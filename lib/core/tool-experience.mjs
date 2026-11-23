// @ts-check
// 通用工具经验：scope（activity:xxx）+ context → tool 成功/失败；分域隔离、90 天衰减。
import fs from 'node:fs'
import path from 'node:path'

const MAX_SCOPES = 50
const MAX_CONTEXTS = 100
const DECAY_DAYS = 90
function clean(value, max) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) }
export function normalizeScope(value) {
  const scope = clean(value, 60)
  return /^activity:[a-z][a-z0-9-]{1,40}$/.test(scope) || scope === 'global' ? scope : 'global'
}
export function experienceContextKey(context = {}) {
  return Object.entries(isObject(context) ? context : {})
    .filter(([, value]) => value === true || (typeof value === 'number' && Number.isFinite(value)))
    .map(([key, value]) => `${key}:${typeof value === 'boolean' ? value : value}`)
    .sort()
    .join('+') || 'plain'
}
export function createToolExperience(options = {}) {
  const file = typeof options.file === 'string' ? options.file : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let scopes = {}
  try {
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (raw && isObject(raw.scopes)) scopes = raw.scopes
    }
  } catch (error) { void error }
  function persist() {
    if (!file) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp-' + process.pid
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, scopes }, null, 2) + '\n', { mode: 0o600 })
      fs.renameSync(tmp, file)
    } catch (error) { void error }
  }
  function prune() {
    const keys = Object.keys(scopes)
    if (keys.length > MAX_SCOPES) {
      const sorted = keys.sort((a, b) => (scopes[a]._at || 0) - (scopes[b]._at || 0))
      for (const key of sorted.slice(0, keys.length - MAX_SCOPES)) delete scopes[key]
    }
    const cutoff = now() - DECAY_DAYS * 86400000
    for (const scope of Object.values(scopes)) {
      for (const entry of Object.values(scope.contexts || {})) {
        for (const [tool, stat] of Object.entries(entry.tools || {})) {
          if (Number(stat.lastAt) > 0 && Number(stat.lastAt) < cutoff) delete entry.tools[tool]
        }
      }
    }
  }
  function record(input = {}) {
    const spec = /** @type {any} */ (input)
    const scope = spec.scope
    const tool = spec.tool
    const context = spec.context
    const ok = spec.ok
    const args = spec.arguments
    const scopeId = normalizeScope(scope)
    const name = clean(tool, 60)
    if (!name) return { ok: false, error: 'tool_required' }
    const key = clean(experienceContextKey(context), 160)
    const scopeEntry = scopes[scopeId] && isObject(scopes[scopeId]) ? scopes[scopeId] : { contexts: {}, _at: 0 }
    const entry = scopeEntry.contexts[key] && isObject(scopeEntry.contexts[key]) ? scopeEntry.contexts[key] : { context: isObject(context) ? context : {}, tools: {} }
    const stat = entry.tools[name] && isObject(entry.tools[name]) ? entry.tools[name] : { success: 0, failure: 0, lastAt: 0, lastArgs: null }
    if (ok === true) stat.success += 1
    else stat.failure += 1
    stat.lastAt = now()
    stat.lastArgs = isObject(args) ? JSON.parse(JSON.stringify(args)) : null
    entry.context = isObject(context) ? context : {}
    entry.tools[name] = stat
    scopeEntry.contexts[key] = entry
    scopeEntry._at = now()
    scopes[scopeId] = scopeEntry
    prune()
    persist()
    return { ok: true, scope: scopeId, key, tool: name }
  }
  function summary(input = {}) {
    const spec = /** @type {any} */ (input)
    const scope = spec.scope
    const context = spec.context
    const limit = spec.limit === undefined ? 5 : spec.limit
    const scopeId = normalizeScope(scope)
    const key = clean(experienceContextKey(context), 160)
    const entry = scopes[scopeId] && scopes[scopeId].contexts ? scopes[scopeId].contexts[key] : null
    if (!entry) return []
    return Object.entries(entry.tools || {})
      .map(([tool, stat]) => {
        const success = Number(stat.success) || 0
        const failure = Number(stat.failure) || 0
        const attempts = success + failure
        return { tool, success, failure, attempts, rate: (success + 1) / (attempts + 2), lastAt: stat.lastAt, lastArgs: stat.lastArgs }
      })
      .filter((item) => item.attempts > 0)
      .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts)
      .slice(0, Math.max(1, Math.min(20, limit)))
  }
  function listScopes() { return Object.keys(scopes).sort() }
  function snapshot() { return { ok: true, file, scopes: listScopes().length, names: listScopes() } }
  return { file, record, summary, listScopes, snapshot }
}
