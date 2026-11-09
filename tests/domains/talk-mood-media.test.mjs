// tests/domains/talk-mood-media.test.mjs —— 自言自语/心情/记忆日志/飞花/媒体（W3 拆分）
// tests/host.test.mjs —— 宿主半区单测（其余部分；共享脚手架在 tests/helpers/harness.mjs）
import * as harness from '../helpers/harness.mjs'
// tests/host.test.mjs —— 宿主半区单测（node:test，不依赖真实 DSH 宿主）。
//
// 覆盖：设置校验/clamp/损坏回退/原子写、bootstrap 形状与今日诗确定性、
//       data 缺失/损坏降级、about 脱敏、信任栅栏 403/401、路由 200/400/403/405、静态资源越界防护。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import test from 'node:test'

import { name as pluginName, apply as pluginApply } from '../../index.js'
import { createAssetHandler, resolveAssetPath } from '../../lib/legacy/assets.mjs'
import { createDataStore, pickPoemIndex } from '../../lib/legacy/data-store.mjs'
import { formatLocalDate, maskPath, readPackageMeta } from '../../lib/paths.mjs'
import { createRouteTable } from '../../lib/legacy/routes.mjs'
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  normalizeSettings,
  resolveSettingsPath,
  validateSettingsPatch,
} from '../../lib/settings-store.mjs'
import { createTrustFence, isLoopbackHostname } from '../../lib/legacy/trust.mjs'
import {
  DEFAULT_CITY as WEATHER_DEFAULT_CITY,
  createWeatherService,
  mapWeather,
  normalizeCity,
} from '../../lib/legacy/weather.mjs'
import {
  MAX_ACTIVE_GAP_MS,
  MOOD_ACTIVITY_IDLE_MS,
  MOOD_ACTIVITY_LABELS,
  MOOD_EVENT_TYPES,
  MOOD_RECENT_TOOL_LIMIT,
  MOOD_STAT_KEYS,
  applySessionEvent,
  classifyToolName,
  createEmptyMoodState,
  createMoodTracker,
  describeRecentActivity,
  localDateKey,
  toMoodResponse,
  zeroMoodResponse,
} from '../../lib/legacy/mood.mjs'
import {
  EXPERIENCE_EMOTION_LABELS,
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_MAX_AGE_MS,
  readExperience,
  resolveExperiencePath,
} from '../../lib/legacy/experience.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  isSafeWebmRelative,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  resolvePetMediaDir,
} from '../../lib/legacy/pet-media.mjs'
import {
  createFeihuaFullService,
  isValidFeihuaChar,
  resolveFeihuaFullDir,
} from '../../lib/feihua-full.mjs'
import {
  JOURNAL_MURMUR_MIN_INTERVAL_MS,
  MEMORY_JOURNAL_HEADER,
  createMemoryJournal,
  formatJournalTime,
  resolveMemoryDir,
} from '../../lib/legacy/memory-journal.mjs'
import {
  MOOD_AI_CACHE_TTL_MS,
  MOOD_AI_EMOTION_VOCAB,
  MOOD_AI_TIMEOUT_MS,
  MOOD_AI_SYSTEM_PROMPT,
  MOOD_AI_TEMPERATURE,
  MOOD_MIN_CANDIDATES,
  MOOD_RECENT_IMAGES_MAX,
  buildMoodPrompt,
  createMoodAiService,
  isWhenActive,
  loadMoodCatalog,
  normalizeMoodCatalog,
  normalizeRecentImageList,
  parseMoodResult,
  resolveFestivalAvailability,
  resolveMoodCandidates,
  shuffleCopy,
} from '../../lib/legacy/mood-ai.mjs'
import {
  MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_DSH_OPENCODE_PROVIDER,
} from '../../lib/legacy/model-policy.mjs'
import {
  MODEL_ERRORS_MAX_LINES,
  MODEL_ERRORS_MESSAGE_MAX,
  MODEL_ERRORS_ROUTE,
  appendModelError,
  buildModelErrorRecord,
  createModelErrorsHandler,
  readModelErrors,
  resolveModelErrorsPath,
} from '../../lib/legacy/model-errors.mjs'
import {
  MODEL_POLICY_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_OPENCODE_PROVIDER,
  MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS,
  MODEL_POLICY_SAFE_FALLBACK,
  MODEL_POLICY_DEFAULTS,
  MODEL_POLICY_DEFAULT_EFFORTS,
  MODEL_POLICY_EFFORTS,
  MODEL_POLICY_ROLES,
  createModelPolicy,
  describeModelPolicy,
  normalizeEffort,
  resolveCandidateMaxTokens,
} from '../../lib/legacy/model-policy.mjs'
import {
  VOICE_EXEMPLAR_MAX_CHARS,
  VOICE_REFRESH_INTERVAL_MS,
  VOICE_TIMEOUT_MS,
  buildVoiceRefreshPrompt,
  collectVoiceSamples,
  createVoiceService,
  normalizeVoiceFile,
  parseVoiceResult,
  resolveVoicePath,
} from '../../lib/legacy/voice-memory.mjs'
import {
  MEMORY_RECALL_JOURNAL_LINES,
  bigramJaccard,
  chineseBigrams,
  createMemoryRecall,
  extractRecallKeywords,
  formatMemoryDigest,
  pickRelevantLearning,
  readLearningSections,
  readRecentJournalEntries,
  resolveMemoryRecallPaths,
} from '../../lib/legacy/memory-recall.mjs'
import {
  MEMORY_BACKUP_INTERVAL_MS,
  MEMORY_BACKUP_MAX,
  MEMORY_BACKUP_ROUTE,
  MEMORY_ROUTE,
  createMemoryBackupHandler,
  createMemoryHub,
  createMemorySnapshotHandler,
  resolveMemoryHubPaths,
} from '../../lib/legacy/memory-hub.mjs'
import {
  SELF_DRIVE_ACTIONS,
  buildSelfDrivePrompt,
  createSelfDrive,
  parseSelfDriveResult,
} from '../../lib/legacy/self-drive.mjs'
import {
  SELF_BEING_VERSION,
  applyBeingEvent,
  composeElapsed,
  createSelfBeing,
  defaultSelfBeing,
  describeTimeline,
  formatBeingLine,
  normalizeSelfBeing,
  resolveSelfBeingPath,
} from '../../lib/legacy/self-being.mjs'
import {
  FEELING_DESC_MAX,
  FEELING_NAME_MAX,
  appendFeeling,
  loadFeelingBank,
  normalizeFeeling,
  parseNewFeeling,
  readFeelingFile,
  resolveFeelingsPath,
} from '../../lib/legacy/feelings.mjs'
import {
  SELF_GROWTH_REFLECT_INTERVAL_MS,
  SELF_GROWTH_TICK_MS,
  SELF_GROWTH_TIMEOUT_MS,
  SELF_PROBE_GAP_MS,
  buildLearnPrompt,
  buildProbeProposalPrompt,
  buildProbeVerdictPrompt,
  buildReflectPrompt,
  createSelfGrowth,
  normalizeTopicCandidate,
  parseLearnResult,
  parseProbeProposal,
  parseProbeVerdict,
  parseReflectResult,
} from '../../lib/legacy/self-growth.mjs'
import {
  SELF_WANDER_ALLOWED_HOSTS,
  SELF_WANDER_ALLOWED_SUFFIXES,
  SELF_WANDER_GAP_MS,
  buildWanderPrompt,
  createSelfWander,
  fetchRandomPage,
  isJunkWanderPage,
  parseWanderResult,
  wanderRandomUrl,
} from '../../lib/legacy/self-wander.mjs'
import {
  SELF_READING_GAP_MS,
  SELF_READING_RANDOM_API,
  SELF_READING_WORKS,
  buildReadingPrompt,
  cleanReadingHtml,
  createSelfReading,
  fetchRandomReadingExcerpt,
  fetchReadingText,
  isAllowedReadingHost,
  isJunkReadingPage,
  parseReadingResult,
  pickReadingExcerpt,
  readingApiUrl,
} from '../../lib/legacy/self-reading.mjs'
import { runMemoryMigrations } from '../../lib/legacy/memory-migrations.mjs'
import { createDshHost } from '../../lib/legacy/dsh-host.mjs'
import { createSelfProjects, projectCanRetry, projectProgressAt, projectStage } from '../../lib/legacy/self-projects.mjs'
import { createGuiInbox, pushGuiInbox, readGuiInbox, GUI_INBOX_MAX } from '../../lib/legacy/gui-inbox.mjs'
import { normalizeVideoCourse, readVideoCourses, readVideoCoursesShelf } from '../../lib/video-courses.mjs'
import { createSelfEvents } from '../../lib/legacy/self-events.mjs'
import { createMetabolism } from '../../lib/self-metabolism.mjs'
import { createWorldFeedback } from '../../lib/legacy/world-feedback.mjs'
import { PRESENCE_ROUTE, createPresenceHandler } from '../../lib/legacy/presence.mjs'
import { createChatBridge } from '../../lib/legacy/chat-bridge.mjs'
import { createCurriculum } from '../../lib/legacy/self-curriculum.mjs'
import { createMediaBudget } from '../../lib/legacy/media-budget.mjs'
import { createAttentionStore } from '../../lib/legacy/attention.mjs'
import { createOutbox } from '../../lib/legacy/outbox.mjs'
import { constitutionLines, PROMPT_LAYERS_VERSION } from '../../lib/legacy/prompt-layers.mjs'
import { fetchShugeEntry, searchShuge } from '../../lib/shuge.mjs'
import { createLifecycle } from '../../lib/legacy/self-lifecycle.mjs'
import { createTwinBridge } from '../../lib/legacy/twin-bridge.mjs'
import { createTwinResearch } from '../../lib/legacy/twin-research.mjs'
import { createGrowthMetrics } from '../../lib/growth-metrics.mjs'
import { createSelfWorks, createWorksHandler, sanitizeWorkSvg } from '../../lib/legacy/self-works.mjs'
import { createManualReadHandler, createManualReading, ensureManualToken } from '../../lib/manual-reading.mjs'
import { seedMemoryBaseline } from '../../lib/legacy/memory-baseline.mjs'
import { createHeartbeat } from '../../lib/legacy/heartbeat.mjs'
import { createModelBudget, createModelGate } from '../../lib/legacy/model-budget.mjs'
import { createDeepSeekWeb } from '../../lib/deepseek-web.mjs'
import {
  createWebAccess,
  extractHtmlTitle,
  extractPageLinks,
  extractReadableText,
  fetchPublicPage,
  isPrivateAddress,
  parseDuckDuckGoResults,
  parseRssFeed,
  parseSearxResults,
  parseWikipediaSearchPayload,
  resolvePublicAddress,
  validatePublicUrl,
} from '../../lib/legacy/safe-web.mjs'
import { callModelForRole, configureModelRuntime, resetModelRuntime } from '../../lib/legacy/llm-call.mjs'
import {
  buildConsolidationPrompt,
  countJournalEntries,
  createMemoryConsolidator,
  createMemoryLayers,
  parseConsolidationResult,
  readMemoryLayers,
  resolveMemoryLayersPath,
} from '../../lib/legacy/memory-layers.mjs'
import {
  SELF_NETLANG_GAP_MS,
  SELF_NETLANG_SOURCES,
  buildNetlangPrompt,
  createSelfNetlang,
  fetchNetlangTitles,
  parseGithubTrendingHtml,
  parseNetlangPayload,
  parseNetlangResult,
} from '../../lib/legacy/self-netlang.mjs'
import {
  SELF_ACTION_LABELS,
  SELF_ACTION_TEXTS,
  SELF_ACTIONS_MAX_ENTRIES,
  SELF_ACTIONS_MIN_GAP_MS,
  chooseSelfAction,
  createSelfActions,
  normalizeSelfAction,
  normalizeSelfActionsFile,
  resolveSelfActionsPath,
} from '../../lib/legacy/self-actions.mjs'
import {
  SELF_STATE_DEFAULTS,
  SELF_STATE_MAX_TICK_MINUTES,
  SELF_STATE_ROUTE,
  advanceSelfState,
  applySelfEvent,
  clampSelfValue,
  createSelfState,
  createSelfStateHandler,
  defaultSelfState,
  describeSelfState,
  formatSelfStateLine,
  normalizeSelfState,
  resolveSelfStatePath,
} from '../../lib/legacy/self-state.mjs'
import {
  LEARNED_TOPIC_RECENCY_BONUS,
  SELF_TALK_TOPIC_RECENT_MAX,
  SELF_TALK_TOPIC_TOP_N,
  buildTopicPromptLine,
  loadTopicBank,
  compactTopicBankForArchive,
  mergeLearnedTopicIntoBank,
  parseTopicBank,
  pickSelfTalkTopic,
  resolveTopicsArchivePath,
  resolveTopicsPath,
  scoreSelfTalkTopic,
  searchArchivedTopics,
  topicRecencyWeight,
} from '../../lib/legacy/self-talk-topics.mjs'
import {
  SELF_TALK_RECENT_MAX,
  SELF_TALK_TIMEOUT_MS,
  selectDiverseSelfTalkLines,
  selfTalkSimilarity,
  SELF_TALK_TEMPERATURE,
  SELF_TALK_THEMES,
  SELF_TALK_SYSTEM_PROMPT,
  buildSelfTalkPrompt,
  createSelfTalkService,
  parseRecentQuery,
  parseSelfTalkLines,
  pickSelfTalkTheme,
} from '../../lib/self-talk.mjs'

// ---------------------------------------------------------------------------
// 测试基础设施
// ---------------------------------------------------------------------------

const {
  POEM_IDS,
  DATA_VERSION,
  FIXED_NOW,
  makeTmpDir,
  writeJson,
  writeFixtureData,
  MockResponse,
  mockRequest,
  createHarness,
  makeWeatherFetch,
  makeMockLlm,
  SELF_TALK_SELECTION,
  SELF_TALK_LINES_A,
  SELF_TALK_LINES_B,
  makeSelfTalkHarness,
  cachedRealMoodCatalog,
  realMoodCatalog,
  makeMoodCatalogFixture,
  makeMoodAiHarness,
  expectedPoemId,
  MOOD_T0,
  moodEvent,
  emptyStatsForTest,
  readJournalJsonl,
  makeMoodCatalogWithVideos,
  writeExperienceFile,
  makeGrowthHarness,
  makeGrowthLlm,
  promptCatalogRowFiles,
  writeRecallJournal,
  makeLongVoiceProfile,
  VOICE_PROFILE_SAMPLE,
  writeVoiceFile,
} = harness


// ---------------------------------------------------------------------------
// 实时自言自语（契约 v1.8 §2.11）
// ---------------------------------------------------------------------------

const SELF_TALK_SEP = '\n'

test('self-talk：system prompt 含关键约束（人格/长度/禁引诗/不提 AI）', () => {
  for (const phrase of [
    '第一人称',
    '简体中文',
    '8–60',
    '不迎合',
    '不说教',
    'AI',
    '不编造',
    'emoji',
    '只输出一句话',
    // v1.8b 纯随想：禁止引诗/念诗/往诗词上引，必须用自己的话
    '不要引用',
    '背诵',
    '化用',
    '古诗文',
    '不要念诗',
    '不要报诗名',
    '用你自己的话',
    '此刻的感受',
  ]) {
    assert.equal(SELF_TALK_SYSTEM_PROMPT.includes(phrase), true, `system prompt 缺少约束：${phrase}`)
  }
  assert.equal(SELF_TALK_SYSTEM_PROMPT.includes('8–24'), false, 'intro 已废弃，不再有 8–24 字约束')
  assert.equal(SELF_TALK_SYSTEM_PROMPT.includes('诗句本身'), false, 'system prompt 不应再出现「诗句本身」类 intro 文案')
})

test('self-talk：buildSelfTalkPrompt 只有聚合上下文（无今日诗、无会话原文）', () => {
  const prompt = buildSelfTalkPrompt({
    kind: 'intro', // 已废弃：应被忽略
    now: Date.UTC(2026, 9, 21, 2, 0, 0), // 2026-10-21 10:00 Asia/Shanghai
    weather: 'rain',
    moodKey: 'busy',
    // v1.8b：今日诗元数据不再发送，即使调用方误传也必须丢弃
    poem: { title: '静夜思', author: '李白' },
    recent: ['最近说过的一句话'],
    // 下面这些是误传/恶意注入的会话内容，白名单必须丢弃：
    messages: [{ role: 'user', content: [{ type: 'text', text: '绝密原文' }] }],
    sessionMessages: ['绝密原文'],
    sessionText: '绝密原文',
  })
  assert.match(prompt, /2026-10-21/)
  assert.match(prompt, /10:00/)
  assert.match(prompt, /雨（rain）/)
  assert.match(prompt, /busy（忙碌）/)
  assert.equal(prompt.includes('用户消息'), false, 'v1.58：不注入会话统计')
  assert.equal(prompt.includes('工具调用'), false)
  assert.equal(prompt.includes('活跃约'), false)
  assert.match(prompt, /最近说过的一句话/)
  assert.match(prompt, /不要重复/)
  assert.match(prompt, /不要引用/, 'user prompt 也应重申禁止引诗')
  assert.match(prompt, /古诗文/)
  // 今日诗上下文必须完全消失
  assert.equal(prompt.includes('静夜思'), false, '不得发送今日诗标题')
  assert.equal(prompt.includes('李白'), false, '不得发送今日诗作者')
  assert.equal(prompt.includes('今天的诗'), false, '不得包含今日诗介绍语')
  assert.equal(prompt.includes('《'), false, 'prompt 不应出现书名号/诗名格式')
  assert.equal(prompt.includes('kind='), false, 'kind 固定 murmur，不再写进 prompt')
  assert.equal(prompt.includes('intro'), false, 'intro 已废弃，不进入 prompt')
  assert.equal(prompt.includes('绝密原文'), false, '会话原文绝不允许进入 prompt')
  assert.match(prompt, /对称骨架/, 'v1.61：带上去 AI 味的自然语言约束')
  assert.match(prompt, /碎碎念不是微散文/)
})

test('self-talk：parseSelfTalkLines 过滤长度/引号/编号/非中文/重复', () => {
  const text = [
    '1. 「今天小雨，我有点想窝在窗边看雨。」',
    '2. 太短',
    '3. 今天小雨，我有点想窝在窗边看雨',
    '4. This line is long enough but not Chinese at all',
    `5. ${'我'.repeat(61)}`,
    '6. 我数了数你敲键盘的声音，好像比昨天轻快一点。',
  ].join('\n')
  assert.deepEqual(parseSelfTalkLines(text, { kind: 'murmur' }), [
    '今天小雨，我有点想窝在窗边看雨',
    '我'.repeat(61),
  ])
  // 按句号拆分
  assert.deepEqual(parseSelfTalkLines('第一句话说得长一点吧。第二句话也说得长一点吧', { kind: 'murmur' }), [
    '第一句话说得长一点吧',
    '第二句话也说得长一点吧',
  ])
  // 长度边界（v2.0 放开）：murmur 4–120
  assert.deepEqual(parseSelfTalkLines(`${'好'.repeat(3)}\n${'好'.repeat(4)}`, { kind: 'murmur' }), ['好'.repeat(4)])
  assert.deepEqual(parseSelfTalkLines(`${'好'.repeat(120)}\n${'妙'.repeat(121)}`, { kind: 'murmur' }), ['好'.repeat(120)])
  // intro 已废弃（v1.8b）：也按 4–120 处理
  assert.deepEqual(parseSelfTalkLines('明月'.repeat(13), { kind: 'intro' }), ['明月'.repeat(13)])
  assert.deepEqual(parseSelfTalkLines('山的', { kind: 'intro' }), [], '过短仍然丢弃')
  // recent 去重（忽略标点/空白差异）
  assert.deepEqual(
    parseSelfTalkLines('窗外的雨声让我想起一句没读过的话\n今天的云很低，低到我想伸手碰一碰', {
      kind: 'murmur',
      recent: ['窗外的雨声，让我想起一句没读过的话。'],
    }),
    ['今天的云很低，低到我想伸手碰一碰'],
  )
  assert.deepEqual(parseSelfTalkLines(''), [])
  assert.deepEqual(parseSelfTalkLines(null), [])
})

test('self-talk：过滤疑似引诗/报诗名的句子（v1.8b 纯随想）', () => {
  assert.deepEqual(parseSelfTalkLines('我想起《静夜思》里的句子，月亮真好看啊', {}), [], '书名号=引诗')
  assert.deepEqual(parseSelfTalkLines('“明月几时有”这样的句子真应景', {}), [], '引号=引诗')
  assert.deepEqual(parseSelfTalkLines('这首诗的平仄我背不下来，还是说点别的吧', {}), [], '诗评术语=往诗词上引')
  assert.deepEqual(parseSelfTalkLines('今天有点想读点诗，不过还是算了吧', {}), [], '带「诗」字的句子丢弃')
  assert.deepEqual(parseSelfTalkLines('今天的风有点凉，我缩了缩尾巴', {}), ['今天的风有点凉，我缩了缩尾巴'])
})

test('self-talk：parseRecentQuery（| 分隔 / ≤12 条 / 1200 字符上限）', () => {
  assert.deepEqual(parseRecentQuery('a|b|c'), ['a', 'b', 'c'])
  // v1.22：5→12 条
  const thirteen = Array.from({ length: 13 }, (_, index) => `最近说过的话第${index}句`).join('|')
  const parsed = parseRecentQuery(thirteen)
  assert.equal(parsed.length, SELF_TALK_RECENT_MAX)
  assert.equal(parsed.length, 12)
  assert.equal(parsed[11], '最近说过的话第11句')
  // 去重/空值
  assert.deepEqual(parseRecentQuery('a|a|b'), ['a', 'b'])
  assert.deepEqual(parseRecentQuery(''), [])
  assert.deepEqual(parseRecentQuery(null), [])
  // 单条超长截断到 80 字符
  const long = parseRecentQuery('x'.repeat(1300))
  assert.equal(long.length, 1)
  assert.ok(Array.from(long[0]).length <= 80, '单条被截断到安全长度')
  // 总长 1200 字符上限：20 段各 100 字 → 只在 1200 字符内解析，最多 12 条
  const huge = Array.from({ length: 20 }, () => '甲'.repeat(100)).join('|')
  const hugeParsed = parseRecentQuery(huge)
  assert.ok(hugeParsed.length <= 12)
  assert.ok(hugeParsed.length >= 1)
  // 1200 字符足够容纳 12 条正常长度句子（不再像旧版 500 那样被过早截断）
  const twelveNormal = Array.from({ length: 12 }, (_, index) => `第${index}句稍微长一点的最近碎碎念内容`).join('|')
  assert.equal(parseRecentQuery(twelveNormal).length, 12)
})

test('self-talk 服务：成功生成 2 句并透传模型参数', async () => {
  const { llm, service } = makeSelfTalkHarness()
  const result = await service.generate({
    kind: 'murmur',
    weather: 'rain',
    moodKey: 'busy',
    stats: { userMessages: 3, toolCalls: 9, activeMs: 60000 },
    idleMinutes: 5,
    poem: { title: '静夜思', author: '李白' },
    recent: ['最近说过的一句话'],
  })
  assert.equal(result.ok, true)
  assert.equal(result.cached, false)
  assert.equal(result.lines.length, 1, 'v1.33：默认返回最不重复的一句')
  assert.deepEqual(result.lines.map((line) => line.text), [SELF_TALK_LINES_A[0]])
  for (const line of result.lines) {
    assert.equal(typeof line.text, 'string')
    assert.equal(typeof line.ts, 'number')
  }
  assert.deepEqual(result.model, { provider: SELF_TALK_SELECTION.provider, model: SELF_TALK_SELECTION.model })
  assert.equal(typeof result.generatedAt, 'number')
  assert.equal(llm.calls.length, 1)

  const options = llm.calls[0]
  assert.equal(options.provider, 'deepseek-account')
  assert.equal(options.model, 'deepseek-flash')
  assert.equal(options.reasoningEffort, undefined, '短请求不透传 reasoningEffort（避免推理吃光 200 token / 拖过客户端 8s 超时）')
  assert.equal(options.system, SELF_TALK_SYSTEM_PROMPT)
  assert.equal(options.maxTokens, 320)
  assert.equal(options.temperature, SELF_TALK_TEMPERATURE)
  assert.equal(options.temperature, 1.0, 'v1.22 temperature 0.95→1.0')
  assert.ok(options.signal instanceof AbortSignal, '传入了 AbortSignal（20s 超时）')
  const userText = options.messages[0].content[0].text
  assert.match(userText, /心情：busy/)
  assert.match(userText, /天气/)
  assert.match(userText, /最近说过的一句话/)
  assert.match(userText, /不要重复/)
  assert.equal(userText.includes('静夜思'), false, '今日诗标题即使误传也不得进入 prompt')
  assert.equal(userText.includes('李白'), false, '今日诗作者即使误传也不得进入 prompt')
})

test('self-talk 服务：多段 text-delta 正确拼接（含无 finish 的容错）', async () => {
  const llm = makeMockLlm(() => ({
    chunks: [
      { type: 'text-delta', index: 0, text: '今天的小雨让我有点' },
      { type: 'text-delta', index: 0, text: '想窝在窗边看雨\n我数了数你敲键盘' },
      { type: 'text-delta', index: 0, text: '的声音，好像比昨天轻快' },
    ],
    noFinish: true,
  }))
  const service = createSelfTalkService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
  })
  const result = await service.generate({})
  assert.equal(result.ok, true)
  assert.deepEqual(result.lines.map((line) => line.text), [SELF_TALK_LINES_A[0]])
})

test('self-talk：prompt 白名单（传敏感会话文本也不会进入模型请求）', async () => {
  const { llm, service } = makeSelfTalkHarness()
  const secrets = ['超级机密的用户原文：我的银行卡密码是 123456', 'sessionMessages 里的对话内容']
  const result = await service.generate({
    kind: 'murmur',
    stats: { userMessages: 2 },
    recent: ['这是契约允许发送的最近一句模型生成文本'],
    messages: [{ role: 'user', content: [{ type: 'text', text: secrets[0] }] }],
    sessionMessages: secrets,
    sessionText: secrets[1],
    transcript: secrets,
    poem: { title: '将进酒', author: '李白' },
  })
  assert.equal(result.ok, true)
  const sent = JSON.stringify(llm.calls[0])
  for (const secret of secrets) assert.equal(sent.includes(secret), false, '敏感会话文本不得出现在模型请求里')
  assert.equal(sent.includes('将进酒'), false, '今日诗标题不得出现在模型请求里')
  assert.equal(sent.includes('李白'), false, '今日诗作者不得出现在模型请求里')
  assert.equal(sent.includes('这是契约允许发送的最近一句模型生成文本'), true, 'recent 是契约允许的上下文')
})

test('self-talk 服务：最小间隔内复用上次结果（cached:true），之后可再生成', async () => {
  let call = 0
  const { llm, service, state } = makeSelfTalkHarness({
    minIntervalMs: 3000,
    responder: () => (call++ === 0 ? SELF_TALK_LINES_A : SELF_TALK_LINES_B).join(SELF_TALK_SEP),
  })
  const first = await service.generate({})
  assert.equal(first.ok, true)
  assert.equal(first.cached, false)
  assert.equal(llm.calls.length, 1)

  state.clock += 1000
  const second = await service.generate({})
  assert.equal(second.ok, true)
  assert.equal(second.cached, true, '3s 内复用上次结果')
  assert.equal(llm.calls.length, 1)
  assert.deepEqual(second.lines, first.lines)

  state.clock += 3000
  const third = await service.generate({})
  assert.equal(third.ok, true)
  assert.equal(third.cached, false)
  assert.equal(llm.calls.length, 2)
  assert.deepEqual(third.lines.map((line) => line.text), [SELF_TALK_LINES_B[0]])
})

test('self-talk 服务：无上次结果时的过早请求 → SELF_TALK_RATE_LIMITED', async () => {
  const { service, state } = makeSelfTalkHarness({
    minIntervalMs: 3000,
    responder: () => new Error('network down'),
  })
  const first = await service.generate({})
  assert.equal(first.ok, false)
  assert.equal(first.error.code, 'SELF_TALK_UNAVAILABLE')
  state.clock += 100
  const second = await service.generate({})
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'SELF_TALK_RATE_LIMITED')
})

test('self-talk 服务：并发请求 in-flight 去重复用同一次模型调用', async () => {
  const { llm, service } = makeSelfTalkHarness({
    responder: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return SELF_TALK_LINES_A.join(SELF_TALK_SEP)
    },
  })
  const [a, b] = await Promise.all([service.generate({}), service.generate({})])
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(llm.calls.length, 1, '并发只调用一次模型')
  assert.deepEqual([a.cached, b.cached].sort(), [false, true])
})

test('self-talk 服务：空文本 / 流异常 / finish error / 超时 → ok:false 不抛', async () => {
  const empty = makeSelfTalkHarness({ responder: () => '' })
  const emptyResult = await empty.service.generate({})
  assert.equal(emptyResult.ok, false)
  assert.equal(emptyResult.error.code, 'SELF_TALK_UNAVAILABLE')

  const boom = makeSelfTalkHarness({ responder: () => new Error('boom') })
  assert.equal((await boom.service.generate({})).ok, false)

  const finishError = makeSelfTalkHarness({
    responder: () => ({ text: '', finish: { kind: 'error', failure: { code: 'AUTH', message: 'bad key' } } }),
  })
  const errorResult = await finishError.service.generate({})
  assert.equal(errorResult.ok, false)
  assert.equal(errorResult.error.code, 'SELF_TALK_UNAVAILABLE')
  assert.match(errorResult.error.message, /AUTH/)

  const hanging = makeSelfTalkHarness({ responder: () => ({ hang: true }), timeoutMs: 40 })
  const startedAt = Date.now()
  const timeoutResult = await hanging.service.generate({})
  assert.equal(timeoutResult.ok, false)
  assert.equal(timeoutResult.error.code, 'SELF_TALK_UNAVAILABLE')
  assert.match(timeoutResult.error.message, /超时/)
  assert.ok(Date.now() - startedAt < 2000, '超时被及时收敛')
})

test('self-talk：llm / 默认模型缺失时安全降级（不抛）', async () => {
  const noLlm = createSelfTalkService({ llm: null, getSelection: () => SELF_TALK_SELECTION })
  const noLlmResult = await noLlm.generate({})
  assert.equal(noLlmResult.ok, false)
  assert.equal(noLlmResult.error.code, 'SELF_TALK_UNAVAILABLE')

  const llm = makeMockLlm(() => SELF_TALK_LINES_A.join(SELF_TALK_SEP))
  const noSelection = createSelfTalkService({ llm, getSelection: () => null })
  const noSelectionResult = await noSelection.generate({})
  assert.equal(noSelectionResult.ok, false)
  assert.equal(noSelectionResult.error.code, 'SELF_TALK_UNAVAILABLE')
  assert.equal(llm.calls.length, 0, '没有模型选择时不应发起请求')

  const throwsSelection = createSelfTalkService({
    llm,
    getSelection: () => {
      throw new Error('selection boom')
    },
  })
  assert.equal((await throwsSelection.generate({})).ok, false)

  // getLlm getter 路径（index.js 用这种方式懒取 optional 服务）
  const viaGetter = createSelfTalkService({ getLlm: () => llm, getSelection: () => SELF_TALK_SELECTION })
  const viaGetterResult = await viaGetter.generate({})
  assert.equal(viaGetterResult.ok, true)
})

test('self-talk：最近 20 条生成文本参与去重（重复结果被丢弃）', async () => {
  const { llm, service, state } = makeSelfTalkHarness({
    responder: () => SELF_TALK_LINES_A.join(SELF_TALK_SEP),
  })
  const first = await service.generate({})
  assert.equal(first.ok, true)
  state.clock += 5000
  const second = await service.generate({})
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'SELF_TALK_UNAVAILABLE')
  assert.equal(llm.calls.length, 2, '仍会请求模型，只是结果被判重')
})

test('self-talk 路由：成功形状 + query 解析 + 隐私白名单 + 栅栏', async () => {
  const { llm, service } = makeSelfTalkHarness({ responder: () => SELF_TALK_LINES_A.join(SELF_TALK_SEP) })
  const harness = createHarness({ selfTalkService: service })

  const recent = encodeURIComponent(['第一句最近说过的话', '第二句最近说过的话'].join('|'))
  const url =
    `/api/dsh-poetry/self-talk.json?kind=intro&mood=busy&weather=rain&recent=${recent}` +
    `&sessionMessages=${encodeURIComponent('超级机密对话内容')}`
  const response = await harness.call('self-talk.json', mockRequest({ url }))
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, true)
  assert.equal(body.lines.length, 1, 'v1.33：默认返回最不重复的一句')
  assert.equal(body.cached, false)
  assert.deepEqual(body.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(typeof body.generatedAt, 'number')

  const userText = llm.calls[0].messages[0].content[0].text
  // kind=intro 已废弃：路由统一按 murmur 处理，prompt 里不再出现 kind/intro
  assert.equal(/kind=/.test(userText), false, 'kind 固定 murmur，不写进 prompt')
  assert.equal(/intro/.test(userText), false, 'intro 已废弃')
  assert.match(userText, /busy/)
  assert.match(userText, /rain/)
  assert.equal(userText.includes('用户消息'), false, 'v1.58：不注入会话统计')
  assert.match(userText, /第一句最近说过的话/)
  // v1.8b：不再发送今日诗标题/作者（避免诱导背诗）
  assert.equal(/今天的诗/.test(userText), false)
  assert.equal(/《/.test(userText), false, 'prompt 不含书名号/诗名')
  assert.equal(/诗\d/.test(userText), false, 'prompt 不含数据里的诗标题')
  assert.equal(JSON.stringify(llm.calls[0]).includes('超级机密'), false, '未知 query 参数不会进入 prompt')

  const crossed = await harness.call(
    'self-talk.json',
    mockRequest({ url, headers: { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' } }),
  )
  assert.equal(crossed.statusCode, 403)
  assert.equal(crossed.json().error.code, 'FORBIDDEN')
})

test('self-talk 路由：非法 query 安全归一/截断（kind/idleMinutes/recent）', async () => {
  const { llm, service } = makeSelfTalkHarness({ responder: () => SELF_TALK_LINES_B.join(SELF_TALK_SEP) })
  const harness = createHarness({ selfTalkService: service })
  const manyRecent = encodeURIComponent(Array.from({ length: 7 }, (_, index) => `最近说过的话第${index}句`).join('|'))
  const url = `/api/dsh-poetry/self-talk.json?kind=weird&idleMinutes=abc&recent=${manyRecent}`
  const response = await harness.call('self-talk.json', mockRequest({ url }))
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
  const userText = llm.calls[0].messages[0].content[0].text
  assert.equal(/kind=/.test(userText), false, 'kind 固定 murmur，非法 kind 也不影响 prompt')
  assert.equal(/距上次和用户互动/.test(userText), false, 'v1.58：不再注入互动间隔')
  const recentLines = userText.split('\n').filter((line) => line.startsWith('- '))
  assert.ok(recentLines.length <= 12, 'recent 最多 12 条（v1.22）')
  assert.equal(recentLines.length, 7, '7 条合法 recent 全部保留')
})

test('self-talk 路由：llm 缺失时 200 + SELF_TALK_UNAVAILABLE（不抛）', async () => {
  const harness = createHarness() // 默认 selfTalkService 无 llm
  const response = await harness.call('self-talk.json', mockRequest({ url: '/api/dsh-poetry/self-talk.json' }))
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'SELF_TALK_UNAVAILABLE')
})

// ---------------------------------------------------------------------------
// 模型心情（契约 v1.9 §2.12）与 92 张心情图鉴
// ---------------------------------------------------------------------------

test('mood-ai：loadMoodCatalog 读真实 92 张图鉴（89 mood + 3 panel），缺失降级不抛', () => {
  const loaded = loadMoodCatalog()
  assert.equal(loaded.ok, true, loaded.ok === false ? loaded.message : '')
  assert.equal(loaded.catalog.moodImages.length, 89, '89 张 mood 图全部可用')
  assert.equal(loaded.catalog.panelImages.length, 3, '3 张 panel 图')
  assert.equal(loaded.catalog.files.size, 89)
  for (const file of ['dsh-whale-state-celebrate.webp', 'dsh-whale-state-festival-christmas.webp']) {
    assert.equal(loaded.catalog.files.has(file), true, `图鉴应包含 ${file}`)
  }
  for (const image of loaded.catalog.moodImages) assert.match(image.file, /^dsh-whale-[^/]+\.webp$/)
  // 图鉴里的 5 张节日图都有 when
  const festival = loaded.catalog.moodImages.filter((image) => typeof image.when === 'string')
  assert.equal(festival.length, 5)

  const missing = loadMoodCatalog({ file: '/nonexistent/mood-catalog.json' })
  assert.equal(missing.ok, false)
  assert.equal(typeof missing.message, 'string')
})

test('mood-ai：节日 when 解析（单日/区间/跨年/农历不开放）', () => {
  assert.equal(isWhenActive('10-31', '2026-10-31'), true)
  assert.equal(isWhenActive('10-31', '2026-11-01'), false)
  assert.equal(isWhenActive('12-24..12-26', '2026-12-25'), true)
  assert.equal(isWhenActive('12-24..12-26', '2026-12-27'), false)
  assert.equal(isWhenActive('12-31..01-02', '2027-01-01'), true, '跨年区间')
  assert.equal(isWhenActive('中秋', '2026-10-21'), false, '农历节日无法按公历判断 → 不开放')
  assert.equal(isWhenActive('', '2026-10-21'), false)

  const catalog = makeMoodCatalogFixture()
  const christmas = resolveFestivalAvailability(catalog, '2026-12-25')
  assert.deepEqual(christmas.available.map((image) => image.file), ['dsh-whale-state-xmas.webp'])
  assert.deepEqual(christmas.unavailable.map((image) => image.file).sort(), [
    'dsh-whale-state-halloween.webp',
    'dsh-whale-state-midautumn.webp',
    'dsh-whale-state-valentine.webp',
  ])
  assert.equal(resolveFestivalAvailability(catalog, '2026-10-21').available.length, 0)
})

test('mood-ai：buildMoodPrompt 含图鉴清单+当天情境，无会话原文/诗上下文', () => {
  const catalog = makeMoodCatalogFixture()
  const prompt = buildMoodPrompt(
    {
      now: Date.UTC(2026, 9, 21, 2, 0, 0), // 2026-10-21 10:00 Asia/Shanghai
      weather: 'rain',
      moodKey: 'busy',
      recent: ['刚刚在发呆', '看到窗外下雨了'],
      recentImages: ['dsh-whale-state-tired.webp', 'dsh-whale-state-sad.webp'],
      // 误传/注入的敏感内容必须被白名单丢弃：
      messages: [{ role: 'user', content: [{ type: 'text', text: '绝密会话原文' }] }],
      sessionMessages: ['绝密会话原文'],
      sessionText: '绝密会话原文',
      poem: { title: '静夜思', author: '李白' },
    },
    catalog,
  )
  assert.match(prompt, /2026-10-21/)
  assert.match(prompt, /当前天气：rain/)
  assert.match(prompt, /busy（忙碌）/)
  assert.equal(prompt.includes('用户消息'), false, 'v1.58：不注入会话统计')
  assert.equal(prompt.includes('工具调用'), false)
  assert.equal(prompt.includes('活跃约'), false)
  assert.match(prompt, /刚刚在发呆/)
  assert.match(prompt, /最近用过的图片/)
  assert.match(prompt, /dsh-whale-state-happy\.webp｜开心｜happy,celebrate/)
  assert.match(prompt, /今天没有可用的节日图/)
  assert.match(prompt, /今天不可用的节日图/)
  assert.match(prompt, /不是随机抽图/)
  assert.match(prompt, /只输出一个 JSON 对象/)
  assert.equal(prompt.includes('绝密会话原文'), false, '会话原文绝不允许进入 prompt')
  assert.equal(prompt.includes('静夜思'), false, '不发送诗上下文')
  assert.equal(prompt.includes('李白'), false)

  // 节日日期：圣诞图进入「今天可用」
  const xmasPrompt = buildMoodPrompt({ now: Date.UTC(2026, 11, 25, 2, 0, 0) }, catalog)
  assert.match(xmasPrompt, /今天可用的节日图/)
  assert.match(xmasPrompt, /dsh-whale-state-xmas\.webp｜圣诞/)
})

test('mood-ai：parseMoodResult 合法/fenced/非法/超长/节日 when 校验', () => {
  const catalog = makeMoodCatalogFixture()
  const dateKey = '2026-10-21'
  const valid = parseMoodResult(
    '{"label":"有点累","image":"dsh-whale-state-tired.webp","reason":"忙了很久，想歇一会","energy":25}',
    catalog,
    { dateKey },
  )
  assert.equal(valid.ok, true)
  assert.deepEqual(valid.mood, { label: '有点累', image: 'dsh-whale-state-tired.webp', reason: '忙了很久，想歇一会', energy: 25 })

  const fenced = parseMoodResult(
    '```json\n{"label":"开心","image":"dsh-whale-state-happy.webp","reason":"聊得很开心","energy":80}\n```',
    catalog,
    { dateKey },
  )
  assert.equal(fenced.ok, true)
  assert.equal(fenced.mood.label, '开心')

  const withChatter = parseMoodResult(
    '好的，结果如下：{"label":"开心","image":"dsh-whale-state-happy.webp","reason":"聊得很开心","energy":80} 希望你喜欢',
    catalog,
    { dateKey },
  )
  assert.equal(withChatter.ok, true, '容忍 JSON 前后废话')

  const trimmed = parseMoodResult(
    '{"label":"  开心  ","image":"dsh-whale-state-happy.webp","reason":"  聊得很开心  ","energy":80}',
    catalog,
    { dateKey },
  )
  assert.equal(trimmed.mood.label, '开心', 'label 去空白')
  assert.equal(trimmed.mood.reason, '聊得很开心', 'reason 去空白')

  assert.equal(parseMoodResult('这不是 JSON', catalog, { dateKey }).ok, false)
  assert.equal(parseMoodResult('{"label":"开心"}', catalog, { dateKey }).ok, false, '缺 image')
  assert.equal(
    parseMoodResult('{"label":"开心","image":"dsh-whale-state-not-exist.webp","reason":"理由","energy":50}', catalog, { dateKey }).ok,
    false,
    '未知图片',
  )
  assert.equal(
    parseMoodResult(`{"label":"${'心'.repeat(13)}","image":"dsh-whale-state-happy.webp","reason":"理由","energy":50}`, catalog, { dateKey }).ok,
    false,
    'label 超 12 字',
  )
  assert.equal(
    parseMoodResult(`{"label":"开心","image":"dsh-whale-state-happy.webp","reason":"${'理'.repeat(41)}","energy":50}`, catalog, { dateKey }).ok,
    false,
    'reason 超 40 字',
  )
  assert.equal(
    parseMoodResult('{"label":"开心","image":"dsh-whale-state-happy.webp","reason":"理由","energy":101}', catalog, { dateKey }).ok,
    false,
    'energy 超范围',
  )
  // 节日图：日期不符 → 失败；日期匹配 → 成功
  const festivalJson = JSON.stringify({ label: '圣诞快乐', image: 'dsh-whale-state-xmas.webp', reason: '今天圣诞节', energy: 90 })
  assert.equal(parseMoodResult(festivalJson, catalog, { dateKey: '2026-10-21' }).ok, false, '圣诞图非圣诞日不可用')
  assert.equal(parseMoodResult(festivalJson, catalog, { dateKey: '2026-12-25' }).ok, true, '圣诞日可用')
  const halloweenJson = JSON.stringify({ label: '万圣节', image: 'dsh-whale-state-halloween.webp', reason: '今天万圣节', energy: 60 })
  assert.equal(parseMoodResult(halloweenJson, catalog, { dateKey: '2026-10-31' }).ok, true)
  assert.equal(parseMoodResult(halloweenJson, catalog, { dateKey: '2026-10-30' }).ok, false)
  const midautumnJson = JSON.stringify({ label: '中秋', image: 'dsh-whale-state-midautumn.webp', reason: '今天中秋', energy: 60 })
  assert.equal(parseMoodResult(midautumnJson, catalog, { dateKey: '2026-10-21' }).ok, false, '农历节日图不开放')
})

test('mood-ai 服务：成功生成心情并透传模型参数', async () => {
  const { llm, service } = makeMoodAiHarness()
  const result = await service.generate({
    moodKey: 'busy',
    weather: 'rain',
    stats: { userMessages: 3, toolCalls: 9, activeMs: 60000 },
    idleMinutes: 5,
    recent: ['刚刚在发呆'],
    recentImages: ['dsh-whale-state-sad.webp'],
  })
  assert.equal(result.ok, true)
  assert.equal(result.cached, false)
  assert.deepEqual(result.mood, {
    label: '开心',
    image: 'dsh-whale-state-happy.webp',
    reason: '今天聊得很开心',
    energy: 82,
  })
  assert.deepEqual(result.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(typeof result.generatedAt, 'number')
  assert.equal(llm.calls.length, 1)

  const options = llm.calls[0]
  assert.equal(options.provider, 'deepseek-account')
  assert.equal(options.model, 'deepseek-flash')
  assert.equal(options.system, MOOD_AI_SYSTEM_PROMPT)
  assert.equal(options.maxTokens, 220)
  assert.equal(options.temperature, MOOD_AI_TEMPERATURE)
  assert.ok(options.temperature >= 1.0 && options.temperature <= 1.1, 'v1.13 temperature 提到 1.0–1.1')
  assert.equal(options.reasoningEffort, undefined)
  assert.ok(options.signal instanceof AbortSignal)
  const userText = options.messages[0].content[0].text
  assert.match(userText, /心情图鉴/)
  assert.match(userText, /dsh-whale-state-happy\.webp/)
  assert.match(userText, /busy（忙碌）/)
  assert.match(userText, /当前天气：rain/)
  assert.match(userText, /最近用过的图片/)
  assert.match(userText, /dsh-whale-state-sad\.webp/)
  assert.match(userText, /只输出一个 JSON 对象/)
})

test('mood-ai 服务：10 分钟缓存命中 / force 绕过 / 过期重取', async () => {
  let call = 0
  const responder = () => {
    call += 1
    const tired = call > 1
    return JSON.stringify({
      label: tired ? '有点累' : '开心',
      image: tired ? 'dsh-whale-state-tired.webp' : 'dsh-whale-state-happy.webp',
      reason: tired ? '忙了一天有点累' : '今天聊得很开心',
      energy: tired ? 25 : 82,
    })
  }
  const { llm, service, state } = makeMoodAiHarness({ responder })
  const first = await service.generate({ moodKey: 'calm' })
  assert.equal(first.ok, true)
  assert.equal(first.cached, false)
  assert.equal(llm.calls.length, 1)

  state.clock += 60 * 1000 // 1 分钟后命中缓存
  const hit = await service.generate({ moodKey: 'calm' })
  assert.equal(hit.ok, true)
  assert.equal(hit.cached, true)
  assert.deepEqual(hit.mood, first.mood)
  assert.equal(llm.calls.length, 1)

  state.clock += 5 * 60 * 1000 // force 绕过缓存
  const forced = await service.generate({ moodKey: 'calm' }, { force: true })
  assert.equal(forced.ok, true)
  assert.equal(forced.cached, false)
  assert.equal(forced.mood.label, '有点累')
  assert.equal(llm.calls.length, 2)

  state.clock += 11 * 60 * 1000 // 10 分钟 TTL 过期 → 重新生成
  const expired = await service.generate({ moodKey: 'calm' })
  assert.equal(expired.ok, true)
  assert.equal(expired.cached, false)
  assert.equal(llm.calls.length, 3)
})

test('mood-ai 服务：并发 in-flight 去重复用同一次模型调用', async () => {
  const { llm, service } = makeMoodAiHarness({
    responder: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return JSON.stringify({
        label: '开心',
        image: 'dsh-whale-state-happy.webp',
        reason: '今天聊得很开心',
        energy: 82,
      })
    },
  })
  const [a, b] = await Promise.all([service.generate({}), service.generate({})])
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(llm.calls.length, 1, '并发只调用一次模型')
  assert.deepEqual([a.cached, b.cached].sort(), [false, true])
})

test('mood-ai 服务：3s 限频（无缓存时 RATE_LIMITED，之后恢复）', async () => {
  let first = true
  const { service, state } = makeMoodAiHarness({
    cacheTtlMs: 0,
    minIntervalMs: 3000,
    responder: () => {
      if (first) {
        first = false
        throw new Error('offline')
      }
      return JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '缓过来了', energy: 70 })
    },
  })
  const failed = await service.generate({})
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'MOOD_AI_UNAVAILABLE')

  state.clock += 100
  const limited = await service.generate({})
  assert.equal(limited.ok, false)
  assert.equal(limited.error.code, 'MOOD_AI_RATE_LIMITED')

  state.clock += 3000
  const recovered = await service.generate({})
  assert.equal(recovered.ok, true)
})

test('mood-ai：失败/空输出/非法 JSON/超时/llm 缺失/图鉴缺失 → ok:false 不抛', async () => {
  const invalid = makeMoodAiHarness({ responder: () => '这不是 JSON' })
  const invalidResult = await invalid.service.generate({})
  assert.equal(invalidResult.ok, false)
  assert.equal(invalidResult.error.code, 'MOOD_AI_UNAVAILABLE')

  const empty = makeMoodAiHarness({ responder: () => '' })
  assert.equal((await empty.service.generate({})).ok, false)

  const boom = makeMoodAiHarness({ responder: () => new Error('boom') })
  assert.equal((await boom.service.generate({})).ok, false)

  const unknownImage = makeMoodAiHarness({
    responder: () => JSON.stringify({ label: '开心', image: 'nope.webp', reason: '理由', energy: 50 }),
  })
  assert.equal((await unknownImage.service.generate({})).ok, false)

  const hanging = makeMoodAiHarness({ responder: () => ({ hang: true }), timeoutMs: 40 })
  const startedAt = Date.now()
  const timeoutResult = await hanging.service.generate({})
  assert.equal(timeoutResult.ok, false)
  assert.match(timeoutResult.error.message, /超时/)
  assert.ok(Date.now() - startedAt < 2000, '超时被及时收敛')

  const noCatalog = createMoodAiService({
    llm: makeMockLlm(() => '{}'),
    getSelection: () => SELF_TALK_SELECTION,
    catalog: null,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
  })
  assert.equal((await noCatalog.generate({})).ok, false)
  assert.equal((await noCatalog.generate({})).error.code, 'MOOD_AI_UNAVAILABLE')

  const noLlm = createMoodAiService({ llm: null, getSelection: () => SELF_TALK_SELECTION, catalog: makeMoodCatalogFixture() })
  assert.equal((await noLlm.generate({})).ok, false)

  const noSelection = createMoodAiService({
    llm: makeMockLlm(() => '{}'),
    getSelection: () => null,
    catalog: makeMoodCatalogFixture(),
  })
  const selectionResult = await noSelection.generate({})
  assert.equal(selectionResult.ok, false)
  assert.equal(selectionResult.error.code, 'MOOD_AI_UNAVAILABLE')
})

test('mood-ai 路由：成功形状 + query 解析 + 隐私白名单 + force + 栅栏', async () => {
  const { llm, service } = makeMoodAiHarness({
    responder: () =>
      JSON.stringify({
        label: '有成就感',
        image: 'dsh-whale-state-achievement.webp',
        reason: '今天完成了不少事',
        energy: 70,
      }),
  })
  const harness = createHarness({ moodAiService: service })

  const recent = encodeURIComponent('刚刚在发呆|看到窗外下雨了')
  const recentImages = encodeURIComponent('dsh-whale-state-tired.webp|dsh-whale-state-sad.webp')
  const url =
    `/api/dsh-poetry/mood-ai.json?mood=busy&weather=rain&recent=${recent}&recentImages=${recentImages}` +
    `&sessionMessages=${encodeURIComponent('超级机密对话内容')}`
  const response = await harness.call('mood-ai.json', mockRequest({ url }))
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.mood, {
    label: '有成就感',
    image: 'dsh-whale-state-achievement.webp',
    reason: '今天完成了不少事',
    energy: 70,
  })
  assert.deepEqual(body.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(typeof body.generatedAt, 'number')
  assert.equal(body.cached, false)

  const userText = llm.calls[0].messages[0].content[0].text
  assert.match(userText, /busy（忙碌）/)
  assert.match(userText, /当前天气：rain/)
  assert.equal(userText.includes('用户消息'), false, 'v1.58：不注入会话统计')
  assert.match(userText, /刚刚在发呆/)
  assert.match(userText, /dsh-whale-state-tired\.webp/)
  assert.match(userText, /不是随机抽图/)
  assert.equal(JSON.stringify(llm.calls[0]).includes('超级机密'), false, '未知 query 参数不会进入 prompt')

  // 普通再次请求 → 10min 缓存命中，不再调模型
  const cachedBody = (await harness.call('mood-ai.json', mockRequest({ url }))).json()
  assert.equal(cachedBody.ok, true)
  assert.equal(cachedBody.cached, true)
  assert.equal(llm.calls.length, 1)

  // v1.78：自动刷新带 force 但不带 manual → 仍走缓存（避免多页面/重载叠加刷模型）
  const autoForced = (await harness.call('mood-ai.json', mockRequest({ url: `${url}&force=1` }))).json()
  assert.equal(autoForced.ok, true)
  assert.equal(autoForced.cached, true)
  assert.equal(llm.calls.length, 1)

  // 只有手动刷新（force=1&manual=1）才绕过缓存
  const forcedBody = (await harness.call('mood-ai.json', mockRequest({ url: `${url}&force=1&manual=1` }))).json()
  assert.equal(forcedBody.ok, true)
  assert.equal(forcedBody.cached, false)
  assert.equal(llm.calls.length, 2)

  const crossed = await harness.call(
    'mood-ai.json',
    mockRequest({ url, headers: { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' } }),
  )
  assert.equal(crossed.statusCode, 403)
  assert.equal(crossed.json().error.code, 'FORBIDDEN')
})

test('mood-ai 路由：失败服务 → 200 + MOOD_AI_UNAVAILABLE；query 归一/截断', async () => {
  const seen = []
  const stubService = {
    async generate(context, options) {
      seen.push({ context, options })
      return { ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: '模型不可用' } }
    },
  }
  const harness = createHarness({ moodAiService: stubService })
  const manyRecent = encodeURIComponent(Array.from({ length: 7 }, (_, index) => `第${index}句最近自述`).join('|'))
  const manyImages = encodeURIComponent(Array.from({ length: 7 }, (_, index) => `dsh-whale-state-${index}.webp`).join('|'))
  const url = `/api/dsh-poetry/mood-ai.json?recent=${manyRecent}&recentImages=${manyImages}&force=1&manual=1`
  const response = await harness.call('mood-ai.json', mockRequest({ url }))
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'MOOD_AI_UNAVAILABLE')

  const captured = seen[0]
  assert.equal(captured.context.recent.length, 3, 'recent 最多 3 条')
  assert.equal(captured.context.recentImages.length, 7, 'v1.13：上限 20，7 条全部保留')
  assert.equal('idleMinutes' in captured.context, false, 'v1.58：不再传入互动间隔')
  assert.deepEqual(captured.options, { force: true })

  const noService = createHarness({ moodAiService: undefined })
  // overrides.moodAiService=undefined 会走默认（无 llm）→ 同样安全降级
  const fallback = (await noService.call('mood-ai.json', mockRequest({ url }))).json()
  assert.equal(fallback.ok, false)
  assert.equal(fallback.error.code, 'MOOD_AI_UNAVAILABLE')
})

// ---------------------------------------------------------------------------
// 自主记忆日志（契约 v1.10 §2.13，只追加、不改写）
// ---------------------------------------------------------------------------

test('memory-journal：resolveMemoryDir 优先级（DSH_AGENT_MEMORY_DIR → DSH_HOME → ~/.dsh）', () => {
  assert.equal(resolveMemoryDir({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'), '/tmp/dsh-home/agent-memory')
  assert.equal(
    resolveMemoryDir({ DSH_HOME: '/tmp/dsh-home', DSH_AGENT_MEMORY_DIR: '/tmp/custom-memory' }, '/Users/alice'),
    '/tmp/custom-memory',
    'DSH_AGENT_MEMORY_DIR 优先',
  )
  assert.equal(resolveMemoryDir({}, '/Users/alice'), '/Users/alice/.dsh/agent-memory')
  assert.equal(resolveMemoryDir({ HOME: '/Users/bob' }, null), '/Users/bob/.dsh/agent-memory')
  assert.equal(
    resolveMemoryDir({ DSH_AGENT_MEMORY_DIR: '   ' }, '/Users/alice'),
    '/Users/alice/.dsh/agent-memory',
    '空白自定义目录忽略',
  )
})

test('memory-journal：append 创建目录/补 header/只追加，jsonl 格式正确', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  const ts = new Date(2026, 9, 21, 10, 30, 0).getTime()
  let clock = ts
  const journal = createMemoryJournal({ dir, now: () => clock, logger: { warn() {} } })
  const model = { provider: 'deepseek-account', model: 'deepseek-flash' }

  const first = await journal.append({ kind: 'murmur', text: '今天有点困，想趴一会儿', model })
  assert.equal(first.ok, true)
  assert.equal(fs.existsSync(dir), true, '自动创建目录')
  const mdFile = path.join(dir, 'journal.md')
  const md = fs.readFileSync(mdFile, 'utf8')
  assert.ok(md.startsWith(MEMORY_JOURNAL_HEADER), '首次写入补 md 头部')
  assert.match(md, /## 2026-10-21 10:30 · 碎碎念/)
  assert.match(md, /今天有点困，想趴一会儿/)

  let entries = readJournalJsonl(dir)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0], {
    ts,
    kind: 'murmur',
    text: '今天有点困，想趴一会儿',
    model: { provider: 'deepseek-account', model: 'deepseek-flash' },
  })

  clock += JOURNAL_MURMUR_MIN_INTERVAL_MS // v1.20：murmur 最多 3min 一条，推进时钟后再写
  const second = await journal.append({ kind: 'murmur', text: '第二句碎碎念', model })
  assert.equal(second.ok, true)
  entries = readJournalJsonl(dir)
  assert.equal(entries.length, 2)
  assert.equal(entries[1].text, '第二句碎碎念')
  const mdAfter = fs.readFileSync(mdFile, 'utf8')
  assert.ok(mdAfter.startsWith(md), '已有内容保持不变（只追加）')
  assert.equal(mdAfter.split(MEMORY_JOURNAL_HEADER).length - 1, 1, 'header 不重复写')
})

test('memory-journal：已有文件内容保留（不覆盖/不补 header）', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  fs.mkdirSync(dir, { recursive: true })
  const existingMd = '# 我的碎碎念与想法\n\n> 只追加。过去的条目不改写。\n\n## 2026-10-21 傍晚 · 旧条目\n旧内容\n'
  const existingJsonl = '{"ts":1,"kind":"murmur","text":"旧句子"}\n'
  fs.writeFileSync(path.join(dir, 'journal.md'), existingMd, 'utf8')
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), existingJsonl, 'utf8')

  const journal = createMemoryJournal({ dir, now: () => new Date(2026, 9, 21, 11, 0, 0).getTime(), logger: { warn() {} } })
  await journal.append({ kind: 'murmur', text: '新追加的句子' })

  const md = fs.readFileSync(path.join(dir, 'journal.md'), 'utf8')
  assert.ok(md.startsWith(existingMd), '旧 md 内容逐字保留')
  assert.ok(md.endsWith('新追加的句子\n'))
  assert.equal(md.split(MEMORY_JOURNAL_HEADER).length - 1, 1, '已有 header 不重复写')
  const jsonlLines = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean)
  assert.equal(jsonlLines[0], existingJsonl.trim(), '旧 jsonl 行逐字保留')
  assert.equal(jsonlLines.length, 2)
  assert.equal(JSON.parse(jsonlLines[1]).text, '新追加的句子')
})

test('memory-journal：mood 条目格式（label/reason/image/model）', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  const journal = createMemoryJournal({ dir, now: () => new Date(2026, 9, 21, 12, 5, 0).getTime(), logger: { warn() {} } })
  const result = await journal.append({
    kind: 'mood',
    label: '开心',
    reason: '聊得很开心',
    image: 'dsh-whale-state-celebrate.webp',
    model: { provider: 'deepseek-account', model: 'deepseek-flash' },
  })
  assert.equal(result.ok, true)
  const md = fs.readFileSync(path.join(dir, 'journal.md'), 'utf8')
  assert.match(md, /## 2026-10-21 12:05 · 心情/)
  assert.match(md, /心情：开心 — 聊得很开心（dsh-whale-state-celebrate\.webp）/)
  const entries = readJournalJsonl(dir)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0], {
    ts: new Date(2026, 9, 21, 12, 5, 0).getTime(),
    kind: 'mood',
    label: '开心',
    reason: '聊得很开心',
    image: 'dsh-whale-state-celebrate.webp',
    model: { provider: 'deepseek-account', model: 'deepseek-flash' },
  })
  assert.equal('text' in entries[0], false)
})

test('memory-journal：超长内容按 maxEntryChars 截断', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  const journal = createMemoryJournal({
    dir,
    now: () => new Date(2026, 9, 21, 9, 0, 0).getTime(),
    logger: { warn() {} },
    maxEntryChars: 20,
  })
  await journal.append({ kind: 'murmur', text: '好'.repeat(100) })
  const entries = readJournalJsonl(dir)
  assert.equal(Array.from(entries[0].text).length, 20)
  const md = fs.readFileSync(path.join(dir, 'journal.md'), 'utf8')
  assert.equal(md.includes('好'.repeat(21)), false, 'md 内容同样被截断')
  assert.equal(md.includes('好'.repeat(20)), true)
})

test('memory-journal：写失败只 warn 不抛；非法条目忽略', async () => {
  const warned = []
  const blocker = path.join(makeTmpDir('dshp-mem'), 'not-a-directory')
  fs.writeFileSync(blocker, 'occupied', 'utf8')
  const journal = createMemoryJournal({
    dir: path.join(blocker, 'agent-memory'),
    logger: { warn: (message) => warned.push(String(message)) },
  })
  const failed = await journal.append({ kind: 'murmur', text: '写不进去的句子' })
  assert.equal(failed.ok, false)
  assert.ok(warned.some((message) => message.includes('记忆日志写入失败')), '失败会 logger.warn')
  const invalid = await journal.append({ kind: 'unknown', text: 'x' })
  assert.equal(invalid.ok, false)
})

test('memory-journal 路由：self-talk 新生成每句写一条 murmur，cached 不重复，敏感 query 不入库', async () => {
  const { service } = makeSelfTalkHarness({ minIntervalMs: 3000 })
  const harness = createHarness({ selfTalkService: service })
  const sensitive = '这句是客户端传来的敏感原文不要写进记忆'
  const url = `/api/dsh-poetry/self-talk.json?recent=${encodeURIComponent(sensitive)}&weather=rain`
  const first = await harness.call('self-talk.json', mockRequest({ url }))
  assert.equal(first.json().ok, true)

  let entries = readJournalJsonl(harness.journalDir)
  // v1.20：murmur 最多 3min 一条，同一批 2 句同 ts → 只写第 1 句，第 2 句被限频跳过。
  assert.equal(entries.length, 1, '批次 2 句 → journal 只写 1 条（限频）')
  assert.equal(entries[0].kind, 'murmur')
  assert.deepEqual(entries[0].model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(entries[0].text, SELF_TALK_LINES_A[0])
  const md = fs.readFileSync(path.join(harness.journalDir, 'journal.md'), 'utf8')
  assert.match(md, /· 碎碎念/)
  assert.equal(`${md}${JSON.stringify(entries)}`.includes(sensitive), false, 'query 里的 recent 不得写入记忆')
  assert.equal(`${md}${JSON.stringify(entries)}`.includes('rain'), false, 'query 里的 weather 不得写入记忆')

  // 3s 内再次请求 → cached:true，不重复写
  const second = await harness.call('self-talk.json', mockRequest({ url }))
  assert.equal(second.json().cached, true)
  entries = readJournalJsonl(harness.journalDir)
  assert.equal(entries.length, 1, 'cached 不重复写')
})

test('memory-journal 路由：mood-ai 新生成写 mood，cached 不写，force 再写，失败不写', async () => {
  const { service } = makeMoodAiHarness()
  const harness = createHarness({ moodAiService: service })
  const url = '/api/dsh-poetry/mood-ai.json?mood=busy&weather=rain'
  const first = await harness.call('mood-ai.json', mockRequest({ url }))
  assert.equal(first.json().ok, true)

  let entries = readJournalJsonl(harness.journalDir)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'mood')
  assert.equal(entries[0].label, '开心')
  assert.equal(entries[0].reason, '今天聊得很开心')
  assert.equal(entries[0].image, 'dsh-whale-state-happy.webp')
  assert.deepEqual(entries[0].model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  const md = fs.readFileSync(path.join(harness.journalDir, 'journal.md'), 'utf8')
  assert.match(md, /· 心情/)
  assert.match(md, /心情：开心 — 今天聊得很开心（dsh-whale-state-happy\.webp）/)
  assert.equal(md.includes('busy'), false, 'query 的 mood key 不写入记忆')
  assert.equal(md.includes('rain'), false, 'query 的 weather 不写入记忆')

  // 10min 缓存命中 → cached:true，不重复写
  const cached = await harness.call('mood-ai.json', mockRequest({ url }))
  assert.equal(cached.json().cached, true)
  assert.equal(readJournalJsonl(harness.journalDir).length, 1)

  // v1.21：mood 不再限频/去重 → force 新生成再写一条
  const forced = await harness.call('mood-ai.json', mockRequest({ url: `${url}&force=1&manual=1` }))
  assert.equal(forced.json().cached, false)
  assert.equal(readJournalJsonl(harness.journalDir).length, 2, '每条 mood 都写（回忆完整保留）')

  // 失败 → 不写
  const failingHarness = createHarness({
    moodAiService: { generate: async () => ({ ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: 'x' } }) },
  })
  const failed = await failingHarness.call('mood-ai.json', mockRequest({ url }))
  assert.equal(failed.json().ok, false)
  assert.deepEqual(readJournalJsonl(failingHarness.journalDir), [])
})

test('memory-journal 路由：失败结果不写记忆', async () => {
  const harness = createHarness() // 默认 self-talk / mood-ai 服务均不可用
  const selfTalk = await harness.call('self-talk.json', mockRequest({ url: '/api/dsh-poetry/self-talk.json' }))
  assert.equal(selfTalk.json().ok, false)
  const moodAi = await harness.call('mood-ai.json', mockRequest({ url: '/api/dsh-poetry/mood-ai.json' }))
  assert.equal(moodAi.json().ok, false)
  assert.equal(fs.existsSync(path.join(harness.journalDir, 'journal.jsonl')), false, '失败不创建记忆文件')
})

test('index.js：注入记忆日志（临时 DSH_HOME），self-talk/mood-ai 新生成写入 $DSH_HOME/agent-memory', async () => {
  const dshHome = makeTmpDir('dshp-dshhome')
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const routes = []
    const cleanups = []
    const llm = makeMockLlm((options) => {
      if (options.system === MOOD_AI_SYSTEM_PROMPT) {
        return JSON.stringify({ label: '开心', image: 'dsh-whale-state-celebrate.webp', reason: '一切都很顺利', energy: 80 })
      }
      return SELF_TALK_LINES_A.join('\n')
    })
    const fakeCtx = {
      logger: { info() {}, warn() {}, error() {} },
      on() {
        return () => {}
      },
      effect(execute) {
        const disposer = execute()
        cleanups.push(disposer)
        return disposer
      },
      inject(_keys, callback) {
        callback({
          get(name) {
            if (name === 'webServer') {
              return {
                register(route) {
                  routes.push(route)
                  return () => {}
                },
              }
            }
            if (name === 'connection') return { requestRejection: () => undefined }
            if (name === 'llm') return llm
            if (name === 'agentDefaultModel') {
              return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
            }
            return undefined
          },
          effect(execute) {
            const disposer = execute()
            cleanups.push(disposer)
            return disposer
          },
        })
      },
    }

    await pluginApply(fakeCtx)
    const sensitive = '这段是会话原文不该进记忆'
    const selfTalkRoute = routes.find((route) => route.path === '/api/dsh-poetry/self-talk.json')
    const selfTalkRes = new MockResponse()
    await selfTalkRoute.handler(mockRequest({ url: `/api/dsh-poetry/self-talk.json?recent=${encodeURIComponent(sensitive)}` }), selfTalkRes)
    await selfTalkRes.finished()
    assert.equal(selfTalkRes.json().ok, true)

    const moodRoute = routes.find((route) => route.path === '/api/dsh-poetry/mood-ai.json')
    const moodRes = new MockResponse()
    await moodRoute.handler(mockRequest({ url: '/api/dsh-poetry/mood-ai.json?force=1' }), moodRes)
    await moodRes.finished()
    assert.equal(moodRes.json().ok, true)

    const memoryDir = path.join(dshHome, 'agent-memory')
    const entries = readJournalJsonl(memoryDir)
    assert.deepEqual(entries.map((entry) => entry.kind), ['murmur', 'mood'])
    assert.equal(JSON.stringify(entries).includes(sensitive), false)
    const md = fs.readFileSync(path.join(memoryDir, 'journal.md'), 'utf8')
    assert.match(md, /## \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 碎碎念/)
    assert.match(md, /· 心情/)
    assert.equal(md.includes(sensitive), false)

    for (const cleanup of cleanups.reverse()) {
      if (typeof cleanup === 'function') cleanup()
    }
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  }
})

// ---------------------------------------------------------------------------
// 飞花令全量校验句库（契约 v1.11 §2.14）
// ---------------------------------------------------------------------------

function writeFeihuaShard(dir, char, entries) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${char}.json`), JSON.stringify({ ok: true, v: 1, char, entries }), 'utf8')
}

test('feihua-full：resolveFeihuaFullDir（env 覆盖/默认项目同级 _ref）', () => {
  assert.equal(resolveFeihuaFullDir({ DSH_POETRY_FULL_INDEX: '/tmp/full-index' }, '/pkg/app'), '/tmp/full-index')
  assert.equal(resolveFeihuaFullDir({}, '/a/b/dsh-little-whale'), '/a/b/_ref/feihua-full')
  assert.equal(resolveFeihuaFullDir({ DSH_POETRY_FULL_INDEX: '   ' }, '/a/b/pkg'), '/a/b/_ref/feihua-full')
  assert.equal(resolveFeihuaFullDir({ DSH_POETRY_FULL_INDEX: '  /tmp/x  ' }, '/pkg'), '/tmp/x')
})

test('feihua-full：isValidFeihuaChar 单字校验（多字/标点/字母/emoji 拒绝）', () => {
  for (const char of ['花', '月', '龍', '不']) assert.equal(isValidFeihuaChar(char), true, char)
  for (const char of ['花朵', 'a', '1', '', ' ', '，', '🌙', '花月', null, undefined, 123]) {
    assert.equal(isValidFeihuaChar(char), false, String(char))
  }
})

test('feihua-full：读取合法分片并透传 entries/count，第二次命中缓存', async () => {
  const dir = makeTmpDir('dshp-feihua')
  const entries = [
    ['春风得意马蹄疾，一日看尽长安花。', '孟郊《登科后》'],
    ['花间一壶酒，独酌无相亲。', '李白《月下独酌》'],
  ]
  writeFeihuaShard(dir, '花', entries)
  const service = createFeihuaFullService({ dir, logger: { warn() {} } })

  const first = await service.load('花')
  assert.equal(first.ok, true)
  assert.equal(first.char, '花')
  assert.equal(first.count, 2)
  assert.deepEqual(first.entries, entries)
  assert.equal(first.cached, false)

  const second = await service.load('花')
  assert.equal(second.ok, true)
  assert.equal(second.cached, true)
  assert.deepEqual(second.entries, entries)
  assert.equal(service.cacheSize(), 1)
})

test('feihua-full：缓存命中不重复读盘；文件改动后仍返回缓存（clearCache 后可重读）', async () => {
  const dir = makeTmpDir('dshp-feihua')
  writeFeihuaShard(dir, '月', [['月落乌啼霜满天，江枫渔火对愁眠。', '张继《枫桥夜泊》']])
  let reads = 0
  const service = createFeihuaFullService({
    dir,
    logger: { warn() {} },
    readFile: async (file) => {
      reads += 1
      return fs.readFileSync(file, 'utf8')
    },
  })
  await service.load('月')
  assert.equal(reads, 1)
  // 磁盘改动后仍命中缓存
  writeFeihuaShard(dir, '月', [['改动后的句子，不应该被立刻读到。', '某出处']])
  const cached = await service.load('月')
  assert.equal(reads, 1, '缓存命中不重复读盘')
  assert.equal(cached.entries[0][0], '月落乌啼霜满天，江枫渔火对愁眠。')
  service.clearCache()
  const fresh = await service.load('月')
  assert.equal(reads, 2)
  assert.equal(fresh.entries[0][0], '改动后的句子，不应该被立刻读到。')
})

test('feihua-full：LRU 最多 4 个令字，淘汰最旧', async () => {
  const dir = makeTmpDir('dshp-feihua')
  for (const char of ['花', '月', '风', '春', '山']) {
    writeFeihuaShard(dir, char, [[`${char}字开头的测试句子，够长了吧。`, '测试《出处》']])
  }
  let reads = 0
  const service = createFeihuaFullService({
    dir,
    logger: { warn() {} },
    maxChars: 4,
    readFile: async (file) => {
      reads += 1
      return fs.readFileSync(file, 'utf8')
    },
  })
  for (const char of ['花', '月', '风', '春']) await service.load(char)
  assert.deepEqual(service.cacheKeys(), ['花', '月', '风', '春'])
  await service.load('山') // 触发淘汰
  assert.equal(service.cacheSize(), 4)
  assert.deepEqual(service.cacheKeys(), ['月', '风', '春', '山'], '淘汰最旧的花')
  const before = reads
  await service.load('花') // 已被淘汰 → 重新读盘
  assert.equal(reads, before + 1)
  assert.deepEqual(service.cacheKeys(), ['风', '春', '山', '花'])
})

test('feihua-full：缺目录/缺文件/坏 JSON/形状不符/空 entries → UNAVAILABLE（不抛）', async () => {
  const missingDirService = createFeihuaFullService({ dir: path.join(makeTmpDir('dshp-feihua'), 'nope'), logger: { warn() {} } })
  const missingDir = await missingDirService.load('花')
  assert.equal(missingDir.ok, false)
  assert.equal(missingDir.error.code, 'FEIHUA_FULL_UNAVAILABLE')

  const dir = makeTmpDir('dshp-feihua')
  const service = createFeihuaFullService({ dir, logger: { warn() {} } })
  const missingFile = await service.load('花')
  assert.equal(missingFile.ok, false)
  assert.match(missingFile.error.message, /不存在/)

  fs.writeFileSync(path.join(dir, '风.json'), 'not json at all', 'utf8')
  const badJson = await service.load('风')
  assert.equal(badJson.ok, false)
  assert.match(badJson.error.message, /损坏/)

  fs.writeFileSync(path.join(dir, '春.json'), JSON.stringify({ ok: true, v: 2, char: '春', entries: [] }), 'utf8')
  assert.equal((await service.load('春')).ok, false, 'v 必须为 1')

  fs.writeFileSync(path.join(dir, '山.json'), JSON.stringify({ ok: true, v: 1, char: '山', entries: 'nope' }), 'utf8')
  assert.equal((await service.load('山')).ok, false, 'entries 必须是数组')

  writeFeihuaShard(dir, '水', [])
  const empty = await service.load('水')
  assert.equal(empty.ok, false)
  assert.match(empty.error.message, /没有可用句子/)

  // 非法条目逐条过滤（必须是 [text,source] 二元组且句子非空）；只剩合法句子时仍可用
  writeFeihuaShard(dir, '云', [
    ['', '出处'],
    ['云想衣裳花想容，春风拂槛露华浓。', '李白《清平调》'],
    { foo: 1 },
    ['只有句子没出处'],
    ['第二条合法句子，也够长了。', '测试《出处》'],
  ])
  const filtered = await service.load('云')
  assert.equal(filtered.ok, true)
  assert.equal(filtered.count, 2)
  assert.deepEqual(filtered.entries, [
    ['云想衣裳花想容，春风拂槛露华浓。', '李白《清平调》'],
    ['第二条合法句子，也够长了。', '测试《出处》'],
  ])
})

test('feihua-full：非法令字直接拒绝，不读盘/不越界', async () => {
  const dir = makeTmpDir('dshp-feihua')
  writeFeihuaShard(dir, '花', [['花间一壶酒，独酌无相亲。', '李白《月下独酌》']])
  let reads = 0
  const service = createFeihuaFullService({
    dir,
    logger: { warn() {} },
    readFile: async (file) => {
      reads += 1
      return fs.readFileSync(file, 'utf8')
    },
  })
  for (const bad of ['花朵', 'abc', '', '  ', '，', '🌙', '花/../花', '../花']) {
    const result = await service.load(bad)
    assert.equal(result.ok, false, bad)
    assert.equal(result.error.code, 'FEIHUA_FULL_UNAVAILABLE')
  }
  assert.equal(reads, 0, '非法令字不应触发任何读盘')
  // 前后空白 trim 后合法
  const trimmed = await service.load('  花  ')
  assert.equal(trimmed.ok, true)
  assert.equal(trimmed.char, '花')
})

test('feihua-full：并发同一令字只读一次盘（in-flight 去重）', async () => {
  const dir = makeTmpDir('dshp-feihua')
  writeFeihuaShard(dir, '花', [['花间一壶酒，独酌无相亲。', '李白《月下独酌》']])
  let reads = 0
  const service = createFeihuaFullService({
    dir,
    logger: { warn() {} },
    readFile: async (file) => {
      reads += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return fs.readFileSync(file, 'utf8')
    },
  })
  const [a, b] = await Promise.all([service.load('花'), service.load('花')])
  assert.equal(reads, 1, '并发只读一次盘')
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.deepEqual([a.cached, b.cached].sort(), [false, true])
})

test('feihua-full 路由：成功/query 解码/cached/非法令字/栅栏', async () => {
  const dir = makeTmpDir('dshp-feihua')
  const entries = Array.from({ length: 3 }, (_, index) => [`花字第${index}句测试，春风吹又生。`, '测试《出处》'])
  writeFeihuaShard(dir, '花', entries)
  const service = createFeihuaFullService({ dir, logger: { warn() {} } })
  const harness = createHarness({ feihuaFullService: service })

  const url = `/api/dsh-poetry/feihua-full.json?char=${encodeURIComponent('花')}`
  const first = await harness.call('feihua-full.json', mockRequest({ url }))
  assert.equal(first.statusCode, 200)
  const body = first.json()
  assert.equal(body.ok, true)
  assert.equal(body.char, '花')
  assert.equal(body.count, entries.length)
  assert.deepEqual(body.entries, entries)
  assert.equal(body.cached, false)

  const second = await harness.call('feihua-full.json', mockRequest({ url }))
  assert.equal(second.json().ok, true)
  assert.equal(second.json().cached, true)

  // 已解码的裸中文 query 也可以
  const rawCharUrl = '/api/dsh-poetry/feihua-full.json?char=花'
  assert.equal((await harness.call('feihua-full.json', mockRequest({ url: rawCharUrl }))).json().char, '花')

  for (const bad of ['abc', '花朵', '']) {
    const response = await harness.call(
      'feihua-full.json',
      mockRequest({ url: `/api/dsh-poetry/feihua-full.json?char=${encodeURIComponent(bad)}` }),
    )
    assert.equal(response.statusCode, 200, bad)
    const result = response.json()
    assert.equal(result.ok, false, bad)
    assert.equal(result.error.code, 'FEIHUA_FULL_UNAVAILABLE', bad)
  }
  const noChar = await harness.call('feihua-full.json', mockRequest({ url: '/api/dsh-poetry/feihua-full.json' }))
  assert.equal(noChar.statusCode, 200)
  assert.equal(noChar.json().ok, false)

  // 信任栅栏
  const crossed = await harness.call(
    'feihua-full.json',
    mockRequest({ url, headers: { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' } }),
  )
  assert.equal(crossed.statusCode, 403)
  assert.equal(crossed.json().error.code, 'FORBIDDEN')
  const evilHost = await harness.call('feihua-full.json', mockRequest({ url, headers: { host: 'evil.example' } }))
  assert.equal(evilHost.statusCode, 403)
})

test('feihua-full 路由：Accept-Encoding: gzip 时压缩大响应，无 gzip 时明文 JSON', async () => {
  const dir = makeTmpDir('dshp-feihua')
  const entries = Array.from({ length: 60 }, (_, index) => [
    `花字第${index}句测试句子，春风吹又生，野火烧不尽，为了触发 gzip 压缩阈值而写得长一点。`,
    '测试《出处》',
  ])
  writeFeihuaShard(dir, '花', entries)
  const service = createFeihuaFullService({ dir, logger: { warn() {} } })
  const harness = createHarness({ feihuaFullService: service })
  const url = `/api/dsh-poetry/feihua-full.json?char=${encodeURIComponent('花')}`

  const gzipped = await harness.call(
    'feihua-full.json',
    mockRequest({ url, headers: { host: '127.0.0.1:57623', 'accept-encoding': 'gzip, deflate' } }),
  )
  assert.equal(gzipped.statusCode, 200)
  assert.equal(gzipped.headers['Content-Encoding'], 'gzip')
  assert.equal(gzipped.headers['Vary'], 'Accept-Encoding')
  const decompressed = JSON.parse(gunzipSync(Buffer.concat(gzipped.chunks)).toString('utf8'))
  assert.equal(decompressed.ok, true)
  assert.equal(decompressed.char, '花')
  assert.equal(decompressed.count, entries.length)
  assert.deepEqual(decompressed.entries, entries)

  const plain = await harness.call('feihua-full.json', mockRequest({ url }))
  assert.equal(plain.headers['Content-Encoding'], undefined, '未声明 gzip 时保持明文')
  assert.equal(plain.json().ok, true)
})

test('feihua-full 路由：服务缺失/异常 → 200 + FEIHUA_FULL_UNAVAILABLE（不抛）', async () => {
  const noService = createHarness({ feihuaFullService: null })
  const noServiceResponse = await noService.call(
    'feihua-full.json',
    mockRequest({ url: '/api/dsh-poetry/feihua-full.json?char=花' }),
  )
  assert.equal(noServiceResponse.statusCode, 200)
  assert.equal(noServiceResponse.json().ok, false)
  assert.equal(noServiceResponse.json().error.code, 'FEIHUA_FULL_UNAVAILABLE')

  const throwing = createHarness({
    feihuaFullService: {
      load: async () => {
        throw new Error('boom')
      },
    },
  })
  const throwingResponse = await throwing.call(
    'feihua-full.json',
    mockRequest({ url: '/api/dsh-poetry/feihua-full.json?char=花' }),
  )
  assert.equal(throwingResponse.statusCode, 200)
  assert.equal(throwingResponse.json().ok, false)
  assert.equal(throwingResponse.json().error.code, 'FEIHUA_FULL_UNAVAILABLE')
})

// ---------------------------------------------------------------------------
// 心情动画素材（契约 v1.12 §2.15，dsh-pet MIT webm）
// ---------------------------------------------------------------------------

function writePetCatalog(dir, entries, extra = {}) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'catalog.json'),
    JSON.stringify({ ok: true, v: 1, source: 'PC2005-cloud/dsh-pet@MIT (webm animations)', entries, ...extra }),
    'utf8',
  )
}

const PET_VIDEO_FILE = 'webm/三球抛接.webm'
const PET_VIDEO_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88])

function writePetVideo(dir) {
  fs.mkdirSync(path.join(dir, 'webm'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'webm', '三球抛接.webm'), PET_VIDEO_BYTES)
}

test('pet-media：resolvePetMediaDir（env 覆盖/默认项目同级 _ref）', () => {
  assert.equal(resolvePetMediaDir({ DSH_PET_MEDIA_DIR: '/tmp/pet-media' }, '/pkg/app'), '/tmp/pet-media')
  assert.equal(resolvePetMediaDir({}, '/a/b/dsh-little-whale'), '/a/b/_ref/pet-media')
  assert.equal(resolvePetMediaDir({ DSH_PET_MEDIA_DIR: '   ' }, '/a/b/pkg'), '/a/b/_ref/pet-media')
  assert.equal(resolvePetMediaDir({ DSH_PET_MEDIA_DIR: '  /tmp/x  ' }, '/pkg'), '/tmp/x')
})

test('pet-media：isSafeWebmRelative 只接受 webm/<名>.webm', () => {
  assert.equal(isSafeWebmRelative(PET_VIDEO_FILE), true)
  assert.equal(isSafeWebmRelative('webm/a.webm'), true)
  for (const bad of ['', 'catalog.json', '../a.webm', '/abs/a.webm', 'webm\\a.webm', 'webm/a.js', 'webm/../a.webm', 'webm/', 'other/a.webm', 'webm/a.webm/../b.webm', 'webm/a./webm']) {
    assert.equal(isSafeWebmRelative(bad), false, bad)
  }
})

test('pet-media：loadPetMediaCatalog 合法/过滤非法条目/去重', () => {
  const dir = makeTmpDir('dshp-pet')
  writePetCatalog(dir, [
    { file: PET_VIDEO_FILE, label: '三球抛接', media: 'video', scope: 'mood', tags: ['game'] },
    { file: 'webm/下五子棋.webm', label: '下五子棋', media: 'video', tags: ['game', 'game', ''] },
    { file: PET_VIDEO_FILE, label: '重复文件', media: 'video', tags: ['dup'] },
    { file: '../evil.webm', label: '越界', media: 'video', tags: ['x'] },
    { file: 'webm/a.js', label: '非白名单', media: 'video', tags: ['x'] },
    { file: 'webm/缺标签.webm', label: '', media: 'video', tags: [] },
    { file: 'webm/错类型.webm', label: '错类型', media: 'image', tags: [] },
    { file: 'webm/缺tags.webm', label: '缺 tags', media: 'video' },
    { file: 'webm/坏tags.webm', label: '坏 tags', media: 'video', tags: 'game' },
    { file: 'webm/缺media.webm', label: '缺 media', tags: [] },
  ])
  const loaded = loadPetMediaCatalog({ dir, logger: { warn() {} } })
  assert.equal(loaded.ok, true, loaded.ok === false ? loaded.message : '')
  assert.equal(loaded.entries.length, 2, '合法 2 条 + 去重')
  assert.deepEqual(loaded.entries[0], {
    file: PET_VIDEO_FILE,
    label: '三球抛接',
    media: 'video',
    scope: 'mood',
    tags: ['game'],
  })
  assert.deepEqual(loaded.entries[1].tags, ['game'], 'tags 去重/去空')
  assert.equal(loaded.entries.some((entry) => entry.file === 'webm/错类型.webm'), false)
})

test('pet-media：loadPetMediaCatalog 缺目录/坏 JSON/格式不符/全非法 → ok:false 不抛', () => {
  const missing = loadPetMediaCatalog({ dir: path.join(makeTmpDir('dshp-pet'), 'nope'), logger: { warn() {} } })
  assert.equal(missing.ok, false)
  assert.match(missing.message, /不存在/)

  const badJsonDir = makeTmpDir('dshp-pet')
  fs.writeFileSync(path.join(badJsonDir, 'catalog.json'), 'not json', 'utf8')
  assert.equal(loadPetMediaCatalog({ dir: badJsonDir, logger: { warn() {} } }).ok, false)

  const badShapeDir = makeTmpDir('dshp-pet')
  fs.writeFileSync(path.join(badShapeDir, 'catalog.json'), JSON.stringify({ ok: true, v: 2, entries: [] }), 'utf8')
  assert.equal(loadPetMediaCatalog({ dir: badShapeDir, logger: { warn() {} } }).ok, false)

  const noEntriesDir = makeTmpDir('dshp-pet')
  fs.writeFileSync(path.join(noEntriesDir, 'catalog.json'), JSON.stringify({ ok: true, v: 1, entries: 'nope' }), 'utf8')
  assert.equal(loadPetMediaCatalog({ dir: noEntriesDir, logger: { warn() {} } }).ok, false)

  const allInvalidDir = makeTmpDir('dshp-pet')
  writePetCatalog(allInvalidDir, [{ file: '../x.webm', label: 'x', media: 'video', tags: [] }])
  const allInvalid = loadPetMediaCatalog({ dir: allInvalidDir, logger: { warn() {} } })
  assert.equal(allInvalid.ok, false)
  assert.match(allInvalid.message, /没有可用视频条目/)
})

test('pet-media：merge 追加视频/补 media:image/去重/保留 panel/不修改原对象', () => {
  const base = makeMoodCatalogFixture()
  const snapshot = JSON.stringify(base)
  const petEntries = [
    { file: PET_VIDEO_FILE, label: '三球抛接', media: 'video', scope: 'mood', tags: ['game'] },
    { file: 'dsh-whale-state-happy.webp', label: '重复静图', media: 'video', tags: ['dup'] },
    { file: 'webm/下五子棋.webm', label: '下五子棋', media: 'video', scope: 'mood', tags: ['game'] },
  ]
  const merged = mergePetMediaIntoMoodCatalog(base, petEntries)
  assert.notEqual(merged, base)
  assert.equal(JSON.stringify(base), snapshot, '原 catalog 不被修改')

  const baseCount = base.moodImages.length
  assert.equal(merged.moodImages.length, baseCount + 2, '重复 file 不追加')
  for (const image of merged.moodImages.slice(0, baseCount)) {
    assert.equal(image.media, 'image', '原有图片补 media:image')
  }
  const added = merged.moodImages.slice(baseCount)
  assert.deepEqual(added.map((image) => image.file), [PET_VIDEO_FILE, 'webm/下五子棋.webm'])
  for (const image of added) {
    assert.equal(image.media, 'video')
    assert.equal(image.scope, 'mood')
  }
  assert.equal(merged.files.has(PET_VIDEO_FILE), true)
  assert.equal(merged.files.has('dsh-whale-state-happy.webp'), true)
  assert.deepEqual(merged.panelImages, base.panelImages, '保留 panelImages')
  assert.equal(merged.panelImages !== base.panelImages, true, '不是同一个数组引用')

  // 无视频条目：浅拷贝，内容保持原样
  const copy = mergePetMediaIntoMoodCatalog(base, [])
  assert.notEqual(copy, base)
  assert.deepEqual(copy.moodImages, base.moodImages, '无条目时 moodImages 原样')
  assert.deepEqual(copy.panelImages, base.panelImages)
  assert.equal(JSON.stringify(base), snapshot)
})

test('pet-media handler：webm/catalog 200 + Content-Type/Content-Length/Cache-Control/HEAD', async () => {
  const dir = makeTmpDir('dshp-pet')
  writePetCatalog(dir, [{ file: PET_VIDEO_FILE, label: '三球抛接', media: 'video', tags: ['game'] }])
  writePetVideo(dir)
  const handler = createPetMediaHandler({ dir, logger: { warn() {} } })

  async function call({ method = 'GET', url }) {
    const response = new MockResponse()
    await handler(mockRequest({ method, url }), response)
    await response.finished()
    return response
  }

  const video = await call({ url: `${PET_MEDIA_ROUTE}?f=${encodeURIComponent(PET_VIDEO_FILE)}` })
  assert.equal(video.statusCode, 200)
  assert.equal(video.headers['Content-Type'], 'video/webm')
  assert.equal(video.headers['Content-Length'], String(PET_VIDEO_BYTES.length))
  assert.equal(video.headers['Cache-Control'], 'public, max-age=3600')
  assert.deepEqual(Buffer.concat(video.chunks), PET_VIDEO_BYTES)

  const catalog = await call({ url: `${PET_MEDIA_ROUTE}?f=catalog.json` })
  assert.equal(catalog.statusCode, 200)
  assert.equal(catalog.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(catalog.headers['Cache-Control'], 'public, max-age=3600')
  const parsed = catalog.json()
  assert.equal(parsed.ok, true)
  assert.equal(parsed.entries.length, 1)

  const head = await call({ method: 'HEAD', url: `${PET_MEDIA_ROUTE}?f=${encodeURIComponent(PET_VIDEO_FILE)}` })
  assert.equal(head.statusCode, 200)
  assert.equal(head.headers['Content-Length'], String(PET_VIDEO_BYTES.length))
  assert.equal(Buffer.concat(head.chunks).length, 0, 'HEAD 不返回 body')
})

test('pet-media handler：404（缺失/越界/非白名单）与 405，错误不泄漏', async () => {
  const dir = makeTmpDir('dshp-pet')
  writePetCatalog(dir, [{ file: PET_VIDEO_FILE, label: '三球抛接', media: 'video', tags: ['game'] }])
  writePetVideo(dir)
  fs.mkdirSync(path.join(dir, 'webm'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'webm', 'other.js'), 'console.log(1)', 'utf8')
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret', 'utf8')
  const handler = createPetMediaHandler({ dir, logger: { warn() {} } })

  async function call({ method = 'GET', url }) {
    const response = new MockResponse()
    await handler(mockRequest({ method, url }), response)
    await response.finished()
    return response
  }

  for (const f of [
    '',
    'webm/不存在.webm',
    '../secret.txt',
    '%2e%2e%2fsecret.txt',
    'webm%2F..%2Fsecret.txt',
    '/etc/passwd',
    'webm\\a.webm',
    'webm/other.js',
    'catalog.json/../catalog.json',
    'webm/a.webm%00.png',
    'ATTRIBUTION.md',
  ]) {
    const response = await call({ url: `${PET_MEDIA_ROUTE}?f=${f}` })
    assert.equal(response.statusCode, 404, `应 404: ${f}`)
    assert.equal(response.bodyText.includes('secret'), false, '不泄漏内容')
  }

  const wrongMethod = await call({ method: 'POST', url: `${PET_MEDIA_ROUTE}?f=catalog.json` })
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.headers.Allow, 'GET, HEAD')

  // 不套信任栅栏：没有任何 cookie/Host 校验也能读（只读、无用户数据）
  const unfenced = await call({ url: `${PET_MEDIA_ROUTE}?f=catalog.json` })
  assert.equal(unfenced.statusCode, 200)
})

test('pet-media：merge 后 mood-ai prompt 含 video 条目，parse 接受 video 文件', async () => {
  const base = makeMoodCatalogFixture()
  const merged = mergePetMediaIntoMoodCatalog(base, [
    { file: PET_VIDEO_FILE, label: '三球抛接', media: 'video', scope: 'mood', tags: ['game'] },
  ])
  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0), weather: 'clear' }, merged)
  assert.equal(prompt.includes(PET_VIDEO_FILE), true, 'prompt 图鉴里应含视频文件')
  assert.ok(prompt.includes(`${PET_VIDEO_FILE}｜三球抛接｜game｜video｜-`), '图鉴行含 video 条目与 media 列')
  assert.match(prompt, /media=video/, 'prompt 说明 media 语义')

  const parsed = parseMoodResult(
    JSON.stringify({ label: '在玩球', image: PET_VIDEO_FILE, reason: '今天想活动一下', energy: 60 }),
    merged,
    { dateKey: '2026-10-21' },
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.mood.image, PET_VIDEO_FILE)

  const unknownVideo = parseMoodResult(
    JSON.stringify({ label: '在玩球', image: 'webm/不存在.webm', reason: '理由', energy: 50 }),
    merged,
    { dateKey: '2026-10-21' },
  )
  assert.equal(unknownVideo.ok, false, '未在合并图鉴内的视频仍拒绝')

  // 服务层：mock llm 返回 video 文件 → 成功
  const { service } = makeMoodAiHarness({
    catalog: merged,
    responder: () => JSON.stringify({ label: '在玩球', image: PET_VIDEO_FILE, reason: '今天想活动一下', energy: 60 }),
  })
  const result = await service.generate({})
  assert.equal(result.ok, true)
  assert.equal(result.mood.image, PET_VIDEO_FILE)
  assert.equal(result.mood.label, '在玩球')
})

test('index.js：DSH_PET_MEDIA_DIR 注入 + pet-media 静态路由可用（临时目录，未栅栏）', async () => {
  const petDir = makeTmpDir('dshp-pet')
  writePetCatalog(petDir, [{ file: PET_VIDEO_FILE, label: '三球抛接', media: 'video', tags: ['game'] }])
  writePetVideo(petDir)
  const dshHome = makeTmpDir('dshp-dshhome')
  const previousPetDir = process.env.DSH_PET_MEDIA_DIR
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_PET_MEDIA_DIR = petDir
  process.env.DSH_HOME = dshHome
  try {
    const routes = []
    const cleanups = []
    const fakeCtx = {
      logger: { info() {}, warn() {}, error() {} },
      on() {
        return () => {}
      },
      effect(execute) {
        const disposer = execute()
        cleanups.push(disposer)
        return disposer
      },
      inject(_keys, callback) {
        callback({
          get(name) {
            if (name === 'webServer') {
              return {
                register(route) {
                  routes.push(route)
                  return () => {}
                },
              }
            }
            if (name === 'connection') return { requestRejection: () => undefined }
            return undefined
          },
          effect(execute) {
            const disposer = execute()
            cleanups.push(disposer)
            return disposer
          },
        })
      },
    }
    await pluginApply(fakeCtx)
    assert.equal(routes.length, 29, 'assets + pet-media + self + project-action + project-detail + works + works-media + manual-read + presence + twin + chat + attention + memory + model-errors + graph + graph-view + 13 条 JSON')
    const petRoute = routes.find((route) => route.path === PET_MEDIA_ROUTE)
    assert.ok(petRoute, '注册了 pet-media 路由')

    const catalogResponse = new MockResponse()
    await petRoute.handler(mockRequest({ url: `${PET_MEDIA_ROUTE}?f=catalog.json` }), catalogResponse)
    await catalogResponse.finished()
    assert.equal(catalogResponse.statusCode, 200)
    assert.equal(catalogResponse.json().entries.length, 1)

    const videoResponse = new MockResponse()
    await petRoute.handler(
      mockRequest({ url: `${PET_MEDIA_ROUTE}?f=${encodeURIComponent(PET_VIDEO_FILE)}` }),
      videoResponse,
    )
    await videoResponse.finished()
    assert.equal(videoResponse.statusCode, 200)
    assert.equal(videoResponse.headers['Content-Type'], 'video/webm')

    for (const cleanup of cleanups.reverse()) {
      if (typeof cleanup === 'function') cleanup()
    }
  } finally {
    if (previousPetDir === undefined) delete process.env.DSH_PET_MEDIA_DIR
    else process.env.DSH_PET_MEDIA_DIR = previousPetDir
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  }
})

