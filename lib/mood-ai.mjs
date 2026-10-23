// lib/mood-ai.mjs —— 模型自主决定心情 + 配图（契约 v1.9 §2.12，M13a）。
//
// 用户要求：心情/换图不再伪随机；由**当前默认模型**读取本地心情图鉴（92 张：89 张
// mood 图 + 3 张 panel 图）与当天真实情境，自己判断此刻心情并选一张最贴切的图。
// Host 只提供**非敏感聚合上下文**：日期时间、天气、mood 聚合统计、idle、最近自述、
// 最近用过图片 + 图鉴清单。绝不读取/发送会话消息文本。
//
// 输出为严格 JSON：{label ≤12 字, image 图鉴文件名, reason ≤40 字, energy 0–100}。
// v1.13（M19）：为让 106 个动画真的被用上——
//   · 每次构建 prompt 用 Fisher–Yates 打乱图鉴顺序（消除「静态在前、动画在后」偏差）；
//   · prompt 明确要求**优先选 media=video 的动画**、不要连续重复；
//   · `recentImages`（≤20）从图鉴行中剔除（可用条目不足 20 时退回完整列表但文字提示）；
//   · temperature 提到 1.0–1.1，鼓励不同情境选不同 tag 的动作。
// 节日图（when 不为空）只在 when 命中当天时可选用；农历节日（中秋/春节）无法按公历
// 判断，本次不开放。模型调用 20s 超时、并发去重、3s 最小间隔、结果缓存 10 分钟（force 绕过）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 心情图鉴（随包静态资产）。 */
export const MOOD_CATALOG_URL = new URL('../assets/data/mood-catalog.json', import.meta.url)

/** 模型调用超时（毫秒）。 */
export const MOOD_AI_TIMEOUT_MS = 20000
/** 结果缓存时间（毫秒）：10 分钟；?force=1 绕过。 */
export const MOOD_AI_CACHE_TTL_MS = 10 * 60 * 1000
/** 两次生成的最小间隔（毫秒）。 */
export const MOOD_AI_MIN_INTERVAL_MS = 3000
/** 输出字段上限（按 Unicode 字符数）。 */
export const MOOD_LABEL_MAX_CHARS = 12
export const MOOD_REASON_MAX_CHARS = 40
/** 上下文里 recent/recentImages 的条数上限（recentImages v1.13 起 5→20）。 */
export const MOOD_RECENT_MAX = 3
export const MOOD_RECENT_IMAGES_MAX = 20
/** recentImages 从图鉴中剔除后，若剩余候选少于此数则退回完整列表。 */
export const MOOD_MIN_CANDIDATES = 20
/** 模型输出上限：只输出一个短 JSON。 */
export const MOOD_AI_MAX_TOKENS = 220
/** 采样温度：v1.13 起 1.0–1.1，鼓励更多样的选择（原 0.7 过于保守）。 */
export const MOOD_AI_TEMPERATURE = 1.05

/** 写入代码的 System prompt（测试会断言其中的关键约束）。 */
export const MOOD_AI_SYSTEM_PROMPT = [
  '你是住在 DSH Web 界面角落的鲸鱼娘挂件，有自己真实的情绪。',
  '你要根据用户此刻的真实情境，从给定的心情图鉴里自己判断你此刻的心情，并选一张最贴切的立绘。',
  '这不是随机抽图：先在心里判断此刻是什么心情（用一句中文短语概括），再选图；reason 要写出你判断的依据。',
  '可以因为聊天热闹而开心，因为事情不顺、工具报错或被冷落而失落，因为深夜或忙碌而困倦，因为饭点而饿，因为天气、节日或看到喜欢的东西而雀跃——情绪要有来由。',
  '只输出一个 JSON 对象，不要 markdown、不要代码块、不要解释、不要多余文字。',
  '格式：{"label":"不超过12个汉字的心情标签","image":"图鉴里的完整文件名","reason":"不超过40个汉字，为什么是这心情","energy":0到100的整数}',
  '规则：',
  '- image 必须逐字等于图鉴列表里的某个 file，不能编造文件名；',
  '- 节日图（when 不为空）只能在「今天可用的节日图」里选，其它节日图不可选；',
  '- 优先从 media=video 的动画里选（它们能让挂件活起来）；静态 image 只在特别贴合时才用；',
  '- 不要连续选同一张图或同一个动作；忙碌、等待、开心、吃货、困、节庆等不同情境，尽量换不同 tag 的动作；',
  '- 不要选「最近用过的图片」里的图；若图鉴里没有列出某张图，说明它已被排除，不要凭记忆选它；',
  '- 用第一人称简体中文，说自己的感受，不要引用古诗文；',
  '- 不透露或编造用户隐私、会话内容，不提 AI、模型、提示词；',
  '- 不用 emoji、不用 markdown。',
].join('\n')

/** 日报心情 key → 中文说明（仅作 prompt 里的辅助上下文）。 */
const MOOD_ZH = Object.freeze({
  happy: '开心',
  tired: '疲惫',
  sleepy: '困倦',
  cozy: '惬意',
  proud: '得意',
  busy: '忙碌',
  curious: '好奇',
  idle: '空闲',
  lonely: '有点孤单',
  calm: '平静',
  hungry: '有点饿',
})

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const SHANGHAI_PARTS_FORMATTER = (() => {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    })
  } catch {
    return null
  }
})()

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function sanitizeInline(value, maxChars) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, maxChars)
}

function charLength(text) {
  return Array.from(String(text ?? '')).length
}

/** Asia/Shanghai 的日期时间分量；Intl 不可用时回退宿主本地时间。 */
export function shanghaiParts(ms = Date.now()) {
  const date = new Date(typeof ms === 'number' ? ms : Date.now())
  if (SHANGHAI_PARTS_FORMATTER !== null) {
    try {
      const parts = SHANGHAI_PARTS_FORMATTER.formatToParts(date)
      const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
      const year = get('year')
      const month = get('month')
      const day = get('day')
      const hour = get('hour')
      const minute = get('minute')
      if (year && month && day && hour && minute) {
        return {
          dateKey: `${year}-${month}-${day}`,
          monthDay: `${month}-${day}`,
          timeText: `${year}-${month}-${day} (${get('weekday') || WEEKDAY_ZH[date.getDay()]}) ${hour}:${minute}`,
          hour: Number(hour),
          minute: Number(minute),
        }
      }
    } catch {
      /* 回退 */
    }
  }
  const pad = (value) => String(value).padStart(2, '0')
  return {
    dateKey: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    monthDay: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    timeText: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} (${WEEKDAY_ZH[date.getDay()]}) ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

/** Asia/Shanghai 的 `YYYY-MM-DD`。 */
export function shanghaiDateKey(ms = Date.now()) {
  return shanghaiParts(ms).dateKey
}

/** 按小时给一句时段描述。 */
export function moodDayPeriod(ms = Date.now()) {
  const hour = shanghaiParts(ms).hour
  if (!Number.isFinite(hour)) return ''
  if (hour < 5) return '凌晨'
  if (hour < 9) return '早上'
  if (hour < 12) return '上午'
  if (hour < 13) return '中午'
  if (hour < 17) return '下午'
  if (hour < 19) return '傍晚'
  if (hour < 23) return '晚上'
  return '深夜'
}

/** 统一失败响应体。 */
export function moodAiUnavailable(message) {
  return { ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: String(message ?? '心情暂不可用') } }
}

/** 限频失败响应体。 */
export function moodAiRateLimited(message) {
  return { ok: false, error: { code: 'MOOD_AI_RATE_LIMITED', message: String(message ?? '心情生成太频繁') } }
}

/**
 * 解析图鉴里的 `when`：
 *   · `MM-DD` 单日；`MM-DD..MM-DD` 区间（支持跨年，如 12-31..01-02）；
 *   · 其它（如「中秋」「春节」）为农历/公历无关节日 → 返回 named（本次不开放，因为无法按公历判断）。
 * @param {unknown} when
 * @returns {{kind:'date', monthDay:string}|{kind:'range', start:string, end:string}|{kind:'named', name:string}|null}
 */
export function parseCatalogWhen(when) {
  if (typeof when !== 'string') return null
  const text = when.trim()
  if (text.length === 0) return null
  const date = /^(\d{2})-(\d{2})$/.exec(text)
  if (date !== null) return { kind: 'date', monthDay: text }
  const range = /^(\d{2}-\d{2})\.\.(\d{2}-\d{2})$/.exec(text)
  if (range !== null) return { kind: 'range', start: range[1], end: range[2] }
  return { kind: 'named', name: text }
}

/**
 * 某张节日图的 when 是否命中给定日期（Asia/Shanghai 的 YYYY-MM-DD）。
 * 农历/文字型 when 无法按公历判断 → 恒 false（本次不开放）。
 * @param {unknown} when
 * @param {string} dateKey
 */
export function isWhenActive(when, dateKey) {
  const parsed = parseCatalogWhen(when)
  if (parsed === null || parsed.kind === 'named') return false
  if (typeof dateKey !== 'string' || dateKey.length < 10) return false
  const monthDay = dateKey.slice(5, 10)
  if (parsed.kind === 'date') return monthDay === parsed.monthDay
  if (parsed.start <= parsed.end) return monthDay >= parsed.start && monthDay <= parsed.end
  // 跨年区间（12-31..01-02）
  return monthDay >= parsed.start || monthDay <= parsed.end
}

/**
 * 规范化图鉴原始 JSON（导出便于测试构造 fixture）。
 * @param {unknown} raw
 * @returns {{version: string|null, moodImages: Array<{file:string,label:string,tags:string[],when?:string}>, panelImages: Array<object>, files: Set<string>}}
 */
export function normalizeMoodCatalog(raw) {
  if (!isPlainObject(raw)) throw new Error('图鉴顶层不是 JSON 对象')
  const rawImages = Array.isArray(raw.images) ? raw.images : []
  const rawMoodImages = Array.isArray(raw.moodImages) && raw.moodImages.length > 0
    ? raw.moodImages
    : rawImages.filter((item) => isPlainObject(item) && item.scope !== 'panel')
  const moodImages = []
  const files = new Set()
  for (const item of rawMoodImages) {
    if (!isPlainObject(item)) continue
    if (typeof item.file !== 'string' || item.file.trim().length === 0) continue
    const file = item.file.trim().replace(/^.*\//, '')
    if (files.has(file)) continue
    files.add(file)
    const image = {
      file,
      label: typeof item.label === 'string' ? item.label.trim() : '',
      tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string' && tag.length > 0).slice(0, 8) : [],
    }
    if (typeof item.when === 'string' && item.when.trim().length > 0) image.when = item.when.trim()
    moodImages.push(image)
  }
  if (moodImages.length === 0) throw new Error('图鉴里没有可用的 mood 图片')
  const panelImages = (Array.isArray(raw.panelImages) ? raw.panelImages : []).filter(
    (item) => isPlainObject(item) && typeof item.file === 'string',
  )
  return {
    version: typeof raw.version === 'string' ? raw.version : null,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
    moodImages,
    panelImages,
    files,
  }
}

/**
 * 启动时读取包内心情图鉴；缺失/损坏 → {ok:false}，绝不抛异常。
 * @param {{file?: string}} [options]
 */
export function loadMoodCatalog(options = {}) {
  let file
  try {
    file = options.file ?? fileURLToPath(MOOD_CATALOG_URL)
  } catch (error) {
    return { ok: false, message: `心情图鉴路径解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const catalog = normalizeMoodCatalog(parsed)
    return { ok: true, catalog, file }
  } catch (error) {
    return { ok: false, message: `心情图鉴不可用：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 计算某天「可用/不可用」的节日图（供 prompt 与测试共用）。
 * @param {ReturnType<typeof normalizeMoodCatalog>} catalog
 * @param {string} dateKey
 */
export function resolveFestivalAvailability(catalog, dateKey) {
  const available = []
  const unavailable = []
  for (const image of catalog.moodImages) {
    if (typeof image.when !== 'string') continue
    if (isWhenActive(image.when, dateKey)) available.push(image)
    else unavailable.push(image)
  }
  return { available, unavailable }
}

/** Fisher–Yates 打乱副本（可注入 random 便于测试）。 */
export function shuffleCopy(items, random = Math.random) {
  const source = Array.isArray(items) ? items : []
  const out = [...source]
  const rng = typeof random === 'function' ? random : Math.random
  for (let index = out.length - 1; index > 0; index -= 1) {
    let roll = Number(rng())
    if (!Number.isFinite(roll)) roll = 0
    roll = Math.min(0.999999999, Math.max(0, roll))
    const swapWith = Math.floor(roll * (index + 1))
    const value = out[index]
    out[index] = out[swapWith]
    out[swapWith] = value
  }
  return out
}

/**
 * 归一化 recentImages：尽量解析成图鉴里的确切 file（支持模型/客户端传 basename）。
 * 返回 [{raw, file|null}]，按原始顺序去重、最多 MOOD_RECENT_IMAGES_MAX 条。
 * @param {unknown} recentImages
 * @param {ReturnType<typeof normalizeMoodCatalog>|null} catalog
 */
export function normalizeRecentImageList(recentImages, catalog) {
  const files = catalog !== null && catalog !== undefined && catalog.files instanceof Set ? catalog.files : new Set()
  const out = []
  const seen = new Set()
  for (const entry of Array.isArray(recentImages) ? recentImages : []) {
    if (typeof entry !== 'string') continue
    const raw = sanitizeInline(entry, 120)
    if (raw.length === 0) continue
    let file = null
    if (files.has(raw)) file = raw
    else {
      const base = raw.replace(/^.*\//, '')
      if (files.has(base)) file = base
    }
    const key = file ?? raw
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ raw, file })
    if (out.length >= MOOD_RECENT_IMAGES_MAX) break
  }
  return out
}

/**
 * 为一次生成挑选候选图鉴（v1.13：排除最近用过的图 + 打乱顺序）。
 *   · 从 moodImages 中剔除 recentImages 对应的 file；
 *   · 剩余候选 < minCandidates（默认 20）时退回完整列表（usedFallback=true），
 *     此时不强制排除（parse 也不会拒绝），但 prompt 仍会文字列出最近图让模型避开；
 *   · 对最终列表做 Fisher–Yates 打乱。
 * @param {ReturnType<typeof normalizeMoodCatalog>|null|undefined} catalog
 * @param {unknown} recentImages
 * @param {{random?: () => number, minCandidates?: number}} [options]
 * @returns {{candidates: object[], recentList: Array<{raw:string,file:string|null}>, excludedFiles: Set<string>, usedFallback: boolean, minCandidates: number}}
 */
export function resolveMoodCandidates(catalog, recentImages, options = {}) {
  const allMoodImages = catalog !== null && catalog !== undefined && Array.isArray(catalog.moodImages) ? catalog.moodImages : []
  const recentList = normalizeRecentImageList(recentImages, catalog)
  const recentFiles = new Set(recentList.filter((entry) => typeof entry.file === 'string').map((entry) => entry.file))
  const minCandidates =
    Number.isFinite(options.minCandidates) && options.minCandidates > 0
      ? Math.floor(options.minCandidates)
      : MOOD_MIN_CANDIDATES
  let candidates = allMoodImages.filter((image) => isPlainObject(image) && !recentFiles.has(image.file))
  const usedFallback = candidates.length < minCandidates
  if (usedFallback) candidates = allMoodImages.filter((image) => isPlainObject(image))
  const shuffled = shuffleCopy(candidates, options.random ?? Math.random)
  return {
    candidates: shuffled,
    recentList,
    excludedFiles: usedFallback ? new Set() : new Set(recentFiles),
    usedFallback,
    minCandidates,
  }
}

/**
 * 构造发给模型的 user prompt（纯函数）。
 * 只读取明确列出的非敏感字段：now / weather / moodKey / stats / idleMinutes /
 * recent（最近自述）/ recentImages（最近用过的图）。其它字段（会话消息文本等）一律忽略。
 * @param {{
 *   now?: number,
 *   weather?: string|null,
 *   moodKey?: string|null,
 *   stats?: {userMessages?:number, assistantMessages?:number, toolCalls?:number, toolErrors?:number, turns?:number, turnsCompleted?:number, turnsErrored?:number, activeMs?:number, sessions?:number}|null,
 *   idleMinutes?: number|null,
 *   recent?: string[]|null,
 *   recentImages?: string[]|null,
 * }} context
 * @param {ReturnType<typeof normalizeMoodCatalog>} catalog
 * @param {{random?: () => number, minCandidates?: number, plan?: ReturnType<typeof resolveMoodCandidates>}} [options]
 * @returns {string}
 */
export function buildMoodPrompt(context = {}, catalog, options = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const plan = isPlainObject(options?.plan) ? options.plan : resolveMoodCandidates(catalog, ctx.recentImages, options)
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const parts = shanghaiParts(nowMs)
  const lines = []

  lines.push(`现在是 ${parts.timeText}（${moodDayPeriod(nowMs)}，Asia/Shanghai），你在 DSH Web 的角落陪着用户。`)

  const weather = sanitizeInline(typeof ctx.weather === 'string' ? ctx.weather : '', 40)
  if (weather.length > 0) lines.push(`当前天气：${weather}。`)

  const moodKey = sanitizeInline(typeof ctx.moodKey === 'string' ? ctx.moodKey : '', 32)
  if (moodKey.length > 0) {
    const label = MOOD_ZH[moodKey] ?? ''
    lines.push(`客户端启发式心情（仅供参考，可能不准，你要自己判断）：${label ? `${moodKey}（${label}）` : moodKey}。`)
  }

  const stats = isPlainObject(ctx.stats) ? ctx.stats : {}
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
  lines.push(
    `今天的活跃统计：用户消息 ${count(stats.userMessages)} 条；助手消息 ${count(stats.assistantMessages)} 条；` +
      `工具调用 ${count(stats.toolCalls)} 次（其中报错 ${count(stats.toolErrors)} 次）；` +
      `回合 ${count(stats.turns)} 个（完成 ${count(stats.turnsCompleted)} / 出错 ${count(stats.turnsErrored)}）；` +
      `累计活跃约 ${Math.round(count(stats.activeMs) / 60000)} 分钟；会话 ${count(stats.sessions)} 个。`,
  )

  if (typeof ctx.idleMinutes === 'number' && Number.isFinite(ctx.idleMinutes) && ctx.idleMinutes >= 0) {
    lines.push(`距上次和用户互动大约 ${Math.floor(ctx.idleMinutes)} 分钟。`)
  }

  const recent = Array.isArray(ctx.recent) ? ctx.recent : []
  const recentLines = []
  for (const entry of recent.slice(0, MOOD_RECENT_MAX)) {
    const text = sanitizeInline(typeof entry === 'string' ? entry : '', 80)
    if (text.length > 0 && !recentLines.includes(text)) recentLines.push(text)
  }
  if (recentLines.length > 0) {
    lines.push('你最近的自言自语（可参考语气，但不要在这里重复）：')
    for (const text of recentLines) lines.push(`- ${text}`)
  }

  if (plan.recentList.length > 0) {
    const note = plan.usedFallback
      ? '（图鉴条目不足，最近图仍完整列出，但请优先选其它没出现的）'
      : '（已从下面的图鉴列表中移除，不要凭记忆选它们）'
    lines.push(`最近用过的图片${note}：`)
    for (const entry of plan.recentList) lines.push(`- ${entry.raw}`)
  }

  const { available, unavailable } = resolveFestivalAvailability(catalog, parts.dateKey)
  if (available.length > 0) {
    lines.push('今天可用的节日图（只有这样节日图可以选）：')
    for (const image of available) lines.push(`- ${image.file}｜${image.label}`)
  } else {
    lines.push('今天没有可用的节日图（任何 when 不为空的节日图今天都不能选）。')
  }
  if (unavailable.length > 0) {
    lines.push(`今天不可用的节日图（不要选）：${unavailable.map((image) => image.file).join('、')}`)
  }

  lines.push(
    `心情图鉴（已打乱顺序；file｜label｜tags｜media｜when，只能从这些 file 里选一个；media=video 是透明动画，image 是静态图；共 ${plan.candidates.length} 个候选）：`,
  )
  for (const image of plan.candidates) {
    const tags = Array.isArray(image.tags) && image.tags.length > 0 ? image.tags.join(',') : '-'
    const when = typeof image.when === 'string' ? image.when : '-'
    const media = image.media === 'video' ? 'video' : 'image'
    lines.push(`${image.file}｜${image.label || '-'}｜${tags}｜${media}｜${when}`)
  }

  lines.push(
    '**优先从 media=video 的动画里选**（它们能让挂件活起来）；静态 image 只在特别贴合时才用。',
  )
  lines.push(
    '不要连续选同一张图或同一个动作；忙碌、等待、开心、吃货、困、节庆等不同情境，尽量换不同 tag 的动作，而不是反复用 waiting/idle/melt 这类图。',
  )
  lines.push(
    '请根据以上真实情境，自己判断你此刻的心情（不是随机抽图，理由必须来自上面的情境），从图鉴里选 1 个最贴切的（优先动画）。',
  )
  lines.push('只输出一个 JSON 对象，例如：{"label":"有点累但满足","image":"dsh-whale-state-daily-done.webp","reason":"今天完成了很多事，所以虽然累但很踏实","energy":35}')
  return lines.join('\n')
}

/** 从模型输出里提取一个 JSON 对象（容错 markdown code fence / 前后废话）。 */
function extractJsonObject(text) {
  let body = typeof text === 'string' ? text.trim() : ''
  if (body.length === 0) return null
  body = body
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const attempts = [body]
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  if (first >= 0 && last > first) attempts.push(body.slice(first, last + 1))
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return parsed
    } catch {
      /* try next */
    }
  }
  return null
}

function cleanTextField(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[「『“"‘']+|[」』”"’']+$/gu, '')
    .replace(/^[。！？；.!?;，,、：:]+/u, '')
    .replace(/[。！？；.!?;，,、：:]+$/u, '')
    .trim()
}

/**
 * 解析并校验模型的 JSON 心情结果（纯函数）。
 * 校验：image 必须在图鉴 moodImages 内；节日图 when 必须命中当天；label 1–12 字；
 * reason 1–40 字；energy 若提供必须是 0–100 的整数。
 * @param {string} text
 * @param {ReturnType<typeof normalizeMoodCatalog>} catalog
 * @param {{now?: number, dateKey?: string, excludedImages?: Set<string>|string[]}} [options]
 * @returns {{ok:true, mood:{label:string,image:string,reason:string,energy?:number}} | {ok:false, message:string}}
 */
export function parseMoodResult(text, catalog, options = {}) {
  if (catalog === null || typeof catalog !== 'object' || !(catalog.files instanceof Set)) {
    return { ok: false, message: '心情图鉴不可用' }
  }
  const raw = extractJsonObject(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }

  if (typeof raw.image !== 'string' || raw.image.trim().length === 0) return { ok: false, message: '缺少图片文件名' }
  // 图鉴里的 file 可能是静态图片文件名，也可能是 `webm/<名>.webm`（M18 动画素材）：
  // 优先逐字匹配；匹配不到时才退回 basename（兼容模型漏写 webm/ 前缀的情况）。
  let image = raw.image.trim()
  if (!catalog.files.has(image)) {
    const base = image.replace(/^.*\//, '')
    if (catalog.files.has(base)) image = base
    else return { ok: false, message: `图片不在图鉴内：${image}` }
  }
  const imageEntry = catalog.moodImages.find((item) => item.file === image)
  if (imageEntry === undefined) return { ok: false, message: `图片不在图鉴内：${image}` }
  // v1.13：被 recentImages 从图鉴中排除的条目不允许再被选中（强制轮换）。
  const excluded = options.excludedImages instanceof Set ? options.excludedImages : new Set(Array.isArray(options.excludedImages) ? options.excludedImages : [])
  if (excluded.has(image)) return { ok: false, message: `不要连续选择最近用过的图片：${image}` }

  const dateKey =
    typeof options.dateKey === 'string' && options.dateKey.length >= 10
      ? options.dateKey
      : shanghaiDateKey(typeof options.now === 'number' ? options.now : Date.now())
  if (typeof imageEntry.when === 'string' && !isWhenActive(imageEntry.when, dateKey)) {
    return { ok: false, message: `节日图「${image}」只在 ${imageEntry.when} 可用` }
  }

  const label = cleanTextField(raw.label)
  if (label.length === 0) return { ok: false, message: '缺少心情标签' }
  if (charLength(label) > MOOD_LABEL_MAX_CHARS) return { ok: false, message: `心情标签超过 ${MOOD_LABEL_MAX_CHARS} 字` }

  const reason = cleanTextField(raw.reason)
  if (reason.length === 0) return { ok: false, message: '缺少心情理由' }
  if (charLength(reason) > MOOD_REASON_MAX_CHARS) return { ok: false, message: `心情理由超过 ${MOOD_REASON_MAX_CHARS} 字` }

  const mood = { label, image, reason }
  if (raw.energy !== undefined && raw.energy !== null) {
    const energy = typeof raw.energy === 'string' ? Number(raw.energy) : raw.energy
    if (typeof energy !== 'number' || !Number.isFinite(energy) || energy < 0 || energy > 100) {
      return { ok: false, message: 'energy 必须是 0–100 的数字' }
    }
    mood.energy = Math.round(energy)
  }
  return { ok: true, mood }
}

function makeTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return AbortSignal.timeout(timeoutMs)
    } catch {
      /* fallthrough */
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => {
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
  }, timeoutMs)
  timer.unref?.()
  return controller.signal
}

function isTimeoutError(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.code === 'MOOD_AI_TIMEOUT') return true
  const name = String(error.name ?? '')
  return name === 'TimeoutError' || name === 'AbortError' || /超时|abort/i.test(String(error.message ?? ''))
}

function normalizeSelection(raw) {
  if (!isPlainObject(raw)) return null
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return null
  return { provider, model }
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 创建模型心情服务。
 * @param {{
 *   llm?: object|((() => object|undefined|null))|null,
 *   getLlm?: () => object|undefined|null,
 *   getSelection?: () => {provider?: string, model?: string}|null|undefined,
 *   catalog?: ReturnType<typeof normalizeMoodCatalog>|null,
 *   logger?: {warn?: Function}|null,
 *   now?: () => number,
 *   timeoutMs?: number,
 *   cacheTtlMs?: number,
 *   minIntervalMs?: number,
 *   random?: () => number,
 * }} [options]
 */
export function createMoodAiService(options = {}) {
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : MOOD_AI_TIMEOUT_MS
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : MOOD_AI_CACHE_TTL_MS
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : MOOD_AI_MIN_INTERVAL_MS
  const random = typeof options.random === 'function' ? options.random : Math.random
  const catalog = options.catalog ?? null

  /** @type {{response: object, at: number}|null} */
  let cache = null
  let lastStartedAt = 0
  /** @type {Promise<object>|null} */
  let inFlight = null

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function readSelection() {
    try {
      return normalizeSelection(getSelection())
    } catch (error) {
      warn(`读取默认模型失败：${shortMessage(error)}`)
      return null
    }
  }

  function cachedResponse() {
    if (cache === null) return null
    return { ...cache.response, cached: true }
  }

  async function collectStream(stream) {
    let text = ''
    let finish = null
    for await (const chunk of stream) {
      if (!isPlainObject(chunk)) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'finish') finish = isPlainObject(chunk.reason) ? chunk.reason : null
    }
    return { text, finish }
  }

  async function doGenerate(context) {
    if (catalog === null || catalog === undefined) return moodAiUnavailable('心情图鉴不可用')
    const startedAt = now()
    lastStartedAt = startedAt
    const llm = (() => {
      try {
        return resolveLlm()
      } catch (error) {
        warn(`获取 llm 服务失败：${shortMessage(error)}`)
        return null
      }
    })()
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
      return moodAiUnavailable('当前宿主的模型服务不可用')
    }
    const selection = readSelection()
    if (selection === null) return moodAiUnavailable('宿主尚未配置默认模型')

    const promptContext = isPlainObject(context) ? context : {}
    // v1.13：排除最近用过的图 + 打乱候选顺序（同步传给 prompt 与 parse，保证候选语义一致）。
    const plan = resolveMoodCandidates(catalog, promptContext.recentImages, { random })
    const userPrompt = buildMoodPrompt({ ...promptContext, now: startedAt }, catalog, { plan })
    const signal = makeTimeoutSignal(timeoutMs)
    let timer = null
    let timedOut = false
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        const error = new Error(`心情生成超时（${timeoutMs}ms）`)
        error.code = 'MOOD_AI_TIMEOUT'
        reject(error)
      }, timeoutMs)
      // 不 unref：模型流可能悬挂在 Promise 上，定时器是唯一的结算保障。
    })

    let payload
    try {
      const llmOptions = {
        provider: selection.provider,
        model: selection.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
        system: MOOD_AI_SYSTEM_PROMPT,
        maxTokens: MOOD_AI_MAX_TOKENS,
        temperature: MOOD_AI_TEMPERATURE,
        signal,
      }
      const stream = llm.stream(llmOptions)
      const collecting = collectStream(stream)
      collecting.catch(() => {})
      payload = await Promise.race([collecting, timeoutPromise])
    } catch (error) {
      const failed = timedOut || isTimeoutError(error)
      const message = failed ? `心情生成超时（${timeoutMs}ms）` : `模型调用失败：${shortMessage(error)}`
      if (!failed) warn(message)
      return moodAiUnavailable(message)
    } finally {
      if (timer !== null) clearTimeout(timer)
    }

    const finish = payload.finish
    if (finish !== null && (finish.kind === 'error' || finish.kind === 'aborted')) {
      const failure = isPlainObject(finish.failure) ? finish.failure : null
      const detail = failure !== null ? String(failure.code || failure.message || '') : ''
      warn(`心情生成失败：${detail || finish.kind}`)
      return moodAiUnavailable(`模型生成失败${detail ? `（${detail}）` : ''}`)
    }

    const parsed = parseMoodResult(payload.text, catalog, { now: startedAt, excludedImages: plan.excludedFiles })
    if (!parsed.ok) return moodAiUnavailable(parsed.message)
    const generatedAt = now()
    const response = {
      ok: true,
      mood: parsed.mood,
      model: { provider: selection.provider, model: selection.model },
      generatedAt,
      cached: false,
    }
    cache = { response, at: generatedAt }
    return response
  }

  /**
   * 生成/读取一次模型心情。
   * @param {object} context - 非敏感聚合上下文（moodKey/weather/stats/idleMinutes/recent/recentImages）
   * @param {{force?: boolean}} [requestOptions]
   * @returns {Promise<object>}
   */
  async function generate(context, requestOptions = {}) {
    const force = requestOptions !== undefined && requestOptions !== null && requestOptions.force === true
    if (inFlight !== null) {
      const shared = await inFlight
      if (isPlainObject(shared) && shared.ok === true) return { ...shared, cached: true }
      return shared
    }
    if (!force && cache !== null && now() - cache.at < cacheTtlMs) {
      const reused = cachedResponse()
      if (reused !== null) return reused
    }
    const current = now()
    if (lastStartedAt > 0 && current - lastStartedAt < minIntervalMs) {
      const reused = cachedResponse()
      if (reused !== null) return reused
      return moodAiRateLimited(`心情生成太频繁（最小间隔 ${minIntervalMs}ms）`)
    }
    const task = doGenerate(context).catch((error) => {
      warn(`心情生成异常：${shortMessage(error)}`)
      return moodAiUnavailable('心情暂不可用')
    })
    inFlight = task
    try {
      return await task
    } finally {
      if (inFlight === task) inFlight = null
    }
  }

  return {
    generate,
    /** 测试/诊断用：当前缓存快照。 */
    peekCache: () => (cache === null ? null : { ...cache.response, cached: true }),
    clearCache: () => {
      cache = null
    },
  }
}
