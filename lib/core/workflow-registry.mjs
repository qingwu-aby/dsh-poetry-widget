// @ts-check
// Phase 3A：跨 Activity 工作流定义 + 预算账本（只存储/校验/计费，不执行步骤）。
import fs from 'node:fs'
import path from 'node:path'

export const WORKFLOW_VERSION = 1
export const WORKFLOW_TRIGGERS = Object.freeze(['manual', 'interval', 'event'])
export const WORKFLOW_BUDGET_DEFAULTS = Object.freeze({
  maxSteps: 10,
  maxTokens: 20000,
  maxDurationMs: 600000,
  maxRuns: 20,
})
const MAX_WORKFLOWS = 100
const NAME_RE = /^[a-z][a-z0-9_-]{1,40}$/

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) }
function clean(v, max) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function positiveInt(value, fallback, max) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : fallback
}

export function validateWorkflow(input = {}, options = {}) {
  const allowedActivities = options.allowedActivities instanceof Set ? options.allowedActivities : null
  if (!isObject(input)) return { ok: false, error: 'invalid_body' }
  const name = clean(input.name, 40).toLowerCase()
  if (!NAME_RE.test(name)) return { ok: false, error: 'invalid_name' }
  const trigger = isObject(input.trigger) ? input.trigger : { type: 'manual' }
  const triggerType = clean(trigger.type, 20) || 'manual'
  if (!WORKFLOW_TRIGGERS.includes(triggerType)) return { ok: false, error: 'invalid_trigger' }
  const everyMs = triggerType === 'interval' ? positiveInt(trigger.everyMs, 60000, 86400000) : 0
  const eventType = triggerType === 'event' ? clean(trigger.eventType, 80) : ''
  if (triggerType === 'event' && eventType.length === 0) return { ok: false, error: 'event_type_required' }
  const rawSteps = Array.isArray(input.steps) ? input.steps : []
  const steps = []
  for (const item of rawSteps.slice(0, 50)) {
    if (!isObject(item)) continue
    const activity = clean(item.activity, 40)
    const tool = clean(item.tool, 80)
    if (!activity || !tool) continue
    if (allowedActivities && !allowedActivities.has(activity)) continue
    steps.push({ activity, tool, arguments: isObject(item.arguments) ? item.arguments : {} })
  }
  const budgetInput = isObject(input.budget) ? input.budget : {}
  const budget = {
    maxSteps: positiveInt(budgetInput.maxSteps, WORKFLOW_BUDGET_DEFAULTS.maxSteps, 50),
    maxTokens: positiveInt(budgetInput.maxTokens, WORKFLOW_BUDGET_DEFAULTS.maxTokens, 1000000),
    maxDurationMs: positiveInt(budgetInput.maxDurationMs, WORKFLOW_BUDGET_DEFAULTS.maxDurationMs, 86400000),
    maxRuns: positiveInt(budgetInput.maxRuns, WORKFLOW_BUDGET_DEFAULTS.maxRuns, 1000),
  }
  if (steps.length === 0) return { ok: false, error: 'steps_required' }
  if (steps.length > budget.maxSteps) return { ok: false, error: 'too_many_steps' }
  return {
    ok: true,
    workflow: {
      name,
      description: clean(input.description, 400),
      trigger: { type: triggerType, ...(everyMs > 0 ? { everyMs } : {}), ...(eventType ? { eventType } : {}) },
      steps,
      budget,
      enabled: input.enabled !== false,
      runs: 0,
      tokensUsed: 0,
      totalDurationMs: 0,
      lastRunAt: 0,
      lastStatus: 'idle',
      runState: null,
      createdAt: Date.now(),
    },
  }
}

export function createWorkflowRegistry(options = {}) {
  const file = typeof options.file === 'string' ? options.file : ''
  const allowedActivities = options.allowedActivities instanceof Set ? options.allowedActivities : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let workflows = []
  try { if (file && fs.existsSync(file)) { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(raw.workflows)) workflows = raw.workflows } } catch (error) { void error }
  function persist() {
    if (!file) return
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify({ v: WORKFLOW_VERSION, workflows }, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file) } catch (error) { void error }
  }
  function list() { return workflows.map((item) => ({ ...item, budget: { ...item.budget }, remainingRuns: Math.max(0, item.budget.maxRuns - item.runs) })) }
  function get(name) { return workflows.find((item) => item.name === name) ?? null }
  function upsert(validated) {
    if (!validated || validated.ok !== true) return validated
    const workflow = validated.workflow
    const index = workflows.findIndex((item) => item.name === workflow.name)
    if (index >= 0) workflows[index] = { ...workflows[index], ...workflow, createdAt: workflows[index].createdAt || now(), runs: workflows[index].runs || 0, tokensUsed: workflows[index].tokensUsed || 0, totalDurationMs: workflows[index].totalDurationMs || 0 }
    else workflows.push(workflow)
    if (workflows.length > MAX_WORKFLOWS) workflows = workflows.slice(-MAX_WORKFLOWS)
    persist()
    return { ok: true, workflow: { ...get(workflow.name) } }
  }
  function setEnabled(name, enabled) { const item = get(name); if (!item) return { ok: false, error: 'not_found' }; item.enabled = enabled === true; persist(); return { ok: true, workflow: { ...item } } }
  function remove(name) { const before = workflows.length; workflows = workflows.filter((item) => item.name !== name); persist(); return before !== workflows.length ? { ok: true } : { ok: false, error: 'not_found' } }
  function canRun(name) {
    const item = get(name); if (!item) return { ok: false, error: 'not_found' }
    if (!item.enabled) return { ok: false, error: 'disabled' }
    if (item.budget.maxRuns > 0 && item.runs >= item.budget.maxRuns) return { ok: false, error: 'runs_exhausted' }
    if (item.budget.maxTokens > 0 && item.tokensUsed >= item.budget.maxTokens) return { ok: false, error: 'tokens_exhausted' }
    return { ok: true, workflow: item }
  }
  function beginRun(name) {
    const check = canRun(name); if (check.ok !== true) return check
    const item = check.workflow
    item.lastStatus = 'running'; item.lastRunAt = now();
    item.runState = { status: 'running', runId: 'run-' + now().toString(36), cursor: 0, startedAt: now(), pendingTaskId: null, results: [], tokensUsed: 0 }
    persist()
    return { ok: true, workflow: { ...item } }
  }
  function finishRun(name, result = {}) {
    const item = get(name); if (!item) return { ok: false, error: 'not_found' }
    const ok = result.ok === true
    item.runs += 1
    item.tokensUsed += Math.max(0, Number(result.tokensUsed) || 0)
    item.totalDurationMs += Math.max(0, Number(result.durationMs) || 0)
    item.lastStatus = ok ? 'success' : 'failed'
    item.lastError = ok ? null : clean(result.error, 300)
    item.runState = null
    persist()
    return { ok: true, workflow: { ...item } }
  }
  function setWaiting(name, state = {}) {
    const item = get(name); if (!item) return { ok: false, error: 'not_found' }
    item.lastStatus = 'waiting'
    item.runState = {
      status: 'waiting',
      runId: state.runId || (item.runState && item.runState.runId) || 'run-' + now().toString(36),
      cursor: Math.max(0, Number(state.cursor) || 0),
      startedAt: Number(state.startedAt) || now(),
      pendingTaskId: state.pendingTaskId || null,
      results: Array.isArray(state.results) ? state.results.slice(0, 50) : [],
      tokensUsed: Math.max(0, Number(state.tokensUsed) || 0),
    }
    persist()
    return { ok: true, workflow: { ...item } }
  }
  function resume(name) {
    const item = get(name); if (!item) return { ok: false, error: 'not_found' }
    if (!item.runState || item.runState.status !== 'waiting') return { ok: false, error: 'not_waiting' }
    item.runState.status = 'running'
    persist()
    return { ok: true, workflow: { ...item } }
  }
  function cancelRun(name, reason = '') {
    const item = get(name); if (!item) return { ok: false, error: 'not_found' }
    item.lastStatus = 'cancelled'
    item.lastError = clean(reason, 300) || 'cancelled'
    item.runState = null
    persist()
    return { ok: true, workflow: { ...item } }
  }
  function snapshot() { return { ok: true, file, total: workflows.length, workflows: list() } }
  return { file, list, get, upsert, setEnabled, remove, canRun, beginRun, finishRun, setWaiting, resume, cancelRun, snapshot }
}
