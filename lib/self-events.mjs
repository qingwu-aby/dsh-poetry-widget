// lib/self-events.mjs —— 事件饱和/习惯化（v2.17，P2）。
//
// 用户观察到的核心问题：她没有真实感官反馈，同一事件可以无限重复，
// 行为对事件的“熵”不衰减。这里给事件加一个**兴趣/新鲜度**状态：
// 同一主题重复尝试 → 兴趣递减；到阈值 → 事件饱和，暂时不允许继续；
// 冷却期后或换主题 → 重新开始。
//
// 这不是打分，也不修改她的记忆；只约束“同一件事不能无意识地一直做下去”。
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { resolveSettingsPath } from './settings-store.mjs'

export const SELF_EVENTS_VERSION = 1
export const SELF_EVENTS_MAX_ATTEMPTS = 3
export const SELF_EVENTS_HABITUATION = 0.55
export const SELF_EVENTS_COOLDOWN_MS = 2 * 60 * 60 * 1000
export const SELF_EVENTS_MAX_CLOSED = 50
export const SELF_EVENT_TOPIC_MAX = 30

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanTopic(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > SELF_EVENT_TOPIC_MAX ? chars.slice(0, SELF_EVENT_TOPIC_MAX).join('') : chars.join('')
}

export function resolveEventsPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'events.json')
}

export function createSelfEvents(options = {}) {
  const file = path.resolve(options.file ?? resolveEventsPath(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const maxAttempts =
    Number.isFinite(options.maxAttempts) && options.maxAttempts > 0 ? Math.floor(options.maxAttempts) : SELF_EVENTS_MAX_ATTEMPTS
  const cooldownMs =
    Number.isFinite(options.cooldownMs) && options.cooldownMs >= 0 ? options.cooldownMs : SELF_EVENTS_COOLDOWN_MS
  const habituation =
    Number.isFinite(options.habituation) && options.habituation > 0 && options.habituation < 1
      ? options.habituation
      : SELF_EVENTS_HABITUATION

  const state = load()
  let current = state.current
  const closed = state.closed.slice()

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function normalizeCurrent(raw) {
    if (!isPlainObject(raw)) return null
    const topic = cleanTopic(raw.topic)
    if (topic.length < 2) return null
    const at = Number.isFinite(raw.startedAt) ? raw.startedAt : null
    return {
      topic,
      startedAt: at,
      lastAt: Number.isFinite(raw.lastAt) ? raw.lastAt : at,
      attempts: Number.isFinite(raw.attempts) ? Math.max(1, Math.floor(raw.attempts)) : 1,
      salience: Number.isFinite(raw.salience) ? Math.max(0, Math.min(1, raw.salience)) : 1,
      satiatedAt: Number.isFinite(raw.satiatedAt) ? raw.satiatedAt : null,
    }
  }

  function load() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const current = normalizeCurrent(parsed.current)
      const closedRaw = Array.isArray(parsed.closed) ? parsed.closed : []
      const closed = closedRaw
        .map((item) => {
          if (!isPlainObject(item)) return null
          const topic = cleanTopic(item.topic)
          if (topic.length < 2) return null
          return {
            topic,
            startedAt: Number.isFinite(item.startedAt) ? item.startedAt : null,
            endedAt: Number.isFinite(item.endedAt) ? item.endedAt : null,
            attempts: Number.isFinite(item.attempts) ? Math.max(1, Math.floor(item.attempts)) : 1,
            reason: typeof item.reason === 'string' ? item.reason.slice(0, 40) : 'closed',
          }
        })
        .filter(Boolean)
        .slice(-SELF_EVENTS_MAX_CLOSED)
      return { current, closed }
    } catch {
      return { current: null, closed: [] }
    }
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ok: true, v: SELF_EVENTS_VERSION, current, closed })
      return true
    } catch (error) {
      warn(`事件状态写入失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  function closedFor(topic) {
    for (let i = closed.length - 1; i >= 0; i -= 1) {
      if (closed[i].topic === topic && Number.isFinite(closed[i].endedAt)) return closed[i]
    }
    return null
  }

  function describe(at = now()) {
    if (current === null) return { topic: '', attempts: 0, satiated: false, text: '' }
    const satiated =
      current.satiatedAt !== null || current.attempts >= maxAttempts || current.salience <= 0.15
    const ageMin = current.startedAt ? Math.max(0, Math.round((at - current.startedAt) / 60000)) : 0
    const lines = []
    lines.push(`你正在做的一件事：${current.topic}。`)
    if (current.attempts >= 2) lines.push(`这件事你已经试了 ${current.attempts} 次，新鲜感在变钝。`)
    if (satiated) {
      lines.push('它对你来说已经没感觉了：再试也不会得到新的结果。允许你承认分不出来/先放下，换一件不同的事，或者什么都不做。')
    }
    return { topic: current.topic, attempts: current.attempts, satiated, text: lines.join('') }
  }

  /** 记录一次尝试；返回是否允许继续这个主题。 */
  function observe(topicRaw, at = now()) {
    const topic = cleanTopic(topicRaw)
    if (topic.length < 2) return { ok: true, allowed: true, event: current, reason: 'no-topic' }
    if (current !== null && current.topic === topic) {
      const satiated = current.satiatedAt !== null || current.attempts >= maxAttempts || current.salience <= 0.15
      if (satiated) {
        const sinceSatiated = current.satiatedAt ? at - current.satiatedAt : null
        if (sinceSatiated !== null && sinceSatiated < cooldownMs) {
          return { ok: true, allowed: false, reason: 'satiated', event: current }
        }
        // 冷却结束：允许重新开始同一主题，但算新一次尝试
      }
      current = {
        ...current,
        lastAt: at,
        attempts: current.attempts + 1,
        salience: Math.max(0, current.salience * habituation),
      }
      if (current.attempts >= maxAttempts || current.salience <= 0.15) current.satiatedAt = at
      persist()
      return { ok: true, allowed: true, event: current, reason: 'continued' }
    }
    if (current !== null) {
      closed.push({
        topic: current.topic,
        startedAt: current.startedAt,
        endedAt: at,
        attempts: current.attempts,
        reason: 'switched',
      })
      while (closed.length > SELF_EVENTS_MAX_CLOSED) closed.shift()
    }
    const previous = closedFor(topic)
    if (previous !== null && previous.endedAt !== null && at - previous.endedAt < cooldownMs) {
      current = null
      persist()
      return { ok: true, allowed: false, reason: 'cooldown', event: null }
    }
    current = { topic, startedAt: at, lastAt: at, attempts: 1, salience: 1, satiatedAt: null }
    persist()
    return { ok: true, allowed: true, event: current, reason: 'started' }
  }

  function snapshot() {
    return { current, closedCount: closed.length, recentClosed: closed.slice(-3) }
  }

  return { file, observe, describe, snapshot, current: () => current }
}
