#!/usr/bin/env node
/**
 * dsh-little-whale 集成验收脚本（Lead 用）。
 *
 * 覆盖：插件包静态结构 → 数据产物契约抽检 → desktop profile 安装态 → 宿主路由存活。
 * 浏览器内的视觉/交互仍需 cordis_inspect_query + 用户确认（脚本不做 DOM 断言）。
 *
 * 用法：
 *   node tests/integration/verify.mjs            # 静态 + profile + 路由
 *   node tests/integration/verify.mjs --settings # 额外做 settings GET/PUT 回环（会写一次当前值）
 *
 * 退出码：0 全过；1 有 FAIL。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = process.env.DSH_WEB_URL || 'http://127.0.0.1:57623'
const PROFILE = path.join(process.env.HOME || '', '.dsh', 'profiles', 'desktop')
const ROUTES = [
  '/api/dsh-poetry/assets?f=mascot-celebrate.webp',
  '/api/dsh-poetry/health.json',
  '/api/dsh-poetry/bootstrap.json',
  '/api/dsh-poetry/poems.json',
  '/api/dsh-poetry/ci.json',
  '/api/dsh-poetry/yun.json',
  '/api/dsh-poetry/knowledge.json',
  '/api/dsh-poetry/settings.json',
  '/api/dsh-poetry/weather.json',
  '/api/dsh-poetry/mood.json',
  '/api/dsh-poetry/self-talk.json',
  '/api/dsh-poetry/mood-ai.json',
  '/api/dsh-poetry/about.json',
]

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`)
}
const warn = (name, detail = '') => {
  results.push({ name, ok: true, warn: true, detail })
  console.log(`WARN  ${name}${detail ? '  —  ' + detail : ''}`)
}
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))
const bytes = (rel) => (exists(rel) ? fs.statSync(path.join(ROOT, rel)).size : 0)
const kb = (n) => (n / 1024).toFixed(1) + ' KB'

// ---------- 1. 包结构 ----------
const pkg = readJson('package.json')
check('package.json name', pkg.name === 'dsh-little-whale', pkg.name)
check('package.json dsh.bundle.patch', pkg?.dsh?.bundle?.patch === './cordis.patch.yml')
check('package.json dsh.client.platform=web', pkg?.dsh?.client?.platform === 'web')
check('dsh.client.inject 含 slots', (pkg?.dsh?.client?.inject || []).includes('slots'))
check('cordis.patch.yml 存在', exists('cordis.patch.yml'))
check('host 入口 index.js', exists('index.js'))
check('client 入口 client.js', exists('client.js'))
const iconPath = pkg.icon ? pkg.icon.replace(/^\.\//, '') : ''
check('插件图标存在且 ≤256KiB', iconPath && exists(iconPath) && bytes(iconPath) <= 256 * 1024, kb(bytes(iconPath)))
for (const loc of ['locale/zh.json', 'locale/en.json']) {
  if (!exists(loc)) { check(loc, false); continue }
  const j = readJson(loc)
  check(`${loc} meta.title/description`, Boolean(j?.meta?.title && j?.meta?.description))
}
check('dsh-plugin.naming.json 存在', exists('dsh-plugin.naming.json'))
check('mascot-celebrate.webp 存在', exists('assets/mascot-celebrate.webp'), kb(bytes('assets/mascot-celebrate.webp')))
// M7：本地立绘（dsh-whale-musume，MIT）
try {
  const genDir = path.join(ROOT, 'assets', 'generated')
  const files = fs.existsSync(genDir) ? fs.readdirSync(genDir).filter((n) => n.endsWith('.webp')) : []
  const total = files.reduce((sum, n) => sum + fs.statSync(path.join(genDir, n)).size, 0)
  check('本地立绘数量 ≥90', files.length >= 90, `${files.length} 张`)
  check('本地立绘总体积 ≤20MB', total <= 20 * 1024 * 1024, kb(total))
  for (const name of ['dsh-whale-state-celebrate.webp', 'dsh-whale-state-weather-umbrella.webp', 'dsh-whale-state-weather-snow.webp', 'dsh-whale-state-night.webp', 'dsh-whale-state-game-win.webp']) {
    check(`立绘存在：${name}`, files.includes(name))
  }
} catch (e) {
  check('扫描本地立绘', false, String(e?.message || e))
}

// ---------- 2. 数据产物 ----------
const dataFiles = {
  'data/manifest.json': 100 * 1024,
  'data/poems.json': 620 * 1024,
  'data/ci.json': 220 * 1024,
  'data/yun.json': 80 * 1024,
  'data/knowledge.json': 90 * 1024,
}
for (const [rel, budget] of Object.entries(dataFiles)) {
  const ok = exists(rel) && bytes(rel) > 0 && bytes(rel) <= budget
  check(`${rel} 体积 ≤ ${kb(budget)}`, ok, kb(bytes(rel)))
}

let manifest = null
if (exists('data/manifest.json')) {
  try {
    manifest = readJson('data/manifest.json')
    check('manifest.dataVersion 形如 YYYY-MM-DD.N', /^\d{4}-\d{2}-\d{2}\.\d+$/.test(manifest?.dataVersion || ''), manifest?.dataVersion)
    check('manifest.source.commit', /^[0-9a-f]{40}$/.test(manifest?.source?.commit || ''))
  } catch (e) {
    check('manifest 可解析', false, String(e?.message || e))
  }
}

if (exists('data/poems.json')) {
  const j = readJson('data/poems.json')
  const items = j.items || []
  check('poems.dataVersion 与 manifest 一致', !manifest || j.dataVersion === manifest.dataVersion, j.dataVersion)
  check('poems 数量 ≥ 30（冒烟）/ 500（最终）', items.length >= 30, String(items.length))
  check('poems ≤ 500', items.length <= 500, String(items.length))
  const cp = (s) => [...s] // 码点长度（含 CJK Ext-B 时不能用 .length）
  const bad = items.filter((p) => {
    if (![4, 8].includes(p.lines?.length)) return '行数'
    if (!p.lines.every((l) => [5, 7].includes(cp(l).filter((c) => !'，。！？；、'.includes(c)).length))) return '字数'
    if (!p.tones || p.tones.length !== p.lines.length) return 'tones 行数'
    if (p.tones.some((t, i) => cp(t).length !== cp(p.lines[i]).length)) return 'tones 等长'
    if (p.tones.some((t) => t.includes('？'))) return '含？'
    if (!['五绝', '七绝', '五律', '七律'].includes(p.form)) return 'form'
    if (!['平起', '仄起'].includes(p.start)) return 'start'
    if (!Array.isArray(p.rhymeIdx) || !p.rhymeIdx.length) return 'rhymeIdx'
    return ''
  })
  check('poems 逐首契约抽检（行数/字数/tones/form/start/rhymeIdx）', bad.length === 0, bad.length ? `${bad.length} 首不合格，例：${JSON.stringify(bad[0]).slice(0, 120)}` : '')
  const authors = new Map()
  for (const p of items) authors.set(p.author, (authors.get(p.author) || 0) + 1)
  const maxAuthor = Math.max(0, ...authors.values())
  const topAuthors = [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, n]) => `${a}×${n}`).join(' / ')
  // 精选选集不设配额（杜甫等名家多首属正常）；仅要求分布不失控。
  check('作者分布合理（单人 ≤40 首）', maxAuthor <= 40, `max=${maxAuthor}（${topAuthors}）`)
  const astral = items.filter((p) => p.lines.some((l) => [...l].some((c) => c.codePointAt(0) > 0xffff)))
  check('无 CJK Ext-B 罕见字（避免字体豆腐块）', astral.length === 0, astral.length ? `${astral.length} 首：${astral.slice(0, 3).map((p) => p.title).join('、')}` : '')
  check('linesOriginal 与 lines 等长（抽检前 20）', items.slice(0, 20).every((p) => (p.linesOriginal || []).length === p.lines.length && p.linesOriginal.every((l, i) => l.length === p.lines[i].length)))
}

if (exists('data/ci.json')) {
  const j = readJson('data/ci.json')
  const items = j.items || []
  check('ci 数量 ≥ 20', items.length >= 20, String(items.length))
  check('ci ≤ 300', items.length <= 300, String(items.length))
  check('ci rhythmic 非空', items.every((c) => c.rhythmic && c.lines?.length))
}

if (exists('data/yun.json')) {
  const j = readJson('data/yun.json')
  const volumes = j.volumes || []
  check('yun 2 卷 × 15 韵部', volumes.length === 2 && volumes.every((v) => v.chapters?.length === 15), volumes.map((v) => v.chapters?.length).join('/'))
}

if (exists('data/knowledge.json')) {
  const j = readJson('data/knowledge.json')
  const cards = j.cards || []
  const ciCards = j.ciCards || []
  check('knowledge cards 12', cards.length === 12, String(cards.length))
  check('knowledge ciCards 15', ciCards.length === 15, String(ciCards.length))
  check('knowledge 卡片 id 唯一', new Set(cards.map((c) => c.id)).size === cards.length)
  check('词牌 name 唯一', new Set(ciCards.map((c) => c.name)).size === ciCards.length)
}

// ---------- 2b. 扩展静态数据资产（M9，assets/data/） ----------
const assetData = {
  'assets/data/anthology.json': 400 * 1024,
  'assets/data/poems-bank.json': 8 * 1024 * 1024,
  'assets/data/pingshui.json': 400 * 1024,
  'assets/data/ci-bank.json': 12 * 1024 * 1024,
  'assets/data/mood-catalog.json': 64 * 1024,
  'assets/data/manifest.json': 64 * 1024,
}
for (const [rel, budget] of Object.entries(assetData)) {
  const okSize = exists(rel) && bytes(rel) > 0 && bytes(rel) <= budget
  check(`${rel} 存在且 ≤ ${kb(budget)}`, okSize, kb(bytes(rel)))
}
// ---------- 3. profile 安装态 ----------
try {
  const profilePkg = JSON.parse(fs.readFileSync(path.join(PROFILE, 'package.json'), 'utf8'))
  const dep = profilePkg?.dependencies?.['dsh-little-whale']
  check('desktop profile 记录了插件依赖', Boolean(dep), dep || 'missing')
  check('desktop profile bundles 含 dsh-little-whale', (profilePkg?.dsh?.profile?.bundles || []).includes('dsh-little-whale'))
  const linked = (dep || '').startsWith('link:') && path.resolve((dep || '').slice(5)) === ROOT
  check('依赖为 link: 到本项目目录', linked, dep || '')
} catch (e) {
  check('读取 desktop profile', false, String(e?.message || e))
}

// ---------- 4. 宿主路由存活 ----------
const probe = async (route) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(WEB + route, { signal: controller.signal })
    const text = await res.text()
    return { status: res.status, text }
  } catch (e) {
    return { status: 0, error: String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}
// M9 扩展资产路由（assets 静态路由，无栅栏）
for (const route of ['/api/dsh-poetry/assets?f=data/anthology.json', '/api/dsh-poetry/assets?f=data/poems-bank.json', '/api/dsh-poetry/assets?f=data/pingshui.json', '/api/dsh-poetry/assets?f=data/ci-bank.json', '/api/dsh-poetry/assets?f=data/mood-catalog.json']) {
  const r = await probe(route)
  if (r.status === 200) {
    let ok = false, detail = ''
    try { const j = JSON.parse(r.text); ok = j.ok === true; detail = `items=${j.items ? j.items.length : (j.categories ? j.categories.length : '-')}` } catch { detail = '非 JSON' }
    check(`GET ${route}`, ok, detail)
  } else if (r.status === 401 || r.status === 403) {
    warn(`GET ${route} 被信任栅栏拦截`, `HTTP ${r.status}`)
  } else {
    check(`GET ${route}`, false, `HTTP ${r.status}`)
  }
}

for (const route of ROUTES) {
  const r = await probe(route)
  if (r.status === 200) {
    if (route.endsWith('.json')) {
      let ok = true, detail = ''
      try {
        const j = JSON.parse(r.text)
        if (route.endsWith('/mood-ai.json')) {
          let catalogImages = []
          try { catalogImages = (readJson('assets/data/mood-catalog.json').moodImages || []).map((x) => x.file) } catch {}
          ok = j.ok === true ? Boolean(j.mood && typeof j.mood.label === 'string' && typeof j.mood.reason === 'string' && catalogImages.includes(j.mood.image)) : (j.error && ['MOOD_AI_UNAVAILABLE','MOOD_AI_RATE_LIMITED'].includes(j.error.code))
          detail = j.ok === true ? `${j.mood.label} → ${j.mood.image}` : `降级：${j.error && j.error.code}`
        } else if (route.endsWith('/self-talk.json')) {
          ok = j.ok === true ? Array.isArray(j.lines) && j.lines.length >= 1 && typeof j.lines[0].text === 'string' : (j.error && ['SELF_TALK_UNAVAILABLE','SELF_TALK_BUSY','SELF_TALK_RATE_LIMITED'].includes(j.error.code))
          detail = j.ok === true ? `lines=${j.lines.length} model=${j.model && (j.model.provider + '/' + j.model.model)}` : `降级：${j.error && j.error.code}`
        } else if (route.endsWith('/mood.json')) {
          ok = j.ok === true && Boolean(j.stats && typeof j.stats.userMessages === 'number' && typeof j.stats.toolCalls === 'number')
          detail = ok ? `userMessages=${j.stats.userMessages} toolCalls=${j.stats.toolCalls}` : JSON.stringify(j).slice(0, 120)
        } else if (route.endsWith('/weather.json')) {
          // 天气：ok 且带 weather，或 ok:false（外部接口不可用）都算路由健康；无 key 时也算正常降级
          ok = j.ok === true ? Boolean(j.weather && j.weather.category && j.weather.label) : Boolean(j.error && j.error.code === 'WEATHER_UNAVAILABLE')
          detail = j.ok === true ? `${j.weather && j.weather.label} ${j.weather && j.weather.tempC}℃ ${j.weather && j.weather.category}` : 'WEATHER_UNAVAILABLE（降级正常）'
        } else {
          ok = j.ok === true
          detail = ok ? `dataVersion=${j.dataVersion ?? '-'}` : JSON.stringify(j.error || j).slice(0, 120)
        }
      } catch { ok = false; detail = '非 JSON' }
      check(`GET ${route}`, ok, detail)
    } else {
      check(`GET ${route}`, true, `${r.text.length}B`)
    }
  } else if (r.status === 401 || r.status === 403) {
    warn(`GET ${route} 被信任栅栏拦截（路由已注册，浏览器同源可访问）`, `HTTP ${r.status}`)
  } else if (r.status === 0) {
    check(`GET ${route}`, false, r.error)
  } else {
    check(`GET ${route}`, false, `HTTP ${r.status}（宿主是否已重启加载新代码？）`)
  }
}

// ---------- 5. settings 回环（可选） ----------
if (process.argv.includes('--settings')) {
  const getSettings = await probe('/api/dsh-poetry/settings.json')
  if (getSettings.status === 200) {
    try {
      const current = JSON.parse(getSettings.text).settings
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      const res = await fetch(WEB + '/api/dsh-poetry/settings.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const j = await res.json().catch(() => ({}))
      check('PUT settings.json 回环', res.status === 200 && j.ok === true, `HTTP ${res.status}`)
    } catch (e) {
      check('PUT settings.json 回环', false, String(e?.message || e))
    }
  } else {
    warn('跳过 PUT settings 回环（GET 未拿到 200）', `HTTP ${getSettings.status}`)
  }
}

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.ok)
const warned = results.filter((r) => r.warn)
console.log(`\n${results.length - failed.length}/${results.length} passed, ${warned.length} warnings, ${failed.length} failed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
