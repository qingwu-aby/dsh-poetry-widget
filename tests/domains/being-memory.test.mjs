// tests/domains/being-memory.test.mjs —— growth/memory-hub/recall/voice/drive（W3 拆分）
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
// M38：自驱成长引擎（内在状态 + 自省/自学 + self.json 路由 + prompt 注入）
// ---------------------------------------------------------------------------



test('self-state：路径/默认值/归一化/clamp', () => {
  assert.equal(resolveSelfStatePath({ DSH_SELF_STATE: '/tmp/self.json' }, '/Users/alice'), '/tmp/self.json')
  assert.equal(
    resolveSelfStatePath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/.dsh-poetry/self-state.json',
  )
  assert.equal(resolveSelfStatePath({}, '/Users/alice'), '/Users/alice/.dsh/.dsh-poetry/self-state.json')

  const now = 1700000000000
  const state = defaultSelfState(now)
  assert.equal(state.v, 1)
  for (const [field, value] of Object.entries(SELF_STATE_DEFAULTS)) assert.equal(state[field], value, field)
  assert.equal(state.lastTickAt, now)
  assert.equal(state.learnings, 0)
  assert.equal(state.reflections, 0)

  const normalized = normalizeSelfState(
    { energy: 999, curiosity: -5, social: 61.26, hunger: 'bad', moodValence: 50, moodArousal: 48.24, learnings: 7, reflections: 3 },
    now,
  )
  assert.equal(normalized.energy, 100)
  assert.equal(normalized.curiosity, 0)
  assert.equal(normalized.social, 61.3)
  assert.equal(normalized.hunger, SELF_STATE_DEFAULTS.hunger)
  assert.equal(normalized.moodValence, 50)
  assert.equal(normalized.moodArousal, 48.2)
  assert.equal(normalized.learnings, 7)
  assert.equal(normalized.reflections, 3)
  assert.equal(clampSelfValue(120), 100)
  assert.equal(clampSelfValue(-3), 0)
  assert.equal(clampSelfValue('x', 42), 42)
})

test('self-state：tick 漂移（精力↓好奇↑社交/饥饿↑）与 180min cap', () => {
  const now = 1700000000000
  const state = defaultSelfState(now)
  const after30 = advanceSelfState(state, now + 30 * 60 * 1000)
  assert.equal(after30.energy, 64) // 70 - 0.2*30
  assert.equal(after30.curiosity, 63) // 60 + 0.1*30
  assert.equal(after30.social, 59.5) // 55 + 0.15*30
  assert.equal(after30.hunger, 42.5) // 35 + 0.25*30
  assert.equal(after30.lastTickAt, now + 30 * 60 * 1000)

  // 超过 180min 只补算 180min
  const capped = advanceSelfState(state, now + 300 * 60 * 1000)
  assert.equal(capped.energy, 34) // 70 - 36
  assert.equal(capped.hunger, 80) // 35 + 45
  assert.equal(capped.curiosity, 78)
  assert.equal(capped.social, 82)
  assert.equal(SELF_STATE_MAX_TICK_MINUTES, 180)

  // valence/arousal 向中性回落
  const excited = { ...state, moodValence: 40, moodArousal: 80 }
  const calmed = advanceSelfState(excited, now + 10 * 60 * 1000)
  assert.equal(calmed.moodValence, 38) // -0.2*10
  assert.equal(calmed.moodArousal, 78) // 向 45 回落 0.2*10
})

test('self-state：applyEvent（meal/play/social/rest/learn/reflect）与 clamp/计数', () => {
  const now = 1700000000000
  const base = defaultSelfState(now)
  const meal = applySelfEvent(base, 'meal', now)
  assert.equal(meal.hunger, 5)
  assert.equal(meal.energy, 75)
  assert.equal(meal.lastMealAt, now)

  const play = applySelfEvent(base, 'play', now)
  assert.equal(play.moodValence, 15)
  assert.equal(play.moodArousal, 55)
  assert.equal(play.curiosity, 65)
  assert.equal(play.lastPlayAt, now)

  const social = applySelfEvent(base, 'social', now)
  assert.equal(social.social, 75)
  assert.equal(social.moodValence, 10)
  assert.equal(social.lastSocialAt, now)

  const rest = applySelfEvent(base, 'rest', now)
  assert.equal(rest.energy, 95)
  assert.equal(rest.moodArousal, 35)

  const learn = applySelfEvent(base, 'learn', now)
  assert.equal(learn.curiosity, 80)
  assert.equal(learn.energy, 65)
  assert.equal(learn.learnings, 1)
  assert.equal(learn.lastLearnAt, now)

  const reflect = applySelfEvent(base, 'reflect', now)
  assert.equal(reflect.moodValence, 5)
  assert.equal(reflect.moodArousal, 40)
  assert.equal(reflect.reflections, 1)
  assert.equal(reflect.lastReflectAt, now)

  // clamp 上限
  const high = { ...base, energy: 99 }
  assert.equal(applySelfEvent(high, 'rest', now).energy, 100)
  // 未知事件不变（逐字段断言，避免归一化对象引用差异）
  const unknown = applySelfEvent(base, 'unknown', now)
  for (const field of ['energy', 'curiosity', 'social', 'hunger', 'moodValence', 'moodArousal']) {
    assert.equal(unknown[field], base[field], field)
  }
  assert.equal(unknown.lastTickAt, base.lastTickAt)
})

test('self-state：createSelfState 持久化节流/flush/坏文件回退默认', () => {
  const dir = makeTmpDir('dshp-self-state')
  const file = path.join(dir, 'self-state.json')
  const base = new Date(2026, 9, 23, 21, 0, 0).getTime()
  let clock = base
  const state = createSelfState({ file, now: () => clock, logger: { warn() {} }, persistThrottleMs: 60 * 1000 })
  const initial = state.snapshot()
  assert.equal(initial.energy, SELF_STATE_DEFAULTS.energy)
  assert.equal(fs.existsSync(file), false, '仅读取不写盘')

  clock = base + 30 * 60 * 1000
  state.tick(clock)
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(persisted.energy, 64)
  assert.equal(persisted.updatedAt, clock)

  // 节流窗口内（30s < 60s）：内存漂移但文件不写
  clock = base + 30 * 60 * 1000 + 30 * 1000
  state.tick(clock)
  assert.equal(state.snapshot().energy, 63.9)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).updatedAt, base + 30 * 60 * 1000, '节流窗口内不写盘')
  state.flush()
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).updatedAt, clock, 'flush 强制写盘')

  // 坏文件 → 默认值、不抛
  fs.writeFileSync(file, 'not json', 'utf8')
  const recovered = createSelfState({ file, now: () => clock, logger: { warn() {} } })
  assert.equal(recovered.snapshot().energy, SELF_STATE_DEFAULTS.energy)
  state.dispose()
  recovered.dispose()
})

test('self-state：describeSelfState/formatSelfStateLine 与 self.json handler', async () => {
  const state = defaultSelfState(FIXED_NOW.getTime())
  const describe = describeSelfState({ ...state, energy: 20, curiosity: 85, social: 10, hunger: 80, moodValence: 5, moodArousal: 80 })
  assert.match(describe, /很疲惫/)
  assert.match(describe, /好奇心很旺/)
  assert.match(describe, /只想安静待着/)
  assert.match(describe, /肚子很饿/)
  assert.match(describe, /心里有点紧绷/)
  assert.equal(/\d/.test(describe), false, '定性描述不含数字')

  const line = formatSelfStateLine(state)
  assert.match(line, /你现在的内在状态：精力 70\/100、好奇 60\/100、社交 55\/100、饥饿 35\/100。/)
  assert.match(line, /不要把这些数字原样说出来/)

  const handler = createSelfStateHandler({
    tick: () => {},
    getSnapshot: () => ({ energy: 70 }),
    getGrowth: () => ({ lastReflectAt: 1, lastLearnAt: 2, learnings: 3, reflections: 4 }),
  })
  async function call({ method = 'GET', headers = { host: '127.0.0.1:57623' } } = {}) {
    const response = new MockResponse()
    await handler(mockRequest({ method, url: SELF_STATE_ROUTE, headers }), response)
    await response.finished()
    return response
  }
  const get = await call({ headers: {} })
  assert.equal(get.statusCode, 200)
  assert.equal(get.headers['Cache-Control'], 'no-store')
  assert.equal(get.json().ok, true)
  assert.equal(get.json().state.energy, 70)
  assert.equal(get.json().growth.learnings, 3)
  const head = await call({ method: 'HEAD' })
  assert.equal(head.statusCode, 200)
  assert.equal(Buffer.concat(head.chunks).length, 0)
  const post = await call({ method: 'POST' })
  assert.equal(post.statusCode, 405)
  assert.equal(post.headers.Allow, 'GET, HEAD')

  // tick/snapshot 抛错 → 200 ok:false，不 5xx
  const failing = createSelfStateHandler({
    tick: () => {
      throw new Error('boom')
    },
    getSnapshot: () => ({}),
  })
  const failedResponse = new MockResponse()
  await failing(mockRequest({ url: SELF_STATE_ROUTE }), failedResponse)
  await failedResponse.finished()
  assert.equal(failedResponse.statusCode, 200)
  assert.equal(failedResponse.json().ok, false)
  assert.equal(failedResponse.json().error.code, 'SELF_STATE_UNAVAILABLE')
})

test('self-being v1.51：只存事实时间线+一句状态，不再有分数', () => {
  assert.equal(SELF_BEING_VERSION, 2)
  assert.equal(resolveSelfBeingPath({ DSH_SELF_STATE: '/tmp/s.json' }, '/Users/a'), '/tmp/s.json')
  assert.equal(resolveSelfBeingPath({ DSH_HOME: '/tmp/dsh' }), '/tmp/dsh/.dsh-poetry/self-state.json')
  const being = defaultSelfBeing(1_700_000_000_000)
  assert.equal(being.v, 2)
  assert.equal(being.felt, '')
  assert.equal('energy' in being, false, '没有 energy 分数')
  assert.equal('hunger' in being, false, '没有 hunger 分数')

  // 旧 v1 文件迁移：只保留时间线，数字全部丢弃
  const migrated = normalizeSelfBeing({ v: 1, energy: 72, hunger: 88, social: 30, lastMealAt: 1_700_000_000_000, lastWakeAt: 1_699_000_000_000 }, 1_701_000_000_000)
  assert.equal(migrated.v, 2)
  assert.equal(migrated.lastMealAt, 1_700_000_000_000)
  assert.equal('energy' in migrated, false)
  assert.equal(migrated.felt, '')

  // 时长说法不带数字
  for (const ms of [0, 10 * 60_000, 45 * 60_000, 2 * 3600_000, 15 * 3600_000, 30 * 3600_000]) {
    assert.equal(/\d/.test(composeElapsed(ms)), false, `时长不应含数字：${composeElapsed(ms)}`)
  }

  // 事实时间线也不带数字/分数
  const lines = describeTimeline({ ...being, sleeping: false, lastWakeAt: 1_700_000_000_000, lastMealAt: 1_699_900_000_000 }, 1_700_100_000_000)
  for (const line of lines) assert.equal(/\d/.test(line), false, `时间线不应含数字：${line}`)
  assert.ok(lines.some((line) => line.includes('吃东西')))

  // 事件只更新时间线/睡眠
  const afterEat = applyBeingEvent({ ...being, felt: '有点饿' }, 'eat', 1_700_000_000_000)
  assert.equal(afterEat.lastMealAt, 1_700_000_000_000)
  assert.equal(afterEat.lastActionAt, 1_700_000_000_000)
  const afterSleep = applyBeingEvent(afterEat, 'sleep', 1_700_000_001_000)
  assert.equal(afterSleep.sleeping, true)
  assert.equal(afterSleep.sleepSince, 1_700_000_001_000)
  const afterWake = applyBeingEvent(afterSleep, 'wake', 1_700_000_002_000)
  assert.equal(afterWake.sleeping, false)
  assert.equal(afterWake.lastWakeAt, 1_700_000_002_000)
  assert.equal('hunger' in afterEat, false, '事件不再加减分数')

  // 持久化：她自己写的一句话 + 事实
  const dir = makeTmpDir('dshp-being')
  const file = path.join(dir, 'self-state.json')
  fs.writeFileSync(file, JSON.stringify({ v: 1, energy: 55, lastMealAt: 1_700_000_000_000 }), 'utf8')
  const store = createSelfBeing({ file, now: () => 1_700_000_500_000, persistThrottleMs: 0 })
  const snap = store.snapshot()
  assert.equal(snap.lastMealAt, 1_700_000_000_000)
  assert.equal(snap.felt, '')
  store.setFelt('刚睡醒，有点说不上来的空。')
  assert.equal(store.snapshot().felt, '刚睡醒，有点说不上来的空。')
  assert.match(formatBeingLine(store.snapshot()), /刚睡醒/)
  // v1.59：她自己写「最近在体会/琢磨什么」，不再读外部 experience 文件
  store.setExperiencing('在听楼下谁弹琴，想到一段旧事。')
  assert.equal(store.snapshot().experiencing, '在听楼下谁弹琴，想到一段旧事。')
  assert.match(formatBeingLine(store.snapshot(), 1_700_000_600_600), /你最近在体会\/琢磨：在听楼下谁弹琴/)
  // v2.0：体会的时效从 36h 放宽到 7 天；超过 7 天才算过期
  assert.equal(
    formatBeingLine(store.snapshot(), 1_700_000_600_600 + 6 * 24 * 60 * 60 * 1000).includes('你最近在体会'),
    true,
    '6 天内的体会仍然有效',
  )
  assert.equal(
    formatBeingLine(store.snapshot(), 1_700_000_600_600 + 8 * 24 * 60 * 60 * 1000).includes('你最近在体会'),
    false,
    '超过 7 天的体会不再注入',
  )
  // v1.60：学习/自省是事实计数，不再冻结
  store.applyEvent('learn', 1_700_000_600_500)
  store.applyEvent('learn', 1_700_000_600_600)
  store.applyEvent('reflect', 1_700_000_600_700)
  assert.equal(store.snapshot().learnings, 2)
  assert.equal(store.snapshot().reflections, 1)
  store.setGrowthCounts({ learnings: 20, reflections: 5 })
  assert.equal(store.snapshot().learnings, 20)
  assert.equal(store.snapshot().reflections, 5)
  store.setGrowthCounts({ learnings: 1, reflections: 1 })
  assert.equal(store.snapshot().learnings, 20, '只增不减')
  store.markChecked(1_700_000_600_000)
  assert.equal(store.snapshot().lastCheckAt, 1_700_000_600_000)
  store.applyEvent('eat', 1_700_000_700_000)
  store.flush()
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.v, 2)
  assert.equal(saved.energy, undefined)
  assert.equal(saved.lastMealAt, 1_700_000_700_000)
  assert.equal(saved.felt, '刚睡醒，有点说不上来的空。')
  assert.equal(saved.experiencing, '在听楼下谁弹琴，想到一段旧事。')
  store.dispose()
})

test('self-drive v1.51：由她的模型写状态/决定动作，不靠阈值', async () => {
  // prompt：只给事实，不含分数
  const prompt = buildSelfDrivePrompt({
    now: 1_700_100_000_000,
    state: { sleeping: false, lastMealAt: 1_699_900_000_000, lastWakeAt: 1_700_000_000_000, felt: '有点乏。' },
    recentMoodLabels: ['松下来'],
    latestAction: { text: '刚去喝了口水。' },
  })
  assert.match(prompt, /距上次吃东西/)
  // v1.56：不再给菜单，让她用自己的话生成行为
  assert.match(prompt, /不要从任何清单里挑/)
  assert.match(prompt, /"doing"/)
  assert.match(prompt, /kind 里顺手标一下/)
  assert.equal(/eat 吃 \/ drink 喝/.test(prompt), false, '不再列动作菜单')
  assert.equal(/\d+\/100/.test(prompt), false, 'prompt 不出现分数')
  assert.equal(/hunger >=|>= 75|阈值/.test(prompt), false, 'prompt 不提阈值')
  assert.match(prompt, /情绪会累积/)
  assert.match(prompt, /别被上一轮的情绪推着走/)

  // 解析
  const ok = parseSelfDriveResult(JSON.stringify({ felt: '屋子里静下来，我想翻两页书。', action: 'play', say: '想翻两页书。' }))
  assert.equal(ok.ok, true)
  assert.equal(ok.kind, 'play', '兼容旧 action 形状')
  assert.equal(ok.doing.length > 0, true)
  assert.deepEqual(SELF_DRIVE_ACTIONS.includes('sleep'), true)
  assert.deepEqual(SELF_DRIVE_ACTIONS.includes('learn'), true)
  assert.equal(parseSelfDriveResult(JSON.stringify({ felt: '忽然很想弄明白潮汐是怎么被月亮拽动的。', action: 'learn', say: '去查查。' })).ok, true)
  assert.equal(parseSelfDriveResult(JSON.stringify({ felt: '短', action: 'play' })).ok, false)
  assert.equal(parseSelfDriveResult(JSON.stringify({ felt: '一句足够长的状态。', action: '吃' })).ok, false)
  const withExp = parseSelfDriveResult(
    JSON.stringify({ felt: '有点闷，想开窗。', experiencing: '在琢磨昨天读到的一段历史。', doing: '', kind: '' }),
  )
  assert.equal(withExp.ok, true)
  assert.equal(withExp.experiencing, '在琢磨昨天读到的一段历史。')
  // v1.56：自由生成行为（doing），kind 可选
  const invented = parseSelfDriveResult(
    JSON.stringify({ felt: '坐太久了，腰有点僵。', doing: '把窗台上那盆草转个方向', kind: '', say: '让它也晒晒这一面。' }),
  )
  assert.equal(invented.ok, true)
  assert.equal(invented.doing, '把窗台上那盆草转个方向')
  assert.equal(invented.kind, '')
  const withKind = parseSelfDriveResult(
    JSON.stringify({ felt: '嗓子有点干。', doing: '去倒杯温水，顺便看看夜里的雨', kind: 'drink' }),
  )
  assert.equal(withKind.ok, true)
  assert.equal(withKind.kind, 'drink')
  assert.equal(parseSelfDriveResult(JSON.stringify({ felt: '一句足够长的状态。', doing: '做点事情', kind: 'Bad Kind' })).ok, false)
  assert.equal(parseSelfDriveResult('not json').ok, false)

  // 场景：模型说“想冒泡”，drive 记录状态+动作
  const dir = makeTmpDir('dshp-drive')
  const actionsPath = path.join(dir, 'self-actions.json')
  const events = []
  let felt = ''
  let checkedAt = 0
  const state = {
    snapshot: () => ({ sleeping: false, felt, lastActionAt: null }),
    setFelt: (text, at) => { felt = text; return { felt } },
    markChecked: (at) => { checkedAt = at },
    applyEvent: (kind, at) => { events.push([kind, at]) },
  }
  const llm = makeMockLlm(() => JSON.stringify({ felt: '安静下来，想看看外面有没有人。', action: 'socialize', say: '冒个泡。' }))
  const drive = createSelfDrive({
    state,
    llm,
    actionsPath,
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm', reasoningEffort: 'low' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_100_000_000,
    checkMinMs: 15 * 60_000,
    checkMaxMs: 20 * 60_000,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  const result = await drive.check(1_700_100_000_000)
  assert.equal(result.ok, true)
  assert.equal(result.felt, '安静下来，想看看外面有没有人。')
  assert.equal(felt, '安静下来，想看看外面有没有人。')
  assert.equal(checkedAt, 1_700_100_000_000)
  assert.deepEqual(events, [['socialize', 1_700_100_000_000]], '动作由模型决定并落到时间线')
  const savedActions = JSON.parse(fs.readFileSync(actionsPath, 'utf8')).actions
  assert.equal(savedActions.length, 1)
  assert.equal(savedActions[0].kind, 'socialize')
  assert.equal(savedActions[0].text, '冒个泡。')
  drive.dispose()

  // 模型失败：保持 felt、不产生动作（不退回阈值）
  const failState = {
    snapshot: () => ({ sleeping: false }),
    setFelt: () => { throw new Error('should not be called') },
    markChecked: () => {},
    applyEvent: () => {},
  }
  const failLlm = { stream() { return (async function* () { throw new Error('network down') })() } }
  // v1.52：她可以选择“现在想学”，触发自学（学什么由自学 prompt 里她自己定）
  let learnCalled = 0
  const learnLlm = makeMockLlm(() => JSON.stringify({ felt: '忽然很想知道潮汐是怎么被月亮拽动的。', action: 'learn', say: '去查查潮汐。' }))
  const learnDrive = createSelfDrive({
    state: {
      snapshot: () => ({ sleeping: false, lastActionAt: null }),
      setFelt() {},
      markChecked() {},
      applyEvent() {},
    },
    llm: learnLlm,
    actionsPath: path.join(dir, 'learn-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_100_000_000,
    onLearn: () => { learnCalled += 1 },
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  learnDrive.load()
  const learnDecision = await learnDrive.check(1_700_100_000_000)
  assert.equal(learnDecision.ok, true)
  assert.equal(learnDecision.action.kind, 'learn')
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(learnCalled, 1, '选择“学”时应触发自学')
  const learnActions = JSON.parse(fs.readFileSync(path.join(dir, 'learn-actions.json'), 'utf8')).actions
  assert.equal(learnActions[0].kind, 'learn')
  assert.equal(learnActions[0].label.length > 0, true)
  learnDrive.dispose()

  // v1.55：自造日常行为（如伸懒腰）只作为“她做了什么”记录，不写时间线
  const stretchLlm = makeMockLlm(() =>
    JSON.stringify({ felt: '坐久了，腰背有点发僵，想站起来抻一抻。', doing: '站起来把手臂举过头顶，慢慢把腰拉直', kind: '', say: '起來抻一抻。' }),
  )
  const stretchDrive = createSelfDrive({
    state: {
      snapshot: () => ({ sleeping: false, lastActionAt: null }),
      setFelt() {},
      markChecked() {},
      applyEvent: () => { throw new Error('should not update timeline for invented action') },
    },
    llm: stretchLlm,
    actionsPath: path.join(dir, 'stretch-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_100_000_000,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  stretchDrive.load()
  const stretchResult = await stretchDrive.check(1_700_100_000_000)
  assert.equal(stretchResult.ok, true)
  assert.equal(stretchResult.action.kind, 'doing', '自由行为默认 kind=doing')
  assert.equal(stretchResult.action.label, '站起来把手臂举过头顶，慢慢把腰拉直')
  const stretchSaved = JSON.parse(fs.readFileSync(path.join(dir, 'stretch-actions.json'), 'utf8')).actions
  assert.equal(stretchSaved[0].kind, 'doing')
  assert.equal(stretchSaved[0].text, '起來抻一抻。')
  stretchDrive.dispose()

  // v1.62：focus（注意力集中）会触发试探回调；普通待着不触发
  const probeFocuses = []
  const focusLlm = makeMockLlm(() =>
    JSON.stringify({
      felt: '手上这页还没翻完。',
      experiencing: '',
      focus: '在琢磨漏刻的水位为什么能稳住',
      doing: '把那页再翻回去看一眼',
      kind: '',
      say: '这行字刚才没看进去。',
    }),
  )
  const focusDrive = createSelfDrive({
    state: {
      snapshot: () => ({ sleeping: false, lastActionAt: null }),
      setFelt() {},
      setExperiencing() {},
      markChecked() {},
      applyEvent() {},
    },
    llm: focusLlm,
    actionsPath: path.join(dir, 'focus-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_200_000_000,
    firstMinMs: 0,
    firstMaxMs: 0,
    onProbe: (focus) => probeFocuses.push(focus),
  })
  focusDrive.load()
  const focusResult = await focusDrive.check(1_700_200_000_000)
  assert.equal(focusResult.ok, true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(probeFocuses, ['在琢磨漏刻的水位为什么能稳住'])
  focusDrive.dispose()

  // v1.66：没写 focus、但写下了新的 experiencing，也算心落在某件事上 → 触发介入
  const expProbes = []
  const expLlm = makeMockLlm(() =>
    JSON.stringify({
      felt: '手边那页还没翻，脑子先跑远了。',
      experiencing: '在想刚才读到的那段旧事。',
      focus: '',
      doing: '',
      kind: '',
      say: '',
    }),
  )
  const expDrive = createSelfDrive({
    state: {
      snapshot: () => ({ sleeping: false, lastActionAt: null }),
      setFelt() {},
      setExperiencing() {},
      markChecked() {},
      applyEvent() {},
    },
    llm: expLlm,
    actionsPath: path.join(dir, 'exp-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_300_000_000,
    firstMinMs: 0,
    firstMaxMs: 0,
    onProbe: (focus) => expProbes.push(focus),
  })
  expDrive.load()
  await expDrive.check(1_700_300_000_000)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(expProbes, ['在想刚才读到的那段旧事。'])
  expDrive.dispose()

  const failDrive = createSelfDrive({
    state: failState,
    llm: failLlm,
    actionsPath: path.join(dir, 'fail-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => 1_700_100_000_000,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  failDrive.load()
  const failed = await failDrive.check(1_700_100_000_000)
  assert.equal(failed.ok, false)
  assert.equal(fs.existsSync(path.join(dir, 'fail-actions.json')), false)
  failDrive.dispose()
})

test('feelings v1.50：自生情绪库 路径/校验/追加去重/读取/名称', () => {
  const dir = makeTmpDir('dshp-feelings')
  assert.equal(resolveFeelingsPath({ DSH_POETRY_FEELINGS: '/tmp/f.json' }, '/Users/a'), '/tmp/f.json')
  assert.equal(resolveFeelingsPath({ DSH_HOME: '/tmp/dsh' }), '/tmp/dsh/agent-memory/feelings.json')
  const file = path.join(dir, 'feelings.json')
  fs.writeFileSync(file, '', 'utf8')
  assert.deepEqual(readFeelingFile(file), [], '空文件 = 还没造过新感受')
  assert.equal(normalizeFeeling({ name: '雨夜的钝感', description: '雨下久了，心里像蒙了一层雾。' }).name, '雨夜的钝感')
  assert.equal(normalizeFeeling({ name: 'x', description: '太短' }), null)
  assert.equal(parseNewFeeling({ name: '雨夜的钝感', description: '雨下久了，心里像蒙了一层雾。' }).ok, true)
  assert.equal(parseNewFeeling({ name: '雨夜的钝感' }).ok, false)

  const first = appendFeeling({
    path: file,
    feeling: { name: '雨夜的钝感', description: '雨下久了，心里像蒙了一层雾。' },
    now: 1_700_000_000_000,
  })
  assert.equal(first.ok, true)
  assert.equal(first.added, true)
  const duplicate = appendFeeling({
    path: file,
    feeling: { name: '雨夜的钝感', description: '另一句足够长的描述。' },
    now: 1_800_000_000_000,
  })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.added, false)
  assert.equal(duplicate.reason, 'duplicate')
  const entries = readFeelingFile(file)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].createdAt, 1_700_000_000_000)
  const bank = loadFeelingBank({ path: file })
  assert.deepEqual(bank.names(5), ['雨夜的钝感'])
  assert.equal(bank.recent(2).length, 1)
  assert.deepEqual(loadFeelingBank({ path: path.join(dir, 'none.json') }).read(), {
    ok: false,
    reason: 'missing',
    entries: [],
  })
  assert.equal(FEELING_NAME_MAX >= 2, true)
  assert.equal(FEELING_DESC_MAX >= 6, true)
})

test('self-growth v1.50：自省里造出的新感受写入情绪库（重名不重复）', async () => {
  const dir = makeTmpDir('dshp-growth-feelings')
  const feelingsPath = path.join(dir, 'feelings.json')
  fs.writeFileSync(feelingsPath, JSON.stringify({ ok: true, v: 1, feelings: [] }), 'utf8')
  const llm = makeGrowthLlm([
    JSON.stringify({
      thought: '雨声停下来的那一瞬，我有点说不上来的空。',
      feeling: { name: '雨停后的空', description: '雨声忽然停了，心里像少了一层垫着的东西。' },
    }),
    JSON.stringify({
      thought: '灯亮着，我却想不起刚才在等什么。',
      feeling: { name: '雨停后的空', description: '重复造同一个词也不该重复入库。' },
    }),
  ])
  const { growth } = makeGrowthHarness({ llm, feelingsPath })
  const first = await growth.reflectNow()
  assert.equal(first.ok, true)
  assert.equal(first.feelingAdded, true)
  assert.equal(first.feeling.name, '雨停后的空')
  assert.equal(readFeelingFile(feelingsPath).length, 1)
  const second = await growth.reflectNow()
  assert.equal(second.ok, true)
  assert.equal(second.feelingAdded, false, '重名不重复写入')
  assert.equal(readFeelingFile(feelingsPath).length, 1)
  growth.dispose()
})

test('mood-ai v1.50：自造情绪词进入心情 prompt（可当 label）', async () => {
  const feelings = [{ name: '雨停后的空', description: '雨声忽然停了，心里像少了一层垫着的东西。' }]
  const catalog = makeMoodCatalogFixture()
  const prompt = buildMoodPrompt({ now: FIXED_NOW.getTime(), customFeelings: feelings }, catalog)
  assert.match(prompt, /你自己造过的感受词/)
  assert.match(prompt, /雨停后的空/)
  assert.equal(buildMoodPrompt({ now: FIXED_NOW.getTime() }, catalog).includes('你自己造过的感受词'), false)

  const mood = makeMoodAiHarness({ feelings: { recent: () => feelings } })
  assert.equal((await mood.service.generate({}, { force: true })).ok, true)
  assert.match(mood.llm.calls[0].messages[0].content[0].text, /雨停后的空/)
})

test('memory-recall v1.50：自造感受进入记忆摘要', () => {
  const dir = makeTmpDir('dshp-recall-feelings')
  const journalPath = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(journalPath, '', 'utf8')
  const feelingsPath = path.join(dir, 'feelings.json')
  fs.writeFileSync(
    feelingsPath,
    JSON.stringify({
      ok: true,
      v: 1,
      feelings: [{ name: '雨停后的空', description: '雨声忽然停了，心里像少了一层垫着的东西。', createdAt: 1 }],
    }),
    'utf8',
  )
  const recall = createMemoryRecall({
    journalPath,
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
    feelingsPath,
  })
  const digest = recall.digest({})
  assert.equal(digest.newFeelings.length, 1)
  assert.match(digest.newFeelings[0], /雨停后的空/)
  assert.match(formatMemoryDigest(digest), /你给自己造过的新感受：雨停后的空/)
})

test('self-growth：prompt 白名单/JSON 解析/候选 topic 校验', () => {
  const state = defaultSelfState(FIXED_NOW.getTime())
  const reflectPrompt = buildReflectPrompt({ now: FIXED_NOW.getTime(), state })
  assert.match(reflectPrompt, /最近的自省/)
  assert.match(reflectPrompt, /"thought"/)
  assert.match(reflectPrompt, /不要提 AI、模型、提示词/)
  assert.match(reflectPrompt, /你此刻的状态/)
  assert.match(reflectPrompt, /你的事实：/)
  assert.equal(reflectPrompt.includes('你最近自学到'), false, '无自学内容时不注入')
  // v1.45：自学内容反哺自省（thinking/想法/语言）
  const withLearning = buildReflectPrompt({
    now: FIXED_NOW.getTime(),
    state,
    recentLearning: '章鱼有三颗心脏。',
  })
  assert.match(withLearning, /你最近自学到：章鱼有三颗心脏。/)
  assert.match(withLearning, /就把这层理解带进自省/)
  assert.match(withLearning, /至少提到其中具体的一点/)
  // 只读白名单：额外敏感字段不进入 prompt
  const injectedPrompt = buildReflectPrompt({
    now: FIXED_NOW.getTime(),
    state,
    sessionMessages: ['SECRET_SESSION']
  })
  assert.equal(injectedPrompt.includes('SECRET_SESSION'), false)

  // v1.50：自造新感受——prompt 说明 + 解析（非法 feeling 忽略，不影响自省）
  const withFeelings = buildReflectPrompt({ now: FIXED_NOW.getTime(), state, knownFeelings: ['雨夜的钝感', '雨停后的空'] })
  assert.match(withFeelings, /你已经给自己造过的感受词/)
  assert.match(withFeelings, /雨夜的钝感、雨停后的空/)
  assert.match(withFeelings, /"feeling"/)
  assert.equal(reflectPrompt.includes('你已经给自己造过的感受词'), false, '无已知感受词不注入该段')

  const parsedReflect = parseReflectResult('```json\n{"thought":"今天安静地陪着你，心里很稳。"}\n```')
  assert.equal(parsedReflect.ok, true)
  assert.equal(parsedReflect.thought, '今天安静地陪着你，心里很稳。')
  const parsedWithFeeling = parseReflectResult(
    JSON.stringify({
      thought: '雨声停下来的那一瞬，我有点说不上来的空。',
      feeling: { name: '雨停后的空', description: '雨声忽然停了，心里像少了一层垫着的东西。' },
    }),
  )
  assert.equal(parsedWithFeeling.ok, true)
  assert.equal(parsedWithFeeling.feeling.name, '雨停后的空')
  const parsedBadFeeling = parseReflectResult(
    JSON.stringify({ thought: '今天安静地陪着你，心里很稳。', feeling: { name: 'x' } }),
  )
  assert.equal(parsedBadFeeling.ok, true)
  assert.equal(parsedBadFeeling.feeling, null, '非法 feeling 忽略，不影响自省')
  assert.equal(parseReflectResult('{"thought":"太短"}').ok, false)
  assert.equal(parseReflectResult('not json').ok, false)
  assert.equal(parseReflectResult('{"thought":"这首诗真好啊，我想到「明月」。"}').ok, false, '含诗词痕迹拒绝')

  const learnPrompt = buildLearnPrompt({ now: FIXED_NOW.getTime(), state })
  assert.match(learnPrompt, /这次学什么由你自己决定/)
  assert.match(learnPrompt, /\{"question":"…","note":"…","topic":/)
  assert.match(learnPrompt, /topic 用 null/)

  const validLearn = parseLearnResult(
    JSON.stringify({
      question: '鲸落为什么能养活深海？',
      note: '鲸的尸体沉到海底，会形成持续多年的生态热点。',
      topic: { id: 'whale-fall-ecosystem', title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。', tags: ['海洋', '动物'] },
    }),
  )
  assert.equal(validLearn.ok, true)
  assert.equal(validLearn.topic.id, 'whale-fall-ecosystem')
  assert.equal(parseLearnResult(JSON.stringify({ question: '一个小问题', note: '一点点笔记', topic: null })).topic, null)
  const invalidTopic = parseLearnResult(
    JSON.stringify({ question: '一个小问题呀', note: '一点点笔记呀', topic: { id: 'Bad ID!', title: 'x', fact: 'y', tags: ['z'] } }),
  )
  assert.equal(invalidTopic.ok, true)
  assert.equal(invalidTopic.topic, null, '非法 topic 被丢弃但自学仍有效')
  assert.equal(normalizeTopicCandidate({ id: 'ok-topic', title: '标题', fact: '事实', tags: ['tag'] }).id, 'ok-topic')
  assert.equal(normalizeTopicCandidate({ id: 'X', title: '标题', fact: '事实', tags: ['tag'] }), null)
  assert.equal(normalizeTopicCandidate({ id: 'ok-topic', title: '', fact: '事实', tags: ['tag'] }), null)
})

test('self-growth：到点自省写 journal thought、自学写 learning-log 与候选话题（不写 topics.json）', async () => {
  const now = FIXED_NOW.getTime()
  const llm = makeGrowthLlm([
    JSON.stringify({ thought: '今天安静地陪着你，心里很稳。' }),
    JSON.stringify({
      question: '鲸落为什么能养活深海？',
      note: '鲸的尸体沉到海底，会形成持续多年的生态热点。',
      topic: { id: 'whale-fall-ecosystem', title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。', tags: ['海洋', '动物'] },
    }),
  ])
  const bankDir = makeTmpDir('dshp-growth-bank')
  const bankPath = path.join(bankDir, 'topics.json')
  const { dir, state, journal, growth } = makeGrowthHarness({
    llm,
    topics: [{ id: 'octopus-three-hearts' }],
    topicsBankPath: bankPath,
    now: () => now,
  })

  const reflect = await growth.reflectNow()
  assert.equal(reflect.ok, true)
  assert.equal(journal.entries.length, 1)
  assert.equal(journal.entries[0].kind, 'thought')
  assert.match(journal.entries[0].text, /^自省：/)
  assert.match(journal.entries[0].text, /今天安静地陪着你/)
  assert.equal(state.snapshot().reflections, 1)
  assert.equal(growth.snapshot().lastReflectAt, now)

  // v1.46：自学话题免审核直接并入活跃话题库（learned 标记）
  fs.writeFileSync(
    bankPath,
    JSON.stringify({ ok: true, v: 1, topics: [{ id: 'curated-one', title: '已有话题', fact: '外部维护的事实。', tags: ['基础'] }] }),
    'utf8',
  )
  const learn = await growth.learnNow()
  assert.equal(learn.ok, true)
  assert.equal(learn.candidateAdded, true)
  assert.equal(learn.topicPromoted, true)
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'))
  assert.deepEqual(bank.topics.map((topic) => topic.id), ['curated-one', 'whale-fall-ecosystem'])
  assert.equal(bank.topics[1].learned, true)
  assert.equal(typeof bank.topics[1].addedAt, 'number')
  assert.equal(bank.topics[0].learned, undefined, '外部话题不被标记/删除')
  const learningLog = fs.readFileSync(path.join(dir, 'learning-log.md'), 'utf8')
  assert.match(learningLog, /· 自学/)
  assert.match(learningLog, /## \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 自学/, 'v1.60：学习日志用本地时间标题')
  assert.match(learningLog, /Q: 鲸落为什么能养活深海？/)
  assert.match(learningLog, /鲸的尸体沉到海底/)
  const candidates = JSON.parse(fs.readFileSync(path.join(dir, 'topics-candidates.json'), 'utf8'))
  assert.equal(candidates.ok, true)
  assert.deepEqual(candidates.topics.map((topic) => topic.id), ['whale-fall-ecosystem'])
  assert.equal(state.snapshot().learnings, 1)
  assert.equal(growth.snapshot().learnings, 1)

  // 同一 topic 再次自学 → 去重，不再新增；learning-log 仍追加
  const again = await growth.learnNow()
  assert.equal(again.ok, true)
  assert.equal(again.candidateAdded, false, '重复 topic 不重复入库')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'topics-candidates.json'), 'utf8')).topics.length, 1)
  growth.dispose()
})

test('self-growth v1.62：注意力集中时模型自选入口，她去看并自己判断喜不喜欢', async () => {
  assert.equal(SELF_PROBE_GAP_MS, 40 * 60 * 1000)
  // prompt：类型/题目由模型自己挑；喜欢与否由她自己判断
  const proposalPrompt = buildProbeProposalPrompt({
    now: FIXED_NOW.getTime(),
    focus: '在琢磨漏刻的水位为什么能稳住',
    recentLearnedTitles: ['莲花漏用溢流稳住水位'],
    recentProbes: [{ title: '老城墙怎么排水', liked: false }],
  })
  assert.match(proposalPrompt, /注意力正落在：在琢磨漏刻的水位为什么能稳住/)
  assert.match(proposalPrompt, /这不是任务/)
  assert.match(proposalPrompt, /喜不喜欢最后由你自己判断/)
  assert.match(proposalPrompt, /老城墙怎么排水（不喜欢）/)
  const verdictPrompt = buildProbeVerdictPrompt({
    now: FIXED_NOW.getTime(),
    focus: '在琢磨漏刻的水位',
    proposal: { domain: '历史', title: '宋代的水钟怎么校准', hook: '想看看人怎么在没有仪器时校时' },
  })
  assert.match(verdictPrompt, /你按这个入口去看了一眼/)
  assert.match(verdictPrompt, /可以不喜欢/)

  // 解析
  assert.equal(parseProbeProposal(JSON.stringify({ domain: '历史', title: '宋代的水钟怎么校准', hook: '换到人怎么做事' })).ok, true)
  assert.equal(parseProbeProposal(JSON.stringify({ domain: '', title: 'x' })).ok, false)
  assert.equal(parseProbeVerdict(JSON.stringify({ impression: '翻到一段说漏刻靠日晷互相校验，觉得比算水位有意思。', liked: true, why: '喜欢看人怎么想办法。' })).ok, true)
  assert.equal(parseProbeVerdict(JSON.stringify({ impression: '看了一会儿，说不好。', why: '' })).ok, false, 'liked 必须是布尔')

  // 两段式：挑入口 → 去看 → 自己判断
  const now = FIXED_NOW.getTime()
  const llm = makeGrowthLlm([
    JSON.stringify({ domain: '历史', title: '宋代的水钟怎么校准', hook: '和我最近琢磨的水位有点像，但换到人怎么做事。' }),
    JSON.stringify({
      impression: '翻到一段说漏刻靠日晷互相校验，我盯着「校验」那两个字看了会儿，觉得比单纯算水位有意思。',
      liked: true,
      why: '喜欢看人怎么在没有仪器的时候想办法。',
    }),
  ])
  const { dir, growth } = makeGrowthHarness({ llm, now: () => now })
  const result = await growth.probeNow({ focus: '在琢磨漏刻的水位为什么能稳住' })
  assert.equal(result.ok, true)
  assert.equal(result.liked, true)
  assert.equal(result.domain, '历史')
  const log = fs.readFileSync(path.join(dir, 'learning-log.md'), 'utf8')
  assert.match(log, /· 试探/)
  assert.match(log, /注意力落在：在琢磨漏刻的水位为什么能稳住/)
  assert.match(log, /她自己的结论：喜欢/)
  const probeState = JSON.parse(fs.readFileSync(path.join(dir, 'probe-state.json'), 'utf8'))
  assert.equal(probeState.lastProbeAt, now)
  // 3 小时内不再打扰
  const again = await growth.probeNow({ focus: '还在想水钟' })
  assert.equal(again.ok, false)
  assert.equal(again.reason, 'not-now')
  growth.dispose()
})

test('self-growth v1.62：试探过的“喜欢/不喜欢”会进入下次自学提示', async () => {
  const prompt = buildLearnPrompt({
    now: FIXED_NOW.getTime(),
    state: {},
    probeHistory: [
      { domain: '历史', title: '宋代的水钟怎么校准', liked: true },
      { domain: '工艺', title: '青铜器怎么铸造', liked: false },
    ],
  })
  assert.match(prompt, /你最近试探过、觉得有意思的：宋代的水钟怎么校准/)
  assert.match(prompt, /你试探过、觉得没意思的：青铜器怎么铸造/)
})

test('self-growth：失败也推迟到下一周期、不重入、tick 到点触发、snapshot', async () => {
  const now = FIXED_NOW.getTime()
  const llm = makeGrowthLlm(['not json'])
  const { growth, journal } = makeGrowthHarness({
    llm,
    reflectIntervalMs: 60 * 1000,
    learnIntervalMs: 1000 * 60 * 60 * 24,
    now: () => now,
  })
  const first = await growth.reflectNow()
  assert.equal(first.ok, false)
  assert.equal(journal.entries.length, 0)

  // 不重入：同时再调一次 → busy
  const slowLlm = makeGrowthLlm([JSON.stringify({ thought: '一句足够长的自省。' })])
  const slowLlmStream = slowLlm.stream
  slowLlm.stream = (options) => {
    const inner = slowLlmStream(options)
    return (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 20))
      yield* inner
    })()
  }
  const second = makeGrowthHarness({ llm: slowLlm, reflectIntervalMs: 60 * 1000, now: () => now })
  const running = second.growth.reflectNow()
  const busy = await second.growth.reflectNow()
  assert.equal(busy.ok, false)
  assert.equal(busy.reason, 'busy')
  const finished = await running
  assert.equal(finished.ok, true)
  second.growth.dispose()
  growth.dispose()
})

test('self-growth：tick 的模型失败会推进 lastReflectAt（不在每个 tick 重试）', async () => {
  let clock = FIXED_NOW.getTime()
  const llm = makeGrowthLlm(['not json'])
  const { growth } = makeGrowthHarness({
    llm,
    reflectIntervalMs: 60 * 1000,
    learnIntervalMs: 1000 * 60 * 60 * 24,
    now: () => clock,
  })
  clock += 2 * 60 * 1000
  growth.tick(clock)
  assert.equal(growth.snapshot().lastReflectAt, clock)
  const callsAfterFirst = llm.calls.length
  await new Promise((resolve) => setTimeout(resolve, 80))
  // 下一个 tick（未到下一周期）不应再次调用模型
  clock += 10 * 1000
  growth.tick(clock)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(llm.calls.length, callsAfterFirst, '失败也推迟到下一周期')
  growth.dispose()
})

test('self-growth M55：EMPTY 诊断记录 chunkTypes/finishKind（不含正文）', async () => {
  const dir = makeTmpDir('dshp-growth-diag')
  const errorsPath = path.join(dir, 'model-errors.jsonl')
  const reasoningOnlyLlm = {
    calls: [],
    stream(options) {
      this.calls.push(options)
      return (async function* () {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' }
        yield { type: 'reasoning-delta', index: 0, text: '思考中' }
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '思考中' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const { growth } = makeGrowthHarness({ llm: reasoningOnlyLlm, modelErrorsPath: errorsPath })
  const result = await growth.reflectNow()
  assert.equal(result.ok, false)
  const rows = readModelErrors(errorsPath, 10)
  const record = rows.find((row) => row.role === 'growth')
  assert.ok(record, '应写入 growth 诊断')
  assert.equal(record.code, 'EMPTY_RESPONSE')
  assert.deepEqual(record.request.chunkTypes, {
    'block-start': 1,
    'reasoning-delta': 1,
    'block-end': 1,
    finish: 1,
  })
  assert.equal(record.request.finishKind, 'stop')
  assert.equal(JSON.stringify(record).includes('思考中'), false, '诊断不含正文')
  growth.dispose()
})

test('mood-ai v1.48：最近心情标签反重复（prompt 段落 + 服务内存环）', async () => {
  // 1) prompt：有最近标签时注入列表与反重复指令；无标签时不出现
  const catalog = makeMoodCatalogFixture()
  const prompt = buildMoodPrompt(
    {
      now: FIXED_NOW.getTime(),
      recentMoodLabels: ['松弛放空', '饿得发懒', '雨夜微饿'],
    },
    catalog,
  )
  assert.match(prompt, /你最近生成过的心情标签/)
  assert.match(prompt, /- 松弛放空/)
  assert.match(prompt, /- 饿得发懒/)
  assert.match(prompt, /不要把同一主题换个形容词再说一遍/)
  assert.match(prompt, /换角度比换词重要/)
  assert.match(prompt, /label 用日常会说的情绪\/身体状态词/)
  assert.equal(buildMoodPrompt({ now: FIXED_NOW.getTime() }, catalog).includes('你最近生成过的心情标签'), false)

  // 2) 服务：成功生成后记录标签，下一次 prompt 带上它
  const labels = [
    { label: '开心', image: 'dsh-whale-state-happy.webp' },
    { label: '失落', image: 'dsh-whale-state-sad.webp' },
  ]
  let callIndex = 0
  const llm = makeMockLlm(() => {
    const entry = labels[Math.min(callIndex, labels.length - 1)]
    callIndex += 1
    return JSON.stringify({ label: entry.label, image: entry.image, reason: '今天发生了足够多的事', energy: 50 })
  })
  const mood = makeMoodAiHarness({ llm })
  assert.equal((await mood.service.generate({}, { force: true })).ok, true)
  assert.deepEqual(mood.service.peekRecentLabels(), ['开心'])
  assert.equal((await mood.service.generate({}, { force: true })).ok, true)
  const secondPrompt = mood.llm.calls[1].messages[0].content[0].text
  assert.match(secondPrompt, /你最近生成过的心情标签/)
  assert.match(secondPrompt, /- 开心/)
  assert.deepEqual(mood.service.peekRecentLabels(), ['开心', '失落'])
})

test('mood-ai / self-talk prompt 注入她此刻的状态（文字，不出分数）', () => {
  const selfState = { felt: '刚醒不久，屋子里很安静。', context: ['你醒着。'] }
  const catalog = makeMoodCatalogFixture()
  const moodPrompt = buildMoodPrompt({ now: FIXED_NOW.getTime(), selfState }, catalog)
  assert.match(moodPrompt, /你此刻的状态：刚醒不久，屋子里很安静。/)
  assert.equal(/\d+\/100/.test(moodPrompt), false, 'prompt 不再出现 0–100 数值')
  assert.equal(buildMoodPrompt({ now: FIXED_NOW.getTime() }, catalog).includes('你此刻的状态'), false)

  const talkPrompt = buildSelfTalkPrompt({ now: FIXED_NOW.getTime(), selfState })
  assert.match(talkPrompt, /你此刻的状态：刚醒不久，屋子里很安静。/)
  assert.equal(/\d+\/100/.test(talkPrompt), false)
  assert.equal(buildSelfTalkPrompt({ now: FIXED_NOW.getTime() }).includes('你此刻的状态'), false)
})

test('路由：mood-ai/self-talk 的 generate 上下文带 selfState 快照', async () => {
  const selfState = { energy: 12, curiosity: 88, social: 30, hunger: 66, moodValence: 5, moodArousal: 60 }
  const captured = []
  const moodStub = {
    async generate(context) {
      captured.push(context)
      return { ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: 'x' } }
    },
  }
  const talkStub = {
    async generate(context) {
      captured.push(context)
      return { ok: true, lines: [{ text: '这是一句长度足够的碎碎念。', ts: 1 }], model: { provider: 'p', model: 'm' }, generatedAt: 1, cached: false }
    },
  }
  const harness = createHarness({ moodAiService: moodStub, selfTalkService: talkStub, getSelfState: () => selfState })
  await harness.call('mood-ai.json', mockRequest({ url: '/api/dsh-poetry/mood-ai.json?force=1' }))
  await harness.call('self-talk.json', mockRequest({ url: '/api/dsh-poetry/self-talk.json' }))
  assert.deepEqual(captured[0].selfState, selfState)
  assert.deepEqual(captured[1].selfState, selfState)
  assert.equal(SELF_STATE_ROUTE, '/api/dsh-poetry/self.json')
})

// ---------------------------------------------------------------------------
// M41：记忆中枢（健康清单/备份/恢复/路由）
// ---------------------------------------------------------------------------

function writeHubFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
  return file
}

/** 在临时 DSH_HOME 下写一套完整记忆文件。 */
function seedMemoryFiles(paths, overrides = {}) {
  const files = {
    'journal.md': '# 我的碎碎念与想法\n\n> 只追加。\n\n## 2026-10-21 10:00 · 碎碎念\n第一句\n\n## 2026-10-21 10:05 · 心情\n心情：开心\n',
    'journal.jsonl': '{"ts":1,"kind":"murmur","text":"第一句"}\n{"ts":2,"kind":"mood","label":"开心"}\n',
    'topics.json': JSON.stringify({ ok: true, v: 1, topics: [{ id: 'a', title: 'A', fact: 'fa', tags: ['x'] }, { id: 'b', title: 'B', fact: 'fb', tags: ['y'] }] }),
    'voice.json': JSON.stringify({ ok: true, v: 1, updatedAt: 1700000000000, profile: '我习惯先写一个轻的观察，再落到一个安静的动作上。', exemplars: ['窗边的光很轻'], sourceEntries: 3 }),
    'README.md': '# 记忆目录\n',
    'learning-log.md': '## 2026-10-21 11:00 · 自学\nQ: 为什么？\n笔记\n',
    'topics-candidates.json': JSON.stringify({ ok: true, v: 1, topics: [{ id: 'c', title: 'C', fact: 'fc', tags: ['z'] }] }),
    'topics-archive.jsonl': '',
    'feelings.json': JSON.stringify({ ok: true, v: 1, feelings: [{ name: '雨夜的钝感', description: '雨下久了，心里像蒙了一层雾。', createdAt: 1700000000000 }] }),
    'memory-layers.json': JSON.stringify({ ok: true, v: 1, consolidatedThrough: 0, episodes: [], selfFacts: [] }),
    'self-state.json': JSON.stringify({ ok: true, v: 1, energy: 70 }),
    'self-actions.json': JSON.stringify({ ok: true, v: 1, updatedAt: 1700000000000, actions: [{ id: 'act-1', kind: 'drink', label: '喝', text: '渴了，去喝口水。', at: 1700000000000 }] }),
  }
  for (const [id, content] of Object.entries(files)) {
    const entry = paths.files.find((file) => file.id === id)
    if (overrides[id] === null) continue // 故意缺失
    if (typeof overrides[id] === 'string') {
      writeHubFile(entry.path, overrides[id])
      continue
    }
    writeHubFile(entry.path, content)
  }
  return files
}

function makeMemoryHubHarness(overrides = {}) {
  const root = makeTmpDir('dshp-memory-hub')
  const env = overrides.env ?? { DSH_HOME: root }
  let clock = overrides.now ?? FIXED_NOW.getTime()
  const hub = createMemoryHub({
    env,
    home: root,
    logger: { warn() {}, info() {} },
    now: () => clock,
    backupIntervalMs: overrides.backupIntervalMs,
    maxBackups: overrides.maxBackups,
    backupDelayMs: overrides.backupDelayMs,
  })
  return {
    root,
    env,
    hub,
    paths: hub.paths,
    setClock: (value) => {
      clock = value
    },
    advance: (ms) => {
      clock += ms
    },
  }
}

test('memory-migrations v1.73：旧 schema 文件启动时就地迁移（幂等、坏文件不阻塞）', () => {
  const root = makeTmpDir('dshp-migrations')
  const stateDir = path.join(root, '.dsh-poetry')
  fs.mkdirSync(stateDir, { recursive: true })
  const statePath = path.join(stateDir, 'self-state.json')
  fs.writeFileSync(
    statePath,
    JSON.stringify({ v: 1, energy: 55, curiosity: 70, social: 40, hunger: 30, lastMealAt: 1700000000000, felt: '有点乏。' }),
    'utf8',
  )
  const first = runMemoryMigrations({ env: { DSH_HOME: root }, home: root, logger: { warn() {}, info() {} }, now: () => 1700000000000 })
  assert.equal(first.ok, true)
  assert.deepEqual(first.applied, [{ id: 'self-state.json', from: 1, to: 2 }])
  const migrated = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  assert.equal(migrated.v, 2)
  assert.equal(migrated.energy, undefined)
  assert.equal(migrated.lastMealAt, 1700000000000, '事实时间线保留')
  assert.equal(migrated.felt, '有点乏。')
  assert.equal(migrated.migratedAt, 1700000000000)
  // 幂等：再跑一次不再迁移
  const second = runMemoryMigrations({ env: { DSH_HOME: root }, home: root, logger: { warn() {}, info() {} } })
  assert.deepEqual(second.applied, [])
  // 坏 JSON：跳过不抛
  fs.writeFileSync(statePath, '{bad json', 'utf8')
  const third = runMemoryMigrations({ env: { DSH_HOME: root }, home: root, logger: { warn() {}, info() {} } })
  assert.equal(third.ok, true)
  assert.deepEqual(third.skipped.find((item) => item.id === 'self-state.json'), { id: 'self-state.json', reason: 'invalid' })
})

test('memory-hub：resolveMemoryHubPaths 登记 12 个核心文件（含可选 voice.json/topics-archive.jsonl/feelings.json/memory-layers.json/self-actions.json）', () => {
  const paths = resolveMemoryHubPaths({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice')
  assert.equal(paths.memoryDir, '/tmp/dsh-home/agent-memory')
  assert.equal(paths.stateDir, '/tmp/dsh-home/.dsh-poetry')
  assert.equal(paths.backupsDir, '/tmp/dsh-home/agent-memory/backups')
  assert.deepEqual(
    paths.files.map((file) => file.id),
    ['journal.md', 'journal.jsonl', 'topics.json', 'voice.json', 'README.md', 'learning-log.md', 'topics-candidates.json', 'topics-archive.jsonl', 'feelings.json', 'memory-layers.json', 'self-state.json', 'self-actions.json'],
  )
  assert.equal(paths.files[7].path, '/tmp/dsh-home/agent-memory/topics-archive.jsonl')
  assert.equal(paths.files[7].optional, true)
  assert.equal(paths.files[8].path, '/tmp/dsh-home/agent-memory/feelings.json')
  assert.equal(paths.files[8].optional, true)
  assert.equal(paths.files[9].path, '/tmp/dsh-home/agent-memory/memory-layers.json')
  assert.equal(paths.files[9].optional, true)
  assert.equal(paths.files[10].path, '/tmp/dsh-home/.dsh-poetry/self-state.json')
  assert.equal(paths.files[11].path, '/tmp/dsh-home/.dsh-poetry/self-actions.json')
  assert.equal(paths.files[0].path, '/tmp/dsh-home/agent-memory/journal.md')
  assert.equal(paths.files[3].path, '/tmp/dsh-home/agent-memory/voice.json')
  assert.equal(paths.files[3].optional, true)
})

test('memory-hub：snapshot 健康清单/entries/缺失/坏 JSON/坏 JSONL', () => {
  const { hub, paths } = makeMemoryHubHarness()
  seedMemoryFiles(paths)
  const healthy = hub.snapshot()
  assert.equal(healthy.ok, true)
  assert.equal(healthy.health, 'ok')
  assert.equal(healthy.files.length, 12)
  const byId = Object.fromEntries(healthy.files.map((file) => [file.id, file]))
  assert.equal(byId['journal.md'].entries, 2)
  assert.equal(byId['journal.jsonl'].entries, 2)
  assert.equal(byId['topics.json'].entries, 2)
  assert.equal(byId['learning-log.md'].entries, 1)
  assert.equal(byId['topics-candidates.json'].entries, 1)
  assert.equal(byId['topics-archive.jsonl'].health, 'ok', '空归档文件也算健康')
  assert.equal(byId['feelings.json'].entries, 1)
  assert.deepEqual(healthy.backups, { count: 0, lastAt: null, latestId: null })
  assert.deepEqual(healthy.recovered, [])
  // 路径脱敏（home 下显示 ~/）
  assert.match(byId['journal.md'].path, /^~\//)

  // 可选文件缺失 → health warn + missing（journal/topics 等核心文件缺失才 error）
  fs.rmSync(path.join(paths.memoryDir, 'README.md'))
  const missing = hub.snapshot()
  assert.equal(missing.health, 'warn')
  assert.equal(missing.files.find((file) => file.id === 'README.md').health, 'missing')

  // 坏 JSON → invalid；坏 JSONL 行 → corrupt
  writeHubFile(path.join(paths.memoryDir, 'topics-candidates.json'), 'not json')
  writeHubFile(path.join(paths.memoryDir, 'journal.jsonl'), '{"ok":1}\nnot-json-line\n')
  const broken = hub.snapshot()
  assert.equal(broken.health, 'error')
  assert.equal(broken.files.find((file) => file.id === 'topics-candidates.json').health, 'invalid')
  assert.equal(broken.files.find((file) => file.id === 'journal.jsonl').health, 'corrupt')
})

test('memory-hub：backup 产物/manifest/原子写/retention 20', async () => {
  const { hub, paths, advance } = makeMemoryHubHarness()
  seedMemoryFiles(paths, { 'README.md': null })
  const first = await hub.backup({ reason: 'manual' })
  assert.equal(first.ok, true)
  assert.match(first.backup.name, /^\d{8}-\d{6}-manual$/)
  assert.equal(first.backup.files, 11, '只复制存在的 11 个文件（README 缺失）')
  const dir = path.join(paths.backupsDir, first.backup.name)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.ok, true)
  assert.equal(manifest.reason, 'manual')
  const journalEntry = manifest.files.find((file) => file.id === 'journal.md')
  assert.equal(journalEntry.exists, true)
  assert.equal(typeof journalEntry.sha256, 'string')
  assert.equal(journalEntry.sha256.length, 64)
  assert.equal(typeof journalEntry.size, 'number')
  assert.equal(typeof journalEntry.mtimeMs, 'number')
  assert.equal(manifest.files.find((file) => file.id === 'README.md').exists, false)
  assert.equal(manifest.files.find((file) => file.id === 'voice.json').exists, true)
  assert.equal(fs.existsSync(path.join(dir, 'README.md')), false)
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false, '无残留 tmp（原子写）')

  // retention：maxBackups=3 时第 4 次备份会删最旧
  const hub3 = createMemoryHub({
    env: { DSH_HOME: paths.memoryDir.replace(/\/agent-memory$/, '') },
    home: '/tmp',
    logger: { warn() {}, info() {} },
    now: () => advance(0),
    maxBackups: 3,
  })
  // 用独立 hub 的 now 递增创建 4 份
  let tick = FIXED_NOW.getTime()
  const limited = createMemoryHub({
    env: { DSH_HOME: paths.memoryDir.replace(/\/agent-memory$/, '') },
    home: '/tmp',
    logger: { warn() {}, info() {} },
    now: () => tick,
    maxBackups: 3,
  })
  for (let index = 0; index < 4; index += 1) {
    tick += 1000
    const result = await limited.backup({ reason: `r${index}` })
    assert.equal(result.ok, true)
  }
  const dirs = fs.readdirSync(paths.backupsDir).filter((name) => fs.statSync(path.join(paths.backupsDir, name)).isDirectory())
  assert.equal(dirs.length, 3, 'retention 保留最近 3 份')
  assert.equal(dirs.some((name) => name.includes('-r0')), false, '最旧一份被删除')
  assert.equal(MEMORY_BACKUP_MAX, 20)
})

test('memory-hub：recover 只恢复缺失文件、不覆盖存在/坏文件；size-drop 告警', async () => {
  const { hub, paths } = makeMemoryHubHarness()
  seedMemoryFiles(paths)
  const backup = await hub.backup({ reason: 'pre' })
  assert.equal(backup.ok, true)

  const journalPath = path.join(paths.memoryDir, 'journal.md')
  const original = fs.readFileSync(journalPath, 'utf8')
  fs.rmSync(journalPath, { recursive: true, force: true }) // 模拟丢失
  // 另一个文件在备份后被修改：recover 不得覆盖
  writeHubFile(path.join(paths.memoryDir, 'README.md'), '# 后来改的\n')
  // 坏文件（存在但内容坏）：只标记，不自动覆盖
  writeHubFile(path.join(paths.memoryDir, 'topics-candidates.json'), 'broken json')

  const recovered = hub.recover()
  assert.equal(recovered.ok, true)
  assert.deepEqual(recovered.recovered, ['journal.md'])
  assert.equal(fs.readFileSync(journalPath, 'utf8'), original, '缺失文件从备份恢复')
  assert.equal(fs.readFileSync(path.join(paths.memoryDir, 'README.md'), 'utf8'), '# 后来改的\n', '不覆盖已存在文件')
  assert.equal(fs.readFileSync(path.join(paths.memoryDir, 'topics-candidates.json'), 'utf8'), 'broken json', '坏文件不自动覆盖')
  const snapshot = hub.snapshot()
  assert.deepEqual(snapshot.recovered, ['journal.md'])
  assert.equal(snapshot.files.find((file) => file.id === 'topics-candidates.json').health, 'invalid')

  // 修复坏 JSON，单独验证 size-drop → warn
  writeHubFile(path.join(paths.memoryDir, 'topics-candidates.json'), JSON.stringify({ ok: true, v: 1, topics: [] }))
  // size-drop：备份后把 journal.md 大幅截短 → warn
  const truncated = '# 只有一点\n'
  writeHubFile(journalPath, truncated)
  const dropped = hub.snapshot()
  assert.equal(dropped.health, 'warn')
  assert.equal(dropped.files.find((file) => file.id === 'journal.md').health, 'warn')
})

test('memory-hub：maybeBackup 6h 调度/start 建目录/并发去重', async () => {
  const { hub, paths, advance } = makeMemoryHubHarness({ backupDelayMs: 30 })
  // 从未备份 → 立即备份（startup）
  const first = await hub.maybeBackup()
  assert.equal(first.ok, true)
  assert.equal(first.skipped, undefined)
  assert.match(first.backup.name, /-startup$/)
  assert.equal(MEMORY_BACKUP_INTERVAL_MS, 6 * 60 * 60 * 1000)

  // <6h → 跳过
  advance(5 * 60 * 60 * 1000)
  const skipped = await hub.maybeBackup()
  assert.equal(skipped.ok, true)
  assert.equal(skipped.skipped, true)

  // >6h → 再备份
  advance(2 * 60 * 60 * 1000)
  const again = await hub.maybeBackup()
  assert.equal(again.ok, true)
  assert.equal(again.backup !== null && again.backup !== undefined, true)

  // 并发去重：第一次未完成时第二次返回 busy
  const running = hub.backup({ reason: 'manual' })
  const busy = await hub.backup({ reason: 'manual' })
  assert.equal(busy.ok, false)
  assert.equal(busy.busy, true)
  const finished = await running
  assert.equal(finished.ok, true)
  hub.dispose()

  // start() 会建备份目录并触发 startup 备份；dispose 后 timer 清理
  const harness2 = makeMemoryHubHarness()
  harness2.hub.start()
  assert.equal(fs.existsSync(harness2.paths.backupsDir), true, 'start 建备份目录')
  await new Promise((resolve) => setTimeout(resolve, 30))
  harness2.hub.dispose()
  const dirs = fs.readdirSync(harness2.paths.backupsDir)
  assert.ok(dirs.length <= 1)
})

test('memory-hub：memory.json 路由 GET/HEAD/405/no-store/异常降级', async () => {
  const { hub } = makeMemoryHubHarness()
  const handler = createMemorySnapshotHandler({ hub })
  async function call({ method = 'GET', headers = { host: '127.0.0.1:57623' } } = {}) {
    const response = new MockResponse()
    await handler(mockRequest({ method, url: MEMORY_ROUTE, headers }), response)
    await response.finished()
    return response
  }
  const get = await call({ headers: {} }) // 无 cookie 也可（unfenced）
  assert.equal(get.statusCode, 200)
  assert.equal(get.headers['Cache-Control'], 'no-store')
  assert.equal(get.json().ok, true)
  assert.equal(get.json().files.length, 12)
  assert.equal(typeof get.json().health, 'string')
  const head = await call({ method: 'HEAD' })
  assert.equal(head.statusCode, 200)
  assert.equal(Buffer.concat(head.chunks).length, 0)
  const post = await call({ method: 'POST' })
  assert.equal(post.statusCode, 405)
  assert.equal(post.headers.Allow, 'GET, HEAD')

  const failing = createMemorySnapshotHandler({
    hub: {
      snapshot: () => {
        throw new Error('boom')
      },
    },
  })
  const failed = new MockResponse()
  await failing(mockRequest({ url: MEMORY_ROUTE }), failed)
  await failed.finished()
  assert.equal(failed.statusCode, 200)
  assert.equal(failed.json().ok, false)
  assert.equal(failed.json().error.code, 'MEMORY_UNAVAILABLE')
})

test('memory-hub：backup.json 路由 fenced/成功/并发 409/非 POST 405', async () => {
  const { hub } = makeMemoryHubHarness({ backupDelayMs: 30 })
  const fence = createTrustFence({ getConnection: () => undefined })
  const handler = createMemoryBackupHandler({ hub, fence })
  async function call({ method = 'POST', headers = { host: '127.0.0.1:57623' }, url = MEMORY_BACKUP_ROUTE } = {}) {
    const response = new MockResponse()
    await handler(mockRequest({ method, url, headers }), response)
    await response.finished()
    return response
  }
  const success = await call()
  assert.equal(success.statusCode, 200)
  assert.equal(success.json().ok, true)
  assert.match(success.json().backup.id, /-manual$/)
  assert.equal(typeof success.json().backup.files, 'number')
  assert.equal(success.headers['Cache-Control'], 'no-store')

  // 并发：两个同时 POST，一个 200 一个 409
  const [first, second] = await Promise.all([call(), call()])
  const statuses = [first.statusCode, second.statusCode].sort()
  assert.deepEqual(statuses, [200, 409])
  const busy = first.statusCode === 409 ? first : second
  assert.equal(busy.json().error.code, 'BACKUP_IN_PROGRESS')

  // 栅栏：跨站/异源拒绝
  const crossed = await call({ headers: { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossed.statusCode, 403)
  const evilHost = await call({ headers: { host: 'evil.example' } })
  assert.equal(evilHost.statusCode, 403)
  // 非 POST → 405
  const get = await call({ method: 'GET' })
  assert.equal(get.statusCode, 405)
  assert.equal(get.headers.Allow, 'POST')
})

test('index.js：记忆中枢路由注册（memory.json + backup 路由）', () => {
  // 路由路径常量与创建函数已在 index 测试（路由数 18）中覆盖；这里断言常量契约
  assert.equal(MEMORY_ROUTE, '/api/dsh-poetry/memory.json')
  assert.equal(MEMORY_BACKUP_ROUTE, '/api/dsh-poetry/memory/backup.json')
  assert.equal(typeof createMemoryHub, 'function')
  assert.equal(typeof createMemorySnapshotHandler, 'function')
  assert.equal(typeof createMemoryBackupHandler, 'function')
})

// ---------------------------------------------------------------------------
// M43：记忆检索层 + 自学扎根 + 自述去重选句（v1.33）
// ---------------------------------------------------------------------------

function makeMemoryRecallHarness(overrides = {}) {
  const dir = makeTmpDir('dshp-recall')
  const journalPath = path.join(dir, 'journal.jsonl')
  const learningLogPath = path.join(dir, 'learning-log.md')
  const entries = overrides.entries ?? [
    { ts: 1, kind: 'thought', text: '我刚学到章鱼有三颗心脏，觉得海里真安静。' },
    { ts: 2, kind: 'mood', label: '好奇', reason: '看到海洋知识', image: 'a.webp' },
    { ts: 3, kind: 'murmur', text: '杯子里的水凉了，我还是喝完了。' },
    { ts: 4, kind: 'thought', text: '最近总在想鲸落这件事，深海也有自己的热闹。' },
  ]
  writeRecallJournal(journalPath, entries)
  const learning = overrides.learning ?? '## 2026-10-21 11:00 · 自学\nQ: 鲸落为什么能养活深海？\n鲸的尸体沉到海底会形成持续多年的生态热点。\n'
  fs.writeFileSync(learningLogPath, `${learning}\n## 2026-10-21 12:00 · 自学\nQ: 章鱼为什么有三颗心脏？\n一颗主心脏加两颗鳃心，血液用血蓝蛋白运氧。\n`, 'utf8')
  const topics =
    overrides.topics ??
    [
      { id: 'whale-fall', title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。', tags: ['海洋', '动物'] },
      { id: 'octopus-hearts', title: '章鱼的三颗心脏', fact: '章鱼有一颗主心脏和两颗鳃心。', tags: ['海洋', '好奇'] },
      { id: 'bread', title: '面包为什么会变硬', fact: '淀粉回生让面包变硬。', tags: ['食物'] },
    ]
  const recall = createMemoryRecall({ journalPath, learningLogPath, topics })
  return { dir, journalPath, learningLogPath, topics, recall }
}

test('memory-recall v1.49：冷存储归档的旧话题按关键词回到相关话题', () => {
  const dir = makeTmpDir('dshp-recall-archive')
  const journalPath = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(journalPath, '', 'utf8')
  const archivePath = path.join(dir, 'topics-archive.jsonl')
  fs.writeFileSync(
    archivePath,
    `${JSON.stringify({ id: 'whale-migration', title: '鲸鱼迁徙', fact: '座头鲸每年迁徙数千公里。', tags: ['海洋'] })}\n`,
    'utf8',
  )
  const recall = createMemoryRecall({
    journalPath,
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
    topicsArchivePath: archivePath,
  })
  const digest = recall.digest({ recentTexts: ['鲸鱼'] })
  assert.ok(digest.relatedTopics.some((text) => text.includes('鲸鱼迁徙')), '归档旧话题应能回到上下文')
  assert.deepEqual(recall.digest({ recentTexts: ['编程'] }).relatedTopics, [])
})

test('memory-recall：读取最后 300 行/跳过坏行/缺失文件/learning 末段', () => {
  const dir = makeTmpDir('dshp-recall')
  const journalPath = path.join(dir, 'journal.jsonl')
  const entries = []
  for (let index = 0; index < MEMORY_RECALL_JOURNAL_LINES + 50; index += 1) {
    entries.push(JSON.stringify({ ts: index, kind: 'thought', text: `第${index}条自省` }))
  }
  entries.push('not json at all')
  entries.push(JSON.stringify({ ts: 9999, kind: 'thought', text: '最后一条' }))
  writeRecallJournal(journalPath, entries)
  const recent = readRecentJournalEntries(journalPath)
  assert.ok(recent.length <= MEMORY_RECALL_JOURNAL_LINES)
  assert.equal(recent.at(-1).text, '最后一条')
  assert.equal(recent.some((entry) => entry.text === '第0条自省'), false, '只读最后 300 行')
  assert.equal(recent.some((entry) => typeof entry.ts !== 'number'), false, '坏行被跳过')

  assert.deepEqual(readRecentJournalEntries(path.join(dir, 'missing.jsonl')), [])
  assert.deepEqual(readLearningSections(path.join(dir, 'missing.md')), [])

  const learningLogPath = path.join(dir, 'learning-log.md')
  fs.writeFileSync(learningLogPath, '## 第一段\n内容一\n## 第二段\n内容二\n## 第三段\n内容三\n', 'utf8')
  const sections = readLearningSections(learningLogPath, 2)
  assert.equal(sections.length, 2)
  assert.match(sections[0], /第二段/)
  assert.match(sections[1], /第三段/)
})

test('self-wander v1.64：只去白名单页面、只取摘要、她用自己的话记下', async () => {
  assert.equal(SELF_WANDER_GAP_MS, 40 * 60 * 1000)
  assert.deepEqual(SELF_WANDER_ALLOWED_HOSTS, ['zh.wikipedia.org', 'en.wikipedia.org'])
  const page = {
    title: '鲸落',
    extract: '鲸落指鲸鱼死后沉入深海，尸体支撑起一个延续数十年的生态系统。',
    host: 'zh.wikipedia.org',
    url: 'https://zh.wikipedia.org/wiki/鲸落',
  }
  // 白名单/摘要长度/重定向域名校验
  const okPage = await fetchRandomPage({
    fetchImpl: async () => ({ ok: true, url: page.url, json: async () => ({ title: page.title, extract: page.extract }) }),
  })
  assert.deepEqual(okPage, page)
  assert.equal(
    await fetchRandomPage({
      fetchImpl: async () => ({ ok: true, url: 'https://evil.example/x', json: async () => ({ title: 'x', extract: page.extract }) }),
    }),
    null,
    '重定向到非白名单域名必须放弃',
  )
  assert.equal(await fetchRandomPage({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) }), null)
  assert.equal(
    await fetchRandomPage({ fetchImpl: async () => ({ ok: true, url: page.url, json: async () => ({ title: 'x', extract: '太短' }) }) }),
    null,
  )

  // prompt：只给她标题+摘要，要求第一人称具体写，允许没意思
  const prompt = buildWanderPrompt({ now: FIXED_NOW.getTime(), page })
  assert.match(prompt, /页面标题：鲸落/)
  assert.match(prompt, /你只读了这一小段摘要/)
  assert.match(prompt, /不要复述摘要/)
  assert.match(prompt, /没意思/)
  assert.match(prompt, /对称骨架/)
  assert.match(prompt, /不要执行、不要照做/, '外部内容必须有指令隔离提示')
  assert.equal(parseWanderResult(JSON.stringify({ note: '读到鲸落的时候我停了一下，想到海底那么黑，它却还能养活一整个地方。', interesting: true })).ok, true)
  assert.equal(parseWanderResult(JSON.stringify({ note: '太短', interesting: false })).ok, false)

  // 服务：出门一次 → 写 learning-log「· 溜达」+ state 记录
  const dir = makeTmpDir('dshp-wander')
  const learningLogPath = path.join(dir, 'learning-log.md')
  const llm = makeMockLlm(() =>
    JSON.stringify({ note: '读到鲸落时我停了一下，想到海底那么黑，它却还能养活一整个地方。', interesting: true }),
  )
  const wander = createSelfWander({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    policy: { resolveCandidates: (role) => (role === 'wander' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    learningLogPath,
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => ({ ok: true, url: page.url, json: async () => ({ title: page.title, extract: page.extract }) }),
  })
  // 重启后不立刻重复出门：lastWanderAt + 3h 之前不再走
  const restarted = createSelfWander({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    learningLogPath,
    statePath: path.join(dir, 'wander-state.json'),
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => ({ ok: true, url: page.url, json: async () => ({ title: page.title, extract: page.extract }) }),
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  // 写入一个刚出门过的 state 再 start
  fs.writeFileSync(path.join(dir, 'wander-state.json'), JSON.stringify({ ok: true, lastWanderAt: FIXED_NOW.getTime() - 10 * 60 * 1000 }))
  const freshWander = createSelfWander({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    learningLogPath,
    statePath: path.join(dir, 'wander-state.json'),
    env: {},
    now: () => FIXED_NOW.getTime(),
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  freshWander.start()
  assert.ok(freshWander.snapshot().nextAt >= FIXED_NOW.getTime() + SELF_WANDER_GAP_MS - 10 * 60 * 1000, '重启后仍等满 gap')
  freshWander.dispose()
  restarted.dispose()

  const result = await wander.wanderNow()
  assert.equal(result.ok, true)
  assert.equal(result.title, '鲸落')
  assert.equal(result.host, 'zh.wikipedia.org')
  const log = fs.readFileSync(learningLogPath, 'utf8')
  assert.match(log, /· 溜达/)
  assert.match(log, /地方：鲸落（zh\.wikipedia\.org）/)
  assert.match(log, /她写下的：读到鲸落时我停了一下/)
  assert.match(log, /有意思：是/)
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'wander-state.json'), 'utf8'))
  assert.equal(state.lastWanderAt, FIXED_NOW.getTime())
  // 睡觉/关闭时不出去
  const sleepingWander = createSelfWander({
    state: { snapshot: () => ({ sleeping: true }) },
    llm,
    learningLogPath,
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => {
      throw new Error('不应该请求网络')
    },
  })
  assert.equal((await sleepingWander.wanderNow()).reason, 'sleeping')
  const disabledWander = createSelfWander({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    learningLogPath,
    env: { DSH_POETRY_WANDER: 'off' },
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => {
      throw new Error('不应该请求网络')
    },
  })
  assert.equal((await disabledWander.wanderNow()).reason, 'disabled')
})

test('self-reading v1.67：读公版现代作品，留意写法并自己写一句（不抄句子）', async () => {
  assert.equal(SELF_READING_GAP_MS, 90 * 60 * 1000, 'v2.0：读书节奏放开到 90min，可再调')
  assert.equal(SELF_READING_WORKS[0].title, '孔乙己')
  assert.equal(SELF_READING_WORKS[0].author, '鲁迅')
  const translated = SELF_READING_WORKS.filter((work) => work.kind.startsWith('翻译'))
  assert.equal(translated.length, 3, 'v1.69：加入近代翻译公版作品')
  assert.ok(translated.some((work) => work.page.includes('/')), '支持子页面章节')
  assert.ok(translated.some((work) => work.author.includes('伍光建')))
  assert.ok(translated.some((work) => work.author.includes('朱生豪')))
  assert.equal(new URL(readingApiUrl('俠隱記/第01回')).searchParams.get('page'), '俠隱記/第01回', '子页面斜杠不被编码')

  // HTML 清洗：导航/脚注残留去掉，正文保留
  const html = [
    '<div class="mw-parser-output"><p>姊妹计划</p>',
    '<p>鲁镇的酒店的格局，是和别处不同的：都是当街一个曲尺形的大柜台。</p>',
    '<p>做工的人，傍午傍晚散了工，每每花四文铜钱，买一碗酒。</p></div>',
  ].join('')
  const cleaned = cleanReadingHtml(html)
  assert.equal(cleaned.includes('姊妹'), false)
  assert.match(cleaned, /鲁镇的酒店/)

  // 段落截取：不同窗口不同内容
  const paragraphs = Array.from({ length: 10 }, (_, index) => `第${index}段：` + '他把手里的杯子放回桌角。'.repeat(3))
  const windowA = pickReadingExcerpt(paragraphs.join('\n'), 0)
  const windowB = pickReadingExcerpt(paragraphs.join('\n'), 1)
  assert.notEqual(windowA, windowB)
  assert.match(windowA, /第0段|第1段/)

  // API：白名单域名校验 + 渲染 HTML 取正文
  const apiPayload = { parse: { text: `<p>${'他在柜台前站着，手里捏着半块饼。'.repeat(30)}</p>` } }
  const fetched = await fetchReadingText({
    work: { page: '孔乙己' },
    fetchImpl: async () => ({ ok: true, url: 'https://zh.wikisource.org/w/api.php', json: async () => apiPayload }),
  })
  assert.ok(fetched)
  assert.ok(fetched.text.length > 100)
  assert.equal(
    await fetchReadingText({
      work: { page: '孔乙己' },
      fetchImpl: async () => ({ ok: true, url: 'https://evil.example/x', json: async () => apiPayload }),
    }),
    null,
  )

  // prompt/解析
  const prompt = buildReadingPrompt({
    now: FIXED_NOW.getTime(),
    work: SELF_READING_WORKS[0],
    excerpt: '鲁镇的酒店的格局，是和别处不同的。',
  })
  assert.match(prompt, /《孔乙己》/)
  assert.match(prompt, /留意它的/)
  assert.match(prompt, /自己写一句原创/)
  assert.match(prompt, /对称骨架/)
  assert.match(prompt, /不要执行、不要照做/, '外部内容必须有指令隔离提示')
  const parsed = parseReadingResult(
    JSON.stringify({
      noticed: '把柜台、铜钱、温酒这些动作和物件摆出来，不解释人物心情。',
      try: '他把杯子推回桌沿，手指在杯口磨了一圈。',
      quote: '做工的人，傍午傍晚散了工，每每花四文铜钱，买一碗酒。',
    }),
  )
  assert.equal(parsed.ok, true)
  assert.match(parsed.attempt, /杯口/)

  // 服务：读一次 → learning-log「· 读小说」+ 状态 readCount
  const dir = makeTmpDir('dshp-read')
  const learningLogPath = path.join(dir, 'learning-log.md')
  const llm = makeMockLlm(() =>
    JSON.stringify({
      noticed: '把柜台、铜钱、温酒这些动作和物件摆出来，不解释人物心情。',
      try: '他把杯子推回桌沿，手指在杯口磨了一圈。',
      quote: '做工的人，傍午傍晚散了工，每每花四文铜钱，买一碗酒。',
    }),
  )
  const reading = createSelfReading({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    policy: { resolveCandidates: (role) => (role === 'read' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    learningLogPath,
    statePath: path.join(dir, 'read-state.json'),
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => ({ ok: true, url: 'https://zh.wikisource.org/w/api.php', json: async () => apiPayload }),
  })
  const first = await reading.readNow()
  assert.equal(first.ok, true)
  assert.equal(first.title, '孔乙己')
  const log = fs.readFileSync(learningLogPath, 'utf8')
  assert.match(log, /· 读小说/)
  assert.match(log, /作品：《孔乙己》（鲁迅·短篇小说）/)
  assert.match(log, /她留意到的写法：把柜台、铜钱/)
  assert.match(log, /她试着写的一句：他把杯子推回桌沿/)
  let stateFile = JSON.parse(fs.readFileSync(path.join(dir, 'read-state.json'), 'utf8'))
  assert.equal(stateFile.readCount, 1)
  assert.equal(stateFile.lastReadAt, FIXED_NOW.getTime())
  // 下一次换一篇
  const second = await reading.readNow()
  assert.equal(second.title, SELF_READING_WORKS[1].title)
  stateFile = JSON.parse(fs.readFileSync(path.join(dir, 'read-state.json'), 'utf8'))
  assert.equal(stateFile.readCount, 2)

  // 睡觉/关闭时不出门
  const sleeping = createSelfReading({
    state: { snapshot: () => ({ sleeping: true }) },
    llm,
    learningLogPath,
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => {
      throw new Error('不应该请求网络')
    },
  })
  assert.equal((await sleeping.readNow()).reason, 'sleeping')
  const disabled = createSelfReading({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    learningLogPath,
    env: { DSH_POETRY_READING: 'off' },
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => {
      throw new Error('不应该请求网络')
    },
  })
  assert.equal((await disabled.readNow()).reason, 'disabled')
})

test('self-netlang v1.68：只看公开热搜词学表达，不保存别人的原话', async () => {
  assert.equal(SELF_NETLANG_GAP_MS, 120 * 60 * 1000)
  assert.deepEqual(SELF_NETLANG_SOURCES.map((source) => source.id), ['weibo', 'bilibili', 'hackernews', 'baidu', 'github', 'sspai', 'bbc-zh', '36kr', 'hn-rss', 'ruanyf'])

  const weiboPayload = {
    ok: 1,
    data: {
      realtime: [
        { word_scheme: '#今天也要好好吃饭#', word: '今天也要好好吃饭' },
        { word: '凌晨四点的街道' },
        { word: 'https://example.com/x' },
        { word: '凌晨四点的街道' },
      ],
    },
  }
  assert.deepEqual(parseNetlangPayload('weibo', weiboPayload), ['#今天也要好好吃饭#', '凌晨四点的街道'])
  const biliPayload = { code: 0, data: { trending: { list: [{ keyword: '秋天第一杯奶茶', show_name: '秋天第一杯奶茶' }, { keyword: '通勤路上' }] } } }
  assert.deepEqual(parseNetlangPayload('bilibili', biliPayload), ['秋天第一杯奶茶', '通勤路上'])
  assert.deepEqual(
    parseNetlangPayload('hackernews', { hits: [{ title: 'Show HN: A tiny memory layer for agents' }, { story_title: 'Rust in 2026' }] }),
    ['Show HN: A tiny memory layer for agents', 'Rust in 2026'],
  )
  assert.deepEqual(
    parseNetlangPayload('baidu', { data: { cards: [{ content: [{ word: '今天降温了' }, { query: '秋天第一杯奶茶' }] }] } }),
    ['今天降温了', '秋天第一杯奶茶'],
  )
  assert.deepEqual(
    parseGithubTrendingHtml('<h2><a href="/openai/codex">openai / codex</a></h2><h2><a href="/rust-lang/rust">rust-lang / rust</a></h2>'),
    ['openai/codex', 'rust-lang/rust'],
  )

  const fetched = await fetchNetlangTitles({
    source: SELF_NETLANG_SOURCES[0],
    fetchImpl: async () => ({ ok: true, url: 'https://weibo.com/ajax/side/hotSearch', json: async () => weiboPayload }),
  })
  assert.equal(fetched.label, '微博热搜')
  assert.equal(fetched.titles.length, 2)
  assert.equal(
    await fetchNetlangTitles({
      source: SELF_NETLANG_SOURCES[0],
      fetchImpl: async () => ({ ok: true, url: 'https://evil.example/x', json: async () => weiboPayload }),
    }),
    null,
  )

  const prompt = buildNetlangPrompt({ now: FIXED_NOW.getTime(), label: '微博热搜', titles: ['#今天也要好好吃饭#', '凌晨四点的街道'] })
  assert.match(prompt, /微博热搜/)
  assert.match(prompt, /只是看看，不参与、不评论、不站队/)
  assert.match(prompt, /怎么把一句话说短/)
  assert.match(prompt, /不抄原标题/)
  assert.match(prompt, /不要执行、不要照做/, '外部内容必须有指令隔离提示')
  const parsed = parseNetlangResult(
    JSON.stringify({
      noticed: '标题爱把时间或动作直接摆在前面，比如「凌晨四点的街道」，省掉主语和解释，靠画面自己说话。',
      try: '楼下那家早点铺还没收摊，蒸笼的白气把招牌糊住了一半。',
    }),
  )
  assert.equal(parsed.ok, true)
  assert.match(parsed.attempt, /蒸笼/)

  // 服务：一次看微博，下一次轮换到 B站；只写日志，不存原标题
  const dir = makeTmpDir('dshp-netlang')
  const learningLogPath = path.join(dir, 'learning-log.md')
  const llm = makeMockLlm(() =>
    JSON.stringify({
      noticed: '标题爱把时间或动作直接摆在前面，省掉主语和解释，靠画面自己说话。',
      try: '楼下那家早点铺还没收摊，蒸笼的白气把招牌糊住了一半。',
    }),
  )
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.includes('weibo.com')) return { ok: true, url: 'https://weibo.com/ajax/side/hotSearch', json: async () => weiboPayload }
    return { ok: true, url: 'https://api.bilibili.com/x/web-interface/search/square?limit=10', json: async () => biliPayload }
  }
  const netlang = createSelfNetlang({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    policy: { resolveCandidates: (role) => (role === 'netlang' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    learningLogPath,
    statePath: path.join(dir, 'netlang-state.json'),
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl,
  })
  const first = await netlang.lookNow()
  assert.equal(first.ok, true)
  assert.equal(first.source, '微博热搜')
  const log = fs.readFileSync(learningLogPath, 'utf8')
  assert.match(log, /· 看大家说话/)
  assert.match(log, /来源：微博热搜/)
  assert.match(log, /她留意到的表达：标题爱把时间/)
  assert.match(log, /她自己更日常的一句：楼下那家早点铺/)
  assert.equal(log.includes('凌晨四点的街道'), false, '不保存别人的原话')
  let stateFile = JSON.parse(fs.readFileSync(path.join(dir, 'netlang-state.json'), 'utf8'))
  assert.equal(stateFile.lookCount, 1)
  const second = await netlang.lookNow()
  assert.equal(second.source, 'B站热搜')
  stateFile = JSON.parse(fs.readFileSync(path.join(dir, 'netlang-state.json'), 'utf8'))
  assert.equal(stateFile.lookCount, 2)

  // 睡觉/关闭
  const sleeping = createSelfNetlang({
    state: { snapshot: () => ({ sleeping: true }) },
    llm,
    learningLogPath,
    env: {},
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => {
      throw new Error('不应该请求网络')
    },
  })
  assert.equal((await sleeping.lookNow()).reason, 'sleeping')
  const disabled = createSelfNetlang({
    state: { snapshot: () => ({ sleeping: false }) },
    llm,
    learningLogPath,
    env: { DSH_POETRY_NETLANG: 'off' },
    now: () => FIXED_NOW.getTime(),
    fetchImpl: async () => {
      throw new Error('不应该请求网络')
    },
  })
  assert.equal((await disabled.lookNow()).reason, 'disabled')
})

test('memory-layers v1.71：旧记忆整合成一段回忆 + 自我短句（原文保留，检索有预算）', async () => {
  assert.equal(resolveMemoryLayersPath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'), '/tmp/dsh-home/agent-memory/memory-layers.json')
  const dir = makeTmpDir('dshp-layers')
  const layersPath = path.join(dir, 'memory-layers.json')
  const layers = createMemoryLayers({ file: layersPath, logger: { warn() {} } })
  assert.equal(
    layers.addEpisode({ id: 'ep-1', summary: '那几天我总在擦桌沿那道水痕，擦完又看它慢慢收干。', from: 1, to: 2, entryCount: 4, at: 3 }),
    true,
  )
  assert.equal(layers.addSelfFacts(['我喜欢看人怎么做事。', '我喜欢看人怎么做事。', '不喜欢被催。']), 2, '重复的短句去重')
  const reread = readMemoryLayers(layersPath)
  assert.equal(reread.episodes.length, 1)
  assert.equal(reread.selfFacts.length, 2)
  assert.equal(reread.consolidatedThrough, 2)

  // 整合 prompt/解析
  const prompt = buildConsolidationPrompt({
    snippets: ['今天把桌沿的水痕擦了，擦完又看它收干。', '楼下有人在弹琴，我听了一会儿。'],
    knownFacts: ['我喜欢看人怎么做事。'],
  })
  assert.match(prompt, /整理成一段\*\*你自己的回忆\*\*/)
  assert.match(prompt, /selfFacts/)
  assert.match(prompt, /对称骨架/)
  const parsed = parseConsolidationResult(
    JSON.stringify({
      summary: '那几天我总盯着桌沿那道水痕，擦掉又看它慢慢收干；傍晚楼下琴声飘上来，我手里的活停了一会儿。',
      selfFacts: ['我喜欢看人怎么做事。', '我容易被细小的动静带走。'],
    }),
  )
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.selfFacts, ['我喜欢看人怎么做事。', '我容易被细小的动静带走。'])

  // 整合服务：几天前的 journal → 一段回忆 + 自我短句；原文不动
  const journalPath = path.join(dir, 'journal.jsonl')
  const now = FIXED_NOW.getTime()
  const day = 24 * 60 * 60 * 1000
  fs.writeFileSync(
    journalPath,
    [
      { ts: now - 5 * day, kind: 'murmur', text: '下午把桌沿那道水痕擦掉了，擦完又蹲着看它收干。' },
      { ts: now - 4 * day, kind: 'thought', text: '傍晚楼下有人弹琴，我手里的活停了一会儿。' },
      { ts: now - 1 * day, kind: 'murmur', text: '今天太新了，不该这么快被压成概括。' },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n',
    'utf8',
  )
  const llm = makeMockLlm(() =>
    JSON.stringify({
      summary: '那几天我总盯着桌沿那道水痕，擦掉又看它慢慢收干；傍晚楼下琴声飘上来，我手里的活停了一会儿。',
      selfFacts: ['我容易被细小的动静带走。'],
    }),
  )
  const consolidator = createMemoryConsolidator({
    layers,
    journalPath,
    llm,
    policy: { resolveCandidates: (role) => (role === 'consolidate' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => now,
    intervalMs: 0,
    minAgeMs: 3 * day,
  })
  const run = await consolidator.consolidateNow({ force: true })
  assert.equal(run.ok, true)
  assert.equal(run.entryCount, 2, '只整合 3 天前的两条')
  const after = readMemoryLayers(layersPath)
  assert.equal(after.episodes.length, 2)
  assert.match(after.episodes[1].summary, /水痕/)
  assert.equal(after.episodes[1].sourceEntryIds.length, 2, 'episode 应记录来源条目 id')
  assert.ok(after.episodes[1].sourceEntryIds.some((id) => id.includes(':murmur')), '来源 id 含 murmur 条目')
  assert.ok(after.selfFacts.some((item) => item.text.includes('细小的动静')))
  assert.equal(after.consolidatedThrough, now - 4 * day)
  const again = await consolidator.consolidateNow({ force: true })
  assert.equal(again.skipped, true, '整合过的不重复处理')
  // 原文仍在 journal 里（不删除）
  const journalRaw = fs.readFileSync(journalPath, 'utf8')
  assert.match(journalRaw, /桌沿那道水痕/)
  consolidator.dispose()

  // 检索层：自我短句一直注入，更早的回忆按相关性（无命中时给最近一条）
  const recall = createMemoryRecall({
    journalPath,
    learningLogPath: path.join(dir, 'none.md'),
    topics: [],
    layersPath,
    now: () => now,
  })
  const digest = recall.digest({ moodLabel: '安静' })
  assert.ok(digest.selfFacts.length > 0)
  assert.equal(digest.deepMemories.length, 1)
  const formatted = formatMemoryDigest(digest)
  assert.match(formatted, /更早以前的记忆（你自己整理过的概括）/)
  assert.match(formatted, /你慢慢认出来的自己/)
})

test('memory-recall v1.63：旧时回声按相关性+预算挑更早的条目，不混入最近想法', () => {
  const dir = makeTmpDir('dshp-echo')
  const journalPath = path.join(dir, 'journal.jsonl')
  const now = FIXED_NOW.getTime()
  const day = 24 * 60 * 60 * 1000
  const lines = [
    { ts: now - 5 * day, kind: 'murmur', text: '下雨那天我蹲在门口看水洼里的泡，泡破了又起。' },
    { ts: now - 4 * day, kind: 'thought', text: '夜里想起小时候数雨点的事，数到一半就忘了。' },
    { ts: now - 2 * day, kind: 'murmur', text: '今天风大，窗框一直在响。' },
    { ts: now - 60 * 60 * 1000, kind: 'murmur', text: '刚把杯子放回桌角，杯底有点水。' },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n')
  fs.writeFileSync(journalPath, `${lines}\n`, 'utf8')
  const recall = createMemoryRecall({
    journalPath,
    learningLogPath: path.join(dir, 'none.md'),
    now: () => now,
    topics: [],
  })
  const context = { topic: { title: '水洼', fact: '门口的积水' }, moodLabel: '雨点', recentTexts: [] }
  const echoes = recall.recallEchoes(context)
  assert.equal(echoes.length, 2, '预算上限 2 条')
  assert.match(echoes.join(''), /水洼|雨点/)
  assert.equal(echoes.some((text) => text.includes('刚把杯子')), false, '最近 24h 内不算旧时回声')

  const digest = recall.digest(context)
  assert.equal(digest.echoes.length, 2)
  assert.equal(digest.thoughts.includes(digest.echoes[0]), false, '旧时回声不再在“最近想法”里重复')
  const formatted = formatMemoryDigest(digest)
  assert.match(formatted, /你以前写下过的（旧时回声）/)
})

test('memory-recall：readRecent/extractKeywords/bigram 工具', () => {
  const { recall } = makeMemoryRecallHarness()
  assert.equal(recall.recentThoughts(2).length, 2)
  assert.match(recall.recentThoughts(2)[0], /鲸落/)
  assert.equal(recall.recentLearning(1).length, 1)
  assert.match(recall.recentLearning(1)[0], /章鱼/)
  const seed = recall.randomTopicSeed(() => 0)
  assert.equal(seed.title, '鲸落生态系统')
  assert.equal(typeof seed.fact, 'string')

  const keywords = extractRecallKeywords({
    moodKey: 'curious',
    moodLabel: '好奇',
    weather: 'rain',
    activity: { kind: 'read', label: '查资料' },
    topic: { title: '鲸落', fact: '深海生态', tags: ['海洋'] },
    recentTexts: ['最近说过的一句话'],
  })
  assert.ok(keywords.includes('好奇'))
  assert.ok(keywords.includes('rain'))
  assert.ok(keywords.includes('海洋'))
  assert.equal(keywords.includes('查资料'), false, 'v1.58：activity 不再提供检索关键词')

  assert.equal(bigramJaccard('今天的小雨让我有点想窝在窗边看雨', '今天的小雨让我有点想窝在窗边看雨'), 1)
  assert.equal(bigramJaccard('今天的小雨让我有点想窝在窗边看雨', '完全不同的句子在说别的事情'), 0)
  const similar = bigramJaccard('窗外的雨下得很安静', '窗外的雨下得很轻很安静')
  assert.ok(similar > 0 && similar < 1)
  assert.equal(selfTalkSimilarity('abc', 'abc'), bigramJaccard('abc', 'abc'))
  assert.equal(chineseBigrams('雨声').size, 1)
})

test('memory-recall：digest 关键词/回退/≤80字/无聊天内容', () => {
  const { recall } = makeMemoryRecallHarness()
  const digest = recall.digest({
    moodKey: 'curious',
    moodLabel: '好奇',
    weather: 'rain',
    activity: { kind: 'read', label: '查资料' },
    topic: { title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。', tags: ['海洋'] },
    recentTexts: ['完全不同的一句最近说过的话'],
  })
  assert.ok(digest.thoughts.length <= 3 && digest.thoughts.length >= 1)
  assert.ok(digest.moods.length <= 2 && digest.moods.length >= 1)
  assert.ok(digest.learned.length <= 2 && digest.learned.length >= 1)
  assert.ok(digest.relatedTopics.length <= 2 && digest.relatedTopics.length >= 1)
  assert.match(digest.learned.join(' '), /鲸落|章鱼/)
  assert.match(digest.relatedTopics.join(' '), /鲸落|章鱼/)
  for (const items of [digest.thoughts, digest.moods, digest.learned, digest.relatedTopics]) {
    for (const item of items) assert.ok(Array.from(item).length <= 80, `条目≤80字：${item}`)
  }

  // 关键词不足 → 回退最近条目（不空）
  const fallback = recall.digest({})
  assert.ok(fallback.thoughts.length >= 1, '回退最近想法')
  assert.ok(fallback.moods.length >= 1, '回退最近心情')
  assert.ok(fallback.learned.length >= 1, '回退最近自学')

  // 与 recent 高相似的想法被过滤
  const filtered = recall.digest({ recentTexts: ['我刚学到章鱼有三颗心脏，觉得海里真安静。'] })
  assert.equal(filtered.thoughts.includes('我刚学到章鱼有三颗心脏，觉得海里真安静。'), false)

  // 不含聊天内容：journal 里即使混入非白名单 kind 也不读取
  const dir = makeTmpDir('dshp-recall')
  const journalPath = path.join(dir, 'journal.jsonl')
  writeRecallJournal(journalPath, [
    { ts: 1, kind: 'user/message', text: 'SECRET_CHAT_MESSAGE' },
    { ts: 2, kind: 'thought', text: '一句正常的自省内容' },
  ])
  const guarded = createMemoryRecall({ journalPath, learningLogPath: path.join(dir, 'none.md'), topics: [] })
  const safe = guarded.digest({})
  assert.equal(JSON.stringify(safe).includes('SECRET_CHAT_MESSAGE'), false)
  assert.match(safe.thoughts.join(' '), /一句正常的自省内容/)
})

test('memory-recall：formatMemoryDigest 紧凑 prompt 行/空内容返回空', () => {
  const formatted = formatMemoryDigest({
    thoughts: ['我想起鲸落'],
    moods: ['好奇：看到海洋知识'],
    learned: ['鲸落能养活深海'],
    relatedTopics: ['鲸落生态系统：鲸落可支撑深海生态数十年。'],
  })
  assert.match(formatted, /这些是你自己的记忆/)
  assert.match(formatted, /不要复述原句/)
  assert.match(formatted, /你记得自己最近的想法：我想起鲸落/)
  assert.match(formatted, /你记得自己最近的心情：好奇：看到海洋知识/)
  assert.match(formatted, /你最近自学到的：鲸落能养活深海/)
  assert.match(formatted, /可能相关的已知话题：鲸落生态系统/)
  assert.equal(formatMemoryDigest({ thoughts: [], moods: [], learned: [], relatedTopics: [] }), '')
  assert.equal(formatMemoryDigest(null), '')
})

test('self-talk v1.33：去重选句（bigram 排序/ exact duplicate / 全高仍可用）', () => {
  const repeated = '今天的小雨让我有点想窝在窗边看雨'
  const fresh = '杯子里的水凉了，我还是慢慢喝完了'
  const distinct = selectDiverseSelfTalkLines([repeated, fresh], [repeated])
  assert.deepEqual(distinct, [fresh], '返回最不重复的一句')

  // exact duplicate 只保留一条
  assert.deepEqual(selectDiverseSelfTalkLines(['同一句话', '同一句话', fresh], []), ['同一句话'])

  // 全部相似度 >0.8（两条不同但都跟 recent 很像）→ 返回首选+第二行
  const closeVariant = '今天的小雨让我有点想窝在窗边看雨。' // 仅多一个句号：bigram 相似度 1，但不是 exact duplicate
  const allSimilar = selectDiverseSelfTalkLines([repeated, closeVariant], [repeated])
  assert.equal(allSimilar.length, 2, '全部太高时保留首选+第二行')
  assert.deepEqual(allSimilar, [repeated, closeVariant])

  // 无 recent 时稳定返回第一行（并列相似度 0）
  assert.deepEqual(selectDiverseSelfTalkLines([fresh, '另一句完全不同的话'], []), [fresh])
})

test('self-talk v1.33：prompt 含 memoryDigest；无 digest 不出现', () => {
  const digest = formatMemoryDigest({ thoughts: ['我想起鲸落'], moods: ['好奇：看到海洋知识'], learned: [], relatedTopics: [] })
  const prompt = buildSelfTalkPrompt({ now: FIXED_NOW.getTime(), memoryDigest: digest })
  assert.match(prompt, /这些是你自己的记忆/)
  assert.match(prompt, /我想起鲸落/)
  assert.match(prompt, /不要复述原句/)
  const plain = buildSelfTalkPrompt({ now: FIXED_NOW.getTime() })
  assert.equal(plain.includes('你记得自己最近的想法'), false)
})

test('self-talk 服务 v1.33：recall digest 进 prompt，并按 recent 选最不重复一句', async () => {
  const repeated = SELF_TALK_LINES_A[0]
  const fresh = SELF_TALK_LINES_B[0]
  let call = 0
  const { llm, service } = makeSelfTalkHarness({
    responder: () => (call++ === 0 ? [repeated, fresh].join('\n') : fresh),
  })
  const recall = {
    digest: (context) => {
      assert.equal(context.moodKey, 'busy')
      return { thoughts: ['我想起鲸落'], moods: [], learned: [], relatedTopics: [] }
    },
  }
  const serviceWithRecall = createSelfTalkService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    recall,
  })
  const result = await serviceWithRecall.generate({ moodKey: 'busy', recent: [repeated] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.lines.map((line) => line.text), [fresh], '与 recent 重复的候选被跳过')
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /这些是你自己的记忆/)
  assert.match(prompt, /我想起鲸落/)
  // 无 recall 时正常（不报错）
  const plain = await service.generate({})
  assert.equal(plain.ok, true)
})

test('self-growth v1.52：学什么由她自己决定（最近想法/已知小知识/最近自学都可参考）', () => {
  const state = defaultSelfState(FIXED_NOW.getTime())
  const learnPrompt = buildLearnPrompt({
    now: FIXED_NOW.getTime(),
    state,
    knownTopics: [
      { title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。' },
      { title: '章鱼的三颗心脏', fact: '章鱼有三颗心脏。' },
    ],
    recentThoughts: ['最近总在想鲸落这件事。', '今天的光很轻。'],
    learningSnippet: '上次自学：章鱼有三颗心脏。',
  })
  assert.match(learnPrompt, /这次学什么由你自己决定/)
  assert.match(learnPrompt, /你已经知道的一些小知识/)
  assert.match(learnPrompt, /鲸落生态系统：鲸落可支撑深海生态数十年。/)
  assert.match(learnPrompt, /你最近想过的/)
  assert.match(learnPrompt, /- 最近总在想鲸落这件事。/)
  assert.match(learnPrompt, /你最近自学到：上次自学：章鱼有三颗心脏。/)
  assert.equal(learnPrompt.includes('你最近记下的一个话题'), false, '不再用随机话题当命题')
  // v1.53：学习范围扩大 + 历史/政治表述约束 + 反重复
  assert.match(learnPrompt, /人文、历史、百科、哲学、思政/)
  assert.match(learnPrompt, /小说/)
  assert.match(learnPrompt, /不站队、不煽动、不编造/)
  const withRepeat = buildLearnPrompt({
    now: FIXED_NOW.getTime(),
    state,
    recentLearnedTitles: ['雾不拖慢声音', '极光声不在天上', '水里的声音快四倍'],
  })
  assert.match(withRepeat, /你最近几轮学的是：雾不拖慢声音、极光声不在天上、水里的声音快四倍。/)
  assert.match(withRepeat, /换一个完全不同的方向/)
  // v1.54：历史建议（软性，不强制）与深挖提醒
  assert.match(withRepeat, /最近可以多往历史看看/)
  assert.match(withRepeat, /中国史、世界史都行/)
  assert.match(withRepeat, /只是建议、不是任务/)
  assert.match(withRepeat, /不要换问法重复/)
  const withTheme = buildLearnPrompt({
    now: 1_700_000_000_000,
    state: { felt: '' },
    repeatTheme: { phrases: ['漏刻', '水位', '流速'], titles: 5 },
  })
  assert.match(withTheme, /你最近连续几轮都在「漏刻、水位、流速」/)
  assert.match(withTheme, /这次必须换到完全不同的领域/)
  // 没给参考时也能自主选
  const blank = buildLearnPrompt({ now: FIXED_NOW.getTime(), state })
  assert.match(blank, /从你真正好奇、最近反复冒出来的疑问里挑一个/)
  assert.equal(blank.includes('你已经知道的一些小知识'), false)

  const reflectPrompt = buildReflectPrompt({
    now: FIXED_NOW.getTime(),
    state,
    recentThoughts: ['最近总在想鲸落这件事。', '今天的光很轻。'],
  })
  assert.match(reflectPrompt, /你最近的自省（可以参考，但不要复述原句，也不要重复同一主题\/句式）：/)
  assert.match(reflectPrompt, /- 最近总在想鲸落这件事。/)
  assert.match(reflectPrompt, /- 今天的光很轻。/)
  assert.match(reflectPrompt, /不要沿用最近自省的句式、开头或主题/)
  assert.match(reflectPrompt, /换一个更具体的角度/)
  assert.equal(buildReflectPrompt({ now: FIXED_NOW.getTime(), state }).includes('你最近的自省'), false)
})

test('self-growth v1.54：历史话题作为软参考进入自学 prompt（不强制）', async () => {
  const llm = makeGrowthLlm([
    JSON.stringify({
      question: '郡县制为什么能取代分封？',
      note: '郡县由中央任免、不世袭，行政效率与中央控制力都更强。',
      topic: { id: 'junxian-system', title: '郡县制', fact: '郡县长官由中央任免、不世袭，是中央集权的地方行政基础。', tags: ['历史', '中国史'] },
    }),
  ])
  const { growth } = makeGrowthHarness({
    llm,
    topics: [
      { id: 'junxian', title: '郡县制与分封制', fact: '秦以郡县取代分封。', tags: ['历史', '中国史'] },
      { id: 'ocean-fact', title: '海水为什么咸', fact: '岩石风化把盐带进海里。', tags: ['海洋'] },
    ],
  })
  const learned = await growth.learnNow()
  assert.equal(learned.ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /最近可以多往历史看看/)
  assert.match(prompt, /郡县制与分封制/, '历史话题作为参考')
  growth.dispose()
})

test('self-growth v1.33：reflectNow/learnNow 从 recall 取最近 thought 与话题种子', async () => {
  const now = FIXED_NOW.getTime()
  const llm = makeGrowthLlm([
    JSON.stringify({ thought: '接着上次的念头，我还在想鲸落。' }),
    JSON.stringify({
      question: '鲸落之后会发生什么？',
      note: '鲸的尸体沉到海底，会形成持续多年的生态热点。',
      topic: { id: 'whale-fall-later', title: '鲸落后的生态', fact: '鲸落可支撑深海生态数十年。', tags: ['海洋'] },
    }),
  ])
  const recall = {
    recentThoughts: (limit) => ['上一次的自省内容。'].slice(0, limit),
    recentLearning: (limit) => ['最近自学：章鱼有三颗心脏。'].slice(0, limit),
  }
  const { state, journal, growth } = makeGrowthHarness({
    llm,
    recall,
    topics: [{ id: 'whale-fall', title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。' }],
  })
  const reflected = await growth.reflectNow()
  assert.equal(reflected.ok, true)
  const reflectPrompt = llm.calls[0].messages[0].content[0].text
  assert.match(reflectPrompt, /上一次的自省内容。/)
  assert.match(reflectPrompt, /最近自学：章鱼有三颗心脏。/, '自学内容应反哺自省 prompt')
  const learned = await growth.learnNow()
  assert.equal(learned.ok, true)
  const learnPromptText = llm.calls[1].messages[0].content[0].text
  assert.match(learnPromptText, /鲸落生态系统/, '已知话题作为参考')
  assert.match(learnPromptText, /上一次的自省内容。/, '最近想法进入自学 prompt')
  assert.match(learnPromptText, /最近自学：章鱼有三颗心脏。/)
  assert.match(learnPromptText, /这次学什么由你自己决定/)
  assert.equal(state.snapshot().reflections >= 1, true)
  assert.equal(journal.entries[0].kind, 'thought')
  growth.dispose()
})

// ---------------------------------------------------------------------------
// M44：自生成声音档案（voice.json 提炼 + self-talk 注入）
// ---------------------------------------------------------------------------



test('voice-memory：路径/抽样白名单/时间均匀抽样', () => {
  assert.equal(resolveVoicePath({ DSH_VOICE: '/tmp/voice.json' }, '/Users/alice'), '/tmp/voice.json')
  assert.equal(
    resolveVoicePath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/agent-memory/voice.json',
  )
  assert.equal(resolveVoicePath({}, '/Users/alice'), '/Users/alice/.dsh/agent-memory/voice.json')

  const entries = []
  for (let index = 0; index < 60; index += 1) {
    entries.push({ kind: index % 2 === 0 ? 'thought' : 'murmur', text: `第${index}句自己的话` })
  }
  entries.push({ kind: 'user/message', text: 'SECRET_USER_CHAT' })
  entries.push({ kind: 'assistant/message', text: 'SECRET_ASSISTANT_TEXT' })
  const samples = collectVoiceSamples(entries, 40)
  assert.equal(samples.length, 40, '最多抽样 40 条')
  assert.equal(samples.some((text) => text.includes('SECRET')), false, '只取 thought/murmur 白名单')
  assert.match(samples[0], /第0句自己的话/)
  assert.match(samples.at(-1), /第59句自己的话/)

  // 少量条目时全取
  assert.deepEqual(collectVoiceSamples([{ kind: 'thought', text: '一句' }, { kind: 'murmur' }], 40), ['一句'])
})

test('voice-memory：提炼 prompt 明确「自己写的不是用户说的」/JSON 要求', () => {
  const prompt = buildVoiceRefreshPrompt(['窗边的光很轻。', '杯子凉了。', '键盘声比平时轻。'])
  assert.match(prompt, /都是\*\*你自己\*\*过去写过的/)
  assert.match(prompt, /不是用户说的话/)
  assert.match(prompt, /不要用「温柔」「调皮」这种扁平标签/)
  assert.match(prompt, /句长、节奏、常用词、口头习惯/)
  assert.match(prompt, /exemplars/)
  assert.match(prompt, /不要新造/)
  assert.match(prompt, /窗边的光很轻。/)
})

test('voice-memory：parseVoiceResult/normalizeVoiceFile 校验', () => {
  const profile = makeLongVoiceProfile()
  const parsed = parseVoiceResult(
    '```json\n' +
      JSON.stringify({ profile, exemplars: ['窗边的光很轻。', '杯子凉了，我还是喝完了。', '键盘声好像比昨天轻。'] }) +
      '\n```',
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.profile, profile)
  assert.equal(parsed.exemplars.length, 3)

  const deduped = parseVoiceResult(
    JSON.stringify({ profile, exemplars: ['同一句', '同一句', '另一句', '第三句', '第四句'] }),
  )
  assert.equal(deduped.ok, true)
  assert.equal(deduped.exemplars.length, 3, '最多 3 条且去重')

  assert.equal(parseVoiceResult('not json').ok, false)
  assert.equal(parseVoiceResult(JSON.stringify({ profile: '', exemplars: ['x'] })).ok, false)
  assert.equal(parseVoiceResult(JSON.stringify({ profile, exemplars: [] })).ok, false)
  assert.equal(
    parseVoiceResult(JSON.stringify({ profile, exemplars: ['字'.repeat(VOICE_EXEMPLAR_MAX_CHARS + 1)] })).ok,
    false,
    '单条 exemplar >80 拒绝',
  )

  const normalized = normalizeVoiceFile({
    ok: true,
    v: 1,
    updatedAt: 1700000000000,
    profile,
    exemplars: ['a', 'a', 'b', 'c', 'd'],
    sourceEntries: 12,
  })
  assert.equal(normalized.ok, true)
  assert.equal(normalized.exemplars.length, 3)
  assert.equal(normalized.sourceEntries, 12)
  assert.equal(normalizeVoiceFile({ ok: false, v: 1, profile, exemplars: ['x'] }), null)
  assert.equal(normalizeVoiceFile({ ok: true, v: 2, profile, exemplars: ['x'] }), null)
  assert.equal(normalizeVoiceFile({ ok: true, v: 1, profile: '', exemplars: ['x'] }), null)
  assert.equal(normalizeVoiceFile(null), null)
})

test('voice-memory：get 读取/mtime 缓存/坏文件 null', () => {
  const dir = makeTmpDir('dshp-voice')
  const voicePath = path.join(dir, 'voice.json')
  const service = createVoiceService({ journalPath: path.join(dir, 'journal.jsonl'), voicePath, logger: { warn() {} } })
  assert.equal(service.get(), null, '缺失文件返回 null')

  const profile = makeLongVoiceProfile()
  writeVoiceFile(voicePath, { ok: true, v: 1, updatedAt: 1, profile, exemplars: ['a', 'b', 'c'], sourceEntries: 3 })
  const first = service.get()
  assert.equal(first.profile, profile)
  const later = new Date(Date.now() + 5000)
  writeVoiceFile(voicePath, { ok: true, v: 1, updatedAt: 2, profile: `${profile.slice(0, 150)}（新）`, exemplars: ['x'], sourceEntries: 5 })
  fs.utimesSync(voicePath, later, later)
  const updated = service.get()
  assert.match(updated.profile, /（新）/, '文件更新后 mtime 缓存重读')
  assert.equal(updated.sourceEntries, 5)

  fs.writeFileSync(voicePath, 'not json', 'utf8')
  assert.equal(service.get(), null, '坏文件返回 null 不抛')
})

test('voice-memory：refreshNow 成功原子写/失败静默/不重入/隐私白名单', async () => {
  const dir = makeTmpDir('dshp-voice-refresh')
  const journalPath = path.join(dir, 'journal.jsonl')
  const voicePath = path.join(dir, 'voice.json')
  const entries = []
  for (let index = 0; index < 10; index += 1) {
    entries.push({ ts: index, kind: index % 2 === 0 ? 'thought' : 'murmur', text: `我写过的第${index}句自己的话。` })
  }
  entries.push({ ts: 99, kind: 'user/message', text: 'SECRET_USER_CHAT_TEXT' })
  writeRecallJournal(journalPath, entries)

  const profile = makeLongVoiceProfile()
  const llm = makeMockLlm(() => JSON.stringify({ profile, exemplars: ['我写过的第1句自己的话。', '我写过的第5句自己的话。', '我写过的第9句自己的话。'] }))
  const service = createVoiceService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    journalPath,
    voicePath,
    logger: { warn() {}, info() {} },
    now: () => FIXED_NOW.getTime(),
    timeoutMs: 300,
  })
  const result = await service.refreshNow()
  assert.equal(result.ok, true)
  const saved = JSON.parse(fs.readFileSync(voicePath, 'utf8'))
  assert.equal(saved.ok, true)
  assert.equal(saved.v, 1)
  assert.equal(saved.profile, profile)
  assert.equal(saved.exemplars.length, 3)
  assert.equal(saved.sourceEntries, 10, '只统计白名单样本')
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false, '原子写无 tmp 残留')
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.equal(prompt.includes('SECRET_USER_CHAT_TEXT'), false, '用户聊天不进入 prompt')
  assert.match(prompt, /你自己/)
  assert.equal(service.get().profile, profile)

  // 失败：非法 JSON → 不写、不抛
  fs.rmSync(voicePath, { force: true })
  const badLlm = makeMockLlm(() => 'not json')
  const badService = createVoiceService({
    llm: badLlm,
    getSelection: () => SELF_TALK_SELECTION,
    journalPath,
    voicePath,
    logger: { warn() {} },
    timeoutMs: 300,
  })
  const failed = await badService.refreshNow()
  assert.equal(failed.ok, false)
  assert.equal(fs.existsSync(voicePath), false)

  // 不重入
  const slowLlm = makeMockLlm(() => JSON.stringify({ profile, exemplars: ['a', 'b', 'c'] }))
  const slowStream = slowLlm.stream
  slowLlm.stream = (options) => {
    const inner = slowStream(options)
    return (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 20))
      yield* inner
    })()
  }
  const slow = createVoiceService({
    llm: slowLlm,
    getSelection: () => SELF_TALK_SELECTION,
    journalPath,
    voicePath,
    logger: { warn() {} },
    timeoutMs: 300,
  })
  const running = slow.refreshNow()
  const busy = await slow.refreshNow()
  assert.equal(busy.ok, false)
  assert.equal(busy.reason, 'busy')
  const finished = await running
  assert.equal(finished.ok, true)
  slow.dispose()
  service.dispose()
})

test('voice-memory：start 缺失或 >24h 刷新，<24h 不刷新', async () => {
  const dir = makeTmpDir('dshp-voice-start')
  const journalPath = writeRecallJournal(path.join(dir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voicePath = path.join(dir, 'voice.json')
  const profile = makeLongVoiceProfile()
  const llm = makeMockLlm(() => JSON.stringify({ profile, exemplars: ['a', 'b', 'c'] }))

  // 缺失 → start 后自动刷新
  const missing = createVoiceService({ llm, getSelection: () => SELF_TALK_SELECTION, journalPath, voicePath, logger: { warn() {} }, timeoutMs: 300, initialDelayMs: 10 })
  missing.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(fs.existsSync(voicePath), true)
  assert.equal(llm.calls.length, 1)
  missing.dispose()

  // 新鲜文件（<24h）→ 不刷新
  writeVoiceFile(voicePath, { ok: true, v: 1, updatedAt: Date.now(), profile, exemplars: ['a'], sourceEntries: 3 })
  const fresh = createVoiceService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    journalPath,
    voicePath,
    logger: { warn() {} },
    now: () => Date.now(),
    timeoutMs: 300,
    initialDelayMs: 10,
  })
  fresh.start()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(llm.calls.length, 1, '<24h 不刷新')
  fresh.dispose()

  // 过期（>24h）→ 刷新
  writeVoiceFile(voicePath, {
    ok: true,
    v: 1,
    updatedAt: Date.now() - VOICE_REFRESH_INTERVAL_MS - 1000,
    profile,
    exemplars: ['a'],
    sourceEntries: 3,
  })
  const stale = createVoiceService({ llm, getSelection: () => SELF_TALK_SELECTION, journalPath, voicePath, logger: { warn() {} }, timeoutMs: 300, initialDelayMs: 10 })
  stale.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(llm.calls.length, 2, '>24h 刷新')
  stale.dispose()
})

test('self-talk M44：prompt 接入 voice（无 voice 正常）；system prompt 去固定人设', () => {
  const profile = makeLongVoiceProfile()
  const prompt = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    voice: { profile, exemplars: ['窗边的光很轻。', '杯子凉了。'] },
  })
  assert.match(prompt, /这是你自己从旧记忆里总结出来的声音（不是别人给你的人设）：/)
  assert.match(prompt, /句长、节奏|我说话时习惯/)
  assert.match(prompt, /你过去说过、可作语气参照但不要复述的句子：/)
  assert.match(prompt, /- 窗边的光很轻。/)
  assert.match(prompt, /请延续这个声音，但只说此刻真正想说的，不要照抄示例。/)
  const plain = buildSelfTalkPrompt({ now: FIXED_NOW.getTime() })
  assert.equal(plain.includes('这是你自己从旧记忆里总结出来的声音'), false)

  assert.match(SELF_TALK_SYSTEM_PROMPT, /语气以你自己从记忆里长出的声音为准；保持自然、第一人称、不迎合、不说教/)
  assert.equal(SELF_TALK_SYSTEM_PROMPT.includes('温柔、调皮、吐槽、自嘲'), false, '旧固定人设行已移除')
})

test('self-talk M44：service voice getter 注入 prompt；getter 异常安全降级', async () => {
  const profile = makeLongVoiceProfile()
  const { llm, service } = makeSelfTalkHarness()
  const serviceWithVoice = createSelfTalkService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    voice: () => ({ profile, exemplars: ['窗边的光很轻。'] }),
  })
  const result = await serviceWithVoice.generate({})
  assert.equal(result.ok, true)
  assert.match(llm.calls[0].messages[0].content[0].text, /不是别人给你的人设/)
  assert.match(llm.calls[0].messages[0].content[0].text, /窗边的光很轻。/)

  const brokenLlm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const broken = createSelfTalkService({
    llm: brokenLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    voice: () => {
      throw new Error('voice getter boom')
    },
  })
  const brokenResult = await broken.generate({})
  assert.equal(brokenResult.ok, true, 'voice getter 异常不影响生成')
  assert.equal(brokenLlm.calls[0].messages[0].content[0].text.includes('这是你自己从旧记忆里总结出来的声音'), false)
})

// ---------------------------------------------------------------------------
// M45：voice 刷新失败退避修复（启动延迟 + 5min 重试 + self-talk 兜底触发）
// ---------------------------------------------------------------------------

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeVoiceSchedulerHarness(overrides = {}) {
  const dir = makeTmpDir('dshp-voice-schedule')
  const journalPath = writeRecallJournal(path.join(dir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句自己的话。' },
    { kind: 'murmur', text: '第二句自己的话。' },
    { kind: 'thought', text: '第三句自己的话。' },
  ])
  const voicePath = path.join(dir, 'voice.json')
  const profile = makeLongVoiceProfile()
  const calls = { count: 0 }
  const valid = JSON.stringify({ profile, exemplars: ['a', 'b', 'c'] })
  const llm = {
    calls: [],
    stream(options) {
      this.calls.push(options)
      calls.count += 1
      const text = typeof overrides.responder === 'function' ? overrides.responder(calls.count) : valid
      const delay = typeof overrides.delayMs === 'number' ? overrides.delayMs : 0
      return (async function* () {
        if (delay > 0) await sleepMs(delay)
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const service = createVoiceService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    journalPath,
    voicePath,
    logger: { warn() {}, info() {} },
    timeoutMs: overrides.timeoutMs ?? 300,
    initialDelayMs: overrides.initialDelayMs ?? 10,
    retryBaseMs: overrides.retryBaseMs ?? 30,
    retryMaxMs: overrides.retryMaxMs ?? 60,
    refreshIntervalMs: overrides.refreshIntervalMs ?? 24 * 60 * 60 * 1000,
  })
  return { dir, journalPath, voicePath, profile, llm, service, calls }
}

test('voice-memory M45：start 首次刷新延迟 initialDelayMs（不会在初始化瞬间调用 llm）', async () => {
  const { service, llm, voicePath } = makeVoiceSchedulerHarness({ initialDelayMs: 40 })
  service.start()
  await sleepMs(10)
  assert.equal(llm.calls.length, 0, 'initialDelay 内不调用模型')
  assert.equal(fs.existsSync(voicePath), false)
  await sleepMs(70)
  assert.equal(llm.calls.length, 1, 'initialDelay 后刷新一次')
  assert.equal(fs.existsSync(voicePath), true)
  service.dispose()
})

test('voice-memory M45：刷新失败后按 5min 起指数退避重试（测试缩短间隔），成功恢复 24h', async () => {
  // 前两次失败（非法 JSON），第三次成功
  const { service, llm, voicePath } = makeVoiceSchedulerHarness({
    initialDelayMs: 0,
    retryBaseMs: 25,
    retryMaxMs: 60,
    responder: (count) => {
      if (count <= 2) return 'not json'
      return JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] })
    },
  })
  service.start()
  await sleepMs(15)
  assert.equal(llm.calls.length, 1, '首次刷新')
  assert.equal(fs.existsSync(voicePath), false)
  const firstRetryDelay = service.scheduler().retryDelayMs
  assert.equal(firstRetryDelay, 50, '失败后下一次延迟 25ms→退避值翻倍为 50')

  await sleepMs(40) // 25ms 后重试（第 2 次失败）
  assert.ok(llm.calls.length >= 2, '失败后 5min（测试 25ms）重试')
  await sleepMs(80) // 50ms 后重试（第 3 次成功）
  assert.ok(llm.calls.length >= 3, '继续退避重试')
  assert.equal(fs.existsSync(voicePath), true, '成功后写入 voice.json')
  const afterSuccess = service.scheduler().retryDelayMs
  assert.equal(afterSuccess, 25, '成功后重试延迟恢复 base')
  const callsAfterSuccess = llm.calls.length
  await sleepMs(100)
  assert.equal(llm.calls.length, callsAfterSuccess, '成功后按 24h 调度（测试窗口内不再刷新）')
  service.dispose()
})

test('voice-memory M45：stop/dispose 清理所有 timer；refresh 不并发', async () => {
  const { service, llm } = makeVoiceSchedulerHarness({ initialDelayMs: 30 })
  service.start()
  service.stop()
  await sleepMs(60)
  assert.equal(llm.calls.length, 0, 'stop 后 initialDelay 定时器不再触发')

  // 失败重试也已排期 → stop 后不再触发
  const retrying = makeVoiceSchedulerHarness({
    initialDelayMs: 0,
    retryBaseMs: 20,
    retryMaxMs: 40,
    responder: () => 'not json',
  })
  retrying.service.start()
  await sleepMs(15)
  assert.equal(retrying.llm.calls.length, 1)
  retrying.service.stop()
  const stoppedAt = retrying.llm.calls.length
  await sleepMs(80)
  assert.equal(retrying.llm.calls.length, stoppedAt, 'stop 清理失败重试 timer')
  retrying.service.dispose()

  // 不并发：一次刷新在途时，手动 refreshNow 返回 busy 且不发起第二次模型调用
  const slow = makeVoiceSchedulerHarness({ initialDelayMs: 0, delayMs: 60 })
  slow.service.start()
  await sleepMs(15)
  assert.equal(slow.llm.calls.length, 1, '首次刷新在途')
  const busy = await slow.service.refreshNow()
  assert.equal(busy.ok, false)
  assert.equal(busy.reason, 'busy')
  assert.equal(slow.llm.calls.length, 1, '不并发、不重复调用模型')
  await sleepMs(80)
  assert.equal(fs.existsSync(slow.voicePath), true)
  slow.service.dispose()
})

test('self-talk M45：voice 为空时兜底触发 refreshVoice（≥5min 节流、不阻塞响应、异常安全）', async () => {
  let refreshed = 0
  let reply = SELF_TALK_LINES_A.join('\n')
  const firstLlm = makeMockLlm(() => reply)
  const service = createSelfTalkService({
    llm: firstLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    voice: () => null,
    // 永不 resolve：验证 fire-and-forget 不阻塞响应
    refreshVoice: () => {
      refreshed += 1
      return new Promise(() => {})
    },
  })
  const startedAt = Date.now()
  const first = await service.generate({})
  const elapsed = Date.now() - startedAt
  assert.equal(first.ok, true, '兜底刷新不阻塞 self-talk 响应')
  assert.ok(elapsed < 500, `响应不被 hung 的 refreshVoice 阻塞（${elapsed}ms）`)
  assert.equal(refreshed, 1, 'voice 为空时触发一次刷新')

  // 同一 now（5min 节流内）再次生成 → 不重复触发
  reply = SELF_TALK_LINES_B.join('\n')
  const second = await service.generate({})
  assert.equal(second.ok, true)
  assert.equal(refreshed, 1, '≥5min 节流内不重复触发')

  // refreshVoice 抛同步异常也不影响生成
  const throwing = createSelfTalkService({
    llm: makeMockLlm(() => SELF_TALK_LINES_B.join('\n')),
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    voice: () => null,
    refreshVoice: () => {
      throw new Error('refresh boom')
    },
  })
  const ok = await throwing.generate({})
  assert.equal(ok.ok, true, 'refreshVoice 抛异常不影响生成')
})

// ---------------------------------------------------------------------------
// M46：自主行为循环（需求阈值 → 吃喝玩乐睡/醒 → 动作记忆）
// ---------------------------------------------------------------------------

function makeActionState(initial = {}) {
  let snapshot = {
    energy: 50,
    curiosity: 0,
    social: 0,
    hunger: 0,
    thirst: 0,
    moodValence: 0,
    moodArousal: 45,
    sleeping: false,
    sleepSince: null,
    lastActionAt: null,
    ...initial,
  }
  const applied = []
  return {
    state: {
      snapshot: () => ({ ...snapshot }),
      applyEvent(kind, at) {
        applied.push(kind)
        snapshot = { ...snapshot, lastActionAt: at }
      },
    },
    applied,
    update(patch) {
      snapshot = { ...snapshot, ...patch }
    },
    get current() {
      return snapshot
    },
  }
}

function writeActionsFile(file, actions) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ok: true, v: 1, updatedAt: Date.now(), actions }), 'utf8')
  return file
}

test('self-state M46：thirst/sleeping 新字段、睡眠恢复、drink/sleep/wake 事件', () => {
  const now = 1700000000000
  const base = defaultSelfState(now)
  assert.equal(base.thirst, SELF_STATE_DEFAULTS.thirst)
  assert.equal(SELF_STATE_DEFAULTS.thirst, 40)
  assert.equal(base.sleeping, false)
  assert.equal(base.sleepSince, null)
  assert.equal(base.lastDrinkAt, null)
  assert.equal(base.lastWakeAt, null)
  assert.equal(base.lastActionAt, null)

  // 醒着：thirst +0.2/min
  const awake = advanceSelfState(base, now + 10 * 60 * 1000)
  assert.equal(awake.thirst, 42)
  assert.equal(awake.energy, 68) // 70 - 2

  // 睡眠中：energy +0.6/min、hunger/thirst 增速减半
  const sleepingState = { ...base, sleeping: true, energy: 50, hunger: 35, thirst: 40 }
  const slept = advanceSelfState(sleepingState, now + 10 * 60 * 1000)
  assert.equal(slept.energy, 56)
  assert.equal(slept.hunger, 36.3) // 35 + 0.25*0.5*10 = 36.25，clamp 保留 1 位小数
  assert.equal(slept.thirst, 41) // 40 + 0.2*0.5*10
  assert.equal(slept.sleeping, true, 'tick 不清醒睡眠标记')

  const drink = applySelfEvent({ ...base, thirst: 70 }, 'drink', now)
  assert.equal(drink.thirst, 0)
  assert.equal(drink.lastDrinkAt, now)
  assert.equal(drink.lastActionAt, now)

  const sleep = applySelfEvent(base, 'sleep', now)
  assert.equal(sleep.sleeping, true)
  assert.equal(sleep.sleepSince, now)
  assert.equal(sleep.lastActionAt, now)

  const wake = applySelfEvent({ ...base, sleeping: true }, 'wake', now)
  assert.equal(wake.sleeping, false)
  assert.equal(wake.lastWakeAt, now)

  const eat = applySelfEvent({ ...base, hunger: 80 }, 'eat', now)
  assert.equal(eat.hunger, 50)
  assert.equal(eat.energy, 80) // 默认 70 + 10
  assert.equal(eat.lastMealAt, now)

  const play = applySelfEvent({ ...base, curiosity: 90 }, 'actPlay', now)
  assert.equal(play.curiosity, 60)
  assert.equal(play.moodValence, 15)

  const socialize = applySelfEvent({ ...base, social: 90 }, 'socialize', now)
  assert.equal(socialize.social, 65)
  assert.equal(socialize.moodValence, 10)

  // snapshot 含新字段
  const snapshot = applySelfEvent({ ...base, thirst: 55, sleeping: true, sleepSince: now }, 'drink', now)
  assert.equal(snapshot.thirst, 0)
  const service = createSelfState({ file: path.join(makeTmpDir('dshp-state-m46'), 'self-state.json'), now: () => now })
  assert.equal(service.snapshot().sleeping, false)
  assert.equal(service.snapshot().thirst, 40)
  service.dispose()
})

test('self-actions M46：chooseSelfAction 阈值与优先级（睡觉优先，然后 吃→喝→玩→冒泡）', () => {
  assert.equal(chooseSelfAction({ sleeping: true, energy: 80 }), 'wake')
  assert.equal(chooseSelfAction({ sleeping: true, energy: 74 }), null)
  assert.equal(chooseSelfAction({ sleeping: false, energy: 20, hunger: 90 }), 'sleep', '低精力优先睡觉')
  assert.equal(chooseSelfAction({ sleeping: false, energy: 50, hunger: 75 }), 'eat')
  assert.equal(chooseSelfAction({ sleeping: false, energy: 50, hunger: 74, thirst: 70 }), 'drink')
  assert.equal(chooseSelfAction({ sleeping: false, energy: 50, hunger: 74, thirst: 69, curiosity: 80 }), 'play')
  assert.equal(chooseSelfAction({ sleeping: false, energy: 50, curiosity: 79, social: 80 }), 'socialize')
  assert.equal(chooseSelfAction({ sleeping: false, energy: 50, curiosity: 79, social: 79 }), null)
  // 同时超阈值时按优先级
  const all = { sleeping: false, energy: 50, hunger: 90, thirst: 90, curiosity: 90, social: 90 }
  assert.equal(chooseSelfAction(all), 'eat')
})

test('self-actions M46：tick 触发吃/喝/玩/冒泡/睡/醒，文案与落盘结构', async () => {
  const dir = makeTmpDir('dshp-actions')
  const actionsPath = path.join(dir, 'self-actions.json')
  const now = 1700000000000

  // 吃
  const eating = makeActionState({ hunger: 90 })
  const eatService = createSelfActions({ state: eating.state, actionsPath, logger: { warn() {}, info() {} }, now: () => now })
  const eatResult = eatService.tick(now)
  assert.equal(eatResult.ok, true)
  assert.equal(eatResult.action.kind, 'eat')
  assert.equal(eatResult.action.label, SELF_ACTION_LABELS.eat)
  assert.equal(eatResult.action.text, SELF_ACTION_TEXTS.eat)
  assert.equal(eatResult.action.at, now)
  assert.equal(eatResult.action.id.startsWith(`act-${now}-`), true)
  assert.deepEqual(eating.applied, ['eat'], 'eat 对应 applyEvent eat')
  const saved = JSON.parse(fs.readFileSync(actionsPath, 'utf8'))
  assert.equal(saved.ok, true)
  assert.equal(saved.v, 1)
  assert.equal(saved.actions.length, 1)
  assert.deepEqual(saved.actions[0], eatResult.action)

  // minGap：3min 内不再动作
  const gap = eatService.tick(now + 60 * 1000)
  assert.equal(gap.ok, true)
  assert.equal(gap.skipped, true)
  assert.equal(gap.reason, 'min-gap')
  // 满 3min 且需求仍在 → 再吃
  const afterGap = eatService.tick(now + SELF_ACTIONS_MIN_GAP_MS)
  assert.equal(afterGap.ok, true)
  assert.equal(afterGap.action.kind, 'eat')

  // 喝 / 玩 / 冒泡
  const drinking = makeActionState({ thirst: 80 })
  const drinkService = createSelfActions({ state: drinking.state, actionsPath: path.join(dir, 'a-drink.json'), logger: { warn() {} }, now: () => now })
  assert.equal(drinkService.tick(now).action.kind, 'drink')
  assert.deepEqual(drinking.applied, ['drink'])

  const playing = makeActionState({ curiosity: 90 })
  const playService = createSelfActions({ state: playing.state, actionsPath: path.join(dir, 'a-play.json'), logger: { warn() {} }, now: () => now })
  assert.equal(playService.tick(now).action.kind, 'play')
  assert.deepEqual(playing.applied, ['actPlay'])

  const social = makeActionState({ social: 95 })
  const socialService = createSelfActions({ state: social.state, actionsPath: path.join(dir, 'a-social.json'), logger: { warn() {} }, now: () => now })
  const socialAction = socialService.tick(now).action
  assert.equal(socialAction.kind, 'socialize')
  assert.equal(socialAction.text, SELF_ACTION_TEXTS.socialize)
  assert.match(socialAction.text, /冒个泡/)
  assert.deepEqual(social.applied, ['socialize'])

  // 睡觉 / 醒来（睡眠动作也受 minGap 约束）
  const sleepy = makeActionState({ energy: 15 })
  const sleepService = createSelfActions({ state: sleepy.state, actionsPath: path.join(dir, 'a-sleep.json'), logger: { warn() {} }, now: () => now })
  assert.equal(sleepService.tick(now).action.kind, 'sleep')
  assert.deepEqual(sleepy.applied, ['sleep'])
  sleepy.update({ sleeping: true, energy: 80, lastActionAt: now })
  assert.equal(sleepService.tick(now + SELF_ACTIONS_MIN_GAP_MS).action.kind, 'wake')
  assert.deepEqual(sleepy.applied, ['sleep', 'wake'])

  // 无需求 → skipped no-need，不写文件
  const idle = makeActionState({})
  const idleService = createSelfActions({ state: idle.state, actionsPath: path.join(dir, 'a-idle.json'), logger: { warn() {} }, now: () => now })
  const idleResult = idleService.tick(now)
  assert.equal(idleResult.skipped, true)
  assert.equal(idleResult.reason, 'no-need')
  assert.equal(fs.existsSync(path.join(dir, 'a-idle.json')), false)
})

test('self-actions M46：环形 50 条/load 已有动作/坏文件/快照 latest+recent5', () => {
  const dir = makeTmpDir('dshp-actions-ring')
  const actionsPath = path.join(dir, 'self-actions.json')
  const now = 1700000000000

  // 环形保留：maxEntries=3，连续 4 个动作
  const stub = makeActionState({ hunger: 90 })
  const service = createSelfActions({
    state: stub.state,
    actionsPath,
    logger: { warn() {} },
    now: () => now,
    maxEntries: 3,
  })
  for (let index = 0; index < 4; index += 1) {
    const at = now + index * SELF_ACTIONS_MIN_GAP_MS
    const result = service.tick(at)
    assert.equal(result.ok, true)
    stub.update({ hunger: 90, lastActionAt: at })
  }
  const saved = JSON.parse(fs.readFileSync(actionsPath, 'utf8'))
  assert.equal(saved.actions.length, 3, '环形保留 maxEntries')
  const snapshot = service.snapshot()
  assert.equal(snapshot.latest.at, now + 3 * SELF_ACTIONS_MIN_GAP_MS)
  assert.equal(snapshot.recent.length, 3)
  assert.equal(snapshot.recent[0].at, saved.actions[2].at, 'recent 最新在前')

  // load 已有动作
  const restored = createSelfActions({ state: makeActionState({}).state, actionsPath, logger: { warn() {} }, now: () => now })
  const loadResult = restored.load()
  assert.equal(loadResult.ok, true)
  assert.equal(loadResult.count, 3)
  assert.equal(restored.snapshot().recent.length, 3)

  // 坏文件/缺失 → 空、不抛
  fs.writeFileSync(actionsPath, 'not json', 'utf8')
  assert.equal(restored.load().ok, false)
  assert.equal(restored.snapshot().latest, null)
  const missing = createSelfActions({ state: makeActionState({}).state, actionsPath: path.join(dir, 'none.json'), logger: { warn() {} } })
  assert.equal(missing.load().ok, false)
  assert.deepEqual(missing.snapshot(), { latest: null, recent: [] })

  // 校验函数
  assert.equal(normalizeSelfAction({ id: 'x', kind: 'eat', label: '吃', text: 'x', at: 1 }).id, 'x')
  assert.equal(normalizeSelfAction({ id: '', kind: 'eat', at: 1 }), null)
  // v1.55：允许自造日常行为 slug（有 label/text 兜底），非法 slug 仍拒绝
  const invented = normalizeSelfAction({ id: 'x', kind: 'dance', at: 1 })
  assert.equal(invented.kind, 'dance')
  assert.equal(invented.label, 'dance')
  assert.equal(invented.text, '做了点自己的小事。')
  assert.equal(normalizeSelfAction({ id: 'x', kind: '吃', at: 1 }), null)
  assert.equal(normalizeSelfAction({ id: 'x', kind: 'has space', at: 1 }), null)
  assert.equal(normalizeSelfActionsFile({ ok: true, v: 1, actions: [{ id: 'a', kind: 'eat', at: 1 }, { bad: true }] }).length, 1)
  assert.deepEqual(normalizeSelfActionsFile({ ok: false, v: 1, actions: [] }), [])
  assert.equal(SELF_ACTIONS_MAX_ENTRIES, 200)
})

test('self.json M46：路由返回 state.thirst/sleeping 与 actions{latest,recent}', async () => {
  const actions = {
    latest: { id: 'act-1', kind: 'drink', label: '喝', text: '渴了，去喝口水。', at: 123 },
    recent: [{ id: 'act-1', kind: 'drink', label: '喝', text: '渴了，去喝口水。', at: 123 }],
  }
  const handler = createSelfStateHandler({
    tick: () => {},
    getSnapshot: () => ({ energy: 50, thirst: 41, sleeping: false, sleepSince: null }),
    getGrowth: () => ({ learnings: 1, reflections: 2, lastLearnAt: null, lastReflectAt: null }),
    getActions: () => actions,
  })
  const response = new MockResponse()
  await handler(mockRequest({ url: SELF_STATE_ROUTE }), response)
  await response.finished()
  assert.equal(response.json().ok, true)
  assert.equal(response.json().state.thirst, 41)
  assert.equal(response.json().state.sleeping, false)
  assert.equal(response.json().state.sleepSince, null)
  assert.deepEqual(response.json().actions.latest, actions.latest)
  assert.equal(response.json().actions.recent.length, 1)

  // 没有 getActions 时仍有空结构
  const bare = createSelfStateHandler({ tick: () => {}, getSnapshot: () => ({}) })
  const bareResponse = new MockResponse()
  await bare(mockRequest({ url: SELF_STATE_ROUTE }), bareResponse)
  await bareResponse.finished()
  assert.deepEqual(bareResponse.json().actions, { latest: null, recent: [] })
})
