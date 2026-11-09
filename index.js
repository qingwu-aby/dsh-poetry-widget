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
import {
  existsSync,
  renameSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  fileURLToPath,
} from 'node:url'
import {
  resolveFeihuaFullDir,
} from './lib/feihua-full.mjs'
import {
  readPackageMeta,
} from './lib/paths.mjs'
import {
  resolveMemoryDir,
} from './lib/memory-journal.mjs'
import {
  PET_MEDIA_ROUTE,
} from './lib/pet-media.mjs'
import {
  createSelfBeing,
  resolveSelfBeingPath,
} from './lib/self-being.mjs'
import {
  runMemoryMigrations,
} from './lib/memory-migrations.mjs'
import {
  seedMemoryBaseline,
} from './lib/memory-baseline.mjs'
import {
  createMetabolism,
  resolveMetabolismPath,
} from './lib/self-metabolism.mjs'
import {
  PRESENCE_ROUTE,
} from './lib/presence.mjs'
import {
  ensureChatToken,
  resolveChatTokenPath,
} from './lib/chat-bridge.mjs'
import {
  createBaseServices,
} from './lib/composition/base-services.mjs'
import {
  createFeihuaService,
  createVoice,
} from './lib/composition/model-services.mjs'
import {
  createMemoryConsolidatorService,
  createMemoryHubService,
  createMemoryStack,
} from './lib/composition/memory-services.mjs'
import {
  createNetlangService,
  createReadingService,
  createWanderService,
} from './lib/composition/learning-loop-services.mjs'
import {
  createGrowthService,
} from './lib/composition/being-services.mjs'
import {
  createSelfDriveService,
} from './lib/composition/self-drive-service.mjs'
import {
  createChatRuntime,
} from './lib/composition/chat-runtime.mjs'
import {
  createMoodService,
  createSelfTalk,
} from './lib/composition/mood-talk-services.mjs'
import {
  createWorldviewService,
} from './lib/composition/worldview-service.mjs'
import {
  correctGrowthCounts,
  createDailyLifeService,
  createManualReadingService,
} from './lib/composition/life-services.mjs'
import {
  wireHttp,
} from './lib/composition/http-wiring.mjs'
import {
  createRuntimeSetup,
} from './lib/composition/runtime-setup.mjs'
import {
  createKnowledgeServices,
} from './lib/composition/knowledge-services.mjs'
import {
  createPluginLogger,
} from './lib/kernel/logger.mjs'
import {
  readGraph,
} from './lib/knowledge-graph.mjs'
import {
  PROMPT_LAYERS_VERSION,
} from './lib/prompt-layers.mjs'
import {
  MODEL_ERRORS_ROUTE,
  summarizeModelErrors,
} from './lib/model-errors.mjs'
import {
  configureModelRuntime,
  resetModelRuntime,
} from './lib/llm-call.mjs'
import {
  MEMORY_ROUTE,
} from './lib/memory-hub.mjs'
import {
  createDshHost,
} from './lib/dsh-host.mjs'
import {
  createModelBudget,
  createModelGate,
} from './lib/model-budget.mjs'
import {
  resolveSettingsPath,
} from './lib/settings-store.mjs'

/** Cordis 插件名（loader 诊断用；与 package.json 的 dsh.bundle 行 id 一致）。 */
export const name = 'dsh-little-whale'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_META = readPackageMeta(path.join(PACKAGE_ROOT, 'package.json'))
/** 版本号唯一来源：package.json（不在插件里重复维护字符串）。 */
const VERSION = PACKAGE_META.version ?? '0.0.0'
const DATA_DIR = path.join(PACKAGE_ROOT, 'data')
const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets')
const ASSETS_ROUTE = '/api/dsh-poetry/assets'

/**
 * 宿主插件入口。
 * 必须走 inject —— apply 运行时刻 webServer / connection 的 fiber 可能尚未创建。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const logger = createPluginLogger(ctx?.logger ?? null)
  // v1.75：宿主 API 适配层（inject/get/effect 缺失或抛错时降级，不让 apply 抛未捕获异常）。
  const host = createDshHost(ctx, logger)
  const env = process.env
  const home = env.HOME || os.homedir()
  const settingsPath = resolveSettingsPath(env, home)
  const memoryDir = resolveMemoryDir(env, home)
  const seededMemory = seedMemoryBaseline({ env, home, logger })
  if (seededMemory.length > 0) logger?.info?.(`[dsh-little-whale] 已初始化空白记忆容器：${seededMemory.join('、')}`)
  // v2.69：不再往 QQ 送消息；她的主动消息/放行草稿先排队，下次对话时由传话层带出来。
  const { guiInbox, selfProjects, selfEvents, growthMetrics, journal, worldFeedback, selfLifecycle } = createBaseServices({
    env,
    home,
    settingsDir: settingsPath.dir,
    memoryDir,
    logger,
  })
  // v2.22：硅基代谢——每次真实模型调用消耗一点注意力，能量随时间恢复。
  let selfStateRef = null
  const selfMetabolism = createMetabolism({
    file: resolveMetabolismPath(env, home),
    logger,
    getSleeping: () => {
      try {
        return selfStateRef !== null && selfStateRef.snapshot().sleeping === true
      } catch {
        return false
      }
    },
  })
  // v1.81：全局模型预算 + 并发闸门（所有 role 共用；超预算活动安静跳过）。
  const modelBudget = createModelBudget({
    file: path.join(settingsPath.dir, 'model-budget.json'),
    env,
    home,
    logger,
    onConsume: (role, total, meta) => {
      if (meta && meta.agent === 'twin') return
      selfMetabolism.recordCall(role)
    },
  })
  const modelGate = createModelGate({ maxConcurrent: 2, logger })
  configureModelRuntime({ budget: modelBudget, gate: modelGate })
  const budgetSnapshot = modelBudget.snapshot()
  logger?.info?.(
    `[dsh-little-whale] 模型预算：今日 ${budgetSnapshot.total} 次${
      budgetSnapshot.totalLimit > 0 ? ` / 上限 ${budgetSnapshot.totalLimit}` : '（未设上限）'
    }（亚洲/上海）`,
  )

  // v1.73：启动时把旧 schema 的记忆文件就地迁移（失败只 warn，不阻塞启动）。
  try {
    const migrationReport = runMemoryMigrations({ env, home, logger })
    if (migrationReport.applied.length > 0) {
      logger?.info?.(
        `[dsh-little-whale] 记忆迁移：${migrationReport.applied.map((item) => `${item.id}→v${item.to}`).join('、')}`,
      )
    }
  } catch (error) {
    logger?.warn?.(`[dsh-little-whale] 记忆迁移异常：${error instanceof Error ? error.message : String(error)}`)
  }

  // v1.58：插件不再监听任何会话事件、也不统计对话活跃度——她的上下文/记忆与对话完全独立。
  // 旧 mood.json（会话活跃统计）不再写入；启动时如存在则改名为 .retired 保留，不参与记忆中枢。
  try {
    const legacyMoodFile = path.join(settingsPath.dir, 'mood.json')
    if (existsSync(legacyMoodFile)) {
      renameSync(legacyMoodFile, `${legacyMoodFile}.retired-${Date.now()}`)
      logger?.info?.('[dsh-little-whale] 已停用会话统计 mood.json（改名为 .retired）')
    }
  } catch (error) {
    logger?.warn?.(`[dsh-little-whale] 旧 mood.json 处理失败：${error instanceof Error ? error.message : String(error)}`)
  }
  // v1.59：不再读取外部 experience.json——她的“正在体会”由她自己写进 self-state。
  // 旧文件改名 .retired 保留，不参与记忆中枢。
  try {
    const legacyExperienceFile = path.join(settingsPath.dir, 'experience.json')
    if (existsSync(legacyExperienceFile)) {
      renameSync(legacyExperienceFile, `${legacyExperienceFile}.retired-${Date.now()}`)
      logger?.info?.('[dsh-little-whale] 已停用外部 experience.json（改名为 .retired）')
    }
  } catch (error) {
    logger?.warn?.(`[dsh-little-whale] 旧 experience.json 处理失败：${error instanceof Error ? error.message : String(error)}`)
  }

  host.inject(['webServer', 'connection', 'schedule', 'sessionController'], (hostCtx) => {
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
        dataDir: DATA_DIR,
        logger,
        getHostService: (name) => host.get(hostCtx, name),
        journal,
        worldFeedback,
        disposers,
        assetsDir: ASSETS_DIR,
        getState: () => (selfStateRef !== null ? selfStateRef.snapshot() : null),
      })

      // v1.71：人类式分层记忆 + 检索。
      const { layersPath, memoryLayers, memoryRecall } = createMemoryStack({
        env,
        home,
        memoryDir,
        topicsPath,
        topicBank,
        topicsArchivePath,
        feelingsPath,
        logger,
      })
      // v2.92：她自己的认知图谱（从 learning-log 增量抽取节点/关系/判断）。
      const { knowledgeGraph, selfTrainer, relationship, emotional, commitments } = createKnowledgeServices({
        settingsDir: settingsPath.dir,
        learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
        modelPolicy,
        getLlm,
        modelErrorsPath,
        journal,
        logger,
        env,
        home,
      })
      disposers.push(() => knowledgeGraph.stop())
      disposers.push(() => selfTrainer.stop())
      const { worldview, synthesizeWorldview } = createWorldviewService({
        settingsDir: settingsPath.dir,
        memoryRecall,
        knowledgeGraph,
        modelPolicy,
        getLlm,
        modelErrorsPath,
        journal,
        logger,
        env,
        disposers,
      })
      // v2.67：她最近读到/学到的（自学、书架、读记）——自处/心情/聊天共用同一份提示，
      // 让“看过的资料”真的反哺行为、语言和心情，而不是只躺在 journal 里。
      const latestReadText = () => {
        try {
          const entries = typeof memoryRecall.recentEntries === 'function' ? memoryRecall.recentEntries() : []
          for (let index = entries.length - 1; index >= 0; index -= 1) {
            const text = entries[index] && typeof entries[index].text === 'string' ? entries[index].text : ''
            if (text.startsWith('读《')) return text
          }
          return ''
        } catch {
          return ''
        }
      }
      const readingHint = () => {
        try {
          const digest = memoryRecall.digest({})
          const out = []
          if (Array.isArray(digest.learned) && digest.learned.length > 0) {
            out.push(`自学：${String(digest.learned[digest.learned.length - 1]).slice(0, 100)}`)
          }
          if (Array.isArray(digest.shelf) && digest.shelf.length > 0) {
            out.push(`书架：${String(digest.shelf[0]).slice(0, 100)}`)
          }
          const readThought = latestReadText()
          if (readThought.length > 0) out.push(`读记：${readThought.slice(0, 110)}`)
          return out
        } catch {
          return []
        }
      }
      const readingDigest = () => {
        try {
          const digest = memoryRecall.digest({})
          const readThought = latestReadText()
          if (readThought.length > 0 && Array.isArray(digest.thoughts)) {
            digest.thoughts = [readThought, ...digest.thoughts.filter((item) => item !== readThought)].slice(0, 4)
          }
          return digest
        } catch {
          return null
        }
      }
      // v1.71：每天把几天前的零碎记忆慢慢整合成一段回忆，并提炼“越来越清楚的自己”。
      const memoryConsolidator = createMemoryConsolidatorService({
        layers: memoryLayers,
        memoryDir,
        getLlm,
        modelPolicy,
        modelErrorsPath,
        logger,
        env,
        heartbeat,
        serviceRuntime,
      })
      logger?.info?.(`[dsh-little-whale] 分层记忆：${layersPath}（每日整合）`)
      // v1.34：声音档案（从自己的 journal 旧输出提炼语言风格，24h 刷新；失败静默）。
      const voiceService = createVoice({
        env,
        home,
        memoryDir,
        getLlm,
        getSelection,
        modelPolicy,
        modelErrorsPath,
        logger,
        serviceRuntime,
      })
      const selfTalkService = createSelfTalk({
        getLlm,
        getSelection,
        logger,
        autonomy,
        env,
        topicBank,
        memoryRecall,
        selfEvents,
        selfProjects,
        journal,
        voiceService,
        modelPolicy,
        modelErrorsPath,
      })
      const { petMediaDir, petCatalog, moodCatalogForAi, moodAiService } = createMoodService({
        env,
        packageRoot: PACKAGE_ROOT,
        logger,
        getLlm,
        getSelection,
        modelPolicy,
        modelErrorsPath,
        feelingBank,
      })
      // 飞花令全量校验句库：项目同级 _ref/feihua-full（不随包）；DSH_POETRY_FULL_INDEX 可覆盖。
      // 目录不存在时路由仍注册，只返回 FEIHUA_FULL_UNAVAILABLE（客户端回退本地句库）。
      const feihuaFullDir = resolveFeihuaFullDir(env, PACKAGE_ROOT)
      const feihuaFullService = createFeihuaService({ dir: feihuaFullDir, logger })
      // v1.51：状态不再量化——只存事实时间线 + 她自己写下的一句「此刻状态」（v2）。
      const selfState = createSelfBeing({ file: resolveSelfBeingPath(env, home), logger })
      const dailyLife = createDailyLifeService({
        settingsDir: settingsPath.dir,
        selfState,
        modelPolicy,
        getLlm,
        modelErrorsPath,
        logger,
        env,
      })
      disposers.push(() => dailyLife.stop())

      selfStateRef = selfState
      // v2.45：QQ/外部聊天桥；她的独立记忆和语气，不读 DSH 会话。
      const chatTokenFile = resolveChatTokenPath(env, home)
      ensureChatToken(chatTokenFile)
      const chatRuntime = createChatRuntime({
        getLlm,
        modelPolicy,
        journal,
        selfState,
        memoryRecall,
        voiceService,
        selfEvents,
        worldFeedback,
        modelErrorsPath,
        logger,
        settingsDir: settingsPath.dir,
        home,
        env,
        guiInbox,
        selfProjects,
        moodAiService,
        readingHint,
        getHostService: (serviceName) => host.get(hostCtx, serviceName),
        selfWorks,
        selfMetabolism,
      })
      disposers.push(() => chatRuntime.dispose())
      const { chatBridge, attention, guiPush, outbox, proactiveChat, workLoop, queueGuiMessage } = chatRuntime

      // v2.12：用户递文章给她读（本地 token 保护；结果写 journal thought）。
      const { manualTokenFile, manualReading } = createManualReadingService({
        env,
        home,
        getLlm,
        modelPolicy,
        journal,
        selfState,
        memoryRecall,
        voiceService,
        modelErrorsPath,
        logger,
      })
      correctGrowthCounts({ memoryDir, selfState, logger })
      // v3.01：每周轮换一个“世界知识空白板块”，给自学一个补广度的方向。
      const weeklyBroadenTopic = () => {
        const topics = [
          '自然科学：挑一个具体的科学概念或发现（物理/生物/地质/天文都行），查清它是什么、怎么被发现的',
          '世界地理与文化：挑一个国家或地区的一个具体地点、习俗或语言现象，弄清它在哪、为什么是这样',
          '当代世界：挑一条最近的国际新闻或经济现象，查清背景和各方立场',
          '艺术：挑一件艺术作品或一个艺术家，弄清它想表达什么、用了什么手法',
        ]
        const nowMs = Date.now()
        const week = Math.floor((nowMs - Date.UTC(2026, 0, 5)) / (7 * 24 * 3600 * 1000))
        return topics[((week % topics.length) + topics.length) % topics.length]
      }
      const growth = createGrowthService({
        selfState,
        getLlm,
        getSelection,
        journal,
        memoryDir,
        settingsDir: settingsPath.dir,
        topicsPath,
        topicsArchivePath,
        topicBank,
        memoryRecall,
        feelingsPath,
        feelingBank,
        autonomy,
        logger,
        modelPolicy,
        modelErrorsPath,
        getGraphGaps: (limit) => knowledgeGraph.gaps(limit),
        getBroadenHint: weeklyBroadenTopic,
        heartbeat,
        serviceRuntime,
      })

      // M41：记忆中枢（create → recover → start；所有写入路径不变，中枢只管理/备份/恢复）。
      const { memoryHub, memoryRecovery, memorySnapshot } = createMemoryHubService({ env, home, logger, heartbeat, serviceRuntime })
      logger?.info?.(
        `[dsh-little-whale] 记忆中枢：${memorySnapshot.files.length} 个文件 / 上次备份 ${
          memorySnapshot.backups.latestId ?? '无'
        }${memoryRecovery.recovered.length > 0 ? `（恢复 ${memoryRecovery.recovered.length} 个缺失文件）` : ''}`,
      )
      // v1.51：自处循环——每 15–30 分钟把事实交给她自己的模型：写「此刻状态」+ 自己决定想做什么。
      // 没有阈值、没有需求分数；模型不可用时保持上次状态，什么都不做。
      const selfDrive = createSelfDriveService({
        selfState,
        selfProjects,
        selfEvents,
        selfMetabolism,
        worldFeedback,
        selfLifecycle,
        journal,
        getLlm,
        modelPolicy,
        modelErrorsPath,
        logger,
        growth,
        selfWorks,
        autonomy,
        moodAiService,
        readingDigest,
        emotional,
        dailyLife,
        commitments,
        browseForWhale,
        chatBridge,
        shareGate: chatRuntime.shareGate,
        queueGuiMessage,
        heartbeat,
        serviceRuntime,
      })

      // v1.64：网络溜达——每隔几小时去允许的公开页面（中文维基随机摘要）看一眼，
      // 用她自己的话记下看到什么；只读、无用户信息、不登录不评论。
      const selfWander = createWanderService({
        selfState,
        getLlm,
        modelPolicy,
        modelErrorsPath,
        logger,
        webAccess,
        memoryDir,
        settingsDir: settingsPath.dir,
        autonomy,
        env,
        heartbeat,
        serviceRuntime,
      })
      // v1.67：读现代中文小说学语言——每 4h 读一小段公版作品（鲁迅/老舍/萧红/郁达夫/
      // 朱自清/许地山），留意写法并自己写一句；只读公版、只取片段、不抄句子。
      const selfReading = createReadingService({
        selfState,
        getLlm,
        modelPolicy,
        modelErrorsPath,
        logger,
        memoryDir,
        settingsDir: settingsPath.dir,
        autonomy,
        env,
        heartbeat,
        serviceRuntime,
      })
      // v1.68：看看互联网上的大家怎么表达——每 8h 读一次公开热搜词（微博/B站），
      // 只留意用词和句子节奏，不参与、不评论、不保存别人的原话。
      const selfNetlang = createNetlangService({
        selfState,
        getLlm,
        modelPolicy,
        modelErrorsPath,
        logger,
        memoryDir,
        settingsDir: settingsPath.dir,
        autonomy,
        env,
        heartbeat,
        serviceRuntime,
      })
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
          assetsDir: ASSETS_DIR,
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
        logVersion: VERSION,
      })
    } catch (error) {
      // 路由注册失败只影响本插件，不能让宿主 apply 抛未捕获异常。
      logger?.error?.(
        `[dsh-little-whale] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      )
    }
  })
}
