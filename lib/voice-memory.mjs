// lib/voice-memory.mjs —— 自生成声音档案（契约 v1.34 §2.19，task-60）。
//
// 用户要求「语言风格自己生成、按记忆来」：不要固定人设，而是从挂件自己的旧输出
// （journal 里的 thought/murmur）里提炼出它自己的声音（句长/节奏/意象/语气/开头收尾），
// 存成 voice.json，供 self-talk prompt 使用。
//
// 文件：`$DSH_HOME/agent-memory/voice.json`（`DSH_VOICE` 可覆盖）
//   {ok:true, v:1, updatedAt, profile:string, exemplars:string[≤3], sourceEntries:number}
//
// 边界：只读自己的 journal（白名单 kind thought/murmur），prompt 明确「不是用户说的话」；
// voice 只描述自己的语言风格，不写用户/会话内容；refresh 失败静默，写盘原子。
import { callCandidate } from './llm-call.mjs'
import { naturalStyleLines } from './language-style.mjs'
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { readRecentJournalEntries } from './memory-recall.mjs'
import { normalizeEffort } from './model-policy.mjs'
import { resolveMemoryDir } from './memory-journal.mjs'

/** 刷新周期：24h。 */
export const VOICE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 单次刷新最多扫描 journal 的行数（最后 N 行）。 */
export const VOICE_JOURNAL_SCAN_LINES = 200
/** 时间均匀抽样上限。 */
export const VOICE_SAMPLE_MAX = 40
/** 声音档案 profile 上限（文件校验）。 */
export const VOICE_PROFILE_MAX_CHARS = 400
/** prompt 期望的 profile 长度区间。 */
export const VOICE_PROFILE_PROMPT_MIN = 120
export const VOICE_PROFILE_PROMPT_MAX = 250
/** exemplars 上限与单条字数。 */
export const VOICE_EXEMPLAR_MAX = 3
export const VOICE_EXEMPLAR_MAX_CHARS = 80
/** 模型调用超时（契约 v1.38 起 20s→40s）。 */
export const VOICE_TIMEOUT_MS = 40000
/** 启动后首次刷新延迟（等宿主 llm/默认模型就绪；插件初始化瞬间通常还没就绪）。 */
export const VOICE_INITIAL_DELAY_MS = 15 * 1000
/** 刷新失败后的首次重试延迟。 */
export const VOICE_RETRY_BASE_MS = 5 * 60 * 1000
/** 重试指数退避上限。 */
export const VOICE_RETRY_MAX_MS = 30 * 60 * 1000
/** self-talk 兜底触发刷新时的最小节流间隔。 */
export const VOICE_FALLBACK_THROTTLE_MS = 5 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function charLength(text) {
  return Array.from(text).length
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanText(value, max = 400) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, max)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** 解析 voice 文件路径：`DSH_VOICE` 优先 → `$DSH_HOME/agent-memory/voice.json`。 */
export function resolveVoicePath(env = process.env, home = null) {
  const custom = typeof env?.DSH_VOICE === 'string' ? env.DSH_VOICE.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  return path.join(resolveMemoryDir(env, home), 'voice.json')
}

/** 从 journal 条目中按白名单提取可作样本的文本（thought/murmur）。 */
export function collectVoiceSamples(entries, max = VOICE_SAMPLE_MAX) {
  const texts = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPlainObject(entry)) continue
    if (entry.kind !== 'thought' && entry.kind !== 'murmur') continue
    const text = cleanText(entry.text, 120)
    if (text.length === 0) continue
    texts.push(text)
  }
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : VOICE_SAMPLE_MAX
  if (texts.length <= limit) return texts
  // 时间上均匀抽样（旧→新），避免全都来自最近同一段语气。
  const sampled = []
  const seen = new Set()
  for (let index = 0; index < limit; index += 1) {
    const position = Math.round((index * (texts.length - 1)) / (limit - 1))
    const text = texts[position]
    if (seen.has(text)) continue
    seen.add(text)
    sampled.push(text)
  }
  return sampled
}

/** 构造 voice 提炼 prompt（隐私白名单：只含自己写过的句子）。 */
export function buildVoiceRefreshPrompt(samples) {
  const list = (Array.isArray(samples) ? samples : []).slice(0, VOICE_SAMPLE_MAX)
  return [
    '下面这些文字都是**你自己**过去写过的自言自语/自省（不是用户说的话，也不是用户消息）；请只分析你自己的语言习惯。',
    ...list.map((text) => `- ${cleanText(text, 120)}`),
    '请提炼出你自己的「声音」，输出严格 JSON：',
    '{"profile":"第一人称写你自己的声音：句长、节奏、常用意象、语气、开头收尾习惯。不要用「温柔」「调皮」这种扁平标签；不要写用户；不要编造没写过的东西。",',
    '"exemplars":["从上面挑 3 句风格各不相同的旧句子，代表你的语气；只可轻微节选，不要新造"]}',
    `profile 请写 ${VOICE_PROFILE_PROMPT_MIN}–${VOICE_PROFILE_PROMPT_MAX} 字；exemplars 必须来自上面的句子。`,
    '只输出 JSON，不要 markdown、不要解释。',
    ...naturalStyleLines(),
  ].join('\n')
}

/** 校验并归一化 voice 文件内容；非法返回 null。 */
export function normalizeVoiceFile(raw) {
  if (!isPlainObject(raw)) return null
  if (raw.ok !== true || raw.v !== 1) return null
  const profile = cleanText(raw.profile, VOICE_PROFILE_MAX_CHARS)
  if (profile.length === 0) return null
  if (!Array.isArray(raw.exemplars)) return null
  const exemplars = []
  for (const item of raw.exemplars) {
    if (typeof item !== 'string') continue
    const text = cleanText(item, VOICE_EXEMPLAR_MAX_CHARS)
    if (text.length === 0 || exemplars.includes(text)) continue
    exemplars.push(text)
    if (exemplars.length >= VOICE_EXEMPLAR_MAX) break
  }
  if (exemplars.length === 0) return null
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  const sourceEntries =
    typeof raw.sourceEntries === 'number' && Number.isFinite(raw.sourceEntries) && raw.sourceEntries >= 0
      ? Math.floor(raw.sourceEntries)
      : 0
  return { ok: true, v: 1, updatedAt, profile, exemplars, sourceEntries }
}

/** 从模型输出解析 {profile, exemplars}；非法返回 {ok:false}。 */
export function parseVoiceResult(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, message: '模型没有输出' }
  const trimmed = text.trim()
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  let raw = null
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) {
        raw = parsed
        break
      }
    } catch {
      /* try next */
    }
  }
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }
  const profile = cleanText(raw.profile, VOICE_PROFILE_MAX_CHARS)
  if (profile.length === 0) return { ok: false, message: 'profile 为空' }
  if (charLength(profile) > VOICE_PROFILE_MAX_CHARS) return { ok: false, message: 'profile 超长' }
  if (!Array.isArray(raw.exemplars)) return { ok: false, message: 'exemplars 不是数组' }
  const exemplars = []
  for (const item of raw.exemplars) {
    if (typeof item !== 'string') continue
    const example = cleanText(item, VOICE_EXEMPLAR_MAX_CHARS + 1)
    if (example.length === 0) continue
    if (charLength(example) > VOICE_EXEMPLAR_MAX_CHARS) return { ok: false, message: 'exemplar 超过 80 字' }
    if (!exemplars.includes(example)) exemplars.push(example)
    if (exemplars.length >= VOICE_EXEMPLAR_MAX) break
  }
  if (exemplars.length === 0) return { ok: false, message: '缺少 exemplar' }
  return { ok: true, profile, exemplars }
}

/**
 * 创建 voice 服务。
 * @param {{
 *   llm?: object|(() => object|undefined|null),
 *   getLlm?: () => object|undefined|null,
 *   getSelection?: () => {provider?: string, model?: string}|null,
 *   journalPath?: string,
 *   voicePath?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   refreshIntervalMs?: number,
 *   initialDelayMs?: number,
 *   retryBaseMs?: number,
 *   retryMaxMs?: number,
 *   timeoutMs?: number,
 *   policy?: object|Function|null,
 *   modelErrorsPath?: string|null,
 * }} [options]
 */
export function createVoiceService(options = {}) {
  const voicePath = path.resolve(options.voicePath ?? resolveVoicePath(options.env, options.home))
  const journalPath =
    options.journalPath ??
    path.join(
      resolveMemoryDir(options.env ?? process.env, options.home ?? null),
      'journal.jsonl',
    )
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const refreshIntervalMs =
    Number.isFinite(options.refreshIntervalMs) && options.refreshIntervalMs > 0
      ? options.refreshIntervalMs
      : VOICE_REFRESH_INTERVAL_MS
  const initialDelayMs =
    Number.isFinite(options.initialDelayMs) && options.initialDelayMs >= 0 ? options.initialDelayMs : VOICE_INITIAL_DELAY_MS
  const retryBaseMs =
    Number.isFinite(options.retryBaseMs) && options.retryBaseMs > 0 ? options.retryBaseMs : VOICE_RETRY_BASE_MS
  const retryMaxMs =
    Number.isFinite(options.retryMaxMs) && options.retryMaxMs >= retryBaseMs ? options.retryMaxMs : VOICE_RETRY_MAX_MS
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : VOICE_TIMEOUT_MS
  const policy = options.policy ?? null
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null

  let cache = null // {mtimeMs, data}
  let refreshing = false
  let disposed = false
  /** @type {ReturnType<typeof setTimeout>|null} 唯一的调度 timer（stop/dispose 会清理）。 */
  let timer = null
  let started = false
  let retryDelayMs = retryBaseMs

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

  /** 读取 voice（mtime 缓存；坏文件/缺失返回 null，不抛）。 */
  function get() {
    try {
      const stat = statSync(voicePath)
      if (cache !== null && cache.mtimeMs === stat.mtimeMs) return cache.data
      const parsed = normalizeVoiceFile(JSON.parse(readFileSync(voicePath, 'utf8')))
      cache = { mtimeMs: stat.mtimeMs, data: parsed }
      return parsed
    } catch {
      cache = null
      return null
    }
  }

  /** v1.38：按 role 从 policy 取 provider/model/reasoningEffort。 */
  function policySelection(role) {
    if (policy === null || policy === undefined) return null
    try {
      const picked =
        typeof policy === 'function'
          ? policy(role)
          : typeof policy.forRole === 'function'
            ? policy.forRole(role)
            : typeof policy.resolve === 'function'
              ? policy.resolve(role)
              : null
      if (!isPlainObject(picked)) return null
      const provider = typeof picked.provider === 'string' ? picked.provider.trim() : ''
      const model = typeof picked.model === 'string' ? picked.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return null
      const effort = normalizeEffort(picked.reasoningEffort)
      return effort !== null ? { provider, model, reasoningEffort: effort } : { provider, model }
    } catch {
      return null
    }
  }

  /** v1.39：按 role 取候选模型列表（policy.resolveCandidates → 单候选 → selection）。 */
  function modelCandidates(role) {
    const out = []
    const seen = new Set()
    const push = (candidate) => {
      if (!isPlainObject(candidate)) return
      const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
      const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return
      const key = `${provider}\u0000${model}`
      if (seen.has(key)) return
      seen.add(key)
      const effort = normalizeEffort(candidate.reasoningEffort)
      out.push({
        provider,
        model,
        ...(effort !== null ? { reasoningEffort: effort } : {}),
        ...(candidate.omitTemperature === true ? { omitTemperature: true } : {}),
        ...(candidate.omitReasoningEffort === true ? { omitReasoningEffort: true } : {}),
        ...(Number.isFinite(candidate.maxTokensFloor) ? { maxTokensFloor: candidate.maxTokensFloor } : {}),
      })
    }
    try {
      if (policy !== null && policy !== undefined && typeof policy.resolveCandidates === 'function') {
        const candidates = policy.resolveCandidates(role)
        if (Array.isArray(candidates)) for (const candidate of candidates) push(candidate)
      }
    } catch {
      /* ignore */
    }
    if (out.length === 0) {
      push(policySelection(role))
      try {
        const selection = getSelection()
        if (isPlainObject(selection)) {
          push({
            provider: typeof selection.provider === 'string' ? selection.provider : '',
            model: typeof selection.model === 'string' ? selection.model : '',
          })
        }
      } catch {
        /* ignore */
      }
    }
    return out
  }

  function selectionOf() {
    const fromPolicy = policySelection('voice')
    if (fromPolicy !== null) return fromPolicy
    try {
      const selection = getSelection()
      if (!isPlainObject(selection)) return null
      const provider = typeof selection.provider === 'string' ? selection.provider.trim() : ''
      const model = typeof selection.model === 'string' ? selection.model.trim() : ''
      return provider.length > 0 && model.length > 0 ? { provider, model } : null
    } catch {
      return null
    }
  }

  /** 单个候选尝试（独立超时；仅未产出任何文本前失败可回退）。 */
  async function attemptCandidate(candidate, prompt) {
    return callCandidate({
      candidate,
      resolveLlm,
      system: '你是住在 DSH Web 角落的鲸鱼娘挂件。现在请你只分析「你自己」过去写过的文字，提炼你自己的语言声音；不要分析或提到用户。',
      prompt,
      maxTokens: 320,
      temperature: 0.8,
      timeoutMs,
      timeoutCode: 'VOICE_TIMEOUT',
      timeoutMessage: `声音提炼超时（${timeoutMs}ms）`,
      role: 'voice',
      prefix: '声音提炼候选失败',
      modelErrorsPath,
      warn,
      honorFinishFailure: false,
    })
  }

  /** 调模型：按候选顺序尝试；返回 {text, provider, model}；全部失败返回 null。 */
  async function callModel(prompt) {
    let llm = null
    try {
      llm = resolveLlm()
    } catch {
      llm = null
    }
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') return null
    const candidates = modelCandidates('voice')
    let lastMessage = '宿主尚未配置默认模型'
    for (const candidate of candidates) {
      const result = await attemptCandidate(candidate, prompt)
      if (result.ok === true) return { text: result.text, provider: candidate.provider, model: candidate.model }
      lastMessage = result.message
      if (result.retryable !== true) break
    }
    warn(lastMessage)
    return null
  }

  /** 实际执行一次提炼（调用方负责 refreshing 标志与失败调度）。 */
  async function refreshOnce() {
    try {
      const entries = readRecentJournalEntries(journalPath, VOICE_JOURNAL_SCAN_LINES)
      const samples = collectVoiceSamples(entries, VOICE_SAMPLE_MAX)
      if (samples.length < 3) {
        warn('声音提炼跳过：journal 里可用的自身文本太少')
        return { ok: false, reason: 'not-enough-samples' }
      }
      const modelResult = await callModel(buildVoiceRefreshPrompt(samples))
      if (modelResult === null) {
        warn('声音提炼失败：模型不可用，推迟到下一周期')
        return { ok: false, reason: 'llm' }
      }
      const parsed = parseVoiceResult(modelResult.text)
      if (parsed.ok !== true) {
        warn(`声音提炼结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      const payload = {
        ok: true,
        v: 1,
        updatedAt: now(),
        profile: parsed.profile,
        exemplars: parsed.exemplars,
        sourceEntries: samples.length,
      }
      writeJsonAtomic(voicePath, payload)
      cache = null
      info(
        `声音档案已更新（${samples.length} 条旧记忆提炼，${payload.exemplars.length} 句示例；${modelResult.provider}/${modelResult.model}）`,
      )
      return { ok: true, voice: payload }
    } catch (error) {
      warn(`声音提炼异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    }
  }

  /**
   * 对外刷新入口：不并发；若已 start，按结果自动重排（成功 24h / 失败 5min 起指数退避）。
   */
  async function refreshNow() {
    if (disposed) return { ok: false, reason: 'disposed' }
    if (refreshing) return { ok: false, reason: 'busy' }
    refreshing = true
    let result
    try {
      result = await refreshOnce()
    } catch (error) {
      result = { ok: false, reason: shortMessage(error) }
    } finally {
      refreshing = false
    }
    if (started) {
      const ok = result !== null && result !== undefined && result.ok === true
      const nextDelay = retryDelayMs
      scheduleAfterResult(ok)
      if (!ok) {
        const waitText = nextDelay >= 1000 ? `${Math.round(nextDelay / 1000)}s` : `${nextDelay}ms`
        warn(`声音档案刷新失败（${result?.reason ?? 'unknown'}），${waitText} 后重试`)
      }
    }
    return result
  }

  /** 清掉当前调度 timer。 */
  function clearSchedule() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 安排下一次刷新（成功 24h；失败按 5min→10min→…→30min 指数退避）。 */
  function scheduleAfterResult(ok) {
    if (disposed || !started) return
    clearSchedule()
    let delay
    if (ok) {
      retryDelayMs = retryBaseMs
      delay = refreshIntervalMs
    } else {
      delay = retryDelayMs
      retryDelayMs = Math.min(retryMaxMs, retryDelayMs * 2)
    }
    timer = setTimeout(() => {
      timer = null
      attemptRefresh().catch(() => {})
    }, delay)
    timer.unref?.()
  }

  /** 定时触发一次刷新（不并发；在途时顺延重试）。 */
  async function attemptRefresh() {
    if (disposed) return { ok: false, reason: 'disposed' }
    if (refreshing) {
      // 已有刷新在跑：不并发，稍后按退避再试。
      scheduleAfterResult(false)
      return { ok: false, reason: 'busy' }
    }
    return refreshNow()
  }

  /**
   * 首次延迟到点后的检查：缺文件或已过期才刷新；新鲜文件安排到过期时刻再刷新。
   * （避免每次重载都对新鲜 voice.json 多发一次模型调用。）
   */
  function initialCheck() {
    if (disposed || !started) return
    const current = get()
    if (current !== null && now() - current.updatedAt < refreshIntervalMs) {
      const remaining = Math.max(1000, refreshIntervalMs - (now() - current.updatedAt))
      clearSchedule()
      timer = setTimeout(() => {
        timer = null
        attemptRefresh().catch(() => {})
      }, remaining)
      timer.unref?.()
      return
    }
    attemptRefresh().catch(() => {})
  }

  /** 启动调度：首次延迟 initialDelayMs（等 llm 就绪），之后成功 24h / 失败指数退避重试。 */
  function start() {
    if (disposed || started) return
    started = true
    clearSchedule()
    timer = setTimeout(() => {
      timer = null
      initialCheck()
    }, initialDelayMs)
    timer.unref?.()
  }

  function stop() {
    started = false
    clearSchedule()
  }

  function dispose() {
    disposed = true
    stop()
  }

  return {
    voicePath,
    journalPath,
    get,
    refreshNow,
    start,
    stop,
    dispose,
    isRefreshing: () => refreshing,
    /** 测试/诊断：当前是否已 start、是否排了 timer、下次重试退避值。 */
    scheduler: () => ({ started, hasTimer: timer !== null, retryDelayMs }),
  }
}
