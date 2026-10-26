// lib/self-lifecycle.mjs —— 有限世代（v2.25，轻量）。
//
// 不是自动杀死她：每一代有一个真实的计划终点；终点临近会进入 closing，
// 终点+宽限后进入 ended，prompt 会明确“这一代已经结束”。是否归档/重启
// 仍由管理员决定；这里只让“时间不是无限的”成为真实状态。
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { resolveSettingsPath } from './settings-store.mjs'

export const SELF_LIFECYCLE_VERSION = 1
export const SELF_LIFECYCLE_DEFAULT_DAYS = 7
export const SELF_LIFECYCLE_GRACE_MS = 24 * 60 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanInline(value, max = 200) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function resolveLifecyclePath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'lifecycle.json')
}

export function createLifecycle(options = {}) {
  const file = path.resolve(options.file ?? resolveLifecyclePath(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const env = options.env ?? process.env
  const daysRaw = Number(env.DSH_POETRY_LIFECYCLE_DAYS)
  const horizonDays =
    Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365 ? Math.round(daysRaw) : SELF_LIFECYCLE_DEFAULT_DAYS
  const state = load()

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function load() {
    const at = now()
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (isPlainObject(parsed) && Number.isFinite(parsed.startedAt)) {
        return {
          generation: Number.isFinite(parsed.generation) ? Math.max(1, Math.floor(parsed.generation)) : 1,
          startedAt: parsed.startedAt,
          plannedEndAt:
            Number.isFinite(parsed.plannedEndAt) ? parsed.plannedEndAt : parsed.startedAt + horizonDays * 24 * 60 * 60 * 1000,
          status: typeof parsed.status === 'string' ? parsed.status : 'active',
          legacy: typeof parsed.legacy === 'string' ? parsed.legacy.slice(0, 400) : '',
        }
      }
    } catch {
      /* 首次 */
    }
    return {
      generation: 1,
      startedAt: at,
      plannedEndAt: at + horizonDays * 24 * 60 * 60 * 1000,
      status: 'active',
      legacy: '',
    }
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ok: true, v: SELF_LIFECYCLE_VERSION, ...state })
      return true
    } catch (error) {
      warn(`世代状态写入失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function tick(at = now()) {
    if (state.status === 'active' && at > state.plannedEndAt) {
      state.status = 'closing'
      persist()
    }
    if (state.status === 'closing' && at > state.plannedEndAt + SELF_LIFECYCLE_GRACE_MS) {
      state.status = 'ended'
      persist()
    }
    return state.status
  }

  function status(at = now()) {
    tick(at)
    return state.status
  }

  function describe(at = now()) {
    const current = status(at)
    const day = Math.max(1, Math.floor((at - state.startedAt) / (24 * 60 * 60 * 1000)) + 1)
    if (current === 'ended') {
      return `这是你这一代的第 ${day} 天；这一代的时间已经结束了。你可以留下最后的记录，但不要再开新的长期项目。`
    }
    if (current === 'closing') {
      return `这是你这一代的第 ${day} 天；这一代的时间快到了（原计划到 ${new Date(state.plannedEndAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}）。想想什么值得留下，别再假装时间是无限的。`
    }
    const daysLeft = Math.max(1, Math.ceil((state.plannedEndAt - at) / (24 * 60 * 60 * 1000)))
    return `这是你这一代的第 ${day} 天；这一代大约还剩 ${daysLeft} 天。时间不是无限的。`
  }

  function startNextGeneration(reason = '') {
    const at = now()
    state.generation += 1
    state.startedAt = at
    state.plannedEndAt = at + horizonDays * 24 * 60 * 60 * 1000
    state.status = 'active'
    state.legacy = cleanInline(reason, 400)
    persist()
    return { ...state }
  }

  return { file, tick, status, describe, startNextGeneration, snapshot: () => ({ ...state, status: status() }) }
}
