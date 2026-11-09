// @ts-check
// lib/kernel/model-call.mjs —— 统一模型调用层（W1）
//
// 目的：把“角色 token 下限 / EMPTY_RESPONSE 自动重试 / 解析失败落原始输出”
// 从各业务模块里收回来。业务只提供 prompt、parse 和可选的 attempts。
//
// 用法：
//   const result = await callRole('knowledge_extract', {
//     attempts: [{ maxTokens: 8000, prompt }, { maxTokens: 12000, prompt: shortPrompt }],
//     parse: parseKnowledgeExtraction,
//     debugFile: path, policy, resolveLlm, modelErrorsPath, warn,
//   })
//   if (!result.ok) { ... }
import { writeFileSync } from 'node:fs'
import { callModelForRole } from './llm-call.mjs'

export const MODEL_ROLE_PROFILES = Object.freeze({
  knowledge_extract: {
    role: 'consolidate',
    maxTokens: 8000,
    timeoutMs: 120000,
    timeoutCode: 'GRAPH_EXTRACT_TIMEOUT',
    timeoutMessage: '认知图谱抽取超时',
    prefix: '认知图谱候选失败',
  },
  worldview: {
    role: 'consolidate',
    maxTokens: 5000,
    timeoutMs: 120000,
    timeoutCode: 'WORLDVIEW_TIMEOUT',
    timeoutMessage: '世界观整理超时',
    prefix: '世界观整理候选失败',
  },
})

function writeDebug(file, payload) {
  if (typeof file !== 'string' || file.length === 0) return
  try {
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    /* 诊断写盘失败不影响主流程 */
  }
}

/**
 * 创建调用器（测试可注入 invoke）。
 * @param {{ invoke?: Function }} deps
 */
export function createModelCaller(deps = {}) {
  const invoke = typeof deps.invoke === 'function' ? deps.invoke : callModelForRole
  /**
   * @typedef {object} CallRoleOptions
   * @property {Array<{ maxTokens?: number, timeoutMs?: number, prompt?: string }>} [attempts]
   * @property {string} [prompt]
   * @property {string} [system]
   * @property {number} [maxTokens]
   * @property {string} [role]
   * @property {unknown} [policy]
   * @property {Function|null} [resolveLlm]
   * @property {string|null} [modelErrorsPath]
   * @property {Function} [warn]
   * @property {(attempt: object, index: number) => string} [buildPrompt]
   * @property {(text: string) => any} [parse]
   * @property {string} [debugFile]
   */

  /**
   * @param {string} profileId - 见 MODEL_ROLE_PROFILES
   * @param {CallRoleOptions} options
   */
  async function callRole(profileId, options = {}) {
    const profile = MODEL_ROLE_PROFILES[profileId] ?? {}
    /** @type {Array<{ maxTokens?: number, timeoutMs?: number, prompt?: string }>} */
    const attempts =
      Array.isArray(options.attempts) && options.attempts.length > 0
        ? options.attempts
        : [{ maxTokens: options.maxTokens ?? profile.maxTokens ?? 3000 }]
    let lastRaw = ''
    let lastMessage = ''
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index] ?? {}
      const prompt =
        typeof attempt.prompt === 'string'
          ? attempt.prompt
          : typeof options.buildPrompt === 'function'
            ? options.buildPrompt(attempt, index)
            : String(options.prompt ?? '')
      if (prompt.length === 0) continue
      const result = await invoke({
        role: profile.role ?? options.role ?? 'growth',
        policy: options.policy ?? null,
        resolveLlm: options.resolveLlm ?? null,
        system: options.system ?? profile.system ?? '',
        prompt,
        maxTokens: attempt.maxTokens ?? profile.maxTokens ?? 3000,
        timeoutMs: attempt.timeoutMs ?? profile.timeoutMs ?? 90000,
        timeoutCode: profile.timeoutCode ?? 'MODEL_TIMEOUT',
        timeoutMessage: profile.timeoutMessage ?? '模型调用超时',
        prefix: profile.prefix ?? '模型候选失败',
        modelErrorsPath: options.modelErrorsPath ?? null,
        warn: typeof options.warn === 'function' ? options.warn : undefined,
      })
      if (result === null || result === undefined) {
        lastMessage = 'empty'
        continue
      }
      const text = String(result.text ?? '')
      lastRaw = text
      let parsed = text
      if (typeof options.parse === 'function') {
        try {
          parsed = options.parse(text)
        } catch {
          parsed = null
        }
      }
      if (parsed !== null && parsed !== undefined) {
        return { ok: true, parsed, text, attempts: index + 1, provider: result.provider, model: result.model }
      }
      lastMessage = text.length > 0 ? 'invalid' : 'empty'
    }
    writeDebug(options.debugFile, {
      at: Date.now(),
      profile: profileId,
      error: lastMessage,
      raw: lastRaw.slice(0, 3000),
    })
    return { ok: false, error: lastMessage || 'empty', text: lastRaw, attempts: attempts.length }
  }
  return { callRole }
}

const defaultCaller = createModelCaller()
export const callRole = defaultCaller.callRole

/**
 * 兼容旧调用点的统一入口：参数与 callModelForRole 相同，返回 { text, provider, model } | null。
 * 新代码优先用 callRole(profileId, ...)；这个适配器用于把历史调用点逐步收进同一层。
 * @param {object} options
 */
export async function callModel(options = {}) {
  const opts = /** @type {any} */ (options)
  const maxTokens = Number.isFinite(opts.maxTokens) ? opts.maxTokens : 3000
  const attempts = Array.isArray(opts.attempts) && opts.attempts.length > 0 ? opts.attempts : [{ maxTokens }]
  const caller = createModelCaller()
  const result = await caller.callRole('generic', {
    ...opts,
    attempts,
    parse: null,
    debugFile: opts.debugFile ?? null,
  })
  if (result.ok !== true) return null
  return { text: result.text, provider: result.provider, model: result.model }
}
