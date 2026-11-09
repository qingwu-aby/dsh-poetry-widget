// @ts-check
// lib/composition/plugin-runtime.mjs —— 插件运行期总装（W2）：runtime setup → domain services → HTTP。

import path from 'node:path'
import { readGraph } from '../domain/knowledge/knowledge-graph.mjs'
import { resetModelRuntime } from '../kernel/llm-call.mjs'
import { MEMORY_ROUTE } from '../domain/memory/memory-hub.mjs'
import { MODEL_ERRORS_ROUTE, summarizeModelErrors } from '../kernel/model-errors.mjs'
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
import { PRESENCE_ROUTE } from '../domain/being/presence.mjs'
import { PROMPT_LAYERS_VERSION } from '../domain/voice/prompt-layers.mjs'
import { createDomainServices } from './domain-services.mjs'
import { wireHttp } from './http-wiring.mjs'
import { createRuntimeSetup } from './runtime-setup.mjs'

/** Cordis 插件名（loader 诊断用；与 package.json 的 dsh.bundle 行 id 一致）。 */
export const name = 'dsh-little-whale'

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
  try {
    // v1.81：插件停用/测试清理时释放全局模型运行时。
    host.effect(hostCtx, () => () => resetModelRuntime(), 'dsh-little-whale: 模型运行时')
    // v1.73：后台服务运行时 + 启动期基础设施 + 公网访问 + 网页小测/巡检/作品。
    const {
      serviceRuntime,
      autonomy,
      heartbeat,
      webServer,
      connection,
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
      deepseekWeb,
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
    const {
      memoryConsolidator,
      selfTalkService,
      petMediaDir,
      petCatalog,
      moodAiService,
      feihuaFullService,
      selfState,
      dailyLife,
      chatTokenFile,
      chatBridge,
      attention,
      guiPush,
      outbox,
      proactiveChat,
      workLoop,
      queueGuiMessage,
      manualTokenFile,
      manualReading,
      growth,
      selfDrive,
      selfWander,
      selfReading,
      selfNetlang,
      knowledgeGraph,
      selfTrainer,
      relationship,
      emotional,
      commitments,
      worldview,
      readingHint,
      readingDigest,
      memoryHub,
      chatRuntime,
    } = services
    // v1.82：心跳最后启动（等所有活动注册完）。
    serviceRuntime.register('心跳', {
      start: () => heartbeat.start(),
      stop: () => heartbeat.stop(),
      dispose: () => heartbeat.dispose(),
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
      twinEnabled: String(env.DSH_POETRY_TWIN ?? '').toLowerCase() === 'on',
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
        knowledgeGraph,
        relationship,
        emotional,
        dailyLife,
        commitments,
        memoryDir,
        localVoice,
        getLocalVoiceMode: () => localVoiceMode,
      },
      interactive: {
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
    })
  } catch (error) {
    // 路由注册失败只影响本插件，不能让宿主 apply 抛未捕获异常。
    logger?.error?.(
      `[dsh-little-whale] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
}
