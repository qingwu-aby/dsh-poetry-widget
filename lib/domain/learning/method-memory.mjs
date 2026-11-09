// lib/domain/learning/method-memory.mjs —— 方法论账本（v3.12）
//
// 参考 CoALA 的 procedural memory：读过的东西不只留“观点”，还要留“方法”。
// 每读一段哲学，抽出它在用的分析方法（辩证/怀疑/还原/谱系/思想实验...），
// 记下来：哪里来的、怎么做、试过几次、解释得通没有。下次读/想时先把已有的方法给她看。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

const METHODS_MAX = 60

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function emptyMethods() {
  return { ok: true, v: 1, entries: [] }
}

export function normalizeMethods(raw) {
  const out = emptyMethods()
  if (!raw || typeof raw !== 'object') return out
  out.entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => ({
      id: clean(entry.id, 60),
      name: clean(entry.name, 40),
      source: clean(entry.source, 80),
      howTo: clean(entry.howTo, 200),
      usedCount: Number.isFinite(entry.usedCount) ? Math.max(0, entry.usedCount) : 0,
      successCount: Number.isFinite(entry.successCount) ? Math.max(0, entry.successCount) : 0,
      lastAt: Number.isFinite(entry.lastAt) ? entry.lastAt : 0,
    }))
    .filter((entry) => entry.name.length >= 2 && entry.howTo.length >= 4)
    .slice(-METHODS_MAX)
  return out
}

/** 记一条方法（同名视为同一条，更新来源/做法与使用次数）。 */
export function recordMethod(state, input, at = Date.now()) {
  const methods = normalizeMethods(state)
  const name = clean(input?.name, 40)
  const howTo = clean(input?.howTo, 200)
  if (name.length < 2 || howTo.length < 4) return { methods, recorded: false }
  const source = clean(input?.source, 80)
  const existing = methods.entries.find((entry) => entry.name === name || similarity(entry.name, name) >= 0.8)
  if (existing) {
    existing.howTo = howTo
    existing.source = source || existing.source
    existing.usedCount += 1
    if (input?.worked === true) existing.successCount += 1
    existing.lastAt = at
  } else {
    methods.entries.push({
      id: `method-${at}-${methods.entries.length + 1}`,
      name,
      source,
      howTo,
      usedCount: 1,
      successCount: input?.worked === true ? 1 : 0,
      lastAt: at,
    })
  }
  return { methods, recorded: true }
}

/** 方法提示行：优先用过且有效的。 */
export function digestMethods(state, limit = 4) {
  const methods = normalizeMethods(state)
  return methods.entries
    .slice()
    .sort((a, b) => b.usedCount + b.successCount - (a.usedCount + a.successCount) || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map((entry) => `「${entry.name}」：${entry.howTo}${entry.source ? `（出自 ${entry.source}）` : ''}`)
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

export function createMethodMemory(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'methods.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = read()
  function read() {
    try {
      return normalizeMethods(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      return emptyMethods()
    }
  }
  function save(next) {
    try {
      writeJsonAtomic(file, normalizeMethods(next))
      state = next
    } catch (error) {
      /* ignore */
    }
  }
  return {
    file,
    /** 后果回访：只更新已有方法的效果，不新建方法。 */
    reportOutcome: (name, worked) => {
      const key = clean(name, 40)
      const existing = state.entries.find((entry) => entry.name === key || similarity(entry.name, key) >= 0.8)
      if (!existing) return false
      existing.usedCount += 1
      if (worked === true) existing.successCount += 1
      existing.lastAt = now()
      save(state)
      return true
    },
    record: (input) => {
      const result = recordMethod(state, input, now())
      if (result.recorded) save(result.methods)
      return result.recorded
    },
    digest: (limit = 4) => digestMethods(state, limit),
    snapshot: () => ({ entries: state.entries.length, names: state.entries.slice(-8).map((entry) => entry.name) }),
  }
}
