// lib/core/world-supervisor.mjs —— World/Activity 生命周期监管（Gate D3，纯逻辑，不真正 spawn）。
//
// 目标：给每个 Activity/World 统一的启停/健康/崩溃重启监管，先做纯逻辑，不接真实进程：
//   · register({id, start, stop, health, maxRestarts, backoffMs})：start/stop/health 全部注入（可异步）；
//   · 状态机：stopped / starting / running / degraded / error / restarting；
//   · health 探测失败 → degraded（连续失败达阈值 → 按崩溃处理：重启/超限 error）；
//   · 崩溃重启：指数退避（backoffMs × factor^(n-1)，上限 maxBackoffMs），最大次数 maxRestarts，
//     超限 → error 并停止重试；手动 restart 重置重试预算；stopAll 统一停止；
//   · 事件只通过 onEvent 回调输出（world.registered/started/stopped/health/restarting/error/recovered），
//     不直接调用 Activity 业务；一个 World 的失败不影响其他 World（隔离）。
//   · 定时器可注入（测试用假定时器验证退避序列），时钟可注入；模块不读盘/不联网/不 spawn 进程。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；start/stop/health、时钟、定时器、事件回调均可注入。

/** 实现版本。 */
export const WORLD_SUPERVISOR_VERSION = 1

/** 状态。 */
export const WORLD_STATES = Object.freeze(['stopped', 'starting', 'running', 'degraded', 'error', 'restarting'])

/** 事件类型。 */
export const WORLD_SUPERVISOR_EVENTS = Object.freeze([
  'world.registered',
  'world.started',
  'world.stopped',
  'world.health',
  'world.restarting',
  'world.error',
  'world.recovered',
])

/** 错误码。 */
export const WORLD_SUPERVISOR_CODES = Object.freeze({
  unknownWorld: 'WORLD_UNKNOWN',
  duplicateWorld: 'WORLD_DUPLICATE_ID',
  invalidSpec: 'WORLD_INVALID_SPEC',
  startFailed: 'WORLD_START_FAILED',
  stopFailed: 'WORLD_STOP_FAILED',
  restartExhausted: 'WORLD_RESTART_EXHAUSTED',
  notRunning: 'WORLD_NOT_RUNNING',
  crashIgnored: 'WORLD_CRASH_IGNORED',
})

/** 默认配置。 */
export const WORLD_SUPERVISOR_DEFAULTS = Object.freeze({
  maxRestarts: 3,
  backoffMs: 1000,
  backoffFactor: 2,
  maxBackoffMs: 60_000,
  healthFailureThreshold: 2,
  autoRestart: true,
  maxWorlds: 50,
})

const ID_PATTERN = /^[a-z][a-z0-9-]{2,39}$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function clean(value, max) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function normalizeHealthResult(result) {
  if (result === undefined || result === null) return { ok: true, detail: '' }
  if (result === true) return { ok: true, detail: '' }
  if (result === false) return { ok: false, detail: '' }
  if (typeof result === 'string') {
    const lowered = result.trim().toLowerCase()
    if (lowered === 'healthy' || lowered === 'ok' || lowered === 'up') return { ok: true, detail: result }
    if (lowered === 'degraded' || lowered === 'warn' || lowered === 'warning') return { ok: false, detail: result }
    return { ok: false, detail: result }
  }
  if (isPlainObject(result)) {
    const ok = result.ok === true || result.status === 'healthy' || result.status === 'ok'
    return { ok, detail: clean(result.detail ?? result.message ?? result.status, 200) }
  }
  return { ok: false, detail: '' }
}

/**
 * 创建 World 监管器。
 * @param {{
 *   now?: () => number,
 *   timers?: {setTimeout: Function, clearTimeout: Function},
 *   onEvent?: (event: object) => void,
 *   onError?: (info: object) => void,
 *   autoRestart?: boolean,
 *   maxRestarts?: number,
 *   backoffMs?: number,
 *   backoffFactor?: number,
 *   maxBackoffMs?: number,
 *   healthFailureThreshold?: number,
 *   maxWorlds?: number,
 * }} [options]
 */
export function createWorldSupervisor(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const timers = isPlainObject(spec.timers)
    ? spec.timers
    : { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle) }
  const onEvent = typeof spec.onEvent === 'function' ? spec.onEvent : null
  const onError = typeof spec.onError === 'function' ? spec.onError : null
  const autoRestart = spec.autoRestart !== false
  const defaultMaxRestarts = readPositiveInt(spec.maxRestarts, WORLD_SUPERVISOR_DEFAULTS.maxRestarts)
  const defaultBackoffMs = readPositiveInt(spec.backoffMs, WORLD_SUPERVISOR_DEFAULTS.backoffMs)
  const defaultBackoffFactor = Math.max(1, readNumber(spec.backoffFactor, WORLD_SUPERVISOR_DEFAULTS.backoffFactor))
  const defaultMaxBackoffMs = readPositiveInt(spec.maxBackoffMs, WORLD_SUPERVISOR_DEFAULTS.maxBackoffMs)
  const defaultHealthFailureThreshold = readPositiveInt(spec.healthFailureThreshold, WORLD_SUPERVISOR_DEFAULTS.healthFailureThreshold)
  const maxWorlds = readPositiveInt(spec.maxWorlds, WORLD_SUPERVISOR_DEFAULTS.maxWorlds)

  const worlds = new Map()
  const pending = new Set()
  let eventSeq = 0
  const metrics = {
    registered: 0,
    starts: 0,
    stops: 0,
    restarts: 0,
    crashes: 0,
    healthChecks: 0,
    healthFailures: 0,
    errors: 0,
    events: 0,
  }

  function safeCall(callback, payload) {
    if (callback === null) return
    try {
      callback(payload)
    } catch (error) {
      void error
    }
  }

  function emit(type, entry, detail) {
    eventSeq += 1
    metrics.events += 1
    const event = {
      type,
      seq: eventSeq,
      at: now(),
      world: entry === null ? null : summary(entry),
      ...(detail === undefined ? {} : { detail }),
    }
    safeCall(onEvent, event)
    return event
  }

  function summary(entry) {
    return {
      id: entry.id,
      state: entry.state,
      restarts: entry.restarts,
      maxRestarts: entry.maxRestarts,
      nextBackoffMs: entry.nextBackoffMs,
      lastError: entry.lastError === null ? null : { ...entry.lastError },
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt,
      health: {
        consecutiveFailures: entry.consecutiveFailures,
        lastCheckedAt: entry.lastCheckedAt,
        lastOk: entry.lastHealthOk,
      },
      stats: { ...entry.stats },
    }
  }

  function getEntry(id) {
    return worlds.get(String(id ?? '')) ?? null
  }

  function clearRestartTimer(entry) {
    if (entry.timer !== null && entry.timer !== undefined) {
      try {
        timers.clearTimeout(entry.timer)
      } catch (error) {
        void error
      }
      entry.timer = null
    }
  }

  function trackPromise(promise) {
    const tracked = Promise.resolve(promise).catch((error) => {
      metrics.errors += 1
      safeCall(onError, { scope: 'restart', message: error instanceof Error ? error.message : String(error) })
    })
    pending.add(tracked)
    tracked.finally(() => pending.delete(tracked))
  }

  function scheduleRestart(entry, reason) {
    clearRestartTimer(entry)
    if (!autoRestart) {
      entry.state = 'error'
      entry.lastError = {
        code: WORLD_SUPERVISOR_CODES.startFailed,
        message: entry.lastError === null ? reason : entry.lastError.message,
        at: now(),
      }
      emit('world.error', entry, { reason, autoRestart: false })
      return { scheduled: false }
    }
    if (entry.restarts >= entry.maxRestarts) {
      entry.state = 'error'
      entry.nextBackoffMs = 0
      entry.lastError = { code: WORLD_SUPERVISOR_CODES.restartExhausted, message: `重启次数用尽（${entry.maxRestarts}）`, at: now() }
      emit('world.error', entry, { reason: 'restart-exhausted', restarts: entry.restarts })
      return { scheduled: false, exhausted: true }
    }
    entry.restarts += 1
    const delayMs = Math.min(
      entry.backoffMs * Math.pow(entry.backoffFactor, entry.restarts - 1),
      entry.maxBackoffMs,
    )
    entry.state = 'restarting'
    entry.nextBackoffMs = Math.round(delayMs)
    entry.lastError = { code: WORLD_SUPERVISOR_CODES.startFailed, message: reason, at: now() }
    metrics.restarts += 1
    emit('world.restarting', entry, { attempt: entry.restarts, delayMs: Math.round(delayMs), reason })
    entry.timer = timers.setTimeout(() => {
      entry.timer = null
      trackPromise(performRestart(entry))
    }, Math.round(delayMs))
    return { scheduled: true, attempt: entry.restarts, delayMs: Math.round(delayMs) }
  }

  async function performRestart(entry) {
    if (entry.state === 'stopped') return { ok: false, code: WORLD_SUPERVISOR_CODES.notRunning }
    entry.state = 'starting'
    try {
      await entry.stop({ id: entry.id, restart: true, attempt: entry.restarts })
      entry.stats.stops += 1
    } catch (error) {
      void error
    }
    try {
      await entry.start({ id: entry.id, restart: true, attempt: entry.restarts })
      entry.state = 'running'
      entry.startedAt = now()
      entry.consecutiveFailures = 0
      entry.nextBackoffMs = 0
      entry.stats.starts += 1
      entry.stats.restarts += 1
      emit('world.started', entry, { restart: true, attempt: entry.restarts })
      return { ok: true, state: entry.state }
    } catch (error) {
      entry.stats.crashes += 1
      entry.lastError = {
        code: WORLD_SUPERVISOR_CODES.startFailed,
        message: error instanceof Error ? error.message : String(error),
        at: now(),
      }
      emit('world.error', entry, { reason: 'restart-failed', message: entry.lastError.message })
      scheduleRestart(entry, 'restart-failed')
      return { ok: false, code: WORLD_SUPERVISOR_CODES.startFailed, message: entry.lastError.message }
    }
  }

  /** 注册 World（start 必填；stop/health 可选；均可异步）。 */
  function register(worldSpec) {
    if (!isPlainObject(worldSpec)) return errorResult(WORLD_SUPERVISOR_CODES.invalidSpec, 'world 必须是对象')
    const id = typeof worldSpec.id === 'string' ? worldSpec.id.trim() : ''
    if (!ID_PATTERN.test(id)) {
      return errorResult(WORLD_SUPERVISOR_CODES.invalidSpec, 'id 必须是小写字母开头的 3–40 位小写字母/数字/连字符')
    }
    if (worlds.has(id)) return errorResult(WORLD_SUPERVISOR_CODES.duplicateWorld, `world id 重复：${id}`, { id })
    if (worlds.size >= maxWorlds) return errorResult(WORLD_SUPERVISOR_CODES.invalidSpec, `world 数量达到上限（${maxWorlds}）`)
    if (typeof worldSpec.start !== 'function') return errorResult(WORLD_SUPERVISOR_CODES.invalidSpec, 'start 必须是函数')
    if (worldSpec.stop !== undefined && typeof worldSpec.stop !== 'function') {
      return errorResult(WORLD_SUPERVISOR_CODES.invalidSpec, 'stop 必须是函数')
    }
    if (worldSpec.health !== undefined && typeof worldSpec.health !== 'function') {
      return errorResult(WORLD_SUPERVISOR_CODES.invalidSpec, 'health 必须是函数')
    }
    const entry = {
      id,
      start: worldSpec.start,
      stop: typeof worldSpec.stop === 'function' ? worldSpec.stop : async () => {},
      health: typeof worldSpec.health === 'function' ? worldSpec.health : null,
      maxRestarts: readPositiveInt(worldSpec.maxRestarts, defaultMaxRestarts),
      backoffMs: readPositiveInt(worldSpec.backoffMs, defaultBackoffMs),
      backoffFactor: Math.max(1, readNumber(worldSpec.backoffFactor, defaultBackoffFactor)),
      maxBackoffMs: readPositiveInt(worldSpec.maxBackoffMs, defaultMaxBackoffMs),
      healthFailureThreshold: readPositiveInt(worldSpec.healthFailureThreshold, defaultHealthFailureThreshold),
      state: 'stopped',
      restarts: 0,
      nextBackoffMs: 0,
      lastError: null,
      startedAt: 0,
      stoppedAt: 0,
      consecutiveFailures: 0,
      lastCheckedAt: 0,
      lastHealthOk: null,
      timer: null,
      stats: { starts: 0, stops: 0, restarts: 0, crashes: 0, healthChecks: 0, healthFailures: 0 },
    }
    worlds.set(id, entry)
    metrics.registered += 1
    emit('world.registered', entry)
    return { ok: true, world: summary(entry) }
  }

  function unregister(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(WORLD_SUPERVISOR_CODES.unknownWorld, `world 不存在：${String(id)}`)
    clearRestartTimer(entry)
    worlds.delete(entry.id)
    return { ok: true, world: summary(entry) }
  }

  /** 启动（幂等：已运行/启动中/重启中 → already）。 */
  async function startWorld(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(WORLD_SUPERVISOR_CODES.unknownWorld, `world 不存在：${String(id)}`)
    if (entry.state === 'running' || entry.state === 'starting' || entry.state === 'restarting' || entry.state === 'degraded') {
      return { ok: true, already: true, state: entry.state }
    }
    clearRestartTimer(entry)
    entry.restarts = 0
    entry.nextBackoffMs = 0
    entry.lastError = null
    entry.state = 'starting'
    try {
      await entry.start({ id: entry.id, restart: false })
      entry.state = 'running'
      entry.startedAt = now()
      entry.consecutiveFailures = 0
      entry.stats.starts += 1
      metrics.starts += 1
      emit('world.started', entry, { restart: false })
      return { ok: true, state: entry.state }
    } catch (error) {
      entry.stats.crashes += 1
      metrics.crashes += 1
      entry.lastError = {
        code: WORLD_SUPERVISOR_CODES.startFailed,
        message: error instanceof Error ? error.message : String(error),
        at: now(),
      }
      emit('world.error', entry, { reason: 'start-failed', message: entry.lastError.message })
      scheduleRestart(entry, 'start-failed')
      return { ok: false, code: WORLD_SUPERVISOR_CODES.startFailed, message: entry.lastError.message, state: entry.state }
    }
  }

  /** 停止（幂等；停止失败只记录，状态仍为 stopped，保证隔离）。 */
  async function stopWorld(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(WORLD_SUPERVISOR_CODES.unknownWorld, `world 不存在：${String(id)}`)
    if (entry.state === 'stopped' && entry.timer === null) return { ok: true, already: true, state: entry.state }
    clearRestartTimer(entry)
    const wasRunning = entry.state === 'running' || entry.state === 'degraded' || entry.state === 'starting' || entry.state === 'restarting'
    entry.state = 'stopped'
    entry.stoppedAt = now()
    entry.consecutiveFailures = 0
    entry.nextBackoffMs = 0
    if (wasRunning) {
      entry.stats.stops += 1
      metrics.stops += 1
      try {
        await entry.stop({ id: entry.id, restart: false })
      } catch (error) {
        entry.lastError = {
          code: WORLD_SUPERVISOR_CODES.stopFailed,
          message: error instanceof Error ? error.message : String(error),
          at: now(),
        }
        emit('world.error', entry, { reason: 'stop-failed', message: entry.lastError.message })
      }
    }
    emit('world.stopped', entry)
    return { ok: true, state: entry.state }
  }

  /** 停止全部（隔离：单个失败不阻塞其他；返回逐项结果）。 */
  async function stopAll() {
    const results = []
    for (const entry of [...worlds.values()]) {
      try {
        results.push({ id: entry.id, ...(await stopWorld(entry.id)) })
      } catch (error) {
        results.push({ id: entry.id, ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    }
    return { ok: true, results }
  }

  /** 手动重启：清退避、重置重试预算；失败不自动再排（需人工介入）。 */
  async function restart(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(WORLD_SUPERVISOR_CODES.unknownWorld, `world 不存在：${String(id)}`)
    clearRestartTimer(entry)
    entry.restarts = 0
    entry.nextBackoffMs = 0
    entry.state = 'restarting'
    emit('world.restarting', entry, { manual: true, attempt: 0, delayMs: 0 })
    try {
      if (entry.stats.starts > 0) {
        try {
          await entry.stop({ id: entry.id, restart: true, manual: true })
          entry.stats.stops += 1
        } catch (error) {
          void error
        }
      }
      entry.state = 'starting'
      await entry.start({ id: entry.id, restart: true, manual: true })
      entry.state = 'running'
      entry.startedAt = now()
      entry.consecutiveFailures = 0
      entry.lastError = null
      entry.stats.starts += 1
      entry.stats.restarts += 1
      metrics.restarts += 1
      emit('world.started', entry, { restart: true, manual: true })
      return { ok: true, state: entry.state }
    } catch (error) {
      entry.stats.crashes += 1
      entry.state = 'error'
      entry.lastError = {
        code: WORLD_SUPERVISOR_CODES.startFailed,
        message: error instanceof Error ? error.message : String(error),
        at: now(),
      }
      emit('world.error', entry, { reason: 'manual-restart-failed', message: entry.lastError.message })
      return { ok: false, code: WORLD_SUPERVISOR_CODES.startFailed, message: entry.lastError.message, state: entry.state }
    }
  }

  /** 健康探测：失败 → degraded；连续失败达阈值 → 按崩溃重启。 */
  async function probe(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(WORLD_SUPERVISOR_CODES.unknownWorld, `world 不存在：${String(id)}`)
    if (entry.state !== 'running' && entry.state !== 'degraded') {
      return errorResult(WORLD_SUPERVISOR_CODES.notRunning, `world 当前状态不可探测：${entry.state}`, { state: entry.state })
    }
    entry.stats.healthChecks += 1
    metrics.healthChecks += 1
    entry.lastCheckedAt = now()
    let outcome = { ok: true, detail: '' }
    if (entry.health !== null) {
      try {
        outcome = normalizeHealthResult(await entry.health({ id: entry.id, state: entry.state, now: now() }))
      } catch (error) {
        outcome = { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    }
    entry.lastHealthOk = outcome.ok
    if (outcome.ok) {
      entry.consecutiveFailures = 0
      const recovered = entry.state === 'degraded'
      entry.state = 'running'
      emit('world.health', entry, { ok: true, detail: outcome.detail })
      if (recovered) emit('world.recovered', entry, { detail: outcome.detail })
      return { ok: true, state: entry.state }
    }
    entry.stats.healthFailures += 1
    metrics.healthFailures += 1
    entry.consecutiveFailures += 1
    emit('world.health', entry, { ok: false, detail: outcome.detail, failures: entry.consecutiveFailures })
    if (entry.consecutiveFailures >= entry.healthFailureThreshold) {
      entry.stats.crashes += 1
      metrics.crashes += 1
      entry.lastError = {
        code: WORLD_SUPERVISOR_CODES.startFailed,
        message: `health 连续失败 ${entry.consecutiveFailures} 次：${outcome.detail || 'no detail'}`,
        at: now(),
      }
      emit('world.error', entry, { reason: 'health-failed', message: entry.lastError.message })
      const scheduled = scheduleRestart(entry, 'health-failed')
      return { ok: false, state: entry.state, restarts: entry.restarts, ...scheduled }
    }
    entry.state = 'degraded'
    return { ok: false, state: entry.state, failures: entry.consecutiveFailures }
  }

  async function probeAll() {
    const results = []
    for (const entry of [...worlds.values()]) {
      if (entry.state !== 'running' && entry.state !== 'degraded') continue
      results.push({ id: entry.id, ...(await probe(entry.id)) })
    }
    return { ok: true, results }
  }

  /** 外部崩溃上报（bot 进程退出等）→ 按崩溃处理（退避重启/超限 error）。 */
  function crash(id, reason) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(WORLD_SUPERVISOR_CODES.unknownWorld, `world 不存在：${String(id)}`)
    if (entry.state === 'stopped' || entry.state === 'error') {
      return errorResult(WORLD_SUPERVISOR_CODES.crashIgnored, `world 已停止/错误，忽略崩溃上报：${entry.state}`, { state: entry.state })
    }
    entry.stats.crashes += 1
    metrics.crashes += 1
    entry.lastError = {
      code: WORLD_SUPERVISOR_CODES.startFailed,
      message: clean(reason, 240) || 'world crashed',
      at: now(),
    }
    emit('world.error', entry, { reason: 'crashed', message: entry.lastError.message })
    return { ok: true, ...scheduleRestart(entry, entry.lastError.message), state: entry.state }
  }

  function get(id) {
    const entry = getEntry(id)
    return entry === null ? null : summary(entry)
  }

  function list(filter) {
    const spec2 = isPlainObject(filter) ? filter : {}
    const out = []
    for (const entry of worlds.values()) {
      if (typeof spec2.state === 'string' && spec2.state.length > 0 && entry.state !== spec2.state) continue
      out.push(summary(entry))
    }
    return out
  }

  async function flush() {
    while (pending.size > 0) await Promise.allSettled([...pending])
  }

  function snapshot() {
    const byState = { stopped: 0, starting: 0, running: 0, degraded: 0, error: 0, restarting: 0 }
    let pendingTimers = 0
    for (const entry of worlds.values()) {
      byState[entry.state] = (byState[entry.state] ?? 0) + 1
      if (entry.timer !== null) pendingTimers += 1
    }
    return {
      ok: true,
      version: WORLD_SUPERVISOR_VERSION,
      now: now(),
      total: worlds.size,
      byState,
      pendingTimers,
      pendingRestarts: pending.size,
      worlds: list(),
      metrics: { ...metrics },
    }
  }

  return {
    register,
    unregister,
    startWorld,
    stopWorld,
    stopAll,
    restart,
    probe,
    probeAll,
    crash,
    get,
    list,
    flush,
    snapshot,
  }
}
