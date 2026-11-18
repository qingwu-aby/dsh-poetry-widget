// lib/core/memory-privacy.mjs —— 记忆隐私控制（Gate C4，纯逻辑/服务，不直接删数据）。
//
// 目标：给用户“可导出、可删除、可审计”的控制面能力（真正执行由调用方/Hub 负责）：
//   · export(filter)：生成用户可读导出（JSON + manifest），**自动脱敏密钥/凭证**；
//   · delete(filter)：生成删除计划（默认 dry-run，不删除；confirm=true 也只标记 approved，仍由调用方执行）；
//   · 审计事件：who/when/what（actor/时间/动作/filter/counts），**不记录记忆正文**；
//   · 过滤：category / sourceKind / activity / ids / since / until / text / limit。
//
// 纯逻辑：不读盘/不写盘/不联网/无宿主依赖；时钟可注入；导出与删除计划都只返回对象。

import { createHash } from 'node:crypto'

/** 实现版本。 */
export const MEMORY_PRIVACY_VERSION = 1

/** 动作。 */
export const MEMORY_PRIVACY_ACTIONS = Object.freeze(['export', 'delete-plan'])

/** 错误码。 */
export const MEMORY_PRIVACY_CODES = Object.freeze({
  invalidInput: 'MEMORY_PRIVACY_INVALID_INPUT',
  invalidFilter: 'MEMORY_PRIVACY_INVALID_FILTER',
  invalidActor: 'MEMORY_PRIVACY_INVALID_ACTOR',
})

/** 默认限制。 */
export const MEMORY_PRIVACY_DEFAULTS = Object.freeze({
  exportLimit: 500,
  maxExportLimit: 5000,
  auditLimit: 200,
  maxStringLength: 4000,
  maxDepth: 6,
})

/** 敏感键名（命中即脱敏）。 */
export const SENSITIVE_KEY_PATTERN = /(api[-_]?key|access[-_]?key|secret|token|password|passwd|authorization|cookie|credential|private[-_]?key|session[-_]?id)/i

/** 形似凭证的值（脱敏）。 */
export const TOKEN_VALUE_PATTERNS = Object.freeze([
  /^(sk|pk|ghp|gho|ghs|xoxb|xoxp|AKIA)[-_A-Za-z0-9]{8,}$/,
  /^Bearer\s+\S{8,}$/i,
  /^[A-Fa-f0-9]{32,}$/,
])

const REDACTED = '[redacted]'

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

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function looksLikeSecret(value) {
  const text = String(value)
  return TOKEN_VALUE_PATTERNS.some((pattern) => pattern.test(text))
}

/** 深度脱敏：敏感键名/形似凭证的值 → [redacted]；限制深度/字符串长度。 */
export function sanitizeValue(value, depth = 0) {
  if (depth > MEMORY_PRIVACY_DEFAULTS.maxDepth) return '[truncated-depth]'
  if (typeof value === 'string') {
    if (looksLikeSecret(value)) return REDACTED
    return value.length > MEMORY_PRIVACY_DEFAULTS.maxStringLength
      ? value.slice(0, MEMORY_PRIVACY_DEFAULTS.maxStringLength)
      : value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1))
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) out[key] = REDACTED
      else out[key] = sanitizeValue(item, depth + 1)
    }
    return out
  }
  return String(value)
}

/** 脱敏单条记忆（保留 id/text/category/at/confidence；source/provenance/meta 脱敏）。 */
export function sanitizeEntry(entry) {
  if (!isPlainObject(entry)) return null
  const out = {
    id: typeof entry.id === 'string' ? entry.id : '',
    category: typeof entry.category === 'string' ? entry.category : '',
    text: sanitizeValue(typeof entry.text === 'string' ? entry.text : ''),
    at: readNumber(entry.at, 0),
    confidence: readNumber(entry.confidence, 0),
  }
  if (isPlainObject(entry.source)) out.source = sanitizeValue(entry.source)
  if (isPlainObject(entry.provenance)) out.provenance = sanitizeValue(entry.provenance)
  if (isPlainObject(entry.meta)) out.meta = sanitizeValue(entry.meta)
  if (Array.isArray(entry.tags)) out.tags = entry.tags.filter((tag) => typeof tag === 'string').slice(0, 20)
  return out
}

function normalizeFilter(filter) {
  const spec = isPlainObject(filter) ? filter : {}
  const out = {}
  if (spec.category !== undefined) {
    if (typeof spec.category !== 'string' || spec.category.length === 0) {
      return errorResult(MEMORY_PRIVACY_CODES.invalidFilter, 'category 必须是非空字符串')
    }
    out.category = spec.category
  }
  if (spec.sourceKind !== undefined) {
    if (typeof spec.sourceKind !== 'string' || spec.sourceKind.length === 0) {
      return errorResult(MEMORY_PRIVACY_CODES.invalidFilter, 'sourceKind 必须是非空字符串')
    }
    out.sourceKind = spec.sourceKind
  }
  if (spec.activity !== undefined) {
    if (typeof spec.activity !== 'string' || spec.activity.length === 0) {
      return errorResult(MEMORY_PRIVACY_CODES.invalidFilter, 'activity 必须是非空字符串')
    }
    out.activity = spec.activity
  }
  if (spec.text !== undefined) {
    if (typeof spec.text !== 'string') return errorResult(MEMORY_PRIVACY_CODES.invalidFilter, 'text 必须是字符串')
    out.text = spec.text.trim().toLowerCase()
  }
  if (spec.ids !== undefined) {
    if (!Array.isArray(spec.ids) || spec.ids.some((id) => typeof id !== 'string')) {
      return errorResult(MEMORY_PRIVACY_CODES.invalidFilter, 'ids 必须是字符串数组')
    }
    out.ids = spec.ids.slice(0, 1000)
  }
  for (const key of ['since', 'until']) {
    if (spec[key] !== undefined) {
      if (!Number.isFinite(Number(spec[key]))) return errorResult(MEMORY_PRIVACY_CODES.invalidFilter, `${key} 必须是数字`)
      out[key] = Number(spec[key])
    }
  }
  if (spec.limit !== undefined) {
    if (!Number.isFinite(Number(spec.limit)) || Number(spec.limit) < 1) {
      return errorResult(MEMORY_PRIVACY_CODES.invalidFilter, 'limit 必须是正整数')
    }
    out.limit = Math.min(Math.floor(Number(spec.limit)), MEMORY_PRIVACY_DEFAULTS.maxExportLimit)
  }
  return { ok: true, filter: out }
}

function matchesFilter(entry, filter) {
  if (!isPlainObject(entry)) return false
  if (filter.category !== undefined && entry.category !== filter.category) return false
  if (filter.sourceKind !== undefined) {
    const kind = isPlainObject(entry.source) && typeof entry.source.kind === 'string' ? entry.source.kind : ''
    if (kind !== filter.sourceKind) return false
  }
  if (filter.activity !== undefined) {
    const activity = isPlainObject(entry.provenance) && typeof entry.provenance.activity === 'string' ? entry.provenance.activity : ''
    if (activity !== filter.activity) return false
  }
  if (filter.text !== undefined && filter.text.length > 0) {
    const text = String(entry.text ?? '').toLowerCase()
    if (text.indexOf(filter.text) < 0) return false
  }
  if (filter.ids !== undefined && filter.ids.indexOf(entry.id) < 0) return false
  const at = readNumber(entry.at, 0)
  if (filter.since !== undefined && at < filter.since) return false
  if (filter.until !== undefined && at > filter.until) return false
  return true
}

function selectEntries(entries, filter, limit) {
  const selected = []
  for (const entry of entries) {
    if (!matchesFilter(entry, filter)) continue
    selected.push(entry)
    if (selected.length >= limit) break
  }
  return selected
}

function countsOf(entries) {
  const byCategory = {}
  const bySource = {}
  for (const entry of entries) {
    const category = typeof entry.category === 'string' && entry.category.length > 0 ? entry.category : 'unknown'
    byCategory[category] = (byCategory[category] ?? 0) + 1
    const kind = isPlainObject(entry.source) && typeof entry.source.kind === 'string' ? entry.source.kind : 'unknown'
    bySource[kind] = (bySource[kind] ?? 0) + 1
  }
  return { entries: entries.length, byCategory, bySource }
}

function checksumOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * 生成导出（纯函数）：脱敏后的 entries + manifest + JSON 字符串；不写盘。
 * @param {{entries?: object[], filter?: object, now?: number, limit?: number}} [options]
 */
export function buildMemoryExport(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  if (!Array.isArray(spec.entries)) {
    return errorResult(MEMORY_PRIVACY_CODES.invalidInput, 'entries 必须是数组')
  }
  const normalized = normalizeFilter(spec.filter)
  if (normalized.ok !== true) return normalized
  const at = readNumber(spec.now, Date.now())
  const limit = readNumber(spec.limit, MEMORY_PRIVACY_DEFAULTS.exportLimit)
  const selected = selectEntries(spec.entries, normalized.filter, Math.min(readPositiveInt(limit, MEMORY_PRIVACY_DEFAULTS.exportLimit), MEMORY_PRIVACY_DEFAULTS.maxExportLimit))
  const sanitized = selected.map((entry) => sanitizeEntry(entry)).filter((entry) => entry !== null)
  const counts = countsOf(sanitized)
  const manifest = {
    version: MEMORY_PRIVACY_VERSION,
    kind: 'memory-export',
    generatedAt: at,
    filter: { ...normalized.filter },
    counts,
    integrity: { sha256: checksumOf(sanitized) },
    note: '本文件包含用户自己的记忆；密钥/凭证字段已脱敏。',
  }
  const payload = { manifest, entries: sanitized }
  return {
    ok: true,
    export: {
      manifest,
      entries: sanitized,
      json: JSON.stringify(payload, null, 2),
      truncated: spec.entries.length > sanitized.length && counts.entries >= MEMORY_PRIVACY_DEFAULTS.maxExportLimit,
    },
  }
}

/**
 * 生成删除计划（纯函数，默认 dry-run；本模块从不删除数据）。
 * @param {{entries?: object[], filter?: object, now?: number, dryRun?: boolean, confirm?: boolean, actor?: string}} [options]
 */
export function buildMemoryDeletePlan(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  if (!Array.isArray(spec.entries)) {
    return errorResult(MEMORY_PRIVACY_CODES.invalidInput, 'entries 必须是数组')
  }
  const normalized = normalizeFilter(spec.filter)
  if (normalized.ok !== true) return normalized
  const at = readNumber(spec.now, Date.now())
  const dryRun = spec.dryRun !== false
  const confirm = spec.confirm === true
  const matched = selectEntries(spec.entries, normalized.filter, MEMORY_PRIVACY_DEFAULTS.maxExportLimit)
  const plan = {
    version: MEMORY_PRIVACY_VERSION,
    kind: 'memory-delete-plan',
    generatedAt: at,
    dryRun: dryRun && !confirm,
    approved: confirm,
    executed: false,
    requiresConfirmation: !confirm,
    filter: { ...normalized.filter },
    matched: matched.map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      category: typeof entry.category === 'string' ? entry.category : '',
      at: readNumber(entry.at, 0),
      sourceKind: isPlainObject(entry.source) && typeof entry.source.kind === 'string' ? entry.source.kind : 'unknown',
    })),
    counts: countsOf(matched),
    note: '本模块只生成计划，不删除任何数据；执行由用户确认后的调用方负责。',
  }
  return { ok: true, plan }
}

/**
 * 创建隐私控制服务：在纯函数之上加审计（who/when/what，不记录正文）。
 * @param {{now?: () => number, auditLimit?: number}} [options]
 */
export function createMemoryPrivacyController(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const auditLimit = readPositiveInt(options.auditLimit, MEMORY_PRIVACY_DEFAULTS.auditLimit)
  const audit = []
  let nextAuditId = 0

  function recordAudit(action, actor, filter, counts) {
    nextAuditId += 1
    const event = {
      id: 'audit-' + nextAuditId,
      at: now(),
      actor,
      action,
      filter: { ...filter },
      counts: { entries: counts.entries, byCategory: { ...counts.byCategory }, bySource: { ...counts.bySource } },
    }
    audit.push(event)
    while (audit.length > auditLimit) audit.shift()
    return event
  }

  function requireActor(actor) {
    if (typeof actor !== 'string' || actor.trim().length === 0) {
      return errorResult(MEMORY_PRIVACY_CODES.invalidActor, 'actor 必须是非空字符串（审计用）')
    }
    return { ok: true, actor: actor.trim().slice(0, 80) }
  }

  /** 导出（带审计）。 */
  function exportMemory(input = {}) {
    const spec = isPlainObject(input) ? input : {}
    const actor = requireActor(spec.actor)
    if (actor.ok !== true) return actor
    const built = buildMemoryExport({ ...spec, now: readNumber(spec.now, now()) })
    if (built.ok !== true) return built
    const event = recordAudit('export', actor.actor, built.export.manifest.filter, built.export.manifest.counts)
    return { ...built, audit: event }
  }

  /** 删除计划（带审计；默认 dry-run，从不执行删除）。 */
  function deleteMemory(input = {}) {
    const spec = isPlainObject(input) ? input : {}
    const actor = requireActor(spec.actor)
    if (actor.ok !== true) return actor
    const planned = buildMemoryDeletePlan({ ...spec, now: readNumber(spec.now, now()) })
    if (planned.ok !== true) return planned
    const event = recordAudit('delete-plan', actor.actor, planned.plan.filter, planned.plan.counts)
    return { ...planned, audit: event }
  }

  function listAudit(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const limit = readPositiveInt(spec.limit, 50)
    const out = audit.filter((event) => {
      if (typeof spec.actor === 'string' && spec.actor.length > 0 && event.actor !== spec.actor) return false
      if (typeof spec.action === 'string' && spec.action.length > 0 && event.action !== spec.action) return false
      return true
    })
    return out.slice(-limit).reverse().map((event) => ({ ...event, filter: { ...event.filter }, counts: { ...event.counts } }))
  }

  function snapshot() {
    return {
      ok: true,
      version: MEMORY_PRIVACY_VERSION,
      now: now(),
      auditEvents: audit.length,
      lastAudit: audit.length === 0 ? null : { ...audit[audit.length - 1] },
    }
  }

  return { export: exportMemory, delete: deleteMemory, listAudit, snapshot }
}
