// lib/domain/emotion/mood-ai.mjs —— 心情服务装配（纯函数在 mood-ai-core.mjs）
import {
  MOOD_AI_TIMEOUT_MS,
  MOOD_AI_CACHE_TTL_MS,
  MOOD_AI_MIN_INTERVAL_MS,
  MOOD_RECENT_LABELS_MAX,
  MOOD_RECENT_IMAGES_MAX,
  MOOD_AI_MAX_TOKENS,
  MOOD_AI_TEMPERATURE,
  MOOD_AI_SYSTEM_PROMPT,
  moodAiUnavailable,
  moodAiRateLimited,
  resolveMoodCandidates,
  buildMoodPrompt,
  parseMoodResult,
  shortMessage,
  isPlainObject,
  normalizeSelection,
} from './mood-ai-core.mjs'
import { normalizeEffort } from '../../legacy/model-policy.mjs'
import { callCandidate } from '../../legacy/llm-call.mjs'

export * from './mood-ai-core.mjs'

export function createMoodAiService(options = {}) {
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : MOOD_AI_TIMEOUT_MS
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : MOOD_AI_CACHE_TTL_MS
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : MOOD_AI_MIN_INTERVAL_MS
  const random = typeof options.random === 'function' ? options.random : Math.random
  const policy = options.policy ?? null
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  const catalog = options.catalog ?? null
  // v1.50：她自己造过的感受词（可被拿来当 mood label；配图仍在图鉴里选最接近的）。
  const feelingsSource = options.feelings ?? null

  /** @type {{response: object, at: number}|null} */
  let cache = null
  let lastStartedAt = 0
  /** @type {Promise<object>|null} */
  let inFlight = null
  /**
   * v1.20（M27）：本 service 最近成功生成过的 image（≤20，oldest→newest）。
   * 即使客户端没传/传了旧 recentImages，宿主也能保证不连续重复选最近生成过的图。
   * 只内存、不落盘；失败与缓存命中不入队。
   * @type {string[]}
   */
  const recentlyGeneratedImages = []
  /** v1.48：最近成功生成的心情标签（环形，≤MOOD_RECENT_LABELS_MAX），用于 prompt 反重复。 */
  const recentlyGeneratedLabels = []

  /** 记录一次成功生成的 image（去重后放队尾，超过上限淘汰最旧）。 */
  function rememberGeneratedImage(image) {
    if (typeof image !== 'string' || image.length === 0) return
    const existing = recentlyGeneratedImages.indexOf(image)
    if (existing >= 0) recentlyGeneratedImages.splice(existing, 1)
    recentlyGeneratedImages.push(image)
    while (recentlyGeneratedImages.length > MOOD_RECENT_IMAGES_MAX) recentlyGeneratedImages.shift()
  }

  /** 记录一条最近心情标签（去重 + 环形淘汰）。 */
  function rememberGeneratedLabel(label) {
    const text = typeof label === 'string' ? label : ''
    if (text.length === 0) return
    const existing = recentlyGeneratedLabels.indexOf(text)
    if (existing >= 0) recentlyGeneratedLabels.splice(existing, 1)
    recentlyGeneratedLabels.push(text)
    while (recentlyGeneratedLabels.length > MOOD_RECENT_LABELS_MAX) recentlyGeneratedLabels.shift()
  }

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function readSelection() {
    try {
      return normalizeSelection(getSelection())
    } catch (error) {
      warn(`读取默认模型失败：${shortMessage(error)}`)
      return null
    }
  }

  /** v1.38：按 role 从 model policy 取 provider/model/reasoningEffort；无 policy/缺失返回 null。 */
  function policySelection(role) {
    if (policy === null || policy === undefined) return null
    try {
      const picked =
        typeof policy === 'function'
          ? policy(role)
          : typeof policy.forRole === 'function'
            ? policy.forRole(role)
            : typeof policy.resolve === 'function'
              ? policy.resolve(role)
              : null
      if (!isPlainObject(picked)) return null
      const provider = typeof picked.provider === 'string' ? picked.provider.trim() : ''
      const model = typeof picked.model === 'string' ? picked.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return null
      const effort = normalizeEffort(picked.reasoningEffort)
      return effort !== null ? { provider, model, reasoningEffort: effort } : { provider, model }
    } catch {
      return null
    }
  }

  /** v1.39：按 role 取候选模型列表（policy.resolveCandidates → 单候选 → selection）。 */
  function modelCandidates(role) {
    const out = []
    const seen = new Set()
    const push = (candidate) => {
      if (!isPlainObject(candidate)) return
      const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
      const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
      if (provider.length === 0 || model.length === 0) return
      const key = `${provider}\u0000${model}`
      if (seen.has(key)) return
      seen.add(key)
      const effort = normalizeEffort(candidate.reasoningEffort)
      out.push({
        provider,
        model,
        ...(effort !== null ? { reasoningEffort: effort } : {}),
        ...(candidate.omitTemperature === true ? { omitTemperature: true } : {}),
        ...(candidate.omitReasoningEffort === true ? { omitReasoningEffort: true } : {}),
        ...(Number.isFinite(candidate.maxTokensFloor) ? { maxTokensFloor: candidate.maxTokensFloor } : {}),
      })
    }
    try {
      if (policy !== null && policy !== undefined && typeof policy.resolveCandidates === 'function') {
        const candidates = policy.resolveCandidates(role)
        if (Array.isArray(candidates)) for (const candidate of candidates) push(candidate)
      }
    } catch {
      /* ignore */
    }
    if (out.length === 0) {
      push(policySelection(role))
      push(readSelection())
    }
    return out
  }

  function cachedResponse() {
    if (cache === null) return null
    return { ...cache.response, cached: true }
  }

  /** 读取她自己造过的新感受（最近 limit 条；失败返回空）。 */
  function readCustomFeelings(limit = 10) {
    try {
      if (feelingsSource === null || feelingsSource === undefined) return []
      let entries = []
      if (typeof feelingsSource.recent === 'function') entries = feelingsSource.recent(limit)
      else if (typeof feelingsSource.read === 'function') {
        const read = feelingsSource.read()
        entries = read !== null && read !== undefined && Array.isArray(read.entries) ? read.entries.slice(-limit) : []
      } else if (Array.isArray(feelingsSource)) entries = feelingsSource.slice(-limit)
      const out = []
      for (const item of Array.isArray(entries) ? entries : []) {
        if (item === null || typeof item !== 'object') continue
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        const description = typeof item.description === 'string' ? item.description.trim() : ''
        if (name.length === 0 || description.length === 0) continue
        out.push({ name, description })
      }
      return out
    } catch {
      return []
    }
  }



  async function doGenerate(context) {
    if (catalog === null || catalog === undefined) return moodAiUnavailable('心情图鉴不可用')
    const startedAt = now()
    lastStartedAt = startedAt
    const llm = (() => {
      try {
        return resolveLlm()
      } catch (error) {
        warn(`获取 llm 服务失败：${shortMessage(error)}`)
        return null
      }
    })()
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
      return moodAiUnavailable('当前宿主的模型服务不可用')
    }
    const candidates = modelCandidates('mood')
    if (candidates.length === 0) return moodAiUnavailable('宿主尚未配置默认模型')

    const promptContext = isPlainObject(context) ? context : {}
    // v1.50：把她自造的情绪词汇带进心情 prompt（她可以拿自己的词当 label）。
    const customFeelings = readCustomFeelings(10)
    // v1.13：排除最近用过的图 + 打乱候选顺序（同步传给 prompt 与 parse，保证候选语义一致）。
    // v1.20：把客户端 recentImages 与本 service 最近生成过的 image 合并作为排除集合（宿主兜底）。
    const clientRecentImages = Array.isArray(promptContext.recentImages) ? promptContext.recentImages : []
    const mergedRecentImages = [...recentlyGeneratedImages, ...clientRecentImages]
    const plan = resolveMoodCandidates(catalog, mergedRecentImages, { random })
    const userPrompt = buildMoodPrompt(
      {
        ...promptContext,
        now: startedAt,
        recentMoodLabels: [...recentlyGeneratedLabels],
        customFeelings,
      },
      catalog,
      { plan },
    )

    /** 单个候选的一次尝试（独立超时；仅在未产出任何文本前失败才可回退）。 */
    async function attempt(candidate) {
      const result = await callCandidate({
        candidate,
        resolveLlm,
        system: MOOD_AI_SYSTEM_PROMPT,
        prompt: userPrompt,
        maxTokens: MOOD_AI_MAX_TOKENS,
        temperature: MOOD_AI_TEMPERATURE,
        timeoutMs,
        timeoutCode: 'MOOD_AI_TIMEOUT',
        timeoutMessage: `心情生成超时（${timeoutMs}ms）`,
        role: 'mood',
        prefix: '心情生成候选失败',
        modelErrorsPath,
        warn,
        honorFinishFailure: true,
      })
      if (result.ok !== true) return result
      // v1.21：排除只影响 prompt 候选；模型返回的图只要在图鉴内就接受（即便在最近用过/ring 里）。
      const parsed = parseMoodResult(result.text, catalog, { now: startedAt })
      if (!parsed.ok) return { ok: false, retryable: false, message: parsed.message }
      rememberGeneratedLabel(parsed.mood.label)
      return { ok: true, parsed }
    }

    let outcome = null
    let lastMessage = '心情生成失败'
    for (const candidate of candidates) {
      const result = await attempt(candidate)
      if (result.ok === true) {
        outcome = { result, candidate }
        break
      }
      lastMessage = result.message
      if (result.retryable !== true) return moodAiUnavailable(result.message)
      // 未产出任何文本 → 继续尝试下一个候选（不 warn 噪音，最后失败再返回）。
    }
    if (outcome === null) return moodAiUnavailable(lastMessage)

    const parsed = outcome.result.parsed
    // v1.20：成功的新生成才记入宿主去重 ring（失败/缓存命中不记）。
    rememberGeneratedImage(parsed.mood.image)
    const generatedAt = now()
    const response = {
      ok: true,
      mood: parsed.mood,
      model: { provider: outcome.candidate.provider, model: outcome.candidate.model },
      generatedAt,
      cached: false,
    }
    cache = { response, at: generatedAt }
    return response
  }

  /**
   * 生成/读取一次模型心情。
   * @param {object} context - 非敏感聚合上下文（moodKey/weather/stats/idleMinutes/recent/recentImages）
   * @param {{force?: boolean}} [requestOptions]
   * @returns {Promise<object>}
   */
  async function generate(context, requestOptions = {}) {
    const force = requestOptions !== undefined && requestOptions !== null && requestOptions.force === true
    if (inFlight !== null) {
      const shared = await inFlight
      if (isPlainObject(shared) && shared.ok === true) return { ...shared, cached: true }
      return shared
    }
    if (!force && cache !== null && now() - cache.at < cacheTtlMs) {
      const reused = cachedResponse()
      if (reused !== null) return reused
    }
    const current = now()
    if (lastStartedAt > 0 && current - lastStartedAt < minIntervalMs) {
      const reused = cachedResponse()
      if (reused !== null) return reused
      return moodAiRateLimited(`心情生成太频繁（最小间隔 ${minIntervalMs}ms）`)
    }
    const task = doGenerate(context).catch((error) => {
      warn(`心情生成异常：${shortMessage(error)}`)
      return moodAiUnavailable('心情暂不可用')
    })
    inFlight = task
    try {
      return await task
    } finally {
      if (inFlight === task) inFlight = null
    }
  }

  return {
    generate,
    /** 测试/诊断用：当前缓存快照。 */
    peekCache: () => (cache === null ? null : { ...cache.response, cached: true }),
    /** 测试/诊断用：最近成功生成过的 image（oldest→newest，≤20）。 */
    peekRecentGenerated: () => [...recentlyGeneratedImages],
    peekRecentLabels: () => [...recentlyGeneratedLabels],
    clearCache: () => {
      cache = null
    },
  }
}

