// lib/domain/being/habit-memory.mjs —— 情境→动作→结果的习惯记忆（v3.11）
//
// 参考 Wood & Rünger 2016：习惯是“情境线索→动作”的自动链接，重复与稳定情境是关键。
// 这里不改自处决策，只在她想做什么时给一句“类似情况下你做过什么、成没成”。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

const HABITS_MAX = 200
const HALF_LIFE_HOURS = 72

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function bigrams(value) {
  const chars = Array.from(String(value ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}

function similarity(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let overlap = 0
  for (const gram of A) if (B.has(gram)) overlap += 1
  return (2 * overlap) / (A.size + B.size)
}

export function emptyHabits() {
  return { ok: true, v: 1, entries: [] }
}

export function normalizeHabits(raw) {
  const out = emptyHabits()
  if (!raw || typeof raw !== 'object') return out
  out.entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => ({
      id: clean(entry.id, 60),
      situation: clean(entry.situation, 80),
      action: clean(entry.action, 60),
      attempts: Number.isFinite(entry.attempts) ? Math.max(0, entry.attempts) : 0,
      successes: Number.isFinite(entry.successes) ? Math.max(0, entry.successes) : 0,
      lastAt: Number.isFinite(entry.lastAt) ? entry.lastAt : 0,
    }))
    .filter((entry) => entry.situation.length >= 1 && entry.action.length >= 1)
    .slice(-HABITS_MAX)
  return out
}

/** 记一次“情境→动作→结果”。 */
export function recordHabit(state, input, at = Date.now()) {
  const habits = normalizeHabits(state)
  const situation = clean(input?.situation, 80) || '自处'
  const action = clean(input?.action, 60)
  if (action.length === 0) return { habits, recorded: false }
  const ok = input?.ok === true
  const existing = habits.entries.find((entry) => entry.action === action && similarity(entry.situation, situation) >= 0.6)
  if (existing) {
    existing.attempts += 1
    if (ok) existing.successes += 1
    existing.lastAt = at
    existing.situation = situation
  } else {
    habits.entries.push({ id: `habit-${at}-${habits.entries.length + 1}`, situation, action, attempts: 1, successes: ok ? 1 : 0, lastAt: at })
  }
  habits.entries = habits.entries.slice(-HABITS_MAX)
  return { habits, recorded: true }
}

/** 按当前情境给出“以前类似情况下做成过/没做成”的提示行。 */
export function suggestHabits(state, options = {}) {
  const habits = normalizeHabits(state)
  const situation = clean(options.situation, 80)
  if (situation.length < 2) return []
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 2
  const at = Number.isFinite(options.at) ? options.at : Date.now()
  const scored = habits.entries
    .map((entry) => {
      const sim = similarity(entry.situation, situation)
      const rate = entry.attempts > 0 ? entry.successes / entry.attempts : 0
      const hours = Math.max(0, (at - entry.lastAt) / 3600000)
      const recency = Math.pow(0.5, hours / HALF_LIFE_HOURS)
      return { entry, score: sim * 0.5 + rate * 0.3 + recency * 0.2, sim, rate }
    })
    .filter((item) => item.sim >= 0.25 && item.entry.attempts >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return scored.map(({ entry, rate }) => {
    const times = entry.attempts === 1 ? '一次' : `${entry.attempts} 次`
    const result = entry.attempts > 1 ? `${Math.round(rate * 100)}% 成` : entry.successes > 0 ? '成过' : '没成'
    return `在类似情况（${entry.situation}）下，你做过「${entry.action}」，${times}里 ${result}`
  })
}

export function createHabitMemory(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'habits.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = readHabits(file)
  function readHabits(pathname) {
    try {
      return normalizeHabits(JSON.parse(readFileSync(pathname, 'utf8')))
    } catch (error) {
      return emptyHabits()
    }
  }
  function save(next) {
    try {
      writeJsonAtomic(file, normalizeHabits(next))
      state = next
    } catch (error) {
      /* ignore */
    }
  }
  return {
    file,
    record: (input) => {
      const result = recordHabit(state, input, now())
      if (result.recorded) save(result.habits)
      return result.recorded
    },
    suggest: (situation, limit = 2) => suggestHabits(state, { situation, limit, at: now() }),
    snapshot: () => ({ entries: state.entries.length, top: state.entries.slice(-5) }),
  }
}
