#!/usr/bin/env node
// scripts/ops-maintenance.mjs —— 运维自动化聚合（Gate N4）。
//
// 一条命令完成日常维护：临时文件清理 → 状态备份 → 日志轮转。
//   · 默认 dry-run（只报告将做什么），--apply 才真正执行；
//   · 步骤顺序固定；任一步失败继续执行后续步骤并汇总（退出码 1）；
//   · 只清理已知目录/已知模式（*.tmp / .tmp-*，且超过 stale 时长），不删除用户文件；
//   · 备份保留策略复用 scripts/state-backup.mjs（keep=7），日志轮转复用 scripts/log-rotate.mjs；
//   · --json 输出机器可读报告（actions/bytes/freed/errors）。
//
// 用法：
//   node scripts/ops-maintenance.mjs                 # dry-run
//   node scripts/ops-maintenance.mjs --apply         # 执行
//   node scripts/ops-maintenance.mjs --json          # dry-run + JSON
//   node scripts/ops-maintenance.mjs --apply --json --keep 7 --max-size 10M
//   node scripts/ops-maintenance.mjs --home /tmp/x --log-dir /tmp/logs --stale-ms 3600000
//
// 退出码：0 全部步骤成功；1 有步骤失败/参数非法。

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { LOG_ROTATE_DEFAULT_DIR, parseSize, rotateLogs } from './log-rotate.mjs'
import { createStateBackup, formatBytes } from './state-backup.mjs'

/** 实现版本。 */
export const OPS_MAINTENANCE_VERSION = 1

/** 步骤顺序（固定）。 */
export const OPS_STEP_ORDER = Object.freeze(['cleanup-temp', 'backup', 'rotate-logs'])

/** 默认临时文件过期时间（1 小时）。 */
export const OPS_DEFAULT_STALE_MS = 60 * 60 * 1000

/** 默认备份保留份数（与 state-backup 一致）。 */
export const OPS_DEFAULT_BACKUP_KEEP = 7

/** 已知临时目录（相对 home）与匹配模式（只删这些）。 */
export const OPS_TEMP_TARGETS = Object.freeze([
  Object.freeze({ dir: '.dsh-poetry', pattern: 'tmp-suffix' }),
  Object.freeze({ dir: '.dsh-poetry/training-logs', pattern: 'tmp-suffix' }),
  Object.freeze({ dir: '.dsh-poetry/memory-exports', pattern: 'tmp-suffix' }),
  Object.freeze({ dir: 'state-backups', pattern: 'tmp-prefix' }),
])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function isTempCandidate(name, pattern) {
  if (pattern === 'tmp-prefix') return name.startsWith('.tmp-')
  return name.endsWith('.tmp') || name.startsWith('.tmp-')
}

/** 解析维护参数。 */
export function parseMaintenanceArgs(argv) {
  const args = Array.isArray(argv) ? argv : []
  const out = { apply: false, json: false, help: false, home: null, logDir: null, keep: OPS_DEFAULT_BACKUP_KEEP, maxBytes: null, staleMs: OPS_DEFAULT_STALE_MS, unknown: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index])
    if (arg === '--apply') out.apply = true
    else if (arg === '--dry-run') out.apply = false
    else if (arg === '--json') out.json = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--home') out.home = args[(index += 1)] ?? null
    else if (arg === '--log-dir') out.logDir = args[(index += 1)] ?? null
    else if (arg === '--keep') out.keep = Number(args[(index += 1)])
    else if (arg === '--max-size') out.maxBytes = parseSize(args[(index += 1)])
    else if (arg === '--stale-ms') out.staleMs = Number(args[(index += 1)])
    else out.unknown.push(arg)
  }
  if (!Number.isFinite(out.keep) || out.keep <= 0) out.keep = OPS_DEFAULT_BACKUP_KEEP
  if (!Number.isFinite(out.staleMs) || out.staleMs <= 0) out.staleMs = OPS_DEFAULT_STALE_MS
  return out
}

/** 解析维护路径（全部可覆盖，便于测试）。 */
export function resolveMaintenancePaths(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const env = isPlainObject(spec.env) ? spec.env : process.env
  const home = typeof spec.home === 'string' && spec.home.length > 0 ? spec.home : env.DSH_HOME || os.homedir()
  return {
    home,
    settingsDir: path.join(home, '.dsh-poetry'),
    logDir: typeof spec.logDir === 'string' && spec.logDir.length > 0 ? spec.logDir : LOG_ROTATE_DEFAULT_DIR,
    backupDir: path.join(home, 'state-backups'),
  }
}

/** 步骤 1：清理已知目录中的过期临时文件（不碰用户文件）。 */
export function cleanupTempStep(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const paths = resolveMaintenancePaths(spec)
  const apply = spec.apply === true
  const staleMs = readPositiveInt(spec.staleMs, OPS_DEFAULT_STALE_MS)
  const now = typeof spec.now === 'function' ? spec.now() : Date.now()
  const actions = []
  const errors = []
  let freed = 0
  for (const target of OPS_TEMP_TARGETS) {
    const dir = path.join(paths.home, target.dir)
    if (!existsSync(dir)) continue
    let names = []
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      errors.push(`${target.dir}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const item of names) {
      if (!item.isFile() || !isTempCandidate(item.name, target.pattern)) continue
      const full = path.join(dir, item.name)
      let size = 0
      let mtimeMs = 0
      try {
        const stat = statSync(full)
        size = stat.size
        mtimeMs = stat.mtimeMs
      } catch (error) {
        void error
        continue
      }
      if (now - mtimeMs < staleMs) continue
      actions.push({ type: 'temp-cleanup', path: full, bytes: size, apply })
      freed += size
      if (!apply) continue
      try {
        rmSync(full, { force: true })
      } catch (error) {
        freed -= size
        errors.push(`${full}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return { id: 'cleanup-temp', ok: errors.length === 0, dryRun: !apply, actions, bytes: freed, freed, errors }
}

/** 步骤 2：状态备份（复用 state-backup 保留策略）。 */
export function backupStep(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const paths = resolveMaintenancePaths(spec)
  const apply = spec.apply === true
  const keep = readPositiveInt(spec.keep, OPS_DEFAULT_BACKUP_KEEP)
  const errors = []
  const actions = []
  let bytes = 0
  try {
    const report = createStateBackup({
      home: paths.home,
      keep,
      dryRun: !apply,
      prune: true,
      reason: 'maintenance',
      now: typeof spec.now === 'function' ? spec.now() : Date.now(),
    })
    if (report === null || report === undefined) {
      errors.push('备份报告为空')
    } else {
      const reportRecord = /** @type {any} */ (report)
      bytes = isPlainObject(reportRecord.totals) && Number.isFinite(Number(reportRecord.totals.bytes)) ? Number(reportRecord.totals.bytes) : 0
      actions.push({ type: 'backup', id: reportRecord.id ?? null, dir: reportRecord.dir ?? null, files: isPlainObject(reportRecord.totals) ? reportRecord.totals.files : 0, bytes, apply })
      for (const error of Array.isArray(reportRecord.errors) ? reportRecord.errors : []) errors.push(String(error))
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { id: 'backup', ok: errors.length === 0, dryRun: !apply, actions, bytes, freed: 0, errors }
}

/** 步骤 3：日志轮转（复用 log-rotate）。 */
export function rotateLogsStep(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const paths = resolveMaintenancePaths(spec)
  const apply = spec.apply === true
  const errors = []
  const actions = []
  let bytes = 0
  let freed = 0
  try {
    const report = rotateLogs({
      dir: paths.logDir,
      maxBytes: Number.isFinite(Number(spec.maxBytes)) && Number(spec.maxBytes) > 0 ? Number(spec.maxBytes) : undefined,
      keep: readPositiveInt(spec.keep, 5),
      mode: 'copytruncate',
      apply,
    })
    const record = /** @type {any} */ (report)
    const applied = isPlainObject(record.applied) ? record.applied : { rotated: [], deleted: [] }
    for (const item of Array.isArray(applied.rotated) ? applied.rotated : []) {
      actions.push({ type: 'log-rotate', name: item.name, target: item.target, bytes: item.bytes ?? 0, apply })
      bytes += Number(item.bytes) || 0
    }
    for (const item of Array.isArray(applied.deleted) ? applied.deleted : []) {
      actions.push({ type: 'log-prune', name: item.name, bytes: item.bytes ?? 0, apply })
      freed += Number(item.bytes) || 0
    }
    for (const error of Array.isArray(record.errors) ? record.errors : []) errors.push(String(error))
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { id: 'rotate-logs', ok: errors.length === 0, dryRun: !apply, actions, bytes, freed, errors }
}

const DEFAULT_STEPS = { 'cleanup-temp': cleanupTempStep, backup: backupStep, 'rotate-logs': rotateLogsStep }

/**
 * 运行维护（默认 dry-run；--apply 才执行；步骤失败隔离）。
 * @param {{apply?: boolean, home?: string, logDir?: string, keep?: number, maxBytes?: number, staleMs?: number, now?: () => number, steps?: object|null, env?: object|null}} [options]
 */
export function runMaintenance(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const apply = spec.apply === true
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const stepOverrides = isPlainObject(spec.steps) ? spec.steps : {}
  const startedAt = now()
  const steps = []
  const errors = []
  let actionsCount = 0
  let bytes = 0
  let freed = 0
  for (const id of OPS_STEP_ORDER) {
    const fn = typeof stepOverrides[id] === 'function' ? stepOverrides[id] : DEFAULT_STEPS[id]
    const stepOptions = {
      apply,
      home: spec.home,
      logDir: spec.logDir,
      keep: spec.keep,
      maxBytes: spec.maxBytes,
      staleMs: spec.staleMs,
      now,
      env: spec.env,
    }
    let result = null
    try {
      result = fn(stepOptions)
    } catch (error) {
      result = { id, ok: false, dryRun: !apply, actions: [], bytes: 0, freed: 0, errors: [error instanceof Error ? error.message : String(error)] }
    }
    const record = isPlainObject(result) ? /** @type {any} */ (result) : { id, ok: false, dryRun: !apply, actions: [], bytes: 0, freed: 0, errors: ['步骤返回非法'] }
    const stepErrors = Array.isArray(record.errors) ? record.errors.map((item) => String(item)) : []
    const stepActions = Array.isArray(record.actions) ? record.actions : []
    const step = {
      id,
      ok: record.ok === true && stepErrors.length === 0,
      dryRun: !apply,
      actions: stepActions,
      bytes: Number(record.bytes) || 0,
      freed: Number(record.freed) || 0,
      errors: stepErrors,
    }
    if (step.ok !== true) errors.push({ step: id, errors: stepErrors.length > 0 ? stepErrors : ['步骤失败'] })
    actionsCount += stepActions.length
    bytes += step.bytes
    freed += step.freed
    steps.push(step)
  }
  const finishedAt = now()
  return {
    ok: errors.length === 0,
    version: OPS_MAINTENANCE_VERSION,
    apply,
    dryRun: !apply,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    steps,
    totals: { steps: steps.length, actions: actionsCount, bytes, freed, errors: errors.reduce((total, item) => total + item.errors.length, 0) },
    errors,
  }
}

/** 格式化为可读文本。 */
export function formatMaintenanceReport(report) {
  const lines = []
  lines.push(`[ops-maintenance] ${report.dryRun ? 'dry-run（默认，不改文件）' : 'apply（已执行）'} v${report.version}`)
  for (const step of report.steps) {
    lines.push(`- ${step.id}：${step.ok ? 'ok' : 'failed'}，actions=${step.actions.length} bytes=${formatBytes(step.bytes)} freed=${formatBytes(step.freed)}`)
    for (const action of step.actions.slice(0, 20)) lines.push(`  · ${action.type} ${action.path ?? action.name ?? ''} ${formatBytes(action.bytes ?? 0)}`)
    for (const error of step.errors) lines.push(`  ! ${error}`)
  }
  lines.push(`- totals：actions=${report.totals.actions} bytes=${formatBytes(report.totals.bytes)} freed=${formatBytes(report.totals.freed)} errors=${report.totals.errors}`)
  if (report.dryRun) lines.push('[ops-maintenance] 加 --apply 才会真正执行（先看报告再执行）')
  return lines
}

/** CLI 入口。 */
export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseMaintenanceArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/ops-maintenance.mjs [选项]',
        '  --apply          真正执行（默认 dry-run）',
        '  --json           输出 JSON 报告',
        '  --home <dir>     状态目录（默认 $DSH_HOME 或 ~）',
        '  --log-dir <dir>  日志目录（默认 ~/Library/Logs）',
        '  --keep <n>       备份保留份数（默认 7）',
        '  --max-size <size> 日志轮转阈值（如 10M）',
        '  --stale-ms <ms>  临时文件过期阈值（默认 1h）',
        '',
      ].join('\n'),
    )
    return { exitCode: 0, report: null }
  }
  if (options.unknown.length > 0) {
    process.stderr.write('[ops-maintenance] 未知参数：' + options.unknown.join(' ') + '\n')
    return { exitCode: 1, report: null }
  }
  const report = runMaintenance({ ...options, env })
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else for (const line of formatMaintenanceReport(report)) process.stdout.write(line + '\n')
  return { exitCode: report.ok ? 0 : 1, report }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const result = main()
  process.exitCode = result.exitCode
}
