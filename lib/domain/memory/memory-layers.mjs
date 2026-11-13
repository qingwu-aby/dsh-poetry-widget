// lib/memory-layers.mjs —— 人类式分层记忆：把“最近 / 慢慢沉淀 / 更早的概括”分开（v1.71）。
//
// v0.2.6：常量/小工具拆到 memory-layers-core.mjs，每日整合服务拆到 memory-consolidator.mjs；
// 本文件只保留分层记忆存储（episode/selfFacts）与读取，并 re-export 原 API 保持兼容。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveMemoryFile } from './memory-registry.mjs'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import {
  MEMORY_LAYERS_SUMMARY_MAX,
  MEMORY_LAYERS_SOURCE_IDS_MAX,
  MEMORY_LAYERS_FACT_MAX,
  MEMORY_LAYERS_SELF_FACTS_MAX,
  cleanInline,
  isPlainObject,
} from './memory-layers-core.mjs'

export * from './memory-layers-core.mjs'
export * from './memory-consolidator.mjs'

export function resolveMemoryLayersPath(env = process.env, home = null) {
  return resolveMemoryFile('memory-layers.json', env, home)
}

/** 读分层记忆文件（缺失/坏文件 → 空结构，不抛）。 */
export function readMemoryLayers(file) {
  const empty = { ok: true, v: 1, consolidatedThrough: 0, episodes: [], selfFacts: [] }
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return empty
  }
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) return empty
    const episodes = Array.isArray(parsed.episodes)
      ? parsed.episodes
          .filter((item) => isPlainObject(item) && typeof item.summary === 'string' && item.summary.trim().length > 0)
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id.slice(0, 60) : '',
            summary: cleanInline(item.summary, MEMORY_LAYERS_SUMMARY_MAX),
            from: typeof item.from === 'number' && Number.isFinite(item.from) ? item.from : null,
            to: typeof item.to === 'number' && Number.isFinite(item.to) ? item.to : null,
            entryCount: Number.isFinite(item.entryCount) ? Math.floor(item.entryCount) : 0,
            at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : null,
            sourceEntryIds: Array.isArray(item.sourceEntryIds)
              ? item.sourceEntryIds
                  .filter((value) => typeof value === 'string' && value.trim().length > 0)
                  .map((value) => cleanInline(value, 120))
                  .slice(0, MEMORY_LAYERS_SOURCE_IDS_MAX)
              : [],
          }))
      : []
    const selfFacts = Array.isArray(parsed.selfFacts)
      ? parsed.selfFacts
          .filter((item) => isPlainObject(item) && typeof item.text === 'string')
          .map((item) => normalizeSelfFact(item))
          .filter((item) => item !== null)
      : []
    return {
      ok: true,
      v: 1,
      consolidatedThrough:
        typeof parsed.consolidatedThrough === 'number' && Number.isFinite(parsed.consolidatedThrough)
          ? parsed.consolidatedThrough
          : 0,
      episodes,
      selfFacts,
    }
  } catch {
    return empty
  }
}

/** 自我短句归一化：v1.81 起带来源、使用计数、替代链（旧数据补齐默认值）。 */
function normalizeSelfFact(item) {
  if (!isPlainObject(item) || typeof item.text !== 'string') return null
  const text = cleanInline(item.text, MEMORY_LAYERS_FACT_MAX)
  if (text.length < 4) return null
  const at = typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : null
  const accessCount = Number.isFinite(item.accessCount) && item.accessCount > 0 ? Math.floor(item.accessCount) : 0
  const lastAccessedAt =
    typeof item.lastAccessedAt === 'number' && Number.isFinite(item.lastAccessedAt) ? item.lastAccessedAt : null
  const status = item.status === 'retired' ? 'retired' : 'active'
  const sourceEpisodeId = typeof item.sourceEpisodeId === 'string' ? cleanInline(item.sourceEpisodeId, 60) : null
  const supersededBy = typeof item.supersededBy === 'string' ? cleanInline(item.supersededBy, MEMORY_LAYERS_FACT_MAX) : null
  const supersededAt =
    typeof item.supersededAt === 'number' && Number.isFinite(item.supersededAt) ? item.supersededAt : null
  return {
    text,
    at,
    status,
    accessCount,
    lastAccessedAt,
    sourceEpisodeId: sourceEpisodeId || null,
    supersededBy: supersededBy || null,
    supersededAt,
  }
}

/** 归一化短句用于去重/近似比较（去标点空白）。 */
function factKey(text) {
  return String(text ?? '')
    .replace(/[\s，。！？；：、,.!?;:…—\-"'“”‘’（）()《》【】]/g, '')
    .slice(0, 80)
}

/** 字符 bigram Jaccard：0–1，用于识别“说的是同一件事”。 */
function factSimilarity(left, right) {
  const a = factKey(left)
  const b = factKey(right)
  if (a.length === 0 || b.length === 0) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const grams = new Map()
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2)
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }
  let overlap = 0
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2)
    const count = grams.get(gram) ?? 0
    if (count > 0) {
      grams.set(gram, count - 1)
      overlap += 1
    }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1)
}

/** 从 selfFacts 列表里取 active 短句并按“被用到的程度”排序（纯函数，读文件后也能用）。 */
export function selectActiveSelfFacts(facts, limit = MEMORY_LAYERS_SELF_FACTS_MAX) {
  const active = (Array.isArray(facts) ? facts : []).filter((item) => item && item.status !== 'retired')
  active.sort(
    (left, right) =>
      (right.accessCount ?? 0) - (left.accessCount ?? 0) ||
      (right.lastAccessedAt ?? 0) - (left.lastAccessedAt ?? 0) ||
      (left.at ?? 0) - (right.at ?? 0),
  )
  if (!Number.isFinite(limit) || limit <= 0) return active
  return active.slice(0, Math.floor(limit))
}

/**
 * 创建分层记忆存储（只负责读写文件，不做模型调用）。
 * @param {{file: string, logger?: {warn?: Function}|null}} options
 */
export function createMemoryLayers(options) {
  const file = path.resolve(options.file)
  const logger = options.logger ?? null
  const state = readMemoryLayers(file)

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, {
        ok: true,
        v: 1,
        consolidatedThrough: state.consolidatedThrough,
        episodes: state.episodes,
        selfFacts: state.selfFacts,
      })
      return true
    } catch (error) {
      warn(`分层记忆写入失败：${shortMessage(error)}`)
      return false
    }
  }

  function addEpisode(episode) {
    if (!isPlainObject(episode) || typeof episode.summary !== 'string') return false
    const summary = cleanInline(episode.summary, MEMORY_LAYERS_SUMMARY_MAX)
    if (summary.length < 20) return false
    const entry = {
      id: cleanInline(episode.id, 60) || `ep-${Date.now()}`,
      summary,
      from: typeof episode.from === 'number' && Number.isFinite(episode.from) ? episode.from : null,
      to: typeof episode.to === 'number' && Number.isFinite(episode.to) ? episode.to : null,
      entryCount: Number.isFinite(episode.entryCount) ? Math.floor(episode.entryCount) : 0,
      at: typeof episode.at === 'number' && Number.isFinite(episode.at) ? episode.at : Date.now(),
      // v1.82：保留来源条目 id，摘要可回查原文（原文仍只在 journal，不复制）。
      sourceEntryIds: Array.isArray(episode.sourceEntryIds)
        ? episode.sourceEntryIds
            .filter((value) => typeof value === 'string' && cleanInline(value, 120).length > 0)
            .map((value) => cleanInline(value, 120))
            .slice(0, MEMORY_LAYERS_SOURCE_IDS_MAX)
        : [],
    }
    state.episodes.push(entry)
    if (typeof episode.to === 'number' && episode.to > state.consolidatedThrough) state.consolidatedThrough = episode.to
    return persist()
  }

  /**
   * 增加自我短句（v1.81：证据绑定 + 近似去重 + supersedes 替代旧短句）。
   * @param {Array<string|{text: string, supersedes?: string}>} facts
   * @param {number} [at]
   * @param {{sourceEpisodeId?: string}} [options]
   */
  function addSelfFacts(facts, at = Date.now(), options = {}) {
    if (!Array.isArray(facts)) return 0
    const sourceEpisodeId =
      isPlainObject(options) && typeof options.sourceEpisodeId === 'string'
        ? cleanInline(options.sourceEpisodeId, 60) || null
        : null
    let added = 0
    for (const raw of facts) {
      const text = cleanInline(
        typeof raw === 'string' ? raw : raw && typeof raw.text === 'string' ? raw.text : '',
        MEMORY_LAYERS_FACT_MAX,
      )
      if (text.length < 4) continue
      const supersedes =
        isPlainObject(raw) && typeof raw.supersedes === 'string' ? cleanInline(raw.supersedes, MEMORY_LAYERS_FACT_MAX) : ''
      const active = state.selfFacts.filter((item) => item.status === 'active')

      // 明确要替代的旧短句：按归一化相等或最相似（≥0.5）定位，旧句退休但保留在文件里。
      if (supersedes.length >= 4) {
        let target = active.find((item) => factKey(item.text) === factKey(supersedes)) ?? null
        if (target === null) {
          let best = null
          let bestScore = 0
          for (const item of active) {
            const score = factSimilarity(item.text, supersedes)
            if (score > bestScore) {
              bestScore = score
              best = item
            }
          }
          if (best !== null && bestScore >= 0.5) target = best
        }
        if (target !== null) {
          target.status = 'retired'
          target.supersededBy = text
          target.supersededAt = at
        }
      }

      // 完全重复 / 近似重复（同一件事）不重复写。
      const duplicate = active.some((item) => factKey(item.text) === factKey(text))
      if (duplicate) continue
      const near = active.some((item) => factSimilarity(item.text, text) >= 0.82 && !(supersedes.length >= 4))
      if (near) continue

      state.selfFacts.push({
        text,
        at,
        status: 'active',
        accessCount: 0,
        lastAccessedAt: null,
        sourceEpisodeId,
        supersededBy: null,
        supersededAt: null,
      })
      added += 1
    }
    if (added > 0) persist()
    return added
  }

  function snapshot() {
    return {
      consolidatedThrough: state.consolidatedThrough,
      episodes: state.episodes.slice(),
      selfFacts: state.selfFacts.slice(),
    }
  }

  function episodes(limit = 0) {
    if (!Number.isFinite(limit) || limit <= 0) return state.episodes.slice()
    return state.episodes.slice(-Math.floor(limit))
  }

  function selfFacts(limit = 0) {
    const all = state.selfFacts.slice()
    if (!Number.isFinite(limit) || limit <= 0) return all
    return all.slice(-Math.floor(limit))
  }

  /** 只取 active 的自我短句；按使用次数/最近命中/时间排序（用得多的人更难被挤掉）。 */
  function activeSelfFacts(limit = MEMORY_LAYERS_SELF_FACTS_MAX) {
    return selectActiveSelfFacts(state.selfFacts, limit)
  }

  /** 检索命中时给自我短句加一次使用计数（读路径写文件；短句只有几十条，成本可忽略）。 */
  function touchSelfFacts(texts, at = Date.now()) {
    if (!Array.isArray(texts) || texts.length === 0) return 0
    const wanted = new Set(texts.map((text) => factKey(text)).filter((key) => key.length > 0))
    if (wanted.size === 0) return 0
    let changed = 0
    for (const item of state.selfFacts) {
      if (item.status !== 'active' || !wanted.has(factKey(item.text))) continue
      item.accessCount += 1
      item.lastAccessedAt = at
      changed += 1
    }
    if (changed > 0) persist()
    return changed
  }

  return { file, addEpisode, addSelfFacts, snapshot, persist, episodes, selfFacts, activeSelfFacts, touchSelfFacts }
}

/** 构造整合 prompt：把几天前的零碎记忆整理成她自己的回忆 + 自我短句。 */
