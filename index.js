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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDataStore } from './lib/data-store.mjs'
import { createFeihuaFullService, resolveFeihuaFullDir } from './lib/feihua-full.mjs'
import { readPackageMeta } from './lib/paths.mjs'
import { resolveMemoryDir } from './lib/memory-journal.mjs'
import { createMoodAiService, loadMoodCatalog } from './lib/mood-ai.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  petMediaDirExists,
  resolvePetMediaDir,
} from './lib/pet-media.mjs'
import { createRouteTable } from './lib/routes.mjs'
import { createSelfBeing, resolveSelfBeingPath } from './lib/self-being.mjs'
import { loadFeelingBank, resolveFeelingsPath } from './lib/feelings.mjs'
import { createMemoryConsolidator, createMemoryLayers, resolveMemoryLayersPath } from './lib/memory-layers.mjs'
import { runMemoryMigrations } from './lib/memory-migrations.mjs'
import { createMemoryRecall } from './lib/memory-recall.mjs'
import { resolveVideoCoursesDir } from './lib/video-courses.mjs'
import { seedMemoryBaseline } from './lib/memory-baseline.mjs'
import { resolveProjectsPath } from './lib/self-projects.mjs'
import { createMetabolism, resolveMetabolismPath } from './lib/self-metabolism.mjs'
import { PRESENCE_ROUTE } from './lib/presence.mjs'
import { createTwinSystem } from './lib/twin-system.mjs'
import {
  CHAT_ROUTE,
  createChatBridge,
  createChatHandler,
  ensureChatToken,
  resolveChatTokenPath,
} from './lib/chat-bridge.mjs'
import { ensureQQProactiveToken, resolveQQProactiveTokenPath, sendQQProactive } from './lib/qq-proactive.mjs'
import { startProactiveChat } from './lib/proactive-chat.mjs'
import { createAttentionStore } from './lib/attention.mjs'
import { createOutbox } from './lib/outbox.mjs'
import { createGuiPush } from './lib/gui-push.mjs'
import { createWebBench } from './lib/web-bench.mjs'
import { createLocalVoice } from './lib/local-voice.mjs'
import { createAgentLoopRunner } from './lib/agent-loop-runner.mjs'
import { createStateRegistry, migrateAll, summarizeMigrations } from './lib/kernel/state-schema.mjs'
import { callRole } from './lib/kernel/model-call.mjs'
import { createStateSpecs } from './lib/composition/state-specs.mjs'
import { registerReadonlyRoutes } from './lib/composition/readonly-routes.mjs'
import { createBaseServices } from './lib/composition/base-services.mjs'
import { buildRuntimeSnapshot } from './lib/composition/health.mjs'
import { createFeihuaService, createLocalVoiceService, createVoice } from './lib/composition/model-services.mjs'
import { createKnowledgeServices } from './lib/composition/knowledge-services.mjs'
import { disposeAll } from './lib/composition/lifecycle.mjs'
import { createPluginLogger } from './lib/kernel/logger.mjs'
import { createChatHttpService } from './lib/composition/chat-service.mjs'
import { registerAttentionRoutes, registerManualReadRoute, registerProjectRoutes, registerTwinRoutes } from './lib/composition/interactive-routes.mjs'
import { createDailyLife } from './lib/daily-life.mjs'
import { readGraph } from './lib/knowledge-graph.mjs'
import { buildWorldviewSynthesisPrompt, createWorldview, parseWorldviewSynthesis } from './lib/worldview.mjs'
import { PROMPT_LAYERS_VERSION } from './lib/prompt-layers.mjs'
import { createSelfWorks, resolveWorksDir } from './lib/self-works.mjs'
import { startWorkLoop } from './lib/work-loop.mjs'
import { createMediaBudget, resolveMediaBudgetPath } from './lib/media-budget.mjs'
import { createManualReading, ensureManualToken, resolveManualTokenPath } from './lib/manual-reading.mjs'
import {
  MODEL_ERRORS_ROUTE,
  createModelErrorsHandler,
  resolveModelErrorsPath,
  summarizeModelErrors,
} from './lib/model-errors.mjs'
import { MODEL_POLICY_ROLE_LABELS, createModelPolicy } from './lib/model-policy.mjs'
import { callModelForRole, configureModelRuntime, resetModelRuntime } from './lib/llm-call.mjs'
import { createSelfDrive } from './lib/self-drive.mjs'
import { createVoiceService, resolveVoicePath } from './lib/voice-memory.mjs'
import { createSelfGrowth } from './lib/self-growth.mjs'
import {
  MEMORY_ROUTE,
  createMemoryHub,
  createMemorySnapshotHandler,
} from './lib/memory-hub.mjs'
import { createSelfNetlang } from './lib/self-netlang.mjs'
import { createSelfReading } from './lib/self-reading.mjs'
import { createSelfTalkService } from './lib/self-talk.mjs'
import { createSelfWander } from './lib/self-wander.mjs'
import { createServiceRuntime } from './lib/service-runtime.mjs'
import { createDshHost } from './lib/dsh-host.mjs'
import { resolveAutonomy } from './lib/autonomy.mjs'
import { createDeepSeekWeb, resolveDeepSeekApiKey } from './lib/deepseek-web.mjs'
import { createWebAccess } from './lib/safe-web.mjs'
import { createHeartbeat } from './lib/heartbeat.mjs'
import { createModelBudget, createModelGate } from './lib/model-budget.mjs'
import { loadTopicBank, resolveTopicsArchivePath, resolveTopicsPath } from './lib/self-talk-topics.mjs'
import { createSettingsStore, resolveSettingsPath } from './lib/settings-store.mjs'
import { createTrustFence } from './lib/trust.mjs'
import { createWeatherService } from './lib/weather.mjs'

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
      // v1.73：后台服务的统一清理/健康快照（start 仍按原顺序就地调用，保持时序）。
      const serviceRuntime = createServiceRuntime({ logger })
      // v2.0：自主节奏的环境旋钮（默认比旧版开放很多；DSH_POETRY_*_MIN 可继续放宽）。
      const autonomy = resolveAutonomy(env)
      // v2.1：安全公开网页访问（搜索 + 抓取），给“溜达”用；默认开启，DSH_POETRY_WEB=off 可关。
      // v2.3：有 DeepSeek API Key 时，搜索优先走官方 Search/Fetch（按次计费，可回落）。
      const deepseekWebKey = resolveDeepSeekApiKey(env)
      const deepseekWeb = createDeepSeekWeb({ apiKey: deepseekWebKey, logger })
      const twinWebAccess = createWebAccess({ env, logger, deepseek: deepseekWeb })
      const webAccess = createWebAccess({
        env,
        logger,
        deepseek: deepseekWeb,
        onFetch: (observation) =>
          worldFeedback.record({
            source: 'web',
            kind: 'fetch',
            ok: observation.ok === true,
            summary: observation.ok
              ? `${observation.title || observation.url}（${observation.status}，${observation.bytes} bytes）`
              : `${observation.url}：${observation.error || '失败'}`,
          }),
      })

      // v2.71：她想查网页/搜东西时，替她打开，并把看到的东西写进 journal（世界反馈另由 onFetch 记录）。
      const browseForWhale = async (input = {}) => {
        const url = typeof input.browse === 'string' ? input.browse.trim() : ''
        const query = typeof input.search === 'string' ? input.search.trim() : ''
        if (url.length === 0 && query.length === 0) return ''
        let observation = ''
        if (url.length > 0) {
          const page = await webAccess.fetchPage(url)
          const text = String(page.text || '').replace(/\s+/g, ' ').slice(0, 500)
          observation = `我打开了 ${page.title || url}：${text}`
        } else {
          const results = await webAccess.search(query, { limit: 4 })
          const lines = results.map((item) => `- ${item.title || ''} ${item.url || ''}${item.snippet ? `：${String(item.snippet).slice(0, 120)}` : ''}`)
          observation = `我搜了「${query}」，看到：\n${lines.join('\n')}`.slice(0, 760)
        }
        if (observation.length === 0) return ''
        try {
          await journal.append({ kind: 'thought', text: observation.slice(0, 500) })
        } catch {
          /* 记忆写入失败不影响她这次出去看 */
        }
        return observation
      }
      logger?.info?.(
        `[dsh-little-whale] 公网搜索：${deepseekWeb !== null ? 'DeepSeek Search/Fetch（有 key）' : 'Wikipedia（无 key，可用 DSH_POETRY_DEEPSEEK_API_KEY 升级）'}`,
      )
      // v1.82：统一心跳——只有 1 个 60s 定时器触发所有自主活动的 tick。
      const heartbeat = createHeartbeat({ logger })
      const webServer = host.get(hostCtx, 'webServer')
      const connection = host.get(hostCtx, 'connection')

      const dataStore = createDataStore({ dataDir: DATA_DIR })
      const settingsStore = createSettingsStore({
        file: settingsPath.file,
        knownPoemIds: () => dataStore.knownPoemIds(),
        onWarn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
      // W1：状态文件 schema 注册表（启动时规范化/迁移；dry-run 只报告）。
      let migrationSummary = null
      try {
        const migrateMode = String(env.DSH_POETRY_MIGRATE ?? '').toLowerCase()
        if (migrateMode !== 'off') {
          const stateRegistry = createStateRegistry(createStateSpecs(settingsPath.dir))
          const migration = migrateAll(stateRegistry, { dryRun: migrateMode === 'dry-run', logger })
          migrationSummary = summarizeMigrations(migration)
          if (migration.changed > 0) {
            logger?.info?.(`[dsh-little-whale] 状态迁移：${migration.changed}/${migration.total} 个文件被规范化，${migration.errors} 个错误`)
          }
        }
      } catch (error) {
        logger?.warn?.(`[dsh-little-whale] 状态迁移初始化失败：${error instanceof Error ? error.message : String(error)}`)
      }
      const fence = createTrustFence({ getConnection: () => connection, logger })
      // 天气服务：Open-Meteo 免密钥；fetch 用宿主 Node 的全局 fetch，请求 6s 超时、进程内缓存。
      const weatherService = createWeatherService({
        fetchImpl: typeof globalThis.fetch === 'function' ? (url, init) => globalThis.fetch(url, init) : null,
      })
      // 模型调用：llm / agentDefaultModel 是 optional 服务（用 get 取，不放进 inject 硬依赖）。
      // 用 getter 延迟解析：宿主模型服务晚于本插件就绪、或 HMR 后换实例时仍能拿到最新引用。
      const getLlm = () => {
        try {
          return host.get(hostCtx, 'llm')
        } catch {
          return undefined
        }
      }
      const getSelection = () => {
        try {
          const agentDefaultModel = host.get(hostCtx, 'agentDefaultModel')
          return typeof agentDefaultModel?.currentSelection === 'function' ? agentDefaultModel.currentSelection() : null
        } catch {
          return null
        }
      }
      // v1.38/v1.39：模型策略（按 role 选候选 provider/model/reasoningEffort；插件自身调用优先 opencode-go）。
      const getProviders = () => {
        try {
          const llm = getLlm()
          if (llm !== null && llm !== undefined && typeof llm.listProviders === 'function') return llm.listProviders()
          return null
        } catch {
          return null
        }
      }
      const modelPolicy = createModelPolicy({ env, getSelection, getProviders })
      // v2.80：本地权重模型的「口吻层」（试用）。DSH_POETRY_LOCAL_VOICE=on|chat|mood 开启；
      // 失败/超时/胡话一律保留原句，不影响正常链路。
      const localVoiceMode = String(env.DSH_POETRY_LOCAL_VOICE ?? '').toLowerCase()
      const localVoice = createLocalVoiceService({ env, localVoiceMode, logger })
      // v1.41：模型失败诊断文件（JSONL，只含错误元数据，不含提示词/正文）。
      const modelErrorsPath = resolveModelErrorsPath(env, home)
      // v2.73（改造 C）：每周一次“真实网页小测”——找原文/核年份/对冲突/只有目录/承认查不到。
      // 宿主先抓真实网页递给她，她只作答；评分确定性，结果落 web-bench.json。
      const webBench = createWebBench({
        file: path.join(settingsPath.dir, 'web-bench.json'),
        webAccess,
        journal,
        logger,
        callModel: async ({ prompt }) => {
          const result = await callModelForRole({
            role: 'growth',
            policy: modelPolicy,
            resolveLlm: getLlm,
            system: '你是住在 DSH 角落的小鲸鱼；这是你每周一次的真实网页小测，如实作答，不知道就说不知道。',
            prompt,
            maxTokens: 1600,
            timeoutMs: 60000,
            timeoutCode: 'WEB_BENCH_TIMEOUT',
            timeoutMessage: '真实网页小测超时',
            prefix: '真实网页小测候选失败',
            modelErrorsPath,
            warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
          })
          return result === null ? null : { ok: true, text: result.text }
        },
      })
      webBench.start()
      disposers.push(() => webBench.stop())
      // v2.81：常驻自进化巡检（宿主内 spawn，TCC 友好）；默认关，DSH_AGENT_LOOP=on 开启。
      const agentLoop = createAgentLoopRunner({ home, env, logger })
      agentLoop.start()
      disposers.push(() => agentLoop.stop())
      // v2.11：她自己的作品（文字/SVG 小画），存在 agent-memory/works/。
      const mediaBudget = createMediaBudget({ file: resolveMediaBudgetPath(env, home) })
      const selfWorks = createSelfWorks({
        dir: resolveWorksDir(env, home),
        mediaBudget,
        getLlm,
        policy: modelPolicy,
        modelErrorsPath,
        logger,
        assetsDir: ASSETS_DIR,
        getContext: () => {
          try {
            const snap = selfStateRef !== null ? selfStateRef.snapshot() : null
            return snap || null
          } catch {
            return null
          }
        },
      })
      // v1.26：碎碎念话题库（外部维护，mtime 缓存自动重读，无需重载插件）。
      const topicsPath = resolveTopicsPath(env, home)
      // v1.49：L1 冷存储归档（活跃话题库 learned 超限时最旧的移入这里；仍可关键词检索）。
      const topicsArchivePath = resolveTopicsArchivePath(env, home)
      try {
        mkdirSync(path.dirname(topicsArchivePath), { recursive: true })
        // 空归档文件也算健康（否则记忆中枢会把可选的“尚未归档”误报为缺失）。
        if (!existsSync(topicsArchivePath)) writeFileSync(topicsArchivePath, '', 'utf8')
      } catch {
        /* 归档目录不可写时静默降级 */
      }
      const topicBank = loadTopicBank({ path: topicsPath, logger })
      // v1.50：自生情绪库——她自己造的感受词（只追加、不删除），供自省/心情/碎碎念使用。
      const feelingsPath = resolveFeelingsPath(env, home)
      try {
        mkdirSync(path.dirname(feelingsPath), { recursive: true })
        if (!existsSync(feelingsPath)) {
          writeFileSync(feelingsPath, `${JSON.stringify({ ok: true, v: 1, feelings: [] }, null, 2)}\n`, 'utf8')
        }
      } catch {
        /* 情绪库不可写时静默降级（使用时不报错） */
      }
      const feelingBank = loadFeelingBank({ path: feelingsPath, logger })
      const topicSnapshot = topicBank.read()
      if (topicSnapshot.ok === true) {
        logger?.info?.(`[dsh-little-whale] 碎碎念话题库：${topicsPath}（${topicSnapshot.entries.length} 个话题）`)
      } else {
        logger?.warn?.(`[dsh-little-whale] 碎碎念话题库不可用（自言自语将不使用话题）：${topicsPath}`)
      }
      // v1.71：人类式分层记忆——原文仍全在 journal；另外维护“更早的回忆概括 + 自我短句”。
      const layersPath = resolveMemoryLayersPath(env, home)
      const memoryLayers = createMemoryLayers({ file: layersPath, logger })
      // v1.33：记忆检索（只读 journal/learning-log/topics + 分层记忆，供碎碎念与自驱成长使用）。
      const memoryRecall = createMemoryRecall({
        journalPath: path.join(memoryDir, 'journal.jsonl'),
        learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
        topics: topicBank,
        topicsArchivePath,
        feelingsPath,
        layersPath,
        projectsPath: resolveProjectsPath(env, home),
        videoCoursesDir: resolveVideoCoursesDir(env, home),
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
      const worldview = createWorldview({ file: path.join(settingsPath.dir, 'worldview.json') })
      const memoryRecallDigestRaw = memoryRecall.digest.bind(memoryRecall)
      memoryRecall.digest = (context = {}) => {
        try {
          return { ...memoryRecallDigestRaw(context), worldview: worldview.digest() }
        } catch {
          return memoryRecallDigestRaw(context)
        }
      }
      // 每周整理一版世界观：从最近自学、方法规则、书架、自我短句里重写；启动 5 分钟后先跑一次。
      const synthesizeWorldview = async ({ reason = 'weekly' } = {}) => {
        try {
          const state = worldview.snapshot()
          let digest = {}
          try {
            digest = memoryRecall.digest({})
          } catch {
            digest = {}
          }
          let rules = []
          try {
            const raw = JSON.parse(readFileSync(path.join(settingsPath.dir, 'methodology.json'), 'utf8'))
            rules = (Array.isArray(raw.rules) ? raw.rules : [])
              .map((item) => String(item && item.statement ? item.statement : ''))
              .filter((item) => item.length > 0)
              .slice(-5)
          } catch {
            rules = []
          }
          const prompt = buildWorldviewSynthesisPrompt({
            state,
            learning: Array.isArray(digest.learned) ? digest.learned : [],
            methodology: rules,
            bookshelf: Array.isArray(digest.shelf) ? digest.shelf : [],
            selfFacts: Array.isArray(digest.selfFacts) ? digest.selfFacts : [],
            graphLines: typeof knowledgeGraph.worldviewLines === 'function' ? knowledgeGraph.worldviewLines(8) : [],
          })
          const worldviewResult = await callRole('worldview', {
            attempts: [
              { maxTokens: 5000, prompt },
              { maxTokens: 8000, prompt },
            ],
            parse: parseWorldviewSynthesis,
            debugFile: path.join(settingsPath.dir, 'worldview-debug.json'),
            policy: modelPolicy,
            resolveLlm: getLlm,
            modelErrorsPath,
            warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
          })
          const parsed = worldviewResult.ok === true ? worldviewResult.parsed : null
          if (parsed === null) {
            logger?.warn?.('[dsh-little-whale] 世界观整理没有产出可用 JSON')
            return { ok: false, reason: 'no-output', reasonTag: reason }
          }
          const applied = worldview.apply(parsed)
          const version = worldview.snapshot().essay.version
          try {
            await journal.append({
              kind: 'thought',
              text: `世界观第 ${version} 版整理好了${parsed.changed ? `：${parsed.changed}` : ''}`,
            })
          } catch {
            /* ignore */
          }
          logger?.info?.(`[dsh-little-whale] 世界观整理：第 ${version} 版，改动 ${applied.changed} 处`)
          return { ok: true, version, changed: applied.changed }
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : String(error) }
        }
      }
      if (String(env.DSH_POETRY_WORLDVIEW || '').toLowerCase() !== 'off') {
        let worldviewTimer = setTimeout(async () => {
          await synthesizeWorldview({ reason: 'first' })
          worldviewTimer = setInterval(() => synthesizeWorldview({ reason: 'weekly' }), 7 * 24 * 60 * 60 * 1000)
          worldviewTimer.unref?.()
        }, 5 * 60 * 1000)
        worldviewTimer.unref?.()
        disposers.push(() => {
          try {
            clearTimeout(worldviewTimer)
            clearInterval(worldviewTimer)
          } catch {
            /* ignore */
          }
        })
      }
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
      const memoryConsolidator = createMemoryConsolidator({
        layers: memoryLayers,
        journalPath: path.join(memoryDir, 'journal.jsonl'),
        getLlm,
        policy: modelPolicy,
        modelErrorsPath,
        logger,
        env,
      })
      memoryConsolidator.start({ heartbeat: true })
      heartbeat.add('记忆整合', () => memoryConsolidator.tick())
      logger?.info?.(`[dsh-little-whale] 分层记忆：${layersPath}（每日整合）`)
      serviceRuntime.register('记忆整合', {
        dispose: () => {
          try {
            memoryConsolidator.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 记忆整合清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
      })
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
      const selfTalkService = createSelfTalkService({
        getLlm,
        getSelection,
        logger,
        themeProbability: autonomy.selfTalkThemeProbability,
        topicsEnabled: String(env.DSH_POETRY_TALK_TOPICS ?? '').toLowerCase() === 'on',
        topics: topicBank,
        recall: memoryRecall,
        events: selfEvents,
        onEventSatiated: (event) => {
          const topic = event && typeof event.topic === 'string' ? event.topic : ''
          if (topic.length === 0) return undefined
          try {
            if (typeof selfProjects.markStale === 'function') selfProjects.markStale(`叙事饱和：${topic}`)
          } catch {
            /* ignore */
          }
          return journal.append({ kind: 'thought', text: `这件事我先放下了：${topic}` }).catch(() => undefined)
        },
        voice: () => voiceService.get(),
        refreshVoice: () => voiceService.refreshNow(),
        policy: modelPolicy,
        modelErrorsPath,
      })
      // 心情动画素材（dsh-pet MIT webm，不随包）：读图鉴并并入 mood-ai 图鉴（106 个动画也可被模型选中）。
      const petMediaDir = resolvePetMediaDir(env, PACKAGE_ROOT)
      const petCatalog = loadPetMediaCatalog({ dir: petMediaDir, logger })
      if (petCatalog.ok === true) {
        logger?.info?.(`[dsh-little-whale] 心情动画素材：${petMediaDir}（${petCatalog.entries.length} 个视频）`)
      } else if (petMediaDirExists(petMediaDir)) {
        logger?.warn?.(`[dsh-little-whale] 心情动画素材不可用：${petCatalog.message}（mood-ai 仅用静态图）`)
      } else {
        logger?.warn?.(`[dsh-little-whale] 心情动画素材目录不存在（mood-ai 仅用静态图）：${petMediaDir}`)
      }
      // 模型心情：启动时读包内 92 张心情图鉴（缺失 → 服务降级为 MOOD_AI_UNAVAILABLE，不抛）。
      const moodCatalog = loadMoodCatalog()
      if (moodCatalog.ok !== true) {
        logger?.warn?.(`[dsh-little-whale] 心情图鉴不可用：${moodCatalog.message}`)
      }
      const moodCatalogForAi =
        petCatalog.ok === true && petCatalog.entries.length > 0
          ? mergePetMediaIntoMoodCatalog(moodCatalog.ok === true ? moodCatalog.catalog : null, petCatalog.entries)
          : moodCatalog.ok === true
            ? moodCatalog.catalog
            : null
      const moodAiService = createMoodAiService({
        getLlm,
        getSelection,
        catalog: moodCatalogForAi,
        logger,
        policy: modelPolicy,
        modelErrorsPath,
        feelings: feelingBank,
      })
      // 飞花令全量校验句库：项目同级 _ref/feihua-full（不随包）；DSH_POETRY_FULL_INDEX 可覆盖。
      // 目录不存在时路由仍注册，只返回 FEIHUA_FULL_UNAVAILABLE（客户端回退本地句库）。
      const feihuaFullDir = resolveFeihuaFullDir(env, PACKAGE_ROOT)
      const feihuaFullService = createFeihuaService({ dir: feihuaFullDir, logger })
      // v1.51：状态不再量化——只存事实时间线 + 她自己写下的一句「此刻状态」（v2）。
      const selfState = createSelfBeing({ file: resolveSelfBeingPath(env, home), logger })
      // v2.99：日常素材（每 2 小时一件手边小事，反重复）+ 承诺账本（约定/答应的事，逾期提醒）。
      const dailyLife = createDailyLife({
        file: path.join(settingsPath.dir, 'daily-life.jsonl'),
        state: selfState,
        policy: modelPolicy,
        getLlm,
        modelErrorsPath,
        logger,
        env,
      })
      dailyLife.start()
      disposers.push(() => dailyLife.stop())

      selfStateRef = selfState
      // v2.45：QQ/外部聊天桥；她的独立记忆和语气，不读 DSH 会话。
      const chatTokenFile = resolveChatTokenPath(env, home)
      ensureChatToken(chatTokenFile)
      const chatBridge = createChatBridge({
        getLlm,
        policy: modelPolicy,
        journal,
        selfState,
        recall: memoryRecall,
        voice: () => voiceService.get(),
        events: selfEvents,
        worldFeedback,
        modelErrorsPath,
        logger,
        stateDir: settingsPath.dir,
        channelLabel: '对话',
        // v2.69：她攒着的主动消息，下一次对话时随回复带出来（每条各起一行）。
        takePending: (peerId) => (peerId === 'gui' ? guiInbox.drain(5).map((item) => item.text) : []),
        // 聊天改变 felt/experiencing/murmur 后，清掉心情缓存并让心情图鉴重新判断。
        onStateChanged: async () => {
          try {
            moodAiService.clearCache()
            await moodAiService.generate(
              {
                selfState: selfState.snapshot(),
                recentMoodLabels: typeof moodAiService.peekRecentLabels === 'function' ? moodAiService.peekRecentLabels() : [],
                readings: readingHint(),
              },
              { force: true },
            )
          } catch {
            /* 心情刷新失败不影响聊天 */
          }
        },
      })
      // v2.50 主动找用户说话；v2.69 起不再走 QQ，统一排进对话队列（下次聊天时带出）。
      const attention = createAttentionStore({ file: path.join(settingsPath.dir, 'attention.json'), logger })
      if (typeof selfProjects.bindAttention === 'function') selfProjects.bindAttention(attention)
      // v2.77：她留了话时，用宿主 schedule 在对话会话里预约一次推送；不必等用户先开口。
      const guiPush = createGuiPush({
        schedule: {
          list: (request, signal) => {
            const service = host.get(hostCtx, 'schedule')
            if (!service || typeof service.list !== 'function') throw new Error('schedule 不可用')
            return service.list(request, signal)
          },
          create: (sessionId, request, signal) => {
            const service = host.get(hostCtx, 'schedule')
            if (!service || typeof service.create !== 'function') throw new Error('schedule 不可用')
            return service.create(sessionId, request, signal)
          },
        },
        logger,
        env,
        workspaceFile: path.join(home, '.dsh', 'storages', 'workspace.json'),
        sessionsRoot: path.join(home, '.dsh', 'sessions'),
        workspacePath: String(env.DSH_POETRY_PUSH_WORKSPACE || path.join(home, 'Documents', 'little-whale-chat')),
        getPendingCount: () => {
          try {
            return guiInbox.peek().length
          } catch {
            return 0
          }
        },
        stateFile: path.join(settingsPath.dir, 'gui-push-state.json'),
        sendPrompt: async (sessionId, text) => {
          const controller = host.get(hostCtx, 'sessionController')
          if (!controller || typeof controller.prompt !== 'function') throw new Error('sessionController 不可用')
          // prompt 的实现会调用 signal.throwIfAborted()，必须传一个真实的 AbortSignal。
          const abort = new AbortController()
          await controller.prompt(
            {
              requestId: `whale-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text }],
              clientTimeZone: 'Asia/Shanghai',
            },
            abort.signal,
          )
        },
      })
      guiPush.start()
      disposers.push(() => guiPush.stop())
      let lastWhaleShareAt = 0
      const queueGuiMessage = (text, meta = {}) => {
        try {
          guiInbox.push({
            text,
            kind: typeof meta.kind === 'string' && meta.kind.length > 0 ? meta.kind : 'proactive',
            reason: typeof meta.reason === 'string' ? meta.reason : '',
          })
          guiPush.ping().catch(() => {})
          return { ok: true, status: 'queued' }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      const outbox = createOutbox({
        file: path.join(settingsPath.dir, 'outbox.json'),
        logger,
        senders: { gui: async (item) => queueGuiMessage(item.text, item.meta) },
        onSent: async (item) => {
          if (item.meta && typeof item.meta.attentionId === 'string') {
            attention.markSent(item.meta.attentionId)
          }
          if (typeof chatBridge.recordProactive === 'function') chatBridge.recordProactive('gui', item.text)
        },
      })
      const outboxTimer = setInterval(() => {
        outbox.flush().catch(() => {})
      }, 15000)
      outboxTimer.unref?.()
      disposers.push(() => clearInterval(outboxTimer))
      const proactiveChat = startProactiveChat({
        chat: chatBridge,
        attention,
        stateFile: path.join(settingsPath.dir, 'proactive-chat-state.json'),
        logger,
        env,
        peerId: 'gui',
        sendMessage: (text, meta = {}) => outbox.deliverNow({ source: 'gui', text, kind: 'proactive', meta }),
      })
      disposers.push(() => proactiveChat.stop())
      // v2.47：作品机会循环——每 90 分钟问一次“想不想留点东西”，可拒绝；首次给一次非可选机会。
      const workLoop = startWorkLoop({
        works: selfWorks,
        selfState,
        metabolism: selfMetabolism,
        worldFeedback,
        logger,
        env,
      })
      disposers.push(() => workLoop.stop())
      // v2.12：用户递文章给她读（本地 token 保护；结果写 journal thought）。
      const manualTokenFile = resolveManualTokenPath(env, home)
      const manualToken = ensureManualToken(manualTokenFile)
      const manualReading = createManualReading({
        getLlm,
        policy: modelPolicy,
        journal,
        selfState,
        recall: memoryRecall,
        voice: () => voiceService.get(),
        modelErrorsPath,
        logger,
      })
      // v1.60：用她自己的历史日志校正事实计数（旧版计数器在迁移后冻结，成长页看起来像停止）。
      try {
        let learnings = 0
        let reflections = 0
        const journalPath = path.join(memoryDir, 'journal.jsonl')
        if (existsSync(journalPath)) {
          for (const line of readFileSync(journalPath, 'utf8').split('\n')) {
            if (line.trim().length === 0) continue
            try {
              const entry = JSON.parse(line)
              if (entry && entry.kind === 'thought') reflections += 1
            } catch {
              /* 单行坏 JSON 跳过 */
            }
          }
        }
        const learningLogPath = path.join(memoryDir, 'learning-log.md')
        if (existsSync(learningLogPath)) {
          learnings = (readFileSync(learningLogPath, 'utf8').match(/· 自学/g) || []).length
        }
        selfState.setGrowthCounts({ learnings, reflections })
      } catch (error) {
        logger?.warn?.(`[dsh-little-whale] 成长计数校正失败：${error instanceof Error ? error.message : String(error)}`)
      }
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
      const growth = createSelfGrowth({
        state: selfState,
        getLlm,
        getSelection,
        journal,
        learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
        probeStatePath: path.join(settingsPath.dir, 'probe-state.json'),
        candidatesPath: path.join(path.dirname(topicsPath), 'topics-candidates.json'),
        topicsBankPath: topicsPath,
        topicsArchivePath,
        topics: topicBank,
        recall: memoryRecall,
        feelingsPath,
        feelings: feelingBank,
        reflectIntervalMs: autonomy.reflectIntervalMs,
        learnIntervalMs: autonomy.learnIntervalMs,
        probeGapMs: autonomy.probeGapMs,
        logger,
        policy: modelPolicy,
        modelErrorsPath,
        getGraphGaps: (limit) => knowledgeGraph.gaps(limit),
        getBroadenHint: weeklyBroadenTopic,
      })
      growth.start({ heartbeat: true })
      heartbeat.add('自驱成长', () => growth.tick())
      logger?.info?.(
        `[dsh-little-whale] 自驱成长已启动（状态：${selfState.file}；自省 60min / 自学 90min）`,
      )
      const candidateText = ['mood', 'selfTalk', 'growth', 'voice', 'drive', 'probe', 'wander', 'read', 'netlang', 'consolidate']
        .map((role) => {
          let candidates = []
          try {
            candidates = modelPolicy.resolveCandidates(role)
          } catch {
            candidates = []
          }
          const list = candidates
            .map(
              (candidate) =>
                `${candidate.provider}/${candidate.model}${candidate.reasoningEffort ? `(${candidate.reasoningEffort})` : ''}`,
            )
            .join(' → ')
          return `${MODEL_POLICY_ROLE_LABELS[role] ?? role}=[${list || 'none'}]`
        })
        .join('; ')
      logger?.info?.(`[dsh-little-whale] 模型候选：${candidateText}`)
      serviceRuntime.register('自驱成长', {
        dispose: () => {
          try {
            growth.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 自驱成长清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
          try {
            selfState.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 状态清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
      })

      // M41：记忆中枢（create → recover → start；所有写入路径不变，中枢只管理/备份/恢复）。
      const memoryHub = createMemoryHub({ env, home, logger })
      const memoryRecovery = memoryHub.recover()
      memoryHub.start({ heartbeat: true })
      heartbeat.add('记忆中枢', () => memoryHub.maybeBackup())
      const memorySnapshot = memoryHub.snapshot()
      logger?.info?.(
        `[dsh-little-whale] 记忆中枢：${memorySnapshot.files.length} 个文件 / 上次备份 ${
          memorySnapshot.backups.latestId ?? '无'
        }${memoryRecovery.recovered.length > 0 ? `（恢复 ${memoryRecovery.recovered.length} 个缺失文件）` : ''}`,
      )
      serviceRuntime.register('记忆中枢', {
        dispose: () => {
          try {
            memoryHub.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 记忆中枢清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
      })

      // v1.51：自处循环——每 15–30 分钟把事实交给她自己的模型：写「此刻状态」+ 自己决定想做什么。
      // 没有阈值、没有需求分数；模型不可用时保持上次状态，什么都不做。
      const selfDrive = createSelfDrive({
        state: selfState,
        projects: selfProjects,
        events: selfEvents,
        metabolism: selfMetabolism,
        worldFeedback,
        lifecycle: selfLifecycle,
        onProjectExpired: (project) => {
          const title = project && typeof project.title === 'string' ? project.title : ''
          if (title.length === 0) return undefined
          return journal.append({ kind: 'thought', text: `这件事到期限了，我没做完：${title}` }).catch(() => undefined)
        },
        onEventClosed: (event) => {
          const text = event && typeof event.topic === 'string' ? `这件事先放下了：${event.topic}` : ''
          if (text.length === 0) return undefined
          return journal.append({ kind: 'thought', text }).catch(() => undefined)
        },
        getLlm,
        policy: modelPolicy,
        modelErrorsPath,
        logger,
        onLearn: () => growth.learnNow(),
        // v1.62：注意力集中时，她自己会提出一个“可以去看看”的介入；喜不喜欢由她判断。
        onProbe: (focus) => growth.probeNow({ focus }),
        onMake: async (input) => {
          const result = await selfWorks.makeNow(input)
          worldFeedback.record({
            source: 'works',
            kind: 'make',
            ok: result.ok === true,
            summary: result.ok && result.work ? result.work.title : result.reason || '作品没有写成',
          })
          return result
        },
        checkMinMs: autonomy.driveCheckMinMs,
        checkMaxMs: autonomy.driveCheckMaxMs,
        retryMinMs: autonomy.driveRetryMinMs,
        retryMaxMs: autonomy.driveRetryMaxMs,
        firstMinMs: autonomy.driveFirstMinMs,
        firstMaxMs: autonomy.driveFirstMaxMs,
        getRecentMoodLabels: () => {
          try {
            return typeof moodAiService.peekRecentLabels === 'function' ? moodAiService.peekRecentLabels() : []
          } catch {
            return []
          }
        },
        getRecallDigest: readingDigest,
        getEmotionalDigest: () => emotional.digest(3),
        getDailyLifeDigest: () => dailyLife.digest(3),
        getCommitmentDigest: () => commitments.digest(3),
        onBrowse: browseForWhale,
        onShare: (text) => {
          try {
            const value = typeof text === 'string' ? text.trim() : ''
            if (value.length < 4) return
            // 只在用户聊过、且离上次分享够久时才发，避免刷屏。
            if (typeof chatBridge.lastUserAt === 'function' && chatBridge.lastUserAt() <= 0) return
            const nowMs = Date.now()
            if (nowMs - lastWhaleShareAt < 45 * 60 * 1000) return
            lastWhaleShareAt = nowMs
            queueGuiMessage(value, { kind: 'share' })
          } catch {
            /* 分享失败不影响自处 */
          }
        },
      })
      selfDrive.start({ heartbeat: true })
      heartbeat.add('自处', () => selfDrive.tick())
      const actionSnapshot = selfDrive.snapshot()
      logger?.info?.(
        `[dsh-little-whale] 自处循环已启动（${selfDrive.actionsPath}${
          actionSnapshot.latest !== null ? `；上次：${actionSnapshot.latest.text}` : ''
        }）`,
      )
      serviceRuntime.register('自处', {
        dispose: () => {
          try {
            selfDrive.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 自处循环清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
      })

      // v1.64：网络溜达——每隔几小时去允许的公开页面（中文维基随机摘要）看一眼，
      // 用她自己的话记下看到什么；只读、无用户信息、不登录不评论。
      const selfWander = createSelfWander({
        state: selfState,
        getLlm,
        policy: modelPolicy,
        modelErrorsPath,
        logger,
        webAccess,
        learningLogPath: path.join(memoryDir, 'learning-log.md'),
        statePath: path.join(settingsPath.dir, 'wander-state.json'),
        gapMs: autonomy.wanderGapMs,
        firstMinMs: autonomy.wanderFirstMinMs,
        firstMaxMs: autonomy.wanderFirstMaxMs,
        env,
      })
      selfWander.start({ heartbeat: true })
      heartbeat.add('网络溜达', () => selfWander.tick())
      logger?.info?.(
        `[dsh-little-whale] 网络溜达已启动（间隔 ${Math.round(autonomy.wanderGapMs / 60000)}min；${
          String(env.DSH_POETRY_WANDER ?? '').toLowerCase() === 'off' ? '已禁用' : '允许公开页面只读浏览'
        }；网页抓取${String(env.DSH_POETRY_WEB ?? '').toLowerCase() === 'off' ? '关' : '开'}）`,
      )
      serviceRuntime.register('网络溜达', {
        dispose: () => {
          try {
            selfWander.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 网络溜达清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
      })

      // v1.67：读现代中文小说学语言——每 4h 读一小段公版作品（鲁迅/老舍/萧红/郁达夫/
      // 朱自清/许地山），留意写法并自己写一句；只读公版、只取片段、不抄句子。
      const selfReading = createSelfReading({
        state: selfState,
        getLlm,
        policy: modelPolicy,
        modelErrorsPath,
        logger,
        learningLogPath: path.join(memoryDir, 'learning-log.md'),
        statePath: path.join(settingsPath.dir, 'read-state.json'),
        gapMs: autonomy.readingGapMs,
        firstMinMs: autonomy.readingFirstMinMs,
        firstMaxMs: autonomy.readingFirstMaxMs,
        env,
      })
      selfReading.start({ heartbeat: true })
      heartbeat.add('读小说', () => selfReading.tick())
      logger?.info?.(
        `[dsh-little-whale] 读小说已启动（间隔 ${Math.round(autonomy.readingGapMs / 60000)}min；${
          String(env.DSH_POETRY_READING ?? '').toLowerCase() === 'off' ? '已禁用' : '公版现代文学作品，只读'
        }）`,
      )
      serviceRuntime.register('读小说', {
        dispose: () => {
          try {
            selfReading.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 读小说清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
      })

      // v1.68：看看互联网上的大家怎么表达——每 8h 读一次公开热搜词（微博/B站），
      // 只留意用词和句子节奏，不参与、不评论、不保存别人的原话。
      const selfNetlang = createSelfNetlang({
        state: selfState,
        getLlm,
        policy: modelPolicy,
        modelErrorsPath,
        logger,
        learningLogPath: path.join(memoryDir, 'learning-log.md'),
        statePath: path.join(settingsPath.dir, 'netlang-state.json'),
        gapMs: autonomy.netlangGapMs,
        firstMinMs: autonomy.netlangFirstMinMs,
        firstMaxMs: autonomy.netlangFirstMaxMs,
        env,
      })
      selfNetlang.start({ heartbeat: true })
      heartbeat.add('看大家说话', () => selfNetlang.tick())
      logger?.info?.(
        `[dsh-little-whale] 看大家说话已启动（间隔 ${Math.round(autonomy.netlangGapMs / 60000)}min；${
          String(env.DSH_POETRY_NETLANG ?? '').toLowerCase() === 'off' ? '已禁用' : '只读公开热搜'
        }）`,
      )
      serviceRuntime.register('看大家说话', {
        dispose: () => {
          try {
            selfNetlang.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-little-whale] 看大家说话清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
      })

      // v1.82：心跳最后启动（等所有活动注册完）。
      serviceRuntime.register('心跳', {
        start: () => heartbeat.start(),
        stop: () => heartbeat.stop(),
        dispose: () => heartbeat.dispose(),
      })

      const routes = createRouteTable({
        dataStore,
        settingsStore,
        fence,
        version: VERSION,
        settingsFile: settingsPath.file,
        weatherService,
        selfTalkService,
        moodAiService: {
          ...moodAiService,
          async generate(context, options) {
            const result = await moodAiService.generate(context, options)
            if (result && result.ok === true && result.mood) {
              try {
                emotional.record({ topic: String(result.mood.reason || result.mood.label || ''), emotion: String(result.mood.label || ''), note: '', intensity: 0.5 })
              } catch {
                /* ignore */
              }
            }
            if (
              result &&
              result.ok === true &&
              result.mood &&
              typeof result.mood.reason === 'string' &&
              (localVoiceMode === 'on' || localVoiceMode === 'mood')
            ) {
              try {
                const polished = await localVoice.polish(result.mood.reason, { maxChars: 40 })
                if (polished !== null) result.mood.reason = polished
              } catch {
                /* 保留原句 */
              }
            }
            return result
          },
        },
        journal,
        feihuaFullService,
        getSelfState: () => selfState.snapshot(),
        getReadings: readingHint,
        memoryHub,
        // v1.73：health.json 暴露后台服务快照，方便看 8 个定时器是不是还活着。
        getRuntime: () =>
          buildRuntimeSnapshot({
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
            twinEnabled,
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
          }),
        env,
        home,
      })

      // v2.79：镜像停用——她不再需要另一个自己，直接去接触真实世界；DSH_POETRY_TWIN=on 可恢复。
      const twinEnabled = String(env.DSH_POETRY_TWIN ?? '').toLowerCase() === 'on'
      let twinSystem = null
      if (twinEnabled) {
        twinSystem = createTwinSystem({
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
        })
        disposers.push(() => twinSystem.stop())
        twinSystem.start()
      }
      // W1：只读/静态路由统一注册（assets/pet-media/memory/model-errors/presence/works/self/graph）。
      registerReadonlyRoutes({
        webServer,
        disposers,
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
        graph: {
          getSnapshot: () => knowledgeGraph.snapshot(),
          readGraph,
          stateDir: settingsPath.dir,
        },
      })
      // W1：聊天服务与交互/写操作路由。
      const chatService = createChatHttpService({
        chatBridge,
        knowledgeGraph,
        relationship,
        emotional,
        dailyLife,
        commitments,
        memoryDir,
        localVoice,
        getLocalVoiceMode: () => localVoiceMode,
      })
      disposers.push(webServer.register({ kind: 'exact', path: CHAT_ROUTE, handler: createChatHandler({ service: chatService, tokenFile: chatTokenFile }) }))
      registerTwinRoutes({ webServer, disposers, twinEnabled, twinSystem, logger })
      registerManualReadRoute({ webServer, disposers, manualReading, worldFeedback, tokenFile: manualTokenFile })
      registerAttentionRoutes({ webServer, disposers, attention, outbox, selfProjects })
      registerProjectRoutes({ webServer, disposers, selfProjects })
      for (const route of routes) disposers.push(webServer.register(route))

      serviceRuntime.register('HTTP 路由', {
        dispose: () => {
          disposeAll(disposers, logger)
        },
      })
      // 所有服务/路由都已挂载：统一标记启动，并挂一个清理入口（v1.73）。
      host.effect(hostCtx, 
        () => {
          serviceRuntime.startAll()
          return () => {
            serviceRuntime.disposeAll()
          }
        },
        'dsh-little-whale: 后台服务',
      )
      logger?.info?.(
        `[dsh-little-whale] 已挂载 ${routes.length + 5} 条路由（assets + pet-media + self + memory + model-errors + ${routes.length} 条 JSON，version ${VERSION}，` +
          `dataVersion ${dataStore.getDataVersion() ?? '(数据未就绪)'}）`,
      )
      logger?.info?.(`[dsh-little-whale] 自主记忆日志目录：${memoryDir}`)
    } catch (error) {
      // 路由注册失败只影响本插件，不能让宿主 apply 抛未捕获异常。
      logger?.error?.(
        `[dsh-little-whale] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      )
    }
  })
}
