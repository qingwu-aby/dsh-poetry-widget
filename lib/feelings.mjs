// lib/feelings.mjs —— 自生情绪库（v1.50，M61）。
//
// 用户要求：内在状态不要被量化，也不要只在代码逻辑里打转。如果她出现了现有词说不清的感受，
// 让她**自己调用模型给它造一个名字和描述**，长成独属于她自己的情绪词汇，而不是永远套用固定词表。
//
// 文件：`$DSH_HOME/agent-memory/feelings.json`（env `DSH_POETRY_FEELINGS` 可覆盖）
//   {ok:true, v:1, updatedAt, feelings:[{name, description, tags:[], createdAt, lastUsedAt?}]}
// 规则：
//   · 只追加不删除（和话题库一致：学到的感受也是记忆）；
//   · name 2–10 字（可直接当 mood label 用），description 第一人称 6–60 字；
//   · 重名（trim 后完全一致）不重复写入；
//   · 读取带 mtime 缓存，坏文件/坏行静默降级。
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

/** 情绪名长度（字）。 */
export const FEELING_NAME_MIN = 2
export const FEELING_NAME_MAX = 10
/** 描述长度（字）。 */
export const FEELING_DESC_MIN = 6
export const FEELING_DESC_MAX = 60
/** 自生情绪最多保留条数（只追加，不淘汰；这里只是安全读取上限）。 */
export const FEELINGS_MAX = 500

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

/** 解析自生情绪库路径：`DSH_POETRY_FEELINGS` 优先，否则 `$DSH_HOME/agent-memory/feelings.json`。 */
export function resolveFeelingsPath(env = process.env, home = null) {
  const custom = typeof env?.DSH_POETRY_FEELINGS === 'string' ? env.DSH_POETRY_FEELINGS.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  const base =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.resolve(env.DSH_HOME.trim())
      : path.join(home ?? process.env.HOME ?? os.homedir(), '.dsh')
  return path.join(base, 'agent-memory', 'feelings.json')
}

/** 校验一条自生情绪；非法返回 null。 */
export function normalizeFeeling(item) {
  if (!isPlainObject(item)) return null
  const name = cleanText(item.name, FEELING_NAME_MAX)
  const description = cleanText(item.description, FEELING_DESC_MAX)
  if (Array.from(name).length < FEELING_NAME_MIN || Array.from(name).length > FEELING_NAME_MAX) return null
  if (Array.from(description).length < FEELING_DESC_MIN) return null
  const tags = []
  if (Array.isArray(item.tags)) {
    for (const tag of item.tags) {
      const value = cleanText(tag, 16)
      if (value.length === 0 || tags.includes(value)) continue
      tags.push(value)
      if (tags.length >= 6) break
    }
  }
  return { name, description, ...(tags.length > 0 ? { tags } : {}) }
}

/**
 * 解析模型输出的新情绪（reflect 的 `feeling` 字段）。
 * @param {unknown} raw
 * @returns {{ok:true, feeling:{name:string, description:string, tags?:string[]}} | {ok:false, message:string}}
 */
export function parseNewFeeling(raw) {
  const feeling = normalizeFeeling(raw)
  if (feeling === null) return { ok: false, message: '新情绪格式不符（name 2–10 字、description 6–60 字）' }
  return { ok: true, feeling }
}

/** 读取情绪库（坏 JSON/缺失返回空；坏条目跳过）。 */
export function readFeelingFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!isPlainObject(parsed) || !Array.isArray(parsed.feelings)) return []
    const out = []
    const seen = new Set()
    for (const item of parsed.feelings) {
      const feeling = normalizeFeeling(item)
      if (feeling === null) continue
      if (seen.has(feeling.name)) continue
      seen.add(feeling.name)
      out.push({
        ...feeling,
        ...(typeof item.createdAt === 'number' ? { createdAt: item.createdAt } : {}),
        ...(typeof item.lastUsedAt === 'number' ? { lastUsedAt: item.lastUsedAt } : {}),
        ...(typeof item.uses === 'number' ? { uses: item.uses } : {}),
      })
    }
    return out.slice(-FEELINGS_MAX)
  } catch {
    return []
  }
}

/**
 * 把模型造出来的新感受追加进情绪库（只追加、按 name 去重）。
 * @param {{path: string, feeling: object, now?: number}} options
 * @returns {{ok:boolean, added?:boolean, reason?:string, total?:number}}
 */
export function appendFeeling(options = {}) {
  const file = typeof options.path === 'string' && options.path.trim().length > 0 ? path.resolve(options.path) : ''
  if (file.length === 0) return { ok: false, reason: 'no-feelings-path' }
  const feeling = normalizeFeeling(options.feeling)
  if (feeling === null) return { ok: false, reason: 'invalid-feeling' }
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const existing = readFeelingFile(file)
  if (existing.some((item) => item.name === feeling.name)) {
    return { ok: true, added: false, reason: 'duplicate', total: existing.length }
  }
  const next = [...existing, { ...feeling, createdAt: now }]
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeJsonAtomic(file, { ok: true, v: 1, updatedAt: new Date(now).toISOString(), feelings: next })
    return { ok: true, added: true, total: next.length }
  } catch (error) {
    return { ok: false, reason: `write-failed: ${shortMessage(error)}` }
  }
}

/**
 * 创建情绪库读取器（mtime 缓存，文件更新自动重读；坏文件保留上次可用数据、不抛）。
 * @param {{path?: string, env?: NodeJS.ProcessEnv, home?: string|null, logger?: {warn?: Function}|null}} [options]
 */
export function loadFeelingBank(options = {}) {
  const file = path.resolve(options.path ?? resolveFeelingsPath(options.env, options.home))
  const logger = options.logger ?? null
  let cache = null
  let lastError = ''

  function read() {
    let stat = null
    try {
      stat = statSync(file)
    } catch {
      cache = null
      return { ok: false, reason: 'missing', entries: [] }
    }
    if (cache !== null && cache.mtimeMs === stat.mtimeMs) return { ok: true, entries: cache.entries }
    const entries = readFeelingFile(file)
    if (entries.length === 0 && existsSync(file)) {
      // 空文件是正常的（还没造过新感受），不当作错误。
      cache = { mtimeMs: stat.mtimeMs, entries: [] }
      return { ok: true, entries: [] }
    }
    cache = { mtimeMs: stat.mtimeMs, entries }
    return { ok: true, entries }
  }

  /** 最近 limit 条（旧→新）。 */
  function recent(limit = 2) {
    const result = read()
    const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 2
    return result.entries.slice(-count)
  }

  /** 只取名（用于 prompt 里避免重复造词）。 */
  function names(limit = 20) {
    const result = read()
    const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
    return result.entries
      .slice(-count)
      .map((item) => item.name)
      .filter((name) => typeof name === 'string' && name.length > 0)
  }

  return { file, read, recent, names, get lastError() { return lastError } }
}
