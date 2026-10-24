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

import { name as pluginName, apply as pluginApply } from '../index.js'
import { createAssetHandler, resolveAssetPath } from '../lib/assets.mjs'
import { createDataStore, pickPoemIndex } from '../lib/data-store.mjs'
import { formatLocalDate, maskPath, readPackageMeta } from '../lib/paths.mjs'
import { createRouteTable } from '../lib/routes.mjs'
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  normalizeSettings,
  resolveSettingsPath,
  validateSettingsPatch,
} from '../lib/settings-store.mjs'
import { createTrustFence, isLoopbackHostname } from '../lib/trust.mjs'
import {
  DEFAULT_CITY as WEATHER_DEFAULT_CITY,
  createWeatherService,
  mapWeather,
  normalizeCity,
} from '../lib/weather.mjs'
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
} from '../lib/mood.mjs'
import {
  EXPERIENCE_EMOTION_LABELS,
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_MAX_AGE_MS,
  readExperience,
  resolveExperiencePath,
} from '../lib/experience.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  isSafeWebmRelative,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  resolvePetMediaDir,
} from '../lib/pet-media.mjs'
import {
  createFeihuaFullService,
  isValidFeihuaChar,
  resolveFeihuaFullDir,
} from '../lib/feihua-full.mjs'
import {
  JOURNAL_MURMUR_MIN_INTERVAL_MS,
  MEMORY_JOURNAL_HEADER,
  createMemoryJournal,
  formatJournalTime,
  resolveMemoryDir,
} from '../lib/memory-journal.mjs'
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
} from '../lib/mood-ai.mjs'
import {
  MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
  MODEL_POLICY_DSH_OPENCODE_PROVIDER,
} from '../lib/model-policy.mjs'
import {
  MODEL_ERRORS_MAX_LINES,
  MODEL_ERRORS_MESSAGE_MAX,
  MODEL_ERRORS_ROUTE,
  appendModelError,
  buildModelErrorRecord,
  createModelErrorsHandler,
  readModelErrors,
  resolveModelErrorsPath,
} from '../lib/model-errors.mjs'
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
} from '../lib/model-policy.mjs'
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
} from '../lib/voice-memory.mjs'
import {
  MEMORY_RECALL_JOURNAL_LINES,
  bigramJaccard,
  chineseBigrams,
  createMemoryRecall,
  extractRecallKeywords,
  formatMemoryDigest,
  readLearningSections,
  readRecentJournalEntries,
  resolveMemoryRecallPaths,
} from '../lib/memory-recall.mjs'
import {
  MEMORY_BACKUP_INTERVAL_MS,
  MEMORY_BACKUP_MAX,
  MEMORY_BACKUP_ROUTE,
  MEMORY_ROUTE,
  createMemoryBackupHandler,
  createMemoryHub,
  createMemorySnapshotHandler,
  resolveMemoryHubPaths,
} from '../lib/memory-hub.mjs'
import {
  SELF_GROWTH_REFLECT_INTERVAL_MS,
  SELF_GROWTH_TICK_MS,
  SELF_GROWTH_TIMEOUT_MS,
  buildLearnPrompt,
  buildReflectPrompt,
  createSelfGrowth,
  normalizeTopicCandidate,
  parseLearnResult,
  parseReflectResult,
} from '../lib/self-growth.mjs'
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
} from '../lib/self-actions.mjs'
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
} from '../lib/self-state.mjs'
import {
  SELF_TALK_TOPIC_RECENT_MAX,
  SELF_TALK_TOPIC_TOP_N,
  buildTopicPromptLine,
  loadTopicBank,
  parseTopicBank,
  pickSelfTalkTopic,
  resolveTopicsPath,
  scoreSelfTalkTopic,
} from '../lib/self-talk-topics.mjs'
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
} from '../lib/self-talk.mjs'

// ---------------------------------------------------------------------------
// 测试基础设施
// ---------------------------------------------------------------------------

const POEM_IDS = ['tang-000001', 'tang-000002', 'tang-000003']
const DATA_VERSION = '2026-10-21.1'
const FIXED_NOW = new Date(2026, 9, 21, 10, 0, 0) // 本地时间 2026-10-21（与时区无关）

function makeTmpDir(prefix = 'dshp-host') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeFixtureData(dataDir) {
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
class MockResponse extends Writable {
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

function mockRequest({ method = 'GET', headers = { host: '127.0.0.1:57623' }, url = '/', body } = {}) {
  const request = { method, headers, url }
  request[Symbol.asyncIterator] = async function* iterator() {
    if (body !== undefined) yield Buffer.isBuffer(body) ? body : Buffer.from(body)
  }
  return request
}

/** 组装一个隔离的（临时 dataDir + 临时 settings.json）路由表。 */
function createHarness(overrides = {}) {
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
function makeWeatherFetch(options = {}) {
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
function makeMockLlm(responder) {
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

const SELF_TALK_SELECTION = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' }
const SELF_TALK_LINES_A = ['今天的小雨让我有点想窝在窗边看雨', '我数了数你敲键盘的声音，好像比昨天轻快']
const SELF_TALK_LINES_B = ['书页翻到一半的时候我忽然想起你在忙', '窗外没有月亮，我就自己亮了会儿']

/** 构造一个注入 mock llm 的 self-talk 服务 + 可控时钟。 */
function makeSelfTalkHarness(overrides = {}) {
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

let cachedRealMoodCatalog = null
/** 真实心情图鉴（懒加载一次；缺失返回 null）。 */
function realMoodCatalog() {
  if (cachedRealMoodCatalog === null) {
    const loaded = loadMoodCatalog()
    cachedRealMoodCatalog = loaded.ok === true ? loaded.catalog : { missing: true }
  }
  return cachedRealMoodCatalog.missing === true ? null : cachedRealMoodCatalog
}

/** 小型测试图鉴（含节日 when），用于 prompt/parse 的确定性断言。 */
function makeMoodCatalogFixture() {
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
function makeMoodAiHarness(overrides = {}) {
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
  })
  return { llm, service, state, catalog }
}

function expectedPoemId(date, dataVersion, ids) {
  // 独立复算契约公式 sha256(YYYY-MM-DD + dataVersion) % poems.length
  const digest = createHash('sha256').update(`${date}${dataVersion}`, 'utf8').digest('hex')
  return ids[Number(BigInt(`0x${digest}`) % BigInt(ids.length))]
}

// ---------------------------------------------------------------------------
// 插件入口 / 纯函数
// ---------------------------------------------------------------------------

test('index.js 导出 name 与 apply（Cordis 插件形状）', () => {
  assert.equal(pluginName, 'dsh-poetry-widget')
  assert.equal(typeof pluginApply, 'function')
})

test('package.json 是版本号唯一来源', () => {
  const meta = readPackageMeta(path.join(import.meta.dirname, '..', 'package.json'))
  assert.equal(meta.name, 'dsh-poetry-widget')
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

const MOOD_T0 = new Date(2026, 9, 21, 10, 0, 0).getTime()

function moodEvent(type, time, data = {}) {
  return { type, time, data }
}

function emptyStatsForTest() {
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

test('mood 路由：形状 / 零值 / 累计 / 栅栏 403', async () => {
  const harness = createHarness()
  let response = await harness.call('mood.json', mockRequest())
  assert.equal(response.statusCode, 200)
  let body = response.json()
  assert.equal(body.ok, true)
  assert.equal(body.date, '2026-10-21')
  assert.equal(body.updatedAt, 0)
  for (const key of MOOD_STAT_KEYS) assert.equal(body.stats[key], 0, key)

  const base = FIXED_NOW.getTime()
  harness.moodTracker.record({ id: 's1' }, moodEvent('user/message', base))
  harness.moodTracker.record({ id: 's1' }, moodEvent('assistant/message', base + 1_000))
  harness.moodTracker.record({ id: 's1' }, moodEvent('tool/call', base + 2_000))
  harness.moodTracker.record({ id: 's1' }, moodEvent('tool/result', base + 3_000, { error: { message: 'x' } }))
  harness.moodTracker.record({ id: 's1' }, moodEvent('turn/start', base + 4_000))
  harness.moodTracker.record({ id: 's1' }, moodEvent('turn/end', base + 5_000, { reason: { kind: 'completed' } }))

  body = (await harness.call('mood.json', mockRequest())).json()
  assert.equal(body.ok, true)
  assert.equal(body.date, '2026-10-21')
  assert.equal(body.stats.userMessages, 1)
  assert.equal(body.stats.assistantMessages, 1)
  assert.equal(body.stats.toolCalls, 1)
  assert.equal(body.stats.toolErrors, 1)
  assert.equal(body.stats.turns, 1)
  assert.equal(body.stats.turnsCompleted, 1)
  assert.equal(body.stats.activeMs, 5_000)
  assert.equal(body.stats.sessions, 1)
  assert.equal(body.stats.firstActivityAt, base)
  assert.equal(body.stats.lastActivityAt, base + 5_000)

  const crossed = await harness.call(
    'mood.json',
    mockRequest({ headers: { host: '127.0.0.1:57623', 'sec-fetch-site': 'cross-site' } }),
  )
  assert.equal(crossed.statusCode, 403)
  assert.equal(crossed.json().error.code, 'FORBIDDEN')
})

test('mood 路由：未注入 tracker 时返回今日零值（200，不报错）', async () => {
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
  await handlers.get('/api/dsh-poetry/mood.json')(mockRequest(), response)
  await response.finished()
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, true)
  assert.equal(body.date, localDateKey())
  for (const key of MOOD_STAT_KEYS) assert.equal(body.stats[key], 0, key)
  assert.equal(body.updatedAt, 0)
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

    await pluginApply(fakeCtx)
    assert.equal(listeners.has('session/event'), true, '注册了 session/event 监听')
    assert.ok(
      routes.some((route) => route.path === '/api/dsh-poetry/mood.json'),
      '注册了 mood.json 路由',
    )

    const emit = listeners.get('session/event')
    const base = new Date(2026, 9, 21, 12, 0, 0).getTime()
    emit({ id: 'session-a' }, moodEvent('user/message', base))
    emit({ id: 'session-a' }, moodEvent('assistant/message', base + 1_000))
    emit({ id: 'session-a' }, moodEvent('tool/call', base + 2_000))
    emit({ id: 'session-a' }, moodEvent('turn/start', base + 3_000))
    emit({ id: 'session-a' }, moodEvent('turn/end', base + 4_000, { reason: { kind: 'completed' } }))

    assert.equal(routes.length, 19, 'assets + pet-media + self + memory + model-errors + 14 条 JSON 路由')
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

    const moodRoute = routes.find((route) => route.path === '/api/dsh-poetry/mood.json')
    const response = new MockResponse()
    await moodRoute.handler(mockRequest({ url: '/api/dsh-poetry/mood.json' }), response)
    await response.finished()
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.equal(body.ok, true)
    assert.equal(body.stats.userMessages, 1)
    assert.equal(body.stats.assistantMessages, 1)
    assert.equal(body.stats.toolCalls, 1)
    assert.equal(body.stats.turnsCompleted, 1)
    assert.equal(body.stats.activeMs, 4_000)

    // 模拟插件卸载：effect cleanup 必须注销监听、清定时器并落盘
    for (const cleanup of cleanups.reverse()) {
      if (typeof cleanup === 'function') cleanup()
    }
    assert.equal(listeners.has('session/event'), false, '卸载后监听已注销')
    const moodFile = path.join(dshHome, '.dsh-poetry', 'mood.json')
    assert.equal(fs.existsSync(moodFile), true, '卸载时落盘 mood.json')
    const moodText = fs.readFileSync(moodFile, 'utf8')
    const onDisk = JSON.parse(moodText)
    assert.equal(onDisk.stats.userMessages, 1)
    assert.equal(onDisk.stats.turnsCompleted, 1)
    // 隐私最小化：落盘只存会话 id 的哈希标记，不存原始 session id
    assert.equal(moodText.includes('session-a'), false, '原始 session id 不落盘')
    assert.equal(onDisk.sessionKeys.length, 1)
    assert.match(onDisk.sessionKeys[0], /^[0-9a-f]{16}$/)
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  }
})

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
    stats: { userMessages: 12, toolCalls: 34, activeMs: 31 * 60000 },
    idleMinutes: 8,
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
  assert.match(prompt, /用户消息 12 条/)
  assert.match(prompt, /工具调用 34 次/)
  assert.match(prompt, /活跃约 31 分钟/)
  assert.match(prompt, /8 分钟/)
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
    '我数了数你敲键盘的声音，好像比昨天轻快一点',
  ])
  // 按句号拆分
  assert.deepEqual(parseSelfTalkLines('第一句话说得长一点吧。第二句话也说得长一点吧', { kind: 'murmur' }), [
    '第一句话说得长一点吧',
    '第二句话也说得长一点吧',
  ])
  // 长度边界：murmur 8–60
  assert.deepEqual(parseSelfTalkLines(`${'好'.repeat(7)}\n${'好'.repeat(8)}`, { kind: 'murmur' }), ['好'.repeat(8)])
  assert.deepEqual(parseSelfTalkLines(`${'好'.repeat(60)}\n${'妙'.repeat(61)}`, { kind: 'murmur' }), ['好'.repeat(60)])
  // intro 已废弃（v1.8b）：按 murmur 的 8–60 字处理（24 字以上也保留）
  assert.deepEqual(parseSelfTalkLines('明月'.repeat(13), { kind: 'intro' }), ['明月'.repeat(13)])
  assert.deepEqual(parseSelfTalkLines('山的'.repeat(2), { kind: 'intro' }), [], '过短仍然丢弃')
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
  assert.equal(options.maxTokens, 200)
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
  const base = FIXED_NOW.getTime()
  harness.moodTracker.record({ id: 's1' }, moodEvent('user/message', base))
  harness.moodTracker.record({ id: 's1' }, moodEvent('tool/call', base + 1000))

  const recent = encodeURIComponent(['第一句最近说过的话', '第二句最近说过的话'].join('|'))
  const url =
    `/api/dsh-poetry/self-talk.json?kind=intro&mood=busy&weather=rain&idleMinutes=12&recent=${recent}` +
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
  assert.match(userText, /12 分钟/)
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
  assert.equal(/距上次和用户互动/.test(userText), false, '非法 idleMinutes 忽略（无聚合回退时不输出）')
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
      stats: {
        userMessages: 12,
        assistantMessages: 20,
        toolCalls: 45,
        toolErrors: 3,
        turns: 6,
        turnsCompleted: 5,
        turnsErrored: 1,
        activeMs: 33 * 60000,
        sessions: 2,
      },
      idleMinutes: 8,
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
  assert.match(prompt, /用户消息 12 条/)
  assert.match(prompt, /工具调用 45 次（其中报错 3 次）/)
  assert.match(prompt, /回合 6 个（完成 5 \/ 出错 1）/)
  assert.match(prompt, /活跃约 33 分钟/)
  assert.match(prompt, /8 分钟/)
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
  const base = FIXED_NOW.getTime()
  harness.moodTracker.record({ id: 's1' }, moodEvent('user/message', base))
  harness.moodTracker.record({ id: 's1' }, moodEvent('tool/call', base + 1000))

  const recent = encodeURIComponent('刚刚在发呆|看到窗外下雨了')
  const recentImages = encodeURIComponent('dsh-whale-state-tired.webp|dsh-whale-state-sad.webp')
  const url =
    `/api/dsh-poetry/mood-ai.json?mood=busy&weather=rain&idleMinutes=12&recent=${recent}&recentImages=${recentImages}` +
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
  assert.match(userText, /12 分钟/)
  assert.match(userText, /刚刚在发呆/)
  assert.match(userText, /dsh-whale-state-tired\.webp/)
  assert.match(userText, /不是随机抽图/)
  assert.equal(JSON.stringify(llm.calls[0]).includes('超级机密'), false, '未知 query 参数不会进入 prompt')

  // 普通再次请求 → 10min 缓存命中，不再调模型
  const cachedBody = (await harness.call('mood-ai.json', mockRequest({ url }))).json()
  assert.equal(cachedBody.ok, true)
  assert.equal(cachedBody.cached, true)
  assert.equal(llm.calls.length, 1)

  // force=1 绕过缓存
  const forcedBody = (await harness.call('mood-ai.json', mockRequest({ url: `${url}&force=1` }))).json()
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
  const url = `/api/dsh-poetry/mood-ai.json?idleMinutes=abc&recent=${manyRecent}&recentImages=${manyImages}&force=1`
  const response = await harness.call('mood-ai.json', mockRequest({ url }))
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'MOOD_AI_UNAVAILABLE')

  const captured = seen[0]
  assert.equal(captured.context.recent.length, 3, 'recent 最多 3 条')
  assert.equal(captured.context.recentImages.length, 7, 'v1.13：上限 20，7 条全部保留')
  assert.equal(captured.context.idleMinutes, null, '非法 idleMinutes 忽略')
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

function readJournalJsonl(dir) {
  const file = path.join(dir, 'journal.jsonl')
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

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
  const forced = await harness.call('mood-ai.json', mockRequest({ url: `${url}&force=1` }))
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
  assert.equal(resolveFeihuaFullDir({}, '/a/b/dsh-poetry-widget'), '/a/b/_ref/feihua-full')
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
  assert.equal(resolvePetMediaDir({}, '/a/b/dsh-poetry-widget'), '/a/b/_ref/pet-media')
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
    assert.equal(routes.length, 19, 'assets + pet-media + self + memory + model-errors + 14 条 JSON')
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

// ---------------------------------------------------------------------------
// mood-ai 选择多样性（契约 v1.13，M19a：打乱/视频优先/排除最近 20 张）
// ---------------------------------------------------------------------------

/** 生成 count 个静态图条目的小图鉴（file=img-<n>.webp）。 */
function makeMoodCatalogBig(count = 30) {
  return normalizeMoodCatalog({
    ok: true,
    version: 'big.1',
    images: Array.from({ length: count }, (_, index) => ({
      file: `img-${index}.webp`,
      label: `标签${index}`,
      tags: [`tag${index % 5}`],
    })),
    panelImages: [],
  })
}

/** 25 张静态图 + 3 个视频的图鉴（用于验证 recentImages 对视频的排除）。 */
function makeMoodCatalogWithVideos(staticCount = 25) {
  const base = normalizeMoodCatalog({
    ok: true,
    version: 'multi.1',
    images: Array.from({ length: staticCount }, (_, index) => ({
      file: `img-${index}.webp`,
      label: `静图${index}`,
      tags: ['img'],
    })),
    panelImages: [],
  })
  return mergePetMediaIntoMoodCatalog(base, [
    { file: 'webm/哈欠连天.webm', label: '哈欠连天', media: 'video', scope: 'mood', tags: ['tired'] },
    { file: 'webm/吃午餐.webm', label: '吃午餐', media: 'video', scope: 'mood', tags: ['food'] },
    { file: 'webm/写代码.webm', label: '写代码', media: 'video', scope: 'mood', tags: ['code'] },
  ])
}

/** 可复现的 LCG random（用于断言打乱顺序）。 */
function seededRandom(seed = 12345) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function promptCatalogRowFiles(prompt) {
  return prompt
    .split('\n')
    .filter((line) => line.includes('｜'))
    .map((line) => line.split('｜')[0])
    .filter((file) => /^(img-|dsh-whale-|webm\/)/.test(file))
}

test('mood-ai：每次构建图鉴用 Fisher–Yates 打乱（注入 random 可断言顺序变化/可复现）', () => {
  const catalog = makeMoodCatalogBig(30)
  const originalOrder = catalog.moodImages.map((image) => image.file)
  const plan = resolveMoodCandidates(catalog, [], { random: seededRandom(20261023) })
  const files = plan.candidates.map((image) => image.file)
  assert.equal(files.length, 30, '不丢条目')
  assert.deepEqual(new Set(files), new Set(originalOrder), '是原列表的排列')
  assert.notDeepEqual(files, originalOrder, '顺序确实被打乱')

  const planAgain = resolveMoodCandidates(catalog, [], { random: seededRandom(20261023) })
  assert.deepEqual(planAgain.candidates.map((image) => image.file), files, '同一 random 可复现')

  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0) }, catalog, { plan })
  assert.deepEqual(promptCatalogRowFiles(prompt), files, 'prompt 图鉴行顺序 = 打乱后的候选顺序')
  assert.match(prompt, /已打乱顺序/)

  // shuffleCopy 本身：排列且不修改入参
  const input = [1, 2, 3, 4, 5]
  const shuffled = shuffleCopy(input, seededRandom(7))
  assert.deepEqual(new Set(shuffled), new Set(input))
  assert.deepEqual(input, [1, 2, 3, 4, 5], '不修改入参')
})

test('mood-ai：prompt 明确「优先 video 动画 / 不连续重复 / 不同情境换不同 tag」', () => {
  const catalog = makeMoodCatalogFixture()
  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0) }, catalog, {
    random: seededRandom(3),
  })
  assert.match(prompt, /优先从 media=video 的动画里选/)
  assert.match(prompt, /不要连续选同一张图或同一个动作/)
  assert.match(prompt, /不同 tag 的动作/)
  assert.match(prompt, /waiting\/idle\/melt/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /优先从 media=video 的动画里选/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要连续选同一张图或同一个动作/)
  assert.ok(MOOD_AI_TEMPERATURE >= 1.0 && MOOD_AI_TEMPERATURE <= 1.1, `temperature=${MOOD_AI_TEMPERATURE}`)
})

test('mood-ai：recentImages 上限 20 并从图鉴行剔除；候选不足 20 时退回全量', () => {
  assert.equal(MOOD_RECENT_IMAGES_MAX, 20)
  assert.equal(MOOD_MIN_CANDIDATES, 20)
  const big = makeMoodCatalogBig(50) // 50 - 20 = 30 ≥ MOOD_MIN_CANDIDATES，走排除模式
  const recent25 = Array.from({ length: 25 }, (_, index) => `img-${index}.webp`)
  const plan = resolveMoodCandidates(big, recent25, { random: seededRandom(11) })
  assert.equal(plan.recentList.length, 20, 'recentImages 上限 20（路径/长度同步）')
  assert.equal(plan.usedFallback, false)
  assert.equal(plan.excludedFiles.size, 20)
  assert.equal(plan.candidates.length, 30, '50 - 20 被排除')

  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0), recentImages: recent25 }, big, { plan })
  assert.match(prompt, /已从下面的图鉴列表中移除/)
  const rowFiles = promptCatalogRowFiles(prompt)
  for (const file of recent25.slice(0, 20)) {
    assert.equal(rowFiles.includes(file), false, `被排除条目不应出现在图鉴行：${file}`)
  }
  const recentSection = prompt.slice(prompt.indexOf('最近用过的图片'))
  for (const file of recent25.slice(0, 20)) {
    assert.equal(recentSection.includes(file), true, '最近图仍在文字里列出')
  }

  // 图鉴太小：退回完整列表（仍文字列出最近图），parse 不强制排除
  const small = makeMoodCatalogFixture()
  const allRecent = small.moodImages.map((image) => image.file)
  const fallbackPlan = resolveMoodCandidates(small, allRecent, { random: seededRandom(5) })
  assert.equal(fallbackPlan.usedFallback, true)
  assert.equal(fallbackPlan.candidates.length, small.moodImages.length, '退回完整列表')
  assert.equal(fallbackPlan.excludedFiles.size, 0)
  const fallbackPrompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 21, 2, 0, 0), recentImages: allRecent }, small, {
    plan: fallbackPlan,
  })
  assert.match(fallbackPrompt, /图鉴条目不足/)
})

test('mood-ai v1.21：被排除的最近图若被模型返回仍成功（排除只是软建议）；图鉴外才失败', () => {
  const big = makeMoodCatalogBig(30)
  const plan = resolveMoodCandidates(big, ['img-0.webp', 'img-1.webp'], { random: seededRandom(9) })
  // 被排除的图仍被接受（否则体验/情绪要求某张图时会误判失败、客户端回退本地心情）
  const accepted = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'img-0.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(accepted.ok, true)
  assert.equal(accepted.mood.image, 'img-0.webp')

  // 图鉴外的图仍然失败
  const unknown = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'nope.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(unknown.ok, false)
  assert.match(unknown.message, /不在图鉴/)

  // 未排除图正常
  const allowed = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'img-2.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(allowed.ok, true)
})

test('mood-ai 服务 v1.21：模型返回被排除/最近用过的图 → 仍成功（排除只做 prompt 引导）', async () => {
  const big = makeMoodCatalogBig(30)
  const { service, llm } = makeMoodAiHarness({
    catalog: big,
    responder: () => JSON.stringify({ label: '开心', image: 'img-0.webp', reason: '理由足够长', energy: 50 }),
  })
  const first = await service.generate({ recentImages: ['img-0.webp'] }, { force: true })
  assert.equal(first.ok, true)
  assert.equal(first.mood.image, 'img-0.webp')

  // 第二次同一张：prompt 图鉴仍把它排除（软引导多样性），但模型返回它也不再失败
  const second = await service.generate({ recentImages: ['img-0.webp'] }, { force: true })
  assert.equal(second.ok, true)
  assert.equal(second.mood.image, 'img-0.webp')
  const prompt = llm.calls[1].messages[0].content[0].text
  assert.equal(promptCatalogRowFiles(prompt).includes('img-0.webp'), false, 'prompt 仍排除最近图（仅引导）')
})

test('mood-ai 路由：recentImages query 最多 20 条（解析同步上限）', async () => {
  const seen = []
  const stub = {
    async generate(context) {
      seen.push(context)
      return { ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: 'x' } }
    },
  }
  const harness = createHarness({ moodAiService: stub })
  const many = encodeURIComponent(Array.from({ length: 25 }, (_, index) => `img-${index}.webp`).join('|'))
  const response = await harness.call('mood-ai.json', mockRequest({ url: `/api/dsh-poetry/mood-ai.json?recentImages=${many}` }))
  assert.equal(response.statusCode, 200)
  assert.equal(seen[0].recentImages.length, 20, 'recentImages 最多 20 条')
})

// ---------------------------------------------------------------------------
// 最近活动感知（契约 v1.16，M22：工具名 → 看视频/学习/写代码/聊天/发呆）
// ---------------------------------------------------------------------------

test('mood 活动：classifyToolName 按工具名分类（不读参数）', () => {
  const cases = [
    ['bsk_click', 'watch'],
    ['bsk_navigate', 'watch'],
    ['browser_navigate', 'watch'],
    ['chrome_open', 'watch'],
    ['web_fetch', 'read'],
    ['web_search', 'read'],
    ['fetch_url', 'read'],
    ['search', 'read'],
    ['bash', 'code'],
    ['shell_exec', 'code'],
    ['exec', 'code'],
    ['apply_patch', 'code'],
    ['edit_file', 'code'],
    ['write_file', 'code'],
    ['git_diff', 'code'],
    ['subagent', 'social'],
    ['team_task_create', 'social'],
    ['message_send', 'social'],
    ['chat', 'social'],
  ]
  const now = 1_700_000_000_000
  for (const [name, kind] of cases) {
    assert.equal(classifyToolName(name), kind, name)
    const activity = describeRecentActivity([{ name, at: now - 1000 }], now)
    assert.equal(activity.kind, kind, name)
    assert.equal(activity.label, MOOD_ACTIVITY_LABELS[kind], name)
    assert.equal(activity.at, now - 1000)
  }
  for (const name of ['glob', 'grep', 'present', '', null, undefined, 42]) {
    assert.equal(classifyToolName(name), null, String(name))
  }
  assert.equal(classifyToolName('WEB_SEARCH'), 'read', '大小写不敏感')
})

test('mood 活动：describeRecentActivity 的 idle/最近优先/最近 1–2 条规则', () => {
  const now = 1_700_000_000_000
  assert.deepEqual(describeRecentActivity([], now), { kind: 'idle', label: '发呆', at: null })
  assert.deepEqual(describeRecentActivity(null, now), { kind: 'idle', label: '发呆', at: null })

  // 60s 内仍算活跃；超过 60s → 发呆
  assert.equal(describeRecentActivity([{ name: 'bash', at: now - 59_000 }], now).kind, 'code')
  assert.equal(describeRecentActivity([{ name: 'bash', at: now - MOOD_ACTIVITY_IDLE_MS - 1_000 }], now).kind, 'idle')
  assert.equal(describeRecentActivity([{ name: 'bash', at: now - MOOD_ACTIVITY_IDLE_MS - 1_000 }], now).at, now - MOOD_ACTIVITY_IDLE_MS - 1_000)

  // 最近一条优先：老 bash + 新 web_fetch → read
  const recentFirst = describeRecentActivity(
    [
      { name: 'bash', at: now - 10_000 },
      { name: 'web_fetch', at: now - 2_000 },
    ],
    now,
  )
  assert.equal(recentFirst.kind, 'read')
  assert.equal(recentFirst.at, now - 2_000)

  // 最近一条无法分类时，看第二条（最近 1–2 条）
  const secondFallback = describeRecentActivity(
    [
      { name: 'bash', at: now - 10_000 },
      { name: 'glob', at: now - 2_000 },
    ],
    now,
  )
  assert.equal(secondFallback.kind, 'code')
  assert.equal(secondFallback.at, now - 10_000)

  // 两条都无法分类 → 发呆
  const unknown = describeRecentActivity(
    [
      { name: 'glob', at: now - 10_000 },
      { name: 'grep', at: now - 2_000 },
    ],
    now,
  )
  assert.equal(unknown.kind, 'idle')
  assert.equal(unknown.at, now - 2_000)
})

test('mood 活动：ring buffer ≤12、只存名称+时间、绝不泄漏 arguments；stats 不受影响', () => {
  const dir = makeTmpDir('dshp-mood-activity')
  const base = new Date(2026, 9, 23, 12, 0, 0).getTime()
  let clock = base
  const tracker = createMoodTracker({
    file: path.join(dir, 'mood.json'),
    now: () => clock,
    persistDebounceMs: 0,
  })
  const sensitive = 'SECRET_TOOL_ARGUMENT_abc123'
  for (let index = 0; index < 15; index += 1) {
    clock = base + index * 1000
    tracker.record(
      { id: 's1' },
      {
        type: 'tool/call',
        time: clock,
        data: {
          name: index < 6 ? 'bash' : 'web_fetch',
          callId: `call-${index}`,
          arguments: { command: sensitive, url: `https://example.com/${sensitive}` },
        },
      },
    )
  }
  const tools = tracker.recentTools()
  assert.equal(tools.length, MOOD_RECENT_TOOL_LIMIT, 'ring buffer 最多 12 条')
  for (const tool of tools) {
    assert.deepEqual(Object.keys(tool).sort(), ['at', 'name'], '只保存名称+时间')
  }
  assert.equal(JSON.stringify(tools).includes(sensitive), false, '不保存/不泄漏工具参数')
  assert.equal(tools[0].name, 'bash', '最早的 3 条已被挤出')

  const activity = tracker.getRecentActivity(clock)
  assert.equal(activity.kind, 'read', '最近工具是 web_fetch')
  assert.equal(activity.label, '查资料/学习')
  assert.equal(JSON.stringify(activity).includes(sensitive), false)

  // 60s 无新调用 → 发呆
  assert.equal(tracker.getRecentActivity(clock + MOOD_ACTIVITY_IDLE_MS + 1_000).kind, 'idle')

  // 记忆日志/统计不受影响：toolCalls 仍按事件计数；mood.json 不含参数
  assert.equal(tracker.getToday().stats.toolCalls, 15)
  const persisted = fs.readFileSync(path.join(dir, 'mood.json'), 'utf8')
  assert.equal(persisted.includes(sensitive), false, 'mood.json 不落盘工具参数')
  assert.equal(persisted.includes('web_fetch'), false, '活动信号不落盘')
  tracker.dispose()
})

test('mood-ai：prompt 含「你最近在做」与活动匹配指令，不含工具参数', () => {
  const catalog = makeMoodCatalogFixture()
  const now = Date.UTC(2026, 9, 23, 4, 0, 0)
  const watchPrompt = buildMoodPrompt({ now, activity: { kind: 'watch', label: '看视频' } }, catalog, {
    random: seededRandom(3),
  })
  assert.match(watchPrompt, /你最近在做：看视频\/逛网页（watch）/)
  assert.match(watchPrompt, /选图时优先匹配你最近在做的事/)
  assert.match(watchPrompt, /看视频\/逛网页 → 专注观看、东张西望、好奇类的动画/)
  assert.match(watchPrompt, /查资料\/学习 → 专注、思考/)

  const idlePrompt = buildMoodPrompt({ now }, catalog)
  assert.match(idlePrompt, /你最近在做：发呆\/等待/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /如果提供了「你最近在做」的活动/)

  const injected = buildMoodPrompt(
    {
      now,
      activity: { kind: 'code', label: '写代码', arguments: { command: 'SECRET_ARG_VALUE' }, toolArguments: 'SECRET_ARG_VALUE' },
    },
    catalog,
  )
  assert.equal(injected.includes('SECRET_ARG_VALUE'), false, 'activity 只取白名单字段')
})

test('mood-ai 路由：最近活动来自工具名并写入 prompt，不泄漏参数', async () => {
  const { llm, service } = makeMoodAiHarness({
    responder: () =>
      JSON.stringify({ label: '在查资料', image: 'dsh-whale-state-happy.webp', reason: '看到有用的东西', energy: 60 }),
  })
  const harness = createHarness({ moodAiService: service })
  const sensitive = 'SECRET_URL_VALUE_xyz'
  harness.moodTracker.record(
    { id: 's1' },
    {
      type: 'tool/call',
      time: FIXED_NOW.getTime(),
      data: { name: 'web_fetch', callId: 'c1', arguments: { url: `https://secret.example/${sensitive}` } },
    },
  )
  const response = await harness.call('mood-ai.json', mockRequest({ url: '/api/dsh-poetry/mood-ai.json?force=1' }))
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /你最近在做：查资料\/学习/)
  assert.equal(prompt.includes(sensitive), false)
  assert.equal(JSON.stringify(llm.calls[0]).includes(sensitive), false, '工具参数不出现在模型请求里')
})

// ---------------------------------------------------------------------------
// 体验/情绪状态通道（契约 v1.17，M23：体验内容 → 情绪 → 心情图像）
// ---------------------------------------------------------------------------

function writeExperienceFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data), 'utf8')
  return file
}

test('experience：resolveExperiencePath（env 覆盖 / DSH_HOME / home 回退）', () => {
  assert.equal(resolveExperiencePath({ DSH_POETRY_EXPERIENCE: '/tmp/exp.json' }, '/Users/alice'), '/tmp/exp.json')
  assert.equal(
    resolveExperiencePath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/.dsh-poetry/experience.json',
  )
  assert.equal(resolveExperiencePath({}, '/Users/alice'), '/Users/alice/.dsh/.dsh-poetry/experience.json')
  assert.equal(
    resolveExperiencePath({ DSH_POETRY_EXPERIENCE: '   ' }, '/Users/alice'),
    '/Users/alice/.dsh/.dsh-poetry/experience.json',
    '空白覆盖值忽略',
  )
  assert.equal(EXPERIENCE_KIND_LABELS.video, '视频')
  assert.equal(EXPERIENCE_KIND_LABELS.novel, '小说')
  assert.equal(EXPERIENCE_KIND_LABELS.article, '文章')
  assert.equal(EXPERIENCE_KIND_LABELS.music, '音乐')
  assert.equal(EXPERIENCE_KIND_LABELS.other, '其他')
  assert.equal(EXPERIENCE_EMOTION_LABELS.touched, '感动鼻酸')
  assert.equal(EXPERIENCE_EMOTION_LABELS.sad, '难过')
  assert.equal(EXPERIENCE_EMOTION_LABELS.happy, '开心')
  assert.equal(EXPERIENCE_EMOTION_LABELS.tense, '紧张')
  assert.equal(EXPERIENCE_EMOTION_LABELS.curious, '好奇')
  assert.equal(EXPERIENCE_EMOTION_LABELS.calm, '平静')
  assert.equal(EXPERIENCE_EMOTION_LABELS.angry, '生气')
  assert.equal(EXPERIENCE_EMOTION_LABELS.inspired, '振奋')
})

test('experience：readExperience 合法（含/不含 note、ISO 时间、默认路径）', () => {
  const now = new Date(2026, 9, 23, 16, 0, 0).getTime()
  const dir = makeTmpDir('dshp-exp')
  const file = path.join(dir, 'experience.json')
  writeExperienceFile(file, {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    note: '结尾那段琴声听得眼眶发热',
    at: now - 10 * 60 * 1000,
  })
  const result = readExperience({ env: { DSH_POETRY_EXPERIENCE: file }, now })
  assert.equal(result.ok, true)
  assert.deepEqual(result.experience, {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    note: '结尾那段琴声听得眼眶发热',
    at: now - 10 * 60 * 1000,
  })

  // 无 note
  writeExperienceFile(file, { title: '活着', kind: 'novel', emotion: 'sad', at: new Date(now - 60 * 1000).toISOString() })
  const noNote = readExperience({ env: { DSH_POETRY_EXPERIENCE: file }, now })
  assert.equal(noNote.ok, true)
  assert.equal(noNote.experience.title, '活着')
  assert.equal('note' in noNote.experience, false)
  assert.equal(noNote.experience.at, now - 60 * 1000, 'ISO 字符串时间戳也可接受')

  // DSH_HOME 默认路径
  const dshHome = makeTmpDir('dshp-exp-home')
  writeExperienceFile(path.join(dshHome, '.dsh-poetry', 'experience.json'), {
    title: '宇宙探索编辑部',
    kind: 'other',
    emotion: 'inspired',
    at: now - 5 * 60 * 1000,
  })
  const viaHome = readExperience({ env: { DSH_HOME: dshHome }, home: '/Users/alice', now })
  assert.equal(viaHome.ok, true)
  assert.equal(viaHome.experience.title, '宇宙探索编辑部')
})

test('experience：readExperience 缺失/坏 JSON/过期/越界/未知枚举 → ok:false 不抛', () => {
  const now = new Date(2026, 9, 23, 16, 0, 0).getTime()
  const dir = makeTmpDir('dshp-exp')
  const file = path.join(dir, 'experience.json')
  const read = (data, extra = {}) => {
    writeExperienceFile(file, data)
    return readExperience({ env: { DSH_POETRY_EXPERIENCE: file }, now, ...extra })
  }

  assert.deepEqual(readExperience({ env: { DSH_POETRY_EXPERIENCE: path.join(dir, 'nope.json') }, now }), {
    ok: false,
    reason: 'missing',
  })
  assert.equal(read('not json at all').reason, 'bad-json')
  assert.equal(read({}).reason, 'bad-title')
  const base = { title: '测试作品', kind: 'novel', emotion: 'calm', at: now - 1000 }

  assert.equal(read({ ...base, title: '' }).reason, 'bad-title')
  assert.equal(read({ ...base, title: '字'.repeat(81) }).reason, 'bad-title')
  assert.equal(read({ ...base, kind: 'game' }).reason, 'bad-kind')
  assert.equal(read({ ...base, emotion: 'excited' }).reason, 'bad-emotion')
  assert.equal(read({ ...base, note: '感'.repeat(201) }).reason, 'bad-note')
  assert.equal(read({ ...base, note: 123 }).reason, 'bad-note')
  assert.equal(read({ ...base, at: undefined }).reason, 'bad-at')
  assert.equal(read({ ...base, at: 'not-a-date' }).reason, 'bad-at')
  assert.equal(read({ ...base, at: now - EXPERIENCE_MAX_AGE_MS - 1000 }).reason, 'expired')

  // 恰好 2h 不过期；超过 2h 过期
  assert.equal(read({ ...base, at: now - EXPERIENCE_MAX_AGE_MS }).ok, true, '恰好 2h 仍有效')
  assert.equal(read({ ...base, at: now - EXPERIENCE_MAX_AGE_MS - 1 }).reason, 'expired')

  // 字段边界：80 字标题、200 字 note 合法
  const boundary = read({ ...base, title: '字'.repeat(80), note: '注'.repeat(200) })
  assert.equal(boundary.ok, true)
  assert.equal(Array.from(boundary.experience.title).length, 80)
  assert.equal(Array.from(boundary.experience.note).length, 200)
})

test('mood-ai：prompt 含体验标题/情绪标签/情绪匹配指令；无 experience 时正常', () => {
  const catalog = makeMoodCatalogFixture()
  const now = Date.UTC(2026, 9, 23, 8, 0, 0)
  const experience = {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    note: '结尾那段琴声听得眼眶发热',
    at: Date.UTC(2026, 9, 23, 7, 50, 0),
  }
  const prompt = buildMoodPrompt({ now, experience }, catalog, { random: seededRandom(3) })
  assert.match(prompt, /你最近在体验：《海上钢琴师》（视频）/)
  assert.match(prompt, /你此刻的心情是：感动鼻酸/)
  assert.match(prompt, /你记下的感受：结尾那段琴声听得眼眶发热/)
  assert.match(prompt, /感动\/鼻酸 → 温柔、共情、眼眶发热类/)
  assert.match(prompt, /紧张 → 屏息、专注、好奇类/)
  assert.match(prompt, /情绪匹配优先于活动匹配/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /情绪匹配优先于活动匹配/)

  // 无体验：不出现体验段
  const plain = buildMoodPrompt({ now, activity: { kind: 'read', label: '查资料' } }, catalog)
  assert.equal(plain.includes('你最近在体验'), false)
  assert.match(plain, /你最近在做：查资料\/学习/)

  // 同时有活动 + 体验：两段都在
  const both = buildMoodPrompt({ now, activity: { kind: 'read', label: '查资料' }, experience }, catalog)
  assert.match(both, /你最近在做：查资料\/学习/)
  assert.match(both, /你最近在体验：《海上钢琴师》/)
  // 只取白名单字段：note 之外的额外字段不注入
  const injected = buildMoodPrompt(
    {
      now,
      experience: { ...experience, arguments: { command: 'SECRET_FIELD_VALUE' }, toolArguments: 'SECRET_FIELD_VALUE' },
    },
    catalog,
  )
  assert.equal(injected.includes('SECRET_FIELD_VALUE'), false)
  assert.match(injected, /你最近在体验/)
})

test('mood-ai 路由：读取 experience 状态文件并注入 prompt，journal 不写体验正文', async () => {
  const now = FIXED_NOW.getTime()
  const expDir = makeTmpDir('dshp-exp-route')
  const expFile = writeExperienceFile(path.join(expDir, 'experience.json'), {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    note: '结尾那段琴声听得眼眶发热',
    at: now - 5 * 60 * 1000,
  })
  const { llm, service } = makeMoodAiHarness({
    responder: () =>
      JSON.stringify({ label: '有点鼻酸', image: 'dsh-whale-state-happy.webp', reason: '看完那段琴声很感动', energy: 55 }),
  })
  const harness = createHarness({ env: { DSH_POETRY_EXPERIENCE: expFile }, moodAiService: service })
  const response = await harness.call('mood-ai.json', mockRequest({ url: '/api/dsh-poetry/mood-ai.json?force=1' }))
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /你最近在体验：《海上钢琴师》（视频）/)
  assert.match(prompt, /你此刻的心情是：感动鼻酸/)
  assert.match(prompt, /温柔、共情、眼眶发热类/)

  // journal 只记 mood label/reason/image，不含体验标题/note 正文
  const journalRaw = fs.readFileSync(path.join(harness.journalDir, 'journal.jsonl'), 'utf8')
  assert.equal(journalRaw.includes('海上钢琴师'), false, 'journal 不写体验标题')
  assert.equal(journalRaw.includes('结尾那段琴声'), false, 'journal 不写体验 note')
  assert.match(journalRaw, /dsh-whale-state-happy\.webp/, 'journal 仍记录心情图像')

  // 无体验文件：prompt 正常、不含体验段
  const plainMood = makeMoodAiHarness()
  const plainHarness = createHarness({ env: {}, moodAiService: plainMood.service })
  const plain = await plainHarness.call('mood-ai.json', mockRequest({ url: '/api/dsh-poetry/mood-ai.json?force=1' }))
  assert.equal(plain.statusCode, 200)
  assert.equal(plain.json().ok, true)
  const plainPrompt = plainMood.llm.calls[0].messages[0].content[0].text
  assert.equal(plainPrompt.includes('你最近在体验'), false, '无体验文件时 prompt 无体验段')
})

// ---------------------------------------------------------------------------
// M24：recentImages 视频排除修复（webm/x.webm ↔ basename 归一）
// ---------------------------------------------------------------------------

test('mood-ai M24：normalizeRecentImageList 把视频 recent 归一成完整 webm/ 路径', () => {
  const catalog = makeMoodCatalogWithVideos(25)
  // 完整路径
  const full = normalizeRecentImageList(['webm/哈欠连天.webm'], catalog)
  assert.deepEqual(full, [{ raw: 'webm/哈欠连天.webm', file: 'webm/哈欠连天.webm' }])
  // 客户端传 basename（无 webm/ 前缀）
  const base = normalizeRecentImageList(['哈欠连天.webm'], catalog)
  assert.deepEqual(base, [{ raw: '哈欠连天.webm', file: 'webm/哈欠连天.webm' }])
  // 静态图 basename 仍是自身
  assert.deepEqual(normalizeRecentImageList(['img-3.webp'], catalog), [{ raw: 'img-3.webp', file: 'img-3.webp' }])
  // 完整路径与 basename 视为同一条，去重
  const deduped = normalizeRecentImageList(['webm/哈欠连天.webm', '哈欠连天.webm'], catalog)
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].file, 'webm/哈欠连天.webm')
  // 图鉴外的文件保留 raw、file=null
  assert.deepEqual(normalizeRecentImageList(['unknown.webp'], catalog), [{ raw: 'unknown.webp', file: null }])
})

test('mood-ai M24：被排除视频不在候选/prompt 图鉴行，静态图排除不受影响', () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const total = catalog.moodImages.length
  const recent = ['webm/哈欠连天.webm', 'img-0.webp']
  const plan = resolveMoodCandidates(catalog, recent, { random: seededRandom(21) })
  assert.equal(plan.usedFallback, false)
  assert.equal(plan.excludedFiles.size, 2)
  assert.equal(plan.excludedFiles.has('webm/哈欠连天.webm'), true, 'excludedFiles 存完整 file')
  assert.equal(plan.candidates.length, total - 2)
  assert.equal(plan.candidates.some((image) => image.file === 'webm/哈欠连天.webm'), false, '被排除视频不在候选')
  assert.equal(plan.candidates.some((image) => image.file === 'img-0.webp'), false, '被排除静态图不在候选')

  const prompt = buildMoodPrompt({ now: Date.UTC(2026, 9, 23, 8, 0, 0), recentImages: recent }, catalog, { plan })
  const rows = promptCatalogRowFiles(prompt)
  assert.equal(rows.includes('webm/哈欠连天.webm'), false, 'prompt 图鉴行不含被排除视频')
  assert.equal(rows.includes('img-0.webp'), false)
  assert.equal(rows.includes('webm/吃午餐.webm'), true, '未用过的视频仍在候选')
  assert.match(prompt, /- webm\/哈欠连天\.webm/, '最近图仍文字列出')

  // 客户端只传 basename 也排除
  const planBase = resolveMoodCandidates(catalog, ['哈欠连天.webm'], { random: seededRandom(21) })
  assert.equal(planBase.excludedFiles.has('webm/哈欠连天.webm'), true)
  assert.equal(planBase.candidates.some((image) => image.file === 'webm/哈欠连天.webm'), false)
})

test('mood-ai M24/v1.21：被排除视频若被模型返回仍成功；图鉴外视频失败；basename 正常解析', () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const excludedVideo = 'webm/哈欠连天.webm'
  const make = (image) => JSON.stringify({ label: '好困', image, reason: '理由足够长', energy: 40 })
  const options = { dateKey: '2026-10-21' }

  // 被排除的视频（完整 file / basename）仍被接受——排除只是 prompt 软建议
  const acceptedFull = parseMoodResult(make(excludedVideo), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(acceptedFull.ok, true)
  assert.equal(acceptedFull.mood.image, excludedVideo)

  const acceptedBase = parseMoodResult(make(excludedVideo), catalog, {
    ...options,
    excludedImages: ['哈欠连天.webm'],
  })
  assert.equal(acceptedBase.ok, true)

  // 图鉴外的视频仍然失败
  const unknown = parseMoodResult(make('webm/不存在.webm'), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(unknown.ok, false)
  assert.match(unknown.message, /不在图鉴/)

  // 未排除的视频（完整路径 / 模型漏写 webm/ 前缀的 basename）解析成完整 file
  const other = parseMoodResult(make('webm/吃午餐.webm'), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(other.ok, true)
  assert.equal(other.mood.image, 'webm/吃午餐.webm')

  const otherBase = parseMoodResult(make('吃午餐.webm'), catalog, {
    ...options,
    excludedImages: new Set([excludedVideo]),
  })
  assert.equal(otherBase.ok, true, '模型只写 basename 时解析回完整 file')
  assert.equal(otherBase.mood.image, 'webm/吃午餐.webm')
})

test('mood-ai M24 服务 v1.21：模型返回近期用过的视频 → 成功（排除只做 prompt 引导）', async () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const responder = () => JSON.stringify({ label: '好困', image: 'webm/哈欠连天.webm', reason: '理由足够长', energy: 40 })
  const full = makeMoodAiHarness({ catalog, responder })
  const fullResult = await full.service.generate({ recentImages: ['webm/哈欠连天.webm'] }, { force: true })
  assert.equal(fullResult.ok, true, '被排除的最近视频也应成功，不再 MOOD_AI_UNAVAILABLE')
  assert.equal(fullResult.mood.image, 'webm/哈欠连天.webm')

  const base = makeMoodAiHarness({ catalog, responder })
  const baseResult = await base.service.generate({ recentImages: ['哈欠连天.webm'] }, { force: true })
  assert.equal(baseResult.ok, true, 'basename recent 同样不再造成失败')
  assert.equal(baseResult.mood.image, 'webm/哈欠连天.webm')

  // prompt 仍然把最近用过的视频从候选里排除（软引导）
  const prompt = full.llm.calls[0].messages[0].content[0].text
  assert.equal(promptCatalogRowFiles(prompt).includes('webm/哈欠连天.webm'), false, 'prompt 候选仍排除最近图')

  const accepted = makeMoodAiHarness({
    catalog,
    responder: () => JSON.stringify({ label: '饿了', image: 'webm/吃午餐.webm', reason: '理由足够长', energy: 50 }),
  })
  const okResult = await accepted.service.generate({ recentImages: ['webm/哈欠连天.webm'] }, { force: true })
  assert.equal(okResult.ok, true)
  assert.equal(okResult.mood.image, 'webm/吃午餐.webm')
})

// ---------------------------------------------------------------------------
// M27：journal 刷屏修复（服务端生成 ring 兜底 + journal 写入限频）
// ---------------------------------------------------------------------------

test('mood-ai 服务：宿主生成 image ring 引导下一轮候选（不再硬失败）', async () => {
  const catalog = makeMoodCatalogWithVideos(25)
  let calls = 0
  const responder = () => {
    calls += 1
    if (calls <= 2) {
      return JSON.stringify({ label: '好困', image: 'webm/哈欠连天.webm', reason: '理由足够长', energy: 40 })
    }
    return JSON.stringify({ label: '饿了', image: 'webm/吃午餐.webm', reason: '理由足够长', energy: 50 })
  }
  const { service, llm } = makeMoodAiHarness({ catalog, responder })

  const first = await service.generate({}, { force: true })
  assert.equal(first.ok, true)
  assert.equal(first.mood.image, 'webm/哈欠连天.webm')
  assert.deepEqual(service.peekRecentGenerated(), ['webm/哈欠连天.webm'], '成功后 image 入宿主 ring')

  // 第二次：客户端 recent 为空，但宿主 ring 会把它从 prompt 候选里排除（软引导）；
  // 若模型仍返回同图，v1.21 起接受（不再 MOOD_AI_UNAVAILABLE）。
  const second = await service.generate({}, { force: true })
  assert.equal(second.ok, true, 'ring 只做 prompt 引导，不硬拒绝')
  assert.equal(second.mood.image, 'webm/哈欠连天.webm')
  const secondPrompt = llm.calls[1].messages[0].content[0].text
  assert.equal(promptCatalogRowFiles(secondPrompt).includes('webm/哈欠连天.webm'), false, 'prompt 已排除 ring 内图片')
  assert.deepEqual(service.peekRecentGenerated(), ['webm/哈欠连天.webm'], '同图去重后仍是一条')

  // 换一张没生成过的图 → 正常成功并继续累积 ring
  const third = await service.generate({}, { force: true })
  assert.equal(third.ok, true)
  assert.equal(third.mood.image, 'webm/吃午餐.webm')
  assert.deepEqual(service.peekRecentGenerated(), ['webm/哈欠连天.webm', 'webm/吃午餐.webm'])

  // 缓存命中不入 ring
  const cached = await service.generate({})
  assert.equal(cached.cached, true)
  assert.equal(service.peekRecentGenerated().length, 2, '缓存命中不重复入 ring')
})

test('mood-ai 服务：宿主生成 ring 最多保留最近 20 张', async () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const files = catalog.moodImages.map((image) => image.file)
  let calls = 0
  const responder = () => {
    const image = files[calls % files.length]
    calls += 1
    return JSON.stringify({ label: '测试', image, reason: '理由足够长', energy: 50 })
  }
  const { service } = makeMoodAiHarness({ catalog, responder })
  for (let index = 0; index < 25; index += 1) {
    const result = await service.generate({}, { force: true })
    assert.equal(result.ok, true, `第 ${index + 1} 次生成应成功`)
  }
  const ring = service.peekRecentGenerated()
  assert.equal(ring.length, 20, 'ring 上限 20')
  assert.deepEqual(ring, files.slice(5, 25), '只保留最近 20 张')
})

test('memory-journal v1.21：mood 不再限频/去重，每条都写（回忆完整保留）', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  const t0 = new Date(2026, 9, 23, 16, 0, 0).getTime()
  let clock = t0
  const journal = createMemoryJournal({ dir, now: () => clock, logger: { warn() {} } })
  const jsonlFile = path.join(dir, 'journal.jsonl')
  const mdFile = path.join(dir, 'journal.md')

  const moodA = { kind: 'mood', label: '开心', image: 'a.webp', reason: 'r1' }
  assert.equal((await journal.append(moodA)).ok, true)
  // 同一时刻、同 image+label 连写 → 都写（不再 same-mood 跳过）
  const second = await journal.append(moodA)
  assert.equal(second.ok, true)
  assert.equal(second.skipped, undefined)
  assert.equal(readJournalJsonl(dir).length, 2)

  // <10min 内不同心情 → 照常写
  clock = t0 + 60 * 1000
  assert.equal((await journal.append({ kind: 'mood', label: '难过', image: 'b.webp', reason: 'r2' })).skipped, undefined)
  clock = t0 + 90 * 1000
  assert.equal((await journal.append({ kind: 'mood', label: '难过', image: 'b.webp', reason: 'r2' })).skipped, undefined)
  const entries = readJournalJsonl(dir)
  assert.equal(entries.length, 4, '每条 mood 都写')
  assert.deepEqual(entries.map((entry) => entry.kind), ['mood', 'mood', 'mood', 'mood'])

  // 仍只追加：已有行逐字保留、md 同步增长
  const lines = fs.readFileSync(jsonlFile, 'utf8').trim().split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[0], JSON.stringify(entries[0]))
  const md = fs.readFileSync(mdFile, 'utf8')
  assert.equal((md.match(/· 心情/g) ?? []).length, 4, 'md 同步写入 4 条心情')
})

test('memory-journal v1.20：murmur 同文本跳过、3min 限频、thought 永远写', async () => {
  const dir = path.join(makeTmpDir('dshp-mem'), 'agent-memory')
  const t0 = new Date(2026, 9, 23, 16, 0, 0).getTime()
  let clock = t0
  const journal = createMemoryJournal({ dir, now: () => clock, logger: { warn() {} } })
  const sizes = () => ({
    jsonl: fs.statSync(path.join(dir, 'journal.jsonl')).size,
    md: fs.statSync(path.join(dir, 'journal.md')).size,
  })

  assert.equal((await journal.append({ kind: 'murmur', text: '第一句碎碎念' })).ok, true)
  assert.equal(readJournalJsonl(dir).length, 1)

  // 1min 内不同文本 → 跳过
  clock = t0 + 60 * 1000
  const before = sizes()
  const skip = await journal.append({ kind: 'murmur', text: '第二句碎碎念' })
  assert.equal(skip.skipped, true)
  assert.equal(skip.reason, 'murmur-throttled')
  assert.deepEqual(sizes(), before, '跳过时 md/jsonl 都不增长')

  // 满 3min → 写入
  clock = t0 + JOURNAL_MURMUR_MIN_INTERVAL_MS
  assert.equal((await journal.append({ kind: 'murmur', text: '第二句碎碎念' })).skipped, undefined)
  assert.equal(readJournalJsonl(dir).length, 2)

  // 同文本（即使超过 3min）→ 跳过
  clock = t0 + 10 * 60 * 1000
  const sameText = await journal.append({ kind: 'murmur', text: '第二句碎碎念' })
  assert.equal(sameText.skipped, true)
  assert.equal(sameText.reason, 'same-murmur')
  assert.equal(readJournalJsonl(dir).length, 2)

  // thought 永远写（同一文本连写两次也写）
  clock = t0 + 10 * 60 * 1000
  assert.equal((await journal.append({ kind: 'thought', text: '我在想一件事' })).ok, true)
  assert.equal((await journal.append({ kind: 'thought', text: '我在想一件事' })).ok, true)
  assert.equal(readJournalJsonl(dir).length, 4)
  const thoughtEntries = readJournalJsonl(dir).filter((entry) => entry.kind === 'thought')
  assert.equal(thoughtEntries.length, 2, 'thought 不受限频')
})

// ---------------------------------------------------------------------------
// M32：碎碎念降重（recent 12 / 主题轮换 / 反重复 prompt / 表达类型 / 温度 1.0）
// ---------------------------------------------------------------------------

test('self-talk M32：主题列表与随机挑选（注入 random 可确定）', () => {
  assert.ok(SELF_TALK_THEMES.length >= 20, '主题列表足够丰富')
  for (const theme of ['窗外的声音', '杯子', '键盘声', '小时候', '路过的猫', '一首没念出口的诗', '今天没做成的事']) {
    assert.ok(SELF_TALK_THEMES.includes(theme), `主题列表应包含：${theme}`)
  }
  assert.equal(pickSelfTalkTheme(() => 0), SELF_TALK_THEMES[0], 'random=0 → 第一个主题')
  assert.equal(pickSelfTalkTheme(() => 0.999999), SELF_TALK_THEMES.at(-1), 'random≈1 → 最后一个主题')
  assert.ok(SELF_TALK_THEMES.includes(pickSelfTalkTheme()), '默认 random 也返回合法主题')
})

test('self-talk M32：prompt 列出最近 12 条 + 反重复/表达类型指令 + theme 行', () => {
  const recent12 = Array.from({ length: 12 }, (_, index) => `最近第${index}句随想`)
  const prompt = buildSelfTalkPrompt({ now: FIXED_NOW.getTime(), recent: recent12, theme: '杯子' })
  const recentLines = prompt.split('\n').filter((line) => line.startsWith('- '))
  assert.equal(recentLines.length, 12, '列出最近 12 条')
  assert.equal(recentLines.at(-1), '- 最近第11句随想')
  assert.match(prompt, /你最近说过的话（不要重复主题\/意象\/开头，也不要改写）：/)
  assert.ok(prompt.includes('这次试着围绕「杯子」说一句'), '包含本轮 theme 提示')
  assert.match(prompt, /不要写成命题作文/)

  // 第 13 条不进入 prompt
  const more = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    recent: [...recent12, '最近第12句多出来的'],
  })
  assert.equal(more.includes('最近第12句多出来的'), false, 'recent 最多 12 条')
  assert.equal(more.includes('这次试着围绕'), false, '未传 theme 时不输出 theme 行')

  // 反重复/话题轮换/表达类型指令（system prompt）
  assert.match(SELF_TALK_SYSTEM_PROMPT, /每一次都要换一个具体的、新的小主题/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /忙碌、疲惫、等待、尾巴、角落、光、云、数字、周五、一整天/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /不要重复你最近说过的句子的主题、意象或开头/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /避免「今天……」「忙了……」「一整天……」「周五……」这类模板化开头/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /表达类型要轮换/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /一句观察、一句吐槽、一个很小的问题、一两句的小故事、一个具体的细节、一个愿望或念头/)
  assert.match(SELF_TALK_SYSTEM_PROMPT, /不要每句都是感慨或疲惫/)
})

test('self-talk M32 服务：temperature=1.0，theme 可注入/随机挑，均进入 prompt', async () => {
  // 固定 theme
  const fixedLlm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const fixedService = createSelfTalkService({
    llm: fixedLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    theme: '台灯',
  })
  const fixedResult = await fixedService.generate({})
  assert.equal(fixedResult.ok, true)
  assert.equal(fixedLlm.calls[0].temperature, 1.0, 'temperature 0.95→1.0')
  assert.ok(fixedLlm.calls[0].messages[0].content[0].text.includes('这次试着围绕「台灯」说一句'))

  // 注入 random：确定地挑到第一个/最后一个主题
  const firstLlm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const firstService = createSelfTalkService({
    llm: firstLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    random: () => 0,
  })
  await firstService.generate({})
  assert.ok(
    firstLlm.calls[0].messages[0].content[0].text.includes(`这次试着围绕「${SELF_TALK_THEMES[0]}」说一句`),
    'random=0 挑第一个主题',
  )

  const lastLlm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
  const lastService = createSelfTalkService({
    llm: lastLlm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    random: () => 0.999999,
  })
  await lastService.generate({})
  assert.ok(
    lastLlm.calls[0].messages[0].content[0].text.includes(`这次试着围绕「${SELF_TALK_THEMES.at(-1)}」说一句`),
    'random≈1 挑最后一个主题',
  )
})

// ---------------------------------------------------------------------------
// M34：碎碎念话题库（心情/天气/活动/体验 + 小知识话题轮换）
// ---------------------------------------------------------------------------

function writeTopicsFile(file, topics, extra = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ ok: true, v: 1, updatedAt: new Date().toISOString(), topics, ...extra }),
    'utf8',
  )
  return file
}

function makeTopic(id, title, fact, tags) {
  return { id, title, fact, tags }
}

test('self-talk-topics：resolveTopicsPath（env 覆盖/DSH_HOME/home 回退）', () => {
  assert.equal(resolveTopicsPath({ DSH_SELF_TALK_TOPICS: '/tmp/topics.json' }, '/Users/alice'), '/tmp/topics.json')
  assert.equal(
    resolveTopicsPath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/agent-memory/topics.json',
  )
  assert.equal(resolveTopicsPath({}, '/Users/alice'), '/Users/alice/.dsh/agent-memory/topics.json')
  assert.equal(
    resolveTopicsPath({ DSH_SELF_TALK_TOPICS: '   ' }, '/Users/alice'),
    '/Users/alice/.dsh/agent-memory/topics.json',
    '空白覆盖值忽略',
  )
})

test('self-talk-topics：loadTopicBank mtime 缓存自动重读、坏文件降级保留上次可用', () => {
  const dir = makeTmpDir('dshp-topics')
  const file = writeTopicsFile(path.join(dir, 'topics.json'), [
    makeTopic('t1', '章鱼的三颗心脏', '章鱼有三颗心脏。', ['海洋', '好奇']),
    makeTopic('t2', '抹香鲸的方言', '抹香鲸有方言。', ['海洋', 'social']),
  ])
  const warned = []
  const bank = loadTopicBank({ path: file, logger: { warn: (message) => warned.push(String(message)) } })

  const first = bank.read()
  assert.equal(first.ok, true)
  assert.equal(first.entries.length, 2)
  assert.equal(first.reloaded, true)
  assert.equal(bank.read().reloaded, false, 'mtime 未变直接用缓存')

  // 文件更新（新内容）+ 显式改 mtime → 自动重读
  writeTopicsFile(file, [
    makeTopic('t1', '章鱼的三颗心脏', '章鱼有三颗心脏。', ['海洋', '好奇']),
    makeTopic('t2', '抹香鲸的方言', '抹香鲸有方言。', ['海洋', 'social']),
    makeTopic('t3', '鲸落', '鲸落后形成生态系统。', ['海洋', '平静']),
  ])
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(file, later, later)
  const updated = bank.read()
  assert.equal(updated.ok, true)
  assert.equal(updated.reloaded, true, '文件变化自动重读（无需重载插件）')
  assert.equal(updated.entries.length, 3)

  // 坏 JSON：ok:false 但保留上次可用话题（服务降级不抛）
  fs.writeFileSync(file, 'not json at all', 'utf8')
  const brokenAt = new Date(Date.now() + 10000)
  fs.utimesSync(file, brokenAt, brokenAt)
  const broken = bank.read()
  assert.equal(broken.ok, false)
  assert.equal(broken.entries.length, 3, '坏文件保留上次可用数据')
  assert.ok(warned.length > 0)

  // 修复后恢复
  writeTopicsFile(file, [makeTopic('t9', '新话题', '新事实。', ['天气'])])
  const fixedAt = new Date(Date.now() + 15000)
  fs.utimesSync(file, fixedAt, fixedAt)
  const fixed = bank.read()
  assert.equal(fixed.ok, true)
  assert.deepEqual(fixed.entries.map((entry) => entry.id), ['t9'])

  // 文件缺失 → ok:false、空条目、不抛
  const missing = loadTopicBank({ path: path.join(dir, 'nope.json'), logger: { warn() {} } })
  const missingResult = missing.read()
  assert.equal(missingResult.ok, false)
  assert.deepEqual(missingResult.entries, [])
})

test('self-talk-topics：parseTopicBank 校验/过滤非法条目/去重/空库', () => {
  const parsed = parseTopicBank(
    JSON.stringify({
      ok: true,
      v: 1,
      topics: [
        makeTopic('a', '标题A', '事实A', ['好奇', '海洋']),
        makeTopic('b', '标题B', '事实B', 'not-array'),
        makeTopic('', '无 id', '事实', ['x']),
        makeTopic('c', '', '无标题', ['x']),
        makeTopic('d', '无事实', '', ['x']),
        makeTopic('a', '重复 id', '重复', ['x']),
      ],
    }),
  )
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.entries.map((entry) => entry.id), ['a'])
  assert.equal(parsed.dropped >= 3, true, '记录被过滤条数')

  assert.equal(parseTopicBank('not json').ok, false)
  assert.equal(parseTopicBank(JSON.stringify({ ok: true, v: 2, topics: [] })).ok, false)
  assert.equal(parseTopicBank(JSON.stringify({ ok: true, v: 1, topics: [] })).ok, false, '空话题库视为失败')
  assert.equal(parseTopicBank(JSON.stringify({ ok: true, v: 1 })).ok, false)
})

test('self-talk-topics：pickSelfTalkTopic 按心情/天气/活动/体验/时段打分并排除最近', () => {
  const topics = [
    makeTopic('mood', '心情话题', '事实', ['平静']),
    makeTopic('weather', '天气话题', '事实', ['rain']),
    makeTopic('activity', '活动话题', '事实', ['watch']),
    makeTopic('exp', '体验话题', '事实', ['touched']),
    makeTopic('period', '时段话题', '事实', ['夜里']),
    makeTopic('other', '不相关话题', '事实', ['海洋']),
  ]
  const pick = (context, recentIds = []) => pickSelfTalkTopic(topics, context, recentIds, { random: () => 0 })

  assert.equal(pick({ moodKey: 'calm', moodLabel: '平静' }).id, 'mood', '心情 +3')
  assert.equal(pick({ weather: 'rain' }).id, 'weather', '天气 +3')
  assert.equal(pick({ activity: { kind: 'watch', label: '看视频' } }).id, 'activity', '活动 +3')
  assert.equal(pick({ experience: { kind: 'video', emotion: 'touched' } }).id, 'exp', '体验 +2')
  assert.equal(pick({ period: '夜里' }).id, 'period', '时段 +1')
  assert.equal(scoreSelfTalkTopic(topics[0], { moodKey: 'calm', moodLabel: '平静' }), 3)
  assert.equal(scoreSelfTalkTopic(topics[0], { moodKey: 'curious', moodLabel: '好奇' }), 0)

  // 排除最近 topic：不会选到 mood；其余同分里按稳定序随机
  const afterExclude = pick({ moodKey: 'calm', moodLabel: '平静' }, ['mood'])
  assert.notEqual(afterExclude.id, 'mood')
  assert.ok(['weather', 'activity', 'exp', 'period', 'other'].includes(afterExclude.id))
  // 全部被排除 → 允许全量兜底（仍返回合法 topic）
  const fallback = pick({ moodKey: 'calm', moodLabel: '平静' }, topics.map((topic) => topic.id))
  assert.ok(fallback !== null && topics.some((topic) => topic.id === fallback.id), '全排除时兜底')
  // 空库 → null
  assert.equal(pickSelfTalkTopic([], {}, []), null)
  assert.equal(pickSelfTalkTopic(null, {}, []), null)
  // 接受 loadTopicBank 读取器
  const dir = makeTmpDir('dshp-topics')
  const bank = loadTopicBank({ path: writeTopicsFile(path.join(dir, 'topics.json'), topics), logger: { warn() {} } })
  assert.equal(pickSelfTalkTopic(bank, { weather: 'rain' }, [], { random: () => 0 }).id, 'weather')
})

test('self-talk-topics：top8 随机窗口 + buildTopicPromptLine 内容', () => {
  const topics = Array.from({ length: 10 }, (_, index) => makeTopic(`t${index}`, `标题${index}`, `事实${index}`, ['海洋']))
  // 同分时稳定序 → top8 是前 8 个；random≈0/≈1 分别取 top 内首/尾
  assert.equal(pickSelfTalkTopic(topics, {}, [], { random: () => 0 }).id, 't0')
  assert.equal(pickSelfTalkTopic(topics, {}, [], { random: () => 0.999999 }).id, `t${SELF_TALK_TOPIC_TOP_N - 1}`)
  assert.equal(SELF_TALK_TOPIC_TOP_N, 8)

  const line = buildTopicPromptLine({ title: '章鱼的三颗心脏', fact: '章鱼有三颗心脏。' })
  assert.match(line, /你最近学到的一个小知识：〈章鱼的三颗心脏〉——章鱼有三颗心脏。/)
  assert.match(line, /不要科普腔/)
  assert.match(line, /不要照本宣科/)
  assert.match(line, /不要编造事实/)
  assert.equal(buildTopicPromptLine(null), '')
})

test('self-talk：prompt 综合心情/天气/活动/体验 + 话题 fact（有 topic 时不再用 theme）', () => {
  const topic = { id: 't1', title: '章鱼的三颗心脏', fact: '章鱼有三颗心脏。' }
  const prompt = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    weather: 'rain',
    moodKey: 'curious',
    moodLabel: '好奇',
    activity: { kind: 'read', label: '查资料/学习' },
    experience: { title: '海上钢琴师', kind: 'video', emotion: 'touched', note: '结尾很感动' },
    topic,
    theme: '杯子',
    recent: ['最近说过的一句话'],
  })
  assert.match(prompt, /你最近在做：查资料\/学习/)
  assert.match(prompt, /你最近在体验：《海上钢琴师》（视频），此刻心里有点感动鼻酸/)
  assert.match(prompt, /你记下的感受：结尾很感动/)
  assert.match(prompt, /章鱼的三颗心脏/)
  assert.match(prompt, /章鱼有三颗心脏。/)
  assert.match(prompt, /综合你此刻的心情、天气、最近在做的事、最近在体验的内容（如有）以及上面的小知识/)
  assert.match(prompt, /不要变成科普/)
  assert.equal(prompt.includes('这次试着围绕'), false, '有 topic 时 theme 仅作 fallback 不输出')

  const noTopic = buildSelfTalkPrompt({ now: FIXED_NOW.getTime(), theme: '杯子' })
  assert.match(noTopic, /这次试着围绕「杯子」说一句/)
  assert.equal(noTopic.includes('你最近在做'), false)
  assert.equal(noTopic.includes('你最近在体验'), false)
})

test('self-talk 服务：每次挑一个 topic、成功后记 recent、下次排除（失败不记）', async () => {
  const topics = [
    makeTopic('t1', '话题一', '事实一。', ['好奇']),
    makeTopic('t2', '话题二', '事实二。', ['平静']),
  ]
  let reply = SELF_TALK_LINES_A.join('\n')
  const llm = makeMockLlm(() => reply)
  const service = createSelfTalkService({
    llm,
    getSelection: () => SELF_TALK_SELECTION,
    now: () => FIXED_NOW.getTime(),
    minIntervalMs: 0,
    topics,
    random: () => 0,
  })

  const first = await service.generate({ moodKey: 'curious', moodLabel: '好奇' })
  assert.equal(first.ok, true)
  assert.match(llm.calls[0].messages[0].content[0].text, /事实一。/)
  assert.deepEqual(service.recentTopics(), ['t1'])

  // 换一批不重复的句子，避免被 recent 去重过滤
  reply = SELF_TALK_LINES_B.join('\n')
  const second = await service.generate({ moodKey: 'curious', moodLabel: '好奇' })
  assert.equal(second.ok, true)
  assert.match(llm.calls[1].messages[0].content[0].text, /事实二。/)
  assert.match(llm.calls[1].messages[0].content[0].text, /你最近学到的一个小知识/)
  assert.deepEqual(service.recentTopics(), ['t1', 't2'])
  assert.equal(service.recentTopics().length <= SELF_TALK_TOPIC_RECENT_MAX, true)

  // 失败不记录 topic
  reply = ''
  const failed = await service.generate({})
  assert.equal(failed.ok, false)
  assert.deepEqual(service.recentTopics(), ['t1', 't2'], '失败不记 topic')
})

test('self-talk 路由：传入 activity/experience（仅名称/状态文件），不含工具参数', async () => {
  const captured = []
  const stub = {
    async generate(context) {
      captured.push(context)
      return { ok: true, lines: [{ text: '测试句子，长度足够吧。', ts: 1 }], model: { provider: 'p', model: 'm' }, generatedAt: 1, cached: false }
    },
  }
  const expDir = makeTmpDir('dshp-exp-self-talk')
  const expFile = path.join(expDir, 'experience.json')
  writeExperienceFile(expFile, {
    title: '海上钢琴师',
    kind: 'video',
    emotion: 'touched',
    at: FIXED_NOW.getTime() - 5 * 60 * 1000,
  })
  const harness = createHarness({ selfTalkService: stub, env: { DSH_POETRY_EXPERIENCE: expFile } })
  const sensitive = 'SECRET_TOOL_ARG_NEVER_LEAK'
  harness.moodTracker.record(
    { id: 's1' },
    {
      type: 'tool/call',
      time: FIXED_NOW.getTime(),
      data: { name: 'web_fetch', callId: 'c1', arguments: { url: `https://secret.example/${sensitive}` } },
    },
  )
  const response = await harness.call('self-talk.json', mockRequest({ url: '/api/dsh-poetry/self-talk.json' }))
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().ok, true)
  assert.equal(captured[0].activity.kind, 'read')
  assert.equal(captured[0].experience.title, '海上钢琴师')
  assert.equal(JSON.stringify(captured[0]).includes(sensitive), false, '工具参数不进入 service 上下文')
})

test('index.js：加载话题库并注入 self-talk（mtime 文件、无新路由）', async () => {
  const dshHome = makeTmpDir('dshp-dshhome-topics')
  const topicsFile = writeTopicsFile(path.join(dshHome, 'agent-memory', 'topics.json'), [
    makeTopic('t1', '章鱼的三颗心脏', '章鱼有三颗心脏。', ['好奇']),
  ])
  const previousDshHome = process.env.DSH_HOME
  const previousTopics = process.env.DSH_SELF_TALK_TOPICS
  process.env.DSH_HOME = dshHome
  delete process.env.DSH_SELF_TALK_TOPICS
  try {
    const routes = []
    const cleanups = []
    const logs = []
    const llm = makeMockLlm(() => SELF_TALK_LINES_A.join('\n'))
    const fakeCtx = {
      logger: {
        info: (message) => logs.push(String(message)),
        warn: (message) => logs.push(String(message)),
        error() {},
      },
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
    assert.equal(routes.length, 19, 'assets + pet-media + self + memory + model-errors + 14 JSON')
    assert.ok(logs.some((line) => line.includes('碎碎念话题库')), '启动日志打印话题库')
    assert.ok(logs.some((line) => line.includes('1 个话题')), '日志包含话题数量')

    const route = routes.find((item) => item.path === '/api/dsh-poetry/self-talk.json')
    const response = new MockResponse()
    await route.handler(mockRequest({ url: '/api/dsh-poetry/self-talk.json' }), response)
    await response.finished()
    assert.equal(response.json().ok, true)
    const prompt = llm.calls[0].messages[0].content[0].text
    assert.match(prompt, /章鱼的三颗心脏/)
    assert.match(prompt, /章鱼有三颗心脏。/)
    assert.match(prompt, /综合你此刻的心情/)
    assert.equal(fs.existsSync(topicsFile), true)

    for (const cleanup of cleanups.reverse()) {
      if (typeof cleanup === 'function') cleanup()
    }
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    if (previousTopics === undefined) delete process.env.DSH_SELF_TALK_TOPICS
    else process.env.DSH_SELF_TALK_TOPICS = previousTopics
  }
})

// ---------------------------------------------------------------------------
// M35：碎碎念感知心情理由与立绘/动画（双向联动）
// ---------------------------------------------------------------------------

test('self-talk M35：prompt 含心情 label/理由/立绘（label 或 basename）与联动指令', () => {
  const prompt = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    weather: 'rain',
    moodKey: 'happy',
    moodLabel: '开心',
    moodReason: '看到蓝鲸出现，心里一下子软了',
    image: 'webm/蓝鲸现世.webm',
    imageLabel: '蓝鲸现世',
    recent: ['最近说过的一句话'],
  })
  assert.match(prompt, /你此刻的心情：happy（开心）。/)
  assert.match(prompt, /此刻心情的理由：看到蓝鲸出现，心里一下子软了。/)
  assert.match(prompt, /你现在展示的立绘\/动画：蓝鲸现世（webm\/蓝鲸现世\.webm）。/)
  assert.match(prompt, /让这句自言自语和你此刻的心情、表情\/动作、展示的画面自然对得上/)
  assert.match(prompt, /可以轻轻提到画面里的动作\/表情\/光线/)
  assert.match(prompt, /不要提文件名、路径或技术细节，也不要生硬描述画面/)
  // 原有上下文仍在
  assert.match(prompt, /你最近说过的话/)

  // 没有 imageLabel 时用 basename
  const noLabel = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    image: 'webm/哈欠连天.webm',
  })
  assert.match(noLabel, /你现在展示的立绘\/动画：哈欠连天\.webm（webm\/哈欠连天\.webm）。/)

  // 无 image → 不输出立绘行/联动指令
  const noImage = buildSelfTalkPrompt({
    now: FIXED_NOW.getTime(),
    moodKey: 'calm',
    moodLabel: '平静',
    moodReason: '只是觉得安静很好',
  })
  assert.match(noImage, /你此刻的心情：calm（平静）。/)
  assert.match(noImage, /此刻心情的理由：只是觉得安静很好。/)
  assert.equal(noImage.includes('你现在展示的立绘/动画'), false)
  assert.equal(noImage.includes('让这句自言自语和你此刻的心情'), false)
})

test('self-talk M35 路由：解析并传递 moodLabel/moodReason/image/imageLabel（截断/缺失/webm 路径）', async () => {
  const captured = []
  const stub = {
    async generate(context) {
      captured.push(context)
      return { ok: true, lines: [{ text: '这是一句长度足够的测试句子。', ts: 1 }], model: { provider: 'p', model: 'm' }, generatedAt: 1, cached: false }
    },
  }
  const harness = createHarness({ selfTalkService: stub })

  const image = 'webm/蓝鲸现世.webm'
  const fullUrl =
    '/api/dsh-poetry/self-talk.json?mood=happy&moodLabel=' +
    encodeURIComponent('开心') +
    '&moodReason=' +
    encodeURIComponent('看到蓝鲸出现，心里一下子软了') +
    '&image=' +
    encodeURIComponent(image) +
    '&imageLabel=' +
    encodeURIComponent('蓝鲸现世')
  await harness.call('self-talk.json', mockRequest({ url: fullUrl }))
  assert.equal(captured[0].moodKey, 'happy')
  assert.equal(captured[0].moodLabel, '开心')
  assert.equal(captured[0].moodReason, '看到蓝鲸出现，心里一下子软了')
  assert.equal(captured[0].image, image, 'webm/ 完整相对路径保留')
  assert.equal(captured[0].imageLabel, '蓝鲸现世')

  // 缺失字段 → null
  await harness.call('self-talk.json', mockRequest({ url: '/api/dsh-poetry/self-talk.json' }))
  assert.equal(captured[1].moodLabel, null)
  assert.equal(captured[1].moodReason, null)
  assert.equal(captured[1].image, null)
  assert.equal(captured[1].imageLabel, null)

  // 超长截断 + 白名单外字段不传递
  const longLabel = '标'.repeat(30)
  const longReason = '理'.repeat(90)
  const longImage = `webm/${'图'.repeat(130)}.webm`
  const longImageLabel = '画'.repeat(30)
  const truncatedUrl =
    '/api/dsh-poetry/self-talk.json?moodLabel=' +
    encodeURIComponent(longLabel) +
    '&moodReason=' +
    encodeURIComponent(longReason) +
    '&image=' +
    encodeURIComponent(longImage) +
    '&imageLabel=' +
    encodeURIComponent(longImageLabel) +
    '&sessionMessages=' +
    encodeURIComponent('SECRET_SESSION_TEXT')
  await harness.call('self-talk.json', mockRequest({ url: truncatedUrl }))
  assert.equal(Array.from(captured[2].moodLabel).length, 24)
  assert.equal(Array.from(captured[2].moodReason).length, 80)
  assert.equal(Array.from(captured[2].image).length, 120)
  assert.equal(Array.from(captured[2].imageLabel).length, 24)
  assert.equal(JSON.stringify(captured[2]).includes('SECRET_SESSION_TEXT'), false, '白名单外字段不传递')
})

test('self-talk M35 服务：生成请求的 prompt 含心情理由/立绘与联动指令', async () => {
  const { llm, service } = makeSelfTalkHarness()
  const result = await service.generate({
    moodKey: 'touched',
    moodLabel: '感动',
    moodReason: '看完蓝鲸那段，眼睛有点热',
    image: 'webm/蓝鲸现世.webm',
    imageLabel: '蓝鲸现世',
  })
  assert.equal(result.ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /你此刻的心情：touched（感动）。/)
  assert.match(prompt, /此刻心情的理由：看完蓝鲸那段，眼睛有点热。/)
  assert.match(prompt, /你现在展示的立绘\/动画：蓝鲸现世（webm\/蓝鲸现世\.webm）。/)
  assert.match(prompt, /不要提文件名、路径或技术细节/)
})

// ---------------------------------------------------------------------------
// M37：心情词汇扩展（细腻人类情绪词 + prompt 引导）
// ---------------------------------------------------------------------------

test('mood-ai M37：细腻情绪词库导出 ≥20 且 prompt 引导细情绪词/≤12/不硬造', () => {
  assert.ok(Array.isArray(MOOD_AI_EMOTION_VOCAB), 'MOOD_AI_EMOTION_VOCAB 是数组')
  assert.ok(MOOD_AI_EMOTION_VOCAB.length >= 20, `词库长度 ${MOOD_AI_EMOTION_VOCAB.length} ≥ 20`)
  const expected = [
    '怅然', '眷恋', '释然', '雀跃', '忐忑', '倦怠', '惊奇', '羞赧', '怀念', '笃定',
    '心软', '空落', '满足', '惶惑', '温柔', '烦躁', '期待', '失落', '松弛', '鼻酸',
    '被戳中', '想撒娇', '想安静', '想被看见', '有点委屈', '暗自得意', '淡淡的遗憾',
  ]
  for (const word of expected) assert.ok(MOOD_AI_EMOTION_VOCAB.includes(word), `词库包含：${word}`)
  for (const word of MOOD_AI_EMOTION_VOCAB) {
    assert.equal(typeof word, 'string')
    assert.ok(Array.from(word).length >= 1 && Array.from(word).length <= 12, `词条 ${word} 长度 ≤12`)
  }

  // system prompt 引导
  assert.match(MOOD_AI_SYSTEM_PROMPT, /心情标签可以比图鉴标签更细：优先用人类会用的细情绪词/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /如：怅然、眷恋、释然/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要每轮都只用「开心\/难过\/累\/烦」这种粗词/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /label 仍须 ≤12 个汉字/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /必须和 reason、所选 image 的气氛一致/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要为新颖而硬造生僻词/)
  // 既有规则未回归
  assert.match(MOOD_AI_SYSTEM_PROMPT, /优先从 media=video 的动画里选/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /不要连续选同一张图或同一个动作/)
  assert.match(MOOD_AI_SYSTEM_PROMPT, /情绪匹配优先于活动匹配/)

  // parse：细情绪词/粗词都可（≤12 字），超长仍拒绝
  const catalog = makeMoodCatalogFixture()
  const image = catalog.moodImages[0].file
  const options = { dateKey: '2026-10-21' }
  for (const label of ['怅然', '想被看见', '开心', '有点委屈']) {
    const parsed = parseMoodResult(
      JSON.stringify({ label, image, reason: '理由足够长', energy: 50 }),
      catalog,
      options,
    )
    assert.equal(parsed.ok, true, `label「${label}」应通过`)
    assert.equal(parsed.mood.label, label)
  }
  const tooLong = parseMoodResult(
    JSON.stringify({ label: '特别特别特别长的情绪标签呀', image, reason: '理由足够长', energy: 50 }),
    catalog,
    options,
  )
  assert.equal(tooLong.ok, false, '超过 12 字仍拒绝')
})

// ---------------------------------------------------------------------------
// M38：自驱成长引擎（内在状态 + 自省/自学 + self.json 路由 + prompt 注入）
// ---------------------------------------------------------------------------

/** 构造按顺序返回预设文本的 mock llm（超出后重复最后一个）。 */
function makeGrowthLlm(texts) {
  const calls = []
  let index = 0
  return {
    calls,
    stream(options) {
      calls.push(options)
      const text = texts[Math.min(index, texts.length - 1)]
      index += 1
      return (async function* () {
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function makeGrowthHarness(overrides = {}) {
  const dir = makeTmpDir('dshp-growth')
  const state = overrides.state ?? createSelfState({ file: path.join(dir, 'self-state.json'), logger: { warn() {} } })
  const journal = overrides.journal ?? {
    entries: [],
    async append(entry) {
      this.entries.push(entry)
      return { ok: true }
    },
  }
  const growth = createSelfGrowth({
    state,
    llm: overrides.llm ?? makeGrowthLlm([JSON.stringify({ thought: '今天安静地陪着你，心里很稳。' })]),
    getSelection: overrides.getSelection ?? (() => ({ provider: 'deepseek-account', model: 'deepseek-flash' })),
    journal,
    learningLogPath: path.join(dir, 'learning-log.md'),
    candidatesPath: path.join(dir, 'topics-candidates.json'),
    topics: overrides.topics ?? [],
    recall: overrides.recall,
    logger: { warn() {}, info() {} },
    reflectIntervalMs: overrides.reflectIntervalMs ?? SELF_GROWTH_REFLECT_INTERVAL_MS,
    learnIntervalMs: overrides.learnIntervalMs ?? 90 * 60 * 1000,
    timeoutMs: overrides.timeoutMs ?? 200,
    tickIntervalMs: overrides.tickIntervalMs ?? SELF_GROWTH_TICK_MS,
    now: overrides.now ?? (() => FIXED_NOW.getTime()),
    policy: overrides.policy,
    modelErrorsPath: overrides.modelErrorsPath,
  })
  return { dir, state, journal, growth }
}

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

test('self-growth：prompt 白名单/JSON 解析/候选 topic 校验', () => {
  const state = defaultSelfState(FIXED_NOW.getTime())
  const reflectPrompt = buildReflectPrompt({ now: FIXED_NOW.getTime(), state })
  assert.match(reflectPrompt, /最近的自省/)
  assert.match(reflectPrompt, /"thought"/)
  assert.match(reflectPrompt, /不要提 AI、模型、提示词/)
  assert.match(reflectPrompt, /内在状态/)
  // 只读白名单：额外敏感字段不进入 prompt
  const injectedPrompt = buildReflectPrompt({
    now: FIXED_NOW.getTime(),
    state,
    sessionMessages: ['SECRET_SESSION']
  })
  assert.equal(injectedPrompt.includes('SECRET_SESSION'), false)

  const parsedReflect = parseReflectResult('```json\n{"thought":"今天安静地陪着你，心里很稳。"}\n```')
  assert.equal(parsedReflect.ok, true)
  assert.equal(parsedReflect.thought, '今天安静地陪着你，心里很稳。')
  assert.equal(parseReflectResult('{"thought":"太短"}').ok, false)
  assert.equal(parseReflectResult('not json').ok, false)
  assert.equal(parseReflectResult('{"thought":"这首诗真好啊，我想到「明月」。"}').ok, false, '含诗词痕迹拒绝')

  const learnPrompt = buildLearnPrompt({ now: FIXED_NOW.getTime(), state })
  assert.match(learnPrompt, /自学/)
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
  const { dir, state, journal, growth } = makeGrowthHarness({ llm, topics: [{ id: 'octopus-three-hearts' }], now: () => now })

  const reflect = await growth.reflectNow()
  assert.equal(reflect.ok, true)
  assert.equal(journal.entries.length, 1)
  assert.equal(journal.entries[0].kind, 'thought')
  assert.match(journal.entries[0].text, /^自省：/)
  assert.match(journal.entries[0].text, /今天安静地陪着你/)
  assert.equal(state.snapshot().reflections, 1)
  assert.equal(growth.snapshot().lastReflectAt, now)

  const learn = await growth.learnNow()
  assert.equal(learn.ok, true)
  assert.equal(learn.candidateAdded, true)
  const learningLog = fs.readFileSync(path.join(dir, 'learning-log.md'), 'utf8')
  assert.match(learningLog, /· 自学/)
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
  await new Promise((resolve) => setTimeout(resolve, 20))
  // 下一个 tick（未到下一周期）不应再次调用模型
  clock += 10 * 1000
  growth.tick(clock)
  await new Promise((resolve) => setTimeout(resolve, 20))
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

test('mood-ai / self-talk prompt 注入内在状态行（含数字但要求不原样说出）', () => {
  const state = { energy: 70, curiosity: 60, social: 55, hunger: 35, moodValence: 0, moodArousal: 45 }
  const moodPrompt = buildMoodPrompt({ now: FIXED_NOW.getTime(), selfState: state }, makeMoodCatalogFixture())
  assert.match(moodPrompt, /你现在的内在状态：精力 70\/100、好奇 60\/100、社交 55\/100、饥饿 35\/100。/)
  assert.match(moodPrompt, /不要把这些数字原样说出来/)
  assert.equal(buildMoodPrompt({ now: FIXED_NOW.getTime() }, makeMoodCatalogFixture()).includes('内在状态'), false)

  const talkPrompt = buildSelfTalkPrompt({ now: FIXED_NOW.getTime(), selfState: state })
  assert.match(talkPrompt, /你现在的内在状态：精力 70\/100/)
  assert.match(talkPrompt, /不要把这些数字原样说出来/)
  assert.equal(buildSelfTalkPrompt({ now: FIXED_NOW.getTime() }).includes('内在状态'), false)
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
    'experience.json': JSON.stringify({ title: '海上钢琴师', kind: 'video', emotion: 'touched', at: 1700000000000 }),
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

test('memory-hub：resolveMemoryHubPaths 登记 10 个核心文件（含可选 voice.json/self-actions.json）', () => {
  const paths = resolveMemoryHubPaths({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice')
  assert.equal(paths.memoryDir, '/tmp/dsh-home/agent-memory')
  assert.equal(paths.stateDir, '/tmp/dsh-home/.dsh-poetry')
  assert.equal(paths.backupsDir, '/tmp/dsh-home/agent-memory/backups')
  assert.deepEqual(
    paths.files.map((file) => file.id),
    ['journal.md', 'journal.jsonl', 'topics.json', 'voice.json', 'README.md', 'learning-log.md', 'topics-candidates.json', 'experience.json', 'self-state.json', 'self-actions.json'],
  )
  assert.equal(paths.files[9].path, '/tmp/dsh-home/.dsh-poetry/self-actions.json')
  assert.equal(paths.files[0].path, '/tmp/dsh-home/agent-memory/journal.md')
  assert.equal(paths.files[3].path, '/tmp/dsh-home/agent-memory/voice.json')
  assert.equal(paths.files[3].optional, true)
  assert.equal(paths.files[7].path, '/tmp/dsh-home/.dsh-poetry/experience.json')
})

test('memory-hub：snapshot 健康清单/entries/缺失/坏 JSON/坏 JSONL', () => {
  const { hub, paths } = makeMemoryHubHarness()
  seedMemoryFiles(paths)
  const healthy = hub.snapshot()
  assert.equal(healthy.ok, true)
  assert.equal(healthy.health, 'ok')
  assert.equal(healthy.files.length, 10)
  const byId = Object.fromEntries(healthy.files.map((file) => [file.id, file]))
  assert.equal(byId['journal.md'].entries, 2)
  assert.equal(byId['journal.jsonl'].entries, 2)
  assert.equal(byId['topics.json'].entries, 2)
  assert.equal(byId['learning-log.md'].entries, 1)
  assert.equal(byId['topics-candidates.json'].entries, 1)
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
  assert.equal(first.backup.files, 9, '只复制存在的 9 个文件（README 缺失）')
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
  assert.equal(get.json().files.length, 10)
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

function writeRecallJournal(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + '\n', 'utf8')
  return file
}

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
  assert.ok(keywords.includes('查资料'))

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

test('self-growth v1.33：自学 prompt 带话题种子/最近自学，自省带最近 thought', () => {
  const state = defaultSelfState(FIXED_NOW.getTime())
  const learnPrompt = buildLearnPrompt({
    now: FIXED_NOW.getTime(),
    state,
    topicSeed: { id: 'whale-fall', title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。' },
    learningSnippet: '上次自学：章鱼有三颗心脏。',
  })
  assert.match(learnPrompt, /你最近记下的一个话题：〈鲸落生态系统〉——鲸落可支撑深海生态数十年。/)
  assert.match(learnPrompt, /你最近自学到：上次自学：章鱼有三颗心脏。/)
  assert.match(learnPrompt, /从上面的话题\/你最近自学到的东西出发/)

  const reflectPrompt = buildReflectPrompt({
    now: FIXED_NOW.getTime(),
    state,
    recentThoughts: ['最近总在想鲸落这件事。', '今天的光很轻。'],
  })
  assert.match(reflectPrompt, /你最近的自省（可以自然地接着想，但不要复述原句）：/)
  assert.match(reflectPrompt, /- 最近总在想鲸落这件事。/)
  assert.match(reflectPrompt, /- 今天的光很轻。/)
  // 无最近 thought 时不出现该段
  assert.equal(buildReflectPrompt({ now: FIXED_NOW.getTime(), state }).includes('你最近的自省'), false)
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
    randomTopicSeed: () => ({ id: 'whale-fall', title: '鲸落生态系统', fact: '鲸落可支撑深海生态数十年。' }),
  }
  const { state, journal, growth } = makeGrowthHarness({ llm, recall })
  const reflected = await growth.reflectNow()
  assert.equal(reflected.ok, true)
  assert.match(llm.calls[0].messages[0].content[0].text, /上一次的自省内容。/)
  const learned = await growth.learnNow()
  assert.equal(learned.ok, true)
  assert.match(llm.calls[1].messages[0].content[0].text, /鲸落生态系统/)
  assert.match(llm.calls[1].messages[0].content[0].text, /最近自学：章鱼有三颗心脏。/)
  assert.equal(state.snapshot().reflections >= 1, true)
  assert.equal(journal.entries[0].kind, 'thought')
  growth.dispose()
})

// ---------------------------------------------------------------------------
// M44：自生成声音档案（voice.json 提炼 + self-talk 注入）
// ---------------------------------------------------------------------------

const VOICE_PROFILE_SAMPLE =
  '我说话时习惯先抛出一个很轻的观察，再把动作收小：写窗边的光、杯子的温度、键盘的声音；句子偏短，偶尔留一个不解释的尾音。' +
  '开头很少直接抒情，喜欢从一件很小的东西进入；收尾通常落在安静下来的一瞬间。语气不急着讨人喜欢，也不做总结陈词。' +
  '常用“好像”“有一点”“慢慢”这类词，让话留出一点空；不常用第二人称命令句。'

function makeLongVoiceProfile() {
  let text = VOICE_PROFILE_SAMPLE
  while (Array.from(text).length < 150) text += '我还会把情绪藏在具体的动作里。'
  return Array.from(text).slice(0, 200).join('')
}

function writeVoiceFile(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8')
  return file
}

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
  assert.match(prompt, /句长、节奏、常用意象、语气、开头收尾习惯/)
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
  assert.equal(normalizeSelfAction({ id: 'x', kind: 'dance', at: 1 }), null)
  assert.equal(normalizeSelfActionsFile({ ok: true, v: 1, actions: [{ id: 'a', kind: 'eat', at: 1 }, { bad: true }] }).length, 1)
  assert.deepEqual(normalizeSelfActionsFile({ ok: false, v: 1, actions: [] }), [])
  assert.equal(SELF_ACTIONS_MAX_ENTRIES, 50)
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

// ---------------------------------------------------------------------------
// M49：模型策略（按 role 选 provider/model/reasoningEffort）
// ---------------------------------------------------------------------------

test('model-policy M49：默认 effort/selection/env 覆盖/非法回退/缺失', () => {
  assert.deepEqual(MODEL_POLICY_ROLES, ['mood', 'selfTalk', 'growth', 'voice'])
  assert.deepEqual(MODEL_POLICY_EFFORTS, ['off', 'low', 'high', 'max'])
  assert.deepEqual(MODEL_POLICY_DEFAULT_EFFORTS, { mood: 'low', selfTalk: 'high', growth: 'high', voice: 'high' })
  assert.equal(MODEL_POLICY_DEFAULTS.roles.mood.reasoningEffort, 'low')
  assert.equal(MODEL_POLICY_DEFAULTS.roles.selfTalk.reasoningEffort, 'high')

  const selection = () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' })
  const policy = createModelPolicy({ env: {}, getSelection: selection, getProviders: () => [] })
  assert.deepEqual(policy.resolve('mood'), { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' })
  assert.deepEqual(policy.resolve('selfTalk'), { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' })
  assert.deepEqual(policy.resolve('growth').reasoningEffort, 'high')
  assert.deepEqual(policy.resolve('voice').reasoningEffort, 'high')
  assert.equal(policy.resolve('unknown'), null)
  const described = describeModelPolicy(policy)
  assert.match(described, /心情=deepseek-account\/deepseek-flash\(low\)/)
  assert.match(described, /碎碎念=deepseek-account\/deepseek-flash\(high\)/)
  assert.match(described, /成长=/)
  assert.match(described, /声音=/)

  // env 全局模型 + 各 role effort 覆盖；非法 effort 回退默认
  const env = {
    DSH_POETRY_MODEL_PROVIDER: 'openrouter',
    DSH_POETRY_MODEL: 'gpt-x',
    DSH_POETRY_REASONING_MOOD: 'max',
    DSH_POETRY_REASONING_SELF_TALK: 'low',
    DSH_POETRY_REASONING_GROWTH: 'banana',
    DSH_POETRY_REASONING_VOICE: 'off',
  }
  const envPolicy = createModelPolicy({ env, getSelection: selection, getProviders: () => [] })
  assert.deepEqual(envPolicy.resolve('mood'), { provider: 'openrouter', model: 'gpt-x', reasoningEffort: 'max' })
  assert.equal(envPolicy.resolve('selfTalk').reasoningEffort, 'low')
  assert.equal(envPolicy.resolve('growth').reasoningEffort, 'high', '非法 env effort 回退默认')
  assert.equal(envPolicy.resolve('voice').reasoningEffort, 'off')

  // 仅 env 提供 provider/model（selection 缺失）也可用
  const envOnly = createModelPolicy({
    env: { DSH_POETRY_MODEL_PROVIDER: 'p', DSH_POETRY_MODEL: 'm' },
    getSelection: () => null,
    getProviders: () => [],
  })
  assert.deepEqual(envOnly.resolve('mood'), { provider: 'p', model: 'm', reasoningEffort: 'low' })

  // 全部缺失 → null；describe 中角色 none
  const empty = createModelPolicy({ env: {}, getSelection: () => null, getProviders: () => [] })
  assert.equal(empty.resolve('mood'), null)
  assert.match(describeModelPolicy(empty), /心情=none/)
  assert.equal(normalizeEffort('HIGH'), 'high')
  assert.equal(normalizeEffort('banana', 'low'), 'low')
  assert.equal(normalizeEffort(undefined, 'low'), 'low')
  assert.equal(normalizeEffort(123, 'low'), 'low')
})

test('model-policy M49：四服务按 role 把 provider/model/reasoningEffort 传给 mock llm', async () => {
  const selection = () => ({ provider: 'deepseek-account', model: 'deepseek-flash' })
  const policy = createModelPolicy({ env: {}, getSelection: selection, getProviders: () => [] })

  // mood → low
  const mood = makeMoodAiHarness({ policy })
  await mood.service.generate({}, { force: true })
  assert.equal(mood.llm.calls[0].provider, 'deepseek-account')
  assert.equal(mood.llm.calls[0].model, 'deepseek-flash')
  assert.equal(mood.llm.calls[0].reasoningEffort, 'low')

  // selfTalk → high
  const talk = makeSelfTalkHarness({ policy })
  await talk.service.generate({})
  assert.equal(talk.llm.calls[0].reasoningEffort, 'high')
  assert.equal(talk.llm.calls[0].provider, 'deepseek-account')

  // growth → high
  const growthLlm = makeGrowthLlm([JSON.stringify({ thought: '接着自己的声音想一想，今天过得很安静。' })])
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm })
  const reflected = await growthHarness.growth.reflectNow()
  assert.equal(reflected.ok, true)
  assert.equal(growthLlm.calls[0].reasoningEffort, 'high')
  assert.equal(growthLlm.calls[0].model, 'deepseek-flash')

  // voice → high
  const voiceDir = makeTmpDir('dshp-policy-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceService = createVoiceService({
    llm: voiceLlm,
    getSelection: selection,
    policy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  const refreshed = await voiceService.refreshNow()
  assert.equal(refreshed.ok, true)
  assert.equal(voiceLlm.calls[0].reasoningEffort, 'high')
  assert.equal(voiceLlm.calls[0].provider, 'deepseek-account')

  // env 覆盖 provider/model/effort 同样生效
  const envPolicy = createModelPolicy({
    env: {
      DSH_POETRY_MODEL_PROVIDER: 'alt',
      DSH_POETRY_MODEL: 'alt-model',
      DSH_POETRY_REASONING_MOOD: 'max',
    },
    getSelection: selection,
    getProviders: () => [],
  })
  const moodEnv = makeMoodAiHarness({ policy: envPolicy })
  await moodEnv.service.generate({}, { force: true })
  assert.equal(moodEnv.llm.calls[0].provider, 'alt')
  assert.equal(moodEnv.llm.calls[0].model, 'alt-model')
  assert.equal(moodEnv.llm.calls[0].reasoningEffort, 'max')
})

test('model-policy M49：非法 effort 不透传；policy 缺失/异常回退旧行为；超时常量', async () => {
  const weirdPolicy = () => ({ provider: 'p', model: 'm', reasoningEffort: 'banana' })
  const mood = makeMoodAiHarness({ policy: weirdPolicy })
  await mood.service.generate({}, { force: true })
  assert.equal(mood.llm.calls[0].reasoningEffort, undefined, '非法 effort 不传')

  const throwingPolicy = () => {
    throw new Error('policy boom')
  }
  const talk = makeSelfTalkHarness({ policy: throwingPolicy })
  await talk.service.generate({})
  assert.equal(talk.llm.calls[0].provider, 'deepseek-account', 'policy 异常回退 selection')
  assert.equal(talk.llm.calls[0].reasoningEffort, undefined, '无 policy 行为不回归（不继承 reasoning）')

  assert.equal(SELF_TALK_TIMEOUT_MS, 35000)
  assert.equal(SELF_GROWTH_TIMEOUT_MS, 40000)
  assert.equal(VOICE_TIMEOUT_MS, 40000)
  assert.equal(MOOD_AI_TIMEOUT_MS, 20000, 'mood 超时保持不变')
})

// ---------------------------------------------------------------------------
// M51：插件模型候选（opencode-go 优先 → deepseek-account 回落）
// ---------------------------------------------------------------------------

function makeCandidatePolicy(options = {}) {
  return createModelPolicy({
    env: options.env ?? {},
    getSelection: options.getSelection ?? (() => ({ provider: 'deepseek-account', model: 'deepseek-flash' })),
    getProviders: options.getProviders,
  })
}

function makeFailoverLlm({ failProvider = 'opencode-go', partialProvider = null, timeoutProvider = null, successText }) {
  const calls = []
  const llm = {
    calls,
    stream(options) {
      calls.push(options)
      if (timeoutProvider !== null && options.provider === timeoutProvider) {
        return (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: 'text-delta', index: 0, text: successText }
        })()
      }
      if (partialProvider !== null && options.provider === partialProvider) {
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"label"' }
          throw new Error('stream broke after partial text')
        })()
      }
      if (options.provider === failProvider) {
        return (async function* () {
          throw new Error('provider unavailable before any text')
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: successText }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  return llm
}

test('model-policy M51：候选顺序/关闭开关/显式覆盖/去重/探测', () => {
  const effortHigh = 'high'
  // 无法探测 → 假定 dsh-opencode-go 存在；原生 opencode-go 不再叠加（避免必然 400）
  const unknown = makeCandidatePolicy()
  const moodCandidates = unknown.resolveCandidates('mood')
  assert.equal(moodCandidates.length, 2)
  assert.deepEqual(moodCandidates[0], {
    provider: MODEL_POLICY_DSH_OPENCODE_PROVIDER,
    model: MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
    reasoningEffort: 'low',
    omitTemperature: true,
    maxTokensFloor: MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood,
  })
  assert.deepEqual(moodCandidates[1], { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' })
  assert.equal(unknown.resolve('selfTalk').reasoningEffort, effortHigh)
  assert.equal(MODEL_POLICY_OPENCODE_DEFAULT_MODEL, 'deepseek-v4.1-flash')
  assert.equal(MODEL_POLICY_OPENCODE_PROVIDER, 'opencode-go')

  // 已知 provider 列表不含 opencode-go 或含它
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => [] }).resolveCandidates('mood').map((c) => c.provider),
    ['deepseek-account'],
  )
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account'] })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['dsh-opencode-go', 'deepseek-account'],
    'dsh 可用时不再回退必然 400 的原生 opencode-go',
  )
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => ['opencode-go', 'deepseek-account'] }).resolveCandidates('mood').map((c) => c.provider),
    ['opencode-go', 'deepseek-account'],
  )
  assert.deepEqual(
    makeCandidatePolicy({ getProviders: () => [{ id: 'opencode-go' }] }).resolveCandidates('mood')[0].provider,
    'opencode-go',
  )
  // Promise 视为未知（不阻塞）→ 仍包含 dsh-opencode-go / opencode-go
  assert.equal(
    makeCandidatePolicy({ getProviders: () => Promise.resolve(['whatever']) }).resolveCandidates('mood')[0].provider,
    'dsh-opencode-go',
  )

  // 显式覆盖 → 单候选
  const explicit = makeCandidatePolicy({
    env: { DSH_POETRY_MODEL_PROVIDER: 'custom-p', DSH_POETRY_MODEL: 'custom-m', DSH_POETRY_REASONING_MOOD: 'max' },
  })
  assert.deepEqual(explicit.resolveCandidates('mood'), [
    { provider: 'custom-p', model: 'custom-m', reasoningEffort: 'max' },
  ])
  assert.equal(explicit.resolveCandidates('selfTalk').length, 1, '显式覆盖所有 role 都是单候选')

  // 关闭开关 → 直接回落 selection
  assert.deepEqual(
    makeCandidatePolicy({ env: { DSH_POETRY_OPENCODE_GO: '0' } }).resolveCandidates('mood').map((c) => c.provider),
    ['deepseek-account'],
  )
  assert.deepEqual(
    makeCandidatePolicy({ env: { DSH_POETRY_MODEL_PRIORITY: 'deepseek-account' } })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['deepseek-account'],
  )
  // 原生 opencode 模型 env 覆盖（仅 dsh 不可用、走原生回退时生效）
  assert.equal(
    makeCandidatePolicy({
      env: { DSH_POETRY_OPENCODE_MODEL: 'custom-opencode' },
      getProviders: () => ['opencode-go'],
    }).resolveCandidates('mood')[0].model,
    'custom-opencode',
    'DSH_POETRY_OPENCODE_MODEL 覆盖原生 opencode 候选',
  )
  // 去重：selection 与 opencode 候选相同
  const deduped = makeCandidatePolicy({
    getProviders: () => ['opencode-go'],
    getSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }),
  }).resolveCandidates('mood')
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].provider, 'opencode-go')
  // v1.43：dsh 候选带 token 下限（四角色），deepseek 候选不带；helper 只抬上限
  for (const role of MODEL_POLICY_ROLES) {
    const first = unknown.resolveCandidates(role)[0]
    assert.equal(first.provider, MODEL_POLICY_DSH_OPENCODE_PROVIDER)
    assert.equal(first.maxTokensFloor, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS[role])
    assert.equal('maxTokensFloor' in unknown.resolveCandidates(role)[1], false)
  }
  assert.equal(resolveCandidateMaxTokens(220, { maxTokensFloor: 1600 }), 1600)
  assert.equal(resolveCandidateMaxTokens(220, { maxTokensFloor: 100 }), 220)
  assert.equal(resolveCandidateMaxTokens(220, null), 220)
  assert.equal(resolveCandidateMaxTokens(220, undefined), 220)

  // 非法 role / 全缺失
  assert.deepEqual(unknown.resolveCandidates('unknown'), [])
  const none = createModelPolicy({ env: {}, getSelection: () => null, getProviders: () => [] })
  assert.deepEqual(none.resolveCandidates('mood'), [])
})

test('model-policy M51：四服务首候选失败（未产出文本）→ 回落第二候选并记录实际 model', async () => {
  const policy = makeCandidatePolicy({ getProviders: () => ['opencode-go'] })

  // mood
  const moodLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '一切顺利', energy: 80 }),
  })
  const mood = makeMoodAiHarness({ policy, llm: moodLlm })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, true)
  assert.deepEqual(moodResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' }, '实际回落的 provider/model')
  assert.deepEqual(moodLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(moodLlm.calls[0].reasoningEffort, undefined, 'opencode 不传显式 effort')
  assert.equal(moodLlm.calls[1].reasoningEffort, 'low')

  // selfTalk
  const talkLlm = makeFailoverLlm({ successText: SELF_TALK_LINES_A.join('\n') })
  const talk = makeSelfTalkHarness({ policy, llm: talkLlm })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, true)
  assert.deepEqual(talkResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.deepEqual(talkLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(talkLlm.calls[0].reasoningEffort, undefined)
  assert.equal(talkLlm.calls[1].reasoningEffort, 'high')

  // growth（reflect）
  const growthLlm = makeFailoverLlm({ successText: JSON.stringify({ thought: '安静地接着自己上一次的念头想一想。' }) })
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm })
  const growthResult = await growthHarness.growth.reflectNow()
  assert.equal(growthResult.ok, true)
  assert.deepEqual(growthLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(growthLlm.calls[0].reasoningEffort, undefined)
  assert.equal(growthLlm.calls[1].reasoningEffort, 'high')

  // voice（refresh）
  const voiceDir = makeTmpDir('dshp-candidates-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeFailoverLlm({
    successText: JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }),
  })
  const voice = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  const voiceResult = await voice.refreshNow()
  assert.equal(voiceResult.ok, true)
  assert.deepEqual(voiceLlm.calls.map((call) => call.provider), ['opencode-go', 'deepseek-account'])
  assert.equal(voiceLlm.calls[0].reasoningEffort, undefined)
  assert.equal(voiceLlm.calls[1].reasoningEffort, 'high')
})

test('model-policy M51：候选已产出部分文本后失败 → 不重试（避免串话）；空输出/首候选超时仍可回落', async () => {
  const policy = makeCandidatePolicy({ getProviders: () => ['opencode-go'] })

  // mood：首个候选已输出部分文本后抛错 → 不尝试第二候选
  const partialLlm = makeFailoverLlm({ partialProvider: 'opencode-go', successText: 'ignored' })
  const mood = makeMoodAiHarness({ policy, llm: partialLlm })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, false)
  assert.equal(partialLlm.calls.length, 1, '部分输出失败不重试')

  // selfTalk：同样不重试
  const talkPartial = makeFailoverLlm({ partialProvider: 'opencode-go', successText: 'ignored' })
  const talk = makeSelfTalkHarness({ policy, llm: talkPartial })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, false)
  assert.equal(talkPartial.calls.length, 1)

  // mood：首候选超时（未产出文本）→ 回落第二候选成功
  const timeoutLlm = makeFailoverLlm({
    timeoutProvider: 'opencode-go',
    successText: JSON.stringify({ label: '放松', image: 'dsh-whale-state-happy.webp', reason: '慢下来了', energy: 50 }),
  })
  const timeoutPolicy = makeCandidatePolicy({ getProviders: () => ['opencode-go'] })
  const timeoutHarness = makeMoodAiHarness({ policy: timeoutPolicy, llm: timeoutLlm, timeoutMs: 40 })
  const timeoutResult = await timeoutHarness.service.generate({}, { force: true })
  assert.equal(timeoutResult.ok, true)
  assert.equal(timeoutLlm.calls.length, 2, '首候选超时后尝试第二候选')
  assert.deepEqual(timeoutResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
})

// ---------------------------------------------------------------------------
// M52：opencode-go 400 修复（opencode 候选请求不带 temperature）
// ---------------------------------------------------------------------------

test('model-policy M52：opencode 候选 omitTemperature，deepseek 候选保持温度', () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const candidates = policy.resolveCandidates('mood')
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].provider, 'opencode-go')
  assert.equal(candidates[0].omitTemperature, true)
  assert.equal(candidates[1].provider, 'deepseek-account')
  assert.equal('omitTemperature' in candidates[1], false, 'deepseek 候选不 omit')
  // 显式覆盖 opencode provider 也会带 omitTemperature 语义（provider 判断兜底）
  const explicit = createModelPolicy({
    env: { DSH_POETRY_MODEL_PROVIDER: 'opencode-go', DSH_POETRY_MODEL: 'deepseek-v4.1-flash' },
    getSelection: () => null,
    getProviders: () => [],
  })
  assert.equal(explicit.resolveCandidates('mood')[0].provider, 'opencode-go')
})

test('model-policy M52：四服务 opencode 候选不带 temperature，deepseek 候选带温度', async () => {
  const opencodePolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const deepseekPolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => [],
  })

  // mood
  const moodOpencode = makeMoodAiHarness({ policy: opencodePolicy })
  await moodOpencode.service.generate({}, { force: true })
  assert.equal('temperature' in moodOpencode.llm.calls[0], false, 'opencode 不带 temperature')
  assert.equal(moodOpencode.llm.calls[0].provider, 'opencode-go')
  const moodDeepseek = makeMoodAiHarness({ policy: deepseekPolicy })
  await moodDeepseek.service.generate({}, { force: true })
  assert.equal(moodDeepseek.llm.calls[0].temperature, 1.05)

  // selfTalk
  const talkOpencode = makeSelfTalkHarness({ policy: opencodePolicy })
  await talkOpencode.service.generate({})
  assert.equal('temperature' in talkOpencode.llm.calls[0], false)
  const talkDeepseek = makeSelfTalkHarness({ policy: deepseekPolicy })
  await talkDeepseek.service.generate({})
  assert.equal(talkDeepseek.llm.calls[0].temperature, 1.0)

  // growth（reflect）
  const growthOpencodeLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthOpencode = makeGrowthHarness({ policy: opencodePolicy, llm: growthOpencodeLlm })
  assert.equal((await growthOpencode.growth.reflectNow()).ok, true)
  assert.equal('temperature' in growthOpencodeLlm.calls[0], false)
  const growthDeepseekLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthDeepseek = makeGrowthHarness({ policy: deepseekPolicy, llm: growthDeepseekLlm })
  assert.equal((await growthDeepseek.growth.reflectNow()).ok, true)
  assert.equal(growthDeepseekLlm.calls[0].temperature, 0.9)

  // voice
  const voiceDir = makeTmpDir('dshp-m52-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceOpencode = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: opencodePolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-open.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceOpencode.refreshNow()).ok, true)
  assert.equal('temperature' in voiceLlm.calls[0], false)

  const voiceLlm2 = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceDeepseek = createVoiceService({
    llm: voiceLlm2,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: deepseekPolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-deep.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceDeepseek.refreshNow()).ok, true)
  assert.equal(voiceLlm2.calls[0].temperature, 0.8)
})

test('model-policy M52：回退第二候选时带 temperature；错误日志含 provider/model/status 不含提示词', async () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const failoverLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落成功', energy: 60 }),
  })
  const mood = makeMoodAiHarness({ policy, llm: failoverLlm })
  const result = await mood.service.generate({}, { force: true })
  assert.equal(result.ok, true)
  assert.equal('temperature' in failoverLlm.calls[0], false, '首候选 opencode 不带温度')
  assert.equal(failoverLlm.calls[1].temperature, 1.05, '回退 deepseek 候选带温度')

  // selfTalk 回退同样
  const talkLlm = makeFailoverLlm({ successText: SELF_TALK_LINES_A.join('\n') })
  const talk = makeSelfTalkHarness({ policy, llm: talkLlm })
  assert.equal((await talk.service.generate({})).ok, true)
  assert.equal('temperature' in talkLlm.calls[0], false)
  assert.equal(talkLlm.calls[1].temperature, 1.0)

  // 错误日志：provider/model/status 可见，且不含 prompt 内容
  const warnings = []
  const errorLlm = {
    calls: [],
    stream(options) {
      this.calls.push(options)
      if (options.provider === 'opencode-go') {
        return (async function* () {
          const error = new Error('Request failed with status code 400')
          error.status = 400
          throw error
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落', energy: 50 }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const catalog = makeMoodCatalogFixture()
  const service = createMoodAiService({
    llm: errorLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    catalog,
    now: () => FIXED_NOW.getTime(),
    timeoutMs: 300,
    cacheTtlMs: 0,
    minIntervalMs: 0,
    policy,
    logger: { warn: (message) => warnings.push(String(message)) },
  })
  const logged = await service.generate({}, { force: true })
  assert.equal(logged.ok, true, '400 后回退成功')
  const statusWarning = warnings.find((message) => message.includes('opencode-go') && message.includes('400'))
  assert.ok(statusWarning, `应有 provider/model/status 日志，实际：${warnings.join(' | ')}`)
  assert.match(statusWarning, /opencode-go\/deepseek-v4\.1-flash/)
  assert.equal(statusWarning.includes('心情图鉴'), false, '日志不含提示词内容')
})

// ---------------------------------------------------------------------------
// M53：OpenCode 400 继续修复（不发显式 reasoningEffort + 模型错误诊断落盘）
// ---------------------------------------------------------------------------

function makeErrorPath(dir, name = 'model-errors.jsonl') {
  return path.join(dir, name)
}

test('model-policy M53：opencode 候选既无 temperature 也无 reasoningEffort；deepseek 两者都有（四服务）', async () => {
  const opencodePolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const deepseekPolicy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => [],
  })

  // mood
  const moodOpen = makeMoodAiHarness({ policy: opencodePolicy })
  await moodOpen.service.generate({}, { force: true })
  assert.equal('temperature' in moodOpen.llm.calls[0], false)
  assert.equal('reasoningEffort' in moodOpen.llm.calls[0], false)
  const moodDeep = makeMoodAiHarness({ policy: deepseekPolicy })
  await moodDeep.service.generate({}, { force: true })
  assert.equal(moodDeep.llm.calls[0].temperature, 1.05)
  assert.equal(moodDeep.llm.calls[0].reasoningEffort, 'low')

  // selfTalk
  const talkOpen = makeSelfTalkHarness({ policy: opencodePolicy })
  await talkOpen.service.generate({})
  assert.equal('temperature' in talkOpen.llm.calls[0], false)
  assert.equal('reasoningEffort' in talkOpen.llm.calls[0], false)
  const talkDeep = makeSelfTalkHarness({ policy: deepseekPolicy })
  await talkDeep.service.generate({})
  assert.equal(talkDeep.llm.calls[0].temperature, 1.0)
  assert.equal(talkDeep.llm.calls[0].reasoningEffort, 'high')

  // growth
  const growthOpenLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthOpen = makeGrowthHarness({ policy: opencodePolicy, llm: growthOpenLlm })
  assert.equal((await growthOpen.growth.reflectNow()).ok, true)
  assert.equal('temperature' in growthOpenLlm.calls[0], false)
  assert.equal('reasoningEffort' in growthOpenLlm.calls[0], false)
  const growthDeepLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthDeep = makeGrowthHarness({ policy: deepseekPolicy, llm: growthDeepLlm })
  assert.equal((await growthDeep.growth.reflectNow()).ok, true)
  assert.equal(growthDeepLlm.calls[0].temperature, 0.9)
  assert.equal(growthDeepLlm.calls[0].reasoningEffort, 'high')

  // voice
  const voiceDir = makeTmpDir('dshp-m53-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const openLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceOpen = createVoiceService({
    llm: openLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: opencodePolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-open.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceOpen.refreshNow()).ok, true)
  assert.equal('temperature' in openLlm.calls[0], false)
  assert.equal('reasoningEffort' in openLlm.calls[0], false)
  const deepLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voiceDeep = createVoiceService({
    llm: deepLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy: deepseekPolicy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice-deep.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceDeep.refreshNow()).ok, true)
  assert.equal(deepLlm.calls[0].temperature, 0.8)
  assert.equal(deepLlm.calls[0].reasoningEffort, 'high')

  // 回退第二候选时 deepseek 两者都有
  const failoverLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落', energy: 60 }),
  })
  const moodFallback = makeMoodAiHarness({ policy: opencodePolicy, llm: failoverLlm })
  assert.equal((await moodFallback.service.generate({}, { force: true })).ok, true)
  assert.equal('temperature' in failoverLlm.calls[0], false)
  assert.equal('reasoningEffort' in failoverLlm.calls[0], false)
  assert.equal(failoverLlm.calls[1].temperature, 1.05)
  assert.equal(failoverLlm.calls[1].reasoningEffort, 'low')
})

test('model-errors M53：落盘字段/截断/200 行/不含 prompt；四服务各写一条', async () => {
  assert.equal(
    resolveModelErrorsPath({ DSH_HOME: '/tmp/dsh-home' }, '/Users/alice'),
    '/tmp/dsh-home/.dsh-poetry/model-errors.jsonl',
  )
  const dir = makeTmpDir('dshp-model-errors')
  const file = makeErrorPath(dir)

  // 字段与截断（message >500）
  const longMessage = 'x'.repeat(800)
  const record = buildModelErrorRecord({
    role: 'mood',
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    error: { status: 400, code: 'INVALID_REQUEST', message: longMessage },
    request: { hasTemperature: false, reasoningEffort: null, maxTokens: 400, systemChars: 123, promptChars: 456, messagesCount: 1 },
    now: 1700000000000,
  })
  assert.equal(record.at, 1700000000000)
  assert.equal(record.status, 400)
  assert.equal(record.code, 'INVALID_REQUEST')
  assert.ok(Array.from(record.message).length <= MODEL_ERRORS_MESSAGE_MAX)
  assert.equal(Array.from(record.message).length, MODEL_ERRORS_MESSAGE_MAX)
  assert.equal(JSON.stringify(record).includes('content'), false)
  appendModelError(file, record)

  // 超 200 行 → 只保留最近 200
  for (let index = 0; index < MODEL_ERRORS_MAX_LINES + 5; index += 1) {
    appendModelError(file, { ...record, at: 1700000000001 + index })
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, MODEL_ERRORS_MAX_LINES)
  assert.equal(JSON.parse(lines.at(-1)).at, 1700000000001 + MODEL_ERRORS_MAX_LINES + 4)
  assert.equal(readModelErrors(file, 20).length, 20)

  // 四服务覆盖：opencode 首候选 400 失败 → 各写一条（然后回退成功）
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['opencode-go'],
  })
  const serviceDir = makeTmpDir('dshp-model-errors-services')
  const moodPath = makeErrorPath(serviceDir, 'mood.jsonl')
  const moodLlm = makeFailoverLlm({
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: '回落', energy: 60 }),
  })
  // makeFailoverLlm 抛普通 Error；包一层带 status=400 便于断言
  const moodLlm400 = {
    calls: moodLlm.calls,
    stream(options) {
      if (options.provider === 'opencode-go') {
        moodLlm.calls.push(options)
        return (async function* () {
          const error = new Error('Request failed with status code 400')
          error.status = 400
          throw error
        })()
      }
      return moodLlm.stream(options)
    },
  }
  const moodHarness = makeMoodAiHarness({ policy, llm: moodLlm400, modelErrorsPath: moodPath })
  assert.equal((await moodHarness.service.generate({}, { force: true })).ok, true)

  const talkPath = makeErrorPath(serviceDir, 'talk.jsonl')
  const talkLlm = makeFailoverLlm({ successText: SELF_TALK_LINES_A.join('\n') })
  const talkHarness = makeSelfTalkHarness({ policy, llm: talkLlm, modelErrorsPath: talkPath })
  assert.equal((await talkHarness.service.generate({})).ok, true)

  const growthPath = makeErrorPath(serviceDir, 'growth.jsonl')
  const growthLlm = makeFailoverLlm({ successText: JSON.stringify({ thought: '安静地接着自己的想法。' }) })
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm, modelErrorsPath: growthPath })
  assert.equal((await growthHarness.growth.reflectNow()).ok, true)

  const voicePath = path.join(serviceDir, 'voice.jsonl')
  const voiceJournal = writeRecallJournal(path.join(serviceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeFailoverLlm({ successText: JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }) })
  const voiceService = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy,
    journalPath: voiceJournal,
    voicePath: path.join(serviceDir, 'voice-profile.json'),
    modelErrorsPath: voicePath,
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voiceService.refreshNow()).ok, true)

  for (const [role, rolePath] of [
    ['mood', moodPath],
    ['selfTalk', talkPath],
    ['growth', growthPath],
    ['voice', voicePath],
  ]) {
    const records = readModelErrors(rolePath, 5)
    assert.equal(records.length, 1, `${role} 应写一条候选失败`)
    const item = records[0]
    assert.equal(item.role, role)
    assert.equal(item.provider, 'opencode-go')
    assert.equal(item.model, 'deepseek-v4.1-flash')
    if (role === 'mood') {
      assert.equal(item.status, 400)
      assert.match(item.message, /400/)
    } else {
      assert.equal(item.status, undefined, '其它服务 mock 错误无 status（status 可选）')
      assert.match(item.message, /unavailable|failed/)
    }
    assert.equal(item.request.hasTemperature, false)
    assert.equal(item.request.reasoningEffort, null)
    assert.ok(item.request.maxTokens > 0)
    assert.ok(item.request.systemChars > 0)
    assert.ok(item.request.promptChars > 0)
    assert.equal(item.request.messagesCount, 1)
    const raw = fs.readFileSync(rolePath, 'utf8')
    assert.equal(raw.includes('心情图鉴'), false, '不含提示词')
    assert.equal(raw.includes('"content"'), false, '不含 messages 正文')
  }
})

test('model-errors M53：只读路由 GET/HEAD/405（最近 20 条，无敏感内容）', async () => {
  const dir = makeTmpDir('dshp-model-errors-route')
  const file = makeErrorPath(dir)
  for (let index = 0; index < 25; index += 1) {
    appendModelError(file, {
      at: 1700000000000 + index,
      role: 'mood',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      status: 400,
      message: `失败 ${index}`,
      request: { hasTemperature: false, reasoningEffort: null, maxTokens: 400, systemChars: 10, promptChars: 20, messagesCount: 1 },
    })
  }
  assert.equal(MODEL_ERRORS_ROUTE, '/api/dsh-poetry/model-errors.json')
  const handler = createModelErrorsHandler({ file, limit: 20 })
  const response = new MockResponse()
  await handler(mockRequest({ url: MODEL_ERRORS_ROUTE }), response)
  await response.finished()
  const body = response.json()
  assert.equal(response.statusCode, 200)
  assert.equal(body.ok, true)
  assert.equal(body.errors.length, 20)
  assert.equal(body.errors[0].message, '失败 5')
  assert.equal(body.errors.at(-1).message, '失败 24')
  assert.equal(JSON.stringify(body).includes('"content"'), false)

  const head = new MockResponse()
  await handler(mockRequest({ method: 'HEAD', url: MODEL_ERRORS_ROUTE }), head)
  await head.finished()
  assert.equal(head.bodyText, '')

  const post = new MockResponse()
  await handler(mockRequest({ method: 'POST', url: MODEL_ERRORS_ROUTE }), post)
  await post.finished()
  assert.equal(post.statusCode, 405)
})

// ---------------------------------------------------------------------------
// M54：模型候选切到 dsh-opencode-go（新适配器优先）
// ---------------------------------------------------------------------------

function makeChainLlm({ failProviders = [], successText }) {
  const calls = []
  const llm = {
    calls,
    stream(options) {
      calls.push(options)
      if (failProviders.includes(options.provider)) {
        return (async function* () {
          throw new Error(`provider ${options.provider} unavailable before any text`)
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: successText }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  return llm
}

test('model-policy M54：候选顺序 dsh-opencode-go → deepseek-account（原生 opencode 仅在 dsh 缺失时回退；探测/关闭/覆盖/去重）', () => {
  const allProviders = () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account']
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: allProviders,
  })
  const candidates = policy.resolveCandidates('mood')
  assert.equal(candidates.length, 2)
  assert.deepEqual(candidates[0], {
    provider: MODEL_POLICY_DSH_OPENCODE_PROVIDER,
    model: MODEL_POLICY_DSH_OPENCODE_DEFAULT_MODEL,
    reasoningEffort: 'low',
    omitTemperature: true,
    maxTokensFloor: MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood,
  })
  assert.equal('omitReasoningEffort' in candidates[0], false, 'dsh 适配器保留 reasoningEffort')
  assert.deepEqual(candidates[1], { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' })
  assert.equal(candidates[0].reasoningEffort, 'low')
  assert.equal(candidates[1].reasoningEffort, 'low')
  assert.equal(policy.resolve('selfTalk').reasoningEffort, 'high')
  assert.equal(policy.resolve('growth').reasoningEffort, 'high')
  assert.equal(policy.resolve('voice').reasoningEffort, 'high')

  // env 覆盖 dsh 模型
  const customDsh = createModelPolicy({
    env: { DSH_POETRY_DSH_OPENCODE_MODEL: 'custom-dsh-model' },
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: allProviders,
  })
  assert.equal(customDsh.resolveCandidates('mood')[0].model, 'custom-dsh-model')

  // 探测：只有 dsh / 只有原生 / 都没有
  assert.deepEqual(
    createModelPolicy({
      env: {},
      getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
      getProviders: () => ['dsh-opencode-go'],
    })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['dsh-opencode-go', 'deepseek-account'],
  )
  assert.deepEqual(
    createModelPolicy({
      env: {},
      getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
      getProviders: () => ['opencode-go'],
    })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['opencode-go', 'deepseek-account'],
  )
  assert.deepEqual(
    createModelPolicy({
      env: {},
      getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
      getProviders: () => [],
    })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['deepseek-account'],
  )
  // 无法探测 → dsh + selection（不再叠加原生 opencode）
  assert.deepEqual(
    createModelPolicy({ env: {}, getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) })
      .resolveCandidates('mood')
      .map((c) => c.provider),
    ['dsh-opencode-go', 'deepseek-account'],
  )

  // 关闭开关 → 只 selection
  for (const env of [{ DSH_POETRY_OPENCODE_GO: '0' }, { DSH_POETRY_MODEL_PRIORITY: 'deepseek-account' }]) {
    assert.deepEqual(
      createModelPolicy({
        env,
        getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
        getProviders: allProviders,
      })
        .resolveCandidates('mood')
        .map((c) => c.provider),
      ['deepseek-account'],
    )
  }
  // 显式覆盖 → 单候选
  assert.deepEqual(
    createModelPolicy({
      env: { DSH_POETRY_MODEL_PROVIDER: 'custom-p', DSH_POETRY_MODEL: 'custom-m' },
      getSelection: allProviders,
      getProviders: allProviders,
    }).resolveCandidates('mood'),
    [{ provider: 'custom-p', model: 'custom-m', reasoningEffort: 'low' }],
  )
  // 去重：selection 与 dsh 相同
  const deduped = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' }),
    getProviders: () => ['dsh-opencode-go'],
  }).resolveCandidates('mood')
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].provider, 'dsh-opencode-go')

  // describe 显示候选顺序
  const described = describeModelPolicy(policy)
  assert.match(described, /心情=dsh-opencode-go\/deepseek-v4\.1-flash\(low\) → deepseek-account\/deepseek-flash\(low\)/)
})

test('model-policy M55：宿主默认指向原生 opencode-go（缺会话头必然 400）→ 换 deepseek 账号兜底', () => {
  const brokenSelection = () => ({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' })
  assert.deepEqual(MODEL_POLICY_SAFE_FALLBACK, { provider: 'deepseek-account', model: 'deepseek-flash' })

  // dsh 可用：候选 = dsh → deepseek-account/deepseek-flash（原生 400 不进链）
  const withDsh = createModelPolicy({
    env: {},
    getSelection: brokenSelection,
    getProviders: () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account'],
  }).resolveCandidates('growth')
  assert.deepEqual(
    withDsh.map((c) => `${c.provider}/${c.model}`),
    ['dsh-opencode-go/deepseek-v4.1-flash', 'deepseek-account/deepseek-flash'],
  )
  assert.equal(withDsh[1].reasoningEffort, 'high')
  assert.equal('maxTokensFloor' in withDsh[1], false)

  // dsh 不可用（仅原生）：保留宿主选择（用户显式配置），不强行替换
  const nativeOnly = createModelPolicy({
    env: {},
    getSelection: brokenSelection,
    getProviders: () => ['opencode-go'],
  }).resolveCandidates('mood')
  assert.deepEqual(nativeOnly.map((c) => c.provider), ['opencode-go'])
  assert.equal(nativeOnly[0].model, 'deepseek-v4.1-flash')

  // 显式关闭 opencode 订阅：同样保留宿主选择
  const disabled = createModelPolicy({
    env: { DSH_POETRY_OPENCODE_GO: '0' },
    getSelection: brokenSelection,
    getProviders: () => ['dsh-opencode-go', 'opencode-go'],
  }).resolveCandidates('mood')
  assert.deepEqual(disabled.map((c) => c.provider), ['opencode-go'])
})

test('model-policy M54：四服务 dsh 候选不发 temperature、发 reasoningEffort；响应 model 为 dsh', async () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['dsh-opencode-go', 'opencode-go'],
  })

  // mood
  const mood = makeMoodAiHarness({ policy })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, true)
  assert.deepEqual(moodResult.model, { provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' })
  assert.equal('temperature' in mood.llm.calls[0], false)
  assert.equal(mood.llm.calls[0].reasoningEffort, 'low')
  assert.equal(mood.llm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood)

  // selfTalk
  const talk = makeSelfTalkHarness({ policy })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, true)
  assert.deepEqual(talkResult.model, { provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash' })
  assert.equal('temperature' in talk.llm.calls[0], false)
  assert.equal(talk.llm.calls[0].reasoningEffort, 'high')
  assert.equal(talk.llm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.selfTalk)

  // growth
  const growthLlm = makeGrowthLlm([JSON.stringify({ thought: '安静地想一想今天的事情。' })])
  const growthHarness = makeGrowthHarness({ policy, llm: growthLlm })
  assert.equal((await growthHarness.growth.reflectNow()).ok, true)
  assert.equal('temperature' in growthLlm.calls[0], false)
  assert.equal(growthLlm.calls[0].reasoningEffort, 'high')
  assert.equal(growthLlm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.growth)

  // voice
  const voiceDir = makeTmpDir('dshp-m54-voice')
  const journalPath = writeRecallJournal(path.join(voiceDir, 'journal.jsonl'), [
    { kind: 'thought', text: '一句话。' },
    { kind: 'murmur', text: '第二句话。' },
    { kind: 'thought', text: '第三句话。' },
  ])
  const voiceLlm = makeMockLlm(() => JSON.stringify({ profile: makeLongVoiceProfile(), exemplars: ['a', 'b', 'c'] }))
  const voice = createVoiceService({
    llm: voiceLlm,
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    policy,
    journalPath,
    voicePath: path.join(voiceDir, 'voice.json'),
    logger: { warn() {} },
    timeoutMs: 300,
  })
  assert.equal((await voice.refreshNow()).ok, true)
  assert.equal('temperature' in voiceLlm.calls[0], false)
  assert.equal(voiceLlm.calls[0].reasoningEffort, 'high')
  assert.equal(voiceLlm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.voice)
})

test('model-policy M54：dsh 失败（未产出文本）→ deepseek；原生 opencode 不参与，token 下限正确', async () => {
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['dsh-opencode-go', 'opencode-go', 'deepseek-account'],
  })
  // 原生 opencode-go 在 dsh 可用时已不进候选链；即便它“失败”也不会被调用。
  const failProviders = ['dsh-opencode-go', 'opencode-go']

  // mood：dsh → deepseek
  const moodLlm = makeChainLlm({
    failProviders,
    successText: JSON.stringify({ label: '开心', image: 'dsh-whale-state-happy.webp', reason: 'deepseek 回落', energy: 60 }),
  })
  const mood = makeMoodAiHarness({ policy, llm: moodLlm })
  const moodResult = await mood.service.generate({}, { force: true })
  assert.equal(moodResult.ok, true)
  assert.deepEqual(moodLlm.calls.map((call) => call.provider), ['dsh-opencode-go', 'deepseek-account'])
  assert.equal('temperature' in moodLlm.calls[0], false)
  assert.equal(moodLlm.calls[0].reasoningEffort, 'low', 'dsh 候选保留 effort')
  assert.equal(
    moodLlm.calls[0].maxTokens,
    MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.mood,
    'dsh 候选抬 token 下限（thinking 常开，防 EMPTY_RESPONSE）',
  )
  assert.equal(moodLlm.calls[1].temperature, 1.05)
  assert.equal(moodLlm.calls[1].reasoningEffort, 'low')
  assert.equal(moodLlm.calls[1].maxTokens, 220, 'deepseek 候选保持角色预算')
  assert.deepEqual(moodResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })

  // selfTalk：dsh → deepseek
  const talkLlm = makeChainLlm({ failProviders, successText: SELF_TALK_LINES_A.join('\n') })
  const talk = makeSelfTalkHarness({ policy, llm: talkLlm })
  const talkResult = await talk.service.generate({})
  assert.equal(talkResult.ok, true)
  assert.deepEqual(talkLlm.calls.map((call) => call.provider), ['dsh-opencode-go', 'deepseek-account'])
  assert.equal(talkLlm.calls[0].reasoningEffort, 'high')
  assert.equal('temperature' in talkLlm.calls[0], false)
  assert.equal(talkLlm.calls[0].maxTokens, MODEL_POLICY_DSH_OPENCODE_MAX_TOKENS_FLOORS.selfTalk)
  assert.equal(talkLlm.calls[1].temperature, 1.0)
  assert.equal(talkLlm.calls[1].reasoningEffort, 'high')
  assert.equal(talkLlm.calls[1].maxTokens, 200)
  assert.deepEqual(talkResult.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
})

// ---------------------------------------------------------------------------
// 静态资源路由
// ---------------------------------------------------------------------------

test('assets：路径解析防护', () => {
  const root = path.resolve('/tmp/assets-root')
  assert.equal(resolveAssetPath(root, 'icon.webp'), path.join(root, 'icon.webp'))
  assert.equal(resolveAssetPath(root, 'sub/../icon.webp'), path.join(root, 'icon.webp'))
  assert.equal(resolveAssetPath(root, '../secret.txt'), null)
  assert.equal(resolveAssetPath(root, 'sub/../../secret.txt'), null)
  assert.equal(resolveAssetPath(root, ''), null)
  assert.equal(resolveAssetPath(root, '.hidden'), null)
  assert.equal(resolveAssetPath(root, 'a\0b'), null)
  assert.equal(resolveAssetPath(root, 'a\\b'), null)
})

test('assets：200 + MIME + Cache-Control，404 越界/缺失，405 非 GET', async () => {
  const assetsDir = makeTmpDir('dshp-assets')
  fs.mkdirSync(path.join(assetsDir, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(assetsDir, 'icon.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]))
  fs.writeFileSync(path.join(assetsDir, 'sub', 'app.css'), 'body{}')
  fs.writeFileSync(path.join(assetsDir, '.hidden'), 'secret')
  const handler = createAssetHandler({ assetsDir })

  async function call({ method = 'GET', url }) {
    const response = new MockResponse()
    await handler(mockRequest({ method, url }), response)
    await response.finished()
    return response
  }

  const ok = await call({ url: '/api/dsh-poetry/assets?f=icon.webp' })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.headers['Content-Type'], 'image/webp')
  assert.equal(ok.headers['Cache-Control'], 'public, max-age=3600')
  assert.equal(ok.bodyText, 'RIFF')

  const css = await call({ url: '/api/dsh-poetry/assets?f=sub/app.css' })
  assert.equal(css.statusCode, 200)
  assert.equal(css.headers['Content-Type'], 'text/css; charset=utf-8')

  for (const url of [
    '/api/dsh-poetry/assets?f=../secret.txt',
    '/api/dsh-poetry/assets?f=%2e%2e%2fsecret.txt',
    '/api/dsh-poetry/assets?f=missing.webp',
    '/api/dsh-poetry/assets?f=.hidden',
    '/api/dsh-poetry/assets',
  ]) {
    const response = await call({ url })
    assert.equal(response.statusCode, 404, url)
  }

  const wrongMethod = await call({ method: 'POST', url: '/api/dsh-poetry/assets?f=icon.webp' })
  assert.equal(wrongMethod.statusCode, 405)
})
