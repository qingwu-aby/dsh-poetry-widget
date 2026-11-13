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
import { createAssetHandler, resolveAssetPath } from '../../lib/domain/integration/assets.mjs'
import { createDataStore, pickPoemIndex } from '../../lib/domain/memory/data-store.mjs'
import { formatLocalDate, maskPath, readPackageMeta } from '../../lib/kernel/paths.mjs'
import { createRouteTable } from '../../lib/domain/integration/routes.mjs'
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  normalizeSettings,
  resolveSettingsPath,
  validateSettingsPatch,
} from '../../lib/kernel/settings-store.mjs'
import { createTrustFence, isLoopbackHostname } from '../../lib/domain/integration/trust.mjs'
import {
  DEFAULT_CITY as WEATHER_DEFAULT_CITY,
  createWeatherService,
  mapWeather,
  normalizeCity,
} from '../../lib/domain/life/weather.mjs'
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
} from '../../lib/domain/emotion/mood.mjs'
import {
  EXPERIENCE_EMOTION_LABELS,
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_MAX_AGE_MS,
  readExperience,
  resolveExperiencePath,
} from '../../lib/domain/learning/experience.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  isSafeWebmRelative,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  resolvePetMediaDir,
} from '../../lib/domain/works/pet-media.mjs'
import {
  createFeihuaFullService,
  isValidFeihuaChar,
  resolveFeihuaFullDir,
} from '../../lib/domain/works/feihua-full.mjs'
import {
  JOURNAL_MURMUR_MIN_INTERVAL_MS,
  MEMORY_JOURNAL_HEADER,
  createMemoryJournal,
  formatJournalTime,
  resolveMemoryDir,
} from '../../lib/domain/memory/memory-journal.mjs'
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
} from '../../lib/domain/emotion/mood-ai.mjs'
import {
  MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_DSH_OPENCODE_PROVIDER,
} from '../../lib/kernel/model-policy.mjs'
import {
  MODEL_ERRORS_MAX_LINES,
  MODEL_ERRORS_MESSAGE_MAX,
  MODEL_ERRORS_ROUTE,
  appendModelError,
  buildModelErrorRecord,
  createModelErrorsHandler,
  readModelErrors,
  resolveModelErrorsPath,
} from '../../lib/kernel/model-errors.mjs'
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
} from '../../lib/kernel/model-policy.mjs'
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
} from '../../lib/domain/voice/voice-memory.mjs'
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
} from '../../lib/domain/memory/memory-recall.mjs'
import {
  MEMORY_BACKUP_INTERVAL_MS,
  MEMORY_BACKUP_MAX,
  MEMORY_BACKUP_ROUTE,
  MEMORY_ROUTE,
  createMemoryBackupHandler,
  createMemoryHub,
  createMemorySnapshotHandler,
  resolveMemoryHubPaths,
} from '../../lib/domain/memory/memory-hub.mjs'
import {
  SELF_DRIVE_ACTIONS,
  buildSelfDrivePrompt,
  createSelfDrive,
  parseSelfDriveResult,
} from '../../lib/domain/being/self-drive.mjs'
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
} from '../../lib/domain/being/self-being.mjs'
import {
  FEELING_DESC_MAX,
  FEELING_NAME_MAX,
  appendFeeling,
  loadFeelingBank,
  normalizeFeeling,
  parseNewFeeling,
  readFeelingFile,
  resolveFeelingsPath,
} from '../../lib/domain/emotion/feelings.mjs'
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
} from '../../lib/domain/learning/self-growth.mjs'
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
} from '../../lib/domain/learning/self-wander.mjs'
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
} from '../../lib/domain/learning/self-reading.mjs'
import { runMemoryMigrations } from '../../lib/domain/memory/memory-migrations.mjs'
import { createDshHost } from '../../lib/domain/host/dsh-host.mjs'
import { createSelfProjects, projectCanRetry, projectProgressAt, projectStage } from '../../lib/domain/being/self-projects.mjs'
import { createGuiInbox, pushGuiInbox, readGuiInbox, GUI_INBOX_MAX } from '../../lib/domain/chat/gui-inbox.mjs'
import { normalizeVideoCourse, readVideoCourses, readVideoCoursesShelf } from '../../lib/domain/learning/video-courses.mjs'
import { createSelfEvents } from '../../lib/domain/being/self-events.mjs'
import { createMetabolism } from '../../lib/domain/being/self-metabolism.mjs'
import { createWorldFeedback } from '../../lib/domain/learning/world-feedback.mjs'
import { PRESENCE_ROUTE, createPresenceHandler } from '../../lib/domain/being/presence.mjs'
import { createChatBridge } from '../../lib/domain/chat/chat-bridge.mjs'
import { createCurriculum } from '../../lib/domain/learning/self-curriculum.mjs'
import { createMediaBudget } from '../../lib/domain/works/media-budget.mjs'
import { createAttentionStore } from '../../lib/domain/relationship/attention.mjs'
import { createOutbox } from '../../lib/domain/chat/outbox.mjs'
import { constitutionLines, PROMPT_LAYERS_VERSION } from '../../lib/domain/voice/prompt-layers.mjs'
import { fetchShugeEntry, searchShuge } from '../../lib/domain/learning/shuge.mjs'
import { createLifecycle } from '../../lib/domain/being/self-lifecycle.mjs'
import { createTwinBridge } from '../../lib/domain/twin/twin-bridge.mjs'
import { createTwinResearch } from '../../lib/domain/twin/twin-research.mjs'
import { createGrowthMetrics } from '../../lib/domain/being/growth-metrics.mjs'
import { createSelfWorks, createWorksHandler, sanitizeWorkSvg } from '../../lib/domain/works/self-works.mjs'
import { createManualReadHandler, createManualReading, ensureManualToken } from '../../lib/domain/learning/manual-reading.mjs'
import { seedMemoryBaseline } from '../../lib/domain/memory/memory-baseline.mjs'
import { createHeartbeat } from '../../lib/domain/host/heartbeat.mjs'
import { createModelBudget, createModelGate } from '../../lib/domain/host/model-budget.mjs'
import { createDeepSeekWeb } from '../../lib/domain/integration/deepseek-web.mjs'
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
} from '../../lib/domain/integration/safe-web.mjs'
import { callModelForRole, configureModelRuntime, resetModelRuntime } from '../../lib/kernel/llm-call.mjs'
import {
  buildConsolidationPrompt,
  countJournalEntries,
  createMemoryConsolidator,
  createMemoryLayers,
  parseConsolidationResult,
  readMemoryLayers,
  resolveMemoryLayersPath,
} from '../../lib/domain/memory/memory-layers.mjs'
import {
  SELF_NETLANG_GAP_MS,
  SELF_NETLANG_SOURCES,
  buildNetlangPrompt,
  createSelfNetlang,
  fetchNetlangTitles,
  parseGithubTrendingHtml,
  parseNetlangPayload,
  parseNetlangResult,
} from '../../lib/domain/learning/self-netlang.mjs'
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
} from '../../lib/domain/being/self-actions.mjs'
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
} from '../../lib/domain/being/self-state.mjs'
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
} from '../../lib/domain/learning/self-talk-topics.mjs'
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
} from '../../lib/domain/chat/self-talk.mjs'

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

test('mood：applySessionEvent 计数 / 活跃时长 / 会话去重 / 防御性', () => {
  let state = createEmptyMoodState('2026-10-21')
  const apply = (type, time, data, sessionId = 's1') => {
    state = applySessionEvent(state, moodEvent(type, time, data), { sessionId, now: () => time })
  }
  const view = () => toMoodResponse(state)

  apply('user/message', MOOD_T0)
  let snapshot = view()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.date, '2026-10-21')
  assert.equal(snapshot.updatedAt, MOOD_T0)
  assert.deepEqual(Object.keys(snapshot.stats).sort(), [...MOOD_STAT_KEYS].sort())
  for (const key of MOOD_STAT_KEYS) assert.equal(typeof snapshot.stats[key], 'number', key)
  assert.equal(snapshot.stats.userMessages, 1)
  assert.equal(snapshot.stats.sessions, 1)
  assert.equal(snapshot.stats.firstActivityAt, MOOD_T0)
  assert.equal(snapshot.stats.lastActivityAt, MOOD_T0)
  assert.equal(snapshot.stats.activeMs, 0)

  apply('assistant/message', MOOD_T0 + 30_000)
  apply('tool/call', MOOD_T0 + 60_000)
  apply('tool/result', MOOD_T0 + 90_000, {})
  assert.equal(view().stats.toolErrors, 0, '成功的 tool/result 不计错误')
  apply('tool/result', MOOD_T0 + 90_000, { error: { message: 'boom' } })
  assert.equal(view().stats.toolErrors, 1)
  apply('tool/result', MOOD_T0 + 120_000, { message: { isError: true } })
  assert.equal(view().stats.toolErrors, 2, '兼容 message.isError 标记')

  apply('turn/start', MOOD_T0 + 150_000)
  apply('turn/end', MOOD_T0 + 180_000, { reason: { kind: 'completed' } })
  apply('turn/end', MOOD_T0 + 210_000, { reason: { kind: 'error' } })
  apply('turn/end', MOOD_T0 + 240_000, { reason: { kind: 'aborted' } })
  apply('turn/end', MOOD_T0 + 270_000, { reason: { kind: 'blocked' } })
  snapshot = view()
  assert.equal(snapshot.stats.assistantMessages, 1)
  assert.equal(snapshot.stats.toolCalls, 1)
  assert.equal(snapshot.stats.turns, 1)
  assert.equal(snapshot.stats.turnsCompleted, 1)
  assert.equal(snapshot.stats.turnsErrored, 2, 'error/aborted 计为出错，blocked 不计')
  assert.equal(snapshot.stats.activeMs, 270_000, '相邻事件 30s 间隔累加')
  assert.equal(snapshot.stats.sessions, 1, '同一 session 只计一次')

  // 第二个会话去重计数
  apply('user/message', MOOD_T0 + 300_000, {}, 's2')
  snapshot = view()
  assert.equal(snapshot.stats.userMessages, 2)
  assert.equal(snapshot.stats.sessions, 2)
  assert.equal(snapshot.stats.activeMs, 300_000)

  // 单段上限 10min：空闲 20min 只累计 10min
  apply('user/message', MOOD_T0 + 300_000 + 20 * 60_000, {}, 's2')
  snapshot = view()
  assert.equal(snapshot.stats.activeMs, 300_000 + MAX_ACTIVE_GAP_MS)
  assert.equal(snapshot.stats.userMessages, 3)

  // 时钟回拨：不减活跃时长、不倒退 lastActivityAt
  const lastActivityAt = snapshot.stats.lastActivityAt
  apply('user/message', MOOD_T0, {}, 's2')
  snapshot = view()
  assert.equal(snapshot.stats.activeMs, 300_000 + MAX_ACTIVE_GAP_MS, '负间隔不扣减')
  assert.equal(snapshot.stats.lastActivityAt, lastActivityAt, 'lastActivityAt 取更大值')
  assert.equal(snapshot.stats.firstActivityAt, MOOD_T0, 'firstActivityAt 保持当日首个事件')

  // 未知事件类型完全忽略（不计数、不推进活跃时长）
  const beforeUnknown = JSON.stringify(state)
  state = applySessionEvent(state, moodEvent('step/end', MOOD_T0 + 999_000, {}), { sessionId: 's9', now: () => MOOD_T0 + 999_000 })
  assert.equal(JSON.stringify(state), beforeUnknown, '未知 type 不改变状态')
  assert.equal(applySessionEvent(state, null), state)
  assert.equal(applySessionEvent(state, {}), state)
  assert.equal(applySessionEvent(state, undefined), state)

  // 畸形事件：不抛异常；缺 data 时能计数的照常计数
  const malformed = applySessionEvent(state, { type: 'user/message' }, { sessionId: 's3', now: () => MOOD_T0 + 999_000 })
  assert.equal(malformed.stats.userMessages, 5, '此前已累计 4 条 user/message')
  assert.equal(applySessionEvent(null, moodEvent('user/message', 1)), null)

  // 纯函数：不修改入参
  const frozenBefore = JSON.stringify(malformed)
  applySessionEvent(malformed, moodEvent('tool/call', MOOD_T0 + 1_000_000), { sessionId: 's3', now: () => MOOD_T0 + 1_000_000 })
  assert.equal(JSON.stringify(malformed), frozenBefore, 'applySessionEvent 不修改入参')
})

test('mood：跨本地日重置（保留 lastActivityAt，其余归零）', () => {
  const file = path.join(makeTmpDir('dshp-mood'), 'mood.json')
  let clock = new Date(2026, 9, 21, 23, 50, 0).getTime()
  const tracker = createMoodTracker({ file, now: () => clock, persistDebounceMs: 0 })

  tracker.record({ id: 's1' }, moodEvent('user/message', clock))
  tracker.record({ id: 's1' }, moodEvent('tool/call', clock + 1_000))
  let snapshot = tracker.getToday()
  assert.equal(snapshot.date, '2026-10-21')
  assert.equal(snapshot.stats.userMessages, 1)
  assert.equal(snapshot.stats.toolCalls, 1)
  assert.equal(snapshot.stats.activeMs, 1_000)
  const lastActivityAt = snapshot.stats.lastActivityAt

  // 跨日读取：计数/首活/会话归零，仅保留 lastActivityAt
  clock = new Date(2026, 9, 22, 8, 0, 0).getTime()
  snapshot = tracker.getToday()
  assert.equal(snapshot.date, '2026-10-22')
  assert.equal(snapshot.stats.lastActivityAt, lastActivityAt, '跨日保留 lastActivityAt')
  assert.equal(snapshot.stats.firstActivityAt, 0)
  assert.equal(snapshot.stats.sessions, 0)
  assert.equal(snapshot.stats.activeMs, 0)
  assert.equal(snapshot.stats.userMessages, 0)
  assert.equal(snapshot.updatedAt, 0)

  // 跨日后第一条事件：不把夜间空闲算进 activeMs
  tracker.record({ id: 's2' }, moodEvent('user/message', clock))
  snapshot = tracker.getToday()
  assert.equal(snapshot.stats.activeMs, 0)
  assert.equal(snapshot.stats.userMessages, 1)
  assert.equal(snapshot.stats.sessions, 1)
  assert.equal(snapshot.stats.firstActivityAt, clock)

  // 读取时落盘：文件 date 已滚动
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(onDisk.date, '2026-10-22')
  tracker.dispose()
})

test('mood：加载昨日 mood.json 时跨日重置并回写新日期', () => {
  const dir = makeTmpDir('dshp-mood')
  const file = path.join(dir, 'mood.json')
  const oldLastActivityAt = new Date(2026, 9, 20, 22, 0, 0).getTime()
  writeJson(file, {
    schemaVersion: 1,
    date: '2026-10-20',
    stats: { ...emptyStatsForTest(), userMessages: 5, toolCalls: 9, lastActivityAt: oldLastActivityAt },
    sessionKeys: ['0123456789abcdef'],
    lastEventAt: oldLastActivityAt,
    updatedAt: oldLastActivityAt,
  })
  const tracker = createMoodTracker({
    file,
    now: () => new Date(2026, 9, 21, 9, 0, 0).getTime(),
    persistDebounceMs: 60_000,
  })
  const snapshot = tracker.getToday()
  assert.equal(snapshot.date, '2026-10-21')
  assert.equal(snapshot.stats.userMessages, 0)
  assert.equal(snapshot.stats.lastActivityAt, oldLastActivityAt, '跨日加载保留 lastActivityAt')
  assert.equal(snapshot.stats.sessions, 0)
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(onDisk.date, '2026-10-21', '读取时回写新日期')
  assert.equal(onDisk.stats.lastActivityAt, oldLastActivityAt)
  tracker.dispose()
})

test('mood：损坏文件备份 .bak 并回退零值（永不抛异常）', () => {
  const dir = makeTmpDir('dshp-mood')
  const file = path.join(dir, 'mood.json')
  fs.mkdirSync(dir, { recursive: true })
  const corrupt = '{"stats": '
  fs.writeFileSync(file, corrupt, 'utf8')
  const tracker = createMoodTracker({ file, now: () => new Date(2026, 9, 21, 12, 0, 0).getTime(), persistDebounceMs: 0 })
  const snapshot = tracker.getToday()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.date, '2026-10-21')
  for (const key of MOOD_STAT_KEYS) assert.equal(snapshot.stats[key], 0, key)
  assert.equal(snapshot.updatedAt, 0)
  assert.equal(fs.existsSync(`${file}.bak`), true, '损坏文件已备份')
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), corrupt)
  tracker.dispose()

  // 合法 JSON 但形状不符 → 零值，不崩溃
  const file2 = path.join(makeTmpDir('dshp-mood'), 'mood.json')
  writeJson(file2, [1, 2, 3])
  const tracker2 = createMoodTracker({ file: file2, now: () => new Date(2026, 9, 21, 12, 0, 0).getTime(), persistDebounceMs: 0 })
  assert.equal(tracker2.getToday().stats.userMessages, 0)
  tracker2.dispose()
})

test('mood：事件防抖落盘与读取时落盘', async () => {
  const clock = new Date(2026, 9, 21, 12, 0, 0).getTime()

  // 防抖：事件后不立刻写，到期后写
  const file = path.join(makeTmpDir('dshp-mood'), 'mood.json')
  const tracker = createMoodTracker({ file, now: () => clock, persistDebounceMs: 40 })
  tracker.record({ id: 's1' }, moodEvent('user/message', clock))
  assert.equal(fs.existsSync(file), false, '防抖期内不落盘')
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(fs.existsSync(file), true, '防抖到期后落盘')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).stats.userMessages, 1)
  tracker.dispose()

  // 同一天内宿主重载（重新创建 tracker）→ 从文件恢复累计值
  const reloaded = createMoodTracker({ file, now: () => clock, persistDebounceMs: 0 })
  const reloadedSnapshot = reloaded.getToday()
  assert.equal(reloadedSnapshot.stats.userMessages, 1, '重载后恢复计数')
  assert.equal(reloadedSnapshot.stats.sessions, 1, '重载后恢复会话去重')
  reloaded.dispose()

  // 路由读取时落盘（长防抖也立即写）
  const file2 = path.join(makeTmpDir('dshp-mood'), 'mood.json')
  const tracker2 = createMoodTracker({ file: file2, now: () => clock, persistDebounceMs: 60_000 })
  tracker2.record({ id: 's1' }, moodEvent('tool/call', clock + 1_000))
  assert.equal(fs.existsSync(file2), false)
  tracker2.getToday()
  assert.equal(fs.existsSync(file2), true, '读取时落盘')
  assert.equal(JSON.parse(fs.readFileSync(file2, 'utf8')).stats.toolCalls, 1)
  tracker2.dispose()

  // 卸载（dispose）落盘未保存数据
  const file3 = path.join(makeTmpDir('dshp-mood'), 'mood.json')
  const tracker3 = createMoodTracker({ file: file3, now: () => clock, persistDebounceMs: 60_000 })
  tracker3.record({ id: 's1' }, moodEvent('assistant/message', clock + 2_000))
  assert.equal(fs.existsSync(file3), false)
  tracker3.dispose()
  assert.equal(fs.existsSync(file3), true, 'dispose 落盘')
  assert.equal(JSON.parse(fs.readFileSync(file3, 'utf8')).stats.assistantMessages, 1)
})

test('v1.58：mood.json 会话统计接口已移除（路由表不再注册）', () => {
  const dataDir = makeTmpDir('dshp-data')
  writeFixtureData(dataDir)
  const home = makeTmpDir('dshp-home')
  const settingsFile = path.join(home, '.dsh', '.dsh-poetry', 'settings.json')
  const routes = createRouteTable({
    dataStore: createDataStore({ dataDir }),
    settingsStore: createSettingsStore({ file: settingsFile }),
    fence: createTrustFence({ getConnection: () => undefined }),
    version: '0.1.0',
    settingsFile,
  })
  assert.equal(
    routes.some((route) => route.path === '/api/dsh-poetry/mood.json'),
    false,
    '插件不再提供会话活跃统计接口',
  )
})

test('settings：mood/spontaneousPoem 默认值与校验', async () => {
  assert.equal(DEFAULT_SETTINGS.mood, true)
  assert.equal(DEFAULT_SETTINGS.spontaneousPoem, true)
  assert.deepEqual(validateSettingsPatch({ mood: false, spontaneousPoem: false }), {
    ok: true,
    patch: { mood: false, spontaneousPoem: false },
  })
  assert.deepEqual(validateSettingsPatch({ mood: 'no' }).fields, ['mood'])
  assert.deepEqual(validateSettingsPatch({ spontaneousPoem: 1 }).fields, ['spontaneousPoem'])
  assert.equal(normalizeSettings({ mood: false }).mood, false)
  assert.equal(normalizeSettings({ spontaneousPoem: 'x' }).spontaneousPoem, true, '非法值回退默认')

  const harness = createHarness()
  const put = await harness.call(
    'settings.json',
    mockRequest({ method: 'PUT', body: JSON.stringify({ mood: false, spontaneousPoem: false }) }),
  )
  assert.equal(put.statusCode, 200)
  assert.equal(put.json().settings.mood, false)
  assert.equal(put.json().settings.spontaneousPoem, false)
  const onDisk = JSON.parse(fs.readFileSync(harness.settingsFile, 'utf8'))
  assert.equal(onDisk.mood, false)
  assert.equal(onDisk.spontaneousPoem, false)
  assert.equal((await harness.call('settings.json', mockRequest())).json().settings.mood, false)

  const bad = await harness.call('settings.json', mockRequest({ method: 'PUT', body: JSON.stringify({ mood: 'yes' }) }))
  assert.equal(bad.statusCode, 400)
  assert.deepEqual(bad.json().error.fields, ['mood'])

  // 旧版 settings.json（无 mood/spontaneousPoem 字段）→ GET 补默认值，不报错
  const legacyFile = path.join(makeTmpDir('dshp-settings'), '.dsh-poetry', 'settings.json')
  writeJson(legacyFile, { schemaVersion: 1, scale: 1.1, showTones: false, mode: 'daily' })
  const legacy = createSettingsStore({ file: legacyFile })
  const legacySettings = legacy.get()
  assert.equal(legacySettings.mood, true)
  assert.equal(legacySettings.spontaneousPoem, true)
  assert.equal(legacySettings.scale, 1.1, '旧字段保留')
})

test('index.js：注册 session/event 监听、mood 路由可读、卸载时落盘', async () => {
  const dshHome = makeTmpDir('dshp-dshhome')
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const listeners = new Map()
    const cleanups = []
    const routes = []
    const fakeCtx = {
      logger: { info() {}, warn() {}, error() {} },
      on(event, callback) {
        listeners.set(event, callback)
        return () => listeners.delete(event)
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

    // v1.58：不再监听会话事件；如果旧版 mood.json 存在，应改名 .retired 而不是继续使用。
    fs.mkdirSync(path.join(dshHome, '.dsh-poetry'), { recursive: true })
    fs.writeFileSync(path.join(dshHome, '.dsh-poetry', 'mood.json'), '{"stats":{}}', 'utf8')
    await pluginApply(fakeCtx)
    assert.equal(listeners.has('session/event'), false, '不注册 session/event 监听')
    assert.equal(
      routes.some((route) => route.path === '/api/dsh-poetry/mood.json'),
      false,
      '不再注册 mood.json 路由',
    )
    const retired = fs.readdirSync(path.join(dshHome, '.dsh-poetry')).filter((name) => name.startsWith('mood.json.retired-'))
    assert.equal(retired.length, 1, '旧 mood.json 改名为 .retired')
    assert.equal(fs.existsSync(path.join(dshHome, '.dsh-poetry', 'mood.json')), false)

    assert.equal(routes.length, 31, 'assets + pet-media + self + project-action + project-detail + works + works-media + manual-read + presence + twin + twin-state + chat + attention + memory + model-errors + graph + graph-view + 13 条 JSON 路由')
    assert.ok(routes.some((route) => route.path === SELF_STATE_ROUTE), '注册了 self.json 内在状态路由')
    assert.ok(routes.some((route) => route.path === MEMORY_ROUTE), '注册了 memory.json 记忆中枢路由')
    assert.ok(routes.some((route) => route.path === MEMORY_BACKUP_ROUTE), '注册了 memory/backup.json 备份路由')
    assert.ok(
      routes.some((route) => route.path === '/api/dsh-poetry/self-talk.json'),
      '注册了 self-talk.json 路由',
    )
    assert.ok(
      routes.some((route) => route.path === '/api/dsh-poetry/mood-ai.json'),
      '注册了 mood-ai.json 路由',
    )
    assert.ok(
      routes.some((route) => route.path === '/api/dsh-poetry/feihua-full.json'),
      '注册了 feihua-full.json 路由',
    )
    assert.ok(
      routes.some((route) => route.path === PET_MEDIA_ROUTE),
      '注册了 pet-media 静态路由',
    )

    // v1.73：health.json 带后台服务快照（growth/drive/wander/reading/netlang/consolidate）
    const healthRoute = routes.find((route) => route.path === '/api/dsh-poetry/health.json')
    const healthResponse = new MockResponse()
    await healthRoute.handler(mockRequest({ url: '/api/dsh-poetry/health.json' }), healthResponse)
    await healthResponse.finished()
    const healthBody = healthResponse.json()
    assert.equal(healthBody.ok, true)
    assert.equal(typeof healthBody.runtime, 'object')
    for (const key of ['growth', 'drive', 'wander', 'reading', 'netlang', 'consolidate', 'budget', 'gate', 'heartbeat', 'modelErrors', 'services']) {
      assert.equal(typeof healthBody.runtime[key], 'object', `health.runtime.${key}`)
    }
    assert.ok(Array.isArray(healthBody.runtime.heartbeat.jobs), 'heartbeat 应列出各活动')
    assert.ok(healthBody.runtime.heartbeat.jobs.length >= 6, '心跳应已注册自主活动')
    assert.equal(typeof healthBody.runtime.budget.total, 'number')
    assert.equal(typeof healthBody.runtime.modelErrors.total, 'number')

    // 假 ctx 里没有 llm/agentDefaultModel → mood-ai 路由必须安全降级（200 + ok:false）
    const moodAiRoute = routes.find((route) => route.path === '/api/dsh-poetry/mood-ai.json')
    const moodAiResponse = new MockResponse()
    await moodAiRoute.handler(mockRequest({ url: '/api/dsh-poetry/mood-ai.json' }), moodAiResponse)
    await moodAiResponse.finished()
    assert.equal(moodAiResponse.statusCode, 200)
    assert.equal(moodAiResponse.json().ok, false)
    assert.equal(moodAiResponse.json().error.code, 'MOOD_AI_UNAVAILABLE')

    // 全量校验句库：目录不存在/未配置时必须安全降级（200 + ok:false）
    const feihuaRoute = routes.find((route) => route.path === '/api/dsh-poetry/feihua-full.json')
    const feihuaResponse = new MockResponse()
    await feihuaRoute.handler(mockRequest({ url: '/api/dsh-poetry/feihua-full.json?char=' }), feihuaResponse)
    await feihuaResponse.finished()
    assert.equal(feihuaResponse.statusCode, 200)
    assert.equal(feihuaResponse.json().ok, false)
    assert.equal(feihuaResponse.json().error.code, 'FEIHUA_FULL_UNAVAILABLE')

    // 假 ctx 里没有 llm/agentDefaultModel → self-talk 路由必须安全降级（200 + ok:false）
    const selfTalkRoute = routes.find((route) => route.path === '/api/dsh-poetry/self-talk.json')
    const selfTalkResponse = new MockResponse()
    await selfTalkRoute.handler(mockRequest({ url: '/api/dsh-poetry/self-talk.json' }), selfTalkResponse)
    await selfTalkResponse.finished()
    assert.equal(selfTalkResponse.statusCode, 200)
    assert.equal(selfTalkResponse.json().ok, false)
    assert.equal(selfTalkResponse.json().error.code, 'SELF_TALK_UNAVAILABLE')

    // 模拟插件卸载：不应重新写回会话统计文件
    for (const cleanup of cleanups.reverse()) {
      if (typeof cleanup === 'function') cleanup()
    }
    assert.equal(listeners.has('session/event'), false)
    assert.equal(fs.existsSync(path.join(dshHome, '.dsh-poetry', 'mood.json')), false, '不再写 mood.json')
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  }
})
