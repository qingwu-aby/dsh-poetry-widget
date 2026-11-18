// lib/core/event-bus.mjs —— Activity Hub 统一事件总线（Gate B1，纯逻辑 + 可注入依赖）。
//
// 目标：在 Hub 落地前，提供可用的“有界、幂等、可回放”事件总线。复用 Gate A 的契约：
//   · envelope 校验/幂等键/版本策略来自 `event-schema.mjs`（Gate A7）；
//   · 背压默认值来自 `EVENT_BACKPRESSURE_DEFAULTS`（保留窗口/内存上限/回放上限/磁盘阈值）。
//
// 设计要点：
//   · append(event)：校验 envelope → 幂等去重 → 背压检查 → 有界环形缓冲 → 异步投递订阅者；
//   · 幂等：buildIdempotencyKey 重复 append 返回 {ok:true, duplicate:true, seq}，不重复投递；
//   · 有界：内存最多 maxEvents 条（队列满默认显式拒绝，可选 drop-oldest 并计数，绝不静默丢）；
//   · 保留窗口：超过 retentionMs 的旧事件在下一次 append/snapshot/replay 时清理（计数 evicted）；
//   · 回放：replay({activity,type,topics,fromSeq,fromAt,toAt,limit})，limit 不得超过 maxReplay（显式拒绝）；
//   · 订阅：subscribe(pattern, handler)，pattern 支持 `*` / `ns.*` / 精确 type；投递失败隔离；
//   · 背压：队列满 / 磁盘软阈值 → 明确拒绝码；磁盘硬阈值 → 始终拒绝；
//   · 持久化适配：store = {append, read, clear}（可选；本任务只提供内存实现 createMemoryEventStore，
//     不写 live 数据；store 失败只计数不阻塞总线）。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟/磁盘用量/存储均可注入，事件通过回调输出。

import {
  EVENT_BACKPRESSURE_DEFAULTS,
  buildIdempotencyKey,
  validateEventEnvelope,
} from './event-schema.mjs'

/** 总线实现版本。 */
export const EVENT_BUS_VERSION = 1

/** 拒绝/错误码（调用方据此决定退避/告警）。 */
export const EVENT_BUS_CODES = Object.freeze({
  invalidEvent: 'EVENT_BUS_INVALID_EVENT',
  invalidPattern: 'EVENT_BUS_INVALID_PATTERN',
  invalidFilter: 'EVENT_BUS_INVALID_FILTER',
  queueFull: 'EVENT_BUS_QUEUE_FULL',
  diskSoftLimit: 'EVENT_BUS_DISK_SOFT_LIMIT',
  diskHardLimit: 'EVENT_BUS_DISK_HARD_LIMIT',
  replayLimit: 'EVENT_BUS_REPLAY_LIMIT',
  noStore: 'EVENT_BUS_NO_STORE',
  storeError: 'EVENT_BUS_STORE_ERROR',
})

/** 队列满时的处理策略。 */
export const EVENT_BUS_QUEUE_FULL_POLICIES = Object.freeze(['reject', 'drop-oldest'])

/** 默认配置（与 event-schema 的背压默认值对齐）。 */
export const EVENT_BUS_DEFAULTS = Object.freeze({
  maxEvents: EVENT_BACKPRESSURE_DEFAULTS.maxEventsInMemory,
  retentionMs: EVENT_BACKPRESSURE_DEFAULTS.retentionHours * 60 * 60 * 1000,
  maxReplay: EVENT_BACKPRESSURE_DEFAULTS.maxReplayEvents,
  maxDedupeKeys: 50_000,
  diskSoftLimitBytes: EVENT_BACKPRESSURE_DEFAULTS.diskSoftLimitBytes,
  diskHardLimitBytes: EVENT_BACKPRESSURE_DEFAULTS.diskHardLimitBytes,
  queueFullPolicy: 'reject',
  allowSoftOverflow: false,
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function errorEntry(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

/** 解析订阅 pattern：`*` / `ns.*` / 精确 type。 */
export function parseSubscriptionPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.trim().length === 0 || pattern.length > 160) {
    return { ok: false, code: EVENT_BUS_CODES.invalidPattern, message: 'pattern 必须是非空字符串（`*` / `ns.*` / 精确 type）' }
  }
  const value = pattern.trim()
  if (value === '*') return { ok: true, kind: 'all', value }
  if (/^[a-z][a-z0-9-]*\.\*$/.test(value)) return { ok: true, kind: 'prefix', value, prefix: value.slice(0, -1) }
  if (/^[a-z][a-z0-9-]*(?:\.[a-z0-9_-]+){1,4}$/.test(value)) return { ok: true, kind: 'exact', value }
  return { ok: false, code: EVENT_BUS_CODES.invalidPattern, message: `不支持的 pattern：${value}` }
}

function matchesPattern(parsed, type) {
  if (parsed.kind === 'all') return true
  if (parsed.kind === 'exact') return parsed.value === type
  return type.startsWith(parsed.prefix)
}

/** 内部：解析回放过滤条件。 */
function normalizeReplayFilter(filter, maxReplay) {
  const spec = isPlainObject(filter) ? filter : {}
  const limitRaw = spec.limit === undefined ? maxReplay : Number(spec.limit)
  if (!Number.isFinite(limitRaw) || limitRaw < 1) {
    return { ok: false, ...errorEntry(EVENT_BUS_CODES.invalidFilter, 'limit 必须是正整数') }
  }
  const limit = Math.floor(limitRaw)
  if (limit > maxReplay) {
    return {
      ok: false,
      ...errorEntry(EVENT_BUS_CODES.replayLimit, `回放上限 ${maxReplay}，请求 ${limit} 被拒绝（避免回放风暴）`, {
        limit,
        maxReplay,
      }),
    }
  }
  let typePattern = null
  if (spec.type !== undefined) {
    typePattern = parseSubscriptionPattern(spec.type)
    if (!typePattern.ok) return { ok: false, ...errorEntry(EVENT_BUS_CODES.invalidFilter, `type 过滤非法：${String(spec.type)}`) }
  }
  const topics = spec.topics === undefined ? null : Array.isArray(spec.topics) ? spec.topics.filter((item) => typeof item === 'string') : null
  if (spec.topics !== undefined && topics === null) {
    return { ok: false, ...errorEntry(EVENT_BUS_CODES.invalidFilter, 'topics 必须是字符串数组') }
  }
  return {
    ok: true,
    limit,
    activity: typeof spec.activity === 'string' && spec.activity.length > 0 ? spec.activity : null,
    subject: typeof spec.subject === 'string' && spec.subject.length > 0 ? spec.subject : null,
    typePattern,
    topics: topics !== null && topics.length > 0 ? topics : null,
    fromSeq: Number.isFinite(Number(spec.fromSeq)) ? Math.max(0, Math.floor(Number(spec.fromSeq))) : 0,
    fromAt: Number.isFinite(Number(spec.fromAt)) ? Math.max(0, Math.floor(Number(spec.fromAt))) : 0,
    toAt: Number.isFinite(Number(spec.toAt)) ? Math.floor(Number(spec.toAt)) : 0,
  }
}

function filterMatches(parsed, entry) {
  const event = entry.event
  if (parsed.fromSeq > 0 && entry.seq < parsed.fromSeq) return false
  if (parsed.fromAt > 0 && event.at < parsed.fromAt) return false
  if (parsed.toAt > 0 && event.at > parsed.toAt) return false
  if (parsed.activity !== null && event.activity !== parsed.activity) return false
  if (parsed.subject !== null && event.subject !== parsed.subject) return false
  if (parsed.typePattern !== null && !matchesPattern(parsed.typePattern, event.type)) return false
  if (parsed.topics !== null) {
    const eventTopics = Array.isArray(event.topics) ? event.topics : []
    if (!parsed.topics.some((topic) => eventTopics.indexOf(topic) >= 0)) return false
  }
  return true
}

/**
 * 内存持久化适配器（接口演示；不写盘、不写 live 数据）。
 * store = { append(event), read(filter), clear(), snapshot() }
 * @param {{maxEvents?: number, now?: () => number}} [options]
 */
export function createMemoryEventStore(options = {}) {
  const maxEvents = readPositiveInt(options.maxEvents, EVENT_BACKPRESSURE_DEFAULTS.maxEventsInMemory)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const events = []
  return {
    append(event) {
      events.push({ event, storedAt: now() })
      while (events.length > maxEvents) events.shift()
      return { ok: true }
    },
    read(filter) {
      const spec = isPlainObject(filter) ? filter : {}
      const limit = readPositiveInt(spec.limit, events.length)
      const activity = typeof spec.activity === 'string' && spec.activity.length > 0 ? spec.activity : null
      const out = []
      for (const item of events) {
        if (activity !== null && item.event.activity !== activity) continue
        out.push(item.event)
        if (out.length >= limit) break
      }
      return { ok: true, events: out }
    },
    clear() {
      events.length = 0
    },
    snapshot() {
      return { ok: true, stored: events.length, maxEvents }
    },
  }
}

/**
 * 创建事件总线。
 * @param {{
 *   now?: () => number,
 *   maxEvents?: number,
 *   retentionMs?: number,
 *   maxReplay?: number,
 *   maxDedupeKeys?: number,
 *   diskSoftLimitBytes?: number,
 *   diskHardLimitBytes?: number,
 *   getDiskUsageBytes?: (() => number)|null,
 *   queueFullPolicy?: 'reject'|'drop-oldest',
 *   allowSoftOverflow?: boolean,
 *   store?: {append?: Function, read?: Function, clear?: Function}|null,
 *   onDrop?: (info: object) => void,
 *   onError?: (info: object) => void,
 *   onReject?: (info: object) => void,
 * }} [options]
 */
export function createEventBus(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxEvents = readPositiveInt(options.maxEvents, EVENT_BUS_DEFAULTS.maxEvents)
  const retentionMs = readPositiveInt(options.retentionMs, EVENT_BUS_DEFAULTS.retentionMs)
  const maxReplay = readPositiveInt(options.maxReplay, EVENT_BUS_DEFAULTS.maxReplay)
  const maxDedupeKeys = readPositiveInt(options.maxDedupeKeys, EVENT_BUS_DEFAULTS.maxDedupeKeys)
  const diskSoftLimitBytes = readPositiveInt(options.diskSoftLimitBytes, EVENT_BUS_DEFAULTS.diskSoftLimitBytes)
  const diskHardLimitBytes = readPositiveInt(options.diskHardLimitBytes, EVENT_BUS_DEFAULTS.diskHardLimitBytes)
  const getDiskUsageBytes = typeof options.getDiskUsageBytes === 'function' ? options.getDiskUsageBytes : null
  const queueFullPolicy =
    EVENT_BUS_QUEUE_FULL_POLICIES.indexOf(options.queueFullPolicy) >= 0
      ? options.queueFullPolicy
      : EVENT_BUS_DEFAULTS.queueFullPolicy
  const allowSoftOverflow = options.allowSoftOverflow === true
  const store = isPlainObject(options.store) ? options.store : null
  const onDrop = typeof options.onDrop === 'function' ? options.onDrop : null
  const onError = typeof options.onError === 'function' ? options.onError : null
  const onReject = typeof options.onReject === 'function' ? options.onReject : null

  /** 有界环形缓冲：{seq, event, storedAt}。 */
  const ring = []
  /** 幂等键 → {seq, storedAt}。 */
  const dedupe = new Map()
  /** 订阅：id → {id, parsed, handler}。 */
  const subscriptions = new Map()
  /** 待投递事件队列（append 顺序）。 */
  const dispatchQueue = []
  /** 正在执行/等待的 handler promise（flush 用）。 */
  const pendingHandlers = new Set()
  let nextSeq = 0
  let nextSubId = 0
  let drainScheduled = false
  let lastReject = null
  const metrics = {
    published: 0,
    duplicates: 0,
    rejected: 0,
    delivered: 0,
    deliveryErrors: 0,
    dropped: 0,
    evicted: 0,
    replayed: 0,
    storeErrors: 0,
    storeAppends: 0,
  }

  function safeCall(callback, payload) {
    if (callback === null) return
    try {
      callback(payload)
    } catch (error) {
      void error
    }
  }

  function recordReject(code, message, extra) {
    metrics.rejected += 1
    lastReject = { code, message, at: now(), ...(extra === undefined ? {} : extra) }
    safeCall(onReject, lastReject)
    return errorEntry(code, message, { ...(extra === undefined ? {} : extra), reject: lastReject })
  }

  /** 清理超过保留窗口的事件与幂等键（计数 evicted / dropped）。 */
  function pruneRetention() {
    const cutoff = now() - retentionMs
    while (ring.length > 0 && ring[0].storedAt < cutoff) {
      const removed = ring.shift()
      metrics.evicted += 1
      safeCall(onDrop, { reason: 'retention', seq: removed.seq, event: removed.event, at: removed.storedAt })
    }
    for (const [key, item] of dedupe) {
      if (item.storedAt >= cutoff) continue
      dedupe.delete(key)
    }
  }

  /** 背压检查：磁盘硬/软阈值 → 队列满。 */
  function evaluateBackpressure() {
    if (getDiskUsageBytes !== null) {
      let usage = 0
      try {
        usage = Number(getDiskUsageBytes())
        if (!Number.isFinite(usage) || usage < 0) usage = 0
      } catch (error) {
        void error
        usage = 0
      }
      if (usage >= diskHardLimitBytes) {
        return {
          ok: false,
          ...recordReject(EVENT_BUS_CODES.diskHardLimit, `事件存储磁盘达到硬阈值（${usage}/${diskHardLimitBytes} 字节），拒绝新事件`, {
            usageBytes: usage,
            limitBytes: diskHardLimitBytes,
          }),
        }
      }
      if (usage >= diskSoftLimitBytes && allowSoftOverflow !== true) {
        return {
          ok: false,
          ...recordReject(EVENT_BUS_CODES.diskSoftLimit, `事件存储磁盘达到软阈值（${usage}/${diskSoftLimitBytes} 字节），拒绝新事件（可用 allowSoftOverflow 放宽）`, {
            usageBytes: usage,
            limitBytes: diskSoftLimitBytes,
          }),
        }
      }
    }
    if (ring.length >= maxEvents) {
      if (queueFullPolicy === 'drop-oldest') {
        const removed = ring.shift()
        if (removed !== undefined) {
          metrics.dropped += 1
          safeCall(onDrop, { reason: 'queue-full', seq: removed.seq, event: removed.event, at: removed.storedAt })
        }
        return { ok: true, droppedOldest: true }
      }
      return {
        ok: false,
        ...recordReject(EVENT_BUS_CODES.queueFull, `事件队列已满（${ring.length}/${maxEvents}），拒绝新事件`, {
          queueDepth: ring.length,
          maxEvents,
        }),
      }
    }
    return { ok: true }
  }

  function persistToStore(event) {
    if (store === null || typeof store.append !== 'function') return
    metrics.storeAppends += 1
    try {
      const result = store.append(event)
      if (result !== null && result !== undefined && typeof result.then === 'function') {
        result.catch((error) => {
          metrics.storeErrors += 1
          safeCall(onError, { scope: 'store', message: error instanceof Error ? error.message : String(error) })
        })
      }
    } catch (error) {
      metrics.storeErrors += 1
      safeCall(onError, { scope: 'store', message: error instanceof Error ? error.message : String(error) })
    }
  }

  function scheduleDrain() {
    if (drainScheduled) return
    drainScheduled = true
    Promise.resolve().then(() => {
      drainScheduled = false
      drain()
    })
  }

  function drain() {
    while (dispatchQueue.length > 0) {
      const entry = dispatchQueue.shift()
      for (const id of entry.targets ?? []) {
        const subscription = subscriptions.get(id)
        if (subscription === undefined) continue
        metrics.delivered += 1
        try {
          const result = subscription.handler(entry.event, { seq: entry.seq })
          if (result !== null && result !== undefined && typeof result.then === 'function') {
            const tracked = Promise.resolve(result).catch((error) => {
              metrics.deliveryErrors += 1
              safeCall(onError, {
                scope: 'handler',
                subscriptionId: subscription.id,
                seq: entry.seq,
                message: error instanceof Error ? error.message : String(error),
              })
            })
            pendingHandlers.add(tracked)
            tracked.finally(() => pendingHandlers.delete(tracked))
          }
        } catch (error) {
          // 投递失败隔离：单个订阅抛错不影响其他订阅/后续事件。
          metrics.deliveryErrors += 1
          safeCall(onError, {
            scope: 'handler',
            subscriptionId: subscription.id,
            seq: entry.seq,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }

  /**
   * 发布事件：校验 → 幂等 → 背压 → 入队 → 异步投递。
   * @returns {{ok: true, seq: number, duplicate?: boolean, droppedOldest?: boolean} | {ok: false, code: string, message: string, errors?: Array}}
   */
  function append(event) {
    const validated = validateEventEnvelope(event)
    if (!validated.ok) {
      return {
        ...recordReject(EVENT_BUS_CODES.invalidEvent, '事件未通过 envelope 校验', { errors: validated.errors }),
        errors: validated.errors,
      }
    }
    pruneRetention()
    const envelope = validated.event
    const key = buildIdempotencyKey(envelope)
    const dedupeKey = key.length > 0 ? key : 'id:' + envelope.id
    const existing = dedupe.get(dedupeKey)
    if (existing !== undefined) {
      metrics.duplicates += 1
      return { ok: true, seq: existing.seq, duplicate: true, event: envelope }
    }
    const backpressure = evaluateBackpressure()
    if (backpressure.ok !== true) return backpressure

    nextSeq += 1
    const entry = { seq: nextSeq, event: envelope, storedAt: now() }
    ring.push(entry)
    dedupe.set(dedupeKey, { seq: entry.seq, storedAt: entry.storedAt })
    while (dedupe.size > maxDedupeKeys) {
      const oldestKey = dedupe.keys().next().value
      if (oldestKey === undefined) break
      dedupe.delete(oldestKey)
    }
    metrics.published += 1
    // 发布时固定 fanout 目标：之后新增的订阅不接收已发布事件（unsubscribe 后也不再投递）。
    entry.targets = [...subscriptions.entries()]
      .filter(([, subscription]) => matchesPattern(subscription.parsed, envelope.type))
      .map(([id]) => id)
    persistToStore(envelope)
    dispatchQueue.push(entry)
    scheduleDrain()
    return { ok: true, seq: entry.seq, duplicate: false, droppedOldest: backpressure.droppedOldest === true, event: envelope }
  }

  /**
   * 订阅：pattern 支持 `*`（全部）、`ns.*`（类型前缀）、精确 type。
   * handler(event, {seq})；同步抛错/异步 reject 都会被隔离计数。
   * @returns {() => void} unsubscribe
   */
  function subscribe(pattern, handler) {
    const parsed = parseSubscriptionPattern(pattern)
    if (!parsed.ok) throw new TypeError(parsed.message)
    if (typeof handler !== 'function') throw new TypeError('handler 必须是函数')
    nextSubId += 1
    const id = nextSubId
    subscriptions.set(id, { id, parsed, handler })
    return function unsubscribe() {
      subscriptions.delete(id)
    }
  }

  /** 等待当前投递队列与已产生的 handler promise 全部结束（测试/优雅退出用）。 */
  async function flush() {
    for (let guard = 0; guard < 10_000; guard += 1) {
      drain()
      if (dispatchQueue.length === 0 && pendingHandlers.size === 0) return
      await Promise.resolve()
      if (pendingHandlers.size > 0) await Promise.allSettled([...pendingHandlers])
    }
  }

  /**
   * 回放：按过滤条件从内存缓冲取事件（不重新投递；需要投递可传 handler）。
   * limit 超过 maxReplay → 显式拒绝（避免回放风暴）。
   */
  function replay(filter, handler) {
    pruneRetention()
    const parsed = normalizeReplayFilter(filter, maxReplay)
    if (!parsed.ok) return parsed
    const events = []
    for (const entry of ring) {
      if (!filterMatches(parsed, entry)) continue
      if (events.length >= parsed.limit) break
      events.push(entry.event)
    }
    metrics.replayed += events.length
    if (typeof handler === 'function') {
      for (const event of events) {
        try {
          const result = handler(event)
          if (result !== null && result !== undefined && typeof result.then === 'function') {
            Promise.resolve(result).catch((error) => {
              metrics.deliveryErrors += 1
              safeCall(onError, { scope: 'replay-handler', message: error instanceof Error ? error.message : String(error) })
            })
          }
        } catch (error) {
          metrics.deliveryErrors += 1
          safeCall(onError, { scope: 'replay-handler', message: error instanceof Error ? error.message : String(error) })
        }
      }
      return { ok: true, count: events.length }
    }
    return { ok: true, count: events.length, events }
  }

  /** 把事件显式写入持久化适配器（手工补偿/迁移用）。 */
  function appendToStore(event) {
    if (store === null || typeof store.append !== 'function') {
      return errorEntry(EVENT_BUS_CODES.noStore, '未配置持久化 store')
    }
    try {
      store.append(event)
      metrics.storeAppends += 1
      return { ok: true }
    } catch (error) {
      metrics.storeErrors += 1
      return errorEntry(EVENT_BUS_CODES.storeError, `写入 store 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 从持久化适配器读取（本任务只有内存实现；未配置返回 NO_STORE）。 */
  function readFromStore(filter) {
    if (store === null || typeof store.read !== 'function') {
      return errorEntry(EVENT_BUS_CODES.noStore, '未配置持久化 store')
    }
    try {
      const result = store.read(filter)
      if (isPlainObject(result) && Array.isArray(result.events)) return { ok: true, events: result.events }
      if (Array.isArray(result)) return { ok: true, events: result }
      return errorEntry(EVENT_BUS_CODES.storeError, 'store.read 返回格式非法')
    } catch (error) {
      metrics.storeErrors += 1
      return errorEntry(EVENT_BUS_CODES.storeError, `读取 store 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 观测快照（供 health/CLI；不含 payload 正文）。 */
  function snapshot() {
    pruneRetention()
    let disk = null
    if (getDiskUsageBytes !== null) {
      let usage = 0
      try {
        usage = Number(getDiskUsageBytes())
        if (!Number.isFinite(usage) || usage < 0) usage = 0
      } catch (error) {
        void error
      }
      disk = {
        usageBytes: usage,
        softLimitBytes: diskSoftLimitBytes,
        hardLimitBytes: diskHardLimitBytes,
        state: usage >= diskHardLimitBytes ? 'hard' : usage >= diskSoftLimitBytes ? 'soft' : 'ok',
      }
    }
    return {
      ok: true,
      version: EVENT_BUS_VERSION,
      now: now(),
      stored: ring.length,
      maxEvents,
      retentionMs,
      maxReplay,
      queueDepth: dispatchQueue.length,
      subscriptions: subscriptions.size,
      dedupeSize: dedupe.size,
      disk,
      queueFullPolicy,
      metrics: { ...metrics },
      lastReject: lastReject === null ? null : { ...lastReject },
    }
  }

  return {
    append,
    subscribe,
    flush,
    replay,
    appendToStore,
    readFromStore,
    snapshot,
  }
}
