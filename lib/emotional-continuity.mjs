// lib/emotional-continuity.mjs —— 情绪的持续与衰减（v2.98）
//
// 她和人聊完、心情生成、自处时，会把“还挂着的事/情绪”记成线程；
// 之后按半衰期衰减，但被再次提及时会加强。prompt 里只给还没散掉的。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

export const EMOTION_VERSION = 1
export const EMOTION_MAX_THREADS = 12
export const EMOTION_HALF_LIFE_HOURS = 36
export const EMOTION_PRUNE_BELOW = 0.12

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}
function bigrams(value) {
  const chars = Array.from(String(value ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}
function similar(a, b, threshold = 0.55) {
  const A = bigrams(a); const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return false
  let n = 0
  for (const g of A) if (B.has(g)) n += 1
  return (2 * n) / (A.size + B.size) >= threshold
}

export function emptyEmotions() {
  return { ok: true, v: EMOTION_VERSION, updatedAt: 0, threads: [] }
}
export function normalizeEmotions(raw) {
  const out = emptyEmotions()
  if (!raw || typeof raw !== 'object') return out
  out.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  out.threads = (Array.isArray(raw.threads) ? raw.threads : [])
    .map((thread) => ({
      id: clean(thread.id, 60) || `emo-${Math.random().toString(36).slice(2, 8)}`,
      topic: clean(thread.topic, 40),
      emotion: clean(thread.emotion, 12),
      intensity: Number.isFinite(thread.intensity) ? Math.max(0, Math.min(1, thread.intensity)) : 0.5,
      note: clean(thread.note, 120),
      createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt : 0,
      lastAt: Number.isFinite(thread.lastAt) ? thread.lastAt : 0,
      reinforced: Number.isFinite(thread.reinforced) ? thread.reinforced : 1,
    }))
    .filter((thread) => thread.topic.length >= 2)
    .slice(-EMOTION_MAX_THREADS)
  return out
}
export function readEmotions(file) {
  try { return normalizeEmotions(JSON.parse(readFileSync(file, 'utf8'))) } catch { return emptyEmotions() }
}
export function saveEmotions(file, state) {
  try { mkdirSync(path.dirname(file), { recursive: true }); writeJsonAtomic(file, normalizeEmotions(state)); return true } catch { return false }
}
/** 有效强度：按半衰期衰减，被提及时会更近的 lastAt 支撑。 */
export function effectiveIntensity(thread, at = Date.now()) {
  const hours = Math.max(0, (at - (thread.lastAt || 0)) / 3600000)
  return Math.max(0, Math.min(1, (thread.intensity || 0.5) * Math.pow(0.5, hours / EMOTION_HALF_LIFE_HOURS)))
}
/** 记一条情绪线程：同主题合并加强，不同主题新增。 */
export function recordEmotion(state, input, at = Date.now()) {
  const emotions = normalizeEmotions(state)
  const topic = clean(input?.topic, 40)
  if (topic.length < 2) return { emotions, added: false, reinforced: false }
  const emotion = clean(input?.emotion, 12)
  const note = clean(input?.note, 120)
  const intensity = Number.isFinite(input?.intensity) ? Math.max(0.1, Math.min(1, input.intensity)) : 0.55
  const existing = emotions.threads.find((thread) => similar(thread.topic, topic))
  if (existing !== undefined) {
    existing.topic = note.length >= 4 ? topic : existing.topic
    existing.emotion = emotion || existing.emotion
    existing.note = note || existing.note
    existing.intensity = Math.min(1, Math.max(existing.intensity * 0.9, intensity))
    existing.lastAt = at
    existing.reinforced += 1
    emotions.updatedAt = at
    return { emotions, added: false, reinforced: true }
  }
  emotions.threads.push({ id: `emo-${at}-${emotions.threads.length + 1}`, topic, emotion, intensity, note, createdAt: at, lastAt: at, reinforced: 1 })
  emotions.threads = emotions.threads.slice(-EMOTION_MAX_THREADS)
  emotions.updatedAt = at
  return { emotions, added: true, reinforced: false }
}
/** 清掉已经衰减到很低的线程。 */
export function pruneEmotions(state, at = Date.now()) {
  const emotions = normalizeEmotions(state)
  emotions.threads = emotions.threads.filter((thread) => effectiveIntensity(thread, at) >= EMOTION_PRUNE_BELOW)
  emotions.updatedAt = at
  return emotions
}
export function formatEmotionalDigest(state, at = Date.now(), limit = 3) {
  const emotions = normalizeEmotions(state)
  const alive = emotions.threads
    .map((thread) => ({ thread, strength: effectiveIntensity(thread, at) }))
    .filter((item) => item.strength >= EMOTION_PRUNE_BELOW)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit)
  if (alive.length === 0) return []
  return alive.map(({ thread, strength }) => {
    const level = strength >= 0.6 ? '很强' : strength >= 0.35 ? '挂着' : '快淡了'
    return `还${level}：${thread.topic}${thread.emotion ? `（${thread.emotion}）` : ''}${thread.note && thread.note !== thread.topic ? `——${thread.note}` : ''}`
  })
}
/** 从聊天结果里提取情绪线程（felt 优先，其次 murmur/reply 的情绪词）。 */
export function recordFromChat(state, input = {}, at = Date.now()) {
  const felt = clean(input.felt, 60)
  const murmur = clean(input.murmur, 60)
  const reply = clean(input.reply, 200)
  const text = felt || murmur || reply
  if (text.length < 4) return { emotions: normalizeEmotions(state), added: false, reinforced: false }
  const emotionMatch = text.match(/(烦|累|高兴|开心|舍不得|委屈|难受|怕|担心|没劲|踏实|满足|气|难过|空|蔫)/)
  const topic = felt.length >= 4 ? felt : text.slice(0, 40)
  return recordEmotion(state, { topic: text.slice(0, 40), emotion: emotionMatch ? emotionMatch[1] : '', note: felt || murmur || '', intensity: felt ? 0.6 : 0.45 }, at)
}
export function createEmotionalState(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'emotional-state.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = readEmotions(file)
  function save(next) { saveEmotions(file, next); state = next }
  function record(input) { const result = recordEmotion(state, input, now()); if (result.added || result.reinforced) save(result.emotions); return result }
  function recordFromChatResult(input) { const result = recordFromChat(state, input, now()); if (result.added || result.reinforced) save(result.emotions); return result }
  function digest(limit = 3) { return formatEmotionalDigest(state, now(), limit) }
  function snapshot() { return { updatedAt: state.updatedAt, threads: state.threads.length, alive: pruneEmotions(state, now()).threads.length } }
  return { file, record, recordFromChat: recordFromChatResult, digest, snapshot, read: () => state }
}
