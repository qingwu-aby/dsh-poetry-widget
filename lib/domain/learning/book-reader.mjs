// @ts-check
// lib/domain/learning/book-reader.mjs —— 本地书阅读器（Gate L2，纯本地，不联网）。
//
// 支持：.txt/.md/.markdown 直接读取；.pdf 仅当系统存在 `pdftotext` 时调用（不安装任何依赖）。
//   · open(path) → {title, kind, pages[], chars, pageCount}；
//   · paginate(text,{maxChars}) 分页（优先段落/行边界）；getPage(book,index)（1 起）；
//   · search(book, query) 可选；
//   · 路径安全：拒绝空字节/目录/不存在；配置 rootDir 时拒绝越界路径；读失败给明确错误码。
//
// 纯本地文件读取：不联网/不写盘；readFile/exec/时钟可注入（便于测试 PDF 分支）。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** 实现版本。 */
export const BOOK_READER_VERSION = 1

/** 支持的书类型。 */
export const BOOK_KINDS = Object.freeze(['text', 'markdown', 'pdf'])

/** 错误码。 */
export const BOOK_READER_CODES = Object.freeze({
  invalidPath: 'BOOK_INVALID_PATH',
  outsideRoot: 'BOOK_OUTSIDE_ROOT',
  notFound: 'BOOK_NOT_FOUND',
  notFile: 'BOOK_NOT_FILE',
  unsupported: 'BOOK_UNSUPPORTED_TYPE',
  pdfToolMissing: 'BOOK_PDF_TOOL_MISSING',
  permissionDenied: 'BOOK_PERMISSION_DENIED',
  readFailed: 'BOOK_READ_FAILED',
  invalidPage: 'BOOK_INVALID_PAGE',
})

/** 默认每页字符数。 */
export const DEFAULT_PAGE_CHARS = 4000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function readPositiveInt(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.txt') return 'text'
  if (ext === '.pdf') return 'pdf'
  return null
}

function titleOf(file) {
  const base = path.basename(file, path.extname(file))
  return base.length > 0 ? base.slice(0, 120) : '未命名'
}

/** 按 maxChars 分页；优先在段落/换行边界切，避免把词切断。 */
export function paginate(text, options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const maxChars = readPositiveInt(spec.maxChars, DEFAULT_PAGE_CHARS, 200000)
  const raw = String(text ?? '').replace(/\r\n/g, '\n')
  if (raw.length === 0) return ['']
  const pages = []
  let cursor = 0
  while (cursor < raw.length) {
    let end = Math.min(raw.length, cursor + maxChars)
    if (end < raw.length) {
      const slice = raw.slice(cursor, end)
      const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('。'), slice.lastIndexOf(' '))
      if (breakAt > Math.floor(maxChars * 0.5)) end = cursor + breakAt + 1
    }
    pages.push(raw.slice(cursor, end))
    cursor = end
  }
  return pages
}

/**
 * 创建本地书阅读器。
 * @param {{
 *   rootDir?: string|null,
 *   maxChars?: number,
 *   readFile?: ((file: string, encoding: string) => string)|null,
 *   execPdfText?: ((file: string) => string)|null,
 *   now?: () => number,
 *   logger?: object|null,
 * }} [options]
 */
export function createBookReader(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const rootDir = typeof spec.rootDir === 'string' && spec.rootDir.length > 0 ? path.resolve(spec.rootDir) : null
  const maxChars = readPositiveInt(spec.maxChars, DEFAULT_PAGE_CHARS, 200000)
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const readFile =
    typeof spec.readFile === 'function' ? spec.readFile : (file, encoding) => readFileSync(file, encoding)
  const execPdfText =
    typeof spec.execPdfText === 'function'
      ? spec.execPdfText
      : (file) => execFileSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

  function resolvePath(input) {
    if (typeof input !== 'string' || input.trim().length === 0) {
      return errorResult(BOOK_READER_CODES.invalidPath, 'path 必须是非空字符串')
    }
    const raw = input.trim()
    if (raw.indexOf('\0') >= 0) return errorResult(BOOK_READER_CODES.invalidPath, 'path 包含非法字符')
    const resolved = path.resolve(rootDir !== null && !path.isAbsolute(raw) ? rootDir : process.cwd(), raw)
    if (rootDir !== null) {
      const relative = path.relative(rootDir, resolved)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return errorResult(BOOK_READER_CODES.outsideRoot, 'path 越界（不在允许的根目录内）')
      }
    }
    return { ok: true, file: resolved }
  }

  function readText(file, kind) {
    try {
      const text = readFile(file, 'utf8')
      return { ok: true, text: typeof text === 'string' ? text : String(text) }
    } catch (error) {
      const code = error !== null && error !== undefined && error.code === 'EACCES' ? BOOK_READER_CODES.permissionDenied : BOOK_READER_CODES.readFailed
      return errorResult(code, error instanceof Error ? error.message : String(error))
    }
  }

  function readPdf(file) {
    try {
      const text = execPdfText(file)
      return { ok: true, text: typeof text === 'string' ? text : String(text ?? '') }
    } catch (error) {
      const code = error !== null && error !== undefined && (error.code === 'ENOENT' || /not found/i.test(String(error.message))) ? BOOK_READER_CODES.pdfToolMissing : BOOK_READER_CODES.readFailed
      return errorResult(code, code === BOOK_READER_CODES.pdfToolMissing ? '系统没有 pdftotext，无法解析 PDF（未安装依赖）' : error instanceof Error ? error.message : String(error))
    }
  }

  function buildBook(file, kind, text) {
    const pages = paginate(text, { maxChars })
    return {
      ok: true,
      book: {
        path: file,
        title: titleOf(file),
        kind,
        chars: text.length,
        pageCount: pages.length,
        pages,
        openedAt: now(),
      },
    }
  }

  /** 打开本地书（txt/md/markdown；pdf 需系统 pdftotext）。 */
  function open(input) {
    const resolved = resolvePath(input)
    if (resolved.ok !== true) return resolved
    const file = resolved.file
    if (existsSync(file)) {
      try {
        if (statSync(file).isDirectory()) return errorResult(BOOK_READER_CODES.notFile, 'path 是目录，不是文件')
      } catch (error) {
        return errorResult(BOOK_READER_CODES.readFailed, error instanceof Error ? error.message : String(error))
      }
    }
    const kind = kindOf(file)
    if (kind === null) return errorResult(BOOK_READER_CODES.unsupported, '只支持 .txt/.md/.markdown/.pdf：' + path.extname(file))
    if (!existsSync(file)) return errorResult(BOOK_READER_CODES.notFound, '文件不存在：' + file)
    const content = kind === 'pdf' ? readPdf(file) : readText(file, kind)
    if (content.ok !== true) return content
    return buildBook(file, kind, content.text)
  }

  /** 取第 index 页（1 起）。 */
  function getPage(book, index) {
    if (!isPlainObject(book) || !Array.isArray(book.pages)) {
      return errorResult(BOOK_READER_CODES.invalidPage, 'book 必须是 open() 的产物')
    }
    const pageIndex = Math.floor(Number(index))
    if (!Number.isFinite(pageIndex) || pageIndex < 1 || pageIndex > book.pages.length) {
      return errorResult(BOOK_READER_CODES.invalidPage, `页码越界：${String(index)}（共 ${book.pages.length} 页）`)
    }
    return {
      ok: true,
      page: {
        index: pageIndex,
        total: book.pages.length,
        text: book.pages[pageIndex - 1],
        chars: Array.from(book.pages[pageIndex - 1]).length,
        title: book.title,
      },
    }
  }

  /** 在书中搜索（不区分大小写；返回最多 limit 条命中）。 */
  function search(book, query, options = {}) {
    if (!isPlainObject(book) || !Array.isArray(book.pages)) {
      return errorResult(BOOK_READER_CODES.invalidPage, 'book 必须是 open() 的产物')
    }
    const needle = String(query ?? '').trim()
    if (needle.length === 0) return { ok: true, matches: [] }
    const limit = readPositiveInt(isPlainObject(options) ? options.limit : undefined, 20, 200)
    const matches = []
    const lowered = needle.toLowerCase()
    for (let index = 0; index < book.pages.length; index += 1) {
      const pageText = book.pages[index]
      const at = pageText.toLowerCase().indexOf(lowered)
      if (at < 0) continue
      matches.push({ page: index + 1, index: at, snippet: pageText.slice(Math.max(0, at - 40), at + needle.length + 60).trim() })
      if (matches.length >= limit) break
    }
    return { ok: true, matches }
  }

  return { rootDir, maxChars, open, getPage, search, paginate }
}
