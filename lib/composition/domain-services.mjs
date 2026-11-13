// @ts-check
// lib/composition/domain-services.mjs —— 域服务装配（W2；从 index.js 整体抽出）

import path from 'node:path'
import { createHabitMemory } from '../domain/being/habit-memory.mjs'
import { createSelfBeing, resolveSelfBeingPath } from '../domain/being/self-being.mjs'
import { createAppraisalLoop } from '../domain/emotion/appraisal.mjs'
import { createGrowthService } from './being-services.mjs'
import { createChatEntryServices } from './chat-entry-services.mjs'
import { createLanguageMoodServices } from './language-mood-services.mjs'
import { createLearningBeingServices } from './learning-being-services.mjs'
import { createNetlangService, createReadingService, createWanderService } from './learning-loop-services.mjs'
import { correctGrowthCounts, createDailyLifeService } from './life-services.mjs'
import { createMemoryKnowledgeServices } from './memory-knowledge-services.mjs'
import { createMemoryHubService } from './memory-services.mjs'
import { createSelfDriveService } from './self-drive-service.mjs'

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
  // v0.2.3：记忆/知识/情绪底座装配拆到 memory-knowledge-services.mjs。
  const {
    layersPath,
    memoryLayers,
    memoryRecall,
    knowledgeGraph,
    selfTrainer,
    relationship,
    emotional,
    commitments,
    nightlyConsolidator,
    affectState,
    emotionalEpisodes,
    worldview,
    synthesizeWorldview,
    readingHint,
    readingDigest,
    memoryConsolidator,
  } = createMemoryKnowledgeServices({
    env,
    home,
    settingsDir: settingsPath.dir,
    memoryDir,
    topicsPath,
    topicsArchivePath,
    topicBank,
    feelingsPath,
    modelPolicy,
    getLlm,
    modelErrorsPath,
    journal,
    logger,
    disposers,
    heartbeat,
    serviceRuntime,
  })

  // v0.2.3：语言/心情/动作策略装配拆到 language-mood-services.mjs。
  const {
    voiceService,
    actionPolicy,
    styleExemplars,
    selfTalkService,
    internalRules,
    petMediaDir,
    petCatalog,
    moodAiService,
    feihuaFullDir,
    feihuaFullService,
  } = createLanguageMoodServices({
    env,
    home,
    settingsDir: settingsPath.dir,
    memoryDir,
    packageRoot,
    getLlm,
    getSelection,
    modelPolicy,
    modelErrorsPath,
    logger,
    serviceRuntime,
    autonomy,
    topicBank,
    memoryRecall,
    selfEvents,
    selfProjects,
    journal,
    affect: affectState,
    feelingBank,
  })

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
  // v0.2.3：聊天入口/推送/手动阅读装配拆到 chat-entry-services.mjs。
  const {
    chatTokenFile,
    chatRuntime,
    chatBridge,
    attention,
    guiPush,
    outbox,
    proactiveChat,
    workLoop,
    queueGuiMessage,
    manualTokenFile,
    manualReading,
  } = createChatEntryServices({
    env,
    home,
    settingsDir: settingsPath.dir,
    memoryDir,
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
    guiInbox,
    selfProjects,
    moodAiService,
    readingHint,
    getHostService,
    selfWorks,
    selfMetabolism,
    disposers,
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

  // v0.2.3：学习/判断/成长/道德装配拆到 learning-being-services.mjs。
  const { thoughtChain, methodMemory, selfPhilosophy, growthArc, moralPractice, ruleSynthesizer } =
    createLearningBeingServices({
      env,
      home,
      settingsDir: settingsPath.dir,
      memoryDir,
      journal,
      logger,
      heartbeat,
      serviceRuntime,
      selfState,
      getLlm,
      modelPolicy,
      modelErrorsPath,
      commitments,
      emotional,
      emotionalEpisodes,
      affect: affectState,
      internalRules,
      habitMemory,
      memoryRecall,
      disposers,
    })
  philosophyServiceRef = selfPhilosophy
  growthArcRef = growthArc

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
