// @ts-check
// Phase 3A：工作流定义/预算 API（只存储/校验/计费，不执行步骤）。
import path from 'node:path'
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
export function createWorkflowHandler(deps = {}) {
  const tokenFile = typeof deps.tokenFile === 'string' ? deps.tokenFile : ''
  const fence = deps.fence && typeof deps.fence.check === 'function' ? deps.fence : null
  const file =
    typeof deps.file === 'string' ? deps.file : path.join(deps.home || '', '.dsh', '.dsh-poetry', 'workflows.json')
  const registry = createWorkflowRegistry({ file, allowedActivities: ALLOWED_ACTIVITIES })
  const minecraftQueue = deps.minecraftQueue ?? null
  const hubRuntimeProvider = typeof deps.hubRuntimeProvider === 'function' ? deps.hubRuntimeProvider : () => null
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
        const finished = registry.finishRun(workflow.name, {
          ok: false,
          tokensUsed,
          durationMs: Date.now() - began,
          error: 'duration_exceeded',
        })
        return { ok: false, workflow: finished.workflow, results }
      }
      if (workflow.budget.maxTokens > 0 && tokensUsed >= workflow.budget.maxTokens) {
        const finished = registry.finishRun(workflow.name, {
          ok: false,
          tokensUsed,
          durationMs: Date.now() - began,
          error: 'tokens_exceeded',
        })
        return { ok: false, workflow: finished.workflow, results }
      }
      const result = await dispatchStep(step, workflow.name)
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
        const finished = registry.finishRun(workflow.name, {
          ok: false,
          tokensUsed,
          durationMs: Date.now() - began,
          error: result.error || 'step_failed',
        })
        return { ok: false, workflow: finished.workflow, results }
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

  return async function workflowHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!allowed(req, '')) return sendJson(res, 403, { ok: false, error: 'forbidden' })
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
          const result = await runSteps(started.workflow, 0, [], 0, began)
          return sendJson(res, 200, result)
        }
        if (action === 'resume') {
          const workflow = registry.get(name)
          if (!workflow) return sendJson(res, 200, { ok: false, error: 'not_found' })
          if (!workflow.runState || workflow.runState.status !== 'waiting')
            return sendJson(res, 200, { ok: false, error: 'not_waiting' })
          const task =
            minecraftQueue && workflow.runState.pendingTaskId
              ? minecraftQueue.get(workflow.runState.pendingTaskId)
              : null
          if (!task || ['queued', 'running'].includes(task.status))
            return sendJson(res, 200, { ok: true, pending: true, workflow })
          if (!['done'].includes(task.status)) {
            const finished = registry.finishRun(name, {
              ok: false,
              tokensUsed: workflow.runState.tokensUsed,
              durationMs: Date.now() - workflow.runState.startedAt,
              error: 'minecraft_task_' + task.status,
            })
            return sendJson(res, 200, { ok: false, workflow: finished.workflow, result: task })
          }
          const resumed = registry.resume(name)
          if (resumed.ok !== true) return sendJson(res, 200, resumed)
          const results = Array.isArray(resumed.workflow.runState.results)
            ? resumed.workflow.runState.results.slice()
            : []
          results.push({
            step: workflow.steps[Math.max(0, resumed.workflow.runState.cursor - 1)],
            ok: true,
            pending: true,
            taskId: task.taskId,
            receipt: task.receipt,
          })
          const next = await runSteps(
            resumed.workflow,
            resumed.workflow.runState.cursor,
            results,
            resumed.workflow.runState.tokensUsed,
            resumed.workflow.runState.startedAt,
          )
          return sendJson(res, 200, next)
        }
        return sendJson(res, 400, { ok: false, error: 'invalid_action' })
      }
      res.writeHead(405, { Allow: 'GET, PUT, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
export function registerWorkflowRoute(deps) {
  const handler = createWorkflowHandler(deps)
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: WORKFLOW_ROUTE, handler }))
  return handler
}
