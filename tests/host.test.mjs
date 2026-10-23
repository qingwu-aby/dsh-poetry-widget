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
  MEMORY_JOURNAL_HEADER,
  createMemoryJournal,
  formatJournalTime,
  resolveMemoryDir,
} from '../lib/memory-journal.mjs'
import {
  MOOD_AI_CACHE_TTL_MS,
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
  SELF_TALK_SYSTEM_PROMPT,
  buildSelfTalkPrompt,
  createSelfTalkService,
  parseRecentQuery,
  parseSelfTalkLines,
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
  const llm = makeMockLlm(overrides.responder ?? (() => SELF_TALK_LINES_A.join('\n')))
  const service = createSelfTalkService({
    llm,
    getSelection: overrides.getSelection ?? (() => SELF_TALK_SELECTION),
    now: () => state.clock,
    minIntervalMs: overrides.minIntervalMs ?? 0,
    timeoutMs: overrides.timeoutMs ?? 300,
    logger: { warn() {} },
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

    assert.equal(routes.length, 15, 'assets + pet-media + 13 条 JSON 路由')
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

test('self-talk：parseRecentQuery（| 分隔 / ≤5 条 / 长度上限）', () => {
  assert.deepEqual(parseRecentQuery('甲|乙|丙|丁|戊|己|庚'), ['甲', '乙', '丙', '丁', '戊'])
  assert.deepEqual(parseRecentQuery('a|a|b'), ['a', 'b'])
  assert.deepEqual(parseRecentQuery(''), [])
  assert.deepEqual(parseRecentQuery(null), [])
  const long = parseRecentQuery('x'.repeat(600))
  assert.equal(long.length, 1)
  assert.ok(Array.from(long[0]).length <= 80, '单条被截断到安全长度')
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
  assert.equal(result.lines.length, 2)
  assert.deepEqual(result.lines.map((line) => line.text), SELF_TALK_LINES_A)
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
  assert.equal(options.temperature, 0.95)
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
  assert.deepEqual(result.lines.map((line) => line.text), SELF_TALK_LINES_A)
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
  assert.deepEqual(third.lines.map((line) => line.text), SELF_TALK_LINES_B)
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
  assert.equal(body.lines.length, 2)
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
  assert.ok(recentLines.length <= 5, 'recent 最多 5 条')
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
  const journal = createMemoryJournal({ dir, now: () => ts, logger: { warn() {} } })
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
  assert.equal(entries.length, SELF_TALK_LINES_A.length, '批次 2 句 → 2 条 murmur')
  for (const entry of entries) {
    assert.equal(entry.kind, 'murmur')
    assert.deepEqual(entry.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
  }
  assert.deepEqual(entries.map((entry) => entry.text), SELF_TALK_LINES_A)
  const md = fs.readFileSync(path.join(harness.journalDir, 'journal.md'), 'utf8')
  assert.match(md, /· 碎碎念/)
  assert.equal(`${md}${JSON.stringify(entries)}`.includes(sensitive), false, 'query 里的 recent 不得写入记忆')
  assert.equal(`${md}${JSON.stringify(entries)}`.includes('rain'), false, 'query 里的 weather 不得写入记忆')

  // 3s 内再次请求 → cached:true，不重复写
  const second = await harness.call('self-talk.json', mockRequest({ url }))
  assert.equal(second.json().cached, true)
  entries = readJournalJsonl(harness.journalDir)
  assert.equal(entries.length, SELF_TALK_LINES_A.length, 'cached 不重复写')
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

  // force 新生成 → 再写一条
  const forced = await harness.call('mood-ai.json', mockRequest({ url: `${url}&force=1` }))
  assert.equal(forced.json().cached, false)
  assert.equal(readJournalJsonl(harness.journalDir).length, 2)

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
    assert.deepEqual(entries.map((entry) => entry.kind), ['murmur', 'murmur', 'mood'])
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
    assert.equal(routes.length, 15, 'assets + pet-media + 13 条 JSON')
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

test('mood-ai：被排除的最近图若被模型返回则 parse 失败；未排除图正常', () => {
  const big = makeMoodCatalogBig(30)
  const plan = resolveMoodCandidates(big, ['img-0.webp', 'img-1.webp'], { random: seededRandom(9) })
  const excluded = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'img-0.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(excluded.ok, false)
  assert.match(excluded.message, /最近用过/)

  const allowed = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'img-2.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21', excludedImages: plan.excludedFiles },
  )
  assert.equal(allowed.ok, true)
  assert.equal(allowed.mood.image, 'img-2.webp')

  // 不传 excludedImages（旧调用方）时仍按图鉴校验
  const legacy = parseMoodResult(
    JSON.stringify({ label: '开心', image: 'img-0.webp', reason: '理由足够长', energy: 50 }),
    big,
    { dateKey: '2026-10-21' },
  )
  assert.equal(legacy.ok, true)
})

test('mood-ai 服务：模型返回被排除的最近图 → MOOD_AI_UNAVAILABLE（强制轮换）', async () => {
  const big = makeMoodCatalogBig(30)
  const { service } = makeMoodAiHarness({
    catalog: big,
    responder: () => JSON.stringify({ label: '开心', image: 'img-0.webp', reason: '理由足够长', energy: 50 }),
  })
  const rejected = await service.generate({ recentImages: ['img-0.webp'] })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'MOOD_AI_UNAVAILABLE')

  const other = makeMoodAiHarness({
    catalog: big,
    responder: () => JSON.stringify({ label: '开心', image: 'img-5.webp', reason: '理由足够长', energy: 50 }),
  })
  const accepted = await other.service.generate({ recentImages: ['img-0.webp'] })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.mood.image, 'img-5.webp')
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

test('mood-ai M24：parse 拒绝被排除视频（完整路径或 basename 传入），未排除视频可接受', () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const excludedVideo = 'webm/哈欠连天.webm'
  const make = (image) => JSON.stringify({ label: '好困', image, reason: '理由足够长', energy: 40 })
  const options = { dateKey: '2026-10-21' }

  // 完整 file 传入 excluded
  assert.equal(
    parseMoodResult(make(excludedVideo), catalog, { ...options, excludedImages: new Set([excludedVideo]) }).ok,
    false,
  )
  // basename 传入 excluded 也拒绝
  const baseExcluded = parseMoodResult(make(excludedVideo), catalog, {
    ...options,
    excludedImages: ['哈欠连天.webm'],
  })
  assert.equal(baseExcluded.ok, false)
  assert.match(baseExcluded.message, /最近用过/)

  // 未排除的视频（完整路径 / 模型漏写 webm/ 前缀的 basename）都能解析成完整 file
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

test('mood-ai M24 服务：模型返回近期用过的视频 → 失败（完整路径与 basename 都生效）', async () => {
  const catalog = makeMoodCatalogWithVideos(25)
  const responder = () => JSON.stringify({ label: '好困', image: 'webm/哈欠连天.webm', reason: '理由足够长', energy: 40 })
  const full = makeMoodAiHarness({ catalog, responder })
  const rejectedFull = await full.service.generate({ recentImages: ['webm/哈欠连天.webm'] })
  assert.equal(rejectedFull.ok, false)
  assert.equal(rejectedFull.error.code, 'MOOD_AI_UNAVAILABLE')

  const base = makeMoodAiHarness({ catalog, responder })
  const rejectedBase = await base.service.generate({ recentImages: ['哈欠连天.webm'] })
  assert.equal(rejectedBase.ok, false, 'basename recent 也能阻止重复视频')

  const accepted = makeMoodAiHarness({
    catalog,
    responder: () => JSON.stringify({ label: '饿了', image: 'webm/吃午餐.webm', reason: '理由足够长', energy: 50 }),
  })
  const okResult = await accepted.service.generate({ recentImages: ['webm/哈欠连天.webm'] })
  assert.equal(okResult.ok, true)
  assert.equal(okResult.mood.image, 'webm/吃午餐.webm')
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
