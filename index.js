// dsh-poetry-widget —— 宿主半区（M2）。
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
import { createAssetHandler } from './lib/assets.mjs'
import { createDataStore } from './lib/data-store.mjs'
import { createFeihuaFullService, resolveFeihuaFullDir } from './lib/feihua-full.mjs'
import { readPackageMeta } from './lib/paths.mjs'
import { createMemoryJournal, resolveMemoryDir } from './lib/memory-journal.mjs'
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
import { SELF_STATE_ROUTE } from './lib/self-state.mjs'
import { createSelfBeing, createSelfBeingHandler, resolveSelfBeingPath } from './lib/self-being.mjs'
import { loadFeelingBank, resolveFeelingsPath } from './lib/feelings.mjs'
import { createMemoryRecall } from './lib/memory-recall.mjs'
import {
  MODEL_ERRORS_ROUTE,
  createModelErrorsHandler,
  resolveModelErrorsPath,
} from './lib/model-errors.mjs'
import { MODEL_POLICY_ROLE_LABELS, createModelPolicy } from './lib/model-policy.mjs'
import { createSelfDrive } from './lib/self-drive.mjs'
import { createVoiceService, resolveVoicePath } from './lib/voice-memory.mjs'
import { createSelfGrowth } from './lib/self-growth.mjs'
import {
  MEMORY_ROUTE,
  createMemoryHub,
  createMemorySnapshotHandler,
} from './lib/memory-hub.mjs'
import { createSelfTalkService } from './lib/self-talk.mjs'
import { loadTopicBank, resolveTopicsArchivePath, resolveTopicsPath } from './lib/self-talk-topics.mjs'
import { createSettingsStore, resolveSettingsPath } from './lib/settings-store.mjs'
import { createTrustFence } from './lib/trust.mjs'
import { createWeatherService } from './lib/weather.mjs'

/** Cordis 插件名（loader 诊断用；与 package.json 的 dsh.bundle 行 id 一致）。 */
export const name = 'dsh-poetry-widget'

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
  const logger = ctx?.logger ?? null
  const env = process.env
  const home = env.HOME || os.homedir()
  const settingsPath = resolveSettingsPath(env, home)
  // 自主记忆日志（契约 §2.13）：只追加写模型自己生成的内容；与 llm 是否可用无关，先建好等待写入。
  const memoryDir = resolveMemoryDir(env, home)
  const journal = createMemoryJournal({ dir: memoryDir, logger })

  // v1.58：插件不再监听任何会话事件、也不统计对话活跃度——她的上下文/记忆与对话完全独立。
  // 旧 mood.json（会话活跃统计）不再写入；启动时如存在则改名为 .retired 保留，不参与记忆中枢。
  try {
    const legacyMoodFile = path.join(settingsPath.dir, 'mood.json')
    if (existsSync(legacyMoodFile)) {
      renameSync(legacyMoodFile, `${legacyMoodFile}.retired-${Date.now()}`)
      logger?.info?.('[dsh-poetry-widget] 已停用会话统计 mood.json（改名为 .retired）')
    }
  } catch (error) {
    logger?.warn?.(`[dsh-poetry-widget] 旧 mood.json 处理失败：${error instanceof Error ? error.message : String(error)}`)
  }
  // v1.59：不再读取外部 experience.json——她的“正在体会”由她自己写进 self-state。
  // 旧文件改名 .retired 保留，不参与记忆中枢。
  try {
    const legacyExperienceFile = path.join(settingsPath.dir, 'experience.json')
    if (existsSync(legacyExperienceFile)) {
      renameSync(legacyExperienceFile, `${legacyExperienceFile}.retired-${Date.now()}`)
      logger?.info?.('[dsh-poetry-widget] 已停用外部 experience.json（改名为 .retired）')
    }
  } catch (error) {
    logger?.warn?.(`[dsh-poetry-widget] 旧 experience.json 处理失败：${error instanceof Error ? error.message : String(error)}`)
  }

  ctx.inject(['webServer', 'connection'], (hostCtx) => {
    try {
      const webServer = hostCtx.get('webServer')
      const connection = hostCtx.get('connection')

      const dataStore = createDataStore({ dataDir: DATA_DIR })
      const settingsStore = createSettingsStore({
        file: settingsPath.file,
        knownPoemIds: () => dataStore.knownPoemIds(),
        onWarn: (message) => logger?.warn?.(`[dsh-poetry-widget] ${message}`),
      })
      const fence = createTrustFence({ getConnection: () => connection, logger })
      // 天气服务：Open-Meteo 免密钥；fetch 用宿主 Node 的全局 fetch，请求 6s 超时、进程内缓存。
      const weatherService = createWeatherService({
        fetchImpl: typeof globalThis.fetch === 'function' ? (url, init) => globalThis.fetch(url, init) : null,
      })
      // 模型调用：llm / agentDefaultModel 是 optional 服务（用 get 取，不放进 inject 硬依赖）。
      // 用 getter 延迟解析：宿主模型服务晚于本插件就绪、或 HMR 后换实例时仍能拿到最新引用。
      const getLlm = () => {
        try {
          return hostCtx.get('llm')
        } catch {
          return undefined
        }
      }
      const getSelection = () => {
        try {
          const agentDefaultModel = hostCtx.get('agentDefaultModel')
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
      // v1.41：模型失败诊断文件（JSONL，只含错误元数据，不含提示词/正文）。
      const modelErrorsPath = resolveModelErrorsPath(env, home)
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
        logger?.info?.(`[dsh-poetry-widget] 碎碎念话题库：${topicsPath}（${topicSnapshot.entries.length} 个话题）`)
      } else {
        logger?.warn?.(`[dsh-poetry-widget] 碎碎念话题库不可用（自言自语将不使用话题）：${topicsPath}`)
      }
      // v1.33：记忆检索（只读 journal/learning-log/topics，供碎碎念与自驱成长使用）。
      const memoryRecall = createMemoryRecall({
        journalPath: path.join(memoryDir, 'journal.jsonl'),
        learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
        topics: topicBank,
        topicsArchivePath,
        feelingsPath,
      })
      // v1.34：声音档案（从自己的 journal 旧输出提炼语言风格，24h 刷新；失败静默）。
      const voiceService = createVoiceService({
        getLlm,
        getSelection,
        policy: modelPolicy,
        modelErrorsPath,
        journalPath: path.join(memoryDir, 'journal.jsonl'),
        voicePath: resolveVoicePath(env, home),
        logger,
      })
      voiceService.start()
      logger?.info?.(`[dsh-poetry-widget] 声音档案：${voiceService.voicePath}`)
      hostCtx.effect(
        () => () => {
          try {
            voiceService.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-poetry-widget] 声音档案清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
        'dsh-poetry-widget: 声音档案',
      )
      const selfTalkService = createSelfTalkService({
        getLlm,
        getSelection,
        logger,
        topics: topicBank,
        recall: memoryRecall,
        voice: () => voiceService.get(),
        refreshVoice: () => voiceService.refreshNow(),
        policy: modelPolicy,
        modelErrorsPath,
      })
      // 心情动画素材（dsh-pet MIT webm，不随包）：读图鉴并并入 mood-ai 图鉴（106 个动画也可被模型选中）。
      const petMediaDir = resolvePetMediaDir(env, PACKAGE_ROOT)
      const petCatalog = loadPetMediaCatalog({ dir: petMediaDir, logger })
      if (petCatalog.ok === true) {
        logger?.info?.(`[dsh-poetry-widget] 心情动画素材：${petMediaDir}（${petCatalog.entries.length} 个视频）`)
      } else if (petMediaDirExists(petMediaDir)) {
        logger?.warn?.(`[dsh-poetry-widget] 心情动画素材不可用：${petCatalog.message}（mood-ai 仅用静态图）`)
      } else {
        logger?.warn?.(`[dsh-poetry-widget] 心情动画素材目录不存在（mood-ai 仅用静态图）：${petMediaDir}`)
      }
      // 模型心情：启动时读包内 92 张心情图鉴（缺失 → 服务降级为 MOOD_AI_UNAVAILABLE，不抛）。
      const moodCatalog = loadMoodCatalog()
      if (moodCatalog.ok !== true) {
        logger?.warn?.(`[dsh-poetry-widget] 心情图鉴不可用：${moodCatalog.message}`)
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
      const feihuaFullService = createFeihuaFullService({ dir: feihuaFullDir, logger })
      if (existsSync(feihuaFullDir)) {
        logger?.info?.(`[dsh-poetry-widget] 飞花令全量校验目录：${feihuaFullDir}`)
      } else {
        logger?.warn?.(
          `[dsh-poetry-widget] 飞花令全量校验目录不存在（feihua-full 将返回 FEIHUA_FULL_UNAVAILABLE）：${feihuaFullDir}`,
        )
      }
      // v1.51：状态不再量化——只存事实时间线 + 她自己写下的一句「此刻状态」（v2）。
      const selfState = createSelfBeing({ file: resolveSelfBeingPath(env, home), logger })
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
        logger?.warn?.(`[dsh-poetry-widget] 成长计数校正失败：${error instanceof Error ? error.message : String(error)}`)
      }
      const growth = createSelfGrowth({
        state: selfState,
        getLlm,
        getSelection,
        journal,
        learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
        candidatesPath: path.join(path.dirname(topicsPath), 'topics-candidates.json'),
        topicsBankPath: topicsPath,
        topicsArchivePath,
        topics: topicBank,
        recall: memoryRecall,
        feelingsPath,
        feelings: feelingBank,
        logger,
        policy: modelPolicy,
        modelErrorsPath,
      })
      growth.start()
      logger?.info?.(
        `[dsh-poetry-widget] 自驱成长已启动（状态：${selfState.file}；自省 60min / 自学 90min）`,
      )
      const candidateText = ['mood', 'selfTalk', 'growth', 'voice', 'drive', 'probe']
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
      logger?.info?.(`[dsh-poetry-widget] 模型候选：${candidateText}`)
      hostCtx.effect(
        () => () => {
          try {
            growth.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-poetry-widget] 自驱成长清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
          try {
            selfState.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-poetry-widget] 状态清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
        'dsh-poetry-widget: 自驱成长',
      )

      // M41：记忆中枢（create → recover → start；所有写入路径不变，中枢只管理/备份/恢复）。
      const memoryHub = createMemoryHub({ env, home, logger })
      const memoryRecovery = memoryHub.recover()
      memoryHub.start()
      const memorySnapshot = memoryHub.snapshot()
      logger?.info?.(
        `[dsh-poetry-widget] 记忆中枢：${memorySnapshot.files.length} 个文件 / 上次备份 ${
          memorySnapshot.backups.latestId ?? '无'
        }${memoryRecovery.recovered.length > 0 ? `（恢复 ${memoryRecovery.recovered.length} 个缺失文件）` : ''}`,
      )
      hostCtx.effect(
        () => () => {
          try {
            memoryHub.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-poetry-widget] 记忆中枢清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
        'dsh-poetry-widget: 记忆中枢',
      )

      // v1.51：自处循环——每 15–30 分钟把事实交给她自己的模型：写「此刻状态」+ 自己决定想做什么。
      // 没有阈值、没有需求分数；模型不可用时保持上次状态，什么都不做。
      const selfDrive = createSelfDrive({
        state: selfState,
        getLlm,
        policy: modelPolicy,
        modelErrorsPath,
        logger,
        onLearn: () => growth.learnNow(),
        // v1.62：注意力集中时，她自己会提出一个“可以去看看”的介入；喜不喜欢由她判断。
        onProbe: (focus) => growth.probeNow({ focus }),
        getRecentMoodLabels: () => {
          try {
            return typeof moodAiService.peekRecentLabels === 'function' ? moodAiService.peekRecentLabels() : []
          } catch {
            return []
          }
        },
      })
      selfDrive.start()
      const actionSnapshot = selfDrive.snapshot()
      logger?.info?.(
        `[dsh-poetry-widget] 自处循环已启动（${selfDrive.actionsPath}${
          actionSnapshot.latest !== null ? `；上次：${actionSnapshot.latest.text}` : ''
        }）`,
      )
      hostCtx.effect(
        () => () => {
          try {
            selfDrive.dispose()
          } catch (error) {
            logger?.warn?.(`[dsh-poetry-widget] 自处循环清理失败：${error instanceof Error ? error.message : String(error)}`)
          }
        },
        'dsh-poetry-widget: 自处',
      )

      const routes = createRouteTable({
        dataStore,
        settingsStore,
        fence,
        version: VERSION,
        settingsFile: settingsPath.file,
        weatherService,
        selfTalkService,
        moodAiService,
        journal,
        feihuaFullService,
        getSelfState: () => selfState.snapshot(),
        memoryHub,
        env,
        home,
      })

      /** @type {Array<() => void>} */
      const disposers = []
      // M0 静态资源路由：行为原样保留（不套信任栅栏；只读、无敏感信息）。
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: ASSETS_ROUTE,
          handler: createAssetHandler({ assetsDir: ASSETS_DIR }),
        }),
      )
      // dsh-pet 动画素材静态路由（只读、无用户数据；供 <video> 直接加载，与 assets 同类不套栅栏）。
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: PET_MEDIA_ROUTE,
          handler: createPetMediaHandler({ dir: petMediaDir, logger }),
        }),
      )
      // 记忆中枢只读快照（unfenced、no-store；路径脱敏、无用户内容）。
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: MEMORY_ROUTE,
          handler: createMemorySnapshotHandler({ hub: memoryHub }),
        }),
      )
      // 模型错误诊断只读路由（unfenced、no-store；只含元数据，无提示词/正文/用户内容）。
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: MODEL_ERRORS_ROUTE,
          handler: createModelErrorsHandler({ file: modelErrorsPath }),
        }),
      )
      // 内在状态只读路由（unfenced、no-store；只读内部指标，不含用户数据）。
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: SELF_STATE_ROUTE,
          handler: createSelfBeingHandler({
            getSnapshot: () => selfState.snapshot(),
            getGrowth: () => growth.snapshot(),
            getActions: () => selfDrive.snapshot(),
          }),
        }),
      )
      for (const route of routes) disposers.push(webServer.register(route))

      hostCtx.effect(
        () => () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch (error) {
              logger?.warn?.(`[dsh-poetry-widget] 路由注销失败：${error instanceof Error ? error.message : String(error)}`)
            }
          }
        },
        'dsh-poetry-widget: HTTP 路由',
      )
      logger?.info?.(
        `[dsh-poetry-widget] 已挂载 ${routes.length + 5} 条路由（assets + pet-media + self + memory + model-errors + ${routes.length} 条 JSON，version ${VERSION}，` +
          `dataVersion ${dataStore.getDataVersion() ?? '(数据未就绪)'}）`,
      )
      logger?.info?.(`[dsh-poetry-widget] 自主记忆日志目录：${memoryDir}`)
    } catch (error) {
      // 路由注册失败只影响本插件，不能让宿主 apply 抛未捕获异常。
      logger?.error?.(
        `[dsh-poetry-widget] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      )
    }
  })
}
