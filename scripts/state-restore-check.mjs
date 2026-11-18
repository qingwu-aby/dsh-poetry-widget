#!/usr/bin/env node
// scripts/state-restore-check.mjs —— 备份恢复演练（Gate A4）。
//
// 目标：把“有备份”变成“能恢复”。默认做**只读演练**：
//   1) 校验备份 manifest 与每个文件的大小/sha256；
//   2) 在系统临时目录恢复一份（不覆盖任何 live 数据）；
//   3) 校验恢复后的文件数/哈希，输出报告，然后删掉临时目录。
//
// 约束：
//   · 不写 `$DSH_HOME`：临时目录必须在 live 目录之外（默认 os.tmpdir()）；
//   · 默认不改动备份本身（只读）；`--keep-temp` 可保留演练目录供人工检查；
//   · manifest 里的相对路径做穿越校验（拒绝绝对路径 / `..` / 反斜杠）。
//
// 用法：
//   node scripts/state-restore-check.mjs                  # 校验并演练最近一份备份
//   node scripts/state-restore-check.mjs --backup <dir>   # 指定备份目录
//   node scripts/state-restore-check.mjs --no-copy        # 只校验备份哈希，不恢复
//   node scripts/state-restore-check.mjs --keep-temp      # 保留临时恢复目录
//   node scripts/state-restore-check.mjs --json           # 机器可读报告
//
// 退出码：0 校验/演练通过；1 失败（错误写到 stderr）。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STATE_BACKUP_KIND,
  STATE_BACKUP_SCHEMA_VERSION,
  formatBytes,
  isSafeRelativePath,
  resolveStateBackupRoot,
  resolveStateHome,
  sha256Hex,
} from './state-backup.mjs'

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** 读取并做结构校验的 manifest（不碰文件内容）。 */
export function readStateBackupManifest(backupDir) {
  const result = { ok: false, manifest: null, errors: [] }
  if (typeof backupDir !== 'string' || backupDir.length === 0) {
    result.errors.push('缺少备份目录')
    return result
  }
  const manifestPath = path.join(backupDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    result.errors.push(`备份缺少 manifest.json：${manifestPath}`)
    return result
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    result.errors.push(`manifest.json 解析失败：${errorText(error)}`)
    return result
  }
  if (!isPlainObject(manifest)) {
    result.errors.push('manifest.json 不是对象')
    return result
  }
  if (manifest.kind !== STATE_BACKUP_KIND) {
    result.errors.push(`manifest.kind 不是 ${STATE_BACKUP_KIND}（实际 ${String(manifest.kind)}）`)
  }
  if (Number(manifest.v) !== STATE_BACKUP_SCHEMA_VERSION) {
    result.errors.push(`不支持的备份格式版本：${String(manifest.v)}（期望 ${STATE_BACKUP_SCHEMA_VERSION}）`)
  }
  if (!Array.isArray(manifest.files)) {
    result.errors.push('manifest.files 必须是数组')
    return result
  }
  const seen = new Set()
  manifest.files.forEach((entry, index) => {
    const where = `files[${index}]`
    if (!isPlainObject(entry)) {
      result.errors.push(`${where} 不是对象`)
      return
    }
    if (!isSafeRelativePath(entry.path)) {
      result.errors.push(`${where}.path 不是安全的相对路径：${String(entry.path)}`)
      return
    }
    if (seen.has(entry.path)) result.errors.push(`${where}.path 重复：${entry.path}`)
    seen.add(entry.path)
    if (typeof entry.source !== 'string' || entry.source.length === 0) {
      result.errors.push(`${where}.source 必须是字符串`)
    }
    const size = Number(entry.size)
    if (!Number.isFinite(size) || size < 0) result.errors.push(`${where}.size 非法：${String(entry.size)}`)
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      result.errors.push(`${where}.sha256 非法`)
    }
  })
  if (result.errors.length > 0) return result
  result.ok = true
  result.manifest = manifest
  return result
}

function totalsOf(manifest) {
  let files = 0
  let bytes = 0
  for (const entry of manifest.files) {
    files += 1
    bytes += Number(entry.size) || 0
  }
  return { files, bytes }
}

/**
 * 只读校验备份：结构 + 每个文件存在/大小/哈希。
 * @param {string} backupDir
 */
export function verifyStateBackup(backupDir) {
  const report = {
    ok: false,
    backupDir: path.resolve(String(backupDir ?? '')),
    id: '',
    createdAt: 0,
    sources: [],
    totals: { files: 0, bytes: 0 },
    files: [],
    errors: [],
  }
  const loaded = readStateBackupManifest(report.backupDir)
  if (!loaded.ok) {
    report.errors.push(...loaded.errors)
    return report
  }
  const manifest = loaded.manifest
  report.id = typeof manifest.id === 'string' ? manifest.id : ''
  report.createdAt = Number.isFinite(Number(manifest.createdAt)) ? Number(manifest.createdAt) : 0
  report.sources = Array.isArray(manifest.sources) ? manifest.sources : []
  report.totals = totalsOf(manifest)
  const declaredTotals = isPlainObject(manifest.totals) ? manifest.totals : null
  if (declaredTotals !== null) {
    if (Number(declaredTotals.files) !== report.totals.files || Number(declaredTotals.bytes) !== report.totals.bytes) {
      report.errors.push(
        `manifest.totals 与实际不一致（声明 ${String(declaredTotals.files)}/${String(declaredTotals.bytes)}，实际 ${report.totals.files}/${report.totals.bytes}）`,
      )
    }
  }
  const backupRoot = path.resolve(report.backupDir)
  for (const entry of manifest.files) {
    const item = {
      path: entry.path,
      source: entry.source,
      ok: false,
      expectedSize: Number(entry.size),
      actualSize: null,
      expectedSha256: entry.sha256,
      actualSha256: null,
      error: '',
    }
    const full = path.resolve(backupRoot, ...entry.path.split('/'))
    if (full !== backupRoot && !full.startsWith(backupRoot + path.sep)) {
      item.error = '路径越界'
      report.files.push(item)
      continue
    }
    if (!existsSync(full)) {
      item.error = '文件缺失'
      report.files.push(item)
      continue
    }
    try {
      const buffer = readFileSync(full)
      item.actualSize = buffer.length
      item.actualSha256 = sha256Hex(buffer)
      if (item.actualSize !== item.expectedSize) item.error = '大小不一致'
      else if (item.actualSha256 !== item.expectedSha256) item.error = '哈希不一致'
      else item.ok = true
    } catch (error) {
      item.error = `读取失败：${errorText(error)}`
    }
    report.files.push(item)
  }
  const bad = report.files.filter((item) => !item.ok)
  if (bad.length > 0) report.errors.push(`${bad.length} 个文件校验失败`)
  report.ok = report.errors.length === 0
  return report
}

/** 找最近一份本脚本生成的备份。 */
export function findLatestStateBackup(outDir) {
  if (!existsSync(outDir)) return null
  const entries = []
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = path.join(outDir, entry.name)
    const loaded = readStateBackupManifest(dir)
    if (!loaded.ok) continue
    entries.push({
      dir,
      id: typeof loaded.manifest.id === 'string' ? loaded.manifest.id : entry.name,
      createdAt: Number.isFinite(Number(loaded.manifest.createdAt)) ? Number(loaded.manifest.createdAt) : 0,
    })
  }
  entries.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
  return entries.length > 0 ? entries[0] : null
}

function isInside(parent, child) {
  const base = path.resolve(parent)
  const target = path.resolve(child)
  return target === base || target.startsWith(base + path.sep)
}

/** 解析演练临时目录根：默认系统临时目录，禁止落在 live home 内。 */
export function resolveRestoreWorkRoot(options = {}) {
  const env = options.env ?? process.env
  const home = resolveStateHome({ env, home: options.home })
  const root = path.resolve(typeof options.workdir === 'string' && options.workdir.length > 0 ? options.workdir : os.tmpdir())
  if (options.allowHomeWorkdir !== true && isInside(home, root)) {
    return {
      ok: false,
      home,
      root,
      errors: [`演练目录不能位于 live 数据目录内（${root}）；请用系统临时目录或 --workdir 指定 home 外目录`],
    }
  }
  return { ok: true, home, root, errors: [] }
}

/**
 * 在临时目录恢复一份备份并校验（默认只读演练，不覆盖 live 数据）。
 * @param {{
 *   backupDir: string, env?: object, home?: string, workdir?: string,
 *   keepTemp?: boolean, copy?: boolean, allowHomeWorkdir?: boolean,
 * }} options
 */
export function restoreStateBackup(options = {}) {
  const report = {
    ok: false,
    backupDir: path.resolve(String(options.backupDir ?? '')),
    tempDir: '',
    keptTemp: false,
    copy: options.copy !== false,
    verify: null,
    restored: { files: 0, bytes: 0 },
    sources: [],
    errors: [],
  }
  const verified = verifyStateBackup(report.backupDir)
  report.verify = verified
  report.sources = verified.sources
  if (!verified.ok) {
    report.errors.push(...verified.errors)
    return report
  }
  if (report.copy !== true) {
    report.ok = true
    report.restored = { files: verified.totals.files, bytes: verified.totals.bytes }
    return report
  }
  const workRoot = resolveRestoreWorkRoot(options)
  if (!workRoot.ok) {
    report.errors.push(...workRoot.errors)
    return report
  }
  let tempDir = ''
  try {
    mkdirSync(workRoot.root, { recursive: true, mode: 0o700 })
    tempDir = mkdtempSync(path.join(workRoot.root, 'dsh-state-restore-'))
    report.tempDir = tempDir
    const manifest = readStateBackupManifest(report.backupDir).manifest
    let restoredBytes = 0
    for (const entry of manifest.files) {
      const source = path.resolve(report.backupDir, ...entry.path.split('/'))
      const target = path.resolve(tempDir, ...entry.path.split('/'))
      if (!isInside(tempDir, target)) {
        report.errors.push(`恢复路径越界：${entry.path}`)
        continue
      }
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
      copyFileSync(source, target)
      const buffer = readFileSync(target)
      const actualSha = sha256Hex(buffer)
      if (buffer.length !== Number(entry.size) || actualSha !== entry.sha256) {
        report.errors.push(`恢复后校验失败：${entry.path}`)
        continue
      }
      restoredBytes += buffer.length
      report.restored.files += 1
    }
    report.restored.bytes = restoredBytes
    if (report.restored.files !== verified.totals.files) {
      report.errors.push(`恢复文件数不一致（${report.restored.files}/${verified.totals.files}）`)
    }
    if (report.restored.bytes !== verified.totals.bytes) {
      report.errors.push(`恢复字节数不一致（${report.restored.bytes}/${verified.totals.bytes}）`)
    }
    // 演练报告落盘到临时目录，便于人工查看（不写 live）。
    writeFileSync(
      path.join(tempDir, 'restore-check-report.json'),
      JSON.stringify(
        {
          ok: report.errors.length === 0,
          backupDir: report.backupDir,
          id: verified.id,
          createdAt: verified.createdAt,
          restored: report.restored,
          errors: report.errors,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    )
    report.ok = report.errors.length === 0
  } catch (error) {
    report.errors.push(`恢复演练失败：${errorText(error)}`)
    report.ok = false
  } finally {
    report.keptTemp = options.keepTemp === true
    if (!report.keptTemp && tempDir.length > 0) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch (error) {
        report.errors.push(`清理临时目录失败：${errorText(error)}`)
      }
    }
  }
  return report
}

export function formatRestoreReport(report) {
  const lines = []
  lines.push(report.copy === false ? '备份校验（只读，未恢复）' : '备份恢复演练')
  lines.push(`备份目录：${report.backupDir}`)
  const verify = report.verify
  if (verify !== null) {
    lines.push(`备份 id：${verify.id || '（未知）'}（创建于 ${verify.createdAt > 0 ? new Date(verify.createdAt).toISOString() : '未知'}）`)
    lines.push(`文件：${verify.totals.files} 个 / ${formatBytes(verify.totals.bytes)}`)
    const failed = verify.files.filter((item) => !item.ok)
    lines.push(`校验：${failed.length === 0 ? '全部通过' : `${failed.length} 个失败`}`)
    for (const item of failed.slice(0, 10)) lines.push(`  - ${item.path}：${item.error}`)
    if (failed.length > 10) lines.push(`  … 其余 ${failed.length - 10} 个失败文件省略`)
  }
  if (report.copy !== false && report.tempDir.length > 0) {
    lines.push(`临时恢复目录：${report.tempDir}`)
    lines.push(`恢复结果：${report.restored.files} 个 / ${formatBytes(report.restored.bytes)}`)
    lines.push(report.keptTemp ? '（已按 --keep-temp 保留，可人工检查后删除）' : '（演练结束已删除临时目录，live 数据未被触碰）')
  }
  lines.push(report.ok ? '结论：通过' : '结论：失败')
  for (const error of report.errors) lines.push(`错误：${error}`)
  return lines.join('\n')
}

export function parseRestoreArgs(argv) {
  const options = { copy: true, keepTemp: false, json: false }
  const args = Array.isArray(argv) ? argv : []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--backup') options.backupDir = args[(index += 1)]
    else if (arg === '--latest') options.latest = true
    else if (arg === '--home') options.home = args[(index += 1)]
    else if (arg === '--workdir') options.workdir = args[(index += 1)]
    else if (arg === '--keep-temp') options.keepTemp = true
    else if (arg === '--no-copy') options.copy = false
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else options.unknown = [...(options.unknown ?? []), arg]
  }
  return options
}

export function main(argv) {
  const options = parseRestoreArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/state-restore-check.mjs [选项]',
        '  --backup <dir>    指定备份目录（默认取最近一份）',
        '  --home <dir>      $DSH_HOME（默认 DSH_HOME 或 ~/.dsh）',
        '  --workdir <dir>   演练临时目录根（默认系统临时目录，禁止在 live 目录内）',
        '  --no-copy         只校验备份哈希，不恢复',
        '  --keep-temp       保留临时恢复目录',
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
  let backupDir = typeof options.backupDir === 'string' ? options.backupDir : ''
  if (backupDir.length === 0) {
    const home = resolveStateHome({ env: process.env, home: options.home })
    const latest = findLatestStateBackup(resolveStateBackupRoot(home))
    if (latest === null) {
      process.stderr.write(`未找到备份（${resolveStateBackupRoot(home)}）；请先运行 scripts/state-backup.mjs\n`)
      return 1
    }
    backupDir = latest.dir
  }
  const report = restoreStateBackup({ ...options, backupDir })
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else process.stdout.write(formatRestoreReport(report) + '\n')
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
    process.stderr.write(`恢复演练失败：${errorText(error)}\n`)
    process.exitCode = 1
  }
}
