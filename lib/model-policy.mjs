// lib/model-policy.mjs —— 角色化模型/推理策略（契约 v1.38 §2.21，task-65）。
//
// 用户允许挂件自选模型/推理强度。四个模型调用点（mood/selfTalk/growth/voice）各有自己的
// role，可分别使用不同 provider/model/reasoningEffort：
//   · provider/model 默认取宿主当前默认选择（agentDefaultModel.currentSelection）；
//   · env `DSH_POETRY_MODEL_PROVIDER` / `DSH_POETRY_MODEL` 可全局覆盖；
//   · effort 默认：mood=low、selfTalk=high、growth=high、voice=high；
//   · env `DSH_POETRY_EFFORT_MOOD` / `DSH_POETRY_EFFORT_SELF_TALK` / `DSH_POETRY_EFFORT_GROWTH` /
//     `DSH_POETRY_EFFORT_VOICE` 可覆盖；非法值回退默认。
//
// `resolve(role)` 返回 `{provider, model, reasoningEffort?}` 或 null（selection/覆盖缺失时由
// 调用方回退旧行为）。策略是纯本地解析，不缓存 selection（宿主可能换模型）。
import os from 'node:os'

/** 合法 reasoning effort（当前宿主支持 off/low/high/max）。 */
export const MODEL_POLICY_EFFORTS = Object.freeze(['off', 'low', 'high', 'max'])
/** 四个模型调用角色。 */
export const MODEL_POLICY_ROLES = Object.freeze(['mood', 'selfTalk', 'growth', 'voice'])
/** 各角色默认 effort。 */
export const MODEL_POLICY_DEFAULT_EFFORTS = Object.freeze({
  mood: 'low',
  selfTalk: 'high',
  growth: 'high',
  voice: 'high',
})
/** 各角色 effort 的环境变量名（契约 v1.38：DSH_POETRY_REASONING_*）。 */
export const MODEL_POLICY_EFFORT_ENV = Object.freeze({
  mood: 'DSH_POETRY_REASONING_MOOD',
  selfTalk: 'DSH_POETRY_REASONING_SELF_TALK',
  growth: 'DSH_POETRY_REASONING_GROWTH',
  voice: 'DSH_POETRY_REASONING_VOICE',
})

/** 默认策略（只含各角色 effort；provider/model 由宿主 selection 决定）。 */
export const MODEL_POLICY_DEFAULTS = Object.freeze({
  provider: null,
  model: null,
  roles: Object.freeze({
    mood: Object.freeze({ reasoningEffort: 'low' }),
    selfTalk: Object.freeze({ reasoningEffort: 'high' }),
    growth: Object.freeze({ reasoningEffort: 'high' }),
    voice: Object.freeze({ reasoningEffort: 'high' }),
  }),
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 归一化 effort：合法值返回小写，否则返回 fallback（也可是 null）。 */
export function normalizeEffort(value, fallback = null) {
  if (typeof value !== 'string') return fallback
  const effort = value.trim().toLowerCase()
  if (effort.length === 0) return fallback
  return MODEL_POLICY_EFFORTS.includes(effort) ? effort : fallback
}

function readEnvText(env, name) {
  if (!isPlainObject(env)) return ''
  const value = env[name]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 创建角色化模型策略。
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   getSelection?: () => {provider?: string, model?: string, reasoningEffort?: string}|null|undefined,
 * }} [options]
 */
export function createModelPolicy(options = {}) {
  const env = options.env ?? process.env
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null

  function baseSelection() {
    try {
      const selection = getSelection()
      if (!isPlainObject(selection)) return null
      const provider = typeof selection.provider === 'string' ? selection.provider.trim() : ''
      const model = typeof selection.model === 'string' ? selection.model.trim() : ''
      return { provider, model }
    } catch {
      return null
    }
  }

  /** 角色 effort：env 覆盖 → 角色默认；非法 env 值回退默认。 */
  function effortFor(role) {
    const fallback = MODEL_POLICY_DEFAULT_EFFORTS[role] ?? null
    const envName = MODEL_POLICY_EFFORT_ENV[role]
    if (envName !== undefined) {
      const override = readEnvText(env, envName)
      if (override.length > 0) return normalizeEffort(override, fallback)
    }
    return fallback
  }

  /**
   * 解析某角色实际使用的 provider/model/effort。
   * @param {'mood'|'selfTalk'|'growth'|'voice'} role
   * @returns {{provider:string, model:string, reasoningEffort?:string}|null}
   */
  function resolve(role) {
    if (!MODEL_POLICY_ROLES.includes(role)) return null
    const selection = baseSelection()
    const provider =
      readEnvText(env, 'DSH_POETRY_MODEL_PROVIDER') || (selection !== null ? selection.provider : '')
    const model = readEnvText(env, 'DSH_POETRY_MODEL') || (selection !== null ? selection.model : '')
    if (provider.length === 0 || model.length === 0) return null
    const reasoningEffort = effortFor(role)
    return reasoningEffort !== null ? { provider, model, reasoningEffort } : { provider, model }
  }

  /** 空环境/缺 selection 的安全默认（便于测试与描述）。 */
  function defaults() {
    const out = {}
    for (const role of MODEL_POLICY_ROLES) out[role] = { reasoningEffort: effortFor(role) }
    return out
  }

  return { resolve, defaults, effortFor }
}

/** 角色中文标签（日志用）。 */
export const MODEL_POLICY_ROLE_LABELS = Object.freeze({
  mood: '心情',
  selfTalk: '碎碎念',
  growth: '成长',
  voice: '声音',
})

/** 一行可读描述（日志/诊断用；resolve 失败的角色标记 none）。 */
export function describeModelPolicy(policy) {
  if (policy === null || policy === undefined || typeof policy.resolve !== 'function') return 'none'
  const parts = []
  for (const role of MODEL_POLICY_ROLES) {
    let picked = null
    try {
      picked = policy.resolve(role)
    } catch {
      picked = null
    }
    const label = MODEL_POLICY_ROLE_LABELS[role] ?? role
    if (picked === null) {
      parts.push(`${label}=none`)
      continue
    }
    parts.push(`${label}=${picked.provider}/${picked.model}${picked.reasoningEffort ? `(${picked.reasoningEffort})` : ''}`)
  }
  return parts.join('; ')
}

/** 兼容/工具：宿主 home 不参与策略解析（保持纯函数语义；导出便于未来扩展）。 */
export function resolveModelPolicyHome(env = process.env) {
  return env.HOME || os.homedir()
}
