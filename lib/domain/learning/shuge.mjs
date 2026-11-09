// lib/shuge.mjs —— 书格（shuge.org）目录/版本数据适配（v2.51）。
//
// 书格以扫描影像本、书目信息和版本介绍为主，不是全文语料。
// 这里只把它当“版本/目录/序跋/收藏信息”的来源；不能把图片目录当正文，
// 也不能从扫描本的书名推演出正文内容。
const BASE = 'https://www.shuge.org'

function cleanInline(value, max = 500) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8230;/g, '…')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function extractId(item) {
  const self = item?._links?.self?.[0]?.href
  const fromSelf = typeof self === 'string' ? self.match(/\/portfolio\/(\d+)/) : null
  if (fromSelf) return fromSelf[1]
  const fromUrl = typeof item?.url === 'string' ? item.url.match(/\/view\/([^/]+)/) : null
  return fromUrl ? fromUrl[1] : ''
}

/** 用 WordPress REST 搜索书格；返回 {title,url,id}。 */
export async function searchShuge(webAccess, query, options = {}) {
  const keyword = String(query ?? '').trim()
  if (keyword.length === 0 || webAccess === null || typeof webAccess.fetchPage !== 'function') return []
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(10, Math.floor(options.limit)) : 5
  const url = `${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(keyword)}&per_page=${limit}`
  try {
    const page = await webAccess.fetchPage(url, { maxChars: 30000 })
    const list = JSON.parse(page.text)
    if (!Array.isArray(list)) return []
    return list
      .filter((item) => item && typeof item.url === 'string' && item.url.includes('/view/'))
      .map((item) => ({ id: String(item.id ?? extractId(item)), title: cleanInline(item.title, 80), url: item.url }))
      .slice(0, limit)
  } catch {
    return []
  }
}

/** 读一条书格条目：标题、版本/目录介绍、扫描本标注。 */
export async function fetchShugeEntry(webAccess, item) {
  if (!item || typeof item.url !== 'string' || webAccess === null || typeof webAccess.fetchPage !== 'function') return null
  const rawId = item.id === null || item.id === undefined ? '' : String(item.id)
  const id = /^\d+$/.test(rawId) ? rawId : extractId(item)
  let payload = null
  if (id) {
    try {
      const page = await webAccess.fetchPage(`${BASE}/wp-json/wp/v2/portfolio/${encodeURIComponent(id)}`, { maxChars: 30000 })
      payload = JSON.parse(page.text)
    } catch {
      payload = null
    }
  }
  let title = cleanInline(item.title || payload?.title?.rendered, 100)
  let text = ''
  if (payload) {
    title = cleanInline(payload.title?.rendered || title, 100)
    const excerpt = cleanInline(payload.excerpt?.rendered, 1200)
    const content = cleanInline(payload.content?.rendered, 6000)
    text = [excerpt, content].filter(Boolean).join('\n')
  }
  return {
    title,
    url: item.url,
    text,
    kind: 'catalog',
    note: '书格为扫描/影像本或书目条目：可作版本、目录、序跋、收藏信息；正文需另找文本，不能把目录当正文。',
  }
}

export function isShugeUrl(url) {
  try {
    return new URL(String(url)).hostname.endsWith('shuge.org')
  } catch {
    return false
  }
}
