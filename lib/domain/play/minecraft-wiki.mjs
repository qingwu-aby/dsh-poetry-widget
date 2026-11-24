// @ts-check
// Minecraft 中文 Wiki 检索：优先用 wiki 正文回答“怎么做”，视频只作兜底。
export const MINECRAFT_WIKI_API = 'https://zh.minecraft.wiki/api.php'
const USER_AGENT = 'dsh-little-whale/1.0 (Minecraft assistant; local)'
const MAX_EXTRACT = 6000
function clean(text, max) { return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
const MATERIAL_PREFIX = ['下界合金', '钻石', '金', '铁', '石', '木', '皮革', '锁链']
const NOISY_TITLE = ['版本', '概览', '更新', '历史', '未使用', '已移除', '分类']
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
  const words = cleaned.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2)
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
  for (const noisy of NOISY_TITLE) if (title.includes(noisy)) score -= 4
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
const ACTION_SECTIONS = ['使用', '获取', '行为', '机制', '用途', '种植', '合成', '养殖', '交易', '战斗', '睡眠', '睡觉', '放置', '延展']
function pickSection(query, sections) {
  let best = null
  let bestScore = 0
  for (const section of sections) {
    const hit = scoreCandidate(query, { title: section.title, snippet: section.body.slice(0, 3).join(' ') })
    const action = ACTION_SECTIONS.some((word) => section.title.includes(word)) ? 2 : 0
    const score = hit + action
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
  const text = String(page.extract ?? '').trim().slice(0, MAX_EXTRACT)
  if (text.length === 0) return null
  const { intro, sections } = splitSections(text)
  const method = clean(intro.slice(0, 2).join(' '), 220)
  const section = pickSection(query, sections)
  // 单节信息常常不够用：再挑一个行动向小节合并，最多两节。
  const ranked = sections
    .map((item) => ({ item, score: scoreCandidate(query, { title: item.title, snippet: item.body.slice(0, 3).join(' ') }) + (ACTION_SECTIONS.some((word) => item.title.includes(word)) ? 2 : 0) }))
    .sort((a, b) => b.score - a.score)
  const merged = []
  for (const entry of ranked.slice(0, 2)) if (entry.item.body.length > 0) merged.push(...entry.item.body)
  const steps = toSteps(merged.length > 0 ? merged : intro, 5)
  return {
    method: method || clean(steps[0], 220),
    steps: steps.length > 0 ? steps : ['wiki 里有条目，但没有可直接照做的步骤；可以打开原文看细节'],
    caveat: section ? `来自 wiki 小节「${section.title}」` : '来自 wiki 导语',
    title: clean(page.title, 80),
    url: page.url || '',
    source: 'wiki',
  }
}
export function createWikiGuide(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const timeoutMs = Math.max(3000, Math.min(30000, Number(options.timeoutMs) || 12000))
  const maxPages = Math.max(1, Math.min(5, Number(options.maxPages) || 3))
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
    let hits = []
    for (const attempt of searchQueries(query)) {
      const found = await get({ action: 'query', list: 'search', srsearch: attempt, srlimit: String(maxPages) })
      hits = found && found.query && Array.isArray(found.query.search) ? found.query.search : []
      if (hits.length > 0) break
    }
    if (hits.length === 0) return { ok: false, error: 'no_wiki_page', query }
    const ranked = hits.map((hit) => ({ ...hit, score: scoreCandidate(query, { title: hit.title, snippet: hit.snippet }) })).sort((a, b) => b.score - a.score)
    const best = ranked[0]
    const page = await get({ action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: best.title })
    const pages = page && page.query && page.query.pages ? Object.values(page.query.pages) : []
    const raw = pages.find((item) => item && typeof item.extract === 'string')
    if (!raw) return { ok: false, error: 'wiki_extract_failed', title: best.title }
    const guide = buildWikiGuide(query, { ...raw, url: 'https://zh.minecraft.wiki/w/' + encodeURIComponent(raw.title) })
    if (guide === null) return { ok: false, error: 'wiki_empty', title: best.title }
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
