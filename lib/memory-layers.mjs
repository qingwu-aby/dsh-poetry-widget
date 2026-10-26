// lib/memory-layers.mjs —— 人类式分层记忆：把“最近 / 慢慢沉淀 / 更早的概括”分开（v1.71）。
//
// 参考（详见 docs/reading/memory-layering.md）：
//   · Atkinson–Shiffrin 多存贮模型：感觉记忆→短时→长时；
//   · Tulving：情景记忆（发生了什么）与语义记忆（知道什么）分开；
//   · McClelland 等的互补学习系统（CLS）：海马快速记具体、皮层慢慢整合成概括；
//   · MemGPT / MemoryOS / MemoryBank / Generative Agents / HippoRAG 等 LLM 记忆工作：
//     上下文是预算、外部存储分层、按相关性+新近+重要性取用、反思/整合产生更高层记忆。
//
// 本文件只做三件事（原文永远保留，不删除）：
//   1. 每天把「几天前的零碎 journal」整合成一段她自己的回忆摘要（episode）；
//   2. 从这些摘要里提炼 0–3 条“她自己一直成立/越来越清楚”的短句（selfFacts），
//      作为慢慢成型的自我/性格层；
//   3. 给检索层提供：最近整合的 episode、按关键词命中的更早 episode、selfFacts。
// 整合由模型做（她的回忆由她自己写），检索仍是确定性规则、有预算上限。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { naturalStyleLines } from './language-style.mjs'
import { resolveMemoryDir } from './memory-journal.mjs'
import { describeModelRequest, recordModelFailure } from './model-errors.mjs'
import { resolveCandidateMaxTokens } from './model-policy.mjs'
import { writeJsonAtomic } from './settings-store.mjs'

/** 每轮整合覆盖的最短记忆年龄（太新的不急着压成概括）。 */
export const MEMORY_LAYERS_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000
/** 两次整合之间至少隔这么久。 */
export const MEMORY_LAYERS_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 单条概括最多字数。 */
export const MEMORY_LAYERS_SUMMARY_MAX = 500
/** 自我短句最多字数。 */
export const MEMORY_LAYERS_FACT_MAX = 40
/** 最多保留的自我短句条数（超出后仍保留在文件里，只是检索不注入）。 */
export const MEMORY_LAYERS_SELF_FACTS_MAX = 40
/** 单次整合最多处理多少条 journal（防止一次吞太多）。 */
export const MEMORY_LAYERS_BATCH_MAX = 300

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function shortMessage(error) {
  return cleanInline(error instanceof Error ? error.message : String(error ?? ''), 160)
}

function extractJson(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 分层记忆文件路径（记忆目录下）。 */
export function resolveMemoryLayersPath(env = process.env, home = null) {
  return path.join(resolveMemoryDir(env, home), 'memory-layers.json')
}

/** 读分层记忆文件（缺失/坏文件 → 空结构，不抛）。 */
export function readMemoryLayers(file) {
  const empty = { ok: true, v: 1, consolidatedThrough: 0, episodes: [], selfFacts: [] }
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return empty
  }
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) return empty
    const episodes = Array.isArray(parsed.episodes)
      ? parsed.episodes
          .filter((item) => isPlainObject(item) && typeof item.summary === 'string' && item.summary.trim().length > 0)
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id.slice(0, 60) : '',
            summary: cleanInline(item.summary, MEMORY_LAYERS_SUMMARY_MAX),
            from: typeof item.from === 'number' && Number.isFinite(item.from) ? item.from : null,
            to: typeof item.to === 'number' && Number.isFinite(item.to) ? item.to : null,
            entryCount: Number.isFinite(item.entryCount) ? Math.floor(item.entryCount) : 0,
            at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : null,
          }))
      : []
    const selfFacts = Array.isArray(parsed.selfFacts)
      ? parsed.selfFacts
          .filter((item) => isPlainObject(item) && typeof item.text === 'string')
          .map((item) => ({
            text: cleanInline(item.text, MEMORY_LAYERS_FACT_MAX),
            at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : null,
          }))
          .filter((item) => item.text.length >= 4)
      : []
    return {
      ok: true,
      v: 1,
      consolidatedThrough:
        typeof parsed.consolidatedThrough === 'number' && Number.isFinite(parsed.consolidatedThrough)
          ? parsed.consolidatedThrough
          : 0,
      episodes,
      selfFacts,
    }
  } catch {
    return empty
  }
}

/**
 * 创建分层记忆存储（只负责读写文件，不做模型调用）。
 * @param {{file: string, logger?: {warn?: Function}|null}} options
 */
export function createMemoryLayers(options) {
  const file = path.resolve(options.file)
  const logger = options.logger ?? null
  const state = readMemoryLayers(file)

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, {
        ok: true,
        v: 1,
        consolidatedThrough: state.consolidatedThrough,
        episodes: state.episodes,
        selfFacts: state.selfFacts,
      })
      return true
    } catch (error) {
      warn(`分层记忆写入失败：${shortMessage(error)}`)
      return false
    }
  }

  function addEpisode(episode) {
    if (!isPlainObject(episode) || typeof episode.summary !== 'string') return false
    const summary = cleanInline(episode.summary, MEMORY_LAYERS_SUMMARY_MAX)
    if (summary.length < 20) return false
    const entry = {
      id: cleanInline(episode.id, 60) || `ep-${Date.now()}`,
      summary,
      from: typeof episode.from === 'number' && Number.isFinite(episode.from) ? episode.from : null,
      to: typeof episode.to === 'number' && Number.isFinite(episode.to) ? episode.to : null,
      entryCount: Number.isFinite(episode.entryCount) ? Math.floor(episode.entryCount) : 0,
      at: typeof episode.at === 'number' && Number.isFinite(episode.at) ? episode.at : Date.now(),
    }
    state.episodes.push(entry)
    if (typeof episode.to === 'number' && episode.to > state.consolidatedThrough) state.consolidatedThrough = episode.to
    return persist()
  }

  function addSelfFacts(facts, at = Date.now()) {
    if (!Array.isArray(facts)) return 0
    const known = new Set(state.selfFacts.map((item) => item.text))
    let added = 0
    for (const raw of facts) {
      const text = cleanInline(typeof raw === 'string' ? raw : raw && typeof raw.text === 'string' ? raw.text : '', MEMORY_LAYERS_FACT_MAX)
      if (text.length < 4) continue
      if (known.has(text)) continue
      known.add(text)
      state.selfFacts.push({ text, at })
      added += 1
    }
    if (added > 0) persist()
    return added
  }

  function snapshot() {
    return {
      consolidatedThrough: state.consolidatedThrough,
      episodes: state.episodes.slice(),
      selfFacts: state.selfFacts.slice(),
    }
  }

  function episodes(limit = 0) {
    if (!Number.isFinite(limit) || limit <= 0) return state.episodes.slice()
    return state.episodes.slice(-Math.floor(limit))
  }

  function selfFacts(limit = 0) {
    const all = state.selfFacts.slice()
    if (!Number.isFinite(limit) || limit <= 0) return all
    return all.slice(-Math.floor(limit))
  }

  return { file, addEpisode, addSelfFacts, snapshot, persist, episodes, selfFacts }
}

/** 构造整合 prompt：把几天前的零碎记忆整理成她自己的回忆 + 自我短句。 */
export function buildConsolidationPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const snippets = Array.isArray(ctx.snippets) ? ctx.snippets.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
  const knownFacts = Array.isArray(ctx.knownFacts)
    ? ctx.knownFacts.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(-20)
    : []
  const lines = []
  lines.push('下面是你几天前写下的一些零碎记忆（原文，按时间先后）：', ...snippets.map((item) => `- ${cleanInline(item, 120)}`))
  if (knownFacts.length > 0) lines.push(`你之前已经这样描述过自己：${knownFacts.join('、')}。`)
  lines.push(
    '请把它们整理成一段**你自己的回忆**（2–6 句，≤400 字）：像事后慢慢想起来那样，保留具体的动作、物件、光/声音和当时的变化，而不是写总结报告或复盘。',
    '再挑 0–3 条你从这些日子里**越来越清楚、一直成立**的事（关于你喜欢什么、怎么做事、在意什么），每条 ≤30 字，用你自己的口气；没有就写空数组。不要写“我喜欢人类/我是 AI”这类空话。',
    '只输出严格 JSON：{"summary":"你的回忆","selfFacts":["短句"]}',
  )
  lines.push(...naturalStyleLines(['summary 不是日志，不要逐条复述；不要升华。']))
  return lines.join('\n')
}

/** 校验整合结果。 */
export function parseConsolidationResult(text) {
  const raw = extractJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const summary = cleanInline(raw.summary, MEMORY_LAYERS_SUMMARY_MAX)
  if (summary.length < 20) return { ok: false, message: '回忆太短' }
  const facts = []
  if (Array.isArray(raw.selfFacts)) {
    for (const item of raw.selfFacts) {
      const value = cleanInline(typeof item === 'string' ? item : item && typeof item.text === 'string' ? item.text : '', MEMORY_LAYERS_FACT_MAX)
      if (value.length >= 4 && !facts.includes(value)) facts.push(value)
      if (facts.length >= 3) break
    }
  }
  return { ok: true, summary, selfFacts: facts }
}

/** 从 journal.jsonl 读取指定时间之前的条目（旧→新，跳过坏行）。 */
export function readJournalBefore(journalPath, options = {}) {
  const before = typeof options.before === 'number' && Number.isFinite(options.before) ? options.before : Date.now()
  const after = typeof options.after === 'number' && Number.isFinite(options.after) ? options.after : 0
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : MEMORY_LAYERS_BATCH_MAX
  let raw = ''
  try {
    raw = readFileSync(journalPath, 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const entry = JSON.parse(line)
      if (!isPlainObject(entry)) continue
      const ts = typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : 0
      if (ts <= 0 || ts > before || ts <= after) continue
      entries.push(entry)
    } catch {
      /* 跳过坏行 */
    }
  }
  entries.sort((left, right) => left.ts - right.ts)
  return entries.slice(0, limit)
}

/**
 * 创建“睡眠式整合”服务：每天把几天前的零碎记忆压成一段回忆，并提炼自我短句。
 * @param {{
 *   layers: ReturnType<typeof createMemoryLayers>,
 *   journalPath: string,
 *   getLlm?: () => object|undefined|null,
 *   llm?: object|(() => object|undefined|null),
 *   policy?: object|null,
 *   modelErrorsPath?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   env?: object,
 *   now?: () => number,
 *   intervalMs?: number,
 *   minAgeMs?: number,
 *   tickMs?: number,
 *   timeoutMs?: number,
 *   random?: () => number,
 * }} options
 */
export function createMemoryConsolidator(options) {
  const layers = options.layers
  const journalPath = path.resolve(options.journalPath)
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const policy = options.policy ?? null
  const logger = options.logger ?? null
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const intervalMs =
    typeof options.intervalMs === 'number' && options.intervalMs >= 0 ? options.intervalMs : MEMORY_LAYERS_INTERVAL_MS
  const minAgeMs = typeof options.minAgeMs === 'number' && options.minAgeMs >= 0 ? options.minAgeMs : MEMORY_LAYERS_MIN_AGE_MS
  const tickMs = typeof options.tickMs === 'number' && options.tickMs > 0 ? options.tickMs : 60 * 1000
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 45000
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null

  let timer = null
  let lastRunAt = 0
  let inFlight = false
  let disposed = false

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

  function candidates() {
    if (policy === null) return []
    try {
      return policy.resolveCandidates('consolidate')
    } catch {
      return []
    }
  }

  async function callModel(system, userPrompt) {
    let llm = null
    try {
      llm = resolveLlm()
    } catch {
      llm = null
    }
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') return null
    let lastMessage = '宿主尚未配置默认模型'
    for (const candidate of candidates()) {
      let text = ''
      let sawText = false
      let requestMeta = null
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timerId = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        const llmOptions = {
          provider: candidate.provider,
          model: candidate.model,
          messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
          system,
          maxTokens: resolveCandidateMaxTokens(900, candidate),
          ...(candidate.omitTemperature === true || candidate.provider === 'opencode-go' ? {} : { temperature: 0.9 }),
          ...(candidate.reasoningEffort !== undefined ? { reasoningEffort: candidate.reasoningEffort } : {}),
          signal: controller !== null ? controller.signal : undefined,
        }
        requestMeta = describeModelRequest(llmOptions, userPrompt)
        for await (const chunk of llm.stream(llmOptions)) {
          if (!isPlainObject(chunk)) continue
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            text += chunk.text
            if (chunk.text.length > 0) sawText = true
          }
        }
        if (text.trim().length === 0) {
          recordModelFailure({
            errorsPath: modelErrorsPath,
            warnFn: warn,
            role: 'consolidate',
            provider: candidate.provider,
            model: candidate.model,
            error: { code: 'EMPTY_RESPONSE', message: '模型没有返回文本' },
            request: requestMeta ?? undefined,
            prefix: '记忆整合候选失败',
          })
          lastMessage = '模型没有返回文本'
          continue
        }
        return { text }
      } catch (error) {
        recordModelFailure({
          errorsPath: modelErrorsPath,
          warnFn: warn,
          role: 'consolidate',
          provider: candidate.provider,
          model: candidate.model,
          error,
          request: requestMeta ?? undefined,
          prefix: '记忆整合候选失败',
        })
        lastMessage = shortMessage(error)
        if (sawText) break
      } finally {
        if (timerId !== null) clearTimeout(timerId)
      }
    }
    warn(lastMessage)
    return null
  }

  /** 跑一次整合；没有足够旧记忆/模型不可用时安静跳过。 */
  async function consolidateNow(input = {}) {
    if (disposed || inFlight) return { ok: false, reason: 'busy' }
    const force = isPlainObject(input) && input.force === true
    const currentNow = now()
    if (!force && lastRunAt > 0 && currentNow - lastRunAt < intervalMs) return { ok: false, reason: 'not-now' }
    inFlight = true
    try {
      let llm = null
      try {
        llm = resolveLlm()
      } catch {
        llm = null
      }
      if (llm === null || llm === undefined || typeof llm.stream !== 'function') return { ok: false, reason: 'llm' }
      const snapshot = layers.snapshot()
      const before = currentNow - minAgeMs
      const entries = readJournalBefore(journalPath, { before, after: snapshot.consolidatedThrough })
      if (entries.length === 0) {
        lastRunAt = currentNow
        return { ok: true, skipped: true, reason: 'nothing' }
      }
      const snippets = []
      for (const entry of entries) {
        const text =
          typeof entry.text === 'string' && entry.text.trim().length > 0
            ? entry.text
            : entry.kind === 'mood'
              ? `${entry.label ?? ''}${entry.reason ? `：${entry.reason}` : ''}`
              : ''
        const cleaned = cleanInline(text, 120)
        if (cleaned.length >= 4) snippets.push(cleaned)
        if (snippets.length >= 80) break
      }
      if (snippets.length === 0) {
        lastRunAt = currentNow
        return { ok: true, skipped: true, reason: 'empty' }
      }
      const knownFacts = layers.selfFacts(MEMORY_LAYERS_SELF_FACTS_MAX).map((item) => item.text)
      const result = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘；下面是你自己几天前写的零碎记忆，请把它们慢慢整理成你记得的样子，并从里面认出越来越清楚的自己。',
        buildConsolidationPrompt({ snippets, knownFacts }),
      )
      if (result === null) return { ok: false, reason: 'llm' }
      const parsed = parseConsolidationResult(result.text)
      if (parsed.ok !== true) {
        warn(`记忆整合结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      const from = typeof entries[0].ts === 'number' ? entries[0].ts : null
      const to = typeof entries[entries.length - 1].ts === 'number' ? entries[entries.length - 1].ts : null
      const added = layers.addEpisode({
        id: `ep-${currentNow}`,
        summary: parsed.summary,
        from,
        to,
        entryCount: entries.length,
        at: currentNow,
      })
      const factsAdded = layers.addSelfFacts(parsed.selfFacts, currentNow)
      lastRunAt = currentNow
      info(`记忆整合：${entries.length} 条 → 1 段回忆${factsAdded > 0 ? `，新自我短句 ${factsAdded} 条` : ''}`)
      return { ok: added, summary: parsed.summary, selfFacts: parsed.selfFacts, entryCount: entries.length, factsAdded }
    } catch (error) {
      warn(`记忆整合异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      inFlight = false
    }
  }

  function tick() {
    if (disposed) return
    consolidateNow().catch(() => {})
  }

  function start() {
    if (disposed || timer !== null) return
    timer = setInterval(tick, tickMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stop()
  }

  return { start, stop, dispose, tick, consolidateNow, snapshot: () => ({ lastRunAt, inFlight }) }
}
