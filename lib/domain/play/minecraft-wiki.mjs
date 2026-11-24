// @ts-check
// Minecraft 中文 Wiki 检索：优先用 wiki 正文回答“怎么做”，视频只作兜底。
export const MINECRAFT_WIKI_API = 'https://zh.minecraft.wiki/api.php'
const USER_AGENT = 'dsh-little-whale/1.0 (Minecraft assistant; local)'
const MAX_PARSE = 60000
const MAX_MATERIAL = 2500
const MAX_SECTIONS = 3
function clean(text, max) { return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
const MATERIAL_PREFIX = ['下界合金', '钻石', '金', '铁', '石', '木', '皮革', '锁链']
const NOISY_TITLE = ['版本', '概览', '更新', '历史', '未使用', '已移除', '分类', '快照', 'JE', 'BE']
const FILLER = ['怎么', '怎样', '如何', '怎么办', '为什么', '什么', '哪些', '哪个', '可以', '能不能', '我要', '我想', '应该', '需要', '一下', '的方法', '方法', '教程', '攻略', '做', '造', '搭', '弄', '获得', '获取', '制作', '合成', '使用', '用', '吗', '呢', '呀', '的', '了']
/** 提问式查询去掉口水词，只留实体词；多候选取第一个能搜到的。 */
/** “石镐”这类物品名在 wiki 里常是“镐”，需要去掉材质前缀再搜。 */
export function itemNameVariants(text) {
  const out = []
  for (const raw of String(text ?? '').split(/\s+/)) {
    if (raw.length < 2) continue
    out.push(raw)
    for (const prefix of MATERIAL_PREFIX) {
      if (raw.startsWith(prefix) && raw.length > prefix.length) out.push(raw.slice(prefix.length))
    }
  }
  return out
}
export function searchQueries(text) {
  let cleaned = String(text ?? '').toLowerCase()
  for (const word of FILLER) cleaned = cleaned.split(word).join(' ')
  const words = cleaned.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 1 && !/^[a-z]$/.test(item))
  const out = []
  const push = (value) => { const v = value.trim(); if (v.length > 0 && !out.includes(v)) out.push(v) }
  for (const variant of itemNameVariants(words.join(' '))) push(variant)
  push(words.slice(0, 3).join(' '))
  push(words.slice(0, 2).join(' '))
  if (words.length > 0) push(words[0])
  return out.slice(0, 3)
}
function tokens(text) {
  const raw = String(text ?? '').toLowerCase()
  const words = raw.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2)
  const cjk = (raw.match(/[\u4e00-\u9fa5]{2,}/gu) || []).flatMap((chunk) => chunk.length <= 4 ? [chunk] : [chunk.slice(0, 2), chunk.slice(-2)])
  return [...new Set([...words, ...cjk])]
}
/** 标题命中权重最高，其次摘要命中；用于在几个候选里挑最相关的一页。 */
export function scoreCandidate(query, candidate = {}) {
  const q = tokens(query)
  if (q.length === 0) return 0
  const title = String(candidate.title ?? '').toLowerCase()
  const snippet = String(candidate.snippet ?? '').replace(/<[^>]+>/g, '')
  let score = 0
  for (const token of q) {
    if (title === token) score += 6
    else if (title.includes(token)) score += 3
    if (snippet.toLowerCase().includes(token)) score += 1
  }
  // 物品/方块页通常是短标题，且会原样出现在提问里；这条能压掉“Java版xx版本”这类噪声页。
  if (title.length >= 1 && title.length <= 6 && String(query ?? '').toLowerCase().includes(title)) score += 8
  for (const noisy of NOISY_TITLE) if (title.includes(noisy)) score -= 4
  if (/^(java|bedrock|基岩)版/i.test(String(candidate.title ?? ''))) score -= 6
  if (title.length > 16) score -= 1
  return score
}
function stripMarkup(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''?/g, '')
    .replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2')
    .replace(/^=+\s*(.+?)\s*=+\s*$/gm, '## $1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
/** 把正文切成“导语 + 按小节分组”的结构。 */
export function splitSections(text) {
  const lines = stripMarkup(text).split('\n')
  const intro = []
  const sections = []
  let current = null
  for (const line of lines) {
    const heading = line.match(/^##\s*(.+)$/)
    if (heading) {
      current = { title: clean(heading[1], 40), body: [] }
      sections.push(current)
    } else if (line.trim().length > 0) {
      if (current === null) intro.push(line.trim())
      else current.body.push(line.trim())
    }
  }
  return { intro, sections }
}
const SECTION_WEIGHTS = [
  ['使用', 5], ['用途', 5], ['睡眠', 5], ['睡觉', 5], ['种植', 4], ['行为', 4], ['机制', 4], ['战斗', 4], ['养殖', 4],
  ['放置', 3], ['延展', 3], ['交易', 3], ['获取', -3], ['合成', -2], ['生成', -3], ['掉落', -3], ['数据值', -4],
  ['历史', -5], ['画廊', -5], ['参考', -5], ['另见', -5], ['导航', -5],
]
function sectionWeight(title) {
  let weight = 0
  for (const [word, value] of SECTION_WEIGHTS) if (title.includes(word)) weight += Number(value)
  return weight
}
function pickSection(query, sections) {
  let best = null
  let bestScore = 0
  for (const section of sections) {
    const score = scoreCandidate(query, { title: section.title, snippet: section.body.slice(0, 3).join(' ') }) + sectionWeight(section.title)
    if (score > bestScore) { best = section; bestScore = score }
  }
  return best
}
function toSteps(lines, limit = 5) {
  const sentences = []
  const skip = /^(##|==)|不会生成|没有生成|仅?在.{0,6}版本|历史|画廊|参考|另见/
  for (const line of lines) {
    if (skip.test(line)) continue
    for (const part of line.split(/(?<=[。！？；])/)) {
      const text = clean(part, 140)
      if (text.length >= 8 && !skip.test(text) && sentences.length < limit) sentences.push(text)
    }
  }
  return sentences
}
export function buildWikiGuide(query, page = {}) {
  const text = String(page.extract ?? '').trim().slice(0, MAX_PARSE)
  if (text.length === 0) return null
  const { intro, sections } = splitSections(text)
  const method = clean(intro.slice(0, 2).join(' '), 220)
  const section = pickSection(query, sections)
  // 先按查询+小节权重排序，再把最多 3 节合成材料；不做“按总长度硬截断”，避免用法被切掉。
  const ranked = sections
    .map((item) => ({ item, score: scoreCandidate(query, { title: item.title, snippet: item.body.slice(0, 3).join(' ') }) + sectionWeight(item.title) }))
    .filter((entry) => entry.item.body.length > 0)
    .sort((a, b) => b.score - a.score)
  const merged = []
  const materialLines = []
  let used = 0
  // 先取加权最高的小节；材料不足 800 字时继续往下补，避免只有一两句话可提炼。
  for (const entry of ranked) {
    if (merged.length >= MAX_SECTIONS && used >= 800) break
    for (const line of entry.item.body) {
      if (used + line.length > MAX_MATERIAL) break
      materialLines.push(line)
      used += line.length + 1
    }
    merged.push(entry.item.title)
  }
  const steps = toSteps(materialLines.length > 0 ? materialLines : intro, 5)
  return {
    method: method || clean(steps[0], 220),
    steps: steps.length > 0 ? steps : ['wiki 里有条目，但没有可直接照做的步骤；可以打开原文看细节'],
    caveat: section ? `来自 wiki 小节「${section.title}」` : '来自 wiki 导语',
    material: (materialLines.length > 0 && used >= 200 ? materialLines.join('\n') : [intro.join(' '), ...materialLines].filter(Boolean).join('\n')).slice(0, MAX_MATERIAL),
    sections: merged,
    title: clean(page.title, 80),
    url: page.url || '',
    source: 'wiki',
  }
}
export function createWikiGuide(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const timeoutMs = Math.max(3000, Math.min(30000, Number(options.timeoutMs) || 12000))
  const maxPages = Math.max(1, Math.min(8, Number(options.maxPages) || 5))
  const summarize = typeof options.summarize === 'function' ? options.summarize : null
  async function get(params) {
    const url = MINECRAFT_WIKI_API + '?' + new URLSearchParams({ format: 'json', ...params }).toString()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal })
      if (!response || response.ok !== true) return null
      return await response.json()
    } catch (_error) { return null } finally { clearTimeout(timer) }
  }
  async function lookup(input = {}) {
    const query = clean(`${input.topic ?? ''} ${input.question ?? ''}`, 120)
    if (query.length === 0) return { ok: false, error: 'topic_required' }
    // 多个查询变体的结果合并去重：只取第一个有结果的变体会漏掉正确条目（例如“桶”）。
    const byId = new Map()
    for (const attempt of searchQueries(query)) {
      const found = await get({ action: 'query', list: 'search', srsearch: attempt, srlimit: String(maxPages) })
      const list = found && found.query && Array.isArray(found.query.search) ? found.query.search : []
      for (const hit of list) {
        const key = hit.pageid ?? hit.title
        if (!byId.has(key)) byId.set(key, hit)
      }
      if (byId.size >= maxPages * 4) break
    }
    const hits = [...byId.values()]
    if (hits.length === 0) return { ok: false, error: 'no_wiki_page', query }
    const ranked = hits.map((hit) => ({ ...hit, score: scoreCandidate(query, { title: hit.title, snippet: hit.snippet }) })).sort((a, b) => b.score - a.score)
    // 取相关度最高的那一页；只有它没有正文时才看下一个候选。
    let guide = null
    for (const candidate of ranked.slice(0, 2)) {
      const page = await get({ action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: candidate.title })
      const pages = page && page.query && page.query.pages ? Object.values(page.query.pages) : []
      const found = pages.find((item) => item && typeof item.extract === 'string')
      if (!found) continue
      guide = buildWikiGuide(query, { ...found, url: 'https://zh.minecraft.wiki/w/' + encodeURIComponent(found.title) })
      if (guide !== null) break
    }
    if (guide === null) return { ok: false, error: 'wiki_extract_failed', title: ranked[0].title }
    // 把 wiki 原文句子提炼成“她能在游戏里照做”的步骤；模型失败就用原文兜底。
    if (summarize !== null) {
      const refined = await summarize({ query, question: String(input.question ?? ''), guide }).catch(() => null)
      if (refined && Array.isArray(refined.steps) && refined.steps.length > 0) {
        guide.method = typeof refined.method === 'string' && refined.method.length > 0 ? refined.method : guide.method
        guide.steps = refined.steps.slice(0, 6).map((step) => String(step).slice(0, 140))
        if (typeof refined.caveat === 'string' && refined.caveat.length > 0) guide.caveat = refined.caveat
        guide.refined = true
      }
    }
    return { ok: true, cached: false, query, guide, candidates: ranked.slice(0, maxPages).map((item) => item.title) }
  }
  return { lookup, api: MINECRAFT_WIKI_API }
}
