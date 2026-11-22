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
