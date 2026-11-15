// client-src/widget/models/weather-model.js —— 天气 → 形象状态 / 天气选诗池 / 天气请求。
import { num } from '../../base.js'
import { hashString } from './utils.js'
import { fetchJson } from './api.js'
import { ASSET_BASE, MASCOT_DIR, MASCOT_FILES, WEATHER_CATEGORY_TAGS, WEATHER_EXPLAIN, WEATHER_NIGHT_TAGS, WEATHER_POOL_LIMIT } from './constants.js'

  export let weatherCache = null

  /** 形象状态 key：飞花令脉冲（gameWin/gameLose/gameThink）由调用方优先叠加。 */
  export function weatherPoemTags(weather) {
  if (!weather || typeof weather !== 'object') return []
  const tags = []
  const push = (list) => {
   for (const tag of list) if (tags.indexOf(tag) < 0) tags.push(tag)
  }
  push(WEATHER_CATEGORY_TAGS[weather.category] || [])
  if (weather.isDay === false || weather.isDay === 0) push(WEATHER_NIGHT_TAGS)
  return tags
  }

  export function countWeatherTagHits(lines, tags) {
  const text = (Array.isArray(lines) ? lines : []).join('')
  if (!text) return 0
  let hits = 0
  for (const tag of Array.isArray(tags) ? tags : []) {
   if (!tag) continue
   let from = 0
   while (from <= text.length) {
    const at = text.indexOf(tag, from)
    if (at < 0) break
    hits += 1
    from = at + tag.length
   }
  }
  return hits
  }

  export function buildWeatherPoemPool(poemsData, ciData, tags, limit, extraSources) {
  const poolLimit = Math.max(0, num(limit, WEATHER_POOL_LIMIT))
  const safeTags = (Array.isArray(tags) ? tags : []).filter((tag) => typeof tag === 'string' && tag.length > 0)
  if (!safeTags.length || !poolLimit) return []
  const build = (items, kind) => {
   const out = []
   for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.id) continue
    const hits = countWeatherTagHits(item.lines, safeTags)
    if (hits > 0) out.push({ kind, id: item.id, hits, item })
   }
   out.sort((a, b) => b.hits - a.hits || String(a.id).localeCompare(String(b.id)))
   return out
  }
  const extras = extraSources && typeof extraSources === 'object' ? extraSources : {}
  const sources = [
   [poemsData && poemsData.items, 'poem'],
   [ciData && ciData.items, 'ci'],
   [extras.anthology && extras.anthology.items, 'anthology'],
   [extras.bank && extras.bank.items, 'bank'],
   [extras.ciBank && extras.ciBank.items, 'ci-bank'],
  ]
  const pool = []
  for (const source of sources) {
   if (pool.length >= poolLimit) break
   const entries = build(source[0], source[1]).slice(0, poolLimit - pool.length)
   for (const entry of entries) pool.push(entry)
  }
  return pool
  }

  /** 今日天气诗：hash(date + category + dataVersion) % pool.length（与 todayPoemId 同思路但独立）。 */
  export function selectWeatherPoemEntry(pool, meta) {
  if (!Array.isArray(pool) || !pool.length) return null
  const date = meta && meta.date ? String(meta.date) : ''
  const category = meta && meta.category ? String(meta.category) : ''
  const dataVersion = meta && meta.dataVersion ? String(meta.dataVersion) : ''
  const index = Math.abs(hashString(date + '|' + category + '|' + dataVersion)) % pool.length
  return pool[index]
  }

  export function weatherChipText(city, weather) {
  if (!weather || typeof weather !== 'object') return ''
  const place = typeof city === 'string' && city ? city : ''
  const label = typeof weather.label === 'string' && weather.label ? weather.label : '天气'
  const tempC = Number(weather.tempC)
  const temp = Number.isFinite(tempC) ? Math.round(tempC) + '℃' : ''
  return (place ? place + ' · ' : '') + label + (temp ? ' ' + temp : '')
  }

  export function weatherExplainText(weather) {
  if (!weather || typeof weather !== 'object') return ''
  const category = typeof weather.category === 'string' ? weather.category : 'unknown'
  const night = weather.isDay === false || weather.isDay === 0
  if (night && (category === 'clear' || category === 'cloud' || category === 'unknown')) {
   return '今夜月色正好，为你选了写月夜的这首'
  }
  return WEATHER_EXPLAIN[category] || WEATHER_EXPLAIN.unknown
  }

  export function weatherUpdatedLabel(at) {
  const time = Number(at)
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
  }

  export function requestWeather() {
  return fetchJson('weather.json').then((data) => {
   if (!data || data.ok !== true || !data.weather) throw new Error('天气数据不可用')
   weatherCache = { data, at: Date.now() }
   return data
  })
  }

  export function clearWeatherCache() {
  weatherCache = null
  }

