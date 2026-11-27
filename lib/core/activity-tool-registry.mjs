// @ts-check
// Activity 通用工具注册表：声明式宏 + 受限代码（只返回步骤，不执行任意副作用）。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const DEFAULT_NAME_RE = /^[a-z][a-z0-9_]{1,28}$/
const MAX_TOOLS = 30
const MAX_STEPS = 8
const FORBIDDEN = /\b(require|import|process|globalThis|global|Function|eval|WebAssembly|fetch|XMLHttpRequest|child_process|setTimeout|setInterval|constructor)\b/

function cleanName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30)
}
function isObject(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function normalizeSteps(value, allowed) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value.slice(0, MAX_STEPS)) {
    if (!isObject(item) || typeof item.tool !== 'string' || !allowed.has(item.tool)) continue
    out.push({ tool: item.tool, arguments: isObject(item.arguments) ? item.arguments : {} })
  }
  return out
}

export function createActivityToolRegistry(options = {}) {
  const file = typeof options.file === 'string' ? options.file : ''
  const prefix = typeof options.prefix === 'string' && options.prefix.length > 0 ? options.prefix : ''
  const nameRe = prefix ? new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z0-9_]{1,28}$') : DEFAULT_NAME_RE
  const allowed = options.allowedTools instanceof Set ? options.allowedTools : new Set()
  const logger = options.logger ?? null
  let tools = {}
  try {
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (raw && isObject(raw.tools)) tools = raw.tools
    }
  } catch (error) { void error }
  function persist() {
    if (!file) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp-' + process.pid
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, tools }, null, 2) + '\n', { mode: 0o600 })
      fs.renameSync(tmp, file)
    } catch (error) { logger?.warn?.('[dsh-little-whale] 工具注册持久化失败：' + (error instanceof Error ? error.message : String(error))) }
  }
  function names() { return Object.keys(tools) }
  function has(name) { return Object.hasOwn(tools, name) }
  function defineMacro(input = {}) {
    const name = cleanName(input.name)
    if (!nameRe.test(name) || allowed.has(name)) return { ok: false, error: 'invalid_name' }
    if (Object.keys(tools).length >= MAX_TOOLS && !has(name)) return { ok: false, error: 'too_many_tools' }
    const steps = normalizeSteps(input.steps, allowed)
    if (steps.length === 0) return { ok: false, error: 'invalid_steps' }
    tools[name] = { kind: 'macro', purpose: String(input.purpose || '').slice(0, 120), steps, updatedAt: Date.now() }
    persist()
    return { ok: true, name, kind: 'macro', steps: steps.length }
  }
  function validateCode(code) {
    const text = String(code || '')
    if (text.length < 20 || text.length > 4000) return { ok: false, error: 'code_length' }
    if (FORBIDDEN.test(text)) return { ok: false, error: 'code_forbidden' }
    try {
      new vm.Script('(function(obs){ "use strict";\n' + text + '\n})')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: 'code_syntax: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  function defineCode(input = {}) {
    const name = cleanName(input.name)
    if (!nameRe.test(name) || allowed.has(name)) return { ok: false, error: 'invalid_name' }
    if (Object.keys(tools).length >= MAX_TOOLS && !has(name)) return { ok: false, error: 'too_many_tools' }
    const checked = validateCode(input.code)
    if (checked.ok !== true) return checked
    tools[name] = { kind: 'code', purpose: String(input.purpose || '').slice(0, 120), code: String(input.code).slice(0, 4000), updatedAt: Date.now() }
    persist()
    return { ok: true, name, kind: 'code' }
  }
  function expand(name, observation = {}) {
    const tool = tools[name]
    if (!tool) return null
    if (tool.kind === 'macro') return normalizeSteps(tool.steps, allowed)
    try {
      const sandbox = vm.createContext({ obs: observation, Math, JSON }, { codeGeneration: { strings: false, wasm: false } })
      const result = new vm.Script('(function(obs){ "use strict";\n' + tool.code + '\n})(obs)').runInContext(sandbox, { timeout: 500 })
      const steps = Array.isArray(result) ? result : result && Array.isArray(result.steps) ? result.steps : []
      const normalized = normalizeSteps(steps, allowed)
      if (normalized.length === 0) recordFailure(name, 'empty_steps：代码跑完了但没返回可执行的步骤')
      else recordSuccess(name)
      return normalized
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.warn?.('[dsh-little-whale] 代码工具执行失败：' + message)
      recordFailure(name, message.slice(0, 200))
      return null
    }
  }
  function recordFailure(name, message) {
    const tool = tools[name]
    if (!tool) return
    tool.lastError = String(message || '').slice(0, 200)
    tool.failCount = (Number(tool.failCount) || 0) + 1
    tool.lastFailAt = Date.now()
    persist()
  }
  function recordSuccess(name) {
    const tool = tools[name]
    if (!tool || !tool.lastError) return
    tool.lastError = ''
    tool.lastFailAt = 0
    persist()
  }
  /** 失败过的自定义工具（给 prompt 用）：名字、用途、错误、次数、代码。 */
  function failures() {
    return Object.entries(tools)
      .filter(([, tool]) => typeof tool.lastError === 'string' && tool.lastError.length > 0)
      .map(([name, tool]) => ({ name, purpose: tool.purpose || '', error: tool.lastError, failCount: Number(tool.failCount) || 1, kind: tool.kind || 'macro', code: String(tool.code || '').slice(0, 600) }))
      .slice(0, 3)
  }
  function list() {
    return Object.entries(tools).map(([name, tool]) => ({ name, purpose: tool.purpose || '', kind: tool.kind || 'macro' }))
  }
  return { file, prefix, names, has, defineMacro, defineCode, expand, list, failures, recordFailure, recordSuccess }
}
