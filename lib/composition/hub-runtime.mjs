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

import { createActivityRegistry } from '../core/activity-registry.mjs'
import { CHAT_MANIFEST_RAW } from '../core/chat-activity.mjs'
import { createEventBus } from '../core/event-bus.mjs'
import { validateEventEnvelope } from '../core/event-schema.mjs'
import { createFeedbackLedger } from '../core/feedback-ledger.mjs'
import { createHubPersistence, isPlainObject, sanitizeEventText } from '../core/file-stores.mjs'

export { sanitizeEventText }

import { createHub } from '../core/hub.mjs'
import {
  GAME_CATEGORY_MAP,
  gameMemoryProvider,
  journalProvider,
  methodMemoryProvider,
} from '../core/memory-adapters.mjs'
import { createInMemoryMemoryProvider, createMemoryGateway } from '../core/memory-gateway.mjs'
import { MINECRAFT_MANIFEST_RAW } from '../core/minecraft-activity.mjs'
import { createScheduler } from '../core/scheduler.mjs'
import { createTaskBoard } from '../core/task-board.mjs'
import { createWorldSupervisor } from '../core/world-supervisor.mjs'

/** 运行时装配版本。 */
export const HUB_RUNTIME_VERSION = 1

/** 默认 feature flag（与 core/hub 一致：off + shadow）。 */
export const HUB_RUNTIME_DEFAULT_FLAG = Object.freeze({
  enabled: false,
  shadow: true,
  memoryWrite: false,
  persist: false,
})

/** 当前进程内已注册的 Hub 运行时（供 chat/minecraft shadow 钩子读取；单实例插件）。 */
let activeHubRuntime = null

/** 读取当前激活的 Hub 运行时（未注册时为 null）。 */
export function getActiveHubRuntime() {
  return activeHubRuntime
}

/** 设置当前激活的 Hub 运行时（测试/装配用；传 null 清除）。 */
export function setActiveHubRuntime(runtime) {
  activeHubRuntime = runtime ?? null
  return activeHubRuntime
}

const ENABLED_VALUES = Object.freeze(['1', 'on', 'true', 'full', 'yes'])
const SHADOW_VALUES = Object.freeze(['shadow', 'dry', 'dry-run'])
const DISABLED_VALUES = Object.freeze(['0', 'off', 'false', 'no', ''])
function normalizeFlag(raw) {
  if (!isPlainObject(raw))
    return raw === true
      ? { enabled: true, shadow: true, memoryWrite: false, persist: false }
      : { ...HUB_RUNTIME_DEFAULT_FLAG }
  return {
    enabled: raw.enabled === true,
    shadow: raw.shadow !== false,
    memoryWrite: raw.memoryWrite === true,
    persist: raw.persist === true,
    ...(typeof raw.name === 'string' && raw.name.length > 0 ? { name: raw.name.slice(0, 40) } : {}),
  }
}

/**
 * 解析 Hub feature flag（显式 > env > settings > 默认 off/shadow）。
 * @param {{featureFlag?: object|boolean, env?: Record<string, unknown>, settings?: Record<string, any>|null}} [input]
 */
export function resolveHubFeatureFlag(input = {}) {
  const spec = isPlainObject(input) ? input : {}
  const env = isPlainObject(spec.env) ? spec.env : {}
  const settings = isPlainObject(spec.settings) ? spec.settings : null
  const base = (() => {
    if (spec.featureFlag !== undefined) return normalizeFlag(spec.featureFlag)
    const envValue = env.DSH_POETRY_HUB ?? env.DSH_HUB ?? ''
    if (typeof envValue === 'string' && envValue.trim().length > 0) {
      const lowered = envValue.trim().toLowerCase()
      if (SHADOW_VALUES.includes(lowered)) return { enabled: true, shadow: true, name: 'env' }
      if (ENABLED_VALUES.includes(lowered)) return { enabled: true, shadow: false, name: 'env' }
      if (DISABLED_VALUES.includes(lowered)) return { ...HUB_RUNTIME_DEFAULT_FLAG, name: 'env' }
    }
    if (settings !== null && isPlainObject(settings.hub)) return normalizeFlag(settings.hub)
    return { ...HUB_RUNTIME_DEFAULT_FLAG }
  })()
  return { ...base, memoryWrite: resolveMemoryWrite(spec, env, settings), persist: resolvePersist(spec, env, settings) }
}

/** Gate H5：memoryWrite feature flag（env DSH_POETRY_MEMORY_WRITE=gateway / settings.memoryWrite）。 */
function resolveMemoryWrite(spec, env, settings) {
  const explicit =
    isPlainObject(spec.featureFlag) && typeof spec.featureFlag.memoryWrite === 'boolean'
      ? spec.featureFlag.memoryWrite
      : null
  if (explicit !== null) return explicit
  const envValue =
    typeof env.DSH_POETRY_MEMORY_WRITE === 'string' ? env.DSH_POETRY_MEMORY_WRITE.trim().toLowerCase() : ''
  if (envValue === 'gateway') return true
  if (envValue === 'off' || envValue === 'legacy' || envValue === 'file') return false
  if (settings !== null && (settings.memoryWrite === 'gateway' || settings.memoryWrite === true)) return true
  return (
    settings !== null &&
    isPlainObject(settings.hub) &&
    (settings.hub.memoryWrite === 'gateway' || settings.hub.memoryWrite === true)
  )
}

/** Gate I1：persist feature flag（env DSH_POETRY_HUB_PERSIST=1 / settings.persist）。 */
function resolvePersist(spec, env, settings) {
  const explicit =
    isPlainObject(spec.featureFlag) && typeof spec.featureFlag.persist === 'boolean' ? spec.featureFlag.persist : null
  if (explicit !== null) return explicit
  const envValue = typeof env.DSH_POETRY_HUB_PERSIST === 'string' ? env.DSH_POETRY_HUB_PERSIST.trim().toLowerCase() : ''
  if (envValue === '1' || envValue === 'on' || envValue === 'true') return true
  if (envValue === '0' || envValue === 'off' || envValue === 'false') return false
  if (settings === null) return false
  if (settings.persist === true || settings.persist === '1' || settings.persist === 'on') return true
  return isPlainObject(settings.hub) && (settings.hub.persist === true || settings.hub.persist === '1')
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
 *   feedbackLedger?: object|null,
 *   worldSupervisor?: object|null,
 *   activityManifests?: object[]|object|null,
 *   activities?: object|null,
 *   memoryGateway?: object|null,
 *   memoryPaths?: {agentMemoryDir?: string, gameMemoryDir?: string, methodsFile?: string}|null,
 *   persistPaths?: {taskBoardFile?: string, eventFile?: string}|null,
 *   taskStore?: object|null,
 *   eventStore?: object|null,
 *   persistReplay?: number,
 *   onRestoredEvents?: ((events: object[]) => void)|null,
 *   assembleHub?: boolean,
 *   featureFlag?: object|boolean,
 *   allowMemoryWrite?: boolean,
 *   now?: () => number,
 * }} [options]
 */
export function createHubRuntime(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const logger = spec.logger ?? null
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const settingsRaw = spec.settings ?? null
  let settings = isPlainObject(settingsRaw) ? settingsRaw : null
  if (settingsRaw !== null && settingsRaw !== undefined && typeof settingsRaw.get === 'function') {
    try {
      const value = settingsRaw.get()
      settings = isPlainObject(value) ? value : null
    } catch (error) {
      void error
      settings = null
    }
  }
  const featureFlag = resolveHubFeatureFlag({
    featureFlag: spec.featureFlag,
    env: spec.env ?? null,
    settings,
  })
  // Gate E4：只读 Memory Gateway（真实路径只读接入；查询仅经 queryMemory API，绝不写入）。
  const memoryPaths = isPlainObject(spec.memoryPaths) ? spec.memoryPaths : null
  const injectedGateway = isPlainObject(spec.memoryGateway) ? spec.memoryGateway : null
  const memoryWrite = featureFlag.memoryWrite === true
  const memoryGateway = injectedGateway ?? (memoryPaths !== null || memoryWrite ? createMemoryGateway({ now }) : null)
  /** @type {string[]} */
  const memoryProviders = []
  const memoryMetrics = { queries: 0, errors: 0 }
  if (memoryGateway !== null && memoryPaths !== null) {
    const gateway = /** @type {any} */ (memoryGateway)
    const register = (name, factory) => {
      try {
        const provider = factory()
        if (provider === null) return
        const registered = gateway.registerProvider(provider)
        if (registered.ok === true) memoryProviders.push(name)
        else warn(`Memory provider 注册失败（${name}）：${registered.message ?? ''}`)
      } catch (error) {
        warn(`Memory provider 创建失败（${name}）：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (typeof memoryPaths.agentMemoryDir === 'string' && memoryPaths.agentMemoryDir.length > 0) {
      register('journal', () => journalProvider({ dir: memoryPaths.agentMemoryDir }))
    }
    if (typeof memoryPaths.gameMemoryDir === 'string' && memoryPaths.gameMemoryDir.length > 0) {
      register('game-memory', () => gameMemoryProvider({ dir: memoryPaths.gameMemoryDir }))
    }
    if (typeof memoryPaths.methodsFile === 'string' && memoryPaths.methodsFile.length > 0) {
      register('method-memory', () => methodMemoryProvider({ file: memoryPaths.methodsFile }))
    }
  }
  // Gate H5：memoryWrite 开启时注册可写内存 provider（默认关闭 → 不注册、不写 Gateway）。
  if (memoryGateway !== null && memoryWrite) {
    try {
      const gateway = /** @type {any} */ (memoryGateway)
      const provider = createInMemoryMemoryProvider({
        id: 'hub-bridge',
        kind: 'memory',
        permissions: { read: true, write: true },
      })
      const registered = gateway.registerProvider(provider)
      if (registered.ok === true) memoryProviders.push('hub-bridge')
      else warn(`Memory bridge provider 注册失败：${registered.message ?? ''}`)
    } catch (error) {
      warn(`Memory bridge provider 创建失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Gate H3：真实 Activity 执行适配器由装配方注入（仅 full 模式启用；off/shadow 一律不执行）。
  const fullMode = featureFlag.enabled === true && featureFlag.shadow === false
  /** @type {Map<string, {manifest: object, execute: Function}>} */
  const executors = new Map()
  if (fullMode && Array.isArray(spec.activityManifests)) {
    for (const item of spec.activityManifests) {
      if (
        isPlainObject(item) &&
        isPlainObject(item.manifest) &&
        typeof item.manifest.id === 'string' &&
        typeof item.execute === 'function'
      ) {
        executors.set(item.manifest.id, item)
      }
    }
  }
  const hubManifests = [...executors.values()]

  // Gate I1：opt-in 持久化（默认关闭 → 完全内存态，零行为变化）。
  const persistPaths = isPlainObject(spec.persistPaths) ? spec.persistPaths : null
  const persistence = createHubPersistence({
    enabled: featureFlag.persist === true,
    taskBoardFile:
      persistPaths !== null && typeof persistPaths.taskBoardFile === 'string' ? persistPaths.taskBoardFile : '',
    eventFile: persistPaths !== null && typeof persistPaths.eventFile === 'string' ? persistPaths.eventFile : '',
    taskStore: spec.taskStore ?? null,
    eventStore: spec.eventStore ?? null,
    replay: spec.persistReplay,
    now,
    logger,
  })
  const taskStore = persistence.taskStore
  const eventStore = persistence.eventStore
  const persistEnabled = persistence.enabled

  // Gate F1：完整 Hub 图（默认装配；assembleHub:false 时保持 Gate E 的“只注册 lifecycle”形态）。
  const assembleHub = spec.assembleHub !== false
  /** @type {Record<string, any>} */
  const instances = {
    eventBus: spec.eventBus ?? null,
    taskBoard: spec.taskBoard ?? null,
    scheduler: spec.scheduler ?? null,
    registry: spec.registry ?? null,
    feedbackLedger: spec.feedbackLedger ?? null,
    worldSupervisor: spec.worldSupervisor ?? null,
    memoryGateway,
  }
  if (assembleHub) {
    instances.eventBus =
      instances.eventBus ?? createEventBus({ now, ...(eventStore === null ? {} : { store: eventStore }) })
    instances.feedbackLedger = instances.feedbackLedger ?? createFeedbackLedger({ now })
    instances.taskBoard =
      instances.taskBoard ??
      createTaskBoard({
        now,
        ...(taskStore === null ? {} : { store: taskStore, loadOnCreate: false }),
        onEvent: (event) => bridgeSourceEvent('taskBoard', event),
      })
    instances.scheduler =
      instances.scheduler ??
      createScheduler({
        board: instances.taskBoard,
        now,
        onDecision: (decision) => bridgeSourceEvent('scheduler', { type: 'scheduler.decision', at: now(), decision }),
      })
    instances.registry =
      instances.registry ?? createActivityRegistry({ now, onEvent: (event) => bridgeSourceEvent('registry', event) })
    instances.worldSupervisor =
      instances.worldSupervisor ?? createWorldSupervisor({ now, onEvent: (event) => bridgeSourceEvent('world', event) })
    // 注册 chat/minecraft manifests（可观测；adapter 由后续注入，不影响 off/shadow）。
    for (const manifest of [CHAT_MANIFEST_RAW, MINECRAFT_MANIFEST_RAW]) {
      try {
        const registered = /** @type {any} */ (instances.registry).register(manifest)
        if (registered.ok !== true) warn(`Activity manifest 注册失败（${manifest.id}）：${registered.message ?? ''}`)
      } catch (error) {
        warn(`Activity manifest 注册失败（${manifest.id}）：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const hub = createHub({
    eventBus: instances.eventBus,
    taskBoard: instances.taskBoard,
    scheduler: instances.scheduler,
    registry: instances.registry,
    memoryGateway,
    feedbackLedger: instances.feedbackLedger,
    worldSupervisor: instances.worldSupervisor,
    activityManifests: hubManifests,
    activities: spec.activities ?? null,
    featureFlag,
    allowMemoryWrite: spec.allowMemoryWrite === true,
    now,
  })

  // 恢复持久化任务（放在 hub 创建之后，避免 restore 事件在 TDZ 阶段触发）。
  let restoredTasks = 0
  let restoredEvents = []
  if (persistence.enabled) {
    restoredTasks = persistence.restoreTasks(instances.taskBoard)
    restoredEvents = persistence.readReplay()
    if (restoredEvents.length > 0 && typeof spec.onRestoredEvents === 'function') {
      try {
        spec.onRestoredEvents(restoredEvents)
      } catch (error) {
        void error
      }
    }
  }
  let started = false
  let disposed = false
  let startedAt = 0
  let stoppedAt = 0
  /** @type {{code: string, message: string, at: number}|null} */
  let lastError = null
  /** 无 Event Bus 时的 shadow 观察环（只记录来源事件，不产生任何业务副作用）。 */
  const shadowEvents = []
  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch (error) {
      void error
    }
  }

  /** 来源事件桥：TaskBoard/Registry/WorldSupervisor/Scheduler onEvent → Hub ingest → EventBus。 */
  function bridgeSourceEvent(source, event) {
    if (disposed) return
    try {
      ingest(source, event)
    } catch (error) {
      recordError('eventBridge', error)
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

  /**
   * 事件桥代理：
   *   · 已是统一 envelope（如 Chat/Minecraft Activity 产出）→ 直接追加 Event Bus（保持 payload 原样）；
   *   · 其它来源事件 → 交给 core Hub 包装成 envelope；
   *   · Event Bus 未接入时记进本地 shadow 环（可观测，不落盘）。
   */
  function ingest(sourceName, sourceEvent) {
    if (disposed) return { ok: false, code: 'HUB_RUNTIME_DISPOSED' }
    try {
      const busRef = /** @type {any} */ (instances.eventBus)
      const validated = validateEventEnvelope(sourceEvent)
      if (validated.ok === true) {
        if (busRef !== null && busRef !== undefined && typeof busRef.append === 'function') {
          const appended = busRef.append(validated.event)
          if (appended !== null && appended !== undefined && appended.ok === false) return appended
          return { ok: true, appended: true, passthrough: true }
        }
        shadowEvents.push({ source: String(sourceName ?? ''), at: now(), event: validated.event })
        while (shadowEvents.length > 50) shadowEvents.shift()
        return { ok: true, recorded: true, bridged: false }
      }
      const result = hub.ingest(sourceName, sourceEvent)
      if (result !== null && result.ok === true) return result
      if (spec.eventBus === null || spec.eventBus === undefined) {
        shadowEvents.push({ source: String(sourceName ?? ''), at: now(), event: sourceEvent })
        while (shadowEvents.length > 50) shadowEvents.shift()
        return { ok: true, recorded: true, bridged: false }
      }
      return result
    } catch (error) {
      recordError('ingest', error)
      return { ok: false, code: 'HUB_RUNTIME_INGEST_FAILED', message: lastError === null ? '' : lastError.message }
    }
  }

  /** 事件源挂接代理（供 Task Board/Registry 等 onEvent 接线）。 */
  function attachEventSource(sourceName, source) {
    if (disposed) return { ok: false, code: 'HUB_RUNTIME_DISPOSED' }
    try {
      return hub.attachEventSource(sourceName, source)
    } catch (error) {
      recordError('attachEventSource', error)
      return { ok: false, code: 'HUB_RUNTIME_ATTACH_FAILED', message: lastError === null ? '' : lastError.message }
    }
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
    if (activeHubRuntime === runtimeHandle) activeHubRuntime = null
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

  function finishTick(result) {
    const failed =
      isPlainObject(result) &&
      (result.ok === false || (result.ok === undefined && (result.scope !== undefined || result.message !== undefined)))
    if (!failed) return result
    lastError = {
      code: typeof result.code === 'string' ? result.code : 'HUB_RUNTIME_TICK_FAILED',
      message: typeof result.message === 'string' ? result.message : '',
      at: now(),
    }
    if (result.ok === false) return result
    return { ok: false, code: 'HUB_RUNTIME_TICK_FAILED', message: lastError.message, mode: hub.mode() }
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

  /**
   * Gate H5：记忆写入桥（仅 memoryWrite flag 开启时写 Gateway；默认 no-op，失败隔离）。
   * @param {object} entry game-memory 记录 {category, text, at?, source?}
   */
  async function recordMemory(entry) {
    if (disposed) return { ok: false, code: 'HUB_RUNTIME_DISPOSED' }
    if (memoryWrite !== true) return { ok: true, skipped: true, reason: 'memory-write-disabled' }
    if (memoryGateway === null) return { ok: false, code: 'HUB_MEMORY_UNAVAILABLE', message: 'Memory Gateway 未接入' }
    if (!isPlainObject(entry))
      return { ok: false, code: 'HUB_MEMORY_INVALID_ENTRY', message: '记忆条目必须是带 text 的对象' }
    const record = /** @type {Record<string, any>} */ (entry)
    if (typeof record.text !== 'string' || record.text.trim().length === 0) {
      return { ok: false, code: 'HUB_MEMORY_INVALID_ENTRY', message: '记忆条目必须是带 text 的对象' }
    }
    const gameCategory = typeof record.category === 'string' && record.category.length > 0 ? record.category : 'event'
    const gatewayEntry = {
      category: GAME_CATEGORY_MAP[gameCategory] ?? 'episodic',
      topic: 'game:' + gameCategory,
      text: record.text.trim().slice(0, 500),
      source: { kind: 'game-memory', id: 'game-memory-workspace', activity: gameCategory },
      confidence: 0.7,
      provenance: { activity: gameCategory, ...(Number.isFinite(Number(record.at)) ? { at: Number(record.at) } : {}) },
    }
    try {
      const written = await /** @type {any} */ (memoryGateway).write(gatewayEntry)
      if (written !== null && written !== undefined && written.ok === true) {
        memoryMetrics.writes = (memoryMetrics.writes ?? 0) + 1
        return { ok: true, entry: written.entry ?? null }
      }
      return {
        ok: false,
        code: 'HUB_MEMORY_WRITE_FAILED',
        message: written && typeof written.message === 'string' ? written.message : '',
      }
    } catch (error) {
      recordError('recordMemory', error)
      return { ok: false, code: 'HUB_MEMORY_WRITE_FAILED', message: lastError === null ? '' : lastError.message }
    }
  }
  async function queryMemory(filter) {
    if (disposed) return { ok: false, code: 'HUB_RUNTIME_DISPOSED' }
    if (memoryGateway === null)
      return { ok: false, code: 'HUB_RUNTIME_MEMORY_UNAVAILABLE', message: 'Memory Gateway 未接入' }
    try {
      const specFilter = isPlainObject(filter) ? filter : {}
      const requested = Math.floor(Number(specFilter.limit))
      const limit = Math.min(Math.max(1, Number.isFinite(requested) ? requested : 20), 50)
      const result = await /** @type {any} */ (memoryGateway).query({ ...specFilter, limit })
      memoryMetrics.queries += 1
      return {
        ok: true,
        entries: Array.isArray(result.entries) ? result.entries : [],
        total: Number.isFinite(Number(result.total)) ? Number(result.total) : 0,
        errors: Array.isArray(result.errors) ? result.errors : [],
        limit,
      }
    } catch (error) {
      memoryMetrics.errors += 1
      recordError('queryMemory', error)
      return {
        ok: false,
        code: 'HUB_RUNTIME_MEMORY_QUERY_FAILED',
        message: lastError === null ? '' : lastError.message,
      }
    }
  }
  function memorySnapshot() {
    if (memoryGateway === null) return { available: false, write: false, providers: [], metrics: null }
    let gatewaySnapshot = null
    try {
      gatewaySnapshot = /** @type {any} */ (memoryGateway).snapshot()
    } catch (error) {
      recordError('memorySnapshot', error)
    }
    return {
      available: true,
      write: memoryWrite === true,
      providers: memoryProviders.slice(),
      metrics: gatewaySnapshot !== null ? { ...gatewaySnapshot.metrics, ...memoryMetrics } : { ...memoryMetrics },
      conflicts: gatewaySnapshot !== null ? gatewaySnapshot.conflicts : 0,
    }
  }

  /** Gate H3：执行显式创建的 Activity 任务（仅 full；adapter 由装配方注入）。 */
  async function executeTask(taskId) {
    if (disposed) return { ok: false, code: 'HUB_RUNTIME_DISPOSED' }
    if (hub.mode() !== 'full')
      return {
        ok: false,
        code: 'HUB_FULL_REQUIRED',
        message: '只有 full 模式才会执行真实任务（当前 ' + hub.mode() + '）',
      }
    const board = /** @type {any} */ (instances.taskBoard)
    if (board === null || typeof board.get !== 'function')
      return { ok: false, code: 'HUB_TASK_BOARD_UNAVAILABLE', message: '任务板未接入' }
    let task = board.get(String(taskId))
    if (task === null || task === undefined)
      return { ok: false, code: 'HUB_TASK_NOT_FOUND', message: '任务不存在：' + String(taskId) }
    if (task.status === 'queued') {
      const claimed = board.claim(task.id, 'hub')
      if (claimed === null || claimed.ok !== true) {
        return {
          ok: false,
          code: claimed && typeof claimed.code === 'string' ? claimed.code : 'HUB_CLAIM_FAILED',
          message: claimed && claimed.message ? claimed.message : '认领任务失败',
        }
      }
      task = board.get(task.id)
    }
    if (task === null || task === undefined || task.status !== 'running') {
      return {
        ok: false,
        code: 'HUB_TASK_NOT_RUNNING',
        message: '任务当前不可执行：' + (task ? task.status : 'missing'),
      }
    }
    const adapter = executors.get(task.activity) ?? null
    if (adapter === null) {
      try {
        board.fail(task.id, { message: '没有 ' + task.activity + ' 的 Activity adapter' })
      } catch (error) {
        void error
      }
      return { ok: false, code: 'HUB_NO_ACTIVITY_ADAPTER', message: '没有 ' + task.activity + ' 的 Activity adapter' }
    }
    let result = null
    try {
      result = await adapter.execute(task, { now })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        board.fail(task.id, { message })
      } catch (failError) {
        void failError
      }
      recordError('executeTask', error)
      return { ok: false, code: 'HUB_ADAPTER_FAILED', message, receipt: { ok: false, at: now(), message } }
    }
    const receipt =
      isPlainObject(result) && isPlainObject(result.receipt)
        ? result.receipt
        : { ok: false, at: now(), message: 'adapter 未返回 receipt' }
    const success = receipt.ok === true
    try {
      if (success) board.complete(task.id, receipt)
      else
        board.fail(task.id, {
          message:
            typeof receipt.message === 'string'
              ? receipt.message
              : typeof receipt.detail === 'string'
                ? receipt.detail
                : '执行失败',
        })
    } catch (error) {
      void error
    }
    let feedback = null
    const ledger = /** @type {any} */ (instances.feedbackLedger)
    if (ledger !== null && typeof ledger.record === 'function') {
      try {
        const recorded = ledger.record({
          taskId: task.id,
          hypothesis:
            typeof task.title === 'string' && task.title.length > 0
              ? task.title
              : task.activity + '.' + (task.kind ?? 'task'),
          experiment: task.activity + ':' + (task.kind ?? 'run') + ':' + (task.key ?? task.id),
          receipt: {
            kind: 'event',
            at: Number.isFinite(Number(receipt.at)) ? Number(receipt.at) : now(),
            ref: task.id,
            ok: success,
          },
          outcome: success ? 'success' : 'failure',
          evidence: [
            'receipt.ok=' + success,
            ...(typeof receipt.detail === 'string' && receipt.detail.length > 0 ? [receipt.detail] : []),
          ],
          provenance: { activity: task.activity },
        })
        if (recorded !== null && recorded !== undefined && recorded.ok === true) feedback = recorded.record ?? recorded
      } catch (error) {
        void error
      }
    }
    return { ok: true, taskId: task.id, activity: task.activity, receipt, success, feedback }
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
      assembled: assembleHub,
      adapters: [...executors.keys()],
      hub: hubSnapshot,
      memory: memorySnapshot(),
      persist: { ...persistence.snapshot(), restoredTasks, restoredEvents: restoredEvents.length },
      shadowEventCount: shadowEvents.length,
      shadowEvents: shadowEvents.slice(-20),
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
      memory: {
        available: memoryGateway !== null,
        write: memoryWrite === true,
        providers: memoryProviders.length,
        queries: memoryMetrics.queries,
        writes: memoryMetrics.writes ?? 0,
      },
      lastError: lastError === null ? null : { ...lastError },
    }
  }
  const runtimeHandle = {
    start,
    stop,
    dispose,
    tick,
    executeTask,
    getAdapters: () => [...executors.keys()],
    ingest,
    attachEventSource,
    queryMemory,
    recordMemory,
    memorySnapshot,
    readPersistedEvents: (limit) => {
      if (eventStore === null || typeof eventStore.readTail !== 'function')
        return { ok: true, events: [], enabled: false }
      const tail = eventStore.readTail({
        maxLines: Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 50,
      })
      return { ok: tail.ok === true, events: Array.isArray(tail.events) ? tail.events : [], enabled: true }
    },
    getMemoryGateway: () => memoryGateway,
    getInstances: () => instances,
    snapshot,
    health,
    getHub: () => hub,
    mode: () => hub.mode(),
    featureFlag: { ...featureFlag },
  }
  return runtimeHandle
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
  setActiveHubRuntime(hubRuntime)
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
