// @ts-check
// lib/core/study-activity.mjs —— Study/Research Activity（Gate L4，用 L1 Activity SDK 定义）。
//
// 研究闭环：问题（ask）→ 来源（search）→ 假设/结论（note）→ 完成（finish）。
//   · manifest id=study；events: study.question/source/hypothesis/note/stuck/finished；
//     tools: study.ask/search/note/finish；tasks: study.research/study.note；
//   · search/ask 由上层注入（async）；不直接 import domain（core 保持纯净，不联网）；
//   · 未注入时工具返回明确 unavailable 错误；search/ask 抛错隔离为失败 receipt；
//   · 笔记存内存 store（可注入）；事件走 onEvent 回调；不接 Hub/HTTP/UI、不自动运行。

import { defineActivity } from './activity-sdk.mjs'

/** 实现版本。 */
export const STUDY_ACTIVITY_VERSION = 1

/** 事件。 */
export const STUDY_EVENTS = Object.freeze({
  question: 'study.question',
  source: 'study.source',
  hypothesis: 'study.hypothesis',
  note: 'study.note',
  stuck: 'study.stuck',
  finished: 'study.finished',
})

/** 工具名。 */
export const STUDY_TOOLS = Object.freeze(['study.ask', 'search', 'note', 'finish'])

/** 任务 kind。 */
export const STUDY_TASKS = Object.freeze(['study.research', 'study.note'])

/** 错误码。 */
export const STUDY_CODES = Object.freeze({
  searchUnavailable: 'STUDY_SEARCH_UNAVAILABLE',
  askUnavailable: 'STUDY_ASK_UNAVAILABLE',
  searchFailed: 'STUDY_SEARCH_FAILED',
  askFailed: 'STUDY_ASK_FAILED',
  invalidQuestion: 'STUDY_INVALID_QUESTION',
  invalidNote: 'STUDY_INVALID_NOTE',
  invalidQuery: 'STUDY_INVALID_QUERY',
})

/** 默认最多保留来源数。 */
export const STUDY_MAX_SOURCES = 8

/** manifest（Activity SDK 会再校验一次）。 */
export const STUDY_MANIFEST_RAW = Object.freeze({
  id: 'study',
  version: '1.0.0',
  name: '研究',
  events: Object.freeze([STUDY_EVENTS.question, STUDY_EVENTS.source, STUDY_EVENTS.hypothesis, STUDY_EVENTS.note, STUDY_EVENTS.stuck, STUDY_EVENTS.finished]),
  tasks: Object.freeze([
    Object.freeze({ kind: 'study.research', goal: '围绕一个问题检索来源并记录假设/结论', success: '来源与笔记可查询', priority: 40 }),
    Object.freeze({ kind: 'study.note', goal: '记录一条研究笔记/结论', success: '笔记已保存', priority: 50 }),
  ]),
  tools: STUDY_TOOLS,
  permissions: Object.freeze(['tool']),
  resources: Object.freeze({ model: false, foreground: false, maxMinutes: 10 }),
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function receiptError(code, message) {
  return { ok: false, at: Date.now(), detail: message, facts: { code } }
}

function normalizeSources(raw, maxSources) {
  const list = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw.results) ? raw.results : []
  return list
    .filter((item) => isPlainObject(item) || typeof item === 'string')
    .slice(0, maxSources)
    .map((item) =>
      isPlainObject(item)
        ? {
            title: String(item.title ?? '').slice(0, 200),
            url: String(item.url ?? '').slice(0, 500),
            snippet: String(item.snippet ?? '').slice(0, 500),
          }
        : { title: String(item).slice(0, 200), url: '', snippet: '' },
    )
}

/**
 * 内存研究笔记 store（可注入；只存内存，不写盘）。
 * @param {{now?: () => number}} [options]
 */
export function createStudyNoteStore(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const entries = []
  let seq = 0
  function add(input = {}) {
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000)
    if (text.length === 0) return { ok: false, code: STUDY_CODES.invalidNote, message: '笔记内容不能为空' }
    const kind = input.kind === 'hypothesis' || input.kind === 'conclusion' || input.kind === 'stuck' ? input.kind : 'note'
    seq += 1
    const note = {
      id: 'study-note-' + seq,
      text,
      kind,
      question: typeof input.question === 'string' ? input.question.slice(0, 300) : '',
      source: typeof input.source === 'string' ? input.source.slice(0, 500) : '',
      at: now(),
    }
    entries.push(note)
    return { ok: true, note: { ...note } }
  }
  function list(filter = {}) {
    const specFilter = isPlainObject(filter) ? filter : {}
    return entries
      .filter((note) => (typeof specFilter.kind === 'string' && specFilter.kind.length > 0 ? note.kind === specFilter.kind : true))
      .slice(-100)
      .map((note) => ({ ...note }))
  }
  function clear() {
    entries.length = 0
  }
  function snapshot() {
    const byKind = { note: 0, hypothesis: 0, conclusion: 0, stuck: 0 }
    for (const note of entries) if (byKind[note.kind] !== undefined) byKind[note.kind] += 1
    return { ok: true, total: entries.length, byKind, recent: entries.slice(-5).map((note) => ({ ...note })) }
  }
  return { add, list, clear, snapshot }
}

/**
 * 创建 Study/Research Activity（返回 {ok, activity, notes, snapshot, events}）。
 * @param {{
 *   search?: ((query: string) => Promise<object[]>|object[])|null,
 *   ask?: ((question: string) => Promise<string|object>|string|object)|null,
 *   store?: object|null,
 *   onEvent?: ((event: object) => void)|null,
 *   maxSources?: number,
 *   now?: () => number,
 * }} [options]
 */
export function createStudyActivity(options = {}) {
  const spec = /** @type {any} */ (isPlainObject(options) ? options : {})
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const search = typeof spec.search === 'function' ? spec.search : null
  const ask = typeof spec.ask === 'function' ? spec.ask : null
  const maxSources = Number.isFinite(Number(spec.maxSources)) && Number(spec.maxSources) > 0 ? Math.floor(Number(spec.maxSources)) : STUDY_MAX_SOURCES
  const notes = /** @type {any} */ (
    isPlainObject(spec.store) && typeof spec.store.add === 'function' ? spec.store : createStudyNoteStore({ now })
  )
  const onEvent = typeof spec.onEvent === 'function' ? spec.onEvent : null
  const events = []
  const session = { question: '', answer: '', sources: [], status: 'idle', startedAt: 0, finishedAt: 0 }

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

  const tools = {
    'study.ask': async (args) => {
      const question = String(args.question ?? args.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
      if (question.length === 0) return receiptError(STUDY_CODES.invalidQuestion, '问题不能为空')
      if (ask === null) return receiptError(STUDY_CODES.askUnavailable, 'ask 未注入（可选能力）')
      session.question = question
      session.startedAt = now()
      session.status = 'researching'
      emit(STUDY_EVENTS.question, { question })
      try {
        const raw = await ask(question)
        const answer = typeof raw === 'string' ? raw : isPlainObject(raw) && typeof raw.answer === 'string' ? raw.answer : ''
        session.answer = answer.slice(0, 2000)
        return { ok: true, detail: '问题已记录', facts: { question, answer: session.answer.slice(0, 200), hasAnswer: session.answer.length > 0 } }
      } catch (error) {
        return receiptError(STUDY_CODES.askFailed, error instanceof Error ? error.message : String(error))
      }
    },
    search: async (args) => {
      const query = String(args.query ?? args.question ?? session.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
      if (query.length === 0) return receiptError(STUDY_CODES.invalidQuery, '检索词不能为空')
      if (search === null) return receiptError(STUDY_CODES.searchUnavailable, 'search 未注入')
      try {
        const raw = await search(query)
        const sources = normalizeSources(raw, maxSources)
        session.sources = sources
        for (const source of sources) emit(STUDY_EVENTS.source, { query, title: source.title, url: source.url })
        return {
          ok: true,
          detail: '找到 ' + sources.length + ' 条来源',
          facts: { query, count: sources.length, sources: sources.map((source) => ({ title: source.title, url: source.url })) },
        }
      } catch (error) {
        return receiptError(STUDY_CODES.searchFailed, error instanceof Error ? error.message : String(error))
      }
    },
    note: async (args) => {
      const text = String(args.text ?? args.note ?? '').trim()
      if (text.length === 0) return receiptError(STUDY_CODES.invalidNote, '笔记内容不能为空')
      const kind = args.stuck === true ? 'stuck' : args.kind === 'hypothesis' ? 'hypothesis' : args.kind === 'conclusion' ? 'conclusion' : 'note'
      const added = notes.add({ text, kind, question: session.question, source: args.source })
      if (added === null || added === undefined || added.ok !== true) {
        return receiptError(added && added.code ? added.code : STUDY_CODES.invalidNote, added && added.message ? added.message : '保存笔记失败')
      }
      const type = kind === 'hypothesis' ? STUDY_EVENTS.hypothesis : kind === 'stuck' ? STUDY_EVENTS.stuck : STUDY_EVENTS.note
      emit(type, { noteId: added.note.id, kind, text: added.note.text.slice(0, 120), question: session.question })
      return { ok: true, detail: kind === 'hypothesis' ? '假设已记录' : kind === 'stuck' ? '已记录卡住' : '笔记已保存', facts: { noteId: added.note.id, kind, total: notes.snapshot().total } }
    },
    finish: async (args) => {
      session.status = 'finished'
      session.finishedAt = now()
      const summary = String(args.summary ?? '').trim().slice(0, 1000)
      emit(STUDY_EVENTS.finished, { question: session.question, sources: session.sources.length, notes: notes.snapshot().total, summary })
      return {
        ok: true,
        detail: '研究完成',
        facts: {
          question: session.question,
          sources: session.sources.length,
          notes: notes.snapshot().total,
          hypotheses: notes.list({ kind: 'hypothesis' }).length,
          summary,
        },
      }
    },
  }

  const activity = defineActivity({
    manifest: STUDY_MANIFEST_RAW,
    tools,
    health: async () => ({ ok: true, status: 'healthy', detail: session.status === 'researching' ? '研究中：' + session.question : '空闲' }),
    now,
  })
  if (activity.ok !== true) return { ok: false, code: activity.code, message: activity.message, errors: activity.errors, notes }

  function snapshot() {
    return {
      ok: true,
      version: STUDY_ACTIVITY_VERSION,
      activity: activity.snapshot(),
      session: { ...session, sources: session.sources.map((source) => ({ ...source })) },
      notes: notes.snapshot(),
      events: events.slice(-30),
    }
  }

  return { ok: true, activity, notes, snapshot, events, session }
}
