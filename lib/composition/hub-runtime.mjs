// @ts-check
// lib/composition/hub-runtime.mjs —— Hub 运行时装配（Gate E1，默认 off/shadow，零行为变化）。
//
// 目标：把 lib/core/hub.mjs 接进真实插件运行时，但**默认关闭**，且关闭时完全无副作用：
//   · createHubRuntime({logger, env, settings, eventBus, taskBoard, scheduler, registry,
//     memoryGateway, feedbackLedger, worldSupervisor, activityManifests, featureFlag, now})；
//   · featureFlag 解析优先级：显式 options.featureFlag > env.DSH_POETRY_HUB > settings.hub > 默认 off/shadow；
//   · start/stop/dispose：start 失败只记录不抛（不影响插件其它服务）；dispose 幂等且不等待异步 stop；
//   · snapshot 聚合（runtime 状态 + hub 快照）；health 提供 hub 指标；
//   · 所有 Hub 调用都包在错误隔离里：Hub 故障不能影响聊天/游戏/心跳/路由。
//
// 接线约定：plugin-runtime 只调用 registerHubRuntime(serviceRuntime, options) 注册生命周期；
// 真正的活动适配器（chat/minecraft）在 Gate E2/E3 由装配方注入，本模块不 import 业务模块。

import { createHub } from '../core/hub.mjs'

/** 运行时装配版本。 */
export const HUB_RUNTIME_VERSION = 1

/** 默认 feature flag（与 core/hub 一致：off + shadow）。 */
export const HUB_RUNTIME_DEFAULT_FLAG = Object.freeze({ enabled: false, shadow: true })

const ENABLED_VALUES = Object.freeze(['1', 'on', 'true', 'full', 'yes'])
const SHADOW_VALUES = Object.freeze(['shadow', 'dry', 'dry-run'])
const DISABLED_VALUES = Object.freeze(['0', 'off', 'false', 'no', ''])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFlag(raw) {
  if (raw === true) return { enabled: true, shadow: true }
  if (raw === false) return { ...HUB_RUNTIME_DEFAULT_FLAG }
  if (!isPlainObject(raw)) return { ...HUB_RUNTIME_DEFAULT_FLAG }
  return {
    enabled: raw.enabled === true,
    shadow: raw.shadow !== false,
    ...(typeof raw.name === 'string' && raw.name.length > 0 ? { name: raw.name.slice(0, 40) } : {}),
  }
}

/**
 * 解析 Hub feature flag（显式 > env > settings > 默认 off/shadow）。
 * @param {{featureFlag?: object|boolean, env?: Record<string, unknown>, settings?: Record<string, any>|null}} [input]
 */
export function resolveHubFeatureFlag(input = {}) {
  const spec = isPlainObject(input) ? input : {}
  if (spec.featureFlag !== undefined) return normalizeFlag(spec.featureFlag)
  const env = isPlainObject(spec.env) ? spec.env : {}
  const envValue = env.DSH_POETRY_HUB ?? env.DSH_HUB ?? ''
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    const lowered = envValue.trim().toLowerCase()
    if (SHADOW_VALUES.includes(lowered)) return { enabled: true, shadow: true, name: 'env' }
    if (ENABLED_VALUES.includes(lowered)) return { enabled: true, shadow: false, name: 'env' }
    if (DISABLED_VALUES.includes(lowered)) return { ...HUB_RUNTIME_DEFAULT_FLAG, name: 'env' }
  }
  const settings = isPlainObject(spec.settings) ? spec.settings : null
  if (settings !== null && isPlainObject(settings.hub)) return normalizeFlag(settings.hub)
  return { ...HUB_RUNTIME_DEFAULT_FLAG }
}

function resolveSettings(settings) {
  if (settings === null || settings === undefined) return null
  if (typeof settings.get === 'function') {
    try {
      const value = settings.get()
      return isPlainObject(value) ? value : null
    } catch (error) {
      void error
      return null
    }
  }
  return isPlainObject(settings) ? settings : null
}

/**
 * 创建 Hub 运行时（默认 off/shadow；start/stop/dispose/snapshot/health/tick）。
 * @param {{
 *   logger?: {warn?: Function, info?: Function, error?: Function}|null,
 *   env?: Record<string, unknown>|null,
 *   settings?: Record<string, any>|{get: Function}|null,
 *   eventBus?: object|null,
 *   taskBoard?: object|null,
 *   scheduler?: object|null,
 *   registry?: object|null,
 *   memoryGateway?: object|null,
 *   feedbackLedger?: object|null,
 *   worldSupervisor?: object|null,
 *   activityManifests?: object[]|object|null,
 *   activities?: object|null,
 *   featureFlag?: object|boolean,
 *   allowMemoryWrite?: boolean,
 *   now?: () => number,
 * }} [options]
 */
export function createHubRuntime(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const logger = spec.logger ?? null
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const settings = resolveSettings(spec.settings ?? null)
  const featureFlag = resolveHubFeatureFlag({
    featureFlag: spec.featureFlag,
    env: spec.env ?? null,
    settings,
  })
  const hub = createHub({
    eventBus: spec.eventBus ?? null,
    taskBoard: spec.taskBoard ?? null,
    scheduler: spec.scheduler ?? null,
    registry: spec.registry ?? null,
    memoryGateway: spec.memoryGateway ?? null,
    feedbackLedger: spec.feedbackLedger ?? null,
    worldSupervisor: spec.worldSupervisor ?? null,
    activityManifests: spec.activityManifests ?? null,
    activities: spec.activities ?? null,
    featureFlag,
    allowMemoryWrite: spec.allowMemoryWrite === true,
    now,
  })

  let started = false
  let disposed = false
  let startedAt = 0
  let stoppedAt = 0
  /** @type {{code: string, message: string, at: number}|null} */
  let lastError = null

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch (error) {
      void error
    }
  }

  function recordError(scope, error) {
    lastError = {
      code: scope,
      message: error instanceof Error ? error.message : String(error),
      at: now(),
    }
    warn(`Hub ${scope} 失败：${lastError.message}`)
    return lastError
  }

  /** 启动 Hub（off 模式下是 no-op；失败不抛，只记录）。 */
  function start() {
    if (disposed) return { ok: false, code: 'HUB_RUNTIME_DISPOSED', mode: hub.mode() }
    if (started) return { ok: true, already: true, mode: hub.mode() }
    try {
      const result = hub.start()
      started = true
      startedAt = now()
      return { ok: true, mode: hub.mode(), ...(isPlainObject(result) ? result : {}) }
    } catch (error) {
      recordError('start', error)
      return { ok: false, mode: hub.mode(), message: lastError === null ? '' : lastError.message }
    }
  }

  /** 停止 Hub（异步；失败只记录）。 */
  async function stop() {
    if (!started) return { ok: true, already: true, mode: hub.mode() }
    try {
      await hub.stop()
    } catch (error) {
      recordError('stop', error)
    }
    started = false
    stoppedAt = now()
    return { ok: true, mode: hub.mode() }
  }

  /** 释放（同步、幂等；异步 stop 不阻塞插件退出）。 */
  function dispose() {
    if (disposed) return { ok: true, already: true }
    disposed = true
    try {
      const pending = hub.stop()
      if (pending !== null && pending !== undefined && typeof pending.then === 'function') {
        pending.catch((error) => recordError('dispose', error))
      }
    } catch (error) {
      recordError('dispose', error)
    }
    started = false
    stoppedAt = now()
    return { ok: true }
  }

  /** 记录 tick 的非抛错失败（供 health/snapshot 观测）。 */
  function finishTick(result) {
    if (isPlainObject(result) && result.ok === false) {
      lastError = {
        code: typeof result.code === 'string' ? result.code : 'HUB_RUNTIME_TICK_FAILED',
        message: typeof result.message === 'string' ? result.message : '',
        at: now(),
      }
      return result
    }
    // 兼容 core/hub.tick 在依赖异常时返回的原始错误对象（{scope, message}）。
    if (
      isPlainObject(result) &&
      result.ok === undefined &&
      (result.scope !== undefined || result.message !== undefined)
    ) {
      lastError = {
        code: 'HUB_RUNTIME_TICK_FAILED',
        message: typeof result.message === 'string' ? result.message : '',
        at: now(),
      }
      return { ok: false, code: 'HUB_RUNTIME_TICK_FAILED', message: lastError.message, mode: hub.mode() }
    }
    return result
  }

  /** 一轮 Hub tick（异步；错误隔离为 {ok:false}，不抛）。 */
  function tick(nowArg) {
    if (disposed) return Promise.resolve({ ok: false, code: 'HUB_RUNTIME_DISPOSED', mode: hub.mode() })
    try {
      const result = hub.tick(nowArg)
      if (result !== null && result !== undefined && typeof result.then === 'function') {
        return result.then(finishTick, (error) => {
          recordError('tick', error)
          return { ok: false, code: 'HUB_RUNTIME_TICK_FAILED', mode: hub.mode() }
        })
      }
      return Promise.resolve(finishTick(result))
    } catch (error) {
      recordError('tick', error)
      return Promise.resolve({ ok: false, code: 'HUB_RUNTIME_TICK_FAILED', mode: hub.mode() })
    }
  }

  function snapshot() {
    let hubSnapshot = null
    try {
      hubSnapshot = hub.snapshot()
    } catch (error) {
      recordError('snapshot', error)
    }
    return {
      ok: true,
      version: HUB_RUNTIME_VERSION,
      now: now(),
      started,
      disposed,
      startedAt,
      stoppedAt,
      featureFlag: { ...featureFlag },
      mode: hub.mode(),
      hub: hubSnapshot,
      lastError: lastError === null ? null : { ...lastError },
    }
  }

  function health() {
    let hubHealth = null
    try {
      hubHealth = hub.health()
    } catch (error) {
      recordError('health', error)
    }
    return {
      ok: !disposed,
      started,
      disposed,
      mode: hub.mode(),
      enabled: featureFlag.enabled,
      shadow: featureFlag.shadow,
      hub: hubHealth,
      lastError: lastError === null ? null : { ...lastError },
    }
  }

  return {
    start,
    stop,
    dispose,
    tick,
    snapshot,
    health,
    getHub: () => hub,
    featureFlag: { ...featureFlag },
  }
}

/**
 * 把 Hub 运行时注册进 serviceRuntime（plugin-runtime 用）；返回 hubRuntime 句柄。
 * serviceRuntime.register(name, {start, dispose, snapshot})，Hub 注册失败不影响其他服务。
 * @param {{register: Function}|null} serviceRuntime
 * @param {object} [options]
 */
export function registerHubRuntime(serviceRuntime, options = {}) {
  const opts = /** @type {Record<string, any>} */ (isPlainObject(options) ? options : {})
  const hubRuntime = createHubRuntime(opts)
  const runtime = serviceRuntime !== null && typeof serviceRuntime?.register === 'function' ? serviceRuntime : null
  if (runtime === null) return hubRuntime
  try {
    runtime.register('Hub', {
      start: () => {
        const result = hubRuntime.start()
        if (result.ok !== true) throw new Error(result.message ?? 'hub start failed')
      },
      dispose: () => {
        hubRuntime.dispose()
      },
      snapshot: () => hubRuntime.snapshot(),
    })
  } catch (error) {
    hubRuntime.snapshot()
    try {
      opts.logger?.warn?.(
        `[dsh-little-whale] Hub 服务注册失败：${error instanceof Error ? error.message : String(error)}`,
      )
    } catch (warnError) {
      void warnError
    }
  }
  return hubRuntime
}
