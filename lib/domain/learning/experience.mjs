// lib/experience.mjs —— 「体验/情绪」状态文件通道（契约 v1.17 §2.12，M23）。
//
// 挂件的图像要和「我最近在体验什么、因此有什么情绪」强相关：正在读的小说/看的视频
// 里的情节会带来感动、紧张、开心等情绪。宿主无法也不应该读取会话/内容，因此由外部
// （agent/用户）在体验时写一个轻量状态文件：
//
//   $DSH_HOME/.dsh-poetry/experience.json
//   {
//     "title": "海上钢琴师",             // 1–80 字
//     "kind": "video",                  // novel|video|article|music|other
//     "emotion": "touched",             // touched|sad|happy|tense|curious|calm|angry|inspired
//     "note": "结尾那段琴声听得眼眶发热",  // 可选，≤200 字
//     "at": 1761135600000               // 毫秒时间戳（也接受 ISO 8601 字符串）
//   }
//
// 本模块只做只读校验：缺失/坏 JSON/过期/越界/未知枚举一律返回 {ok:false,reason}，
// 绝不抛异常；超过 maxAgeMs（默认 2 小时）视为过期，避免旧情绪长期影响心情。
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 体验类型 → 中文标签。 */
export const EXPERIENCE_KIND_LABELS = Object.freeze({
  novel: '小说',
  video: '视频',
  article: '文章',
  music: '音乐',
  other: '其他',
})

/** 体验带来的情绪 → 中文标签。 */
export const EXPERIENCE_EMOTION_LABELS = Object.freeze({
  touched: '感动鼻酸',
  sad: '难过',
  happy: '开心',
  tense: '紧张',
  curious: '好奇',
  calm: '平静',
  angry: '生气',
  inspired: '振奋',
})

/** 状态文件默认有效期：2 小时。 */
export const EXPERIENCE_MAX_AGE_MS = 2 * 60 * 60 * 1000
/** 标题最大字数。 */
export const EXPERIENCE_TITLE_MAX_CHARS = 80
/** 备注最大字数。 */
export const EXPERIENCE_NOTE_MAX_CHARS = 200
/** 允许的未来时间偏差（时钟漂移容忍；超过视为坏时间戳）。 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function charLength(text) {
  return Array.from(text).length
}

/**
 * 解析体验状态文件路径：`DSH_POETRY_EXPERIENCE` 优先，否则 `$DSH_HOME/.dsh-poetry/experience.json`
 * （DSH_HOME 未设则 `~/.dsh`）。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string|null} [home]
 * @returns {string}
 */
export function resolveExperiencePath(env = process.env, home = null) {
  const custom = typeof env?.DSH_POETRY_EXPERIENCE === 'string' ? env.DSH_POETRY_EXPERIENCE.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  const base =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.resolve(env.DSH_HOME.trim())
      : path.join(home ?? process.env.HOME ?? os.homedir(), '.dsh')
  return path.join(base, '.dsh-poetry', 'experience.json')
}

/** 归一化时间戳：毫秒数或 ISO 8601 字符串；非法返回 null。 */
function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function resolveNow(now) {
  if (typeof now === 'function') {
    try {
      const value = now()
      const normalized = normalizeTimestamp(value instanceof Date ? value.getTime() : value)
      if (normalized !== null) return normalized
    } catch {
      /* fallthrough */
    }
  } else {
    const normalized = normalizeTimestamp(now instanceof Date ? now.getTime() : now)
    if (normalized !== null) return normalized
  }
  return Date.now()
}

/**
 * 读取并校验体验状态文件（只读，永不抛）。
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string|null,
 *   now?: number|Date|(() => number|Date),
 *   maxAgeMs?: number,
 * }} [options]
 * @returns {{ok:true, experience:{title:string,kind:string,emotion:string,note?:string,at:number}} | {ok:false, reason:string}}
 */
export function readExperience(options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? null
  const now = resolveNow(options.now)
  const maxAgeMs =
    Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0 ? Math.floor(options.maxAgeMs) : EXPERIENCE_MAX_AGE_MS
  const file = resolveExperiencePath(env, home)

  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? String(error.code ?? '') : ''
    return { ok: false, reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'bad-json' }
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: 'bad-shape' }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  if (charLength(title) < 1 || charLength(title) > EXPERIENCE_TITLE_MAX_CHARS) {
    return { ok: false, reason: 'bad-title' }
  }
  const kind = typeof parsed.kind === 'string' ? parsed.kind.trim() : ''
  if (!Object.hasOwn(EXPERIENCE_KIND_LABELS, kind)) return { ok: false, reason: 'bad-kind' }
  const emotion = typeof parsed.emotion === 'string' ? parsed.emotion.trim() : ''
  if (!Object.hasOwn(EXPERIENCE_EMOTION_LABELS, emotion)) return { ok: false, reason: 'bad-emotion' }

  let note = null
  if (parsed.note !== undefined && parsed.note !== null) {
    if (typeof parsed.note !== 'string') return { ok: false, reason: 'bad-note' }
    const trimmed = parsed.note.trim()
    if (charLength(trimmed) > EXPERIENCE_NOTE_MAX_CHARS) return { ok: false, reason: 'bad-note' }
    if (trimmed.length > 0) note = trimmed
  }

  const at = normalizeTimestamp(parsed.at)
  if (at === null) return { ok: false, reason: 'bad-at' }
  if (at - now > FUTURE_TOLERANCE_MS) return { ok: false, reason: 'bad-at' }
  if (now - at > maxAgeMs) return { ok: false, reason: 'expired' }

  const experience = { title, kind, emotion, at }
  if (note !== null) experience.note = note
  return { ok: true, experience }
}
