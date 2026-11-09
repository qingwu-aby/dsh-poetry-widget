// lib/self-talk.mjs —— 碎碎念服务装配（纯函数/提示词在 self-talk-core.mjs）
import {
  SELF_TALK_MIN_INTERVAL_MS,
  SELF_TALK_TIMEOUT_MS,
  SELF_TALK_BATCH,
  SELF_TALK_RECENT_CACHE,
  SELF_TALK_RECENT_MAX,
  SELF_TALK_RECENT_MAX_CHARS,
  SELF_TALK_MAX_TOKENS,
  SELF_TALK_TEMPERATURE,
  pickSelfTalkTheme,
  SELF_TALK_SYSTEM_PROMPT,
  selfTalkUnavailable,
  dayPeriod,
  selectDiverseSelfTalkLines,
  buildSelfTalkPrompt,
  parseSelfTalkLines,
  isPlainObject,
  sanitizeInline,
  normalizeSelection,
} from './self-talk-core.mjs'

export * from './self-talk-core.mjs'
import { callCandidate } from './llm-call.mjs'
import { formatMemoryDigest } from './memory-recall.mjs'
import { normalizeEffort } from './model-policy.mjs'
import { VOICE_FALLBACK_THROTTLE_MS } from './voice-memory.mjs'
import { SELF_TALK_TOPIC_RECENT_MAX, pickSelfTalkTopic } from './self-talk-topics.mjs'

export function createSelfTalkService(options = {}) {
  const resolveLlm =
    typeof options.getLlm === 'function'
      ? options.getLlm
      : typeof options.llm === 'function'
        ? options.llm
        : () => options.llm
  const getSelection = typeof options.getSelection === 'function' ? options.getSelection : () => null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : SELF_TALK_MIN_INTERVAL_MS
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : SELF_TALK_TIMEOUT_MS
  const batch = Number.isFinite(options.batch) && options.batch > 0 ? Math.min(SELF_TALK_BATCH, Math.floor(options.batch)) : SELF_TALK_BATCH
  const recentCacheSize = Number.isFinite(options.recentCacheSize) ? options.recentCacheSize : SELF_TALK_RECENT_CACHE
  const random = typeof options.random === 'function' ? options.random : Math.random
  const fixedTheme = typeof options.theme === 'string' ? sanitizeInline(options.theme, 40) : ''
  // v2.2：默认不再从固定主题数组里挑；只有显式给 theme 或把概率调高时才带主题。
  const themeProbability =
    Number.isFinite(options.themeProbability) && options.themeProbability >= 0 && options.themeProbability <= 1
      ? options.themeProbability
      : 0
  // v2.2：话题库默认不参与“挑一个话题”；需要时用 DSH_POETRY_TALK_TOPICS=on 打开。
  const topicsEnabled = options.topicsEnabled === true
  /** v1.26：话题库来源（数组或带 read() 的读取器，读取器自带 mtime 缓存）。 */
  const topicsSource = options.topics ?? null
  /** v1.33：记忆检索器（只读 journal/learning-log/topics，异常静默）。 */
  const memoryRecall = options.recall ?? null
  /** v2.19：共享事件状态（叙事通道也计入事件饱和）。 */
  const events = options.events ?? null
  const onEventSatiated = typeof options.onEventSatiated === 'function' ? options.onEventSatiated : null
  const notifiedSatiated = new Set()
  /** v1.38：按 role 选择 provider/model/reasoningEffort。 */
  const policy = options.policy ?? null
  /** v1.41：模型失败诊断文件（null 则不落盘，只 warn）。 */
  const modelErrorsPath =
    typeof options.modelErrorsPath === 'string' && options.modelErrorsPath.length > 0 ? options.modelErrorsPath : null
  /** v1.34：声音档案 getter（函数或 {get()}；缺失/异常返回 null）。 */
  const voiceSource = options.voice ?? null
  /** v1.35：voice 为空时的兜底刷新回调（fire-and-forget，≥5min 节流，不阻塞响应）。 */
  const refreshVoice = typeof options.refreshVoice === 'function' ? options.refreshVoice : null
  let lastVoiceRefreshAttemptAt = 0

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

  function readVoice() {
    try {
      const value =
        typeof voiceSource === 'function'
          ? voiceSource()
          : voiceSource !== null && voiceSource !== undefined && typeof voiceSource.get === 'function'
            ? voiceSource.get()
            : null
      if (!isPlainObject(value)) return null
      const profile = typeof value.profile === 'string' ? value.profile.trim() : ''
      if (profile.length === 0) return null
      const exemplars = Array.isArray(value.exemplars)
        ? value.exemplars.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 3)
        : []
      return { profile, exemplars }
    } catch {
      return null
    }
  }
  /** 最近用过的 topic id（ring ≤30，成功后记录；失败不记）。 */
  const recentTopicIds = []

  /** 读取话题库条目；任何异常都降级为空（不影响自言自语）。 */
  function readTopics() {
    try {
      if (Array.isArray(topicsSource)) return topicsSource
      if (topicsSource !== null && topicsSource !== undefined && typeof topicsSource.read === 'function') {
        const result = topicsSource.read()
        return result !== null && result !== undefined && Array.isArray(result.entries) ? result.entries : []
      }
      if (typeof topicsSource === 'function') {
        const result = topicsSource()
        return Array.isArray(result) ? result : []
      }
      return []
    } catch (error) {
      warn(`读取话题库失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  function rememberTopic(topicId) {
    if (typeof topicId !== 'string' || topicId.length === 0) return
    const existing = recentTopicIds.indexOf(topicId)
    if (existing >= 0) recentTopicIds.splice(existing, 1)
    recentTopicIds.push(topicId)
    while (recentTopicIds.length > SELF_TALK_TOPIC_RECENT_MAX) recentTopicIds.shift()
  }

  /** 最近生成过的句子（用于跨请求去重，上限 20）。 */
  const generatedRecent = []
  /** @type {{ok:true,lines:Array<{text:string,ts:number}>,model:{provider:string,model:string},generatedAt:number,cached:boolean}|null} */
  let lastResult = null
  let lastStartedAt = 0
  /** @type {Promise<object>|null} */
  let inFlight = null

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
      warn(`读取默认模型失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /** v1.38：按 role 从 policy 取 provider/model/reasoningEffort；无 policy/缺失返回 null。 */
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

  function rememberLines(texts) {
    for (const text of texts) {
      generatedRecent.push(text)
      if (generatedRecent.length > recentCacheSize) generatedRecent.splice(0, generatedRecent.length - recentCacheSize)
    }
  }

  function cachedResponse() {
    if (lastResult === null) return null
    return { ...lastResult, cached: true }
  }



  async function doGenerate(context) {
    const eventNow = events !== null && typeof events.describe === 'function' ? events.describe(now()) : null
    if (eventNow !== null && eventNow.satiated === true) {
      return selfTalkUnavailable('这件事已经说够了，先安静一会儿', 'SELF_TALK_EVENT_SATIATED')
    }
    const request = isPlainObject(context) ? context : {}
    // intro 已废弃（v1.8b）：统一按 murmur 生成纯随想。
    const kind = 'murmur'
    const startedAt = now()
    lastStartedAt = startedAt
    const llm = (() => {
      try {
        return resolveLlm()
      } catch (error) {
        warn(`获取 llm 服务失败：${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    })()
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
      return selfTalkUnavailable('当前宿主的模型服务不可用')
    }
    const candidates = modelCandidates('selfTalk')
    if (candidates.length === 0) return selfTalkUnavailable('宿主尚未配置默认模型')

    // v1.26：从话题库按「心情/天气/最近在做/体验/时段」挑一个话题（排除最近 30 个）；
    // 有 topic 时用 topic，没有话题库时退回 v1.22 的随机小主题。
    const topic = topicsEnabled
      ? pickSelfTalkTopic(
          readTopics(),
          {
            moodKey: request.moodKey,
            moodLabel: request.moodLabel,
            weather: request.weather,
            period: dayPeriod(startedAt),
          },
          recentTopicIds,
          { random, now: startedAt },
        )
      : null
    const theme =
      topic !== null
        ? ''
        : fixedTheme.length > 0
          ? fixedTheme
          : random() < themeProbability
            ? pickSelfTalkTheme(random)
            : ''
    const recentForPrompt = [...(Array.isArray(request.recent) ? request.recent : []), ...generatedRecent]
    // v1.33：带当前情境做一次记忆检索（失败静默为空）。
    let memoryDigest = ''
    try {
      if (memoryRecall !== null && typeof memoryRecall.digest === 'function') {
        memoryDigest = formatMemoryDigest(
          memoryRecall.digest({
            moodKey: request.moodKey,
            moodLabel: request.moodLabel,
            weather: request.weather,
            topic,
            recentTexts: recentForPrompt,
          }),
        )
      }
    } catch {
      memoryDigest = ''
    }
    const voiceNow = readVoice()
    if (voiceNow === null && refreshVoice !== null) {
      const current = now()
      if (lastVoiceRefreshAttemptAt === 0 || current - lastVoiceRefreshAttemptAt >= VOICE_FALLBACK_THROTTLE_MS) {
        lastVoiceRefreshAttemptAt = current
        try {
          // fire-and-forget：不 await，失败静默，绝不阻塞 self-talk 响应。
          Promise.resolve(refreshVoice()).catch(() => {})
        } catch {
          /* ignore */
        }
      }
    }
    const userPrompt = buildSelfTalkPrompt({
      kind,
      theme,
      topic,
      memoryDigest,
      voice: voiceNow,
      now: startedAt,
      weather: request.weather,
      moodKey: request.moodKey,
      moodLabel: request.moodLabel,
      moodReason: request.moodReason,
      image: request.image,
      imageLabel: request.imageLabel,
      selfState: request.selfState,
      event: eventNow,
      // 客户端 recent + 服务端最近生成，一起用于避免重复
      recent: recentForPrompt,
    })

    /** 单个候选的一次尝试（独立超时；仅未产出任何文本前失败才可回退）。 */
    async function attempt(candidate) {
      return callCandidate({
        candidate,
        resolveLlm,
        system: SELF_TALK_SYSTEM_PROMPT,
        prompt: userPrompt,
        maxTokens: SELF_TALK_MAX_TOKENS,
        temperature: SELF_TALK_TEMPERATURE,
        timeoutMs,
        timeoutCode: 'SELF_TALK_TIMEOUT',
        timeoutMessage: `自言自语生成超时（${timeoutMs}ms）`,
        role: 'selfTalk',
        prefix: '自言自语候选失败',
        modelErrorsPath,
        warn,
        honorFinishFailure: true,
      })
    }

    let payloadText = null
    let actualCandidate = null
    let lastMessage = '自言自语生成失败'
    for (const candidate of candidates) {
      const result = await attempt(candidate)
      if (result.ok === true) {
        payloadText = result.text
        actualCandidate = candidate
        break
      }
      lastMessage = result.message
      if (result.retryable !== true) return selfTalkUnavailable(result.message)
    }
    if (payloadText === null || actualCandidate === null) return selfTalkUnavailable(lastMessage)

    const lines = parseSelfTalkLines(payloadText, {
      kind,
      // 客户端 recent + 服务端最近生成缓存：两边都要避免重复。
      recent: [...(Array.isArray(request.recent) ? request.recent : []), ...generatedRecent],
      limit: batch,
    })
    if (lines.length === 0) {
      return selfTalkUnavailable('模型没有返回可用的句子')
    }
    // v1.33：在多行候选里挑最不重复的一句（全部太像时保留首选+第二行）。
    const selectedLines = selectDiverseSelfTalkLines(lines, recentForPrompt)
    const finalLines = selectedLines.length > 0 ? selectedLines : lines
    const generatedAt = now()
    const response = {
      ok: true,
      lines: finalLines.map((text) => ({ text, ts: generatedAt })),
      // v1.39：记录实际成功的候选 provider/model（回退后不写首候选）。
      model: { provider: actualCandidate.provider, model: actualCandidate.model },
      generatedAt,
      cached: false,
    }
    rememberLines(lines)
    if (topic !== null) rememberTopic(topic.id)
    if (events !== null && typeof events.engage === 'function') {
      try {
        const engagement = events.engage('narration', generatedAt)
        if (
          engagement &&
          engagement.satiated === true &&
          engagement.event &&
          onEventSatiated !== null &&
          !notifiedSatiated.has(engagement.event.eventId)
        ) {
          notifiedSatiated.add(engagement.event.eventId)
          Promise.resolve(onEventSatiated(engagement.event)).catch(() => {})
        }
      } catch {
        /* ignore */
      }
    }
    lastResult = response
    return response
  }

  /**
   * 生成一批自言自语。
   * 契约 §2.11：in-flight 请求复用同一个结果；距上次生成 < 3s 时复用上次结果（cached:true），
   * 没有上次结果则返回 SELF_TALK_RATE_LIMITED。永不抛异常。
   * @param {object} context
   * @returns {Promise<object>}
   */
  async function generate(context) {
    if (inFlight !== null) {
      const shared = await inFlight
      if (isPlainObject(shared) && shared.ok === true) return { ...shared, cached: true }
      return shared
    }
    const current = now()
    if (lastStartedAt > 0 && current - lastStartedAt < minIntervalMs) {
      const reused = cachedResponse()
      if (reused !== null) return reused
      return selfTalkUnavailable(`自言自语生成太频繁（最小间隔 ${minIntervalMs}ms）`, 'SELF_TALK_RATE_LIMITED')
    }
    const task = doGenerate(context).catch((error) => {
      warn(`自言自语异常：${error instanceof Error ? error.message : String(error)}`)
      return selfTalkUnavailable('自言自语暂不可用')
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
    /** 测试/诊断用：最近生成缓存快照。 */
    recentLines: () => [...generatedRecent],
    /** 测试/诊断用：最近用过的 topic id（ring ≤30）。 */
    recentTopics: () => [...recentTopicIds],
    lastResult: () => lastResult,
  }
}

/**
 * 解析路由 query 的 recent 参数（`|` 分隔、≤12 条、总长 ≤1200 字符；v1.22 扩容）。
 * 调用方传 URLSearchParams 解码后的值；这里再做一次防御性清理。
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
export function parseRecentQuery(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return []
  const trimmed = raw.slice(0, SELF_TALK_RECENT_MAX_CHARS)
  const out = []
  for (const part of trimmed.split('|')) {
    const text = sanitizeInline(part, 80)
    if (text.length > 0 && !out.includes(text)) {
      out.push(text)
      if (out.length >= SELF_TALK_RECENT_MAX) break
    }
  }
  return out
}

