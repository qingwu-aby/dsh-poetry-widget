// lib/growth-metrics.mjs —— 成长质量指标（v2.10，P2）。
//
// 不是打分，只是让人能看出“经历 → 回忆 → 自我”的转化情况：
// 活跃天数、journal 量、回忆覆盖、自我短句、学习条目、项目、重复度。
// 只读文件，60 秒缓存；不写任何记忆。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readMemoryLayers } from './memory-layers.mjs'
import { readSelfProjects } from './self-projects.mjs'

function cleanInline(value, max = 200) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function shanghaiDay(ts) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}

function normForCompare(text) {
  return String(text ?? '').replace(/[\s，。！？；：、,.!?;:…—\-"'“”‘’（）()]/g, '')
}

function bigrams(text) {
  const value = normForCompare(text)
  const out = new Set()
  for (let i = 0; i + 1 < value.length; i += 1) out.add(value.slice(i, i + 2))
  return out
}

function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const gram of a) if (b.has(gram)) overlap += 1
  return (2 * overlap) / (a.size + b.size)
}

function readJournal(file) {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          const entry = JSON.parse(line)
          return entry && typeof entry === 'object' && typeof entry.ts === 'number' ? entry : null
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * @param {{journalPath: string, layersPath: string, learningLogPath?: string|null,
 *   projectsPath?: string|null, now?: () => number, cacheMs?: number}} options
 */
export function createGrowthMetrics(options = {}) {
  const journalPath = path.resolve(options.journalPath)
  const layersPath = path.resolve(options.layersPath)
  const learningLogPath =
    typeof options.learningLogPath === 'string' && options.learningLogPath.length > 0 ? path.resolve(options.learningLogPath) : null
  const projectsPath =
    typeof options.projectsPath === 'string' && options.projectsPath.length > 0 ? path.resolve(options.projectsPath) : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const cacheMs = Number.isFinite(options.cacheMs) && options.cacheMs >= 0 ? options.cacheMs : 60 * 1000
  let cache = { at: 0, value: null }

  function compute() {
    const at = now()
    const entries = readJournal(journalPath)
    const today = shanghaiDay(at)
    const daySet = new Set()
    const byKind = {}
    let todayCount = 0
    let last7 = 0
    const cutoff7 = at - 7 * 24 * 60 * 60 * 1000
    for (const entry of entries) {
      const ts = entry.ts
      const day = shanghaiDay(ts)
      daySet.add(day)
      if (day === today) todayCount += 1
      if (ts >= cutoff7) last7 += 1
      const kind = typeof entry.kind === 'string' && entry.kind.length > 0 ? entry.kind : 'other'
      byKind[kind] = (byKind[kind] ?? 0) + 1
    }
    const layers = readMemoryLayers(layersPath)
    const episodeEntries = layers.episodes.reduce((sum, episode) => sum + (Number(episode.entryCount) || 0), 0)
    const activeFacts = layers.selfFacts.filter((fact) => fact.status !== 'retired').length
    const retiredFacts = layers.selfFacts.length - activeFacts
    let learningSections = 0
    const learningTitles = new Set()
    if (learningLogPath !== null) {
      try {
        const text = readFileSync(learningLogPath, 'utf8')
        for (const match of text.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})[^\n]*·\s*([^\n]+)/gm)) {
          learningSections += 1
          const title = cleanInline(match[2], 40)
          if (title.length > 0) learningTitles.add(title)
        }
      } catch {
        /* ignore */
      }
    }
    let project = null
    if (projectsPath !== null) {
      try {
        const state = readSelfProjects(projectsPath)
        project = {
          current: state.current ? cleanInline(state.current.title, 60) : null,
          completed: Array.isArray(state.completed) ? state.completed.length : 0,
        }
      } catch {
        project = null
      }
    }
    // 重复度：最近 30 条 murmur/thought 两两最大 bigram 相似度
    const recentTexts = entries
      .filter((entry) => entry.kind === 'murmur' || entry.kind === 'thought')
      .slice(-30)
      .map((entry) => bigrams(entry.text))
      .filter((grams) => grams.size > 0)
    let maxSimilarity = 0
    for (let i = 0; i < recentTexts.length; i += 1) {
      for (let j = i + 1; j < recentTexts.length; j += 1) {
        maxSimilarity = Math.max(maxSimilarity, similarity(recentTexts[i], recentTexts[j]))
      }
    }
    return {
      generatedAt: at,
      daysAlive: daySet.size,
      journal: { total: entries.length, today: todayCount, last7d: last7, byKind },
      memory: {
        episodes: layers.episodes.length,
        episodeEntries,
        consolidatedThrough: layers.consolidatedThrough,
        coverage: entries.length > 0 ? Math.min(1, episodeEntries / entries.length) : 0,
      },
      selfFacts: { active: activeFacts, retired: retiredFacts },
      learning: { sections: learningSections, distinctTopics: learningTitles.size },
      project,
      repetition: { recentSample: recentTexts.length, maxSimilarity: Number(maxSimilarity.toFixed(3)) },
    }
  }

  function snapshot() {
    const at = now()
    if (cache.value !== null && at - cache.at < cacheMs) return cache.value
    const value = compute()
    cache = { at, value }
    return value
  }

  return { snapshot }
}
