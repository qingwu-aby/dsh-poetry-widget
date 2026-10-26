// lib/llm-call.mjs —— 插件内统一的模型调用（v1.72，P0-1 重构）。
//
// 之前 self-talk / mood-ai / self-growth / self-drive / voice / wander / reading /
// netlang / memory-layers 各自实现了一遍「按候选顺序尝试 + 超时 + abort + 空响应 +
// finish 错误 + 记录 model-errors」。这里把这段抽成唯一实现：
//   · callCandidate：单个候选的一次调用（带超时、finish 错误处理、失败记录）；
//   · callModelForRole：按 policy.resolveCandidates(role) 顺序尝试，返回 {text,provider,model}|null；
//   · resolveCandidatesForRole / resolveLlmSafe：常用小工具。
// 各业务模块只需提供 role / prompt / 预算 / 超时文案 / 失败前缀，不再复制循环。
import { describeModelRequest, recordModelFailure } from './model-errors.mjs'
import { resolveCandidateMaxTokens } from './model-policy.mjs'

// v1.81：全局模型运行时（预算 + 并发闸门）；由 index 装配，测试可重置。
let modelRuntime = { budget: null, gate: null }

/** 配置全局预算/闸门（index 启动时调用一次）。 */
export function configureModelRuntime(options = {}) {
  modelRuntime = {
    budget: options.budget ?? null,
    gate: options.gate ?? null,
  }
  return modelRuntime
}

/** 测试用：清空全局运行时。 */
export function resetModelRuntime() {
  modelRuntime = { budget: null, gate: null }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
}

/** 安全解析 LLM（供各服务的 getLlm/llm 两种传参方式复用）。 */
export function resolveLlmSafe(resolveLlm) {
  try {
    return typeof resolveLlm === 'function' ? resolveLlm() : null
  } catch {
    return null
  }
}

/** 解析某角色的候选列表（policy 缺失/异常 → 空）。 */
export function resolveCandidatesForRole(policy, role) {
  if (policy === null || policy === undefined || typeof policy.resolveCandidates !== 'function') return []
  try {
    const list = policy.resolveCandidates(role)
    return Array.isArray(list) ? list.filter((candidate) => isPlainObject(candidate)) : []
  } catch {
    return []
  }
}

/** 构造 llm.stream 的 options（统一 temperature / reasoningEffort / maxTokens 规则）。 */
function buildLlmOptions(options) {
  const candidate = options.candidate
  const next = {
    provider: candidate.provider,
    model: candidate.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: options.prompt }] }],
    system: options.system,
    maxTokens: resolveCandidateMaxTokens(options.maxTokens, candidate),
    ...(candidate.omitTemperature === true || candidate.provider === 'opencode-go'
      ? {}
      : { temperature: typeof options.temperature === 'number' ? options.temperature : 0.9 }),
    ...(candidate.omitReasoningEffort === true || candidate.provider === 'opencode-go'
      ? {}
      : candidate.reasoningEffort !== undefined
        ? { reasoningEffort: candidate.reasoningEffort }
        : {}),
  }
  if (options.signal !== undefined) next.signal = options.signal
  return next
}

/**
 * 单个候选的一次调用。
 * @param {{
 *   candidate: object,
 *   resolveLlm: () => object|undefined|null,
 *   system: string,
 *   prompt: string,
 *   maxTokens: number,
 *   temperature?: number,
 *   timeoutMs: number,
 *   timeoutCode: string,
 *   timeoutMessage: string,
 *   role: string,
 *   prefix?: string,
 *   modelErrorsPath?: string|null,
 *   warn?: (message: string) => void,
 *   honorFinishFailure?: boolean,
 * }} options
 * @returns {Promise<{ok: true, text: string, request: object|null} | {ok: false, retryable: boolean, message: string, request: object|null}>}
 */
export async function callCandidate(options) {
  const candidate = options.candidate
  // v1.81：先过每日预算，再排队（并发闸门），最后才真正发模型请求。
  const budget = modelRuntime.budget
  if (budget !== null && typeof budget.tryConsume === 'function') {
    let permit = null
    try {
      permit = budget.tryConsume(options.role)
    } catch {
      permit = { ok: true }
    }
    if (permit !== null && permit.ok !== true) {
      return { ok: false, retryable: false, message: permit.message ?? '今日模型调用预算已用完', request: null }
    }
  }
  const gate = modelRuntime.gate
  const release = gate !== null && typeof gate.acquire === 'function' ? await gate.acquire() : null
  try {
  const warn = typeof options.warn === 'function' ? options.warn : () => {}
  const honorFinishFailure = options.honorFinishFailure !== false
  const timeoutMs = options.timeoutMs
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timerId = null
  let timedOut = false
  let text = ''
  let sawText = false
  let requestMeta = null
  const chunkTypes = Object.create(null)
  let finishKind = null
  let finishFailure = null
  const timeoutPromise = new Promise((_resolve, reject) => {
    timerId = setTimeout(() => {
      timedOut = true
      const error = new Error(options.timeoutMessage)
      error.code = options.timeoutCode
      reject(error)
    }, timeoutMs)
    // 不退订 timer：模型流可能悬挂在 Promise 上，超时定时器是唯一结算保障。
  })
  try {
    const llm = resolveLlmSafe(options.resolveLlm)
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
      return { ok: false, retryable: false, message: '宿主尚未配置默认模型', request: null }
    }
    const llmOptions = buildLlmOptions({
      candidate,
      system: options.system,
      prompt: options.prompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      signal: controller !== null ? controller.signal : undefined,
    })
    requestMeta = describeModelRequest(llmOptions, options.prompt)
    const collecting = (async () => {
      for await (const chunk of llm.stream(llmOptions)) {
        if (!isPlainObject(chunk)) continue
        const kind = typeof chunk.type === 'string' ? chunk.type : 'unknown'
        chunkTypes[kind] = (chunkTypes[kind] ?? 0) + 1
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
          if (chunk.text.length > 0) sawText = true
        } else if (chunk.type === 'finish' && isPlainObject(chunk.reason) && typeof chunk.reason.kind === 'string') {
          finishKind = chunk.reason.kind
          if (isPlainObject(chunk.reason.failure)) finishFailure = chunk.reason.failure
        }
      }
      return text
    })()
    collecting.catch(() => {})
    await Promise.race([collecting, timeoutPromise])
    const request = requestMeta ?? describeModelRequest(null, options.prompt)
    request.chunkTypes = { ...chunkTypes }
    if (finishKind !== null) request.finishKind = finishKind
    if (honorFinishFailure && (finishKind === 'error' || finishKind === 'aborted')) {
      const detail = finishFailure !== null ? String(finishFailure.code ?? finishFailure.message ?? '') : ''
      const failureCode = finishFailure !== null && (finishFailure.code !== undefined || finishFailure.message !== undefined)
        ? finishFailure.code ?? finishFailure.message
        : finishKind
      recordModelFailure({
        errorsPath: options.modelErrorsPath ?? null,
        warnFn: warn,
        role: options.role,
        provider: candidate.provider,
        model: candidate.model,
        error: {
          code: failureCode,
          message: detail.length > 0 ? detail : finishKind,
          ...(finishFailure !== null && finishFailure.status !== undefined ? { status: finishFailure.status } : {}),
        },
        request,
        prefix: options.prefix ?? `${options.role}候选失败`,
      })
      return {
        ok: false,
        retryable: !sawText,
        message: `模型生成失败${detail.length > 0 ? `（${detail}）` : ''}`,
        request,
      }
    }
    if (text.trim().length === 0) {
      recordModelFailure({
        errorsPath: options.modelErrorsPath ?? null,
        warnFn: warn,
        role: options.role,
        provider: candidate.provider,
        model: candidate.model,
        error: { code: 'EMPTY_RESPONSE', message: '模型没有返回文本' },
        request,
        prefix: options.prefix ?? `${options.role}候选失败`,
      })
      return { ok: false, retryable: true, message: '模型没有返回文本', request }
    }
    return { ok: true, text, request }
  } catch (error) {
    const failed = timedOut
    const message = failed ? options.timeoutMessage : `模型调用失败：${shortMessage(error)}`
    recordModelFailure({
      errorsPath: options.modelErrorsPath ?? null,
      warnFn: warn,
      role: options.role,
      provider: candidate.provider,
      model: candidate.model,
      error: failed ? { code: options.timeoutCode, message } : error,
      request: requestMeta ?? describeModelRequest(null, options.prompt),
      prefix: options.prefix ?? `${options.role}候选失败`,
    })
    return { ok: false, retryable: !sawText, message, request: requestMeta }
  } finally {
    if (timerId !== null) clearTimeout(timerId)
  }
  } finally {
    if (release !== null) release()
  }
}

/**
 * 按角色候选顺序调用模型（全部失败 → null；成功 → {text, provider, model}）。
 * 失败时按 retryable 决定是否换下一个候选（与旧实现一致：未产出任何文本才回退）。
 * @param {object} options 同 callCandidate，外加 policy
 */
export async function callModelForRole(options) {
  const policy = options.policy ?? null
  const candidates = resolveCandidatesForRole(policy, options.role)
  if (candidates.length === 0) return null
  let lastMessage = '宿主尚未配置默认模型'
  for (const candidate of candidates) {
    const result = await callCandidate({ ...options, candidate })
    if (result.ok === true) return { text: result.text, provider: candidate.provider, model: candidate.model }
    lastMessage = result.message
    if (result.retryable !== true) break
  }
  if (typeof options.warn === 'function') options.warn(lastMessage)
  return null
}
