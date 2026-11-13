// lib/domain/memory/memory-recall-search.mjs —— 记忆检索纯函数（v0.2.8 从 memory-recall.mjs 拆出）
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveMemoryDir } from './memory-journal.mjs'
import { searchArchivedTopics } from '../learning/self-talk-topics.mjs'
import { readSelfProjects, createSelfProjects } from '../being/self-projects.mjs'
import { readVideoCoursesShelf } from '../learning/video-courses.mjs'

/** 检索 journal 的最大行数。 */
export const MEMORY_RECALL_JOURNAL_LINES = 800
/** 每条记忆摘要的最大字数。 */
export const MEMORY_RECALL_ITEM_MAX_CHARS = 120
/** 最近句子相似度阈值（高于此值不放进 digest，避免复读）。 */
export const MEMORY_RECALL_SIMILARITY_MAX = 0.8
/** 「旧时回声」最多条数（v1.63：借鉴 dsh-memory 的相关性+预算装包，但只做轻量版）。 */
export const MEMORY_RECALL_ECHO_MAX = 3
/** 只有比这更早的条目才算“旧时回声”，避免和最近想法重复。 */
export const MEMORY_RECALL_ECHO_MIN_AGE_MS = 24 * 60 * 60 * 1000

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clampText(text, max = MEMORY_RECALL_ITEM_MAX_CHARS) {
  const chars = Array.from(String(text ?? '').trim())
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function cleanInline(value, max = 120) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, max)
}

/** 解析记忆检索涉及的路径。 */
export function resolveMemoryRecallPaths(env = process.env, home = null) {
  const memoryDir = resolveMemoryDir(env, home)
  const stateDir =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.join(path.resolve(env.DSH_HOME.trim()), '.dsh-poetry')
      : path.join(home ?? process.env.HOME ?? os.homedir(), '.dsh', '.dsh-poetry')
  return {
    memoryDir,
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    topicsPath: path.join(memoryDir, 'topics.json'),
    learningLogPath: path.join(stateDir, 'learning-log.md'),
  }
}

/** 读取 journal.jsonl 最后 limit 行（跳过坏行/缺失；返回解析成功条目，旧→新）。 */
export function readRecentJournalEntries(journalPath, limit = MEMORY_RECALL_JOURNAL_LINES) {
  let raw = ''
  try {
    raw = readFileSync(journalPath, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0)
  const recent = lines.slice(-Math.max(1, limit))
  const entries = []
  for (const line of recent) {
    try {
      const parsed = JSON.parse(line)
      if (isPlainObject(parsed)) entries.push(parsed)
    } catch {
      /* 跳过坏行 */
    }
  }
  return entries
}

/** 读取 learning-log.md 最后 limit 段（按 `## ` 分段；旧→新）。 */
export function readLearningSections(learningLogPath, limit = 2) {
  let raw = ''
  try {
    raw = readFileSync(learningLogPath, 'utf8')
  } catch {
    return []
  }
  const sections = []
  let current = null
  for (const line of raw.split('\n')) {
    if (/^##\s+/.test(line)) {
      if (current !== null && current.trim().length > 0) sections.push(current.trim())
      current = `${line.trim()}\n`
    } else if (current !== null) {
      current += `${line}\n`
    }
  }
  if (current !== null && current.trim().length > 0) sections.push(current.trim())
  return sections.slice(-Math.max(1, limit))
}

/** 稀疏向量（中文 bigram + ASCII token）的 TF-IDF 检索：比纯关键词重合更能压住高频噪声。 */
const VECTOR_TOKEN_RE = /[a-z0-9]+/g
function vectorTokens(text) {
  const lowered = String(text ?? '').toLowerCase()
  const tokens = []
  for (const match of lowered.matchAll(VECTOR_TOKEN_RE)) tokens.push(match[0])
  for (const segment of lowered.split(/[^\u3400-\u4dbf\u4e00-\u9fff]+/u)) {
    const chars = Array.from(segment)
    for (let i = 0; i + 1 < chars.length; i += 1) tokens.push(chars[i] + chars[i + 1])
  }
  return tokens
}

function buildVectorIndex(sections) {
  const docTokens = sections.map((section) => vectorTokens(section))
  const df = new Map()
  for (const tokens of docTokens) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1)
  }
  const total = sections.length
  const vectors = docTokens.map((tokens) => {
    const tf = new Map()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
    const vector = new Map()
    let norm = 0
    for (const [token, count] of tf) {
      const idf = Math.log((total + 1) / ((df.get(token) ?? 0) + 1)) + 1
      const weight = (1 + Math.log(count)) * idf
      vector.set(token, weight)
      norm += weight * weight
    }
    const length = Math.sqrt(norm) || 1
    for (const [token, weight] of vector) vector.set(token, weight / length)
    return vector
  })
  return { df, total, vectors }
}

const VECTOR_INDEX_CACHE = new Map()

function getCachedVectorIndex(learningLogPath, sections) {
  let mtimeMs = 0
  try {
    mtimeMs = statSync(learningLogPath).mtimeMs
  } catch {
    mtimeMs = 0
  }
  const cached = VECTOR_INDEX_CACHE.get(learningLogPath)
  if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.count === sections.length) return cached.index
  const index = buildVectorIndex(sections)
  VECTOR_INDEX_CACHE.set(learningLogPath, { mtimeMs, count: sections.length, index })
  return index
}

/** 按当前话题用 TF-IDF 稀疏向量从 learning-log 里取最相关的几段。 */
export function pickRelevantLearning(learningLogPath, query, limit = 2) {
  const text = String(query ?? '').trim()
  if (text.length < 2) return []
  const sections = readLearningSections(learningLogPath, 500)
  if (sections.length === 0) return []
  const { df, total, vectors } = getCachedVectorIndex(learningLogPath, sections)
  const queryTokens = vectorTokens(text)
  if (queryTokens.length === 0) return []
  const queryTf = new Map()
  for (const token of queryTokens) queryTf.set(token, (queryTf.get(token) ?? 0) + 1)
  const queryVector = new Map()
  for (const [token, count] of queryTf) {
    const idf = Math.log((total + 1) / ((df.get(token) ?? 0) + 1)) + 1
    queryVector.set(token, (1 + Math.log(count)) * idf)
  }
  let queryNorm = 0
  for (const weight of queryVector.values()) queryNorm += weight * weight
  queryNorm = Math.sqrt(queryNorm) || 1
  const scored = vectors.map((vector, index) => {
    let dot = 0
    for (const [token, weight] of queryVector) {
      const other = vector.get(token)
      if (other !== undefined) dot += weight * other
    }
    return { index, score: dot / queryNorm }
  })
  return scored
    .filter((item) => item.score >= 0.08)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, Math.max(1, limit))
    .map((item) => sections[item.index].replace(/^##\s+/m, '').replace(/\n+/g, ' ').trim().slice(0, 220))
}

/** 用户这句话是不是在问“以前的事/记不记得”。 */
export function isRecallQuery(text) {
  const value = String(text ?? '')
  return /(还记得|记不记得|记得吗|想不起|想得起|上次|那天|那次|你说过|我说过|我跟你说|你跟我说|(之前|以前|昨天)[^，。！？]{0,8}(说|提|问|讲|聊|那|的))/.test(value)
}

/** 把时间戳转成“昨天/前天/几天前”的口语标签。 */
function relativeDayLabel(ts, now = Date.now()) {
  const hours = Math.max(0, (now - ts) / 3600000)
  if (hours < 20) return '今天'
  if (hours < 44) return '昨天'
  if (hours < 68) return '前天'
  return `${Math.round(hours / 24)} 天前`
}

/**
 * 显式回忆检索：按用户这句话在 journal 里找原文条目（只读她自己的输出）。
 * 返回 [{text, kind, ts, when, score}]，score 是关键词覆盖率 × 衰减。
 */
export function searchJournalEntries(journalPath, query, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 3
  const maxLines = Number.isFinite(options.maxLines) && options.maxLines > 0 ? options.maxLines : 4000
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  // 去掉“你还记得/上次/后来怎么样”这类问句填充词，只用真正的内容词做检索。
  const RECALL_FILLER = /(你还?记不记得|还记不记得|你还?记得|记得吗|想起来|想不起|上次|之前|以前|昨天|前天|那天|那次|你说过|我说过|我跟你说|你跟我说|后来|怎么样|怎么|那件|那个|这件事|事情|一下|跟我说|告诉我|吗|呢|吧|啊|了)/g
  const contentQuery = String(query ?? '').replace(RECALL_FILLER, ' ')
  const queryGrams = chineseBigrams(contentQuery)
  if (queryGrams.size === 0) return []
  const entries = readRecentJournalEntries(journalPath, maxLines)
  const scored = []
  // 跳过两类条目：① 聊天转录（“对话里的人对你说…”），② 带元叙述的历史回答。
  const CHAT_LOG = /^(对话里的人对你说|我主动对他说|用户说)/
  const META = /(日记|翻不出来|不敢编|不敢顺着|检索不到|真没印象|没印象|记不清)/
  for (const entry of entries) {
    const text = typeof entry.text === 'string' ? entry.text : ''
    if (text.length < 16) continue
    if (CHAT_LOG.test(text)) continue
    if (META.test(text)) continue
    const grams = chineseBigrams(text)
    if (grams.size === 0) continue
    let hit = 0
    for (const gram of queryGrams) if (grams.has(gram)) hit += 1
    const coverage = hit / queryGrams.size
    if (coverage < 0.12) continue
    const ageHours = Math.max(0, (now - (Number(entry.ts) || now)) / 3600000)
    const recency = Math.pow(0.5, ageHours / (24 * 14))
    scored.push({
      text: clampText(text, 220),
      kind: typeof entry.kind === 'string' ? entry.kind : '',
      ts: Number(entry.ts) || 0,
      when: relativeDayLabel(Number(entry.ts) || now, now),
      score: Number((coverage * 0.75 + recency * 0.25).toFixed(3)),
    })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** 中文/英文关键词提取（长度 ≥2 的 token，中文按非汉字/字母/数字切分）。 */
export function extractRecallKeywords(context) {
  const ctx = isPlainObject(context) ? context : {}
  const texts = []
  const push = (value) => {
    if (typeof value === 'string' && value.trim().length > 0) texts.push(value.trim())
  }
  push(ctx.moodKey)
  push(ctx.moodLabel)
  push(ctx.weather)
  if (isPlainObject(ctx.topic)) {
    push(ctx.topic.title)
    push(ctx.topic.fact)
    if (Array.isArray(ctx.topic.tags)) for (const tag of ctx.topic.tags) push(tag)
  }
  if (Array.isArray(ctx.recentTexts)) for (const text of ctx.recentTexts) push(text)
  const tokens = new Set()
  for (const text of texts) {
    for (const part of text.split(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/u)) {
      const token = part.trim().toLowerCase()
      if (token.length >= 2) tokens.add(token)
    }
  }
  return [...tokens]
}

/** 中文 bigram 集合（去标点空白）。 */
export function chineseBigrams(text) {
  const cleaned = String(text ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '')
  const chars = Array.from(cleaned)
  const grams = new Set()
  for (let index = 0; index + 1 < chars.length; index += 1) grams.add(`${chars[index]}${chars[index + 1]}`)
  return grams
}

/** 两段文本的 bigram Jaccard 相似度。 */
export function bigramJaccard(left, right) {
  const a = chineseBigrams(left)
  const b = chineseBigrams(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const gram of a) if (b.has(gram)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function maxSimilarity(text, recentTexts) {
  let best = 0
  for (const recent of Array.isArray(recentTexts) ? recentTexts : []) {
    if (typeof recent !== 'string' || recent.trim().length === 0) continue
    best = Math.max(best, bigramJaccard(text, recent))
  }
  return best
}

export function keywordScore(text, keywords) {
  if (typeof text !== 'string' || text.length === 0) return 0
  const haystack = text.toLowerCase()
  let score = 0
  for (const keyword of keywords) if (haystack.includes(keyword)) score += 1
  return score
}

/** 解析话题库来源为条目数组。 */
export function readTopics(topicsSource) {
  if (Array.isArray(topicsSource)) return topicsSource
  if (topicsSource !== null && topicsSource !== undefined && typeof topicsSource.read === 'function') {
    try {
      const result = topicsSource.read()
      return result !== null && result !== undefined && Array.isArray(result.entries) ? result.entries : []
    } catch {
      return []
    }
  }
  if (typeof topicsSource === 'function') {
    try {
      const result = topicsSource()
      return Array.isArray(result) ? result : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * 创建记忆检索器（只读；文件缺失/坏行静默跳过）。
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string|null,
 *   journalPath?: string,
 *   learningLogPath?: string,
 *   topics?: object[]|{read: Function}|null,
 *   topicsArchivePath?: string|null,
 *   feelingsPath?: string|null,
 *   logger?: {warn?: Function}|null,
 * }} [options]
 */
