// lib/self-reading.mjs —— 她读现代中文小说，慢慢学语言（v1.67）。
//
// 用户希望她多读当代/现代的好小说，学里面的语言方式，慢慢改。版权上只能安全地读
// **已进入公有领域的现代作家**（鲁迅、老舍、萧红、郁达夫、朱自清、许地山等），
// 来源用中文维基文库（zh.wikisource.org，MediaWiki API，只读）。
//
// 每次：取一篇公版作品 → 清成简体正文 → 截一小段 → 让她留意“写法”（怎么把动作写具体、
// 怎么留白、怎么不解释情绪），并照那种写法**自己写一句原创的话**；记进 learning-log
// 「· 读小说」。她不抄句子，只吸收观察方式；笔记会经记忆检索自然进入后面的自言自语。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from './llm-call.mjs'
import { naturalStyleLines } from './language-style.mjs'
import { formatJournalTime } from './memory-journal.mjs'
import { writeJsonAtomic } from './settings-store.mjs'

/** 两次读小说之间至少隔这么久（慢慢来）。 */
export const SELF_READING_GAP_MS = 24 * 60 * 60 * 1000
/** 失败/睡觉时的重试间隔。 */
export const SELF_READING_RETRY_MS = 30 * 60 * 1000
/** 第一次读的延迟（插件启动后）。 */
export const SELF_READING_FIRST_MIN_MS = 90 * 1000
export const SELF_READING_FIRST_MAX_MS = 3 * 60 * 1000
/** 巡检 tick。 */
export const SELF_READING_TICK_MS = 60 * 1000
/** 单次网络超时。 */
export const SELF_READING_TIMEOUT_MS = 20 * 1000
/** 允许的域名。 */
export const SELF_READING_ALLOWED_HOSTS = Object.freeze(['zh.wikisource.org'])
/** 每次给她的正文长度上限（字符）。 */
export const SELF_READING_EXCERPT_MAX = 1400
/** 每次取用的段落数。 */
export const SELF_READING_PARAGRAPHS = 5

/**
 * 已确认收录于中文维基文库、且作者已进入公有领域的现代中文小说/散文。
 * page 为文库页名（多为繁体），title 为给她的简体显示名。
 */
export const SELF_READING_WORKS = Object.freeze([
  { page: '孔乙己', title: '孔乙己', author: '鲁迅', kind: '短篇小说' },
  { page: '故鄉', title: '故乡', author: '鲁迅', kind: '短篇小说' },
  // 近代翻译公版作品穿插在中间，几天内就能轮到，不用等十几天。
  { page: '俠隱記/第01回', title: '侠隐记·第一回', author: '大仲马 / 伍光建 译', kind: '翻译小说（白话）' },
  { page: '藥', title: '药', author: '鲁迅', kind: '短篇小说' },
  { page: '荷塘月色', title: '荷塘月色', author: '朱自清', kind: '散文' },
  { page: '漢姆萊脫', title: '汉姆莱脱', author: '莎士比亚 / 朱生豪 译', kind: '翻译戏剧（白话）' },
  { page: '在酒樓上', title: '在酒楼上', author: '鲁迅', kind: '短篇小说' },
  { page: '月牙兒', title: '月牙儿', author: '老舍', kind: '短篇小说' },
  { page: '月界旅行/第一回', title: '月界旅行·第一回', author: '凡尔纳 / 鲁迅 译', kind: '翻译科学小说（章回）' },
  { page: '祝福', title: '祝福', author: '鲁迅', kind: '短篇小说' },
  { page: '背影', title: '背影', author: '朱自清', kind: '散文' },
  { page: '駱駝祥子', title: '骆驼祥子', author: '老舍', kind: '长篇小说' },
  { page: '春風沉醉的晚上', title: '春风沉醉的晚上', author: '郁达夫', kind: '短篇小说' },
  { page: '生死場', title: '生死场', author: '萧红', kind: '长篇小说' },
  { page: '呼蘭河傳', title: '呼兰河传', author: '萧红', kind: '长篇小说' },
  { page: '命命鳥', title: '命命鸟', author: '许地山', kind: '短篇小说' },
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

/** 从模型输出里取出 JSON（可能带 markdown fence）。 */
function extractReadingJson(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 维基文库 API：取页面渲染后的 HTML（双转换已尽量是简体）。 */
export function readingApiUrl(pageTitle) {
  // 子页面（如「俠隱記/第01回」）的斜杠要保留，不能编码成 %2F。
  const title = encodeURIComponent(String(pageTitle ?? '').trim()).replace(/%2F/gi, '/')
  return (
    'https://zh.wikisource.org/w/api.php?action=parse&prop=text&format=json&formatversion=2' +
    `&disablelimitreport=1&variant=zh-hans&page=${title}`
  )
}

/** HTML → 干净的简体正文行（去掉导航、脚注、“编辑”等网页残留）。 */
export function cleanReadingHtml(htmlText) {
  if (typeof htmlText !== 'string' || htmlText.length === 0) return ''
  let text = htmlText
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  const noise = /^(姊妹[计計]划|姊妹計劃|作者[：:]|本作品收[录錄]|此版本取自|版本信息|数据项|數據項|百科|粵典|粤典|编辑|編輯|目[录錄]|上一|下一|返回|版[权權]|跳至)/u
  const lines = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/[\u200b-\u200f\ufe0f]/g, '').replace(/\s+/g, ' ').trim()
    if (line.length === 0) continue
    if (/^[←→·・\-\s]+$/u.test(line)) continue
    if (noise.test(line)) continue
    lines.push(line)
  }
  return lines.join('\n')
}

/** 从干净正文里按“第几段开始”截一小段（段落优先，避免截断句子）。 */
export function pickReadingExcerpt(cleanText, windowIndex = 0, maxChars = SELF_READING_EXCERPT_MAX) {
  const paragraphs = String(cleanText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
  if (paragraphs.length === 0) return ''
  const usable = Math.max(1, paragraphs.length - 2)
  const start = Math.max(0, Math.min(usable - 1, Math.floor(Number(windowIndex) || 0) % usable))
  const picked = paragraphs.slice(start, start + SELF_READING_PARAGRAPHS)
  const excerpt = picked.join('\n')
  const chars = Array.from(excerpt)
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : excerpt
}

/** 取一篇公版作品的渲染正文（失败/越界返回 null）。 */
export async function fetchReadingText(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const work = isPlainObject(options.work) ? options.work : null
  if (work === null || typeof work.page !== 'string' || work.page.trim().length === 0) return null
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : SELF_READING_TIMEOUT_MS
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const url = readingApiUrl(work.page)
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        'user-agent': 'dsh-little-whale/0.1.4 (+https://github.com/qingwu-aby/dsh-little-whale)',
      },
      signal: controller !== null ? controller.signal : undefined,
    })
    if (!response || response.ok !== true) return null
    const finalUrl = typeof response.url === 'string' && response.url.length > 0 ? response.url : url
    let host = ''
    try {
      host = new URL(finalUrl).hostname.toLowerCase()
    } catch {
      return null
    }
    if (!SELF_READING_ALLOWED_HOSTS.includes(host)) return null
    const data = typeof response.json === 'function' ? await response.json() : null
    if (!isPlainObject(data)) return null
    const htmlText =
      data && data.parse && typeof data.parse.text === 'string' ? data.parse.text : ''
    if (htmlText.length === 0) return null
    const cleaned = cleanReadingHtml(htmlText)
    if (cleaned.length < 200) return null
    return { text: cleaned, host, url: `https://${host}/wiki/${encodeURIComponent(work.page)}` }
  } catch {
    return null
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** 构造“读小说学语言”的 prompt。 */
export function buildReadingPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const work = isPlainObject(ctx.work) ? ctx.work : {}
  const excerpt = cleanInline(ctx.excerpt, SELF_READING_EXCERPT_MAX)
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = [
    `现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`,
    `你最近在读现代中文${cleanInline(work.kind, 12) || '小说'}《${cleanInline(work.title, 30)}》（${cleanInline(work.author, 20)}，公版作品）。`,
    `下面是其中一小段：\n「${excerpt}」`,
    '读的时候留意它的**写法**：怎么把动作和物件写具体、怎么留白、怎么不直接解释情绪、句子怎么有长有短。',
    '然后：1）用 2–4 句写下你留意到的写法（具体到“做法”，不要复述情节，不要写成文学评论）；2）照这种写法自己写一句原创的话（≤50 字，不要抄原文，不要模仿原句的用词）；3）如果有一小句原文让你停了一下，可以摘 ≤40 字（可空）。',
    '不要为了显得有收获而夸大；也可以说这一段没打动你。',
    '只输出严格 JSON：{"noticed":"留意到的写法","try":"自己写的一句原创","quote":"原文小句（可空）"}',
  ]
  lines.push(...naturalStyleLines(['noticed 写具体的做法，不写「语言优美」这种空话。']))
  return lines.join('\n')
}

/** 校验读小说结果。 */
export function parseReadingResult(text) {
  const raw = extractReadingJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const noticed = cleanInline(raw.noticed, 300)
  const attempt = cleanInline(raw.try, 80)
  const quote = cleanInline(raw.quote, 40)
  if (noticed.length < 12) return { ok: false, message: '没写下留意到的写法' }
  if (attempt.length < 4) return { ok: false, message: '没写下自己试着写的一句' }
  return { ok: true, noticed, attempt, ...(quote.length > 0 ? { quote } : {}) }
}

/**
 * 创建“读小说学语言”服务。
 * @param {{
 *   state: {snapshot: Function},
 *   llm?: object|(() => object|undefined|null),
 *   getLlm?: () => object|undefined|null,
 *   policy?: object|null,
 *   modelErrorsPath?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   learningLogPath: string,
 *   statePath?: string,
 *   env?: object,
 *   now?: () => number,
 *   random?: () => number,
 *   fetchImpl?: Function,
 *   gapMs?: number,
 *   retryMs?: number,
 *   firstMinMs?: number,
 *   firstMaxMs?: number,
 *   tickMs?: number,
 *   timeoutMs?: number,
 * }} options
 */
export function createSelfReading(options) {
  const state = options.state ?? null
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const policy = options.policy ?? null
  const logger = options.logger ?? null
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const random = typeof options.random === 'function' ? options.random : Math.random
  const learningLogPath = path.resolve(options.learningLogPath)
  const statePath = path.resolve(options.statePath ?? path.join(path.dirname(learningLogPath), 'read-state.json'))
  const gapMs = typeof options.gapMs === 'number' && options.gapMs >= 0 ? options.gapMs : SELF_READING_GAP_MS
  const retryMs = typeof options.retryMs === 'number' && options.retryMs >= 0 ? options.retryMs : SELF_READING_RETRY_MS
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : SELF_READING_TIMEOUT_MS
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  const tickMs = typeof options.tickMs === 'number' && options.tickMs > 0 ? options.tickMs : SELF_READING_TICK_MS
  const firstMinMs = typeof options.firstMinMs === 'number' ? options.firstMinMs : SELF_READING_FIRST_MIN_MS
  const firstMaxMs = typeof options.firstMaxMs === 'number' ? options.firstMaxMs : SELF_READING_FIRST_MAX_MS

  let lastReadAt = 0
  let readCount = 0
  let inFlight = false
  let timer = null
  let nextAt = 0
  let disposed = false

  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    if (isPlainObject(raw) && typeof raw.lastReadAt === 'number') lastReadAt = raw.lastReadAt
    if (isPlainObject(raw) && typeof raw.readCount === 'number' && raw.readCount >= 0) readCount = Math.floor(raw.readCount)
  } catch {
    /* 首次运行/坏文件 */
  }

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function info(message) {
    try {
      logger?.info?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function persist() {
    try {
      mkdirSync(path.dirname(statePath), { recursive: true })
      writeJsonAtomic(statePath, { ok: true, v: 1, lastReadAt, readCount })
    } catch {
      /* ignore */
    }
  }

  function sleeping() {
    try {
      const snap = state !== null && typeof state.snapshot === 'function' ? state.snapshot() : null
      return snap !== null && snap !== undefined && snap.sleeping === true
    } catch {
      return false
    }
  }

  function candidates() {
    if (policy === null) return []
    try {
      return policy.resolveCandidates('read')
    } catch {
      return []
    }
  }

  async function callModel(system, userPrompt) {
    return callModelForRole({
      role: 'read',
      policy,
      resolveLlm,
      system,
      prompt: userPrompt,
      maxTokens: 900,
      timeoutMs,
      timeoutCode: 'SELF_READING_TIMEOUT',
      timeoutMessage: `读小说模型调用超时（${timeoutMs}ms）`,
      prefix: '读小说候选失败',
      modelErrorsPath,
      warn,
    })
  }

  function appendLog(work, excerpt, parsed, atNow) {
    const time = formatJournalTime(atNow)
    const lines = [
      `\n## ${time} · 读小说\n`,
      `作品：《${work.title}》（${work.author}·${cleanInline(work.kind, 12)}）\n`,
      `她留意到的写法：${parsed.noticed}\n`,
      `她试着写的一句：${parsed.attempt}\n`,
    ]
    if (parsed.quote !== undefined) lines.push(`让她停了一下的原文：${parsed.quote}\n`)
    mkdirSync(path.dirname(learningLogPath), { recursive: true })
    appendFileSync(learningLogPath, lines.join(''), 'utf8')
  }

  /** 读一次：取公版片段 → 留意写法 → 自己写一句 → 记进学习日志。 */
  async function readNow(input = {}) {
    if (disposed || inFlight) return { ok: false, reason: 'busy' }
    if (String(env.DSH_POETRY_READING ?? '').toLowerCase() === 'off') return { ok: false, reason: 'disabled' }
    const force = isPlainObject(input) && input.force === true
    if (!force && sleeping()) return { ok: false, reason: 'sleeping' }
    inFlight = true
    const atNow = now()
    try {
      let llm = null
      try {
        llm = resolveLlm()
      } catch {
        llm = null
      }
      if (llm === null || llm === undefined || typeof llm.stream !== 'function') return { ok: false, reason: 'llm' }
      const work = SELF_READING_WORKS[readCount % SELF_READING_WORKS.length]
      const fetched = await fetchReadingText({ fetchImpl, work, timeoutMs })
      if (fetched === null) {
        lastReadAt = atNow
        persist()
        warn('读小说：这次没取到正文（网络/页面不可用），下次再试')
        return { ok: false, reason: 'fetch' }
      }
      const excerpt = pickReadingExcerpt(fetched.text, Math.floor(readCount / SELF_READING_WORKS.length))
      if (excerpt.length === 0) {
        lastReadAt = atNow
        persist()
        warn('读小说：抽取正文失败，下次再试')
        return { ok: false, reason: 'excerpt' }
      }
      const result = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘，正在读现代中文小说，想慢慢学里面的语言方式；不抄句子，只记写法，并自己试着写一句。',
        buildReadingPrompt({ now: atNow, work, excerpt }),
      )
      if (result === null) return { ok: false, reason: 'llm' }
      const parsed = parseReadingResult(result.text)
      if (parsed.ok !== true) {
        warn(`读小说结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      appendLog(work, excerpt, parsed, atNow)
      lastReadAt = atNow
      readCount += 1
      persist()
      info(`读小说：《${work.title}》→ 留意到 ${cleanInline(parsed.noticed, 24)}…`)
      return {
        ok: true,
        title: work.title,
        author: work.author,
        noticed: parsed.noticed,
        attempt: parsed.attempt,
        ...(parsed.quote !== undefined ? { quote: parsed.quote } : {}),
      }
    } catch (error) {
      warn(`读小说异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      inFlight = false
    }
  }

  function tick() {
    if (disposed) return
    const currentNow = now()
    if (currentNow < nextAt) return
    if (sleeping()) {
      nextAt = currentNow + retryMs
      return
    }
    const scheduled = readNow()
    nextAt = currentNow + gapMs
    scheduled.catch(() => {})
  }

  function start() {
    if (disposed || timer !== null) return
    const firstDelay = firstMinMs + Math.max(0, Math.min(1, Number(random()) || 0)) * Math.max(0, firstMaxMs - firstMinMs)
    const currentNow = now()
    const afterLast = lastReadAt > 0 ? lastReadAt + gapMs : 0
    nextAt = Math.max(currentNow + Math.max(1000, firstDelay), afterLast)
    timer = setInterval(tick, tickMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stop()
  }

  function snapshot() {
    return { lastReadAt, readCount, inFlight, nextAt }
  }

  return { start, stop, dispose, tick, readNow, snapshot, statePath, learningLogPath }
}
