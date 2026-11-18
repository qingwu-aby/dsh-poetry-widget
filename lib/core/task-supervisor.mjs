// lib/core/task-supervisor.mjs —— 长任务监管骨架（Gate A2，纯逻辑、无宿主依赖）。
//
// 目标：多活动并发之前，先有统一的“长任务”生命周期，避免 running 卡死、重启后重复副作用。
//   · 状态机：queued → running ⇄ waiting / blocked → done | failed | cancelled；
//   · 租约：running/waiting 持有 owner + expiresAt，心跳 renew 续租；过期由 tick()/sweep() 自动 failed；
//   · 幂等：submit 带 key 时同 key 不会并发执行（返回已有任务，duplicate:true）；
//   · 并发：maxRunning 限制在飞任务（running/waiting），其余 queued，完成一个补一个；
//   · 取消：cancel() 立即终态，并向 signalFor(id) 的订阅者发取消信号；
//   · 事件：只通过 onEvent 回调输出（不写盘、不依赖宿主），由调用方决定落盘/上报。
//
// 接入方式（后续 Sprint）：Hub 每个 Activity 动作 submit 一个任务；宿主心跳周期性调用
// tick() 清理过期租约；进程重启后由调用方把持久化的任务以 resumeFrom() 语义重建（本模块不读盘）。

/** 全部状态。 */
export const TASK_STATES = Object.freeze(['queued', 'running', 'waiting', 'blocked', 'done', 'failed', 'cancelled'])

/** 终态（不可再迁移）。 */
export const TASK_TERMINAL_STATES = Object.freeze(['done', 'failed', 'cancelled'])

/** 占用 maxRunning 槽位的状态：running 正在执行，waiting 仍在飞（等外部事件，持有租约）。 */
export const TASK_SLOT_STATES = Object.freeze(['running', 'waiting'])

/** 合法状态迁移表（未列出的迁移一律拒绝）。 */
export const TASK_ALLOWED_TRANSITIONS = Object.freeze({
  queued: Object.freeze(['running', 'cancelled', 'failed']),
  running: Object.freeze(['waiting', 'blocked', 'done', 'failed', 'cancelled']),
  waiting: Object.freeze(['running', 'blocked', 'done', 'failed', 'cancelled']),
  blocked: Object.freeze(['running', 'waiting', 'done', 'failed', 'cancelled']),
  done: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
})

/** 可识别错误码（调用方据此决定重试/告警，不靠字符串匹配）。 */
export const TASK_ERROR_CODES = Object.freeze({
  invalidTransition: 'TASK_INVALID_TRANSITION',
  notFound: 'TASK_NOT_FOUND',
  terminal: 'TASK_TERMINAL',
  ownerMismatch: 'TASK_LEASE_OWNER_MISMATCH',
  noCapacity: 'TASK_NO_CAPACITY',
  invalidArgument: 'TASK_INVALID_ARGUMENT',
  duplicateKey: 'TASK_DUPLICATE_KEY',
  leaseExpired: 'TASK_LEASE_EXPIRED',
})

/** 默认值。 */
export const TASK_SUPERVISOR_DEFAULTS = Object.freeze({
  leaseMs: 30 * 1000,
  maxRunning: 4,
  maxKeys: 2000,
})

export function isTaskTerminal(state) {
  return TASK_TERMINAL_STATES.indexOf(state) >= 0
}

export function canTransition(from, to) {
  const allowed = TASK_ALLOWED_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.indexOf(to) >= 0
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function cloneTask(task) {
  if (!task) return null
  return {
    ...task,
    meta: task.meta === null ? null : { ...task.meta },
    result: task.result,
    error: task.error === null ? null : { ...task.error },
  }
}

/**
 * 创建任务监管器。
 * @param {{
 *   now?: () => number,
 *   leaseMs?: number,
 *   maxRunning?: number,
 *   maxKeys?: number,
 *   onEvent?: (event: {type: string, at: number, task: object, detail?: object}) => void,
 * }} [options]
 */
export function createTaskSupervisor(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const leaseMs = readPositiveInt(options.leaseMs, TASK_SUPERVISOR_DEFAULTS.leaseMs)
  const maxRunning = readPositiveInt(options.maxRunning, TASK_SUPERVISOR_DEFAULTS.maxRunning)
  const maxKeys = readPositiveInt(options.maxKeys, TASK_SUPERVISOR_DEFAULTS.maxKeys)
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const tasks = new Map()
  const keyIndex = new Map()
  const cancelListeners = new Map()
  let seq = 0

  function emit(type, task, detail) {
    if (onEvent === null) return
    try {
      onEvent({
        type,
        at: now(),
        task: cloneTask(task),
        ...(detail === undefined ? {} : { detail }),
      })
    } catch (error) {
      /* 观测回调失败不影响监管逻辑（调用方自己兜底日志） */
      void error
    }
  }

  function countSlots() {
    let count = 0
    for (const task of tasks.values()) {
      if (TASK_SLOT_STATES.indexOf(task.state) >= 0) count += 1
    }
    return count
  }

  function errorResult(code, message, extra) {
    return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
  }

  function fireCancel(task, reason) {
    const listeners = cancelListeners.get(task.id)
    if (listeners === undefined) return
    cancelListeners.delete(task.id)
    for (const listener of listeners) {
      try {
        listener({ id: task.id, reason })
      } catch (error) {
        void error
      }
    }
  }

  function startTask(task, owner) {
    task.state = 'running'
    task.owner = typeof owner === 'string' && owner.length > 0 ? owner : task.owner ?? 'supervisor'
    task.startedAt = task.startedAt === null ? now() : task.startedAt
    task.updatedAt = now()
    task.attempts += 1
    task.leaseExpiresAt = now() + leaseMs
    emit(task.attempts > 1 ? 'task/resumed' : 'task/started', task)
  }

  /** 有空槽时按 FIFO 把 queued 任务提为 running。 */
  function pump() {
    let slots = countSlots()
    for (const task of tasks.values()) {
      if (slots >= maxRunning) return
      if (task.state !== 'queued') continue
      startTask(task, task.owner)
      slots += 1
    }
  }

  function pruneKeys() {
    if (keyIndex.size <= maxKeys) return
    for (const [key, id] of keyIndex) {
      const task = tasks.get(id)
      if (task !== undefined && isTaskTerminal(task.state)) keyIndex.delete(key)
      if (keyIndex.size <= maxKeys) return
    }
  }

  /**
   * 提交任务。带 key 时幂等：同 key 已有任务（含终态）→ 返回已有任务且 duplicate:true；
   * 终态任务 + retry:true → 以同 key 新建一次重试（attempts 延续）。
   */
  function submit(input) {
    const spec = isPlainObject(input) ? input : {}
    const key = typeof spec.key === 'string' && spec.key.length > 0 ? spec.key : ''
    let attempts = 0
    if (key.length > 0) {
      const existingId = keyIndex.get(key)
      const existing = existingId === undefined ? null : tasks.get(existingId)
      if (existing !== undefined && existing !== null) {
        if (!(spec.retry === true && isTaskTerminal(existing.state))) {
          emit('task/duplicate', existing, { key })
          return {
            ok: true,
            duplicate: true,
            terminal: isTaskTerminal(existing.state),
            task: cloneTask(existing),
          }
        }
        attempts = existing.attempts
      }
    }
    seq += 1
    const task = {
      id: 'task-' + seq,
      key: key.length > 0 ? key : null,
      kind: typeof spec.kind === 'string' ? spec.kind : '',
      state: 'queued',
      owner: typeof spec.owner === 'string' && spec.owner.length > 0 ? spec.owner : null,
      priority: Number.isFinite(Number(spec.priority)) ? Number(spec.priority) : 0,
      attempts,
      createdAt: now(),
      updatedAt: now(),
      startedAt: null,
      finishedAt: null,
      leaseExpiresAt: null,
      result: null,
      error: null,
      meta: isPlainObject(spec.meta) ? { ...spec.meta } : null,
    }
    tasks.set(task.id, task)
    if (key.length > 0) {
      keyIndex.set(key, task.id)
      pruneKeys()
    }
    emit('task/queued', task)
    pump()
    return { ok: true, duplicate: false, terminal: false, task: cloneTask(task) }
  }

  function applyTransition(task, to, patch) {
    const from = task.state
    task.state = to
    task.updatedAt = now()
    if (isPlainObject(patch)) {
      if (Object.hasOwn(patch, 'owner') && typeof patch.owner === 'string' && patch.owner.length > 0) task.owner = patch.owner
      if (Object.hasOwn(patch, 'result')) task.result = patch.result
      if (Object.hasOwn(patch, 'error')) task.error = isPlainObject(patch.error) ? { ...patch.error } : null
      if (Object.hasOwn(patch, 'meta') && isPlainObject(patch.meta)) task.meta = { ...task.meta, ...patch.meta }
    }
    if (to === 'running') {
      task.leaseExpiresAt = now() + leaseMs
      task.startedAt = task.startedAt === null ? now() : task.startedAt
    } else if (to === 'waiting') {
      task.leaseExpiresAt = now() + leaseMs
    } else if (to === 'blocked') {
      task.leaseExpiresAt = null
    } else if (isTaskTerminal(to)) {
      task.finishedAt = now()
      task.leaseExpiresAt = null
    }
    const eventType = {
      running: from === 'queued' ? 'task/started' : 'task/resumed',
      waiting: 'task/waiting',
      blocked: 'task/blocked',
      done: 'task/done',
      failed: 'task/failed',
      cancelled: 'task/cancelled',
    }[to]
    emit(eventType ?? 'task/updated', task, { from, to })
    if (to === 'cancelled') {
      fireCancel(task, task.error !== null && typeof task.error.message === 'string' ? task.error.message : 'cancelled')
    }
    // 结束或释放槽位（blocked）后立刻补位，避免队列被“已经让出槽位”的任务堵住。
    const releasedSlot = TASK_SLOT_STATES.indexOf(from) >= 0 && TASK_SLOT_STATES.indexOf(to) < 0
    if (isTaskTerminal(to) || releasedSlot) pump()
    return { ok: true, task: cloneTask(task), from, to }
  }

  /** 通用迁移：校验状态机；非法迁移返回 TASK_INVALID_TRANSITION 并上报事件。 */
  function transition(id, to, patch) {
    const task = tasks.get(id)
    if (task === undefined) return errorResult(TASK_ERROR_CODES.notFound, `任务不存在：${String(id)}`, { id })
    if (TASK_STATES.indexOf(to) < 0) {
      emit('task/transition-rejected', task, { from: task.state, to, reason: 'unknown-state' })
      return errorResult(TASK_ERROR_CODES.invalidArgument, `未知状态：${String(to)}`, { id, from: task.state, to })
    }
    if (!canTransition(task.state, to)) {
      emit('task/transition-rejected', task, { from: task.state, to, reason: 'illegal-transition' })
      return errorResult(
        TASK_ERROR_CODES.invalidTransition,
        `不允许的状态迁移：${task.state} → ${to}`,
        { id, from: task.state, to, task: cloneTask(task) },
      )
    }
    // 槽位规则：非占用槽位的状态进入 running，且已满 → 明确拒绝（不硬塞）。
    const occupies = TASK_SLOT_STATES.indexOf(task.state) >= 0
    if (to === 'running' && !occupies && countSlots() >= maxRunning) {
      return errorResult(TASK_ERROR_CODES.noCapacity, `并发已满（${maxRunning}），请稍后再试`, {
        id,
        from: task.state,
        to,
        task: cloneTask(task),
      })
    }
    return applyTransition(task, to, patch)
  }

  function start(id, opts) {
    const task = tasks.get(id)
    if (task === undefined) return errorResult(TASK_ERROR_CODES.notFound, `任务不存在：${String(id)}`, { id })
    if (task.state !== 'queued') {
      return errorResult(TASK_ERROR_CODES.invalidTransition, `任务不是 queued（当前 ${task.state}）`, {
        id,
        from: task.state,
        to: 'running',
        task: cloneTask(task),
      })
    }
    if (countSlots() >= maxRunning) {
      return { ok: true, queued: true, task: cloneTask(task) }
    }
    const result = applyTransition(task, 'running', isPlainObject(opts) ? { owner: opts.owner } : undefined)
    return { ...result, queued: false }
  }

  /** 心跳续租：只对持有租约的 running/waiting 生效；owner 不匹配或已过期 → 可识别错误。 */
  function renew(id, opts) {
    const task = tasks.get(id)
    if (task === undefined) return errorResult(TASK_ERROR_CODES.notFound, `任务不存在：${String(id)}`, { id })
    if (isTaskTerminal(task.state)) {
      return errorResult(TASK_ERROR_CODES.terminal, `任务已结束（${task.state}）`, { id, state: task.state })
    }
    if (TASK_SLOT_STATES.indexOf(task.state) < 0) {
      return errorResult(TASK_ERROR_CODES.invalidTransition, `任务未持有租约（${task.state}）`, { id, state: task.state })
    }
    const spec = isPlainObject(opts) ? opts : {}
    if (typeof spec.owner === 'string' && spec.owner.length > 0 && task.owner !== null && spec.owner !== task.owner) {
      return errorResult(TASK_ERROR_CODES.ownerMismatch, `租约 owner 不匹配（持有者 ${task.owner}）`, {
        id,
        owner: task.owner,
      })
    }
    if (task.leaseExpiresAt !== null && task.leaseExpiresAt <= now()) {
      expireTask(task)
      return errorResult(TASK_ERROR_CODES.leaseExpired, '租约已过期，任务已置 failed', {
        id,
        state: task.state,
        task: cloneTask(task),
      })
    }
    task.leaseExpiresAt = now() + readPositiveInt(spec.leaseMs, leaseMs)
    task.updatedAt = now()
    emit('task/lease-renewed', task, { leaseExpiresAt: task.leaseExpiresAt })
    return { ok: true, task: cloneTask(task) }
  }

  function expireTask(task) {
    const previousOwner = task.owner
    task.error = {
      code: TASK_ERROR_CODES.leaseExpired,
      message: `租约过期（owner=${previousOwner ?? 'unknown'}）`,
    }
    applyTransition(task, 'failed', undefined)
    emit('task/lease-expired', task, { owner: previousOwner })
    fireCancel(task, 'lease-expired')
  }

  /** 清理过期租约；宿主心跳周期调用（本模块不建定时器）。 */
  function tick(at) {
    const moment = Number.isFinite(Number(at)) ? Number(at) : now()
    const expired = []
    for (const task of tasks.values()) {
      if (task.leaseExpiresAt === null) continue
      if (TASK_SLOT_STATES.indexOf(task.state) < 0) continue
      if (task.leaseExpiresAt > moment) continue
      expireTask(task)
      expired.push(cloneTask(task))
    }
    return { ok: true, expired: expired.length, tasks: expired }
  }

  const sweep = tick

  function cancel(id, opts) {
    const task = tasks.get(id)
    if (task === undefined) return errorResult(TASK_ERROR_CODES.notFound, `任务不存在：${String(id)}`, { id })
    if (task.state === 'cancelled') return { ok: true, already: true, task: cloneTask(task) }
    if (isTaskTerminal(task.state)) {
      return errorResult(TASK_ERROR_CODES.terminal, `任务已结束（${task.state}）`, { id, state: task.state })
    }
    const spec = isPlainObject(opts) ? opts : {}
    const reason = typeof spec.reason === 'string' && spec.reason.length > 0 ? spec.reason : 'cancelled'
    return applyTransition(task, 'cancelled', { error: { code: 'TASK_CANCELLED', message: reason } })
  }

  function complete(id, result) {
    const task = tasks.get(id)
    if (task === undefined) return errorResult(TASK_ERROR_CODES.notFound, `任务不存在：${String(id)}`, { id })
    if (task.state === 'done') return { ok: true, already: true, task: cloneTask(task) }
    return transition(id, 'done', { result })
  }

  function fail(id, error) {
    const task = tasks.get(id)
    if (task === undefined) return errorResult(TASK_ERROR_CODES.notFound, `任务不存在：${String(id)}`, { id })
    if (task.state === 'failed') return { ok: true, already: true, task: cloneTask(task) }
    return transition(id, 'failed', { error })
  }

  function wait(id) {
    return transition(id, 'waiting')
  }

  function resume(id) {
    return transition(id, 'running')
  }

  function block(id) {
    return transition(id, 'blocked')
  }

  function get(id) {
    return cloneTask(tasks.get(id) ?? null)
  }

  function list(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const out = []
    for (const task of tasks.values()) {
      if (typeof spec.state === 'string' && task.state !== spec.state) continue
      if (typeof spec.kind === 'string' && spec.kind.length > 0 && task.kind !== spec.kind) continue
      if (typeof spec.key === 'string' && spec.key.length > 0 && task.key !== spec.key) continue
      out.push(cloneTask(task))
    }
    return out
  }

  /**
   * 取消信号：await 方在取消/租约过期时收到回调（Hub 接入时用于中断长动作）。
   * 返回 { id, cancelled, onCancel(fn) → unsubscribe }。
   */
  function signalFor(id) {
    return {
      id,
      get cancelled() {
        const task = tasks.get(id)
        return task === undefined || task.state === 'cancelled'
      },
      onCancel(listener) {
        if (typeof listener !== 'function') return () => {}
        let listeners = cancelListeners.get(id)
        if (listeners === undefined) {
          listeners = new Set()
          cancelListeners.set(id, listeners)
        }
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
  }

  function snapshot() {
    const byState = {}
    for (const state of TASK_STATES) byState[state] = 0
    for (const task of tasks.values()) byState[task.state] = (byState[task.state] ?? 0) + 1
    const active = byState.queued + byState.running + byState.waiting + byState.blocked
    return {
      total: tasks.size,
      active,
      running: byState.running,
      waiting: byState.waiting,
      blocked: byState.blocked,
      queued: byState.queued,
      maxRunning,
      leaseMs,
      slotsUsed: byState.running + byState.waiting,
      byState,
    }
  }

  return {
    submit,
    start,
    transition,
    renew,
    tick,
    sweep,
    cancel,
    complete,
    fail,
    wait,
    resume,
    block,
    get,
    list,
    signalFor,
    snapshot,
  }
}
