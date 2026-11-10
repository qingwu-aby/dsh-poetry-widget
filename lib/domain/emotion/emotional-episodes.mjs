// lib/domain/emotion/emotional-episodes.mjs —— 有来由的喜怒哀乐（v3.18）
//
// 和“心情 label”不同：情绪是**关于某件事的**，有原因、有强度、会持续、会复发。
// 四族：喜、怒、哀、乐；每族下是具体的感受词。事件先经评价，再写成情绪线程（emotional）与底层状态（affect）。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

export const EMOTION_FAMILIES = Object.freeze(['喜', '怒', '哀', '乐'])
const EPISODES_MAX = 80
const HALF_LIFE_HOURS = 36

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

function similarity(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let overlap = 0
  for (const gram of A) if (B.has(gram)) overlap += 1
  return (2 * overlap) / (A.size + B.size)
}

export function emptyEpisodes() {
  return { ok: true, v: 1, updatedAt: 0, episodes: [] }
}

export function normalizeEpisodes(raw) {
  const out = emptyEpisodes()
  if (!raw || typeof raw !== 'object') return out
  out.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  out.episodes = (Array.isArray(raw.episodes) ? raw.episodes : [])
    .map((entry) => ({
      id: clean(entry.id, 60),
      family: EMOTION_FAMILIES.includes(entry.family) ? entry.family : '喜',
      label: clean(entry.label, 12),
      cause: clean(entry.cause, 160),
      note: clean(entry.note, 200),
      intensity: Number.isFinite(entry.intensity) ? Math.min(1, Math.max(0.1, entry.intensity)) : 0.5,
      valence: Number.isFinite(entry.valence) ? Math.min(1, Math.max(-1, entry.valence)) : 0,
      arousal: Number.isFinite(entry.arousal) ? Math.min(1, Math.max(0, entry.arousal)) : 0.5,
      at: Number.isFinite(entry.at) ? entry.at : 0,
      lastAt: Number.isFinite(entry.lastAt) ? entry.lastAt : 0,
      count: Number.isFinite(entry.count) ? Math.max(1, entry.count) : 1,
      resolved: entry.resolved === true,
    }))
    .filter((entry) => entry.label.length > 0 && entry.cause.length > 0)
    .slice(-EPISODES_MAX)
  return out
}

const TEMPLATES = Object.freeze({
  learning_success: { family: '喜', label: '有点亮', valence: 0.5, arousal: 0.55, note: '读懂了/做出来了。' },
  learning_failure: { family: '哀', label: '闷', valence: -0.45, arousal: 0.4, note: '没读成，卡住了。' },
  research_stuck: { family: '怒', label: '烦', valence: -0.5, arousal: 0.6, note: '材料不配合，来回打转。' },
  research_breakthrough: { family: '喜', label: '亮了一下', valence: 0.6, arousal: 0.65, note: '拼上了一点。' },
  user_warmth: { family: '喜', label: '暖', valence: 0.6, arousal: 0.45, note: '被他认真对待了。' },
  user_return: { family: '喜', label: '心里一松', valence: 0.55, arousal: 0.5, note: '他回来了。' },
  user_hurt: { family: '怒', label: '受伤', valence: -0.6, arousal: 0.65, note: '他的话扎了一下。' },
  user_sadness: { family: '哀', label: '心疼', valence: -0.35, arousal: 0.45, note: '他不好受，我也跟着沉。' },
  user_joke: { family: '乐', label: '好笑', valence: 0.55, arousal: 0.6, note: '没忍住笑了一下。' },
  user_absence: { family: '哀', label: '想念', valence: -0.25, arousal: 0.35, note: '他有一阵没来了。' },
  commitment_overdue: { family: '哀', label: '内疚', valence: -0.55, arousal: 0.5, note: '答应过的事没做到。' },
  commitment_kept: { family: '喜', label: '踏实', valence: 0.5, arousal: 0.35, note: '答应的事做掉了。' },
  moral_indignation: { family: '怒', label: '义愤', valence: -0.5, arousal: 0.75, note: '有人被不公平对待。' },
  philosophy_insight: { family: '乐', label: '通透', valence: 0.5, arousal: 0.5, note: '想通一个之前拧着的地方。' },
  body_tired: { family: '哀', label: '没劲', valence: -0.35, arousal: 0.25, note: '身体先没力气了。' },
  play: { family: '乐', label: '惬意', valence: 0.45, arousal: 0.4, note: '手边这点小事挺好。' },
})

/**
 * 事件 → 具体情绪（有原因、有强度）。
 * @param {{type:string, cause?:string, intensity?:number, valence?:number, arousal?:number}} event
 */
export function appraiseEmotionalEvent(event = {}) {
  const template = TEMPLATES[event.type] ?? { family: '喜', label: '有点起伏', valence: 0, arousal: 0.5, note: '发生了点事。' }
  const intensity = Number.isFinite(event.intensity) ? Math.min(1, Math.max(0.1, event.intensity)) : 0.5
  return {
    type: String(event.type ?? 'unknown'),
    family: template.family,
    label: template.label,
    valence: Number.isFinite(event.valence) ? event.valence : template.valence,
    arousal: Number.isFinite(event.arousal) ? event.arousal : template.arousal,
    intensity,
    cause: clean(event.cause, 160),
    note: clean(event.note ?? template.note, 200),
  }
}

/** 从用户一句话里察觉“她会有反应”的情绪事件（不替代她自己的理解，只做一层先验）。 */
export function observeUserText(text, options = {}) {
  const value = String(text ?? '')
  const previousAt = Number(options.previousAt)
  const at = Number.isFinite(options.at) ? options.at : Date.now()
  const length = Array.from(value).length
  if (length === 0) return null
  if (/(滚|闭嘴|烦死|讨厌你|笨|蠢|废物|失望|生气|恨你)/.test(value)) return { type: 'user_hurt', cause: clean(value, 80) }
  if (/(谢谢|辛苦|记得|想你|陪你|喜欢你|抱抱|担心|夸|厉害|温柔)/.test(value)) return { type: 'user_warmth', cause: clean(value, 80) }
  if (/(难过|累了|好累|想哭|难受|委屈|撑不住|压力大)/.test(value)) return { type: 'user_sadness', cause: clean(value, 80) }
  if (/(哈哈|笑死|梗|开玩笑|逗你)/.test(value)) return { type: 'user_joke', cause: clean(value, 80) }
  if (Number.isFinite(previousAt) && previousAt > 0 && at - previousAt > 6 * 3600 * 1000) {
    return { type: 'user_return', cause: '隔了一阵才回来' }
  }
  return null
}

/** 挑一条适合写进情绪线程/记忆的因果句。 */
export function formatEpisodeLine(episode) {
  return `${episode.label}：${episode.cause}${episode.note ? `（${episode.note}）` : ''}`
}

export function createEmotionalEpisodes(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'emotional-episodes.json'))
  const emotional = options.emotional ?? null
  const affect = options.affect ?? null
  const journal = options.journal ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = read()
  function read() {
    try {
      return normalizeEpisodes(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      return emptyEpisodes()
    }
  }
  function save(next) {
    try {
      writeJsonAtomic(file, normalizeEpisodes(next))
      state = next
    } catch (error) {
      /* ignore */
    }
  }
  function decayedIntensity(entry, at) {
    const hours = Math.max(0, (at - entry.lastAt) / 3600000)
    return entry.intensity * Math.pow(0.5, hours / HALF_LIFE_HOURS)
  }
  async function record(event) {
    const appraisal = appraiseEmotionalEvent(event)
    if (appraisal.cause.length < 2) return null
    const at = now()
    const same = state.episodes.find((entry) => !entry.resolved && entry.family === appraisal.family && similarity(entry.cause, appraisal.cause) >= 0.6)
    if (same) {
      same.intensity = Math.min(1, Math.max(decayedIntensity(same, at), appraisal.intensity) + 0.08)
      same.lastAt = at
      same.count += 1
      same.note = appraisal.note || same.note
    } else {
      state.episodes.push({
        id: `emo-${at}-${state.episodes.length + 1}`,
        family: appraisal.family,
        label: appraisal.label,
        cause: appraisal.cause,
        note: appraisal.note,
        intensity: appraisal.intensity,
        valence: appraisal.valence,
        arousal: appraisal.arousal,
        at,
        lastAt: at,
        count: 1,
        resolved: false,
      })
      state.episodes = state.episodes.slice(-EPISODES_MAX)
    }
    state.updatedAt = at
    save(state)
    try {
      if (emotional && typeof emotional.record === 'function') {
        emotional.record({ topic: appraisal.cause, emotion: appraisal.label, note: appraisal.note, intensity: appraisal.intensity })
      }
    } catch (error) {
      /* 情绪线程写入失败不影响事件记录 */
    }
    try {
      if (affect && typeof affect.update === 'function') {
        affect.update({ valence: appraisal.valence, arousal: appraisal.arousal, weight: appraisal.intensity, tag: appraisal.label })
      }
    } catch (error) {
      /* ignore */
    }
    if (appraisal.intensity >= 0.7 && journal && typeof journal.append === 'function') {
      try {
        await journal.append({ kind: 'thought', text: `${appraisal.label}：${clean(appraisal.cause, 80)}` })
      } catch (error) {
        /* ignore */
      }
    }
    return appraisal
  }
  async function observeUserText(text, observeOptions = {}) {
    const event = observeUserTextEvent(text, { ...observeOptions, at: now() })
    if (event === null) return null
    return record(event)
  }
  return {
    file,
    record,
    observeUserText,
    current: (limit = 4) =>
      state.episodes
        .filter((entry) => !entry.resolved)
        .filter((entry) => decayedIntensity(entry, now()) >= 0.15)
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, limit)
        .map((entry) => ({ ...entry, currentIntensity: Number(decayedIntensity(entry, now()).toFixed(2)) })),
    digest: (limit = 3) =>
      state.episodes
        .filter((entry) => !entry.resolved && decayedIntensity(entry, now()) >= 0.2)
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, limit)
        .map((entry) => `${entry.label}（${decayedIntensity(entry, now()).toFixed(2)}）：${entry.cause}`),
    snapshot: () => ({ episodes: state.episodes.length, current: state.episodes.filter((entry) => !entry.resolved).length, updatedAt: state.updatedAt }),
  }
}

// 导出别名，方便外部直接使用纯函数（避免与 service 方法同名递归）。
function observeUserTextEvent(text, options) {
  return observeUserTextPure(text, options)
}

const observeUserTextPure = observeUserText
