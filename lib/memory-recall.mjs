// lib/memory-recall.mjs —— 记忆检索（契约 v1.33 §2.18，task-59）。
//
// 只读检索三类记忆，绝不读会话/用户内容：
//   · journal.jsonl（最后 ≤300 行，模型自己的 thought/mood 输出）；
//   · learning-log.md（最后 1–2 段自学笔记）；
//   · topics.json 快照（外部维护的小知识库）。
//
// `digest(context)` 按心情/天气/活动/话题/最近句子做关键词匹配，匹配不足回退最近条目，
// 返回 {thoughts≤3, moods≤2, learned≤2, relatedTopics≤2}（每条 ≤80 字）；
// `formatMemoryDigest(digest)` 生成紧凑 prompt 行（无内容返回空串）。
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveMemoryDir } from './memory-journal.mjs'
import { searchArchivedTopics } from './self-talk-topics.mjs'

/** 检索 journal 的最大行数。 */
export const MEMORY_RECALL_JOURNAL_LINES = 300
/** 每条记忆摘要的最大字数。 */
export const MEMORY_RECALL_ITEM_MAX_CHARS = 80
/** 最近句子相似度阈值（高于此值不放进 digest，避免复读）。 */
export const MEMORY_RECALL_SIMILARITY_MAX = 0.8

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max = MEMORY_RECALL_ITEM_MAX_CHARS) {
  const chars = Array.from(String(text ?? '').trim())
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanInline(value, max = 120) {
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
  if (isPlainObject(ctx.activity)) {
    push(ctx.activity.kind)
    push(ctx.activity.label)
  }
  if (isPlainObject(ctx.experience)) {
    push(ctx.experience.title)
    push(ctx.experience.kindLabel)
    push(ctx.experience.emotionLabel)
  }
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

function maxSimilarity(text, recentTexts) {
  let best = 0
  for (const recent of Array.isArray(recentTexts) ? recentTexts : []) {
    if (typeof recent !== 'string' || recent.trim().length === 0) continue
    best = Math.max(best, bigramJaccard(text, recent))
  }
  return best
}

function keywordScore(text, keywords) {
  if (typeof text !== 'string' || text.length === 0) return 0
  const haystack = text.toLowerCase()
  let score = 0
  for (const keyword of keywords) if (haystack.includes(keyword)) score += 1
  return score
}

/** 解析话题库来源为条目数组。 */
function readTopics(topicsSource) {
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
 *   logger?: {warn?: Function}|null,
 * }} [options]
 */
export function createMemoryRecall(options = {}) {
  const paths = resolveMemoryRecallPaths(options.env, options.home)
  const journalPath = options.journalPath ?? paths.journalPath
  const learningLogPath = options.learningLogPath ?? paths.learningLogPath
  const topicsSource = options.topics ?? null
  // v1.49：L1 冷存储归档路径；归档里的旧话题可被关键词检索回上下文（不删除旧知识）。
  const topicsArchivePath =
    typeof options.topicsArchivePath === 'string' && options.topicsArchivePath.trim().length > 0
      ? path.resolve(options.topicsArchivePath)
      : null

  function recentEntries() {
    return readRecentJournalEntries(journalPath, MEMORY_RECALL_JOURNAL_LINES)
  }

  /** 最近 limit 条自省 thought（新→旧，≤80 字）。 */
  function recentThoughts(limit = 2) {
    const out = []
    const entries = recentEntries()
    for (let index = entries.length - 1; index >= 0 && out.length < limit; index -= 1) {
      const entry = entries[index]
      if (entry.kind !== 'thought') continue
      const text = cleanInline(entry.text, MEMORY_RECALL_ITEM_MAX_CHARS)
      if (text.length > 0) out.push(text)
    }
    return out
  }

  /** 最近 limit 段自学笔记（新→旧，整段压缩）。 */
  function recentLearning(limit = 1) {
    const sections = readLearningSections(learningLogPath, limit)
    return sections.slice().reverse().map((section) => cleanInline(section, MEMORY_RECALL_ITEM_MAX_CHARS))
  }

  /** 随机取一个话题种子（title+fact）；无话题返回 null。 */
  function randomTopicSeed(random = Math.random) {
    const topics = readTopics(topicsSource).filter(
      (topic) => isPlainObject(topic) && typeof topic.title === 'string' && typeof topic.fact === 'string',
    )
    if (topics.length === 0) return null
    let roll = Number(random())
    if (!Number.isFinite(roll)) roll = 0
    roll = Math.min(0.999999999, Math.max(0, roll))
    const topic = topics[Math.floor(roll * topics.length)]
    return { id: typeof topic.id === 'string' ? topic.id : '', title: cleanInline(topic.title, 30), fact: cleanInline(topic.fact, 120) }
  }

  /**
   * 生成记忆摘要（只读、≤80 字/条）。
   * @param {object} context {moodKey,moodLabel,weather,activity,experience,topic,recentTexts}
   */
  function digest(context = {}) {
    const ctx = isPlainObject(context) ? context : {}
    const keywords = extractRecallKeywords(ctx)
    const recentTexts = Array.isArray(ctx.recentTexts) ? ctx.recentTexts.filter((text) => typeof text === 'string') : []
    const entries = recentEntries()

    const scoreSort = (items) => {
      // 先按关键词得分降序，同分保持“最近优先”的原始顺序（items 已新→旧）。
      return items
        .map((item, index) => ({ ...item, index }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
    }

    // thoughts：优先 thought，其次 murmur（模型自己的话）。
    const thoughtCandidates = []
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      const text = entry.kind === 'thought' || entry.kind === 'murmur' ? cleanInline(entry.text, MEMORY_RECALL_ITEM_MAX_CHARS) : ''
      if (text.length === 0) continue
      if (maxSimilarity(text, recentTexts) >= MEMORY_RECALL_SIMILARITY_MAX) continue
      thoughtCandidates.push({ text, score: keywordScore(text, keywords) })
    }
    const thoughts = []
    for (const item of scoreSort(thoughtCandidates)) {
      if (thoughts.length >= 3) break
      if (!thoughts.includes(item.text)) thoughts.push(item.text)
    }

    // moods：journal 里的心情（label：reason）。
    const moodCandidates = []
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry.kind !== 'mood') continue
      const label = cleanInline(entry.label, 24)
      const reason = cleanInline(entry.reason, 60)
      if (label.length === 0) continue
      const text = clampText(reason.length > 0 ? `${label}：${reason}` : label)
      moodCandidates.push({ text, score: keywordScore(`${label}${reason}`, keywords) })
    }
    const moods = []
    for (const item of scoreSort(moodCandidates)) {
      if (moods.length >= 2) break
      if (!moods.includes(item.text)) moods.push(item.text)
    }

    // learned：learning-log 最后 1–2 段。
    const learned = []
    const sections = readLearningSections(learningLogPath, 2).slice().reverse()
    const learnedCandidates = sections.map((section) => {
      const text = cleanInline(section.replace(/^##\s+[^\n]*\n?/, ''), MEMORY_RECALL_ITEM_MAX_CHARS)
      return { text, score: keywordScore(section, keywords) }
    })
    for (const item of scoreSort(learnedCandidates)) {
      if (learned.length >= 2) break
      if (item.text.length > 0 && !learned.includes(item.text)) learned.push(item.text)
    }

    // relatedTopics：按 tags/title/fact 关键词匹配（无匹配则为空，不硬凑无关话题）。
    const topicCandidates = []
    for (const topic of readTopics(topicsSource)) {
      if (!isPlainObject(topic) || typeof topic.title !== 'string') continue
      const title = cleanInline(topic.title, 30)
      const fact = cleanInline(topic.fact, 80)
      const tags = Array.isArray(topic.tags) ? topic.tags.filter((tag) => typeof tag === 'string') : []
      const haystack = `${title} ${fact} ${tags.join(' ')}`.toLowerCase()
      const score = keywords.reduce((sum, keyword) => (haystack.includes(keyword) ? sum + 1 : sum), 0)
      if (score <= 0) continue
      topicCandidates.push({ text: clampText(`${title}${fact.length > 0 ? `：${fact}` : ''}`), score, index: topicCandidates.length })
    }
    const relatedTopics = []
    for (const item of scoreSort(topicCandidates)) {
      if (relatedTopics.length >= 2) break
      if (!relatedTopics.includes(item.text)) relatedTopics.push(item.text)
    }
    // v1.49：活跃库没有足够相关话题时，从冷存储归档里按关键词补旧知识（仍可被调用）。
    if (topicsArchivePath !== null && relatedTopics.length < 2) {
      try {
        const archived = searchArchivedTopics({
          path: topicsArchivePath,
          keywords,
          limit: 2 - relatedTopics.length,
        })
        for (const topic of archived) {
          const title = cleanInline(topic.title, 30)
          const fact = cleanInline(topic.fact, 80)
          const text = clampText(`${title}${fact.length > 0 ? `：${fact}` : ''}`)
          if (text.length > 0 && !relatedTopics.includes(text)) relatedTopics.push(text)
        }
      } catch {
        /* 归档检索失败静默 */
      }
    }

    return { thoughts, moods, learned, relatedTopics }
  }

  return {
    journalPath,
    learningLogPath,
    digest,
    recentThoughts,
    recentLearning,
    randomTopicSeed,
    recentEntries,
  }
}

/** 记忆摘要 → 紧凑 prompt 行（无内容返回空串）。 */
export function formatMemoryDigest(digest) {
  const data = isPlainObject(digest) ? digest : {}
  const sections = []
  const add = (label, items) => {
    const list = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    if (list.length === 0) return
    sections.push(`${label}：${list.map((item) => clampText(item)).join('；')}`)
  }
  add('你记得自己最近的想法', data.thoughts)
  add('你记得自己最近的心情', data.moods)
  add('你最近自学到的', data.learned)
  add('可能相关的已知话题', data.relatedTopics)
  if (sections.length === 0) return ''
  return ['（这些是你自己的记忆，可以自然延续，但不要复述原句，也不要逐条列出。）', ...sections].join('\n')
}
