// lib/domain/host/cost-guard.mjs —— 成本治理：按 role/activity 的窗口限流（Gate A6）。
//
// 背景：设置 `modelTokenLimit` 默认 0（不封顶）后，单次成本可控但**调用频率/总量**仍可能失控。
// 本模块是纯逻辑的“调用侧”限流器，与既有 model-budget 分工：
//   · model-budget（Gate A1）：按上海本地日统计 role/总调用数，超预算拒绝；
//   · cost-guard（本模块）：按 role/activity 的**滑动分钟窗口 + 日窗口**限流，超限返回明确 reason；
//   · modelTokenLimit：单次生成的 token 上限（模型侧，见 docs/cost-policy.md）。
// 三者互不重复计数：cost-guard 只维护自己的窗口计数，不读写 model-budget 的计数/文件。
//
// 默认策略：**不设硬上限**（保持“默认不封顶”），只给软告警阈值（分钟/日），
// 用户可用 `DSH_POETRY_COST_GUARD=off`（或未来设置页开关）关闭；未来 Sprint 再接 UI。
//
// 纯逻辑：不读盘、不联网、无定时器；时间通过 now() 注入，事件只走回调。

/** 支持的窗口。 */
export const COST_WINDOWS = Object.freeze(['minute', 'day'])
/** 支持的限流维度。 */
export const COST_SCOPES = Object.freeze(['total', 'role', 'activity'])
/** 硬拒绝码（调用方据此决定静默跳过/告警，不靠字符串匹配）。 */
export const COST_REJECT_CODE = 'COST_RATE_LIMITED'
/** 软告警码（不拒绝调用）。 */
export const COST_SOFT_ALERT_CODE = 'COST_SOFT_ALERT'
/** 参数错误码。 */
export const COST_INVALID_ARGUMENT = 'COST_INVALID_ARGUMENT'

/** 默认策略：硬上限全 0（不限制），软告警给出建议阈值。 */
export const DEFAULT_COST_POLICY = Object.freeze({
  enabled: true,
  tokenLimit: 0,
  limits: Object.freeze({
    total: Object.freeze({ minute: 0, day: 0 }),
    roles: Object.freeze({}),
    activities: Object.freeze({}),
  }),
  softAlerts: Object.freeze({
    total: Object.freeze({ minute: 20, day: 600 }),
    roles: Object.freeze({
      mood: Object.freeze({ minute: 0, day: 100 }),
      selfTalk: Object.freeze({ minute: 0, day: 120 }),
      growth: Object.freeze({ minute: 0, day: 80 }),
      voice: Object.freeze({ minute: 0, day: 60 }),
    }),
    activities: Object.freeze({}),
  }),
  alertCooldownMs: Object.freeze({ minute: 60 * 1000, day: 60 * 60 * 1000 }),
})

/** 上海时区偏移（与 model-budget 的本地日口径一致）。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCount(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

function shanghaiDayKey(ts) {
  return new Date(Number(ts) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

function msUntilNextDay(ts) {
  const shifted = Number(ts) + SHANGHAI_OFFSET_MS
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS
  return Math.max(0, dayStart + DAY_MS - shifted)
}

function snakeToCamel(name) {
  return String(name)
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_match, char) => char.toUpperCase())
}

function envNumber(env, key) {
  if (env === null || env === undefined || typeof env !== 'object' || !Object.hasOwn(env, key)) return null
  const raw = env[key]
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

function cloneWindowTable(source) {
  const out = {}
  if (!isPlainObject(source)) return out
  for (const [name, entry] of Object.entries(source)) {
    if (!isPlainObject(entry)) continue
    out[name] = { minute: readCount(entry.minute, 0), day: readCount(entry.day, 0) }
  }
  return out
}

function clonePolicy(policy) {
  return {
    enabled: policy.enabled !== false,
    tokenLimit: readCount(policy.tokenLimit, 0),
    limits: {
      total: {
        minute: readCount(policy.limits?.total?.minute, 0),
        day: readCount(policy.limits?.total?.day, 0),
      },
      roles: cloneWindowTable(policy.limits?.roles),
      activities: cloneWindowTable(policy.limits?.activities),
    },
    softAlerts: {
      total: {
        minute: readCount(policy.softAlerts?.total?.minute, 0),
        day: readCount(policy.softAlerts?.total?.day, 0),
      },
      roles: cloneWindowTable(policy.softAlerts?.roles),
      activities: cloneWindowTable(policy.softAlerts?.activities),
    },
    alertCooldownMs: {
      minute: readCount(policy.alertCooldownMs?.minute, DEFAULT_COST_POLICY.alertCooldownMs.minute),
      day: readCount(policy.alertCooldownMs?.day, DEFAULT_COST_POLICY.alertCooldownMs.day),
    },
  }
}

function mergeWindowTable(target, source) {
  if (!isPlainObject(source)) return
  for (const [name, entry] of Object.entries(source)) {
    if (!isPlainObject(entry)) continue
    target[name] = {
      minute: readCount(entry.minute, target[name]?.minute ?? 0),
      day: readCount(entry.day, target[name]?.day ?? 0),
    }
  }
}

/**
 * 解析成本策略。优先级：overrides（未来设置页/UI）> 环境变量 > 默认值。
 *
 * 环境变量：
 *   DSH_POETRY_COST_GUARD=off|0|false        关闭（只记录不拒绝）
 *   DSH_POETRY_COST_MINUTE_TOTAL / _DAY_TOTAL  总维度硬上限
 *   DSH_POETRY_COST_ROLE_<ROLE>_MINUTE|_DAY   role 维度硬上限（ROLE 用大写蛇形，如 SELF_TALK）
 *   DSH_POETRY_COST_ACTIVITY_<NAME>_MINUTE|_DAY  activity 维度硬上限
 *   DSH_POETRY_COST_SOFT_MINUTE_TOTAL / _SOFT_DAY_TOTAL  软告警阈值（总维度）
 * @param {{env?: object, settings?: object, overrides?: object}} [options]
 */
export function resolveCostPolicy(options = {}) {
  const env = isPlainObject(options.env) ? options.env : {}
  const settings = isPlainObject(options.settings) ? options.settings : {}
  const overrides = isPlainObject(options.overrides) ? options.overrides : {}
  const policy = clonePolicy(DEFAULT_COST_POLICY)

  // 1) 单次 token 上限（设置项已有；0 = 不封顶，仅记录在策略里供 UI/文档展示）。
  if (Object.hasOwn(settings, 'modelTokenLimit')) {
    policy.tokenLimit = Math.min(200_000, readCount(settings.modelTokenLimit, 0))
  }

  // 2) 环境变量：开关与总维度。
  const guardFlag = String(env.DSH_POETRY_COST_GUARD ?? '').trim().toLowerCase()
  if (guardFlag === 'off' || guardFlag === '0' || guardFlag === 'false') policy.enabled = false
  const minuteTotal = envNumber(env, 'DSH_POETRY_COST_MINUTE_TOTAL')
  if (minuteTotal !== null) policy.limits.total.minute = minuteTotal
  const dayTotal = envNumber(env, 'DSH_POETRY_COST_DAY_TOTAL')
  if (dayTotal !== null) policy.limits.total.day = dayTotal
  const softMinuteTotal = envNumber(env, 'DSH_POETRY_COST_SOFT_MINUTE_TOTAL')
  if (softMinuteTotal !== null) policy.softAlerts.total.minute = softMinuteTotal
  const softDayTotal = envNumber(env, 'DSH_POETRY_COST_SOFT_DAY_TOTAL')
  if (softDayTotal !== null) policy.softAlerts.total.day = softDayTotal

  // 3) 环境变量：role/activity 维度（从 key 反推名字）。
  for (const [key, raw] of Object.entries(env)) {
    const roleMatched = /^DSH_POETRY_COST_ROLE_([A-Z0-9_]+)_(MINUTE|DAY)$/.exec(key)
    if (roleMatched !== null) {
      const value = envNumber(env, key)
      if (value === null) continue
      const role = snakeToCamel(roleMatched[1])
      policy.limits.roles[role] = policy.limits.roles[role] ?? { minute: 0, day: 0 }
      policy.limits.roles[role][roleMatched[2].toLowerCase()] = value
      continue
    }
    const activityMatched = /^DSH_POETRY_COST_ACTIVITY_([A-Z0-9_]+)_(MINUTE|DAY)$/.exec(key)
    if (activityMatched !== null) {
      const value = envNumber(env, key)
      if (value === null) continue
      const activity = snakeToCamel(activityMatched[1])
      policy.limits.activities[activity] = policy.limits.activities[activity] ?? { minute: 0, day: 0 }
      policy.limits.activities[activity][activityMatched[2].toLowerCase()] = value
    }
  }

  // 4) overrides（未来设置页）：整体覆盖 enabled/tokenLimit/limits/softAlerts/cooldown。
  if (typeof overrides.enabled === 'boolean') policy.enabled = overrides.enabled
  if (Object.hasOwn(overrides, 'tokenLimit')) policy.tokenLimit = Math.min(200_000, readCount(overrides.tokenLimit, policy.tokenLimit))
  if (isPlainObject(overrides.limits)) {
    if (isPlainObject(overrides.limits.total)) {
      policy.limits.total.minute = readCount(overrides.limits.total.minute, policy.limits.total.minute)
      policy.limits.total.day = readCount(overrides.limits.total.day, policy.limits.total.day)
    }
    mergeWindowTable(policy.limits.roles, overrides.limits.roles)
    mergeWindowTable(policy.limits.activities, overrides.limits.activities)
  }
  if (isPlainObject(overrides.softAlerts)) {
    if (isPlainObject(overrides.softAlerts.total)) {
      policy.softAlerts.total.minute = readCount(overrides.softAlerts.total.minute, policy.softAlerts.total.minute)
      policy.softAlerts.total.day = readCount(overrides.softAlerts.total.day, policy.softAlerts.total.day)
    }
    mergeWindowTable(policy.softAlerts.roles, overrides.softAlerts.roles)
    mergeWindowTable(policy.softAlerts.activities, overrides.softAlerts.activities)
  }
  if (isPlainObject(overrides.alertCooldownMs)) {
    policy.alertCooldownMs.minute = readCount(overrides.alertCooldownMs.minute, policy.alertCooldownMs.minute)
    policy.alertCooldownMs.day = readCount(overrides.alertCooldownMs.day, policy.alertCooldownMs.day)
  }
  return policy
}

function windowTable(policy, scope) {
  if (scope === 'role') return policy.limits.roles
  if (scope === 'activity') return policy.limits.activities
  return null
}

function softTable(policy, scope) {
  if (scope === 'role') return policy.softAlerts.roles
  if (scope === 'activity') return policy.softAlerts.activities
  return null
}

function limitOf(policy, scope, name, window) {
  if (scope === 'total') return readCount(policy.limits.total[window], 0)
  const table = windowTable(policy, scope)
  const entry = table !== null && name !== null ? table[name] : null
  return entry === undefined || entry === null ? 0 : readCount(entry[window], 0)
}

function softOf(policy, scope, name, window) {
  if (scope === 'total') return readCount(policy.softAlerts.total[window], 0)
  const table = softTable(policy, scope)
  const entry = table !== null && name !== null ? table[name] : null
  return entry === undefined || entry === null ? 0 : readCount(entry[window], 0)
}

function scopeLabel(scope, name) {
  if (scope === 'total') return '模型调用总量'
  if (scope === 'role') return `role「${name}」`
  return `activity「${name}」`
}

function normalizeInput(input) {
  const spec = isPlainObject(input) ? input : {}
  const role = typeof spec.role === 'string' && spec.role.trim().length > 0 ? spec.role.trim() : ''
  const activity = typeof spec.activity === 'string' && spec.activity.trim().length > 0 ? spec.activity.trim() : ''
  return { role, activity }
}

/**
 * 创建成本闸门（纯逻辑）。
 * @param {{
 *   now?: () => number,
 *   env?: object,
 *   settings?: object,
 *   overrides?: object,
 *   policy?: object,
 *   enabled?: boolean,
 *   logger?: {warn?: Function}|null,
 *   onAlert?: (alert: object) => void,
 * }} [options]
 */
export function createCostGuard(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const policy =
    isPlainObject(options.policy)
      ? clonePolicy({ ...DEFAULT_COST_POLICY, ...options.policy })
      : resolveCostPolicy({ env: options.env ?? process.env, settings: options.settings, overrides: options.overrides })
  const enabled = options.enabled === false ? false : policy.enabled !== false
  const logger = options.logger ?? null
  const onAlert = typeof options.onAlert === 'function' ? options.onAlert : null
  /** key -> number[]（滑动分钟窗口的调用时间戳）。 */
  const minuteBuckets = new Map()
  let dayKey = shanghaiDayKey(now())
  /** key -> 当日调用次数。 */
  const dayCounts = new Map()
  const rejected = { minute: 0, day: 0 }
  const rejectedByScope = { total: 0, role: 0, activity: 0 }
  const lastAlertAt = new Map()
  const recentAlerts = []

  function rollDay(at) {
    const key = shanghaiDayKey(at)
    if (key === dayKey) return
    dayKey = key
    dayCounts.clear()
    lastAlertAt.clear()
  }

  function pruneMinute(key, at) {
    const list = minuteBuckets.get(key)
    if (list === undefined) return []
    const cutoff = at - MINUTE_MS
    let index = 0
    while (index < list.length && list[index] <= cutoff) index += 1
    if (index > 0) list.splice(0, index)
    if (list.length === 0) minuteBuckets.delete(key)
    return list
  }

  function minuteUsed(key, at) {
    return pruneMinute(key, at).length
  }

  function dayUsed(key) {
    return dayCounts.get(key) ?? 0
  }

  function candidatesFor(input) {
    const list = [{ scope: 'total', name: null, key: 'total' }]
    if (input.role.length > 0) list.push({ scope: 'role', name: input.role, key: 'role:' + input.role })
    if (input.activity.length > 0) list.push({ scope: 'activity', name: input.activity, key: 'activity:' + input.activity })
    return list
  }

  function evaluate(input, at) {
    for (const candidate of candidatesFor(input)) {
      for (const window of COST_WINDOWS) {
        const limit = limitOf(policy, candidate.scope, candidate.name, window)
        if (limit <= 0) continue
        const used = window === 'minute' ? minuteUsed(candidate.key, at) : dayUsed(candidate.key)
        if (used < limit) continue
        const retryAfterMs =
          window === 'minute'
            ? Math.max(0, (minuteBuckets.get(candidate.key)?.[0] ?? at) + MINUTE_MS - at)
            : msUntilNextDay(at)
        return {
          ok: false,
          code: COST_REJECT_CODE,
          reason: 'rate-limit',
          scope: candidate.scope,
          name: candidate.name ?? '',
          window,
          limit,
          used,
          retryAfterMs,
          message: `${scopeLabel(candidate.scope, candidate.name)}每${window === 'minute' ? '分钟' : '日'}调用上限 ${limit} 已用完（${used}/${limit}）`,
        }
      }
    }
    return { ok: true }
  }

  function record(input, at) {
    for (const candidate of candidatesFor(input)) {
      const list = minuteBuckets.get(candidate.key) ?? []
      list.push(at)
      minuteBuckets.set(candidate.key, list)
      dayCounts.set(candidate.key, dayUsed(candidate.key) + 1)
    }
  }

  function collectSoftAlerts(input, at) {
    const alerts = []
    for (const candidate of candidatesFor(input)) {
      for (const window of COST_WINDOWS) {
        const threshold = softOf(policy, candidate.scope, candidate.name, window)
        if (threshold <= 0) continue
        const used = window === 'minute' ? minuteUsed(candidate.key, at) : dayUsed(candidate.key)
        if (used < threshold) continue
        const cooldownKey = candidate.key + ':' + window
        const previous = lastAlertAt.get(cooldownKey) ?? 0
        if (previous > 0 && at - previous < policy.alertCooldownMs[window]) continue
        lastAlertAt.set(cooldownKey, at)
        const alert = {
          code: COST_SOFT_ALERT_CODE,
          level: 'warn',
          scope: candidate.scope,
          name: candidate.name ?? '',
          window,
          used,
          threshold,
          at,
          message: `${scopeLabel(candidate.scope, candidate.name)}每${window === 'minute' ? '分钟' : '日'}调用达到软告警阈值（${used}/${threshold}）`,
        }
        alerts.push(alert)
        recentAlerts.push(alert)
        if (recentAlerts.length > 20) recentAlerts.shift()
        if (onAlert !== null) {
          try {
            onAlert(alert)
          } catch (error) {
            void error
          }
        }
      }
    }
    return alerts
  }

  function usageOf(input, at) {
    const usage = {}
    for (const candidate of candidatesFor(input)) {
      usage[candidate.key] = {
        minute: minuteUsed(candidate.key, at),
        day: dayUsed(candidate.key),
      }
    }
    return usage
  }

  function warnReject(verdict, at) {
    if (logger === null || typeof logger.warn !== 'function') return
    const cooldownKey = 'reject:' + verdict.scope + ':' + verdict.name + ':' + verdict.window
    const previous = lastAlertAt.get(cooldownKey) ?? 0
    if (previous > 0 && at - previous < MINUTE_MS) return
    lastAlertAt.set(cooldownKey, at)
    try {
      logger.warn(`[dsh-little-whale] 成本限流：${verdict.message}（retryAfter≈${Math.round(verdict.retryAfterMs / 1000)}s）`)
    } catch (error) {
      void error
    }
  }

  /**
   * 申请一次调用额度：超限返回 {ok:false, code:'COST_RATE_LIMITED', reason, scope, window, limit, used, retryAfterMs}；
   * 允许时记录计数并返回软告警。
   * @param {{role?: string, activity?: string}} [input]
   */
  function acquire(input) {
    if (!enabled) return { ok: true, disabled: true, softAlerts: [] }
    const spec = normalizeInput(input)
    const at = now()
    rollDay(at)
    const verdict = evaluate(spec, at)
    if (!verdict.ok) {
      rejected[verdict.window] += 1
      rejectedByScope[verdict.scope] = (rejectedByScope[verdict.scope] ?? 0) + 1
      warnReject(verdict, at)
      return verdict
    }
    record(spec, at)
    return { ok: true, softAlerts: collectSoftAlerts(spec, at), usage: usageOf(spec, at) }
  }

  /** 只检查不计数（用于预检/展示）。 */
  function peek(input) {
    if (!enabled) return { ok: true, disabled: true }
    const at = now()
    rollDay(at)
    return evaluate(normalizeInput(input), at)
  }

  /** 只计数不检查（外部已完成限额判定时使用；仍保持与 acquire 相同的计数口径）。 */
  function recordOnly(input) {
    if (!enabled) return { ok: true, disabled: true }
    const spec = normalizeInput(input)
    const at = now()
    rollDay(at)
    record(spec, at)
    return { ok: true, softAlerts: collectSoftAlerts(spec, at), usage: usageOf(spec, at) }
  }

  /** 观测快照（供 health/CLI；不含调用内容）。 */
  function snapshot() {
    const at = now()
    rollDay(at)
    const roles = {}
    const activities = {}
    const allKeys = new Set([...minuteBuckets.keys(), ...dayCounts.keys()])
    for (const key of allKeys) {
      const usage = { minute: minuteUsed(key, at), day: dayUsed(key) }
      if (key.startsWith('role:')) roles[key.slice(5)] = usage
      else if (key.startsWith('activity:')) activities[key.slice(9)] = usage
    }
    return {
      enabled,
      now: at,
      day: dayKey,
      tokenLimit: policy.tokenLimit,
      limits: policy.limits,
      softAlerts: policy.softAlerts,
      usage: {
        total: { minute: minuteUsed('total', at), day: dayUsed('total') },
        roles,
        activities,
      },
      rejected: { ...rejected },
      rejectedByScope: { ...rejectedByScope },
      recentAlerts: recentAlerts.slice(-10),
    }
  }

  /** 清空窗口计数（测试/手动重置；不清策略）。 */
  function reset() {
    minuteBuckets.clear()
    dayCounts.clear()
    lastAlertAt.clear()
    recentAlerts.length = 0
    rejected.minute = 0
    rejected.day = 0
    rejectedByScope.total = 0
    rejectedByScope.role = 0
    rejectedByScope.activity = 0
    dayKey = shanghaiDayKey(now())
  }

  return { acquire, peek, record: recordOnly, snapshot, reset, policy, enabled }
}

/** 导出给文档/测试用的默认建议值（软告警）。 */
export function describeCostPolicy(policy) {
  const resolved = isPlainObject(policy) ? policy : DEFAULT_COST_POLICY
  const lines = []
  lines.push(`成本闸门：${resolved.enabled === false ? '关闭' : '开启'}；单次 token 上限：${readCount(resolved.tokenLimit, 0) || '不封顶'}`)
  const describeTable = (label, limits, softs) => {
    const names = new Set([...Object.keys(limits ?? {}), ...Object.keys(softs ?? {})])
    for (const name of names) {
      const limit = limits?.[name] ?? { minute: 0, day: 0 }
      const soft = softs?.[name] ?? { minute: 0, day: 0 }
      lines.push(
        `  ${label}「${name}」：硬上限 分钟 ${readCount(limit.minute, 0) || '∞'} / 日 ${readCount(limit.day, 0) || '∞'}；软告警 分钟 ${readCount(soft.minute, 0) || '—'} / 日 ${readCount(soft.day, 0) || '—'}`,
      )
    }
  }
  const totalLimit = resolved.limits?.total ?? { minute: 0, day: 0 }
  const totalSoft = resolved.softAlerts?.total ?? { minute: 0, day: 0 }
  lines.push(
    `  总量：硬上限 分钟 ${readCount(totalLimit.minute, 0) || '∞'} / 日 ${readCount(totalLimit.day, 0) || '∞'}；软告警 分钟 ${readCount(totalSoft.minute, 0) || '—'} / 日 ${readCount(totalSoft.day, 0) || '—'}`,
  )
  describeTable('role', resolved.limits?.roles, resolved.softAlerts?.roles)
  describeTable('activity', resolved.limits?.activities, resolved.softAlerts?.activities)
  return lines.join('\n')
}
