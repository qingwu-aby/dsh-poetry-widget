// lib/self-state.mjs —— 挂件的「内在状态」持久化（契约 v1.27 §2.16，M38）。
//
// 用户同意做最小自驱成长循环：挂件有自己的精力/好奇/社交/饥饿/心情维度，
// 会随时间缓慢漂移，也会被事件（吃饭/玩耍/社交/休息/学习/自省）影响；
// 这些内在状态会注入 mood-ai / self-talk 的 prompt（模型可据此判断心情，但不报数字）。
//
// 文件：`$DSH_HOME/.dsh-poetry/self-state.json`（`DSH_SELF_STATE` 可覆盖；原子写、坏文件回退默认）。
// 边界：纯本地、只读内置指标，不含任何用户/会话内容。
import { resolveMemoryFile } from './memory-registry.mjs'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

/** 只读内在状态路由路径（unfenced）。 */
export const SELF_STATE_ROUTE = '/api/dsh-poetry/self.json'

/** 状态字段（顺序即文件/接口字段顺序）。 */
export const SELF_STATE_FIELDS = Object.freeze([
  'energy',
  'curiosity',
  'social',
  'hunger',
  'thirst',
  'moodValence',
  'moodArousal',
])

/** 默认内在状态（0–100）。 */
export const SELF_STATE_DEFAULTS = Object.freeze({
  energy: 70,
  curiosity: 60,
  social: 55,
  hunger: 35,
  thirst: 40,
  moodValence: 0,
  moodArousal: 45,
})

/** 单次 tick 最多补算的分钟数（长时间未运行不会一次漂移太多）。 */
export const SELF_STATE_MAX_TICK_MINUTES = 180
/** persist 默认节流间隔（毫秒）。 */
export const SELF_STATE_PERSIST_THROTTLE_MS = 60 * 1000

/** 每分钟漂移量（契约：精力下降、好奇上升、社交/饥饿上升、valence/arousal 微漂移）。 */
export const SELF_STATE_DRIFT_PER_MINUTE = Object.freeze({
  energy: -0.2,
  curiosity: 0.1,
  social: 0.15,
  hunger: 0.25,
  thirst: 0.2,
  // 睡眠中：精力恢复、饥饿/口渴增速减半。
  sleepingEnergyGain: 0.6,
  sleepingNeedScale: 0.5,
  // moodValence 向 0（中性）回落；moodArousal 向 45 回落。
  moodValenceDecay: 0.2,
  moodArousalTarget: 45,
  moodArousalDrift: 0.2,
})

/** 事件对状态的影响。 */
const SELF_STATE_EVENTS = Object.freeze({
  meal: { hunger: -30, energy: 5, lastMealAt: true },
  play: { moodValence: 15, moodArousal: 10, curiosity: 5, lastPlayAt: true },
  social: { social: 20, moodValence: 10, lastSocialAt: true },
  rest: { energy: 25, moodArousal: -10 },
  learn: { curiosity: 20, energy: -5, lastLearnAt: true, learnings: 1 },
  reflect: { moodValence: 5, moodArousal: -5, lastReflectAt: true, reflections: 1 },
  // v1.36（M46）：自主行为事件（动作循环使用）。
  eat: { hunger: -30, energy: 10, lastMealAt: true, lastActionAt: true },
  drink: { thirst: 0, lastDrinkAt: true, lastActionAt: true },
  actPlay: { moodValence: 15, moodArousal: 10, curiosity: -30, lastPlayAt: true, lastActionAt: true },
  socialize: { social: -25, moodValence: 10, lastSocialAt: true, lastActionAt: true },
  sleep: { sleepSince: true, lastActionAt: true },
  wake: { lastWakeAt: true, lastActionAt: true },
})

/** 支持的事件类型。 */
export const SELF_STATE_EVENT_KINDS = Object.freeze(Object.keys(SELF_STATE_EVENTS))

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

/** 0–100 clamp（非数字回退默认值）。 */
export function clampSelfValue(value, fallback = 0) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(100, Math.max(0, Math.round(number * 10) / 10))
}

/**
 * 解析状态文件路径：`DSH_SELF_STATE` 优先，否则 `$DSH_HOME/.dsh-poetry/self-state.json`。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string|null} [home]
 */
export function resolveSelfStatePath(env = process.env, home = null) {
  const custom = typeof env?.DSH_SELF_STATE === 'string' ? env.DSH_SELF_STATE.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  return resolveMemoryFile('self-state.json', env, home)
}

/** 默认状态（可传 now 作为 lastTickAt）。 */
export function defaultSelfState(now = Date.now()) {
  return {
    v: 1,
    ...SELF_STATE_DEFAULTS,
    lastTickAt: now,
    lastMealAt: null,
    lastPlayAt: null,
    lastSocialAt: null,
    lastLearnAt: null,
    lastReflectAt: null,
    lastDrinkAt: null,
    lastWakeAt: null,
    lastActionAt: null,
    sleepSince: null,
    sleeping: false,
    learnings: 0,
    reflections: 0,
    updatedAt: 0,
  }
}

/** 宽松归一化磁盘/外部状态；缺失/非法字段回退默认值。 */
export function normalizeSelfState(raw, now = Date.now()) {
  const input = isPlainObject(raw) ? raw : {}
  const state = defaultSelfState(now)
  for (const field of SELF_STATE_FIELDS) {
    state[field] = clampSelfValue(input[field], SELF_STATE_DEFAULTS[field])
  }
  for (const field of [
    'lastTickAt',
    'lastMealAt',
    'lastPlayAt',
    'lastSocialAt',
    'lastLearnAt',
    'lastReflectAt',
    'lastDrinkAt',
    'lastWakeAt',
    'lastActionAt',
    'sleepSince',
    'updatedAt',
  ]) {
    state[field] = toTimestamp(input[field])
  }
  state.sleeping = input.sleeping === true
  state.lastTickAt = state.lastTickAt ?? now
  state.learnings = Number.isFinite(input.learnings) && input.learnings >= 0 ? Math.floor(input.learnings) : 0
  state.reflections = Number.isFinite(input.reflections) && input.reflections >= 0 ? Math.floor(input.reflections) : 0
  state.v = 1
  return state
}

/** 纯函数：按经过分钟推进状态（cap 180min），返回新对象。 */
export function advanceSelfState(state, now = Date.now()) {
  const current = normalizeSelfState(state, now)
  const minutesRaw = (now - (current.lastTickAt ?? now)) / 60000
  const minutes = Math.min(SELF_STATE_MAX_TICK_MINUTES, Math.max(0, minutesRaw))
  const next = { ...current }
  if (minutes > 0) {
    const sleeping = current.sleeping === true
    const needScale = sleeping ? SELF_STATE_DRIFT_PER_MINUTE.sleepingNeedScale : 1
    if (sleeping) {
      // 睡眠中精力恢复（替代醒着的下降）。
      next.energy = clampSelfValue(next.energy + SELF_STATE_DRIFT_PER_MINUTE.sleepingEnergyGain * minutes)
    } else {
      next.energy = clampSelfValue(next.energy + SELF_STATE_DRIFT_PER_MINUTE.energy * minutes)
    }
    next.curiosity = clampSelfValue(next.curiosity + SELF_STATE_DRIFT_PER_MINUTE.curiosity * minutes)
    next.social = clampSelfValue(next.social + SELF_STATE_DRIFT_PER_MINUTE.social * minutes)
    next.hunger = clampSelfValue(next.hunger + SELF_STATE_DRIFT_PER_MINUTE.hunger * needScale * minutes)
    next.thirst = clampSelfValue(next.thirst + SELF_STATE_DRIFT_PER_MINUTE.thirst * needScale * minutes)
    // valence 向 0 回落；arousal 向 45 回落（每步不超过剩余差值）。
    const valenceStep = SELF_STATE_DRIFT_PER_MINUTE.moodValenceDecay * minutes
    next.moodValence = clampSelfValue(
      next.moodValence > 0 ? Math.max(0, next.moodValence - valenceStep) : Math.min(0, next.moodValence + valenceStep),
    )
    const arousalStep = SELF_STATE_DRIFT_PER_MINUTE.moodArousalDrift * minutes
    next.moodArousal = clampSelfValue(
      next.moodArousal > 45
        ? Math.max(45, next.moodArousal - arousalStep)
        : Math.min(45, next.moodArousal + arousalStep),
    )
    next.lastTickAt = now
  }
  return next
}

/** 纯函数：应用事件（meal/play/social/rest/learn/reflect），返回新对象。 */
export function applySelfEvent(state, kind, now = Date.now()) {
  const current = normalizeSelfState(state, now)
  const effect = SELF_STATE_EVENTS[kind]
  if (!effect) return current
  const next = { ...current }
  for (const field of SELF_STATE_FIELDS) {
    if (typeof effect[field] === 'number') next[field] = clampSelfValue(next[field] + effect[field])
  }
  for (const key of ['lastMealAt', 'lastPlayAt', 'lastSocialAt', 'lastLearnAt', 'lastReflectAt', 'lastDrinkAt', 'lastWakeAt', 'lastActionAt']) {
    if (effect[key] === true) next[key] = now
  }
  if (kind === 'sleep') {
    next.sleeping = true
    next.sleepSince = now
  }
  if (kind === 'wake') {
    next.sleeping = false
    next.lastWakeAt = now
  }
  if (kind === 'drink') next.thirst = 0
  if (effect.learnings === 1) next.learnings = (next.learnings ?? 0) + 1
  if (effect.reflections === 1) next.reflections = (next.reflections ?? 0) + 1
  return next
}

/** 内在状态的定性描述（prompt 用，不含数字）。 */
export function describeSelfState(state) {
  const normalized = normalizeSelfState(state)
  const energy = normalized.energy
  const curiosity = normalized.curiosity
  const social = normalized.social
  const hunger = normalized.hunger
  const valence = normalized.moodValence
  const arousal = normalized.moodArousal

  const parts = []
  parts.push(energy >= 75 ? '精力很足' : energy >= 55 ? '还有点精力' : energy >= 35 ? '有点累' : '很疲惫')
  parts.push(curiosity >= 75 ? '好奇心很旺' : curiosity >= 55 ? '有点好奇' : curiosity >= 35 ? '好奇心平平' : '提不起好奇')
  parts.push(social >= 75 ? '很想找人说话' : social >= 55 ? '想找个人聊聊' : social >= 35 ? '不太想社交' : '只想安静待着')
  if (hunger >= 75) parts.push('肚子很饿')
  else if (hunger >= 55) parts.push('有点饿')
  else if (hunger >= 35) parts.push('不饿')
  parts.push(
    valence >= 60 ? '心情很好' : valence >= 30 ? '心情不错' : valence >= 10 ? '心情还算平静' : valence >= 0 ? '心情有点低' : '心情低落',
  )
  if (arousal >= 70) parts.push('心里有点紧绷')
  else if (arousal >= 50) parts.push('心里微微起伏')
  else parts.push('比较放松')
  return `你现在的内在状态：${parts.join('、')}。`
}

/** 内在状态 → prompt 的数字行（模型可见数字，但需被要求不原样说出）。 */
export function formatSelfStateLine(state) {
  const normalized = normalizeSelfState(state)
  const percent = (value) => Math.round(clampSelfValue(value))
  return (
    `你现在的内在状态：精力 ${percent(normalized.energy)}/100、好奇 ${percent(normalized.curiosity)}/100、` +
    `社交 ${percent(normalized.social)}/100、饥饿 ${percent(normalized.hunger)}/100。` +
    '（这些是你内部的状态指标，可以在心里据此判断心情，但不要把这些数字原样说出来。）'
  )
}

/** 只读内在状态路由（unfenced，与 assets 同类；no-store、永不 5xx）。 */
export function createSelfStateHandler(options) {
  const tick = typeof options.tick === 'function' ? options.tick : null
  const getSnapshot = typeof options.getSnapshot === 'function' ? options.getSnapshot : () => ({})
  const getGrowth = typeof options.getGrowth === 'function' ? options.getGrowth : null
  const getActions = typeof options.getActions === 'function' ? options.getActions : null
  return async function selfStateHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end('method not allowed')
      return
    }
    let payload
    try {
      if (tick !== null) tick()
      const growth = getGrowth !== null ? getGrowth() : null
      payload = {
        ok: true,
        state: getSnapshot(),
        growth: growth ?? { lastLearnAt: null, lastReflectAt: null, learnings: 0, reflections: 0 },
        actions: getActions !== null ? getActions() : { latest: null, recent: [] },
        updatedAt: Date.now(),
      }
    } catch (error) {
      payload = {
        ok: false,
        error: { code: 'SELF_STATE_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) },
      }
    }
    const body = JSON.stringify(payload)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    if (method === 'HEAD') {
      res.end()
      return
    }
    res.end(body)
  }
}

/**
 * 创建内在状态管理器（加载/漂移/事件/原子持久化节流）。
 * @param {{
 *   file: string,
 *   now?: () => number,
 *   logger?: {warn?: Function}|null,
 *   persistThrottleMs?: number,
 * }} options
 */
export function createSelfState(options) {
  const file = path.resolve(options.file)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const persistThrottleMs = Number.isFinite(options.persistThrottleMs) ? options.persistThrottleMs : SELF_STATE_PERSIST_THROTTLE_MS

  let state = null
  let loaded = false
  let lastPersistAt = 0
  let disposed = false

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function ensureLoaded() {
    if (loaded) return state
    loaded = true
    let raw = null
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      const code = typeof error === 'object' && error !== null ? String(error.code ?? '') : ''
      if (code !== 'ENOENT' && code !== 'ENOTDIR') warn(`内在状态文件不可用（使用默认值）：${file}`)
      raw = null
    }
    state = normalizeSelfState(raw, now())
    return state
  }

  /** 节流持久化；force=true 立即写。 */
  function persist(request = {}) {
    if (disposed) return { ok: false, message: 'disposed' }
    try {
      const current = ensureLoaded()
      const currentNow = now()
      const force = request !== null && request !== undefined && request.force === true
      if (!force && lastPersistAt > 0 && currentNow - lastPersistAt < persistThrottleMs) {
        return { ok: true, skipped: true }
      }
      const payload = { ...current, updatedAt: currentNow }
      writeJsonAtomic(file, payload)
      state = payload
      lastPersistAt = currentNow
      return { ok: true, skipped: false }
    } catch (error) {
      warn(`内在状态写入失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  function tick(atNow) {
    try {
      const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
      const current = ensureLoaded()
      const next = advanceSelfState(current, target)
      state = next
      persist()
      return snapshot()
    } catch (error) {
      warn(`内在状态 tick 失败：${error instanceof Error ? error.message : String(error)}`)
      return snapshot()
    }
  }

  function applyEvent(kind, atNow) {
    try {
      const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
      const current = ensureLoaded()
      state = applySelfEvent(current, kind, target)
      persist()
      return snapshot()
    } catch (error) {
      warn(`内在状态事件失败：${error instanceof Error ? error.message : String(error)}`)
      return snapshot()
    }
  }

  function snapshot() {
    const current = ensureLoaded()
    const out = { v: 1 }
    for (const field of SELF_STATE_FIELDS) out[field] = current[field]
    out.lastTickAt = current.lastTickAt
    out.lastMealAt = current.lastMealAt
    out.lastPlayAt = current.lastPlayAt
    out.lastSocialAt = current.lastSocialAt
    out.lastLearnAt = current.lastLearnAt
    out.lastReflectAt = current.lastReflectAt
    out.lastDrinkAt = current.lastDrinkAt
    out.lastWakeAt = current.lastWakeAt
    out.lastActionAt = current.lastActionAt
    out.sleepSince = current.sleepSince
    out.sleeping = current.sleeping === true
    out.learnings = current.learnings
    out.reflections = current.reflections
    out.updatedAt = current.updatedAt
    return out
  }

  function flush() {
    return persist({ force: true })
  }

  function dispose() {
    if (disposed) return
    flush()
    disposed = true
  }

  return { file, tick, applyEvent, snapshot, persist, flush, dispose }
}
