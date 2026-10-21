// lib/weather.mjs —— 「根据天气推荐古诗词」的宿主侧天气能力（Open-Meteo，免密钥）。
//
// 契约（docs/contract.md v1.3 §2.9）：
//   GET /api/dsh-poetry/weather.json 永远 HTTP 200：
//     成功 {ok:true, city, weather:{category,label,tempC,feelsLikeC,humidity,windKph,isDay,code,
//           latitude,longitude,updatedAt,source:"open-meteo"}, stale:false}
//     失败 {ok:false, error:{code:"WEATHER_UNAVAILABLE", message}}
//   地理编码缓存 24h（进程内 Map，上限 ~20 城市）；天气缓存 20min；
//   请求超时 6s；请求失败回退上次天气并标 stale:true；无缓存则 ok:false。
//
// 设计：映射逻辑是纯函数（mapWeather / normalizeCity），网络访问封装在
// createWeatherService({fetchImpl, now, timeoutMs, ...})，便于单测注入 mock fetch 与假时钟。
/** 默认城市（settings.weatherCity 的默认值/归一目标）。 */
export const DEFAULT_CITY = '北京'

/** 地理编码结果缓存 TTL：24 小时。 */
export const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000
/** 当前天气缓存 TTL：20 分钟。 */
export const FORECAST_TTL_MS = 20 * 60 * 1000
/** 单次 Open-Meteo 请求超时：6 秒。 */
export const REQUEST_TIMEOUT_MS = 6000
/** 缓存条目上限（地理编码 / 天气各自独立计数）。 */
export const MAX_CACHE_ENTRIES = 20

const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const FORECAST_CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'weather_code',
  'wind_speed_10m',
].join(',')

/** WMO weather code → 契约 category；未覆盖的码返回 null（由风速/温度规则兜底）。 */
const CODE_CATEGORIES = new Map([
  [0, 'clear'],
  [1, 'cloud'],
  [2, 'cloud'],
  [3, 'cloud'],
  [45, 'fog'],
  [48, 'fog'],
  ...[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].map((code) => [code, 'rain']),
  ...[71, 73, 75, 77, 85, 86].map((code) => [code, 'snow']),
  ...[95, 96, 99].map((code) => [code, 'thunder']),
])

/** WMO weather code → 中文天气描述（客户端直接展示）。 */
const CODE_LABELS = new Map([
  [0, '晴'],
  [1, '晴间多云'],
  [2, '多云'],
  [3, '阴'],
  [45, '雾'],
  [48, '冻雾'],
  [51, '小毛毛雨'],
  [53, '毛毛雨'],
  [55, '大毛毛雨'],
  [56, '冻毛毛雨'],
  [57, '强冻毛毛雨'],
  [61, '小雨'],
  [63, '中雨'],
  [65, '大雨'],
  [66, '冻雨'],
  [67, '强冻雨'],
  [71, '小雪'],
  [73, '中雪'],
  [75, '大雪'],
  [77, '米雪'],
  [80, '小阵雨'],
  [81, '阵雨'],
  [82, '强阵雨'],
  [85, '小阵雪'],
  [86, '强阵雪'],
  [95, '雷阵雨'],
  [96, '雷暴伴冰雹'],
  [99, '强雷暴伴冰雹'],
])

const CATEGORY_LABELS = Object.freeze({
  clear: '晴',
  cloud: '多云',
  fog: '雾',
  rain: '雨',
  snow: '雪',
  thunder: '雷',
  wind: '大风',
  cold: '寒冷',
  unknown: '未知',
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function round(value, digits) {
  if (value === null || value === undefined) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 城市名归一化：trim 后 1–20 个字符（按 Unicode 码点）才有效，否则回退默认「北京」。
 * 控制字符（换行等）同样视为非法。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCity(value) {
  if (typeof value !== 'string') return DEFAULT_CITY
  const trimmed = value.trim()
  if (trimmed.length === 0) return DEFAULT_CITY
  if ([...trimmed].length > 20) return DEFAULT_CITY
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return DEFAULT_CITY
  return trimmed
}

/**
 * 把 Open-Meteo current 数据 + WMO code 映射为契约 §2.9 的 weather 对象（纯函数）。
 * 映射规则（契约 §2.9）：
 *   0→clear；1–3→cloud；45/48→fog；51–57/61–67/80–82→rain；71–77/85–86→snow；95–99→thunder；
 *   非雨雪雷且 windKph≥25→wind；温度≤0 且非雪→cold；其余→unknown。
 * @param {{
 *   code?: number|null, isDay?: boolean|number, tempC?: number|null, feelsLikeC?: number|null,
 *   humidity?: number|null, windKph?: number|null, latitude?: number|null, longitude?: number|null,
 *   updatedAt?: number|null,
 * }} input
 */
export function mapWeather(input = {}) {
  const code = toFiniteNumber(input.code)
  const tempC = toFiniteNumber(input.tempC)
  const feelsLikeC = toFiniteNumber(input.feelsLikeC)
  const humidity = toFiniteNumber(input.humidity)
  const windKph = toFiniteNumber(input.windKph)
  const latitude = toFiniteNumber(input.latitude)
  const longitude = toFiniteNumber(input.longitude)
  const updatedAt = toFiniteNumber(input.updatedAt)
  const isDay = input.isDay === true || input.isDay === 1 || input.isDay === '1'

  const codeInt = code === null ? null : Math.trunc(code)
  const baseCategory = codeInt === null ? null : (CODE_CATEGORIES.get(codeInt) ?? null)
  const baseLabel = codeInt === null ? null : (CODE_LABELS.get(codeInt) ?? null)

  let category = baseCategory
  const isPrecipitation = category === 'rain' || category === 'snow' || category === 'thunder'
  if (!isPrecipitation) {
    if (windKph !== null && windKph >= 25) {
      category = 'wind'
    } else if (tempC !== null && tempC <= 0 && category !== 'snow') {
      category = 'cold'
    }
  }
  if (category === null) category = 'unknown'

  let label
  if (category === 'wind') label = baseLabel === null ? CATEGORY_LABELS.wind : `${baseLabel}，${CATEGORY_LABELS.wind}`
  else if (category === 'cold') label = baseLabel === null ? CATEGORY_LABELS.cold : `${baseLabel}，${CATEGORY_LABELS.cold}`
  else label = baseLabel ?? CATEGORY_LABELS.unknown

  return {
    category,
    label,
    tempC: round(tempC, 1),
    feelsLikeC: round(feelsLikeC, 1),
    humidity: humidity === null ? null : Math.round(humidity),
    windKph: round(windKph, 1),
    isDay,
    code: codeInt,
    latitude,
    longitude,
    updatedAt,
    source: 'open-meteo',
  }
}

/** 统一失败响应体。 */
export function weatherUnavailable(message) {
  return { ok: false, error: { code: 'WEATHER_UNAVAILABLE', message: String(message ?? '天气暂不可用') } }
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 创建天气服务（可注入 fetch/时钟/超时/缓存 TTL，便于单测）。
 * @param {{
 *   fetchImpl?: ((url: string, init?: object) => Promise<unknown>) | null,
 *   now?: () => number,
 *   timeoutMs?: number,
 *   geocodeTtlMs?: number,
 *   forecastTtlMs?: number,
 *   maxCacheEntries?: number,
 * }} [options]
 */
export function createWeatherService(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? (() => Date.now())
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const geocodeTtlMs = options.geocodeTtlMs ?? GEOCODE_TTL_MS
  const forecastTtlMs = options.forecastTtlMs ?? FORECAST_TTL_MS
  const maxCacheEntries = options.maxCacheEntries ?? MAX_CACHE_ENTRIES

  /** @type {Map<string, {geo: {latitude: number, longitude: number}, at: number}>} */
  const geocodeCache = new Map()
  /** @type {Map<string, {weather: object, at: number}>} */
  const forecastCache = new Map()

  function cacheSet(cache, key, entry) {
    // 重新插入以维护 LRU（Map 迭代顺序 = 插入顺序），超上限淘汰最旧条目。
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > maxCacheEntries) {
      const oldest = cache.keys().next().value
      cache.delete(oldest)
    }
  }

  /** 带超时的 JSON GET；超时/HTTP 非 2xx/非法 JSON 都以异常形式抛出。 */
  async function requestJson(url) {
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境没有可用的 fetch')
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let timer = null
    const request = Promise.resolve().then(() => fetchImpl(url, controller === null ? {} : { signal: controller.signal }))
    const races = [request]
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      races.push(
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`请求超时（${timeoutMs}ms）`))
            try {
              controller?.abort()
            } catch {
              /* ignore */
            }
          }, timeoutMs)
        }),
      )
    }
    try {
      const response = await Promise.race(races)
      if (!response || typeof response.ok !== 'boolean') throw new Error('响应格式异常')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  /** 城市 → 坐标（24h 缓存；网络失败时回退过期缓存，没有缓存则失败）。 */
  async function resolveGeocode(city) {
    const key = normalizeCity(city)
    const cached = geocodeCache.get(key)
    if (cached !== undefined && now() - cached.at < geocodeTtlMs) return { ok: true, geo: cached.geo }
    try {
      const url = `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(key)}&count=1&language=zh&format=json`
      const payload = await requestJson(url)
      const first = Array.isArray(payload?.results) ? payload.results[0] : null
      const latitude = toFiniteNumber(first?.latitude)
      const longitude = toFiniteNumber(first?.longitude)
      if (latitude === null || longitude === null) throw new Error('未找到该城市')
      const geo = { latitude, longitude }
      cacheSet(geocodeCache, key, { geo, at: now() })
      return { ok: true, geo }
    } catch (error) {
      if (cached !== undefined) return { ok: true, geo: cached.geo }
      return { ok: false, message: `城市「${key}」解析失败：${shortMessage(error)}` }
    }
  }

  /** 坐标 → 当前天气（20min 缓存；失败回退 stale 缓存）。 */
  async function fetchWeather(geo) {
    const url =
      `${FORECAST_ENDPOINT}?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      `&current=${FORECAST_CURRENT_FIELDS}&timezone=auto`
    const payload = await requestJson(url)
    const current = isPlainObject(payload?.current) ? payload.current : null
    if (current === null) throw new Error('响应缺少 current 字段')
    return mapWeather({
      code: current.weather_code,
      isDay: current.is_day,
      tempC: current.temperature_2m,
      feelsLikeC: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      windKph: current.wind_speed_10m,
      latitude: geo.latitude,
      longitude: geo.longitude,
      updatedAt: now(),
    })
  }

  async function getWeather(rawCity, requestOptions = {}) {
    try {
      const city = normalizeCity(rawCity)
      const forceRefresh = requestOptions.refresh === true
      const geoResult = await resolveGeocode(city)
      if (!geoResult.ok) return weatherUnavailable(geoResult.message)
      const geo = geoResult.geo
      const cacheKey = `${geo.latitude.toFixed(4)},${geo.longitude.toFixed(4)}`
      const cached = forecastCache.get(cacheKey)
      const fresh = cached !== undefined && now() - cached.at < forecastTtlMs
      if (!forceRefresh && fresh) return { ok: true, city, weather: cached.weather, stale: false }
      try {
        const weather = await fetchWeather(geo)
        cacheSet(forecastCache, cacheKey, { weather, at: now() })
        return { ok: true, city, weather, stale: false }
      } catch (error) {
        if (cached !== undefined) {
          // 契约：失败保留上次结果并标 stale:true（updatedAt 保留上次成功时间）。
          return { ok: true, city, weather: cached.weather, stale: true }
        }
        return weatherUnavailable(`天气获取失败：${shortMessage(error)}`)
      }
    } catch (error) {
      // 兜底：任何未预期异常都收敛成 WEATHER_UNAVAILABLE，路由层永远 200。
      return weatherUnavailable(`天气服务异常：${shortMessage(error)}`)
    }
  }

  /**
   * 只读缓存：取某城市「当前进程内」缓存的天气（不发任何网络请求）。
   * 供 self-talk 等旁路功能在不增加延迟的前提下复用天气上下文；无缓存返回 null。
   * @param {string} [rawCity]
   * @returns {{weather: object, at: number, stale: boolean}|null}
   */
  function peekCached(rawCity) {
    try {
      const key = normalizeCity(rawCity)
      const geoEntry = geocodeCache.get(key)
      if (geoEntry === undefined) return null
      const cacheKey = `${geoEntry.geo.latitude.toFixed(4)},${geoEntry.geo.longitude.toFixed(4)}`
      const cached = forecastCache.get(cacheKey)
      if (cached === undefined) return null
      return { weather: cached.weather, at: cached.at, stale: now() - cached.at >= forecastTtlMs }
    } catch {
      return null
    }
  }

  return {
    getWeather,
    peekCached,
    /** 主动清空进程内缓存（测试/诊断用；正常刷新走路由 ?refresh=1）。 */
    clearCache() {
      geocodeCache.clear()
      forecastCache.clear()
    },
  }
}

/** Open-Meteo 端点（测试可用作断言；生产代码只读常量）。 */
export const WEATHER_ENDPOINTS = Object.freeze({ geocode: GEOCODE_ENDPOINT, forecast: FORECAST_ENDPOINT })

/** 仅用于测试/诊断：暴露端点路径相关常量，不含网络逻辑。 */
export const WEATHER_DEFAULTS = Object.freeze({
  city: DEFAULT_CITY,
  timeoutMs: REQUEST_TIMEOUT_MS,
  geocodeTtlMs: GEOCODE_TTL_MS,
  forecastTtlMs: FORECAST_TTL_MS,
})
