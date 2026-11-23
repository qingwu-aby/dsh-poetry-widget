// @ts-check
// 原语申请只读/审核 API：申请由她在游戏里提交，用户在这里审核，不自动实现。
import { readChatToken } from '../domain/chat/facade.mjs'

export const CAPABILITY_ROUTE = '/api/dsh-poetry/capability-proposals.json'
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}
function tokenFrom(req, body) {
  if (body && typeof body === 'object' && typeof body.token === 'string') return body.token
  const raw = typeof req?.url === 'string' ? req.url : ''
  const i = raw.indexOf('?')
  if (i < 0) return ''
  try {
    return new URLSearchParams(raw.slice(i + 1)).get('token') || ''
  } catch (error) {
    void error
    return ''
  }
}
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function createCapabilityHandler(deps = {}) {
  const tokenFile = typeof deps.tokenFile === 'string' ? deps.tokenFile : ''
  const fence = deps.fence && typeof deps.fence.check === 'function' ? deps.fence : null
  const proposals = deps.proposals ?? null
  const tokenOk = (value) => {
    if (typeof value !== 'string' || !value) return false
    const expected = readChatToken(tokenFile)
    return expected.length > 0 && value === expected
  }
  const allowed = (req, body) =>
    tokenOk(tokenFrom(req, body)) ||
    (fence !== null &&
      (() => {
        try {
          return fence.check(req) === null
        } catch (error) {
          void error
          return false
        }
      })())
  return async function handler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!allowed(req, null)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (!proposals || typeof proposals.list !== 'function')
          return sendJson(res, 503, { ok: false, error: 'proposals_unavailable' })
        return sendJson(res, 200, proposals.list())
      }
      if (method === 'POST') {
        const body = await readBody(req)
        if (!allowed(req, body)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (!proposals || typeof proposals.propose !== 'function')
          return sendJson(res, 503, { ok: false, error: 'proposals_unavailable' })
        const action = body && typeof body.action === 'string' ? body.action : ''
        if (action === 'create')
          return sendJson(
            res,
            200,
            proposals.propose({
              activityId: 'minecraft',
              capability: body.capability,
              reason: body.reason,
              evidence: body.evidence,
            }),
          )
        if (action === 'status') return sendJson(res, 200, proposals.setStatus(body.id, body.status, body.note))
        return sendJson(res, 400, { ok: false, error: 'invalid_action' })
      }
      res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
export function registerCapabilityRoute(deps) {
  const handler = createCapabilityHandler(deps)
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: CAPABILITY_ROUTE, handler }))
  return handler
}
