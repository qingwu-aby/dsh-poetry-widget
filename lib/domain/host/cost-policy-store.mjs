// @ts-check
// lib/domain/host/cost-policy-store.mjs —— 成本策略持久化（Gate N3，原子写 + 默认空 + 非法值回退）。
//
// 文件：$DSH_HOME/.dsh-poetry/cost-policy.json
// 字段：disabled / minuteTotal / dayTotal / roleLimits / activityLimits / softMinuteTotal / softDayTotal
//   · 默认空策略（不改变 cost-guard 既有 env/settings 行为）；
//   · 非负整数、范围上限、白名单字段；非法值回退默认（写时报告 errors，不写坏值）；
//   · 原子写（临时文件 + rename，0600）；坏文件降级为默认空策略；
//   · 只读写本地文件：不联网、不调用 guard。

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 实现版本。 */
export const COST_POLICY_STORE_VERSION = 1

/** 默认空策略（与 cost-guard DEFAULT_COST_POLICY 的“不限制”语义一致）。 */
export const DEFAULT_COST_POLICY_CONFIG = Object.freeze({
  disabled: false,
  minuteTotal: 0,
  dayTotal: 0,
  roleLimits: Object.freeze({}),
  activityLimits: Object.freeze({}),
  softMinuteTotal: 20,
  softDayTotal: 600,
})

/** 允许范围。 */
export const COST_POLICY_RANGES = Object.freeze({
  minuteTotal: Object.freeze({ min: 0, max: 100000 }),
  dayTotal: Object.freeze({ min: 0, max: 1000000 }),
  softMinuteTotal: Object.freeze({ min: 0, max: 100000 }),
  softDayTotal: Object.freeze({ min: 0, max: 1000000 }),
  roleLimit: Object.freeze({ min: 0, max: 100000 }),
  maxRoleLimits: 20,
  maxActivityLimits: 20,
})

/** 可编辑字段（PUT 白名单）。 */
export const COST_POLICY_EDITABLE_FIELDS = Object.freeze([
  'disabled',
  'minuteTotal',
  'dayTotal',
  'roleLimits',
  'activityLimits',
  'softMinuteTotal',
  'softDayTotal',
])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneConfig(config) {
  return {
    disabled: config.disabled === true,
    minuteTotal: Number(config.minuteTotal) || 0,
    dayTotal: Number(config.dayTotal) || 0,
    roleLimits: { ...(isPlainObject(config.roleLimits) ? config.roleLimits : {}) },
    activityLimits: { ...(isPlainObject(config.activityLimits) ? config.activityLimits : {}) },
    softMinuteTotal: Number(config.softMinuteTotal) || 0,
    softDayTotal: Number(config.softDayTotal) || 0,
  }
}

function readNonNegative(value, fallback, range) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < range.min || n > range.max) return fallback
  return Math.floor(n)
}

function normalizeWindowTable(value, errors, field, maxEntries) {
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    errors.push({ path: field, message: field + ' 必须是对象' })
    return {}
  }
  const out = {}
  let count = 0
  for (const [name, entry] of Object.entries(value)) {
    if (count >= maxEntries) {
      errors.push({ path: field, message: field + ' 最多 ' + maxEntries + ' 项' })
      break
    }
    const key = String(name).trim().slice(0, 40)
    if (key.length === 0) continue
    if (!isPlainObject(entry)) {
      errors.push({ path: field + '.' + key, message: '需要 {minute, day}' })
      continue
    }
    const minute = readNonNegative(entry.minute, 0, COST_POLICY_RANGES.roleLimit)
    const day = readNonNegative(entry.day, 0, COST_POLICY_RANGES.roleLimit)
    out[key] = { minute, day }
    count += 1
  }
  return out
}

/** 归一化/校验用户输入（非法值回退默认并记录 errors）。 */
export function normalizeCostPolicyConfig(input, base = DEFAULT_COST_POLICY_CONFIG) {
  const errors = []
  const source = isPlainObject(input) ? input : {}
  for (const key of Object.keys(source)) {
    if (COST_POLICY_EDITABLE_FIELDS.indexOf(key) < 0) errors.push({ path: key, message: '不允许修改字段：' + key })
  }
  const config = cloneConfig(base)
  if (source.disabled !== undefined) config.disabled = source.disabled === true
  if (source.minuteTotal !== undefined) config.minuteTotal = readNonNegative(source.minuteTotal, config.minuteTotal, COST_POLICY_RANGES.minuteTotal)
  if (source.dayTotal !== undefined) config.dayTotal = readNonNegative(source.dayTotal, config.dayTotal, COST_POLICY_RANGES.dayTotal)
  if (source.softMinuteTotal !== undefined) config.softMinuteTotal = readNonNegative(source.softMinuteTotal, config.softMinuteTotal, COST_POLICY_RANGES.softMinuteTotal)
  if (source.softDayTotal !== undefined) config.softDayTotal = readNonNegative(source.softDayTotal, config.softDayTotal, COST_POLICY_RANGES.softDayTotal)
  if (source.roleLimits !== undefined) config.roleLimits = normalizeWindowTable(source.roleLimits, errors, 'roleLimits', COST_POLICY_RANGES.maxRoleLimits)
  if (source.activityLimits !== undefined) config.activityLimits = normalizeWindowTable(source.activityLimits, errors, 'activityLimits', COST_POLICY_RANGES.maxActivityLimits)
  return { ok: errors.length === 0, config, errors }
}

/** 严格校验用户输入（PUT 用；非法 → errors，不做静默回退）。 */
export function validateCostPolicyConfig(input) {
  const errors = []
  const source = isPlainObject(input) ? input : null
  if (source === null) return { ok: false, errors: [{ path: '$', message: 'config 必须是对象' }] }
  for (const key of Object.keys(source)) {
    if (COST_POLICY_EDITABLE_FIELDS.indexOf(key) < 0) errors.push({ path: key, message: '不允许修改字段：' + key })
  }
  const checkInt = (key, range) => {
    if (source[key] === undefined) return
    const n = Number(source[key])
    if (!Number.isInteger(n) || n < range.min || n > range.max) errors.push({ path: key, message: key + ' 必须是 ' + range.min + '..' + range.max + ' 的整数' })
  }
  checkInt('minuteTotal', COST_POLICY_RANGES.minuteTotal)
  checkInt('dayTotal', COST_POLICY_RANGES.dayTotal)
  checkInt('softMinuteTotal', COST_POLICY_RANGES.softMinuteTotal)
  checkInt('softDayTotal', COST_POLICY_RANGES.softDayTotal)
  if (source.disabled !== undefined && typeof source.disabled !== 'boolean') errors.push({ path: 'disabled', message: 'disabled 必须是 boolean' })
  const checkTable = (key, maxEntries) => {
    if (source[key] === undefined) return
    if (!isPlainObject(source[key])) {
      errors.push({ path: key, message: key + ' 必须是对象' })
      return
    }
    const entries = Object.entries(source[key])
    if (entries.length > maxEntries) errors.push({ path: key, message: key + ' 最多 ' + maxEntries + ' 项' })
    for (const [name, entry] of entries) {
      if (!isPlainObject(entry)) {
        errors.push({ path: key + '.' + name, message: '需要 {minute, day}' })
        continue
      }
      for (const window of ['minute', 'day']) {
        if (entry[window] === undefined) continue
        const n = Number(entry[window])
        if (!Number.isInteger(n) || n < 0 || n > COST_POLICY_RANGES.roleLimit.max) {
          errors.push({ path: key + '.' + name + '.' + window, message: window + ' 必须是非负整数' })
        }
      }
    }
  }
  checkTable('roleLimits', COST_POLICY_RANGES.maxRoleLimits)
  checkTable('activityLimits', COST_POLICY_RANGES.maxActivityLimits)
  return { ok: errors.length === 0, errors }
}

/** store 配置 → cost-guard overrides（供 resolveCostPolicy 合并）。 */
export function costConfigToOverrides(config) {
  const spec = isPlainObject(config) ? config : DEFAULT_COST_POLICY_CONFIG
  return {
    enabled: spec.disabled !== true,
    limits: {
      total: { minute: Number(spec.minuteTotal) || 0, day: Number(spec.dayTotal) || 0 },
      roles: isPlainObject(spec.roleLimits) ? spec.roleLimits : {},
      activities: isPlainObject(spec.activityLimits) ? spec.activityLimits : {},
    },
    softAlerts: {
      total: { minute: Number(spec.softMinuteTotal) || 0, day: Number(spec.softDayTotal) || 0 },
    },
  }
}

function writeAtomic(file, content) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.tmp')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
    return { ok: true }
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch (cleanupError) {
      void cleanupError
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 创建成本策略 store。
 * @param {{file: string, now?: () => number, logger?: object|null, readFile?: ((file: string) => string)|null}} options
 */
export function createCostPolicyStore(options) {
  const spec = isPlainObject(options) ? options : {}
  const file = typeof spec.file === 'string' && spec.file.length > 0 ? spec.file : ''
  if (file.length === 0) throw new TypeError('createCostPolicyStore 需要 file')
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const logger = /** @type {any} */ (spec.logger ?? null)
  const readFile = typeof spec.readFile === 'function' ? spec.readFile : (target) => readFileSync(target, 'utf8')

  function read() {
    const errors = []
    let config = cloneConfig(DEFAULT_COST_POLICY_CONFIG)
    let exists = false
    let updatedAt = 0
    try {
      exists = existsSync(file)
      if (exists) {
        const parsed = JSON.parse(readFile(file))
        if (!isPlainObject(parsed)) errors.push({ path: '$', message: 'cost-policy 必须是对象' })
        else {
          const normalized = normalizeCostPolicyConfig(parsed, DEFAULT_COST_POLICY_CONFIG)
          config = normalized.config
          for (const error of normalized.errors) errors.push(error)
          if (Number.isFinite(Number(parsed.updatedAt))) updatedAt = Number(parsed.updatedAt)
        }
      }
    } catch (error) {
      errors.push({ path: '$', message: error instanceof Error ? error.message : String(error) })
    }
    return { ok: errors.length === 0, file, exists, updatedAt, config, errors }
  }

  function write(patch) {
    const current = read()
    const normalized = normalizeCostPolicyConfig(patch, /** @type {any} */ (current.config))
    if (normalized.ok !== true) {
      return { ok: false, errors: normalized.errors, config: current.config }
    }
    const payload = { version: COST_POLICY_STORE_VERSION, updatedAt: now(), ...normalized.config }
    const written = writeAtomic(file, JSON.stringify(payload, null, 2) + '\n')
    if (written.ok !== true) {
      try {
        logger?.warn?.(`[dsh-little-whale] cost-policy 写入失败：${written.message ?? ''}`)
      } catch (error) {
        void error
      }
      return { ok: false, message: written.message, config: current.config }
    }
    return { ok: true, updatedAt: payload.updatedAt, config: normalized.config, file }
  }

  function reset() {
    const written = writeAtomic(file, JSON.stringify({ version: COST_POLICY_STORE_VERSION, updatedAt: now(), ...cloneConfig(DEFAULT_COST_POLICY_CONFIG) }, null, 2) + '\n')
    if (written.ok !== true) return { ok: false, message: written.message }
    return { ok: true, config: cloneConfig(DEFAULT_COST_POLICY_CONFIG) }
  }

  function snapshot() {
    const state = read()
    return { ok: true, version: COST_POLICY_STORE_VERSION, file, exists: state.exists, updatedAt: state.updatedAt, config: state.config, errors: state.errors, now: now() }
  }

  return { version: COST_POLICY_STORE_VERSION, file, read, write, reset, snapshot, toOverrides: costConfigToOverrides }
}
