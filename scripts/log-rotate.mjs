#!/usr/bin/env node
// scripts/log-rotate.mjs —— 本机日志轮转（Gate A5）。
//
// 目标：`~/Library/Logs/whale-*.log`（Minecraft server/proxy/bot 等）长期运行会无限增长，
// 这里按大小轮转、按份数保留，并支持把某份轮转文件恢复回原日志。
//
// 安全设计：
//   · 默认 **dry-run**，只有 `--apply` 才真正改文件；
//   · 只处理目标目录下匹配 `whale-*.log` 的**普通文件**（跳过符号链接/目录）；
//   · 轮转文件名固定为 `<base>.<YYYYMMDD-HHmmss>.log`，清理只删除匹配该命名的文件；
//   · 默认 `copytruncate`：先复制再清空原文件，写日志的进程不需要重启；
//   · `rename` 模式：重命名后重建空文件（写日志的进程需重新打开文件才会写新内容）；
//   · 恢复 = 把轮转文件内容拼回原日志（旧内容在前、当前内容在后），再删除轮转文件。
//
// 用法：
//   node scripts/log-rotate.mjs                          # dry-run：看会轮转/清理什么
//   node scripts/log-rotate.mjs --apply                  # 执行（默认阈值 10MB / 保留 5 份）
//   node scripts/log-rotate.mjs --dir ~/Library/Logs --max-size 20M --keep 7 --apply
//   node scripts/log-rotate.mjs --list                   # 列出日志与轮转文件
//   node scripts/log-rotate.mjs --restore <轮转文件>      # dry-run：看恢复计划
//   node scripts/log-rotate.mjs --restore <轮转文件> --apply
//
// 退出码：0 成功；1 失败（错误写到 stderr）。
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatBytes } from './state-backup.mjs'

/** 默认日志目录（macOS launchd 日志）。 */
export const LOG_ROTATE_DEFAULT_DIR = path.join(os.homedir(), 'Library', 'Logs')
/** 默认单文件阈值：10MB。 */
export const LOG_ROTATE_MAX_BYTES = 10 * 1024 * 1024
/** 默认每个 base 保留份数。 */
export const LOG_ROTATE_KEEP = 5
/** 支持的模式。 */
export const LOG_ROTATE_MODES = Object.freeze(['copytruncate', 'rename'])
/** 轮转文件名：<base>.<YYYYMMDD-HHmmss>[-n].log。 */
const ROTATED_PATTERN = /^(.+?)\.(\d{8}-\d{6})(?:-(\d+))?\.log$/

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

export function formatRotateStamp(ms) {
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

/** 解析大小：数字或 10M / 1.5GB 之类。 */
export function parseSize(value, fallback = LOG_ROTATE_MAX_BYTES) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (text.length === 0) return fallback
  const matched = /^(\d+(?:\.\d+)?)\s*([kmg])?b?$/.exec(text)
  if (matched === null) return fallback
  const base = Number(matched[1])
  if (!Number.isFinite(base) || base <= 0) return fallback
  const unit = matched[2]
  const multiplier = unit === 'k' ? 1024 : unit === 'm' ? 1024 * 1024 : unit === 'g' ? 1024 * 1024 * 1024 : 1
  return Math.floor(base * multiplier)
}

/** 活动日志：whale-*.log（排除轮转后的名字）。 */
export function isActiveLogName(name) {
  return (
    typeof name === 'string' &&
    name.startsWith('whale-') &&
    name.endsWith('.log') &&
    !ROTATED_PATTERN.test(name)
  )
}

/** 轮转文件：<base>.<stamp>.log。 */
export function isRotatedLogName(name) {
  return typeof name === 'string' && ROTATED_PATTERN.test(name)
}

function baseOf(name) {
  const matched = ROTATED_PATTERN.exec(name)
  if (matched !== null) return matched[1]
  return name.endsWith('.log') ? name.slice(0, -4) : name
}

function resolveLogDir(options) {
  const dir = typeof options.dir === 'string' && options.dir.length > 0 ? options.dir : LOG_ROTATE_DEFAULT_DIR
  return path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()))
}

function listLogFiles(dir) {
  const active = []
  const rotated = []
  const ignored = []
  if (!existsSync(dir)) return { active, rotated, ignored }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      ignored.push(entry.name)
      continue
    }
    const full = path.join(dir, entry.name)
    let info
    try {
      info = statSync(full)
    } catch (error) {
      void error
      ignored.push(entry.name)
      continue
    }
    if (isActiveLogName(entry.name)) {
      active.push({ name: entry.name, path: full, size: info.size, mtimeMs: info.mtimeMs, base: baseOf(entry.name) })
    } else if (isRotatedLogName(entry.name)) {
      const matched = ROTATED_PATTERN.exec(entry.name)
      rotated.push({
        name: entry.name,
        path: full,
        size: info.size,
        mtimeMs: info.mtimeMs,
        base: baseOf(entry.name),
        stamp: matched !== null ? matched[2] : '',
      })
    } else {
      ignored.push(entry.name)
    }
  }
  active.sort((left, right) => left.name.localeCompare(right.name))
  rotated.sort((left, right) => right.name.localeCompare(left.name))
  return { active, rotated, ignored }
}

function uniqueRotatedPath(dir, base, stamp) {
  let candidate = `${base}.${stamp}.log`
  let counter = 1
  while (existsSync(path.join(dir, candidate))) {
    counter += 1
    candidate = `${base}.${stamp}-${counter}.log`
  }
  return path.join(dir, candidate)
}

/**
 * 规划一次轮转（只读）。返回将要执行的 rotate/delete 动作与保留情况。
 * @param {{dir?: string, maxBytes?: number|string, keep?: number, now?: number, mode?: string}} [options]
 */
export function planLogRotation(options = {}) {
  const dir = resolveLogDir(options)
  const maxBytes = parseSize(options.maxBytes, LOG_ROTATE_MAX_BYTES)
  const keepRaw = Number(options.keep)
  const keep = Number.isFinite(keepRaw) && keepRaw > 0 ? Math.floor(keepRaw) : LOG_ROTATE_KEEP
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const mode = LOG_ROTATE_MODES.indexOf(options.mode) >= 0 ? options.mode : 'copytruncate'
  const report = {
    ok: false,
    dryRun: true,
    dir,
    mode,
    maxBytes,
    keep,
    active: [],
    rotated: [],
    actions: { rotate: [], delete: [], restore: [] },
    ignored: [],
    errors: [],
  }
  if (!existsSync(dir)) {
    report.errors.push(`日志目录不存在：${dir}`)
    return report
  }
  const listed = listLogFiles(dir)
  report.active = listed.active.map(({ name, size, mtimeMs }) => ({ name, size, mtimeMs }))
  report.rotated = listed.rotated.map(({ name, size, mtimeMs, base }) => ({ name, size, mtimeMs, base }))
  report.ignored = listed.ignored
  const stamp = formatRotateStamp(now)
  for (const file of listed.active) {
    if (file.size < maxBytes) continue
    report.actions.rotate.push({
      name: file.name,
      base: file.base,
      size: file.size,
      target: uniqueRotatedPath(dir, file.base, stamp),
      mode,
    })
  }
  // 保留策略：每个 base 的轮转文件（含本次计划新增的）只保留最近 keep 份。
  const byBase = new Map()
  for (const file of listed.rotated) {
    if (!byBase.has(file.base)) byBase.set(file.base, [])
    byBase.get(file.base).push({ name: file.name, path: file.path, size: file.size, mtimeMs: file.mtimeMs, stamp: file.stamp })
  }
  for (const action of report.actions.rotate) {
    if (!byBase.has(action.base)) byBase.set(action.base, [])
    byBase.get(action.base).push({
      name: path.basename(action.target),
      path: action.target,
      size: action.size,
      mtimeMs: now,
      stamp,
      planned: true,
    })
  }
  for (const [base, files] of byBase) {
    // 以文件名里的时间戳为准（mtime 可能被复制/解压改变）。
    files.sort((left, right) => String(right.stamp ?? '').localeCompare(String(left.stamp ?? '')) || right.name.localeCompare(left.name))
    for (const file of files.slice(keep)) {
      if (file.planned === true) continue
      report.actions.delete.push({ base, name: file.name, path: file.path, size: file.size })
    }
  }
  report.ok = true
  return report
}

/**
 * 执行轮转；默认 dry-run，`apply:true` 才动文件。
 * @param {{dir?: string, maxBytes?: number|string, keep?: number, now?: number, mode?: string, apply?: boolean}} [options]
 */
export function rotateLogs(options = {}) {
  const apply = options.apply === true
  const plan = planLogRotation(options)
  const report = { ...plan, dryRun: !apply, applied: { rotated: [], deleted: [] } }
  if (!plan.ok || !apply) return report
  for (const action of plan.actions.rotate) {
    try {
      if (action.mode === 'rename') {
        renameSync(path.join(plan.dir, action.name), action.target)
        writeFileSync(path.join(plan.dir, action.name), '', { mode: 0o600 })
      } else {
        copyFileSync(path.join(plan.dir, action.name), action.target)
        truncateSync(path.join(plan.dir, action.name), 0)
      }
      report.applied.rotated.push({ name: action.name, target: path.basename(action.target), bytes: action.size })
    } catch (error) {
      report.errors.push(`轮转失败 ${action.name}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const action of plan.actions.delete) {
    try {
      // 只删除轮转命名模式内的文件，且必须在目标目录内。
      if (!isRotatedLogName(action.name)) continue
      const full = path.resolve(plan.dir, action.name)
      if (path.dirname(full) !== path.resolve(plan.dir)) continue
      rmSync(full, { force: true })
      report.applied.deleted.push({ name: action.name, bytes: action.size })
    } catch (error) {
      report.errors.push(`清理失败 ${action.name}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  report.ok = report.errors.length === 0
  return report
}

/**
 * 把轮转文件恢复回原日志：原日志 = 轮转内容（旧） + 当前内容（新），随后删除轮转文件。
 * 默认 dry-run。
 * @param {{dir?: string, restore?: string, apply?: boolean}} [options]
 */
export function restoreRotatedLog(options = {}) {
  const dir = resolveLogDir(options)
  const apply = options.apply === true
  const report = {
    ok: false,
    dryRun: !apply,
    dir,
    restore: '',
    target: '',
    restoredBytes: 0,
    deleted: false,
    errors: [],
  }
  const rawName = typeof options.restore === 'string' ? options.restore.trim() : ''
  if (rawName.length === 0) {
    report.errors.push('缺少要恢复的轮转文件（--restore <文件名或路径>）')
    return report
  }
  const name = path.basename(rawName)
  if (!isRotatedLogName(name)) {
    report.errors.push(`不是轮转文件命名（期望 <base>.<YYYYMMDD-HHmmss>.log）：${name}`)
    return report
  }
  const source = path.resolve(dir, name)
  if (path.dirname(source) !== path.resolve(dir)) {
    report.errors.push('恢复文件必须在目标日志目录内')
    return report
  }
  if (!existsSync(source)) {
    report.errors.push(`轮转文件不存在：${source}`)
    return report
  }
  const base = baseOf(name)
  const target = path.join(path.resolve(dir), base + '.log')
  report.restore = name
  report.target = target
  let rotated
  try {
    rotated = readFileSync(source)
  } catch (error) {
    report.errors.push(`读取轮转文件失败：${error instanceof Error ? error.message : String(error)}`)
    return report
  }
  let current = Buffer.alloc(0)
  if (existsSync(target)) {
    try {
      current = readFileSync(target)
    } catch (error) {
      report.errors.push(`读取当前日志失败：${error instanceof Error ? error.message : String(error)}`)
      return report
    }
  }
  report.restoredBytes = rotated.length
  if (!apply) {
    report.ok = true
    return report
  }
  try {
    writeFileSync(target, Buffer.concat([rotated, current]), { mode: 0o600 })
    rmSync(source, { force: true })
    report.deleted = true
    report.ok = true
  } catch (error) {
    report.errors.push(`恢复失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return report
}

export function formatRotateReport(report) {
  const lines = []
  lines.push(report.dryRun ? '【dry-run】日志轮转（未改动文件）' : '日志轮转完成')
  lines.push(`目录：${report.dir}`)
  lines.push(`阈值：${formatBytes(report.maxBytes)} / 保留 ${report.keep} 份 / 模式 ${report.mode}`)
  lines.push(`活动日志：${report.active.length} 个；轮转文件：${report.rotated.length} 个`)
  if (report.actions.rotate.length > 0) {
    lines.push(`${report.dryRun ? '将轮转' : '已轮转'}：`)
    for (const action of report.actions.rotate) lines.push(`  - ${action.name}（${formatBytes(action.size)}）→ ${path.basename(action.target)}`)
  } else {
    lines.push('没有超过阈值的活动日志。')
  }
  if (report.actions.delete.length > 0) {
    lines.push(`${report.dryRun ? '将清理' : '已清理'} ${report.actions.delete.length} 份旧轮转文件：`)
    for (const action of report.actions.delete.slice(0, 10)) lines.push(`  - ${action.name}（${formatBytes(action.size)}）`)
    if (report.actions.delete.length > 10) lines.push(`  … 其余 ${report.actions.delete.length - 10} 份省略`)
  }
  if (report.ignored.length > 0) lines.push(`忽略：${report.ignored.length} 个非 whale-*.log 文件`)
  for (const error of report.errors) lines.push(`错误：${error}`)
  return lines.join('\n')
}

export function formatRestoreLogReport(report) {
  const lines = []
  lines.push(report.dryRun ? '【dry-run】日志恢复（未改动文件）' : '日志恢复完成')
  lines.push(`目录：${report.dir}`)
  lines.push(`轮转文件：${report.restore}`)
  lines.push(`目标日志：${report.target}`)
  lines.push(`轮转内容：${formatBytes(report.restoredBytes)}（会拼在当前日志之前）`)
  if (report.deleted) lines.push('已删除轮转文件。')
  for (const error of report.errors) lines.push(`错误：${error}`)
  return lines.join('\n')
}

export function parseLogRotateArgs(argv) {
  const options = { apply: false, json: false, list: false }
  const args = Array.isArray(argv) ? argv : []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--apply') options.apply = true
    else if (arg === '--json') options.json = true
    else if (arg === '--list') options.list = true
    else if (arg === '--dry-run') options.apply = false
    else if (arg === '--dir') options.dir = args[(index += 1)]
    else if (arg === '--max-size') options.maxBytes = args[(index += 1)]
    else if (arg === '--keep') options.keep = Number(args[(index += 1)])
    else if (arg === '--mode') options.mode = args[(index += 1)]
    else if (arg === '--restore') options.restore = args[(index += 1)]
    else if (arg === '--help' || arg === '-h') options.help = true
    else options.unknown = [...(options.unknown ?? []), arg]
  }
  return options
}

function listReport(options) {
  const plan = planLogRotation(options)
  return {
    ok: plan.ok,
    dir: plan.dir,
    maxBytes: plan.maxBytes,
    keep: plan.keep,
    mode: plan.mode,
    active: plan.active,
    rotated: plan.rotated,
    errors: plan.errors,
  }
}

export function main(argv) {
  const options = parseLogRotateArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/log-rotate.mjs [选项]',
        '  --dir <dir>        日志目录（默认 ~/Library/Logs）',
        '  --max-size <size>  单文件阈值，如 10485760 / 10M / 1G（默认 10M）',
        '  --keep <n>         每个日志保留的轮转份数（默认 5）',
        '  --mode <mode>      copytruncate（默认）或 rename',
        '  --apply            真正执行（默认 dry-run）',
        '  --list             列出活动日志与轮转文件',
        '  --restore <file>   把轮转文件恢复回原日志（默认 dry-run，配合 --apply 执行）',
        '  --json             输出 JSON 报告',
        '',
      ].join('\n'),
    )
    return 0
  }
  if (options.unknown !== undefined) {
    process.stderr.write(`未知参数：${options.unknown.join(' ')}\n`)
    return 1
  }
  if (options.list === true) {
    const report = listReport(options)
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return report.ok ? 0 : 1
  }
  if (typeof options.restore === 'string' && options.restore.length > 0) {
    const report = restoreRotatedLog(options)
    if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    else process.stdout.write(formatRestoreLogReport(report) + '\n')
    if (!report.ok) {
      for (const error of report.errors) process.stderr.write(`错误：${error}\n`)
      return 1
    }
    return 0
  }
  const report = rotateLogs(options)
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else process.stdout.write(formatRotateReport(report) + '\n')
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
    process.stderr.write(`日志轮转失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
