// @ts-check
// Video 摘要整理模型层：provider 原文 → 带视频工具经验的可读摘要。
import { callModel } from '../../kernel/model-call.mjs'
import { getActiveToolExperience, skillContextForActivity, skillHintLines } from '../../core/tool-experience-service.mjs'

const SYSTEM = '你是住在 DSH Web 角落的小鲸鱼。你在整理一个视频的摘要，只写你真正看懂的内容，不编造视频里没有的东西。'

export function buildVideoSummaryPrompt(input = {}) {
  const spec = /** @type {any} */ (input)
  const session = spec.session && typeof spec.session === 'object' ? spec.session : {}
  const source = spec.source ?? ''
  const topics = Array.isArray(spec.topics) ? spec.topics : []
  const skillHints = Array.isArray(spec.skillHints) ? spec.skillHints : []
  const title = String(session.title ?? '').trim().slice(0, 120) || '未命名视频'
  const lines = [
    `视频：${title}`,
    session.url ? `链接：${session.url}` : '',
    `已有的视频原文/字幕摘要：${String(source).slice(0, 3000)}`,
    topics.length > 0 ? `已有主题：${topics.slice(0, 6).join('、')}` : '',
  ]
  if (skillHints.length > 0) lines.push('你在类似视频情境里的工具经验：' + skillHints.join('；'))
  lines.push('请输出严格 JSON：{"summary":"3–5 句中文摘要，贴着视频内容，不编造","topics":["1–4 个短主题标签"]}')
  return lines.filter((line) => typeof line === 'string' && line.length > 0).join('\n')
}

export function createVideoSummary(options = {}) {
  const getLlm = options.getLlm
  const policy = options.policy ?? null
  const modelErrorsPath = typeof options.modelErrorsPath === 'string' ? options.modelErrorsPath : null
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 45000
  if (typeof getLlm !== 'function') return null
  return async function summarize({ session = {}, source = '', topics = [] } = {}) {
    if (typeof source !== 'string' || source.trim().length === 0) return null
    const video = /** @type {any} */ (session)
    const hints = skillHintLines(getActiveToolExperience(), {
      activity: 'video',
      context: skillContextForActivity('video', { arguments: { url: video.url || '' } }),
    })
    const result = await callModel({
      role: 'read',
      policy,
      resolveLlm: getLlm,
      system: SYSTEM,
      prompt: buildVideoSummaryPrompt({ session, source, topics, skillHints: hints }),
      maxTokens: 600,
      timeoutMs,
      timeoutCode: 'VIDEO_SUMMARY_TIMEOUT',
      timeoutMessage: `视频摘要整理超时（${timeoutMs}ms）`,
      prefix: '视频摘要整理失败',
      modelErrorsPath,
    })
    if (result === null) return null
    const text = String(result.text ?? '').trim()
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
        return { summary: parsed.summary.trim().slice(0, 2000), topics: Array.isArray(parsed.topics) ? parsed.topics.filter((item) => typeof item === 'string').slice(0, 4) : [] }
      }
    } catch {
      const fallback = text.slice(0, 2000)
      if (fallback.length > 0) return { summary: fallback, topics: [] }
    }
    return null
  }
}
