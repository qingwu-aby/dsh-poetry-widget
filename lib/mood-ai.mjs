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
import { describeModelRequest, recordModelFailure } from './model-errors.mjs'
import { normalizeEffort, resolveCandidateMaxTokens } from './model-policy.mjs'
import { formatSelfStateLine } from './self-state.mjs'
import {
  EXPERIENCE_EMOTION_LABELS,
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_NOTE_MAX_CHARS,
  EXPERIENCE_TITLE_MAX_CHARS,
} from './experience.mjs'
import { MOOD_ACTIVITY_KINDS, MOOD_ACTIVITY_LABELS } from './mood.mjs'

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
  '如果提供了「你最近在做」的活动，选图时优先匹配它：看视频/逛网页→专注观看、东张西望、好奇类；查资料/学习→专注、思考、魔方类；写代码/跑命令→写代码、调试、加班类；聊天/思考→放松、开心类；发呆→放空、伸懒腰类。',
  '如果提供了「你最近在体验」及它带来的心情，**情绪匹配优先于活动匹配**：先选能表达这种情绪的图，再考虑活动/环境。',
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

/**
 * 从 catalog.moodImages 建立文件索引（M24）：
 *   · fullFiles：所有完整 file（静态图是 basename，视频是 `webm/xxx.webm`）；
 *   · basenameToFull：basename → 完整 file（解决 recentImages 里视频被归一成 basename 的根因）。
 * 同时并上 catalog.files，保证与 normalizeMoodCatalog 的结果一致。
 */
function buildCatalogImageIndex(catalog) {
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
function resolveCatalogImageFile(raw, index) {
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
function normalizeActivityContext(value) {
  if (typeof value === 'string') {
    const label = sanitizeInline(value, 20)
    return label.length > 0 ? { kind: null, label } : null
  }
  if (!isPlainObject(value)) return null
  const kind = MOOD_ACTIVITY_KINDS.includes(value.kind) ? value.kind : null
  if (kind !== null) return { kind, label: MOOD_ACTIVITY_LABELS[kind] }
  const label = sanitizeInline(typeof value.label === 'string' ? value.label : '', 20)
  return label.length > 0 ? { kind: null, label } : null
}

/** 归一化「体验/情绪」上下文（只认白名单字段；忽略 arguments 等额外字段）。 */
function normalizeExperienceContext(value) {
  if (!isPlainObject(value)) return null
  const title = sanitizeInline(typeof value.title === 'string' ? value.title : '', EXPERIENCE_TITLE_MAX_CHARS)
  if (title.length === 0) return null
  const kind = typeof value.kind === 'string' && Object.hasOwn(EXPERIENCE_KIND_LABELS, value.kind) ? value.kind : null
  const emotion =
    typeof value.emotion === 'string' && Object.hasOwn(EXPERIENCE_EMOTION_LABELS, value.emotion) ? value.emotion : null
  if (kind === null || emotion === null) return null
  const note = sanitizeInline(typeof value.note === 'string' ? value.note : '', EXPERIENCE_NOTE_MAX_CHARS)
  const normalized = {
    title,
    kind,
    kindLabel: EXPERIENCE_KIND_LABELS[kind],
    emotion,
    emotionLabel: EXPERIENCE_EMOTION_LABELS[emotion],
  }
  if (note.length > 0) normalized.note = note
  return normalized
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
 *   activity?: {kind?: string, label?: string}|string|null,
 *   experience?: {title?: string, kind?: string, emotion?: string, note?: string, at?: number}|null,
 *   selfState?: {energy?: number, curiosity?: number, social?: number, hunger?: number}|null,
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

  if (isPlainObject(ctx.selfState)) {
    lines.push(formatSelfStateLine(ctx.selfState))
  }

  const activity = normalizeActivityContext(ctx.activity)
  lines.push(
    `你最近在做：${activity !== null ? `${activity.label}${activity.kind ? `（${activity.kind}）` : ''}` : `${MOOD_ACTIVITY_LABELS.idle}/等待`}。`,
  )
  const experience = normalizeExperienceContext(ctx.experience)
  if (experience !== null) {
    lines.push(
      `你最近在体验：《${experience.title}》（${experience.kindLabel}）。读到/看到这里，你此刻的心情是：${experience.emotionLabel}。`,
    )
    if (experience.note !== undefined) lines.push(`你记下的感受：${experience.note}。`)
    lines.push(
      '选图时优先匹配你此刻的情绪（体验带来的心情）：感动/鼻酸 → 温柔、共情、眼眶发热类；难过 → 低垂、安静类；紧张 → 屏息、专注、好奇类；开心 → 笑、庆祝类；振奋 → 有劲、奔跑类；平静 → 放空、安静类；好奇 → 张望、专注类；生气 → 不满、鼓起脸类。',
    )
    lines.push('情绪匹配优先于活动匹配；同时仍优先 media=video、避开最近用过的 20 张、不连续重复。')
  }

  lines.push(
    '选图时优先匹配你最近在做的事：看视频/逛网页 → 专注观看、东张西望、好奇类的动画；查资料/学习 → 专注、思考、写代码、魔方类；写代码/跑命令 → 写代码、调试、加班类；聊天/思考 → 放松、开心类；发呆 → 放空、伸懒腰类。',
  )

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

  // v1.48：最近生成过的心情标签——只反重复**主题/说法**，不禁止相似情境下表达相近情绪。
  const recentLabels = []
  if (Array.isArray(ctx.recentMoodLabels)) {
    for (const item of ctx.recentMoodLabels) {
      const label = sanitizeInline(typeof item === 'string' ? item : '', 24)
      if (label.length > 0 && !recentLabels.includes(label)) recentLabels.push(label)
    }
  }
  const recentLabelList = recentLabels.slice(-MOOD_RECENT_LABELS_MAX)
  if (recentLabelList.length > 0) {
    lines.push(
      '你最近生成过的心情标签（不要把同一主题换个形容词再说一遍；如果此刻情境确实相似，换一个更具体的角度：一个小动作、一个细节、一个念头）：',
    )
    for (const label of recentLabelList) lines.push(`- ${label}`)
    lines.push(
      '尤其避免重复「饿/馋、困/累、松弛/放空/发呆」这几类已经用过的主题，除非此刻确实发生了新的事；换角度比换词重要。',
    )
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
  lines.push(
    'label 请尽量从具体细节切入（比如「被雨声哄住了」「敲到一半忘了下一行」），不要总写「有点累」「松弛放空」这类概括；',
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
 * @param {{now?: number, dateKey?: string, excludedImages?: Set<string>|string[]}} [options] - excludedImages 仅保留参数兼容，不再参与失败判定（v1.28 起排除是软建议）
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
  // 用完整 file / basename→完整 file 映射解析（M24：兼容模型漏写或只写 basename 的情况）。
  const imageIndex = buildCatalogImageIndex(catalog)
  const image = resolveCatalogImageFile(raw.image, imageIndex)
  if (image === null) return { ok: false, message: `图片不在图鉴内：${raw.image.trim()}` }
  const imageEntry = catalog.moodImages.find((item) => item.file === image)
  if (imageEntry === undefined) return { ok: false, message: `图片不在图鉴内：${image}` }
  // v1.21/M28：`excludedImages` 只用于 prompt 多样性引导（软建议），不再硬拒绝。
  // 模型返回的图只要在图鉴内就成功——即使它正好在「最近用过」列表里，
  // 否则体验/情绪明确要求某张图时会误判失败、客户端回退本地心情。

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
 *   policy?: object|Function|null,
 *   modelErrorsPath?: string|null,
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
  const policy = options.policy ?? null
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  const catalog = options.catalog ?? null

  /** @type {{response: object, at: number}|null} */
  let cache = null
  let lastStartedAt = 0
  /** @type {Promise<object>|null} */
  let inFlight = null
  /**
   * v1.20（M27）：本 service 最近成功生成过的 image（≤20，oldest→newest）。
   * 即使客户端没传/传了旧 recentImages，宿主也能保证不连续重复选最近生成过的图。
   * 只内存、不落盘；失败与缓存命中不入队。
   * @type {string[]}
   */
  const recentlyGeneratedImages = []
  /** v1.48：最近成功生成的心情标签（环形，≤MOOD_RECENT_LABELS_MAX），用于 prompt 反重复。 */
  const recentlyGeneratedLabels = []

  /** 记录一次成功生成的 image（去重后放队尾，超过上限淘汰最旧）。 */
  function rememberGeneratedImage(image) {
    if (typeof image !== 'string' || image.length === 0) return
    const existing = recentlyGeneratedImages.indexOf(image)
    if (existing >= 0) recentlyGeneratedImages.splice(existing, 1)
    recentlyGeneratedImages.push(image)
    while (recentlyGeneratedImages.length > MOOD_RECENT_IMAGES_MAX) recentlyGeneratedImages.shift()
  }

  /** 记录一条最近心情标签（去重 + 环形淘汰）。 */
  function rememberGeneratedLabel(label) {
    const text = typeof label === 'string' ? label : ''
    if (text.length === 0) return
    const existing = recentlyGeneratedLabels.indexOf(text)
    if (existing >= 0) recentlyGeneratedLabels.splice(existing, 1)
    recentlyGeneratedLabels.push(text)
    while (recentlyGeneratedLabels.length > MOOD_RECENT_LABELS_MAX) recentlyGeneratedLabels.shift()
  }

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

  /** v1.38：按 role 从 model policy 取 provider/model/reasoningEffort；无 policy/缺失返回 null。 */
  function policySelection(role) {
    if (policy === null || policy === undefined) return null
    try {
      const picked =
        typeof policy === 'function'
          ? policy(role)
          : typeof policy.forRole === 'function'
            ? policy.forRole(role)
            : typeof policy.resolve === 'function'
              ? policy.resolve(role)
              : null
      if (!isPlainObject(picked)) return null
      const provider = typeof picked.provider === 'string' ? picked.provider.trim() : ''
      const model = typeof picked.model === 'string' ? picked.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return null
      const effort = normalizeEffort(picked.reasoningEffort)
      return effort !== null ? { provider, model, reasoningEffort: effort } : { provider, model }
    } catch {
      return null
    }
  }

  /** v1.39：按 role 取候选模型列表（policy.resolveCandidates → 单候选 → selection）。 */
  function modelCandidates(role) {
    const out = []
    const seen = new Set()
    const push = (candidate) => {
      if (!isPlainObject(candidate)) return
      const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
      const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return
      const key = `${provider}\u0000${model}`
      if (seen.has(key)) return
      seen.add(key)
      const effort = normalizeEffort(candidate.reasoningEffort)
      out.push({
        provider,
        model,
        ...(effort !== null ? { reasoningEffort: effort } : {}),
        ...(candidate.omitTemperature === true ? { omitTemperature: true } : {}),
        ...(candidate.omitReasoningEffort === true ? { omitReasoningEffort: true } : {}),
        ...(Number.isFinite(candidate.maxTokensFloor) ? { maxTokensFloor: candidate.maxTokensFloor } : {}),
      })
    }
    try {
      if (policy !== null && policy !== undefined && typeof policy.resolveCandidates === 'function') {
        const candidates = policy.resolveCandidates(role)
        if (Array.isArray(candidates)) for (const candidate of candidates) push(candidate)
      }
    } catch {
      /* ignore */
    }
    if (out.length === 0) {
      push(policySelection(role))
      push(readSelection())
    }
    return out
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
    const candidates = modelCandidates('mood')
    if (candidates.length === 0) return moodAiUnavailable('宿主尚未配置默认模型')

    const promptContext = isPlainObject(context) ? context : {}
    // v1.13：排除最近用过的图 + 打乱候选顺序（同步传给 prompt 与 parse，保证候选语义一致）。
    // v1.20：把客户端 recentImages 与本 service 最近生成过的 image 合并作为排除集合（宿主兜底）。
    const clientRecentImages = Array.isArray(promptContext.recentImages) ? promptContext.recentImages : []
    const mergedRecentImages = [...recentlyGeneratedImages, ...clientRecentImages]
    const plan = resolveMoodCandidates(catalog, mergedRecentImages, { random })
    const userPrompt = buildMoodPrompt(
      { ...promptContext, now: startedAt, recentMoodLabels: [...recentlyGeneratedLabels] },
      catalog,
      { plan },
    )

    /** 单个候选的一次尝试（独立超时；仅在未产出任何文本前失败才可回退）。 */
    async function attempt(candidate) {
      const signal = makeTimeoutSignal(timeoutMs)
      let timer = null
      let timedOut = false
      let text = ''
      let sawText = false
      let requestMeta = null
      const timeoutPromise = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          const error = new Error(`心情生成超时（${timeoutMs}ms）`)
          error.code = 'MOOD_AI_TIMEOUT'
          reject(error)
        }, timeoutMs)
        // 不 unref：模型流可能悬挂在 Promise 上，定时器是唯一的结算保障。
      })
      try {
        const llmOptions = {
          provider: candidate.provider,
          model: candidate.model,
          messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
          system: MOOD_AI_SYSTEM_PROMPT,
          maxTokens: resolveCandidateMaxTokens(MOOD_AI_MAX_TOKENS, candidate),
          ...(candidate.omitTemperature === true || candidate.provider === 'opencode-go'
            ? {}
            : { temperature: MOOD_AI_TEMPERATURE }),
          ...(candidate.omitReasoningEffort === true || candidate.provider === 'opencode-go'
            ? {}
            : candidate.reasoningEffort !== undefined
              ? { reasoningEffort: candidate.reasoningEffort }
              : {}),
          signal,
        }
        requestMeta = describeModelRequest(llmOptions, userPrompt)
        const stream = llm.stream(llmOptions)
        const collecting = (async () => {
          let finish = null
          for await (const chunk of stream) {
            if (!isPlainObject(chunk)) continue
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
              text += chunk.text
              if (chunk.text.length > 0) sawText = true
            } else if (chunk.type === 'finish') {
              finish = isPlainObject(chunk.reason) ? chunk.reason : null
            }
          }
          return { text, finish }
        })()
        collecting.catch(() => {})
        const payload = await Promise.race([collecting, timeoutPromise])
        const finish = payload.finish
        if (finish !== null && (finish.kind === 'error' || finish.kind === 'aborted')) {
          const failure = isPlainObject(finish.failure) ? finish.failure : null
          const detail = failure !== null ? String(failure.code || failure.message || '') : ''
          recordModelFailure({
            errorsPath: modelErrorsPath,
            warnFn: warn,
            role: 'mood',
            provider: candidate.provider,
            model: candidate.model,
            error: { code: failure?.code ?? finish.kind, message: detail || finish.kind, status: failure?.status },
            request: requestMeta,
            prefix: '心情生成候选失败',
          })
          return { ok: false, retryable: !sawText, message: `模型生成失败${detail ? `（${detail}）` : ''}` }
        }
        if (payload.text.trim().length === 0) {
          recordModelFailure({
            errorsPath: modelErrorsPath,
            warnFn: warn,
            role: 'mood',
            provider: candidate.provider,
            model: candidate.model,
            error: { code: 'EMPTY_RESPONSE', message: '模型没有返回文本' },
            request: requestMeta,
            prefix: '心情生成候选失败',
          })
          return { ok: false, retryable: true, message: '模型没有返回文本' }
        }
        // v1.21：排除只影响 prompt 候选；模型返回的图只要在图鉴内就接受（即便在最近用过/ring 里）。
        const parsed = parseMoodResult(payload.text, catalog, { now: startedAt })
        if (!parsed.ok) return { ok: false, retryable: false, message: parsed.message }
        rememberGeneratedLabel(parsed.mood.label)
        return { ok: true, parsed }
      } catch (error) {
        const failed = timedOut || isTimeoutError(error)
        const message = failed ? `心情生成超时（${timeoutMs}ms）` : `模型调用失败：${shortMessage(error)}`
        recordModelFailure({
          errorsPath: modelErrorsPath,
          warnFn: warn,
          role: 'mood',
          provider: candidate.provider,
          model: candidate.model,
          error: failed ? { code: 'MOOD_AI_TIMEOUT', message } : error,
          request: requestMeta ?? describeModelRequest(null, userPrompt),
          prefix: '心情生成候选失败',
        })
        return { ok: false, retryable: !sawText, message }
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
    }

    let outcome = null
    let lastMessage = '心情生成失败'
    for (const candidate of candidates) {
      const result = await attempt(candidate)
      if (result.ok === true) {
        outcome = { result, candidate }
        break
      }
      lastMessage = result.message
      if (result.retryable !== true) return moodAiUnavailable(result.message)
      // 未产出任何文本 → 继续尝试下一个候选（不 warn 噪音，最后失败再返回）。
    }
    if (outcome === null) return moodAiUnavailable(lastMessage)

    const parsed = outcome.result.parsed
    // v1.20：成功的新生成才记入宿主去重 ring（失败/缓存命中不记）。
    rememberGeneratedImage(parsed.mood.image)
    const generatedAt = now()
    const response = {
      ok: true,
      mood: parsed.mood,
      model: { provider: outcome.candidate.provider, model: outcome.candidate.model },
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
    /** 测试/诊断用：最近成功生成过的 image（oldest→newest，≤20）。 */
    peekRecentGenerated: () => [...recentlyGeneratedImages],
    peekRecentLabels: () => [...recentlyGeneratedLabels],
    clearCache: () => {
      cache = null
    },
  }
}
