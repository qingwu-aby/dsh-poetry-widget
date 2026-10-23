// lib/self-growth.mjs —— 最小自驱成长循环（契约 v1.27 §2.16，M38）。
//
// 每 60s tick：
//   · 驱动内在状态随时间漂移（state 由外部创建）；
//   · 每 60min 自我反思：模型输出 {thought} → journal 追加 `{kind:'thought', text:'自省：…'}`；
//   · 每 90min 自学：模型输出 {question,note,topic|null} → 追加 learning-log.md；
//     合法 topic 写入 topics-candidates.json（**不直接写 topics.json**）。
// 失败也把 last*At 推进到当前（推迟到下一周期，不在每个 tick 重试）；并发不重入；20s 超时。
//
// 隐私白名单：prompt 只含时间、内在状态（数字/定性）与固定指令；不读会话正文，
// 不读用户消息，不把用户隐私写进学习日志。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { describeSelfState, formatSelfStateLine } from './self-state.mjs'

/** 循环 tick 间隔（毫秒）。 */
export const SELF_GROWTH_TICK_MS = 60 * 1000
/** 自我反思周期。 */
export const SELF_GROWTH_REFLECT_INTERVAL_MS = 60 * 60 * 1000
/** 自学周期。 */
export const SELF_GROWTH_LEARN_INTERVAL_MS = 90 * 60 * 1000
/** 单次模型调用超时。 */
export const SELF_GROWTH_TIMEOUT_MS = 20000
/** 自学候选文件最多保留条数。 */
export const SELF_GROWTH_MAX_CANDIDATES = 500

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, max)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** 从模型输出中提取 JSON 对象（容忍 markdown fence 与前后文字）。 */
export function extractGrowthJson(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return parsed
    } catch {
      /* try next */
    }
  }
  return null
}

/** 反思 prompt（白名单：时间 + 内在状态 + 最近自省；不含会话/用户内容）。 */
export function buildReflectPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    `现在是 ${new Date(nowMs).toISOString()}。`,
    describeSelfState(state),
  ]
  const recentThoughts = Array.isArray(ctx.recentThoughts)
    ? ctx.recentThoughts.filter((text) => typeof text === 'string' && text.trim().length > 0).slice(0, 2)
    : []
  if (recentThoughts.length > 0) {
    lines.push('你最近的自省（可以自然地接着想，但不要复述原句）：')
    for (const text of recentThoughts) lines.push(`- ${cleanText(text, 80)}`)
  }
  lines.push(
    '请写一句最近的自省：第一人称、简体中文、8–60 个字，像在安静地回想自己今天的状态和念头。',
    '不要提 AI、模型、提示词、系统或程序；不要引用古诗文；不要写用户隐私或会话内容；不要输出数字指标。',
    '只输出严格 JSON：{"thought":"一句自省"}',
  )
  return lines.join('\n')
}

/** 自学 prompt（白名单：时间 + 内在状态 + 话题种子 + 最近自学；要求可入库候选话题）。 */
export function buildLearnPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    `现在是 ${new Date(nowMs).toISOString()}。`,
    formatSelfStateLine(state),
  ]
  if (isPlainObject(ctx.topicSeed) && typeof ctx.topicSeed.title === 'string' && ctx.topicSeed.title.trim().length > 0) {
    const fact = cleanText(ctx.topicSeed.fact, 120)
    lines.push(`你最近记下的一个话题：〈${cleanText(ctx.topicSeed.title, 30)}〉${fact.length > 0 ? `——${fact}` : ''}`)
  }
  const learningSnippet = typeof ctx.learningSnippet === 'string' ? cleanText(ctx.learningSnippet, 100) : ''
  if (learningSnippet.length > 0) lines.push(`你最近自学到：${learningSnippet}`)
  lines.push(
    '请像在自学一样，从上面的话题/你最近自学到的东西出发（没有就自己挑一个），提出一个你最近真正好奇的小问题（≤60 字），再写 2–4 句你已经知道或刚想明白的东西（不要编造细节）。',
    '如果能把它总结成一条值得收进知识库的小知识，给出 topic：',
    '{"id":"kebab-case-英文小写 3–60 字符","title":"≤30 字","fact":"≤120 字，一条准确的小知识","tags":["1–6 个中文或英文标签"]}',
    '如果还不值得入库，topic 用 null。不要写用户隐私、会话内容或任何用户信息。',
    '只输出严格 JSON：{"question":"…","note":"…","topic":{…}|null}',
  )
  return lines.join('\n')
}

/** 校验反思结果。 */
export function parseReflectResult(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }
  const thought = cleanText(raw.thought, 60)
  if (thought.length < 8) return { ok: false, message: '自省太短' }
  if (/[《》「」“”]|——|[诗詩]|词牌|平仄|押韵/u.test(thought)) return { ok: false, message: '自省含引用/诗词痕迹' }
  return { ok: true, thought }
}

/** 校验候选 topic（id/title/fact/tags 白名单）。 */
export function normalizeTopicCandidate(topic) {
  if (!isPlainObject(topic)) return null
  const id = typeof topic.id === 'string' ? topic.id.trim().toLowerCase() : ''
  if (!/^[a-z0-9-]{3,60}$/.test(id)) return null
  const title = cleanText(topic.title, 30)
  const fact = cleanText(topic.fact, 120)
  if (title.length === 0 || fact.length === 0) return null
  if (!Array.isArray(topic.tags)) return null
  const tags = []
  for (const tag of topic.tags) {
    const value = cleanText(tag, 16)
    if (value.length === 0 || tags.includes(value)) continue
    tags.push(value)
    if (tags.length >= 6) break
  }
  if (tags.length === 0) return null
  return { id, title, fact, tags }
}

/** 校验自学结果。 */
export function parseLearnResult(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }
  const question = cleanText(raw.question, 60)
  const note = cleanText(raw.note, 400)
  if (question.length < 4) return { ok: false, message: '缺少问题' }
  if (note.length < 4) return { ok: false, message: '缺少笔记' }
  const topic = raw.topic === null || raw.topic === undefined ? null : normalizeTopicCandidate(raw.topic)
  return { ok: true, question, note, topic }
}

/**
 * 创建自驱成长循环。
 * @param {{
 *   state: {tick: Function, applyEvent: Function, snapshot: Function},
 *   llm?: object|(() => object|undefined|null),
 *   getLlm?: () => object|undefined|null,
 *   getSelection?: () => {provider?: string, model?: string}|null,
 *   journal?: {append: (entry: object) => Promise<object>}|null,
 *   learningLogPath: string,
 *   candidatesPath: string,
 *   topics?: object[]|{read: Function}|null,
 *   recall?: {recentThoughts?: Function, recentLearning?: Function, randomTopicSeed?: Function}|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   reflectIntervalMs?: number,
 *   learnIntervalMs?: number,
 *   timeoutMs?: number,
 *   tickIntervalMs?: number,
 *   random?: () => number,
 * }} options
 */
export function createSelfGrowth(options) {
  const state = options.state
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const journal = options.journal ?? null
  const learningLogPath = path.resolve(options.learningLogPath)
  const candidatesPath = path.resolve(options.candidatesPath)
  const topicsSource = options.topics ?? null
  const memoryRecall = options.recall ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const reflectIntervalMs =
    Number.isFinite(options.reflectIntervalMs) && options.reflectIntervalMs > 0
      ? options.reflectIntervalMs
      : SELF_GROWTH_REFLECT_INTERVAL_MS
  const learnIntervalMs =
    Number.isFinite(options.learnIntervalMs) && options.learnIntervalMs > 0
      ? options.learnIntervalMs
      : SELF_GROWTH_LEARN_INTERVAL_MS
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : SELF_GROWTH_TIMEOUT_MS
  const tickIntervalMs =
    Number.isFinite(options.tickIntervalMs) && options.tickIntervalMs > 0 ? options.tickIntervalMs : SELF_GROWTH_TICK_MS

  let lastReflectAt = now()
  let lastLearnAt = now()
  let reflecting = false
  let learning = false
  let disposed = false
  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function info(message) {
    try {
      logger?.info?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function selectionOf() {
    try {
      const selection = getSelection()
      if (!isPlainObject(selection)) return null
      const provider = typeof selection.provider === 'string' ? selection.provider.trim() : ''
      const model = typeof selection.model === 'string' ? selection.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return null
      return { provider, model }
    } catch {
      return null
    }
  }

  function readTopics() {
    try {
      if (Array.isArray(topicsSource)) return topicsSource
      if (topicsSource !== null && topicsSource !== undefined && typeof topicsSource.read === 'function') {
        const result = topicsSource.read()
        return result !== null && result !== undefined && Array.isArray(result.entries) ? result.entries : []
      }
      return []
    } catch {
      return []
    }
  }

  /** 调模型（20s 超时；失败返回 null，不抛）。 */
  async function callModel(system, userPrompt) {
    const llm = (() => {
      try {
        return resolveLlm()
      } catch {
        return null
      }
    })()
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') return null
    const selection = selectionOf()
    if (selection === null) return null

    let timerId = null
    let timedOut = false
    const timeoutPromise = new Promise((_resolve, reject) => {
      timerId = setTimeout(() => {
        timedOut = true
        const error = new Error(`自驱成长模型调用超时（${timeoutMs}ms）`)
        error.code = 'SELF_GROWTH_TIMEOUT'
        reject(error)
      }, timeoutMs)
      // 不 unref：模型流可能悬挂在 Promise 上，超时计时器是唯一结算保障。
    })
    const collecting = (async () => {
      let text = ''
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
        system,
        maxTokens: 260,
        temperature: 0.9,
        signal: AbortSignal.timeout?.(timeoutMs),
      })) {
        if (isPlainObject(chunk) && chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      }
      return text
    })()
    collecting.catch(() => {})
    try {
      return await Promise.race([collecting, timeoutPromise])
    } catch (error) {
      if (!timedOut) warn(`自驱成长模型调用失败：${shortMessage(error)}`)
      return null
    } finally {
      if (timerId !== null) clearTimeout(timerId)
    }
  }

  function appendLearningLog(currentNow, question, note, topic) {
    const time = new Date(currentNow).toISOString().replace('T', ' ').slice(0, 16)
    const lines = [`\n## ${time} · 自学\n`, `Q: ${question}\n`, `${note}\n`]
    if (topic !== null) lines.push(`候选话题：${topic.title} — ${topic.fact}\n`)
    mkdirSync(path.dirname(learningLogPath), { recursive: true })
    appendFileSync(learningLogPath, lines.join(''), 'utf8')
  }

  function mergeTopicCandidate(topic, currentNow) {
    if (topic === null) return { ok: true, added: false, reason: 'no-topic' }
    try {
      let existing = []
      try {
        const parsed = JSON.parse(readFileSync(candidatesPath, 'utf8'))
        if (isPlainObject(parsed) && Array.isArray(parsed.topics)) existing = parsed.topics
      } catch {
        existing = []
      }
      const ids = new Set()
      for (const item of [...readTopics(), ...existing]) {
        if (isPlainObject(item) && typeof item.id === 'string') ids.add(item.id)
      }
      if (ids.has(topic.id)) return { ok: true, added: false, reason: 'duplicate' }
      existing.push(topic)
      const capped = existing.slice(-SELF_GROWTH_MAX_CANDIDATES)
      writeJsonAtomic(candidatesPath, { ok: true, v: 1, updatedAt: currentNow, topics: capped })
      return { ok: true, added: true }
    } catch (error) {
      warn(`自学候选写入失败：${shortMessage(error)}`)
      return { ok: false, added: false, reason: shortMessage(error) }
    }
  }

  async function reflectNow() {
    if (disposed || reflecting) return { ok: false, reason: 'busy' }
    reflecting = true
    const currentNow = now()
    lastReflectAt = currentNow
    try {
      let recentThoughts = []
      try {
        if (memoryRecall !== null && typeof memoryRecall.recentThoughts === 'function') {
          recentThoughts = memoryRecall.recentThoughts(2)
        }
      } catch {
        recentThoughts = []
      }
      const text = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘挂件，正在安静地回顾自己最近的状态。',
        buildReflectPrompt({ now: currentNow, state: state.snapshot(), recentThoughts }),
      )
      if (text === null) {
        warn('自省：模型不可用，推迟到下一周期')
        return { ok: false, reason: 'llm' }
      }
      const parsed = parseReflectResult(text)
      if (parsed.ok !== true) {
        warn(`自省结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      if (journal !== null && typeof journal.append === 'function') {
        await journal.append({ kind: 'thought', text: `自省：${parsed.thought}` })
      }
      try {
        state.applyEvent('reflect', currentNow)
      } catch {
        /* ignore */
      }
      info(`自省完成：${parsed.thought}`)
      return { ok: true, thought: parsed.thought }
    } catch (error) {
      warn(`自省异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      reflecting = false
    }
  }

  async function learnNow() {
    if (disposed || learning) return { ok: false, reason: 'busy' }
    learning = true
    const currentNow = now()
    lastLearnAt = currentNow
    try {
      let topicSeed = null
      let learningSnippet = ''
      try {
        if (memoryRecall !== null && typeof memoryRecall.randomTopicSeed === 'function') {
          topicSeed = memoryRecall.randomTopicSeed(options.random ?? Math.random)
        }
        if (memoryRecall !== null && typeof memoryRecall.recentLearning === 'function') {
          const recent = memoryRecall.recentLearning(1)
          learningSnippet = Array.isArray(recent) && recent.length > 0 && typeof recent[0] === 'string' ? recent[0] : ''
        }
      } catch {
        topicSeed = null
        learningSnippet = ''
      }
      const text = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘挂件，正在自学一点新知识，并把真正值得记住的收进自己的小知识库。',
        buildLearnPrompt({ now: currentNow, state: state.snapshot(), topicSeed, learningSnippet }),
      )
      if (text === null) {
        warn('自学：模型不可用，推迟到下一周期')
        return { ok: false, reason: 'llm' }
      }
      const parsed = parseLearnResult(text)
      if (parsed.ok !== true) {
        warn(`自学结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      appendLearningLog(currentNow, parsed.question, parsed.note, parsed.topic)
      const merged = mergeTopicCandidate(parsed.topic, currentNow)
      try {
        state.applyEvent('learn', currentNow)
      } catch {
        /* ignore */
      }
      info(`自学完成：${parsed.question}${merged.added === true ? '（新增候选话题）' : ''}`)
      return { ok: true, question: parsed.question, note: parsed.note, topic: parsed.topic, candidateAdded: merged.added === true }
    } catch (error) {
      warn(`自学异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      learning = false
    }
  }

  /** 60s tick：推进状态 + 到点触发反思/自学（失败也推迟到下一周期）。 */
  function tick(atNow) {
    if (disposed) return snapshot()
    const currentNow = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    try {
      state.tick(currentNow)
    } catch (error) {
      warn(`内在状态 tick 失败：${shortMessage(error)}`)
    }
    if (!reflecting && currentNow - lastReflectAt >= reflectIntervalMs) {
      lastReflectAt = currentNow
      reflectNow().catch(() => {})
    }
    if (!learning && currentNow - lastLearnAt >= learnIntervalMs) {
      lastLearnAt = currentNow
      learnNow().catch(() => {})
    }
    return snapshot()
  }

  function start() {
    if (disposed || timer !== null) return
    timer = setInterval(() => {
      try {
        tick()
      } catch {
        /* ignore */
      }
    }, tickIntervalMs)
    timer.unref?.()
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function snapshot() {
    let stateSnapshot = null
    try {
      stateSnapshot = state.snapshot()
    } catch {
      stateSnapshot = null
    }
    return {
      lastReflectAt,
      lastLearnAt,
      learnings: stateSnapshot !== null ? stateSnapshot.learnings : 0,
      reflections: stateSnapshot !== null ? stateSnapshot.reflections : 0,
    }
  }

  function dispose() {
    disposed = true
    stop()
  }

  return {
    tick,
    start,
    stop,
    dispose,
    reflectNow,
    learnNow,
    snapshot,
    learningLogPath,
    candidatesPath,
  }
}
