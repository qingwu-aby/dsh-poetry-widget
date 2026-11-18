// @ts-check
// lib/composition/activity-grants-routes.mjs —— Activity 权限授权 API（Gate K5，token/fence）。
//
// GET  /api/dsh-poetry/activity-grants.json：grants 列表 + 已注册 Activity 的声明权限 + 默认策略说明；
// PUT  /api/dsh-poetry/activity-grants.json：
//   · {grant:{activityId,permission,scope?}} / {activityId,permission,scope?}：写 guard grants（原子写）；
//   · {revoke:{activityId,permission?,scope?}}：撤销；
//   · {reset:true}：清空全部授权。
// 校验：activityId 小写 3–40；permission 属于 tool/model/fs.read/fs.write/net；scope 可选字符串（≤500）。
// 无 guard 时降级 available:false。只写 grants 文件，不执行 Activity。

import { readChatToken } from '../domain/chat/facade.mjs'
import { getActiveHubRuntime } from './hub-runtime.mjs'

/** 路由。 */
export const ACTIVITY_GRANTS_ROUTE = '/api/dsh-poetry/activity-grants.json'

/** 允许授权的权限。 */
export const ACTIVITY_GRANT_PERMISSIONS = Object.freeze(['tool', 'model', 'fs.read', 'fs.write', 'net'])

/** 默认已知 Activity（无运行时时的展示兜底）。 */
export const ACTIVITY_GRANTS_DEFAULT_KNOWN = Object.freeze([
  Object.freeze({ id: 'reading', permissions: Object.freeze(['fs.read', 'tool']) }),
  Object.freeze({ id: 'minecraft', permissions: Object.freeze(['tool']) }),
  Object.freeze({ id: 'study', permissions: Object.freeze(['tool']) }),
  Object.freeze({ id: 'video', permissions: Object.freeze(['tool']) }),
])

const ACTIVITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/
const MAX_BODY_BYTES = 64 * 1024

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
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
  const url = typeof req?.url === 'string' ? req.url : ''
  const index = url.indexOf('?')
  if (index < 0) return ''
  try {
    return new URLSearchParams(url.slice(index + 1)).get('token') ?? ''
  } catch (error) {
    void error
    return ''
  }
}

function normalizeManifestPermissions(manifest) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.permissions)) return []
  const out = []
  for (const item of manifest.permissions) {
    if (typeof item === 'string' && item.length > 0) out.push({ permission: item, scope: null })
    else if (isPlainObject(item) && typeof item.permission === 'string' && item.permission.length > 0) {
      out.push({
        permission: item.permission,
        scope: typeof item.scope === 'string' && item.scope.length > 0 ? item.scope : null,
      })
    }
  }
  return out
}

/**
 * 创建授权 handler。
 * @param {{
 *   guard?: object|null,
 *   getHubRuntime?: (() => object|null)|null,
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   logger?: object|null,
 * }} [options]
 */
export function createActivityGrantsHandler(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const guard = isPlainObject(spec.guard) ? /** @type {any} */ (spec.guard) : null
  const getHubRuntime = typeof spec.getHubRuntime === 'function' ? spec.getHubRuntime : () => getActiveHubRuntime()
  const tokenFile = typeof spec.tokenFile === 'string' ? spec.tokenFile : ''
  const fence = spec.fence ?? null
  const logger = /** @type {any} */ (spec.logger ?? null)

  function tokenMatches(value) {
    if (typeof value !== 'string' || value.length === 0) return false
    const expected = readChatToken(tokenFile)
    return typeof expected === 'string' && expected.length > 0 && value === expected
  }

  function fenceAllows(req) {
    try {
      if (fence === null || typeof fence.check !== 'function') return true
      return fence.check(req) === null
    } catch (error) {
      void error
      return false
    }
  }

  function allows(req, bodyToken) {
    return fenceAllows(req) || tokenMatches(bodyToken) || tokenMatches(queryToken(req))
  }

  function collectKnown() {
    const known = new Map()
    for (const item of ACTIVITY_GRANTS_DEFAULT_KNOWN)
      known.set(item.id, { id: item.id, permissions: item.permissions.slice() })
    try {
      const runtime = getHubRuntime()
      if (runtime !== null && runtime !== undefined && typeof runtime.getAdapters === 'function') {
        for (const id of runtime.getAdapters()) {
          const adapter = typeof runtime.getAdapter === 'function' ? runtime.getAdapter(id) : null
          const permissions = normalizeManifestPermissions(isPlainObject(adapter) ? adapter.manifest : null)
          known.set(id, { id, permissions: permissions.map((item) => item.permission) })
        }
      }
    } catch (error) {
      void error
    }
    return [...known.values()]
  }

  function snapshotPayload() {
    const snapshot = guard.snapshot()
    return {
      ok: true,
      available: true,
      file: snapshot.file,
      exists: snapshot.exists,
      grants: guard.list(),
      known: collectKnown(),
      permissions: ACTIVITY_GRANT_PERMISSIONS.slice(),
      defaultPolicy: {
        baseline: ['tool', 'model'],
        requiresGrant: ['fs.read', 'fs.write', 'net'],
        note: 'tool/model 默认可用；fs.*/net 必须显式授权（scope 前缀匹配）；未声明权限一律拒绝',
      },
      errors: snapshot.errors,
    }
  }

  function validateGrant(input) {
    const errors = []
    const source = isPlainObject(input) ? input : {}
    const activityId = typeof source.activityId === 'string' ? source.activityId.trim() : ''
    if (!ACTIVITY_ID_PATTERN.test(activityId))
      errors.push({ path: 'activityId', message: 'activityId 必须是 3–40 位小写字母/数字/连字符' })
    const permission = typeof source.permission === 'string' ? source.permission.trim() : ''
    if (ACTIVITY_GRANT_PERMISSIONS.indexOf(permission) < 0)
      errors.push({ path: 'permission', message: 'permission 必须是 ' + ACTIVITY_GRANT_PERMISSIONS.join('/') })
    const scope = source.scope === undefined || source.scope === null ? null : String(source.scope).trim()
    if (scope !== null && scope.length > 500) errors.push({ path: 'scope', message: 'scope 过长（>500）' })
    return {
      ok: errors.length === 0,
      errors,
      activityId,
      permission,
      scope: scope !== null && scope.length > 0 ? scope : null,
    }
  }

  return async function activityGrantsHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'PUT') {
        res.writeHead(405, { Allow: 'GET, PUT', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      if (guard === null) {
        sendJson(res, 200, { ok: true, available: false, reason: 'guard-unavailable' })
        return
      }
      let payload = null
      if (method === 'PUT') {
        try {
          payload = await readBody(req)
        } catch (error) {
          void error
          sendJson(res, 400, { ok: false, error: 'invalid_json' })
          return
        }
      }
      const bodyToken = isPlainObject(payload) && typeof payload.token === 'string' ? payload.token : ''
      if (!allows(req, bodyToken)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if (method === 'GET') {
        sendJson(res, 200, snapshotPayload())
        return
      }
      const body = isPlainObject(payload) ? payload : {}
      if (body.reset === true) {
        let removed = 0
        for (const entry of guard.list()) {
          const result = guard.revoke(
            entry.activityId,
            entry.permission,
            entry.scope === null ? undefined : entry.scope,
          )
          if (result !== null && result !== undefined && result.ok === true) removed += Number(result.removed) || 0
        }
        sendJson(res, 200, { ok: true, reset: true, removed, ...snapshotPayload() })
        return
      }
      if (isPlainObject(body.revoke)) {
        const validated = validateGrant(body.revoke)
        if (validated.ok !== true) {
          sendJson(res, 400, { ok: false, error: 'invalid_argument', errors: validated.errors })
          return
        }
        const result = guard.revoke(
          validated.activityId,
          validated.permission,
          validated.scope === null ? undefined : validated.scope,
        )
        sendJson(res, 200, {
          ok: result !== null && result !== undefined && result.ok === true,
          removed: result && result.removed ? result.removed : 0,
          ...snapshotPayload(),
        })
        return
      }
      const grantInput = isPlainObject(body.grant) ? body.grant : body
      const validated = validateGrant(grantInput)
      if (validated.ok !== true) {
        sendJson(res, 400, { ok: false, error: 'invalid_argument', errors: validated.errors })
        return
      }
      const granted = guard.grant(validated.activityId, validated.permission, validated.scope)
      if (granted === null || granted === undefined || granted.ok !== true) {
        sendJson(res, 500, {
          ok: false,
          error: 'write_failed',
          message: granted && granted.message ? granted.message : '',
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        grant: { activityId: validated.activityId, permission: validated.permission, scope: validated.scope },
        ...snapshotPayload(),
      })
    } catch (error) {
      try {
        logger?.warn?.(
          `[dsh-little-whale] activity-grants 路由失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } catch (warnError) {
        void warnError
      }
      sendJson(res, 500, { ok: false, error: 'internal_error' })
    }
  }
}

/**
 * 注册授权路由（http-wiring 调用）。
 * @param {{webServer: any, disposers?: Array<Function>, guard?: object|null, getHubRuntime?: Function|null, tokenFile?: string, fence?: object|null, logger?: object|null}} deps
 */
export function registerActivityGrantsRoute(deps) {
  const handler = createActivityGrantsHandler({
    guard: deps.guard ?? null,
    getHubRuntime: typeof deps.getHubRuntime === 'function' ? /** @type {any} */ (deps.getHubRuntime) : null,
    tokenFile: deps.tokenFile,
    fence: deps.fence ?? null,
    logger: deps.logger ?? null,
  })
  const registration = deps.webServer.register({ kind: 'exact', path: ACTIVITY_GRANTS_ROUTE, handler })
  if (Array.isArray(deps.disposers) && registration !== null && registration !== undefined) {
    if (typeof registration === 'function') deps.disposers.push(registration)
    else if (typeof registration.dispose === 'function') deps.disposers.push(() => registration.dispose())
  }
  return handler
}
