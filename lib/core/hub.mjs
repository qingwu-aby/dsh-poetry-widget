// lib/core/hub.mjs —— Activity Hub 装配（Gate D4，shadow 模式，不改变现有业务）。
//
// 目标：把 Gate B/C/D 的模块装配成一个独立 Hub（不接 plugin-runtime、不写 live 数据）：
//   · createHub({eventBus, taskBoard, scheduler, registry, memoryGateway, feedbackLedger,
//               worldSupervisor, activityManifests, featureFlag, activities});
//   · start()/stop()：装配/拆卸事件桥（默认不启动真实 World）；
//   · tick(now)：scheduler 决策 → （full 模式）通过 activity adapter 执行 → receipt → Feedback Ledger →
//     method 候选（不直接写 Memory Gateway，除非显式 allowMemoryWrite）；
//   · shadow 模式：只读决策/记录，不 claim/execute/不写任何状态（默认 enabled=false）；
//   · 事件接线：Task Board/Registry 等 onEvent → 统一 envelope → Event Bus append（enabled 时）；
//   · snapshot/health 聚合各层指标；所有依赖调用都做错误隔离，单层故障不影响 Hub 自身。
//
// featureFlag（默认）：{enabled:false, shadow:true} —— 默认关闭且 shadow；只有显式 enabled=true 才工作，
// shadow=true 时只做“将要做”的记录，不产生任务板/执行/记忆副作用。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟、依赖模块、事件回调均可注入。

import { createEventEnvelope } from './event-schema.mjs'

/** 实现版本。 */
export const HUB_VERSION = 1

/** Hub 状态。 */
export const HUB_STATES = Object.freeze(['created', 'starting', 'running', 'stopped', 'error'])

/** 模式。 */
export const HUB_MODES = Object.freeze(['off', 'shadow', 'full'])

/** 错误码。 */
export const HUB_CODES = Object.freeze({
  disabled: 'HUB_DISABLED',
  notRunning: 'HUB_NOT_RUNNING',
  noAdapter: 'HUB_NO_ACTIVITY_ADAPTER',
  adapterFailed: 'HUB_ADAPTER_FAILED',
  eventBridgeFailed: 'HUB_EVENT_BRIDGE_FAILED',
  dependencyError: 'HUB_DEPENDENCY_ERROR',
})

/** 默认 feature flag（shadow/off）。 */
export const HUB_DEFAULT_FEATURE_FLAG = Object.freeze({ enabled: false, shadow: true })

const ACTIVITY_PATTERN = /^[a-z][a-z0-9-]{2,39}$/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function normalizeFeatureFlag(raw) {
  if (raw === true) return { enabled: true, shadow: true }
  if (raw === false) return { enabled: false, shadow: true }
  const spec = isPlainObject(raw) ? raw : {}
  return {
    enabled: spec.enabled === true,
    shadow: spec.shadow !== false,
    ...(typeof spec.name === 'string' && spec.name.length > 0 ? { name: spec.name.slice(0, 40) } : {}),
  }
}

function normalizeActivities(activityManifests) {
  const executors = new Map()
  const manifests = []
  const add = (item) => {
    if (!isPlainObject(item)) return
    const manifest = isPlainObject(item.manifest) ? item.manifest : item
    const id = typeof manifest.id === 'string' ? manifest.id : ''
    if (!ACTIVITY_PATTERN.test(id)) return
    manifests.push(manifest)
    if (typeof item.execute === 'function') executors.set(id, { execute: item.execute })
  }
  if (Array.isArray(activityManifests)) {
    for (const item of activityManifests) add(item)
  } else if (isPlainObject(activityManifests)) {
    for (const [id, item] of Object.entries(activityManifests)) {
      if (isPlainObject(item)) add({ id, ...item })
    }
  }
  return { manifests, executors }
}

function safeSnapshot(name, module) {
  if (module === null || typeof module.snapshot !== 'function') {
    return { available: false, value: null, error: null }
  }
  try {
    return { available: true, value: module.snapshot(), error: null }
  } catch (error) {
    return {
      available: true,
      value: null,
      error: { code: HUB_CODES.dependencyError, message: `${name} 快照失败：${error instanceof Error ? error.message : String(error)}` },
    }
  }
}

function pickTaskId(task) {
  if (!isPlainObject(task)) return null
  if (typeof task.id === 'string' && task.id.length > 0) return task.id
  return null
}

/**
 * 创建 Hub。
 * @param {{
 *   eventBus?: object|null,
 *   taskBoard?: object|null,
 *   scheduler?: object|null,
 *   registry?: object|null,
 *   memoryGateway?: object|null,
 *   feedbackLedger?: object|null,
 *   worldSupervisor?: object|null,
 *   activityManifests?: object[]|object|null,
 *   activities?: object|null,
 *   featureFlag?: object|boolean,
 *   now?: () => number,
 *   allowMemoryWrite?: boolean,
 *   onEvent?: (event: object) => void,
 * }} [options]
 */
export function createHub(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const eventBus = isPlainObject(spec.eventBus) ? spec.eventBus : null
  const taskBoard = isPlainObject(spec.taskBoard) ? spec.taskBoard : null
  const scheduler = isPlainObject(spec.scheduler) ? spec.scheduler : null
  const registry = isPlainObject(spec.registry) ? spec.registry : null
  const memoryGateway = isPlainObject(spec.memoryGateway) ? spec.memoryGateway : null
  const feedbackLedger = isPlainObject(spec.feedbackLedger) ? spec.feedbackLedger : null
  const worldSupervisor = isPlainObject(spec.worldSupervisor) ? spec.worldSupervisor : null
  const allowMemoryWrite = spec.allowMemoryWrite === true
  const onEvent = typeof spec.onEvent === 'function' ? spec.onEvent : null
  const featureFlag = normalizeFeatureFlag(spec.featureFlag)
  const normalized = normalizeActivities(spec.activityManifests)
  const extraActivities = isPlainObject(spec.activities) ? spec.activities : {}
  const executors = new Map(normalized.executors)
  for (const [id, adapter] of Object.entries(extraActivities)) {
    if (isPlainObject(adapter) && typeof adapter.execute === 'function') executors.set(id, { execute: adapter.execute })
  }

  let state = 'created'
  const detachers = []
  const metrics = {
    ticks: 0,
    fullTicks: 0,
    shadowTicks: 0,
    skippedTicks: 0,
    executed: 0,
    succeeded: 0,
    failed: 0,
    feedbacks: 0,
    candidates: 0,
    memoryWrites: 0,
    eventsBridged: 0,
    eventErrors: 0,
    errors: 0,
    lastError: null,
  }

  function recordError(scope, error) {
    metrics.errors += 1
    metrics.lastError = {
      scope,
      at: now(),
      message: error instanceof Error ? error.message : String(error),
    }
    return metrics.lastError
  }

  function safeCall(scope, fn) {
    try {
      return { ok: true, value: fn() }
    } catch (error) {
      return { ok: false, error: recordError(scope, error) }
    }
  }

  async function safeAwait(scope, fn) {
    try {
      return { ok: true, value: await fn() }
    } catch (error) {
      return { ok: false, error: recordError(scope, error) }
    }
  }

  function mode() {
    if (state !== 'running' || featureFlag.enabled !== true) return 'off'
    return featureFlag.shadow === true ? 'shadow' : 'full'
  }

  function emit(type, payload) {
    if (onEvent === null) return
    try {
      onEvent({ type, at: now(), ...payload })
    } catch (error) {
      void error
    }
  }

  /** 事件桥：把来源模块的事件转成统一 envelope 追加到 Event Bus。 */
  function ingest(sourceName, sourceEvent) {
    if (mode() === 'off') return { ok: true, skipped: true, reason: 'off' }
    if (!isPlainObject(sourceEvent)) return errorResult(HUB_CODES.eventBridgeFailed, '来源事件必须是对象')
    const type = typeof sourceEvent.type === 'string' ? sourceEvent.type : ''
    if (type.length === 0) return errorResult(HUB_CODES.eventBridgeFailed, '来源事件缺少 type')
    if (eventBus === null || typeof eventBus.append !== 'function') {
      return errorResult(HUB_CODES.eventBridgeFailed, 'eventBus 未接入')
    }
    const normalizedSource = typeof sourceName === 'string' ? sourceName.toLowerCase() : ''
    const activity = ACTIVITY_PATTERN.test(normalizedSource) ? normalizedSource : 'hub'
    const subjectSource = isPlainObject(sourceEvent.task)
      ? sourceEvent.task.id
      : isPlainObject(sourceEvent.activity)
        ? sourceEvent.activity.id
        : null
    const envelope = createEventEnvelope(
      {
        activity,
        type,
        version: 1,
        at: Number.isFinite(Number(sourceEvent.at)) ? Number(sourceEvent.at) : now(),
        subject: (typeof subjectSource === 'string' && subjectSource.length > 0 ? subjectSource : sourceName).slice(0, 200),
        payload: {
          source: sourceName,
          ...(Number.isFinite(Number(sourceEvent.seq)) ? { seq: Number(sourceEvent.seq) } : {}),
          data: sourceEvent,
        },
      },
      { now, prefix: 'hub' },
    )
    if (envelope.ok !== true) {
      metrics.eventErrors += 1
      return errorResult(HUB_CODES.eventBridgeFailed, '事件 envelope 非法', { errors: envelope.errors })
    }
    const appended = safeCall('eventBus.append', () => eventBus.append(envelope.event))
    if (appended.ok !== true) {
      metrics.eventErrors += 1
      return appended
    }
    metrics.eventsBridged += 1
    return { ok: true, event: envelope.event }
  }

  /** 挂接来源事件源：支持 subscribe(fn)/on(fn)/addListener(fn) 或直接传 subscribe 函数。 */
  function attachEventSource(sourceName, source) {
    if (mode() === 'off') return { ok: true, skipped: true, reason: 'off' }
    let subscribe = null
    if (typeof source === 'function') subscribe = source
    else if (isPlainObject(source)) {
      for (const method of ['subscribe', 'on', 'addListener']) {
        if (typeof source[method] === 'function') {
          subscribe = (fn) => source[method](fn)
          break
        }
      }
    }
    if (subscribe === null) return errorResult(HUB_CODES.eventBridgeFailed, '事件源需要 subscribe/on/addListener')
    const handler = (sourceEvent) => {
      ingest(sourceName, sourceEvent)
    }
    const detach = safeCall('eventSource.subscribe', () => subscribe(handler))
    if (detach.ok !== true) return detach
    if (typeof detach.value === 'function') detachers.push(detach.value)
    return { ok: true, attached: true }
  }

  /** 启动：装配事件桥；shadow 模式下不启动任何真实 World。 */
  function start() {
    if (state === 'running') return { ok: true, already: true, mode: mode() }
    if (featureFlag.enabled !== true) {
      state = 'created'
      return { ok: true, mode: 'off', enabled: false, shadow: featureFlag.shadow }
    }
    state = 'running'
    if (featureFlag.shadow !== true && worldSupervisor !== null && typeof worldSupervisor.startWorld === 'function') {
      // full 模式才考虑启动已注册 World；shadow 模式绝不启动真实进程。
      const worlds = safeCall('worldSupervisor.list', () => worldSupervisor.list())
      if (worlds.ok === true && Array.isArray(worlds.value)) {
        for (const world of worlds.value) {
          if (!isPlainObject(world) || typeof world.id !== 'string') continue
          if (world.state !== 'stopped') continue
          safeAwait('worldSupervisor.startWorld', () => worldSupervisor.startWorld(world.id)).catch((error) => void error)
        }
      }
    }
    emit('hub.started', { mode: mode() })
    return { ok: true, mode: mode(), enabled: true, shadow: featureFlag.shadow }
  }

  async function stop() {
    if (state === 'stopped') return { ok: true, already: true }
    for (const detach of detachers.splice(0)) {
      try {
        detach()
      } catch (error) {
        void error
      }
    }
    if (worldSupervisor !== null && typeof worldSupervisor.stopAll === 'function') {
      await safeAwait('worldSupervisor.stopAll', () => worldSupervisor.stopAll())
    }
    state = 'stopped'
    emit('hub.stopped', {})
    return { ok: true }
  }

  /** shadow：只读地选出“下一步会做什么”，不 claim/execute。 */
  function shadowDecision() {
    if (taskBoard === null || typeof taskBoard.list !== 'function') {
      return { action: 'idle', reason: 'no-task-board', task: null }
    }
    const listed = safeCall('taskBoard.list', () => taskBoard.list({ status: 'queued' }))
    if (listed.ok !== true || !Array.isArray(listed.value)) return { action: 'idle', reason: 'task-board-error', task: null }
    const queued = listed.value.filter((task) => isPlainObject(task) && task.status === 'queued')
    if (queued.length === 0) {
      const foreground = scheduler !== null && typeof scheduler.snapshot === 'function'
        ? safeCall('scheduler.snapshot', () => scheduler.snapshot())
        : { ok: false }
      return { action: 'idle', reason: 'no-queued', task: null, foreground: foreground.ok === true ? foreground.value?.foreground ?? null : null }
    }
    const sorted = queued.slice().sort((left, right) => {
      const priorityDiff = (Number(right.priority) || 0) - (Number(left.priority) || 0)
      if (priorityDiff !== 0) return priorityDiff
      return (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0)
    })
    return { action: 'would-start', reason: 'shadow', task: sorted[0] }
  }

  async function executeDecision(decision) {
    const task = decision.task
    const taskId = pickTaskId(task)
    const activityId = typeof task.activity === 'string' ? task.activity : ''
    const adapter = executors.get(activityId) ?? null
    if (adapter === null) {
      metrics.errors += 1
      const failure = { ok: false, code: HUB_CODES.noAdapter, message: `没有 ${activityId || '（未知）'} 的 activity adapter` }
      if (taskBoard !== null && typeof taskBoard.fail === 'function' && taskId !== null) {
        safeCall('taskBoard.fail', () => taskBoard.fail(taskId, { message: failure.message }))
      }
      return failure
    }
    const executed = await safeAwait('activity.execute', () => adapter.execute(task, { now }))
    if (executed.ok !== true) {
      metrics.failed += 1
      if (taskBoard !== null && typeof taskBoard.fail === 'function' && taskId !== null) {
        safeCall('taskBoard.fail', () => taskBoard.fail(taskId, { message: executed.error.message }))
      }
      return errorResult(HUB_CODES.adapterFailed, executed.error.message, { receipt: { ok: false, at: now() } })
    }
    metrics.executed += 1
    const result = executed.value
    const receipt = isPlainObject(result) && isPlainObject(result.receipt) ? result.receipt : { ok: false, at: now(), message: 'adapter 未返回 receipt' }
    const success = receipt.ok === true
    if (success) metrics.succeeded += 1
    else metrics.failed += 1

    // 1) 任务板收尾（成功 complete / 失败 fail），失败不阻塞后续。
    if (taskBoard !== null && taskId !== null) {
      if (success && typeof taskBoard.complete === 'function') {
        safeCall('taskBoard.complete', () => taskBoard.complete(taskId, receipt))
      } else if (!success && typeof taskBoard.fail === 'function') {
        safeCall('taskBoard.fail', () => taskBoard.fail(taskId, { message: receipt.message ?? receipt.detail ?? '执行失败' }))
      }
    }

    // 2) receipt → Feedback Ledger（成功/失败都留痕；失败不丢）。
    let feedback = null
    if (feedbackLedger !== null && typeof feedbackLedger.record === 'function') {
      const outcome = success ? 'success' : 'failure'
      const recorded = safeCall('feedbackLedger.record', () =>
        feedbackLedger.record({
          taskId: taskId ?? 'unknown',
          hypothesis: typeof task.title === 'string' && task.title.length > 0 ? task.title : `${activityId}.${task.kind ?? 'task'}`,
          experiment: `${activityId}:${task.kind ?? 'run'}:${task.key ?? taskId ?? 'no-key'}`,
          receipt: {
            kind: 'event',
            at: Number.isFinite(Number(receipt.at)) ? Number(receipt.at) : now(),
            ref: taskId ?? task.key ?? 'task',
            ok: success,
          },
          outcome,
          evidence: [
            `receipt.ok=${success}`,
            ...(typeof receipt.detail === 'string' && receipt.detail.length > 0 ? [receipt.detail] : []),
            ...(typeof receipt.replyId === 'string' && receipt.replyId.length > 0 ? [`replyId=${receipt.replyId}`] : []),
          ],
          provenance: { activity: activityId },
        }),
      )
      if (recorded.ok === true && isPlainObject(recorded.value) && recorded.value.ok === true) {
        metrics.feedbacks += 1
        feedback = recorded.value.record ?? recorded.value
      }
    }

    // 3) 成功 → method 候选（只返回/记录；默认不写 Memory Gateway）。
    let candidate = null
    if (success && feedbackLedger !== null && typeof feedbackLedger.promoteToMethod === 'function' && feedback !== null) {
      const promoted = safeCall('feedbackLedger.promoteToMethod', () => feedbackLedger.promoteToMethod({ recordId: feedback.id }))
      if (promoted.ok === true && isPlainObject(promoted.value) && promoted.value.ok === true) {
        candidate = promoted.value.candidate
        metrics.candidates += 1
        if (allowMemoryWrite && memoryGateway !== null && typeof memoryGateway.write === 'function' && isPlainObject(candidate) && isPlainObject(candidate.memoryEntry)) {
          const written = await safeAwait('memoryGateway.write', () => memoryGateway.write(candidate.memoryEntry))
          if (written.ok === true) metrics.memoryWrites += 1
        }
      }
    }
    emit('hub.executed', { activity: activityId, taskId, success })
    return { ok: true, receipt, success, feedback, candidate }
  }

  /**
   * 一轮：scheduler 决策 → （full）执行 → receipt → feedback → 候选；shadow 只记录。
   * @param {number} [nowArg]
   */
  async function tick(nowArg) {
    metrics.ticks += 1
    const at = Number.isFinite(Number(nowArg)) ? Number(nowArg) : now()
    const currentMode = mode()
    if (currentMode === 'off') {
      metrics.skippedTicks += 1
      return { ok: true, mode: 'off', skipped: true, at }
    }
    if (currentMode === 'shadow') {
      metrics.shadowTicks += 1
      const decision = shadowDecision()
      emit('hub.shadow', { decision })
      return { ok: true, mode: 'shadow', at, decision, executed: false }
    }
    metrics.fullTicks += 1
    if (scheduler === null || typeof scheduler.tick !== 'function') {
      return errorResult(HUB_CODES.dependencyError, 'scheduler 未接入，无法 full 模式 tick')
    }
    const decision = safeAwait('scheduler.tick', () => scheduler.tick(at))
    const resolved = await decision
    if (resolved.ok !== true) return resolved.error
    const value = resolved.value
    if (!isPlainObject(value) || value.ok !== true) {
      return { ok: true, mode: 'full', at, decision: value, executed: false }
    }
    if (['start', 'preempt', 'resume', 'background'].indexOf(value.action) < 0 || !isPlainObject(value.task)) {
      return { ok: true, mode: 'full', at, decision: value, executed: false }
    }
    const execution = await executeDecision(value)
    if (execution.ok !== true) return { ok: false, mode: 'full', at, decision: value, error: execution }
    return {
      ok: true,
      mode: 'full',
      at,
      decision: value,
      executed: true,
      receipt: execution.receipt,
      success: execution.success,
      feedback: execution.feedback,
      candidate: execution.candidate,
    }
  }

  function health() {
    const checks = {
      eventBus: eventBus !== null,
      taskBoard: taskBoard !== null,
      scheduler: scheduler !== null,
      registry: registry !== null,
      memoryGateway: memoryGateway !== null,
      feedbackLedger: feedbackLedger !== null,
      worldSupervisor: worldSupervisor !== null,
      activityAdapters: executors.size,
    }
    const snapshot = aggregateSnapshot()
    const ok = state === 'running' && featureFlag.enabled === true
      ? checks.eventBus || checks.taskBoard
      : true
    return {
      ok,
      state,
      mode: mode(),
      enabled: featureFlag.enabled,
      shadow: featureFlag.shadow,
      checks,
      errors: snapshot.errors.length,
      metrics: { ...metrics },
      lastError: metrics.lastError === null ? null : { ...metrics.lastError },
    }
  }

  function aggregateSnapshot() {
    const sections = {
      eventBus: safeSnapshot('eventBus', eventBus),
      taskBoard: safeSnapshot('taskBoard', taskBoard),
      scheduler: safeSnapshot('scheduler', scheduler),
      registry: safeSnapshot('registry', registry),
      memoryGateway: safeSnapshot('memoryGateway', memoryGateway),
      feedbackLedger: safeSnapshot('feedbackLedger', feedbackLedger),
      worldSupervisor: safeSnapshot('worldSupervisor', worldSupervisor),
    }
    const errors = Object.entries(sections)
      .filter(([, section]) => section.error !== null)
      .map(([name, section]) => ({ layer: name, ...section.error }))
    return { sections, errors }
  }

  function snapshot() {
    const aggregated = aggregateSnapshot()
    return {
      ok: true,
      version: HUB_VERSION,
      now: now(),
      state,
      mode: mode(),
      featureFlag: { ...featureFlag },
      activities: normalized.manifests.map((manifest) => manifest.id),
      adapters: [...executors.keys()],
      available: {
        eventBus: eventBus !== null,
        taskBoard: taskBoard !== null,
        scheduler: scheduler !== null,
        registry: registry !== null,
        memoryGateway: memoryGateway !== null,
        feedbackLedger: feedbackLedger !== null,
        worldSupervisor: worldSupervisor !== null,
      },
      layers: {
        eventBus: aggregated.sections.eventBus.value,
        taskBoard: aggregated.sections.taskBoard.value,
        scheduler: aggregated.sections.scheduler.value,
        registry: aggregated.sections.registry.value,
        memoryGateway: aggregated.sections.memoryGateway.value,
        feedbackLedger: aggregated.sections.feedbackLedger.value,
        worldSupervisor: aggregated.sections.worldSupervisor.value,
      },
      errors: aggregated.errors,
      metrics: { ...metrics },
    }
  }

  return {
    start,
    stop,
    tick,
    ingest,
    attachEventSource,
    snapshot,
    health,
    featureFlag: { ...featureFlag },
    mode,
  }
}
