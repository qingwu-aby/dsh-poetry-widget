// lib/core/activity-registry.mjs —— Activity 注册中心（Gate B4，复用 activity-manifest）。
//
// 目标：可扩展活动的注册/启停/健康中心，给后续 Hub 控制面（Gate B5）提供数据：
//   · register(manifest, adapter)：复用 Gate A3 validateActivityManifest 校验，拒绝非法 manifest、
//     重复 id、非法权限；adapter 可选（start/stop/health），不传也能注册（占位/只读活动）；
//   · enable/disable：调用 adapter.start/stop（可同步/异步），启停互相隔离（一个失败不影响其他活动）；
//   · 健康：healthy / degraded / stopped / error；adapter.health 可选，refreshHealth 刷新；
//   · 事件只通过 onEvent 回调输出（activity.registered/enabled/disabled/health/...），不依赖 Event Bus；
//   · 权限/资源摘要供控制面展示；本模块**不执行权限判定**，只通过 checkPermission 暴露查询
//     （真正的权限执行在 Gate D 的 Activity SDK/工具网关）。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟、adapter、事件回调均可注入。

import {
  checkActivityPermission,
  describeActivityPermissions,
  listActivityPermissions,
  validateActivityManifest,
} from './activity-manifest.mjs'

/** 注册中心实现版本。 */
export const ACTIVITY_REGISTRY_VERSION = 1

/** 健康状态（stopped = 未启用/已停；unknown 仅内部兜底）。 */
export const ACTIVITY_HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'stopped', 'error'])

/** 可调度判定：启用且健康（degraded 仍可调度，由调度器决定降级策略）。 */
export const ACTIVITY_SCHEDULABLE_HEALTH = Object.freeze(['healthy', 'degraded'])

/** 错误码。 */
export const ACTIVITY_REGISTRY_CODES = Object.freeze({
  invalidManifest: 'ACTIVITY_INVALID_MANIFEST',
  duplicateId: 'ACTIVITY_DUPLICATE_ID',
  notFound: 'ACTIVITY_NOT_FOUND',
  capacity: 'ACTIVITY_REGISTRY_CAPACITY',
  invalidArgument: 'ACTIVITY_INVALID_ARGUMENT',
  adapterError: 'ACTIVITY_ADAPTER_ERROR',
})

/** 事件类型。 */
export const ACTIVITY_REGISTRY_EVENTS = Object.freeze([
  'activity.registered',
  'activity.unregistered',
  'activity.enabled',
  'activity.disabled',
  'activity.health',
  'activity.error',
  'activity.rejected',
])

/** 默认配置。 */
export const ACTIVITY_REGISTRY_DEFAULTS = Object.freeze({
  maxActivities: 100,
  maxRecentEvents: 50,
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function normalizeHealthValue(value) {
  if (value === true) return 'healthy'
  if (value === false) return 'error'
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (ACTIVITY_HEALTH_STATES.indexOf(lowered) >= 0) return lowered
    if (lowered === 'ok') return 'healthy'
    if (lowered === 'warn' || lowered === 'warning') return 'degraded'
    if (lowered === 'fail' || lowered === 'failed' || lowered === 'unhealthy') return 'error'
  }
  if (isPlainObject(value) && typeof value.status === 'string') return normalizeHealthValue(value.status)
  return 'unknown'
}

function describeAdapter(adapter) {
  if (adapter === null || adapter === undefined) return { ok: true, adapter: null }
  if (!isPlainObject(adapter)) return errorResult(ACTIVITY_REGISTRY_CODES.invalidArgument, 'adapter 必须是对象（可省略）')
  for (const method of ['start', 'stop', 'health']) {
    if (adapter[method] !== undefined && typeof adapter[method] !== 'function') {
      return errorResult(ACTIVITY_REGISTRY_CODES.invalidArgument, `adapter.${method} 必须是函数`)
    }
  }
  return { ok: true, adapter }
}

/**
 * 创建 Activity 注册中心。
 * @param {{
 *   now?: () => number,
 *   maxActivities?: number,
 *   maxRecentEvents?: number,
 *   onEvent?: (event: object) => void,
 *   onError?: (info: object) => void,
 * }} [options]
 */
export function createActivityRegistry(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxActivities = readPositiveInt(options.maxActivities, ACTIVITY_REGISTRY_DEFAULTS.maxActivities)
  const maxRecentEvents = readPositiveInt(options.maxRecentEvents, ACTIVITY_REGISTRY_DEFAULTS.maxRecentEvents)
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const onError = typeof options.onError === 'function' ? options.onError : null

  /** id → entry。 */
  const entries = new Map()
  const recentEvents = []
  const pendingOps = new Set()
  let eventSeq = 0
  let lastError = null
  const metrics = {
    registered: 0,
    unregistered: 0,
    enabled: 0,
    disabled: 0,
    startCalls: 0,
    stopCalls: 0,
    adapterErrors: 0,
    healthChecks: 0,
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
      activity: entry === null ? null : summary(entry),
      ...(detail === undefined ? {} : { detail }),
    }
    recentEvents.push(event)
    if (recentEvents.length > maxRecentEvents) recentEvents.shift()
    safeCall(onEvent, event)
    return event
  }

  function recordReject(code, message, extra) {
    lastError = { code, message, at: now(), ...(extra === undefined ? {} : extra) }
    emit('activity.rejected', null, { code, message })
    return errorResult(code, message, extra)
  }

  function summary(entry) {
    if (entry === null || entry === undefined) return null
    return {
      id: entry.manifest.id,
      version: entry.manifest.version,
      name: entry.manifest.name,
      enabled: entry.enabled,
      health: entry.health,
      schedulable: entry.enabled && ACTIVITY_SCHEDULABLE_HEALTH.indexOf(entry.health) >= 0,
      events: entry.manifest.events.slice(),
      tasks: entry.manifest.tasks.map((task) => ({ ...task })),
      tools: entry.manifest.tools.slice(),
      permissions: describeActivityPermissions(entry.manifest),
      resources: { ...entry.manifest.resources },
      world: entry.manifest.world === null ? null : { ...entry.manifest.world },
      registeredAt: entry.registeredAt,
      updatedAt: entry.updatedAt,
      lastHealthAt: entry.lastHealthAt,
      lastError: entry.lastError === null ? null : { ...entry.lastError },
      stats: { ...entry.stats },
    }
  }

  function trackPending(promise) {
    const tracked = Promise.resolve(promise).catch((error) => {
      metrics.adapterErrors += 1
      lastError = { code: ACTIVITY_REGISTRY_CODES.adapterError, message: error instanceof Error ? error.message : String(error) }
      safeCall(onError, { scope: 'adapter', message: lastError.message })
    })
    pendingOps.add(tracked)
    tracked.finally(() => pendingOps.delete(tracked))
  }

  function getEntry(id) {
    return entries.get(String(id ?? '')) ?? null
  }

  /**
   * 注册活动：校验 manifest + adapter，拒绝重复 id / 非法权限 / 超容量。
   * @param {object} manifest
   * @param {{start?: Function, stop?: Function, health?: Function}|null} [adapter]
   */
  function register(manifest, adapter) {
    const validated = validateActivityManifest(manifest)
    if (!validated.ok) {
      return recordReject(ACTIVITY_REGISTRY_CODES.invalidManifest, 'manifest 未通过校验', { errors: validated.errors })
    }
    const id = validated.manifest.id
    if (entries.has(id)) {
      return recordReject(ACTIVITY_REGISTRY_CODES.duplicateId, `活动 id 重复：${id}`, { id })
    }
    if (entries.size >= maxActivities) {
      return recordReject(ACTIVITY_REGISTRY_CODES.capacity, `活动数量达到上限（${maxActivities}）`, { maxActivities })
    }
    const described = describeAdapter(adapter)
    if (described.ok !== true) return recordReject(described.code, described.message)
    const entry = {
      manifest: validated.manifest,
      adapter: described.adapter,
      enabled: false,
      health: 'stopped',
      registeredAt: now(),
      updatedAt: now(),
      lastHealthAt: 0,
      lastError: null,
      stats: { starts: 0, stops: 0, healthChecks: 0, failures: 0 },
    }
    entries.set(id, entry)
    metrics.registered += 1
    emit('activity.registered', entry)
    return { ok: true, activity: summary(entry) }
  }

  /** 注销活动：启用中会先 stop（失败只计数不阻塞注销）。 */
  function unregister(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(ACTIVITY_REGISTRY_CODES.notFound, `活动不存在：${String(id)}`)
    if (entry.enabled) stopAdapter(entry, 'unregister')
    entry.enabled = false
    entry.health = 'stopped'
    entries.delete(entry.manifest.id)
    metrics.unregistered += 1
    emit('activity.unregistered', entry)
    return { ok: true, activity: summary(entry) }
  }

  function markAdapterError(entry, error) {
    metrics.adapterErrors += 1
    entry.stats.failures += 1
    entry.health = 'error'
    entry.lastError = {
      code: ACTIVITY_REGISTRY_CODES.adapterError,
      message: error instanceof Error ? error.message : String(error),
      at: now(),
    }
    entry.updatedAt = now()
    emit('activity.error', entry, { message: entry.lastError.message })
    safeCall(onError, { scope: 'adapter', activityId: entry.manifest.id, message: entry.lastError.message })
    return entry.lastError
  }

  function startAdapter(entry) {
    if (entry.adapter === null || typeof entry.adapter.start !== 'function') return
    metrics.startCalls += 1
    entry.stats.starts += 1
    try {
      const result = entry.adapter.start({ manifest: entry.manifest, now: now() })
      if (result !== null && result !== undefined && typeof result.then === 'function') {
        trackPending(
          Promise.resolve(result).then(
            () => {
              if (entry.enabled) {
                entry.health = 'healthy'
                entry.updatedAt = now()
                emit('activity.health', entry, { health: 'healthy', reason: 'start-resolved' })
              }
            },
            (error) => {
              entry.enabled = false
              markAdapterError(entry, error)
            },
          ),
        )
      }
    } catch (error) {
      entry.enabled = false
      markAdapterError(entry, error)
    }
  }

  function stopAdapter(entry, reason) {
    if (entry.adapter === null || typeof entry.adapter.stop !== 'function') return
    metrics.stopCalls += 1
    entry.stats.stops += 1
    try {
      const result = entry.adapter.stop({ manifest: entry.manifest, now: now(), reason })
      if (result !== null && result !== undefined && typeof result.then === 'function') trackPending(result)
    } catch (error) {
      markAdapterError(entry, error)
    }
  }

  /** 启用活动（调用 adapter.start；同步失败 → error，异步失败在 flush 后可见）。 */
  function enable(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(ACTIVITY_REGISTRY_CODES.notFound, `活动不存在：${String(id)}`)
    if (entry.enabled) return { ok: true, already: true, activity: summary(entry) }
    entry.enabled = true
    entry.health = 'healthy'
    entry.updatedAt = now()
    entry.lastError = null
    startAdapter(entry)
    if (entry.enabled === false) {
      // 同步 start 失败：markAdapterError 已记录，返回可识别错误。
      return errorResult(ACTIVITY_REGISTRY_CODES.adapterError, entry.lastError?.message ?? '活动启动失败', {
        activity: summary(entry),
      })
    }
    metrics.enabled += 1
    emit('activity.enabled', entry)
    emit('activity.health', entry, { health: entry.health, reason: 'enabled' })
    return { ok: true, activity: summary(entry) }
  }

  /** 停用活动（调用 adapter.stop；失败只记 error 并继续停用，保证隔离）。 */
  function disable(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(ACTIVITY_REGISTRY_CODES.notFound, `活动不存在：${String(id)}`)
    if (!entry.enabled) return { ok: true, already: true, activity: summary(entry) }
    stopAdapter(entry, 'disable')
    entry.enabled = false
    entry.health = 'stopped'
    entry.updatedAt = now()
    metrics.disabled += 1
    emit('activity.disabled', entry)
    emit('activity.health', entry, { health: 'stopped', reason: 'disabled' })
    return { ok: true, activity: summary(entry) }
  }

  /**
   * 刷新健康状态（调用 adapter.health；支持同步/异步）。
   * 未启用 → stopped；adapter 无 health → 启用则 healthy。
   * @returns {Promise<{ok: true, activity: object}|{ok: false, code: string, message: string}>}
   */
  async function refreshHealth(id) {
    const entry = getEntry(id)
    if (entry === null) return errorResult(ACTIVITY_REGISTRY_CODES.notFound, `活动不存在：${String(id)}`)
    if (!entry.enabled) {
      entry.health = 'stopped'
      return { ok: true, activity: summary(entry) }
    }
    metrics.healthChecks += 1
    entry.stats.healthChecks += 1
    entry.lastHealthAt = now()
    if (entry.adapter === null || typeof entry.adapter.health !== 'function') {
      entry.health = 'healthy'
      entry.updatedAt = now()
      return { ok: true, activity: summary(entry) }
    }
    try {
      const result = await entry.adapter.health({ manifest: entry.manifest, now: now() })
      const health = normalizeHealthValue(result)
      entry.health = health === 'unknown' ? 'degraded' : health
      entry.updatedAt = now()
      emit('activity.health', entry, { health: entry.health, reason: 'probe' })
      return { ok: true, activity: summary(entry) }
    } catch (error) {
      const detail = markAdapterError(entry, error)
      return errorResult(ACTIVITY_REGISTRY_CODES.adapterError, detail.message, { activity: summary(entry) })
    }
  }

  /** 刷新全部启用活动的健康状态。 */
  async function refreshAll() {
    const results = []
    for (const entry of entries.values()) {
      results.push({ id: entry.manifest.id, result: await refreshHealth(entry.manifest.id) })
    }
    return { ok: true, results }
  }

  /** 缓存健康状态（不触发 adapter 调用）。 */
  function healthOf(id) {
    const entry = getEntry(id)
    return entry === null ? null : entry.health
  }

  /** 是否可被调度（启用 + healthy/degraded）。 */
  function canSchedule(id) {
    const entry = getEntry(id)
    if (entry === null) return false
    return entry.enabled && ACTIVITY_SCHEDULABLE_HEALTH.indexOf(entry.health) >= 0
  }

  function get(id) {
    const entry = getEntry(id)
    return entry === null ? null : summary(entry)
  }

  function has(id) {
    return entries.has(String(id ?? ''))
  }

  function isEnabled(id) {
    const entry = getEntry(id)
    return entry !== null && entry.enabled
  }

  function list(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const out = []
    for (const entry of entries.values()) {
      if (spec.enabled !== undefined && entry.enabled !== (spec.enabled === true)) continue
      if (typeof spec.health === 'string' && spec.health.length > 0 && entry.health !== spec.health) continue
      out.push(entry)
    }
    out.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))
    return out.map((entry) => summary(entry))
  }

  /**
   * 权限查询（只读，不执行判定）：把请求交给 Gate A3 的 checkActivityPermission。
   * @param {string} id
   * @param {string} request 形如 `fs.read:~/Books/a.md`
   */
  function checkPermission(id, request) {
    const entry = getEntry(id)
    if (entry === null) return { ok: false, allowed: false, code: ACTIVITY_REGISTRY_CODES.notFound, message: `活动不存在：${String(id)}` }
    const verdict = checkActivityPermission(entry.manifest, request)
    return { ok: true, activityId: entry.manifest.id, ...verdict }
  }

  /** 权限/资源摘要（供控制面展示；不含权限判定）。 */
  function describe(id) {
    const entry = getEntry(id)
    if (entry === null) return null
    return {
      id: entry.manifest.id,
      version: entry.manifest.version,
      name: entry.manifest.name,
      enabled: entry.enabled,
      health: entry.health,
      permissions: describeActivityPermissions(entry.manifest),
      permissionStrings: listActivityPermissions(entry.manifest).map((item) => item.raw),
      resources: { ...entry.manifest.resources },
      events: entry.manifest.events.slice(),
      tools: entry.manifest.tools.slice(),
      taskCount: entry.manifest.tasks.length,
    }
  }

  async function flush() {
    while (pendingOps.size > 0) await Promise.allSettled([...pendingOps])
  }

  function snapshot() {
    const byHealth = { healthy: 0, degraded: 0, stopped: 0, error: 0 }
    let enabled = 0
    for (const entry of entries.values()) {
      byHealth[entry.health] = (byHealth[entry.health] ?? 0) + 1
      if (entry.enabled) enabled += 1
    }
    return {
      ok: true,
      version: ACTIVITY_REGISTRY_VERSION,
      now: now(),
      total: entries.size,
      enabled,
      byHealth,
      maxActivities,
      activities: list(),
      metrics: { ...metrics },
      lastError: lastError === null ? null : { ...lastError },
      recentEvents: recentEvents.slice(-10),
    }
  }

  return {
    register,
    unregister,
    enable,
    disable,
    refreshHealth,
    refreshAll,
    healthOf,
    canSchedule,
    get,
    has,
    isEnabled,
    list,
    checkPermission,
    describe,
    flush,
    snapshot,
  }
}
