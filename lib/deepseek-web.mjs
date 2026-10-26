// lib/deepseek-web.mjs —— DeepSeek Search / Fetch API（可选，按次计费）。
//
// 文档：https://api-docs.deepseek.com/zh-cn/guides/search
//   POST /v1/tools/search  { query, count, need_content, ori_question? }
//   POST /v1/tools/fetch   { url }
// 鉴权用 DeepSeek API Key（Bearer）。Search/Fetch 各 5 元/1000 次成功请求，
// 失败/无结果不计费；QPS Search 100 / Fetch 25。
// 没有 key 时返回 null，调用方回落到自建安全抓取 + Wikipedia 搜索。
import { WebAccessError, validatePublicUrl } from './safe-web.mjs'

export const DEEPSEEK_API_BASE = 'https://api.deepseek.com'
export const DEEPSEEK_SEARCH_PATH = '/v1/tools/search'
export const DEEPSEEK_FETCH_PATH = '/v1/tools/fetch'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {{apiKey?: string, baseUrl?: string, fetchImpl?: Function, timeoutMs?: number,
 *   logger?: {warn?: Function, info?: Function}|null, retries?: number}} [options]
 * @returns {null|{search: Function, fetchPage: Function, snapshot: Function}}
 */
export function createDeepSeekWeb(options = {}) {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : ''
  if (apiKey.length === 0) return null
  const baseUrl = (typeof options.baseUrl === 'string' && options.baseUrl.length > 0 ? options.baseUrl : DEEPSEEK_API_BASE).replace(/\/$/, '')
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.floor(options.timeoutMs) : 20000
  const retries = Number.isFinite(options.retries) && options.retries >= 0 ? Math.floor(options.retries) : 1
  const logger = options.logger ?? null
  let searches = 0
  let fetches = 0
  let lastError = null

  async function postJson(pathName, body) {
    let attempt = 0
    for (;;) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        const response = await fetchImpl(`${baseUrl}${pathName}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller !== null ? controller.signal : undefined,
        })
        const status = Number(response?.status ?? 0)
        let payload = null
        try {
          payload = typeof response.json === 'function' ? await response.json() : null
        } catch {
          payload = null
        }
        if (status === 200 && payload !== null) return payload
        const message = payload && payload.error && typeof payload.error.message === 'string' ? payload.error.message : `HTTP ${status}`
        const code =
          status === 401
            ? 'DEEPSEEK_WEB_UNAUTHORIZED'
            : status === 402
              ? 'DEEPSEEK_WEB_NO_BALANCE'
              : status === 429
                ? 'DEEPSEEK_WEB_RATE_LIMITED'
                : status === 403
                  ? 'DEEPSEEK_WEB_BLOCKED'
                  : status === 404
                    ? 'DEEPSEEK_WEB_NOT_FOUND'
                    : 'DEEPSEEK_WEB_HTTP'
        // 408/429/5xx 可重试；其它 4xx 不重试
        if ((status === 408 || status === 429 || status >= 500) && attempt < retries) {
          attempt += 1
          await sleep(400 * attempt)
          continue
        }
        throw new WebAccessError(code, message)
      } catch (error) {
        if (error instanceof WebAccessError) throw error
        if (attempt < retries) {
          attempt += 1
          await sleep(400 * attempt)
          continue
        }
        throw new WebAccessError('DEEPSEEK_WEB_NETWORK', error instanceof Error ? error.message : String(error))
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
    }
  }

  /** 搜索公开网页；返回 [{title,url,snippet,summary,text,siteName,date,authority}]。 */
  async function search(query, searchOptions = {}) {
    const q = String(query ?? '').trim()
    if (q.length === 0 || Array.from(q).length > 128) return []
    const count = Number.isFinite(searchOptions.count) ? Math.min(50, Math.max(1, Math.floor(searchOptions.count))) : 10
    const body = {
      query: q,
      count,
      need_content: searchOptions.needContent === true,
    }
    if (typeof searchOptions.oriQuestion === 'string' && searchOptions.oriQuestion.trim().length > 0) {
      body.ori_question = String(searchOptions.oriQuestion).slice(0, 128)
    }
    try {
      const payload = await postJson(DEEPSEEK_SEARCH_PATH, body)
      searches += 1
      const rows = Array.isArray(payload.results) ? payload.results : []
      const out = []
      for (const row of rows) {
        if (!row || typeof row.url !== 'string') continue
        let url = ''
        try {
          url = validatePublicUrl(row.url).toString()
        } catch {
          continue
        }
        const content = typeof row.content === 'string' ? row.content : ''
        const summary = typeof row.summary === 'string' ? row.summary : ''
        const snippet = typeof row.snippet === 'string' ? row.snippet : ''
        out.push({
          title: typeof row.title === 'string' ? row.title.trim().slice(0, 200) : url,
          url,
          snippet,
          summary,
          text: content || summary || snippet,
          siteName: typeof row.site_name === 'string' ? row.site_name : null,
          date: typeof row.date === 'string' ? row.date : null,
          authority: Number.isFinite(row.authority) ? row.authority : -1,
          rerankScore: Number.isFinite(row.rerank_score) ? row.rerank_score : 0,
        })
      }
      return out
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      try {
        logger?.warn?.(`[dsh-little-whale] DeepSeek 搜索不可用：${lastError}`)
      } catch {
        /* ignore */
      }
      return []
    }
  }

  /** 抓取单页 Markdown（DeepSeek 服务端抓取）。 */
  async function fetchPage(rawUrl) {
    let url = ''
    try {
      url = validatePublicUrl(rawUrl).toString()
    } catch (error) {
      throw error instanceof WebAccessError ? error : new WebAccessError('INVALID_URL', 'URL 不合法')
    }
    try {
      const payload = await postJson(DEEPSEEK_FETCH_PATH, { url })
      fetches += 1
      return {
        url,
        title: typeof payload.title === 'string' ? payload.title : '',
        text: typeof payload.content === 'string' ? payload.content : '',
        html: '',
        contentType: 'text/markdown',
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  function snapshot() {
    return { enabled: true, baseUrl, searches, fetches, lastError }
  }

  return { search, fetchPage, snapshot }
}
