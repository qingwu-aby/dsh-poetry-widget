// client-src/mood-engine.js —— 心情引擎纯逻辑（v2.5 从 client.js 抽出）。
import { num } from './base.js'

export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
export const MOOD_SWITCH_MIN_MS = 20 * 60 * 1000
export const MOOD_REFRESH_MS = 5 * 60 * 1000
export const MOOD_TICK_MS = 60 * 1000
export const MOOD_AI_PATH = 'mood-ai.json'
export const MOOD_AI_TIMEOUT_MS = 35000
export const MOOD_AI_DEBOUNCE_MIN_MS = 2000
export const MOOD_AI_DEBOUNCE_MAX_MS = 4000
export const MOOD_AI_MIN_GAP_MS = 20000
export const MOOD_AI_RETRY_MIN_MS = 12000
export const MOOD_AI_RETRY_MAX_MS = 25000
export const MOOD_AI_KEEP_MS = 30 * 60 * 1000
export const MOOD_AI_MAX_RETRIES = 5
export const MOOD_AI_RECENT_MAX = 3
export const MOOD_AI_RECENT_IMAGES_MAX = 20
export const MOOD_PANEL_PEEK_FILES = Object.freeze({
  today: 'dsh-whale-home-peek.webp',
  settings: 'dsh-whale-settings-peek.webp',
  other: 'dsh-whale-workbench-peek.webp',
})
export const MOOD_STRONG = Object.freeze(['tired', 'sleepy', 'proud'])
export const MOOD_LABELS = Object.freeze({
  happy: '开心', proud: '得意', tired: '有点累', sleepy: '困了', hungry: '有点饿',
  lonely: '有点孤单', curious: '好奇', cozy: '惬意', calm: '平静',
})
export const MOOD_IMAGES = Object.freeze({
  happy: ['dsh-whale-state-game-happy.webp', 'dsh-whale-state-celebrate.webp'],
  proud: ['dsh-whale-state-achievement.webp', 'dsh-whale-state-levelup.webp'],
  tired: ['dsh-whale-state-work-sleep.webp', 'dsh-whale-state-daily-melt.webp'],
  sleepy: ['dsh-whale-state-sleep.webp', 'dsh-whale-state-night.webp'],
  hungry: ['dsh-whale-state-daily-eat.webp', 'dsh-whale-state-daily-cooking.webp'],
  lonely: ['dsh-whale-state-waiting.webp', 'dsh-whale-state-idle-cute.webp'],
  curious: ['dsh-whale-state-curious.webp', 'dsh-whale-state-thinking.webp'],
  cozy: ['dsh-whale-state-daily-coffee.webp', 'dsh-whale-state-weather-rain-happy.webp', 'dsh-whale-state-weather-snow.webp'],
  calm: ['dsh-whale-state-idle-cute.webp'],
})

export function shanghaiParts(now) {
const date = new Date(num(now, Date.now()) + SHANGHAI_OFFSET_MS)
const hour = date.getUTCHours()
return {
 hour,
 minutes: hour * 60 + date.getUTCMinutes(),
 dateKey: date.toISOString().slice(0, 10),
}
}

export function emptyMoodStats() {
return {
 userMessages: 0, assistantMessages: 0, toolCalls: 0, toolErrors: 0,
 turns: 0, turnsCompleted: 0, turnsErrored: 0, activeMs: 0, sessions: 0,
 firstActivityAt: 0, lastActivityAt: 0,
}
}

export function normalizeMoodStats(raw) {
const stats = emptyMoodStats()
const src = raw && typeof raw === 'object' ? raw : {}
for (const key of ['userMessages', 'assistantMessages', 'toolCalls', 'toolErrors', 'turns', 'turnsCompleted', 'turnsErrored', 'activeMs', 'sessions', 'firstActivityAt', 'lastActivityAt']) {
 stats[key] = Math.max(0, Math.floor(num(src[key], 0)))
}
return stats
}

export function computeMood(input) {
const opts = input && typeof input === 'object' ? input : {}
const weather = opts.weather && typeof opts.weather === 'object' ? opts.weather : null
const signals = opts.signals && typeof opts.signals === 'object' ? opts.signals : {}
const now = num(signals.now, Date.now())
const local = shanghaiParts(now)
const clicks = Math.max(0, Math.floor(num(signals.clicks, 0)))
const wins = Math.max(0, Math.floor(num(signals.feihuaWins, 0)))
const minutes = local.minutes
const meal = (minutes >= 7 * 60 && minutes < 9 * 60)
 || (minutes >= 11 * 60 + 30 && minutes < 13 * 60)
 || (minutes >= 17 * 60 + 30 && minutes < 19 * 60 + 30)
const night = local.hour >= 23 || local.hour < 6
const category = weather && typeof weather.category === 'string' ? weather.category : ''
const rainy = category === 'rain' || category === 'snow' || category === 'thunder'
const tempC = weather ? Number(weather.tempC) : NaN
const coolNight = Boolean(weather) && weather.isDay === false && Number.isFinite(tempC) && tempC <= 22
let key = 'calm'
let reason = '平平常常的一阵'
if (night) {
 key = 'sleepy'
 reason = '夜深了 · 有点困'
} else if (wins >= 3) {
 key = 'proud'
 reason = '飞花令赢了 ' + wins + ' 次 · 好得意'
} else if (wins >= 1) {
 key = 'happy'
 reason = '飞花令赢了 · 心情不错'
} else if (meal) {
 key = 'hungry'
 reason = '到饭点啦 · 有点饿'
} else if (rainy || coolNight) {
 key = 'cozy'
 reason = category === 'snow' ? '下雪了 · 适合读诗' : (category === 'rain' || category === 'thunder' ? '外面有雨 · 适合读诗' : '夜色凉凉 · 很惬意')
} else if (clicks === 0) {
 key = 'curious'
 reason = '安静着 · 四处看看'
}
return {
 key,
 label: MOOD_LABELS[key] || key,
 image: (MOOD_IMAGES[key] || MOOD_IMAGES.calm)[0],
 reason,
 strong: MOOD_STRONG.indexOf(key) >= 0,
}
}

export function throttleMoodSwitch(previous, next, now, force) {
const time = num(now, Date.now())
if (!next) return previous || null
if (!previous) return Object.assign({}, next, { changed: true, switchedAt: time })
if (next.key === previous.key) {
 return Object.assign({}, next, { changed: false, switchedAt: num(previous.switchedAt, time) })
}
const elapsed = Math.max(0, time - num(previous.switchedAt, 0))
if (next.strong === true || force === true || elapsed >= MOOD_SWITCH_MIN_MS) {
 return Object.assign({}, next, { changed: true, switchedAt: time })
}
return Object.assign({}, previous, { changed: false, pendingKey: next.key })
}

export function moodBasisText(weather) {
const label = weather && weather.label ? weather.label : '未知'
return '天气：' + label
}

export function normalizeMoodCatalog(data) {
if (!data || !Array.isArray(data.moodImages) || !data.moodImages.length) return null
const moodImages = []
const seen = {}
for (const item of data.moodImages) {
 const file = item && typeof item.file === 'string' ? item.file.trim() : ''
 if (!file || seen[file]) continue
 seen[file] = true
 moodImages.push({ file, label: String(item.label || ''), tags: Array.isArray(item.tags) ? item.tags : [], media: item.media || 'image' })
}
if (!moodImages.length) return null
const panel = Object.assign({}, MOOD_PANEL_PEEK_FILES)
const applyPanel = (item) => {
 const file = item && typeof item.file === 'string' ? item.file.trim() : ''
 if (!file) return
 const tags = Array.isArray(item.tags) ? item.tags.join('|') : ''
 if (tags.indexOf('home') >= 0) panel.today = file
 else if (tags.indexOf('settings') >= 0) panel.settings = file
 else if (tags.indexOf('workbench') >= 0 || tags.indexOf('poetry') >= 0) panel.other = file
}
for (const item of Array.isArray(data.panelImages) ? data.panelImages : []) applyPanel(item)
for (const item of Array.isArray(data.images) ? data.images : []) {
 if (item && item.scope === 'panel') applyPanel(item)
}
const byFile = {}
for (const item of moodImages) byFile[item.file] = item
return {
 version: String(data.version || data.dataVersion || ''),
 moodImages,
 moodFiles: moodImages.map((item) => item.file),
 byFile,
 panel,
}
}

export function panelPeekFile(catalog, tabId) {
const panel = catalog && catalog.panel ? catalog.panel : MOOD_PANEL_PEEK_FILES
if (tabId === 'today') return panel.today || MOOD_PANEL_PEEK_FILES.today
if (tabId === 'settings') return panel.settings || MOOD_PANEL_PEEK_FILES.settings
return panel.other || MOOD_PANEL_PEEK_FILES.other
}

export function moodCatalogAllows(catalog, image) {
if (!catalog || !Array.isArray(catalog.moodFiles) || typeof image !== 'string' || !image) return false
return catalog.moodFiles.indexOf(image) >= 0
}

export function moodAiQuery(options) {
const opts = options && typeof options === 'object' ? options : {}
const params = []
const add = (key, value) => {
 if (value == null || value === '') return
 params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
}
if (opts.force === true) add('force', '1')
// v1.78：只有用户手动「刷新心情」才带 manual=1；自动刷新由宿主按缓存限流，避免多标签/重载叠加刷模型。
if (opts.manual === true) add('manual', '1')
add('mood', opts.moodKey)
add('weather', opts.weather)
const recent = (Array.isArray(opts.recent) ? opts.recent : []).map((text) => String(text == null ? '' : text).trim()).filter(Boolean).slice(-MOOD_AI_RECENT_MAX)
if (recent.length) add('recent', recent.join('|'))
const imageSeen = {}
const recentImages = []
for (const file of Array.isArray(opts.recentImages) ? opts.recentImages : []) {
 const clean = String(file == null ? '' : file).trim()
 if (!clean || imageSeen[clean]) continue
 imageSeen[clean] = true
 recentImages.push(clean)
}
if (recentImages.length) add('recentImages', recentImages.slice(-MOOD_AI_RECENT_IMAGES_MAX).join('|'))
return MOOD_AI_PATH + (params.length ? '?' + params.join('&') : '')
}

export function parseMoodAiResponse(data, catalog) {
const errorCode = data && data.error && typeof data.error.code === 'string' ? data.error.code : ''
if (!data || data.ok === false || !data.mood || typeof data.mood !== 'object') return { ok: false, reason: 'invalid', code: errorCode }
const raw = data.mood
const label = String(raw.label == null ? '' : raw.label).trim()
const reason = String(raw.reason == null ? '' : raw.reason).trim()
const image = String(raw.image == null ? '' : raw.image).trim()
const videoImage = /^webm\/[^/]+\.webm$/.test(image)
if (!label || (!videoImage && !moodCatalogAllows(catalog, image))) return { ok: false, reason: 'image', code: errorCode }
return {
 ok: true,
 mood: {
  key: 'ai',
  label: label.slice(0, 24),
  image,
  reason: reason.slice(0, 80),
  energy: num(raw.energy, 0),
  source: 'model',
  ai: true,
 },
}
}

export function nextMoodAiDebounceDelay(options) {
const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
const random = typeof opts.random === 'function' ? opts.random : Math.random
const value = Number(random())
const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
return Math.round(MOOD_AI_DEBOUNCE_MIN_MS + ratio * (MOOD_AI_DEBOUNCE_MAX_MS - MOOD_AI_DEBOUNCE_MIN_MS))
}

export function nextMoodAiRetryDelay(options) {
const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
const random = typeof opts.random === 'function' ? opts.random : Math.random
const value = Number(random())
const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
return Math.round(MOOD_AI_RETRY_MIN_MS + ratio * (MOOD_AI_RETRY_MAX_MS - MOOD_AI_RETRY_MIN_MS))
}

export function moodAiKeepDecision(options) {
const opts = options && typeof options === 'object' ? options : {}
if (opts.source !== 'model') return false
const last = num(opts.lastSuccessAt, 0)
if (last <= 0) return false
return num(opts.now, Date.now()) - last < MOOD_AI_KEEP_MS
}

export function normalizeMoodAiFailure(result) {
const reason = result && typeof result.reason === 'string' ? result.reason : ''
const code = result && typeof result.code === 'string' ? result.code : ''
if (result && result.status === 429) return 'rate'
if (reason === 'timeout' || reason === 'http' || reason === 'json' || reason === 'image' || reason === 'network' || reason === 'rate') return reason
if (reason === 'no-fetch') return 'network'
if (reason === 'catalog') return 'catalog'
if (code) {
 if (/RATE|LIMIT/i.test(code)) return 'rate'
 if (/TIMEOUT/i.test(code)) return 'timeout'
 if (/JSON|PARSE/i.test(code)) return 'json'
 if (/IMAGE/i.test(code)) return 'image'
 if (/CATALOG/i.test(code)) return 'catalog'
 if (/NETWORK|OFFLINE/i.test(code)) return 'network'
}
if (reason === 'host' || reason === 'invalid') return 'model'
return 'unknown'
}

export function moodAiFailureLabel(reason) {
const labels = { timeout: '超时', http: 'HTTP 错误', json: '响应格式错误', image: '图片无效', network: '网络错误', rate: '请求过频', model: '模型返回错误', catalog: '图鉴未加载', unknown: '未知原因' }
return labels[reason] || labels.unknown
}

export function moodAiEventDelay(options) {
const opts = options && typeof options === 'object' ? options : {}
const last = num(opts.lastRequestAt, 0)
const now = num(opts.now, Date.now())
if (last > 0) {
 const remaining = MOOD_AI_MIN_GAP_MS - (now - last)
 if (remaining > 0) return remaining
}
return nextMoodAiDebounceDelay(opts)
}

export function moodTimeBucket(now) {
const parts = shanghaiParts(num(now, Date.now()))
const hour = parts.hour
let period = 'night'
if (hour >= 6 && hour < 11) period = 'morning'
else if (hour >= 11 && hour < 14) period = 'noon'
else if (hour >= 14 && hour < 18) period = 'afternoon'
else if (hour >= 18 && hour < 22) period = 'evening'
const meal = hour === 7 || hour === 8 || hour === 11 || hour === 12 || hour === 17 || hour === 18
return period + '|' + (meal ? 'meal' : 'offmeal')
}

export function moodAiSnapshot(weather, feihuaWins, feihuaLosses) {
return {
 weatherCategory: weather && typeof weather.category === 'string' ? weather.category : '',
 feihuaWins: Math.max(0, Math.floor(num(feihuaWins, 0))),
 feihuaLosses: Math.max(0, Math.floor(num(feihuaLosses, 0))),
}
}

export function isMoodAiSignificant(previous, current) {
if (!previous || !current) return false
if (current.weatherCategory !== previous.weatherCategory) return true
if (current.feihuaWins > previous.feihuaWins || current.feihuaLosses > previous.feihuaLosses) return true
return false
}
