// @ts-check
// Phase 3A：工作流定义/预算 API（只存储/校验/计费，不执行步骤）。
import path from 'node:path'
import { skillContextForActivity } from '../core/tool-experience.mjs'
import { createWorkflowRegistry, validateWorkflow } from '../core/workflow-registry.mjs'
import { readChatToken } from '../domain/chat/facade.mjs'

export const WORKFLOW_ROUTE = '/api/dsh-poetry/workflows.json'
const ALLOWED_ACTIVITIES = new Set(['chat', 'minecraft', 'reading', 'study', 'video'])

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function queryToken(req) {
  const raw = typeof req?.url === 'string' ? req.url : ''
  const i = raw.indexOf('?')
  if (i < 0) return ''
  try {
    return new URLSearchParams(raw.slice(i + 1)).get('token') || ''
  } catch {
    return ''
  }
}
function queryValue(req, key) {
  const raw = typeof req?.url === 'string' ? req.url : ''
  const i = raw.indexOf('?')
  if (i < 0) return ''
  try {
    return new URLSearchParams(raw.slice(i + 1)).get(key) || ''
  } catch (error) {
    void error
    return ''
  }
}
export function createWorkflowHandler(deps = {}) {
  const tokenFile = typeof deps.tokenFile === 'string' ? deps.tokenFile : ''
  const fence = deps.fence && typeof deps.fence.check === 'function' ? deps.fence : null
  const file =
    typeof deps.file === 'string' ? deps.file : path.join(deps.home || '', '.dsh', '.dsh-poetry', 'workflows.json')
  const registry = createWorkflowRegistry({ file, allowedActivities: ALLOWED_ACTIVITIES })
  const minecraftQueue = deps.minecraftQueue ?? null
  const hubRuntimeProvider = typeof deps.hubRuntimeProvider === 'function' ? deps.hubRuntimeProvider : () => null
  const toolExperience = deps.toolExperience ?? null
  const maxConcurrent = Math.max(1, Math.min(8, Number(deps.maxConcurrent) || 1))
  const activeRuns = new Set()
  async function executeWorkflow(workflow, startCursor, previousResults, previousTokens, began) {
    if (activeRuns.size >= maxConcurrent) return { ok: false, error: 'concurrency_limit', workflow }
    activeRuns.add(workflow.name)
    try {
      return await runSteps(workflow, startCursor, previousResults, previousTokens, began)
    } finally {
      activeRuns.delete(workflow.name)
    }
  }
  async function dispatchStep(step, workflowName) {
    if (step.activity === 'minecraft') {
      if (!minecraftQueue || typeof minecraftQueue.create !== 'function')
        return { ok: false, error: 'minecraft_queue_unavailable' }
      const taskId = 'wf-' + workflowName + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
      const created = minecraftQueue.create({ taskId, tool: step.tool, arguments: step.arguments, priority: 10 })
      if (!created || created.ok !== true)
        return { ok: false, error: created && created.error ? created.error : 'queue_create_failed' }
      return { ok: true, pending: true, taskId, detail: 'minecraft 任务已入队，由 bot 领取' }
    }
    const runtime = hubRuntimeProvider()
    const adapter = runtime && typeof runtime.getAdapter === 'function' ? runtime.getAdapter(step.activity) : null
    if (!adapter || typeof adapter.execute !== 'function') return { ok: false, error: 'adapter_unavailable' }
    try {
      const result = await adapter.execute(
        { activity: step.activity, kind: step.tool, payload: { tool: step.tool, arguments: step.arguments } },
        { now: () => Date.now() },
      )
      const receipt = result && result.receipt ? result.receipt : null
      return {
        ok: result && result.ok === true,
        receipt,
        tokensUsed:
          receipt && receipt.facts && Number(receipt.facts.tokensUsed) > 0 ? Number(receipt.facts.tokensUsed) : 0,
        detail: receipt && receipt.detail ? receipt.detail : '',
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  async function rollbackWorkflow(workflow, results = []) {
    const completed = (Array.isArray(results) ? results : [])
      .filter((item) => item && item.ok === true && item.pending !== true && item.step)
      .map((item) => item.step)
      .reverse()
    const steps = []
    for (const step of completed) if (Array.isArray(step.rollback)) steps.push(...step.rollback)
    if (Array.isArray(workflow.rollback)) steps.push(...workflow.rollback.slice().reverse())
    const out = []
    let failed = false
    for (const step of steps) {
      try {
        const result = await dispatchStep(step, workflow.name)
        out.push({ step, ...result, compensation: true })
        if (result.ok !== true) failed = true
      } catch (error) {
        failed = true
        out.push({ step, ok: false, compensation: true, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (failed) out.push({ compensationFailed: true })
    return out
  }

  const tokenOk = (value) => {
    if (typeof value !== 'string' || value.length === 0) return false
    const expected = readChatToken(tokenFile)
    return expected.length > 0 && value === expected
  }
  const allowed = (req, bodyToken) =>
    tokenOk(bodyToken) ||
    tokenOk(queryToken(req)) ||
    (fence !== null &&
      (() => {
        try {
          return fence.check(req) === null
        } catch {
          return false
        }
      })())
  async function runSteps(workflow, startCursor, previousResults, previousTokens, began) {
    const results = Array.isArray(previousResults) ? previousResults.slice() : []
    let tokensUsed = Math.max(0, Number(previousTokens) || 0)
    const steps = Array.isArray(workflow.steps) ? workflow.steps : []
    for (let index = Math.max(0, Number(startCursor) || 0); index < steps.length; index += 1) {
      const step = steps[index]
      if (Date.now() - began > workflow.budget.maxDurationMs) {
        const rollback = await rollbackWorkflow(workflow, results)
        const finished = registry.finishRun(workflow.name, {
          ok: false,
          tokensUsed,
          durationMs: Date.now() - began,
          error: 'duration_exceeded',
        })
        return { ok: false, workflow: finished.workflow, results: [...results, ...rollback] }
      }
      if (workflow.budget.maxTokens > 0 && tokensUsed >= workflow.budget.maxTokens) {
        const rollback = await rollbackWorkflow(workflow, results)
        const finished = registry.finishRun(workflow.name, {
          ok: false,
          tokensUsed,
          durationMs: Date.now() - began,
          error: 'tokens_exceeded',
        })
        return { ok: false, workflow: finished.workflow, results: [...results, ...rollback] }
      }
      const result = await dispatchStep(step, workflow.name)
      if (toolExperience && typeof toolExperience.record === 'function' && result.pending !== true) {
        toolExperience.record({
          scope: 'activity:' + step.activity,
          tool: step.tool,
          context: skillContextForActivity(step.activity, { arguments: step.arguments }),
          ok: result.ok === true,
          arguments: step.arguments,
        })
      }
      tokensUsed += Math.max(0, Number(result.tokensUsed) || 0)
      if (result.pending === true) {
        results.push({ step, ...result })
        const waiting = registry.setWaiting(workflow.name, {
          cursor: index + 1,
          pendingTaskId: result.taskId || null,
          results,
          tokensUsed,
          startedAt: began,
        })
        return { ok: true, pending: true, workflow: waiting.workflow, results }
      }
      results.push({ step, ...result })
      if (result.ok !== true) {
        const rollback = await rollbackWorkflow(workflow, results)
        const finished = registry.finishRun(workflow.name, {
          ok: false,
          tokensUsed,
          durationMs: Date.now() - began,
          error: result.error || 'step_failed',
        })
        return { ok: false, workflow: finished.workflow, results: [...results, ...rollback] }
      }
    }
    const finished = registry.finishRun(workflow.name, {
      ok: true,
      tokensUsed,
      durationMs: Date.now() - began,
      error: '',
    })
    return { ok: true, workflow: finished.workflow, results }
  }

  async function resumeWorkflow(name) {
    const workflow = registry.get(name)
    if (!workflow) return { ok: false, error: 'not_found' }
    if (!workflow.runState || workflow.runState.status !== 'waiting') return { ok: false, error: 'not_waiting' }
    if (Date.now() - workflow.runState.startedAt > workflow.budget.maxDurationMs) {
      const finished = registry.finishRun(name, {
        ok: false,
        tokensUsed: workflow.runState.tokensUsed,
        durationMs: Date.now() - workflow.runState.startedAt,
        error: 'duration_exceeded',
      })
      return { ok: false, workflow: finished.workflow }
    }
    const task =
      minecraftQueue && workflow.runState.pendingTaskId ? minecraftQueue.get(workflow.runState.pendingTaskId) : null
    if (!task || ['queued', 'running'].includes(task.status)) return { ok: true, pending: true, workflow }
    if (!['done'].includes(task.status)) {
      const rollback = await rollbackWorkflow(workflow, workflow.runState.results)
      const finished = registry.finishRun(name, {
        ok: false,
        tokensUsed: workflow.runState.tokensUsed,
        durationMs: Date.now() - workflow.runState.startedAt,
        error: 'minecraft_task_' + task.status,
      })
      return { ok: false, workflow: finished.workflow, result: task, compensation: rollback }
    }
    if (activeRuns.size >= maxConcurrent) return { ok: false, error: 'concurrency_limit', workflow }
    const resumed = registry.resume(name)
    if (resumed.ok !== true) return resumed
    const results = Array.isArray(resumed.workflow.runState.results) ? resumed.workflow.runState.results.slice() : []
    results.push({
      step: workflow.steps[Math.max(0, resumed.workflow.runState.cursor - 1)],
      ok: true,
      pending: true,
      taskId: task.taskId,
      receipt: task.receipt,
    })
    return runSteps(
      resumed.workflow,
      resumed.workflow.runState.cursor,
      results,
      resumed.workflow.runState.tokensUsed,
      resumed.workflow.runState.startedAt,
    )
  }

  const handler = async function workflowHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!allowed(req, '')) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const experienceScope = queryValue(req, 'experience')
        if (experienceScope && toolExperience) {
          const contextRaw = queryValue(req, 'context')
          let context = {}
          if (contextRaw) {
            try {
              context = JSON.parse(contextRaw)
            } catch (error) {
              void error
              return sendJson(res, 400, { ok: false, error: 'invalid_context' })
            }
          }
          return sendJson(res, 200, {
            ok: true,
            scope: experienceScope,
            context,
            skills: toolExperience.summary({ scope: experienceScope, context, limit: 20 }),
          })
        }
        return sendJson(res, 200, registry.snapshot())
      }
      if (method === 'PUT') {
        const body = await readBody(req)
        const bodyToken = body && typeof body.token === 'string' ? body.token : ''
        if (!allowed(req, bodyToken)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const validated = validateWorkflow(body, { allowedActivities: ALLOWED_ACTIVITIES })
        if (validated.ok !== true) return sendJson(res, 400, { ok: false, error: validated.error })
        return sendJson(res, 200, registry.upsert(validated))
      }
      if (method === 'POST') {
        const body = await readBody(req)
        const bodyToken = body && typeof body.token === 'string' ? body.token : ''
        if (!allowed(req, bodyToken)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const action = body && typeof body.action === 'string' ? body.action : ''
        const name = body && typeof body.name === 'string' ? body.name : ''
        if (action === 'enable' || action === 'disable')
          return sendJson(res, 200, registry.setEnabled(name, action === 'enable'))
        if (action === 'delete') return sendJson(res, 200, registry.remove(name))
        if (action === 'check') return sendJson(res, 200, registry.canRun(name))
        if (action === 'record') return sendJson(res, 200, registry.finishRun(name, body.result || {}))
        if (action === 'run') {
          const started = registry.beginRun(name)
          if (started.ok !== true) return sendJson(res, 200, started)
          const began = Date.now()
          const result = await executeWorkflow(started.workflow, 0, [], 0, began)
          return sendJson(res, 200, result)
        }
        if (action === 'resume') {
          const result = await resumeWorkflow(name)
          return sendJson(res, 200, result)
        }
        if (action === 'cancel') {
          const workflow = registry.get(name)
          if (
            workflow &&
            workflow.runState &&
            workflow.runState.pendingTaskId &&
            minecraftQueue &&
            typeof minecraftQueue.cancel === 'function'
          ) {
            try {
              minecraftQueue.cancel(workflow.runState.pendingTaskId)
            } catch (error) {
              void error
            }
          }
          return sendJson(res, 200, registry.cancelRun(name, 'user_cancelled'))
        }
        return sendJson(res, 400, { ok: false, error: 'invalid_action' })
      }
      res.writeHead(405, { Allow: 'GET, PUT, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  handler.handleEvent = async (event) => {
    const type = event && typeof event.type === 'string' ? event.type : ''
    if (!type) return []
    const candidates = registry
      .list()
      .filter(
        (item) =>
          item.enabled &&
          item.trigger &&
          item.trigger.type === 'event' &&
          (item.trigger.eventType === type || item.trigger.eventType === '*'),
      )
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    const results = []
    for (const item of candidates) {
      if (registry.canRun(item.name).ok !== true) continue
      const started = registry.beginRun(item.name)
      if (started.ok !== true) continue
      if (activeRuns.size >= maxConcurrent) {
        results.push({ name: item.name, skipped: 'concurrency_limit' })
        break
      }
      results.push({ name: item.name, result: await executeWorkflow(started.workflow, 0, [], 0, Date.now()) })
    }
    return results
  }
  handler.resumeAll = async () => {
    const waiting = registry.list().filter((item) => item.runState && item.runState.status === 'waiting')
    const results = []
    for (const item of waiting) {
      try {
        results.push({ name: item.name, result: await resumeWorkflow(item.name) })
      } catch (error) {
        results.push({ name: item.name, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return results
  }
  return handler
}
export function registerWorkflowRoute(deps) {
  const handler = createWorkflowHandler(deps)
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: WORKFLOW_ROUTE, handler }))
  const timer = setInterval(() => {
    handler.resumeAll().catch(() => {})
  }, 5000)
  timer.unref?.()
  deps.disposers.push(() => clearInterval(timer))
  try {
    const runtime = deps.hubRuntimeProvider && deps.hubRuntimeProvider()
    const instances = runtime && typeof runtime.getInstances === 'function' ? runtime.getInstances() : null
    const bus = instances && instances.eventBus
    if (bus && typeof bus.subscribe === 'function') {
      const off = bus.subscribe('*', (event) => {
        handler.handleEvent(event).catch(() => {})
      })
      deps.disposers.push(off)
    }
  } catch (error) {
    void error
  }
  return handler
}
