// client-src/self-talk-client.js —— 碎碎念/彩蛋的纯客户端逻辑（v2.5 从 client.js 抽出）。
//
// 不做 storage/fetch；调用方仍持有 readSpontState/writeSpontState/requestSelfTalk。
import { num } from './base.js'
import { shanghaiParts } from './mood-engine.js'

export const SPONT_KEY = 'dshp-mood-spont-v1'
export const SPONT_POLL_MIN_MS = 60 * 1000
export const SPONT_POLL_MAX_MS = 120 * 1000
export const SPONT_RETRY_MS = 10 * 1000
export const SPONT_EVENT_MIN_MS = 2 * 1000
export const SPONT_EVENT_MAX_MS = 5 * 1000
export const SPONT_CLOSE_RECHECK_MS = 3 * 1000
export const SPONT_QUIET_MS = 3 * 1000
export const SPONT_REPEAT_MS = 3 * 24 * 60 * 60 * 1000
export const SPONT_SEEN_DAYS = 7 * 24 * 60 * 60 * 1000
export const SPONT_MAX_SEEN = 300
export const SPONT_AUTO_CLOSE_MS = 25000
export const SELF_TALK_PATH = 'self-talk.json'
export const SELF_TALK_TIMEOUT_MS = 35 * 1000
export const SELF_TALK_RECENT_MAX = 12

export function normalizeSpontState(raw, now) {
const src = raw && typeof raw === 'object' ? raw : {}
const dateKey = shanghaiParts(now).dateKey
const seen = []
if (Array.isArray(src.seenIds)) {
 for (const entry of src.seenIds.slice(-SPONT_MAX_SEEN)) {
  let id = ''
  let at = 0
  if (typeof entry === 'string') id = entry
  else if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
  id = entry.id
  at = num(entry.at, 0)
  }
  if (!id) continue
  if (at > 0 && now - at > SPONT_SEEN_DAYS) continue
  seen.push({ id, at })
 }
}
const sameDay = src.date === dateKey
return {
 date: dateKey,
 lastShownAt: sameDay ? num(src.lastShownAt, 0) : 0,
 todayCount: sameDay ? Math.max(0, Math.floor(num(src.todayCount, 0))) : 0,
 seenIds: seen,
 lastType: typeof src.lastType === 'string' ? src.lastType : '',
 lastTag: typeof src.lastTag === 'string' ? src.lastTag : '',
}
}

export function recordSpontShown(state, id, now, type, tag) {
const base = normalizeSpontState(state, now)
const seen = base.seenIds.filter((entry) => entry.id !== id).concat([{ id: String(id), at: now }]).slice(-SPONT_MAX_SEEN)
return {
 date: base.date,
 lastShownAt: num(now, Date.now()),
 todayCount: base.todayCount + 1,
 seenIds: seen,
 lastType: typeof type === 'string' ? type : base.lastType,
 lastTag: typeof tag === 'string' ? tag : base.lastTag,
}
}

export function countSpontHits(text, tags) {
let hits = 0
for (const tag of Array.isArray(tags) ? tags : []) {
 if (!tag) continue
 hits += String(text || '').split(tag).length - 1
}
return hits
}

export function splitCompleteSentences(text) {
const value = String(text == null ? '' : text)
const out = []
let start = 0
for (let i = 0; i < value.length; i += 1) {
 const ch = value.charAt(i)
 if (ch === '。' || ch === '！' || ch === '？') {
  const sentence = value.slice(start, i + 1).trim()
  if (sentence) out.push(sentence)
  start = i + 1
 }
}
return out
}

export function pickSentenceFromLines(lines, tags, random) {
const list = (Array.isArray(lines) ? lines : []).map((value) => String(value == null ? '' : value)).filter((value) => value.length > 0)
const sentences = splitCompleteSentences(list.join(''))
if (!sentences.length) {
 if (!list.length) return ''
 let fallback = list[list.length - 1]
 if (/[，,]$/.test(fallback)) {
  fallback = list.length > 1 ? list[list.length - 2] : fallback.replace(/[，,]$/, '。')
 }
 return fallback
}
const scored = sentences.map((sentence) => ({ sentence, length: sentence.length, hits: countSpontHits(sentence, tags) }))
const preferred = scored.filter((item) => item.length >= 8 && item.length <= 40 && item.hits > 0)
const medium = scored.filter((item) => item.length >= 8 && item.length <= 40)
const withTag = scored.filter((item) => item.hits > 0)
const pool = (preferred.length ? preferred : medium.length ? medium : withTag.length ? withTag : scored)
if (!pool.length) return ''
const index = Math.min(pool.length - 1, Math.max(0, Math.floor(num(typeof random === 'function' ? random() : Math.random(), 0) * pool.length)))
return pool[index].sentence
}

export function canShowSpontaneous(options) {
const opts = options && typeof options === 'object' ? options : {}
if (opts.enabled !== true) return false
if (opts.hidden === true || opts.panelOpen === true || opts.bubbleOpen === true || opts.visible === false) return false
const now = num(opts.now, Date.now())
const lastInteraction = num(opts.lastInteractionAt, 0)
const quietMs = num(opts.quietMs, SPONT_QUIET_MS)
const idleMs = lastInteraction > 0 ? Math.max(0, now - lastInteraction) : Number.POSITIVE_INFINITY
if (idleMs < quietMs) return false
return true
}

export function nextSpontPollDelay(options) {
const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
const random = typeof opts.random === 'function' ? opts.random : Math.random
const value = Number(random())
const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
return Math.round(SPONT_POLL_MIN_MS + ratio * (SPONT_POLL_MAX_MS - SPONT_POLL_MIN_MS))
}

export function nextSpontEventDelay(options) {
const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
const random = typeof opts.random === 'function' ? opts.random : Math.random
const value = Number(random())
const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
return Math.round(SPONT_EVENT_MIN_MS + ratio * (SPONT_EVENT_MAX_MS - SPONT_EVENT_MIN_MS))
}

export function selfTalkKindFor() {
return 'murmur'
}

export function selfTalkQuery(options) {
const opts = options && typeof options === 'object' ? options : {}
const params = []
const add = (key, value) => {
 if (value == null || value === '') return
 params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
}
add('kind', 'murmur')
add('mood', opts.moodKey)
add('moodLabel', opts.moodLabel)
add('moodReason', opts.moodReason)
add('image', opts.image)
add('imageLabel', opts.imageLabel)
add('weather', opts.weather)
add('idleMinutes', Math.max(0, Math.floor(num(opts.idleMinutes, 0))))
const seen = {}
const recent = []
for (const text of Array.isArray(opts.recent) ? opts.recent : []) {
 const clean = String(text == null ? '' : text).trim()
 if (!clean || seen[clean]) continue
 seen[clean] = true
 recent.push(clean)
}
const recentSlice = recent.slice(-SELF_TALK_RECENT_MAX)
if (recentSlice.length) add('recent', recentSlice.join('|'))
return SELF_TALK_PATH + (params.length ? '?' + params.join('&') : '')
}

export function parseSelfTalkResponse(data) {
if (!data || data.ok === false || !Array.isArray(data.lines)) return { ok: false, reason: 'invalid' }
const texts = []
for (const line of data.lines) {
 const text = typeof line === 'string' ? line : line && typeof line.text === 'string' ? line.text : ''
 const clean = text.trim()
 if (clean && texts.indexOf(clean) < 0) texts.push(clean)
}
if (!texts.length) return { ok: false, reason: 'empty' }
return { ok: true, line: texts[0], next: texts[1] || '' }
}
