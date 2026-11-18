#!/usr/bin/env node
// scripts/fault-inject.mjs —— Gate A 故障注入（Gate A8）。
//
// 目标：用**可复现的本地 mock** 复现 Gate A 的典型故障，验证“不会卡死/能恢复/错误可识别”：
//   · 模型超时 / 空响应 → 调用失败可识别、并发槽位释放；
//   · 闸门队列满 / 排队超时 → 明确拒绝码、队列自愈；
//   · 任务取消 / 租约过期 → 状态正确、槽位释放、取消信号；
//   · 进程重启 → 预算落盘计数保留、内存态任务清空（语义符合文档）；
//   · 磁盘写失败 → 预算内存计数不受影响、不抛异常（只告警）。
//
// 约束：不联网、不调用真实模型、不写 live 数据；临时文件只在系统临时目录并清理。
//
// 用法：
//   node scripts/fault-inject.mjs                 # 跑全部场景（默认）
//   node scripts/fault-inject.mjs --list          # 列出场景
//   node scripts/fault-inject.mjs --scenario task-cancel
//   node scripts/fault-inject.mjs --dry-run       # 只打印计划
//   node scripts/fault-inject.mjs --json
//
// 退出码：0 全部通过；1 有场景失败（错误写到 stderr）。
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MODEL_GATE_REJECT_CODES,
  createModelBudget,
  createModelGate,
} from '../lib/domain/host/model-budget.mjs'
import { TASK_ERROR_CODES, createTaskSupervisor } from '../lib/core/task-supervisor.mjs'
import { EVENT_VERSION_STATUS, checkEventVersion, createEventEnvelope } from '../lib/core/event-schema.mjs'

export const FAULT_INJECT_VERSION = 1

/** 场景清单（文档/CLI 单一来源）。 */
export const FAULT_SCENARIOS = Object.freeze([
  { id: 'model-timeout', name: '模型超时', description: 'mock 模型永不返回 → 调用方超时、槽位释放、可重试' },
  { id: 'model-empty', name: '模型空响应', description: 'mock 模型返回空文本 → 判失败、槽位释放' },
  { id: 'gate-queue-full', name: '闸门队列满', description: '并发打满 + 队列满 → 立即拒绝（MODEL_GATE_QUEUE_FULL）' },
  { id: 'gate-queue-timeout', name: '闸门排队超时', description: '排队超过 queueTimeoutMs → 拒绝（MODEL_GATE_QUEUE_TIMEOUT）、队列自愈' },
  { id: 'task-cancel', name: '任务取消', description: '取消运行中任务 → 终态 cancelled、取消信号、槽位释放、队列补位' },
  { id: 'task-lease-expiry', name: '任务租约过期', description: '租约过期 → 自动 failed（TASK_LEASE_EXPIRED）、槽位释放' },
  { id: 'process-restart', name: '进程重启', description: '预算落盘计数保留；Task 监管器内存态清空（符合契约）' },
  { id: 'disk-write-failure', name: '磁盘写失败', description: '预算写盘抛错 → 内存计数不受影响、不抛异常、有告警' },
  { id: 'event-unknown-retain', name: '未知事件保留', description: '未知事件类型 → 版本判定 retain，不丢弃、不执行' },
])

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
  })
}

/** 让闸门的排队超时定时器保持 ref（否则 CLI 在只等定时器时会提前退出）。 */
function createRefTimers() {
  return {
    setTimeout(fn, ms) {
      return { handle: setTimeout(fn, ms) }
    },
    clearTimeout(timer) {
      if (timer !== null && timer !== undefined && timer.handle !== undefined) clearTimeout(timer.handle)
    },
  }
}

function tmpDir(name) {
  return mkdtempSync(path.join(os.tmpdir(), `dshp-fault-${name}-`))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** 模拟一次模型调用：成功返回文本，超时/空响应返回结构化失败（不抛）。 */
async function mockModelCall(options) {
  const mode = options.mode
  const gate = options.gate
  const release = await gate.acquire({ role: 'fault' })
  try {
    if (mode === 'hang') {
      const timeoutMs = Math.max(1, Number(options.timeoutMs) || 20)
      const started = Date.now()
      try {
        await Promise.race([
          new Promise(() => {}),
          sleep(timeoutMs).then(() => {
            throw Object.assign(new Error(`模型调用超时（>${timeoutMs}ms）`), { code: 'FAULT_TIMEOUT' })
          }),
        ])
        throw new Error('不可达：超时分支应抛错')
      } catch (error) {
        return { ok: false, code: error && error.code === 'FAULT_TIMEOUT' ? 'FAULT_TIMEOUT' : 'FAULT_ERROR', elapsedMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) }
      }
    }
    await sleep(options.delayMs ?? 1)
    const text = mode === 'empty' ? '' : 'ok'
    if (text.trim().length === 0) return { ok: false, code: 'FAULT_EMPTY_RESPONSE', message: '模型没有返回文本' }
    return { ok: true, text }
  } finally {
    release()
  }
}

async function scenarioModelTimeout() {
  const gate = createModelGate({ maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 200, logger: null })
  const result = await mockModelCall({ mode: 'hang', gate, timeoutMs: 20 })
  assert(result.ok === false, '挂起调用应超时失败')
  assert(result.code === 'FAULT_TIMEOUT', '超时错误码应可识别')
  assert(gate.snapshot().active === 0, '超时后并发槽位必须释放')
  const release = await gate.acquire({ role: 'fault' })
  release()
  assert(gate.snapshot().active === 0, '释放后可再次获取槽位')
  return { code: result.code, elapsedMs: result.elapsedMs, gate: gate.snapshot() }
}

async function scenarioModelEmpty() {
  const gate = createModelGate({ maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 200, logger: null })
  const result = await mockModelCall({ mode: 'empty', gate })
  assert(result.ok === false, '空响应应判失败')
  assert(result.code === 'FAULT_EMPTY_RESPONSE', '空响应错误码应可识别')
  assert(gate.snapshot().active === 0, '空响应后槽位必须释放')
  return { code: result.code, gate: gate.snapshot() }
}

async function scenarioGateQueueFull() {
  const gate = createModelGate({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 5000, logger: null })
  const first = await gate.acquire()
  const queued = gate.acquire().then(
    (release) => release,
    (error) => error,
  )
  await Promise.resolve()
  const rejection = await gate.acquire({ role: 'fault' }).then(
    () => null,
    (error) => error,
  )
  assert(rejection instanceof Error, '队列满应拒绝')
  assert(rejection.code === MODEL_GATE_REJECT_CODES.queueFull, '拒绝码应为 queue-full')
  assert(gate.snapshot().queued === 1, '拒绝不占用队列')
  first()
  const releaseQueued = await queued
  releaseQueued()
  return { code: rejection.code, gate: gate.snapshot() }
}

async function scenarioGateQueueTimeout() {
  const gate = createModelGate({ maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 25, logger: null, timers: createRefTimers() })
  const first = await gate.acquire()
  const rejection = await gate.acquire({ role: 'fault' }).then(
    () => null,
    (error) => error,
  )
  assert(rejection instanceof Error, '排队超时应拒绝')
  assert(rejection.code === MODEL_GATE_REJECT_CODES.queueTimeout, '拒绝码应为 queue-timeout')
  assert(gate.snapshot().queued === 0, '超时项应出队（队列自愈）')
  first()
  const release = await gate.acquire()
  release()
  return { code: rejection.code, gate: gate.snapshot() }
}

async function scenarioTaskCancel() {
  const supervisor = createTaskSupervisor({ now: () => 1000, leaseMs: 10_000, maxRunning: 1 })
  const running = supervisor.submit({ key: 'fault-running' })
  const queued = supervisor.submit({ key: 'fault-queued' })
  assert(running.task.state === 'running', '第一个任务应运行')
  assert(queued.task.state === 'queued', '第二个任务应排队')
  const signal = supervisor.signalFor(running.task.id)
  let cancelledSignal = 0
  signal.onCancel(() => {
    cancelledSignal += 1
  })
  const cancelled = supervisor.cancel(running.task.id, { reason: 'fault-inject' })
  assert(cancelled.ok === true && cancelled.task.state === 'cancelled', '取消后应为 cancelled')
  assert(cancelledSignal === 1, '取消信号应触发')
  assert(supervisor.get(queued.task.id).state === 'running', '取消后队列应补位')
  return { signal: cancelledSignal, byState: supervisor.snapshot().byState }
}

async function scenarioTaskLeaseExpiry() {
  let clock = 1000
  const supervisor = createTaskSupervisor({ now: () => clock, leaseMs: 50, maxRunning: 1 })
  const task = supervisor.submit({ key: 'fault-lease', owner: 'fault' })
  clock = 1100
  const swept = supervisor.tick()
  assert(swept.expired === 1, '应清理 1 个过期租约')
  assert(supervisor.get(task.task.id).state === 'failed', '过期任务应 failed')
  assert(supervisor.get(task.task.id).error.code === TASK_ERROR_CODES.leaseExpired, '错误码应为 TASK_LEASE_EXPIRED')
  assert(supervisor.snapshot().slotsUsed === 0, '过期后槽位释放')
  return { expired: swept.expired, state: supervisor.get(task.task.id).state }
}

async function scenarioProcessRestart() {
  const dir = tmpDir('restart')
  const file = path.join(dir, 'model-budget.json')
  try {
    const before = createModelBudget({ file, env: {}, now: () => 1000 })
    before.tryConsume('mood')
    before.tryConsume('mood')
    before.flush()
    assert(existsSync(file), '预算应已落盘')
    // 模拟重启：新实例从同一文件读回
    const after = createModelBudget({ file, env: {}, now: () => 1000 })
    assert(after.snapshot().total === 2, '重启后预算计数应保留')
    const persisted = JSON.parse(readFileSync(file, 'utf8'))
    assert(persisted.total === 2, '落盘文件计数应为 2')
    // Task 监管器是内存态：新实例没有旧任务（契约：持久化由 Hub 负责）
    const oldSupervisor = createTaskSupervisor({ now: () => 1000, leaseMs: 10_000, maxRunning: 2 })
    oldSupervisor.submit({ key: 'restart-task' })
    const newSupervisor = createTaskSupervisor({ now: () => 1000, leaseMs: 10_000, maxRunning: 2 })
    assert(newSupervisor.snapshot().total === 0, 'Task 监管器重启后为空白（需 Hub 重建）')
    return { budgetTotal: after.snapshot().total, persistedTotal: persisted.total, newSupervisorTotal: 0 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function scenarioDiskWriteFailure() {
  const dir = tmpDir('disk')
  const file = path.join(dir, 'model-budget.json')
  const warnings = []
  try {
    const budget = createModelBudget({
      file,
      env: {},
      now: () => 1000,
      write: () => {
        throw new Error('ENOSPC: no space left on device')
      },
      logger: {
        warn: (message) => warnings.push(String(message)),
      },
    })
    const consumed = budget.tryConsume('mood')
    assert(consumed.ok === true, '写盘失败不应影响预算判定（内存计数为准）')
    assert(budget.snapshot().total === 1, '内存计数应保留')
    // 强制 flush：不得抛异常，只告警
    budget.flush()
    assert(budget.snapshot().total === 1, 'flush 失败后内存计数仍保留')
    assert(warnings.some((message) => message.includes('模型预算写入失败')), '应记录写入失败告警')
    return { total: budget.snapshot().total, warnings: warnings.length }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function scenarioEventUnknownRetain() {
  const created = createEventEnvelope(
    { activity: 'fault', type: 'fault.unknown.event', version: 1, subject: 'fault-1', payload: { a: 1 } },
    { now: 1000, random: () => 0.5 },
  )
  assert(created.ok === true, '事件应通过 envelope 校验')
  const verdict = checkEventVersion(created.event, { types: ['fault.known.event'] })
  assert(verdict.status === EVENT_VERSION_STATUS.unknownType, '未知类型应判定 unknown-type')
  assert(verdict.action === 'retain', '未知事件应保留（不丢弃）')
  return { status: verdict.status, action: verdict.action }
}

const RUNNERS = Object.freeze({
  'model-timeout': scenarioModelTimeout,
  'model-empty': scenarioModelEmpty,
  'gate-queue-full': scenarioGateQueueFull,
  'gate-queue-timeout': scenarioGateQueueTimeout,
  'task-cancel': scenarioTaskCancel,
  'task-lease-expiry': scenarioTaskLeaseExpiry,
  'process-restart': scenarioProcessRestart,
  'disk-write-failure': scenarioDiskWriteFailure,
  'event-unknown-retain': scenarioEventUnknownRetain,
})

export function listFaultScenarios() {
  return FAULT_SCENARIOS.map((item) => ({ ...item }))
}

/**
 * 运行故障注入场景。
 * @param {{scenario?: string, dryRun?: boolean, only?: string[]}} [options]
 */
export async function runFaultInjection(options = {}) {
  const startedAt = Date.now()
  const report = {
    ok: false,
    dryRun: options.dryRun === true,
    version: FAULT_INJECT_VERSION,
    startedAt,
    finishedAt: 0,
    durationMs: 0,
    scenarios: [],
    errors: [],
  }
  const requested = typeof options.scenario === 'string' && options.scenario.length > 0 ? [options.scenario] : null
  const only = Array.isArray(options.only) && options.only.length > 0 ? options.only : requested
  const selected = FAULT_SCENARIOS.filter((item) => only === null || only.includes(item.id))
  if (selected.length === 0) {
    report.errors.push(`没有匹配的场景：${(only ?? []).join(', ') || '（空）'}`)
    report.finishedAt = Date.now()
    report.durationMs = report.finishedAt - report.startedAt
    return report
  }
  if (report.dryRun) {
    report.ok = true
    report.scenarios = selected.map((item) => ({ id: item.id, name: item.name, ok: null, dryRun: true }))
    report.plan = `dry-run：将执行 ${selected.length} 个场景（${selected.map((item) => item.id).join(', ')}）`
    report.finishedAt = Date.now()
    report.durationMs = report.finishedAt - report.startedAt
    return report
  }
  for (const item of selected) {
    const began = Date.now()
    try {
      const runner = RUNNERS[item.id]
      const details = await runner()
      report.scenarios.push({ id: item.id, name: item.name, ok: true, durationMs: Date.now() - began, details })
    } catch (error) {
      report.scenarios.push({
        id: item.id,
        name: item.name,
        ok: false,
        durationMs: Date.now() - began,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  report.ok = report.scenarios.every((item) => item.ok === true)
  report.finishedAt = Date.now()
  report.durationMs = report.finishedAt - report.startedAt
  return report
}

export function formatFaultReport(report) {
  const lines = []
  lines.push(report.dryRun ? '【dry-run】故障注入（未执行）' : '故障注入结果')
  if (report.plan !== undefined) lines.push(report.plan)
  for (const item of report.scenarios) {
    const mark = item.ok === true ? '✅' : item.ok === false ? '❌' : '•'
    lines.push(`${mark} ${item.id}（${item.name}）${item.durationMs !== undefined ? ` ${item.durationMs}ms` : ''}`)
    if (item.error !== undefined) lines.push(`   错误：${item.error}`)
  }
  lines.push(report.ok ? `结论：通过（${report.durationMs}ms）` : `结论：失败（${report.durationMs}ms）`)
  for (const error of report.errors) lines.push(`错误：${error}`)
  return lines.join('\n')
}

export function parseFaultArgs(argv) {
  const options = { dryRun: false, json: false }
  const args = Array.isArray(argv) ? argv : []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--list') options.list = true
    else if (arg === '--scenario') options.scenario = args[(index += 1)]
    else if (arg === '--help' || arg === '-h') options.help = true
    else options.unknown = [...(options.unknown ?? []), arg]
  }
  return options
}

export async function main(argv) {
  const options = parseFaultArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/fault-inject.mjs [选项]',
        '  --list             列出全部场景',
        '  --scenario <id>    只跑一个场景',
        '  --dry-run          只打印计划，不执行',
        '  --json             输出 JSON 报告',
        '',
        '场景：' + FAULT_SCENARIOS.map((item) => item.id).join(' / '),
        '',
      ].join('\n'),
    )
    return 0
  }
  if (options.list === true) {
    for (const item of FAULT_SCENARIOS) process.stdout.write(`${item.id}\t${item.name}\t${item.description}\n`)
    return 0
  }
  if (options.unknown !== undefined) {
    process.stderr.write(`未知参数：${options.unknown.join(' ')}\n`)
    return 1
  }
  const report = await runFaultInjection(options)
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else process.stdout.write(formatFaultReport(report) + '\n')
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
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`故障注入失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
