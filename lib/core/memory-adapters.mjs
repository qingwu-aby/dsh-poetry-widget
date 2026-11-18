// lib/core/memory-adapters.mjs —— 现有记忆的只读适配器（Gate C3，接入 Gate C1 Memory Gateway）。
//
// 目标：把“已经在文件里的记忆”以只读 provider 的形式接进 Memory Gateway，**不改变现有写入路径**：
//   · journalProvider({dir|file})：只读 agent-memory/journal.jsonl（逐行 JSON；坏行跳过并计数）；
//   · gameMemoryProvider({dir|file})：只读 game-memory：
//       - workspace 目录：PARTNER_GAME.md 短画像 + world/players/build/methods/inquiry/vision/todo/log 等 md；
//       - legacy JSON：game-memory.json（entries[{category,text,at,source}]）；
//   · methodMemoryProvider({file|dir})：只读 methods.json（entries[{id,name,howTo,...}]）。
//
// 约束：
//   · 只读：只用 fs 读 API，绝不 write/mkdir/rename；provider 声明 permissions {read:true, write:false}，
//     没有 write 函数（Gateway 侧写入会得到 MEMORY_PERMISSION_DENIED）；
//   · 大文件限流：字节上限（默认 8MB，超出读尾部/或 JSON 报 FILE_TOO_LARGE）+ 行数上限（默认 5000）；
//   · 统一返回条目 {id, text, category, at, source, provenance}（category 映射到 Gateway 白名单）；
//   · 缺失文件/目录 → 空结果（不抛错）；坏 JSON/超大 JSON → 抛带 code 的错误（由 Gateway 隔离计数）。
//
// 纯逻辑：不联网/无宿主依赖；不接 live 数据（测试用临时 fixture）。

import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

/** 适配器实现版本。 */
export const MEMORY_ADAPTERS_VERSION = 1

/** 错误码（provider 抛错时 error.code）。 */
export const MEMORY_ADAPTER_CODES = Object.freeze({
  invalidOptions: 'MEMORY_ADAPTER_INVALID_OPTIONS',
  fileTooLarge: 'MEMORY_ADAPTER_FILE_TOO_LARGE',
  parseError: 'MEMORY_ADAPTER_PARSE_ERROR',
  readError: 'MEMORY_ADAPTER_READ_ERROR',
})

/** 默认限流。 */
export const MEMORY_ADAPTER_DEFAULTS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxLines: 5000,
  maxFiles: 50,
  maxEntryText: 500,
  defaultLimit: 100,
  maxLimit: 500,
})

/** journal kind → Gateway category。 */
export const JOURNAL_KIND_CATEGORY = Object.freeze({
  thought: 'episodic',
  murmur: 'episodic',
  chat: 'episodic',
  daily: 'episodic',
  learning: 'semantic',
  read: 'semantic',
  insight: 'semantic',
  method: 'method',
  vision: 'vision',
})

/** game-memory 分类 → Gateway category。 */
export const GAME_CATEGORY_MAP = Object.freeze({
  world: 'semantic',
  player: 'relationship',
  session: 'episodic',
  event: 'episodic',
  plan: 'vision',
  build: 'skill',
  method: 'method',
  inquiry: 'reflection',
  vision: 'vision',
})

/** workspace md 文件 → game 分类。 */
const GAME_WORKSPACE_FILES = Object.freeze([
  { file: 'world.md', category: 'world' },
  { file: 'players.md', category: 'player' },
  { file: 'build/home.md', category: 'build' },
  { file: 'methods.md', category: 'method' },
  { file: 'inquiry.md', category: 'inquiry' },
  { file: 'vision.md', category: 'vision' },
  { file: 'todo.md', category: 'plan' },
])


function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function clampText(value, max) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function adapterError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** 读文件尾部（最多 maxBytes），返回 {text, size, bytes, truncated, missing}。 */
function readTextCapped(file, maxBytes) {
  if (!existsSync(file)) return { ok: true, text: '', size: 0, bytes: 0, truncated: false, missing: true }
  let size = 0
  try {
    size = statSync(file).size
  } catch (error) {
    throw adapterError(MEMORY_ADAPTER_CODES.readError, `stat 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (size === 0) return { ok: true, text: '', size: 0, bytes: 0, truncated: false, missing: false }
  const readBytes = Math.min(size, maxBytes)
  let fd = null
  try {
    fd = openSync(file, 'r')
    const buffer = Buffer.alloc(readBytes)
    readSync(fd, buffer, 0, readBytes, size - readBytes)
    return {
      ok: true,
      text: buffer.toString('utf8'),
      size,
      bytes: readBytes,
      truncated: size > readBytes,
      missing: false,
    }
  } catch (error) {
    throw adapterError(MEMORY_ADAPTER_CODES.readError, `读取失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch (error) {
        void error
      }
    }
  }
}

/** 读 JSON（超过 maxBytes → FILE_TOO_LARGE；解析失败 → PARSE_ERROR；缺失 → missing）。 */
function readJsonCapped(file, maxBytes) {
  if (!existsSync(file)) return { ok: true, data: null, missing: true, bytes: 0 }
  let size = 0
  try {
    size = statSync(file).size
  } catch (error) {
    throw adapterError(MEMORY_ADAPTER_CODES.readError, `stat 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (size > maxBytes) {
    throw adapterError(
      MEMORY_ADAPTER_CODES.fileTooLarge,
      `文件过大（${size} > ${maxBytes} 字节），拒绝读取以避免阻塞`,
    )
  }
  try {
    return { ok: true, data: JSON.parse(readFileSync(file, 'utf8')), missing: false, bytes: size }
  } catch (error) {
    throw adapterError(
      MEMORY_ADAPTER_CODES.parseError,
      `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function makeReadOnlyProvider(options) {
  const id = options.id
  const kind = options.kind
  const stats = { reads: 0, errors: 0, entries: 0, badLines: 0, files: 0, truncated: false, lastError: null }
  return {
    id,
    kind,
    permissions: { read: true, write: false },
    read(filter) {
      return readEntries(filter)
    },
    query(filter) {
      return readEntries(filter)
    },
    snapshot() {
      return {
        ok: true,
        id,
        kind,
        permissions: { read: true, write: false },
        stats: { ...stats },
      }
    },
  }

  function readEntries(filter) {
    const spec = isPlainObject(filter) ? filter : {}
    const limit = Math.min(readPositiveInt(spec.limit, MEMORY_ADAPTER_DEFAULTS.defaultLimit), MEMORY_ADAPTER_DEFAULTS.maxLimit)
    stats.reads += 1
    try {
      const entries = options.collect(spec, stats)
      const filtered = []
      for (const entry of entries) {
        if (typeof spec.category === 'string' && spec.category.length > 0 && entry.category !== spec.category) continue
        if (typeof spec.activity === 'string' && spec.activity.length > 0) {
          const activity = isPlainObject(entry.provenance) ? entry.provenance.activity : ''
          if (activity !== spec.activity) continue
        }
        if (typeof spec.text === 'string' && spec.text.trim().length > 0) {
          if (entry.text.toLowerCase().indexOf(spec.text.trim().toLowerCase()) < 0) continue
        }
        filtered.push(entry)
        if (filtered.length >= limit) break
      }
      stats.entries = filtered.length
      return filtered
    } catch (error) {
      stats.errors += 1
      stats.lastError = { code: error && error.code ? error.code : MEMORY_ADAPTER_CODES.readError, message: error instanceof Error ? error.message : String(error) }
      throw error
    }
  }
}

/**
 * journal.jsonl 只读 provider。
 * @param {{dir?: string, file?: string, id?: string, maxBytes?: number, maxLines?: number}} [options]
 */
export function journalProvider(options = {}) {
  const dir = typeof options.dir === 'string' && options.dir.length > 0 ? options.dir : ''
  const file = typeof options.file === 'string' && options.file.length > 0 ? options.file : dir ? path.join(dir, 'journal.jsonl') : ''
  if (file.length === 0) throw new TypeError('journalProvider 需要 dir 或 file')
  const maxBytes = readPositiveInt(options.maxBytes, MEMORY_ADAPTER_DEFAULTS.maxBytes)
  const maxLines = readPositiveInt(options.maxLines, MEMORY_ADAPTER_DEFAULTS.maxLines)
  return makeReadOnlyProvider({
    id: typeof options.id === 'string' && options.id.length > 0 ? options.id : 'journal',
    kind: 'journal',
    collect(_spec, stats) {
      const read = readTextCapped(file, maxBytes)
      stats.truncated = read.truncated
      stats.files = read.missing ? 0 : 1
      if (read.missing) return []
      let text = read.text
      if (read.truncated) {
        const firstBreak = text.indexOf('\n')
        if (firstBreak >= 0) text = text.slice(firstBreak + 1)
      }
      const lines = text.split('\n').filter((line) => line.trim().length > 0)
      const tail = lines.slice(-maxLines)
      const entries = []
      tail.forEach((line, index) => {
        let parsed = null
        try {
          parsed = JSON.parse(line)
        } catch (error) {
          void error
          stats.badLines += 1
          return
        }
        if (!isPlainObject(parsed) || typeof parsed.text !== 'string') {
          stats.badLines += 1
          return
        }
        const journalKind = typeof parsed.kind === 'string' ? parsed.kind : 'thought'
        const at = Number.isFinite(Number(parsed.ts)) ? Number(parsed.ts) : 0
        entries.push({
          id: 'journal:' + (at > 0 ? at : 'line') + ':' + index,
          text: clampText(parsed.text, MEMORY_ADAPTER_DEFAULTS.maxEntryText),
          category: JOURNAL_KIND_CATEGORY[journalKind] ?? 'episodic',
          at,
          source: { kind: 'journal', id: 'journal.jsonl', activity: journalKind },
          provenance: { at, activity: journalKind, journalKind },
        })
      })
      return entries
    },
  })
}

/** 解析 workspace md 中的条目行：`- text（source）[YYYY-MM-DD]`。 */
function parseMarkdownEntries(content, category, sourceFile, stats) {
  const out = []
  let index = 0
  for (const rawLine of String(content || '').split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const matched = /^[-*]\s+(.*?)(?:\s*（(.*?)）)?(?:\s*\[(\d{4}-\d{2}-\d{2})\])?$/.exec(line)
    if (matched === null) continue
    const text = clampText(matched[1], MEMORY_ADAPTER_DEFAULTS.maxEntryText)
    if (text.length === 0) continue
    index += 1
    const at = matched[3] ? Date.parse(matched[3] + 'T00:00:00Z') : 0
    out.push({
      id: 'game:' + category + ':' + index,
      text,
      category: GAME_CATEGORY_MAP[category] ?? 'episodic',
      at,
      source: { kind: 'game-memory', id: sourceFile, activity: category },
      provenance: { at, activity: category, source: matched[2] ?? '' },
    })
  }
  stats.badLines += 0
  return out
}

/**
 * game-memory 只读 provider：支持 workspace 目录（PARTNER_GAME.md + 分类 md + log/）与 legacy JSON。
 * @param {{dir?: string, file?: string, id?: string, maxBytes?: number, maxFiles?: number, includeLogs?: boolean, includeArchive?: boolean}} [options]
 */
export function gameMemoryProvider(options = {}) {
  const dir = typeof options.dir === 'string' && options.dir.length > 0 ? options.dir : ''
  const explicitFile = typeof options.file === 'string' && options.file.length > 0 ? options.file : ''
  if (dir.length === 0 && explicitFile.length === 0) throw new TypeError('gameMemoryProvider 需要 dir 或 file')
  const maxBytes = readPositiveInt(options.maxBytes, MEMORY_ADAPTER_DEFAULTS.maxBytes)
  const maxFiles = readPositiveInt(options.maxFiles, MEMORY_ADAPTER_DEFAULTS.maxFiles)
  const includeLogs = options.includeLogs !== false
  const includeArchive = options.includeArchive === true
  return makeReadOnlyProvider({
    id: typeof options.id === 'string' && options.id.length > 0 ? options.id : 'game-memory',
    kind: 'game-memory',
    collect(_spec, stats) {
      const legacyFile = explicitFile.length > 0 ? explicitFile : path.join(dir, 'game-memory.json')
      if (existsSync(legacyFile)) return collectLegacy(legacyFile, maxBytes, stats)
      if (dir.length === 0 || !existsSync(dir)) return []
      return collectWorkspace(dir, maxBytes, maxFiles, includeLogs, includeArchive, stats)
    },
  })
}

function collectLegacy(file, maxBytes, stats) {
  const read = readJsonCapped(file, maxBytes)
  stats.files = read.missing ? 0 : 1
  if (read.missing || !isPlainObject(read.data) || !Array.isArray(read.data.entries)) return []
  const entries = []
  read.data.entries.forEach((item, index) => {
    if (!isPlainObject(item) || typeof item.text !== 'string') return
    const gameCategory = typeof item.category === 'string' ? item.category : 'event'
    const at = Number.isFinite(Number(item.at)) ? Number(item.at) : 0
    entries.push({
      id: 'game:legacy:' + (at > 0 ? at : 'line') + ':' + index,
      text: clampText(item.text, MEMORY_ADAPTER_DEFAULTS.maxEntryText),
      category: GAME_CATEGORY_MAP[gameCategory] ?? 'episodic',
      at,
      source: { kind: 'game-memory', id: 'game-memory.json', activity: gameCategory },
      provenance: { at, activity: gameCategory, source: typeof item.source === 'string' ? item.source : '' },
    })
  })
  return entries
}

function collectWorkspace(dir, maxBytes, maxFiles, includeLogs, includeArchive, stats) {
  const entries = []
  const partnerFile = path.join(dir, 'PARTNER_GAME.md')
  if (existsSync(partnerFile)) {
    const read = readTextCapped(partnerFile, maxBytes)
    stats.truncated = stats.truncated || read.truncated
    if (!read.missing) {
      stats.files += 1
      const lines = read.text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
      if (lines.length > 0) {
        entries.push({
          id: 'game:profile:0',
          text: clampText(lines.join(' '), MEMORY_ADAPTER_DEFAULTS.maxEntryText),
          category: 'relationship',
          at: 0,
          source: { kind: 'game-memory', id: 'PARTNER_GAME.md', activity: 'profile' },
          provenance: { at: 0, activity: 'profile' },
        })
      }
    }
  }
  for (const item of GAME_WORKSPACE_FILES) {
    const file = path.join(dir, item.file)
    if (!existsSync(file)) continue
    const read = readTextCapped(file, maxBytes)
    stats.truncated = stats.truncated || read.truncated
    if (read.missing) continue
    stats.files += 1
    entries.push(...parseMarkdownEntries(read.text, item.category, item.file, stats))
  }
  const logDir = path.join(dir, 'log')
  if (includeLogs && existsSync(logDir)) {
    let files = []
    try {
      files = readdirSync(logDir)
        .filter((name) => name.endsWith('.md'))
        .sort()
    } catch (error) {
      void error
      files = []
    }
    for (const name of files.slice(-maxFiles)) {
      const file = path.join(logDir, name)
      const read = readTextCapped(file, maxBytes)
      stats.truncated = stats.truncated || read.truncated
      if (read.missing) continue
      stats.files += 1
      const category = name.includes('-') ? 'session' : 'event'
      const parsed = parseMarkdownEntries(read.text, category, 'log/' + name, stats)
      for (const entry of parsed) entry.id = 'game:log:' + name + ':' + entry.id.split(':').pop()
      entries.push(...parsed)
    }
  }
  if (includeArchive) {
    const archiveDir = path.join(dir, 'archive')
    if (existsSync(archiveDir)) {
      let files = []
      try {
        files = readdirSync(archiveDir).filter((name) => name.endsWith('.md')).sort()
      } catch (error) {
        void error
        files = []
      }
      for (const name of files.slice(-maxFiles)) {
        const read = readTextCapped(path.join(archiveDir, name), maxBytes)
        if (read.missing) continue
        stats.files += 1
        entries.push(...parseMarkdownEntries(read.text, 'event', 'archive/' + name, stats))
      }
    }
  }
  return entries
}

/**
 * methods.json 只读 provider。
 * @param {{file?: string, dir?: string, id?: string, maxBytes?: number}} [options]
 */
export function methodMemoryProvider(options = {}) {
  const dir = typeof options.dir === 'string' && options.dir.length > 0 ? options.dir : ''
  const file =
    typeof options.file === 'string' && options.file.length > 0 ? options.file : dir ? path.join(dir, 'methods.json') : ''
  if (file.length === 0) throw new TypeError('methodMemoryProvider 需要 file 或 dir')
  const maxBytes = readPositiveInt(options.maxBytes, MEMORY_ADAPTER_DEFAULTS.maxBytes)
  return makeReadOnlyProvider({
    id: typeof options.id === 'string' && options.id.length > 0 ? options.id : 'method-memory',
    kind: 'method-memory',
    collect(_spec, stats) {
      const read = readJsonCapped(file, maxBytes)
      stats.files = read.missing ? 0 : 1
      if (read.missing || !isPlainObject(read.data) || !Array.isArray(read.data.entries)) return []
      const entries = []
      read.data.entries.forEach((item, index) => {
        if (!isPlainObject(item) || typeof item.name !== 'string' || typeof item.howTo !== 'string') return
        const name = clampText(item.name, 40)
        const howTo = clampText(item.howTo, 200)
        if (name.length < 2 || howTo.length < 4) return
        const at = Number.isFinite(Number(item.lastAt)) ? Number(item.lastAt) : 0
        entries.push({
          id: 'method:' + (typeof item.id === 'string' && item.id.length > 0 ? item.id : index),
          text: clampText(name + '：' + howTo, MEMORY_ADAPTER_DEFAULTS.maxEntryText),
          category: 'method',
          at,
          source: { kind: 'method-memory', id: 'methods.json', activity: 'method' },
          provenance: {
            at,
            activity: 'method',
            source: typeof item.source === 'string' ? item.source : '',
            usedCount: Number.isFinite(Number(item.usedCount)) ? Number(item.usedCount) : 0,
            successCount: Number.isFinite(Number(item.successCount)) ? Number(item.successCount) : 0,
          },
        })
      })
      return entries
    },
  })
}
