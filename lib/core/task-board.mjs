// lib/core/task-board.mjs —— Hub 统一任务板（Gate B2，组合 task-supervisor + 持久化适配）。
//
// 目标：在 Task 监管器（Gate A2）之上提供“可持久重建、幂等、可查询”的任务板：
//   · create/claim/renew/complete/fail/cancel/waiting/resume/blocked 生命周期；
//   · 幂等键：同 key 不重复执行；崩溃重建后仍按 key 去重（不会重复跑同一任务）；
//   · 持久化适配：store = {load(), save(snapshot)}，默认内存实现（createMemoryTaskStore）；
//     每次状态变化异步落盘（失败只计数不阻塞），可 flush()/save() 强制；
//   · 任务索引：id/status/activity/priority/owner，list/filter/next/counts；
//   · 容量上限（maxTasks）与优先级排序（不实现调度器，调度由 Gate B3 Scheduler 负责）；
//   · 事件只通过 onEvent 回调输出（task.created/...），由 Event Bus 接线，不直接依赖 Event Bus。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟、存储、事件回调均可注入。

import { createTaskSupervisor } from './task-supervisor.mjs'

/** 任务板快照格式版本。 */
export const TASK_BOARD_VERSION = 1

/** 任务板错误码（监管器错误码原样透传）。 */
export const TASK_BOARD_CODES = Object.freeze({
  capacity: 'TASK_BOARD_CAPACITY',
  notFound: 'TASK_BOARD_NOT_FOUND',
  invalidArgument: 'TASK_BOARD_INVALID_ARGUMENT',
  storeError: 'TASK_BOARD_STORE_ERROR',
  restoreFailed: 'TASK_BOARD_RESTORE_FAILED',
})

/** 事件类型（onEvent 回调的 type 字段）。 */
export const TASK_BOARD_EVENTS = Object.freeze([
  'task.created',
  'task.started',
  'task.claimed',
  'task.renewed',
  'task.waiting',
  'task.resumed',
  'task.blocked',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'task.duplicate',
  'task.rejected',
  'task.restored',
])

/** 默认配置。 */
export const TASK_BOARD_DEFAULTS = Object.freeze({
  maxTasks: 1000,
  maxRunning: 4,
  leaseMs: 30 * 1000,
  loadOnCreate: true,
  maxRecentEvents: 50,
})

const TERMINAL_STATUSES = Object.freeze(['done', 'failed', 'cancelled'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function isTerminal(status) {
  return TERMINAL_STATUSES.indexOf(status) >= 0
}

function cloneTask(task) {
  if (!isPlainObject(task)) return null
  return {
    ...task,
    payload: task.payload === null || task.payload === undefined ? null : JSON.parse(JSON.stringify(task.payload)),
    result: task.result === null || task.result === undefined ? null : JSON.parse(JSON.stringify(task.result)),
    error: task.error === null || task.error === undefined ? null : { ...task.error },
  }
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

/**
 * 内存持久化适配器（默认实现；不写盘、不写 live 数据）。
 * store = {load(), save(snapshot), snapshot()}
 * @param {{initial?: object|null, now?: () => number}} [options]
 */
export function createMemoryTaskStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let stored = isPlainObject(options.initial) ? JSON.parse(JSON.stringify(options.initial)) : null
  let saves = 0
  return {
    load() {
      return stored === null ? null : JSON.parse(JSON.stringify(stored))
    },
    save(snapshot) {
      stored = JSON.parse(JSON.stringify(snapshot))
      saves += 1
      return { ok: true, savedAt: now() }
    },
    snapshot() {
      return { ok: true, stored: stored !== null, tasks: stored !== null && Array.isArray(stored.tasks) ? stored.tasks.length : 0, saves }
    },
  }
}

/**
 * 创建任务板。
 * @param {{
 *   now?: () => number,
 *   maxTasks?: number,
 *   maxRunning?: number,
 *   leaseMs?: number,
 *   supervisor?: object,
 *   store?: {load?: Function, save?: Function}|null,
 *   onEvent?: (event: object) => void,
 *   onError?: (info: object) => void,
 *   loadOnCreate?: boolean,
 *   maxRecentEvents?: number,
 * }} [options]
 */
export function createTaskBoard(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxTasks = readPositiveInt(options.maxTasks, TASK_BOARD_DEFAULTS.maxTasks)
  const maxRunning = readPositiveInt(options.maxRunning, TASK_BOARD_DEFAULTS.maxRunning)
  const leaseMs = readPositiveInt(options.leaseMs, TASK_BOARD_DEFAULTS.leaseMs)
  const maxRecentEvents = readPositiveInt(options.maxRecentEvents, TASK_BOARD_DEFAULTS.maxRecentEvents)
  const supervisor =
    isPlainObject(options.supervisor) && typeof options.supervisor.submit === 'function'
      ? options.supervisor
      : createTaskSupervisor({ now, leaseMs, maxRunning })
  const store = isPlainObject(options.store) ? options.store : createMemoryTaskStore({ now })
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const onError = typeof options.onError === 'function' ? options.onError : null
  const loadOnCreate = options.loadOnCreate !== false

  const records = new Map()
  const keyIndex = new Map()
  const pendingSaves = new Set()
  const recentEvents = []
  let nextBoardId = 0
  let eventSeq = 0
  let lastSavedAt = 0
  let lastReject = null
  const metrics = {
    created: 0,
    duplicates: 0,
    rejected: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    restored: 0,
    saves: 0,
    saveErrors: 0,
    storeLoads: 0,
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

  function recordSnapshot(record) {
    if (record === null) return null
    return cloneTask(record)
  }

  function emit(type, record, detail) {
    eventSeq += 1
    metrics.events += 1
    const event = {
      type,
      seq: eventSeq,
      at: now(),
      task: recordSnapshot(record),
      ...(detail === undefined ? {} : { detail }),
    }
    recentEvents.push(event)
    if (recentEvents.length > maxRecentEvents) recentEvents.shift()
    safeCall(onEvent, event)
    return event
  }

  function recordReject(code, message, extra) {
    metrics.rejected += 1
    lastReject = { code, message, at: now(), ...(extra === undefined ? {} : extra) }
    emit('task.rejected', null, { code, message })
    return errorResult(code, message, { ...(extra === undefined ? {} : extra), reject: lastReject })
  }

  function boardSnapshotState() {
    return {
      ok: true,
      v: TASK_BOARD_VERSION,
      savedAt: now(),
      tasks: [...records.values()].map((record) => cloneTask(record)),
    }
  }

  function persist() {
    if (store === null || typeof store.save !== 'function') return
    const snapshot = boardSnapshotState()
    try {
      const result = store.save(snapshot)
      lastSavedAt = now()
      metrics.saves += 1
      if (result !== null && result !== undefined && typeof result.then === 'function') {
        const tracked = Promise.resolve(result).catch((error) => {
          metrics.saveErrors += 1
          safeCall(onError, { scope: 'store', message: error instanceof Error ? error.message : String(error) })
        })
        pendingSaves.add(tracked)
        tracked.finally(() => pendingSaves.delete(tracked))
      }
    } catch (error) {
      metrics.saveErrors += 1
      safeCall(onError, { scope: 'store', message: error instanceof Error ? error.message : String(error) })
    }
  }

  function liveSupervisorTask(record) {
    if (record.supervisorId === null) return null
    return supervisor.get(record.supervisorId)
  }

  /** 把监管器里的最新状态同步回任务板记录。 */
  function syncRecord(record) {
    const live = liveSupervisorTask(record)
    if (live === null) return record
    record.status = live.state
    record.owner = live.owner ?? record.owner
    record.attempts = live.attempts
    record.startedAt = live.startedAt ?? record.startedAt
    record.finishedAt = live.finishedAt ?? record.finishedAt
    record.leaseExpiresAt = live.leaseExpiresAt ?? null
    if (live.result !== null && live.result !== undefined) record.result = live.result
    if (live.error !== null && live.error !== undefined) record.error = { ...live.error }
    record.updatedAt = live.updatedAt ?? record.updatedAt
    return record
  }

  function getRecord(id) {
    const record = records.get(String(id ?? ''))
    if (record === undefined) return null
    syncRecord(record)
    return record
  }

  function activeCount() {
    let count = 0
    for (const record of records.values()) {
      syncRecord(record)
      if (!isTerminal(record.status)) count += 1
    }
    return count
  }

  function mapSupervisorError(result, record) {
    if (record !== undefined) syncRecord(record)
    return {
      ok: false,
      code: typeof result.code === 'string' ? result.code : TASK_BOARD_CODES.storeError,
      message: typeof result.message === 'string' ? result.message : '任务状态迁移失败',
      task: record === undefined ? null : recordSnapshot(record),
    }
  }

  /**
   * 创建任务（幂等）：同 key 已有任务 → duplicate；key 对应终态任务时可用 retry:true 重开一次。
   * @param {{activity: string, kind?: string, priority?: number, key?: string, owner?: string, title?: string, payload?: object, retry?: boolean}} input
   */
  function create(input) {
    const spec = isPlainObject(input) ? input : {}
    const activity = typeof spec.activity === 'string' ? spec.activity.trim() : ''
    if (activity.length === 0 || activity.length > 40) {
      return recordReject(TASK_BOARD_CODES.invalidArgument, 'activity 必须是 1–40 字字符串')
    }
    const key = typeof spec.key === 'string' && spec.key.trim().length > 0 ? spec.key.trim() : ''
    if (key.length > 128) return recordReject(TASK_BOARD_CODES.invalidArgument, 'key 过长（>128）')
    if (key.length > 0) {
      const existingId = keyIndex.get(key)
      const existing = existingId === undefined ? null : records.get(existingId)
      if (existing !== undefined && existing !== null) {
        syncRecord(existing)
        if (!(spec.retry === true && isTerminal(existing.status))) {
          metrics.duplicates += 1
          emit('task.duplicate', existing, { key })
          return { ok: true, duplicate: true, terminal: isTerminal(existing.status), task: recordSnapshot(existing) }
        }
      }
    }
    if (activeCount() >= maxTasks) {
      return recordReject(TASK_BOARD_CODES.capacity, `任务板已满（${maxTasks}），拒绝新任务`, { maxTasks })
    }
    const submitted = supervisor.submit({
      key: key.length > 0 ? key : undefined,
      kind: activity,
      owner: typeof spec.owner === 'string' && spec.owner.length > 0 ? spec.owner : undefined,
      priority: Number.isFinite(Number(spec.priority)) ? Number(spec.priority) : 0,
      retry: spec.retry === true,
      meta: { board: true },
    })
    if (submitted.ok !== true) return mapSupervisorError(submitted)
    nextBoardId += 1
    const live = submitted.task
    const record = {
      id: 'tb-' + nextBoardId,
      key: key.length > 0 ? key : null,
      activity,
      kind: typeof spec.kind === 'string' && spec.kind.length > 0 ? spec.kind : activity,
      priority: Number.isFinite(Number(spec.priority)) ? Math.trunc(Number(spec.priority)) : 0,
      title: typeof spec.title === 'string' ? spec.title.slice(0, 120) : '',
      payload: isPlainObject(spec.payload) ? JSON.parse(JSON.stringify(spec.payload)) : null,
      status: live.state,
      owner: live.owner ?? null,
      attempts: live.attempts,
      supervisorId: live.id,
      createdAt: live.createdAt ?? now(),
      updatedAt: live.updatedAt ?? now(),
      startedAt: live.startedAt ?? null,
      finishedAt: null,
      leaseExpiresAt: live.leaseExpiresAt ?? null,
      result: null,
      error: null,
    }
    records.set(record.id, record)
    if (record.key !== null) keyIndex.set(record.key, record.id)
    metrics.created += 1
    emit('task.created', record, { started: record.status === 'running' })
    if (record.status === 'running') emit('task.started', record)
    persist()
    return { ok: true, duplicate: false, terminal: false, task: recordSnapshot(record) }
  }

  /** 认领 queued 任务（指定 owner）；监管器容量不足时保持 queued。 */
  function claim(id, owner) {
    const record = getRecord(id)
    if (record === null) return errorResult(TASK_BOARD_CODES.notFound, `任务不存在：${String(id)}`)
    const result = supervisor.start(record.supervisorId, { owner })
    if (result.ok !== true) return mapSupervisorError(result, record)
    syncRecord(record)
    if (result.queued === true) return { ok: true, queued: true, task: recordSnapshot(record) }
    emit('task.claimed', record, { owner: record.owner })
    persist()
    return { ok: true, queued: false, task: recordSnapshot(record) }
  }

  /** 认领优先级最高的 queued 任务（调度器 Gate B3 会用；本身不实现调度循环）。 */
  function claimNext(owner) {
    const candidate = next()
    if (candidate === null) return { ok: true, task: null }
    return claim(candidate.id, owner)
  }

  /** 心跳续租。 */
  function renew(id, opts) {
    const record = getRecord(id)
    if (record === null) return errorResult(TASK_BOARD_CODES.notFound, `任务不存在：${String(id)}`)
    const result = supervisor.renew(record.supervisorId, opts)
    if (result.ok !== true) return mapSupervisorError(result, record)
    syncRecord(record)
    emit('task.renewed', record, { leaseExpiresAt: record.leaseExpiresAt })
    persist()
    return { ok: true, task: recordSnapshot(record) }
  }

  function transitionAndEmit(id, eventType, apply) {
    const record = getRecord(id)
    if (record === null) return errorResult(TASK_BOARD_CODES.notFound, `任务不存在：${String(id)}`)
    const result = apply(record)
    if (result.ok !== true) return mapSupervisorError(result, record)
    syncRecord(record)
    if (result.already === true) return { ok: true, already: true, task: recordSnapshot(record) }
    emit(eventType, record)
    if (eventType === 'task.completed') metrics.completed += 1
    if (eventType === 'task.failed') metrics.failed += 1
    if (eventType === 'task.cancelled') metrics.cancelled += 1
    persist()
    return { ok: true, task: recordSnapshot(record) }
  }

  function waiting(id) {
    return transitionAndEmit(id, 'task.waiting', (record) => supervisor.wait(record.supervisorId))
  }

  function resume(id) {
    return transitionAndEmit(id, 'task.resumed', (record) => supervisor.resume(record.supervisorId))
  }

  function blocked(id) {
    return transitionAndEmit(id, 'task.blocked', (record) => supervisor.block(record.supervisorId))
  }

  function complete(id, result) {
    return transitionAndEmit(id, 'task.completed', (record) => supervisor.complete(record.supervisorId, result))
  }

  function fail(id, error) {
    return transitionAndEmit(id, 'task.failed', (record) => supervisor.fail(record.supervisorId, error))
  }

  function cancel(id, opts) {
    return transitionAndEmit(id, 'task.cancelled', (record) => supervisor.cancel(record.supervisorId, opts))
  }

  function get(id) {
    const record = getRecord(id)
    return record === null ? null : recordSnapshot(record)
  }

  function list(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const statusFilter = Array.isArray(spec.status)
      ? spec.status
      : typeof spec.status === 'string' && spec.status.length > 0
        ? [spec.status]
        : null
    const activity = typeof spec.activity === 'string' && spec.activity.length > 0 ? spec.activity : null
    const owner = typeof spec.owner === 'string' && spec.owner.length > 0 ? spec.owner : null
    const sort = spec.sort === 'created' || spec.sort === 'updated' ? spec.sort : 'priority'
    const limit = readPositiveInt(spec.limit, records.size)
    const out = []
    for (const record of records.values()) {
      syncRecord(record)
      if (statusFilter !== null && statusFilter.indexOf(record.status) < 0) continue
      if (activity !== null && record.activity !== activity) continue
      if (owner !== null && record.owner !== owner) continue
      out.push(record)
    }
    if (sort === 'created') out.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    else if (sort === 'updated') out.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    else out.sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    return out.slice(0, limit).map((record) => recordSnapshot(record))
  }

  /** 下一个应执行的任务（优先级最高的 queued；只读，不认领）。 */
  function next() {
    let best = null
    for (const record of records.values()) {
      syncRecord(record)
      if (record.status !== 'queued') continue
      if (best === null || record.priority > best.priority || (record.priority === best.priority && record.createdAt < best.createdAt)) {
        best = record
      }
    }
    return best === null ? null : recordSnapshot(best)
  }

  function counts() {
    const byStatus = { queued: 0, running: 0, waiting: 0, blocked: 0, done: 0, failed: 0, cancelled: 0 }
    const byActivity = {}
    const byOwner = {}
    for (const record of records.values()) {
      syncRecord(record)
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1
      byActivity[record.activity] = (byActivity[record.activity] ?? 0) + 1
      if (record.owner !== null) byOwner[record.owner] = (byOwner[record.owner] ?? 0) + 1
    }
    const active = records.size - byStatus.done - byStatus.failed - byStatus.cancelled
    return { total: records.size, active, byStatus, byActivity, byOwner }
  }

  /**
   * 从持久化快照重建任务板（崩溃恢复）：终态任务只恢复索引；非终态任务重新挂到监管器，
   * 并按 key 重建幂等索引，保证重启后同 key 不会重复执行。
   * @param {object} [snapshot] 不传则从 store.load() 读取
   */
  function restore(snapshot) {
    let source = snapshot
    if (source === undefined || source === null) {
      if (store === null || typeof store.load !== 'function') return { ok: true, restored: 0, byStatus: {} }
      metrics.storeLoads += 1
      try {
        source = store.load()
      } catch (error) {
        metrics.saveErrors += 1
        safeCall(onError, { scope: 'store', message: error instanceof Error ? error.message : String(error) })
        return errorResult(TASK_BOARD_CODES.storeError, '读取 store 失败')
      }
    }
    if (source === null || source === undefined) {
      emit('task.restored', null, { restored: 0, byStatus: {} })
      return { ok: true, restored: 0, byStatus: {} }
    }
    if (!isPlainObject(source) || !Array.isArray(source.tasks)) {
      return errorResult(TASK_BOARD_CODES.restoreFailed, '快照格式非法（缺少 tasks 数组）')
    }
    records.clear()
    keyIndex.clear()
    const byStatus = {}
    let restored = 0
    let maxId = 0
    for (const raw of source.tasks) {
      if (!isPlainObject(raw) || typeof raw.id !== 'string' || raw.id.length === 0) continue
      const status = typeof raw.status === 'string' ? raw.status : 'queued'
      const record = {
        id: raw.id,
        key: typeof raw.key === 'string' && raw.key.length > 0 ? raw.key : null,
        activity: typeof raw.activity === 'string' && raw.activity.length > 0 ? raw.activity : 'unknown',
        kind: typeof raw.kind === 'string' ? raw.kind : '',
        priority: Number.isFinite(Number(raw.priority)) ? Math.trunc(Number(raw.priority)) : 0,
        title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : '',
        payload: isPlainObject(raw.payload) ? raw.payload : null,
        status,
        owner: typeof raw.owner === 'string' ? raw.owner : null,
        attempts: Number.isFinite(Number(raw.attempts)) ? Math.max(0, Math.floor(Number(raw.attempts))) : 0,
        supervisorId: null,
        createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : now(),
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now(),
        startedAt:
          raw.startedAt === null || raw.startedAt === undefined || !Number.isFinite(Number(raw.startedAt))
            ? null
            : Number(raw.startedAt),
        finishedAt:
          raw.finishedAt === null || raw.finishedAt === undefined || !Number.isFinite(Number(raw.finishedAt))
            ? null
            : Number(raw.finishedAt),
        leaseExpiresAt: null,
        result: raw.result === undefined ? null : raw.result,
        error: isPlainObject(raw.error) ? { ...raw.error } : null,
      }
      if (isTerminal(status)) {
        records.set(record.id, record)
        if (record.key !== null) keyIndex.set(record.key, record.id)
        byStatus[status] = (byStatus[status] ?? 0) + 1
        restored += 1
        maxId = Math.max(maxId, parseBoardId(record.id))
        continue
      }
      const submitted = supervisor.submit({
        key: record.key !== null ? record.key : undefined,
        kind: record.activity,
        owner: record.owner ?? undefined,
        priority: record.priority,
        meta: { board: true, restored: true },
      })
      if (submitted.ok !== true) continue
      record.supervisorId = submitted.task.id
      if (status === 'waiting') supervisor.wait(record.supervisorId)
      else if (status === 'blocked') supervisor.block(record.supervisorId)
      syncRecord(record)
      records.set(record.id, record)
      if (record.key !== null) keyIndex.set(record.key, record.id)
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1
      restored += 1
      maxId = Math.max(maxId, parseBoardId(record.id))
    }
    nextBoardId = Math.max(nextBoardId, maxId)
    metrics.restored += restored
    emit('task.restored', null, { restored, byStatus })
    return { ok: true, restored, byStatus }
  }

  function parseBoardId(id) {
    const matched = /^tb-(\d+)$/.exec(id)
    return matched === null ? 0 : Number(matched[1])
  }

  function save() {
    persist()
    return { ok: true, savedAt: lastSavedAt }
  }

  async function flush() {
    while (pendingSaves.size > 0) await Promise.allSettled([...pendingSaves])
  }

  function snapshot() {
    const counted = counts()
    return {
      ok: true,
      v: TASK_BOARD_VERSION,
      now: now(),
      total: counted.total,
      active: counted.active,
      maxTasks,
      maxRunning,
      byStatus: counted.byStatus,
      byActivity: counted.byActivity,
      byOwner: counted.byOwner,
      supervisor: supervisor.snapshot(),
      store: {
        saves: metrics.saves,
        saveErrors: metrics.saveErrors,
        loads: metrics.storeLoads,
        lastSavedAt,
      },
      metrics: { ...metrics },
      lastReject: lastReject === null ? null : { ...lastReject },
      recentEvents: recentEvents.slice(-10),
    }
  }

  if (loadOnCreate) {
    try {
      restore()
    } catch (error) {
      safeCall(onError, { scope: 'restore', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    create,
    claim,
    claimNext,
    renew,
    waiting,
    resume,
    blocked,
    complete,
    fail,
    cancel,
    get,
    list,
    next,
    counts,
    restore,
    save,
    flush,
    snapshot,
    supervisor,
  }
}
