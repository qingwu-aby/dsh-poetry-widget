// lib/domain/emotion/mood-ai-shared.mjs —— 心情图鉴/时间/常量共享层（v0.2.7 从 mood-ai-core.mjs 拆出）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 心情图鉴（随包静态资产）。 */
export const MOOD_CATALOG_URL = new URL('../../../assets/data/mood-catalog.json', import.meta.url)

/** 模型调用超时（毫秒）。 */
export const MOOD_AI_TIMEOUT_MS = 20000
/** 结果缓存时间（毫秒）：10 分钟；?force=1 绕过。 */
export const MOOD_AI_CACHE_TTL_MS = 10 * 60 * 1000
/** 两次生成的最小间隔（毫秒）。 */
export const MOOD_AI_MIN_INTERVAL_MS = 3000
/** 输出字段上限（按 Unicode 字符数）。 */
export const MOOD_LABEL_MAX_CHARS = 12
export const MOOD_REASON_MAX_CHARS = 40
/**
 * v1.28（M37）：细腻情绪词库（引导模型用人类会用的细情绪词，而不是每轮「开心/难过/累」）。
 * 仅供参考 → 模型可自然发挥；label 仍受 ≤12 字与「和 reason/image 气氛一致」约束。
 */
export const MOOD_AI_EMOTION_VOCAB = Object.freeze([
  '怅然',
  '眷恋',
  '释然',
  '雀跃',
  '忐忑',
  '倦怠',
  '惊奇',
  '羞赧',
  '怀念',
  '笃定',
  '心软',
  '空落',
  '满足',
  '惶惑',
  '温柔',
  '烦躁',
  '期待',
  '失落',
  '松弛',
  '鼻酸',
  '被戳中',
  '想撒娇',
  '想安静',
  '想被看见',
  '有点委屈',
  '暗自得意',
  '淡淡的遗憾',
])
/** 上下文里 recent/recentImages 的条数上限（recentImages v1.13 起 5→20）。 */
export const MOOD_RECENT_MAX = 3
/** 心情标签反重复记忆条数（v1.48：避免反复「松弛放空/饿得发懒」这类同主题换词）。 */
export const MOOD_RECENT_LABELS_MAX = 12
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
  `- 心情标签可以比图鉴标签更细：优先用人类会用的细情绪词（如：${MOOD_AI_EMOTION_VOCAB.slice(0, 20).join('、')}），不要每轮都只用「开心/难过/累/烦」这种粗词；`,
  '- label 仍须 ≤12 个汉字，并且必须和 reason、所选 image 的气氛一致；不要为新颖而硬造生僻词。',
  '如果提供了「你最近在体验」及它带来的心情，**情绪匹配优先于活动匹配**：先选能表达这种情绪的图，再考虑活动/环境。',
  '- 用第一人称简体中文，说自己的感受，不要引用古诗文；',
  '- 不透露或编造用户隐私、会话内容，不提 AI、模型、提示词；',
  '- 不用 emoji、不用 markdown。',
].join('\n')

/** 日报心情 key → 中文说明（仅作 prompt 里的辅助上下文）。 */
export const MOOD_ZH = Object.freeze({
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

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function sanitizeInline(value, maxChars) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, maxChars)
}

export function charLength(text) {
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

/**
 * 从 catalog.moodImages 建立文件索引（M24）：
 *   · fullFiles：所有完整 file（静态图是 basename，视频是 `webm/xxx.webm`）；
 *   · basenameToFull：basename → 完整 file（解决 recentImages 里视频被归一成 basename 的根因）。
 * 同时并上 catalog.files，保证与 normalizeMoodCatalog 的结果一致。
 */
export function buildCatalogImageIndex(catalog) {
  const fullFiles = new Set()
  const basenameToFull = new Map()
  const moodImages = catalog !== null && catalog !== undefined && Array.isArray(catalog.moodImages) ? catalog.moodImages : []
  for (const image of moodImages) {
    if (!isPlainObject(image) || typeof image.file !== 'string') continue
    const full = image.file.trim()
    if (full.length === 0) continue
    fullFiles.add(full)
    const base = full.replace(/^.*[\\/]/, '')
    if (base.length > 0 && !basenameToFull.has(base)) basenameToFull.set(base, full)
  }
  if (catalog !== null && catalog !== undefined && catalog.files instanceof Set) {
    for (const file of catalog.files) {
      if (typeof file === 'string' && file.trim().length > 0) fullFiles.add(file.trim())
    }
  }
  return { fullFiles, basenameToFull }
}

/** 把一个文件名（完整路径或 basename）解析成图鉴里的完整 file；找不到返回 null。 */
export function resolveCatalogImageFile(raw, index) {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value.length === 0) return null
  if (index.fullFiles.has(value)) return value
  const base = value.replace(/^.*[\\/]/, '')
  if (index.basenameToFull.has(base)) return index.basenameToFull.get(base)
  if (index.fullFiles.has(base)) return base
  return null
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
  const index = buildCatalogImageIndex(catalog)
  const out = []
  const seen = new Set()
  for (const entry of Array.isArray(recentImages) ? recentImages : []) {
    if (typeof entry !== 'string') continue
    const raw = sanitizeInline(entry, 120)
    if (raw.length === 0) continue
    // M24：完整路径优先，其次 basename → 完整 file 映射（视频 `webm/x.webm` 的关键）。
    const file = resolveCatalogImageFile(raw, index)
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

/** 归一化「最近活动」上下文（只认安全白名单字段，忽略 arguments 等）。 */

/** 归一化「体验/情绪」上下文（只认白名单字段；忽略 arguments 等额外字段）。 */

/**
 * 构造发给模型的 user prompt（纯函数）。
 * 只读取明确列出的非敏感字段：now / weather / moodKey / stats / idleMinutes /
 * recent（最近自述）/ recentImages（最近用过的图）。其它字段（会话消息文本等）一律忽略。
 * @param {{
 *   now?: number,
 *   weather?: string|null,
 *   moodKey?: string|null,
 *   recent?: string[]|null,
 *   recentImages?: string[]|null,
 *   selfState?: {energy?: number, curiosity?: number, social?: number, hunger?: number}|null,
 * }} context
 * @param {ReturnType<typeof normalizeMoodCatalog>} catalog
 * @param {{random?: () => number, minCandidates?: number, plan?: ReturnType<typeof resolveMoodCandidates>}} [options]
 * @returns {string}
 */
