// lib/domain/being/action-policy.mjs —— 动作策略权重（v3.16）
//
// 方向：自处不再靠 prompt 里“可以做什么”的清单；动作倾向由她自己“做过→结果”累积。
// 记录：动作类型 + 情境桶 + 成败；读取：按成功率 + 探索 + 近期性排序。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

export const ACTION_KINDS = Object.freeze(['learn', 'probe', 'make', 'say', 'wander', 'read', 'rest', 'tidy'])
const POLICY_MAX = 200
const HALF_LIFE_HOURS = 96

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function bucketOf(context, at = Date.now()) {
  const text = clean(context, 80)
  const hour = (() => {
    try {
      return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(at)))
    } catch (error) {
      return 12
    }
  })()
  const period = hour < 6 ? '深夜' : hour < 11 ? '早上' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜'
  // 情境粗桶：只留前 12 个字，避免语料无限碎片化。
  return `${period}|${text.slice(0, 12)}`
}

export function emptyPolicy() {
  return { ok: true, v: 1, entries: [] }
}

export function normalizePolicy(raw) {
  const out = emptyPolicy()
  if (!isPlainObject(raw)) return out
  out.entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => ({
      kind: ACTION_KINDS.includes(entry.kind) ? entry.kind : null,
      bucket: clean(entry.bucket, 40),
      attempts: Number.isFinite(entry.attempts) ? Math.max(0, entry.attempts) : 0,
      successes: Number.isFinite(entry.successes) ? Math.max(0, entry.successes) : 0,
      lastAt: Number.isFinite(entry.lastAt) ? entry.lastAt : 0,
    }))
    .filter((entry) => entry.kind !== null && entry.bucket.length > 0)
    .slice(-POLICY_MAX)
  return out
}

/** 记一次动作结果（ok=null 表示做了但没明确成败，只记次数）。 */
export function recordAction(state, input, at = Date.now()) {
  const policy = normalizePolicy(state)
  const kind = ACTION_KINDS.includes(input?.kind) ? input.kind : null
  const bucket = clean(input?.bucket, 40)
  if (kind === null || bucket.length === 0) return { policy, recorded: false }
  const existing = policy.entries.find((entry) => entry.kind === kind && entry.bucket === bucket)
  if (existing) {
    existing.attempts += 1
    if (input?.ok === true) existing.successes += 1
    existing.lastAt = at
  } else {
    policy.entries.push({ kind, bucket, attempts: 1, successes: input?.ok === true ? 1 : 0, lastAt: at })
  }
  policy.entries = policy.entries.slice(-POLICY_MAX)
  return { policy, recorded: true }
}

/** 按情境/时间给动作类型打分：成功率 + 探索 + 近期性。 */
export function suggestActions(state, options = {}) {
  const policy = normalizePolicy(state)
  const at = Number.isFinite(options.at) ? options.at : Date.now()
  const bucket = clean(options.bucket, 40)
  const period = bucket.split('|')[0] ?? ''
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 3
  const kinds = Array.isArray(options.kinds) && options.kinds.length > 0 ? options.kinds : ACTION_KINDS
  return kinds
    .map((kind) => {
      const entries = policy.entries.filter((entry) => entry.kind === kind)
      const exact = entries.filter((entry) => entry.bucket === bucket)
      const samePeriod = entries.filter((entry) => entry.bucket.startsWith(`${period}|`))
      const relevant = exact.length > 0 ? exact : samePeriod.length > 0 ? samePeriod : entries
      const attempts = relevant.reduce((sum, entry) => sum + entry.attempts, 0)
      const successes = relevant.reduce((sum, entry) => sum + entry.successes, 0)
      const rate = (successes + 1) / (attempts + 2)
      const exploration = 1 / Math.sqrt(attempts + 1)
      const lastAt = entries.reduce((max, entry) => Math.max(max, entry.lastAt), 0)
      const hours = lastAt > 0 ? Math.max(0, (at - lastAt) / 3600000) : 999
      const recency = Math.pow(0.5, hours / HALF_LIFE_HOURS)
      return { kind, attempts, successes, rate, score: rate * 0.7 + exploration * 0.2 + recency * 0.1 }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function digestActions(state, options = {}) {
  const suggestions = suggestActions(state, options)
  return suggestions
    .filter((item) => item.attempts > 0)
    .map((item) => `「${item.kind}」：做过 ${item.attempts} 次，成 ${item.successes} 次`)
}

export function createActionPolicy(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'action-policy.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let policy = read()
  function read() {
    try {
      return normalizePolicy(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      return emptyPolicy()
    }
  }
  function save(next) {
    try {
      writeJsonAtomic(file, normalizePolicy(next))
      policy = next
    } catch (error) {
      /* ignore */
    }
  }
  return {
    file,
    record: (input) => {
      const result = recordAction(policy, input, now())
      if (result.recorded) save(result.policy)
      return result.recorded
    },
    suggest: (context, suggestOptions = {}) =>
      suggestActions(policy, { bucket: bucketOf(context, now()), at: now(), ...suggestOptions }),
    digest: (context, digestOptions = {}) =>
      digestActions(policy, { bucket: bucketOf(context, now()), at: now(), ...digestOptions }),
    snapshot: () => ({ entries: policy.entries.length, top: policy.entries.slice(-6) }),
  }
}
