// @ts-check
// lib/core/file-stores.mjs —— Hub 持久化文件适配器（Gate I1，opt-in，纯本地文件）。
//
// 目标：给 TaskBoard/EventBus 提供可直接注入的文件 store；默认不启用（featureFlag persist=false）：
//   · createJsonTaskStore(file)：load/save 原子写（临时文件 + rename、0600），空文件/坏文件降级为 null + errors；
//   · createJsonlEventStore({file,maxBytes})：单行 JSON append；readAll/readTail 有界读取；坏行跳过；
//     文件超过 maxBytes 时轮转（file → file.1，旧 .1 覆盖）；
//   · 只读写调用方给的路径，不碰 live 数据；不联网/无宿主依赖；时钟/文件大小统计可注入。
//
// 约定：store 的失败不抛给调用方（返回 {ok:false,...} 或空结果 + errors），由上层计数/告警。

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

/** 实现版本。 */
export const FILE_STORES_VERSION = 1

/** EventBus JSONL 默认文件上限（8MB；超过轮转）。 */
export const DEFAULT_EVENT_STORE_MAX_BYTES = 8 * 1024 * 1024

/** 默认 readAll/readTail 行数上限（防大文件阻塞）。 */
export const DEFAULT_EVENT_STORE_MAX_LINES = 2000

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** 判断是否普通对象（供 Hub 运行时复用，避免重复定义）。 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function fileSize(file) {
  try {
    return statSync(file).size
  } catch (error) {
    void error
    return 0
  }
}

function ensureDir(file) {
  mkdirSync(path.dirname(file), { recursive: true })
}

/** 原子写：临时文件（0600）+ rename；失败清理临时文件并返回 {ok:false}。 */
function writeAtomic(file, content) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  let fd = null
  try {
    mkdirSync(dir, { recursive: true })
    fd = openSync(tmp, 'wx', 0o600)
    writeSync(fd, content)
    closeSync(fd)
    fd = null
    renameSync(tmp, file)
    return { ok: true }
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch (closeError) {
        void closeError
      }
    }
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch (cleanupError) {
      void cleanupError
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * TaskBoard 快照文件 store（可直接作为 createTaskBoard({store}) 注入）。
 * @param {{file?: string, now?: () => number, logger?: object|null}} [options]
 */
export function createJsonTaskStore(options = {}) {
  const file = typeof options.file === 'string' && options.file.length > 0 ? options.file : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = /** @type {any} */ (options.logger ?? null)
  if (file.length === 0) throw new TypeError('createJsonTaskStore 需要 file')
  const stats = { loads: 0, saves: 0, errors: 0, lastSavedAt: 0, lastError: null }

  function read() {
    stats.loads += 1
    const errors = []
    let data = null
    try {
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8')
        if (text.trim().length > 0) {
          const parsed = JSON.parse(text)
          if (isPlainObject(parsed)) data = parsed
          else errors.push({ path: '$', message: '任务板快照必须是对象' })
        }
      }
    } catch (error) {
      stats.errors += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      errors.push({ path: '$', message: `任务板快照读取失败：${stats.lastError}` })
      data = null
    }
    return { ok: true, data, exists: existsSync(file), errors }
  }

  /** TaskBoard 契约：load() 直接返回快照对象（缺失/坏文件 → null）。 */
  function load() {
    return read().data
  }

  function save(snapshot) {
    if (!isPlainObject(snapshot)) {
      stats.errors += 1
      stats.lastError = '任务板快照必须是对象'
      return { ok: false, message: stats.lastError }
    }
    const written = writeAtomic(file, `${JSON.stringify(snapshot)}\n`)
    if (written.ok !== true) {
      stats.errors += 1
      stats.lastError = written.message ?? 'write failed'
      try {
        logger?.warn?.(`[dsh-little-whale] 任务板持久化失败：${stats.lastError}`)
      } catch (error) {
        void error
      }
      return { ok: false, message: stats.lastError }
    }
    stats.saves += 1
    stats.lastSavedAt = now()
    return { ok: true, savedAt: stats.lastSavedAt }
  }

  function clear() {
    try {
      if (existsSync(file)) unlinkSync(file)
      return { ok: true }
    } catch (error) {
      stats.errors += 1
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  function snapshot() {
    return {
      ok: true,
      kind: 'taskboard',
      file,
      exists: existsSync(file),
      bytes: fileSize(file),
      ...stats,
    }
  }

  return { file, load, read, save, clear, snapshot }
}

/** 事件文本脱敏/截断：去掉凭证样式内容并限制长度（不改变用户原消息，只用于事件）。 */
export function sanitizeEventText(value, options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const maxLength =
    Number.isFinite(Number(spec.maxLength)) && Number(spec.maxLength) > 0 ? Math.floor(Number(spec.maxLength)) : 500
  let text = String(value == null ? '' : value)
  text = text
    .replace(/[\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length === 0) return ''
  const redacted = [
    /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
    /\b(?:sk|pk|ghp|gho|ghs|xoxb|xoxp)[-_A-Za-z0-9]{8,}\b/g,
    /\b[A-Fa-f0-9]{32,}\b/g,
    /\b(?:api[-_]?key|access[-_]?token|password|passwd|secret)\s*[:=]\s*\S+/gi,
  ]
  for (const pattern of redacted) text = text.replace(pattern, '[redacted]')
  const chars = Array.from(text)
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : chars.join('')
}

/**
 * Hub 持久化组合（Gate I1）：按 featureFlag 决定是否创建 task/event store，并提供恢复/回放辅助。
 * 默认 enabled=false → 两个 store 都为 null（完全内存态）。
 * @param {{
 *   enabled?: boolean,
 *   taskBoardFile?: string,
 *   eventFile?: string,
 *   taskStore?: object|null,
 *   eventStore?: object|null,
 *   replay?: number,
 *   now?: () => number,
 *   logger?: object|null,
 * }} [options]
 */
export function createHubPersistence(options = {}) {
  const opts = /** @type {any} */ (options)
  const enabled = opts.enabled === true
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const logger = opts.logger ?? null
  const taskStore =
    enabled && isPlainObject(opts.taskStore)
      ? opts.taskStore
      : enabled && typeof opts.taskBoardFile === 'string' && opts.taskBoardFile.length > 0
        ? createJsonTaskStore({ file: opts.taskBoardFile, now, logger })
        : null
  const eventStore =
    enabled && isPlainObject(opts.eventStore)
      ? opts.eventStore
      : enabled && typeof opts.eventFile === 'string' && opts.eventFile.length > 0
        ? createJsonlEventStore({ file: opts.eventFile, now, logger })
        : null
  const replay = readPositiveInt(opts.replay, 0)

  function restoreTasks(board) {
    if (taskStore === null || board === null || board === undefined || typeof board.restore !== 'function') return 0
    try {
      const restored = board.restore()
      return restored !== null && restored !== undefined && restored.ok === true ? Number(restored.restored) || 0 : 0
    } catch (error) {
      void error
      return 0
    }
  }

  function readReplay() {
    if (eventStore === null || replay <= 0 || typeof eventStore.readTail !== 'function') return []
    try {
      const tail = eventStore.readTail({ maxLines: replay })
      return tail !== null && Array.isArray(tail.events) ? tail.events.slice(-replay) : []
    } catch (error) {
      void error
      return []
    }
  }

  function readEvents(limit) {
    if (eventStore === null || typeof eventStore.readTail !== 'function') return { ok: true, events: [], enabled: false }
    const maxLines = readPositiveInt(limit, 50)
    const tail = eventStore.readTail({ maxLines })
    return { ok: tail.ok === true, events: Array.isArray(tail.events) ? tail.events : [], enabled: true }
  }

  function snapshot() {
    return {
      enabled,
      taskBoardFile: taskStore !== null && typeof taskStore.file === 'string' ? taskStore.file : '',
      eventFile: eventStore !== null && typeof eventStore.file === 'string' ? eventStore.file : '',
      replayOnStart: replay,
      taskStore: taskStore !== null && typeof taskStore.snapshot === 'function' ? taskStore.snapshot() : null,
      eventStore: eventStore !== null && typeof eventStore.snapshot === 'function' ? eventStore.snapshot() : null,
    }
  }

  return { enabled, taskStore, eventStore, replay, restoreTasks, readReplay, readEvents, snapshot }
}

/**
 * EventBus JSONL store（可直接作为 createEventBus({store}) 注入）。
 * append(event) 单行 JSON；readAll/readTail 有界；超过 maxBytes 轮转到 <file>.1。
 * @param {{file?: string, maxBytes?: number, now?: () => number, logger?: object|null}} [options]
 */
export function createJsonlEventStore(options = {}) {
  const file = typeof options.file === 'string' && options.file.length > 0 ? options.file : ''
  const maxBytes = readPositiveInt(options.maxBytes, DEFAULT_EVENT_STORE_MAX_BYTES)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = /** @type {any} */ (options.logger ?? null)
  if (file.length === 0) throw new TypeError('createJsonlEventStore 需要 file')
  const stats = { appends: 0, rotations: 0, errors: 0, lastAppendAt: 0, lastError: null }

  function rotateIfNeeded() {
    if (fileSize(file) < maxBytes) return
    try {
      const backup = `${file}.1`
      if (existsSync(backup)) unlinkSync(backup)
      renameSync(file, backup)
      stats.rotations += 1
    } catch (error) {
      stats.errors += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      try {
        logger?.warn?.(`[dsh-little-whale] 事件日志轮转失败：${stats.lastError}`)
      } catch (warnError) {
        void warnError
      }
    }
  }

  function append(event) {
    if (!isPlainObject(event)) return { ok: false, message: 'event 必须是对象' }
    let line = ''
    try {
      line = JSON.stringify(event)
    } catch (error) {
      stats.errors += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      return { ok: false, message: stats.lastError }
    }
    if (typeof line !== 'string' || line.length === 0 || CONTROL_CHARS.test(line)) {
      stats.errors += 1
      stats.lastError = '事件无法序列化为单行 JSON'
      return { ok: false, message: stats.lastError }
    }
    try {
      ensureDir(file)
      rotateIfNeeded()
      appendFileSync(file, line + '\n')
      stats.appends += 1
      stats.lastAppendAt = now()
      return { ok: true }
    } catch (error) {
      stats.errors += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      try {
        logger?.warn?.(`[dsh-little-whale] 事件日志写入失败：${stats.lastError}`)
      } catch (warnError) {
        void warnError
      }
      return { ok: false, message: stats.lastError }
    }
  }

  function readTextTail(maxBytes) {
    if (!existsSync(file)) return { ok: true, text: '', missing: true, truncated: false }
    try {
      const size = fileSize(file)
      const readBytes = Math.min(size, maxBytes)
      const fd = openSync(file, 'r')
      try {
        const buffer = Buffer.alloc(readBytes)
        if (readBytes > 0) {
          const position = size - readBytes
          const bytesRead = readSync(fd, buffer, 0, readBytes, position)
          return {
            ok: true,
            text: buffer.subarray(0, bytesRead).toString('utf8'),
            missing: false,
            truncated: size > readBytes,
          }
        }
        return { ok: true, text: '', missing: false, truncated: false }
      } finally {
        closeSync(fd)
      }
    } catch (error) {
      stats.errors += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      return { ok: false, text: '', missing: false, truncated: false }
    }
  }

  function parseLines(text, statsOut) {
    const events = []
    for (const line of String(text).split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (isPlainObject(parsed)) events.push(parsed)
        else statsOut.badLines += 1
      } catch (error) {
        void error
        statsOut.badLines += 1
      }
    }
    return events
  }

  function readAll(input = {}) {
    const spec = isPlainObject(input) ? input : {}
    const maxLines = readPositiveInt(spec.maxLines, DEFAULT_EVENT_STORE_MAX_LINES)
    const result = readTextTail(maxBytes)
    if (result.ok !== true) return { ok: false, events: [], badLines: 0, bytes: 0, truncated: false }
    const out = { badLines: 0 }
    let text = result.text
    if (result.truncated) {
      const firstBreak = text.indexOf('\n')
      if (firstBreak >= 0) text = text.slice(firstBreak + 1)
    }
    const events = parseLines(text, out)
    return {
      ok: true,
      events: events.slice(-maxLines),
      badLines: out.badLines,
      bytes: fileSize(file),
      truncated: result.truncated || events.length > maxLines,
    }
  }

  function readTail(input = {}) {
    return readAll(input)
  }

  function clear() {
    try {
      if (existsSync(file)) unlinkSync(file)
      return { ok: true }
    } catch (error) {
      stats.errors += 1
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  function snapshot() {
    return {
      ok: true,
      kind: 'events',
      file,
      exists: existsSync(file),
      bytes: fileSize(file),
      maxBytes,
      ...stats,
    }
  }

  return { file, append, readAll, readTail, clear, snapshot }
}
