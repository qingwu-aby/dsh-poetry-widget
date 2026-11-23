// @ts-check
// 工具经验层：记录“情境 → 工具 → 成败”，给下一次选择提供成功率，而不是只靠静态 prompt。
import fs from 'node:fs'
import path from 'node:path'

const MAX_CONTEXTS = 100
const MAX_TOOLS = 200
const DECAY_DAYS = 90

function clean(value, max) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) }

export function buildSkillContext(observation = {}) {
  const obs = isObject(observation) ? observation : {}
  const inventory = Array.isArray(obs.inventory) ? obs.inventory.map(String) : []
  const joined = inventory.join(' ').toLowerCase()
  return {
    empty: inventory.length === 0,
    hungry: Number(obs.food) <= 10,
    night: String(obs.timeOfDay || '').includes('夜'),
    stuck: obs.stuck === true,
    hasWood: /log|plank|wood|oak|birch|spruce|jungle/.test(joined),
    hasPickaxe: /pickaxe/.test(joined),
    hasTable: /crafting_table/.test(joined),
  }
}

export function contextKey(context = {}) {
  return Object.entries(context).filter(([, value]) => value === true).map(([key]) => key).sort().join('+') || 'plain'
}

export function createToolSkills(options = {}) {
  const file = typeof options.file === 'string' ? options.file : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let contexts = {}
  try {
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (raw && isObject(raw.contexts)) contexts = raw.contexts
    }
  } catch (error) { void error }
  function persist() {
    if (!file) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp-' + process.pid
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, contexts }, null, 2) + '\n', { mode: 0o600 })
      fs.renameSync(tmp, file)
    } catch (error) { void error }
  }
  function prune() {
    const keys = Object.keys(contexts)
    if (keys.length > MAX_CONTEXTS) {
      const sorted = keys.sort((a, b) => (contexts[a]._at || 0) - (contexts[b]._at || 0))
      for (const key of sorted.slice(0, keys.length - MAX_CONTEXTS)) delete contexts[key]
    }
    const cutoff = now() - DECAY_DAYS * 86400000
    for (const [key, entry] of Object.entries(contexts)) {
      for (const [tool, stat] of Object.entries(entry.tools || {})) {
        if (Number(stat.lastAt) > 0 && Number(stat.lastAt) < cutoff) delete entry.tools[tool]
      }
    }
  }
  function record(input = {}) {
    const tool = clean(input.tool, 60)
    if (!tool) return { ok: false, error: 'tool_required' }
    const context = isObject(input.context) ? input.context : {}
    const key = clean(contextKey(context), 120)
    const entry = contexts[key] && isObject(contexts[key]) ? contexts[key] : { context, tools: {}, _at: 0 }
    const stat = entry.tools[tool] && isObject(entry.tools[tool]) ? entry.tools[tool] : { success: 0, failure: 0, lastAt: 0, lastArgs: null }
    if (input.ok === true) stat.success += 1
    else stat.failure += 1
    stat.lastAt = now()
    stat.lastArgs = input.arguments && isObject(input.arguments) ? JSON.parse(JSON.stringify(input.arguments)) : null
    entry.context = context
    entry.tools[tool] = stat
    entry._at = now()
    contexts[key] = entry
    prune()
    persist()
    return { ok: true, key, tool }
  }
  function summary(context = {}, limit = 4) {
    const key = clean(contextKey(context), 120)
    const entry = contexts[key]
    if (!entry) return []
    return Object.entries(entry.tools || {})
      .map(([tool, stat]) => ({
        tool,
        success: Number(stat.success) || 0,
        failure: Number(stat.failure) || 0,
        attempts: (Number(stat.success) || 0) + (Number(stat.failure) || 0),
        rate: ((Number(stat.success) || 0) + 1) / ((Number(stat.success) || 0) + (Number(stat.failure) || 0) + 2),
      }))
      .filter((item) => item.attempts > 0)
      .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts)
      .slice(0, Math.max(1, Math.min(8, limit)))
  }
  function snapshot() { return { ok: true, file, contexts: Object.keys(contexts).length, entries: summary({}, 100) } }
  return { file, record, summary, snapshot }
}
