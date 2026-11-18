// lib/core/event-schema.mjs —— 事件契约与校验（Gate A7，纯函数、无宿主依赖、不实现存储）。
//
// 目的：在 Event Bus 落地之前，把“事件长什么样、怎么演进、怎么去重、版本不兼容怎么办”写成可校验的契约，
// 供 Event Bus / Activity SDK / 回放工具直接复用。
//
// 约定：
//   · envelope 字段：id / activity / type / version / at / subject / topics / payload / correlationId；
//   · type 命名空间：`<namespace>.<name>[.<sub>]`（小写），保留命名空间见 EVENT_RESERVED_NAMESPACES；
//   · version 是**事件类型自己的 payload schema 版本**（每个 type 独立递增），不是 envelope 版本；
//   · 投递语义 at-least-once：消费方用幂等键去重（buildIdempotencyKey）；
//   · 未知 type / 更新版本的事件**保留不丢弃**（UNKNOWN_EVENT_POLICY='retain'），由消费方决定跳过/等升级；
//   · 纯逻辑：不读盘、不联网、无定时器；payload 只做 JSON 可序列化与体积校验，不落存储。

import { createHash } from 'node:crypto'

/** envelope 字段清单（文档/测试单一来源）。 */
export const EVENT_ENVELOPE_FIELDS = Object.freeze([
  'id',
  'activity',
  'type',
  'version',
  'at',
  'subject',
  'topics',
  'payload',
  'correlationId',
])

/** 必填字段（其余有默认值）。 */
export const EVENT_REQUIRED_FIELDS = Object.freeze(['id', 'activity', 'type', 'version', 'at', 'subject'])

/** 校验上限（防事件膨胀成攻击面）。 */
export const EVENT_SCHEMA_LIMITS = Object.freeze({
  idMax: 128,
  activityMax: 40,
  typeMax: 120,
  subjectMax: 200,
  versionMax: 1000,
  topicsMax: 16,
  topicMax: 80,
  payloadMaxBytes: 64 * 1024,
  correlationIdMax: 128,
})

/** 可识别错误码。 */
export const EVENT_ERROR_CODES = Object.freeze({
  invalidType: 'EVENT_INVALID_TYPE',
  missingField: 'EVENT_MISSING_FIELD',
  invalidValue: 'EVENT_INVALID_VALUE',
  invalidTypeName: 'EVENT_INVALID_TYPE_NAME',
  payloadNotJson: 'EVENT_PAYLOAD_NOT_JSON',
  payloadTooLarge: 'EVENT_PAYLOAD_TOO_LARGE',
  tooManyTopics: 'EVENT_TOO_MANY_TOPICS',
  duplicateTopic: 'EVENT_DUPLICATE_TOPIC',
})

/** 版本兼容状态。 */
export const EVENT_VERSION_STATUS = Object.freeze({
  compatible: 'compatible',
  unknownType: 'unknown-type',
  tooOld: 'too-old',
  tooNew: 'too-new',
  invalid: 'invalid',
})

/** 未知事件策略：保留（不丢弃、不报错，由消费方跳过/等升级）。 */
export const UNKNOWN_EVENT_POLICY = 'retain'

/** 保留命名空间（核心域；Activity 自定义命名空间不得占用）。 */
export const EVENT_RESERVED_NAMESPACES = Object.freeze([
  'activity',
  'chat',
  'cost',
  'memory',
  'model',
  'system',
  'task',
  'world',
])

/** 背压/保留默认值（docs/event-contract.md 的单一来源；本模块不实现存储）。 */
export const EVENT_BACKPRESSURE_DEFAULTS = Object.freeze({
  /** 事件保留窗口（小时）：超过后归档/清理。 */
  retentionHours: 72,
  /** 内存中最多保留的事件条数（超出触发背压）。 */
  maxEventsInMemory: 10_000,
  /** 单次回放最多事件条数（防止回放风暴）。 */
  maxReplayEvents: 5_000,
  /** 超过该时长的事件先归档再清理（小时）。 */
  archiveAfterHours: 24,
  /** 磁盘软阈值：超过后降采样/暂停低优先级生产并告警。 */
  diskSoftLimitBytes: 512 * 1024 * 1024,
  /** 磁盘硬阈值：超过后拒绝新事件并告警（critical）。 */
  diskHardLimitBytes: 2 * 1024 * 1024 * 1024,
  /** 单事件 payload 上限（字节）。 */
  maxPayloadBytes: EVENT_SCHEMA_LIMITS.payloadMaxBytes,
  /** 未知事件保留策略。 */
  unknownEventRetention: UNKNOWN_EVENT_POLICY,
})

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/
const ACTIVITY_PATTERN = /^[a-z][a-z0-9-]{2,39}$/
const TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9_-]+){1,4}$/
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorEntry(path, code, message) {
  return { path, code, message }
}

function isBoundedText(value, max) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !CONTROL_CHARS.test(value)
  )
}

/** 解析事件类型：`<namespace>.<name>[.<sub>]`。 */
export function parseEventType(type) {
  if (typeof type !== 'string' || !TYPE_PATTERN.test(type) || type.length > EVENT_SCHEMA_LIMITS.typeMax) {
    return {
      ok: false,
      code: EVENT_ERROR_CODES.invalidTypeName,
      message: 'type 必须是 <namespace>.<name>[.<sub>] 形式的小写命名空间',
    }
  }
  const segments = type.split('.')
  return {
    ok: true,
    namespace: segments[0],
    name: segments[1],
    segments,
    reservedNamespace: EVENT_RESERVED_NAMESPACES.indexOf(segments[0]) >= 0,
  }
}

/** 是否保留命名空间。 */
export function isReservedNamespace(namespace) {
  return EVENT_RESERVED_NAMESPACES.indexOf(String(namespace)) >= 0
}

/**
 * 生成事件 id（可注入 now/random 便于测试）。
 * @param {{now?: number|(() => number), random?: () => number, prefix?: string}} [options]
 */
export function generateEventId(options = {}) {
  const now = typeof options.now === 'function' ? Number(options.now()) : Number.isFinite(options.now) ? Number(options.now) : Date.now()
  const random = typeof options.random === 'function' ? options.random : Math.random
  let suffix = ''
  for (let index = 0; index < 8; index += 1) {
    const value = Number(random())
    const ratio = Number.isFinite(value) ? Math.min(0.9999, Math.max(0, value)) : 0
    suffix += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(ratio * 36)]
  }
  const prefix = typeof options.prefix === 'string' && options.prefix.length > 0 ? options.prefix : 'evt'
  return `${prefix}-${now.toString(36)}-${suffix}`
}

/** 稳定序列化（键排序；用于内容哈希/幂等键，与对象键顺序无关）。 */
export function canonicalJson(value) {
  const seen = new Set()
  function encode(input) {
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input)
    if (typeof input === 'number') return Number.isFinite(input) ? JSON.stringify(input) : 'null'
    if (Array.isArray(input)) return '[' + input.map((item) => encode(item)).join(',') + ']'
    if (isPlainObject(input)) {
      if (seen.has(input)) throw new Error('circular')
      seen.add(input)
      const keys = Object.keys(input).sort()
      const parts = []
      for (const key of keys) {
        const encoded = encode(input[key])
        if (encoded !== undefined) parts.push(JSON.stringify(key) + ':' + encoded)
      }
      seen.delete(input)
      return '{' + parts.join(',') + '}'
    }
    return 'null'
  }
  return encode(value)
}

/**
 * 事件内容哈希（sha256；默认覆盖 activity/type/version/subject/payload/correlationId）。
 * 用于去重/诊断；不覆盖 id/at（重投可能保留同一逻辑内容）。
 */
export function contentHashOf(event, fields) {
  const source = isPlainObject(event) ? event : {}
  const keys = Array.isArray(fields) && fields.length > 0 ? fields : ['activity', 'type', 'version', 'subject', 'payload', 'correlationId']
  const selected = {}
  for (const key of keys) if (Object.hasOwn(source, key)) selected[key] = source[key]
  try {
    return createHash('sha256').update(canonicalJson(selected)).digest('hex')
  } catch (error) {
    void error
    return ''
  }
}

/**
 * 生成幂等键（at-least-once 去重）：默认 `${activity}:${type}:${subject}:${correlationId}`。
 * 同一条逻辑事件重投（同 correlationId/subject/type）得到同一 key；非法输入返回 ''。
 * @param {object} event
 * @param {{includeContentHash?: boolean, hashFields?: string[]}} [options]
 */
export function buildIdempotencyKey(event, options = {}) {
  if (!isPlainObject(event)) return ''
  const activity = typeof event.activity === 'string' ? event.activity.trim() : ''
  const type = typeof event.type === 'string' ? event.type.trim() : ''
  const subject = typeof event.subject === 'string' ? event.subject.trim() : ''
  const correlationId =
    typeof event.correlationId === 'string' && event.correlationId.trim().length > 0
      ? event.correlationId.trim()
      : typeof event.id === 'string'
        ? event.id.trim()
        : ''
  if (activity.length === 0 || type.length === 0 || subject.length === 0 || correlationId.length === 0) return ''
  const base = `${activity}:${type}:${subject}:${correlationId}`
  if (options.includeContentHash !== true) return base
  const hash = contentHashOf(event, options.hashFields)
  return hash.length > 0 ? `${base}:${hash.slice(0, 16)}` : ''
}

function normalizeTopics(raw, errors, event) {
  if (raw === undefined || raw === null) {
    const derived = [event.activity, event.type].filter((item) => typeof item === 'string' && item.length > 0)
    return derived
  }
  if (!Array.isArray(raw)) {
    errors.push(errorEntry('topics', EVENT_ERROR_CODES.invalidType, 'topics 必须是字符串数组'))
    return []
  }
  if (raw.length > EVENT_SCHEMA_LIMITS.topicsMax) {
    errors.push(
      errorEntry('topics', EVENT_ERROR_CODES.tooManyTopics, `topics 最多 ${EVENT_SCHEMA_LIMITS.topicsMax} 个（当前 ${raw.length}）`),
    )
  }
  const topics = []
  const seen = new Set()
  raw.slice(0, EVENT_SCHEMA_LIMITS.topicsMax).forEach((item, index) => {
    const path = `topics[${index}]`
    if (typeof item !== 'string' || !TOPIC_PATTERN.test(item) || item.length > EVENT_SCHEMA_LIMITS.topicMax) {
      errors.push(errorEntry(path, EVENT_ERROR_CODES.invalidValue, `${path} 命名不合法：${String(item)}`))
      return
    }
    if (seen.has(item)) {
      errors.push(errorEntry(path, EVENT_ERROR_CODES.duplicateTopic, `${path} 重复：${item}`))
      return
    }
    seen.add(item)
    topics.push(item)
  })
  return topics
}

function normalizePayload(raw, errors) {
  if (raw === undefined || raw === null) return {}
  if (!isPlainObject(raw)) {
    errors.push(errorEntry('payload', EVENT_ERROR_CODES.invalidType, 'payload 必须是对象'))
    return {}
  }
  let text
  try {
    text = JSON.stringify(raw)
  } catch (error) {
    errors.push(errorEntry('payload', EVENT_ERROR_CODES.payloadNotJson, `payload 不是可 JSON 序列化的对象：${error instanceof Error ? error.message : String(error)}`))
    return {}
  }
  if (typeof text !== 'string') {
    errors.push(errorEntry('payload', EVENT_ERROR_CODES.payloadNotJson, 'payload 不是可 JSON 序列化的对象'))
    return {}
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > EVENT_SCHEMA_LIMITS.payloadMaxBytes) {
    errors.push(
      errorEntry(
        'payload',
        EVENT_ERROR_CODES.payloadTooLarge,
        `payload 过大（${bytes} > ${EVENT_SCHEMA_LIMITS.payloadMaxBytes} 字节）`,
      ),
    )
    return {}
  }
  return raw
}

/**
 * 校验事件 envelope。
 * @param {unknown} raw
 * @returns {{ok: true, event: object, errors: []} | {ok: false, event: null, errors: Array<{path: string, code: string, message: string}>}}
 */
export function validateEventEnvelope(raw) {
  const errors = []
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      event: null,
      errors: [errorEntry('$', EVENT_ERROR_CODES.invalidType, '事件 envelope 必须是对象')],
    }
  }
  for (const field of EVENT_REQUIRED_FIELDS) {
    if (!Object.hasOwn(raw, field)) {
      errors.push(errorEntry(field, EVENT_ERROR_CODES.missingField, `缺少必填字段：${field}`))
    }
  }

  let id = ''
  if (raw.id !== undefined) {
    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id.trim())) {
      errors.push(
        errorEntry('id', EVENT_ERROR_CODES.invalidValue, 'id 必须是 8–128 位字母/数字/._:-（字母或数字开头）'),
      )
    } else {
      id = raw.id.trim()
    }
  }

  let activity = ''
  if (raw.activity !== undefined) {
    if (typeof raw.activity !== 'string' || !ACTIVITY_PATTERN.test(raw.activity.trim())) {
      errors.push(errorEntry('activity', EVENT_ERROR_CODES.invalidValue, 'activity 必须是 3–40 位小写字母/数字/连字符'))
    } else {
      activity = raw.activity.trim()
    }
  }

  let type = ''
  if (raw.type !== undefined) {
    const parsed = parseEventType(raw.type)
    if (!parsed.ok) {
      errors.push(errorEntry('type', parsed.code, parsed.message))
    } else {
      type = raw.type.trim()
    }
  }

  let version = 0
  if (raw.version !== undefined) {
    const value = Number(raw.version)
    if (!Number.isInteger(value) || value < 1 || value > EVENT_SCHEMA_LIMITS.versionMax) {
      errors.push(
        errorEntry('version', EVENT_ERROR_CODES.invalidValue, `version 必须是 1..${EVENT_SCHEMA_LIMITS.versionMax} 的整数`),
      )
    } else {
      version = value
    }
  }

  let at = 0
  if (raw.at !== undefined) {
    const value = Number(raw.at)
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(errorEntry('at', EVENT_ERROR_CODES.invalidValue, 'at 必须是毫秒时间戳（>0）'))
    } else {
      at = Math.floor(value)
    }
  }

  let subject = ''
  if (raw.subject !== undefined) {
    if (!isBoundedText(raw.subject, EVENT_SCHEMA_LIMITS.subjectMax)) {
      errors.push(errorEntry('subject', EVENT_ERROR_CODES.invalidValue, `subject 必须是 1–${EVENT_SCHEMA_LIMITS.subjectMax} 字字符串`))
    } else {
      subject = raw.subject.trim()
    }
  }

  let correlationId = ''
  if (raw.correlationId !== undefined && raw.correlationId !== null && String(raw.correlationId).trim().length > 0) {
    const value = String(raw.correlationId).trim()
    if (!ID_PATTERN.test(value) || value.length > EVENT_SCHEMA_LIMITS.correlationIdMax) {
      errors.push(errorEntry('correlationId', EVENT_ERROR_CODES.invalidValue, 'correlationId 必须是 8–128 位字母/数字/._:-'))
    } else {
      correlationId = value
    }
  } else {
    correlationId = id
  }

  const topics = normalizeTopics(raw.topics, errors, { activity, type })
  const payload = normalizePayload(raw.payload, errors)

  if (errors.length > 0) return { ok: false, event: null, errors }
  return {
    ok: true,
    errors: [],
    event: {
      id,
      activity,
      type,
      version,
      at,
      subject,
      topics,
      payload,
      correlationId,
    },
  }
}

/**
 * 构建并校验事件（自动补 id/at/topics/correlationId 默认值）。
 * @param {object} input
 * @param {{now?: number|(() => number), random?: () => number, prefix?: string}} [options]
 */
export function createEventEnvelope(input, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const id =
    typeof source.id === 'string' && source.id.length > 0
      ? source.id
      : generateEventId({ now: options.now, random: options.random, prefix: options.prefix })
  const at = source.at ?? (typeof options.now === 'function' ? options.now() : Number.isFinite(options.now) ? options.now : Date.now())
  const built = {
    ...source,
    id,
    at,
    correlationId:
      typeof source.correlationId === 'string' && source.correlationId.length > 0 ? source.correlationId : id,
  }
  return validateEventEnvelope(built)
}

/**
 * 版本兼容判断（消费方视角）。
 * consumer: { types?: string[] | '*', minVersion?: number, maxVersion?: number }
 * 返回 { ok, status, type, version, action, reason }：
 *   compatible → action:'process'；unknown-type/too-new → action:'retain'（保留等升级）；
 *   too-old → action:'skip'（过旧可归档）；invalid → action:'drop'（结构非法）。
 * @param {unknown} event
 * @param {{types?: string[]|'*', minVersion?: number, maxVersion?: number}} [consumer]
 */
export function checkEventVersion(event, consumer = {}) {
  const validated = validateEventEnvelope(event)
  if (!validated.ok) {
    return {
      ok: false,
      status: EVENT_VERSION_STATUS.invalid,
      type: '',
      version: 0,
      action: 'drop',
      reason: validated.errors.length > 0 ? validated.errors[0].message : '事件结构非法',
      errors: validated.errors,
    }
  }
  const normalized = validated.event
  const spec = isPlainObject(consumer) ? consumer : {}
  const types = spec.types === undefined ? '*' : spec.types
  const supported =
    types === '*' || (Array.isArray(types) && types.indexOf(normalized.type) >= 0)
  if (!supported) {
    return {
      ok: false,
      status: EVENT_VERSION_STATUS.unknownType,
      type: normalized.type,
      version: normalized.version,
      action: 'retain',
      reason: `消费方未声明该事件类型（策略：${UNKNOWN_EVENT_POLICY}）`,
    }
  }
  const minVersion = Number.isFinite(Number(spec.minVersion)) ? Math.max(1, Math.floor(Number(spec.minVersion))) : 1
  const maxVersion = Number.isFinite(Number(spec.maxVersion))
    ? Math.floor(Number(spec.maxVersion))
    : EVENT_SCHEMA_LIMITS.versionMax
  if (normalized.version < minVersion) {
    return {
      ok: false,
      status: EVENT_VERSION_STATUS.tooOld,
      type: normalized.type,
      version: normalized.version,
      action: 'skip',
      reason: `事件版本 ${normalized.version} 低于消费方最低支持 ${minVersion}`,
    }
  }
  if (normalized.version > maxVersion) {
    return {
      ok: false,
      status: EVENT_VERSION_STATUS.tooNew,
      type: normalized.type,
      version: normalized.version,
      action: 'retain',
      reason: `事件版本 ${normalized.version} 高于消费方已知 ${maxVersion}（保留等升级）`,
    }
  }
  return {
    ok: true,
    status: EVENT_VERSION_STATUS.compatible,
    type: normalized.type,
    version: normalized.version,
    action: 'process',
    reason: '',
  }
}

/** 布尔便捷版：版本是否可被该消费方处理。 */
export function isVersionCompatible(event, consumer = {}) {
  return checkEventVersion(event, consumer).status === EVENT_VERSION_STATUS.compatible
}

/** 背压阈值解析（供 Event Bus 读取 env；0/非法回退默认）。 */
export function resolveEventBackpressure(env = process.env) {
  const source = isPlainObject(env) ? env : {}
  const read = (key, fallback) => {
    const raw = source[key]
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
  }
  return {
    retentionHours: read('DSH_POETRY_EVENT_RETENTION_HOURS', EVENT_BACKPRESSURE_DEFAULTS.retentionHours),
    maxEventsInMemory: read('DSH_POETRY_EVENT_MAX_MEMORY', EVENT_BACKPRESSURE_DEFAULTS.maxEventsInMemory),
    maxReplayEvents: read('DSH_POETRY_EVENT_MAX_REPLAY', EVENT_BACKPRESSURE_DEFAULTS.maxReplayEvents),
    archiveAfterHours: read('DSH_POETRY_EVENT_ARCHIVE_HOURS', EVENT_BACKPRESSURE_DEFAULTS.archiveAfterHours),
    diskSoftLimitBytes: read('DSH_POETRY_EVENT_DISK_SOFT_BYTES', EVENT_BACKPRESSURE_DEFAULTS.diskSoftLimitBytes),
    diskHardLimitBytes: read('DSH_POETRY_EVENT_DISK_HARD_BYTES', EVENT_BACKPRESSURE_DEFAULTS.diskHardLimitBytes),
    maxPayloadBytes: EVENT_BACKPRESSURE_DEFAULTS.maxPayloadBytes,
    unknownEventRetention: UNKNOWN_EVENT_POLICY,
  }
}
