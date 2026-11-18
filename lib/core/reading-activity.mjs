// @ts-check
// lib/core/reading-activity.mjs —— Reading Activity（Gate L2，用 L1 Activity SDK 定义）。
//
// 第一个用 SDK 打样的新 Activity：本地书阅读 + 分页 + 笔记/高亮/卡住事件。
//   · manifest id=reading；events: reading.opened/page/note/stuck/finished；
//     tools: book.open/book.page/book.note/book.highlight；tasks: reading.read/reading.note；
//   · 不接 Hub/HTTP/UI：只产出 adapter（execute/start/stop/health）+ 事件回调 + 内存笔记 store；
//   · 不联网/不自动运行；PDF 依赖系统 pdftotext（book-reader 内明确报错，不装依赖）。

import { createBookReader } from '../domain/learning/book-reader.mjs'
import { defineActivity } from './activity-sdk.mjs'

/** 实现版本。 */
export const READING_ACTIVITY_VERSION = 1

/** 事件。 */
export const READING_EVENTS = Object.freeze({
  opened: 'reading.opened',
  page: 'reading.page',
  note: 'reading.note',
  stuck: 'reading.stuck',
  finished: 'reading.finished',
})

/** 工具名。 */
export const READING_TOOLS = Object.freeze(['book.open', 'book.page', 'book.note', 'book.highlight'])

/** 任务 kind。 */
export const READING_TASKS = Object.freeze(['reading.read', 'reading.note'])

/** manifest（Activity SDK 会再校验一次）。 */
export const READING_MANIFEST_RAW = Object.freeze({
  id: 'reading',
  version: '1.0.0',
  name: '阅读',
  events: Object.freeze([READING_EVENTS.opened, READING_EVENTS.page, READING_EVENTS.note, READING_EVENTS.stuck, READING_EVENTS.finished]),
  tasks: Object.freeze([
    Object.freeze({ kind: 'reading.read', goal: '读一页本地书并产出页/笔记', success: '页与笔记可查询', priority: 40 }),
    Object.freeze({ kind: 'reading.note', goal: '为当前页记一条笔记', success: '笔记已保存', priority: 50 }),
  ]),
  tools: READING_TOOLS,
  permissions: Object.freeze(['fs.read', 'tool']),
  resources: Object.freeze({ model: false, foreground: false, maxMinutes: 5 }),
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function receiptError(code, message) {
  return { ok: false, at: Date.now(), detail: message, facts: { code } }
}

/**
 * 内存笔记 store（可注入替换；只存内存，不写盘）。
 * @param {{now?: () => number}} [options]
 */
export function createReadingNoteStore(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const entries = []
  let seq = 0
  function add(input = {}) {
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000)
    if (text.length === 0) return { ok: false, code: 'READING_NOTE_EMPTY', message: '笔记内容不能为空' }
    seq += 1
    const note = {
      id: 'note-' + seq,
      text,
      kind: input.kind === 'stuck' || input.kind === 'highlight' ? input.kind : 'note',
      page: Number.isFinite(Number(input.page)) ? Math.max(1, Math.floor(Number(input.page))) : null,
      bookId: typeof input.bookId === 'string' ? input.bookId.slice(0, 300) : '',
      quote: typeof input.quote === 'string' ? input.quote.slice(0, 300) : '',
      at: now(),
    }
    entries.push(note)
    return { ok: true, note: { ...note } }
  }
  function list(filter = {}) {
    const specFilter = isPlainObject(filter) ? filter : {}
    return entries
      .filter((note) => (typeof specFilter.bookId === 'string' && specFilter.bookId.length > 0 ? note.bookId === specFilter.bookId : true))
      .filter((note) => (typeof specFilter.kind === 'string' && specFilter.kind.length > 0 ? note.kind === specFilter.kind : true))
      .slice(-100)
      .map((note) => ({ ...note }))
  }
  function clear() {
    entries.length = 0
  }
  function snapshot() {
    return { ok: true, total: entries.length, byKind: { note: 0, highlight: 0, stuck: 0 }, recent: entries.slice(-5).map((note) => ({ ...note })) }
  }
  return { add, list, clear, snapshot }
}

/**
 * 创建 Reading Activity（返回 {ok, activity, reader, notes, snapshot}）。
 * @param {{
 *   rootDir?: string|null,
 *   maxChars?: number,
 *   reader?: object|null,
 *   store?: object|null,
 *   onEvent?: ((event: object) => void)|null,
 *   now?: () => number,
 * }} [options]
 */
export function createReadingActivity(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const reader =
    isPlainObject(spec.reader)
      ? spec.reader
      : createBookReader({
          rootDir: typeof spec.rootDir === 'string' ? spec.rootDir : null,
          maxChars: spec.maxChars,
          now,
        })
  const notes = isPlainObject(spec.store) && typeof spec.store.add === 'function' ? spec.store : createReadingNoteStore({ now })
  const onEvent = typeof spec.onEvent === 'function' ? spec.onEvent : null
  const events = []
  let current = null

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

  function openBook(input) {
    const opened = reader.open(input)
    if (opened === null || opened === undefined || opened.ok !== true) {
      return receiptError(opened && opened.code ? opened.code : 'READING_OPEN_FAILED', opened && opened.message ? opened.message : '打开失败')
    }
    current = opened.book
    emit(READING_EVENTS.opened, { title: current.title, kind: current.kind, pageCount: current.pageCount, path: current.path })
    return { ok: true, detail: '打开《' + current.title + '》', facts: { title: current.title, kind: current.kind, pageCount: current.pageCount, chars: current.chars } }
  }

  const tools = {
    'book.open': async (args) => openBook(args.path),
    'book.page': async (args) => {
      if (current === null && typeof args.path === 'string' && args.path.length > 0) {
        const opened = openBook(args.path)
        if (opened.ok !== true) return opened
      }
      if (current === null) return receiptError('READING_NO_BOOK', '还没有打开书（先调用 book.open）')
      const page = reader.getPage(current, args.index)
      if (page === null || page === undefined || page.ok !== true) {
        return receiptError(page && page.code ? page.code : 'BOOK_INVALID_PAGE', page && page.message ? page.message : '页码非法')
      }
      emit(READING_EVENTS.page, { title: current.title, index: page.page.index, total: page.page.total })
      if (page.page.index === page.page.total) {
        emit(READING_EVENTS.finished, { title: current.title, total: page.page.total })
      }
      return {
        ok: true,
        detail: '第 ' + page.page.index + '/' + page.page.total + ' 页',
        facts: { index: page.page.index, total: page.page.total, chars: page.page.chars, text: page.page.text.slice(0, 200) },
      }
    },
    'book.note': async (args) => {
      const text = String(args.text ?? '').trim()
      if (text.length === 0) return receiptError('READING_NOTE_EMPTY', '笔记内容不能为空')
      const page = Number.isFinite(Number(args.page)) ? Math.max(1, Math.floor(Number(args.page))) : current === null ? null : 1
      const added = notes.add({
        text,
        page,
        bookId: current !== null ? current.path : typeof args.bookId === 'string' ? args.bookId : '',
        kind: args.stuck === true ? 'stuck' : 'note',
        quote: args.quote,
      })
      if (added === null || added === undefined || added.ok !== true) {
        return receiptError(added && added.code ? added.code : 'READING_NOTE_FAILED', added && added.message ? added.message : '保存笔记失败')
      }
      const type = args.stuck === true ? READING_EVENTS.stuck : READING_EVENTS.note
      emit(type, { noteId: added.note.id, page, bookId: added.note.bookId, text: added.note.text.slice(0, 120) })
      return { ok: true, detail: args.stuck === true ? '已记录卡住' : '笔记已保存', facts: { noteId: added.note.id, page, kind: added.note.kind, total: notes.snapshot().total } }
    },
    'book.highlight': async (args) => {
      if (current === null) return receiptError('READING_NO_BOOK', '还没有打开书（先调用 book.open）')
      const text = String(args.text ?? '').trim()
      if (text.length === 0) return receiptError('READING_HIGHLIGHT_EMPTY', '高亮内容不能为空')
      const page = reader.getPage(current, args.page)
      if (page === null || page === undefined || page.ok !== true) {
        return receiptError(page && page.code ? page.code : 'BOOK_INVALID_PAGE', page && page.message ? page.message : '页码非法')
      }
      const added = notes.add({ text, page: page.page.index, bookId: current.path, kind: 'highlight', quote: text })
      if (added === null || added === undefined || added.ok !== true) {
        return receiptError(added && added.code ? added.code : 'READING_HIGHLIGHT_FAILED', added && added.message ? added.message : '保存高亮失败')
      }
      emit(READING_EVENTS.note, { noteId: added.note.id, page: page.page.index, kind: 'highlight' })
      return { ok: true, detail: '已高亮第 ' + page.page.index + ' 页', facts: { noteId: added.note.id, page: page.page.index, kind: 'highlight', total: notes.snapshot().total } }
    },
  }

  const activity = defineActivity({
    manifest: READING_MANIFEST_RAW,
    tools,
    health: async () => ({
      ok: true,
      status: 'healthy',
      detail: current === null ? '空闲' : '正在读《' + current.title + '》',
    }),
    now,
  })
  if (activity.ok !== true) return { ok: false, code: activity.code, message: activity.message, errors: activity.errors, reader, notes }

  function snapshot() {
    return {
      ok: true,
      version: READING_ACTIVITY_VERSION,
      activity: activity.snapshot(),
      current: current === null ? null : { title: current.title, kind: current.kind, pageCount: current.pageCount, path: current.path },
      notes: notes.snapshot(),
      events: events.slice(-20),
    }
  }

  return { ok: true, activity, reader, notes, snapshot, get current() { return current }, events }
}
