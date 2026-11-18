// @ts-check
// lib/kernel/model-policy-store.mjs —— 模型策略配置存储（Gate G1）。
//
// 目标：让用户用文件/API 手动指定模型与推理参数（后端优先，UI 后续），默认空配置 = 现有行为：
//   · 文件：$DSH_HOME/.dsh-poetry/model-policy.json（原子写、0600、带 schema 版本）；
//   · 字段：provider/model（可选，覆盖宿主 selection）、roles{role:{provider?,model?,reasoningEffort?}}、
//     tokenLimit（0 = 不封顶）、version/updatedAt；
//   · 读取：缺文件/坏 JSON/非法字段 → 返回默认空策略 + errors[]（不抛错、不崩）；
//   · 写入：先归一化（非法字段忽略并报告），再原子写；写入前不覆盖文件直到校验完成。
//
// 纯 kernel：只读写这一个文件；不联网/无宿主依赖；时钟可注入。

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { MODEL_POLICY_EFFORTS, MODEL_POLICY_ROLES } from './model-policy.mjs'
import { writeJsonAtomic } from './settings-store.mjs'

/** store schema 版本。 */
export const MODEL_POLICY_STORE_VERSION = 1

/** 配置文件名（相对 $DSH_HOME/.dsh-poetry/）。 */
export const MODEL_POLICY_FILE_NAME = 'model-policy.json'

/** tokenLimit 上限（0 = 不封顶；>0 时限制单次调用 maxTokens）。 */
export const MODEL_POLICY_TOKEN_LIMIT_MAX = 1_000_000

/** provider/model 字符串长度上限。 */
export const MODEL_POLICY_VALUE_MAX = 80

/** 默认空策略（空配置 = 不覆盖任何东西）。 */
export function emptyModelPolicy() {
  return { provider: null, model: null, roles: {}, tokenLimit: 0 }
}

const CONTROL_CHARS = /[\p{Cc}]/u

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readValue(value, max = MODEL_POLICY_VALUE_MAX) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max || CONTROL_CHARS.test(trimmed)) return ''
  return trimmed
}

/** $DSH_HOME/.dsh-poetry/model-policy.json 的绝对路径。 */
export function resolveModelPolicyFile(home) {
  const base = typeof home === 'string' && home.length > 0 ? home : process.env.HOME || process.cwd()
  return path.join(base, '.dsh-poetry', MODEL_POLICY_FILE_NAME)
}

/**
 * 归一化模型策略（纯函数）：非法值忽略并记录到 errors，永不抛错。
 * @param {unknown} raw
 * @returns {{ok: true, policy: {provider: string|null, model: string|null, roles: Record<string, object>, tokenLimit: number}, errors: Array<{path: string, message: string}>}}
 */
export function normalizeModelPolicy(raw) {
  const errors = []
  const policy =
    /** @type {{provider: string|null, model: string|null, roles: Record<string, any>, tokenLimit: number}} */ (
      emptyModelPolicy()
    )
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) errors.push({ path: '$', message: '策略必须是对象' })
    return { ok: true, policy, errors }
  }
  const source = /** @type {Record<string, any>} */ (raw)
  const provider = readValue(source.provider)
  if (source.provider !== undefined && source.provider !== null && provider.length === 0) {
    errors.push({ path: 'provider', message: `provider 必须是 1–${MODEL_POLICY_VALUE_MAX} 字非空字符串` })
  }
  policy.provider = provider.length > 0 ? provider : null
  const model = readValue(source.model)
  if (source.model !== undefined && source.model !== null && model.length === 0) {
    errors.push({ path: 'model', message: `model 必须是 1–${MODEL_POLICY_VALUE_MAX} 字非空字符串` })
  }
  policy.model = model.length > 0 ? model : null
  if (source.tokenLimit !== undefined) {
    const limit = Number(source.tokenLimit)
    if (!Number.isInteger(limit) || limit < 0 || limit > MODEL_POLICY_TOKEN_LIMIT_MAX) {
      errors.push({ path: 'tokenLimit', message: `tokenLimit 必须是 0–${MODEL_POLICY_TOKEN_LIMIT_MAX} 的整数` })
    } else {
      policy.tokenLimit = limit
    }
  }
  if (source.roles !== undefined) {
    if (!isPlainObject(source.roles)) {
      errors.push({ path: 'roles', message: 'roles 必须是对象' })
    } else {
      for (const [role, roleValue] of Object.entries(source.roles)) {
        if (MODEL_POLICY_ROLES.indexOf(role) < 0) {
          errors.push({ path: `roles.${role}`, message: `未知角色：${role}` })
          continue
        }
        if (!isPlainObject(roleValue)) {
          errors.push({ path: `roles.${role}`, message: '角色配置必须是对象' })
          continue
        }
        const entry = {}
        const roleProvider = readValue(roleValue.provider)
        if (roleValue.provider !== undefined && roleProvider.length === 0) {
          errors.push({ path: `roles.${role}.provider`, message: 'provider 非法' })
        } else if (roleProvider.length > 0) {
          entry.provider = roleProvider
        }
        const roleModel = readValue(roleValue.model)
        if (roleValue.model !== undefined && roleModel.length === 0) {
          errors.push({ path: `roles.${role}.model`, message: 'model 非法' })
        } else if (roleModel.length > 0) {
          entry.model = roleModel
        }
        if (roleValue.reasoningEffort !== undefined) {
          const effort =
            typeof roleValue.reasoningEffort === 'string' ? roleValue.reasoningEffort.trim().toLowerCase() : ''
          if (MODEL_POLICY_EFFORTS.indexOf(effort) < 0) {
            errors.push({
              path: `roles.${role}.reasoningEffort`,
              message: `reasoningEffort 必须是：${MODEL_POLICY_EFFORTS.join(' / ')}`,
            })
          } else {
            entry.reasoningEffort = effort
          }
        }
        if (Object.keys(entry).length > 0) policy.roles[role] = entry
      }
    }
  }
  return { ok: true, policy, errors }
}

/**
 * 创建模型策略存储。
 * @param {{
 *   file?: string,
 *   home?: string,
 *   logger?: {warn?: Function}|null,
 *   now?: () => number,
 * }} [options]
 */
export function createModelPolicyStore(options = {}) {
  const file =
    typeof options.file === 'string' && options.file.length > 0 ? options.file : resolveModelPolicyFile(options.home)
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let cache = null
  /** @type {{file: string, exists: boolean, policy: object, errors: Array<object>, updatedAt: number}|null} */
  let lastRead = null

  function readFileState() {
    if (!existsSync(file)) return { exists: false, text: '', mtimeMs: 0, size: 0 }
    try {
      const stat = statSync(file)
      return { exists: true, text: readFileSync(file, 'utf8'), mtimeMs: stat.mtimeMs, size: stat.size }
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 读取模型策略失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (warnError) {
        void warnError
      }
      return { exists: false, text: '', mtimeMs: 0, size: 0 }
    }
  }

  function parseState(state) {
    const errors = []
    let raw = null
    if (state.exists && state.text.trim().length > 0) {
      try {
        raw = JSON.parse(state.text)
      } catch (error) {
        errors.push({ path: '$', message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` })
      }
    }
    const normalized = normalizeModelPolicy(raw ?? undefined)
    return {
      file,
      exists: state.exists,
      policy: normalized.policy,
      errors: errors.concat(normalized.errors),
      updatedAt: isPlainObject(raw) && Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
    }
  }

  function read() {
    const state = readFileState()
    if (cache !== null && cache.mtimeMs === state.mtimeMs && cache.size === state.size) {
      lastRead = cache.value
      return { ...cache.value }
    }
    const value = parseState(state)
    cache = { mtimeMs: state.mtimeMs, size: state.size, value }
    lastRead = value
    return { ...value }
  }

  function write(rawPolicy) {
    const normalized = normalizeModelPolicy(rawPolicy)
    const payload = {
      version: MODEL_POLICY_STORE_VERSION,
      updatedAt: now(),
      provider: normalized.policy.provider,
      model: normalized.policy.model,
      roles: normalized.policy.roles,
      tokenLimit: normalized.policy.tokenLimit,
    }
    const written = writeJsonAtomic(file, payload)
    if (written.ok !== true) {
      try {
        logger?.warn?.(`[dsh-little-whale] 写入模型策略失败：${written.message ?? ''}`)
      } catch (warnError) {
        void warnError
      }
      return {
        ok: false,
        message: written.message ?? 'write failed',
        policy: normalized.policy,
        errors: normalized.errors,
      }
    }
    cache = null
    return { ok: true, policy: normalized.policy, errors: normalized.errors, updatedAt: payload.updatedAt }
  }

  function reset() {
    return write(emptyModelPolicy())
  }

  function snapshot() {
    const state = read()
    return {
      ok: true,
      file,
      exists: state.exists,
      version: MODEL_POLICY_STORE_VERSION,
      policy: state.policy,
      errors: state.errors,
      updatedAt: state.updatedAt,
      lastReadAt: lastRead === null ? 0 : now(),
    }
  }

  return { file, read, write, reset, snapshot }
}
