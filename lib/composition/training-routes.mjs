// @ts-check
// lib/composition/training-routes.mjs —— 训练旁路管理 API（Gate H2，默认关闭，不启动真实训练）。
//
// 目标：把 G2 的 training-service 暴露为受保护的本地 HTTP API：
//   · GET  /api/dsh-poetry/training.json：status + plan + config（只读）；
//   · POST /api/dsh-poetry/training.json：{action, confirm?, target?}
//       status | plan | config（只读）
//       run（必须 config.enabled=true + confirm:true + 注入 runner；默认无 runner → 拒绝）
//       cancel
//       promote / rollback（必须 confirm:true）
//   · 鉴权：GET 用 DSH trust fence 或 chat token（?token=）；POST 用 body.token 或 fence；
//   · 默认关闭：config.enabled=false → run 一律拒绝；本模块不 spawn、不写 adapter；
//   · 无 service 时降级（GET available:false / POST TRAINING_UNAVAILABLE），异常隔离为 500。
//   · 不接 UI；不改变现有路由。

import { readChatToken } from '../domain/chat/facade.mjs'

/** 训练管理路由。 */
export const TRAINING_ROUTE = '/api/dsh-poetry/training.json'

/** 支持的 POST action。 */
export const TRAINING_ACTIONS = Object.freeze(['status', 'plan', 'config', 'run', 'cancel', 'promote', 'rollback'])

const MAX_BODY_BYTES = 128 * 1024

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
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function readConfigSummary(service) {
  try {
    const store = service && service.configStore
    if (!store || typeof store.read !== 'function') return null
    const state = store.read()
    return {
      file: state.file,
      exists: state.exists,
      config: state.config,
      errors: state.errors,
      updatedAt: state.updatedAt,
    }
  } catch (error) {
    void error
    return null
  }
}

/**
 * 创建训练管理 handler。
 * @param {{
 *   service?: object|null,
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   logger?: object|null,
 * }} [options]
 */
export function createTrainingHandler(options = {}) {
  const service = isPlainObject(options.service) ? options.service : null
  const serviceRef = /** @type {any} */ (service)
  const tokenFile = typeof options.tokenFile === 'string' ? options.tokenFile : ''
  const fence = options.fence ?? null
  const logger = /** @type {any} */ (options.logger ?? null)

  function fenceAllows(req) {
    try {
      if (fence === null || typeof fence.check !== 'function') return true
      return fence.check(req) === null
    } catch (error) {
      void error
      return false
    }
  }

  function tokenMatches(candidate) {
    try {
      const expected = readChatToken(tokenFile)
      return expected.length > 0 && candidate === expected
    } catch (error) {
      void error
      return false
    }
  }

  function queryToken(req) {
    try {
      return new URL(req?.url ?? '/', 'http://127.0.0.1').searchParams.get('token') ?? ''
    } catch (error) {
      void error
      return ''
    }
  }

  function readOnlyPayload() {
    if (service === null) {
      return {
        ok: true,
        available: false,
        status: null,
        plan: null,
        config: null,
        actions: TRAINING_ACTIONS.slice(),
        note: '训练服务未接入（默认关闭）',
      }
    }
    let status = null
    let plan = null
    try {
      status = typeof serviceRef.status === 'function' ? serviceRef.status() : null
      plan = typeof serviceRef.plan === 'function' ? serviceRef.plan() : null
    } catch (error) {
      void error
    }
    return {
      ok: true,
      available: true,
      status,
      plan,
      config: readConfigSummary(service),
      actions: TRAINING_ACTIONS.slice(),
    }
  }

  return async function trainingHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!fenceAllows(req) && !tokenMatches(queryToken(req))) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        sendJson(res, 200, readOnlyPayload())
        return
      }
      if (method !== 'POST') {
        res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let payload = null
      try {
        payload = await readBody(req)
      } catch (error) {
        void error
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const bodyToken = isPlainObject(payload) && typeof payload.token === 'string' ? payload.token : ''
      if (!tokenMatches(bodyToken) && !fenceAllows(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const action = isPlainObject(payload) && typeof payload.action === 'string' ? payload.action : ''
      if (TRAINING_ACTIONS.indexOf(action) < 0) {
        sendJson(res, 400, { ok: false, error: 'unknown_action', actions: TRAINING_ACTIONS })
        return
      }
      if (service === null) {
        sendJson(res, 200, { ok: false, code: 'TRAINING_UNAVAILABLE', message: '训练服务未接入' })
        return
      }
      if (action === 'status' || action === 'plan' || action === 'config') {
        sendJson(res, 200, readOnlyPayload())
        return
      }
      if (action === 'run') {
        const result = await serviceRef.run({ confirm: payload.confirm === true })
        sendJson(res, 200, result)
        return
      }
      if (action === 'cancel') {
        const result = await serviceRef.cancel()
        sendJson(res, 200, result)
        return
      }
      if (action === 'promote') {
        const result = serviceRef.promote({ confirm: payload.confirm === true })
        sendJson(res, 200, result)
        return
      }
      const target = isPlainObject(payload) && typeof payload.target === 'string' ? payload.target : undefined
      const result = serviceRef.rollback({
        confirm: payload.confirm === true,
        ...(target === undefined ? {} : { target }),
      })
      sendJson(res, 200, result)
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 训练路由失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (warnError) {
        void warnError
      }
      try {
        sendJson(res, 500, {
          ok: false,
          error: { code: 'TRAINING_ROUTE_FAILED', message: error instanceof Error ? error.message : String(error) },
        })
      } catch (sendError) {
        void sendError
      }
    }
  }
}

/**
 * 注册训练管理路由（http-wiring 调用）。
 * @param {{webServer: any, disposers: Array<Function>, service?: object|null, tokenFile?: string, fence?: object|null, logger?: object|null}} deps
 */
export function registerTrainingRoute(deps) {
  const handler = createTrainingHandler({
    service: deps.service ?? null,
    tokenFile: deps.tokenFile,
    fence: deps.fence ?? null,
    logger: deps.logger ?? null,
  })
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: TRAINING_ROUTE, handler }))
  return handler
}
