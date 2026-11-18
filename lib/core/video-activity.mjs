// @ts-check
// lib/core/video-activity.mjs —— Video Activity（Gate L5，用 L1 Activity SDK 定义）。
//
// 为“刷视频”提供 Activity 骨架（不直接调用 dsh-bili-scroll/MCP，避免耦合）：
//   · manifest id=video；events: video.opened/playing/paused/summary/topic/note/finished；
//     tools: video.open/play/pause/summary/note；tasks: video.watch/video.summary；
//   · 注入 provider（open/getMeta/play/pause/summary 均可异步；open 必需）：
//       无 provider 时所有工具明确 unavailable；provider 抛错隔离为失败 receipt；
//   · summary/note 产出 topic 标签（可被 Study 订阅）；内存笔记 store（可注入）；
//   · 不接 Hub/HTTP/UI、不联网、不自动运行。

import { defineActivity } from './activity-sdk.mjs'

/** 实现版本。 */
export const VIDEO_ACTIVITY_VERSION = 1

/** 事件。 */
export const VIDEO_EVENTS = Object.freeze({
  opened: 'video.opened',
  playing: 'video.playing',
  paused: 'video.paused',
  summary: 'video.summary',
  topic: 'video.topic',
  note: 'video.note',
  finished: 'video.finished',
})

/** 工具名。 */
export const VIDEO_TOOLS = Object.freeze(['video.open', 'video.play', 'video.pause', 'video.summary', 'video.note'])

/** 任务 kind。 */
export const VIDEO_TASKS = Object.freeze(['video.watch', 'video.summary'])

/** 错误码。 */
export const VIDEO_CODES = Object.freeze({
  providerUnavailable: 'VIDEO_PROVIDER_UNAVAILABLE',
  invalidInput: 'VIDEO_INVALID_INPUT',
  openFailed: 'VIDEO_OPEN_FAILED',
  playFailed: 'VIDEO_PLAY_FAILED',
  pauseFailed: 'VIDEO_PAUSE_FAILED',
  summaryFailed: 'VIDEO_SUMMARY_FAILED',
  invalidNote: 'VIDEO_INVALID_NOTE',
  noVideo: 'VIDEO_NO_VIDEO',
})

/** 默认最多主题数。 */
export const VIDEO_MAX_TOPICS = 8

/** manifest（Activity SDK 会再校验一次）。 */
export const VIDEO_MANIFEST_RAW = Object.freeze({
  id: 'video',
  version: '1.0.0',
  name: '视频',
  events: Object.freeze([VIDEO_EVENTS.opened, VIDEO_EVENTS.playing, VIDEO_EVENTS.paused, VIDEO_EVENTS.summary, VIDEO_EVENTS.topic, VIDEO_EVENTS.note, VIDEO_EVENTS.finished]),
  tasks: Object.freeze([
    Object.freeze({ kind: 'video.watch', goal: '打开并观看一段视频', success: '播放状态与回执可查询', priority: 40 }),
    Object.freeze({ kind: 'video.summary', goal: '为当前视频生成摘要与主题标签', success: '摘要与主题已记录', priority: 50 }),
  ]),
  tools: VIDEO_TOOLS,
  permissions: Object.freeze(['tool']),
  resources: Object.freeze({ model: false, foreground: false, maxMinutes: 10 }),
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function receiptError(code, message) {
  return { ok: false, at: Date.now(), detail: message, facts: { code } }
}

function normalizeTopics(raw, maxTopics) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw.length > 0 ? raw.split(/[，,、;；\s]+/) : []
  const out = []
  for (const item of list) {
    const topic = String(item ?? '').replace(/^#+/, '').trim().slice(0, 60)
    if (topic.length === 0) continue
    if (out.indexOf(topic) < 0) out.push(topic)
    if (out.length >= maxTopics) break
  }
  return out
}

/**
 * 内存视频笔记 store（可注入；只存内存，不写盘）。
 * @param {{now?: () => number}} [options]
 */
export function createVideoNoteStore(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const entries = []
  let seq = 0
  function add(input = {}) {
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000)
    if (text.length === 0) return { ok: false, code: VIDEO_CODES.invalidNote, message: '笔记内容不能为空' }
    seq += 1
    const note = {
      id: 'video-note-' + seq,
      text,
      videoId: typeof input.videoId === 'string' ? input.videoId.slice(0, 200) : '',
      topics: normalizeTopics(input.topics, VIDEO_MAX_TOPICS),
      at: now(),
    }
    entries.push(note)
    return { ok: true, note: { ...note } }
  }
  function list() {
    return entries.slice(-100).map((note) => ({ ...note }))
  }
  function clear() {
    entries.length = 0
  }
  function snapshot() {
    return { ok: true, total: entries.length, recent: entries.slice(-5).map((note) => ({ ...note })) }
  }
  return { add, list, clear, snapshot }
}

/**
 * 创建 Video Activity（返回 {ok, activity, notes, snapshot, events, session, topics}）。
 * @param {{
 *   provider?: {open?: Function, getMeta?: Function, play?: Function, pause?: Function, summary?: Function}|null,
 *   store?: object|null,
 *   onEvent?: ((event: object) => void)|null,
 *   maxTopics?: number,
 *   now?: () => number,
 * }} [options]
 */
export function createVideoActivity(options = {}) {
  const spec = /** @type {any} */ (isPlainObject(options) ? options : {})
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const provider = isPlainObject(spec.provider) ? spec.provider : null
  const maxTopics = Number.isFinite(Number(spec.maxTopics)) && Number(spec.maxTopics) > 0 ? Math.floor(Number(spec.maxTopics)) : VIDEO_MAX_TOPICS
  const notes = /** @type {any} */ (
    isPlainObject(spec.store) && typeof spec.store.add === 'function' ? spec.store : createVideoNoteStore({ now })
  )
  const onEvent = typeof spec.onEvent === 'function' ? spec.onEvent : null
  const events = []
  const topicSet = []
  const session = { id: '', title: '', url: '', duration: 0, status: 'idle', summary: '', topics: [], openedAt: 0, finishedAt: 0 }

  function emit(type, detail) {
    const event = { type, at: now(), ...(isPlainObject(detail) ? detail : {}) }
    events.push(event)
    try {
      onEvent?.(event)
    } catch (error) {
      void error
    }
    return event
  }

  function addTopics(raw) {
    const topics = normalizeTopics(raw, maxTopics)
    for (const topic of topics) {
      if (topicSet.indexOf(topic) < 0) topicSet.push(topic)
      emit(VIDEO_EVENTS.topic, { topic, videoId: session.id })
    }
    session.topics = topicSet.slice()
    return topics
  }

  function requireProvider() {
    if (provider === null || typeof provider.open !== 'function') {
      return receiptError(VIDEO_CODES.providerUnavailable, 'video provider 未注入（open 必需）')
    }
    return null
  }

  function requireVideo() {
    const missing = requireProvider()
    if (missing !== null) return missing
    if (session.id.length === 0) return receiptError(VIDEO_CODES.noVideo, '还没有打开视频（先调用 video.open）')
    return null
  }

  const tools = {
    'video.open': async (args) => {
      const missing = requireProvider()
      if (missing !== null) return missing
      const input = String(args.url ?? args.id ?? args.path ?? '').trim()
      if (input.length === 0) return receiptError(VIDEO_CODES.invalidInput, 'video.open 需要 url/id/path')
      try {
        const raw = await provider.open(input)
        const info = typeof raw === 'string' ? { id: raw, title: raw } : isPlainObject(raw) ? raw : {}
        session.id = String(info.id ?? info.videoId ?? input).slice(0, 200)
        session.title = String(info.title ?? info.name ?? session.id).slice(0, 200)
        session.url = String(info.url ?? input).slice(0, 500)
        session.duration = Number.isFinite(Number(info.duration)) ? Number(info.duration) : 0
        session.status = 'opened'
        session.openedAt = now()
        emit(VIDEO_EVENTS.opened, { videoId: session.id, title: session.title, url: session.url })
        return { ok: true, detail: '打开《' + session.title + '》', facts: { videoId: session.id, title: session.title, url: session.url, duration: session.duration } }
      } catch (error) {
        return receiptError(VIDEO_CODES.openFailed, error instanceof Error ? error.message : String(error))
      }
    },
    'video.play': async () => {
      const missing = requireVideo()
      if (missing !== null) return missing
      try {
        if (typeof provider.play === 'function') await provider.play({ ...session })
        session.status = 'playing'
        emit(VIDEO_EVENTS.playing, { videoId: session.id, title: session.title })
        return { ok: true, detail: '播放中', facts: { videoId: session.id, status: 'playing' } }
      } catch (error) {
        return receiptError(VIDEO_CODES.playFailed, error instanceof Error ? error.message : String(error))
      }
    },
    'video.pause': async () => {
      const missing = requireVideo()
      if (missing !== null) return missing
      try {
        if (typeof provider.pause === 'function') await provider.pause({ ...session })
        session.status = 'paused'
        emit(VIDEO_EVENTS.paused, { videoId: session.id, title: session.title })
        return { ok: true, detail: '已暂停', facts: { videoId: session.id, status: 'paused' } }
      } catch (error) {
        return receiptError(VIDEO_CODES.pauseFailed, error instanceof Error ? error.message : String(error))
      }
    },
    'video.summary': async (args) => {
      const missing = requireVideo()
      if (missing !== null) return missing
      try {
        let summary = String(args.text ?? '').trim()
        let topics = normalizeTopics(args.topics, maxTopics)
        if (summary.length === 0 && typeof provider.summary === 'function') {
          const raw = await provider.summary({ ...session })
          if (typeof raw === 'string') summary = raw
          else if (isPlainObject(raw)) {
            summary = typeof raw.summary === 'string' ? raw.summary : ''
            if (topics.length === 0) topics = normalizeTopics(raw.topics, maxTopics)
          }
        }
        summary = summary.slice(0, 2000)
        session.summary = summary
        emit(VIDEO_EVENTS.summary, { videoId: session.id, summary: summary.slice(0, 200) })
        if (topics.length > 0) addTopics(topics)
        const finish = args.finish === true
        if (finish) {
          session.status = 'finished'
          session.finishedAt = now()
          emit(VIDEO_EVENTS.finished, { videoId: session.id, title: session.title })
        }
        return { ok: true, detail: '摘要已生成', facts: { videoId: session.id, summary: summary.slice(0, 200), topics: session.topics.slice(), finished: finish } }
      } catch (error) {
        return receiptError(VIDEO_CODES.summaryFailed, error instanceof Error ? error.message : String(error))
      }
    },
    'video.note': async (args) => {
      const text = String(args.text ?? '').trim()
      if (text.length === 0) return receiptError(VIDEO_CODES.invalidNote, '笔记内容不能为空')
      const added = notes.add({ text, videoId: session.id, topics: args.topics })
      if (added === null || added === undefined || added.ok !== true) {
        return receiptError(added && added.code ? added.code : VIDEO_CODES.invalidNote, added && added.message ? added.message : '保存笔记失败')
      }
      emit(VIDEO_EVENTS.note, { noteId: added.note.id, videoId: session.id, text: added.note.text.slice(0, 120) })
      const topics = addTopics(args.topics)
      return { ok: true, detail: '笔记已保存', facts: { noteId: added.note.id, videoId: session.id, topics, total: notes.snapshot().total } }
    },
  }

  const activity = defineActivity({
    manifest: VIDEO_MANIFEST_RAW,
    tools,
    health: async () => ({ ok: true, status: 'healthy', detail: session.id.length === 0 ? '空闲' : '视频：' + session.title + '（' + session.status + '）' }),
    now,
  })
  if (activity.ok !== true) return { ok: false, code: activity.code, message: activity.message, errors: activity.errors, notes }

  function snapshot() {
    return {
      ok: true,
      version: VIDEO_ACTIVITY_VERSION,
      activity: activity.snapshot(),
      session: { ...session, topics: session.topics.slice() },
      notes: notes.snapshot(),
      topics: topicSet.slice(),
      events: events.slice(-30),
    }
  }

  return { ok: true, activity, notes, snapshot, events, session, topics: topicSet }
}
