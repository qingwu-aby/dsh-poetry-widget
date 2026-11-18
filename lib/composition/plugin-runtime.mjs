// @ts-check
// lib/composition/plugin-runtime.mjs —— 插件运行期总装（W2）：runtime setup → domain services → HTTP。

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createEventEnvelope } from '../core/event-schema.mjs'
import { toToolReceiptEvent } from '../core/minecraft-activity.mjs'
import { PRESENCE_ROUTE } from '../domain/being/presence.mjs'
import { createCostGuard } from '../domain/host/cost-guard.mjs'
import { readGraph } from '../domain/knowledge/knowledge-graph.mjs'
import { createTrainingConfigStore } from '../domain/life/training-config.mjs'
import { createTrainingRunner } from '../domain/life/training-runner.mjs'
import { createTrainingService } from '../domain/life/training-service.mjs'
import { MEMORY_ROUTE } from '../domain/memory/memory-hub.mjs'
import { createFocusState } from '../domain/play/focus.mjs'
import { createGameLearnHandler, searchWeb } from '../domain/play/game-learning.mjs'
import { createGameMemoryWorkspace } from '../domain/play/game-memory-workspace.mjs'
import { createMinecraftBrain } from '../domain/play/minecraft-brain.mjs'
import { createMinecraftInquiry } from '../domain/play/minecraft-inquiry.mjs'
import { createMinecraftService } from '../domain/play/minecraft-service.mjs'
import { createMinecraftWorld } from '../domain/play/minecraft-world.mjs'
import { createPracticeLoop } from '../domain/play/practice-loop.mjs'
import { PROMPT_LAYERS_VERSION } from '../domain/voice/prompt-layers.mjs'
// dsh-little-whale —— 宿主半区（M2）。
//
// 职责（契约 docs/contract.md §1/§2/§3）：
//   · 静态资源：GET /api/dsh-poetry/assets?f=<相对路径>（M0 形态，只读、越界 404）；
//   · 数据接口：GET health / bootstrap / poems / ci / yun / knowledge / settings / weather / about；
//   · 设置接口：GET/PUT settings.json（PUT 仅回环来源、白名单校验、原子写 $DSH_HOME/.dsh-poetry/）；
//   · 天气接口：GET weather.json（Open-Meteo 地理编码 + forecast，20min 缓存，失败降级永 200）；
//   · v1.58：不监听任何会话事件、不统计对话活跃度；插件上下文/记忆与对话完全独立；
//   · 实时自言自语：GET self-talk.json，用宿主当前默认模型生成（llm/agentDefaultModel 可选，缺失安全降级）；
//     结合心情/天气/她的状态/体验，并从 $DSH_HOME/agent-memory/topics.json 话题库挑一个小知识自然融入；
//   · 模型心情：GET mood-ai.json，模型读本地 92 张心情图鉴 + 当天情境自主决定心情/配图（缺失安全降级）；
//   · 心情动画素材：GET/HEAD pet-media?f=…（dsh-pet MIT webm，不随包；不套栅栏，与 assets 并列）；
//   · 自主记忆：self-talk / mood-ai 新生成成功时，把模型输出**只追加**写入 $DSH_HOME/agent-memory/；
//   · 飞花令全量校验：GET feihua-full.json 按令字懒加载项目同级 _ref/feihua-full/<字>.json（LRU≤4、gzip、缺失降级）；
//   · 所有新增路由接入宿主信任栅栏（lib/trust.mjs，委托 connection.requestRejection）。
//
// 数据来自包内 data/*.json（只读），宿主进程内按 mtime + dataVersion 缓存；
// data/ 缺失或损坏时优雅降级（200 + DATA_UNAVAILABLE），不会让插件加载失败。
import { PET_MEDIA_ROUTE } from '../domain/works/pet-media.mjs'
import { configureModelRuntime, resetModelRuntime } from '../kernel/llm-call.mjs'
import { MODEL_ERRORS_ROUTE, summarizeModelErrors } from '../kernel/model-errors.mjs'
import { createServiceRegistry } from '../kernel/service.mjs'
import { createDomainServices } from './domain-services.mjs'
import { wireHttp } from './http-wiring.mjs'
import { createRealActivityAdapters } from './hub-routes.mjs'
import { getActiveHubRuntime, registerHubRuntime, sanitizeEventText } from './hub-runtime.mjs'
import { createRuntimeSetup } from './runtime-setup.mjs'

/** Cordis 插件名（loader 诊断用；与 package.json 的 dsh.bundle 行 id 一致）。 */
export const name = 'dsh-little-whale'

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SENSITIVE_FACT_KEY =
  /(api[-_]?key|access[-_]?token|secret|token|password|passwd|authorization|cookie|credential|private[-_]?key)/i

function sanitizeFacts(value, depth = 0) {
  if (depth > 3) return null
  if (typeof value === 'string') return sanitizeEventText(value, { maxLength: 200 })
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeFacts(item, depth + 1))
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, item] of Object.entries(value).slice(0, 20)) {
      const safeKey = sanitizeEventText(key, { maxLength: 60 })
      out[safeKey] = SENSITIVE_FACT_KEY.test(key) ? '[redacted]' : sanitizeFacts(item, depth + 1)
    }
    return out
  }
  return null
}

function truncateFacts(facts) {
  if (!isPlainObject(facts)) return {}
  const sanitized = sanitizeFacts(facts)
  const json = JSON.stringify(sanitized)
  if (typeof json === 'string' && json.length <= 2000) return sanitized
  return { truncated: true, preview: sanitizeEventText(json, { maxLength: 500 }) }
}

function truncateObservation(observation) {
  if (!isPlainObject(observation)) return null
  const list = (value, max) =>
    Array.isArray(value)
      ? value
          .filter((item) => typeof item === 'string')
          .slice(0, max)
          .map((item) => sanitizeEventText(item, { maxLength: 80 }))
      : []
  return {
    position: sanitizeEventText(observation.position, { maxLength: 60 }),
    players: list(observation.players, 6),
    health: Number.isFinite(Number(observation.health)) ? Number(observation.health) : null,
    food: Number.isFinite(Number(observation.food)) ? Number(observation.food) : null,
    timeOfDay: sanitizeEventText(observation.timeOfDay, { maxLength: 20 }),
    inventory: list(observation.inventory, 8),
    nearbyBlocks: list(observation.nearbyBlocks, 8),
    lastChat: sanitizeEventText(observation.lastChat, { maxLength: 120 }),
  }
}

/**
 * Gate E3：Minecraft shadow 事件 sink（由 composition 注入 minecraft-world 的 onShadowEvent）。
 * 只发事件、不改 bot 行为；off 时 no-op；任何异常只记录。
 * @param {{hubRuntime?: object|null, logger?: object|null, worldId?: string, now?: () => number}} [options]
 */
export function createMinecraftShadowSink(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const logger = /** @type {any} */ (spec.logger ?? null)
  const worldId = typeof spec.worldId === 'string' && spec.worldId.length > 0 ? spec.worldId.slice(0, 40) : 'main'
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  return function minecraftShadowSink(raw) {
    try {
      const hubRuntime = spec.hubRuntime ?? getActiveHubRuntime()
      if (!hubRuntime || typeof hubRuntime.mode !== 'function' || typeof hubRuntime.ingest !== 'function') return
      const mode = hubRuntime.mode()
      if (mode !== 'shadow' && mode !== 'full') return
      if (!isPlainObject(raw)) return
      if (raw.kind === 'receipt') {
        const receipt = isPlainObject(raw.receipt) ? raw.receipt : null
        if (
          receipt === null ||
          typeof receipt.ok !== 'boolean' ||
          typeof receipt.tool !== 'string' ||
          receipt.tool.length === 0
        )
          return
        const built = toToolReceiptEvent(
          {
            ok: receipt.ok,
            tool: receipt.tool.slice(0, 40),
            detail: sanitizeEventText(receipt.detail, { maxLength: 240 }),
            facts: truncateFacts(receipt.facts),
            at: Number.isFinite(Number(receipt.at)) ? Number(receipt.at) : now(),
            ...(typeof receipt.commandId === 'string' && receipt.commandId.length > 0
              ? { commandId: receipt.commandId.slice(0, 80) }
              : {}),
          },
          { key: typeof raw.taskKey === 'string' ? raw.taskKey.slice(0, 128) : '' },
          { now, worldId },
        )
        if (built.ok === true) hubRuntime.ingest('minecraft', built.event)
        return
      }
      if (raw.kind === 'observe') {
        const envelope = createEventEnvelope(
          {
            activity: 'minecraft',
            type: 'minecraft.observation',
            version: 1,
            at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : now(),
            subject: ('world:' + worldId).slice(0, 200),
            topics: ['minecraft.observation', 'world:' + worldId.toLowerCase().replace(/[^a-z0-9._:-]/g, '-')],
            payload: {
              ok: raw.ok === true,
              interrupted: raw.interrupted === true,
              tool: sanitizeEventText(raw.tool, { maxLength: 40 }),
              reason: sanitizeEventText(raw.reason, { maxLength: 120 }),
              permission: sanitizeEventText(raw.permission, { maxLength: 20 }),
              blocked: sanitizeEventText(raw.blocked, { maxLength: 40 }),
              observation: truncateObservation(raw.observation),
            },
          },
          { now, prefix: 'mc' },
        )
        if (envelope.ok === true) hubRuntime.ingest('minecraft', envelope.event)
      }
    } catch (error) {
      try {
        logger?.warn?.(
          `[dsh-little-whale] minecraft shadow 钩子失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } catch (warnError) {
        void warnError
      }
    }
  }
}

export function startPluginRuntime(deps) {
  const {
    host,
    hostCtx,
    logger,
    env,
    home,
    settingsPath,
    memoryDir,
    guiInbox,
    selfProjects,
    selfEvents,
    growthMetrics,
    journal,
    worldFeedback,
    selfLifecycle,
    selfMetabolism,
    modelBudget,
    modelGate,
    stateRef,
    packageRoot,
    dataDir,
    version,
    assetsDir,
  } = deps
  const ASSETS_ROUTE = '/api/dsh-poetry/assets'
  /** @type {Array<() => void>} */
  const disposers = []
  /** @type {object|null} */
  let hubRuntime = null
  /** @type {object|null} */
  let trainingService = null
  /** @type {object|null} */
  let trainingRunner = null
  /** @type {object|null} */
  let minecraftWorldRef = null
  try {
    // v1.81：插件停用/测试清理时释放全局模型运行时。
    host.effect(hostCtx, () => () => resetModelRuntime(), 'dsh-little-whale: 模型运行时')
    // v1.73：后台服务运行时 + 启动期基础设施 + 公网访问 + 网页小测/巡检/作品。
    const {
      serviceRuntime,
      autonomy,
      heartbeat,
      webServer,
      dataStore,
      settingsStore,
      migrationSummary,
      fence,
      weatherService,
      getLlm,
      getSelection,
      modelPolicy,
      localVoiceMode,
      localVoice,
      modelErrorsPath,
      topicsPath,
      topicsArchivePath,
      topicBank,
      feelingsPath,
      feelingBank,
      twinWebAccess,
      webAccess,
      browseForWhale,
      webBench,
      agentLoop,
      mediaBudget,
      selfWorks,
    } = createRuntimeSetup({
      env,
      home,
      settingsPath,
      dataDir: dataDir,
      logger,
      getHostService: (name) => host.get(hostCtx, name),
      journal,
      worldFeedback,
      disposers,
      assetsDir: assetsDir,
      getState: () => (stateRef.current !== null ? stateRef.current.snapshot() : null),
    })

    // W2：域服务装配（记忆/知识/世界观/声音/心跳/心情/自我/聊天/成长/生活循环）。
    const services = createDomainServices({
      env,
      home,
      settingsPath,
      memoryDir,
      topicsPath,
      topicsArchivePath,
      topicBank,
      feelingsPath,
      feelingBank,
      journal,
      worldFeedback,
      selfEvents,
      selfProjects,
      selfMetabolism,
      selfLifecycle,
      autonomy,
      serviceRuntime,
      heartbeat,
      modelPolicy,
      getLlm,
      getSelection,
      modelErrorsPath,
      webAccess,
      browseForWhale,
      selfWorks,
      disposers,
      logger,
      packageRoot: packageRoot,
      guiInbox,
      getHostService: (serviceName) => host.get(hostCtx, serviceName),
    })
    stateRef.current = services.selfState
    const costGuard = createCostGuard({ env, settings: settingsStore.get(), logger })
    configureModelRuntime({ budget: modelBudget, gate: modelGate, costGuard })
    const {
      memoryConsolidator,
      selfTalkService,
      petMediaDir,
      moodAiService,
      feihuaFullService,
      selfState,
      dailyLife,
      chatTokenFile,
      chatBridge,
      attention,
      guiPush,
      outbox,
      manualTokenFile,
      manualReading,
      growth,
      selfDrive,
      selfWander,
      selfReading,
      selfNetlang,
      selfPhilosophy,
      growthArc,
      emotionalEpisodes,
      methodMemory,
      thoughtChain,
      moralPractice,
      affectState,
      internalRules,
      ruleSynthesizer,
      actionPolicy,
      styleExemplars,
      knowledgeGraph,
      selfTrainer,
      relationship,
      emotional,
      commitments,
      worldview,
      readingHint,
      memoryHub,
      nightlyConsolidator,
      appraisalLoop,
      habitMemory,
    } = services
    // 服务注册表：把域服务快照收进 health（start/stop 仍由 composition 管理，不重复接管生命周期）。
    const serviceRegistry = createServiceRegistry({ logger })
    for (const [name, service] of Object.entries({
      knowledgeGraph,
      selfTrainer,
      relationship,
      emotional,
      dailyLife,
      commitments,
      growth,
      selfDrive,
      selfWander,
      selfReading,
      selfNetlang,
      selfPhilosophy,
      methodMemory,
      thoughtChain,
      moralPractice,
      affectState,
      internalRules,
      ruleSynthesizer,
      actionPolicy,
      styleExemplars,
      memoryConsolidator,
      nightlyConsolidator,
      appraisalLoop,
      habitMemory,
      webBench,
      agentLoop,
      selfWorks,
      outbox,
      attention,
      guiPush,
      localVoice,
    })) {
      if (service && typeof service.snapshot === 'function') {
        serviceRegistry.register({ name, snapshot: () => service.snapshot() })
      }
    }

    // 优雅退出时把模型预算的合并写盘 flush 掉，最多不丢最后一个窗口。
    serviceRuntime.register('模型预算', {
      dispose: () => {
        try {
          modelBudget.flush()
        } catch (_error) {}
      },
    })

    // v1.82：心跳最后启动（等所有活动注册完）。
    serviceRuntime.register('心跳', {
      start: () => heartbeat.start(),
      stop: () => heartbeat.stop(),
      dispose: () => heartbeat.dispose(),
    })

    // Gate H2：训练旁路（默认关闭；runner 不注入 → 不会 spawn 任何训练进程，也不写 adapter）。
    const trainingConfigStore = createTrainingConfigStore({ home, logger, now: () => Date.now() })
    // Gate H6：真实 runner 只包装本地 self-train.sh；默认 config.enabled=false → 不会执行。
    trainingRunner = createTrainingRunner({ logger, env })
    trainingService = createTrainingService({
      configStore: trainingConfigStore,
      runner: (input) => /** @type {any} */ (trainingRunner).run(input),
      cancelRun: (input) =>
        /** @type {any} */ (trainingRunner).cancel(/** @type {any} */ (input) && /** @type {any} */ (input).runId),
      logger,
    })

    // Gate E1：Hub 运行时（默认 off/shadow；只注册生命周期/快照，不改变聊天/游戏/心跳行为）。
    // 活动适配器（chat/minecraft）与记忆只读接入在 Gate E2–E4 由装配方注入；此处不创建业务副作用。
    hubRuntime = registerHubRuntime(serviceRuntime, {
      logger,
      env,
      settings: settingsStore.get(),
      // Gate E4：现有记忆只读接入（真实路径只读；查询只经 hubRuntime.queryMemory，不写）。
      memoryPaths: {
        agentMemoryDir: memoryDir,
        gameMemoryDir: path.join(settingsPath.dir, 'game-memory'),
        methodsFile: path.join(settingsPath.dir, 'methods.json'),
      },
      // Gate F1：完整 Hub 图（EventBus/TaskBoard/Scheduler/Registry/FeedbackLedger/WorldSupervisor），
      // 默认 featureFlag off → 只装配、不运行；不启动真实 World。
      assembleHub: true,
      // Gate I1：opt-in 持久化路径（默认 flag 关闭 → 不创建 store、不写盘）。
      persistPaths: {
        taskBoardFile: path.join(settingsPath.dir, 'hub-taskboard.json'),
        eventFile: path.join(settingsPath.dir, 'hub-events.jsonl'),
      },
      // Gate H3：真实 Activity 执行适配器（仅 featureFlag full 时启用；off/shadow 不执行）。
      activityManifests: createRealActivityAdapters({
        chatBridgeProvider: () => chatBridge,
        minecraftWorldProvider: () => minecraftWorldRef,
        now: () => Date.now(),
      }),
    })

    const runtimeDeps = {
      growth,
      selfDrive,
      selfWander,
      selfReading,
      selfNetlang,
      memoryConsolidator,
      serviceRuntime,
      modelBudget,
      modelGate,
      heartbeat,
      webAccess,
      summarizeModelErrors,
      modelErrorsPath,
      growthMetrics,
      selfWorks,
      mediaBudget,
      outbox,
      attention,
      promptLayersVersion: PROMPT_LAYERS_VERSION,
      selfEvents,
      selfMetabolism,
      worldFeedback,
      selfLifecycle,
      twinEnabled:
        String(env.DSH_POETRY_TWIN ?? '').toLowerCase() !== 'off' && settingsStore.get().twinSystem !== false,
      webBench,
      agentLoop,
      knowledgeGraph,
      selfTrainer,
      relationship,
      emotional,
      dailyLife,
      migrationSummary,
      commitments,
      guiPush,
      localVoice,
      worldview,
      hubRuntime,
      logger: logger.snapshot(),
    }
    const twinDeps = {
      env,
      home,
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      logger,
      primary: {
        state: selfState,
        journalPath: path.join(memoryDir, 'journal.jsonl'),
        journal,
        learningLogPath: path.join(memoryDir, 'learning-log.md'),
        researchThreadFile: path.join(settingsPath.dir, 'research-thread.json'),
        methodologyFile: path.join(settingsPath.dir, 'methodology.json'),
        curriculumFile: path.join(settingsPath.dir, 'curriculum.json'),
        webAccess,
        twinWebAccess,
      },
    }
    const getGrowthSnapshot = () => {
      try {
        const arc = growthArc && typeof growthArc.snapshot === 'function' ? growthArc.snapshot() : null
        const philosophy =
          selfPhilosophy && typeof selfPhilosophy.snapshot === 'function' ? selfPhilosophy.snapshot() : null
        const emotions =
          emotionalEpisodes && typeof emotionalEpisodes.current === 'function' ? emotionalEpisodes.current(6) : []
        let autobiography = ''
        try {
          autobiography = readFileSync(path.join(home, '.dsh/agent-memory/autobiography.md'), 'utf8').slice(0, 8000)
        } catch {
          autobiography = ''
        }
        let report = ''
        try {
          if (arc && typeof arc.reportFile === 'string' && arc.reportFile.length > 0) {
            report = readFileSync(arc.reportFile, 'utf8').slice(0, 6000)
          }
        } catch {
          report = ''
        }
        return { ok: true, generatedAt: Date.now(), growth: arc, philosophy, emotions, autobiography, report }
      } catch (error) {
        return {
          ok: false,
          error: { code: 'GROWTH_SNAPSHOT_FAILED', message: error instanceof Error ? error.message : String(error) },
        }
      }
    }

    const gameTokenLimit = () => {
      try {
        const value = settingsStore && typeof settingsStore.get === 'function' ? settingsStore.get().modelTokenLimit : 0
        return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(200000, Math.floor(Number(value))) : 0
      } catch (_error) {
        return 0
      }
    }
    const gameMemory = createGameMemoryWorkspace({
      dir: path.join(settingsPath.dir, 'game-memory'),
      legacyFile: path.join(settingsPath.dir, 'game-memory.json'),
      // Gate H5：旧写盘成功后通知记忆写入桥（默认 memoryWrite=false → no-op；失败隔离）。
      onRecord: (entry) => {
        try {
          const hub = /** @type {any} */ (hubRuntime)
          if (hub === null || typeof hub.recordMemory !== 'function') return
          const pending = hub.recordMemory(entry)
          if (pending !== null && pending !== undefined && typeof pending.catch === 'function') pending.catch(() => {})
        } catch (error) {
          void error
        }
      },
    })
    const gameFocus = createFocusState({ file: path.join(settingsPath.dir, 'focus.json') })
    const minecraftService = createMinecraftService({ home, env })
    const gameLearning = createGameLearnHandler({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      gameMemory,
      tokenFile: chatTokenFile,
      getTokenLimit: gameTokenLimit,
      logger,
    })
    const gameInquiry = createMinecraftInquiry({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      gameMemory,
      methodMemory,
      getTokenLimit: gameTokenLimit,
      logger,
    })
    const practiceLoop = createPracticeLoop({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      methodMemory,
      journal,
      search: searchWeb,
      logger,
      getTokenLimit: gameTokenLimit,
      stateFile: path.join(settingsPath.dir, 'practice.json'),
    })
    if (heartbeat && typeof heartbeat.add === 'function') {
      heartbeat.add('实践复盘', () =>
        practiceLoop.maybeRun({
          problem: '最近有没有反复做不通、卡住的事？',
          receipts: [minecraftWorld.snapshot().lastReceipt].filter((receipt) => receipt && receipt.ok === false),
        }),
      )
    }
    const minecraftWorld = createMinecraftWorld({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      gameMemory,
      inquiry: gameInquiry,
      getTokenLimit: gameTokenLimit,
      tokenFile: chatTokenFile,
      permissionFile: path.join(settingsPath.dir, 'game-permission.json'),
      logger,
      getSelfState: () => selfState.snapshot(),
      // Gate E3：Minecraft shadow 观察（Hub 默认 off → 钩子 no-op，不改变 bot 行为）。
      onShadowEvent: createMinecraftShadowSink({ hubRuntime, logger, worldId: 'main' }),
    })
    minecraftWorldRef = minecraftWorld
    const gameBrain = createMinecraftBrain({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      logger,
      gameMemory,
      getTokenLimit: gameTokenLimit,
      getSelfState: () => selfState.snapshot(),
    })

    wireHttp({
      webServer,
      disposers,
      serviceRuntime,
      logger,
      env,
      home,
      host,
      hostCtx,
      dataStore,
      settingsStore,
      fence,
      weatherService,
      selfTalkService,
      moodAiService,
      emotional,
      localVoice,
      getLocalVoiceMode: () => localVoiceMode,
      journal,
      feihuaFullService,
      getSelfState: () => selfState.snapshot(),
      getReadings: readingHint,
      memoryHub,
      runtimeDeps,
      twin: twinDeps,
      readonly: {
        getGrowthSnapshot,
        assetsRoute: ASSETS_ROUTE,
        assetsDir: assetsDir,
        petMediaRoute: PET_MEDIA_ROUTE,
        petMediaDir,
        memoryRoute: MEMORY_ROUTE,
        memoryHub,
        modelErrorsRoute: MODEL_ERRORS_ROUTE,
        modelErrorsPath,
        presenceRoute: PRESENCE_ROUTE,
        worldFeedback,
        logger,
        selfWorks,
        getSelfState: () => selfState.snapshot(),
        getGrowth: () => growth.snapshot(),
        getActions: () => selfDrive.snapshot(),
        getProject: () => selfProjects.snapshot().current,
        graph: { getSnapshot: () => knowledgeGraph.snapshot(), readGraph, stateDir: settingsPath.dir },
      },
      chat: {
        chatBridge,
        focus: gameFocus,
        methodMemory,
        world: minecraftWorld,
        knowledgeGraph,
        internalRules,
        styleExemplars,
        relationship,
        emotional,
        dailyLife,
        commitments,
        memoryDir,
        localVoice,
        getLocalVoiceMode: () => localVoiceMode,
      },
      interactive: {
        gameBrain,
        gameMemory,
        gameFocus,
        gameLearning,
        minecraftWorld,
        minecraftService,
        chatTokenFile,
        manualReading,
        worldFeedback,
        tokenFile: manualTokenFile,
        attention,
        outbox,
        selfProjects,
      },
      chatTokenFile,
      memoryDir,
      settingsFile: settingsPath.file,
      logVersion: version,
      training: { service: trainingService, configStore: trainingConfigStore },
    })
  } catch (error) {
    // 路由注册失败只影响本插件，不能让宿主 apply 抛未捕获异常。
    logger?.error?.(
      `[dsh-little-whale] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
  return { hubRuntime, trainingService, trainingRunner }
}
