// @ts-check
// lib/core/activity-sdk.mjs —— Activity SDK（Gate L1，纯逻辑）。
//
// 目的：让新增 Activity（阅读/视频/学习…）不再手写适配器样板：
//   · defineActivity({manifest, tools, observe, execute, health, start, stop})：
//       复用 activity-manifest 校验 manifest；校验工具名/handler；返回 adapter（execute/start/stop/health）
//       + 便捷方法（tool()/execute()/snapshot()）；
//   · 工具分发：execute(task) 按 task.payload.tool 调用 handler(arguments, task, ctx)；
//       统一 receipt 校验（ok/detail/facts/at），handler 抛错/未知工具都返回失败 receipt（不抛）；
//   · 生命周期：start/stop/health 包装 + 错误隔离（失败只记 lastError，不抛）；
//   · registerActivity(registry, activity)：便捷注册到 Activity Registry。
// 不接现有业务：本模块只产出对象，不启动/不写文件/不联网。

import { describeActivityPermissions, validateActivityManifest } from './activity-manifest.mjs'

/** 实现版本。 */
export const ACTIVITY_SDK_VERSION = 1

/** 错误码。 */
export const ACTIVITY_SDK_CODES = Object.freeze({
  invalidManifest: 'ACTIVITY_SDK_INVALID_MANIFEST',
  invalidDefinition: 'ACTIVITY_SDK_INVALID_DEFINITION',
  duplicateTool: 'ACTIVITY_SDK_DUPLICATE_TOOL',
  unknownTool: 'ACTIVITY_SDK_UNKNOWN_TOOL',
  invalidHandler: 'ACTIVITY_SDK_INVALID_HANDLER',
  noTool: 'ACTIVITY_SDK_NO_TOOL',
  invalidReceipt: 'ACTIVITY_SDK_INVALID_RECEIPT',
  toolFailed: 'ACTIVITY_SDK_TOOL_FAILED',
  lifecycleFailed: 'ACTIVITY_SDK_LIFECYCLE_FAILED',
  invalidRegistry: 'ACTIVITY_SDK_INVALID_REGISTRY',
})

/** 生命周期状态。 */
export const ACTIVITY_SDK_HEALTH = Object.freeze(['healthy', 'degraded', 'stopped', 'error'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

/**
 * 校验/归一化 receipt：ok 必须 boolean；at/detail/facts 可选但类型受限。
 * @param {unknown} raw
 * @returns {{ok: boolean, receipt?: object, errors?: object[]}}
 */
export function validateActivityReceipt(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ path: '$', message: 'receipt 必须是对象' }] }
  }
  const errors = []
  if (typeof raw.ok !== 'boolean') errors.push({ path: 'ok', message: 'ok 必须是 boolean' })
  if (raw.at !== undefined && !Number.isFinite(Number(raw.at))) errors.push({ path: 'at', message: 'at 必须是数字' })
  if (raw.detail !== undefined && typeof raw.detail !== 'string') errors.push({ path: 'detail', message: 'detail 必须是字符串' })
  if (raw.facts !== undefined && !isPlainObject(raw.facts)) errors.push({ path: 'facts', message: 'facts 必须是对象' })
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    receipt: {
      ok: raw.ok,
      ...(raw.at === undefined ? {} : { at: Number(raw.at) }),
      detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 500) : '',
      facts: isPlainObject(raw.facts) ? { ...raw.facts } : {},
    },
  }
}

/**
 * 定义 Activity（不执行任何副作用）。
 * @param {{
 *   manifest: object,
 *   tools?: Record<string, Function>|Array<{name: string, handler: Function, schema?: object}>|null,
 *   observe?: Function|null,
 *   execute?: Function|null,
 *   health?: Function|null,
 *   start?: Function|null,
 *   stop?: Function|null,
 *   now?: () => number,
 * }} definition
 */
export function defineActivity(definition = {}) {
  const spec = isPlainObject(definition) ? definition : {}
  const validated = validateActivityManifest(spec.manifest)
  if (validated.ok !== true) {
    return errorResult(ACTIVITY_SDK_CODES.invalidManifest, 'manifest 未通过校验', { errors: validated.errors })
  }
  const manifest = validated.manifest
  const rawManifest = isPlainObject(spec.manifest) ? spec.manifest : null
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const declaredTools = Array.isArray(manifest.tools) ? manifest.tools.slice() : []
  const handlers = new Map()
  const schemas = new Map()
  const definitionErrors = []
  const state = { started: false, starts: 0, stops: 0, healthChecks: 0, executions: 0, failures: 0, lastError: null }

  function addTool(name, handler, schema) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return errorResult(ACTIVITY_SDK_CODES.invalidDefinition, '工具名必须是非空字符串')
    }
    if (declaredTools.indexOf(name) < 0) {
      return errorResult(ACTIVITY_SDK_CODES.unknownTool, `工具未在 manifest.tools 中声明：${name}`)
    }
    if (typeof handler !== 'function') {
      return errorResult(ACTIVITY_SDK_CODES.invalidHandler, `工具 handler 必须是函数：${name}`)
    }
    if (handlers.has(name)) {
      return errorResult(ACTIVITY_SDK_CODES.duplicateTool, `工具重复注册：${name}`)
    }
    handlers.set(name, handler)
    if (schema !== undefined) schemas.set(name, schema)
    return { ok: true }
  }

  if (Array.isArray(spec.tools)) {
    for (const item of spec.tools) {
      if (!isPlainObject(item)) {
        definitionErrors.push({ path: 'tools', message: 'tools 数组项必须是 {name, handler, schema?}' })
        continue
      }
      const added = addTool(item.name, item.handler, item.schema)
      if (added.ok !== true) definitionErrors.push({ code: added.code, path: 'tools.' + String(item.name ?? ''), message: added.message })
    }
  } else if (isPlainObject(spec.tools)) {
    for (const [name, handler] of Object.entries(spec.tools)) {
      const added = addTool(name, handler, undefined)
      if (added.ok !== true) definitionErrors.push({ code: added.code, path: 'tools.' + name, message: added.message })
    }
  }
  const customExecute = typeof spec.execute === 'function' ? spec.execute : null
  if (customExecute === null && declaredTools.length > 0 && handlers.size === 0) {
    definitionErrors.push({ code: ACTIVITY_SDK_CODES.noTool, path: 'tools', message: 'manifest 声明了工具但未注册 handler（或提供 execute）' })
  }
  if (definitionErrors.length > 0) {
    const first = definitionErrors[0]
    return errorResult(first.code ?? ACTIVITY_SDK_CODES.invalidDefinition, first.message, { errors: definitionErrors })
  }

  function normalizeReceipt(result, fallbackDetail) {
    if (result === undefined || result === null) {
      return { ok: false, at: now(), detail: fallbackDetail ?? '工具未返回结果', facts: {} }
    }
    if (typeof result === 'boolean') return { ok: result, at: now(), detail: '', facts: {} }
    if (isPlainObject(result)) {
      const raw = isPlainObject(result.receipt) ? result.receipt : result
      const receiptValidated = validateActivityReceipt(raw)
      if (receiptValidated.ok === true) {
        return { ...receiptValidated.receipt, at: receiptValidated.receipt.at ?? now() }
      }
      return { ok: raw.ok === true, at: now(), detail: typeof raw.detail === 'string' ? raw.detail : '', facts: isPlainObject(raw.facts) ? { ...raw.facts } : {} }
    }
    return { ok: false, at: now(), detail: '工具返回类型非法', facts: {} }
  }

  async function execute(task, ctx = {}) {
    state.executions += 1
    try {
      let result
      if (customExecute !== null) {
        result = await customExecute(task, ctx)
      } else {
        const payload = isPlainObject(task) && isPlainObject(task.payload) ? task.payload : {}
        const tool = typeof payload.tool === 'string' ? payload.tool : ''
        const handler = handlers.get(tool)
        if (handler === undefined) {
          state.failures += 1
          return { ok: false, at: now(), detail: '未知工具：' + (tool || '(空)'), facts: { code: ACTIVITY_SDK_CODES.unknownTool } }
        }
        const args = isPlainObject(payload.arguments) ? payload.arguments : {}
        result = await handler(args, task, ctx)
      }
      const receipt = normalizeReceipt(result, '工具未返回结果')
      if (receipt.ok !== true) state.failures += 1
      return receipt
    } catch (error) {
      state.failures += 1
      state.lastError = { code: ACTIVITY_SDK_CODES.toolFailed, message: error instanceof Error ? error.message : String(error), at: now() }
      return { ok: false, at: now(), detail: state.lastError.message, facts: { code: ACTIVITY_SDK_CODES.toolFailed } }
    }
  }

  async function start(options) {
    state.starts += 1
    try {
      if (typeof spec.start === 'function') await spec.start(options)
      state.started = true
      return { ok: true, started: true }
    } catch (error) {
      state.lastError = { code: ACTIVITY_SDK_CODES.lifecycleFailed, message: error instanceof Error ? error.message : String(error), at: now() }
      return { ok: false, code: ACTIVITY_SDK_CODES.lifecycleFailed, message: state.lastError.message }
    }
  }

  async function stop() {
    state.stops += 1
    try {
      if (typeof spec.stop === 'function') await spec.stop()
      state.started = false
      return { ok: true, started: false }
    } catch (error) {
      state.lastError = { code: ACTIVITY_SDK_CODES.lifecycleFailed, message: error instanceof Error ? error.message : String(error), at: now() }
      return { ok: false, code: ACTIVITY_SDK_CODES.lifecycleFailed, message: state.lastError.message }
    }
  }

  async function health() {
    state.healthChecks += 1
    try {
      const raw = typeof spec.health === 'function' ? await spec.health() : null
      const status = isPlainObject(raw) && ACTIVITY_SDK_HEALTH.indexOf(raw.status) >= 0 ? raw.status : raw === null || raw === undefined ? 'healthy' : raw.ok === false ? 'error' : 'healthy'
      return {
        ok: status !== 'error',
        status,
        started: state.started,
        detail: isPlainObject(raw) && typeof raw.detail === 'string' ? raw.detail.slice(0, 200) : '',
        at: now(),
      }
    } catch (error) {
      state.lastError = { code: ACTIVITY_SDK_CODES.lifecycleFailed, message: error instanceof Error ? error.message : String(error), at: now() }
      return { ok: false, status: 'error', started: state.started, detail: state.lastError.message, at: now() }
    }
  }

  const adapter = {
    execute,
    start,
    stop,
    health,
    ...(typeof spec.observe === 'function' ? { observe: async (input, ctx) => spec.observe(input, ctx) } : {}),
    manifest,
  }

  function snapshot() {
    return {
      ok: true,
      version: ACTIVITY_SDK_VERSION,
      id: manifest.id,
      activityVersion: manifest.version,
      name: manifest.name,
      tools: declaredTools.map((name) => ({ name, registered: handlers.has(name), hasSchema: schemas.has(name) })),
      permissions: describeActivityPermissions(manifest),
      lifecycle: { started: state.started, ...state },
      lastError: state.lastError === null ? null : { ...state.lastError },
    }
  }

  const activity = {
    ok: true,
    manifest,
    rawManifest,
    adapter,
    execute,
    start,
    stop,
    health,
    snapshot,
    /** 动态追加工具（必须在 manifest.tools 中声明；返回 {ok}）。 */
    tool(name, handler, schema) {
      const added = addTool(name, handler, schema)
      return added.ok === true ? { ok: true } : added
    },
  }
  return activity
}

/**
 * 便捷注册：defineActivity 的产物直接注册进 Activity Registry。
 * @param {object} registry createActivityRegistry() 产物
 * @param {object} activity defineActivity() 产物
 */
export function registerActivity(registry, activity) {
  if (!isPlainObject(registry) || typeof registry.register !== 'function') {
    return errorResult(ACTIVITY_SDK_CODES.invalidRegistry, 'registry 必须是 Activity Registry')
  }
  if (!isPlainObject(activity) || activity.ok !== true || !isPlainObject(activity.manifest) || !isPlainObject(activity.adapter)) {
    return errorResult(ACTIVITY_SDK_CODES.invalidDefinition, 'activity 必须是 defineActivity() 的合法产物')
  }
  return registry.register(activity.rawManifest ?? activity.manifest, activity.adapter)
}
