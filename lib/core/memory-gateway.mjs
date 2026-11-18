// lib/core/memory-gateway.mjs —— 统一记忆读写入口（Gate C1，纯逻辑 + 可注入 provider）。
//
// 目标：让“长期记忆”只有一条写入/查询通道，替代各域直接写文件；本 Gate 不接现有业务。
//   · registerProvider({id, kind, read, write, query, permissions})：provider 只能通过 Gateway 访问；
//     默认**只读**（read=true, write=false），写权限必须显式声明 permissions.write=true；
//   · write(entry)：校验 category/source/confidence/provenance → 同主题重复合并（保留来源/时间）→
//     不同文本冲突不静默覆盖（记录 conflict，返回 conflict 记录；高置信度可显式 supersede）；
//   · query({text,category,activity,limit})：多 provider 聚合、去重、按相关度/时间排序，返回 provenance；
//   · provider 故障隔离：单个 provider 抛错/拒绝只记错误，不影响其他 provider 与 Gateway 自身；
//   · snapshot/metrics：entries/conflicts/providers/errors/byCategory；
//   · 附带纯内存 provider 适配器（createInMemoryMemoryProvider）用于测试，不写 live 数据。
//
// provider 契约（注入对象）：
//   {
//     id: string, kind: string,
//     permissions?: {read?: boolean, write?: boolean},   // Gateway 侧默认 read=true, write=false
//     read?(filter) → entry[] | {ok, entries} | Promise,
//     query?(filter) → entry[] | {ok, entries} | Promise,
//     write(entry) → void | {ok:true} | {ok:false, code?, message?} | Promise,
//   }
// write 必须按 entry.id upsert（Gateway 合并/冲突时会回写更新后的 entry）。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟、provider 均可注入。

/** 实现版本。 */
export const MEMORY_GATEWAY_VERSION = 1

/** 记忆分类白名单。 */
export const MEMORY_CATEGORIES = Object.freeze([
  'episodic',
  'semantic',
  'method',
  'vision',
  'preference',
  'relationship',
  'skill',
  'reflection',
])

/** entry 状态。 */
export const MEMORY_STATUSES = Object.freeze(['active', 'superseded', 'conflicted'])

/** 错误码。 */
export const MEMORY_GATEWAY_CODES = Object.freeze({
  invalidEntry: 'MEMORY_INVALID_ENTRY',
  unknownCategory: 'MEMORY_UNKNOWN_CATEGORY',
  unknownProvider: 'MEMORY_UNKNOWN_PROVIDER',
  duplicateProvider: 'MEMORY_DUPLICATE_PROVIDER',
  noProvider: 'MEMORY_NO_PROVIDER',
  noWritableProvider: 'MEMORY_NO_WRITABLE_PROVIDER',
  permissionDenied: 'MEMORY_PERMISSION_DENIED',
  providerError: 'MEMORY_PROVIDER_ERROR',
  invalidFilter: 'MEMORY_INVALID_FILTER',
})

/** 默认配置。 */
export const MEMORY_GATEWAY_DEFAULTS = Object.freeze({
  maxEntries: 5000,
  maxConflicts: 500,
  supersedeMargin: 0.2,
  defaultLimit: 20,
  maxLimit: 200,
  maxTextLength: 2000,
  maxTopicLength: 120,
  defaultConfidence: 0.5,
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

function clampConfidence(value) {
  const n = readNumber(value, MEMORY_GATEWAY_DEFAULTS.defaultConfidence)
  return Math.min(1, Math.max(0, n))
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function cloneEntry(entry) {
  if (!isPlainObject(entry)) return null
  return {
    ...entry,
    source: isPlainObject(entry.source) ? { ...entry.source } : entry.source,
    provenance: isPlainObject(entry.provenance) ? { ...entry.provenance } : entry.provenance,
    sources: Array.isArray(entry.sources) ? entry.sources.map((item) => ({ ...item })) : [],
    tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
    meta: isPlainObject(entry.meta) ? { ...entry.meta } : null,
  }
}

function mergeSources(existing, incoming) {
  const out = []
  const seen = new Set()
  const push = (item) => {
    if (!isPlainObject(item)) return
    const key = String(item.kind ?? '') + '|' + String(item.id ?? '') + '|' + String(item.activity ?? '')
    if (seen.has(key)) return
    seen.add(key)
    out.push({ ...item })
  }
  for (const item of Array.isArray(existing) ? existing : []) push(item)
  push(incoming)
  return out.slice(-20)
}

function mergeProvenance(existing, incoming) {
  const base = isPlainObject(existing) ? existing : {}
  const next = isPlainObject(incoming) ? incoming : {}
  return {
    ...base,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== null && value !== '')),
  }
}

function topicKeyOf(category, topic, text) {
  const normalizedTopic = normalizeText(topic)
  if (normalizedTopic.length > 0) return category + '|t:' + normalizedTopic.toLowerCase()
  return category + '|x:' + normalizeText(text).toLowerCase()
}

function scoreEntry(entry, text) {
  const needle = normalizeText(text).toLowerCase()
  if (needle.length === 0) return 0
  const haystack = normalizeText(entry.text).toLowerCase()
  let score = 0
  let from = 0
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    score += 2
    from = at + needle.length
  }
  const tokens = needle.split(' ').filter((token) => token.length > 0)
  for (const token of tokens) if (token !== needle && haystack.indexOf(token) >= 0) score += 1
  return score
}

function providerReadable(provider) {
  if (provider.permissions.read !== true) return false
  return typeof provider.query === 'function' || typeof provider.read === 'function'
}

function providerWritable(provider) {
  return provider.permissions.write === true && typeof provider.write === 'function'
}

function providerSummary(provider) {
  return {
    id: provider.id,
    kind: provider.kind,
    permissions: { ...provider.permissions },
    readable: providerReadable(provider),
    writable: providerWritable(provider),
    registeredAt: provider.registeredAt,
    stats: { ...provider.stats },
  }
}

/**
 * 内存 provider 适配器（测试/演示；不写 live 数据）。
 * @param {{id?: string, kind?: string, permissions?: {read?: boolean, write?: boolean}, now?: () => number, entries?: object[]}} [options]
 */
export function createInMemoryMemoryProvider(options = {}) {
  const id = typeof options.id === 'string' && options.id.length > 0 ? options.id : 'memory'
  const kind = typeof options.kind === 'string' && options.kind.length > 0 ? options.kind : 'memory'
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const permissions = {
    read: options.permissions === undefined || options.permissions.read !== false,
    write: options.permissions === undefined || options.permissions.write !== false,
  }
  const entries = new Map()
  for (const entry of Array.isArray(options.entries) ? options.entries : []) {
    if (isPlainObject(entry) && typeof entry.id === 'string') entries.set(entry.id, cloneEntry(entry))
  }
  function matches(entry, filter) {
    const spec = isPlainObject(filter) ? filter : {}
    if (typeof spec.category === 'string' && spec.category.length > 0 && entry.category !== spec.category) return false
    if (typeof spec.activity === 'string' && spec.activity.length > 0) {
      const activity = isPlainObject(entry.provenance) ? entry.provenance.activity : ''
      const sourceActivity = isPlainObject(entry.source) ? entry.source.activity : ''
      if (activity !== spec.activity && sourceActivity !== spec.activity) return false
    }
    const text = normalizeText(spec.text)
    if (text.length > 0 && normalizeText(entry.text).toLowerCase().indexOf(text.toLowerCase()) < 0) return false
    return true
  }
  function list(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const limit = readPositiveInt(spec.limit, 100)
    const out = []
    for (const entry of entries.values()) {
      if (!matches(entry, spec)) continue
      out.push(cloneEntry(entry))
      if (out.length >= limit) break
    }
    return out
  }
  return {
    id,
    kind,
    permissions,
    read(filter) {
      return list(filter)
    },
    query(filter) {
      return list(filter)
    },
    write(entry) {
      if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
        return { ok: false, code: MEMORY_GATEWAY_CODES.invalidEntry, message: 'provider 需要带 id 的 entry' }
      }
      entries.set(entry.id, cloneEntry(entry))
      return { ok: true }
    },
    snapshot() {
      return { ok: true, id, kind, permissions: { ...permissions }, entries: entries.size, now: now() }
    },
    clear() {
      entries.clear()
    },
  }
}

/**
 * 创建记忆网关。
 * @param {{
 *   now?: () => number,
 *   maxEntries?: number,
 *   maxConflicts?: number,
 *   supersedeMargin?: number,
 *   defaultLimit?: number,
 *   maxLimit?: number,
 *   defaultWriteProvider?: string,
 * }} [options]
 */
export function createMemoryGateway(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxEntries = readPositiveInt(options.maxEntries, MEMORY_GATEWAY_DEFAULTS.maxEntries)
  const maxConflicts = readPositiveInt(options.maxConflicts, MEMORY_GATEWAY_DEFAULTS.maxConflicts)
  const supersedeMargin = Math.min(1, Math.max(0, readNumber(options.supersedeMargin, MEMORY_GATEWAY_DEFAULTS.supersedeMargin)))
  const defaultLimit = readPositiveInt(options.defaultLimit, MEMORY_GATEWAY_DEFAULTS.defaultLimit)
  const maxLimit = readPositiveInt(options.maxLimit, MEMORY_GATEWAY_DEFAULTS.maxLimit)
  const defaultWriteProvider = typeof options.defaultWriteProvider === 'string' ? options.defaultWriteProvider : null

  const providers = new Map()
  const entries = new Map()
  const conflicts = []
  let nextEntryId = 0
  const metrics = {
    writes: 0,
    merges: 0,
    conflicts: 0,
    superseded: 0,
    queries: 0,
    invalid: 0,
    permissionDenied: 0,
    providerErrors: 0,
  }

  function getProvider(id) {
    return providers.get(String(id ?? '')) ?? null
  }

  function writableProviders() {
    return [...providers.values()].filter((provider) => providerWritable(provider))
  }

  function readableProviders() {
    return [...providers.values()].filter((provider) => providerReadable(provider))
  }

  function recordProviderError(provider, scope, error) {
    metrics.providerErrors += 1
    provider.stats.errors += 1
    const message = error instanceof Error ? error.message : String(error)
    provider.lastError = { scope, message, at: now() }
    return { code: MEMORY_GATEWAY_CODES.providerError, message: `${provider.id}（${scope}）：${message}` }
  }

  async function callProviderWrite(provider, entry) {
    try {
      const result = await provider.write(entry)
      provider.stats.writes += 1
      if (isPlainObject(result) && result.ok === false) {
        return { ok: false, ...recordProviderError(provider, 'write', result.message ?? result.code ?? 'write failed') }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, ...recordProviderError(provider, 'write', error) }
    }
  }

  async function callProviderRead(provider, filter) {
    try {
      const fn = typeof provider.query === 'function' ? provider.query : provider.read
      const result = await fn(filter)
      provider.stats.reads += 1
      if (Array.isArray(result)) return { ok: true, entries: result }
      if (isPlainObject(result) && Array.isArray(result.entries)) return { ok: true, entries: result.entries }
      return { ok: true, entries: [] }
    } catch (error) {
      return { ok: false, ...recordProviderError(provider, 'query', error) }
    }
  }

  function pruneEntries() {
    while (entries.size > maxEntries) {
      let oldestId = null
      let oldestAt = Infinity
      for (const [id, entry] of entries) {
        if (entry.status === 'active') continue
        if (entry.updatedAt < oldestAt) {
          oldestAt = entry.updatedAt
          oldestId = id
        }
      }
      if (oldestId === null) {
        for (const [id, entry] of entries) {
          if (entry.updatedAt < oldestAt) {
            oldestAt = entry.updatedAt
            oldestId = id
          }
        }
      }
      if (oldestId === null) return
      entries.delete(oldestId)
    }
  }

  function recordConflict(record) {
    conflicts.push({ id: 'conflict-' + (conflicts.length + 1), at: now(), ...record })
    while (conflicts.length > maxConflicts) conflicts.shift()
    metrics.conflicts += 1
    return conflicts[conflicts.length - 1]
  }

  /** 注册 provider（默认只读；写权限需显式 permissions.write=true）。 */
  function registerProvider(spec) {
    if (!isPlainObject(spec)) return errorResult(MEMORY_GATEWAY_CODES.invalidEntry, 'provider 必须是对象')
    const id = typeof spec.id === 'string' ? spec.id.trim() : ''
    if (id.length === 0 || id.length > 64) return errorResult(MEMORY_GATEWAY_CODES.invalidEntry, 'provider.id 必须是 1–64 字字符串')
    if (providers.has(id)) return errorResult(MEMORY_GATEWAY_CODES.duplicateProvider, `provider id 重复：${id}`, { id })
    const kind = typeof spec.kind === 'string' && spec.kind.length > 0 ? spec.kind.slice(0, 40) : 'memory'
    const permissions = {
      read: !isPlainObject(spec.permissions) || spec.permissions.read !== false,
      write: isPlainObject(spec.permissions) && spec.permissions.write === true,
    }
    if (permissions.read && typeof spec.read !== 'function' && typeof spec.query !== 'function') {
      return errorResult(MEMORY_GATEWAY_CODES.invalidEntry, '可读 provider 需要 read 或 query 函数')
    }
    if (permissions.write && typeof spec.write !== 'function') {
      return errorResult(MEMORY_GATEWAY_CODES.invalidEntry, '声明了写权限的 provider 需要 write 函数')
    }
    const provider = {
      id,
      kind,
      permissions,
      read: typeof spec.read === 'function' ? spec.read : null,
      query: typeof spec.query === 'function' ? spec.query : null,
      write: typeof spec.write === 'function' ? spec.write : null,
      registeredAt: now(),
      stats: { reads: 0, writes: 0, errors: 0 },
      lastError: null,
    }
    providers.set(id, provider)
    return { ok: true, provider: providerSummary(provider) }
  }

  function unregisterProvider(id) {
    const provider = getProvider(id)
    if (provider === null) return errorResult(MEMORY_GATEWAY_CODES.unknownProvider, `provider 不存在：${String(id)}`)
    providers.delete(provider.id)
    return { ok: true, provider: providerSummary(provider) }
  }

  function listProviders() {
    return [...providers.values()].map((provider) => providerSummary(provider))
  }

  function normalizeEntryInput(raw) {
    if (!isPlainObject(raw)) return errorResult(MEMORY_GATEWAY_CODES.invalidEntry, 'entry 必须是对象')
    const category = typeof raw.category === 'string' ? raw.category.trim() : ''
    if (MEMORY_CATEGORIES.indexOf(category) < 0) {
      return errorResult(MEMORY_GATEWAY_CODES.unknownCategory, `未知记忆分类：${category || '（空）'}`, {
        allowed: MEMORY_CATEGORIES,
      })
    }
    const text = normalizeText(raw.text)
    if (text.length === 0 || text.length > MEMORY_GATEWAY_DEFAULTS.maxTextLength) {
      return errorResult(MEMORY_GATEWAY_CODES.invalidEntry, `text 必须是 1–${MEMORY_GATEWAY_DEFAULTS.maxTextLength} 字`)
    }
    const topic = normalizeText(raw.topic).slice(0, MEMORY_GATEWAY_DEFAULTS.maxTopicLength)
    let source = raw.source
    if (typeof source === 'string' && source.trim().length > 0) source = { kind: source.trim(), id: '' }
    if (!isPlainObject(source) || typeof source.kind !== 'string' || source.kind.trim().length === 0) {
      return errorResult(MEMORY_GATEWAY_CODES.invalidEntry, 'source 必须是 {kind, id} 或非空字符串')
    }
    const normalizedSource = {
      kind: source.kind.trim().slice(0, 40),
      id: typeof source.id === 'string' ? source.id.trim().slice(0, 120) : '',
      ...(typeof source.activity === 'string' && source.activity.length > 0 ? { activity: source.activity.slice(0, 40) } : {}),
    }
    const provenance = isPlainObject(raw.provenance) ? raw.provenance : {}
    const normalizedProvenance = {
      ...(typeof provenance.activity === 'string' && provenance.activity.length > 0
        ? { activity: provenance.activity.slice(0, 40) }
        : {}),
      ...(typeof provenance.taskId === 'string' && provenance.taskId.length > 0 ? { taskId: provenance.taskId.slice(0, 120) } : {}),
      ...(typeof provenance.correlationId === 'string' && provenance.correlationId.length > 0
        ? { correlationId: provenance.correlationId.slice(0, 128) }
        : {}),
      at: Number.isFinite(Number(provenance.at)) ? Number(provenance.at) : now(),
    }
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0).slice(0, 10).map((tag) => tag.trim().slice(0, 40))
      : []
    return {
      ok: true,
      entry: {
        category,
        topic,
        text,
        source: normalizedSource,
        provenance: normalizedProvenance,
        confidence: clampConfidence(raw.confidence),
        tags,
        provider: typeof raw.provider === 'string' && raw.provider.length > 0 ? raw.provider : null,
        meta: isPlainObject(raw.meta) ? raw.meta : null,
      },
    }
  }

  /**
   * 写入记忆（唯一入口）：校验 → 合并/冲突判定 → 写 provider → 更新索引。
   * @param {object} raw
   * @returns {Promise<object>} {ok:true, entry, duplicate?, merged?, conflict?, superseded?} | {ok:false, code, message}
   */
  async function write(raw) {
    const normalized = normalizeEntryInput(raw)
    if (normalized.ok !== true) {
      metrics.invalid += 1
      return normalized
    }
    const input = normalized.entry
    const target =
      input.provider !== null
        ? getProvider(input.provider)
        : defaultWriteProvider !== null
          ? getProvider(defaultWriteProvider)
          : writableProviders()[0] ?? null
    if (target === null) {
      if (input.provider !== null) return errorResult(MEMORY_GATEWAY_CODES.unknownProvider, `provider 不存在：${input.provider}`)
      return errorResult(MEMORY_GATEWAY_CODES.noWritableProvider, '没有可写的 provider（写权限需显式声明 permissions.write=true）')
    }
    if (!providerWritable(target)) {
      metrics.permissionDenied += 1
      return errorResult(MEMORY_GATEWAY_CODES.permissionDenied, `provider ${target.id} 没有写权限`, { provider: target.id })
    }
    const key = topicKeyOf(input.category, input.topic, input.text)
    const sameKey = [...entries.values()].filter(
      (entry) => topicKeyOf(entry.category, entry.topic, entry.text) === key && entry.status === 'active',
    )
    const duplicate = sameKey.find((entry) => normalizeText(entry.text).toLowerCase() === input.text.toLowerCase()) ?? null
    const ts = now()
    if (duplicate !== null) {
      const merged = {
        ...duplicate,
        confidence: Math.max(duplicate.confidence, input.confidence),
        updatedAt: ts,
        provenance: mergeProvenance(duplicate.provenance, input.provenance),
        sources: mergeSources(duplicate.sources, input.source),
        tags: [...new Set([...duplicate.tags, ...input.tags])].slice(0, 10),
      }
      const originalProvider = getProvider(duplicate.provider)
      const mergeTarget =
        originalProvider !== null && providerWritable(originalProvider) ? originalProvider : target
      if (mergeTarget.id !== duplicate.provider) merged.provider = mergeTarget.id
      const written = await callProviderWrite(mergeTarget, merged)
      if (written.ok !== true) return errorResult(MEMORY_GATEWAY_CODES.providerError, written.message)
      entries.set(merged.id, merged)
      metrics.merges += 1
      return { ok: true, duplicate: true, merged: true, entry: cloneEntry(merged) }
    }
    if (sameKey.length > 0) {
      const existing = sameKey.sort((left, right) => right.confidence - left.confidence || right.updatedAt - left.updatedAt)[0]
      const incomingId = 'mem-' + (nextEntryId + 1)
      const incoming = {
        id: incomingId,
        category: input.category,
        topic: input.topic,
        text: input.text,
        source: input.source,
        provenance: input.provenance,
        confidence: input.confidence,
        tags: input.tags,
        status: 'conflicted',
        createdAt: ts,
        updatedAt: ts,
        provider: target.id,
        sources: [input.source],
        meta: input.meta,
        conflictWith: existing.id,
      }
      if (input.confidence - existing.confidence >= supersedeMargin) {
        const superseded = { ...existing, status: 'superseded', updatedAt: ts, supersededBy: incomingId }
        incoming.status = 'active'
        const existingProvider = getProvider(existing.provider)
        if (existingProvider !== null && providerWritable(existingProvider)) {
          const writtenExisting = await callProviderWrite(existingProvider, superseded)
          if (writtenExisting.ok !== true) return errorResult(MEMORY_GATEWAY_CODES.providerError, writtenExisting.message)
        }
        const writtenIncoming = await callProviderWrite(target, incoming)
        if (writtenIncoming.ok !== true) return errorResult(MEMORY_GATEWAY_CODES.providerError, writtenIncoming.message)
        entries.set(existing.id, superseded)
        nextEntryId += 1
        entries.set(incomingId, incoming)
        pruneEntries()
        metrics.superseded += 1
        const conflict = recordConflict({
          category: input.category,
          topic: input.topic,
          existingId: existing.id,
          incomingId,
          existingText: existing.text,
          incomingText: incoming.text,
          resolution: 'superseded',
        })
        metrics.writes += 1
        return { ok: true, superseded: true, conflict, entry: cloneEntry(incoming) }
      }
      const writtenIncoming = await callProviderWrite(target, incoming)
      if (writtenIncoming.ok !== true) return errorResult(MEMORY_GATEWAY_CODES.providerError, writtenIncoming.message)
      nextEntryId += 1
      entries.set(incomingId, incoming)
      pruneEntries()
      const conflict = recordConflict({
        category: input.category,
        topic: input.topic,
        existingId: existing.id,
        incomingId,
        existingText: existing.text,
        incomingText: incoming.text,
        resolution: 'kept-existing',
      })
      metrics.writes += 1
      return { ok: true, conflict: true, conflict, entry: cloneEntry(incoming) }
    }
    const entry = {
      id: 'mem-' + (nextEntryId + 1),
      category: input.category,
      topic: input.topic,
      text: input.text,
      source: input.source,
      provenance: input.provenance,
      confidence: input.confidence,
      tags: input.tags,
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
      provider: target.id,
      sources: [input.source],
      meta: input.meta,
    }
    const written = await callProviderWrite(target, entry)
    if (written.ok !== true) return errorResult(MEMORY_GATEWAY_CODES.providerError, written.message)
    nextEntryId += 1
    entries.set(entry.id, entry)
    pruneEntries()
    metrics.writes += 1
    return { ok: true, entry: cloneEntry(entry) }
  }

  function normalizeFilter(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    if (spec.category !== undefined) {
      if (typeof spec.category !== 'string' || MEMORY_CATEGORIES.indexOf(spec.category) < 0) {
        return errorResult(MEMORY_GATEWAY_CODES.invalidFilter, `未知记忆分类：${String(spec.category)}`, {
          allowed: MEMORY_CATEGORIES,
        })
      }
    }
    const limit = readPositiveInt(spec.limit, defaultLimit)
    return {
      ok: true,
      filter: {
        text: normalizeText(spec.text),
        category: typeof spec.category === 'string' ? spec.category : '',
        activity: typeof spec.activity === 'string' ? spec.activity : '',
        provider: typeof spec.provider === 'string' ? spec.provider : '',
        limit: Math.min(limit, maxLimit),
      },
    }
  }

  /**
   * 查询记忆：多 provider 聚合 → 去重 → 相关度/时间排序 → 带 provenance。
   * @param {{text?: string, category?: string, activity?: string, provider?: string, limit?: number}} [filter]
   * @returns {Promise<{ok: true, entries: object[], total: number, errors: object[]}>}
   */
  async function query(filter) {
    const normalized = normalizeFilter(filter)
    if (normalized.ok !== true) return normalized
    const spec = normalized.filter
    const candidates = readableProviders().filter(
      (provider) => spec.provider.length === 0 || provider.id === spec.provider,
    )
    const errors = []
    const collected = []
    for (const provider of candidates) {
      if (!providerReadable(provider)) continue
      const result = await callProviderRead(provider, spec)
      if (result.ok !== true) {
        errors.push({ provider: provider.id, code: result.code, message: result.message })
        continue
      }
      for (const entry of result.entries) {
        if (!isPlainObject(entry) || typeof entry.id !== 'string') continue
        collected.push({ provider: provider.id, entry })
      }
    }
    metrics.queries += 1
    const byId = new Map()
    for (const item of collected) {
      const existing = byId.get(item.entry.id)
      if (existing === undefined) {
        byId.set(item.entry.id, { entry: item.entry, providers: [item.provider] })
      } else {
        existing.providers.push(item.provider)
      }
    }
    const results = []
    for (const item of byId.values()) {
      const entry = item.entry
      if (spec.category.length > 0 && entry.category !== spec.category) continue
      if (spec.activity.length > 0) {
        const activity = isPlainObject(entry.provenance) ? entry.provenance.activity : ''
        const sourceActivity = isPlainObject(entry.source) ? entry.source.activity : ''
        if (activity !== spec.activity && sourceActivity !== spec.activity) continue
      }
      results.push({
        ...cloneEntry(entry),
        providers: item.providers.slice(),
        score: scoreEntry(entry, spec.text),
      })
    }
    results.sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    const limited = results.slice(0, spec.limit)
    return { ok: true, entries: limited, total: results.length, errors }
  }

  /** read 是 query 的别名（无文本相关度排序，按时间倒序）。 */
  async function read(filter) {
    const result = await query(filter)
    if (result.ok !== true) return result
    const sorted = result.entries.slice().sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    return { ...result, entries: sorted }
  }

  function getEntry(id) {
    const entry = entries.get(String(id ?? ''))
    return entry === undefined ? null : cloneEntry(entry)
  }

  function listConflicts(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const limit = readPositiveInt(spec.limit, 50)
    const out = conflicts.filter((conflict) => {
      if (typeof spec.category === 'string' && spec.category.length > 0 && conflict.category !== spec.category) return false
      if (typeof spec.resolution === 'string' && spec.resolution.length > 0 && conflict.resolution !== spec.resolution) return false
      return true
    })
    return out.slice(-limit).reverse().map((conflict) => ({ ...conflict }))
  }

  function snapshot() {
    const byCategory = {}
    const byStatus = { active: 0, superseded: 0, conflicted: 0 }
    for (const entry of entries.values()) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1
      byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1
    }
    return {
      ok: true,
      version: MEMORY_GATEWAY_VERSION,
      now: now(),
      providers: listProviders(),
      entries: entries.size,
      byCategory,
      byStatus,
      conflicts: conflicts.length,
      recentConflicts: listConflicts({ limit: 10 }),
      limits: { maxEntries, maxConflicts, supersedeMargin, defaultLimit, maxLimit },
      metrics: { ...metrics },
    }
  }

  return {
    registerProvider,
    unregisterProvider,
    listProviders,
    write,
    query,
    read,
    getEntry,
    listConflicts,
    snapshot,
  }
}
