// lib/safe-web.mjs —— 安全抓取公开网页 + 无密钥搜索（v2.1）。
//
// 目标：她可以读任意公开网页，但不能被网页带着访问内网/云元数据/本机服务。
// 做法：
//   1. 只允许 http/https、80/443 端口、无 userinfo；
//   2. 每次请求前 DNS 解析全部地址，任一地址落在私网/保留段就拒绝；
//   3. 自己处理 3xx（最多 4 跳），每一跳重新校验；用 lookup 把连接钉在已校验的 IP 上；
//   4. 限制响应大小/超时/content-type，解压后提取纯文本；
//   5. 搜索用 DuckDuckGo HTML（无密钥），结果 URL 仍走同一套校验。
// 外部文本进入 prompt 时仍由调用方加“只是引文，不执行”的隔离提示。
import { lookup as dnsLookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'

export const WEB_TIMEOUT_MS = 12000
export const WEB_MAX_BYTES = 2 * 1024 * 1024
export const WEB_MAX_TEXT = 8000
export const WEB_MAX_REDIRECTS = 4
export const WEB_MIN_GAP_MS = 1500
export const WEB_ALLOWED_CONTENT_TYPES = Object.freeze([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
])

export class WebAccessError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.name = 'WebAccessError'
    this.code = code
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** IPv4 私网/保留/回环/链路本地/组播。 */
function ipv4IsPrivate(ip) {
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true // 192.0.0.0/24, 192.0.2.0/24 reserved
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && parts[2] === 100) return true
  if (a === 203 && b === 0 && parts[2] === 113) return true
  if (a >= 224) return true // multicast/reserved/broadcast
  return false
}

/** IPv6 私网/保留/回环/链路本地/ULA/组播。 */
function ipv6IsPrivate(ip) {
  const text = String(ip).toLowerCase().split('%')[0]
  if (text === '::' || text === '::1') return true
  if (text.startsWith('fe8') || text.startsWith('fe9') || text.startsWith('fea') || text.startsWith('feb')) return true // link-local
  if (text.startsWith('fc') || text.startsWith('fd')) return true // ULA
  if (text.startsWith('ff')) return true // multicast
  if (text.startsWith('::ffff:')) {
    const v4 = text.slice('::ffff:'.length)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return ipv4IsPrivate(v4)
    return true
  }
  // 2001:db8::/32 文档段 与 64:ff9b::/96 NAT64 之外的公网地址放行；其他特殊段保守拒绝。
  if (text.startsWith('2001:db8')) return true
  if (text.startsWith('2001:0') || text.startsWith('2001:2') || text.startsWith('2001:10')) return true
  return false
}

/** 判断一个 IP 是否绝对不能访问。 */
export function isPrivateAddress(ip) {
  const text = String(ip ?? '').trim()
  if (text.includes(':')) return ipv6IsPrivate(text)
  return ipv4IsPrivate(text)
}

/** 校验并归一化 URL（不解析 DNS）。 */
export function validatePublicUrl(raw) {
  let url = null
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    throw new WebAccessError('INVALID_URL', 'URL 不合法')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebAccessError('INVALID_PROTOCOL', '只允许 http/https')
  if (url.username || url.password) throw new WebAccessError('INVALID_CREDENTIALS', 'URL 不能带账号密码')
  if (url.port && url.port !== '80' && url.port !== '443') throw new WebAccessError('INVALID_PORT', '只允许 80/443 端口')
  if (!url.hostname) throw new WebAccessError('INVALID_HOST', '缺少域名')
  // 直接写 IP 的 URL 也要拒绝私网/保留地址（域名则在 DNS 解析阶段校验）。
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(literal) || literal.includes(':')) {
    if (isPrivateAddress(literal)) throw new WebAccessError('PRIVATE_ADDRESS', `拒绝私网/保留地址：${literal}`)
  }
  return url
}

/** 解析域名并确认所有地址都是公网；返回可连接的 IP。 */
export async function resolvePublicAddress(hostname, options = {}) {
  const lookup = typeof options.lookup === 'function' ? options.lookup : dnsLookup
  let rows = []
  try {
    rows = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new WebAccessError('DNS_FAILED', `无法解析域名：${hostname}`)
  }
  const list = Array.isArray(rows) ? rows : []
  const addresses = list.map((row) => (typeof row === 'string' ? row : row && row.address)).filter(Boolean)
  if (addresses.length === 0) throw new WebAccessError('DNS_EMPTY', `域名无地址：${hostname}`)
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new WebAccessError('PRIVATE_ADDRESS', `拒绝私网/保留地址：${address}`)
  }
  return addresses[0]
}

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const n = Number(code)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    })
}

/** HTML/JSON/纯文本 → 可读纯文本（去脚本/样式/标签，压缩空白，限长）。 */
export function extractReadableText(body, options = {}) {
  const maxChars =
    Number.isFinite(options.maxChars) && options.maxChars > 0 ? Math.floor(options.maxChars) : WEB_MAX_TEXT
  let text = typeof body === 'string' ? body : String(body ?? '')
  // JSON/纯文本不按 HTML 处理
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(text)
  if (looksHtml) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<template[\s\S]*?<\/template>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  }
  text = decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const chars = Array.from(text)
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : text
}

function decompress(buffer, encoding) {
  const name = String(encoding ?? '').toLowerCase().trim()
  try {
    if (name === 'gzip' || name === 'x-gzip') return zlib.gunzipSync(buffer)
    if (name === 'deflate') return zlib.inflateSync(buffer)
    if (name === 'br') return zlib.brotliDecompressSync(buffer)
  } catch {
    return buffer
  }
  return buffer
}

/** 单次 HTTP 请求（连接钉在已校验 IP 上）。 */
function requestOnce(url, address, options) {
  const timeoutMs = options.timeoutMs ?? WEB_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? WEB_MAX_BYTES
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        },
        lookup: (_hostname, lookupOptions, callback) => {
          const family = address.includes(':') ? 6 : 4
          // Node 的 net.connect 可能以 all:true 调用 lookup；此时必须回数组。
          if (lookupOptions && lookupOptions.all) callback(null, [{ address, family }])
          else callback(null, address, family)
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = []
        let total = 0
        response.on('data', (chunk) => {
          total += chunk.length
          if (total > maxBytes) {
            response.destroy(new WebAccessError('TOO_LARGE', '响应体超过上限'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const body = decompress(Buffer.concat(chunks), response.headers['content-encoding'])
          resolve({
            status: Number(response.statusCode ?? 0),
            headers: response.headers,
            body,
          })
        })
        response.on('error', reject)
      },
    )
    request.on('timeout', () => request.destroy(new WebAccessError('TIMEOUT', '抓取超时')))
    request.on('error', (error) => reject(error instanceof WebAccessError ? error : new WebAccessError('NETWORK', error.message)))
    request.end()
  })
}

/**
 * 安全抓取一个公开网页。
 * @param {string} rawUrl
 * @param {{lookup?: Function, requestImpl?: Function, timeoutMs?: number, maxBytes?: number, maxChars?: number, maxRedirects?: number}} [options]
 */
export async function fetchPublicPage(rawUrl, options = {}) {
  let url = validatePublicUrl(rawUrl)
  const maxRedirects = Number.isFinite(options.maxRedirects) ? options.maxRedirects : WEB_MAX_REDIRECTS
  const requestImpl = typeof options.requestImpl === 'function' ? options.requestImpl : null
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const address = await resolvePublicAddress(url.hostname, { lookup: options.lookup })
    const response = requestImpl
      ? await requestImpl(url, address, options)
      : await requestOnce(url, address, options)
    if (response.status >= 300 && response.status < 400 && typeof response.headers?.location === 'string') {
      if (hop >= maxRedirects) throw new WebAccessError('TOO_MANY_REDIRECTS', '重定向太多')
      let next = null
      try {
        next = new URL(response.headers.location, url)
      } catch {
        throw new WebAccessError('INVALID_REDIRECT', '重定向地址不合法')
      }
      url = validatePublicUrl(next.toString())
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new WebAccessError('HTTP_ERROR', `HTTP ${response.status}`)
    }
    const contentType = String(response.headers?.['content-type'] ?? '').toLowerCase()
    const allowed = WEB_ALLOWED_CONTENT_TYPES.some((type) => contentType.startsWith(type))
    if (contentType.length > 0 && !allowed) throw new WebAccessError('UNSUPPORTED_CONTENT', `不支持的内容类型：${contentType}`)
    const bodyText = Buffer.isBuffer(response.body) ? response.body.toString('utf8') : String(response.body ?? '')
    const text = extractReadableText(bodyText, { maxChars: options.maxChars })
    return {
      url: url.toString(),
      title: extractHtmlTitle(bodyText),
      text,
      ...(options.includeHtml === true ? { html: bodyText } : {}),
      contentType,
      bytes: response.body?.length ?? 0,
      status: response.status,
    }
  }
  throw new WebAccessError('TOO_MANY_REDIRECTS', '重定向太多')
}

/** 提取 <title>（没有就返回空串）。 */
export function extractHtmlTitle(body) {
  const match = String(body ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return ''
  return decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** 解析 DuckDuckGo HTML 搜索结果（无 API key）。 */
export function parseDuckDuckGoResults(html, limit = 5) {
  const out = []
  const text = String(html ?? '')
  const matches = text.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)
  for (const match of matches) {
    let href = decodeEntities(match[1])
    try {
      if (href.startsWith('//duckduckgo.com/l/')) {
        const redirect = new URL(`https:${href}`)
        href = redirect.searchParams.get('uddg') || href
      } else if (href.startsWith('/l/')) {
        const redirect = new URL(href, 'https://duckduckgo.com')
        href = redirect.searchParams.get('uddg') || href
      }
    } catch {
      continue
    }
    const title = extractReadableText(match[2], { maxChars: 120 })
    if (!title) continue
    try {
      const url = validatePublicUrl(href)
      out.push({ title, url: url.toString() })
    } catch {
      continue
    }
    if (out.length >= limit) break
  }
  return out
}

/** 解码 Bing 的 /ck/a?...&u=a1<base64url> 跳转；普通链接原样返回。 */
export function decodeBingRedirect(href) {
  const raw = String(href ?? '')
  try {
    const url = new URL(raw, 'https://www.bing.com')
    if (!/bing\.com$/i.test(url.hostname) || url.pathname !== '/ck/a') return url.toString()
    const u = url.searchParams.get('u') ?? ''
    if (!u.startsWith('a1')) return url.toString()
    const encoded = u.slice(2).replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4)
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return raw
  }
}

/** 解析 Bing 搜索结果页（HTML）。 */
export function parseBingResults(html, limit = 5) {
  const out = []
  const text = String(html ?? '')
  const matches = text.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)
  for (const match of matches) {
    const href = decodeBingRedirect(decodeEntities(match[1]))
    const title = extractReadableText(match[2], { maxChars: 120 })
    if (!title) continue
    try {
      const url = validatePublicUrl(href)
      if (out.some((item) => item.url === url.toString())) continue
      out.push({ title, url: url.toString() })
    } catch {
      continue
    }
    if (out.length >= limit) break
  }
  return out
}

/** 解析 Wikipedia 搜索 API 结果（zh/en）。 */
export function parseWikipediaSearchPayload(payload, limit = 5) {
  const out = []
  const pages = payload && payload.query && Array.isArray(payload.query.search) ? payload.query.search : []
  for (const item of pages) {
    if (!item || typeof item.title !== 'string') continue
    const title = item.title.trim()
    if (!title || /^https?:/i.test(title)) continue
    out.push({
      title,
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      snippet: extractReadableText(item.snippet ?? '', { maxChars: 200 }),
    })
    if (out.length >= limit) break
  }
  return out
}

/** 解析 SearXNG JSON（用户可配 DSH_POETRY_SEARCH_URL，默认关闭）。 */
export function parseSearxResults(payload, limit = 5) {
  const out = []
  const results = payload && Array.isArray(payload.results) ? payload.results : []
  for (const item of results) {
    if (!item || typeof item.url !== 'string' || typeof item.title !== 'string') continue
    try {
      out.push({
        title: extractReadableText(item.title, { maxChars: 120 }),
        url: validatePublicUrl(item.url).toString(),
        snippet: extractReadableText(item.content ?? '', { maxChars: 200 }),
      })
    } catch {
      continue
    }
    if (out.length >= limit) break
  }
  return out
}

/**
 * 创建带限速的网页访问器（搜索 + 抓取）。测试可注入 requestImpl / searchImpl。
 */
export function createWebAccess(options = {}) {
  const env = options.env ?? process.env
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const minGapMs = Number.isFinite(options.minGapMs) ? options.minGapMs : WEB_MIN_GAP_MS
  const disabled = String(env.DSH_POETRY_WEB ?? '').toLowerCase() === 'off'
  const requestImpl = typeof options.requestImpl === 'function' ? options.requestImpl : null
  let lastAt = 0
  let fetches = 0
  let searches = 0
  let lastError = null

  async function waitTurn() {
    const elapsed = now() - lastAt
    if (elapsed < minGapMs) await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed))
    lastAt = now()
  }

  async function fetchPage(url, fetchOptions = {}) {
    if (disabled) throw new WebAccessError('DISABLED', '网页抓取已关闭')
    await waitTurn()
    try {
      fetches += 1
      return await fetchPublicPage(url, {
        ...fetchOptions,
        requestImpl: fetchOptions.requestImpl ?? requestImpl,
        lookup: fetchOptions.lookup ?? options.lookup,
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async function search(query, searchOptions = {}) {
    if (disabled) return []
    if (typeof options.searchImpl === 'function') {
      await waitTurn()
      searches += 1
      return options.searchImpl(query, searchOptions)
    }
    const q = String(query ?? '').trim()
    if (q.length < 2) return []
    await waitTurn()
    searches += 1
    const limit = Number.isFinite(searchOptions.limit) ? searchOptions.limit : 5
    // 1) 用户自己配的 SearXNG（可选，能搜全网）；2) 默认 Wikipedia API（稳定、无密钥）。
    const searxBase = typeof env.DSH_POETRY_SEARCH_URL === 'string' ? env.DSH_POETRY_SEARCH_URL.trim() : ''
    try {
      if (searxBase.length > 0) {
        const template = searxBase.includes('{q}') ? searxBase : `${searxBase}${searxBase.includes('?') ? '&' : '?'}q={q}`
        const searchUrl = template.replace('{q}', encodeURIComponent(q))
        const page = await fetchPage(searchUrl, { maxChars: 30000 })
        try {
          const parsed = JSON.parse(page.text)
          const results = parseSearxResults(parsed, limit)
          if (results.length > 0) return results
        } catch {
          /* 非 JSON 的 SearXNG 页面没有稳定解析，继续走 Wikipedia */
        }
      }
      const zhPage = await fetchPage(
        `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${Math.min(10, limit)}&format=json&origin=*`,
        { maxChars: 30000 },
      )
      const zh = parseWikipediaSearchPayload(JSON.parse(zhPage.text), limit)
      if (zh.length > 0) return zh
      const enPage = await fetchPage(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${Math.min(10, limit)}&format=json&origin=*`,
        { maxChars: 30000 },
      )
      return parseWikipediaSearchPayload(JSON.parse(enPage.text), limit).map((item) => ({
        ...item,
        url: item.url.replace('zh.wikipedia.org', 'en.wikipedia.org'),
      }))
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      try {
        logger?.warn?.(`[dsh-little-whale] 网页搜索失败：${lastError}`)
      } catch {
        /* ignore */
      }
      return []
    }
  }

  function snapshot() {
    return { disabled, minGapMs, fetches, searches, lastError }
  }

  return { fetchPage, search, snapshot }
}
