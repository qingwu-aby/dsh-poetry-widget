// @ts-check
// lib/composition/model-policy-routes.mjs —— 模型策略管理 API（Gate G1，token/fence 鉴权）。
//
// 目标：让用户通过一个受保护的本地 API 读写模型策略（默认空配置 = 现有行为）：
//   · GET  /api/dsh-poetry/model-policy.json：返回存储内容 + 生效策略摘要（每角色 provider/model/effort/来源）
//     与允许值（provider 白名单/角色枚举/effort 枚举）；
//   · PUT  /api/dsh-poetry/model-policy.json：写策略（校验白名单/角色/effort/tokenLimit），原子落盘；
//     `{reset:true}` 恢复空配置；
//   · 鉴权：GET 用 DSH trust fence 或 chat token（?token=）；PUT 用 body.token 或 fence 二选一；
//   · 注册时把 store 设为模型策略的默认 overrides 提供者：真实运行时策略动态读取，无需重启。
//   · 不接 UI；不改变现有路由。

import { readChatToken } from '../domain/chat/facade.mjs'
import {
  createModelPolicy,
  MODEL_POLICY_ALLOWED_PROVIDERS,
  MODEL_POLICY_EFFORTS,
  MODEL_POLICY_ROLES,
  setDefaultModelPolicyOverrides,
} from '../kernel/model-policy.mjs'
import {
  createModelPolicyStore,
  MODEL_POLICY_TOKEN_LIMIT_MAX,
  resolveModelPolicyFile,
} from '../kernel/model-policy-store.mjs'

/** 管理路由。 */
export const MODEL_POLICY_ROUTE = '/api/dsh-poetry/model-policy.json'

/** PUT 允许的顶层字段。 */
export const MODEL_POLICY_ALLOWED_FIELDS = Object.freeze(['provider', 'model', 'roles', 'tokenLimit', 'reset'])

const VALUE_MAX = 80
const CONTROL_CHARS = /[\p{Cc}]/u
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

/**
 * 校验 PUT 策略输入（白名单/角色枚举/effort 枚举/tokenLimit）。
 * @param {unknown} body
 * @param {{allowedProviders?: readonly string[]}} [options]
 * @returns {{ok: true, policy: object, reset: boolean} | {ok: false, errors: Array<{path: string, message: string}>}}
 */
export function validateModelPolicyInput(body, options = {}) {
  const allowedProviders = Array.isArray(options.allowedProviders)
    ? options.allowedProviders
    : MODEL_POLICY_ALLOWED_PROVIDERS
  const errors = []
  if (!isPlainObject(body)) return { ok: false, errors: [{ path: '$', message: '请求体必须是对象' }] }
  const source = /** @type {Record<string, any>} */ (body)
  for (const key of Object.keys(source)) {
    if (MODEL_POLICY_ALLOWED_FIELDS.indexOf(key) < 0) {
      errors.push({ path: key, message: `未知字段：${key}` })
    }
  }
  if (source.reset === true) {
    if (Object.keys(source).length > 1) {
      errors.push({ path: 'reset', message: 'reset 不能与其它字段同时出现' })
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true, reset: true, policy: {} }
  }
  const policy = /** @type {Record<string, any>} */ ({})
  if (source.provider !== undefined) {
    if (
      typeof source.provider !== 'string' ||
      source.provider.trim().length === 0 ||
      source.provider.trim().length > VALUE_MAX ||
      CONTROL_CHARS.test(source.provider)
    ) {
      errors.push({ path: 'provider', message: `provider 必须是 1–${VALUE_MAX} 字非空字符串` })
    } else if (allowedProviders.indexOf(source.provider.trim()) < 0) {
      errors.push({ path: 'provider', message: `provider 不在白名单：${source.provider.trim()}` })
    } else {
      policy.provider = source.provider.trim()
    }
  }
  if (source.model !== undefined) {
    if (
      typeof source.model !== 'string' ||
      source.model.trim().length === 0 ||
      source.model.trim().length > VALUE_MAX ||
      CONTROL_CHARS.test(source.model)
    ) {
      errors.push({ path: 'model', message: `model 必须是 1–${VALUE_MAX} 字非空字符串` })
    } else {
      policy.model = source.model.trim()
    }
  }
  if (source.tokenLimit !== undefined) {
    const limit = Number(source.tokenLimit)
    if (!Number.isInteger(limit) || limit < 0 || limit > MODEL_POLICY_TOKEN_LIMIT_MAX) {
      errors.push({ path: 'tokenLimit', message: `tokenLimit 必须是 0–${MODEL_POLICY_TOKEN_LIMIT_MAX} 的整数` })
    } else {
      policy.tokenLimit = limit
    }
  }
  if (source.roles !== undefined) {
    if (!isPlainObject(source.roles)) {
      errors.push({ path: 'roles', message: 'roles 必须是对象' })
    } else {
      const roles = {}
      for (const [role, roleValue] of Object.entries(source.roles)) {
        if (MODEL_POLICY_ROLES.indexOf(role) < 0) {
          errors.push({ path: `roles.${role}`, message: `未知角色：${role}` })
          continue
        }
        if (!isPlainObject(roleValue)) {
          errors.push({ path: `roles.${role}`, message: '角色配置必须是对象' })
          continue
        }
        const entry = {}
        if (roleValue.provider !== undefined) {
          if (
            typeof roleValue.provider !== 'string' ||
            roleValue.provider.trim().length === 0 ||
            roleValue.provider.trim().length > VALUE_MAX ||
            CONTROL_CHARS.test(roleValue.provider)
          ) {
            errors.push({ path: `roles.${role}.provider`, message: 'provider 非法' })
          } else if (allowedProviders.indexOf(roleValue.provider.trim()) < 0) {
            errors.push({
              path: `roles.${role}.provider`,
              message: `provider 不在白名单：${roleValue.provider.trim()}`,
            })
          } else {
            entry.provider = roleValue.provider.trim()
          }
        }
        if (roleValue.model !== undefined) {
          if (
            typeof roleValue.model !== 'string' ||
            roleValue.model.trim().length === 0 ||
            roleValue.model.trim().length > VALUE_MAX ||
            CONTROL_CHARS.test(roleValue.model)
          ) {
            errors.push({ path: `roles.${role}.model`, message: 'model 非法' })
          } else {
            entry.model = roleValue.model.trim()
          }
        }
        if (roleValue.reasoningEffort !== undefined) {
          const effort =
            typeof roleValue.reasoningEffort === 'string' ? roleValue.reasoningEffort.trim().toLowerCase() : ''
          if (MODEL_POLICY_EFFORTS.indexOf(effort) < 0) {
            errors.push({
              path: `roles.${role}.reasoningEffort`,
              message: `reasoningEffort 必须是：${MODEL_POLICY_EFFORTS.join(' / ')}`,
            })
          } else {
            entry.reasoningEffort = effort
          }
        }
        for (const key of Object.keys(roleValue)) {
          if (key !== 'provider' && key !== 'model' && key !== 'reasoningEffort') {
            errors.push({ path: `roles.${role}.${key}`, message: `未知字段：${key}` })
          }
        }
        if (Object.keys(entry).length > 0) roles[role] = entry
      }
      if (Object.keys(roles).length > 0) policy.roles = roles
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, reset: false, policy }
}

/**
 * 创建模型策略管理 handler。
 * @param {{
 *   store: object,
 *   policy: object,
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   allowedProviders?: readonly string[],
 *   logger?: object|null,
 * }} deps
 */
export function createModelPolicyHandler(deps) {
  const store = /** @type {any} */ (deps.store)
  const policy = /** @type {any} */ (deps.policy)
  const tokenFile = typeof deps.tokenFile === 'string' ? deps.tokenFile : ''
  const fence = deps.fence ?? null
  const allowedProviders = Array.isArray(deps.allowedProviders) ? deps.allowedProviders : MODEL_POLICY_ALLOWED_PROVIDERS
  const logger = /** @type {any} */ (deps.logger ?? null)

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

  function summaryPayload() {
    const state = store.read()
    let effective = null
    try {
      effective = typeof policy.effectiveSummary === 'function' ? policy.effectiveSummary() : null
    } catch (error) {
      void error
    }
    return {
      ok: true,
      version: state.version ?? 1,
      file: state.file,
      exists: state.exists,
      updatedAt: state.updatedAt,
      policy: state.policy,
      reports: state.errors,
      effective,
      allowed: {
        providers: allowedProviders.slice(),
        roles: MODEL_POLICY_ROLES.slice(),
        efforts: MODEL_POLICY_EFFORTS.slice(),
        tokenLimitMax: MODEL_POLICY_TOKEN_LIMIT_MAX,
      },
    }
  }

  return async function modelPolicyHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!fenceAllows(req) && !tokenMatches(queryToken(req))) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        sendJson(res, 200, summaryPayload())
        return
      }
      if (method !== 'PUT') {
        res.writeHead(405, { Allow: 'GET, PUT', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let body = null
      try {
        body = await readBody(req)
      } catch (error) {
        void error
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const bodyToken = isPlainObject(body) && typeof body.token === 'string' ? body.token : ''
      if (!tokenMatches(bodyToken) && !fenceAllows(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const policyInput = isPlainObject(body) ? { ...body } : body
      if (isPlainObject(policyInput) && 'token' in policyInput) delete policyInput.token
      const validated = validateModelPolicyInput(policyInput, { allowedProviders })
      if (validated.ok !== true) {
        sendJson(res, 400, { ok: false, error: 'invalid_policy', errors: validated.errors })
        return
      }
      const written = validated.reset === true ? store.reset() : store.write(validated.policy)
      if (written.ok !== true) {
        sendJson(res, 500, { ok: false, error: 'write_failed', message: written.message ?? '' })
        return
      }
      const state = store.read()
      let effective = null
      try {
        effective = typeof policy.effectiveSummary === 'function' ? policy.effectiveSummary() : null
      } catch (error) {
        void error
      }
      sendJson(res, 200, {
        ok: true,
        reset: validated.reset === true,
        updatedAt: written.updatedAt ?? state.updatedAt,
        policy: state.policy,
        reports: written.errors ?? [],
        effective,
      })
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 模型策略路由失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (warnError) {
        void warnError
      }
      try {
        sendJson(res, 500, {
          ok: false,
          error: { code: 'MODEL_POLICY_ROUTE_FAILED', message: error instanceof Error ? error.message : String(error) },
        })
      } catch (sendError) {
        void sendError
      }
    }
  }
}

/**
 * 注册模型策略管理路由（http-wiring 调用）；注册时把 store 设为策略默认 overrides 提供者。
 * @param {{
 *   webServer: any,
 *   disposers: Array<Function>,
 *   home?: string,
 *   tokenFile?: string,
 *   fence?: object|null,
 *   logger?: object|null,
 *   store?: object,
 *   policy?: object,
 *   getSelection?: Function,
 *   allowedProviders?: readonly string[],
 *   now?: () => number,
 * }} deps
 */
export function registerModelPolicyRoute(deps) {
  const providedStore = isPlainObject(deps.store) ? /** @type {any} */ (deps.store) : null
  const file =
    providedStore !== null && typeof providedStore.file === 'string'
      ? providedStore.file
      : deps.home
        ? resolveModelPolicyFile(deps.home)
        : resolveModelPolicyFile('')
  const store =
    providedStore !== null
      ? providedStore
      : createModelPolicyStore({ file, logger: deps.logger ?? null, now: deps.now })
  const logger = /** @type {any} */ (deps.logger ?? null)
  const policy = isPlainObject(deps.policy)
    ? deps.policy
    : createModelPolicy({
        env: process.env,
        getSelection: /** @type {any} */ (typeof deps.getSelection === 'function' ? deps.getSelection : () => null),
        getOverrides: () => store.read().policy,
        onInvalid: (report) => {
          try {
            logger?.warn?.(`[dsh-little-whale] 模型策略配置非法（${report.path}）：${report.message}`)
          } catch (error) {
            void error
          }
        },
      })
  // 让真实运行时（runtime-setup 里创建的 policy）动态读取 store：无需重启即可生效。
  setDefaultModelPolicyOverrides(() => store.read().policy)
  const handler = createModelPolicyHandler({
    store,
    policy,
    tokenFile: deps.tokenFile,
    fence: deps.fence ?? null,
    allowedProviders: deps.allowedProviders,
    logger: deps.logger ?? null,
  })
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: MODEL_POLICY_ROUTE, handler }))
  return { store, policy, handler }
}
