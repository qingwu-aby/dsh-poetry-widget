// @ts-check
// lib/composition/health.mjs —— health.json 的后台服务快照组装（W1）
//
// v3.2（Gate A5）：增加结构化观测指标 metrics + 阈值告警 alerts（均为新增字段，旧字段保持不变）：
//   · gate/budget：模型并发队列/预算（Gate A1）；
//   · tasks：Task 监管器快照（Gate A2，未接线时 available:false 占位）；
//   · events：事件积压占位（Gate B 接线前 available:false）；
//   · memory/disk：进程堆与磁盘余量；
//   · modelErrors：最近 24h 模型错误聚合；
//   · minecraft：Minecraft World 状态（可用时）；
//   · hub：Hub 运行时（Gate E，默认 off/shadow；available/mode/metrics）。
import { statfsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 告警阈值（docs/observability.md 的单一来源）。 */
export const HEALTH_ALERT_THRESHOLDS = Object.freeze({
  gateQueueRatio: 0.8,
  gateRejected: 1,
  budgetRatio: 0.9,
  modelErrors24h: 20,
  heapUsedRatio: 0.85,
  diskFreeRatio: 0.1,
  tasksBlocked: 5,
  eventQueueRatio: 0.8,
  minecraftStaleMs: 10 * 60 * 1000,
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function safeSnapshot(service) {
  try {
    return service !== null && service !== undefined && typeof service.snapshot === 'function'
      ? service.snapshot()
      : null
  } catch (error) {
    void error
    return null
  }
}

/**
 * 模型并发闸门快照归一化（Gate A1）：active/queued/maxConcurrent 保持原字段，
 * 新增 maxQueue/queueTimeoutMs/rejected/lastReject，便于 health 观察最近拒绝原因。
 * @param {unknown} snapshot
 */
export function summarizeModelGate(snapshot) {
  const source = snapshot !== null && typeof snapshot === 'object' ? /** @type {Record<string, any>} */ (snapshot) : {}
  const rejected = source.rejected !== null && typeof source.rejected === 'object' ? source.rejected : {}
  const lastReject = source.lastReject !== null && typeof source.lastReject === 'object' ? source.lastReject : null
  return {
    active: numberOr(source.active, 0),
    queued: numberOr(source.queued, 0),
    maxConcurrent: numberOr(source.maxConcurrent, 0),
    maxQueue: numberOr(source.maxQueue, 0),
    queueTimeoutMs: numberOr(source.queueTimeoutMs, 0),
    rejected: {
      queueFull: numberOr(rejected.queueFull, 0),
      timeout: numberOr(rejected.timeout, 0),
    },
    lastReject:
      lastReject === null
        ? null
        : {
            reason: String(lastReject.reason ?? ''),
            at: numberOr(lastReject.at, 0),
            message: String(lastReject.message ?? ''),
            role: typeof lastReject.role === 'string' ? lastReject.role : '',
          },
  }
}

/**
 * 模型预算快照归一化（Gate A1）：今日 total/counts 保持原口径，新增最近拒绝原因与落盘状态。
 * @param {unknown} snapshot
 */
export function summarizeModelBudget(snapshot) {
  const source = snapshot !== null && typeof snapshot === 'object' ? /** @type {Record<string, any>} */ (snapshot) : {}
  const counts = source.counts !== null && typeof source.counts === 'object' ? source.counts : {}
  const limits = source.limits !== null && typeof source.limits === 'object' ? source.limits : {}
  const lastReject = source.lastReject !== null && typeof source.lastReject === 'object' ? source.lastReject : null
  const normalizedCounts = {}
  for (const key of Object.keys(counts)) normalizedCounts[key] = numberOr(counts[key], 0)
  const normalizedLimits = {}
  for (const key of Object.keys(limits)) normalizedLimits[key] = numberOr(limits[key], 0)
  return {
    day: typeof source.day === 'string' ? source.day : '',
    total: numberOr(source.total, 0),
    totalLimit: numberOr(source.totalLimit, 0),
    counts: normalizedCounts,
    limits: normalizedLimits,
    lastReject:
      lastReject === null
        ? null
        : {
            reason: String(lastReject.reason ?? ''),
            scope: typeof lastReject.scope === 'string' ? lastReject.scope : '',
            role: typeof lastReject.role === 'string' ? lastReject.role : '',
            at: numberOr(lastReject.at, 0),
            message: String(lastReject.message ?? ''),
          },
    pendingWrite: source.pendingWrite === true,
    flushIntervalMs: numberOr(source.flushIntervalMs, 0),
  }
}

function summarizeTasks(snapshot) {
  const source = isPlainObject(snapshot) ? snapshot : null
  if (source === null) {
    return {
      available: false,
      total: 0,
      active: 0,
      queued: 0,
      running: 0,
      waiting: 0,
      blocked: 0,
      slotsUsed: 0,
      maxRunning: 0,
      byState: { queued: 0, running: 0, waiting: 0, blocked: 0, done: 0, failed: 0, cancelled: 0 },
    }
  }
  const byState = isPlainObject(source.byState) ? source.byState : {}
  const pick = (key) => numberOr(source[key] ?? byState[key], 0)
  return {
    available: true,
    total: numberOr(source.total, 0),
    active: numberOr(source.active, 0),
    queued: pick('queued'),
    running: pick('running'),
    waiting: pick('waiting'),
    blocked: pick('blocked'),
    slotsUsed: numberOr(source.slotsUsed, 0),
    maxRunning: numberOr(source.maxRunning, 0),
    byState: {
      queued: pick('queued'),
      running: pick('running'),
      waiting: pick('waiting'),
      blocked: pick('blocked'),
      done: numberOr(byState.done, 0),
      failed: numberOr(byState.failed, 0),
      cancelled: numberOr(byState.cancelled, 0),
    },
  }
}

function summarizeEventBacklog(snapshot) {
  const source = isPlainObject(snapshot) ? snapshot : null
  if (source === null) {
    return { available: false, queued: 0, capacity: 0, dropped: 0, oldestQueuedAt: 0, note: 'placeholder' }
  }
  return {
    available: true,
    queued: numberOr(source.queued, 0),
    capacity: numberOr(source.capacity, 0),
    dropped: numberOr(source.dropped, 0),
    oldestQueuedAt: numberOr(source.oldestQueuedAt, 0),
    note: '',
  }
}

function summarizeMemory() {
  try {
    const usage = process.memoryUsage()
    const heapUsed = numberOr(usage.heapUsed, 0)
    const heapTotal = numberOr(usage.heapTotal, 0)
    return {
      available: true,
      rssBytes: numberOr(usage.rss, 0),
      heapUsedBytes: heapUsed,
      heapTotalBytes: heapTotal,
      externalBytes: numberOr(usage.external, 0),
      heapUsedRatio: heapTotal > 0 ? heapUsed / heapTotal : 0,
      systemTotalBytes: numberOr(os.totalmem(), 0),
      systemFreeBytes: numberOr(os.freemem(), 0),
    }
  } catch (error) {
    void error
    return {
      available: false,
      rssBytes: 0,
      heapUsedBytes: 0,
      heapTotalBytes: 0,
      externalBytes: 0,
      heapUsedRatio: 0,
      systemTotalBytes: 0,
      systemFreeBytes: 0,
    }
  }
}

function summarizeDisk(targetPath) {
  const target = typeof targetPath === 'string' && targetPath.length > 0 ? targetPath : ''
  if (target.length === 0) {
    return { available: false, path: '', totalBytes: 0, freeBytes: 0, usedRatio: 0 }
  }
  try {
    const stats = statfsSync(target)
    const blockSize = numberOr(stats.bsize, 0)
    const totalBytes = blockSize * numberOr(stats.blocks, 0)
    const freeBytes = blockSize * numberOr(stats.bavail ?? stats.bfree, 0)
    return {
      available: totalBytes > 0,
      path: target,
      totalBytes,
      freeBytes,
      usedRatio: totalBytes > 0 ? (totalBytes - freeBytes) / totalBytes : 0,
    }
  } catch (error) {
    void error
    return { available: false, path: target, totalBytes: 0, freeBytes: 0, usedRatio: 0 }
  }
}

function summarizeMinecraft(source) {
  const empty = {
    available: false,
    reason: 'not-wired',
    ok: false,
    lastObservationAt: 0,
    lastCommandAt: 0,
    permission: '',
    granted: false,
    interrupted: false,
    staleMs: null,
  }
  if (source === null || source === undefined) return empty
  let snapshot = null
  try {
    if (typeof source === 'function') snapshot = source()
    else if (typeof source.snapshot === 'function') snapshot = source.snapshot()
    else if (isPlainObject(source)) snapshot = source
  } catch (error) {
    void error
    return { ...empty, reason: 'snapshot-failed' }
  }
  if (!isPlainObject(snapshot)) return empty
  const observationAt = numberOr(snapshot.observationAt, 0)
  const lastCommand = isPlainObject(snapshot.lastCommand) ? snapshot.lastCommand : null
  const lastReceipt = isPlainObject(snapshot.lastReceipt) ? snapshot.lastReceipt : null
  const lastCommandAt = numberOr(lastCommand?.at || lastReceipt?.at, 0)
  return {
    available: true,
    reason: '',
    ok: snapshot.ok !== false,
    lastObservationAt: observationAt,
    lastCommandAt,
    permission: typeof snapshot.permission === 'string' ? snapshot.permission : '',
    granted: snapshot.granted === true,
    interrupted: snapshot.interrupted === true,
    staleMs: observationAt > 0 ? Math.max(0, Date.now() - observationAt) : null,
  }
}

/**
 * Hub 运行时指标（Gate E，默认 off/shadow；未接线时 available:false）。
 * @param {unknown} source
 */
export function summarizeHub(source) {
  const empty = {
    available: false,
    assembled: false,
    activities: 0,
    mode: 'off',
    enabled: false,
    shadow: true,
    state: 'absent',
    started: false,
    metrics: null,
    errors: 0,
    lastError: null,
  }
  if (source === null || source === undefined) return empty
  const candidate = /** @type {Record<string, any>} */ (source)
  let snapshot = null
  try {
    if (typeof candidate === 'function') snapshot = candidate()
    else if (typeof candidate.snapshot === 'function') snapshot = candidate.snapshot()
    else if (isPlainObject(candidate)) snapshot = candidate
  } catch (error) {
    void error
    return { ...empty, reason: 'snapshot-failed' }
  }
  if (!isPlainObject(snapshot)) return empty
  const hub = isPlainObject(snapshot.hub) ? snapshot.hub : null
  const flag = isPlainObject(snapshot.featureFlag) ? snapshot.featureFlag : null
  const metrics = hub !== null && isPlainObject(hub.metrics) ? hub.metrics : null
  const layerRegistry =
    hub !== null && isPlainObject(hub.layers) && isPlainObject(hub.layers.registry) ? hub.layers.registry : null
  return {
    available: true,
    assembled:
      snapshot.assembled === true || (hub !== null && isPlainObject(hub.available) && hub.available.taskBoard === true),
    activities: layerRegistry !== null && Array.isArray(layerRegistry.activities) ? layerRegistry.activities.length : 0,
    mode: typeof snapshot.mode === 'string' ? snapshot.mode : 'off',
    enabled: flag !== null ? flag.enabled === true : snapshot.mode !== 'off',
    shadow: flag !== null ? flag.shadow !== false : true,
    state:
      hub !== null && typeof hub.state === 'string' ? hub.state : snapshot.started === true ? 'running' : 'stopped',
    started: snapshot.started === true,
    metrics:
      metrics === null
        ? null
        : {
            ticks: numberOr(metrics.ticks, 0),
            fullTicks: numberOr(metrics.fullTicks, 0),
            shadowTicks: numberOr(metrics.shadowTicks, 0),
            skippedTicks: numberOr(metrics.skippedTicks, 0),
            executed: numberOr(metrics.executed, 0),
            succeeded: numberOr(metrics.succeeded, 0),
            failed: numberOr(metrics.failed, 0),
            feedbacks: numberOr(metrics.feedbacks, 0),
            candidates: numberOr(metrics.candidates, 0),
            errors: numberOr(metrics.errors, 0),
          },
    errors: hub !== null && Array.isArray(hub.errors) ? hub.errors.length : 0,
    lastError: isPlainObject(snapshot.lastError) ? { ...snapshot.lastError } : null,
  }
}

function emptyModelErrors() {
  return { since: 0, total: 0, byRole: {}, byCode: {}, lastAt: null }
}

/**
 * 组装结构化观测指标（纯函数；缺失的可选依赖以 available:false 占位）。
 * @param {Record<string, any>} deps
 * @param {number} [now]
 */
export function buildHealthMetrics(deps, now) {
  const at = numberOr(now, Date.now())
  const source = isPlainObject(deps) ? deps : {}
  const gate = summarizeModelGate(safeSnapshot(source.modelGate))
  const budget = summarizeModelBudget(safeSnapshot(source.modelBudget))
  let modelErrors = emptyModelErrors()
  if (typeof source.summarizeModelErrors === 'function') {
    try {
      modelErrors = source.summarizeModelErrors(source.modelErrorsPath, { since: at - 24 * 60 * 60 * 1000 })
    } catch (error) {
      void error
      modelErrors = emptyModelErrors()
    }
  }
  const diskPath =
    typeof source.diskPath === 'string' && source.diskPath.length > 0
      ? source.diskPath
      : typeof source.modelErrorsPath === 'string' && source.modelErrorsPath.length > 0
        ? path.dirname(source.modelErrorsPath)
        : ''
  return {
    generatedAt: at,
    gate: {
      ...gate,
      saturation: gate.maxQueue > 0 ? gate.queued / gate.maxQueue : 0,
    },
    budget: {
      day: budget.day,
      total: budget.total,
      totalLimit: budget.totalLimit,
      usageRatio: budget.totalLimit > 0 ? budget.total / budget.totalLimit : 0,
      lastReject: budget.lastReject,
      pendingWrite: budget.pendingWrite,
    },
    tasks: summarizeTasks(safeSnapshot(source.taskSupervisor)),
    events: summarizeEventBacklog(safeSnapshot(source.eventBacklog)),
    memory: summarizeMemory(),
    disk: summarizeDisk(diskPath),
    modelErrors,
    minecraft: summarizeMinecraft(source.minecraftWorld ?? source.minecraft ?? null),
    hub: summarizeHub(source.hubRuntime ?? source.hub ?? null),
  }
}

/**
 * 根据指标生成阈值告警（纯函数，稳定可测）。
 * @param {Record<string, any>} metrics
 * @param {Record<string, number>} [thresholds]
 */
export function buildHealthAlerts(metrics, thresholds) {
  const limits = isPlainObject(thresholds) ? { ...HEALTH_ALERT_THRESHOLDS, ...thresholds } : HEALTH_ALERT_THRESHOLDS
  const source = isPlainObject(metrics) ? metrics : {}
  const alerts = []
  const push = (code, level, message, value, threshold) => {
    alerts.push({ code, level, message, value, threshold })
  }
  const gate = isPlainObject(source.gate) ? source.gate : {}
  if (numberOr(gate.maxQueue, 0) > 0 && numberOr(gate.saturation, 0) >= limits.gateQueueRatio) {
    push(
      'gate-queue-saturated',
      'warn',
      '模型调用排队接近上限，活动可能变慢',
      numberOr(gate.queued, 0),
      limits.gateQueueRatio,
    )
  }
  const rejected = isPlainObject(gate.rejected) ? gate.rejected : {}
  const rejectedTotal = numberOr(rejected.queueFull, 0) + numberOr(rejected.timeout, 0)
  if (rejectedTotal >= limits.gateRejected) {
    push('gate-rejections', 'warn', '出现模型调用排队拒绝（队列满/超时）', rejectedTotal, limits.gateRejected)
  }
  const budget = isPlainObject(source.budget) ? source.budget : {}
  if (numberOr(budget.totalLimit, 0) > 0 && numberOr(budget.usageRatio, 0) >= limits.budgetRatio) {
    push('budget-near-limit', 'warn', '今日模型调用预算接近上限', numberOr(budget.total, 0), limits.budgetRatio)
  }
  if (budget.lastReject !== null && budget.lastReject !== undefined) {
    push('budget-rejected', 'warn', '最近有调用因预算被拒绝', numberOr(budget.total, 0), limits.budgetRatio)
  }
  const modelErrors = isPlainObject(source.modelErrors) ? source.modelErrors : {}
  if (numberOr(modelErrors.total, 0) >= limits.modelErrors24h) {
    push(
      'model-errors-spike',
      'warn',
      '最近 24h 模型错误偏多，检查 provider/凭证',
      numberOr(modelErrors.total, 0),
      limits.modelErrors24h,
    )
  }
  const memory = isPlainObject(source.memory) ? source.memory : {}
  if (numberOr(memory.heapUsedRatio, 0) >= limits.heapUsedRatio) {
    push('heap-pressure', 'warn', '进程堆使用率偏高', numberOr(memory.heapUsedRatio, 0), limits.heapUsedRatio)
  }
  const disk = isPlainObject(source.disk) ? source.disk : {}
  if (disk.available === true && numberOr(disk.usedRatio, 0) >= 1 - limits.diskFreeRatio) {
    push('disk-low', 'critical', '磁盘余量不足，备份/日志可能写失败', numberOr(disk.freeBytes, 0), limits.diskFreeRatio)
  }
  const tasks = isPlainObject(source.tasks) ? source.tasks : {}
  if (tasks.available === true && numberOr(tasks.blocked, 0) >= limits.tasksBlocked) {
    push('tasks-blocked', 'warn', '有较多任务处于 blocked', numberOr(tasks.blocked, 0), limits.tasksBlocked)
  }
  const events = isPlainObject(source.events) ? source.events : {}
  if (
    events.available === true &&
    numberOr(events.capacity, 0) > 0 &&
    numberOr(events.queued, 0) / numberOr(events.capacity, 1) >= limits.eventQueueRatio
  ) {
    push('event-backlog', 'warn', '事件队列积压接近上限', numberOr(events.queued, 0), limits.eventQueueRatio)
  }
  const minecraft = isPlainObject(source.minecraft) ? source.minecraft : {}
  if (
    minecraft.available === true &&
    minecraft.staleMs !== null &&
    numberOr(minecraft.staleMs, 0) >= limits.minecraftStaleMs
  ) {
    push(
      'minecraft-stale',
      'warn',
      'Minecraft 观察数据超过 10 分钟未更新',
      numberOr(minecraft.staleMs, 0),
      limits.minecraftStaleMs,
    )
  }
  return alerts
}

export function buildRuntimeSnapshot(deps) {
  const worldview = deps.worldview.snapshot()
  const metrics = buildHealthMetrics(deps, Date.now())
  return {
    growth: deps.growth.snapshot(),
    drive: deps.selfDrive.snapshot(),
    wander: deps.selfWander.snapshot(),
    reading: deps.selfReading.snapshot(),
    netlang: deps.selfNetlang.snapshot(),
    consolidate: deps.memoryConsolidator.snapshot(),
    services: deps.serviceRuntime.snapshot(),
    domainServices: deps.domainServices ?? {},
    budget: summarizeModelBudget(safeSnapshot(deps.modelBudget)),
    gate: summarizeModelGate(safeSnapshot(deps.modelGate)),
    heartbeat: deps.heartbeat.snapshot(),
    web: deps.webAccess.snapshot(),
    modelErrors: metrics.modelErrors,
    growthMetrics: deps.growthMetrics.snapshot(),
    works: deps.selfWorks.snapshot(),
    mediaBudget: deps.mediaBudget.snapshot(),
    outbox: deps.outbox.snapshot(),
    attention: { mode: deps.attention.mode(), pending: deps.attention.pending().length },
    promptLayers: { version: deps.promptLayersVersion },
    events: deps.selfEvents.snapshot(),
    metabolism: deps.selfMetabolism.snapshot(),
    worldFeedback: deps.worldFeedback.recent(5),
    lifecycle: deps.selfLifecycle.snapshot(),
    twin: { enabled: deps.twinEnabled === true },
    webBench: deps.webBench.snapshot(),
    agentLoop: deps.agentLoop.snapshot(),
    knowledgeGraph: deps.knowledgeGraph.snapshot(),
    selfTrainer: deps.selfTrainer.snapshot(),
    relationship: deps.relationship.snapshot(),
    emotional: deps.emotional.snapshot(),
    dailyLife: deps.dailyLife.snapshot(),
    stateMigrations: deps.migrationSummary,
    commitments: deps.commitments.snapshot(),
    guiPush: deps.guiPush.snapshot(),
    localVoice: deps.localVoice.snapshot(),
    worldview: {
      version: worldview.essay.version,
      beliefs: worldview.beliefs.length,
      concepts: worldview.concepts.length,
      questions: worldview.questions.length,
      contradictions: worldview.contradictions.filter((item) => item.status === 'open').length,
      essayAt: worldview.essay.at,
    },
    // v3.2（Gate A5）：结构化指标 + 阈值告警（新增字段，旧字段不变）。
    metrics,
    alerts: buildHealthAlerts(metrics),
  }
}
