// @ts-check
// 通用攻略回路：任何 Activity 都能按 topic 求助；先查 B站，再交给注入的总结器。
import { normalizeTopic } from './topic-hub.mjs'

export const GUIDE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function createGuideLoop(options = {}) {
  const searchVideos = typeof options.searchVideos === 'function' ? options.searchVideos : null
  const fetchSubtitle = typeof options.fetchSubtitle === 'function' ? options.fetchSubtitle : null
  const summarize = typeof options.summarize === 'function' ? options.summarize : null
  const topicHub = options.topicHub && typeof options.topicHub.link === 'function' ? options.topicHub : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxVideos = Math.max(1, Math.min(6, Number(options.maxVideos) || 3))
  const inflight = new Map()

  async function run(input = {}) {
    const topic = normalizeTopic(input.topic)
    if (!topic) return { ok: false, error: 'topic_required' }
    const cached = topicHub && typeof topicHub.query === 'function' ? topicHub.query(topic) : null
    const entry = cached && cached.ok === true ? cached.entry : null
    if (entry && now() - Number(entry.updatedAt || 0) < GUIDE_MAX_AGE_MS && Array.isArray(entry.methods) && entry.methods.length > 0) {
      return { ok: true, cached: true, topic, guide: entry.methods[0], links: entry.links || [], entry }
    }
    if (!searchVideos) return { ok: false, error: 'video_search_unavailable', topic }
    const videos = await searchVideos(topic, maxVideos).catch(() => [])
    if (!Array.isArray(videos) || videos.length === 0) return { ok: false, error: 'no_videos', topic }
    let chosen = null
    let transcript = ''
    for (const video of videos.slice(0, maxVideos)) {
      if (!video || typeof video.bvid !== 'string') continue
      let text = ''
      if (fetchSubtitle) {
        try {
          text = String((await fetchSubtitle(video.bvid)) || '').trim()
        } catch {
          text = ''
        }
      }
      if (text.length > 40) {
        chosen = video
        transcript = text
        break
      }
    }
    if (!chosen || transcript.length === 0) {
      return { ok: false, error: 'no_subtitle', topic, videos: videos.slice(0, maxVideos) }
    }
    let guide = null
    if (summarize) {
      try {
        guide = await summarize({ topic, question: String(input.question || ''), video: chosen, transcript: transcript.slice(0, 12000) })
      } catch {
        guide = null
      }
    }
    if (!guide || typeof guide !== 'object') {
      return { ok: false, error: 'summary_unavailable', topic, video: chosen, transcript }
    }
    const method = String(guide.method || guide.steps?.join('；') || '').slice(0, 1200)
    const link = topicHub
      ? topicHub.link({
          topic,
          activity: String(input.activity || 'guide'),
          source: 'bilibili:' + chosen.bvid,
          url: 'https://www.bilibili.com/video/' + chosen.bvid,
          title: String(chosen.title || ''),
          summary: method,
          method,
        })
      : null
    return {
      ok: true,
      cached: false,
      topic,
      guide: { ...guide, method, video: chosen, bvid: chosen.bvid, url: 'https://www.bilibili.com/video/' + chosen.bvid },
      link: link && link.ok === true ? link.entry : null,
    }
  }

  async function lookup(input = {}) {
    const topic = normalizeTopic(input.topic)
    if (!topic) return { ok: false, error: 'topic_required' }
    if (inflight.has(topic)) return inflight.get(topic)
    const promise = run(input).finally(() => inflight.delete(topic))
    inflight.set(topic, promise)
    return promise
  }
  return { lookup, run, snapshot: () => ({ ok: true, inflight: inflight.size }) }
}
