// lib/mood.mjs —— 「当日心情」宿主侧统计（契约 v1.4 §2.10）。
//
// 宿主监听 DSH 的 `session/event`（emit，参数 session, event），在内存累计当日：
//   用户/助手消息数、工具调用/失败数、回合数（完成/出错）、会话活跃时长（相邻事件
//   time 差累加，单段上限 10min）、会话去重数、首次/最近活动时间。
// 防抖 ~15s 原子写 `$DSH_HOME/.dsh-poetry/mood.json`；路由读取时也会落盘。
// 跨本地日归零（只保留 lastActivityAt 供「最近活动」；firstActivityAt 归零）。
// 损坏文件先备份 `.bak` 再回退零值，永不抛异常。
//
// v1.16（M22）：额外在**内存**里记录最近 ≤12 条 tool/call 的**名称+时间**（绝不读
// arguments/参数/内容），归类成「看视频/逛网页、查资料/学习、写代码/跑命令、聊天/思考、
// 发呆」供 mood-ai 选图；这些活动信号不落盘、不进 mood.json stats。
//
// 可测试性：applySessionEvent / describeRecentActivity 是纯函数；createMoodTracker 支持注入 now/防抖/文件路径。
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, statSync } from 'node:fs'
import { writeJsonAtomic } from './settings-store.mjs'

/** 计入统计的 session/event 类型（契约 §2.10）。 */
export const MOOD_EVENT_TYPES = Object.freeze([
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
  'turn/start',
  'turn/end',
])

/** 活跃时长单段上限：10 分钟（契约 §2.10）。 */
export const MAX_ACTIVE_GAP_MS = 10 * 60 * 1000
/** 内存/落盘最多保留的当日会话标记数（防无限增长；统计 sessions 用）。 */
export const MAX_SESSION_IDS = 200
/** 内存里保留的最近工具调用条数（v1.16 活动信号；不落盘）。 */
export const MOOD_RECENT_TOOL_LIMIT = 12
/** 超过该时长没有新的工具调用 → 活动判定为「发呆」。 */
export const MOOD_ACTIVITY_IDLE_MS = 60 * 1000
/** 活动类型 → 中文标签（mood-ai prompt 直接使用）。 */
export const MOOD_ACTIVITY_LABELS = Object.freeze({
  watch: '看视频/逛网页',
  read: '查资料/学习',
  code: '写代码/跑命令',
  social: '聊天/思考',
  idle: '发呆',
})
export const MOOD_ACTIVITY_KINDS = Object.freeze(Object.keys(MOOD_ACTIVITY_LABELS))
/** 统计字段（顺序即响应字段顺序）。 */
export const MOOD_STAT_KEYS = Object.freeze([
  'userMessages',
  'assistantMessages',
  'toolCalls',
  'toolErrors',
  'turns',
  'turnsCompleted',
  'turnsErrored',
  'activeMs',
  'sessions',
  'firstActivityAt',
  'lastActivityAt',
])

const MOOD_SCHEMA_VERSION = 1

/** 零值统计（契约 §2.10：失败/无数据返回 stats 全 0、updatedAt 0）。 */
export function emptyMoodStats() {
  return {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolErrors: 0,
    turns: 0,
    turnsCompleted: 0,
    turnsErrored: 0,
    activeMs: 0,
    sessions: 0,
    firstActivityAt: 0,
    lastActivityAt: 0,
  }
}

/** 本地时区 `YYYY-MM-DD`（跨日滚动按本地日，与今日诗一致）。 */
export function localDateKey(ms = Date.now()) {
  const date = asDate(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function asDate(ms) {
  return ms instanceof Date ? ms : new Date(ms)
}

/** 创建一个空的当日心情状态（可 JSON 序列化）。 */
export function createEmptyMoodState(date = localDateKey()) {
  return {
    schemaVersion: MOOD_SCHEMA_VERSION,
    date,
    stats: emptyMoodStats(),
    sessionKeys: [],
    lastEventAt: null,
    updatedAt: 0,
  }
}

/**
 * 跨日重置：stats 归零，但保留 lastActivityAt（契约 §2.10「保留 lastActivityAt 用于最近活动」）。
 * @param {{stats?: {lastActivityAt?: number}|null}|null} previous
 * @param {string} nextDate
 */
export function rolloverMoodState(previous, nextDate) {
  const stats = emptyMoodStats()
  const lastActivityAt = Number.isFinite(previous?.stats?.lastActivityAt) ? previous.stats.lastActivityAt : 0
  stats.lastActivityAt = Math.max(0, lastActivityAt)
  return { schemaVersion: MOOD_SCHEMA_VERSION, date: nextDate, stats, sessionKeys: [], lastEventAt: null, updatedAt: 0 }
}

/**
 * 工具名 → 活动类型（纯函数，v1.16）。
 * 只做名称匹配，绝不看工具参数/内容：
 *   · bsk_* / browser|chrome|edge → watch「看视频/逛网页」
 *   · web_fetch|web_search|fetch|search → read「查资料/学习」
 *   · bash|shell|exec|patch|edit|write|git → code「写代码/跑命令」
 *   · subagent|team|message|chat → social「聊天/思考」
 * @param {unknown} name
 * @returns {'watch'|'read'|'code'|'social'|null}
 */
export function classifyToolName(name) {
  if (typeof name !== 'string') return null
  const value = name.trim().toLowerCase()
  if (value.length === 0) return null
  if (/^bsk_/.test(value) || /browser|chrome|edge/.test(value)) return 'watch'
  if (/web_fetch|web_search|fetch|search/.test(value)) return 'read'
  if (/bash|shell|exec|patch|edit|write|git/.test(value)) return 'code'
  if (/subagent|team|message|chat/.test(value)) return 'social'
  return null
}

/** 归一化一条内存活动记录（只认名称+时间；arguments 等字段一律丢弃）。 */
function activityRecordOf(tool) {
  if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) return null
  const rawName = typeof tool.name === 'string' ? tool.name : typeof tool.toolName === 'string' ? tool.toolName : ''
  const name = rawName.trim().slice(0, 80)
  if (name.length === 0) return null
  const rawAt = typeof tool.at === 'number' ? tool.at : typeof tool.time === 'number' ? tool.time : typeof tool.ts === 'number' ? tool.ts : NaN
  if (!Number.isFinite(rawAt) || rawAt <= 0) return null
  return { name, at: rawAt }
}

/**
 * 根据最近工具调用（新→旧取最近 1–2 条）描述当前活动（纯函数，v1.16）。
 *   · 空 / 最新一条超过 60s → idle「发呆」；
 *   · 否则从最新往回看 2 条，取第一个能分类的工具名；
 *   · 全部无法分类 → idle。
 * @param {Array<{name?:string, toolName?:string, at?:number, time?:number, ts?:number}>} tools
 * @param {number} [nowMs]
 * @returns {{kind:'watch'|'read'|'code'|'social'|'idle', label:string, at:number|null}}
 */
export function describeRecentActivity(tools, nowMs = Date.now()) {
  const list = (Array.isArray(tools) ? tools : []).map(activityRecordOf).filter((entry) => entry !== null)
  const current = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now()
  if (list.length === 0) return { kind: 'idle', label: MOOD_ACTIVITY_LABELS.idle, at: null }
  const newest = list[list.length - 1]
  if (current - newest.at > MOOD_ACTIVITY_IDLE_MS) {
    return { kind: 'idle', label: MOOD_ACTIVITY_LABELS.idle, at: newest.at }
  }
  const floor = Math.max(0, list.length - 2)
  for (let index = list.length - 1; index >= floor; index -= 1) {
    const kind = classifyToolName(list[index].name)
    if (kind !== null) return { kind, label: MOOD_ACTIVITY_LABELS[kind], at: list[index].at }
  }
  return { kind: 'idle', label: MOOD_ACTIVITY_LABELS.idle, at: newest.at }
}

/** 工具结果是否失败：优先 `data.error`，兼容 `message.isError`（宿主两种标记都存在）。 */
export function isToolErrorEvent(data) {
  if (typeof data !== 'object' || data === null) return false
  if (data.error !== undefined && data.error !== null) return true
  const message = data.message
  return typeof message === 'object' && message !== null && message.isError === true
}

/** 会话 id → 不可逆短标记（只用于去重，避免把原始会话 id 落盘）。 */
export function sessionKeyOf(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  return createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 16)
}

function toTimestamp(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 纯函数：把一条 session/event 应用到心情状态，返回新状态（不修改入参）。
 * - 未列入 MOOD_EVENT_TYPES 的 type 完全忽略（不参与活跃时长/活动时间）；
 * - event / event.data 缺失或畸形时安全跳过（计数能加则加，不抛异常）。
 * @param {ReturnType<typeof createEmptyMoodState>} state
 * @param {{type?: string, time?: number, data?: object}|null|undefined} event
 * @param {{sessionId?: string|null, now?: () => number}} [options]
 */
export function applySessionEvent(state, event, options = {}) {
  if (state === null || typeof state !== 'object') return state
  if (event === null || typeof event !== 'object') return state
  const type = typeof event.type === 'string' ? event.type : null
  if (type === null || !MOOD_EVENT_TYPES.includes(type)) return state

  const now = options.now ?? (() => Date.now())
  const nowMs = typeof now === 'function' ? now() : Date.now()
  const time = toTimestamp(event.time, nowMs)
  const data = typeof event.data === 'object' && event.data !== null ? event.data : {}

  // 浅拷贝：stats 与 sessionKeys 都是新对象/数组，保证纯函数语义。
  const stats = { ...state.stats }
  const sessionKeys = Array.isArray(state.sessionKeys) ? [...state.sessionKeys] : []
  const next = { ...state, stats, sessionKeys }

  // —— 活跃时长与活动时间 ——
  const previousAt = typeof state.lastEventAt === 'number' && Number.isFinite(state.lastEventAt) ? state.lastEventAt : null
  if (previousAt !== null) {
    const gap = time - previousAt
    if (gap > 0) stats.activeMs += Math.min(gap, MAX_ACTIVE_GAP_MS)
  }
  const lastEventAt = previousAt === null ? time : Math.max(previousAt, time)
  // 跨日保留的 lastActivityAt 可能大于本次事件时间（补写/时钟回拨）：只取更晚者。
  const lastActivityAt = Math.max(stats.lastActivityAt ?? 0, time)
  stats.lastActivityAt = lastActivityAt
  if (!stats.firstActivityAt) stats.firstActivityAt = time
  next.lastEventAt = lastEventAt
  next.updatedAt = lastActivityAt

  // —— 会话去重 ——
  const sessionKey = sessionKeyOf(options.sessionId)
  if (sessionKey !== null && !sessionKeys.includes(sessionKey)) {
    sessionKeys.push(sessionKey)
    if (sessionKeys.length > MAX_SESSION_IDS) sessionKeys.splice(0, sessionKeys.length - MAX_SESSION_IDS)
  }
  stats.sessions = sessionKeys.length

  // —— 计数 ——
  switch (type) {
    case 'user/message':
      stats.userMessages += 1
      break
    case 'assistant/message':
      stats.assistantMessages += 1
      break
    case 'tool/call':
      stats.toolCalls += 1
      break
    case 'tool/result':
      if (isToolErrorEvent(data)) stats.toolErrors += 1
      break
    case 'turn/start':
      stats.turns += 1
      break
    case 'turn/end': {
      const kind = typeof data.reason === 'object' && data.reason !== null ? data.reason.kind : undefined
      if (kind === 'completed') stats.turnsCompleted += 1
      else if (kind === 'error' || kind === 'aborted') stats.turnsErrored += 1
      break
    }
    default:
      break
  }
  return next
}

/** 状态 → 路由响应（契约 §2.10）。 */
export function toMoodResponse(state, date = state?.date ?? localDateKey()) {
  const stats = emptyMoodStats()
  if (state !== null && typeof state === 'object' && typeof state.stats === 'object' && state.stats !== null) {
    for (const key of MOOD_STAT_KEYS) {
      const value = state.stats[key]
      stats[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
    }
    stats.sessions = Array.isArray(state.sessionKeys) ? state.sessionKeys.length : stats.sessions
  }
  const updatedAt = typeof state?.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0
  return { ok: true, date, stats, updatedAt }
}

/** 零值响应（无 tracker / 读取失败时的兜底，永不 5xx）。 */
export function zeroMoodResponse(now = Date.now()) {
  return { ok: true, date: localDateKey(now), stats: emptyMoodStats(), updatedAt: 0 }
}

function toCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/**
 * 归一化从磁盘读到的状态；date 不是今天则跨日重置。
 * @param {unknown} raw
 * @param {string} today
 */
export function normalizeLoadedMoodState(raw, today) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return createEmptyMoodState(today)
  const rawDate = typeof raw.date === 'string' ? raw.date : null
  if (rawDate !== today) {
    // 跨日（或日期缺失/畸形）：保留 lastActivityAt，其余归零。
    return rolloverMoodState(raw, today)
  }
  const stats = emptyMoodStats()
  const rawStats = typeof raw.stats === 'object' && raw.stats !== null ? raw.stats : {}
  for (const key of MOOD_STAT_KEYS) {
    if (key === 'sessions') continue
    stats[key] = toCount(rawStats[key])
  }
  // 兼容早期草稿字段 sessionIds（未发布过，仅防御性）：新格式只用 sessionKeys（哈希标记）。
  const rawKeys = Array.isArray(raw.sessionKeys) ? raw.sessionKeys : Array.isArray(raw.sessionIds) ? raw.sessionIds : []
  const sessionKeys = rawKeys.filter((key) => typeof key === 'string' && key.length > 0).slice(-MAX_SESSION_IDS)
  stats.sessions = sessionKeys.length
  return {
    schemaVersion: MOOD_SCHEMA_VERSION,
    date: today,
    stats,
    sessionKeys,
    lastEventAt:
      typeof raw.lastEventAt === 'number' && Number.isFinite(raw.lastEventAt) && raw.lastEventAt > 0 ? raw.lastEventAt : null,
    updatedAt: toCount(raw.updatedAt),
  }
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 创建心情统计器。
 * @param {{
 *   file: string,
 *   now?: () => number,
 *   persistDebounceMs?: number,
 *   onWarn?: (message: string) => void,
 * }} options
 */
export function createMoodTracker(options) {
  const file = options.file
  const now = options.now ?? (() => Date.now())
  const persistDebounceMs = options.persistDebounceMs ?? 15000
  const onWarn = options.onWarn ?? (() => {})

  /** @type {ReturnType<typeof createEmptyMoodState>|null} */
  let state = null
  let loaded = false
  let dirty = false
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null
  let disposed = false
  /** v1.16：最近 ≤12 条工具调用 {name, at}（**只内存**，不落盘/不进 stats）。 */
  const recentTools = []

  function ensureState() {
    if (loaded) return state
    loaded = true
    const today = localDateKey(now())
    const loadedState = loadFromDisk(today)
    state = loadedState.state
    // 只有在跨日滚动时才需要立刻回写新日期（同一天的数据不需要因"读取"而重写）。
    if (loadedState.rolledOver) dirty = true
    return state
  }

  function loadFromDisk(today) {
    let stat
    try {
      stat = statSync(file)
    } catch {
      return { state: createEmptyMoodState(today), rolledOver: false }
    }
    if (!stat.isFile()) return { state: createEmptyMoodState(today), rolledOver: false }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const parsedDate = parsed !== null && typeof parsed === 'object' && typeof parsed.date === 'string' ? parsed.date : null
      return { state: normalizeLoadedMoodState(parsed, today), rolledOver: parsedDate !== today }
    } catch (error) {
      backupCorrupt()
      onWarn(`mood.json 损坏，已备份为 mood.json.bak 并回退零值：${shortMessage(error)}`)
      return { state: createEmptyMoodState(today), rolledOver: false }
    }
  }

  let corruptHandled = false
  function backupCorrupt() {
    if (corruptHandled) return
    corruptHandled = true
    try {
      copyFileSync(file, `${file}.bak`)
    } catch (error) {
      onWarn(`mood.json 备份失败：${shortMessage(error)}`)
    }
  }

  /** 当前状态（必要时先做跨日滚动；只读路径不落盘）。 */
  function currentState() {
    const today = localDateKey(now())
    const current = ensureState()
    if (current.date !== today) {
      state = rolloverMoodState(current, today)
      dirty = true
    }
    return state
  }

  function schedulePersist() {
    if (persistDebounceMs <= 0) {
      flush()
      return
    }
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, persistDebounceMs)
    try {
      timer.unref?.()
    } catch {
      /* ignore */
    }
  }

  /** 立即落盘（用于防抖到期、路由读取、插件卸载）。 */
  function flush() {
    if (!dirty || state === null) return { ok: true }
    const snapshot = state
    const written = writeJsonAtomic(file, snapshot)
    if (written.ok) {
      dirty = false
    } else {
      onWarn(`mood.json 写入失败：${written.message}`)
    }
    return written
  }

  /** 读取当日统计响应（契约 §2.10），读取时顺手落盘。永不抛异常。 */
  function getToday() {
    try {
      const current = currentState()
      if (dirty) flush()
      return toMoodResponse(current, current.date)
    } catch (error) {
      onWarn(`mood.json 读取失败：${shortMessage(error)}`)
      return zeroMoodResponse(now())
    }
  }

  /**
   * 应用一条 session/event（签名与宿主 emit 一致：session, event）。
   * 永不抛异常：监听器里的异常不能影响会话日志主流程。
   * @param {{id?: string}|null|undefined} session
   * @param {unknown} event
   */
  function record(session, event) {
    try {
      if (disposed) return
      // v1.16 活动信号：只记工具**名称+时间**（兼容 data.name/data.toolName/event.name），
      // 绝不读 data.arguments 等参数内容；纯内存 ring buffer。
      if (event !== null && typeof event === 'object' && event.type === 'tool/call') {
        const data = typeof event.data === 'object' && event.data !== null ? event.data : {}
        const rawName =
          typeof data.name === 'string'
            ? data.name
            : typeof data.toolName === 'string'
              ? data.toolName
              : typeof event.name === 'string'
                ? event.name
                : ''
        const name = rawName.trim().slice(0, 80)
        if (name.length > 0 && !disposed) {
          const at =
            typeof event.time === 'number' && Number.isFinite(event.time) && event.time > 0 ? event.time : now()
          recentTools.push({ name, at })
          if (recentTools.length > MOOD_RECENT_TOOL_LIMIT) {
            recentTools.splice(0, recentTools.length - MOOD_RECENT_TOOL_LIMIT)
          }
        }
      }
      const current = currentState()
      const next = applySessionEvent(current, event, {
        sessionId: typeof session?.id === 'string' ? session.id : null,
        now,
      })
      if (next === current) {
        // 事件本身不计入统计（未知类型/畸形），但跨日滚动仍需要回写新日期。
        if (dirty) schedulePersist()
        return
      }
      state = next
      dirty = true
      schedulePersist()
    } catch (error) {
      onWarn(`mood 事件处理失败：${shortMessage(error)}`)
    }
  }

  /**
   * 最近活动（v1.16）：基于内存里的工具调用名称归类，不读参数/不落盘。
   * @param {number|(() => number)|undefined} atNow
   * @returns {{kind:'watch'|'read'|'code'|'social'|'idle', label:string, at:number|null}}
   */
  function getRecentActivity(atNow) {
    const current = typeof atNow === 'number' && Number.isFinite(atNow) ? atNow : typeof atNow === 'function' ? atNow() : now()
    try {
      return describeRecentActivity(recentTools, current)
    } catch {
      return { kind: 'idle', label: MOOD_ACTIVITY_LABELS.idle, at: null }
    }
  }

  /** 插件卸载：清定时器并把未落盘的统计写回。 */
  function dispose() {
    disposed = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    try {
      flush()
    } catch (error) {
      onWarn(`mood.json 卸载落盘失败：${shortMessage(error)}`)
    }
  }

  return {
    file,
    record,
    getToday,
    getRecentActivity,
    flush,
    dispose,
    /** 测试/诊断用：最近的工具名+时间（只含 name/at，永不包含参数）。 */
    recentTools: () => recentTools.map((tool) => ({ ...tool })),
    /** 测试/诊断用：当前状态快照（不触发滚动）。 */
    peek: () => (state === null ? null : { ...state, stats: { ...state.stats }, sessionKeys: [...state.sessionKeys] }),
  }
}
