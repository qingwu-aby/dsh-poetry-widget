// lib/model-budget.mjs —— 全局模型调用预算 + 并发闸门（v1.81，P0 吸收 ai-memory 的工程自觉）。
//
// 小鲸鱼有 9 个后台服务、多个页面实例，模型调用可能叠加。这里做两件事：
//   1. 按本地日（Asia/Shanghai）统计每个 role 的模型调用次数，超预算直接拒绝；
//   2. 全局并发上限（默认 2），避免多个活动同时打模型。
// 预算只影响“是否允许这一次调用”，不删除任何记忆；超预算时活动安静跳过，下一天/reset 恢复。
import { mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

/** 每个 role 的每日调用上限（可在 env 里覆盖：DSH_POETRY_DAILY_<ROLE>，camelCase → SNAKE_CASE）。 */
export const MODEL_BUDGET_DAILY_LIMITS = Object.freeze({
  mood: 200,
  selfTalk: 260,
  growth: 70,
  voice: 6,
  drive: 90,
  probe: 12,
  wander: 12,
  read: 3,
  netlang: 6,
  consolidate: 2,
})
/** 所有 role 合计的每日上限。 */
export const MODEL_BUDGET_DAILY_TOTAL = 600

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

/**
 * 创建按日预算计数器。
 * @param {{file?: string, env?: object, home?: string|null, logger?: {warn?: Function}|null, now?: () => number}} [options]
 */
export function createModelBudget(options = {}) {
  const env = options.env ?? process.env
  const file = path.resolve(options.file ?? resolveModelBudgetPath(env, options.home))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const { limits, total: totalLimit } = resolveModelBudgetLimits(env)
  let state = { day: shanghaiDayKey(now()), counts: {}, total: 0 }
  let warnAt = 0

  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && raw.day === state.day) {
      state = { day: raw.day, counts: { ...(raw.counts ?? {}) }, total: readNumber(raw.total, 0) }
    }
  } catch {
    /* 首次/坏文件 → 从零开始 */
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ok: true, v: 1, day: state.day, counts: state.counts, total: state.total, updatedAt: now() })
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 模型预算写入失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
    }
  }

  function rollDay() {
    const day = shanghaiDayKey(now())
    if (day !== state.day) {
      state = { day, counts: {}, total: 0 }
      persist()
    }
  }

  /** 尝试消耗一次调用；超预算返回 {ok:false, message}。 */
  function tryConsume(role) {
    rollDay()
    const key = typeof role === 'string' && role.length > 0 ? role : 'unknown'
    const limit = Object.hasOwn(limits, key) ? limits[key] : MODEL_BUDGET_DAILY_LIMITS.unknown ?? 50
    const used = readNumber(state.counts[key], 0)
    if (state.total >= totalLimit) {
      if (now() - warnAt > 60 * 60 * 1000) {
        warnAt = now()
        try {
          logger?.warn?.(`[dsh-little-whale] 今日模型调用总预算 ${totalLimit} 已用完，活动暂停到明天`)
        } catch {
          /* ignore */
        }
      }
      return { ok: false, reason: 'budget', message: `今日模型调用总预算已用完（${state.total}/${totalLimit}）` }
    }
    if (used >= limit) {
      return { ok: false, reason: 'budget', message: `今日 ${key} 模型调用预算已用完（${used}/${limit}）` }
    }
    state.counts[key] = used + 1
    state.total += 1
    persist()
    return { ok: true, remaining: Math.max(0, limit - used - 1) }
  }

  function snapshot() {
    rollDay()
    return {
      day: state.day,
      total: state.total,
      totalLimit,
      counts: { ...state.counts },
      limits: { ...limits },
    }
  }

  return { file, tryConsume, snapshot, persist }
}

/** 并发闸门：最多同时 N 个模型调用，其余排队。 */
export function createModelGate(options = {}) {
  const maxConcurrent = Number.isFinite(options.maxConcurrent) && options.maxConcurrent > 0 ? Math.floor(options.maxConcurrent) : 2
  const logger = options.logger ?? null
  let active = 0
  const queue = []

  function acquire() {
    return new Promise((resolve) => {
      const grant = () => {
        active += 1
        let released = false
        resolve(() => {
          if (released) return
          released = true
          active -= 1
          const next = queue.shift()
          if (next !== undefined) next()
        })
      }
      if (active < maxConcurrent) grant()
      else queue.push(grant)
    })
  }

  function snapshot() {
    return { active, queued: queue.length, maxConcurrent }
  }

  try {
    logger?.info?.(`[dsh-little-whale] 模型并发闸门：max=${maxConcurrent}`)
  } catch {
    /* ignore */
  }

  return { acquire, snapshot }
}
