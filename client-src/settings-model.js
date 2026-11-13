// client-src/settings-model.js —— 设置 schema/归一化/PUT 序列化/防抖保存（v0.4.0 拆出）
import { clamp, num } from './base.js'

export const MIN_SCALE = 0.6
export const MAX_SCALE = 1.6
export const SAVE_DEBOUNCE_MS = 450
export const SETTINGS_URL = '/api/dsh-poetry/settings.json'

  export const WRITE_KEYS = [
  'scale', 'showTones', 'mode', 'autoplay', 'snap', 'script',
  'hidden', 'theme', 'weatherCity', 'weatherPoem', 'mood', 'spontaneousPoem',
  'qqBridge', 'twinOverlay', 'twinSystem',
  'lastPoemId', 'tutorialSeen',
  ]
  export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  scale: 1,
  showTones: true,
  mode: 'daily',
  autoplay: 0,
  snap: 'left',
  script: 'simplified',
  hidden: false,
  theme: 'auto',
  weatherCity: '北京',
  weatherPoem: true,
  mood: true,
  spontaneousPoem: true,
  qqBridge: true,
  twinOverlay: true,
  twinSystem: true,
  lastPoemId: null,
  tutorialSeen: false,
  updatedAt: 0,
  })
  function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pickEnum = (value, allowed, fallback) => (allowed.indexOf(value) >= 0 ? value : fallback)
  const scale = Math.round(clamp(num(src.scale, DEFAULT_SETTINGS.scale), MIN_SCALE, MAX_SCALE) * 100) / 100
  const autoplayValue = num(src.autoplay, 0)
  const autoplay = [0, 30, 60, 300].indexOf(autoplayValue) >= 0 ? autoplayValue : 0
  const lastPoemId = typeof src.lastPoemId === 'string' && src.lastPoemId.length ? src.lastPoemId : null
  const weatherCityRaw = typeof src.weatherCity === 'string' ? src.weatherCity.trim() : ''
  const weatherCity = weatherCityRaw.length >= 1 && weatherCityRaw.length <= 20
   ? weatherCityRaw
   : DEFAULT_SETTINGS.weatherCity
  return {
   schemaVersion: 1,
   scale,
   showTones: typeof src.showTones === 'boolean' ? src.showTones : DEFAULT_SETTINGS.showTones,
   mode: pickEnum(src.mode, ['daily', 'random'], DEFAULT_SETTINGS.mode),
   autoplay,
   snap: pickEnum(src.snap, ['left', 'right', 'free'], DEFAULT_SETTINGS.snap),
   script: pickEnum(src.script, ['simplified', 'original'], DEFAULT_SETTINGS.script),
   hidden: typeof src.hidden === 'boolean' ? src.hidden : DEFAULT_SETTINGS.hidden,
   theme: pickEnum(src.theme, ['auto', 'light', 'dark'], DEFAULT_SETTINGS.theme),
   weatherCity,
   weatherPoem: typeof src.weatherPoem === 'boolean' ? src.weatherPoem : DEFAULT_SETTINGS.weatherPoem,
   mood: typeof src.mood === 'boolean' ? src.mood : DEFAULT_SETTINGS.mood,
   spontaneousPoem: typeof src.spontaneousPoem === 'boolean' ? src.spontaneousPoem : DEFAULT_SETTINGS.spontaneousPoem,
   qqBridge: typeof src.qqBridge === 'boolean' ? src.qqBridge : DEFAULT_SETTINGS.qqBridge,
   twinOverlay: typeof src.twinOverlay === 'boolean' ? src.twinOverlay : DEFAULT_SETTINGS.twinOverlay,
   twinSystem: typeof src.twinSystem === 'boolean' ? src.twinSystem : DEFAULT_SETTINGS.twinSystem,
   lastPoemId,
   tutorialSeen: typeof src.tutorialSeen === 'boolean' ? src.tutorialSeen : DEFAULT_SETTINGS.tutorialSeen,
   updatedAt: num(src.updatedAt, 0),
  }
  }

  /** 只保留可写字段（不发送 schemaVersion/updatedAt，host 自己维护）。 */
  export function settingsPatch(input) {
  const src = input && typeof input === 'object' ? input : {}
  const normalized = normalizeSettings(src)
  const out = {}
  for (let i = 0; i < WRITE_KEYS.length; i++) {
   const key = WRITE_KEYS[i]
   if (hasOwn(src, key)) out[key] = normalized[key]
  }
  return out
  }

  /** PUT 请求描述（纯函数，便于单测断言 URL/body 序列化）。 */
  export function buildSettingsRequest(patch) {
  return {
   url: SETTINGS_URL,
   init: {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settingsPatch(patch)),
    keepalive: true,
   },
  }
  }

  /**

  */
  export function createSettingsSaver(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const put = typeof opts.put === 'function' ? opts.put : () => Promise.resolve()
  const delay = Math.max(0, num(opts.delay, SAVE_DEBOUNCE_MS))
  const onError = typeof opts.onError === 'function' ? opts.onError : null
  const onSaved = typeof opts.onSaved === 'function' ? opts.onSaved : null
  let timer = null
  let pending = null
  let disposed = false

  function flush() {
   if (timer) {
    clearTimeout(timer)
    timer = null
   }
   if (!pending) return Promise.resolve()
   const body = pending
   pending = null
   let request
   try {
    request = Promise.resolve(put(body))
   } catch (error) {
    request = Promise.reject(error)
   }
   return request.then(
    (result) => {
    if (onSaved) {
     try {
      onSaved(result)
     } catch (error) {
     }
    }
    return result
    },
    (error) => {
    if (onError) {
     try {
      onError(error)
     } catch (ignored) {
     }
    }
    throw error
    },
   )
  }

  function save(patch) {
   if (disposed) return
   if (patch && typeof patch === 'object') {
    pending = Object.assign({}, pending || {}, patch)
   }
   if (timer) clearTimeout(timer)
   timer = setTimeout(() => {
    timer = null
    flush().catch(() => {})
   }, delay)
  }

  function dispose() {
   disposed = true
   if (timer) {
    clearTimeout(timer)
    timer = null
   }
   pending = null
  }

  return { save, flush, dispose }
  }

  /**

  */
  export function selectNextPoemId(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const items = (Array.isArray(opts.items) ? opts.items : []).filter((item) => item && item.id)
  if (!items.length) return null
  const mode = opts.mode === 'random' ? 'random' : 'daily'
  const currentId = opts.currentId || null
  const todayId = opts.todayId || null
  if (mode === 'random') {
   const random = typeof opts.random === 'function' ? opts.random : Math.random
   let index = Math.floor(num(random(), 0) * items.length)
   if (!Number.isFinite(index) || index < 0) index = 0
   if (index >= items.length) index = items.length - 1
   if (items.length > 1 && items[index].id === currentId) index = (index + 1) % items.length
   return items[index].id
  }
  if (todayId && currentId !== todayId && items.some((item) => item.id === todayId)) {
   return todayId
  }
  const currentIndex = items.findIndex((item) => item.id === currentId)
  return items[(currentIndex + 1) % items.length].id
  }

