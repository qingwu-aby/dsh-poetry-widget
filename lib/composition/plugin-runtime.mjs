import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createActivityPermissionGuard } from '../core/activity-permission-guard.mjs'
import { createEventEnvelope } from '../core/event-schema.mjs'
import { toToolReceiptEvent } from '../core/minecraft-activity.mjs'
import { PRESENCE_ROUTE } from '../domain/being/presence.mjs'
import { readGraph } from '../domain/knowledge/knowledge-graph.mjs'
import { createTrainingConfigStore } from '../domain/life/training-config.mjs'
import { createTrainingDataset } from '../domain/life/training-dataset.mjs'
import { createTrainingEvaluator } from '../domain/life/training-evaluator.mjs'
import { createTrainingRunner } from '../domain/life/training-runner.mjs'
import { createTrainingService } from '../domain/life/training-service.mjs'
import { MEMORY_ROUTE } from '../domain/memory/memory-hub.mjs'
import { createFocusState } from '../domain/play/focus.mjs'
import { createGameLearnHandler } from '../domain/play/game-learning.mjs'
import { createGameMemoryWorkspace } from '../domain/play/game-memory-workspace.mjs'
import { createMinecraftBrain } from '../domain/play/minecraft-brain.mjs'
import { createMinecraftInquiry } from '../domain/play/minecraft-inquiry.mjs'
import { createMinecraftService } from '../domain/play/minecraft-service.mjs'
import { createMinecraftWorld } from '../domain/play/minecraft-world.mjs'
import { createPracticeLoop } from '../domain/play/practice-loop.mjs'
import { PROMPT_LAYERS_VERSION } from '../domain/voice/prompt-layers.mjs'
import { PET_MEDIA_ROUTE } from '../domain/works/pet-media.mjs'
import { configureModelRuntime, resetModelRuntime } from '../kernel/llm-call.mjs'
import { MODEL_ERRORS_ROUTE, summarizeModelErrors } from '../kernel/model-errors.mjs'
import { createServiceRegistry } from '../kernel/service.mjs'
import { createChatTurnRunner } from './chat-service.mjs'
import { createCostPolicyRuntime } from './cost-policy-routes.mjs'
import { createDomainServices } from './domain-services.mjs'
import { createGuideServices, isPlainObject } from './guide-services.mjs'
import { wireHttp } from './http-wiring.mjs'
import { createRealActivityAdapters } from './hub-routes.mjs'
import { getActiveHubRuntime, registerHubRuntime, sanitizeEventText } from './hub-runtime.mjs'
import { createRuntimeSetup } from './runtime-setup.mjs'
export const name = 'dsh-little-whale'
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
/** Gate I4：journal 写入桥（延迟绑定 hubRuntime；默认 memoryWrite 关闭时 recordJournal 直接 skipped）。 */
function wrapJournalBridge(journal, getRuntime) {
  if (journal === null || journal === undefined || typeof journal.append !== 'function') return journal
  return {
    ...journal,
    append: async (entry) => {
      const result = await journal.append(entry)
      if (result !== null && result !== undefined && result.ok === true && result.skipped !== true) {
        const runtime = getRuntime()
        if (runtime !== null && runtime !== undefined && typeof runtime.recordJournal === 'function') {
          try {
            const pending = runtime.recordJournal({ ...entry, ts: result.ts })
            if (pending !== null && pending !== undefined && typeof pending.catch === 'function')
              pending.catch(() => {})
          } catch (error) {
            void error
          }
        }
      }
      return result
    },
  }
}
/** Gate I4：methodMemory 写入桥（record 成功后才通知；失败隔离）。 */
function wrapMethodBridge(methodMemory, getRuntime) {
  if (methodMemory === null || methodMemory === undefined || typeof methodMemory.record !== 'function')
    return methodMemory
  return {
    ...methodMemory,
    record: (input) => {
      const recorded = methodMemory.record(input)
      if (recorded === true) {
        const runtime = getRuntime()
        if (runtime !== null && runtime !== undefined && typeof runtime.recordMethod === 'function') {
          try {
            const pending = runtime.recordMethod({
              name: input && input.name,
              howTo: input && input.howTo,
              source: input && input.source,
              usedCount: 1,
              lastAt: Date.now(),
            })
            if (pending !== null && pending !== undefined && typeof pending.catch === 'function')
              pending.catch(() => {})
          } catch (error) {
            void error
          }
        }
      }
      return recorded
    },
  }
}
/** Gate J2：chatTakeover 开关（默认 true；env DSH_POETRY_CHAT_TAKEOVER / settings.chatTakeover 可关）。 */
function resolveChatTakeover(env, settings) {
  const raw =
    env !== null && env !== undefined && typeof env.DSH_POETRY_CHAT_TAKEOVER === 'string'
      ? env.DSH_POETRY_CHAT_TAKEOVER.trim().toLowerCase()
      : ''
  if (raw === '0' || raw === 'off' || raw === 'false' || raw === 'no') return false
  if (raw === '1' || raw === 'on' || raw === 'true' || raw === 'yes') return true
  if (settings !== null && settings !== undefined && typeof settings === 'object') {
    if (settings.chatTakeover === false || settings.chatTakeover === 'off' || settings.chatTakeover === 'false')
      return false
  }
  return true
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
  /** @type {Function|null} */
  let chatTurnRunnerLazy = null
  const journalBridge = wrapJournalBridge(journal, () => hubRuntime)
  /** @type {object|null} */
  let methodMemoryBridge = null
  /** @type {object|null} */
  let trainingService = null
  /** @type {object|null} */
  let trainingDataset = null
  /** @type {object|null} */
  let trainingEvaluator = null
  /** @type {object|null} */
  let activityGuard = null
  /** @type {object|null} */
  let trainingRunner = null
  /** @type {object|null} */
  let minecraftWorldRef = null
  try {
    host.effect(hostCtx, () => () => resetModelRuntime(), 'dsh-little-whale: 模型运行时')
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
      journal: journalBridge,
      worldFeedback,
      disposers,
      assetsDir: assetsDir,
      getState: () => (stateRef.current !== null ? stateRef.current.snapshot() : null),
    })
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
      journal: journalBridge,
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
    const costPolicy = createCostPolicyRuntime({
      file: path.join(settingsPath.dir, 'cost-policy.json'),
      env,
      settings: settingsStore.get(),
      budget: modelBudget,
      gate: modelGate,
      logger,
    })
    configureModelRuntime({ budget: modelBudget, gate: modelGate, costGuard: costPolicy.costGuard })
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
    methodMemoryBridge = wrapMethodBridge(methodMemory, () => hubRuntime)
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
      methodMemory: methodMemoryBridge,
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
      const snapshot = service === null || service === undefined ? null : /** @type {any} */ (service).snapshot
      if (typeof snapshot === 'function') {
        serviceRegistry.register({ name, snapshot: () => snapshot.call(service) })
      }
    }
    serviceRuntime.register('模型预算', {
      dispose: () => {
        try {
          modelBudget.flush()
        } catch (_error) {}
      },
    })
    serviceRuntime.register('心跳', {
      start: () => heartbeat.start(),
      stop: () => heartbeat.stop(),
      dispose: () => heartbeat.dispose(),
    })
    const trainingConfigStore = createTrainingConfigStore({ home, logger, now: () => Date.now() })
    activityGuard = createActivityPermissionGuard({
      file: path.join(settingsPath.dir, 'activity-grants.json'),
      now: () => Date.now(),
      logger,
    })
    const selfTrainDir =
      typeof env.DSH_POETRY_SELF_TRAIN_DIR === 'string' && env.DSH_POETRY_SELF_TRAIN_DIR.length > 0
        ? env.DSH_POETRY_SELF_TRAIN_DIR
        : path.join(os.homedir(), 'Library', 'Application Support', 'dsh-whale-mlx', 'self-train')
    trainingEvaluator = createTrainingEvaluator({
      reportFile: path.join(selfTrainDir, 'report.md'),
      historyFile: path.join(selfTrainDir, 'history.log'),
      threshold: Number.isFinite(Number(env.DSH_POETRY_EVAL_THRESHOLD))
        ? Number(env.DSH_POETRY_EVAL_THRESHOLD)
        : undefined,
      now: () => Date.now(),
    })
    trainingDataset = createTrainingDataset({
      agentMemoryDir: memoryDir,
      gameMemoryDir: path.join(settingsPath.dir, 'game-memory'),
      methodsFile: path.join(settingsPath.dir, 'methods.json'),
      file: path.join(settingsPath.dir, 'training-data.jsonl'),
      now: () => Date.now(),
    })
    trainingRunner = createTrainingRunner({ logger, env })
    trainingService = createTrainingService({
      configStore: trainingConfigStore,
      datasetStats: () => /** @type {any} */ (trainingDataset).stats(),
      evaluator: (input) => /** @type {any} */ (trainingEvaluator).evaluate(input),
      runner: (input) => /** @type {any} */ (trainingRunner).run(input),
      cancelRun: (input) =>
        /** @type {any} */ (trainingRunner).cancel(/** @type {any} */ (input) && /** @type {any} */ (input).runId),
      logger,
    })
    Object.assign(trainingService, { dataset: trainingDataset })
    hubRuntime = registerHubRuntime(serviceRuntime, {
      logger,
      env,
      settings: settingsStore.get(),
      memoryPaths: {
        agentMemoryDir: memoryDir,
        gameMemoryDir: path.join(settingsPath.dir, 'game-memory'),
        methodsFile: path.join(settingsPath.dir, 'methods.json'),
      },
      assembleHub: true,
      memoryWriteFile: path.join(settingsPath.dir, 'memory-gateway.jsonl'),
      persistPaths: {
        taskBoardFile: path.join(settingsPath.dir, 'hub-taskboard.json'),
        eventFile: path.join(settingsPath.dir, 'hub-events.jsonl'),
      },
      activityManifests: createRealActivityAdapters({
        chatBridgeProvider: () => chatBridge,
        minecraftWorldProvider: () => minecraftWorldRef,
        now: () => Date.now(),
      }),
      permissionGuard: activityGuard,
      chatTurnRunner: (input) =>
        chatTurnRunnerLazy === null
          ? Promise.resolve({ ok: false, code: 'HUB_CHAT_UNAVAILABLE', message: '聊天接管执行器未注入' })
          : chatTurnRunnerLazy(input),
    })
    chatTurnRunnerLazy = createChatTurnRunner(hubRuntime)
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
        journal: journalBridge,
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
      search: webAccess.search,
      logger,
    })
    const gameInquiry = createMinecraftInquiry({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      gameMemory,
      methodMemory: methodMemoryBridge,
      getTokenLimit: gameTokenLimit,
      search: webAccess.search,
      logger,
    })
    const practiceLoop = createPracticeLoop({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      methodMemory: methodMemoryBridge,
      journal: journalBridge,
      search: webAccess.search,
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
    const { guideLoop, toolRegistry, capabilityProposals, toolSkills } = createGuideServices({
      settingsDir: settingsPath.dir,
      getLlm,
      policy: modelPolicy,
    })
    const minecraftWorld = createMinecraftWorld({
      getLlm,
      policy: modelPolicy,
      modelErrorsPath,
      gameMemory,
      inquiry: gameInquiry,
      guide: guideLoop,
      toolRegistry,
      capabilityProposals,
      toolSkills,
      getTokenLimit: gameTokenLimit,
      tokenFile: chatTokenFile,
      permissionFile: path.join(settingsPath.dir, 'game-permission.json'),
      logger,
      getSelfState: () => selfState.snapshot(),
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
      journal: journalBridge,
      feihuaFullService,
      getSelfState: () => selfState.snapshot(),
      getReadings: readingHint,
      memoryHub,
      runtimeDeps,
      guide: guideLoop,
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
        hubRuntime,
        chatTakeover: resolveChatTakeover(env, settingsStore.get()),
        focus: gameFocus,
        methodMemory: methodMemoryBridge,
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
      training: { service: trainingService, configStore: trainingConfigStore, dataset: trainingDataset },
      costPolicy: { store: costPolicy.store, apply: costPolicy.apply },
      activityGrants: { guard: activityGuard },
    })
  } catch (error) {
    logger?.error?.(
      `[dsh-little-whale] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
  return {
    hubRuntime,
    trainingService,
    trainingRunner,
    trainingDataset,
    trainingEvaluator,
    activityGuard,
  }
}
