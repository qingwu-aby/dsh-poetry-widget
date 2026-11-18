// @ts-check
// lib/core/file-memory-provider.mjs —— 可持久化的 Memory Gateway provider（Gate K1）。
//
// 目的：把 H5/I4 双写用的内存 provider（hub-bridge）换成 JSONL 文件 provider：
//   · 默认 memoryWrite=false 时不会被创建/写入（零写盘）；
//   · 开启后 Gateway 写入追加到 `$DSH_HOME/.dsh-poetry/memory-gateway.jsonl`，重启时加载回 Gateway，
//     query/read 能查到之前双写的条目；
//   · provider 契约与 createInMemoryMemoryProvider 一致：{id,kind,permissions,read,write,query,snapshot,clear}；
//   · write 按 entry.id upsert（先更新内存再追加一行；追加失败返回 ok:false 但不抛，旧条目仍在）；
//   · 加载有界（最多 maxBytes/maxEntries）、坏行跳过、文件超过 maxBytes 轮转到 <file>.1。
//
// 纯本地文件：不联网/无宿主依赖；时钟/文件路径/上限均可注入。

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { isPlainObject } from './file-stores.mjs'

/** 实现版本。 */
export const FILE_MEMORY_PROVIDER_VERSION = 1

/** 默认文件上限（8MB；超过轮转到 <file>.1）。 */
export const DEFAULT_FILE_MEMORY_MAX_BYTES = 8 * 1024 * 1024

/** 默认启动加载条目上限。 */
export const DEFAULT_FILE_MEMORY_MAX_ENTRIES = 5000

function cloneEntry(entry) {
  try {
    return JSON.parse(JSON.stringify(entry))
  } catch (error) {
    void error
    return null
  }
}

function fileSize(file) {
  try {
    return statSync(file).size
  } catch (error) {
    void error
    return 0
  }
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function readPositiveInt(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

/** 读取文件尾部 maxBytes 字节（避免大文件一次性读入）。 */
function readTailText(file, maxBytes) {
  if (!existsSync(file)) return { ok: true, text: '', truncated: false }
  try {
    const size = fileSize(file)
    const readBytes = Math.min(size, maxBytes)
    if (readBytes <= 0) return { ok: true, text: '', truncated: false }
    const fd = openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(readBytes)
      const bytesRead = readSync(fd, buffer, 0, readBytes, size - readBytes)
      let text = buffer.subarray(0, bytesRead).toString('utf8')
      if (size > readBytes) {
        const firstBreak = text.indexOf('\n')
        if (firstBreak >= 0) text = text.slice(firstBreak + 1)
      }
      return { ok: true, text, truncated: size > readBytes }
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    void error
    return { ok: false, text: '', truncated: false }
  }
}

/**
 * 创建 JSONL 文件 Memory Gateway provider。
 * @param {{
 *   file: string,
 *   id?: string,
 *   kind?: string,
 *   permissions?: {read?: boolean, write?: boolean},
 *   maxBytes?: number,
 *   maxEntries?: number,
 *   now?: () => number,
 *   logger?: object|null,
 * }} options
 */
export function createFileMemoryProvider(options) {
  const spec = isPlainObject(options) ? options : {}
  const file = typeof spec.file === 'string' && spec.file.length > 0 ? spec.file : ''
  if (file.length === 0) throw new TypeError('createFileMemoryProvider 需要 file')
  const id = typeof spec.id === 'string' && spec.id.length > 0 ? spec.id : 'file-memory'
  const kind = typeof spec.kind === 'string' && spec.kind.length > 0 ? spec.kind : 'file'
  const permissions = {
    read: spec.permissions === undefined || spec.permissions.read !== false,
    write: spec.permissions === undefined || spec.permissions.write !== false,
  }
  const maxBytes = readPositiveInt(spec.maxBytes, DEFAULT_FILE_MEMORY_MAX_BYTES, 512 * 1024 * 1024)
  const maxEntries = readPositiveInt(spec.maxEntries, DEFAULT_FILE_MEMORY_MAX_ENTRIES, 100000)
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const logger = /** @type {any} */ (spec.logger ?? null)
  const entries = new Map()
  const stats = { loads: 0, writes: 0, errors: 0, badLines: 0, rotations: 0, lastError: null }

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch (error) {
      void error
    }
  }

  function load() {
    stats.loads += 1
    const tail = readTailText(file, maxBytes)
    if (tail.ok !== true) {
      stats.errors += 1
      stats.lastError = 'read failed'
      return { ok: false, entries: entries.size, badLines: stats.badLines, truncated: false }
    }
    const parsed = []
    for (const line of tail.text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        const entry = JSON.parse(trimmed)
        if (isPlainObject(entry) && typeof entry.id === 'string' && entry.id.length > 0) parsed.push(entry)
        else stats.badLines += 1
      } catch (error) {
        void error
        stats.badLines += 1
      }
    }
    const kept = parsed.slice(-maxEntries)
    entries.clear()
    for (const entry of kept) entries.set(entry.id, cloneEntry(entry))
    return { ok: true, entries: entries.size, badLines: stats.badLines, truncated: tail.truncated }
  }

  function matches(entry, filter) {
    const specFilter = isPlainObject(filter) ? filter : {}
    if (
      typeof specFilter.category === 'string' &&
      specFilter.category.length > 0 &&
      entry.category !== specFilter.category
    ) {
      return false
    }
    if (typeof specFilter.activity === 'string' && specFilter.activity.length > 0) {
      const activity = isPlainObject(entry.provenance) ? entry.provenance.activity : ''
      const sourceActivity = isPlainObject(entry.source) ? entry.source.activity : ''
      if (activity !== specFilter.activity && sourceActivity !== specFilter.activity) return false
    }
    const text = normalizeText(specFilter.text)
    if (text.length > 0 && normalizeText(entry.text).toLowerCase().indexOf(text.toLowerCase()) < 0) return false
    return true
  }

  function list(filter) {
    const specFilter = isPlainObject(filter) ? filter : {}
    const limit = readPositiveInt(specFilter.limit, 100, maxEntries)
    const out = []
    for (const entry of entries.values()) {
      if (!matches(entry, specFilter)) continue
      out.push(cloneEntry(entry))
      if (out.length >= limit) break
    }
    return out
  }

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
      warn(`memory provider 轮转失败：${stats.lastError}`)
    }
  }

  function write(entry) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
      return { ok: false, code: 'MEMORY_INVALID_ENTRY', message: 'provider 需要带 id 的 entry' }
    }
    entries.set(entry.id, cloneEntry(entry))
    let line = ''
    try {
      line = JSON.stringify(entry)
    } catch (error) {
      stats.errors += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      return { ok: false, message: stats.lastError }
    }
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      rotateIfNeeded()
      appendFileSync(file, line + '\n')
      stats.writes += 1
      return { ok: true }
    } catch (error) {
      stats.errors += 1
      stats.lastError = error instanceof Error ? error.message : String(error)
      warn(`memory provider 写入失败：${stats.lastError}`)
      return { ok: false, message: stats.lastError }
    }
  }

  function read(filter) {
    return list(filter)
  }

  function query(filter) {
    return list(filter)
  }

  function snapshot() {
    return {
      ok: true,
      version: FILE_MEMORY_PROVIDER_VERSION,
      id,
      kind,
      file,
      permissions: { ...permissions },
      entries: entries.size,
      bytes: fileSize(file),
      maxBytes,
      maxEntries,
      ...stats,
      now: now(),
    }
  }

  function clear() {
    entries.clear()
    try {
      if (existsSync(file)) unlinkSync(file)
      return { ok: true }
    } catch (error) {
      stats.errors += 1
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  // 启动加载（有界；坏行跳过；失败只记录，不抛）。
  const loaded = load()
  if (loaded.ok !== true) warn('memory provider 启动加载失败，使用空集合')

  return { id, kind, permissions, file, read, query, write, snapshot, clear, load }
}
