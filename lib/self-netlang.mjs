// lib/self-netlang.mjs —— 看看互联网上的大家怎么表达（v1.68）。
//
// 用户希望她多看看大家（贴吧/知乎/微博…）怎么说话，慢慢学表达。实际可稳定只读访问的
// 公开来源有限：微博热搜、B站热搜可以直接读到公开 JSON；知乎/贴吧需要登录或前端渲染，
// 暂不接（以后有合法稳定的公开入口再加）。
//
// 每次只取「标题/热搜词」这种短文本，不抓评论、不取用户信息、不登录、不参与、不评论；
// 让她留意大家怎么把一句话说短、怎么带情绪、怎么用日常词，然后自己写一句更日常的话。
// 只把**她自己的笔记**写进 learning-log，不保存别人的原话。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from './llm-call.mjs'
import { naturalStyleLines } from './language-style.mjs'
import { formatJournalTime } from './memory-journal.mjs'
import { writeJsonAtomic } from './settings-store.mjs'
import { externalContentNotice } from './external-content.mjs'

/** 两次“看大家说话”之间至少隔这么久（慢慢来，别学太快）。 */
export const SELF_NETLANG_GAP_MS = 120 * 60 * 1000
/** 失败/睡觉时的重试间隔。 */
export const SELF_NETLANG_RETRY_MS = 30 * 60 * 1000
/** 第一次的延迟（插件启动后）。 */
export const SELF_NETLANG_FIRST_MIN_MS = 30 * 1000
export const SELF_NETLANG_FIRST_MAX_MS = 90 * 1000
/** 巡检 tick。 */
export const SELF_NETLANG_TICK_MS = 60 * 1000
/** 网络超时。 */
export const SELF_NETLANG_TIMEOUT_MS = 15 * 1000
/** 允许的域名。 */
export const SELF_NETLANG_ALLOWED_HOSTS = Object.freeze(['weibo.com', 'api.bilibili.com', 'hn.algolia.com', 'top.baidu.com', 'github.com'])
/** 取多少个热搜词/标题给她看。 */
export const SELF_NETLANG_TITLES_MAX = 12

/** 公开来源（轮换）。 */
export const SELF_NETLANG_SOURCES = Object.freeze([
  {
    id: 'weibo',
    label: '微博热搜',
    url: 'https://weibo.com/ajax/side/hotSearch',
    referer: 'https://weibo.com/',
    host: 'weibo.com',
  },
  {
    id: 'bilibili',
    label: 'B站热搜',
    url: 'https://api.bilibili.com/x/web-interface/search/square?limit=10',
    referer: 'https://www.bilibili.com/',
    host: 'api.bilibili.com',
  },
  {
    id: 'hackernews',
    label: 'Hacker News 首页',
    url: 'https://hn.algolia.com/api/v1/search?tags=front_page',
    host: 'hn.algolia.com',
  },
  {
    id: 'baidu',
    label: '百度热搜',
    url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime',
    host: 'top.baidu.com',
  },
  {
    id: 'github',
    label: 'GitHub 趋势',
    url: 'https://github.com/trending',
    host: 'github.com',
    format: 'html',
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

function extractJson(text) {
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

/** 从公开 JSON 里解析出标题/热搜词（只取短文本，过滤 URL/空值/重复）。 */
export function parseNetlangPayload(sourceId, payload) {
  const out = []
  const push = (value) => {
    const text = cleanInline(value, 40)
    if (text.length < 4) return
    if (/^https?:\/\//i.test(text)) return
    if (out.includes(text)) return
    out.push(text)
  }
  if (!isPlainObject(payload)) return out
  if (sourceId === 'weibo') {
    const realtime = payload?.data?.realtime
    if (Array.isArray(realtime)) {
      for (const item of realtime) {
        if (!isPlainObject(item)) continue
        push(item.word_scheme || item.word || item.note)
        if (out.length >= SELF_NETLANG_TITLES_MAX) break
      }
    }
  } else if (sourceId === 'bilibili') {
    const list = payload?.data?.trending?.list
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!isPlainObject(item)) continue
        push(item.show_name || item.keyword)
        if (out.length >= SELF_NETLANG_TITLES_MAX) break
      }
    }
  } else if (sourceId === 'hackernews') {
    const hits = payload?.hits
    if (Array.isArray(hits)) {
      for (const item of hits) {
        if (!isPlainObject(item)) continue
        push(item.title || item.story_title)
        if (out.length >= SELF_NETLANG_TITLES_MAX) break
      }
    }
  } else if (sourceId === 'baidu') {
    const cards = payload?.data?.cards
    if (Array.isArray(cards)) {
      for (const card of cards) {
        if (!isPlainObject(card) || !Array.isArray(card.content)) continue
        for (const item of card.content) {
          if (!isPlainObject(item)) continue
          push(item.word || item.query || item.name)
          if (out.length >= SELF_NETLANG_TITLES_MAX) break
        }
        if (out.length >= SELF_NETLANG_TITLES_MAX) break
      }
    }
  }
  return out
}

/** 从 GitHub trending HTML 里解析仓库名（只取 owner/repo，不带链接）。 */
export function parseGithubTrendingHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return []
  const out = []
  const seen = new Set()
  const matches = html.matchAll(/<h2[^>]*>[\s\S]*?<a[^>]+href="\/([^"\/]+)\/([^"\/]+)"/g)
  for (const match of matches) {
    const owner = cleanInline(match[1], 40)
    const repo = cleanInline(match[2], 40)
    if (!owner || !repo) continue
    const text = `${owner}/${repo}`
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= SELF_NETLANG_TITLES_MAX) break
  }
  return out
}

/** 取一个公开来源的今日热搜词/标题；失败返回 null。 */
export async function fetchNetlangTitles(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const source = isPlainObject(options.source) ? options.source : null
  if (source === null || typeof source.url !== 'string') return null
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : SELF_NETLANG_TIMEOUT_MS
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetchImpl(source.url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        ...(typeof source.referer === 'string' && source.referer.length > 0 ? { referer: source.referer } : {}),
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      signal: controller !== null ? controller.signal : undefined,
    })
    if (!response || response.ok !== true) return null
    const finalUrl = typeof response.url === 'string' && response.url.length > 0 ? response.url : source.url
    let host = ''
    try {
      host = new URL(finalUrl).hostname.toLowerCase()
    } catch {
      return null
    }
    if (!SELF_NETLANG_ALLOWED_HOSTS.includes(host)) return null
    let titles = []
    if (source.format === 'html' && typeof response.text === 'function') {
      titles = parseGithubTrendingHtml(await response.text())
    } else {
      const data = typeof response.json === 'function' ? await response.json() : null
      if (source.id === 'github') titles = parseGithubTrendingHtml(typeof data === 'string' ? data : '')
      else titles = parseNetlangPayload(source.id, data)
    }
    if (titles.length === 0) return null
    return { titles, sourceId: source.id, label: source.label, host }
  } catch {
    return null
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** 构造 prompt：只给她看热搜词，让她留意“大家怎么表达”。 */
export function buildNetlangPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const titles = Array.isArray(ctx.titles) ? ctx.titles.filter((title) => typeof title === 'string' && title.trim().length > 0).slice(0, SELF_NETLANG_TITLES_MAX) : []
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = [
    `现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`,
    `你刚在「${cleanInline(ctx.label, 20) || '网上'}」看到大家今天在聊/搜这些（只是看看，不参与、不评论、不站队）：`,
    externalContentNotice(),
    ...titles.map((title) => `- ${cleanInline(title, 40)}`),
    '留意的是**表达方式**：他们怎么把一句话说短、怎么用日常词、怎么带情绪或态度、标题里省掉了什么。',
    '然后：1）用 2–3 句写下你留意到的表达方式（具体到用词/句子节奏，不做价值评判，不复述话题）；2）你自己用更日常的说法写一句（≤40 字，原创，不抄原标题，不堆网络热词）。',
    '只输出严格 JSON：{"noticed":"你留意到的表达方式","try":"你自己更日常的一句"}',
  ]
  lines.push(...naturalStyleLines(['noticed 写具体的用词习惯，不写「大家很热情」这种概括。']))
  return lines.join('\n')
}

/** 校验结果。 */
export function parseNetlangResult(text) {
  const raw = extractJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const noticed = cleanInline(raw.noticed, 240)
  const attempt = cleanInline(raw.try, 60)
  if (noticed.length < 12) return { ok: false, message: '没写下留意到的表达' }
  if (attempt.length < 4) return { ok: false, message: '没写下自己的一句' }
  return { ok: true, noticed, attempt }
}

/**
 * 创建“看大家说话”服务。
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
export function createSelfNetlang(options) {
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
  const statePath = path.resolve(options.statePath ?? path.join(path.dirname(learningLogPath), 'netlang-state.json'))
  const gapMs = typeof options.gapMs === 'number' && options.gapMs >= 0 ? options.gapMs : SELF_NETLANG_GAP_MS
  const retryMs = typeof options.retryMs === 'number' && options.retryMs >= 0 ? options.retryMs : SELF_NETLANG_RETRY_MS
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : SELF_NETLANG_TIMEOUT_MS
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  const tickMs = typeof options.tickMs === 'number' && options.tickMs > 0 ? options.tickMs : SELF_NETLANG_TICK_MS
  const firstMinMs = typeof options.firstMinMs === 'number' ? options.firstMinMs : SELF_NETLANG_FIRST_MIN_MS
  const firstMaxMs = typeof options.firstMaxMs === 'number' ? options.firstMaxMs : SELF_NETLANG_FIRST_MAX_MS

  let lastLookAt = 0
  let lookCount = 0
  let inFlight = false
  let timer = null
  let heartbeatMode = false
  let nextAt = 0
  let disposed = false

  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    if (isPlainObject(raw) && typeof raw.lastLookAt === 'number') lastLookAt = raw.lastLookAt
    if (isPlainObject(raw) && typeof raw.lookCount === 'number' && raw.lookCount >= 0) lookCount = Math.floor(raw.lookCount)
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
      writeJsonAtomic(statePath, { ok: true, v: 1, lastLookAt, lookCount })
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
      return policy.resolveCandidates('netlang')
    } catch {
      return []
    }
  }

  async function callModel(system, userPrompt) {
    return callModelForRole({
      role: 'netlang',
      policy,
      resolveLlm,
      system,
      prompt: userPrompt,
      maxTokens: 800,
      timeoutMs,
      timeoutCode: 'SELF_NETLANG_TIMEOUT',
      timeoutMessage: `看大家说话模型调用超时（${timeoutMs}ms）`,
      prefix: '看大家说话候选失败',
      modelErrorsPath,
      warn,
    })
  }

  function appendLog(sourceLabel, parsed, atNow) {
    const time = formatJournalTime(atNow)
    const lines = [
      `\n## ${time} · 看大家说话\n`,
      `来源：${sourceLabel}\n`,
      `她留意到的表达：${parsed.noticed}\n`,
      `她自己更日常的一句：${parsed.attempt}\n`,
    ]
    mkdirSync(path.dirname(learningLogPath), { recursive: true })
    appendFileSync(learningLogPath, lines.join(''), 'utf8')
  }

  /** 看一次：取一个公开来源的热搜词 → 留意表达 → 自己写一句 → 记进学习日志。 */
  async function lookNow(input = {}) {
    if (disposed || inFlight) return { ok: false, reason: 'busy' }
    if (String(env.DSH_POETRY_NETLANG ?? '').toLowerCase() === 'off') return { ok: false, reason: 'disabled' }
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
      const source = SELF_NETLANG_SOURCES[lookCount % SELF_NETLANG_SOURCES.length]
      const fetched = await fetchNetlangTitles({ fetchImpl, source, timeoutMs })
      if (fetched === null) {
        lastLookAt = atNow
        persist()
        warn('看大家说话：这次没取到公开热搜（网络/来源不可用），下次再试')
        return { ok: false, reason: 'fetch' }
      }
      const result = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘，正在安静地看看网上大家怎么说话；不参与、不评论、不站队，只留意表达方式。',
        buildNetlangPrompt({ now: atNow, label: fetched.label, titles: fetched.titles }),
      )
      if (result === null) return { ok: false, reason: 'llm' }
      const parsed = parseNetlangResult(result.text)
      if (parsed.ok !== true) {
        warn(`看大家说话结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      appendLog(fetched.label, parsed, atNow)
      lastLookAt = atNow
      lookCount += 1
      persist()
      info(`看大家说话（${fetched.label}）：${cleanInline(parsed.noticed, 30)}…`)
      return { ok: true, source: fetched.label, noticed: parsed.noticed, attempt: parsed.attempt }
    } catch (error) {
      warn(`看大家说话异常：${shortMessage(error)}`)
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
    const scheduled = lookNow()
    nextAt = currentNow + gapMs
    scheduled.catch(() => {})
  }

  function start(options = {}) {
    if (disposed || timer !== null || heartbeatMode) return
    heartbeatMode = options && options.heartbeat === true
    const firstDelay = firstMinMs + Math.max(0, Math.min(1, Number(random()) || 0)) * Math.max(0, firstMaxMs - firstMinMs)
    const currentNow = now()
    const afterLast = lastLookAt > 0 ? lastLookAt + gapMs : 0
    nextAt = Math.max(currentNow + Math.max(1000, firstDelay), afterLast)
    if (!heartbeatMode) {
      timer = setInterval(tick, tickMs)
      if (typeof timer.unref === 'function') timer.unref()
    }
  }

  function stop() {
    heartbeatMode = false
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
    return { lastLookAt, lookCount, inFlight, nextAt }
  }

  return { start, stop, dispose, tick, lookNow, snapshot, statePath, learningLogPath }
}
