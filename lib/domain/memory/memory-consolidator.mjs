// lib/domain/memory/memory-consolidator.mjs —— 每日记忆整合服务（v0.2.6 从 memory-layers.mjs 拆出）
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { callModel as callModelRole } from '../../kernel/model-call.mjs'
import { naturalStyleLines } from '../voice/facade.mjs'
import { resolveMemoryDir } from './memory-journal.mjs'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import {
  MEMORY_LAYERS_INTERVAL_MS,
  MEMORY_LAYERS_MIN_AGE_MS,
  MEMORY_LAYERS_SUMMARY_MAX,
  MEMORY_LAYERS_SOURCE_IDS_MAX,
  MEMORY_LAYERS_FACT_MAX,
  MEMORY_LAYERS_SELF_FACTS_MAX,
  MEMORY_LAYERS_BATCH_MAX,
  MEMORY_LAYERS_MAX_BATCHES_PER_RUN,
  MEMORY_LAYERS_SNIPPET_MAX,
  cleanInline,
  extractJson,
  isPlainObject,
  shortMessage,
} from './memory-layers-core.mjs'

export function buildConsolidationPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const snippets = Array.isArray(ctx.snippets) ? ctx.snippets.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
  const knownFacts = Array.isArray(ctx.knownFacts)
    ? ctx.knownFacts.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(-20)
    : []
  const lines = []
  lines.push('下面是你几天前写下的一些零碎记忆（原文，按时间先后）：', ...snippets.map((item) => `- ${cleanInline(item, 120)}`))
  if (knownFacts.length > 0) lines.push(`你之前已经这样描述过自己：${knownFacts.join('、')}。`)
  lines.push(
    '请把它们整理成一段**你自己的回忆**（2–6 句，≤400 字）：像事后慢慢想起来那样，保留具体的动作、物件、光/声音和当时的变化，而不是写总结报告或复盘。',
    '再挑 0–3 条你从这些日子里**越来越清楚、一直成立**的事（关于你喜欢什么、怎么做事、在意什么），每条 ≤30 字，用你自己的口气；没有就写空数组。不要写“我喜欢人类/我是 AI”这类空话。',
    '如果新认出的某件事和以前的某句不太一样了，用 {"text":"新的短句","supersedes":"以前那句"} 表示替代；只是补充就直接写短句。',
    '只输出严格 JSON：{"summary":"你的回忆","selfFacts":["短句", {"text":"新的短句","supersedes":"以前那句"}]}',
  )
  lines.push(...naturalStyleLines(['summary 不是日志，不要逐条复述；不要升华。']))
  return lines.join('\n')
}

/** 校验整合结果。 */
export function parseConsolidationResult(text) {
  const raw = extractJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const summary = cleanInline(raw.summary, MEMORY_LAYERS_SUMMARY_MAX)
  if (summary.length < 20) return { ok: false, message: '回忆太短' }
  const facts = []
  const factObjects = []
  if (Array.isArray(raw.selfFacts)) {
    for (const item of raw.selfFacts) {
      const value = cleanInline(typeof item === 'string' ? item : item && typeof item.text === 'string' ? item.text : '', MEMORY_LAYERS_FACT_MAX)
      if (value.length < 4) continue
      const supersedes =
        isPlainObject(item) && typeof item.supersedes === 'string'
          ? cleanInline(item.supersedes, MEMORY_LAYERS_FACT_MAX)
          : ''
      if (!facts.includes(value)) facts.push(value)
      factObjects.push(supersedes.length >= 4 ? { text: value, supersedes } : value)
      if (facts.length >= 3) break
    }
  }
  return { ok: true, summary, selfFacts: facts, selfFactObjects: factObjects }
}

/** 统计 journal 中 [after, before] 的条目数与最早时间（backlog 用，不返回正文）。 */
export function countJournalEntries(journalPath, options = {}) {
  const before = typeof options.before === 'number' && Number.isFinite(options.before) ? options.before : Date.now()
  const after = typeof options.after === 'number' && Number.isFinite(options.after) ? options.after : 0
  let raw = ''
  try {
    raw = readFileSync(journalPath, 'utf8')
  } catch {
    return { count: 0, oldestAt: null }
  }
  let count = 0
  let oldestAt = null
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const entry = JSON.parse(line)
      const ts = typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : 0
      if (ts <= 0 || ts > before || ts <= after) continue
      count += 1
      if (oldestAt === null || ts < oldestAt) oldestAt = ts
    } catch {
      /* 跳过坏行 */
    }
  }
  return { count, oldestAt }
}

/** 从 journal.jsonl 读取指定时间之前的条目（旧→新，跳过坏行）。 */
export function readJournalBefore(journalPath, options = {}) {
  const before = typeof options.before === 'number' && Number.isFinite(options.before) ? options.before : Date.now()
  const after = typeof options.after === 'number' && Number.isFinite(options.after) ? options.after : 0
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : MEMORY_LAYERS_BATCH_MAX
  let raw = ''
  try {
    raw = readFileSync(journalPath, 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const entry = JSON.parse(line)
      if (!isPlainObject(entry)) continue
      const ts = typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : 0
      if (ts <= 0 || ts > before || ts <= after) continue
      entries.push(entry)
    } catch {
      /* 跳过坏行 */
    }
  }
  entries.sort((left, right) => left.ts - right.ts)
  return entries.slice(0, limit)
}

/**
 * 创建“睡眠式整合”服务：每天把几天前的零碎记忆压成一段回忆，并提炼自我短句。
 * @param {{
 *   layers: ReturnType<typeof createMemoryLayers>,
 *   journalPath: string,
 *   getLlm?: () => object|undefined|null,
 *   llm?: object|(() => object|undefined|null),
 *   policy?: object|null,
 *   modelErrorsPath?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   env?: object,
 *   now?: () => number,
 *   intervalMs?: number,
 *   minAgeMs?: number,
 *   tickMs?: number,
 *   timeoutMs?: number,
 *   random?: () => number,
 * }} options
 */
export function createMemoryConsolidator(options) {
  const layers = options.layers
  const journalPath = path.resolve(options.journalPath)
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
  const intervalMs =
    typeof options.intervalMs === 'number' && options.intervalMs >= 0 ? options.intervalMs : MEMORY_LAYERS_INTERVAL_MS
  const minAgeMs = typeof options.minAgeMs === 'number' && options.minAgeMs >= 0 ? options.minAgeMs : MEMORY_LAYERS_MIN_AGE_MS
  const tickMs = typeof options.tickMs === 'number' && options.tickMs > 0 ? options.tickMs : 60 * 1000
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 45000
  const batchMax =
    typeof options.batchMax === 'number' && options.batchMax > 0 ? Math.floor(options.batchMax) : MEMORY_LAYERS_BATCH_MAX
  const maxBatchesPerRun =
    typeof options.maxBatchesPerRun === 'number' && options.maxBatchesPerRun > 0
      ? Math.floor(options.maxBatchesPerRun)
      : MEMORY_LAYERS_MAX_BATCHES_PER_RUN
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null

  let timer = null
  let heartbeatMode = false
  let lastRunAt = 0
  let inFlight = false
  let disposed = false
  let backlogCache = { at: 0, entries: 0, oldestAt: null }

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

  function candidates() {
    if (policy === null) return []
    try {
      return policy.resolveCandidates('consolidate')
    } catch {
      return []
    }
  }

  async function callModel(system, userPrompt) {
    return callModelRole({
      role: 'consolidate',
      policy,
      resolveLlm,
      system,
      prompt: userPrompt,
      maxTokens: 900,
      timeoutMs,
      timeoutCode: 'MEMORY_LAYERS_TIMEOUT',
      timeoutMessage: `记忆整合模型调用超时（${timeoutMs}ms）`,
      prefix: '记忆整合候选失败',
      modelErrorsPath,
      warn,
    })
  }

  /** 把一批 journal 条目压成更少的片段：同段心情合并、近似碎碎念去重。原文不动。 */
  function aggregateEntries(entries, limit = MEMORY_LAYERS_SNIPPET_MAX) {
    const snippets = []
    const keptKeys = []
    const moodBuckets = new Map()
    const norm = (text) => String(text ?? '').replace(/[\s，。！？；：、,.!?;:…—\-"'“”‘’（）()]/g, '')
    const bigrams = (text) => {
      const value = norm(text)
      const out = new Set()
      for (let i = 0; i + 1 < value.length; i += 1) out.add(value.slice(i, i + 2))
      return out
    }
    const similarity = (a, b) => {
      if (a.size === 0 || b.size === 0) return 0
      let overlap = 0
      for (const gram of a) if (b.has(gram)) overlap += 1
      return (2 * overlap) / (a.size + b.size)
    }
    for (const entry of entries) {
      if (entry.kind === 'mood') {
        const bucket = Math.floor((Number(entry.ts) || 0) / (2 * 60 * 60 * 1000))
        const label = cleanInline(`${entry.label ?? ''}${entry.reason ? `：${entry.reason}` : ''}`, 80)
        if (label.length < 2) continue
        const list = moodBuckets.get(bucket) ?? []
        if (!list.includes(label)) list.push(label)
        moodBuckets.set(bucket, list)
        continue
      }
      const text = cleanInline(entry.text, 120)
      if (text.length < 4) continue
      const grams = bigrams(text)
      if (keptKeys.some((kept) => similarity(grams, kept) >= 0.85)) continue
      keptKeys.push(grams)
      snippets.push(text)
      if (snippets.length >= limit) break
    }
    for (const list of moodBuckets.values()) {
      if (snippets.length >= limit) break
      snippets.push('心情变化：' + list.slice(0, 5).join(' → '))
    }
    return snippets
  }

  /** 更新 backlog 缓存（默认 60s 内复用，避免 health 每次扫 journal）。 */
  function refreshBacklog() {
    const at = now()
    if (at - backlogCache.at < 60 * 1000) return backlogCache
    try {
      const before = at - minAgeMs
      const after = layers.snapshot().consolidatedThrough
      const stats = countJournalEntries(journalPath, { before, after })
      backlogCache = { at, entries: stats.count, oldestAt: stats.oldestAt }
    } catch {
      backlogCache = { at, entries: 0, oldestAt: null }
    }
    return backlogCache
  }

  /** 跑一次整合；没有足够旧记忆/模型不可用时安静跳过。 */
  async function consolidateNow(input = {}) {
    if (disposed || inFlight) return { ok: false, reason: 'busy' }
    const force = isPlainObject(input) && input.force === true
    const currentNow = now()
    if (!force && lastRunAt > 0 && currentNow - lastRunAt < intervalMs) return { ok: false, reason: 'not-now' }
    inFlight = true
    try {
      let llm = null
      try {
        llm = resolveLlm()
      } catch {
        llm = null
      }
      if (llm === null || llm === undefined || typeof llm.stream !== 'function') return { ok: false, reason: 'llm' }
      const before = currentNow - minAgeMs
      let totalEntries = 0
      let totalFacts = 0
      let episodesAdded = 0
      const summaries = []
      const generatedAt = currentNow
      for (let batch = 0; batch < maxBatchesPerRun; batch += 1) {
        const snapshot = layers.snapshot()
        const entries = readJournalBefore(journalPath, {
          before,
          after: snapshot.consolidatedThrough,
          limit: batchMax,
        })
        if (entries.length === 0) break
        const snippets = aggregateEntries(entries)
        if (snippets.length === 0) break
        const knownFacts =
          typeof layers.activeSelfFacts === 'function'
            ? layers.activeSelfFacts(MEMORY_LAYERS_SELF_FACTS_MAX).map((item) => item.text)
            : layers.selfFacts(MEMORY_LAYERS_SELF_FACTS_MAX).map((item) => item.text)
        const result = await callModel(
          '你是住在 DSH Web 角落的鲸鱼娘；下面是你自己几天前写的零碎记忆（已合并同段心情、去掉近似重复），请把它们慢慢整理成你记得的样子，并从里面认出越来越清楚的自己。',
          buildConsolidationPrompt({ snippets, knownFacts }),
        )
        if (result === null) break
        const parsed = parseConsolidationResult(result.text)
        if (parsed.ok !== true) {
          warn(`记忆整合结果无效：${parsed.message}`)
          break
        }
        const from = typeof entries[0].ts === 'number' ? entries[0].ts : null
        const to = typeof entries[entries.length - 1].ts === 'number' ? entries[entries.length - 1].ts : null
        const sourceEntryIds = entries.slice(0, MEMORY_LAYERS_SOURCE_IDS_MAX).map((entry) =>
          typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : `${entry.ts ?? ''}:${entry.kind ?? ''}`,
        )
        const episodeId = `ep-${generatedAt}-${batch + 1}`
        const added = layers.addEpisode({
          id: episodeId,
          summary: parsed.summary,
          from,
          to,
          entryCount: entries.length,
          at: generatedAt,
          sourceEntryIds,
        })
        const factsAdded = layers.addSelfFacts(parsed.selfFactObjects ?? parsed.selfFacts, generatedAt, {
          sourceEpisodeId: episodeId,
        })
        if (added) episodesAdded += 1
        totalEntries += entries.length
        totalFacts += factsAdded
        summaries.push(parsed.summary)
        if (!added) break
      }
      lastRunAt = currentNow
      backlogCache = { at: 0, entries: 0, oldestAt: null }
      if (episodesAdded === 0) return { ok: true, skipped: true, reason: 'nothing' }
      info(`记忆整合：${totalEntries} 条 → ${episodesAdded} 段回忆${totalFacts > 0 ? `，新自我短句 ${totalFacts} 条` : ''}`)
      return {
        ok: true,
        summary: summaries[0] ?? '',
        summaries,
        selfFacts: [],
        entryCount: totalEntries,
        episodesAdded,
        factsAdded: totalFacts,
        backlog: refreshBacklog(),
      }
    } catch (error) {
      warn(`记忆整合异常：${shortMessage(error)}`)
      return { ok: false, reason: shortMessage(error) }
    } finally {
      inFlight = false
    }
  }

  function tick() {
    if (disposed) return
    consolidateNow().catch(() => {})
  }

  function start(options = {}) {
    if (disposed || timer !== null || heartbeatMode) return
    heartbeatMode = options && options.heartbeat === true
    if (heartbeatMode) return
    timer = setInterval(tick, tickMs)
    if (typeof timer.unref === 'function') timer.unref()
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

  return {
    start,
    stop,
    dispose,
    tick,
    consolidateNow,
    backlog: () => refreshBacklog(),
    snapshot: () => ({
      lastRunAt,
      inFlight,
      intervalMs,
      batchMax,
      maxBatchesPerRun,
      backlog: refreshBacklog(),
    }),
  }
}
