// @ts-check
// 把 dsh-bili-scroll 的 bili_search / bili_subtitle 工具桥接成 guide-loop 的视频源。
import { callModel } from '../kernel/model-call.mjs'

function normalizeVideos(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const list = Array.isArray(raw.videos) ? raw.videos : Array.isArray(raw.results) ? raw.results : []
  return list
    .map((item) => ({
      bvid: String(item.bvid || item.bv || '').slice(0, 40),
      title: String(item.title || '').slice(0, 160),
      author: String(item.author || item.up || '').slice(0, 80),
      play: Number(item.play) || 0,
    }))
    .filter((item) => item.bvid.length > 0)
}

function subtitleText(value) {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.subtitle === 'string') return value.subtitle
  if (Array.isArray(value.segments))
    return value.segments.map((item) => (typeof item === 'string' ? item : item?.text || '')).join('\n')
  return ''
}

export function createBiliGuideSource(options = {}) {
  const getHostTool = typeof options.getHostTool === 'function' ? options.getHostTool : () => null
  const getLlm = options.getLlm
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const timeoutMs = Math.max(5000, Math.min(120000, Number(options.timeoutMs) || 45000))

  async function executeTool(name, args) {
    const definition = getHostTool(name)
    if (!definition || typeof definition.execute !== 'function') return null
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const exec = {
        callId: 'guide-' + name + '-' + Date.now(),
        rootCallId: 'guide-' + name + '-' + Date.now(),
        name,
        arguments: args,
        signal: controller ? controller.signal : undefined,
        deferContext() {},
        concludeTurn() {},
      }
      const value = await definition.execute(args, exec)
      return value ?? null
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] B站 ${name} 失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function searchVideos(topic, count = 3) {
    const value = await executeTool('bili_search', {
      keyword: 'Minecraft ' + String(topic || '').slice(0, 80),
      num: Math.max(1, Math.min(10, count)),
      order: 'click',
    })
    return normalizeVideos(value)
  }

  async function fetchSubtitle(bvid) {
    const value = await executeTool('bili_subtitle', { bvid })
    return subtitleText(value)
  }

  async function summarize(input) {
    const video = input && input.video ? input.video : {}
    const transcript = String(input?.transcript || '').slice(0, 10000)
    const result = await callModel({
      role: 'drive',
      policy,
      resolveLlm: getLlm,
      system: '你住在 DSH 的鲸鱼娘插件里。你在把 B 站攻略视频的字幕提炼成她能执行的方法。只输出 JSON。',
      prompt: [
        `主题：${String(input?.topic || '')}`,
        `问题：${String(input?.question || '')}`,
        `视频：${video.title || ''}（${video.bvid || ''}）`,
        '字幕：',
        transcript,
        '',
        '只输出 JSON：{"method":"一句话方法","steps":["步骤1","步骤2","步骤3"],"caveat":"注意事项"}',
        '步骤必须是游戏里可执行的动作；只保留字幕里确实出现的内容，不确定就写“没提到”。',
      ].join('\n'),
      maxTokens: 0,
      timeoutMs: 45000,
      timeoutCode: 'BILI_GUIDE_SUMMARY_TIMEOUT',
      timeoutMessage: 'B站攻略总结超时',
      prefix: 'B站攻略总结失败',
      modelErrorsPath,
    })
    if (!result || typeof result.text !== 'string') return null
    const first = result.text.indexOf('{')
    const last = result.text.lastIndexOf('}')
    if (first < 0 || last <= first) return null
    try {
      const parsed = JSON.parse(result.text.slice(first, last + 1))
      if (!parsed || typeof parsed !== 'object') return null
      const steps = Array.isArray(parsed.steps)
        ? parsed.steps
            .map((step) => String(step).slice(0, 160))
            .filter(Boolean)
            .slice(0, 6)
        : []
      return {
        method: String(parsed.method || '').slice(0, 300),
        steps,
        caveat: String(parsed.caveat || '').slice(0, 240),
      }
    } catch {
      return null
    }
  }

  return { searchVideos, fetchSubtitle, summarize }
}
