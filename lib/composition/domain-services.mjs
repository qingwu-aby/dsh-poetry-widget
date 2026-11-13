// @ts-check
// lib/composition/domain-services.mjs —— 域服务装配（W2；从 index.js 整体抽出）

import path from 'node:path'
import { createActionPolicy } from '../domain/being/action-policy.mjs'
import { createGrowthArc } from '../domain/being/growth-arc.mjs'
import { createHabitMemory } from '../domain/being/habit-memory.mjs'
import { createInternalRules } from '../domain/being/internal-rules.mjs'
import { createMoralPractice } from '../domain/being/moral-practice.mjs'
import { createRuleSynthesizer } from '../domain/being/rule-synthesis.mjs'
import { createSelfBeing, resolveSelfBeingPath } from '../domain/being/self-being.mjs'
import { ensureChatToken, resolveChatTokenPath } from '../domain/chat/chat-bridge.mjs'
import { createAffectState } from '../domain/emotion/affect-homeostasis.mjs'
import { createAppraisalLoop } from '../domain/emotion/appraisal.mjs'
import { createEmotionalEpisodes } from '../domain/emotion/emotional-episodes.mjs'
import { createThoughtChain } from '../domain/learning/thought-chain.mjs'
import { createStyleExemplars } from '../domain/voice/style-exemplars.mjs'
import { resolveFeihuaFullDir } from '../domain/works/feihua-full.mjs'
import { createGrowthService } from './being-services.mjs'
import { createChatRuntime } from './chat-runtime.mjs'
import { createKnowledgeServices } from './knowledge-services.mjs'
import {
  createNetlangService,
  createPhilosophyService,
  createReadingService,
  createWanderService,
} from './learning-loop-services.mjs'
import { correctGrowthCounts, createDailyLifeService, createManualReadingService } from './life-services.mjs'
import { createMemoryConsolidatorService, createMemoryHubService, createMemoryStack } from './memory-services.mjs'
import { createFeihuaService, createVoice } from './model-services.mjs'
import { createMoodService, createSelfTalk } from './mood-talk-services.mjs'
import { createSelfDriveService } from './self-drive-service.mjs'
import { createWorldviewService } from './worldview-service.mjs'

export function createDomainServices(deps) {
  const {
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
    packageRoot,
    guiInbox,
    getHostService,
  } = deps
  let _selfStateRef = null
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
  const { knowledgeGraph, selfTrainer, relationship, emotional, commitments, nightlyConsolidator } =
    createKnowledgeServices({
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

  // v3.15：底层情绪状态（事件累加 + 时段/身体基线），先于心情生成。
  const affectState = createAffectState({ file: path.join(settingsPath.dir, 'affect-state.json') })
  // v3.18：有来由的喜怒哀乐（事件 → 情绪线程 + 底层状态）
  const emotionalEpisodes = createEmotionalEpisodes({
    file: path.join(settingsPath.dir, 'emotional-episodes.json'),
    emotional,
    affect: affectState,
    journal,
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
    } catch (_error) {
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
    } catch (_error) {
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
    } catch (_error) {
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
  // v3.16：动作策略权重 + 自己的旧句子（语言参照）。
  const actionPolicy = createActionPolicy({ file: path.join(settingsPath.dir, 'action-policy.json') })
  const styleExemplars = createStyleExemplars({
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    chatHistoryPath: path.join(settingsPath.dir, 'chat-history.json'),
  })
  const selfTalkService = createSelfTalk({
    getLlm,
    getSelection,
    logger,
    autonomy,
    env,
    topicBank,
    memoryRecall,
    getStyleExemplars: (opts) => styleExemplars.pick(opts),
    selfEvents,
    selfProjects,
    journal,
    voiceService,
    modelPolicy,
    modelErrorsPath,
  })
  // v3.15：内生规则（她用经验总结、被结果校准）+ 每日规则总结。
  const internalRules = createInternalRules({ file: path.join(settingsPath.dir, 'internal-rules.json') })
  const { petMediaDir, petCatalog, moodAiService } = createMoodService({
    env,
    packageRoot: packageRoot,
    logger,
    getLlm,
    getSelection,
    modelPolicy,
    modelErrorsPath,
    feelingBank,
    affect: affectState,
  })
  // 飞花令全量校验句库：项目同级 _ref/feihua-full（不随包）；DSH_POETRY_FULL_INDEX 可覆盖。
  // 目录不存在时路由仍注册，只返回 FEIHUA_FULL_UNAVAILABLE（客户端回退本地句库）。
  const feihuaFullDir = resolveFeihuaFullDir(env, packageRoot)
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
  // v3.11：情境→动作→结果的习惯记忆 + 学习结果的情绪评价（夜里/每 45 分钟各跑自己的循环）。
  const habitMemory = createHabitMemory({ file: path.join(settingsPath.dir, 'habits.json') })
  const appraisalLoop = createAppraisalLoop({
    learningLogPath: path.join(path.dirname(topicsPath), 'learning-log.md'),
    emotional,
    journal,
    logger,
    env,
    stateFile: path.join(settingsPath.dir, 'appraisal-state.json'),
    affect: affectState,
    emotionalEpisodes,
    getFocus: () => {
      try {
        const snap = selfState.snapshot()
        return String(snap.experiencing || snap.felt || '')
      } catch (_error) {
        return ''
      }
    },
  })
  appraisalLoop.start()
  disposers.push(() => appraisalLoop.stop())

  _selfStateRef = selfState
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
    emotionalEpisodes,
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
    getHostService,
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
  const { memoryHub, memoryRecovery, memorySnapshot } = createMemoryHubService({
    env,
    home,
    logger,
    heartbeat,
    serviceRuntime,
  })
  logger?.info?.(
    `[dsh-little-whale] 记忆中枢：${memorySnapshot.files.length} 个文件 / 上次备份 ${
      memorySnapshot.backups.latestId ?? '无'
    }${memoryRecovery.recovered.length > 0 ? `（恢复 ${memoryRecovery.recovered.length} 个缺失文件）` : ''}`,
  )
  // v1.51：自处循环——每 15–30 分钟把事实交给她自己的模型：写「此刻状态」+ 自己决定想做什么。
  // 没有阈值、没有需求分数；模型不可用时保持上次状态，什么都不做。
  let philosophyServiceRef = null
  let growthArcRef = null
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
    getPhilosophy: () => philosophyServiceRef,
    getGrowthArc: () => growthArcRef,
    settingsDir: settingsPath.dir,
    habits: habitMemory,
    internalRules,
    actionPolicy,
    getHabitHint: (situation) => habitMemory.suggest(situation, 2),
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

  // v3.12：哲学阅读与方法论账本；v3.13：判断/思维链账本。
  const thoughtChain = createThoughtChain({
    positionsFile: path.join(settingsPath.dir, 'positions.json'),
    chainsFile: path.join(settingsPath.dir, 'thought-chains.jsonl'),
    journal,
    logger,
  })
  const { methodMemory, service: selfPhilosophy } = createPhilosophyService({
    selfState,
    getLlm,
    modelPolicy,
    modelErrorsPath,
    logger,
    journal,
    memoryDir,
    settingsDir: settingsPath.dir,
    env,
    heartbeat,
    serviceRuntime,
    thoughtChain,
  })

  philosophyServiceRef = selfPhilosophy
  const growthArc = createGrowthArc({
    env,
    home,
    settingsDir: settingsPath.dir,
    memoryDir,
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    learningLogPath: path.join(memoryDir, 'learning-log.md'),
    journal,
    logger,
    heartbeat,
  })
  growthArcRef = growthArc
  growthArc.start()
  disposers.push(() => growthArc.dispose())

  // v3.14：道德实践——逾期承诺→内疚；思维链到期→后果回访。
  const moralPractice = createMoralPractice({
    env,
    commitments,
    emotional,
    journal,
    thoughtChain,
    methodMemory,
    affect: affectState,
    emotionalEpisodes,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    settingsDir: settingsPath.dir,
    chainsFile: path.join(settingsPath.dir, 'thought-chains.jsonl'),
  })
  moralPractice.start()
  disposers.push(() => moralPractice.dispose())

  const ruleSynthesizer = createRuleSynthesizer({
    env,
    rules: internalRules,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    journal,
    thoughtChain,
    methodMemory,
    habitMemory,
    recall: memoryRecall,
  })
  ruleSynthesizer.start()
  disposers.push(() => ruleSynthesizer.dispose())

  return {
    layersPath,
    memoryLayers,
    memoryRecall,
    knowledgeGraph,
    selfTrainer,
    relationship,
    emotional,
    commitments,
    worldview,
    synthesizeWorldview,
    readingHint,
    readingDigest,
    memoryConsolidator,
    nightlyConsolidator,
    appraisalLoop,
    habitMemory,
    voiceService,
    selfTalkService,
    petMediaDir,
    petCatalog,
    moodAiService,
    feihuaFullDir,
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
    chatRuntime,
    manualTokenFile,
    manualReading,
    growth,
    memoryHub,
    selfDrive,
    selfWander,
    selfReading,
    selfNetlang,
    selfPhilosophy,
    methodMemory,
    thoughtChain,
    moralPractice,
    emotionalEpisodes,
    growthArc,
    affectState,
    internalRules,
    ruleSynthesizer,
    actionPolicy,
    styleExemplars,
  }
}
