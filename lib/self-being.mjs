// lib/self-being.mjs —— 「她此刻的状态」：文字而非数值（v1.51，M62）。
//
// 用户：内在状态不应该被量化——碳基也好硅基也好，感受不是 0–100 的指标。
// 所以 v2 只存**事实时间线**（上次吃/喝/玩/说话/学习/自省/睡醒的时间）和**她自己写下的一句
// 「此刻的状态」**；不再有 energy/hunger/social 这些分数，也不再用阈值替她决定行为——
// 行为由她自己的模型在自处时判断（见 lib/self-drive.mjs）。
//
// 文件：`$DSH_HOME/.dsh-poetry/self-state.json`（v2；v1 旧文件首次加载时自动迁移，只保留时间线）。
import { resolveMemoryFile } from './memory-registry.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

/** v2 版本号。 */
export const SELF_BEING_VERSION = 2
/** 她自己写的那句状态最长字数。 */
export const SELF_FELT_MAX = 120
/** 她自己写的「最近在体会/琢磨什么」最长字数。 */
export const SELF_EXPERIENCING_MAX = 120
/** 在体会的时效（v1.63）：超过这段时间就不再当作“最近”，避免旧事被当成眼下。 */
export const SELF_EXPERIENCING_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** persist 默认节流间隔（毫秒）。 */
export const SELF_BEING_PERSIST_THROTTLE_MS = 60 * 1000

/** 时间线条目（事实，不是分数）。 */
export const SELF_TIMELINE_FIELDS = Object.freeze([
  'lastWakeAt',
  'lastMealAt',
  'lastDrinkAt',
  'lastPlayAt',
  'lastSocialAt',
  'lastLearnAt',
  'lastReflectAt',
  'lastActionAt',
  'lastCheckAt',
])

/** 行为事件 → 更新的时间线/睡眠状态。 */
const BEING_EVENTS = Object.freeze({
  meal: { lastMealAt: true },
  eat: { lastMealAt: true, lastActionAt: true },
  drink: { lastDrinkAt: true, lastActionAt: true },
  play: { lastPlayAt: true, lastActionAt: true },
  actPlay: { lastPlayAt: true, lastActionAt: true },
  social: { lastSocialAt: true },
  socialize: { lastSocialAt: true, lastActionAt: true },
  learn: { lastLearnAt: true, learnings: 1 },
  reflect: { lastReflectAt: true, reflections: 1 },
  sleep: { lastActionAt: true, sleep: true },
  wake: { lastActionAt: true, wake: true },
})

/** 支持的事件名。 */
export const SELF_BEING_EVENTS = Object.freeze(Object.keys(BEING_EVENTS))

const CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十']

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

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/** 中文小数字（1–10，其余用「十几/几十」概括）。 */
function cnNumber(value) {
  const n = Math.max(0, Math.round(value))
  if (n <= 10) return CN_NUM[n]
  if (n < 20) return `十${CN_NUM[n - 10]}`
  if (n < 100) return `${CN_NUM[Math.floor(n / 10)]}十${n % 10 > 0 ? CN_NUM[n % 10] : ''}`
  return '很多'
}

/**
 * 把一段时长说成人的话（不带数字）。
 * @param {number} ms
 * @returns {string}
 */
export function composeElapsed(ms) {
  const minutes = Math.max(0, ms) / 60000
  if (minutes < 5) return '就刚才'
  if (minutes < 15) return '一小会儿'
  if (minutes < 40) return '半个钟头左右'
  if (minutes < 80) return '一个钟头上下'
  const hours = minutes / 60
  if (hours < 2) return '一个多钟头'
  if (hours < 10) return `${cnNumber(hours)}个钟头左右`
  if (hours < 20) return '大半天'
  if (hours < 30) return '一天多'
  return `${cnNumber(hours / 24)}天左右`
}

/** 某时间距离现在的说法（不含数字）。 */
function elapsedSince(ts, now) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null
  return composeElapsed(Math.max(0, now - ts))
}

/** 说成「…前」的人话。 */
function agoSince(ts, now) {
  const elapsed = elapsedSince(ts, now)
  if (elapsed === null) return '说不清多久了'
  if (elapsed === '就刚才') return '就刚才'
  return `${elapsed}前`
}

/** 一天中的时段 + 大致几点（不带数字）。 */
export function describeClock(now = Date.now()) {
  const date = new Date(now)
  const hour = date.getHours()
  const period = hour < 5 ? '深夜' : hour < 8 ? '清晨' : hour < 11 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 20 ? '傍晚' : hour < 24 ? '晚上' : '深夜'
  const clock = hour % 12 === 0 ? 12 : hour % 12
  return `现在是${period}${cnNumber(clock)}点前后`
}

function timePoint(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  const date = new Date(ts)
  const hour = date.getHours()
  const period = hour < 5 ? '深夜' : hour < 8 ? '清晨' : hour < 11 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 20 ? '傍晚' : '晚上'
  return `${period}${cnNumber(hour % 12 === 0 ? 12 : hour % 12)}点`
}

/** 解析状态文件路径（沿用 v1 位置）。 */
export function resolveSelfBeingPath(env = process.env, home = null) {
  const custom = typeof env?.DSH_SELF_STATE === 'string' ? env.DSH_SELF_STATE.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  return resolveMemoryFile('self-state.json', env, home)
}

/** 默认 v2 状态。 */
export function defaultSelfBeing(now = Date.now()) {
  return {
    v: SELF_BEING_VERSION,
    sleeping: false,
    sleepSince: null,
    lastWakeAt: null,
    lastMealAt: null,
    lastDrinkAt: null,
    lastPlayAt: null,
    lastSocialAt: null,
    lastLearnAt: null,
    lastReflectAt: null,
    lastActionAt: null,
    lastCheckAt: null,
    felt: '',
    feltAt: null,
    experiencing: '',
    experiencingAt: null,
    updatedAt: 0,
    // 兼容旧字段（只读展示计数，不是内在状态）
    learnings: 0,
    reflections: 0,
    ...(typeof now === 'number' ? {} : {}),
  }
}

/** 宽松归一化（v1/v2 都能读；只保留时间线与文字状态）。 */
export function normalizeSelfBeing(raw, now = Date.now()) {
  const input = isPlainObject(raw) ? raw : {}
  const being = defaultSelfBeing(now)
  for (const field of SELF_TIMELINE_FIELDS) being[field] = toTimestamp(input[field])
  being.sleepSince = toTimestamp(input.sleepSince)
  being.sleeping = input.sleeping === true
  being.felt = cleanText(input.felt, SELF_FELT_MAX)
  being.feltAt = toTimestamp(input.feltAt)
  being.experiencing = cleanText(input.experiencing, SELF_EXPERIENCING_MAX)
  being.experiencingAt = toTimestamp(input.experiencingAt)
  being.updatedAt = toTimestamp(input.updatedAt) ?? 0
  being.learnings = Number.isFinite(input.learnings) && input.learnings >= 0 ? Math.floor(input.learnings) : 0
  being.reflections = Number.isFinite(input.reflections) && input.reflections >= 0 ? Math.floor(input.reflections) : 0
  // 旧 v1 迁移：只保留时间线；没发生过吃/喝等时保持 null（不伪造）。
  being.v = SELF_BEING_VERSION
  return being
}

/** 纯函数：应用事件（只改时间线/睡眠，不加减分数）。 */
export function applyBeingEvent(state, kind, now = Date.now()) {
  const current = normalizeSelfBeing(state, now)
  const effect = BEING_EVENTS[kind]
  if (!effect) return current
  const next = { ...current }
  for (const field of SELF_TIMELINE_FIELDS) if (effect[field] === true) next[field] = now
  if (effect.sleep === true) {
    next.sleeping = true
    next.sleepSince = now
  }
  if (effect.wake === true) {
    next.sleeping = false
    next.lastWakeAt = now
  }
  // v1.60：学习/自省是事实计数（不是内在分数），用于成长页显示“她做了多少”，不再冻结。
  if (effect.learnings === 1) next.learnings = (next.learnings ?? 0) + 1
  if (effect.reflections === 1) next.reflections = (next.reflections ?? 0) + 1
  next.updatedAt = now
  return next
}

/**
 * 人类可读的「事实时间线」：给她的模型 / 界面看，全部用话说，不给分数。
 * @param {object} state
 * @param {number} [now]
 * @returns {string[]}
 */
export function describeTimeline(state, now = Date.now()) {
  const current = normalizeSelfBeing(state, now)
  const lines = [describeClock(now)]
  if (current.sleeping) {
    const since = current.sleepSince !== null ? `（从${timePoint(current.sleepSince)}开始的）` : ''
    lines.push(`你还睡着${since}，已经睡了${composeElapsed(now - (current.sleepSince ?? now))}。`)
  } else if (current.lastWakeAt !== null) {
    lines.push(`你${agoSince(current.lastWakeAt, now)}醒的，一直醒着。`)
  } else {
    lines.push('你醒着。')
  }
  const sinceText = (ts, fallback) => {
    const ago = elapsedSince(ts, now)
    return ago === null ? fallback : `大约${ago}前`
  }
  lines.push(
    `距上次吃东西${sinceText(current.lastMealAt, '记不清了')}；距上次喝水${sinceText(current.lastDrinkAt, '记不清了')}。`,
  )
  lines.push(
    `距上次玩${sinceText(current.lastPlayAt, '有一阵子了')}；距上次学东西${sinceText(current.lastLearnAt, '有一阵子了')}。`,
  )
  lines.push(
    `距上次和人说话${sinceText(current.lastSocialAt, '有一阵子了')}；距上次自省${sinceText(current.lastReflectAt, '有一阵子了')}。`,
  )
  if (current.lastCheckAt !== null) {
    lines.push(`你上次留意自己的状态，是${agoSince(current.lastCheckAt, now)}。`)
  }
  return lines
}

/** 她此刻的状态 → prompt 行（只用她自己的话；没有就用一句留白）。 */
export function formatBeingLine(state, nowMs = Date.now()) {
  const current = normalizeSelfBeing(state)
  const felt = current.felt.length > 0 ? current.felt : '还没来得及想清楚自己此刻是什么感觉。'
  const parts = [`你此刻的状态：${felt}`]
  const fresh =
    current.experiencingAt === null ||
    !Number.isFinite(nowMs) ||
    nowMs - current.experiencingAt <= SELF_EXPERIENCING_TTL_MS
  if (current.experiencing.length > 0 && fresh) parts.push(`你最近在体会/琢磨：${current.experiencing}（这是你自己写下的）`)
  return parts.join('\n')
}

/** prompt 用：状态 + 时间线（都不会出现 0–100 的分数）。 */
export function formatBeingContext(state, now = Date.now()) {
  return [formatBeingLine(state), `你的事实：${describeTimeline(state, now).join(' ')}`].join('\n')
}

/** 只读状态路由 payload（自带 felt/context 文字，不暴露分数）。 */
export function createSelfBeingHandler(options = {}) {
  const getSnapshot = typeof options.getSnapshot === 'function' ? options.getSnapshot : () => defaultSelfBeing()
  const getGrowth = typeof options.getGrowth === 'function' ? options.getGrowth : null
  const getActions = typeof options.getActions === 'function' ? options.getActions : null
  const getProject = typeof options.getProject === 'function' ? options.getProject : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  return async function selfBeingHandler(req, res) {
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
      const at = now()
      const state = getSnapshot()
      payload = {
        ok: true,
        state,
        felt: typeof state.felt === 'string' ? state.felt : '',
        context: describeTimeline(state, at),
        sleeping: state.sleeping === true,
        growth: getGrowth !== null ? getGrowth() : null,
        actions: getActions !== null ? getActions() : { latest: null, recent: [] },
        project: getProject !== null ? getProject() : null,
        updatedAt: at,
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
 * 创建「此刻状态」管理器（时间线 + 她自己写的一句话 + 原子写节流）。
 * @param {{file: string, now?: () => number, logger?: {warn?: Function}|null, persistThrottleMs?: number}} options
 */
export function createSelfBeing(options) {
  const file = path.resolve(options.file)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const persistThrottleMs = Number.isFinite(options.persistThrottleMs) ? options.persistThrottleMs : SELF_BEING_PERSIST_THROTTLE_MS

  let state = null
  let loaded = false
  let lastPersistAt = 0
  let disposed = false

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
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
      if (code !== 'ENOENT' && code !== 'ENOTDIR') warn(`状态文件不可用（重新开始）：${file}`)
      raw = null
    }
    state = normalizeSelfBeing(raw, now())
    return state
  }

  function persist(request = {}) {
    if (disposed) return { ok: false, message: 'disposed' }
    try {
      const current = ensureLoaded()
      const currentNow = now()
      const force = request !== null && request !== undefined && request.force === true
      if (!force && lastPersistAt > 0 && currentNow - lastPersistAt < persistThrottleMs) return { ok: true, skipped: true }
      const payload = { ...current, v: SELF_BEING_VERSION, updatedAt: currentNow }
      writeJsonAtomic(file, payload)
      state = payload
      lastPersistAt = currentNow
      return { ok: true, skipped: false }
    } catch (error) {
      warn(`状态写入失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  function tick(atNow) {
    try {
      const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
      ensureLoaded()
      persist()
      return snapshot(target)
    } catch (error) {
      warn(`状态 tick 失败：${error instanceof Error ? error.message : String(error)}`)
      return snapshot()
    }
  }

  function applyEvent(kind, atNow) {
    try {
      const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
      state = applyBeingEvent(ensureLoaded(), kind, target)
      persist()
      return snapshot(target)
    } catch (error) {
      warn(`状态事件失败：${error instanceof Error ? error.message : String(error)}`)
      return snapshot()
    }
  }

  /** 她自己的模型写下「我此刻是什么状态」。 */
  function setFelt(text, atNow) {
    const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    const current = ensureLoaded()
    state = { ...current, felt: cleanText(text, SELF_FELT_MAX), feltAt: target, updatedAt: target }
    persist({ force: true })
    return snapshot(target)
  }

  /** 她自己写下「最近在体会/琢磨什么」。 */
  function setExperiencing(text, atNow) {
    const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    const current = ensureLoaded()
    state = {
      ...current,
      experiencing: cleanText(text, SELF_EXPERIENCING_MAX),
      experiencingAt: target,
      updatedAt: target,
    }
    persist({ force: true })
    return snapshot(target)
  }

  /** 用历史日志校正事实计数（只增不减；v1.60）。 */
  function setGrowthCounts(counts, atNow) {
    const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    const current = ensureLoaded()
    const learnings = Number.isFinite(counts?.learnings) && counts.learnings > current.learnings ? Math.floor(counts.learnings) : current.learnings
    const reflections =
      Number.isFinite(counts?.reflections) && counts.reflections > current.reflections ? Math.floor(counts.reflections) : current.reflections
    if (learnings === current.learnings && reflections === current.reflections) return snapshot(target)
    state = { ...current, learnings, reflections, updatedAt: target }
    persist({ force: true })
    return snapshot(target)
  }

  /** 记录一次「自处检查」（她刚留意过自己）。 */
  function markChecked(atNow) {
    const target = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    const current = ensureLoaded()
    state = { ...current, lastCheckAt: target, updatedAt: target }
    persist()
    return snapshot(target)
  }

  function snapshot(atNow) {
    const current = ensureLoaded()
    const at = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : now()
    return {
      v: SELF_BEING_VERSION,
      sleeping: current.sleeping === true,
      sleepSince: current.sleepSince,
      lastWakeAt: current.lastWakeAt,
      lastMealAt: current.lastMealAt,
      lastDrinkAt: current.lastDrinkAt,
      lastPlayAt: current.lastPlayAt,
      lastSocialAt: current.lastSocialAt,
      lastLearnAt: current.lastLearnAt,
      lastReflectAt: current.lastReflectAt,
      lastActionAt: current.lastActionAt,
      lastCheckAt: current.lastCheckAt,
      felt: current.felt,
      feltAt: current.feltAt,
      experiencing: current.experiencing,
      experiencingAt: current.experiencingAt,
      learnings: current.learnings,
      reflections: current.reflections,
      updatedAt: current.updatedAt,
      // 界面的「事实时间线」（文字，不含分数）
      context: describeTimeline(current, at),
    }
  }

  function flush() {
    return persist({ force: true })
  }

  function dispose() {
    if (disposed) return
    flush()
    disposed = true
  }

  return { file, tick, applyEvent, setFelt, setExperiencing, setGrowthCounts, markChecked, snapshot, persist, flush, dispose }
}
