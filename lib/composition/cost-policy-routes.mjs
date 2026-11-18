// @ts-check
// lib/composition/cost-policy-routes.mjs —— 成本策略配置 API（Gate N3，token/fence 保护）。
//
// GET  /api/dsh-poetry/cost-policy.json：返回当前配置 + 允许范围 + 生效 overrides；
// PUT  /api/dsh-poetry/cost-policy.json：
//   · {config:{...}}：白名单字段/非负整数校验 → 写 store → 调用 apply(config) 让 runtime 重建 cost guard（实时生效）；
//   · {reset:true}：恢复默认空策略并 apply。
// 无 store 时降级 available:false。只读写本地配置，不调用模型。

import { readChatToken } from '../domain/chat/facade.mjs'
import { createCostGuard } from '../domain/host/cost-guard.mjs'
import {
  COST_POLICY_EDITABLE_FIELDS,
  COST_POLICY_RANGES,
  costConfigToOverrides,
  createCostPolicyStore,
  normalizeCostPolicyConfig,
  validateCostPolicyConfig,
} from '../domain/host/cost-policy-store.mjs'
import { configureModelRuntime } from '../kernel/llm-call.mjs'

/** 路由。 */
export const COST_POLICY_ROUTE = '/api/dsh-poetry/cost-policy.json'

/** 可编辑字段（供 UI 渲染）。 */
export const COST_POLICY_FIELDS = COST_POLICY_EDITABLE_FIELDS

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

/**
 * 创建“实时应用”函数：用新配置重建 cost guard 并注入模型运行时（无需重启）。
 * @param {{env?: object, settings?: object, budget?: object|null, gate?: object|null, logger?: object|null}} deps
 */
export function createCostPolicyApplier(deps = {}) {
  const spec = isPlainObject(deps) ? deps : {}
  return function applyCostPolicy(config) {
    try {
      const costGuard = createCostGuard({
        env: spec.env,
        settings: spec.settings,
        overrides: costConfigToOverrides(config),
        logger: spec.logger ?? null,
      })
      configureModelRuntime({ budget: spec.budget ?? null, gate: spec.gate ?? null, costGuard })
      return { ok: true, effective: costConfigToOverrides(config) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}

/**
 * 一次性创建 store + cost guard + apply（供 plugin-runtime 装配）。
 * @param {{file?: string, env?: object, settings?: object, budget?: object|null, gate?: object|null, logger?: object|null, now?: () => number}} deps
 */
export function createCostPolicyRuntime(deps = {}) {
  const spec = isPlainObject(deps) ? deps : {}
  const store = createCostPolicyStore({ file: spec.file, now: spec.now, logger: spec.logger ?? null })
  const costGuard = createCostGuard({
    env: spec.env,
    settings: spec.settings,
    overrides: costConfigToOverrides(store.read().config),
    logger: spec.logger ?? null,
  })
  const apply = createCostPolicyApplier({
    env: spec.env,
    settings: spec.settings,
    budget: spec.budget,
    gate: spec.gate,
    logger: spec.logger,
  })
  return { store, costGuard, apply }
}

/**
 * 创建成本策略 handler。
 * @param {{
 *   store?: object|null,
 *   apply?: ((config: object) => object)|null,
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   logger?: object|null,
 * }} [options]
 */
export function createCostPolicyHandler(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const store = isPlainObject(spec.store) ? /** @type {any} */ (spec.store) : null
  const apply = typeof spec.apply === 'function' ? /** @type {any} */ (spec.apply) : null
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

  function snapshotPayload() {
    const state = store.read()
    const effective = costConfigToOverrides(state.config)
    return {
      ok: true,
      available: true,
      file: state.file,
      exists: state.exists,
      updatedAt: state.updatedAt,
      config: state.config,
      errors: state.errors,
      effective,
      ranges: COST_POLICY_RANGES,
      fields: COST_POLICY_FIELDS.slice(),
    }
  }

  return async function costPolicyHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'PUT') {
        res.writeHead(405, { Allow: 'GET, PUT', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      if (store === null) {
        sendJson(res, 200, { ok: true, available: false, reason: 'store-unavailable' })
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
      // PUT
      const body = isPlainObject(payload) ? payload : {}
      if (body.reset === true) {
        const resetResult = store.reset()
        if (resetResult.ok !== true) {
          sendJson(res, 500, { ok: false, error: 'write_failed', message: resetResult.message ?? '' })
          return
        }
        const applied = apply === null ? null : apply(resetResult.config)
        sendJson(res, 200, {
          ok: true,
          reset: true,
          config: resetResult.config,
          applied: applied === null ? null : { ok: applied.ok === true },
        })
        return
      }
      const patch = isPlainObject(body.config) ? body.config : body
      const strict = validateCostPolicyConfig(patch)
      if (strict.ok !== true) {
        sendJson(res, 400, { ok: false, error: 'invalid_config', errors: strict.errors })
        return
      }
      const validated = normalizeCostPolicyConfig(patch, store.read().config)
      if (validated.ok !== true) {
        sendJson(res, 400, { ok: false, error: 'invalid_config', errors: validated.errors })
        return
      }
      const written = store.write(validated.config)
      if (written.ok !== true) {
        sendJson(res, 500, {
          ok: false,
          error: 'write_failed',
          errors: written.errors ?? [],
          message: written.message ?? '',
        })
        return
      }
      const applied = apply === null ? null : apply(written.config)
      if (applied !== null && applied.ok !== true) {
        try {
          logger?.warn?.('[dsh-little-whale] cost-policy 已保存但实时应用失败')
        } catch (error) {
          void error
        }
      }
      sendJson(res, 200, {
        ok: true,
        updatedAt: written.updatedAt,
        config: written.config,
        effective: costConfigToOverrides(written.config),
        applied:
          applied === null
            ? null
            : { ok: applied.ok === true, ...(isPlainObject(applied) ? { effective: applied.effective ?? null } : {}) },
      })
    } catch (error) {
      try {
        logger?.warn?.(
          `[dsh-little-whale] cost-policy 路由失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } catch (warnError) {
        void warnError
      }
      sendJson(res, 500, { ok: false, error: 'internal_error' })
    }
  }
}

/**
 * 注册成本策略路由（http-wiring 调用）。
 * @param {{webServer: any, disposers?: Array<Function>, store?: object|null, apply?: Function|null, tokenFile?: string, fence?: object|null, logger?: object|null}} deps
 */
export function registerCostPolicyRoute(deps) {
  const handler = createCostPolicyHandler({
    store: deps.store ?? null,
    apply: typeof deps.apply === 'function' ? /** @type {any} */ (deps.apply) : null,
    tokenFile: deps.tokenFile,
    fence: deps.fence ?? null,
    logger: deps.logger ?? null,
  })
  const registration = deps.webServer.register({ kind: 'exact', path: COST_POLICY_ROUTE, handler })
  if (Array.isArray(deps.disposers) && registration !== null && registration !== undefined) {
    if (typeof registration === 'function') deps.disposers.push(registration)
    else if (typeof registration.dispose === 'function') deps.disposers.push(() => registration.dispose())
  }
  return handler
}
