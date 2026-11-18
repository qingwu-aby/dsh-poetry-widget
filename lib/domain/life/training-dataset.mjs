// @ts-check
// lib/domain/life/training-dataset.mjs —— 训练数据集导出（Gate M1，只读收集 + 清洗脱敏 + JSONL）。
//
// 数据来源（全部只读，不修改原文件）：
//   · journal.jsonl（agentMemoryDir）：{ts,kind,text?,label?,reason?,image?}
//   · game-memory（gameMemoryDir/*.md、build/home.md、log/*.md）：`- text [YYYY-MM-DD]`
//   · methods.json（methodsFile）：{entries:[{name,howTo,lastAt,...}]}
// 输出：归一化条目 {id,source,category,text,at} → 去空/去重/截断/基础脱敏 → JSONL 原子写 + manifest。
// 默认不自动导出；exportJsonl 需显式调用。纯本地文件：不联网。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 实现版本。 */
export const TRAINING_DATASET_VERSION = 1

/** 默认条目最大字符数（超出截断）。 */
export const TRAINING_DATASET_MAX_TEXT = 500

/** 默认最小数据量（与 training-config.dataset.minEntries 默认一致）。 */
export const TRAINING_DATASET_MIN_ENTRIES = 200

/** 数据来源标签。 */
export const TRAINING_DATASET_SOURCES = Object.freeze(['journal', 'game-memory', 'methods'])

/** 错误码。 */
export const TRAINING_DATASET_CODES = Object.freeze({
  invalidInput: 'TRAINING_DATASET_INVALID_INPUT',
  exportFailed: 'TRAINING_DATASET_EXPORT_FAILED',
})

const SENSITIVE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  /\b(?:sk|pk|ghp|gho|ghs|xoxb|xoxp)[-_A-Za-z0-9]{8,}\b/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b(?:api[-_]?key|access[-_]?token|password|passwd|secret|token)\s*[:=]\s*\S+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
]

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clean(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 基础脱敏 + 截断（返回空串表示该条不可用）。 */
export function sanitizeDatasetText(value, max = TRAINING_DATASET_MAX_TEXT) {
  let text = clean(value)
  if (text.length === 0) return ''
  for (const pattern of SENSITIVE_PATTERNS) text = text.replace(pattern, '[redacted]')
  text = clean(text)
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function entryId(source, text) {
  return 'ds-' + createHash('sha1').update(source + '|' + text).digest('hex').slice(0, 16)
}

function normalizeEntry(source, category, text, at) {
  const sanitized = sanitizeDatasetText(text)
  if (sanitized.length < 4) return null
  return {
    id: entryId(source, sanitized),
    source,
    category: clean(category).slice(0, 80) || source,
    text: sanitized,
    at: Number.isFinite(Number(at)) ? Number(at) : 0,
  }
}

function readJsonl(file, onLine) {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    void error
    return { ok: false, lines: 0, badLines: 0 }
  }
  let lines = 0
  let badLines = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (!isPlainObject(parsed)) {
        badLines += 1
        continue
      }
      lines += 1
      onLine(parsed)
    } catch (error) {
      void error
      badLines += 1
    }
  }
  return { ok: true, lines, badLines }
}

function collectJournal(agentMemoryDir, push) {
  if (typeof agentMemoryDir !== 'string' || agentMemoryDir.length === 0) return { lines: 0, badLines: 0, files: 0 }
  const file = path.join(agentMemoryDir, 'journal.jsonl')
  if (!existsSync(file)) return { lines: 0, badLines: 0, files: 0 }
  const result = readJsonl(file, (record) => {
    const kind = typeof record.kind === 'string' ? record.kind : 'journal'
    const text = [record.text, record.label, record.reason, record.image].filter((part) => typeof part === 'string').join(' — ')
    push('journal', 'journal:' + kind, text, record.ts)
  })
  return { ...result, files: 1 }
}

function collectGameMemory(gameMemoryDir, push) {
  if (typeof gameMemoryDir !== 'string' || gameMemoryDir.length === 0 || !existsSync(gameMemoryDir)) {
    return { lines: 0, badLines: 0, files: 0 }
  }
  const files = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let names = []
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      void error
      return
    }
    for (const item of names) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) walk(full, depth + 1)
      else if (item.isFile() && item.name.endsWith('.md') && item.name !== 'PARTNER_GAME.md') files.push(full)
    }
  }
  walk(gameMemoryDir, 0)
  let lines = 0
  let badLines = 0
  for (const file of files) {
    const category = path.relative(gameMemoryDir, file).replace(/\\/g, '/').replace(/\.md$/, '').replace(/\//g, '.')
    let raw = ''
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      void error
      badLines += 1
      continue
    }
    for (const line of raw.split('\n')) {
      const match = /^- (.*?)(?:\s*\[(\d{4}-\d{2}-\d{2})\])?$/.exec(line.trim())
      if (!match) continue
      const at = match[2] ? Date.parse(match[2] + 'T00:00:00Z') : 0
      lines += 1
      push('game-memory', 'game-memory:' + category, match[1], at)
    }
  }
  return { lines, badLines, files: files.length }
}

function collectMethods(methodsFile, push) {
  if (typeof methodsFile !== 'string' || methodsFile.length === 0 || !existsSync(methodsFile)) {
    return { lines: 0, badLines: 0, files: 0 }
  }
  try {
    const parsed = JSON.parse(readFileSync(methodsFile, 'utf8'))
    const entries = isPlainObject(parsed) && Array.isArray(parsed.entries) ? parsed.entries : []
    let lines = 0
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue
      const name = typeof entry.name === 'string' ? entry.name : ''
      const howTo = typeof entry.howTo === 'string' ? entry.howTo : ''
      if (name.length === 0) continue
      lines += 1
      push('methods', 'method', name + '：' + howTo, entry.lastAt)
    }
    return { lines, badLines: 0, files: 1 }
  } catch (error) {
    void error
    return { lines: 0, badLines: 1, files: 1 }
  }
}

/**
 * 只读收集并清洗数据集条目（去空/去重/截断/脱敏）。
 * @param {{agentMemoryDir?: string, gameMemoryDir?: string, methodsFile?: string}} paths
 */
export function collectTrainingDataset(paths = {}) {
  const spec = isPlainObject(paths) ? paths : {}
  const entries = []
  const seen = new Set()
  const push = (source, category, text, at) => {
    const entry = normalizeEntry(source, category, text, at)
    if (entry === null) return
    const key = entry.text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    entries.push(entry)
  }
  const journal = collectJournal(spec.agentMemoryDir, push)
  const game = collectGameMemory(spec.gameMemoryDir, push)
  const methods = collectMethods(spec.methodsFile, push)
  const bySource = { journal: 0, 'game-memory': 0, methods: 0 }
  for (const entry of entries) if (bySource[entry.source] !== undefined) bySource[entry.source] += 1
  const bytes = entries.reduce((total, entry) => total + Buffer.byteLength(entry.text, 'utf8'), 0)
  return {
    ok: true,
    version: TRAINING_DATASET_VERSION,
    entries,
    counts: { total: entries.length, bySource },
    bytes,
    errors: {
      journal: journal.badLines,
      'game-memory': game.badLines,
      methods: methods.badLines,
    },
    files: { journal: journal.files, 'game-memory': game.files, methods: methods.files },
  }
}

/** 原子写 JSONL（临时文件 + rename，0600）。 */
function writeAtomic(file, content) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.tmp')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
    return { ok: true }
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch (cleanupError) {
      void cleanupError
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 创建训练数据集服务（只读收集；导出需显式调用）。
 * @param {{
 *   agentMemoryDir?: string,
 *   gameMemoryDir?: string,
 *   methodsFile?: string,
 *   file?: string,
 *   now?: () => number,
 *   minEntries?: number,
 * }} [options]
 */
export function createTrainingDataset(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const minEntries = Number.isFinite(Number(spec.minEntries)) && Number(spec.minEntries) > 0 ? Math.floor(Number(spec.minEntries)) : TRAINING_DATASET_MIN_ENTRIES
  const file = typeof spec.file === 'string' && spec.file.length > 0 ? spec.file : ''
  const paths = { agentMemoryDir: spec.agentMemoryDir, gameMemoryDir: spec.gameMemoryDir, methodsFile: spec.methodsFile }

  function collect() {
    return collectTrainingDataset(paths)
  }

  function stats() {
    const collected = collect()
    return {
      available: collected.entries.length > 0,
      entries: collected.entries.length,
      sources: TRAINING_DATASET_SOURCES.slice(),
      bySource: collected.counts.bySource,
      bytes: collected.bytes,
      files: collected.files,
      errors: collected.errors,
      minEntries,
      sufficient: collected.entries.length >= minEntries,
      file,
      generatedAt: now(),
    }
  }

  /** 导出 JSONL + manifest（显式调用；空数据集也允许导出，由训练 plan 判定）。 */
  function exportJsonl(targetFile) {
    const outFile = typeof targetFile === 'string' && targetFile.length > 0 ? targetFile : file
    if (outFile.length === 0) {
      return { ok: false, code: TRAINING_DATASET_CODES.invalidInput, message: '缺少导出文件路径' }
    }
    const collected = collect()
    const lines = collected.entries.map((entry) => JSON.stringify(entry)).join('\n')
    const written = writeAtomic(outFile, lines.length > 0 ? lines + '\n' : '')
    if (written.ok !== true) {
      return { ok: false, code: TRAINING_DATASET_CODES.exportFailed, message: written.message ?? '写入失败' }
    }
    const manifest = {
      ok: true,
      version: TRAINING_DATASET_VERSION,
      file: outFile,
      counts: collected.counts,
      sources: TRAINING_DATASET_SOURCES.slice(),
      bySource: collected.counts.bySource,
      bytes: collected.bytes,
      generatedAt: now(),
      minEntries,
      sufficient: collected.entries.length >= minEntries,
      errors: collected.errors,
    }
    const manifestFile = outFile + '.manifest.json'
    const manifestWritten = writeAtomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
    if (manifestWritten.ok !== true) {
      return { ok: false, code: TRAINING_DATASET_CODES.exportFailed, message: manifestWritten.message ?? 'manifest 写入失败' }
    }
    return { ok: true, file: outFile, manifestFile, manifest, entries: collected.entries.length }
  }

  function snapshot() {
    return { ok: true, version: TRAINING_DATASET_VERSION, file, minEntries, stats: stats() }
  }

  return { version: TRAINING_DATASET_VERSION, file, minEntries, collect, stats, export: exportJsonl, exportJsonl, snapshot }
}
