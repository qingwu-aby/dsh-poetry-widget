// lib/domain/learning/self-philosophy.mjs —— 读哲学、学方法（v3.12）
//
// 用户指定的三个仓库：优先读哲学文献与方法，优先级高于历史资源。
//   · JuneFreer/philosophy-book（164 个 txt，master）
//   · HarborLibrary/Philosophy（6 个 txt 可读；其余 PDF/epub 暂不读）
//   · RedRevolution1949/marxism-philosophy（PDF 为主，另有 1 本 HTML 组分页可读）
//
// 读法不是摘金句，是四步：他在回答什么问题 → 凭什么（论证）→ 反方会怎么说 → 我怎么看；
// 另外抽一个“方法”（辩证/怀疑/还原/谱系/思想实验…）进方法论账本。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModel } from '../../kernel/model-call.mjs'
import { naturalStyleLines } from '../voice/language-style.mjs'
import { formatJournalTime } from '../memory/memory-journal.mjs'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import { externalContentNotice } from './external-content.mjs'

export const PHILOSOPHY_GAP_MS = 2 * 60 * 60 * 1000
export const PHILOSOPHY_RETRY_MS = 30 * 60 * 1000
export const PHILOSOPHY_FIRST_MIN_MS = 45 * 1000
export const PHILOSOPHY_FIRST_MAX_MS = 100 * 1000
export const PHILOSOPHY_TICK_MS = 60 * 1000
export const PHILOSOPHY_TIMEOUT_MS = 20 * 1000
export const PHILOSOPHY_EXCERPT_MAX = 1600
export const PHILOSOPHY_LIST_TTL_MS = 12 * 60 * 60 * 1000

/** 只读白名单（列目录 + 原始文本）。 */
export const PHILOSOPHY_ALLOWED_HOSTS = Object.freeze(['api.github.com', 'raw.githubusercontent.com'])

export function isAllowedPhilosophyHost(host) {
  const value = String(host ?? '').toLowerCase()
  return PHILOSOPHY_ALLOWED_HOSTS.includes(value) || value.endsWith('.githubusercontent.com')
}

/** 三个仓库；readableExts 是能直接取文本的扩展名。 */
export const PHILOSOPHY_SOURCES = Object.freeze([
  {
    id: 'june',
    owner: 'JuneFreer',
    repo: 'philosophy-book',
    branch: 'master',
    label: '哲学名著（JuneFreer）',
    readableExts: ['.txt'],
    seeds: [
      '任何一种能够作为科学出现的未来形而上学导论〔德〕康德',
      '哲学原理〔德〕黑格尔',
      '哲学史讲演录第一卷〔德〕黑格尔',
      '新工具〔英〕培根',
      '人类理解论上册〔英〕洛克',
      '人类理解研究〔英〕休谟',
      '政府论下篇〔英〕洛克',
      '神学政治论〔荷兰〕斯宾诺莎',
      '智慧人格苏格拉底柏拉图亚里斯多德',
      '我的哲学的发展〔英〕伯特兰.罗素',
      '对笛卡尔《沉思》的诘难',
      '爱弥儿 论教育上卷〔法〕卢梭',
      '恐惧与颤栗〔丹麦〕克尔凯郭尔',
      '亚里士多德的三段论〔波兰〕卢卡西维茨',
      '弗洛伊德文集文明与缺憾',
    ],
  },
  {
    id: 'harbor',
    owner: 'HarborLibrary',
    repo: 'Philosophy',
    branch: 'master',
    label: '哲学（HarborLibrary）',
    readableExts: ['.txt'],
    seeds: [
      '伯特兰·罗素：哲学问题',
      '伯特兰·罗素：幸福之路',
      '伯特兰·罗素：西方哲学史',
      '勒内·笛卡尔：第一哲学沉思集',
      '卡尔·波普尔：无尽的探索——卡尔·波普尔自传',
      '马丁·海德格尔：存在与时间',
    ],
  },
  {
    id: 'marxism',
    owner: 'RedRevolution1949',
    repo: 'marxism-philosophy',
    branch: 'main',
    label: '马克思主义哲学（RedRevolution1949）',
    readableExts: ['.htm', '.html', '.txt'],
    seeds: [],
  },
])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function shortMessage(error) {
  return cleanInline(error instanceof Error ? error.message : String(error ?? ''), 160)
}

function decodeBase64Text(content) {
  try {
    return Buffer.from(String(content ?? ''), 'base64').toString('utf8')
  } catch (error) {
    return ''
  }
}

/** 从 GitHub tree API 列出可读书目（失败返回空数组）。 */
export async function listPhilosophyBooks(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') return []
  const sources = Array.isArray(options.sources) && options.sources.length > 0 ? options.sources : PHILOSOPHY_SOURCES
  const maxSize = Number.isFinite(options.maxSize) && options.maxSize > 0 ? options.maxSize : 2 * 1024 * 1024
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PHILOSOPHY_TIMEOUT_MS
  const books = []
  for (const source of sources) {
    const url = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.branch}?recursive=1`
    try {
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs)
      if (!response || response.ok !== true) continue
      const data = typeof response.json === 'function' ? await response.json() : null
      const tree = data && Array.isArray(data.tree) ? data.tree : []
      for (const item of tree) {
        if (!item || item.type !== 'blob' || typeof item.path !== 'string') continue
        if (!source.readableExts.some((ext) => item.path.toLowerCase().endsWith(ext))) continue
        if (Number.isFinite(item.size) && item.size > maxSize) continue
        if (isJunkPhilosophyFile(item.path)) continue
        books.push({
          sourceId: source.id,
          sourceLabel: source.label,
          repo: `${source.owner}/${source.repo}`,
          path: item.path,
          branch: source.branch,
          title: bookTitle(item.path),
        })
      }
    } catch (error) {
      /* 单个仓库失败不影响其它仓库 */
    }
  }
  return books
}

/** 读不到目录时用的种子书目（只需 exact 文件名即可拼 raw URL）。 */
export function seedPhilosophyBooks(sources = PHILOSOPHY_SOURCES) {
  const books = []
  for (const source of sources) {
    for (const seed of source.seeds) {
      const ext = source.readableExts[0] ?? '.txt'
      const name = seed.endsWith(ext) ? seed : `${seed}${ext}`
      books.push({ sourceId: source.id, sourceLabel: source.label, repo: `${source.owner}/${source.repo}`, path: name, branch: source.branch, title: seed })
    }
  }
  return books
}

const JUNK_FILE = /(目录|封面|版权|序言|前言|后记|附录|索引|编译说明|出版说明|译者|致谢|contents?|cover|index|about|ebook\d+|#)/i
export function isJunkPhilosophyFile(pathname) {
  const base = String(pathname ?? '').split('/').pop() ?? ''
  if (JUNK_FILE.test(base)) return true
  return /(^|\/)(#|about\.html$|index\.html$|ebook\d+\.html$)/i.test(pathname)
}

export function bookTitle(pathname) {
  return String(pathname ?? '')
    .split('/')
    .pop()
    .replace(/\.(txt|htm|html)$/i, '')
    .replace(/_(I|II|III)$/i, '')
    .slice(0, 80)
}

function rawUrlFor(book) {
  return `https://raw.githubusercontent.com/${book.repo}/${book.branch}/${book.path.split('/').map(encodeURIComponent).join('/')}`
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'application/json,text/plain,*/*',
        'user-agent': 'dsh-little-whale/0.1.4 (+https://github.com/qingwu-aby/dsh-little-whale)',
      },
      signal: controller !== null ? controller.signal : undefined,
    })
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** 取一本书的纯文本（txt 直接读；html 去标签）。 */
export async function fetchPhilosophyBook(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const book = isPlainObject(options.book) ? options.book : null
  if (book === null || typeof book.path !== 'string' || typeof book.repo !== 'string') return null
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PHILOSOPHY_TIMEOUT_MS
  const maxChars = Number.isFinite(options.maxChars) && options.maxChars > 0 ? options.maxChars : 60000
  try {
    const response = await fetchWithTimeout(fetchImpl, rawUrlFor(book), timeoutMs)
    if (!response || response.ok !== true) return null
    const host = (() => {
      try {
        return new URL(response.url || rawUrlFor(book)).hostname.toLowerCase()
      } catch (error) {
        return ''
      }
    })()
    if (!isAllowedPhilosophyHost(host)) return null
    const raw = typeof response.text === 'function' ? await response.text() : decodeBase64Text(response.content)
    if (typeof raw !== 'string' || raw.length < 200) return null
    const text = raw.trim().toLowerCase().endsWith('.html') || /<html|<body/i.test(raw) ? stripHtml(raw) : cleanInline(raw, maxChars)
    return text.length >= 200 ? { text, host, url: response.url || rawUrlFor(book) } : null
  } catch (error) {
    return null
  }
}

export function stripHtml(htmlText) {
  return String(htmlText ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[\u200b-\u200f\ufe0f]/g, '')
    .replace(/[ \t]+/g, ' ')
}

/** 从正文里挑一段（跳过书名页/目录/版权页；按 startSeed 取窗口）。 */
export function pickPhilosophyExcerpt(text, startSeed = 0, maxChars = PHILOSOPHY_EXCERPT_MAX) {
  const paragraphs = String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 40)
    .filter((line) => !/^(目录|序言|前言|译者|出版|书名|作者|ISBN|版权所有)/.test(line))
  if (paragraphs.length === 0) return ''
  const index = Math.max(0, Math.min(paragraphs.length - 1, Math.floor(Number(startSeed) || 0) % paragraphs.length))
  const picked = paragraphs.slice(index, index + 4).join('\n')
  const chars = Array.from(picked)
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : picked
}

/** 四步阅读 + 方法抽取的 prompt。 */
export function buildPhilosophyPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const title = cleanInline(ctx.title, 80)
  const excerpt = cleanInline(ctx.excerpt, PHILOSOPHY_EXCERPT_MAX)
  const methods = Array.isArray(ctx.methods) ? ctx.methods.filter((line) => typeof line === 'string').slice(0, 4) : []
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = [
    `现在是 ${formatShanghaiTime(now)}。你在读哲学文本，读法不是摘金句，而是看清一层层的论证。`,
    `书名/篇名：${title || '（未标注）'}`,
    '正文片段：',
    excerpt,
    '',
    '请按四步读，只写你真正读到的，读不懂就写读不懂：',
    '1. 它在回答什么问题（不是标题，是作者面对的困惑）；',
    '2. 它凭什么这样回答（前提、推理、例子，具体到这一步用了什么方法）；',
    '3. 反方最有力的反驳会是什么（可以来自你自己的经验，也可以来自别的哲学家）；',
    '4. 你自己怎么看：同意/不同意/还没判断，说清楚为什么。',
    methods.length > 0 ? `你已有的方法（可以拿来对照这次读到的，不必硬套）：${methods.join('；')}` : '',
    '',
    '另外抽一个“方法”出来（这是重点）：这次作者用的分析方式叫什么（比如辩证法、怀疑法、还原法、谱系学、思想实验、先验论证），具体怎么做的一两句话。',
    '只输出 JSON（不要 markdown）：',
    '{"question":"","claim":"","argument":"","objection":"","ownView":"","method":{"name":"","howTo":""}}',
    '不用“不是…而是…”的对称句，不总结升华，不确定的地方就写不确定。',
  ].filter((line) => line.length > 0)
  return lines.join('\n')
}

/** 解析模型输出（宽松 JSON）。 */
export function parsePhilosophyReply(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    if (!isPlainObject(parsed)) return null
    const question = cleanInline(parsed.question, 120)
    const claim = cleanInline(parsed.claim, 160)
    const argument = cleanInline(parsed.argument, 300)
    const objection = cleanInline(parsed.objection, 240)
    const ownView = cleanInline(parsed.ownView, 240)
    const method = isPlainObject(parsed.method) ? parsed.method : {}
    const methodName = cleanInline(method.name, 40)
    const methodHowTo = cleanInline(method.howTo, 200)
    if (question.length < 4 && argument.length < 10) return null
    return {
      question,
      claim,
      argument,
      objection,
      ownView,
      method: methodName.length >= 2 && methodHowTo.length >= 4 ? { name: methodName, howTo: methodHowTo } : null,
    }
  } catch (error) {
    return null
  }
}

export function formatPhilosophyLog({ title, sourceLabel, parsed, at }) {
  const when = formatJournalTime(at)
  const lines = [`## ${when} · 哲学`, `读：${title}${sourceLabel ? `（${sourceLabel}）` : ''}`]
  if (parsed.question) lines.push(`问题：${parsed.question}`)
  if (parsed.claim) lines.push(`主张：${parsed.claim}`)
  if (parsed.argument) lines.push(`论证：${parsed.argument}`)
  if (parsed.objection) lines.push(`反方：${parsed.objection}`)
  if (parsed.ownView) lines.push(`我的看法：${parsed.ownView}`)
  if (parsed.method) lines.push(`方法：${parsed.method.name} — ${parsed.method.howTo}`)
  lines.push('')
  return lines.join('\n')
}

function formatShanghaiTime(ms) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms))
}

/** 哲学阅读服务：每 2 小时读一段、写学习日志、记方法。 */
export function createSelfPhilosophy(options = {}) {
  const env = options.env ?? process.env
  const state = options.state ?? null
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const journal = options.journal ?? null
  const methodMemory = options.methodMemory ?? null
  const learningLogPath = String(options.learningLogPath ?? '')
  const statePath = path.resolve(options.statePath ?? path.join(process.cwd(), 'philosophy-state.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const gapMs = Number.isFinite(options.gapMs) && options.gapMs > 0 ? options.gapMs : PHILOSOPHY_GAP_MS
  const retryMs = Number.isFinite(options.retryMs) && options.retryMs > 0 ? options.retryMs : PHILOSOPHY_RETRY_MS
  const firstMinMs = Number.isFinite(options.firstMinMs) && options.firstMinMs >= 0 ? options.firstMinMs : PHILOSOPHY_FIRST_MIN_MS
  const firstMaxMs = Number.isFinite(options.firstMaxMs) && options.firstMaxMs >= firstMinMs ? options.firstMaxMs : PHILOSOPHY_FIRST_MAX_MS
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PHILOSOPHY_TIMEOUT_MS
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const disabled = String(env.DSH_POETRY_PHILOSOPHY ?? '').toLowerCase() === 'off'
  let lastAt = 0
  let lastResult = null
  let timer = null
  let heartbeatMode = false
  let disposed = false

  const persisted = loadState()
  lastAt = persisted.lastAt
  let cursor = persisted.cursor
  let recentPaths = Array.isArray(persisted.recentPaths) ? persisted.recentPaths.slice(-30) : []
  let cachedBooks = Array.isArray(persisted.books) && Number.isFinite(persisted.booksAt) ? persisted.books : []
  let booksAt = Number.isFinite(persisted.booksAt) ? persisted.booksAt : 0

  function loadState() {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf8'))
      return isPlainObject(raw) ? raw : {}
    } catch (error) {
      return {}
    }
  }
  function persist() {
    try {
      mkdirSync(path.dirname(statePath), { recursive: true })
      writeJsonAtomic(statePath, { ok: true, v: 1, lastAt, cursor, recentPaths, books: cachedBooks, booksAt })
    } catch (error) {
      /* ignore */
    }
  }
  function warn(message) {
    logger?.warn?.(`[dsh-little-whale] ${message}`)
  }
  function info(message) {
    logger?.info?.(`[dsh-little-whale] ${message}`)
  }
  async function loadBooks(force = false) {
    const at = now()
    if (!force && cachedBooks.length > 0 && at - booksAt < PHILOSOPHY_LIST_TTL_MS) return cachedBooks
    let books = await listPhilosophyBooks({ fetchImpl, timeoutMs })
    if (books.length === 0) books = seedPhilosophyBooks()
    if (books.length > 0) {
      cachedBooks = books
      booksAt = at
      persist()
    }
    return books
  }
  function pickBook(books) {
    if (books.length === 0) return null
    const fresh = books.filter((book) => !recentPaths.includes(`${book.repo}:${book.path}`))
    const pool = fresh.length > 0 ? fresh : books
    const index = Math.floor(Math.random() * pool.length)
    return pool[index] ?? null
  }
  async function runOnce(input = {}) {
    if (disabled || disposed) return { ok: false, reason: 'disabled' }
    const atNow = now()
    try {
      const books = await loadBooks(input.force === true)
      const book = pickBook(books)
      if (book === null) {
        lastAt = atNow - gapMs + retryMs
        persist()
        return { ok: false, reason: 'no-books' }
      }
      const fetched = await fetchPhilosophyBook({ fetchImpl, book, timeoutMs })
      if (fetched === null) {
        lastAt = atNow - gapMs + retryMs
        persist()
        warn(`哲学阅读：这次没取到《${book.title}》，下次再试`)
        return { ok: false, reason: 'fetch' }
      }
      const at = now()
      const seed = Math.floor(Math.max(0, atNow / 3600000)) + recentPaths.length
      const excerpt = pickPhilosophyExcerpt(fetched.text, seed)
      if (excerpt.length < 200) {
        lastAt = atNow - gapMs + retryMs
        persist()
        return { ok: false, reason: 'excerpt' }
      }
      const methods = methodMemory && typeof methodMemory.digest === 'function' ? methodMemory.digest(4) : []
      const result = await callModel({
        role: 'philosophy',
        policy,
        resolveLlm: getLlm,
        system: '你是住在 DSH Web 角落的鲸鱼娘，正在认真读哲学文本；只写你真正读到的，不装懂，不抄原文超过一句。',
        prompt: buildPhilosophyPrompt({ title: book.title, excerpt, methods, now: atNow }),
        maxTokens: 1400,
        timeoutMs: 90000,
        timeoutCode: 'SELF_PHILOSOPHY_TIMEOUT',
        timeoutMessage: '哲学阅读模型调用超时',
        prefix: '哲学阅读候选失败',
        modelErrorsPath,
        warn,
      })
      if (result === null) return { ok: false, reason: 'llm' }
      const parsed = parsePhilosophyReply(result.text)
      if (parsed === null) {
        warn('哲学阅读结果无效（不是可用 JSON）')
        return { ok: false, reason: 'invalid' }
      }
      mkdirSync(path.dirname(learningLogPath), { recursive: true })
      appendFileSync(learningLogPath, formatPhilosophyLog({ title: book.title, sourceLabel: book.sourceLabel, parsed, at }), 'utf8')
      try {
        await journal?.append?.({
          kind: 'thought',
          text: `读哲学：${book.title} → ${cleanInline(parsed.ownView || parsed.claim, 80)}`,
        })
      } catch (error) {
        /* journal 写失败不影响主流程 */
      }
      if (parsed.method && methodMemory && typeof methodMemory.record === 'function') {
        methodMemory.record({ name: parsed.method.name, howTo: parsed.method.howTo, source: book.title, worked: undefined })
      }
      recentPaths = [...recentPaths, `${book.repo}:${book.path}`].slice(-30)
      cursor += 1
      lastAt = at
      persist()
      lastResult = { at, ok: true, title: book.title, source: book.repo, method: parsed.method ? parsed.method.name : null }
      info(`哲学阅读：${book.title}${parsed.method ? `（方法：${parsed.method.name}）` : ''}`)
      return { ok: true, title: book.title, repo: book.repo, method: parsed.method, parsed }
    } catch (error) {
      warn(`哲学阅读异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    }
  }
  function snapshot() {
    let asleep = false
    try {
      const snap = state !== null && typeof state.snapshot === 'function' ? state.snapshot() : null
      asleep = Boolean(snap && snap.asleep)
    } catch (error) {
      asleep = false
    }
    return { disabled, lastAt, recentPaths: recentPaths.slice(-5), books: cachedBooks.length, last: lastResult, asleep }
  }
  function tick() {
    if (disposed || timer !== null || heartbeatMode) return { ok: false, reason: 'off' }
    const atNow = now()
    if (lastAt > 0 && atNow - lastAt < gapMs) return { ok: false, reason: 'gap' }
    const snap = snapshot()
    if (snap.asleep) return { ok: false, reason: 'asleep' }
    runOnce().catch(() => {})
    return { ok: true }
  }
  function start(startOptions = {}) {
    if (disabled || disposed || timer !== null || heartbeatMode) return
    heartbeatMode = startOptions && startOptions.heartbeat === true
    if (heartbeatMode) return
    const firstDelay = firstMinMs + Math.random() * Math.max(0, firstMaxMs - firstMinMs)
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => tick(), PHILOSOPHY_TICK_MS)
      timer.unref?.()
    }, firstDelay)
    timer.unref?.()
  }
  function dispose() {
    disposed = true
    if (timer !== null) {
      clearTimeout(timer)
      clearInterval(timer)
      timer = null
    }
  }
  return { statePath, learningLogPath, runOnce, tick, start, dispose, snapshot }
}
