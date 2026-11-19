// @ts-check
// DeepSeek 搜索 API Key 管理路由：GET 只回显状态/后四位，PUT/DELETE 写私有文件。
import { readChatToken } from '../domain/chat/facade.mjs'
import {
  clearStoredDeepSeekKey,
  deepSeekKeyStatus,
  writeStoredDeepSeekKey,
} from '../domain/integration/deepseek-secret.mjs'

export const SEARCH_KEY_ROUTE = '/api/dsh-poetry/search-key.json'

const MAX_BODY_BYTES = 8 * 1024

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (size === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function queryToken(req) {
  const raw = typeof req?.url === 'string' ? req.url : ''
  const index = raw.indexOf('?')
  if (index < 0) return ''
  try {
    return new URLSearchParams(raw.slice(index + 1)).get('token') || ''
  } catch {
    return ''
  }
}

/**
 * @param {{tokenFile?: string, fence?: {check?: Function}|null, env?: NodeJS.ProcessEnv, home?: string|null, logger?: object|null}} deps
 */
export function createSearchKeyHandler(deps = {}) {
  const tokenFile = typeof deps.tokenFile === 'string' ? deps.tokenFile : ''
  const fence = deps.fence && typeof deps.fence.check === 'function' ? deps.fence : null
  const env = /** @type {any} */ (deps.env ?? process.env)
  const home = deps.home ?? null
  const logger = /** @type {any} */ (deps.logger ?? null)
  function tokenMatches(value) {
    if (typeof value !== 'string' || value.length === 0) return false
    const expected = readChatToken(tokenFile)
    return expected.length > 0 && value === expected
  }
  function allowed(req, bodyToken) {
    return tokenMatches(bodyToken) || tokenMatches(queryToken(req)) || (fence !== null && safeFence(req))
  }
  function safeFence(req) {
    try {
      return fence.check(req) === null
    } catch {
      return false
    }
  }
  return async function searchKeyHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!allowed(req, '')) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        return sendJson(res, 200, deepSeekKeyStatus(env, home))
      }
      if (method === 'PUT') {
        const body = await readBody(req)
        const bodyToken = isPlainObject(body) && typeof body.token === 'string' ? body.token : ''
        if (!allowed(req, bodyToken)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const key = isPlainObject(body) && typeof body.key === 'string' ? body.key : ''
        const written = writeStoredDeepSeekKey(key, env, home)
        if (written.ok !== true) return sendJson(res, 400, { ok: false, error: written.error || 'invalid_key' })
        return sendJson(res, 200, { ok: true, ...deepSeekKeyStatus(env, home), restartRequired: true })
      }
      if (method === 'DELETE') {
        const body = await readBody(req)
        const bodyToken = isPlainObject(body) && typeof body.token === 'string' ? body.token : ''
        if (!allowed(req, bodyToken)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const cleared = clearStoredDeepSeekKey(env, home)
        if (cleared.ok !== true) return sendJson(res, 500, { ok: false, error: cleared.error || 'clear_failed' })
        return sendJson(res, 200, { ok: true, ...deepSeekKeyStatus(env, home), restartRequired: true })
      }
      res.writeHead(405, { Allow: 'GET, PUT, DELETE', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
    } catch (error) {
      try {
        logger?.warn?.(
          `[dsh-little-whale] search-key 路由失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } catch {
        /* ignore */
      }
      sendJson(res, 500, { ok: false, error: 'internal_error' })
    }
  }
}

/** @param {{webServer: any, disposers?: Function[], tokenFile?: string, fence?: object|null, env?: object, home?: string|null, logger?: object|null}} deps */
export function registerSearchKeyRoute(deps) {
  const handler = createSearchKeyHandler(/** @type {any} */ (deps))
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: SEARCH_KEY_ROUTE, handler }))
  return handler
}
