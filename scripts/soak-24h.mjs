#!/usr/bin/env node
// scripts/soak-24h.mjs —— 24h soak 运行器（Gate O3，可恢复/分段 JSONL，不阻塞会话）。
//
// 每轮：load-baseline + fault-inject（子进程 --json，只读业务数据）；默认 duration 24h / interval 5min。
// 每轮追加一行 JSONL（ts/round/metrics/errors），结束追加 summary；--resume 从既有报告继续；
// 单轮失败继续但累计；达到 duration 或 Ctrl-C 写最终摘要；退出码 0（无失败）/1（有失败）。
// 只写 --out 指定的 JSONL（默认临时目录），不修改业务数据、不写 live 文件。
//
// 用法：
//   node scripts/soak-24h.mjs                     # 24h，5min 一轮
//   node scripts/soak-24h.mjs --duration-ms 3600000 --interval-ms 60000 --out /tmp/soak.jsonl
//   node scripts/soak-24h.mjs --once              # 跑一轮即结束（自测）
//   node scripts/soak-24h.mjs --resume --out /tmp/soak.jsonl
//   node scripts/soak-24h.mjs --json              # 最终报告 JSON
//
// 退出码：0 无失败；1 有失败/参数非法。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** 实现版本。 */
export const SOAK_VERSION = 1

/** 默认时长：24h。 */
export const SOAK_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000

/** 默认间隔：5min。 */
export const SOAK_DEFAULT_INTERVAL_MS = 5 * 60 * 1000

/** 默认报告文件（临时目录，不碰业务数据）。 */
export const SOAK_DEFAULT_OUT = path.join(os.tmpdir(), 'dsh-poetry-soak', 'soak-24h.jsonl')

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** 解析参数；非法数值/未知参数 → ok:false + errors。 */
export function parseSoakArgs(argv) {
  const args = Array.isArray(argv) ? argv : []
  const out = { durationMs: SOAK_DEFAULT_DURATION_MS, intervalMs: SOAK_DEFAULT_INTERVAL_MS, out: SOAK_DEFAULT_OUT, json: false, once: false, resume: false, help: false, unknown: [], errors: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index])
    if (arg === '--duration-ms') {
      const value = Number(args[(index += 1)])
      if (!Number.isFinite(value) || value <= 0) out.errors.push('--duration-ms 必须是正整数')
      else out.durationMs = Math.floor(value)
    } else if (arg === '--interval-ms') {
      const value = Number(args[(index += 1)])
      if (!Number.isFinite(value) || value <= 0) out.errors.push('--interval-ms 必须是正整数')
      else out.intervalMs = Math.floor(value)
    } else if (arg === '--out') {
      const value = args[(index += 1)]
      if (typeof value !== 'string' || value.trim().length === 0) out.errors.push('--out 需要文件路径')
      else out.out = value
    } else if (arg === '--json') out.json = true
    else if (arg === '--once') out.once = true
    else if (arg === '--resume') out.resume = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else out.unknown.push(arg)
  }
  if (out.unknown.length > 0) out.errors.push('未知参数：' + out.unknown.join(' '))
  return { ok: out.errors.length === 0, ...out }
}

/** 读取既有 JSONL 报告（resume 用）。 */
export function readSoakState(outFile) {
  const state = { rounds: 0, failures: 0, startedAt: 0, last: null, lines: 0, errors: [] }
  if (typeof outFile !== 'string' || !existsSync(outFile)) return state
  let text = ''
  try {
    text = readFileSync(outFile, 'utf8')
  } catch (error) {
    state.errors.push(error instanceof Error ? error.message : String(error))
    return state
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let record = null
    try {
      record = JSON.parse(trimmed)
    } catch (error) {
      void error
      continue
    }
    if (!isPlainObject(record)) continue
    state.lines += 1
    if (record.type === 'summary') {
      if (Number.isFinite(Number(record.startedAt)) && Number(record.startedAt) > 0) state.startedAt = Number(record.startedAt)
      continue
    }
    if (Number.isFinite(Number(record.round))) state.rounds = Math.max(state.rounds, Number(record.round))
    if (Number.isFinite(Number(record.ts)) && state.startedAt === 0) state.startedAt = Number(record.ts)
    if (record.ok !== true) state.failures += 1
    state.last = record
  }
  return state
}

/** 默认单轮：跑 load-baseline + fault-inject（子进程 --json，只读）。 */
export function runRoundWithScripts(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const cwd = typeof spec.cwd === 'string' ? spec.cwd : process.cwd()
  const timeout = readPositiveInt(spec.timeoutMs, 120000)
  const spawn = typeof spec.spawn === 'function' ? spec.spawn : spawnSync
  const errors = []
  const loadResult = spawn(process.execPath, [path.join(cwd, 'scripts/load-baseline.mjs'), '--json'], { cwd, encoding: 'utf8', timeout })
  let load = null
  try {
    load = JSON.parse(String(loadResult && loadResult.stdout ? loadResult.stdout : ''))
  } catch (error) {
    errors.push('load-baseline 输出无法解析：' + (error instanceof Error ? error.message : String(error)))
  }
  const faultResult = spawn(process.execPath, [path.join(cwd, 'scripts/fault-inject.mjs'), '--json'], { cwd, encoding: 'utf8', timeout })
  let fault = null
  try {
    fault = JSON.parse(String(faultResult && faultResult.stdout ? faultResult.stdout : ''))
  } catch (error) {
    errors.push('fault-inject 输出无法解析：' + (error instanceof Error ? error.message : String(error)))
  }
  if (load !== null && load.ok !== true) errors.push('load-baseline 失败')
  if (fault !== null && fault.ok !== true) errors.push('fault-inject 失败')
  return {
    ok: errors.length === 0,
    metrics: {
      loadOk: load !== null && load.ok === true,
      loadScenarios: load !== null && Array.isArray(load.scenarios) ? load.scenarios.length : 0,
      faultOk: fault !== null && fault.ok === true,
      faultScenarios: fault !== null && Array.isArray(fault.scenarios) ? fault.scenarios.length : 0,
    },
    errors,
  }
}

/**
 * 运行 soak（默认 24h；测试可注入 now/sleep/runRound 跑短测）。
 * @param {{
 *   durationMs?: number, intervalMs?: number, outFile?: string, resume?: boolean, once?: boolean,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>, runRound?: Function|null,
 *   spawn?: Function|null, stopRequested?: () => boolean, logger?: object|null,
 * }} [options]
 */
export async function runSoak(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const sleep = typeof spec.sleep === 'function' ? spec.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const outFile = typeof spec.outFile === 'string' && spec.outFile.length > 0 ? spec.outFile : SOAK_DEFAULT_OUT
  const durationMs = readPositiveInt(spec.durationMs, SOAK_DEFAULT_DURATION_MS)
  const intervalMs = readPositiveInt(spec.intervalMs, SOAK_DEFAULT_INTERVAL_MS)
  const resume = spec.resume === true
  const once = spec.once === true
  const stopRequested = typeof spec.stopRequested === 'function' ? spec.stopRequested : () => false
  const logger = /** @type {any} */ (spec.logger ?? null)
  const state = resume ? readSoakState(outFile) : { rounds: 0, failures: 0, startedAt: 0, last: null, lines: 0, errors: [] }
  const startedAt = state.startedAt > 0 ? state.startedAt : now()
  const records = []
  const errors = []
  let rounds = state.rounds
  let failures = state.failures
  let roundErrors = 0
  const roundFn = typeof spec.runRound === 'function' ? spec.runRound : (roundOptions) => runRoundWithScripts({ ...roundOptions, spawn: spec.spawn })
  try {
    mkdirSync(path.dirname(outFile), { recursive: true })
  } catch (error) {
    return { ok: false, version: SOAK_VERSION, outFile, rounds, failures, errors: ['无法创建报告目录：' + (error instanceof Error ? error.message : String(error))], completed: false }
  }
  let stopped = false
  while (true) {
    const elapsed = Math.max(0, now() - startedAt)
    if (!once && elapsed >= durationMs) break
    if (stopRequested()) {
      stopped = true
      break
    }
    rounds += 1
    let result = null
    try {
      result = await roundFn({ round: rounds, elapsedMs: elapsed, outFile })
    } catch (error) {
      result = { ok: false, metrics: {}, errors: [error instanceof Error ? error.message : String(error)] }
    }
    const record = isPlainObject(result) ? result : { ok: false, metrics: {}, errors: ['单轮返回非法'] }
    const recordErrors = Array.isArray(record.errors) ? record.errors.map((item) => String(item)) : []
    const ok = record.ok === true && recordErrors.length === 0
    if (!ok) {
      failures += 1
      roundErrors += recordErrors.length
      for (const error of recordErrors) errors.push('round ' + rounds + '：' + error)
    }
    const entry = { ts: now(), round: rounds, elapsedMs: elapsed, ok, metrics: isPlainObject(record.metrics) ? record.metrics : {}, errors: recordErrors }
    records.push(entry)
    try {
      appendFileSync(outFile, JSON.stringify(entry) + '\n')
    } catch (error) {
      errors.push('写报告失败：' + (error instanceof Error ? error.message : String(error)))
    }
    try {
      logger?.info?.(`[soak] round ${rounds} ${ok ? 'ok' : 'failed'}（elapsed ${Math.round(elapsed / 1000)}s）`)
    } catch (error) {
      void error
    }
    if (once) break
    await sleep(intervalMs)
  }
  const finishedAt = now()
  const summary = {
    type: 'summary',
    ts: finishedAt,
    startedAt,
    finishedAt,
    durationMs,
    intervalMs,
    rounds,
    failures,
    errors: errors.length,
    stopped,
    completed: !stopped && (once || finishedAt - startedAt >= durationMs),
    records: records.length,
  }
  try {
    appendFileSync(outFile, JSON.stringify(summary) + '\n')
  } catch (error) {
    errors.push('写 summary 失败：' + (error instanceof Error ? error.message : String(error)))
  }
  return {
    ok: failures === 0,
    version: SOAK_VERSION,
    outFile,
    startedAt,
    finishedAt,
    durationMs,
    intervalMs,
    rounds,
    failures,
    errors,
    roundErrors,
    stopped,
    completed: summary.completed,
    records,
  }
}

/** 文本报告。 */
export function formatSoakReport(report) {
  const lines = []
  lines.push(`[soak] ${report.ok ? '通过' : '有失败'} · rounds=${report.rounds} failures=${report.failures} out=${report.outFile}`)
  lines.push(`- started=${new Date(report.startedAt).toISOString()} finished=${new Date(report.finishedAt).toISOString()} completed=${report.completed} stopped=${report.stopped}`)
  for (const error of report.errors.slice(0, 20)) lines.push('! ' + error)
  return lines
}

/** CLI 入口。 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseSoakArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/soak-24h.mjs [选项]',
        '  --duration-ms <ms>  总时长（默认 24h）',
        '  --interval-ms <ms>  轮间隔（默认 5min）',
        '  --out <file>        JSONL 报告路径（默认临时目录）',
        '  --once              只跑一轮（自测）',
        '  --resume            从既有 --out 报告继续',
        '  --json              输出最终 JSON 报告',
        '',
      ].join('\n'),
    )
    return { exitCode: 0, report: null }
  }
  if (options.ok !== true) {
    process.stderr.write('[soak] 参数非法：' + options.errors.join('；') + '\n')
    return { exitCode: 1, report: null }
  }
  let stop = false
  const onSignal = () => {
    stop = true
    process.stderr.write('\n[soak] 收到中断，完成当前轮后写最终摘要…\n')
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const report = await runSoak({
    durationMs: options.durationMs,
    intervalMs: options.intervalMs,
    outFile: options.out,
    resume: options.resume,
    once: options.once,
    stopRequested: () => stop,
  })
  process.removeListener('SIGINT', onSignal)
  process.removeListener('SIGTERM', onSignal)
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else for (const line of formatSoakReport(report)) process.stdout.write(line + '\n')
  return { exitCode: report.ok ? 0 : 1, report }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
    .then((result) => {
      process.exitCode = result.exitCode
    })
    .catch((error) => {
      process.stderr.write('[soak] 失败：' + (error instanceof Error ? error.message : String(error)) + '\n')
      process.exitCode = 1
    })
}
