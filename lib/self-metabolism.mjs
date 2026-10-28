// lib/self-metabolism.mjs —— 硅基代谢层（v2.22，P1）。
//
// 不是假“饥饿值”，而是把真实消耗接进行动：每次模型调用都会消耗她的一点
// 注意力/算力；能量随时间恢复；能量低时高消耗活动会被系统挡住，只允许
// 低消耗/休息。数值不展示给她，prompt 只给定性描述。
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { resolveSettingsPath } from './settings-store.mjs'

export const SELF_METABOLISM_VERSION = 1
export const SELF_METABOLISM_FULL_RECOVERY_MS = 24 * 60 * 60 * 1000
export const SELF_METABOLISM_CALL_COST = 0.0015
export const SELF_METABOLISM_LOW = 0.25
export const SELF_METABOLISM_EXHAUSTED = 0.08
// 即使前一天耗尽，睡一觉后也会恢复到一个可活动的下限；避免连续多天 0 能量。
export const SELF_METABOLISM_DAY_FLOOR = 0.55

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shanghaiDay(ts) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}

export function resolveMetabolismPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'metabolism.json')
}

export function createMetabolism(options = {}) {
  const file = path.resolve(options.file ?? resolveMetabolismPath(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const fullRecoveryMs =
    Number.isFinite(options.fullRecoveryMs) && options.fullRecoveryMs > 0
      ? options.fullRecoveryMs
      : SELF_METABOLISM_FULL_RECOVERY_MS
  const callCost = Number.isFinite(options.callCost) && options.callCost >= 0 ? options.callCost : SELF_METABOLISM_CALL_COST
  const getSleeping = typeof options.getSleeping === 'function' ? options.getSleeping : () => false
  const state = load()
  let lastTickAt = now()

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function load() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!isPlainObject(parsed)) throw new Error('bad')
      return {
        energy: typeof parsed.energy === 'number' && Number.isFinite(parsed.energy) ? Math.max(0, Math.min(1, parsed.energy)) : 1,
        day: typeof parsed.day === 'string' ? parsed.day : shanghaiDay(now()),
        calls: Number.isFinite(parsed.calls) ? Math.max(0, Math.floor(parsed.calls)) : 0,
        updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : now(),
      }
    } catch {
      return { energy: 1, day: shanghaiDay(now()), calls: 0, updatedAt: now() }
    }
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ok: true, v: SELF_METABOLISM_VERSION, ...state })
      return true
    } catch (error) {
      warn(`代谢状态写入失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function tick() {
    const at = now()
    const elapsed = Math.max(0, at - lastTickAt)
    lastTickAt = at
    const today = shanghaiDay(at)
    if (state.day !== today) {
      state.day = today
      state.calls = 0
      state.energy = Math.max(state.energy, SELF_METABOLISM_DAY_FLOOR)
    }
    const sleeping = getSleeping() === true
    const recoveryRate = sleeping ? (1 / fullRecoveryMs) * 2.2 : 1 / fullRecoveryMs
    state.energy = Math.max(0, Math.min(1, state.energy + elapsed * recoveryRate))
    state.updatedAt = at
    return state.energy
  }

  /** 真实模型调用消耗；由 model-budget 的 onConsume 调用。 */
  function recordCall(role, count = 1) {
    tick()
    const cost = callCost * (Number.isFinite(count) ? Math.max(1, count) : 1)
    state.calls += 1
    state.energy = Math.max(0, state.energy - cost)
    persist()
    return state.energy
  }

  /** 手动消耗（作品/长活动等额外开销）。 */
  function spend(amount) {
    tick()
    const cost = Number.isFinite(amount) ? Math.max(0, amount) : 0
    state.energy = Math.max(0, state.energy - cost)
    persist()
    return state.energy
  }

  function band() {
    tick()
    if (state.energy <= SELF_METABOLISM_EXHAUSTED) return 'exhausted'
    if (state.energy <= SELF_METABOLISM_LOW) return 'low'
    if (state.energy <= 0.6) return 'ok'
    return 'full'
  }

  function canAfford(kind) {
    const current = band()
    if (current === 'exhausted') return kind === 'rest' || kind === 'drink' || kind === 'eat'
    if (current === 'low') return kind !== 'learn' && kind !== 'wander'
    return true
  }

  function describe() {
    const current = band()
    if (current === 'exhausted') return '你今天已经没什么力气了，只适合喝口水、靠一会儿、睡觉；不要再安排费神的事。'
    if (current === 'low') return '你今天用了不少力气，脑子有点钝；可以慢慢做点轻的，想给自己留点小东西也可以，别再硬塞新的学习/远行。'
    if (current === 'ok') return '你今天还有一些力气，但不算充裕。'
    return ''
  }

  return { file, recordCall, spend, tick, band, canAfford, describe, snapshot: () => ({ ...state, band: band() }) }
}
