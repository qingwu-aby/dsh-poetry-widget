// lib/memory-recall.mjs —— 记忆检索（契约 v1.33 §2.18，task-59）。
//
// v0.2.8：检索纯函数拆到 memory-recall-search.mjs；本文件保留服务与 digest 格式化，并 re-export 原 API。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readFeelingFile } from '../emotion/facade.mjs'
import { MEMORY_LAYERS_SUMMARY_MAX, createMemoryLayers, readMemoryLayers, selectActiveSelfFacts } from './memory-layers.mjs'
import { searchArchivedTopics } from '../learning/facade.mjs'
import { readSelfProjects } from '../being/facade.mjs'
import { readVideoCoursesShelf } from '../learning/facade.mjs'
import {
  MEMORY_RECALL_ECHO_MAX,
  MEMORY_RECALL_ECHO_MIN_AGE_MS,
  MEMORY_RECALL_ITEM_MAX_CHARS,
  MEMORY_RECALL_JOURNAL_LINES,
  MEMORY_RECALL_SIMILARITY_MAX,
  bigramJaccard,
  chineseBigrams,
  cleanInline,
  clampText,
  extractRecallKeywords,
  isPlainObject,
  isRecallQuery,
  keywordScore,
  maxSimilarity,
  pickRelevantLearning,
  readLearningSections,
  readRecentJournalEntries,
  readTopics,
  resolveMemoryRecallPaths,
  searchJournalEntries,
} from './memory-recall-search.mjs'

export * from './memory-recall-search.mjs'

export function createMemoryRecall(options = {}) {
  const projectsPath =
    typeof options.projectsPath === 'string' && options.projectsPath.length > 0 ? path.resolve(options.projectsPath) : null
  // v2.65：她看过的课/书（书架）；只读 course.json 元数据，正文不进摘要。
  const videoCoursesDir =
    typeof options.videoCoursesDir === 'string' && options.videoCoursesDir.trim().length > 0
      ? path.resolve(options.videoCoursesDir)
      : null
  const paths = resolveMemoryRecallPaths(options.env, options.home)
  const journalPath = options.journalPath ?? paths.journalPath
  const learningLogPath = options.learningLogPath ?? paths.learningLogPath
  const topicsSource = options.topics ?? null
  // v1.49：L1 冷存储归档路径；归档里的旧话题可被关键词检索回上下文（不删除旧知识）。
  const topicsArchivePath =
    typeof options.topicsArchivePath === 'string' && options.topicsArchivePath.trim().length > 0
      ? path.resolve(options.topicsArchivePath)
      : null
  // v1.71：分层记忆（更早的回忆概括 + 慢慢成型的自我短句）；文件缺失/坏 → 空。
  const layersPath =
    typeof options.layersPath === 'string' && options.layersPath.trim().length > 0 ? path.resolve(options.layersPath) : null
  // v1.50：她自造的感受词也进入记忆摘要（让碎碎念能用自己的情绪词表达）。
  const feelingsPath =
    typeof options.feelingsPath === 'string' && options.feelingsPath.trim().length > 0
      ? path.resolve(options.feelingsPath)
      : null

  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now()

  /** 上海本地当天 0 点的时间戳（用于“今天发生的事”）。 */
  function shanghaiDayStart(nowMs) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(nowMs))
      const [year, month, day] = parts.split('-').map(Number)
      return Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000
    } catch {
      const date = new Date(nowMs)
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - 8 * 60 * 60 * 1000
    }
  }

  /** v2.2：今天她自己经历/写下的（心情/想法/碎碎念），给碎碎念做真实素材。 */
  function todayJournal(limit = 8) {
    const start = shanghaiDayStart(nowFn())
    const out = []
    const entries = recentEntries()
    for (let index = entries.length - 1; index >= 0 && out.length < limit; index -= 1) {
      const entry = entries[index]
      const ts = typeof entry.ts === 'number' ? entry.ts : 0
      if (ts < start) continue
      let text = ''
      if (entry.kind === 'mood') {
        text = cleanInline(`${entry.label ?? ''}${entry.reason ? `：${entry.reason}` : ''}`, MEMORY_RECALL_ITEM_MAX_CHARS)
      } else if (entry.kind === 'thought' || entry.kind === 'murmur') {
        text = cleanInline(entry.text, MEMORY_RECALL_ITEM_MAX_CHARS)
      }
      if (text.length === 0 || out.includes(text)) continue
      if (maxSimilarity(text, out) >= MEMORY_RECALL_SIMILARITY_MAX) continue
      out.push(text)
    }
    return out
  }

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

  /**
   * 旧时回声：从更早的 journal 条目里按关键词相关度挑 1–2 条（v1.63）。
   * 确定性打分（关键词命中 + 较新优先），有预算上限；只读，不写任何记忆。
   */
  function recallEchoes(context = {}) {
    const ctx = isPlainObject(context) ? context : {}
    const keywords = extractRecallKeywords(ctx)
    const recentTexts = Array.isArray(ctx.recentTexts) ? ctx.recentTexts.filter((text) => typeof text === 'string') : []
    const now = nowFn()
    const candidates = []
    for (const entry of recentEntries()) {
      if (!isPlainObject(entry)) continue
      if (entry.kind !== 'thought' && entry.kind !== 'murmur') continue
      const ts = typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : 0
      if (ts <= 0 || now - ts < MEMORY_RECALL_ECHO_MIN_AGE_MS) continue
      const text = cleanInline(entry.text, MEMORY_RECALL_ITEM_MAX_CHARS)
      if (text.length === 0) continue
      if (maxSimilarity(text, recentTexts) >= MEMORY_RECALL_SIMILARITY_MAX) continue
      const score = keywordScore(text, keywords)
      if (score <= 0) continue
      candidates.push({ text, score, ts })
    }
    candidates.sort((left, right) => right.score - left.score || right.ts - left.ts)
    const echoes = []
    for (const item of candidates) {
      if (echoes.length >= MEMORY_RECALL_ECHO_MAX) break
      if (!echoes.includes(item.text)) echoes.push(item.text)
    }
    return echoes
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
    // v1.63：旧时回声优先占用“以前写下的”位置；最近想法里不再重复它们。
    const echoes = recallEchoes(ctx)

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
      if (echoes.includes(text)) continue
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

    // v1.50：她给自己造过的新感受（最近 2 条，新→旧）。
    const newFeelings = []
    if (feelingsPath !== null) {
      try {
        const entries = readFeelingFile(feelingsPath).slice(-2).reverse()
        for (const item of entries) {
          const name = cleanInline(item.name, 10)
          const description = cleanInline(item.description, 40)
          if (name.length > 0 && description.length > 0) newFeelings.push(`${name}：${description}`)
        }
      } catch {
        /* 情绪库读取失败静默 */
      }
    }

    // v1.71：深层记忆——自我短句（一直注入，做性格的锚）与更早的回忆概括（按关键词相关性取）。
    let selfFacts = []
    let deepMemories = []
    if (layersPath !== null) {
      try {
        const layers = readMemoryLayers(layersPath)
        // v1.81：优先 active 短句（被替代的旧句仍留在文件里，但不再注入 prompt）。
        const activeFacts = selectActiveSelfFacts(layers.selfFacts, 6)
        selfFacts = activeFacts
          .map((item) => cleanInline(item.text, 40))
          .filter((text) => text.length > 0)
        const scored = layers.episodes
          .map((episode, index) => ({
            text: cleanInline(episode.summary, MEMORY_LAYERS_SUMMARY_MAX),
            score: keywordScore(episode.summary, keywords),
            index,
          }))
          .filter((item) => item.text.length > 0)
        const matched = scoreSort(scored).filter((item) => item.score > 0)
        const picked = []
        for (const item of matched) {
          if (picked.length >= 2) break
          if (!picked.includes(item.text)) picked.push(item.text)
        }
        if (picked.length === 0 && scored.length > 0) picked.push(scored[scored.length - 1].text)
        deepMemories = picked
      } catch {
        selfFacts = []
        deepMemories = []
      }
    }

    // v1.81：这次注入的自我短句算一次“被用到”，让常用的短句在排序里更稳（不删除、不淘汰）。
    if (layersPath !== null && selfFacts.length > 0) {
      try {
        const store = createMemoryLayers({ file: layersPath, logger: null })
        store.touchSelfFacts(selfFacts, typeof ctx.now === 'number' ? ctx.now : Date.now())
      } catch {
        /* 使用计数失败静默，不影响检索 */
      }
    }
    let project = ''
    if (projectsPath !== null) {
      try {
        const state = readSelfProjects(projectsPath)
        const current = state.current
        if (current) {
          const last = current.steps.length > 0 ? current.steps[current.steps.length - 1].text : current.note
          project = `${current.title}${last ? `（最近：${last}）` : ''}`
        }
      } catch {
        project = ''
      }
    }
    let shelf = []
    if (videoCoursesDir !== null) {
      try {
        shelf = readVideoCoursesShelf(videoCoursesDir)
      } catch {
        shelf = []
      }
    }
    return { thoughts, moods, learned, relatedTopics, newFeelings, echoes, selfFacts, deepMemories, todayJournal: todayJournal(8), project, shelf }
  }

  return {
    journalPath,
    learningLogPath,
    digest,
    searchJournal: (query, options = {}) => searchJournalEntries(journalPath, query, options),
    recallEchoes,
    recentThoughts,
    recentLearning,
    randomTopicSeed,
    recentEntries,
  }
}

/** 记忆摘要 → 紧凑 prompt 行（无内容返回空串）。 */
/** 聊天专用的轻量记忆摘要：只留很少几条，避免把她自己的事带跑题。 */
export function formatChatDigest(digest) {
  const data = isPlainObject(digest) ? digest : {}
  const pick = (value, count) => (Array.isArray(value) ? value.slice(-count) : [])
  return formatMemoryDigest({
    todayJournal: pick(data.todayJournal, 2),
    thoughts: pick(data.thoughts, 2),
    shelf: pick(data.shelf, 1),
    learned: pick(data.learned, 1),
    selfFacts: pick(data.selfFacts, 1),
  })
}

export function formatMemoryDigest(digest) {
  const data = isPlainObject(digest) ? digest : {}
  const sections = []
  const add = (label, items) => {
    const list = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
    if (list.length === 0) return
    sections.push(`${label}：${list.map((item) => clampText(item)).join('；')}`)
  }
  add('你这几天在持续做的事', data.project ? [data.project] : [])
  add('你看过的课和书（书架上还留着）', data.shelf)
  add('今天你自己经历的（心情/想法/碎碎念）', data.todayJournal)
  add('你记得自己最近的想法', data.thoughts)
  add('你记得自己最近的心情', data.moods)
  add('你最近自学到的', data.learned)
  add('你给自己造过的新感受', data.newFeelings)
  add('可能相关的已知话题', data.relatedTopics)
  add('你以前写下过的（旧时回声）', data.echoes)
  add('更早以前的记忆（你自己整理过的概括）', data.deepMemories)
  add('你慢慢认出来的自己', data.selfFacts)
  add('你自己整理过的世界观', data.worldview)
  if (sections.length === 0) return ''
  return ['（这些是你自己的记忆，可以自然延续，但不要复述原句，也不要逐条列出。）', ...sections].join('\n')
}
