// @ts-check
// 通用攻略查询路由：任何 Activity 都能按 topic 请求 B站/攻略回路结果。
import { readChatToken } from '../domain/chat/facade.mjs'

export const GUIDE_ROUTE = '/api/dsh-poetry/guide.json'
const MAX_BODY_BYTES = 32 * 1024

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += b.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(b)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
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
function queryValue(req, name) {
  const raw = typeof req?.url === 'string' ? req.url : ''
  const i = raw.indexOf('?')
  if (i < 0) return ''
  try {
    return new URLSearchParams(raw.slice(i + 1)).get(name) || ''
  } catch {
    return ''
  }
}

export function createGuideHandler(deps = {}) {
  const tokenFile = typeof deps.tokenFile === 'string' ? deps.tokenFile : ''
  const fence = deps.fence && typeof deps.fence.check === 'function' ? deps.fence : null
  const getGuide = typeof deps.getGuide === 'function' ? deps.getGuide : () => null
  function allowed(req, bodyToken) {
    return tokenMatches(bodyToken) || tokenMatches(queryToken(req)) || (fence !== null && safeFence(req))
  }
  function tokenMatches(value) {
    if (typeof value !== 'string' || value.length === 0) return false
    const expected = readChatToken(tokenFile)
    return expected.length > 0 && value === expected
  }
  function safeFence(req) {
    try {
      return fence.check(req) === null
    } catch {
      return false
    }
  }
  return async function guideHandler(req, res) {
    try {
      const guide = getGuide()
      if (!guide || typeof guide.lookup !== 'function')
        return sendJson(res, 200, { ok: false, error: 'guide_unavailable' })
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!allowed(req, '')) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        return sendJson(
          res,
          200,
          await guide.lookup({
            topic: queryValue(req, 'topic'),
            question: queryValue(req, 'question'),
            activity: queryValue(req, 'activity') || 'api',
          }),
        )
      }
      if (method === 'POST') {
        const body = await readBody(req)
        if (!isPlainObject(body)) return sendJson(res, 400, { ok: false, error: 'invalid_body' })
        if (!allowed(req, typeof body.token === 'string' ? body.token : ''))
          return sendJson(res, 403, { ok: false, error: 'forbidden' })
        return sendJson(
          res,
          200,
          await guide.lookup({ topic: body.topic, question: body.question, activity: body.activity || 'api' }),
        )
      }
      res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function registerGuideRoute(deps) {
  const handler = createGuideHandler(deps)
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: GUIDE_ROUTE, handler }))
  return handler
}
