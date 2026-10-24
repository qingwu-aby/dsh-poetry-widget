// lib/self-talk-topics.mjs —— 碎碎念「话题库」加载/挑选（契约 v1.26 §2.11，M34）。
//
// 用户要求：碎碎念要结合**当前心情、天气、最近做了什么、最近在体验什么**综合评判，
// 话题越丰富越好，且可以自学话题保存后随时调用（扩展边缘知识）。
//
// 话题库由外部（agent/用户）维护：`$DSH_HOME/agent-memory/topics.json`
//   {ok:true, v:1, updatedAt, topics:[{id, title, fact, tags:[...], source?}, …]}
// 本模块只读：
//   · `loadTopicBank` 带 mtime 缓存（文件更新自动重读，无需重载插件；坏文件保留上次可用数据）；
//   · `pickSelfTalkTopic` 按 mood/weather/activity/experience/period 标签打分（+3/+3/+3/+2/+1），
//     排除最近 30 个 topic，在 top 8 里随机挑一个；
//   · `buildTopicPromptLine` 生成 prompt 片段（自然融入、不科普腔/不照本宣科/不编造）。
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

/** 排除「最近用过」的 topic 数量。 */
export const SELF_TALK_TOPIC_RECENT_MAX = 30
/** 自学话题「新鲜度」加成时长：新学的更容易被选中，之后平滑回落到基础权重（不删除）。 */
export const LEARNED_TOPIC_RECENCY_MS = 30 * 24 * 60 * 60 * 1000
/** 新学话题的最大权重倍数（1 为基础权重）。 */
export const LEARNED_TOPIC_RECENCY_BONUS = 2
/** 在得分最高的前 N 个 topic 里随机挑。 */
export const SELF_TALK_TOPIC_TOP_N = 8

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, max)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 解析话题库路径：`DSH_SELF_TALK_TOPICS` 优先，否则 `$DSH_HOME/agent-memory/topics.json`
 * （DSH_HOME 未设则 `~/.dsh`）。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string|null} [home]
 * @returns {string}
 */
export function resolveTopicsPath(env = process.env, home = null) {
  const custom = typeof env?.DSH_SELF_TALK_TOPICS === 'string' ? env.DSH_SELF_TALK_TOPICS.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  const base =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.resolve(env.DSH_HOME.trim())
      : path.join(home ?? process.env.HOME ?? os.homedir(), '.dsh')
  return path.join(base, 'agent-memory', 'topics.json')
}

/** 校验单条 topic；非法返回 null。 */
function normalizeTopic(item) {
  if (!isPlainObject(item)) return null
  const id = cleanText(item.id, 100)
  const title = cleanText(item.title, 80)
  const fact = cleanText(item.fact, 400)
  if (id.length === 0 || title.length === 0 || fact.length === 0) return null
  if (!Array.isArray(item.tags)) return null
  const tags = []
  for (const tag of item.tags) {
    if (typeof tag !== 'string') continue
    const value = cleanText(tag, 24)
    if (value.length === 0 || tags.includes(value)) continue
    tags.push(value)
    if (tags.length >= 16) break
  }
  const source = cleanText(item.source, 160)
  return { id, title, fact, tags, ...(source.length > 0 ? { source } : {}) }
}

/** 解析并校验话题库 JSON；返回 {ok:true, entries} 或 {ok:false, message}。 */
export function parseTopicBank(raw) {
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (error) {
    return { ok: false, message: `话题库 JSON 损坏：${shortMessage(error)}` }
  }
  if (!isPlainObject(parsed) || parsed.ok !== true || parsed.v !== 1) {
    return { ok: false, message: '话题库格式不符（ok/v）' }
  }
  if (!Array.isArray(parsed.topics)) return { ok: false, message: '话题库缺少 topics 数组' }
  const entries = []
  const seen = new Set()
  let dropped = 0
  for (const item of parsed.topics) {
    const topic = normalizeTopic(item)
    if (topic === null) {
      dropped += 1
      continue
    }
    if (seen.has(topic.id)) continue
    seen.add(topic.id)
    entries.push(topic)
  }
  if (entries.length === 0) return { ok: false, message: '话题库没有可用话题', dropped }
  return { ok: true, entries, dropped, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null }
}

/**
 * 把自学得到的合法话题并入话题库（`.dsh/agent-memory/topics.json`）。
 *
 * 用户决定「不用审核」，且「学过的所有东西都要存储」：自学话题**只增不删**地进活跃
 * 话题库（带 `learned:true` + `addedAt`），碎碎念选题/随机话题种子/相关话题都会看到它。
 * 旧话题不会被淘汰或停用；新旧差异只体现在选题权重上（见 topicRecencyWeight）。
 *
 * @param {{path: string, topic: object, now?: number}} options
 * @returns {{ok: boolean, added?: boolean, reason?: string, bankSize?: number}}
 */
export function mergeLearnedTopicIntoBank(options = {}) {
  const file = typeof options.path === 'string' && options.path.trim().length > 0 ? path.resolve(options.path) : ''
  if (file.length === 0) return { ok: false, reason: 'no-topics-bank-path' }
  const topic = normalizeTopic(options.topic)
  if (topic === null) return { ok: false, reason: 'invalid-topic' }
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()

  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    parsed = null
  }
  const topics = isPlainObject(parsed) && Array.isArray(parsed.topics) ? parsed.topics.filter(isPlainObject) : []
  const existing = new Set()
  for (const item of topics) {
    if (typeof item.id === 'string' && item.id.length > 0) existing.add(item.id)
  }
  if (existing.has(topic.id)) return { ok: true, added: false, reason: 'duplicate', bankSize: topics.length }

  topics.push({ ...topic, learned: true, addedAt: now })
  try {
    writeJsonAtomic(file, { ok: true, v: 1, updatedAt: new Date(now).toISOString(), topics })
    return { ok: true, added: true, bankSize: topics.length }
  } catch (error) {
    return { ok: false, reason: `write-failed: ${shortMessage(error)}` }
  }
}

/**
 * 话题的选题权重：新学的自学话题临时加权，随时间平滑回落到 1；旧话题永远保留权重 1（仍可被选中）。
 * @param {object} topic
 * @param {number} [now]
 * @returns {number} 1..(1+LEARNED_TOPIC_RECENCY_BONUS)
 */
export function topicRecencyWeight(topic, now = Date.now()) {
  if (!isPlainObject(topic) || topic.learned !== true) return 1
  const addedAt = typeof topic.addedAt === 'number' && Number.isFinite(topic.addedAt) ? topic.addedAt : 0
  if (addedAt <= 0) return 1
  const age = Math.max(0, now - addedAt)
  const freshness = Math.max(0, 1 - age / LEARNED_TOPIC_RECENCY_MS)
  return 1 + LEARNED_TOPIC_RECENCY_BONUS * freshness
}

/**
 * 创建话题库读取器（mtime 缓存：文件变化自动重读；坏文件保留上次可用数据、不抛）。
 * @param {{path?: string, env?: NodeJS.ProcessEnv, home?: string|null, logger?: {warn?: Function}|null}} [options]
 */
export function loadTopicBank(options = {}) {
  const file = path.resolve(options.path ?? resolveTopicsPath(options.env, options.home))
  const logger = options.logger ?? null
  /** @type {{mtimeMs: number, entries: object[]}|null} */
  let cached = null
  let warnedMessage = null

  function warn(message) {
    // 同一错误不重复刷日志（文件恢复后清空）。
    if (warnedMessage === message) return
    warnedMessage = message
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  /**
   * 读取话题库（mtime 未变则直接用缓存）。
   * @returns {{ok:boolean, entries:object[], path:string, mtimeMs:number|null, reloaded:boolean, message?:string}}
   */
  function read() {
    let stat
    try {
      stat = statSync(file)
    } catch (error) {
      cached = null
      const message = `碎碎念话题库不可用（${file}）：${shortMessage(error)}`
      warn(message)
      return { ok: false, entries: [], path: file, mtimeMs: null, reloaded: false, message }
    }
    if (cached !== null && cached.mtimeMs === stat.mtimeMs) {
      return { ok: true, entries: cached.entries, path: file, mtimeMs: stat.mtimeMs, reloaded: false }
    }
    let parsed = null
    try {
      parsed = parseTopicBank(readFileSync(file, 'utf8'))
    } catch (error) {
      parsed = { ok: false, message: `话题库读取失败：${shortMessage(error)}` }
    }
    if (parsed.ok !== true) {
      // 保留上次可用数据（若 mtime 变化导致坏文件，不把已有话题一起丢掉）。
      const fallbackEntries = cached !== null ? cached.entries : []
      warn(`碎碎念话题库解析失败：${parsed.message}`)
      return { ok: false, entries: fallbackEntries, path: file, mtimeMs: stat.mtimeMs, reloaded: false, message: parsed.message }
    }
    warnedMessage = null
    cached = { mtimeMs: stat.mtimeMs, entries: parsed.entries }
    return {
      ok: true,
      entries: parsed.entries,
      path: file,
      mtimeMs: stat.mtimeMs,
      reloaded: true,
      updatedAt: parsed.updatedAt,
    }
  }

  return {
    path: file,
    read,
    /** 当前缓存里的条目（首次调用会触发读取）。 */
    entries: () => {
      if (cached !== null) return cached.entries
      return read().entries
    },
  }
}

/** 情境词 → 话题标签别名（真实话题库的 tags 多为中文/英文短词）。 */
const WEATHER_ALIASES = Object.freeze({
  晴: ['clear', '天气'],
  多云: ['cloud', '天气'],
  阴: ['cloud', '天气'],
  雾: ['fog', '天气'],
  雨: ['rain', '天气'],
  小雨: ['rain', '天气'],
  中雨: ['rain', '天气'],
  大雨: ['rain', '天气'],
  雷雨: ['thunder', '天气'],
  雪: ['snow', '天气'],
  大风: ['wind', '天气'],
  寒冷: ['cold', '天气'],
})

const ACTIVITY_ALIASES = Object.freeze({
  watch: ['看视频', '逛网页', 'browser', '好奇'],
  read: ['查资料', '学习', '读书', '好奇'],
  code: ['写代码', '工作', '科技', '电脑'],
  social: ['聊天', 'social', '朋友'],
  idle: ['发呆', '空闲', '安静'],
})

/** 把情境值展开成包含别名的可比较字符串列表。 */
function withAliases(values, dictionary) {
  const extra = []
  for (const value of values) {
    const needle = value.toLowerCase()
    for (const [key, aliases] of Object.entries(dictionary)) {
      if (needle.includes(key.toLowerCase())) extra.push(...aliases)
    }
  }
  return [...values, ...extra]
}

/** 把 context 的值展开成可比较的字符串列表。 */
function contextValues(context) {
  const ctx = isPlainObject(context) ? context : {}
  const values = {
    mood: [],
    weather: [],
    activity: [],
    experience: [],
    period: [],
  }
  const push = (bucket, value) => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (text.length > 0) bucket.push(text)
  }
  push(values.mood, ctx.moodKey)
  push(values.mood, ctx.moodLabel)
  push(values.weather, ctx.weather)
  if (isPlainObject(ctx.activity)) {
    push(values.activity, ctx.activity.kind)
    push(values.activity, ctx.activity.label)
  }
  if (isPlainObject(ctx.experience)) {
    push(values.experience, ctx.experience.kind)
    push(values.experience, ctx.experience.emotion)
    push(values.experience, ctx.experience.kindLabel)
    push(values.experience, ctx.experience.emotionLabel)
  }
  push(values.period, ctx.period)
  values.weather = withAliases(values.weather, WEATHER_ALIASES)
  values.activity = withAliases(values.activity, ACTIVITY_ALIASES)
  return values
}

function topicMatches(tags, values) {
  if (tags.length === 0 || values.length === 0) return false
  for (const value of values) {
    const needle = value.toLowerCase()
    for (const tag of tags) {
      const hay = tag.toLowerCase()
      if (hay === needle) return true
      if (needle.length >= 2 && hay.includes(needle)) return true
      if (hay.length >= 2 && needle.includes(hay)) return true
    }
  }
  return false
}

/** 按 5 个情境维度给 topic 打分（mood +3 / weather +3 / activity +3 / experience +2 / period +1）。 */
export function scoreSelfTalkTopic(topic, context) {
  if (!isPlainObject(topic) || !Array.isArray(topic.tags)) return 0
  const values = contextValues(context)
  let score = 0
  if (topicMatches(topic.tags, values.mood)) score += 3
  if (topicMatches(topic.tags, values.weather)) score += 3
  if (topicMatches(topic.tags, values.activity)) score += 3
  if (topicMatches(topic.tags, values.experience)) score += 2
  if (topicMatches(topic.tags, values.period)) score += 1
  return score
}

/**
 * 挑选本轮话题：按情境打分、排除最近 topic、在 top 8 里随机选。
 *   · topics 可以是条目数组，也可以是 loadTopicBank 返回的读取器；
 *   · 全部被排除时退回全量（允许重复）；
 *   · 空库返回 null。
 * @param {object[]|{read: Function}|null|undefined} topics
 * @param {object} context
 * @param {string[]} [recentIds]
 * @param {{random?: () => number, now?: number}} [options]
 * @returns {object|null}
 */
export function pickSelfTalkTopic(topics, context = {}, recentIds = [], options = {}) {
  let entries = []
  try {
    if (Array.isArray(topics)) entries = topics
    else if (topics !== null && topics !== undefined && typeof topics.read === 'function') {
      const result = topics.read()
      entries = result !== null && result !== undefined && Array.isArray(result.entries) ? result.entries : []
    } else if (typeof topics === 'function') {
      const result = topics()
      entries = Array.isArray(result) ? result : []
    }
  } catch {
    entries = []
  }
  const valid = entries.filter((topic) => isPlainObject(topic) && typeof topic.id === 'string' && topic.id.length > 0)
  if (valid.length === 0) return null

  const rng = typeof options.random === 'function' ? options.random : Math.random
  const recent = new Set(
    (Array.isArray(recentIds) ? recentIds : []).filter((id) => typeof id === 'string' && id.length > 0).slice(-SELF_TALK_TOPIC_RECENT_MAX),
  )
  const fresh = valid.filter((topic) => !recent.has(topic.id))
  const pool = fresh.length > 0 ? fresh : valid // 全被排除则允许全量
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const scored = pool.map((topic) => ({
    topic,
    score: scoreSelfTalkTopic(topic, context),
    weight: topicRecencyWeight(topic, now),
  }))
  scored.sort((left, right) => right.score - left.score || right.weight - left.weight)
  const top = scored.slice(0, SELF_TALK_TOPIC_TOP_N)
  // 新学话题临时加权：旧话题仍保留基础权重，永远可被选中（不删除、不停用）。
  const totalWeight = top.reduce((sum, item) => sum + item.weight, 0)
  let roll = Number(rng())
  if (!Number.isFinite(roll)) roll = 0
  roll = Math.min(0.999999999, Math.max(0, roll)) * totalWeight
  let cursor = 0
  for (const item of top) {
    cursor += item.weight
    if (roll < cursor) return item.topic
  }
  return top[top.length - 1].topic
}

/** 生成 user prompt 里的话题行（自然融入、不科普腔/不照本宣科/不编造）。 */
export function buildTopicPromptLine(topic) {
  if (!isPlainObject(topic)) return ''
  const title = cleanText(topic.title, 80)
  const fact = cleanText(topic.fact, 400).replace(/[。！？!?；;]+$/u, '')
  if (title.length === 0 || fact.length === 0) return ''
  return (
    `你最近学到的一个小知识：〈${title}〉——${fact}。` +
    '可以把它和此刻的心情/天气/正在做的事自然连起来，写成一句自然的碎碎念；' +
    '不要科普腔、不要照本宣科、不要一次讲太多、不要编造事实。'
  )
}
