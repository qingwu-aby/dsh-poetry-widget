#!/usr/bin/env node
// scripts/state-backup.mjs —— 本地状态一致性备份（Gate A4）。
//
// 目标：把“有备份”变成“能恢复”。对 `$DSH_HOME/.dsh-poetry` 与 `$DSH_HOME/agent-memory`
// 做一次本地快照，manifest 记录每个文件的大小/sha256/mtime，支持保留策略与清理。
//
// 约束：
//   · 只读源目录、只写自己的备份目录（默认 `$DSH_HOME/state-backups`），**不上传网络**；
//   · 不删除用户既有备份：清理只针对本脚本生成、manifest.kind 匹配的目录；
//   · 默认不删任何东西；`--dry-run` 只算不写；
//   · 单文件读取一次内容后同时算哈希与落盘（文件级一致）；跨文件不做事务（文档已注明）。
//
// 用法：
//   node scripts/state-backup.mjs                 # 备份到 $DSH_HOME/state-backups，保留最近 7 份
//   node scripts/state-backup.mjs --dry-run       # 只报告会备份/清理什么
//   node scripts/state-backup.mjs --home /tmp/x --out /tmp/backups --keep 3 --reason manual
//   node scripts/state-backup.mjs --json          # 机器可读报告
//
// 退出码：0 成功；1 失败（错误写到 stderr）。
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 备份格式版本。 */
export const STATE_BACKUP_SCHEMA_VERSION = 1
/** 备份目录标记（清理只动带这个 kind 的目录）。 */
export const STATE_BACKUP_KIND = 'dsh-state-backup'
/** 默认保留份数。 */
export const STATE_BACKUP_KEEP = 7
/** 默认备份源（相对 $DSH_HOME）。 */
export const STATE_BACKUP_SOURCES = Object.freeze([
  Object.freeze({ name: 'dsh-poetry', dir: '.dsh-poetry' }),
  Object.freeze({ name: 'agent-memory', dir: 'agent-memory' }),
])
/** 备份时跳过的目录名（避免把既有备份/归档再套娃）。 */
export const STATE_BACKUP_EXCLUDE_DIRS = Object.freeze(['backups', 'archives'])
/** 备份目录相对 $DSH_HOME 的位置。 */
export const STATE_BACKUP_DIRNAME = 'state-backups'
/** 临时目录前缀（崩溃残留清理用）。 */
const TEMP_PREFIX = '.tmp-state-backup-'
/** 崩溃残留超过该时长才清理。 */
const STALE_TEMP_MS = 60 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

/** 备份 id：本地时间 YYYYMMDD-HHmmss[-reason]。 */
export function formatBackupStamp(ms) {
  const date = new Date(Number.isFinite(Number(ms)) ? Number(ms) : Date.now())
  return (
    date.getFullYear() +
    pad2(date.getMonth() + 1) +
    pad2(date.getDate()) +
    '-' +
    pad2(date.getHours()) +
    pad2(date.getMinutes()) +
    pad2(date.getSeconds())
  )
}

/** 解析 $DSH_HOME（与插件 settings 同源：DSH_HOME → home/.dsh）。 */
export function resolveStateHome(options = {}) {
  const env = options.env ?? process.env
  if (typeof options.home === 'string' && options.home.trim().length > 0) return path.resolve(options.home.trim())
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0) return path.resolve(env.DSH_HOME.trim())
  const home = typeof env.HOME === 'string' && env.HOME.length > 0 ? env.HOME : os.homedir()
  return path.join(home, '.dsh')
}

export function resolveStateBackupRoot(home) {
  return path.join(path.resolve(home), STATE_BACKUP_DIRNAME)
}

function sanitizeReason(reason) {
  if (typeof reason !== 'string') return ''
  return reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function isTempName(name) {
  return (
    name.startsWith('.tmp') ||
    name.endsWith('.tmp') ||
    name.endsWith('.swp') ||
    name.endsWith('.partial') ||
    name.endsWith('~')
  )
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 相对路径安全校验（manifest 恢复时防路径穿越）。 */
export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false
  if (value.includes('\\') || value.includes('\u0000')) return false
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function walkSourceFiles(rootDir, options) {
  const files = []
  const skipped = []
  const excludes = options.excludeNames
  function visit(dir, relBase) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      skipped.push({ path: relBase || '.', reason: 'unreadable', message: String(error?.code ?? '') })
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const rel = relBase.length > 0 ? relBase + '/' + entry.name : entry.name
      if (entry.isDirectory() && excludes.has(entry.name)) {
        skipped.push({ path: rel, reason: 'excluded-dir' })
        continue
      }
      if (isTempName(entry.name)) {
        skipped.push({ path: rel, reason: 'temp-file' })
        continue
      }
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        skipped.push({ path: rel, reason: 'symlink' })
        continue
      }
      if (entry.isDirectory()) {
        visit(full, rel)
        continue
      }
      if (!entry.isFile()) {
        skipped.push({ path: rel, reason: 'not-regular-file' })
        continue
      }
      files.push({ full, rel })
    }
  }
  visit(rootDir, '')
  return { files, skipped }
}

/** 读取 package.json 版本（只用于 manifest 溯源，不参与逻辑）。 */
function readPluginVersion() {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : ''
  } catch (error) {
    void error
    return ''
  }
}

/** 列出本脚本生成的备份（按 id 倒序），外部/手工目录不计入。 */
export function listStateBackups(outDir) {
  if (!existsSync(outDir)) return []
  const entries = []
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = path.join(outDir, entry.name)
    const manifestPath = path.join(dir, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!isPlainObject(manifest) || manifest.kind !== STATE_BACKUP_KIND) continue
      entries.push({
        id: typeof manifest.id === 'string' ? manifest.id : entry.name,
        dir,
        createdAt: Number.isFinite(Number(manifest.createdAt)) ? Number(manifest.createdAt) : 0,
        files: isPlainObject(manifest.totals) ? Number(manifest.totals.files) || 0 : 0,
        bytes: isPlainObject(manifest.totals) ? Number(manifest.totals.bytes) || 0 : 0,
      })
    } catch (error) {
      void error
      continue
    }
  }
  return entries.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
}

/** 清理崩溃残留的临时目录（只动自己的前缀且超过 1h）。 */
function cleanStaleTempDirs(outDir, now) {
  const cleaned = []
  if (!existsSync(outDir)) return cleaned
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue
    const dir = path.join(outDir, entry.name)
    try {
      const age = now - statSync(dir).mtimeMs
      if (age > STALE_TEMP_MS) {
        rmSync(dir, { recursive: true, force: true })
        cleaned.push(entry.name)
      }
    } catch (error) {
      void error
      continue
    }
  }
  return cleaned
}

function uniqueBackupId(outDir, stamp, reason) {
  const base = reason.length > 0 ? `${stamp}-${reason}` : stamp
  let candidate = base
  let counter = 1
  while (existsSync(path.join(outDir, candidate))) {
    counter += 1
    candidate = `${base}-${counter}`
  }
  return candidate
}

/**
 * 创建一次备份。
 * @param {{
 *   env?: object, home?: string, out?: string, keep?: number, reason?: string,
 *   dryRun?: boolean, prune?: boolean, now?: number|(() => number), sources?: Array<{name: string, dir: string}>,
 *   excludeNames?: string[],
 * }} [options]
 */
export function createStateBackup(options = {}) {
  const env = options.env ?? process.env
  const home = resolveStateHome({ env, home: options.home })
  const outDir = path.resolve(typeof options.out === 'string' ? options.out : resolveStateBackupRoot(home))
  const keep = readPositiveInt(options.keep, STATE_BACKUP_KEEP)
  const prune = options.prune !== false
  const dryRun = options.dryRun === true
  const now = typeof options.now === 'function' ? Number(options.now()) : Number.isFinite(options.now) ? Number(options.now) : Date.now()
  const reason = sanitizeReason(options.reason)
  const sources = Array.isArray(options.sources) ? options.sources : STATE_BACKUP_SOURCES
  const excludeNames = new Set(
    Array.isArray(options.excludeNames) ? options.excludeNames : STATE_BACKUP_EXCLUDE_DIRS,
  )
  const report = {
    ok: false,
    dryRun,
    id: '',
    dir: '',
    outDir,
    createdAt: now,
    keep,
    pluginVersion: readPluginVersion(),
    sources: [],
    files: [],
    skipped: [],
    totals: { files: 0, bytes: 0 },
    pruned: [],
    kept: [],
    cleanedTemp: [],
    errors: [],
  }

  const stamp = formatBackupStamp(now)
  const id = uniqueBackupId(outDir, stamp, reason)
  report.id = id
  report.dir = path.join(outDir, id)

  for (const source of sources) {
    if (!isPlainObject(source) || typeof source.name !== 'string' || typeof source.dir !== 'string') {
      report.errors.push('备份源配置非法（需要 {name, dir}）')
      continue
    }
    const rootDir = path.resolve(home, source.dir)
    const sourceReport = { name: source.name, dir: source.dir, exists: false, files: 0, bytes: 0 }
    if (!existsSync(rootDir)) {
      report.sources.push(sourceReport)
      continue
    }
    sourceReport.exists = true
    const walked = walkSourceFiles(rootDir, { excludeNames })
    for (const item of walked.files) {
      let buffer
      let mtimeMs = 0
      try {
        mtimeMs = lstatSync(item.full).mtimeMs
        buffer = readFileSync(item.full)
      } catch (error) {
        report.skipped.push({ path: `${source.name}/${item.rel}`, reason: 'read-failed', message: String(error?.code ?? '') })
        continue
      }
      const entry = {
        path: `${source.name}/${item.rel}`,
        source: source.name,
        size: buffer.length,
        sha256: sha256Hex(buffer),
        mtimeMs,
        __buffer: buffer,
      }
      report.files.push(entry)
      sourceReport.files += 1
      sourceReport.bytes += buffer.length
      report.totals.files += 1
      report.totals.bytes += buffer.length
    }
    report.skipped.push(...walked.skipped.map((item) => ({ path: `${source.name}/${item.path}`, reason: item.reason })))
    report.sources.push(sourceReport)
  }

  if (report.errors.length > 0 && report.totals.files === 0) {
    report.ok = false
    report.files = report.files.map(({ __buffer, ...rest }) => rest)
    return report
  }

  if (!dryRun) {
    try {
      mkdirSync(outDir, { recursive: true, mode: 0o700 })
      report.cleanedTemp = cleanStaleTempDirs(outDir, now)
      const tmpDir = path.join(outDir, `${TEMP_PREFIX}${id}-${process.pid}`)
      mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
      const manifestFiles = []
      for (const item of report.files) {
        const target = path.join(tmpDir, ...item.path.split('/'))
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
        writeFileSync(target, item.__buffer, { mode: 0o600 })
        manifestFiles.push({
          path: item.path,
          source: item.source,
          size: item.size,
          sha256: item.sha256,
          mtimeMs: item.mtimeMs,
        })
      }
      const manifest = {
        ok: true,
        v: STATE_BACKUP_SCHEMA_VERSION,
        kind: STATE_BACKUP_KIND,
        id,
        createdAt: now,
        pluginVersion: report.pluginVersion,
        sources: report.sources,
        totals: { files: report.totals.files, bytes: report.totals.bytes },
        files: manifestFiles,
        skipped: report.skipped,
      }
      writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
      renameSync(tmpDir, report.dir)
      report.ok = true
    } catch (error) {
      report.errors.push(`写入备份失败：${error instanceof Error ? error.message : String(error)}`)
      report.ok = false
    }
  } else {
    report.ok = true
  }

  // 保留策略在“新备份写成功之后”才执行，避免写失败却先删了旧备份。
  if (report.ok) {
    const existing = listStateBackups(outDir)
    const ordered = existing
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
    // 新备份必须保留（即使同秒 id 排序异常）。
    const keepList = [id, ...ordered.filter((item) => item.id !== id).map((item) => item.id)].slice(0, keep)
    report.kept = keepList
    const pruneList = ordered.filter((item) => !keepList.includes(item.id))
    if (prune && !dryRun) {
      for (const item of pruneList) {
        try {
          rmSync(item.dir, { recursive: true, force: true })
          report.pruned.push(item.id)
        } catch (error) {
          report.errors.push(`清理旧备份失败 ${item.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } else {
      report.pruned = pruneList.map((item) => item.id)
    }
  }

  report.files = report.files.map(({ __buffer, ...rest }) => rest)
  return report
}

/** 人类可读体积。 */
export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatBackupReport(report) {
  const lines = []
  lines.push(report.dryRun ? '【dry-run】状态备份（未写入磁盘）' : '状态备份完成')
  lines.push(`备份 id：${report.id}`)
  lines.push(`目录：${report.dir}`)
  lines.push(`文件：${report.totals.files} 个 / ${formatBytes(report.totals.bytes)}`)
  for (const source of report.sources) {
    lines.push(
      `  - ${source.name}：${source.exists ? `${source.files} 个 / ${formatBytes(source.bytes)}` : '目录不存在（跳过）'}`,
    )
  }
  lines.push(`保留策略：最近 ${report.keep} 份；当前保留 ${report.kept.length} 份${report.pruned.length > 0 ? `，${report.dryRun ? '将清理' : '已清理'} ${report.pruned.length} 份（${report.pruned.join(', ')}）` : ''}`)
  if (report.cleanedTemp.length > 0) lines.push(`清理崩溃残留：${report.cleanedTemp.length} 个临时目录`)
  if (report.skipped.length > 0) lines.push(`跳过：${report.skipped.length} 项（嵌套备份/临时文件/符号链接等）`)
  for (const error of report.errors) lines.push(`错误：${error}`)
  lines.push('说明：备份仅在本机，不上传网络；恢复演练见 scripts/state-restore-check.mjs')
  return lines.join('\n')
}

export function parseBackupArgs(argv) {
  const options = { dryRun: false, prune: true, json: false }
  const args = Array.isArray(argv) ? argv : []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--no-prune') options.prune = false
    else if (arg === '--home') options.home = args[(index += 1)]
    else if (arg === '--out') options.out = args[(index += 1)]
    else if (arg === '--keep') options.keep = Number(args[(index += 1)])
    else if (arg === '--reason') options.reason = args[(index += 1)]
    else if (arg === '--help' || arg === '-h') options.help = true
    else options.unknown = [...(options.unknown ?? []), arg]
  }
  return options
}

export function main(argv) {
  const options = parseBackupArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/state-backup.mjs [选项]',
        '  --home <dir>      $DSH_HOME（默认 DSH_HOME 或 ~/.dsh）',
        '  --out <dir>       备份目录（默认 $DSH_HOME/state-backups）',
        '  --keep <n>        保留份数（默认 7）',
        '  --reason <text>   备份原因（写入 id，便于人工识别）',
        '  --dry-run         只报告，不写盘、不清理',
        '  --no-prune        不清理旧备份',
        '  --json            输出 JSON 报告',
        '',
      ].join('\n'),
    )
    return 0
  }
  if (options.unknown !== undefined) {
    process.stderr.write(`未知参数：${options.unknown.join(' ')}\n`)
    return 1
  }
  const report = createStateBackup(options)
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else process.stdout.write(formatBackupReport(report) + '\n')
  if (!report.ok) {
    for (const error of report.errors) process.stderr.write(`错误：${error}\n`)
    return 1
  }
  return 0
}

function invokedDirectly() {
  if (typeof process.argv[1] !== 'string') return false
  try {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  } catch (error) {
    void error
    return false
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`状态备份失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
