// lib/core/memory-quality.mjs —— 记忆质量评估（Gate C4，纯逻辑，不写盘）。
//
// 目标：在把现有记忆接进 Hub 之前，先能判断“哪些记忆该留/该合并/该归档/该丢”：
//   · 去重/近似合并：同分类下文本完全相同或近似（bigram Dice ≥ 阈值）→ 保留代表条目，其余 merge；
//   · 冲突保留：同 topic 不同文本 → 不静默覆盖，保留最高可信条目，其余建议 archive，并记录冲突；
//   · 来源可信度：activity/feedback/journal/method-memory/game-memory/model/unknown 分级；
//   · 过期策略：按分类 TTL（episodic 30d、semantic 365d、reflection 180d；method/relationship/skill/vision 不过期）；
//   · 污染检测：未知来源、低置信、异常重复（同文本 ≥ maxRepetition）、超龄 → drop/archive；
//   · 输入是 Gateway 查询结果（entry 数组），输出建议动作（keep/merge/archive/drop），**不写盘/不删数据**。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟可注入。

/** 实现版本。 */
export const MEMORY_QUALITY_VERSION = 1

/** 建议动作。 */
export const MEMORY_QUALITY_ACTIONS = Object.freeze(['keep', 'merge', 'archive', 'drop'])

/** 问题码（items[].reasons）。 */
export const MEMORY_QUALITY_ISSUES = Object.freeze([
  'invalid-entry',
  'unknown-source',
  'low-confidence',
  'untrusted-source',
  'expired',
  'very-old',
  'near-duplicate',
  'abnormal-repetition',
  'conflict',
])

/** 错误码。 */
export const MEMORY_QUALITY_CODES = Object.freeze({
  invalidInput: 'MEMORY_QUALITY_INVALID_INPUT',
})

/** 来源可信度（0–1；未知来源默认 0.2）。 */
export const MEMORY_SOURCE_TRUST = Object.freeze({
  activity: 0.9,
  feedback: 0.9,
  journal: 0.8,
  'method-memory': 0.85,
  'game-memory': 0.7,
  model: 0.5,
  unknown: 0.2,
})

const DAY_MS = 24 * 60 * 60 * 1000

/** 默认质量策略。 */
export const MEMORY_QUALITY_DEFAULTS = Object.freeze({
  minConfidence: 0.3,
  hardMinConfidence: 0.1,
  lowTrustThreshold: 0.4,
  nearDuplicateThreshold: 0.8,
  maxRepetition: 3,
  maxEntries: 5000,
  categoryTtlMs: Object.freeze({
    episodic: 30 * DAY_MS,
    semantic: 365 * DAY_MS,
    method: 0,
    vision: 0,
    preference: 365 * DAY_MS,
    relationship: 0,
    skill: 0,
    reflection: 180 * DAY_MS,
  }),
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** 文本近似度（字符 bigram Dice；0–1）。 */
export function similarity(left, right) {
  const a = normalizeText(left).replace(/[\s，。！？；、：,.!?;:]+/g, '')
  const b = normalizeText(right).replace(/[\s，。！？；、：,.!?;:]+/g, '')
  if (a.length === 0 || b.length === 0) return a === b ? 1 : 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bigrams = (text) => {
    const map = new Map()
    for (let index = 0; index < text.length - 1; index += 1) {
      const gram = text.slice(index, index + 2)
      map.set(gram, (map.get(gram) ?? 0) + 1)
    }
    return map
  }
  const leftGrams = bigrams(a)
  const rightGrams = bigrams(b)
  let overlap = 0
  for (const [gram, count] of leftGrams) overlap += Math.min(count, rightGrams.get(gram) ?? 0)
  const total = a.length - 1 + (b.length - 1)
  return total > 0 ? (2 * overlap) / total : 0
}

function normalizeEntry(entry, index) {
  if (!isPlainObject(entry)) return { ok: false, index, reason: 'invalid-entry' }
  const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : 'entry-' + index
  const text = normalizeText(entry.text)
  if (text.length === 0) return { ok: false, index, reason: 'invalid-entry' }
  const category = typeof entry.category === 'string' && entry.category.length > 0 ? entry.category : 'unknown'
  const source = isPlainObject(entry.source) ? entry.source : {}
  const sourceKind = typeof source.kind === 'string' && source.kind.length > 0 ? source.kind : 'unknown'
  const confidence = Math.min(1, Math.max(0, readNumber(entry.confidence, 0.5)))
  const at = readNumber(entry.at, readNumber(entry.updatedAt, 0))
  const topic = typeof entry.topic === 'string' && entry.topic.length > 0
    ? entry.topic
    : isPlainObject(entry.provenance) && typeof entry.provenance.topic === 'string' && entry.provenance.topic.length > 0
      ? entry.provenance.topic
      : ''
  const trust = MEMORY_SOURCE_TRUST[sourceKind] ?? MEMORY_SOURCE_TRUST.unknown
  return {
    ok: true,
    entry: {
      id,
      text,
      rawText: typeof entry.text === 'string' ? entry.text : '',
      category,
      sourceKind,
      confidence,
      at,
      topic,
      trust,
      score: trust * 0.5 + confidence * 0.5,
      original: entry,
    },
  }
}

function resolveOptions(options) {
  const spec = isPlainObject(options) ? options : {}
  const ttl = { ...MEMORY_QUALITY_DEFAULTS.categoryTtlMs }
  if (isPlainObject(spec.categoryTtlMs)) {
    for (const [category, value] of Object.entries(spec.categoryTtlMs)) {
      ttl[category] = Math.max(0, readNumber(value, 0))
    }
  }
  return {
    minConfidence: Math.min(1, Math.max(0, readNumber(spec.minConfidence, MEMORY_QUALITY_DEFAULTS.minConfidence))),
    hardMinConfidence: Math.min(1, Math.max(0, readNumber(spec.hardMinConfidence, MEMORY_QUALITY_DEFAULTS.hardMinConfidence))),
    lowTrustThreshold: Math.min(1, Math.max(0, readNumber(spec.lowTrustThreshold, MEMORY_QUALITY_DEFAULTS.lowTrustThreshold))),
    nearDuplicateThreshold: Math.min(1, Math.max(0, readNumber(spec.nearDuplicateThreshold, MEMORY_QUALITY_DEFAULTS.nearDuplicateThreshold))),
    maxRepetition: readPositiveInt(spec.maxRepetition, MEMORY_QUALITY_DEFAULTS.maxRepetition),
    maxEntries: readPositiveInt(spec.maxEntries, MEMORY_QUALITY_DEFAULTS.maxEntries),
    categoryTtlMs: ttl,
  }
}

function assignAction(entry, at, options, flags) {
  const age = entry.at > 0 ? Math.max(0, at - entry.at) : 0
  const ttl = options.categoryTtlMs[entry.category] ?? 0
  const reasons = []
  if (flags.invalid === true) return { action: 'drop', reasons: ['invalid-entry'] }
  if (entry.confidence < options.hardMinConfidence) return { action: 'drop', reasons: ['low-confidence'] }
  if (ttl > 0 && entry.at > 0 && age > ttl * 2) return { action: 'drop', reasons: ['very-old'] }
  if (flags.duplicate === true) {
    reasons.push(flags.exact === true ? 'near-duplicate' : 'near-duplicate')
    if (flags.repetition === true) reasons.push('abnormal-repetition')
    return { action: 'merge', reasons }
  }
  if (flags.conflictLoser === true) return { action: 'archive', reasons: ['conflict'] }
  if (entry.sourceKind === 'unknown') return { action: 'archive', reasons: ['unknown-source'] }
  if (entry.trust < options.lowTrustThreshold) return { action: 'archive', reasons: ['untrusted-source'] }
  if (entry.confidence < options.minConfidence) return { action: 'archive', reasons: ['low-confidence'] }
  if (ttl > 0 && entry.at > 0 && age > ttl) return { action: 'archive', reasons: ['expired'] }
  return { action: 'keep', reasons }
}

/**
 * 分析 Gateway 查询结果，输出建议动作（不写盘）。
 * @param {object[]} entries
 * @param {{now?: number, minConfidence?: number, hardMinConfidence?: number, lowTrustThreshold?: number,
 *   nearDuplicateThreshold?: number, maxRepetition?: number, maxEntries?: number, categoryTtlMs?: object}} [options]
 */
export function analyzeMemoryQuality(entries, options = {}) {
  if (!Array.isArray(entries)) {
    return { ok: false, code: MEMORY_QUALITY_CODES.invalidInput, message: 'entries 必须是数组' }
  }
  const opts = resolveOptions(options)
  const at = readNumber(options.now, Date.now())
  const normalized = []
  const invalid = []
  entries.slice(0, opts.maxEntries).forEach((entry, index) => {
    const item = normalizeEntry(entry, index)
    if (item.ok !== true) invalid.push({ index, reason: item.reason })
    else normalized.push(item.entry)
  })

  // 1) 去重聚类：同分类下 exact/近似文本（贪心）。
  const groups = []
  const grouped = new Set()
  for (let index = 0; index < normalized.length; index += 1) {
    if (grouped.has(index)) continue
    const seed = normalized[index]
    const members = [index]
    grouped.add(index)
    for (let other = index + 1; other < normalized.length; other += 1) {
      if (grouped.has(other)) continue
      const candidate = normalized[other]
      if (candidate.category !== seed.category) continue
      if (similarity(seed.rawText, candidate.rawText) < opts.nearDuplicateThreshold) continue
      members.push(other)
      grouped.add(other)
    }
    if (members.length > 1) {
      const sorted = members.slice().sort((left, right) => {
        const a = normalized[left]
        const b = normalized[right]
        return b.score - a.score || b.at - a.at || left - right
      })
      groups.push({ representative: sorted[0], members: sorted, repetition: members.length >= opts.maxRepetition })
    }
  }

  // 2) 冲突检测：同 topic + 同分类但文本不同 → 保留最高可信，其余 archive。
  //    只在“去重组的代表条目 + 未分组条目”之间比较，避免把同组副本误判为冲突。
  const representativeIndexes = new Set(groups.map((group) => group.representative))
  const groupedMembers = new Set()
  for (const group of groups) for (const member of group.members) groupedMembers.add(member)
  const conflictMap = new Map()
  for (let index = 0; index < normalized.length; index += 1) {
    const entry = normalized[index]
    if (entry.topic.length === 0) continue
    const isCandidate = !groupedMembers.has(index) || representativeIndexes.has(index)
    if (!isCandidate) continue
    const key = entry.category + '|' + entry.topic.toLowerCase()
    if (!conflictMap.has(key)) conflictMap.set(key, [])
    conflictMap.get(key).push(index)
  }
  const conflictLosers = new Set()
  const conflicts = []
  for (const [key, indexes] of conflictMap) {
    if (indexes.length < 2) continue
    const texts = new Set(indexes.map((index) => normalized[index].text))
    if (texts.size < 2) continue
    const sorted = indexes.slice().sort((left, right) => {
      const a = normalized[left]
      const b = normalized[right]
      return b.score - a.score || b.at - a.at
    })
    const kept = sorted[0]
    for (const loser of sorted.slice(1)) conflictLosers.add(loser)
    conflicts.push({
      topic: normalized[kept].topic,
      category: normalized[kept].category,
      keptId: normalized[kept].id,
      conflictingIds: sorted.slice(1).map((index) => normalized[index].id),
      key,
    })
  }

  // 3) 生成 items。
  const groupOf = new Map()
  for (const [groupIndex, group] of groups.entries()) {
    for (const member of group.members) groupOf.set(member, groupIndex)
  }
  const items = normalized.map((entry, index) => {
    const groupIndex = groupOf.has(index) ? groupOf.get(index) : null
    const group = groupIndex === null ? null : groups[groupIndex]
    const isRepresentative = group !== null && group.representative === index
    const duplicate = group !== null && !isRepresentative
    const repetition = duplicate && group.repetition === true
    const exact = duplicate && group.members.some((member) => member !== index && normalized[member].text === entry.text)
    const decision = assignAction(entry, at, opts, {
      duplicate,
      exact,
      repetition,
      conflictLoser: conflictLosers.has(index),
    })
    return {
      id: entry.id,
      category: entry.category,
      sourceKind: entry.sourceKind,
      confidence: entry.confidence,
      trust: entry.trust,
      at: entry.at,
      ageMs: entry.at > 0 ? Math.max(0, at - entry.at) : 0,
      action: decision.action,
      reasons: decision.reasons,
      ...(group !== null
        ? {
            groupId: 'group-' + (groupIndex + 1),
            mergeWith: isRepresentative ? null : normalized[group.representative].id,
          }
        : {}),
    }
  })
  const summary = { keep: 0, merge: 0, archive: 0, drop: 0 }
  for (const item of items) summary[item.action] = (summary[item.action] ?? 0) + 1
  const polluted = items.filter(
    (item) =>
      item.action === 'drop' ||
      item.action === 'archive' ||
      item.reasons.includes('abnormal-repetition'),
  ).length
  return {
    ok: true,
    version: MEMORY_QUALITY_VERSION,
    at,
    options: { ...opts, now: at },
    items,
    groups: groups.map((group, index) => ({
      id: 'group-' + (index + 1),
      representativeId: normalized[group.representative].id,
      memberIds: group.members.map((member) => normalized[member].id),
      repetition: group.repetition,
    })),
    conflicts,
    invalid,
    summary: {
      total: items.length,
      invalid: invalid.length,
      ...summary,
      duplicates: groups.reduce((total, group) => total + group.members.length - 1, 0),
      conflicts: conflicts.length,
      polluted,
    },
  }
}
