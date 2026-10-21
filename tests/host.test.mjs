// tests/host.test.mjs —— 宿主半区单测（node:test，不依赖真实 DSH 宿主）。
//
// 覆盖：设置校验/clamp/损坏回退/原子写、bootstrap 形状与今日诗确定性、
//       data 缺失/损坏降级、about 脱敏、信任栅栏 403/401、路由 200/400/403/405、静态资源越界防护。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
  MOOD_EVENT_TYPES,
  MOOD_STAT_KEYS,
  applySessionEvent,
  createEmptyMoodState,
  createMoodTracker,
  localDateKey,
  toMoodResponse,
  zeroMoodResponse,
} from '../lib/mood.mjs'

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
  const handlers = new Map(
    createRouteTable({
      dataStore,
      settingsStore,
      fence,
      version,
      settingsFile,
      weatherService,
      moodTracker,
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

  return { dataDir, settingsFile, home, env, dataStore, settingsStore, weatherService, moodTracker, handlers, call }
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
