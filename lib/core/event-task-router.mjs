// @ts-check
// lib/core/event-task-router.mjs —— Event → Task 路由器（Gate J1，纯逻辑）。
//
// 目标：订阅 EventBus，按规则把事件转换成 Task（只创建 queued，不执行）。
//   · rules: [{id, match:{activity?,type?,topics?,payloadOk?}, task:{activity,kind,priority,payload|build}, enabled}]
//   · 去重（idempotencyKey 按 event id/type/subject + rule）、每分钟限流、单规则容量；
//   · dry-run：只记录 wouldCreate，不建任务；失败隔离（单事件/单规则异常不影响其他）；
//   · 默认规则（安全）：minecraft.tool_receipt 失败 → minecraft.inquire；video.topic → study.research；
//     reading.finished → study.note；**明确排除 chat.***（聊天由 J2 直接处理，避免双触发）。
// 不执行 task、不联网、不写盘；board/eventBus/now 均可注入。

/** 实现版本。 */
export const EVENT_TASK_ROUTER_VERSION = 1

/** 默认限流（每分钟最多创建任务数）。 */
export const DEFAULT_ROUTER_RATE_PER_MINUTE = 60

/** 默认单规则容量（最多创建任务数）。 */
export const DEFAULT_ROUTER_RULE_CAPACITY = 200

/** 错误码。 */
export const EVENT_TASK_ROUTER_CODES = Object.freeze({
  invalidRule: 'EVENT_TASK_ROUTER_INVALID_RULE',
  invalidEvent: 'EVENT_TASK_ROUTER_INVALID_EVENT',
})

/** 默认排除的事件前缀（聊天已由 J2 直接处理，避免双触发）。 */
export const DEFAULT_ROUTER_EXCLUDED_PREFIXES = Object.freeze(['chat.'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function eventTypeOf(event) {
  if (!isPlainObject(event)) return ''
  if (typeof event.type === 'string') return event.type
  return ''
}

function eventMatchesType(eventType, pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return true
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) return eventType.startsWith(pattern.slice(0, -1))
  return eventType === pattern
}

function eventMatchesTopics(event, topics) {
  if (!Array.isArray(topics) || topics.length === 0) return true
  const eventTopics = Array.isArray(event.topics) ? event.topics : []
  return topics.some((topic) => eventTopics.indexOf(topic) >= 0)
}

/** 解析 router feature flag（显式 > env DSH_POETRY_HUB_ROUTER > settings.hub.router > 默认 off）。 */
export function resolveRouterFeatureFlag(input = {}) {
  const spec = isPlainObject(input) ? input : {}
  if (isPlainObject(spec.featureFlag) && typeof spec.featureFlag.router === 'boolean') return spec.featureFlag.router
  const env = isPlainObject(spec.env) ? spec.env : {}
  const value = typeof env.DSH_POETRY_HUB_ROUTER === 'string' ? env.DSH_POETRY_HUB_ROUTER.trim().toLowerCase() : ''
  if (value === '1' || value === 'on' || value === 'true' || value === 'yes') return true
  if (value === '0' || value === 'off' || value === 'false' || value === 'no') return false
  const settings = isPlainObject(spec.settings) ? spec.settings : null
  return settings !== null && isPlainObject(settings.hub) && settings.hub.router === true
}

/** 默认安全规则（chat.* 不在其中；router 还会默认忽略 chat.*）。 */
export function createDefaultRouterRules() {
  return [
    {
      id: 'minecraft-receipt-failed-inquire',
      enabled: true,
      match: {
        activity: 'minecraft',
        type: 'minecraft.tool_receipt',
        payloadOk: (event) => isPlainObject(event.payload) && event.payload.ok === false,
      },
      task: {
        activity: 'minecraft',
        kind: 'minecraft.inquire',
        priority: 50,
        build: (event) => ({
          tool: 'mc_inquire',
          arguments: {
            problem: String((isPlainObject(event.payload) && event.payload.detail) || 'tool 执行失败').slice(0, 200),
          },
        }),
      },
    },
    {
      id: 'video-topic-to-study',
      enabled: true,
      match: { type: 'video.topic' },
      task: {
        activity: 'study',
        kind: 'study.research',
        priority: 40,
        build: (event) => ({ query: String((isPlainObject(event.payload) && event.payload.topic) || '').slice(0, 120) }),
      },
    },
    {
      id: 'reading-finished-to-note',
      enabled: true,
      match: { type: 'reading.finished' },
      task: {
        activity: 'study',
        kind: 'study.note',
        priority: 30,
        build: (event) => ({
          text: '读完《' + String((isPlainObject(event.payload) && event.payload.title) || '未命名').slice(0, 80) + '》，值得记一条笔记',
        }),
      },
    },
  ]
}

function normalizeRules(rules) {
  const list = Array.isArray(rules) ? rules : createDefaultRouterRules()
  const out = []
  const errors = []
  for (const rule of list) {
    if (!isPlainObject(rule) || typeof rule.id !== 'string' || rule.id.length === 0) {
      errors.push({ ruleId: '', message: 'rule 需要 id' })
      continue
    }
    if (!isPlainObject(rule.match) || !isPlainObject(rule.task)) {
      errors.push({ ruleId: rule.id, message: 'rule 需要 match/task' })
      continue
    }
    if (typeof rule.task.activity !== 'string' || typeof rule.task.kind !== 'string') {
      errors.push({ ruleId: rule.id, message: 'task 需要 activity/kind' })
      continue
    }
    out.push({
      id: rule.id.slice(0, 80),
      enabled: rule.enabled !== false,
      match: {
        activity: typeof rule.match.activity === 'string' ? rule.match.activity : '',
        type: typeof rule.match.type === 'string' ? rule.match.type : '',
        topics: Array.isArray(rule.match.topics) ? rule.match.topics.filter((topic) => typeof topic === 'string').slice(0, 10) : [],
        payloadOk: typeof rule.match.payloadOk === 'function' ? rule.match.payloadOk : null,
      },
      task: {
        activity: rule.task.activity.slice(0, 60),
        kind: rule.task.kind.slice(0, 80),
        priority: Number.isFinite(Number(rule.task.priority)) ? Math.trunc(Number(rule.task.priority)) : 50,
        payload: isPlainObject(rule.task.payload) ? { ...rule.task.payload } : null,
        build: typeof rule.task.build === 'function' ? rule.task.build : null,
      },
    })
  }
  return { rules: out, errors }
}

/**
 * 创建 Event→Task 路由器。
 * @param {{
 *   eventBus?: {subscribe?: Function, append?: Function},
 *   board?: {create?: Function, waiting?: Function},
 *   rules?: object[]|null,
 *   dryRun?: boolean,
 *   ratePerMinute?: number,
 *   ruleCapacity?: number,
 *   excludedPrefixes?: string[]|null,
 *   attach?: boolean,
 *   now?: () => number,
 *   logger?: object|null,
 * }} [options]
 */
export function createEventTaskRouter(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const eventBus = spec.eventBus ?? null
  const board = spec.board ?? null
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const dryRun = spec.dryRun === true
  const ratePerMinute =
    Number.isFinite(Number(spec.ratePerMinute)) && Number(spec.ratePerMinute) > 0 ? Math.floor(Number(spec.ratePerMinute)) : DEFAULT_ROUTER_RATE_PER_MINUTE
  const ruleCapacity =
    Number.isFinite(Number(spec.ruleCapacity)) && Number(spec.ruleCapacity) > 0 ? Math.floor(Number(spec.ruleCapacity)) : DEFAULT_ROUTER_RULE_CAPACITY
  const excludedPrefixes = Array.isArray(spec.excludedPrefixes)
    ? spec.excludedPrefixes.filter((prefix) => typeof prefix === 'string' && prefix.length > 0)
    : DEFAULT_ROUTER_EXCLUDED_PREFIXES.slice()
  const normalized = normalizeRules(spec.rules)
  const rules = normalized.rules
  const errors = normalized.errors.slice()
  const logger = /** @type {any} */ (spec.logger ?? null)
  const metrics = {
    events: 0,
    matched: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
    wouldCreate: 0,
    errors: 0,
    excluded: 0,
  }
  const recent = []
  const createdPerRule = new Map()
  const createdTimestamps = []
  let unsubscribe = null
  let attached = false

  function record(entry) {
    recent.push({ at: now(), ...entry })
    if (recent.length > 30) recent.shift()
  }

  function pruneRateWindow(at) {
    while (createdTimestamps.length > 0 && createdTimestamps[0] <= at - 60_000) createdTimestamps.shift()
  }

  function eventKey(event, rule) {
    const eventId = typeof event.id === 'string' && event.id.length > 0 ? event.id : ''
    const subject = typeof event.subject === 'string' ? event.subject : ''
    return 'router:' + rule.id + ':' + (eventId.length > 0 ? eventId : eventTypeOf(event) + ':' + subject)
  }

  function payloadFor(rule, event) {
    if (rule.task.build !== null) {
      try {
        const built = rule.task.build(event)
        return isPlainObject(built) ? built : null
      } catch (error) {
        errors.push({ ruleId: rule.id, message: error instanceof Error ? error.message : String(error) })
        metrics.errors += 1
        return null
      }
    }
    return rule.task.payload === null ? {} : { ...rule.task.payload }
  }

  function handleEvent(event) {
    try {
      metrics.events += 1
      if (!isPlainObject(event)) {
        metrics.errors += 1
        record({ action: 'error', reason: EVENT_TASK_ROUTER_CODES.invalidEvent })
        return
      }
      const type = eventTypeOf(event)
      if (type.length === 0) {
        metrics.errors += 1
        record({ action: 'error', reason: 'missing-event-type' })
        return
      }
      if (excludedPrefixes.some((prefix) => type.startsWith(prefix))) {
        metrics.excluded += 1
        record({ action: 'excluded', eventType: type, reason: 'excluded-prefix' })
        return
      }
      if (board === null || typeof board.create !== 'function') {
        metrics.errors += 1
        record({ action: 'error', eventType: type, reason: 'board-unavailable' })
        return
      }
      for (const rule of rules) {
        if (rule.enabled !== true) continue
        if (rule.match.activity.length > 0 && event.activity !== rule.match.activity) continue
        if (!eventMatchesType(type, rule.match.type)) continue
        if (!eventMatchesTopics(event, rule.match.topics)) continue
        if (rule.match.payloadOk !== null) {
          try {
            if (rule.match.payloadOk(event) !== true) continue
          } catch (error) {
            metrics.errors += 1
            errors.push({ ruleId: rule.id, message: error instanceof Error ? error.message : String(error) })
            continue
          }
        }
        metrics.matched += 1
        const at = now()
        pruneRateWindow(at)
        if (createdTimestamps.length >= ratePerMinute) {
          metrics.skipped += 1
          record({ action: 'skipped', ruleId: rule.id, eventType: type, reason: 'rate-limited' })
          continue
        }
        const ruleCreated = createdPerRule.get(rule.id) ?? 0
        if (ruleCreated >= ruleCapacity) {
          metrics.skipped += 1
          record({ action: 'skipped', ruleId: rule.id, eventType: type, reason: 'rule-capacity' })
          continue
        }
        const payload = payloadFor(rule, event)
        if (payload === null) {
          record({ action: 'error', ruleId: rule.id, eventType: type, reason: 'payload-build-failed' })
          continue
        }
        const key = eventKey(event, rule)
        if (dryRun) {
          metrics.wouldCreate += 1
          record({ action: 'would-create', ruleId: rule.id, eventType: type, key, activity: rule.task.activity, kind: rule.task.kind })
          continue
        }
        let created = null
        try {
          created = board.create({
            activity: rule.task.activity,
            kind: rule.task.kind,
            priority: rule.task.priority,
            payload,
            key,
          })
        } catch (error) {
          metrics.errors += 1
          errors.push({ ruleId: rule.id, message: error instanceof Error ? error.message : String(error) })
          record({ action: 'error', ruleId: rule.id, eventType: type, reason: 'create-failed' })
          continue
        }
        if (created === null || created === undefined || created.ok !== true) {
          metrics.errors += 1
          record({ action: 'error', ruleId: rule.id, eventType: type, reason: created && created.code ? created.code : 'create-failed' })
          continue
        }
        if (created.duplicate === true) {
          metrics.duplicates += 1
          record({ action: 'duplicate', ruleId: rule.id, eventType: type, key })
          continue
        }
        if (created.task !== null && created.task !== undefined && created.task.status !== 'queued' && typeof board.waiting === 'function') {
          try {
            board.waiting(created.task.id)
          } catch (error) {
            void error
          }
        }
        createdTimestamps.push(at)
        createdPerRule.set(rule.id, ruleCreated + 1)
        metrics.created += 1
        record({ action: 'created', ruleId: rule.id, eventType: type, key, taskId: created.task && created.task.id ? created.task.id : null })
      }
    } catch (error) {
      metrics.errors += 1
      try {
        logger?.warn?.(`[dsh-little-whale] event router 失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (warnError) {
        void warnError
      }
    }
  }

  function attach() {
    if (attached) return { ok: true, attached: true }
    if (eventBus === null || typeof eventBus.subscribe !== 'function') {
      return { ok: false, code: 'EVENT_TASK_ROUTER_UNAVAILABLE', message: 'EventBus 未接入' }
    }
    try {
      unsubscribe = eventBus.subscribe('*', (event) => handleEvent(event))
      attached = true
      return { ok: true, attached: true, rules: rules.length }
    } catch (error) {
      return { ok: false, code: 'EVENT_TASK_ROUTER_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) }
    }
  }

  function detach() {
    if (typeof unsubscribe === 'function') {
      try {
        unsubscribe()
      } catch (error) {
        void error
      }
    }
    unsubscribe = null
    attached = false
  }

  function snapshot() {
    return {
      ok: true,
      version: EVENT_TASK_ROUTER_VERSION,
      attached,
      dryRun,
      rules: rules.map((rule) => ({ id: rule.id, enabled: rule.enabled, match: { activity: rule.match.activity, type: rule.match.type, topics: rule.match.topics.slice() }, task: { activity: rule.task.activity, kind: rule.task.kind, priority: rule.task.priority } })),
      metrics: { ...metrics },
      recent: recent.slice(),
      errors: errors.slice(0, 20),
      ratePerMinute,
      ruleCapacity,
      excludedPrefixes: excludedPrefixes.slice(),
      now: now(),
    }
  }

  const router = { version: EVENT_TASK_ROUTER_VERSION, attach, detach, handleEvent, snapshot, rules, metrics, dryRun }
  if (spec.attach === true) attach()
  return router
}
