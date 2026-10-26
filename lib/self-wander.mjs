// lib/self-wander.mjs —— 她在互联网上“四处走走”（v1.64）。
//
// 只做一件事：每隔一段时间，去一个允许的公开页面随机看一眼（目前是中文维基百科的
// 随机条目摘要），然后用她自己的话写下看到了什么、哪儿让她停了一下。
// 约束：
//   · 只 GET 白名单域名，不带任何用户信息/cookie/凭据；不登录、不发表、不评论；
//   · 只取摘要（≤1200 字），不把网页正文存进记忆——记忆里只留她自己的话 + 页面标题；
//   · 失败静默推迟，不刷屏；睡觉时不出门；`DSH_POETRY_WANDER=off` 可关。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from './llm-call.mjs'
import { naturalStyleLines } from './language-style.mjs'
import { formatJournalTime } from './memory-journal.mjs'
import { extractPageLinks } from './safe-web.mjs'
import { writeJsonAtomic } from './settings-store.mjs'
import { externalContentNotice } from './external-content.mjs'

/** 两次出门之间至少隔这么久。 */
export const SELF_WANDER_GAP_MS = 40 * 60 * 1000
/** 失败/睡觉时的重试间隔。 */
export const SELF_WANDER_RETRY_MS = 30 * 60 * 1000
/** 第一次出门（插件启动后）的随机延迟。 */
export const SELF_WANDER_FIRST_MIN_MS = 30 * 1000
export const SELF_WANDER_FIRST_MAX_MS = 90 * 1000
/** 巡检 tick。 */
export const SELF_WANDER_TICK_MS = 60 * 1000
/** 网络超时。 */
export const SELF_WANDER_TIMEOUT_MS = 20 * 1000
/** 允许访问的域名（只读公开页面摘要）。 */
/** v2.0：不再只限中英文维基，所有 Wikipedia / Wikisource 语言都可以去。 */
export const SELF_WANDER_ALLOWED_SUFFIXES = Object.freeze(['wikipedia.org', 'wikisource.org'])
export const SELF_WANDER_LANGUAGES = Object.freeze(['zh', 'en', 'ja', 'de', 'fr', 'es', 'ru', 'it', 'pt', 'ko'])
/** 兼容旧导出（测试/文档用）；真实校验按后缀。 */
export const SELF_WANDER_ALLOWED_HOSTS = Object.freeze(['zh.wikipedia.org', 'en.wikipedia.org'])
export function wanderRandomUrl(language = 'zh') {
  const lang = SELF_WANDER_LANGUAGES.includes(language) ? language : 'zh'
  return `https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`
}
/** 随机条目摘要 API（中文维基百科）。 */
export const SELF_WANDER_RANDOM_URL = wanderRandomUrl('zh')

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
  const message = error instanceof Error ? error.message : String(error ?? '')
  return cleanInline(message, 160)
}

/** 从模型输出里取出 JSON（可能带 markdown fence）。 */
function extractWanderJson(text) {
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

/** 构造网络溜达 prompt（只给她看标题与摘要）。 */
export function buildWanderPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const page = isPlainObject(ctx.page) ? ctx.page : {}
  const title = cleanInline(page.title, 60)
  const summary = cleanInline(page.extract, 1200)
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = [`现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`, '你在网络上随便走走，刚走到一个地方。', externalContentNotice()]
  if (title.length > 0) lines.push(`页面标题：${title}。`)
  if (summary.length > 0) lines.push(`你只读了这一小段摘要：「${summary}」`)
  lines.push(
    '用 2–4 句第一人称写下你看到这儿时真正停下来的东西：具体的画面、疑问、联想都可以；不要复述摘要，不要写成科普或总结。',
    '如果这一页让你觉得没意思，就直接写没意思——不用装喜欢，也不用勉强自己找个意义。',
    '只输出严格 JSON：{"note":"你看到/想到的（12–240 字）","interesting":true或false}',
  )
  lines.push(...naturalStyleLines(['note 里别用「这让我意识到／不禁思考」这类收束。']))
  return lines.join('\n')
}

/** 校验网络溜达结果。 */
export function parseWanderResult(text) {
  const raw = extractWanderJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const note = cleanInline(raw.note, 240)
  if (note.length < 12) return { ok: false, message: '笔记太短' }
  const interesting = raw.interesting === true
  return { ok: true, note, interesting }
}

/** 从允许的公开页面取一条随机摘要；失败/越界返回 null（调用方静默推迟）。 */
export async function fetchRandomPage(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const url = typeof options.url === 'string' && options.url.length > 0 ? options.url : SELF_WANDER_RANDOM_URL
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : SELF_WANDER_TIMEOUT_MS
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
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
    // 跟随重定向后仍必须是白名单域名。
    const finalUrl = typeof response.url === 'string' && response.url.length > 0 ? response.url : url
    let host = ''
    try {
      host = new URL(finalUrl).hostname.toLowerCase()
    } catch {
      return null
    }
    if (!SELF_WANDER_ALLOWED_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix))) return null
    const data = typeof response.json === 'function' ? await response.json() : null
    if (!isPlainObject(data)) return null
    const title = cleanInline(data.title, 60)
    const extract = cleanInline(data.extract, 1200)
    if (title.length === 0 || extract.length < 20) return null
    return { title, extract, host, url: finalUrl }
  } catch {
    return null
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * 创建“网络溜达”服务。
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
export function createSelfWander(options) {
  const state = options.state ?? null
  /** v2.1：安全网页访问器（可为空；为空时仍只去维基）。 */
  const webAccess = options.webAccess ?? null
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
  const statePath = path.resolve(options.statePath ?? path.join(path.dirname(learningLogPath), 'wander-state.json'))
  const gapMs = typeof options.gapMs === 'number' && options.gapMs >= 0 ? options.gapMs : SELF_WANDER_GAP_MS
  const retryMs = typeof options.retryMs === 'number' && options.retryMs >= 0 ? options.retryMs : SELF_WANDER_RETRY_MS
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : SELF_WANDER_TIMEOUT_MS
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  const tickMs = typeof options.tickMs === 'number' && options.tickMs > 0 ? options.tickMs : SELF_WANDER_TICK_MS
  const firstMinMs = typeof options.firstMinMs === 'number' ? options.firstMinMs : SELF_WANDER_FIRST_MIN_MS
  const firstMaxMs = typeof options.firstMaxMs === 'number' ? options.firstMaxMs : SELF_WANDER_FIRST_MAX_MS

  let lastWanderAt = 0
  /** v2.2：上一次走到的公开网页，下次可以先从它的链接继续走。 */
  let lastWebUrl = ''
  let inFlight = false
  let timer = null
  let heartbeatMode = false
  let nextAt = 0
  let disposed = false

  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    if (isPlainObject(raw) && typeof raw.lastWanderAt === 'number' && Number.isFinite(raw.lastWanderAt)) {
      lastWanderAt = raw.lastWanderAt
    }
    if (isPlainObject(raw) && typeof raw.lastWebUrl === 'string' && raw.lastWebUrl.startsWith('https://')) {
      lastWebUrl = raw.lastWebUrl
    }
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
      writeJsonAtomic(statePath, { ok: true, v: 1, lastWanderAt, ...(lastWebUrl ? { lastWebUrl } : {}) })
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
      return policy.resolveCandidates('wander')
    } catch {
      return []
    }
  }

  async function callModel(system, userPrompt) {
    return callModelForRole({
      role: 'wander',
      policy,
      resolveLlm,
      system,
      prompt: userPrompt,
      maxTokens: 700,
      timeoutMs,
      timeoutCode: 'SELF_WANDER_TIMEOUT',
      timeoutMessage: `网络溜达模型调用超时（${timeoutMs}ms）`,
      prefix: '网络溜达候选失败',
      modelErrorsPath,
      warn,
    })
  }

  function appendLog(page, parsed, atNow) {
    const time = formatJournalTime(atNow)
    const lines = [
      `\n## ${time} · 溜达\n`,
      `地方：${page.title}（${page.host}）\n`,
      `她写下的：${parsed.note}\n`,
      `有意思：${parsed.interesting === true ? '是' : '否'}\n`,
    ]
    mkdirSync(path.dirname(learningLogPath), { recursive: true })
    appendFileSync(learningLogPath, lines.join(''), 'utf8')
  }

  /** 出门走一次：取一页 → 她写两句 → 记进学习日志。 */
  async function wanderNow(input = {}) {
    if (disposed || inFlight) return { ok: false, reason: 'busy' }
    if (String(env.DSH_POETRY_WANDER ?? '').toLowerCase() === 'off') return { ok: false, reason: 'disabled' }
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
      if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
        return { ok: false, reason: 'llm' }
      }
      // v2.1：如果她能说出自己最近在琢磨什么，就先按这句话去公开网上搜一次；
      // 搜到/抓到就用真实网页，失败再回到维基随机。外部文本仍按“只是引文”隔离。
      let page = null
      let webTried = false
      if (webAccess !== null && String(env.DSH_POETRY_WEB ?? '').toLowerCase() !== 'off') {
        // v2.2：先从上一页的链接继续走一步；失败再按她正在琢磨的事搜索。
        if (lastWebUrl.length > 0) {
          webTried = true
          try {
            const previous = await webAccess.fetchPage(lastWebUrl, { includeHtml: true })
            const links = extractPageLinks(previous.html, previous.url || lastWebUrl)
            if (links.length > 0) {
              const nextUrl = links[Math.floor(Math.max(0, Math.min(0.999999, random())) * links.length)]
              const nextPage = await webAccess.fetchPage(nextUrl, { includeHtml: true })
              const text = cleanInline(nextPage && nextPage.text, 1200)
              if (text.length >= 200) {
                page = {
                  title: cleanInline(nextPage.title, 60) || '一页没标题的网页',
                  extract: text,
                  host: (() => {
                    try {
                      return new URL(nextPage.url || nextUrl).hostname
                    } catch {
                      return ''
                    }
                  })(),
                  url: String(nextPage.url || nextUrl),
                  source: 'web',
                }
                lastWebUrl = page.url
              }
            }
          } catch {
            /* 顺着链接失败，继续搜索/回退 */
          }
        }
        let query = ''
        try {
          const snap = state !== null && typeof state.snapshot === 'function' ? state.snapshot() : null
          query = cleanInline(snap && typeof snap.experiencing === 'string' ? snap.experiencing : '', 60)
        } catch {
          query = ''
        }
        if (query.length >= 4) {
          webTried = true
          try {
            const results = typeof webAccess.search === 'function' ? await webAccess.search(query, { limit: 3 }) : []
            for (const item of Array.isArray(results) ? results.slice(0, 2) : []) {
              if (!item || typeof item.url !== 'string') continue
              try {
                const fetched = await webAccess.fetchPage(item.url)
                const text = cleanInline(fetched && fetched.text, 1200)
                if (text.length < 200) continue
                page = {
                  title: cleanInline(fetched.title || item.title, 60) || '一页没标题的网页',
                  extract: text,
                  host: (() => {
                    try {
                      return new URL(fetched.url || item.url).hostname
                    } catch {
                      return ''
                    }
                  })(),
                  url: String(fetched.url || item.url),
                  source: 'web',
                }
                lastWebUrl = page.url
                break
              } catch {
                /* 单个结果抓取失败就试下一个 */
              }
            }
          } catch {
            /* 搜索失败回落到维基 */
          }
        }
      }
      if (page === null) {
        // v2.0：每次随机挑一个维基语言（不再固定中文），逐步去看不同语言的页面。
        const language = SELF_WANDER_LANGUAGES[Math.floor(Math.max(0, Math.min(0.999999, random())) * SELF_WANDER_LANGUAGES.length)]
        page = await fetchRandomPage({ fetchImpl, url: wanderRandomUrl(language), timeoutMs })
      }
      if (page === null) {
        lastWanderAt = atNow
        persist()
        warn('网络溜达：这次没走到哪里（网络/页面不可用），下次再试')
        return { ok: false, reason: 'fetch' }
      }
      const result = await callModel(
        '你是住在 DSH Web 角落的鲸鱼娘，正在互联网上随便走走；只写你真实看到/想到的，不装喜欢。',
        buildWanderPrompt({ now: atNow, page }),
      )
      if (result === null) return { ok: false, reason: 'llm' }
      const parsed = parseWanderResult(result.text)
      if (parsed.ok !== true) {
        warn(`网络溜达结果无效：${parsed.message}`)
        return { ok: false, reason: 'invalid' }
      }
      appendLog(page, parsed, atNow)
      lastWanderAt = atNow
      persist()
      info(`网络溜达：${page.title} → ${parsed.interesting === true ? '有点意思' : '没什么感觉'}`)
      return {
        ok: true,
        title: page.title,
        host: page.host,
        url: page.url,
        note: parsed.note,
        interesting: parsed.interesting,
      }
    } catch (error) {
      warn(`网络溜达异常：${shortMessage(error)}`)
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
    const scheduled = wanderNow()
    nextAt = currentNow + gapMs
    scheduled.catch(() => {})
  }

  function start(options = {}) {
    if (disposed || timer !== null || heartbeatMode) return
    heartbeatMode = options && options.heartbeat === true
    const firstDelay = firstMinMs + Math.max(0, Math.min(1, Number(random()) || 0)) * Math.max(0, firstMaxMs - firstMinMs)
    const currentNow = now()
    // 重启插件时不立刻重复出门：至少等到上次出门 + gap。
    const afterLast = lastWanderAt > 0 ? lastWanderAt + gapMs : 0
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
    return { lastWanderAt, inFlight, nextAt, lastWebUrl }
  }

  return { start, stop, dispose, tick, wanderNow, snapshot, statePath, learningLogPath }
}
