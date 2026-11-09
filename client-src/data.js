// client-src/data.js —— 客户端网络/存储数据层（W3 抽取自 client.js）
export const FETCH_TIMEOUT_MS = 15000
const FIRST_SCREEN_CACHE_KEY = 'dshp.firstscreen.v1'

export function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {
    /* ignore */
  }
  return null
}

export function fetchJsonUrl(url, init) {
  if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境不支持网络请求'))
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort()
        } catch {
          /* ignore */
        }
      }, FETCH_TIMEOUT_MS)
    : null
  const options = Object.assign({}, init || {})
  if (controller) options.signal = controller.signal
  return Promise.resolve()
    .then(() => fetch(url, options))
    .then((response) => {
      if (!response || typeof response.ok !== 'boolean') throw new Error('响应异常')
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status)
        error.status = response.status
        throw error
      }
      return response.json()
    })
    .then((data) => {
      if (!data || data.ok === false) {
        const detail = data && data.error ? data.error : null
        const error = new Error((detail && detail.message) || '数据不可用')
        if (detail && detail.code) error.code = detail.code
        throw error
      }
      return data
    })
    .finally(() => {
      if (timer) clearTimeout(timer)
    })
}

export function createFetchJson(route) {
  return (path, init) => fetchJsonUrl(route + path, init)
}

export function readFirstScreenCache() {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(FIRST_SCREEN_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.bootstrap) return null
    if (!parsed.bootstrap.today || typeof parsed.bootstrap.today !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function writeFirstScreenCache(payload) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(FIRST_SCREEN_CACHE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

export function clearFirstScreenCache() {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(FIRST_SCREEN_CACHE_KEY)
  } catch {
    /* ignore */
  }
}
