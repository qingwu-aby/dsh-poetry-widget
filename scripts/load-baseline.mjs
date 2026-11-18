#!/usr/bin/env node
// scripts/load-baseline.mjs —— Gate A 基线压测（Gate A8）。
//
// 目标：用**可复现的 mock** 压一压 Gate A 的三个地基，给后续 Hub 留运行基线：
//   · model：并发模型调用 → 复用真实并发闸门 createModelGate（Gate A1），观察 p50/p95、队列深度、拒绝数；
//   · task：长任务 → 复用真实 Task 监管器 createTaskSupervisor（Gate A2），观察排队/完成/取消与时长；
//   · event：事件生产/消费 → 复用事件契约校验（Gate A7）+ 有界队列，观察背压丢弃/未知事件保留。
//
// 约束：**不依赖真实模型 API、不联网、不写 live 数据**；只有显式 `--out` 才写一个本地 JSON 文件。
// 默认参数是“小规模冒烟”，大一点用 `--requests 1000 --concurrency 50`。
//
// 用法：
//   node scripts/load-baseline.mjs                       # 全部场景（模型 200 / 任务 100 / 事件 1000）
//   node scripts/load-baseline.mjs --scenario model --requests 500 --concurrency 50
//   node scripts/load-baseline.mjs --scenario task --tasks 500
//   node scripts/load-baseline.mjs --scenario event --events 5000
//   node scripts/load-baseline.mjs --json --out /tmp/baseline.json
//   node scripts/load-baseline.mjs --dry-run             # 只打印配置与计划，不跑
//
// 退出码：0 成功；1 失败（错误写到 stderr）。
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createModelGate } from '../lib/domain/host/model-budget.mjs'
import { createTaskSupervisor } from '../lib/core/task-supervisor.mjs'
import {
  EVENT_BACKPRESSURE_DEFAULTS,
  checkEventVersion,
  createEventEnvelope,
} from '../lib/core/event-schema.mjs'

export const LOAD_BASELINE_VERSION = 1

/** 默认配置（小规模冒烟；保证单次运行几秒内结束）。 */
export const LOAD_DEFAULTS = Object.freeze({
  scenario: 'all',
  seed: 42,
  // model
  requests: 200,
  concurrency: 20,
  maxConcurrent: 2,
  maxQueue: 24,
  queueTimeoutMs: 200,
  serviceMs: 2,
  slowRatio: 0.1,
  slowMs: 25,
  hangRatio: 0.02,
  // task
  tasks: 100,
  maxRunning: 4,
  taskMs: 20,
  cancelRatio: 0.05,
  // event
  events: 1000,
  eventCapacity: 500,
  unknownRatio: 0.1,
})

/** mulberry32：小而稳定的种子随机（同 seed 同序列，便于对比基线）。 */
export function createSeededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 计算分位数（p ∈ [0,1]；空数组返回 0）。 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = values.slice().sort((left, right) => left - right)
  const ratio = Math.min(1, Math.max(0, Number(p)))
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))
  return sorted[index]
}

function latencyStats(values) {
  const list = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : []
  if (list.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 }
  const sum = list.reduce((total, value) => total + value, 0)
  return {
    count: list.length,
    p50: Math.round(percentile(list, 0.5) * 100) / 100,
    p95: Math.round(percentile(list, 0.95) * 100) / 100,
    p99: Math.round(percentile(list, 0.99) * 100) / 100,
    max: Math.round(Math.max(...list) * 100) / 100,
    avg: Math.round((sum / list.length) * 100) / 100,
  }
}

function memorySnapshot() {
  try {
    const usage = process.memoryUsage()
    return {
      rssBytes: Number(usage.rss) || 0,
      heapUsedBytes: Number(usage.heapUsed) || 0,
      heapTotalBytes: Number(usage.heapTotal) || 0,
    }
  } catch (error) {
    void error
    return { rssBytes: 0, heapUsedBytes: 0, heapTotalBytes: 0 }
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
  })
}

/** 模型调用场景：真实 createModelGate + mock 模型时延/挂起。 */
export async function runModelScenario(options = {}) {
  const config = {
    requests: Math.max(1, Math.floor(Number(options.requests) || LOAD_DEFAULTS.requests)),
    concurrency: Math.max(1, Math.floor(Number(options.concurrency) || LOAD_DEFAULTS.concurrency)),
    maxConcurrent: Math.max(1, Math.floor(Number(options.maxConcurrent) || LOAD_DEFAULTS.maxConcurrent)),
    maxQueue: Math.max(0, Math.floor(Number(options.maxQueue ?? LOAD_DEFAULTS.maxQueue))),
    queueTimeoutMs: Math.max(1, Math.floor(Number(options.queueTimeoutMs) || LOAD_DEFAULTS.queueTimeoutMs)),
    serviceMs: Math.max(0, Number(options.serviceMs ?? LOAD_DEFAULTS.serviceMs)),
    slowRatio: Math.min(1, Math.max(0, Number(options.slowRatio ?? LOAD_DEFAULTS.slowRatio))),
    slowMs: Math.max(0, Number(options.slowMs ?? LOAD_DEFAULTS.slowMs)),
    hangRatio: Math.min(1, Math.max(0, Number(options.hangRatio ?? LOAD_DEFAULTS.hangRatio))),
  }
  const random = createSeededRandom(options.seed ?? LOAD_DEFAULTS.seed)
  const gate = createModelGate({
    maxConcurrent: config.maxConcurrent,
    maxQueue: config.maxQueue,
    queueTimeoutMs: config.queueTimeoutMs,
    logger: null,
  })
  const latencies = []
  const rejected = { queueFull: 0, timeout: 0, other: 0 }
  const hangReleases = []
  let peakQueued = 0
  let granted = 0
  const startedAt = Date.now()
  const sampler = setInterval(() => {
    try {
      const snapshot = gate.snapshot()
      if (snapshot.queued > peakQueued) peakQueued = snapshot.queued
    } catch (error) {
      void error
    }
  }, 2)

  const totalWorkers = Math.min(config.concurrency, config.requests)
  let nextIndex = 0

  async function worker() {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= config.requests) return
      const began = Date.now()
      let release = null
      try {
        release = await gate.acquire({ role: 'load' })
      } catch (error) {
        const reason = error && typeof error.reason === 'string' ? error.reason : 'other'
        if (reason === 'queue-full') rejected.queueFull += 1
        else if (reason === 'queue-timeout') rejected.timeout += 1
        else rejected.other += 1
        continue
      }
      granted += 1
      const snapshot = gate.snapshot()
      if (snapshot.queued > peakQueued) peakQueued = snapshot.queued
      const roll = random()
      const hang = roll < config.hangRatio
      const slow = !hang && roll < config.hangRatio + config.slowRatio
      if (hang) {
        // 挂起：模拟模型长时间不返回；占用槽位到“调用方超时”为止（不永久卡死压测）。
        const hangTimer = setTimeout(() => {
          try {
            release()
          } catch (error) {
            void error
          }
        }, config.queueTimeoutMs + 100)
        hangReleases.push(() => {
          clearTimeout(hangTimer)
          release()
        })
        continue
      }
      await sleep(slow ? config.slowMs : config.serviceMs)
      latencies.push(Date.now() - began)
      release()
    }
  }

  const workers = Array.from({ length: totalWorkers }, () => worker())
  await Promise.all(workers)
  const durationMs = Date.now() - startedAt
  clearInterval(sampler)
  for (const release of hangReleases) {
    try {
      release()
    } catch (error) {
      void error
    }
  }
  return {
    config,
    durationMs,
    requests: config.requests,
    granted,
    rejected,
    latencyMs: latencyStats(latencies),
    queue: {
      peak: peakQueued,
      maxQueue: config.maxQueue,
      maxConcurrent: config.maxConcurrent,
      final: gate.snapshot(),
    },
    throughputPerSec: durationMs > 0 ? Math.round((granted / durationMs) * 1000 * 100) / 100 : 0,
  }
}

/** 任务场景：真实 Task 监管器 + 注入时钟（不依赖真实等待）。 */
export function runTaskScenario(options = {}) {
  const config = {
    tasks: Math.max(1, Math.floor(Number(options.tasks) || LOAD_DEFAULTS.tasks)),
    maxRunning: Math.max(1, Math.floor(Number(options.maxRunning) || LOAD_DEFAULTS.maxRunning)),
    taskMs: Math.max(1, Math.floor(Number(options.taskMs) || LOAD_DEFAULTS.taskMs)),
    cancelRatio: Math.min(1, Math.max(0, Number(options.cancelRatio ?? LOAD_DEFAULTS.cancelRatio))),
  }
  const random = createSeededRandom((options.seed ?? LOAD_DEFAULTS.seed) + 7)
  let clock = 1_700_000_000_000
  const supervisor = createTaskSupervisor({
    now: () => clock,
    leaseMs: 60 * 60 * 1000,
    maxRunning: config.maxRunning,
  })
  const durations = []
  const due = new Map()
  let cancelled = 0
  const startedAt = Date.now()
  for (let index = 0; index < config.tasks; index += 1) {
    const submitted = supervisor.submit({ key: 'load-task-' + index, kind: 'load' })
    if (!submitted.ok) continue
    const id = submitted.task.id
    if (random() < config.cancelRatio) {
      const result = supervisor.cancel(id, { reason: 'load-cancel' })
      if (result.ok) cancelled += 1
      continue
    }
    const createdAt = submitted.task.createdAt
    due.set(id, { dueAt: createdAt + Math.max(1, Math.round(random() * config.taskMs)), createdAt })
  }
  // 事件循环：推进注入时钟，完成到期任务；supervisor 自动补位 queued。
  const maxSteps = config.tasks * config.taskMs * 4 + 1000
  for (let step = 0; step < maxSteps; step += 1) {
    clock += 1
    supervisor.tick()
    for (const [id, item] of [...due]) {
      if (item.dueAt > clock) continue
      const task = supervisor.get(id)
      if (task === null) {
        due.delete(id)
        continue
      }
      if (task.state === 'queued' || task.state === 'waiting') {
        // 还没轮到执行：等它被补位后再完成（不丢 due）。
        item.dueAt = clock + 1
        continue
      }
      if (task.state === 'running') {
        const result = supervisor.complete(id, { done: true })
        if (result.ok) durations.push(clock - item.createdAt)
        due.delete(id)
        continue
      }
      due.delete(id)
    }
    if (supervisor.snapshot().active === 0 && due.size === 0) break
  }
  const snapshot = supervisor.snapshot()
  return {
    config,
    durationMs: Date.now() - startedAt,
    total: config.tasks,
    completed: snapshot.byState.done,
    cancelled: snapshot.byState.cancelled,
    failed: snapshot.byState.failed,
    cancelledByClient: cancelled,
    byState: snapshot.byState,
    durationMsStats: latencyStats(durations),
    slotsUsed: snapshot.slotsUsed,
    maxRunning: snapshot.maxRunning,
  }
}

/** 事件场景：契约校验 + 有界队列背压 + 未知事件保留 + 幂等去重。 */
export function runEventScenario(options = {}) {
  const config = {
    events: Math.max(1, Math.floor(Number(options.events) || LOAD_DEFAULTS.events)),
    capacity: Math.max(1, Math.floor(Number(options.eventCapacity) || LOAD_DEFAULTS.eventCapacity)),
    unknownRatio: Math.min(1, Math.max(0, Number(options.unknownRatio ?? LOAD_DEFAULTS.unknownRatio))),
  }
  const random = createSeededRandom((options.seed ?? LOAD_DEFAULTS.seed) + 13)
  const queue = []
  const seenKeys = new Set()
  let invalid = 0
  let retainedUnknown = 0
  let processed = 0
  let duplicates = 0
  let dropped = 0
  let peakDepth = 0
  const startedAt = Date.now()
  // 阶段 1：生产（有界队列；满则丢弃，模拟背压）。
  for (let index = 0; index < config.events; index += 1) {
    const unknown = random() < config.unknownRatio
    const created = createEventEnvelope(
      {
        activity: 'load',
        type: unknown ? 'load.unknown.event' : 'load.sample.event',
        version: 1,
        subject: 'subject-' + (index % 50),
        payload: { index },
      },
      { now: startedAt + index, random },
    )
    if (!created.ok) {
      invalid += 1
      continue
    }
    const event = created.event
    const verdict = checkEventVersion(event, { types: ['load.sample.event'], minVersion: 1, maxVersion: 1 })
    if (queue.length >= config.capacity) {
      dropped += 1
      continue
    }
    if (verdict.action === 'retain') retainedUnknown += 1
    queue.push({ event, verdict })
    if (queue.length > peakDepth) peakDepth = queue.length
  }
  // 阶段 2：消费（去重 + 只处理兼容事件）。
  while (queue.length > 0) {
    const item = queue.shift()
    const key = item.event.id
    if (seenKeys.has(key)) {
      duplicates += 1
      continue
    }
    seenKeys.add(key)
    if (item.verdict.action === 'process') processed += 1
  }
  const durationMs = Date.now() - startedAt
  return {
    config,
    durationMs,
    produced: config.events,
    invalid,
    processed,
    retainedUnknown,
    duplicates,
    dropped,
    peakDepth,
    backpressure: {
      retentionHours: EVENT_BACKPRESSURE_DEFAULTS.retentionHours,
      maxEventsInMemory: EVENT_BACKPRESSURE_DEFAULTS.maxEventsInMemory,
      maxReplayEvents: EVENT_BACKPRESSURE_DEFAULTS.maxReplayEvents,
      diskSoftLimitBytes: EVENT_BACKPRESSURE_DEFAULTS.diskSoftLimitBytes,
      diskHardLimitBytes: EVENT_BACKPRESSURE_DEFAULTS.diskHardLimitBytes,
    },
    throughputPerSec: durationMs > 0 ? Math.round((config.events / durationMs) * 1000 * 100) / 100 : 0,
  }
}

/** 归一化配置（CLI/测试共用）。 */
export function normalizeLoadOptions(options = {}) {
  const spec = options && typeof options === 'object' ? options : {}
  const scenario = ['all', 'model', 'task', 'event'].includes(spec.scenario) ? spec.scenario : LOAD_DEFAULTS.scenario
  const pick = (key) => (spec[key] === undefined ? LOAD_DEFAULTS[key] : spec[key])
  return {
    scenario,
    seed: Math.floor(Number(pick('seed')) || LOAD_DEFAULTS.seed),
    requests: Math.max(1, Math.floor(Number(pick('requests')))),
    concurrency: Math.max(1, Math.floor(Number(pick('concurrency')))),
    maxConcurrent: Math.max(1, Math.floor(Number(pick('maxConcurrent')))),
    maxQueue: Math.max(0, Math.floor(Number(pick('maxQueue')))),
    queueTimeoutMs: Math.max(1, Math.floor(Number(pick('queueTimeoutMs')))),
    serviceMs: Math.max(0, Number(pick('serviceMs'))),
    slowRatio: Math.min(1, Math.max(0, Number(pick('slowRatio')))),
    slowMs: Math.max(0, Number(pick('slowMs'))),
    hangRatio: Math.min(1, Math.max(0, Number(pick('hangRatio')))),
    tasks: Math.max(1, Math.floor(Number(pick('tasks')))),
    maxRunning: Math.max(1, Math.floor(Number(pick('maxRunning')))),
    taskMs: Math.max(1, Math.floor(Number(pick('taskMs')))),
    cancelRatio: Math.min(1, Math.max(0, Number(pick('cancelRatio')))),
    events: Math.max(1, Math.floor(Number(pick('events')))),
    eventCapacity: Math.max(1, Math.floor(Number(pick('eventCapacity')))),
    unknownRatio: Math.min(1, Math.max(0, Number(pick('unknownRatio')))),
  }
}

/**
 * 运行基线压测。
 * @param {{scenario?: string, dryRun?: boolean} & Record<string, any>} [options]
 */
export async function runLoadBaseline(options = {}) {
  const config = normalizeLoadOptions(options)
  const startedAt = Date.now()
  const report = {
    ok: false,
    dryRun: options.dryRun === true,
    version: LOAD_BASELINE_VERSION,
    scenario: config.scenario,
    seed: config.seed,
    config,
    startedAt,
    finishedAt: 0,
    durationMs: 0,
    model: null,
    tasks: null,
    events: null,
    memory: memorySnapshot(),
    errors: [],
  }
  if (report.dryRun) {
    report.ok = true
    report.finishedAt = Date.now()
    report.plan = `dry-run：将运行 scenario=${config.scenario}（模型 ${config.requests} 次/并发 ${config.concurrency}；任务 ${config.tasks}；事件 ${config.events}）`
    return report
  }
  try {
    if (config.scenario === 'all' || config.scenario === 'model') {
      report.model = await runModelScenario({ ...config })
    }
    if (config.scenario === 'all' || config.scenario === 'task') {
      report.tasks = runTaskScenario({ ...config })
    }
    if (config.scenario === 'all' || config.scenario === 'event') {
      report.events = runEventScenario({ ...config })
    }
    report.ok = report.errors.length === 0
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
    report.ok = false
  }
  report.finishedAt = Date.now()
  report.durationMs = report.finishedAt - report.startedAt
  report.memory = memorySnapshot()
  return report
}

export function formatLoadReport(report) {
  const lines = []
  lines.push(report.dryRun ? '【dry-run】基线压测（未执行）' : '基线压测结果')
  lines.push(`场景：${report.scenario}；seed=${report.seed}；耗时 ${report.durationMs}ms`)
  if (report.model !== null) {
    const model = report.model
    lines.push(
      `模型：${model.requests} 次 / 并发 ${model.config.concurrency} / 闸门 ${model.config.maxConcurrent}+${model.config.maxQueue}队列 → 通过 ${model.granted}，拒绝 队列满 ${model.rejected.queueFull} / 超时 ${model.rejected.timeout}；p50 ${model.latencyMs.p50}ms p95 ${model.latencyMs.p95}ms p99 ${model.latencyMs.p99}ms；峰值队列 ${model.queue.peak}/${model.config.maxQueue}；吞吐 ${model.throughputPerSec}/s`,
    )
  }
  if (report.tasks !== null) {
    const tasks = report.tasks
    lines.push(
      `任务：${tasks.total} 个 / maxRunning ${tasks.maxRunning} → 完成 ${tasks.completed}、取消 ${tasks.cancelled}、失败 ${tasks.failed}；时长 p50 ${tasks.durationMsStats.p50}ms p95 ${tasks.durationMsStats.p95}ms；槽位 ${tasks.slotsUsed}`,
    )
  }
  if (report.events !== null) {
    const events = report.events
    lines.push(
      `事件：${events.produced} 条 / 容量 ${events.config.capacity} → 处理 ${events.processed}、未知保留 ${events.retainedUnknown}、重复 ${events.duplicates}、丢弃 ${events.dropped}、非法 ${events.invalid}；峰值队列 ${events.peakDepth}；吞吐 ${events.throughputPerSec}/s`,
    )
  }
  lines.push(
    `内存：rss ${Math.round(report.memory.rssBytes / 1024 / 1024)}MB / heap ${Math.round(report.memory.heapUsedBytes / 1024 / 1024)}MB`,
  )
  for (const error of report.errors) lines.push(`错误：${error}`)
  return lines.join('\n')
}

export function parseLoadArgs(argv) {
  const options = { dryRun: false, json: false }
  const args = Array.isArray(argv) ? argv : []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const numeric = [
      'requests',
      'concurrency',
      'max-concurrent',
      'max-queue',
      'queue-timeout-ms',
      'service-ms',
      'slow-ratio',
      'slow-ms',
      'hang-ratio',
      'tasks',
      'max-running',
      'task-ms',
      'cancel-ratio',
      'events',
      'event-capacity',
      'unknown-ratio',
      'seed',
    ]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--out') options.out = args[(index += 1)]
    else if (arg === '--scenario') options.scenario = args[(index += 1)]
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--') && numeric.includes(arg.slice(2))) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase())
      options[key] = Number(args[(index += 1)])
    } else options.unknown = [...(options.unknown ?? []), arg]
  }
  return options
}

export async function main(argv) {
  const options = parseLoadArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/load-baseline.mjs [选项]',
        '  --scenario <all|model|task|event>  场景（默认 all）',
        '  --requests/--concurrency/--max-concurrent/--max-queue/--queue-timeout-ms  模型场景',
        '  --service-ms/--slow-ratio/--slow-ms/--hang-ratio                        模型时延分布',
        '  --tasks/--max-running/--task-ms/--cancel-ratio                          任务场景',
        '  --events/--event-capacity/--unknown-ratio                               事件场景',
        '  --seed <n>        随机种子（同 seed 结果可对比）',
        '  --dry-run         只打印计划，不执行',
        '  --json            输出 JSON 报告',
        '  --out <file>      把 JSON 报告写到本地文件（唯一写盘行为）',
        '',
      ].join('\n'),
    )
    return 0
  }
  if (options.unknown !== undefined) {
    process.stderr.write(`未知参数：${options.unknown.join(' ')}\n`)
    return 1
  }
  const report = await runLoadBaseline(options)
  if (typeof options.out === 'string' && options.out.length > 0 && report.dryRun !== true) {
    try {
      writeFileSync(path.resolve(options.out), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    } catch (error) {
      process.stderr.write(`写入报告失败：${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else process.stdout.write(formatLoadReport(report) + '\n')
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
    process.stderr.write(`基线压测失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
