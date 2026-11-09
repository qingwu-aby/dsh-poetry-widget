// lib/domain/learning/self-philosophy.mjs —— 读哲学、学方法（v3.12）
//
// 用户指定的三个仓库：优先读哲学文献与方法，优先级高于历史资源。
//   · JuneFreer/philosophy-book（164 个 txt，master）
//   · HarborLibrary/Philosophy（6 个 txt 可读；其余 PDF/epub 暂不读）
//   · RedRevolution1949/marxism-philosophy（PDF 为主，另有 1 本 HTML 组分页可读）
//
// 读法不是摘金句，是四步：他在回答什么问题 → 凭什么（论证）→ 反方会怎么说 → 我怎么看；
// 另外抽一个“方法”（辩证/怀疑/还原/谱系/思想实验…）进方法论账本。
import { formatJournalTime } from '../memory/memory-journal.mjs'


export const PHILOSOPHY_GAP_MS = 2 * 60 * 60 * 1000
export const PHILOSOPHY_RETRY_MS = 30 * 60 * 1000
export const PHILOSOPHY_FIRST_MIN_MS = 45 * 1000
export const PHILOSOPHY_FIRST_MAX_MS = 100 * 1000
export const PHILOSOPHY_TICK_MS = 60 * 1000
export const PHILOSOPHY_TIMEOUT_MS = 20 * 1000
export const PHILOSOPHY_EXCERPT_MAX = 12000
/** 每段读多少字（整本书分多次读完）。 */
export const PHILOSOPHY_CHUNK_CHARS = 12000
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

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/** 保留换行的正文清洗（整本书分块需要段落结构）。 */
function cleanTextPreservingLines(text, maxChars) {
  if (typeof text !== 'string') return ''
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
  const chars = Array.from(normalized)
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : normalized
}

export function shortMessage(error) {
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
    const text =
      raw.trim().toLowerCase().endsWith('.html') || /<html|<body/i.test(raw)
        ? stripHtml(raw).split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
        : cleanTextPreservingLines(raw, maxChars)
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
  const excerpt = ctx.excerpt
  const methods = Array.isArray(ctx.methods) ? ctx.methods.filter((line) => typeof line === 'string').slice(0, 4) : []
  const progress = isPlainObject(ctx.progress) ? ctx.progress : {}
  const index = Number.isFinite(progress.index) ? progress.index + 1 : 0
  const total = Number.isFinite(progress.total) ? progress.total : 0
  const priorNotes = cleanInline(progress.priorNotes, 500)
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = [
    `现在是 ${formatShanghaiTime(now)}。你在读哲学文本，读法不是摘金句，而是看清一层层的论证；这次读的是整本书的一段，后面还会接着读。`,
    `书名/篇名：${title || '（未标注）'}${index > 0 && total > 0 ? `（第 ${index}/${total} 段）` : ''}`,
    priorNotes ? `你前面读到的（只作衔接，不要重复）：${priorNotes}` : '',
    '正文片段：',
    excerpt,
    '',
    '请只针对这一段，按四步读；读不懂就写读不懂：',
    '1. 这段在回答什么问题（作者面对的困惑，不是标题别话）；',
    '2. 它凭什么这样回答（前提、推理、例子；具体到这一步用了什么方法）；',
    '3. 反方最有力的反驳会是什么（可以来自你自己的经验，也可以来自别的哲学家）；',
    '4. 你自己怎么看：同意/不同意/还没判断，说清楚为什么。',
    methods.length > 0 ? `你已有的方法（可以对照，不必硬套）：${methods.join('；')}` : '',
    '',
    '另外做两件事（重点）：',
    'A. 抽一个“方法”出来：这段作者用的分析方式叫什么（辩证、怀疑、还原、谱系、先验论证、思想实验、语言分析…），具体怎么做的一两句话。',
    'B. 给你自己的判断：用一句话说出你接受/反对/存疑的一个立场，并给出理由（不要复述作者原话）。',
    '只输出 JSON（不要 markdown）：',
    '{"question":"","claim":"","argument":"","objection":"","ownView":"","method":{"name":"","howTo":""},"position":{"stance":"accept|reject|open","claim":"","reason":""}}',
    '不用“不是…而是…”的对称句，不总结升华，不确定的地方就写不确定。',
  ].filter((line) => line.length > 0)
  return lines.join('\n')
}

/** 整本书读完后的总结合成 prompt。 */
export function buildBookSynthesisPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const title = cleanInline(ctx.title, 80)
  const notes = Array.isArray(ctx.notes) ? ctx.notes.map((item) => cleanInline(item, 200)).filter(Boolean).slice(-24) : []
  const methods = Array.isArray(ctx.methods) ? ctx.methods.map((item) => cleanInline(item, 160)).filter(Boolean).slice(0, 6) : []
  return [
    `你刚读完《${title}》全文。不要复述内容，只写这本书在你脑子里留下的结构。`,
    notes.length > 0 ? `你读的时候留下的笔记：${notes.join('；')}` : '',
    methods.length > 0 ? `你在书里抽出的方法：${methods.join('；')}` : '',
    '',
    '只输出 JSON：',
    '{"question":"这本书在回答什么问题","skeleton":"它的论证骨架（两三句）","accept":[{"claim":"","reason":""}],"reject":[{"claim":"","reason":""}],"open":[{"claim":"","reason":""}],"changed":"它改变了你哪个看法（没有就写没有）","leftover":"留下的一个问题"}',
    '接受/反对/存疑各 0–2 条，必须是你自己的判断，不是书的原话；没想清楚就放进 open。',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
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
    const positionRaw = isPlainObject(parsed.position) ? parsed.position : {}
    const positionClaim = cleanInline(positionRaw.claim, 200)
    const position = ['accept', 'reject', 'open'].includes(positionRaw.stance) && positionClaim.length >= 4
      ? { stance: positionRaw.stance, claim: positionClaim, reason: cleanInline(positionRaw.reason, 200) }
      : null
    if (question.length < 4 && argument.length < 10) return null
    return {
      question,
      claim,
      argument,
      objection,
      ownView,
      method: methodName.length >= 2 && methodHowTo.length >= 4 ? { name: methodName, howTo: methodHowTo } : null,
      position,
    }
  } catch (error) {
    return null
  }
}

export function parseBookSynthesis(text) {
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
    const pickList = (list) => (Array.isArray(list) ? list : [])
      .map((item) => ({ claim: cleanInline(item?.claim, 200), reason: cleanInline(item?.reason, 200) }))
      .filter((item) => item.claim.length >= 4)
      .slice(0, 2)
    return {
      question: cleanInline(parsed.question, 200),
      skeleton: cleanInline(parsed.skeleton, 400),
      accept: pickList(parsed.accept),
      reject: pickList(parsed.reject),
      open: pickList(parsed.open),
      changed: cleanInline(parsed.changed, 200),
      leftover: cleanInline(parsed.leftover, 200),
    }
  } catch (error) {
    return null
  }
}

export function formatPhilosophyLog({ title, sourceLabel, parsed, at, progress }) {
  const when = formatJournalTime(at)
  const lines = [`## ${when} · 哲学`, `读：${title}${sourceLabel ? `（${sourceLabel}）` : ''}`]
  if (progress && Number.isFinite(progress.index) && Number.isFinite(progress.total)) {
    lines.push(`进度：第 ${progress.index + 1}/${progress.total} 段`)
  }
  if (parsed.question) lines.push(`问题：${parsed.question}`)
  if (parsed.claim) lines.push(`主张：${parsed.claim}`)
  if (parsed.argument) lines.push(`论证：${parsed.argument}`)
  if (parsed.objection) lines.push(`反方：${parsed.objection}`)
  if (parsed.ownView) lines.push(`我的看法：${parsed.ownView}`)
  if (parsed.method) lines.push(`方法：${parsed.method.name} — ${parsed.method.howTo}`)
  if (parsed.position) lines.push(`判断（${parsed.position.stance === 'accept' ? '接受' : parsed.position.stance === 'reject' ? '反对' : '存疑'}）：${parsed.position.claim}${parsed.position.reason ? ` —— ${parsed.position.reason}` : ''}`)
  lines.push('')
  return lines.join('\n')
}

export function formatBookSynthesisLog({ title, synthesis, at }) {
  const when = formatJournalTime(at)
  const lines = [`## ${when} · 哲学·总`, `读完：${title}`]
  if (synthesis.question) lines.push(`它的问题：${synthesis.question}`)
  if (synthesis.skeleton) lines.push(`论证骨架：${synthesis.skeleton}`)
  for (const item of synthesis.accept) lines.push(`接受：${item.claim}${item.reason ? ` —— ${item.reason}` : ''}`)
  for (const item of synthesis.reject) lines.push(`反对：${item.claim}${item.reason ? ` —— ${item.reason}` : ''}`)
  for (const item of synthesis.open) lines.push(`存疑：${item.claim}${item.reason ? ` —— ${item.reason}` : ''}`)
  if (synthesis.changed) lines.push(`改变：${synthesis.changed}`)
  if (synthesis.leftover) lines.push(`留下的问题：${synthesis.leftover}`)
  lines.push('')
  return lines.join('\n')
}

/** 把整本书按段落切成 ~maxChars 的段落块（供多次读完）。 */
export function splitBookIntoChunks(text, maxChars = PHILOSOPHY_CHUNK_CHARS) {
  const limit = Number.isFinite(maxChars) && maxChars > 500 ? maxChars : PHILOSOPHY_CHUNK_CHARS
  const paragraphs = String(text ?? '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
  const chunks = []
  let current = ''
  const flush = () => {
    if (current.trim().length > 0) chunks.push(current.trim())
    current = ''
  }
  for (const paragraph of paragraphs) {
    if (Array.from(paragraph).length > limit * 1.5) {
      const parts = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [paragraph]
      for (const part of parts) {
        if (Array.from(current + part).length > limit) flush()
        current += part
      }
      continue
    }
    if (Array.from(`${current}\n${paragraph}`).length > limit) flush()
    current = current.length > 0 ? `${current}\n${paragraph}` : paragraph
  }
  flush()
  return chunks
}

export function formatShanghaiTime(ms) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms))
}

export function recentNotesForPrompt(notes, limit = 6) {
  if (!Array.isArray(notes) || notes.length === 0) return ''
  return notes
    .slice(-limit)
    .map((note) => (typeof note === 'string' ? note : cleanInline(note && (note.claim || note.ownView || note.method), 120)))
    .filter(Boolean)
    .join('；')
}

