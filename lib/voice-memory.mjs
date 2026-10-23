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
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { readRecentJournalEntries } from './memory-recall.mjs'
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
/** 模型调用超时。 */
export const VOICE_TIMEOUT_MS = 20000

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
 *   timeoutMs?: number,
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
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : VOICE_TIMEOUT_MS

  let cache = null // {mtimeMs, data}
  let refreshing = false
  let disposed = false
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

  function selectionOf() {
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

  async function callModel(prompt) {
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
        const error = new Error(`声音提炼超时（${timeoutMs}ms）`)
        error.code = 'VOICE_TIMEOUT'
        reject(error)
      }, timeoutMs)
    })
    const collecting = (async () => {
      let text = ''
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        system: '你是住在 DSH Web 角落的鲸鱼娘挂件。现在请你只分析「你自己」过去写过的文字，提炼你自己的语言声音；不要分析或提到用户。',
        maxTokens: 320,
        temperature: 0.8,
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
      })) {
        if (isPlainObject(chunk) && chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      }
      return text
    })()
    collecting.catch(() => {})
    try {
      return await Promise.race([collecting, timeoutPromise])
    } catch (error) {
      if (!timedOut) warn(`声音提炼模型调用失败：${shortMessage(error)}`)
      return null
    } finally {
      if (timerId !== null) clearTimeout(timerId)
    }
  }

  /** 从 journal 重新提炼一次声音并原子写 voice.json；失败静默。 */
  async function refreshNow() {
    if (disposed || refreshing) return { ok: false, reason: 'busy' }
    refreshing = true
    try {
      const entries = readRecentJournalEntries(journalPath, VOICE_JOURNAL_SCAN_LINES)
      const samples = collectVoiceSamples(entries, VOICE_SAMPLE_MAX)
      if (samples.length < 3) {
        warn('声音提炼跳过：journal 里可用的自身文本太少')
        return { ok: false, reason: 'not-enough-samples' }
      }
      const text = await callModel(buildVoiceRefreshPrompt(samples))
      if (text === null) {
        warn('声音提炼失败：模型不可用，推迟到下一周期')
        return { ok: false, reason: 'llm' }
      }
      const parsed = parseVoiceResult(text)
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
      info(`声音档案已更新（${samples.length} 条旧记忆提炼，${payload.exemplars.length} 句示例）`)
      return { ok: true, voice: payload }
    } catch (error) {
      warn(`声音提炼异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      refreshing = false
    }
  }

  /** 缺失或超 24h 才刷新；之后每 24h 一次（unref）。 */
  function start() {
    if (disposed || timer !== null) return
    const maybeRefresh = () => {
      const current = get()
      if (current === null || now() - current.updatedAt >= refreshIntervalMs) {
        refreshNow().catch(() => {})
      }
    }
    maybeRefresh()
    timer = setInterval(maybeRefresh, refreshIntervalMs)
    timer.unref?.()
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
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
  }
}
