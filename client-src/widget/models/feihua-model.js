// client-src/widget/models/feihua-model.js —— 飞花令索引 / 全量句库 / 历史最佳（缓存与请求）。
import { getStorage } from '../../data.js'
import { buildFeihuaIndex, normalizeFeihuaBest } from '../../feihua.js'
import { FEIHUA_BEST_KEY, FEIHUA_FULL_PATH, FEIHUA_FULL_RETRY_MS, FEIHUA_FULL_TIMEOUT_MS, ROUTE } from './constants.js'

  let feihuaIndexCache = { poems: null, ci: null, index: null }

  
  
  
  
  
  
  let feihuaFullCache = {}
  let feihuaFullInflight = {}

  export function clearFeihuaFullCache() {
  feihuaFullCache = {}
  for (const key of Object.keys(feihuaFullInflight)) {
   try {
    if (feihuaFullInflight[key] && typeof feihuaFullInflight[key].abort === 'function') feihuaFullInflight[key].abort()
   } catch (error) {
   }
  }
  feihuaFullInflight = {}
  }

  export function readFeihuaFullCache(char) {
  const key = String(char == null ? '' : char)
  return key ? feihuaFullCache[key] || null : null
  }

  export function abortFeihuaFull(char) {
  const key = String(char == null ? '' : char)
  const item = feihuaFullInflight[key]
  if (item && typeof item.abort === 'function') item.abort()
  delete feihuaFullInflight[key]
  }

  export function requestFeihuaFull(char) {
  const key = String(char == null ? '' : char)
  if (!key) return Promise.resolve({ ok: false, reason: 'invalid' })
  const cached = feihuaFullCache[key]
  if (cached && cached.status === 'ready') {
   return Promise.resolve({ ok: true, char: key, entries: cached.entries, count: cached.count, cached: true })
  }
  if (cached && cached.status === 'error' && Date.now() - cached.at < FEIHUA_FULL_RETRY_MS) {
   return Promise.resolve({ ok: false, char: key, cached: true, reason: 'retry-wait' })
  }
  if (feihuaFullInflight[key]) return feihuaFullInflight[key].promise
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, reason: 'no-fetch' })
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let aborted = false
  let settled = false
  let timer = null
  let abortResolve = null
  const abortPromise = new Promise((resolve) => {
   abortResolve = () => resolve({ ok: false, reason: 'aborted' })
  })
  const item = { promise: null, abort: () => {
   aborted = true
   try {
    if (controller) controller.abort()
   } catch (error) {
   }
   if (abortResolve) abortResolve()
  } }
  const finish = (result) => {
   if (settled) return result
   settled = true
   if (timer) clearTimeout(timer)
   delete feihuaFullInflight[key]
   if (!result.ok && !aborted) feihuaFullCache[key] = { status: 'error', at: Date.now() }
   return result
  }
  const url = ROUTE + FEIHUA_FULL_PATH + '?char=' + encodeURIComponent(key)
  const task = Promise.resolve()
   .then(() => fetch(url, controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) {
     return { ok: false, reason: 'http', status: response ? response.status : 0 }
    }
    return Promise.resolve(response.json()).then((data) => {
     if (!data || data.ok === false || !Array.isArray(data.entries)) return { ok: false, reason: 'invalid' }
     const entries = []
     for (const entry of data.entries) {
      if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === 'string' && entry[0].trim()) {
       entries.push([entry[0].trim(), String(entry[1] == null ? '' : entry[1])])
      } else if (entry && typeof entry === 'object' && typeof entry.text === 'string' && entry.text.trim()) {
       entries.push([entry.text.trim(), String(entry.source || '')])
      }
     }
     if (!entries.length) return { ok: false, reason: 'empty' }
     const count = Number.isFinite(Number(data.count)) && Number(data.count) > 0 ? Math.floor(Number(data.count)) : entries.length
     feihuaFullCache[key] = { status: 'ready', entries, count, at: Date.now() }
     return { ok: true, char: key, entries, count }
    }).catch(() => ({ ok: false, reason: 'json' }))
   })
   .catch(() => ({ ok: false, reason: aborted ? 'aborted' : 'network' }))
  const timeout = new Promise((resolve) => {
   timer = setTimeout(() => {
    try {
     if (controller) controller.abort()
    } catch (error) {
    }
    resolve({ ok: false, reason: 'timeout' })
   }, FEIHUA_FULL_TIMEOUT_MS)
  })
  item.promise = Promise.race([task, timeout, abortPromise]).then(finish)
  feihuaFullInflight[key] = item
  return item.promise
  }

  
  
  
  /** 索引按数据对象引用缓存：换数据（dataVersion 变化）时 clearResourceCache 会一并作废。 */
  export function getFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData) {
  if (!poemsData || !Array.isArray(poemsData.items)) return null
  const cached = feihuaIndexCache
  if (cached.index && cached.poems === poemsData && cached.ci === ciData
   && cached.anthology === anthologyData && cached.bank === bankData
   && cached.ciBank === ciBankData) return cached.index
  const index = buildFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData)
  feihuaIndexCache = { poems: poemsData, ci: ciData, anthology: anthologyData, bank: bankData, ciBank: ciBankData, index }
  return index
  }

  export function clearFeihuaIndexCache() {
  feihuaIndexCache = { poems: null, ci: null, index: null }
  }

  /** 默认令字：今日诗中出现的候选字里句数最多的；否则「花」。 */
  export function pickDefaultFeihuaChar(index, poem) {
  const fallback = '花'
  if (!index || !Array.isArray(index.candidates) || !index.candidates.length) return fallback
  const lines = poem && Array.isArray(poem.lines) ? poem.lines : []
  const text = lines.join('')
  let best = null
  for (const item of index.candidates) {
   if (!item || item.count <= 0) continue
   if (text.indexOf(item.char) < 0) continue
   if (!best || item.count > best.count) best = item
  }
  return best ? best.char : fallback
  }

  
  
  
  
  
    
  
  export function readFeihuaBest() {
  const storage = getStorage()
  if (!storage) return normalizeFeihuaBest(null)
  try {
   const raw = storage.getItem(FEIHUA_BEST_KEY)
   if (!raw) return normalizeFeihuaBest(null)
   return normalizeFeihuaBest(JSON.parse(raw))
  } catch (error) {
   return normalizeFeihuaBest(null)
  }
  }

  export function writeFeihuaBest(best) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(FEIHUA_BEST_KEY, JSON.stringify(normalizeFeihuaBest(best)))
  } catch (error) {
  }
  }
