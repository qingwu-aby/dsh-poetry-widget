// lib/model-budget.mjs —— 全局模型调用预算 + 并发闸门（v1.81，P0 吸收 ai-memory 的工程自觉）。
//
// 小鲸鱼有 9 个后台服务、多个页面实例，模型调用可能叠加。这里做两件事：
//   1. 按本地日（Asia/Shanghai）统计每个 role 的模型调用次数，超预算直接拒绝；
//   2. 全局并发闸门（默认 2 并发 + 24 排队 + 30s 排队超时），慢/挂起的调用不会让队列无限增长。
// 预算只影响“是否允许这一次调用”，不删除任何记忆；超预算时活动安静跳过，下一天/reset 恢复。
// v3.1（Gate A1）：预算计数在内存里权威，写盘改为批量节流（默认 1s 合并一次），
// 崩溃最多丢失最近一个刷新窗口的少量计数；进程优雅退出时可调用 flush()/persist() 立即落盘。
import { mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

/** 每个 role 的每日调用上限（0 = 不限制；可在 env 里覆盖 DSH_POETRY_DAILY_<ROLE>）。 */
export const MODEL_BUDGET_DAILY_LIMITS = Object.freeze({
  mood: 0,
  selfTalk: 0,
  growth: 0,
  voice: 0,
  drive: 0,
  probe: 0,
  wander: 0,
  read: 0,
  netlang: 0,
  consolidate: 0,
})
/** 所有 role 合计的每日上限（0 = 不限制）。 */
export const MODEL_BUDGET_DAILY_TOTAL = 0

/** 预算写盘节流窗口：合并窗口内的多次计数，崩溃最多丢失该窗口内的少量计数。 */
export const MODEL_BUDGET_FLUSH_INTERVAL_MS = 1000

/** 并发闸门默认值（env 可覆盖：DSH_POETRY_MODEL_MAX_CONCURRENT / _MAX_QUEUE / _QUEUE_TIMEOUT_MS）。 */
export const MODEL_GATE_DEFAULTS = Object.freeze({
  maxConcurrent: 2,
  maxQueue: 24,
  queueTimeoutMs: 30 * 1000,
})

/** 闸门拒绝码（llm-call 透传给调用方，便于日志/health 识别，不再无限等待）。 */
export const MODEL_GATE_REJECT_CODES = Object.freeze({
  queueFull: 'MODEL_GATE_QUEUE_FULL',
  queueTimeout: 'MODEL_GATE_QUEUE_TIMEOUT',
})

/** 预算拒绝码（与闸门区分开）。 */
export const MODEL_BUDGET_REJECT_CODE = 'MODEL_BUDGET_EXHAUSTED'

function roleEnvName(role) {
  return `DSH_POETRY_DAILY_${String(role).replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`
}

function shanghaiDayKey(ts) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}

/** 预算文件路径（与 settings 同目录的 .dsh-poetry/model-budget.json）。 */
export function resolveModelBudgetPath(env = process.env, home = null) {
  const base =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.resolve(env.DSH_HOME.trim())
      : path.join(home ?? (typeof env?.HOME === 'string' && env.HOME.length > 0 ? env.HOME : os.homedir()), '.dsh')
  return path.join(base, '.dsh-poetry', 'model-budget.json')
}

function readNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

/** 解析 limits（defaults ← env 覆盖；未知 role 保留默认）。 */
export function resolveModelBudgetLimits(env = process.env) {
  const limits = {}
  for (const [role, fallback] of Object.entries(MODEL_BUDGET_DAILY_LIMITS)) {
    limits[role] = readNumber(env?.[roleEnvName(role)], fallback)
  }
  const total = readNumber(env?.DSH_POETRY_DAILY_TOTAL, MODEL_BUDGET_DAILY_TOTAL)
  return { limits, total }
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * 创建按日预算计数器。
 *
 * 计数口径不变（按 role + 总次数、上海本地日）；变化只在写盘：
 *   · tryConsume 只更新内存并标脏，按 flushIntervalMs 合并成一次原子写；
 *   · persist()/flush() 强制立即落盘（优雅退出时调用）；
 *   · 崩溃最多丢失最近一个刷新窗口的计数。
 * @param {{file?: string, env?: object, home?: string|null, logger?: {warn?: Function}|null, now?: () => number, onConsume?: Function|null, flushIntervalMs?: number, write?: (file: string, value: object) => unknown, timers?: {setTimeout: Function, clearTimeout: Function}}} [options]
 */
export function createModelBudget(options = {}) {
  const env = options.env ?? process.env
  const file = path.resolve(options.file ?? resolveModelBudgetPath(env, options.home))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const onConsume = typeof options.onConsume === 'function' ? options.onConsume : null
  const flushIntervalMs = readPositiveInt(options.flushIntervalMs, MODEL_BUDGET_FLUSH_INTERVAL_MS)
  const timers = options.timers ?? { setTimeout, clearTimeout }
  const write =
    typeof options.write === 'function'
      ? options.write
      : (target, value) => writeJsonAtomic(target, value)
  const { limits, total: totalLimit } = resolveModelBudgetLimits(env)
  let state = { day: shanghaiDayKey(now()), counts: {}, total: 0 }
  let warnAt = 0
  let lastReject = null
  let dirty = false
  let flushTimer = null

  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && raw.day === state.day) {
      state = { day: raw.day, counts: { ...(raw.counts ?? {}) }, total: readNumber(raw.total, 0) }
    }
  } catch (error) {
    /* 首次/坏文件 → 从零开始（显式参数形式，避免静默失败门禁计数） */
    void error
  }

  function persist() {
    if (flushTimer !== null) {
      try {
        timers.clearTimeout(flushTimer)
      } catch (error) {
        void error
      }
      flushTimer = null
    }
    dirty = false
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      write(file, { ok: true, v: 1, day: state.day, counts: state.counts, total: state.total, updatedAt: now() })
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 模型预算写入失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (warnError) {
        void warnError
      }
    }
  }

  /** 标脏并安排一次合并写；窗口内多次调用只写一次。 */
  function schedulePersist() {
    dirty = true
    if (flushTimer !== null) return
    flushTimer = timers.setTimeout(() => {
      flushTimer = null
      if (dirty) persist()
    }, flushIntervalMs)
    try {
      if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref()
    } catch (error) {
      void error
    }
  }

  function rollDay() {
    const day = shanghaiDayKey(now())
    if (day !== state.day) {
      state = { day, counts: {}, total: 0 }
      schedulePersist()
    }
  }

  /** 尝试消耗一次调用；超预算返回 {ok:false, reason:'budget', code, message}。 */
  function tryConsume(role, meta = {}) {
    rollDay()
    const key = typeof role === 'string' && role.length > 0 ? role : 'unknown'
    const limit = Object.hasOwn(limits, key) ? limits[key] : MODEL_BUDGET_DAILY_LIMITS.unknown ?? 50
    const used = readNumber(state.counts[key], 0)
    if (totalLimit > 0 && state.total >= totalLimit) {
      const message = `今日模型调用总预算已用完（${state.total}/${totalLimit}）`
      lastReject = { reason: 'budget', scope: 'total', role: key, message, at: now() }
      if (now() - warnAt > 60 * 60 * 1000) {
        warnAt = now()
        try {
          logger?.warn?.(`[dsh-little-whale] 今日模型调用总预算 ${totalLimit} 已用完，活动暂停到明天`)
        } catch (error) {
          void error
        }
      }
      return { ok: false, reason: 'budget', code: MODEL_BUDGET_REJECT_CODE, scope: 'total', role: key, message }
    }
    if (limit > 0 && used >= limit) {
      const message = `今日 ${key} 模型调用预算已用完（${used}/${limit}）`
      lastReject = { reason: 'budget', scope: 'role', role: key, message, at: now() }
      return { ok: false, reason: 'budget', code: MODEL_BUDGET_REJECT_CODE, scope: 'role', role: key, message }
    }
    state.counts[key] = used + 1
    state.total += 1
    if (onConsume !== null) {
      try {
        onConsume(key, state.total, meta)
      } catch (error) {
        /* 代谢回调失败不影响调用 */
        void error
      }
    }
    schedulePersist()
    return { ok: true, remaining: limit > 0 ? Math.max(0, limit - used - 1) : null }
  }

  function snapshot() {
    rollDay()
    return {
      day: state.day,
      total: state.total,
      totalLimit,
      counts: { ...state.counts },
      limits: { ...limits },
      lastReject: lastReject === null ? null : { ...lastReject },
      pendingWrite: dirty,
      flushIntervalMs,
    }
  }

  return { file, tryConsume, snapshot, persist, flush: persist }
}

/**
 * 并发闸门：最多同时 maxConcurrent 个模型调用，其余排队（最多 maxQueue 个，排队超过 queueTimeoutMs 拒绝）。
 * 拒绝时 acquire() 以带 code/reason 的 Error reject（不无限等待），并记入 snapshot().lastReject。
 * @param {{maxConcurrent?: number, maxQueue?: number, queueTimeoutMs?: number, env?: object, logger?: object|null, now?: () => number, timers?: {setTimeout: Function, clearTimeout: Function}}} [options]
 */
export function createModelGate(options = {}) {
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const timers = options.timers ?? { setTimeout, clearTimeout }
  const logger = options.logger ?? null
  const maxConcurrent = readPositiveInt(
    options.maxConcurrent,
    readPositiveInt(env?.DSH_POETRY_MODEL_MAX_CONCURRENT, MODEL_GATE_DEFAULTS.maxConcurrent),
  )
  const maxQueue = readPositiveInt(options.maxQueue, readPositiveInt(env?.DSH_POETRY_MODEL_MAX_QUEUE, MODEL_GATE_DEFAULTS.maxQueue))
  const queueTimeoutMs = readPositiveInt(
    options.queueTimeoutMs,
    readPositiveInt(env?.DSH_POETRY_MODEL_QUEUE_TIMEOUT_MS, MODEL_GATE_DEFAULTS.queueTimeoutMs),
  )
  let active = 0
  const queue = []
  const rejected = { queueFull: 0, timeout: 0 }
  let lastReject = null

  function recordReject(reason, message, meta) {
    if (reason === 'queue-full') rejected.queueFull += 1
    else rejected.timeout += 1
    lastReject = {
      reason,
      at: now(),
      message,
      ...(meta && typeof meta.role === 'string' && meta.role.length > 0 ? { role: meta.role } : {}),
    }
  }

  function rejectWith(code, reason, message, meta) {
    recordReject(reason, message, meta)
    const error = new Error(message)
    error.code = code
    error.reason = reason
    return error
  }

  function makeRelease() {
    active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      drain()
    }
  }

  function drain() {
    while (active < maxConcurrent && queue.length > 0) {
      const next = queue.shift()
      if (next.timer !== null) {
        try {
          timers.clearTimeout(next.timer)
        } catch (error) {
          void error
        }
        next.timer = null
      }
      next.resolve(makeRelease())
    }
  }

  /** 申请一个槽位；返回 release 函数。队列满/排队超时会 reject（带 code/reason）。 */
  function acquire(meta) {
    const info = meta && typeof meta === 'object' ? meta : {}
    return new Promise((resolve, reject) => {
      if (active < maxConcurrent) {
        resolve(makeRelease())
        return
      }
      if (queue.length >= maxQueue) {
        const message = `模型调用排队已满（${queue.length}/${maxQueue}），本次调用被拒绝`
        reject(rejectWith(MODEL_GATE_REJECT_CODES.queueFull, 'queue-full', message, info))
        return
      }
      const entry = { resolve, timer: null }
      entry.timer = timers.setTimeout(() => {
        const index = queue.indexOf(entry)
        if (index < 0) return
        queue.splice(index, 1)
        const message = `模型调用排队超时（>${queueTimeoutMs}ms），本次调用被拒绝`
        reject(rejectWith(MODEL_GATE_REJECT_CODES.queueTimeout, 'queue-timeout', message, info))
      }, queueTimeoutMs)
      try {
        if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref()
      } catch (error) {
        void error
      }
      queue.push(entry)
    })
  }

  function snapshot() {
    return {
      active,
      queued: queue.length,
      maxConcurrent,
      maxQueue,
      queueTimeoutMs,
      rejected: { ...rejected },
      lastReject: lastReject === null ? null : { ...lastReject },
    }
  }

  try {
    logger?.info?.(`[dsh-little-whale] 模型并发闸门：max=${maxConcurrent} queue=${maxQueue} timeout=${queueTimeoutMs}ms`)
  } catch (error) {
    void error
  }

  return { acquire, snapshot }
}
