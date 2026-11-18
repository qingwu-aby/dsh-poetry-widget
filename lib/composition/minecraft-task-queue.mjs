// @ts-check
// lib/composition/minecraft-task-queue.mjs —— Minecraft 任务队列（Gate J3，host 侧，纯逻辑）。
//
// 用途：Hub full 创建的 minecraft 任务不再由 host 直接执行 adapter，而是进入队列等待 bot 轮询：
//   bot claim（租约）→ 本地 executeWorld(tool,args) → token POST receipt → host 完成任务板 + feedback。
// 默认零副作用：队列只有被 task.create 显式入队时才有任务；不主动启动 bot/不轮询。
//
// 纯逻辑：时钟/容量/租约均可注入；不碰文件/网络/宿主。

/** 实现版本。 */
export const MINECRAFT_TASK_QUEUE_VERSION = 1

/** 队列状态。 */
export const MINECRAFT_TASK_STATUSES = Object.freeze(['queued', 'running', 'done', 'failed', 'cancelled'])

/** 错误码。 */
export const MINECRAFT_TASK_QUEUE_CODES = Object.freeze({
  invalid: 'MINECRAFT_QUEUE_INVALID',
  queueFull: 'MINECRAFT_QUEUE_FULL',
  notFound: 'MINECRAFT_TASK_NOT_FOUND',
  invalidState: 'MINECRAFT_TASK_INVALID_STATE',
  duplicate: 'MINECRAFT_TASK_DUPLICATE',
})

const DEFAULT_MAX_TASKS = 100
const DEFAULT_LEASE_MS = 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 3
const TERMINAL = Object.freeze(['done', 'failed', 'cancelled'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clean(value, max = 80) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function positiveInt(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

function errorResult(code, message) {
  return { ok: false, code, message }
}

/**
 * 创建 Minecraft 任务队列。
 * @param {{
 *   now?: () => number,
 *   maxTasks?: number,
 *   leaseMs?: number,
 *   maxAttempts?: number,
 *   onExpired?: ((task: object) => void)|null,
 * }} [options]
 */
export function createMinecraftTaskQueue(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const maxTasks = positiveInt(spec.maxTasks, DEFAULT_MAX_TASKS, 1000)
  const defaultLeaseMs = positiveInt(spec.leaseMs, DEFAULT_LEASE_MS, 30 * 60 * 1000)
  const maxAttempts = positiveInt(spec.maxAttempts, DEFAULT_MAX_ATTEMPTS, 10)
  const onExpired = typeof spec.onExpired === 'function' ? spec.onExpired : null
  const tasks = new Map()
  const metrics = { created: 0, claimed: 0, completed: 0, failed: 0, expired: 0, cancelled: 0, duplicates: 0 }

  function snapshotTask(record) {
    return {
      taskId: record.taskId,
      tool: record.tool,
      arguments: { ...record.arguments },
      priority: record.priority,
      status: record.status,
      attempts: record.attempts,
      owner: record.owner,
      leaseUntil: record.leaseUntil,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      receipt: record.receipt === null ? null : { ...record.receipt },
      error: record.error === null ? null : { ...record.error },
    }
  }

  function reclaimExpired() {
    const at = now()
    for (const record of tasks.values()) {
      if (record.status !== 'running' || record.leaseUntil > at) continue
      metrics.expired += 1
      record.owner = null
      record.leaseUntil = 0
      record.updatedAt = at
      if (record.attempts >= maxAttempts) {
        record.status = 'failed'
        record.error = { code: 'MINECRAFT_TASK_TIMEOUT', message: '租约过期且达到最大尝试次数' }
        metrics.failed += 1
        if (onExpired !== null) {
          try {
            onExpired(snapshotTask(record))
          } catch (error) {
            void error
          }
        }
      } else {
        record.status = 'queued'
      }
    }
  }

  function nextQueued() {
    return [...tasks.values()]
      .filter((record) => record.status === 'queued')
      .sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt)[0]
  }

  /** 入队（幂等：同 taskId 返回已有任务）。 */
  function create(input = {}) {
    const taskId = clean(input.taskId, 80)
    const tool = clean(input.tool, 40)
    if (taskId.length === 0 || tool.length === 0)
      return errorResult(MINECRAFT_TASK_QUEUE_CODES.invalid, '需要 taskId/tool')
    if (tasks.has(taskId)) {
      metrics.duplicates += 1
      return { ok: true, duplicate: true, task: snapshotTask(tasks.get(taskId)) }
    }
    if (tasks.size >= maxTasks) return errorResult(MINECRAFT_TASK_QUEUE_CODES.queueFull, '队列已满')
    const at = now()
    const record = {
      taskId,
      tool,
      arguments: isPlainObject(input.arguments) ? { ...input.arguments } : {},
      priority: Number.isFinite(Number(input.priority)) ? Math.trunc(Number(input.priority)) : 0,
      status: 'queued',
      attempts: 0,
      owner: null,
      leaseUntil: 0,
      createdAt: at,
      updatedAt: at,
      receipt: null,
      error: null,
    }
    tasks.set(taskId, record)
    metrics.created += 1
    return { ok: true, duplicate: false, task: snapshotTask(record) }
  }

  /** 认领下一个任务（租约）；无任务返回 {ok:true, task:null}。 */
  function claim(input = {}) {
    reclaimExpired()
    const record = nextQueued()
    if (record === undefined) return { ok: true, task: null }
    const at = now()
    const leaseMs = positiveInt(input.leaseMs, defaultLeaseMs, 30 * 60 * 1000)
    record.status = 'running'
    record.owner = clean(input.owner, 80) || 'bot'
    record.leaseUntil = at + leaseMs
    record.attempts += 1
    record.updatedAt = at
    metrics.claimed += 1
    return { ok: true, task: snapshotTask(record) }
  }

  function finish(taskId, status, payload) {
    const record = tasks.get(clean(taskId, 80))
    if (record === undefined) return errorResult(MINECRAFT_TASK_QUEUE_CODES.notFound, '任务不存在')
    if (record.status === 'done' || record.status === 'failed' || record.status === 'cancelled') {
      return { ok: true, already: true, task: snapshotTask(record) }
    }
    const at = now()
    record.status = status
    record.updatedAt = at
    if (status === 'done') {
      record.receipt = isPlainObject(payload)
        ? {
            ok: payload.ok !== false,
            detail: clean(payload.detail, 200),
            facts: isPlainObject(payload.facts) ? { ...payload.facts } : {},
            at,
          }
        : { ok: false, at }
      metrics.completed += 1
    } else if (status === 'failed') {
      record.error = {
        code: 'MINECRAFT_TASK_FAILED',
        message: clean(payload && payload.message, 200) || '执行失败',
        at,
      }
      metrics.failed += 1
    } else {
      metrics.cancelled += 1
    }
    return { ok: true, already: false, task: snapshotTask(record) }
  }

  function complete(taskId, receipt = {}) {
    return finish(taskId, 'done', receipt)
  }

  function fail(taskId, error = {}) {
    return finish(taskId, 'failed', error)
  }

  function cancel(taskId) {
    return finish(taskId, 'cancelled', {})
  }

  function get(taskId) {
    const record = tasks.get(clean(taskId, 80))
    return record === undefined ? null : snapshotTask(record)
  }

  function list(filter = {}) {
    const status = typeof filter.status === 'string' ? filter.status : ''
    return [...tasks.values()]
      .filter((record) => (status.length === 0 ? true : record.status === status))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 100)
      .map(snapshotTask)
  }

  function snapshot() {
    const counts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }
    for (const record of tasks.values()) counts[record.status] += 1
    return {
      ok: true,
      version: MINECRAFT_TASK_QUEUE_VERSION,
      now: now(),
      total: tasks.size,
      counts,
      maxTasks,
      leaseMs: defaultLeaseMs,
      maxAttempts,
      metrics: { ...metrics },
      tasks: list({}),
    }
  }

  return { create, claim, complete, fail, cancel, get, list, reclaimExpired, snapshot, maxTasks }
}
