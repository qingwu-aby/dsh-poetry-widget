// tests/domains/core.test.mjs —— 核心/设置/数据/路由/天气（W3 从 host.test 拆出）
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

test('index.js 导出 name 与 apply（Cordis 插件形状）', () => {
  assert.equal(pluginName, 'dsh-little-whale')
  assert.equal(typeof pluginApply, 'function')
})

test('package.json 是版本号唯一来源', () => {
  const meta = readPackageMeta(path.join(import.meta.dirname, '..', '..', 'package.json'))
  assert.equal(meta.name, 'dsh-little-whale')
  assert.match(meta.version, /^\d+\.\d+\.\d+/)
  // 读不到时安全回退
  assert.deepEqual(readPackageMeta('/nonexistent/package.json'), { name: null, version: null })
})

test('paths：本地日期、设置目录解析、路径脱敏', () => {
  assert.equal(formatLocalDate(new Date(2026, 9, 21, 0, 0, 0)), '2026-10-21')
  assert.equal(formatLocalDate(new Date(2026, 0, 3, 23, 59, 0)), '2026-01-03')

  const defaultPath = resolveSettingsPath({}, '/Users/alice')
  assert.equal(defaultPath.file, '/Users/alice/.dsh/.dsh-poetry/settings.json')
  const customPath = resolveSettingsPath({ DSH_HOME: '/opt/dsh-home' }, '/Users/alice')
  assert.equal(customPath.file, '/opt/dsh-home/.dsh-poetry/settings.json')

  assert.equal(maskPath('/Users/alice/.dsh/.dsh-poetry/settings.json', { home: '/Users/alice' }), '~/.dsh/.dsh-poetry/settings.json')
  assert.equal(
    maskPath('/opt/dsh-home/.dsh-poetry/settings.json', { home: '/Users/alice', dshHome: '/opt/dsh-home' }),
    '$DSH_HOME/.dsh-poetry/settings.json',
  )
  assert.equal(maskPath('/etc/passwd', { home: '/Users/alice' }), '/etc/passwd')
  // /Users/alice2 不能被当成 /Users/alice 的子路径
  assert.equal(maskPath('/Users/alice2/settings.json', { home: '/Users/alice' }), '/Users/alice2/settings.json')
  assert.equal(maskPath('', { home: '/Users/alice' }), '')
})

// ---------------------------------------------------------------------------
// 设置存储
// ---------------------------------------------------------------------------

test('settings：没有文件时返回默认值且不创建文件', () => {
  const file = path.join(makeTmpDir('dshp-settings'), '.dsh-poetry', 'settings.json')
  const store = createSettingsStore({ file })
  assert.deepEqual(store.get(), { ...DEFAULT_SETTINGS })
  assert.equal(fs.existsSync(file), false)
})

test('settings：部分合并 + clamp + updatedAt + 原子写（无 tmp 残留）', () => {
  const file = path.join(makeTmpDir('dshp-settings'), '.dsh-poetry', 'settings.json')
  const store = createSettingsStore({ file, now: () => 1700000000000 })

  const first = store.put({ scale: 9, showTones: false, autoplay: 60, unknownField: 'ignored' })
  assert.equal(first.ok, true)
  assert.equal(first.settings.scale, 1.6, 'scale 上钳到 1.6')
  assert.equal(first.settings.showTones, false)
  assert.equal(first.settings.autoplay, 60)
  assert.equal(first.settings.mode, 'daily', '未提供的字段沿用默认/当前值')
  assert.equal(first.settings.schemaVersion, 1)
  assert.equal(first.settings.updatedAt, 1700000000000)
  assert.equal('unknownField' in first.settings, false)

  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(persisted, first.settings, '落盘内容 = 返回的完整设置')
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter((entry) => entry.endsWith('.tmp')),
    [],
    '原子写不留下临时文件',
  )

  const second = store.put({ scale: 0.1 })
  assert.equal(second.ok, true)
  assert.equal(second.settings.scale, 0.6, 'scale 下钳到 0.6')
  assert.equal(second.settings.showTones, false, '部分写入是合并而非覆盖')
})

test('settings：白名单 / 类型 / 枚举严格校验', () => {
  for (const [patch, field] of [
    [{ autoplay: 45 }, 'autoplay'],
    [{ autoplay: '30' }, 'autoplay'],
    [{ mode: 'weekly' }, 'mode'],
    [{ snap: 'top' }, 'snap'],
    [{ script: 'traditional' }, 'script'],
    [{ theme: 'blue' }, 'theme'],
    [{ scale: '1.2' }, 'scale'],
    [{ showTones: 1 }, 'showTones'],
    [{ hidden: 'false' }, 'hidden'],
    [{ tutorialSeen: 0 }, 'tutorialSeen'],
    [{ lastPoemId: 5 }, 'lastPoemId'],
  ]) {
    const result = validateSettingsPatch(patch)
    assert.equal(result.ok, false, `${JSON.stringify(patch)} 应被拒绝`)
    assert.deepEqual(result.fields, [field])
  }
  const multiple = validateSettingsPatch({ autoplay: 45, mode: 'weekly', scale: 'x' })
  assert.equal(multiple.ok, false)
  assert.deepEqual(multiple.fields, ['scale', 'mode', 'autoplay'])

  assert.deepEqual(validateSettingsPatch({}), { ok: true, patch: {} })
  assert.deepEqual(validateSettingsPatch(null).ok, false)
  // schemaVersion / updatedAt 是宿主维护字段：接受但忽略
  assert.deepEqual(validateSettingsPatch({ schemaVersion: 99, updatedAt: 'yesterday' }), { ok: true, patch: {} })
  assert.deepEqual(validateSettingsPatch({ mode: 'random', autoplay: 300, snap: 'free', script: 'original', theme: 'dark' }).patch, {
    mode: 'random',
    autoplay: 300,
    snap: 'free',
    script: 'original',
    theme: 'dark',
  })
})

test('settings：损坏文件先备份 .bak 再回退默认，之后可正常写入', () => {
  const dir = path.join(makeTmpDir('dshp-settings'), '.dsh-poetry')
  const file = path.join(dir, 'settings.json')
  fs.mkdirSync(dir, { recursive: true })
  const corrupt = '{"scale": 1.2, boom'
  fs.writeFileSync(file, corrupt, 'utf8')

  const store = createSettingsStore({ file })
  assert.deepEqual(store.get(), { ...DEFAULT_SETTINGS }, '损坏文件回退默认值')
  assert.equal(fs.existsSync(`${file}.bak`), true, '损坏文件已备份')
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), corrupt, '备份保留原始内容')

  const result = store.put({ scale: 1.2 })
  assert.equal(result.ok, true)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).scale, 1.2)
})

test('settings：lastPoemId 不在诗列表置 null；列表不可用时保留原值', () => {
  const file = path.join(makeTmpDir('dshp-settings'), '.dsh-poetry', 'settings.json')
  const withPoems = createSettingsStore({ file, knownPoemIds: () => new Set(POEM_IDS) })
  assert.equal(withPoems.put({ lastPoemId: 'tang-000002' }).settings.lastPoemId, 'tang-000002')
  assert.equal(withPoems.put({ lastPoemId: 'not-in-list' }).settings.lastPoemId, null, '不在列表 → null')

  const noPoemsFile = path.join(makeTmpDir('dshp-settings'), '.dsh-poetry', 'settings.json')
  const withoutPoems = createSettingsStore({ file: noPoemsFile, knownPoemIds: () => null })
  assert.equal(withoutPoems.put({ lastPoemId: 'unknown-but-cannot-check' }).settings.lastPoemId, 'unknown-but-cannot-check')
})

test('settings：normalizeSettings 对任意脏数据安全回退', () => {
  const dirty = normalizeSettings({
    scale: -3,
    showTones: 'yes',
    mode: 'nope',
    autoplay: 17,
    snap: 1,
    lastPoemId: 42,
    updatedAt: -1,
    schemaVersion: 'two',
    extra: true,
  })
  assert.deepEqual(dirty, { ...DEFAULT_SETTINGS, scale: 0.6 }, '非法枚举/布尔回退默认；数字型 scale clamp 到 0.6')
  assert.equal(normalizeSettings({ scale: 100 }).scale, 1.6)
  assert.equal(normalizeSettings({ lastPoemId: 'x' }).lastPoemId, 'x')
})

// ---------------------------------------------------------------------------
// 数据存储 + 路由
// ---------------------------------------------------------------------------

test('bootstrap：完整形状 + 今日诗按 sha256(date+dataVersion) 确定性选择', async () => {
  const harness = createHarness()
  const response = await harness.call('bootstrap.json', mockRequest())
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, true)
  assert.equal(body.version, '0.1.0')
  assert.equal(body.dataVersion, DATA_VERSION)
  assert.deepEqual(body.source, {
    repo: 'chinese-poetry/chinese-poetry',
    commit: 'b8594f81a89752241442f2ce267d6f66f96704ee',
    license: 'MIT',
  })
  assert.equal(body.today.date, '2026-10-21')
  assert.equal(body.today.poemId, expectedPoemId('2026-10-21', DATA_VERSION, POEM_IDS))
  assert.deepEqual(body.counts, { poems: 3, ci: 2, yun: 5, cards: 2, ciCards: 3 })
  assert.deepEqual(body.settings, { ...DEFAULT_SETTINGS })
  // 确定性：同一 date+dataVersion 连续两次结果一致
  const again = (await harness.call('bootstrap.json', mockRequest())).json()
  assert.equal(again.today.poemId, body.today.poemId)
})

test('health：判活成功 + version/dataVersion/dataAvailable', async () => {
  const harness = createHarness()
  const body = (await harness.call('health.json', mockRequest())).json()
  assert.deepEqual(body, { ok: true, version: '0.1.0', dataVersion: DATA_VERSION, dataAvailable: true })
})

test('数据文件缺失：数据接口 200 + DATA_UNAVAILABLE；health/about/settings 仍可用', async () => {
  const emptyDataDir = makeTmpDir('dshp-empty-data')
  const harness = createHarness({ dataDir: emptyDataDir })

  for (const routeName of ['poems.json', 'ci.json', 'yun.json', 'knowledge.json', 'bootstrap.json']) {
    const response = await harness.call(routeName, mockRequest())
    assert.equal(response.statusCode, 200, `${routeName} 仍回 200`)
    const body = response.json()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'DATA_UNAVAILABLE')
    assert.equal(typeof body.error.message, 'string')
  }

  const health = (await harness.call('health.json', mockRequest())).json()
  assert.deepEqual(health, { ok: true, version: '0.1.0', dataVersion: null, dataAvailable: false })

  const about = (await harness.call('about.json', mockRequest())).json()
  assert.equal(about.ok, true)
  assert.equal(about.dataVersion, null)
  assert.equal(about.source, null)
  assert.equal(about.builtAt, null)
  assert.equal(about.files.length, 5)
  for (const file of about.files) {
    assert.equal(file.ok, false)
    assert.equal(file.bytes, null)
  }
  assert.equal(about.settingsPath, '~/.dsh/.dsh-poetry/settings.json')

  const settings = (await harness.call('settings.json', mockRequest())).json()
  assert.deepEqual(settings, { ok: true, settings: { ...DEFAULT_SETTINGS } })
})

test('数据文件损坏：DATA_UNAVAILABLE，about 标出 bytes 与 ok:false', async () => {
  const harness = createHarness()
  fs.writeFileSync(path.join(harness.dataDir, 'poems.json'), '{"ok":true,"items":[', 'utf8')

  const poems = (await harness.call('poems.json', mockRequest())).json()
  assert.equal(poems.ok, false)
  assert.equal(poems.error.code, 'DATA_UNAVAILABLE')

  const bootstrap = (await harness.call('bootstrap.json', mockRequest())).json()
  assert.equal(bootstrap.ok, false)
  assert.equal(bootstrap.error.code, 'DATA_UNAVAILABLE')

  const about = (await harness.call('about.json', mockRequest())).json()
  const poemsFile = about.files.find((file) => file.name === 'poems.json')
  assert.equal(poemsFile.ok, false)
  assert.ok(poemsFile.bytes > 0, '损坏文件仍有字节数')
  // manifest 仍可读 → about 保留 dataVersion
  assert.equal(about.dataVersion, DATA_VERSION)
})

test('数据形状不符（items 非数组）视为 DATA_UNAVAILABLE', async () => {
  const harness = createHarness()
  writeJson(path.join(harness.dataDir, 'poems.json'), { ok: true, dataVersion: DATA_VERSION, items: {} })
  const body = (await harness.call('poems.json', mockRequest())).json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'DATA_UNAVAILABLE')
})

test('数据缓存：文件 mtime 变化后重新读取', async () => {
  const harness = createHarness()
  assert.equal(harness.dataStore.load('poems.json').value.items.length, 3)
  writeJson(path.join(harness.dataDir, 'poems.json'), {
    ok: true,
    dataVersion: DATA_VERSION,
    items: [...POEM_IDS, 'tang-000004'].map((id) => ({ id })),
  })
  assert.equal(harness.dataStore.load('poems.json').value.items.length, 4)
})

test('数据缓存：manifest.dataVersion 变化即使文件 mtime/size 不变也失效', async () => {
  const harness = createHarness()
  const poemsFile = path.join(harness.dataDir, 'poems.json')
  assert.equal(harness.dataStore.load('poems.json').value.items[0].id, 'tang-000001')
  const stat = fs.statSync(poemsFile)

  // 同字节长度地改内容（等长替换），并把 mtime 还原 → 只能靠 dataVersion 判失效
  const original = fs.readFileSync(poemsFile, 'utf8')
  const rewritten = original.replace('tang-000001', 'tang-000009')
  assert.equal(rewritten.length, original.length, '测试前提：字节数不变')
  assert.notEqual(rewritten, original)
  fs.writeFileSync(poemsFile, rewritten, 'utf8')
  fs.utimesSync(poemsFile, stat.atime, stat.mtime)

  // manifest 更新 dataVersion（文件大小不变）
  const manifestFile = path.join(harness.dataDir, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  manifest.dataVersion = '2026-10-21.2'
  writeJson(manifestFile, manifest)

  assert.equal(
    harness.dataStore.load('poems.json').value.items[0].id,
    'tang-000009',
    'manifest.dataVersion 变化必须让文件缓存失效',
  )
})

test('pickPoemIndex：确定性、边界安全', () => {
  assert.equal(pickPoemIndex('2026-10-21', 'v1', 3), pickPoemIndex('2026-10-21', 'v1', 3))
  assert.ok(pickPoemIndex('2026-10-21', 'v1', 500) < 500)
  assert.ok(pickPoemIndex('2026-10-21', 'v1', 500) >= 0)
  assert.equal(pickPoemIndex('2026-10-21', 'v1', 0), null)
  assert.equal(pickPoemIndex('2026-10-21', 'v1', -1), null)
  assert.equal(pickPoemIndex('2026-10-21', 'v1', 2.5), null)
})

test('about：settingsPath 脱敏（HOME → ~，自定义 DSH_HOME → $DSH_HOME）', async () => {
  const home = makeTmpDir('dshp-home')
  const homeHarness = createHarness({ home, settingsFile: path.join(home, '.dsh', '.dsh-poetry', 'settings.json') })
  const homeAbout = (await homeHarness.call('about.json', mockRequest())).json()
  assert.equal(homeAbout.settingsPath, '~/.dsh/.dsh-poetry/settings.json')
  assert.equal(homeAbout.builtAt, '2026-10-21T03:00:00.000Z')

  const customDshHome = makeTmpDir('dshp-dshhome')
  const customHarness = createHarness({
    home,
    env: { DSH_HOME: customDshHome },
    settingsFile: path.join(customDshHome, '.dsh-poetry', 'settings.json'),
  })
  const customAbout = (await customHarness.call('about.json', mockRequest())).json()
  assert.equal(customAbout.settingsPath, '$DSH_HOME/.dsh-poetry/settings.json')
})

// ---------------------------------------------------------------------------
// 信任栅栏 + settings 路由
// ---------------------------------------------------------------------------

test('trust：回环主机名判定', () => {
  for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'foo.localhost', '[::1]']) {
    assert.equal(isLoopbackHostname(host.replace(/^\[|\]$/g, '')), true, host)
  }
  for (const host of ['evil.com', '127.0.0.1.evil.com', '10.0.0.1', 'localhost.evil.com', '']) {
    assert.equal(isLoopbackHostname(host), false, host)
  }
})

test('trust：缺 Host / 跨站 / 异源 Origin → 403；同源回环 → 通过', () => {
  const fence = createTrustFence({ getConnection: () => undefined })
  const check = (overrides) => fence.check(mockRequest(overrides))

  assert.equal(check({ headers: {} }).status, 403, '缺 Host')
  assert.equal(check({ headers: { host: 'evil.com' } }).status, 403, '非回环 Host（无宿主栅栏时）')
  assert.equal(check({ headers: { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' } }).status, 403)
  assert.equal(check({ headers: { host: '127.0.0.1:57623', origin: 'http://evil.com' } }).status, 403)
  assert.equal(check({ headers: { host: '127.0.0.1:57623', origin: 'null' } }).status, 403)
  assert.equal(check({ headers: { host: '127.0.0.1:57623', origin: 'http://127.0.0.1:57623' } }), null)
  assert.equal(check({ method: 'PUT', headers: { host: 'evil.com' } }).status, 403, '非回环写请求')
  assert.equal(check({ method: 'GET', headers: { host: 'localhost', 'sec-fetch-site': 'same-origin' } }), null)
})

test('trust：委托 connection.requestRejection，保留 401/403/fail-closed 语义', () => {
  const request = mockRequest()
  const makeFence = (requestRejection) => createTrustFence({ getConnection: () => ({ requestRejection }) })

  assert.equal(makeFence(() => 401).check(request).status, 401)
  assert.equal(makeFence(() => 401).check(request).code, 'UNAUTHORIZED')
  assert.equal(makeFence(() => 403).check(request).status, 403)
  assert.equal(makeFence(() => undefined).check(request), null)
  assert.equal(makeFence(() => false).check(request), null)
  assert.equal(makeFence(() => { throw new Error('boom') }).check(request).status, 403, '栅栏抛异常 → fail-closed')
  // 宿主已信任的反向代理权威（非回环 Host）交给宿主栅栏判定
  const proxied = mockRequest({ headers: { host: 'dsh.example.org' } })
  assert.equal(makeFence(() => undefined).check(proxied), null)
  assert.equal(makeFence(() => 403).check(proxied).status, 403)
})

test('路由：settings GET 返回 {ok:true, settings}', async () => {
  const harness = createHarness()
  const response = await harness.call('settings.json', mockRequest())
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ok: true, settings: { ...DEFAULT_SETTINGS } })
})

test('路由：PUT settings 合并写入并返回完整设置', async () => {
  const harness = createHarness()
  const response = await harness.call(
    'settings.json',
    mockRequest({ method: 'PUT', body: JSON.stringify({ scale: 2, mode: 'random', lastPoemId: 'tang-000002' }) }),
  )
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, true)
  assert.equal(body.settings.scale, 1.6)
  assert.equal(body.settings.mode, 'random')
  assert.equal(body.settings.lastPoemId, 'tang-000002')
  assert.equal(body.settings.updatedAt, 1700000000000)
  assert.equal(JSON.parse(fs.readFileSync(harness.settingsFile, 'utf8')).scale, 1.6)
})

test('路由：PUT settings 非法字段 → 400 INVALID_SETTINGS + fields', async () => {
  const harness = createHarness()
  const response = await harness.call(
    'settings.json',
    mockRequest({ method: 'PUT', body: JSON.stringify({ autoplay: 45, mode: 'weekly' }) }),
  )
  assert.equal(response.statusCode, 400)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'INVALID_SETTINGS')
  assert.deepEqual(body.error.fields, ['mode', 'autoplay'])
})

test('路由：PUT settings 非法 JSON / 超大请求体 → 400 fields:[body]', async () => {
  const harness = createHarness()
  const broken = await harness.call('settings.json', mockRequest({ method: 'PUT', body: '{not json' }))
  assert.equal(broken.statusCode, 400)
  assert.deepEqual(broken.json().error.fields, ['body'])

  const oversized = await harness.call(
    'settings.json',
    mockRequest({ method: 'PUT', body: JSON.stringify({ pad: 'x'.repeat(17 * 1024) }) }),
  )
  assert.equal(oversized.statusCode, 400)
  assert.deepEqual(oversized.json().error.fields, ['body'])
})

test('路由：PUT settings 跨站 / 异源 / 非回环 → 403 FORBIDDEN', async () => {
  const harness = createHarness()
  for (const headers of [
    { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:57623', origin: 'http://evil.example' },
    { host: 'evil.example' },
  ]) {
    const response = await harness.call('settings.json', mockRequest({ method: 'PUT', headers, body: '{}' }))
    assert.equal(response.statusCode, 403, JSON.stringify(headers))
    assert.equal(response.json().error.code, 'FORBIDDEN')
  }
})

test('路由：宿主栅栏返回 401 时读接口同样 401', async () => {
  const harness = createHarness({ fence: createTrustFence({ getConnection: () => ({ requestRejection: () => 401 }) }) })
  const response = await harness.call('health.json', mockRequest())
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'UNAUTHORIZED')
})

test('路由：信任栅栏自身抛异常 → fail-closed 403', async () => {
  const harness = createHarness({
    fence: {
      check() {
        throw new Error('fence boom')
      },
    },
  })
  const response = await harness.call('health.json', mockRequest())
  assert.equal(response.statusCode, 403)
  assert.equal(response.json().error.code, 'FORBIDDEN')
})

test('路由：设置磁盘写入失败 → 200 + ok:false（不抛异常）', async () => {
  const parentFile = path.join(makeTmpDir('dshp-settings'), 'not-a-directory')
  fs.writeFileSync(parentFile, 'occupied', 'utf8')
  const harness = createHarness({ settingsFile: path.join(parentFile, 'settings.json') })
  const response = await harness.call(
    'settings.json',
    mockRequest({ method: 'PUT', body: JSON.stringify({ scale: 1.1 }) }),
  )
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'SETTINGS_WRITE_FAILED')
})

test('路由：未知方法 → 405 + Allow', async () => {
  const harness = createHarness()
  const response = await harness.call('health.json', mockRequest({ method: 'POST' }))
  assert.equal(response.statusCode, 405)
  assert.equal(response.headers.Allow, 'GET')
  assert.equal(response.json().error.code, 'METHOD_NOT_ALLOWED')
})

test('路由：GET 数据接口原样透传文件顶层结构', async () => {
  const harness = createHarness()
  const poems = (await harness.call('poems.json', mockRequest())).json()
  assert.equal(poems.ok, true)
  assert.equal(poems.dataVersion, DATA_VERSION)
  assert.deepEqual(poems.items.map((item) => item.id), POEM_IDS)

  const knowledge = (await harness.call('knowledge.json', mockRequest())).json()
  assert.equal(knowledge.cards.length, 2)
  assert.equal(knowledge.ciCards.length, 3)
})

// ---------------------------------------------------------------------------
// 天气（契约 §2.9）与 settings 扩展（weatherCity / weatherPoem）
// ---------------------------------------------------------------------------

test('weather：WMO 码 → category/label 全表关键值（契约 §2.9）', () => {
  const cases = [
    [0, 'clear', '晴'],
    [1, 'cloud', '晴间多云'],
    [2, 'cloud', '多云'],
    [3, 'cloud', '阴'],
    [45, 'fog', '雾'],
    [48, 'fog', '冻雾'],
    [51, 'rain', '小毛毛雨'],
    [61, 'rain', '小雨'],
    [63, 'rain', '中雨'],
    [65, 'rain', '大雨'],
    [71, 'snow', '小雪'],
    [75, 'snow', '大雪'],
    [80, 'rain', '小阵雨'],
    [82, 'rain', '强阵雨'],
    [85, 'snow', '小阵雪'],
    [95, 'thunder', '雷阵雨'],
    [99, 'thunder', '强雷暴伴冰雹'],
  ]
  for (const [code, category, label] of cases) {
    const weather = mapWeather({ code, tempC: 15, windKph: 5, isDay: 1 })
    assert.equal(weather.category, category, `code ${code} category`)
    assert.equal(weather.label, label, `code ${code} label`)
  }

  // 未映射的 WMO 码 → unknown
  const unknownCode = mapWeather({ code: 42, tempC: 15, windKph: 5 })
  assert.equal(unknownCode.category, 'unknown')
  assert.equal(unknownCode.label, '未知')

  // 非雨雪雷 + 风速 ≥25 → wind（契约 §2.9）
  const windy = mapWeather({ code: 3, tempC: 10, windKph: 25, isDay: 1 })
  assert.equal(windy.category, 'wind')
  assert.equal(windy.label, '阴，大风')
  assert.equal(mapWeather({ code: 3, tempC: 10, windKph: 24.9 }).category, 'cloud', '风速未达阈值不覆盖')

  // 温度 ≤0 且非雪 → cold
  const cold = mapWeather({ code: 0, tempC: -3, windKph: 5, isDay: 1 })
  assert.equal(cold.category, 'cold')
  assert.equal(cold.label, '晴，寒冷')
  assert.equal(mapWeather({ code: 0, tempC: 0 }).category, 'cold', '0℃ 边界算 cold')
  assert.equal(mapWeather({ code: 0, tempC: 0.1 }).category, 'clear')

  // 雨雪雷不被风速/低温覆盖
  assert.equal(mapWeather({ code: 61, tempC: -2, windKph: 40 }).category, 'rain')
  assert.equal(mapWeather({ code: 71, tempC: -8, windKph: 40 }).category, 'snow')
  assert.equal(mapWeather({ code: 95, tempC: -5, windKph: 50 }).category, 'thunder')

  // isDay / 数值透传与规范化
  const passed = mapWeather({
    code: 1,
    isDay: 0,
    tempC: 18.55,
    feelsLikeC: 17.24,
    humidity: 71.4,
    windKph: 12.44,
    latitude: 39.9075,
    longitude: 116.39723,
    updatedAt: 1760000000000,
  })
  assert.equal(passed.isDay, false, 'is_day=0 → isDay=false')
  assert.equal(mapWeather({ code: 1, isDay: 1 }).isDay, true)
  assert.equal(typeof passed.isDay, 'boolean')
  assert.equal(passed.tempC, 18.6)
  assert.equal(passed.feelsLikeC, 17.2)
  assert.equal(passed.humidity, 71)
  assert.equal(passed.windKph, 12.4)
  assert.equal(passed.latitude, 39.9075)
  assert.equal(passed.longitude, 116.39723)
  assert.equal(passed.updatedAt, 1760000000000)
  assert.equal(passed.code, 1)
  assert.equal(passed.source, 'open-meteo')
})

test('weather：normalizeCity 城市归一化（trim/长度/非法→北京）', () => {
  assert.equal(WEATHER_DEFAULT_CITY, '北京')
  assert.equal(normalizeCity('北京'), '北京')
  assert.equal(normalizeCity('  上海  '), '上海')
  assert.equal(normalizeCity(''), '北京')
  assert.equal(normalizeCity('    '), '北京')
  assert.equal(normalizeCity(null), '北京')
  assert.equal(normalizeCity(undefined), '北京')
  assert.equal(normalizeCity(123), '北京')
  assert.equal(normalizeCity('北\n京'), '北京', '控制字符视为非法')
  assert.equal(normalizeCity('x'.repeat(20)), 'x'.repeat(20), '20 字符合法')
  assert.equal(normalizeCity('x'.repeat(21)), '北京', '超长回退北京')
  assert.equal(normalizeCity('城'.repeat(20)), '城'.repeat(20))
})

test('weather 服务：成功映射 Open-Meteo current + 20min 缓存命中', async () => {
  let clock = 1_700_000_000_000
  const { fetchImpl, calls } = makeWeatherFetch()
  const service = createWeatherService({ fetchImpl, now: () => clock })

  const first = await service.getWeather('北京')
  assert.equal(first.ok, true)
  assert.equal(first.city, '北京')
  assert.equal(first.stale, false)
  assert.equal(first.weather.category, 'rain')
  assert.equal(first.weather.label, '小雨')
  assert.equal(first.weather.tempC, 18.5)
  assert.equal(first.weather.feelsLikeC, 17.2)
  assert.equal(first.weather.humidity, 71)
  assert.equal(first.weather.windKph, 12.4)
  assert.equal(first.weather.isDay, true)
  assert.equal(first.weather.code, 61)
  assert.equal(first.weather.latitude, 39.9075)
  assert.equal(first.weather.longitude, 116.39723)
  assert.equal(first.weather.updatedAt, clock)
  assert.equal(first.weather.source, 'open-meteo')
  assert.equal(calls.length, 2, '首次 = 地理编码 + 天气各一次')
  assert.match(calls[0], /geocoding-api\.open-meteo\.com\/v1\/search\?name=%E5%8C%97%E4%BA%AC/)
  assert.match(calls[1], /api\.open-meteo\.com\/v1\/forecast\?latitude=39\.9075&longitude=116\.39723/)
  assert.match(calls[1], /current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m/)

  const second = await service.getWeather('北京')
  assert.equal(second.ok, true)
  assert.equal(calls.length, 2, '20min 内命中缓存，不再发请求')

  clock += 21 * 60 * 1000
  const refreshed = await service.getWeather('北京')
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.stale, false)
  assert.equal(calls.length, 3, '天气缓存过期后仅重取 forecast（地理编码 24h 仍命中）')

  // ?refresh=1 → 即使天气缓存仍新鲜也强制重取
  const forced = await service.getWeather('北京', { refresh: true })
  assert.equal(forced.ok, true)
  assert.equal(calls.length, 4)
})

test('weather 服务：地理编码按城市缓存 + 上限淘汰（maxCacheEntries）', async () => {
  let clock = 1_700_000_000_000
  let geoFetches = 0
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://geocoding-api.open-meteo.com')) {
      geoFetches += 1
      return { ok: true, status: 200, json: async () => ({ results: [{ latitude: geoFetches, longitude: geoFetches + 0.5 }] }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        current: {
          weather_code: 0,
          is_day: 1,
          temperature_2m: 10,
          relative_humidity_2m: 50,
          apparent_temperature: 9,
          wind_speed_10m: 5,
        },
      }),
    }
  }
  const service = createWeatherService({ fetchImpl, now: () => clock, maxCacheEntries: 2 })
  await service.getWeather('北京')
  await service.getWeather('上海')
  await service.getWeather('广州')
  assert.equal(geoFetches, 3)

  // 缓存上限 2：北京已被淘汰 → 重新地理编码
  await service.getWeather('北京')
  assert.equal(geoFetches, 4, '被淘汰城市重新请求地理编码')

  // 广州仍在缓存（24h 内）→ 不再请求
  await service.getWeather('广州')
  assert.equal(geoFetches, 4, '缓存命中城市不重复请求')
})

test('weather 服务：peekCached 只读缓存、不触发网络请求', async () => {
  const { fetchImpl, calls } = makeWeatherFetch()
  const service = createWeatherService({ fetchImpl, now: () => 1_700_000_000_000 })
  assert.equal(service.peekCached('北京'), null, '没有缓存时返回 null')
  await service.getWeather('北京')
  const callsAfter = calls.length
  const cached = service.peekCached('北京')
  assert.ok(cached !== null, '有缓存时返回天气')
  assert.equal(cached.weather.category, 'rain')
  assert.equal(cached.stale, false)
  assert.equal(calls.length, callsAfter, 'peekCached 不发起新请求')
  assert.equal(service.peekCached('不存在的城市'), null)
})

test('weather 服务：请求失败回退 stale 缓存并标 stale:true；无缓存失败 WEATHER_UNAVAILABLE', async () => {
  let clock = 1_700_000_000_000
  const { fetchImpl: okFetch } = makeWeatherFetch()
  let callCount = 0
  const flakyFetch = async (url) => {
    callCount += 1
    if (callCount > 2) throw new Error('offline')
    return okFetch(url)
  }
  const service = createWeatherService({ fetchImpl: flakyFetch, now: () => clock })
  const first = await service.getWeather('北京')
  assert.equal(first.ok, true)
  assert.equal(first.stale, false)
  assert.equal(callCount, 2)

  clock += 21 * 60 * 1000
  const stale = await service.getWeather('北京')
  assert.equal(stale.ok, true, '有旧结果时失败也返回 ok:true')
  assert.equal(stale.stale, true, '失败保留上次结果并标 stale')
  assert.equal(stale.weather.category, 'rain')
  assert.equal(stale.weather.updatedAt, first.weather.updatedAt, 'stale 保留上次成功时间')
  assert.equal(callCount, 3)

  // 完全无缓存 → ok:false WEATHER_UNAVAILABLE
  const noCache = createWeatherService({
    fetchImpl: async () => Promise.reject(new Error('offline')),
    now: () => clock,
  })
  const failed = await noCache.getWeather('北京')
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'WEATHER_UNAVAILABLE')

  // 地理编码成功、天气从未成功过 → 无 stale 天气可回退 → 失败
  const geoOkForecastFail = createWeatherService({
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://geocoding-api.open-meteo.com')) {
        return { ok: true, status: 200, json: async () => ({ results: [{ latitude: 1, longitude: 2 }] }) }
      }
      throw new Error('forecast offline')
    },
    now: () => clock,
  })
  const noForecast = await geoOkForecastFail.getWeather('北京')
  assert.equal(noForecast.ok, false)
  assert.equal(noForecast.error.code, 'WEATHER_UNAVAILABLE')
})

test('weather 服务：请求超时按失败处理（6s 超时可注入缩短）', async () => {
  const never = () => new Promise(() => {})
  const service = createWeatherService({ fetchImpl: never, now: () => 1, timeoutMs: 20 })
  const result = await service.getWeather('北京')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'WEATHER_UNAVAILABLE')
  assert.match(result.error.message, /超时/)
})

test('weather 路由：成功形状 / 使用 settings.weatherCity / refresh 透传 / 永不 5xx', async () => {
  const seen = []
  const stubWeather = {
    async getWeather(city, options) {
      seen.push({ city, options })
      return {
        ok: true,
        city,
        weather: mapWeather({ code: 0, isDay: 1, tempC: 20, feelsLikeC: 19, humidity: 40, windKph: 3, latitude: 39.9, longitude: 116.4, updatedAt: 1700000000000 }),
        stale: false,
      }
    },
  }
  const harness = createHarness({ weatherService: stubWeather })

  const response = await harness.call('weather.json', mockRequest({ url: '/api/dsh-poetry/weather.json' }))
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, true)
  assert.equal(body.city, '北京', '默认 weatherCity')
  assert.equal(body.stale, false)
  assert.equal(body.weather.category, 'clear')
  assert.equal(body.weather.label, '晴')
  assert.equal(seen[0].city, '北京')
  assert.deepEqual(seen[0].options, { refresh: false })

  // 城市来自 settings，而不是请求参数
  harness.settingsStore.put({ weatherCity: '  上海 ' })
  await harness.call('weather.json', mockRequest({ url: '/api/dsh-poetry/weather.json' }))
  assert.equal(seen[1].city, '上海')

  // refresh=1 透传到服务层
  await harness.call('weather.json', mockRequest({ url: '/api/dsh-poetry/weather.json?refresh=1' }))
  assert.deepEqual(seen[2].options, { refresh: true })
})

test('weather 路由：服务失败 → 200 + WEATHER_UNAVAILABLE；跨站请求仍被栅栏 403', async () => {
  const failing = createHarness({
    weatherService: { getWeather: async () => ({ ok: false, error: { code: 'WEATHER_UNAVAILABLE', message: 'offline' } }) },
  })
  const response = await failing.call('weather.json', mockRequest())
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'WEATHER_UNAVAILABLE')

  const crossed = await failing.call('weather.json', mockRequest({ headers: { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' } }))
  assert.equal(crossed.statusCode, 403)
  assert.equal(crossed.json().error.code, 'FORBIDDEN')
})

test('weather 路由：未注入 weatherService 时优雅降级（ok:false，200）', async () => {
  const dataDir = makeTmpDir('dshp-data')
  writeFixtureData(dataDir)
  const home = makeTmpDir('dshp-home')
  const settingsFile = path.join(home, '.dsh', '.dsh-poetry', 'settings.json')
  const dataStore = createDataStore({ dataDir })
  const settingsStore = createSettingsStore({ file: settingsFile })
  const handlers = new Map(
    createRouteTable({
      dataStore,
      settingsStore,
      fence: createTrustFence({ getConnection: () => undefined }),
      version: '0.1.0',
      settingsFile,
    }).map((route) => [route.path, route.handler]),
  )
  const response = new MockResponse()
  await handlers.get('/api/dsh-poetry/weather.json')(mockRequest(), response)
  await response.finished()
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'WEATHER_UNAVAILABLE')
})

test('settings：weatherCity/weatherPoem 默认值与校验（归一不报错）', async () => {
  assert.equal(DEFAULT_SETTINGS.weatherCity, '北京')
  assert.equal(DEFAULT_SETTINGS.weatherPoem, true)
  assert.deepEqual(validateSettingsPatch({ weatherCity: '  上海 ' }), { ok: true, patch: { weatherCity: '上海' } })
  assert.deepEqual(validateSettingsPatch({ weatherCity: '' }), { ok: true, patch: { weatherCity: '北京' } })
  assert.deepEqual(validateSettingsPatch({ weatherCity: 'x'.repeat(21) }), { ok: true, patch: { weatherCity: '北京' } })
  assert.deepEqual(validateSettingsPatch({ weatherCity: 42 }), { ok: true, patch: { weatherCity: '北京' } }, '非字符串也归一')
  assert.deepEqual(validateSettingsPatch({ weatherPoem: false }), { ok: true, patch: { weatherPoem: false } })
  assert.deepEqual(validateSettingsPatch({ weatherPoem: 'yes' }).fields, ['weatherPoem'])

  const file = path.join(makeTmpDir('dshp-settings'), '.dsh-poetry', 'settings.json')
  const store = createSettingsStore({ file })
  assert.equal(store.get().weatherCity, '北京')
  assert.equal(store.get().weatherPoem, true)
  const updated = store.put({ weatherCity: '  杭州 ', weatherPoem: false })
  assert.equal(updated.ok, true)
  assert.equal(updated.settings.weatherCity, '杭州')
  assert.equal(updated.settings.weatherPoem, false)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).weatherCity, '杭州')

  // 路由层：非法 weatherPoem → 400 INVALID_SETTINGS / weatherCity 非法值不报错
  const harness = createHarness()
  const bad = await harness.call('settings.json', mockRequest({ method: 'PUT', body: JSON.stringify({ weatherPoem: 'yes' }) }))
  assert.equal(bad.statusCode, 400)
  assert.deepEqual(bad.json().error.fields, ['weatherPoem'])
  const good = await harness.call(
    'settings.json',
    mockRequest({ method: 'PUT', body: JSON.stringify({ weatherCity: 123, weatherPoem: false }) }),
  )
  assert.equal(good.statusCode, 200)
  assert.equal(good.json().settings.weatherCity, '北京')
  assert.equal(good.json().settings.weatherPoem, false)
})

// ---------------------------------------------------------------------------
// 心情统计（契约 v1.4 §2.10）与 settings 扩展（mood / spontaneousPoem）
// ---------------------------------------------------------------------------
