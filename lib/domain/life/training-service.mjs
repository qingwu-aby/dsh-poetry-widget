// @ts-check
// lib/domain/life/training-service.mjs —— 训练旁路服务骨架（Gate G2，默认关闭，不启动真实训练）。
//
// 目标：先把训练旁路的「配置 → 计划 → 运行 → 评估闸门 → 上线/回滚」接口立起来：
//   · 默认不执行：config.enabled=false / 无 runner → run 直接拒绝；
//   · run 需要 enabled + 显式用户确认标记（confirm:true），且数据集达标才允许；
//   · runner/evaluator/cancelRun/datasetStats 全部注入；本模块不 spawn 进程、不写 adapter 文件；
//   · candidate 必须 eval 通过（score ≥ config.eval.minScore）才能 promote；promote/rollback 也要 confirm；
//   · 失败/取消只改内存状态与审计，**不修改 config.adapter.current**；只有 promote/rollback 写配置；
//   · 状态/审计有界（最近 50 条），snapshot 可观测。
//
// 纯逻辑：不联网/无宿主依赖；时钟、runner、评估器均可注入。

/** 服务实现版本。 */
export const TRAINING_SERVICE_VERSION = 1

/** 状态机阶段。 */
export const TRAINING_PHASES = Object.freeze([
  'idle',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'promoted',
  'rolled-back',
])

/** 错误码。 */
export const TRAINING_SERVICE_CODES = Object.freeze({
  disabled: 'TRAINING_DISABLED',
  busy: 'TRAINING_BUSY',
  confirmationRequired: 'TRAINING_CONFIRMATION_REQUIRED',
  runnerUnavailable: 'TRAINING_RUNNER_UNAVAILABLE',
  datasetTooSmall: 'TRAINING_DATASET_TOO_SMALL',
  runFailed: 'TRAINING_RUN_FAILED',
  cancelled: 'TRAINING_CANCELLED',
  notRunning: 'TRAINING_NOT_RUNNING',
  noCandidate: 'TRAINING_NO_CANDIDATE',
  evalNotPassed: 'TRAINING_EVAL_NOT_PASSED',
  notReady: 'TRAINING_NOT_READY',
  noPrevious: 'TRAINING_NO_PREVIOUS',
  configWriteFailed: 'TRAINING_CONFIG_WRITE_FAILED',
  configUnavailable: 'TRAINING_CONFIG_UNAVAILABLE',
  invalidArgument: 'TRAINING_INVALID_ARGUMENT',
})

const MAX_AUDIT = 50

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

/**
 * 创建训练旁路服务。
 * @param {{
 *   configStore: object,
 *   runner?: ((input: object) => object|Promise<object>)|null,
 *   evaluator?: ((input: object) => object|Promise<object>)|null,
 *   cancelRun?: ((input: object) => unknown)|null,
 *   datasetStats?: (() => object|null)|null,
 *   now?: () => number,
 *   logger?: object|null,
 * }} options
 */
export function createTrainingService(options = {}) {
  const configStore = options.configStore
  const runner = typeof options.runner === 'function' ? options.runner : null
  const evaluator = typeof options.evaluator === 'function' ? options.evaluator : null
  const cancelRun = typeof options.cancelRun === 'function' ? options.cancelRun : null
  const datasetStats = typeof options.datasetStats === 'function' ? options.datasetStats : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = /** @type {any} */ (options.logger ?? null)

  const state = {
    phase: 'idle',
    runId: null,
    startedAt: 0,
    finishedAt: 0,
    candidate: null,
    lastError: null,
    cancelRequested: false,
  }
  const audit = []
  let runCounter = 0

  function recordAudit(action, ok, detail) {
    audit.push({ id: audit.length + 1, at: now(), action, ok: ok === true, detail: detail === undefined ? '' : String(detail).slice(0, 200) })
    while (audit.length > MAX_AUDIT) audit.shift()
  }

  function readConfig() {
    try {
      const stateValue = configStore.read()
      return { config: stateValue.config, errors: stateValue.errors, exists: stateValue.exists, file: stateValue.file }
    } catch (error) {
      return { config: null, errors: [{ path: '$', message: error instanceof Error ? error.message : String(error) }], exists: false, file: '' }
    }
  }

  function readDataset() {
    if (datasetStats === null) return { available: false, entries: null, sources: null }
    try {
      const value = datasetStats()
      if (!isPlainObject(value)) return { available: false, entries: null, sources: null }
      return {
        available: true,
        entries: Number.isFinite(Number(value.entries)) ? Number(value.entries) : null,
        sources: Array.isArray(value.sources) ? value.sources.filter((item) => typeof item === 'string').slice(0, 20) : null,
      }
    } catch (error) {
      void error
      return { available: false, entries: null, sources: null }
    }
  }

  function status() {
    const configState = readConfig()
    const config = configState.config
    return {
      ok: true,
      version: TRAINING_SERVICE_VERSION,
      enabled: config !== null && config.enabled === true,
      phase: state.phase,
      running: state.phase === 'running',
      runId: state.runId,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      current: config === null ? null : config.adapter.current,
      configuredCandidate: config === null ? null : config.adapter.candidate,
      candidate: state.candidate === null ? null : { ...state.candidate },
      lastError: state.lastError === null ? null : { ...state.lastError },
      runnerAvailable: runner !== null,
      evaluatorAvailable: evaluator !== null,
      dataset: readDataset(),
      configFile: configState.file,
      configErrors: configState.errors,
      auditCount: audit.length,
    }
  }

  function plan(input = {}) {
    const configState = readConfig()
    const config = configState.config
    if (config === null) return errorResult(TRAINING_SERVICE_CODES.configUnavailable, '训练配置不可用')
    const dataset = readDataset()
    const required = config.dataset.minEntries
    let ready = true
    let blockedReason = ''
    if (config.enabled !== true) {
      ready = false
      blockedReason = 'disabled'
    } else if (dataset.available && Number.isFinite(dataset.entries) && dataset.entries < required) {
      ready = false
      blockedReason = 'insufficient-data'
    } else if (runner === null) {
      ready = false
      blockedReason = 'runner-unavailable'
    }
    const candidateId = 'adapters-candidate-' + new Date(now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const steps = [
      { id: 'collect', label: '收集数据', detail: `来源：${(config.dataset.sources.length > 0 ? config.dataset.sources : ['（未配置）']).join('、')}；最少 ${required} 条` },
      { id: 'validate', label: '校验数据量', detail: dataset.available ? `当前 ${dataset.entries ?? '未知'} 条` : '数据统计不可用（运行时再校验）' },
      { id: 'train', label: '训练 LoRA（注入 runner）', detail: `rank=${config.hyperparams.rank} steps=${config.hyperparams.steps} lr=${config.hyperparams.lr}` },
      { id: 'eval', label: '评估闸门', detail: `score ≥ ${config.eval.minScore}` },
      { id: 'promote', label: '等待用户确认后上线', detail: 'promote 需要 confirm:true，且 eval 必须通过' },
    ]
    return {
      ok: true,
      enabled: config.enabled === true,
      ready,
      blockedReason,
      requiresConfirmation: true,
      plan: {
        candidateId,
        intervalDays: config.intervalDays,
        dataset: { ...dataset, required, sources: config.dataset.sources.slice() },
        hyperparams: { ...config.hyperparams },
        evalGate: { minScore: config.eval.minScore },
        steps,
        current: config.adapter.current,
      },
      configErrors: configState.errors,
      note: typeof input.note === 'string' ? input.note.slice(0, 200) : '',
    }
  }

  async function run(input = {}) {
    const configState = readConfig()
    const config = configState.config
    if (config === null) return errorResult(TRAINING_SERVICE_CODES.configUnavailable, '训练配置不可用')
    if (config.enabled !== true) {
      recordAudit('run-rejected', false, 'disabled')
      return errorResult(TRAINING_SERVICE_CODES.disabled, '训练默认关闭（config.enabled=false），请先在配置里显式开启')
    }
    if (state.phase === 'running') {
      recordAudit('run-rejected', false, 'busy')
      return errorResult(TRAINING_SERVICE_CODES.busy, '已有训练在运行')
    }
    if (input.confirm !== true) {
      recordAudit('run-rejected', false, 'confirmation-required')
      return errorResult(TRAINING_SERVICE_CODES.confirmationRequired, 'run 需要显式确认标记 confirm:true')
    }
    const dataset = readDataset()
    if (dataset.available && Number.isFinite(dataset.entries) && dataset.entries < config.dataset.minEntries) {
      recordAudit('run-rejected', false, 'dataset-too-small')
      return errorResult(
        TRAINING_SERVICE_CODES.datasetTooSmall,
        `数据量不足：${dataset.entries} < ${config.dataset.minEntries}`,
        { entries: dataset.entries, required: config.dataset.minEntries },
      )
    }
    if (runner === null) {
      recordAudit('run-rejected', false, 'runner-unavailable')
      return errorResult(TRAINING_SERVICE_CODES.runnerUnavailable, '没有注入训练 runner（默认不启动真实训练）')
    }
    runCounter += 1
    const runId = 'train-' + runCounter + '-' + now()
    state.phase = 'running'
    state.runId = runId
    state.startedAt = now()
    state.finishedAt = 0
    state.candidate = null
    state.lastError = null
    state.cancelRequested = false
    recordAudit('run-start', true, runId)
    try {
      const result = await runner({
        runId,
        config,
        plan: plan({}).plan ?? null,
        now,
      })
      if (state.cancelRequested || (isPlainObject(result) && result.cancelled === true)) {
        state.phase = 'cancelled'
        state.finishedAt = now()
        recordAudit('run-cancelled', false, runId)
        return { ok: false, cancelled: true, code: TRAINING_SERVICE_CODES.cancelled, message: '训练已取消', runId }
      }
      if (!isPlainObject(result) || result.ok !== true) {
        const message = isPlainObject(result) && typeof result.message === 'string' ? result.message : 'runner 失败'
        state.phase = 'failed'
        state.finishedAt = now()
        state.lastError = { code: TRAINING_SERVICE_CODES.runFailed, message, at: now() }
        recordAudit('run-failed', false, message)
        return errorResult(TRAINING_SERVICE_CODES.runFailed, message, { runId })
      }
      const candidateRaw = isPlainObject(result.candidate) ? result.candidate : null
      const candidateId = candidateRaw !== null && typeof candidateRaw.id === 'string' && candidateRaw.id.trim().length > 0
        ? candidateRaw.id.trim().slice(0, 80)
        : ''
      if (candidateId.length === 0) {
        state.phase = 'failed'
        state.finishedAt = now()
        state.lastError = { code: TRAINING_SERVICE_CODES.runFailed, message: 'runner 未返回 candidate.id', at: now() }
        recordAudit('run-failed', false, 'missing-candidate')
        return errorResult(TRAINING_SERVICE_CODES.runFailed, 'runner 未返回 candidate.id', { runId })
      }
      let score = Number.isFinite(Number(result.score)) ? Number(result.score) : Number.isFinite(Number(candidateRaw.score)) ? Number(candidateRaw.score) : null
      let metrics = isPlainObject(result.metrics) ? result.metrics : isPlainObject(candidateRaw.metrics) ? candidateRaw.metrics : null
      if (evaluator !== null) {
        const evaluated = await evaluator({ runId, candidate: { ...candidateRaw, id: candidateId }, config, now })
        if (!isPlainObject(evaluated) || evaluated.ok !== true) {
          const message = isPlainObject(evaluated) && typeof evaluated.message === 'string' ? evaluated.message : '评估失败'
          state.phase = 'failed'
          state.finishedAt = now()
          state.lastError = { code: TRAINING_SERVICE_CODES.runFailed, message, at: now() }
          recordAudit('eval-failed', false, message)
          return errorResult(TRAINING_SERVICE_CODES.runFailed, message, { runId })
        }
        if (Number.isFinite(Number(evaluated.score))) score = Number(evaluated.score)
        if (isPlainObject(evaluated.metrics)) metrics = evaluated.metrics
      }
      const minScore = config.eval.minScore
      const passed = typeof score === 'number' && score >= minScore
      state.candidate = {
        id: candidateId,
        path: typeof candidateRaw.path === 'string' ? candidateRaw.path.slice(0, 200) : '',
        score,
        minScore,
        passed,
        metrics,
        runId,
        createdAt: now(),
      }
      state.phase = 'succeeded'
      state.finishedAt = now()
      recordAudit('run-succeeded', true, `candidate=${candidateId} score=${score ?? 'n/a'} passed=${passed}`)
      return {
        ok: true,
        runId,
        candidate: { ...state.candidate },
        passed,
        state: state.phase,
        ...(passed ? {} : { message: `评估未通过（${score ?? 'n/a'} < ${minScore}），candidate 不可 promote` }),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.phase = 'failed'
      state.finishedAt = now()
      state.lastError = { code: TRAINING_SERVICE_CODES.runFailed, message, at: now() }
      recordAudit('run-failed', false, message)
      try {
        logger?.warn?.(`[dsh-little-whale] 训练失败（不改 current）：${message}`)
      } catch (warnError) {
        void warnError
      }
      return errorResult(TRAINING_SERVICE_CODES.runFailed, message, { runId })
    }
  }

  async function cancel() {
    if (state.phase !== 'running') return errorResult(TRAINING_SERVICE_CODES.notRunning, '当前没有运行中的训练')
    state.cancelRequested = true
    recordAudit('cancel-requested', true, state.runId ?? '')
    if (cancelRun !== null) {
      try {
        await cancelRun({ runId: state.runId, now })
      } catch (error) {
        recordAudit('cancel-error', false, error instanceof Error ? error.message : String(error))
      }
    }
    return { ok: true, requested: true, note: '训练将在当前步骤结束后停止（不改 current）' }
  }

  function promote(input = {}) {
    if (input.confirm !== true) {
      recordAudit('promote-rejected', false, 'confirmation-required')
      return errorResult(TRAINING_SERVICE_CODES.confirmationRequired, 'promote 需要显式确认标记 confirm:true')
    }
    const configState = readConfig()
    const config = configState.config
    if (config === null) return errorResult(TRAINING_SERVICE_CODES.configUnavailable, '训练配置不可用')
    const candidate = state.candidate
    if (candidate === null) {
      recordAudit('promote-rejected', false, 'no-candidate')
      return errorResult(TRAINING_SERVICE_CODES.noCandidate, '没有可上线的 candidate（先运行一次训练）')
    }
    if (candidate.passed !== true) {
      recordAudit('promote-rejected', false, 'eval-not-passed')
      return errorResult(TRAINING_SERVICE_CODES.evalNotPassed, 'candidate 未通过评估闸门，不能上线', {
        score: candidate.score,
        minScore: candidate.minScore,
      })
    }
    if (state.phase !== 'succeeded') {
      recordAudit('promote-rejected', false, 'not-ready')
      return errorResult(TRAINING_SERVICE_CODES.notReady, `当前状态不可 promote：${state.phase}`)
    }
    const previous = config.adapter.current
    const next = {
      ...config,
      adapter: { current: candidate.id, candidate: null, previous },
    }
    const written = configStore.write(next)
    if (written.ok !== true) {
      recordAudit('promote-failed', false, 'config-write-failed')
      return errorResult(TRAINING_SERVICE_CODES.configWriteFailed, written.message ?? '写入训练配置失败')
    }
    state.phase = 'promoted'
    recordAudit('promoted', true, `${previous} -> ${candidate.id}`)
    return { ok: true, current: candidate.id, previous, candidate: { ...candidate } }
  }

  function rollback(input = {}) {
    if (input.confirm !== true) {
      recordAudit('rollback-rejected', false, 'confirmation-required')
      return errorResult(TRAINING_SERVICE_CODES.confirmationRequired, 'rollback 需要显式确认标记 confirm:true')
    }
    const configState = readConfig()
    const config = configState.config
    if (config === null) return errorResult(TRAINING_SERVICE_CODES.configUnavailable, '训练配置不可用')
    const target =
      typeof input.target === 'string' && input.target.trim().length > 0
        ? input.target.trim().slice(0, 80)
        : config.adapter.previous
    if (typeof target !== 'string' || target.length === 0) {
      recordAudit('rollback-rejected', false, 'no-previous')
      return errorResult(TRAINING_SERVICE_CODES.noPrevious, '没有可回滚的上一个 adapter')
    }
    const previousCurrent = config.adapter.current
    const next = {
      ...config,
      adapter: { current: target, candidate: null, previous: previousCurrent },
    }
    const written = configStore.write(next)
    if (written.ok !== true) {
      recordAudit('rollback-failed', false, 'config-write-failed')
      return errorResult(TRAINING_SERVICE_CODES.configWriteFailed, written.message ?? '写入训练配置失败')
    }
    state.phase = 'rolled-back'
    recordAudit('rolled-back', true, `${previousCurrent} -> ${target}`)
    return { ok: true, current: target, previous: previousCurrent }
  }

  function auditLog(limit) {
    const max = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), MAX_AUDIT) : MAX_AUDIT
    return audit.slice(-max).reverse().map((entry) => ({ ...entry }))
  }

  return {
    status,
    plan,
    run,
    cancel,
    promote,
    rollback,
    audit: auditLog,
    configStore,
  }
}
