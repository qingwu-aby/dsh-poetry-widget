// client-src/widget/models/mascot-model.js —— 形象状态机 / 立绘与动画素材 / 晕眩·饭点·溜达小动作。
import { isVideoMoodFile, num } from '../../base.js'
import { getStorage } from '../../data.js'
import { normalizeMascotEggState } from '../../local-state.js'
import { shanghaiParts } from '../../mood-engine.js'
import { ASSET_BASE, DIZZY_FAST_DISTANCE_PX, DIZZY_FAST_PX_PER_SEC, DIZZY_FAST_WINDOW_MS, DIZZY_MAX_MS, DIZZY_MIN_MS, MASCOT_DIR, MASCOT_EXPRESSION_FILES, MASCOT_FILES, MASCOT_IDLE_MIN_MS, MASCOT_IDLE_USER_MS, MEAL_KEY, MEAL_PLAY_MAX_MS, MEAL_PLAY_MIN_MS, MOTION_FIRST_MAX_DELAY_MS, MOTION_FIRST_MIN_DELAY_MS, MOTION_MAX_DELAY_MS, MOTION_MIN_DELAY_MS, MOTION_PLAY_MAX_MS, MOTION_PLAY_MIN_MS, MOTION_ROTATION_KEY, PET_MEDIA_CATALOG_FILE, PET_MEDIA_PATH, PET_MEDIA_TIMEOUT_MS, ROUTE, WEATHER_OVERLAY_STATES } from './constants.js'

  export function mascotStateFor(weather, enabled) {
  if (!enabled || !weather || typeof weather !== 'object') return 'celebrate'
  if (weather.isDay === false || weather.isDay === 0) return 'night'
  const category = typeof weather.category === 'string' ? weather.category : ''
  if (category === 'rain') return 'rain'
  if (category === 'snow') return 'snow'
  if (category === 'thunder') return 'thunder'
  if (category === 'cold') return 'cold'
  if (category === 'clear' || category === 'cloud' || category === 'fog' || category === 'wind') return 'idle'
  return 'celebrate'
  }

  export function mascotFileFor(stateKey) {
  return MASCOT_FILES[stateKey] || MASCOT_FILES.celebrate
  }

  export function mascotUrl(file) {
  return ASSET_BASE + MASCOT_DIR + file
  }

  /** 天气类别 → 诗词标签：类别标签 + 夜间追加「月/夜」。 */
  export function mascotImageFor(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const weatherKey = typeof opts.weatherStateKey === 'string' ? opts.weatherStateKey : 'celebrate'
  const weatherOn = opts.weatherEnabled === true
  const moodOn = opts.moodEnabled === true
  const mood = opts.mood && typeof opts.mood === 'object' ? opts.mood : null
  if (moodOn && mood && mood.image && (mood.source === 'model' || mood.ai === true)) {
   return { stateKey: 'mood:ai', file: mood.image, source: 'mood' }
  }
  if (weatherOn && WEATHER_OVERLAY_STATES.indexOf(weatherKey) >= 0) {
   return { stateKey: weatherKey, file: mascotFileFor(weatherKey), source: 'weather' }
  }
  if (moodOn && mood && mood.image) return { stateKey: 'mood:' + mood.key, file: mood.image, source: 'mood' }
  if (weatherOn) return { stateKey: weatherKey, file: mascotFileFor(weatherKey), source: 'weather' }
  return { stateKey: 'celebrate', file: mascotFileFor('celebrate'), source: 'default' }
  }

  /** 视频立绘暂停条件：页面隐藏或面板打开时暂停，避免后台解码/打扰。 */
  export function mascotVideoShouldPause(options) {
  const opts = options && typeof options === 'object' ? options : {}
  return opts.hidden === true || opts.panelOpen === true
  }

  /** 快速拖动检测：两点间速度 ≥1800px/s 或 120ms 内位移 >120px。 */
  export function detectFastDrag(previous, next) {
  const prev = previous && typeof previous === 'object' ? previous : {}
  const cur = next && typeof next === 'object' ? next : {}
  const px = num(prev.x, 0)
  const py = num(prev.y, 0)
  const cx = num(cur.x, 0)
  const cy = num(cur.y, 0)
  const pt = num(prev.t, 0)
  const ct = num(cur.t, 0)
  const dt = ct - pt
  if (!(dt > 0)) return false
  const distance = Math.hypot(cx - px, cy - py)
  const speed = distance / dt * 1000
  if (speed >= DIZZY_FAST_PX_PER_SEC) return true
  return distance > DIZZY_FAST_DISTANCE_PX && dt < DIZZY_FAST_WINDOW_MS
  }

  export function nextDizzyDuration(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(DIZZY_MIN_MS + ratio * (DIZZY_MAX_MS - DIZZY_MIN_MS))
  }

  export function nextMealDuration(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MEAL_PLAY_MIN_MS + ratio * (MEAL_PLAY_MAX_MS - MEAL_PLAY_MIN_MS))
  }

  export function mealMomentFor(now) {
  const parts = shanghaiParts(num(now, Date.now()))
  const minutes = parts.minutes
  const windows = [
   { meal: 'breakfast', label: '早饭', start: 7 * 60, end: 9 * 60, window: '07:00–09:00' },
   { meal: 'lunch', label: '午饭', start: 11 * 60 + 30, end: 13 * 60 + 30, window: '11:30–13:30' },
   { meal: 'dinner', label: '晚饭', start: 17 * 60 + 30, end: 19 * 60 + 30, window: '17:30–19:30' },
  ]
  for (const item of windows) {
   if (minutes >= item.start && minutes < item.end) return { meal: item.meal, label: item.label, window: item.window, dateKey: parts.dateKey }
  }
  return null
  }

  export function normalizeMealState(raw, now) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const dateKey = shanghaiParts(num(now, Date.now())).dateKey
  const sameDay = source.date === dateKey
  const meals = {}
  const previous = sameDay && source.meals && typeof source.meals === 'object' ? source.meals : {}
  for (const meal of ['breakfast', 'lunch', 'dinner']) if (previous[meal] === true) meals[meal] = true
  return { date: dateKey, meals }
  }

  export function readMealState(now) {
  const storage = getStorage()
  if (!storage) return normalizeMealState(null, now)
  try {
   const raw = storage.getItem(MEAL_KEY)
   return normalizeMealState(raw ? JSON.parse(raw) : null, now)
  } catch (error) {
   return normalizeMealState(null, now)
  }
  }

  export function writeMealState(state) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(MEAL_KEY, JSON.stringify(state))
  } catch (error) {
  }
  }

  export function markMealDone(state, meal, now) {
  const base = normalizeMealState(state, now)
  const meals = Object.assign({}, base.meals)
  meals[meal] = true
  return { date: base.date, meals }
  }

  /** 是否应触发饭点提醒（纯函数）：窗口内、未 hidden/panel 遮挡、可见、当日该餐未触发。 */
  export function mealTriggerFor(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.hidden === true || opts.panelOpen === true || opts.visible === false) return null
  const moment = mealMomentFor(opts.now)
  if (!moment) return null
  const state = normalizeMealState(opts.state, opts.now)
  if (state.meals[moment.meal]) return null
  return moment
  }

  export function pickDizzyMedia(entries) {
  if (!Array.isArray(entries) || !entries.length) return null
  const exact = entries.find((entry) => entry && String(entry.label || '').indexOf('小幅度原地360度旋转展示') >= 0)
  if (exact) return exact
  return entries.find((entry) => entry && /转|旋转|转圈|晕/.test(String(entry.label || ''))) || null
  }

  export function pickMealMedia(entries, meal) {
  if (!Array.isArray(entries) || !entries.length) return null
  const preferred = { breakfast: '吃早餐', lunch: '吃午餐', dinner: '吃晚餐' }
  const exact = entries.find((entry) => entry && String(entry.label || '') === preferred[meal])
  if (exact) return exact
  for (const label of ['吃白饭', '干饭']) {
   const match = entries.find((entry) => entry && String(entry.label || '').indexOf(label) >= 0)
   if (match) return match
  }
  return entries.find((entry) => entry && String(entry.label || '').indexOf('吃') >= 0) || null
  }

  /** 立绘层优先级：pulse > panel > dizzy > meal > expression > motion > mood。 */
  export function mascotFilePriority(options) {
  const opts = options && typeof options === 'object' ? options : {}
  return opts.pulseFile || opts.panelFile || opts.dizzyFile || opts.mealFile || opts.expressionFile || opts.wanderFile || opts.motionFile || opts.moodFile || ''
  }



  export function petMediaUrl(file) {
  return ROUTE + PET_MEDIA_PATH + '?f=' + encodeURIComponent(String(file == null ? '' : file))
  }

  /** dsh-pet catalog：只接受 webm/ 下的 video 条目，去重。 */
  export function normalizePetMediaCatalog(data) {
  if (!data || data.ok === false || !Array.isArray(data.entries)) return null
  const entries = []
  const seen = {}
  for (const item of data.entries) {
   if (!item || typeof item.file !== 'string') continue
   const file = item.file.trim()
   if (!/^webm\/[^/]+\.webm$/.test(file)) continue
   if (seen[file]) continue
   seen[file] = true
   entries.push({
    file,
    label: String(item.label || ''),
    media: 'video',
    tags: Array.isArray(item.tags) ? item.tags.slice() : [],
   })
  }
  return entries
  }

  export function mergePetMediaIntoCatalog(catalog, petEntries) {
  if (!catalog || !Array.isArray(petEntries) || !petEntries.length) return catalog
  const moodImages = catalog.moodImages.slice()
  const moodFiles = catalog.moodFiles.slice()
  const byFile = Object.assign({}, catalog.byFile)
  for (const entry of petEntries) {
   if (!entry || !entry.file || byFile[entry.file]) continue
   const normalized = { file: entry.file, label: String(entry.label || ''), tags: Array.isArray(entry.tags) ? entry.tags : [], media: 'video' }
   moodImages.push(normalized)
   moodFiles.push(entry.file)
   byFile[entry.file] = normalized
  }
  return Object.assign({}, catalog, { moodImages, moodFiles, byFile })
  }

  let petMediaCache = null
  let petMediaInflight = null

  export function clearPetMediaCache() {
  petMediaCache = null
  if (petMediaInflight && typeof petMediaInflight.abort === 'function') {
   try {
    petMediaInflight.abort()
   } catch (error) {
   }
  }
  petMediaInflight = null
  }

  export function requestPetMediaCatalog() {
  if (petMediaCache) return Promise.resolve({ ok: true, entries: petMediaCache })
  if (petMediaInflight) return petMediaInflight.promise
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, entries: [] })
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let settled = false
  let timer = null
  let abortResolve = null
  const abortPromise = new Promise((resolve) => {
   abortResolve = () => resolve({ ok: false, entries: [], reason: 'aborted' })
  })
  const finish = (result) => {
   if (settled) return result
   settled = true
   if (timer) clearTimeout(timer)
   petMediaInflight = null
   if (result && result.ok && Array.isArray(result.entries)) petMediaCache = result.entries
   return result
  }
  const task = Promise.resolve()
   .then(() => fetch(ROUTE + PET_MEDIA_PATH + '?f=' + encodeURIComponent(PET_MEDIA_CATALOG_FILE), controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) return { ok: false, entries: [], reason: 'http' }
    return Promise.resolve(response.json()).then((data) => {
     const entries = normalizePetMediaCatalog(data)
     if (!entries) return { ok: false, entries: [], reason: 'invalid' }
     return { ok: true, entries }
    }).catch(() => ({ ok: false, entries: [], reason: 'json' }))
   })
   .catch(() => ({ ok: false, entries: [], reason: 'network' }))
  const timeout = new Promise((resolve) => {
   timer = setTimeout(() => {
    try {
     if (controller) controller.abort()
    } catch (error) {
    }
    resolve({ ok: false, entries: [], reason: 'timeout' })
   }, PET_MEDIA_TIMEOUT_MS)
  })
  const inflight = { promise: null, abort: () => {
   try {
    if (controller) controller.abort()
   } catch (error) {
   }
   if (abortResolve) abortResolve()
  } }
  inflight.promise = Promise.race([task, timeout, abortPromise]).then(finish)
  petMediaInflight = inflight
  return inflight.promise
  }

  export function readMotionRotation() {
  const storage = getStorage()
  if (!storage) return 0
  try {
   const value = Number(storage.getItem(MOTION_ROTATION_KEY))
   return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  } catch (error) {
   return 0
  }
  }

  export function writeMotionRotation(index) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(MOTION_ROTATION_KEY, String(Math.max(0, Math.floor(num(index, 0)))))
  } catch (error) {
  }
  }

  /** 轮转取下一个动作（不随机）；返回 entry 与下一次索引（一轮结束回到 0）。 */
  export function nextMotionEntry(entries, index) {
  if (!Array.isArray(entries) || !entries.length) return { entry: null, index: 0, size: 0 }
  const size = entries.length
  const start = Math.max(0, Math.floor(num(index, 0))) % size
  return { entry: entries[start], index: (start + 1) % size, size, position: start }
  }

  export function nextMotionDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOTION_MIN_DELAY_MS + ratio * (MOTION_MAX_DELAY_MS - MOTION_MIN_DELAY_MS))
  }

  export function nextMotionFirstDelay(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOTION_FIRST_MIN_DELAY_MS + ratio * (MOTION_FIRST_MAX_DELAY_MS - MOTION_FIRST_MIN_DELAY_MS))
  }

  /** 首次且当前心情为静态图时 10–20s 快速补一个动画；其它情况按 90–210s 轮转。 */
  export function nextMotionScheduleDelay(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.first !== false && !isVideoMoodFile(opts.moodImage)) return nextMotionFirstDelay(opts)
  return nextMotionDelay(opts)
  }

  export function nextMotionDuration(options) {
  const opts = typeof options === 'function' ? { random: options } : (options && typeof options === 'object' ? options : {})
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  return Math.round(MOTION_PLAY_MIN_MS + ratio * (MOTION_PLAY_MAX_MS - MOTION_PLAY_MIN_MS))
  }




  export function shouldShowDailyGreet(state, now) {
  return !normalizeMascotEggState(state, now).greeted
  }

  export function canShowIdlePose(state, now, lastInteractionAt) {
  const normalized = normalizeMascotEggState(state, now)
  const time = num(now, Date.now())
  if (normalized.idleAt > 0 && time - normalized.idleAt < MASCOT_IDLE_MIN_MS) return false
  const lastInteraction = num(lastInteractionAt, 0)
  if (lastInteraction > 0 && time - lastInteraction < MASCOT_IDLE_USER_MS) return false
  return true
  }

  export function pickMascotExpression(random) {
  const value = typeof random === 'function' ? Number(random()) : Math.random()
  const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
  const index = Math.floor(ratio * MASCOT_EXPRESSION_FILES.length)
  return MASCOT_EXPRESSION_FILES[index] || MASCOT_EXPRESSION_FILES[0]
  }

