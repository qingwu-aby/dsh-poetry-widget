// @ts-check
// lib/composition/health.mjs —— health.json 的后台服务快照组装（W1）

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
export function buildRuntimeSnapshot(deps) {
  const worldview = deps.worldview.snapshot()
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
    modelErrors: deps.summarizeModelErrors(deps.modelErrorsPath, { since: Date.now() - 24 * 60 * 60 * 1000 }),
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
  }
}
