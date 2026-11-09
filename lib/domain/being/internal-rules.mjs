// lib/domain/being/internal-rules.mjs —— 内生的规则引擎（v3.15）
//
// 方向：减少“prompt 里写死行为/心情/语言规则”，改成她自己从经验里总结、被结果校准的规则。
// 规则不是命令，是她自己的话，可被推翻；置信度随“用了以后成没成”变化。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

export const RULE_SCOPES = Object.freeze(['behavior', 'mood', 'language', 'social'])
const RULES_MAX = 120

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

export function emptyRules() {
  return { ok: true, v: 1, entries: [] }
}

export function normalizeRules(raw) {
  const out = emptyRules()
  if (!isPlainObject(raw)) return out
  out.entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => ({
      id: clean(entry.id, 60),
      scope: RULE_SCOPES.includes(entry.scope) ? entry.scope : 'behavior',
      rule: clean(entry.rule, 160),
      trigger: clean(entry.trigger, 120),
      confidence: Number.isFinite(entry.confidence) ? Math.min(0.98, Math.max(0.1, entry.confidence)) : 0.5,
      evidence: Number.isFinite(entry.evidence) ? Math.max(1, entry.evidence) : 1,
      success: Number.isFinite(entry.success) ? Math.max(0, entry.success) : 0,
      fail: Number.isFinite(entry.fail) ? Math.max(0, entry.fail) : 0,
      at: Number.isFinite(entry.at) ? entry.at : 0,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
    }))
    .filter((entry) => entry.rule.length >= 6)
    .slice(-RULES_MAX)
  return out
}

/** 加一条规则；同 scope 下相似规则合并（多条证据 → 置信度略升）。 */
export function addRule(state, input, at = Date.now()) {
  const rules = normalizeRules(state)
  const rule = clean(input?.rule, 160)
  if (rule.length < 6) return { rules, added: false }
  const scope = RULE_SCOPES.includes(input?.scope) ? input.scope : 'behavior'
  const trigger = clean(input?.trigger, 120)
  const existing = rules.entries.find((entry) => entry.scope === scope && similarity(entry.rule, rule) >= 0.68)
  if (existing) {
    existing.evidence += 1
    existing.confidence = Math.min(0.98, existing.confidence + 0.05)
    existing.updatedAt = at
    if (trigger.length > 0) existing.trigger = trigger
    return { rules, added: false, merged: true }
  }
  rules.entries.push({
    id: `rule-${at}-${rules.entries.length + 1}`,
    scope,
    rule,
    trigger,
    confidence: 0.5,
    evidence: 1,
    success: 0,
    fail: 0,
    at,
    updatedAt: at,
  })
  rules.entries = rules.entries.slice(-RULES_MAX)
  return { rules, added: true }
}

/** 结果反馈：这条规则用了以后成了/没成，置信度随之涨跌。 */
export function recordRuleOutcome(state, id, ok, at = Date.now()) {
  const rules = normalizeRules(state)
  const entry = rules.entries.find((item) => item.id === id)
  if (!entry) return { rules, updated: false }
  entry.evidence += 1
  if (ok === true) {
    entry.success += 1
    entry.confidence = Math.min(0.98, entry.confidence + 0.08)
  } else {
    entry.fail += 1
    entry.confidence = Math.max(0.08, entry.confidence - 0.15)
  }
  entry.updatedAt = at
  return { rules, updated: true }
}

/** 按情境挑可用规则：trigger 越像、置信度越高越靠前；低置信度不打扰。 */
export function applicableRules(state, context = '', options = {}) {
  const rules = normalizeRules(state)
  const scope = options.scope ?? null
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 4
  const text = String(context ?? '')
  return rules.entries
    .filter((entry) => entry.confidence >= 0.35)
    .filter((entry) => (scope === null ? true : entry.scope === scope))
    .map((entry) => {
      const sim = entry.trigger.length >= 2 && text.length >= 2 ? similarity(entry.trigger, text) : 0
      return { entry, score: entry.confidence * 0.7 + sim * 0.3 }
    })
    .filter((item) => text.length < 2 || item.score > 0.3 || (item.entry.trigger.length >= 2 && item.score > 0.25))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry)
}

/** 以内生口吻给她看的规则行（不是命令，是“你自己总结的”）。 */
export function digestRules(state, options = {}) {
  const entries = applicableRules(state, options.context ?? '', options)
  return entries.map((entry) => `「${entry.rule}」${entry.confidence >= 0.7 ? '（验证过几次）' : ''}`)
}

/** 解析模型总结出的规则（0–2 条）。 */
export function parseRuleProposal(text) {
  if (typeof text !== 'string') return []
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('[')
  const objectStart = body.indexOf('{')
  let payload = null
  try {
    if (start >= 0 && (objectStart < 0 || start < objectStart)) payload = JSON.parse(body.slice(start, body.lastIndexOf(']') + 1))
    else if (objectStart >= 0) payload = JSON.parse(body.slice(objectStart, body.lastIndexOf('}') + 1))
  } catch (error) {
    return []
  }
  const list = Array.isArray(payload) ? payload : isPlainObject(payload) && Array.isArray(payload.rules) ? payload.rules : []
  return list
    .map((item) => ({
      scope: RULE_SCOPES.includes(item?.scope) ? item.scope : 'behavior',
      rule: clean(item?.rule, 160),
      trigger: clean(item?.trigger, 120),
    }))
    .filter((item) => item.rule.length >= 6 && item.rule.length <= 160)
    .slice(0, 2)
}

/** 定期总结 prompt：从她自己的行动/判断/结果里长规则，不写口号。 */
export function buildRuleSynthesisPrompt(context = {}) {
  const chains = Array.isArray(context.chains) ? context.chains.map((item) => clean(item, 200)).filter(Boolean).slice(-6) : []
  const methods = Array.isArray(context.methods) ? context.methods.map((item) => clean(item, 160)).filter(Boolean).slice(-6) : []
  const thoughts = Array.isArray(context.thoughts) ? context.thoughts.map((item) => clean(item, 160)).filter(Boolean).slice(-8) : []
  const actions = Array.isArray(context.actions) ? context.actions.map((item) => clean(item, 120)).filter(Boolean).slice(-8) : []
  return [
    '你在总结自己最近的经验，想留下几条真正属于你自己的规则；不要写“要善良”“要努力”这种口号。',
    '规则要具体到：在什么情况下、怎么做、为什么（你观察到什么结果）。第一人称，一句话。',
    '- 只写你从经验里看出来的，不确定就不写；一次最多 2 条；没有就输出 []。',
    '',
    thoughts.length > 0 ? `最近的想法：${thoughts.join('；')}` : '',
    actions.length > 0 ? `最近做过的事：${actions.join('；')}` : '',
    chains.length > 0 ? `最近的判断：${chains.join('；')}` : '',
    methods.length > 0 ? `最近用过的方法：${methods.join('；')}` : '',
    '',
    '输出 JSON 数组：[{"scope":"behavior|mood|language|social","rule":"","trigger":"什么情况下用"}]',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

export function createInternalRules(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'internal-rules.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let rules = read()
  function read() {
    try {
      return normalizeRules(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      return emptyRules()
    }
  }
  function save(next) {
    try {
      writeJsonAtomic(file, normalizeRules(next))
      rules = next
    } catch (error) {
      /* ignore */
    }
  }
  return {
    file,
    add: (input) => {
      const result = addRule(rules, input, now())
      if (result.added || result.merged) save(result.rules)
      return result
    },
    recordOutcome: (id, ok) => {
      const result = recordRuleOutcome(rules, id, ok, now())
      if (result.updated) save(result.rules)
      return result.updated
    },
    applicable: (context, scopeOptions = {}) => applicableRules(rules, context, scopeOptions),
    digest: (context, scopeOptions = {}) => digestRules(rules, { ...scopeOptions, context }),
    list: () => rules.entries,
    snapshot: () => ({ entries: rules.entries.length, top: rules.entries.slice(-6).map((entry) => ({ scope: entry.scope, rule: entry.rule, confidence: Number(entry.confidence.toFixed(2)) })) }),
  }
}
