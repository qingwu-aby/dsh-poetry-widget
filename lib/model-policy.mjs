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

/** 优先插件模型：opencode-go/deepseek-v4.1-flash（仅插件自己的模型调用使用，不改全局）。 */
export const MODEL_POLICY_OPENCODE_PROVIDER = 'opencode-go'
export const MODEL_POLICY_OPENCODE_DEFAULT_MODEL = 'deepseek-v4.1-flash'

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
 *   getProviders?: () => unknown,
 * }} [options]
 */
export function createModelPolicy(options = {}) {
  const env = options.env ?? process.env
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const getProviders = typeof options.getProviders === 'function' ? options.getProviders : null

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

  /** 环境是否显式指定了完整 provider+model（显式覆盖 → 单候选）。 */
  function explicitModelOverride() {
    const provider = readEnvText(env, 'DSH_POETRY_MODEL_PROVIDER')
    const model = readEnvText(env, 'DSH_POETRY_MODEL')
    return provider.length > 0 && model.length > 0 ? { provider, model } : null
  }

  /** 是否关闭 opencode-go 优先（env 开关）。 */
  function opencodeDisabled() {
    return (
      readEnvText(env, 'DSH_POETRY_OPENCODE_GO') === '0' ||
      readEnvText(env, 'DSH_POETRY_MODEL_PRIORITY').toLowerCase() === 'deepseek-account'
    )
  }

  /**
   * 探测宿主可用 provider：
   *   · 返回数组 → 已知列表；
   *   · Promise / 抛错 / 无 getProviders → null（未知，按「可能有 opencode-go」处理，不阻塞）。
   */
  function knownProviders() {
    if (getProviders === null) return null
    try {
      const value = getProviders()
      if (value !== null && value !== undefined && typeof value.then === 'function') return null
      if (!Array.isArray(value)) return null
      return value
        .map((item) => {
          if (typeof item === 'string') return item.toLowerCase()
          if (isPlainObject(item)) {
            const id = typeof item.id === 'string' ? item.id : typeof item.provider === 'string' ? item.provider : typeof item.name === 'string' ? item.name : ''
            return id.toLowerCase()
          }
          return ''
        })
        .filter((id) => id.length > 0)
    } catch {
      return null
    }
  }

  /** selection 候选（env 部分覆盖 provider/model 可与 selection 合并）。 */
  function selectionCandidate() {
    const selection = baseSelection()
    const provider =
      readEnvText(env, 'DSH_POETRY_MODEL_PROVIDER') || (selection !== null ? selection.provider : '')
    const model = readEnvText(env, 'DSH_POETRY_MODEL') || (selection !== null ? selection.model : '')
    return provider.length > 0 && model.length > 0 ? { provider, model } : null
  }

  function dedupeCandidates(list) {
    const out = []
    const seen = new Set()
    for (const candidate of list) {
      const key = `${candidate.provider}\u0000${candidate.model}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(candidate)
    }
    return out
  }

  /**
   * 解析某角色的候选模型顺序（插件自己的调用使用）：
   *   1. 环境显式 provider+model 覆盖 → 单候选；
   *   2. opencode-go（getProviders 有它或无法探测）→ 默认 deepseek-v4.1-flash（可 env 覆盖）；
   *   3. 宿主当前 selection；
   * 去重、按顺序返回；每个候选附带该 role 的 effort。
   * @param {'mood'|'selfTalk'|'growth'|'voice'} role
   * @returns {Array<{provider:string, model:string, reasoningEffort?:string}>}
   */
  function resolveCandidates(role) {
    if (!MODEL_POLICY_ROLES.includes(role)) return []
    const effort = effortFor(role)
    const withEffort = (candidate) => (effort !== null ? { ...candidate, reasoningEffort: effort } : { ...candidate })
    const explicit = explicitModelOverride()
    if (explicit !== null) return [withEffort(explicit)]

    const list = []
    if (!opencodeDisabled()) {
      const providers = knownProviders()
      const hasOpencode = providers === null || providers.some((id) => id.includes(MODEL_POLICY_OPENCODE_PROVIDER))
      if (hasOpencode) {
        const model = readEnvText(env, 'DSH_POETRY_OPENCODE_MODEL') || MODEL_POLICY_OPENCODE_DEFAULT_MODEL
        list.push(withEffort({ provider: MODEL_POLICY_OPENCODE_PROVIDER, model }))
      }
    }
    const selection = selectionCandidate()
    if (selection !== null) list.push(withEffort(selection))
    return dedupeCandidates(list)
  }

  /**
   * 解析某角色实际使用的 provider/model/effort（首候选；保留兼容）。
   * @param {'mood'|'selfTalk'|'growth'|'voice'} role
   * @returns {{provider:string, model:string, reasoningEffort?:string}|null}
   */
  function resolve(role) {
    const candidates = resolveCandidates(role)
    return candidates.length > 0 ? candidates[0] : null
  }

  /** 空环境/缺 selection 的安全默认（便于测试与描述）。 */
  function defaults() {
    const out = {}
    for (const role of MODEL_POLICY_ROLES) out[role] = { reasoningEffort: effortFor(role) }
    return out
  }

  return { resolve, resolveCandidates, defaults, effortFor }
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
