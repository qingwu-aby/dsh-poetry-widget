// tests/helpers/harness.mjs —— 从 host.test 抽出的共享测试脚手架（W3）
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
import { createAssetHandler, resolveAssetPath } from '../../lib/assets.mjs'
import { createDataStore, pickPoemIndex } from '../../lib/data-store.mjs'
import { formatLocalDate, maskPath, readPackageMeta } from '../../lib/paths.mjs'
import { createRouteTable } from '../../lib/routes.mjs'
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  normalizeSettings,
  resolveSettingsPath,
  validateSettingsPatch,
} from '../../lib/settings-store.mjs'
import { createTrustFence, isLoopbackHostname } from '../../lib/trust.mjs'
import {
  DEFAULT_CITY as WEATHER_DEFAULT_CITY,
  createWeatherService,
  mapWeather,
  normalizeCity,
} from '../../lib/weather.mjs'
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
} from '../../lib/mood.mjs'
import {
  EXPERIENCE_EMOTION_LABELS,
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_MAX_AGE_MS,
  readExperience,
  resolveExperiencePath,
} from '../../lib/experience.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  isSafeWebmRelative,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  resolvePetMediaDir,
} from '../../lib/pet-media.mjs'
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
} from '../../lib/memory-journal.mjs'
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
} from '../../lib/mood-ai.mjs'
import {
  MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_DSH_OPENCODE_PROVIDER,
} from '../../lib/model-policy.mjs'
import {
  MODEL_ERRORS_MAX_LINES,
  MODEL_ERRORS_MESSAGE_MAX,
  MODEL_ERRORS_ROUTE,
  appendModelError,
  buildModelErrorRecord,
  createModelErrorsHandler,
  readModelErrors,
  resolveModelErrorsPath,
} from '../../lib/model-errors.mjs'
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
} from '../../lib/model-policy.mjs'
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
} from '../../lib/voice-memory.mjs'
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
} from '../../lib/memory-recall.mjs'
import {
  MEMORY_BACKUP_INTERVAL_MS,
  MEMORY_BACKUP_MAX,
  MEMORY_BACKUP_ROUTE,
  MEMORY_ROUTE,
  createMemoryBackupHandler,
  createMemoryHub,
  createMemorySnapshotHandler,
  resolveMemoryHubPaths,
} from '../../lib/memory-hub.mjs'
import {
  SELF_DRIVE_ACTIONS,
  buildSelfDrivePrompt,
  createSelfDrive,
  parseSelfDriveResult,
} from '../../lib/self-drive.mjs'
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
} from '../../lib/self-being.mjs'
import {
  FEELING_DESC_MAX,
  FEELING_NAME_MAX,
  appendFeeling,
  loadFeelingBank,
  normalizeFeeling,
  parseNewFeeling,
  readFeelingFile,
  resolveFeelingsPath,
} from '../../lib/feelings.mjs'
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
} from '../../lib/self-growth.mjs'
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
} from '../../lib/self-wander.mjs'
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
} from '../../lib/self-reading.mjs'
import { runMemoryMigrations } from '../../lib/memory-migrations.mjs'
import { createDshHost } from '../../lib/dsh-host.mjs'
import { createSelfProjects, projectCanRetry, projectProgressAt, projectStage } from '../../lib/self-projects.mjs'
import { createGuiInbox, pushGuiInbox, readGuiInbox, GUI_INBOX_MAX } from '../../lib/gui-inbox.mjs'
import { normalizeVideoCourse, readVideoCourses, readVideoCoursesShelf } from '../../lib/video-courses.mjs'
import { createSelfEvents } from '../../lib/self-events.mjs'
import { createMetabolism } from '../../lib/self-metabolism.mjs'
import { createWorldFeedback } from '../../lib/world-feedback.mjs'
import { PRESENCE_ROUTE, createPresenceHandler } from '../../lib/presence.mjs'
import { createChatBridge } from '../../lib/chat-bridge.mjs'
import { createCurriculum } from '../../lib/self-curriculum.mjs'
import { createMediaBudget } from '../../lib/media-budget.mjs'
import { createAttentionStore } from '../../lib/attention.mjs'
import { createOutbox } from '../../lib/outbox.mjs'
import { constitutionLines, PROMPT_LAYERS_VERSION } from '../../lib/prompt-layers.mjs'
import { fetchShugeEntry, searchShuge } from '../../lib/shuge.mjs'
import { createLifecycle } from '../../lib/self-lifecycle.mjs'
import { createTwinBridge } from '../../lib/twin-bridge.mjs'
import { createTwinResearch } from '../../lib/twin-research.mjs'
import { createGrowthMetrics } from '../../lib/growth-metrics.mjs'
import { createSelfWorks, createWorksHandler, sanitizeWorkSvg } from '../../lib/self-works.mjs'
import { createManualReadHandler, createManualReading, ensureManualToken } from '../../lib/manual-reading.mjs'
import { seedMemoryBaseline } from '../../lib/memory-baseline.mjs'
import { createHeartbeat } from '../../lib/heartbeat.mjs'
import { createModelBudget, createModelGate } from '../../lib/model-budget.mjs'
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
} from '../../lib/safe-web.mjs'
import { callModelForRole, configureModelRuntime, resetModelRuntime } from '../../lib/llm-call.mjs'
import {
  buildConsolidationPrompt,
  countJournalEntries,
  createMemoryConsolidator,
  createMemoryLayers,
  parseConsolidationResult,
  readMemoryLayers,
  resolveMemoryLayersPath,
} from '../../lib/memory-layers.mjs'
import {
  SELF_NETLANG_GAP_MS,
  SELF_NETLANG_SOURCES,
  buildNetlangPrompt,
  createSelfNetlang,
  fetchNetlangTitles,
  parseGithubTrendingHtml,
  parseNetlangPayload,
  parseNetlangResult,
} from '../../lib/self-netlang.mjs'
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
} from '../../lib/self-actions.mjs'
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
} from '../../lib/self-state.mjs'
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
} from '../../lib/self-talk-topics.mjs'
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

export const POEM_IDS = ['tang-000001', 'tang-000002', 'tang-000003']
export const DATA_VERSION = '2026-10-21.1'
export const FIXED_NOW = new Date(2026, 9, 21, 10, 0, 0) // 本地时间 2026-10-21（与时区无关）

export function makeTmpDir(prefix = 'dshp-host') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function writeFixtureData(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  writeJson(path.join(dataDir, 'manifest.json'), {
    dataVersion: DATA_VERSION,
    source: { repo: 'chinese-poetry/chinese-poetry', commit: 'b8594f81a89752241442f2ce267d6f66f96704ee', license: 'MIT' },
    builtAt: '2026-10-21T03:00:00.000Z',
    stats: { poemsKept: POEM_IDS.length },
    files: {},
  })
  writeJson(path.join(dataDir, 'poems.json'), {
    ok: true,
    dataVersion: DATA_VERSION,
    items: POEM_IDS.map((id, index) => ({ id, title: `诗${index}`, author: '某', lines: [], tones: [] })),
  })
  writeJson(path.join(dataDir, 'ci.json'), {
    ok: true,
    dataVersion: DATA_VERSION,
    items: [{ id: 'ci-1' }, { id: 'ci-2' }],
  })
  writeJson(path.join(dataDir, 'yun.json'), {
    ok: true,
    dataVersion: DATA_VERSION,
    volumes: [
      { title: '上卷', chapters: [{}, {}, {}] },
      { title: '下卷', chapters: [{}, {}] },
    ],
  })
  writeJson(path.join(dataDir, 'knowledge.json'), {
    ok: true,
    dataVersion: DATA_VERSION,
    cards: [{}, {}],
    ciCards: [{}, {}, {}],
  })
}

/** 可同时服务 JSON（res.end）与流式静态资源（pipe）的 mock 响应。 */
export class MockResponse extends Writable {
  constructor() {
    super()
    this.statusCode = 0
    this.headers = {}
    this.chunks = []
  }

  writeHead(status, headers = {}) {
    this.statusCode = status
    this.headers = headers ?? {}
    return this
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  get bodyText() {
    return Buffer.concat(this.chunks).toString('utf8')
  }

  json() {
    return JSON.parse(this.bodyText)
  }

  /** 等待流式响应的 finish（JSON handler 同步 end 时也成立）。 */
  finished() {
    if (this.writableFinished) return Promise.resolve(this)
    return new Promise((resolve) => {
      this.once('finish', () => resolve(this))
      if (this.writableFinished) resolve(this)
    })
  }
}

export function mockRequest({ method = 'GET', headers = { host: '127.0.0.1:57623' }, url = '/', body } = {}) {
  const request = { method, headers, url }
  request[Symbol.asyncIterator] = async function* iterator() {
    if (body !== undefined) yield Buffer.isBuffer(body) ? body : Buffer.from(body)
  }
  return request
}

/** 组装一个隔离的（临时 dataDir + 临时 settings.json）路由表。 */
export function createHarness(overrides = {}) {
  const dataDir = overrides.dataDir ?? (() => {
    const dir = makeTmpDir('dshp-data')
    writeFixtureData(dir)
    return dir
  })()
  const home = overrides.home ?? makeTmpDir('dshp-home')
  const settingsFile = overrides.settingsFile ?? path.join(home, '.dsh', '.dsh-poetry', 'settings.json')
  const env = overrides.env ?? {}
  const now = overrides.now ?? (() => FIXED_NOW)
  const getSelfState = overrides.getSelfState
  const dataStore = createDataStore({ dataDir })
  const settingsStore =
    overrides.settingsStore ??
    createSettingsStore({
      file: settingsFile,
      knownPoemIds: () => dataStore.knownPoemIds(),
      now: () => 1700000000000,
    })
  const fence = overrides.fence ?? createTrustFence({ getConnection: () => undefined })
  const version = overrides.version ?? '0.1.0'
  // 默认天气服务：不发网络请求（单测里需要天气的用例显式注入 mock service）。
  const weatherService = overrides.weatherService ?? {
    getWeather: async () => ({ ok: false, error: { code: 'WEATHER_UNAVAILABLE', message: '测试未注入天气服务' } }),
  }
  const moodTracker =
    overrides.moodTracker ??
    createMoodTracker({
      file: overrides.moodFile ?? path.join(makeTmpDir('dshp-mood'), 'mood.json'),
      now: () => FIXED_NOW.getTime(),
      persistDebounceMs: 0,
    })
  const selfTalkService =
    overrides.selfTalkService ??
    createSelfTalkService({
      llm: null,
      getSelection: () => null,
      now: () => FIXED_NOW.getTime(),
      minIntervalMs: 0,
    })
  const moodAiService =
    overrides.moodAiService ??
    createMoodAiService({
      llm: null,
      getSelection: () => null,
      catalog: realMoodCatalog(),
      now: () => FIXED_NOW.getTime(),
      cacheTtlMs: 0,
      minIntervalMs: 0,
    })
  const feihuaFullDir = overrides.feihuaFullDir ?? makeTmpDir('dshp-feihua-full')
  const feihuaFullService =
    overrides.feihuaFullService !== undefined
      ? overrides.feihuaFullService
      : createFeihuaFullService({ dir: feihuaFullDir, logger: { warn() {} } })
  const journalDir = overrides.journalDir ?? path.join(makeTmpDir('dshp-memory'), 'agent-memory')
  const journal =
    overrides.journal ??
    createMemoryJournal({
      dir: journalDir,
      logger: { warn() {} },
      now: () => FIXED_NOW.getTime(),
    })
  const handlers = new Map(
    createRouteTable({
      dataStore,
      settingsStore,
      fence,
      version,
      settingsFile,
      weatherService,
      moodTracker,
      selfTalkService,
      moodAiService,
      journal,
      feihuaFullService,
      getSelfState,
      env,
      home,
      now,
    }).map((route) => [route.path, route.handler]),
  )

  async function call(name, request) {
    const handler = handlers.get(`/api/dsh-poetry/${name}`)
    assert.ok(handler, `路由存在：${name}`)
    const response = new MockResponse()
    await handler(request, response)
    await response.finished()
    return response
  }

  return {
    dataDir,
    settingsFile,
    home,
    env,
    dataStore,
    settingsStore,
    weatherService,
    moodTracker,
    selfTalkService,
    moodAiService,
    journal,
    journalDir,
    feihuaFullDir,
    feihuaFullService,
    handlers,
    call,
  }
}

/** 构造一个假的 Open-Meteo fetch：calls 记录请求 URL；failFrom 指定第几次请求起抛错。 */
export function makeWeatherFetch(options = {}) {
  const geo = options.geo ?? { name: '北京', latitude: 39.9075, longitude: 116.39723 }
  const current = options.current ?? {
    time: '2026-10-21T10:00',
    temperature_2m: 18.5,
    relative_humidity_2m: 71,
    apparent_temperature: 17.2,
    is_day: 1,
    weather_code: 61,
    wind_speed_10m: 12.4,
  }
  const calls = []
  const failFrom = options.failFrom
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (failFrom !== undefined && calls.length >= failFrom) throw new Error('network down')
    if (String(url).startsWith('https://geocoding-api.open-meteo.com')) {
      return { ok: true, status: 200, json: async () => ({ results: [geo] }) }
    }
    return { ok: true, status: 200, json: async () => ({ current }) }
  }
  return { fetchImpl, calls }
}

/**
 * 造一个假的 llm 服务：calls 记录每次 stream(options)；responder 返回：
 *   string → 文本（按 \u0001 分段 yield text-delta，再 yield finish stop）
 *   {chunks, finish, noFinish, hang, throwError} → 精确控制流
 */
export function makeMockLlm(responder) {
  const calls = []
  const stream = (options) => {
    calls.push(options)
    return (async function* iterator() {
      const outcome = await (typeof responder === 'function' ? responder(options, calls.length) : responder)
      if (outcome instanceof Error) throw outcome
      if (outcome !== null && typeof outcome === 'object' && outcome.hang === true) {
        await new Promise(() => {})
        return
      }
      let chunks = []
      let finish = { kind: 'stop' }
      let noFinish = false
      if (typeof outcome === 'string') {
        chunks = outcome.split('\u0001').filter((part) => part !== undefined).map((text) => ({ type: 'text-delta', index: 0, text }))
      } else if (Array.isArray(outcome)) {
        chunks = outcome
      } else if (outcome !== null && typeof outcome === 'object') {
        if (Array.isArray(outcome.chunks)) chunks = outcome.chunks
        else if (typeof outcome.text === 'string') chunks = [{ type: 'text-delta', index: 0, text: outcome.text }]
        if (outcome.finish !== undefined) finish = outcome.finish
        noFinish = outcome.noFinish === true
      }
      for (const chunk of chunks) yield chunk
      if (!noFinish) yield { type: 'finish', reason: finish }
    })()
  }
  return { calls, stream }
}

export const SELF_TALK_SELECTION = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' }
export const SELF_TALK_LINES_A = ['今天的小雨让我有点想窝在窗边看雨', '我数了数你敲键盘的声音，好像比昨天轻快']
export const SELF_TALK_LINES_B = ['书页翻到一半的时候我忽然想起你在忙', '窗外没有月亮，我就自己亮了会儿']

/** 构造一个注入 mock llm 的 self-talk 服务 + 可控时钟。 */
export function makeSelfTalkHarness(overrides = {}) {
  const state = { clock: FIXED_NOW.getTime() }
  const llm = overrides.llm ?? makeMockLlm(overrides.responder ?? (() => SELF_TALK_LINES_A.join('\n')))
  const service = createSelfTalkService({
    llm,
    getSelection: overrides.getSelection ?? (() => SELF_TALK_SELECTION),
    now: () => state.clock,
    minIntervalMs: overrides.minIntervalMs ?? 0,
    timeoutMs: overrides.timeoutMs ?? 300,
    logger: { warn() {} },
    policy: overrides.policy,
    modelErrorsPath: overrides.modelErrorsPath,
  })
  return { llm, service, state }
}

export let cachedRealMoodCatalog = null
/** 真实心情图鉴（懒加载一次；缺失返回 null）。 */
export function realMoodCatalog() {
  if (cachedRealMoodCatalog === null) {
    const loaded = loadMoodCatalog()
    cachedRealMoodCatalog = loaded.ok === true ? loaded.catalog : { missing: true }
  }
  return cachedRealMoodCatalog.missing === true ? null : cachedRealMoodCatalog
}

/** 小型测试图鉴（含节日 when），用于 prompt/parse 的确定性断言。 */
export function makeMoodCatalogFixture() {
  return normalizeMoodCatalog({
    ok: true,
    version: 'test.1',
    images: [
      { file: 'dsh-whale-state-happy.webp', label: '开心', tags: ['happy', 'celebrate'] },
      { file: 'dsh-whale-state-achievement.webp', label: '有成就感', tags: ['proud', 'success'] },
      { file: 'dsh-whale-state-sad.webp', label: '失落', tags: ['sad'] },
      { file: 'dsh-whale-state-tired.webp', label: '累到融化', tags: ['tired', 'melt'] },
      { file: 'dsh-whale-state-xmas.webp', label: '圣诞', tags: ['festival', 'christmas'], when: '12-24..12-26' },
      { file: 'dsh-whale-state-halloween.webp', label: '万圣节', tags: ['festival', 'halloween'], when: '10-31' },
      { file: 'dsh-whale-state-midautumn.webp', label: '中秋', tags: ['festival', 'midautumn'], when: '中秋' },
      { file: 'dsh-whale-state-valentine.webp', label: '情人节', tags: ['festival', 'valentine'], when: '02-14' },
    ],
    panelImages: [{ file: 'dsh-whale-home-peek.webp', label: '探头', scope: 'panel' }],
  })
}

/** 构造一个注入 mock llm 的 mood-ai 服务 + 可控时钟。 */
export function makeMoodAiHarness(overrides = {}) {
  const state = { clock: FIXED_NOW.getTime() }
  const catalog = overrides.catalog === undefined ? makeMoodCatalogFixture() : overrides.catalog
  const llm = overrides.llm ?? makeMockLlm(overrides.responder ?? (() => JSON.stringify({
    label: '开心',
    image: 'dsh-whale-state-happy.webp',
    reason: '今天聊得很开心',
    energy: 82,
  })))
  const service = createMoodAiService({
    llm,
    getSelection: overrides.getSelection ?? (() => SELF_TALK_SELECTION),
    catalog,
    now: () => state.clock,
    timeoutMs: overrides.timeoutMs ?? 300,
    cacheTtlMs: overrides.cacheTtlMs ?? MOOD_AI_CACHE_TTL_MS,
    minIntervalMs: overrides.minIntervalMs ?? 0,
    logger: { warn() {} },
    policy: overrides.policy,
    modelErrorsPath: overrides.modelErrorsPath,
    feelings: overrides.feelings,
  })
  return { llm, service, state, catalog }
}

export function expectedPoemId(date, dataVersion, ids) {
  // 独立复算契约公式 sha256(YYYY-MM-DD + dataVersion) % poems.length
  const digest = createHash('sha256').update(`${date}${dataVersion}`, 'utf8').digest('hex')
  return ids[Number(BigInt(`0x${digest}`) % BigInt(ids.length))]
}

// ---------------------------------------------------------------------------
// 插件入口 / 纯函数
// ---------------------------------------------------------------------------

export const MOOD_T0 = new Date(2026, 9, 21, 10, 0, 0).getTime()

export function moodEvent(type, time, data = {}) {
  return { type, time, data }
}

export function emptyStatsForTest() {
  return {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolErrors: 0,
    turns: 0,
    turnsCompleted: 0,
    turnsErrored: 0,
    activeMs: 0,
    sessions: 0,
    firstActivityAt: 0,
    lastActivityAt: 0,
  }
}

export function readJournalJsonl(dir) {
  const file = path.join(dir, 'journal.jsonl')
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}
