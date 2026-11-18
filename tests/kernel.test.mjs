// kernel 基础设施单测（W0/W1）

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildHealthAlerts,
  buildHealthMetrics,
  buildRuntimeSnapshot,
  HEALTH_ALERT_THRESHOLDS,
  summarizeModelBudget,
  summarizeModelGate,
} from '../lib/composition/health.mjs'
import {
  ACTIVITY_MANIFEST_ERROR_CODES,
  ACTIVITY_PERMISSIONS,
  checkActivityPermission,
  describeActivityPermissions,
  isActivityPermission,
  listActivityPermissions,
  PERMISSION_REASONS,
  parseActivityPermission,
  validateActivityManifest,
} from '../lib/core/activity-manifest.mjs'
import {
  buildIdempotencyKey,
  canonicalJson,
  checkEventVersion,
  contentHashOf,
  createEventEnvelope,
  EVENT_BACKPRESSURE_DEFAULTS,
  EVENT_ERROR_CODES,
  EVENT_RESERVED_NAMESPACES,
  EVENT_SCHEMA_LIMITS,
  EVENT_VERSION_STATUS,
  generateEventId,
  isReservedNamespace,
  isVersionCompatible,
  parseEventType,
  resolveEventBackpressure,
  UNKNOWN_EVENT_POLICY,
  validateEventEnvelope,
} from '../lib/core/event-schema.mjs'
import {
  canTransition,
  createTaskSupervisor,
  TASK_ALLOWED_TRANSITIONS,
  TASK_ERROR_CODES,
} from '../lib/core/task-supervisor.mjs'
import {
  COST_REJECT_CODE,
  COST_SOFT_ALERT_CODE,
  createCostGuard,
  DEFAULT_COST_POLICY,
  describeCostPolicy,
  resolveCostPolicy,
} from '../lib/domain/host/cost-guard.mjs'
import {
  createModelBudget,
  createModelGate,
  MODEL_GATE_DEFAULTS,
  MODEL_GATE_REJECT_CODES,
} from '../lib/domain/host/model-budget.mjs'
import { describeConfig, readConfig } from '../lib/kernel/config.mjs'
import { createJsonStore, readJson, writeJson } from '../lib/kernel/json-store.mjs'
import { callCandidate, callModelForRole, configureModelRuntime, resetModelRuntime } from '../lib/kernel/llm-call.mjs'
import { createPluginLogger } from '../lib/kernel/logger.mjs'
import { createModelCaller } from '../lib/kernel/model-call.mjs'
import { createServiceRegistry } from '../lib/kernel/service.mjs'
import { createStateRegistry, migrateAll } from '../lib/kernel/state-schema.mjs'
import { FAULT_SCENARIOS, listFaultScenarios, parseFaultArgs, runFaultInjection } from '../scripts/fault-inject.mjs'
import {
  createSeededRandom,
  LOAD_DEFAULTS,
  normalizeLoadOptions,
  percentile,
  runEventScenario,
  runLoadBaseline,
  runModelScenario,
  runTaskScenario,
} from '../scripts/load-baseline.mjs'
import {
  formatRotateStamp,
  isActiveLogName,
  isRotatedLogName,
  parseSize,
  planLogRotation,
  restoreRotatedLog,
  rotateLogs,
} from '../scripts/log-rotate.mjs'
import {
  createStateBackup,
  formatBackupStamp,
  listStateBackups,
  resolveStateHome,
  STATE_BACKUP_KIND,
  sha256Hex,
} from '../scripts/state-backup.mjs'
import {
  findLatestStateBackup,
  resolveRestoreWorkRoot,
  restoreStateBackup,
  verifyStateBackup,
} from '../scripts/state-restore-check.mjs'

function tmpDir(name) {
  return mkdtempSync(path.join(os.tmpdir(), `dshp-${name}-`))
}

/** 可控定时器（Gate A1 测试用）：不依赖真实等待。 */
function createFakeTimers() {
  let nextId = 0
  const pending = new Map()
  return {
    setTimeout(fn, ms) {
      nextId += 1
      const id = nextId
      pending.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
    fireAll() {
      const entries = [...pending.values()]
      pending.clear()
      for (const entry of entries) entry.fn()
    },
    get size() {
      return pending.size
    },
  }
}

function makeStreamLlm(lines) {
  const calls = []
  return {
    calls,
    llm: {
      stream: async function* () {
        calls.push(1)
        for (const line of lines) yield { type: 'text-delta', text: line }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  }
}

test('json-store：缺文件/坏文件回退，normalize 生效', () => {
  const dir = tmpDir('json-store')
  const file = path.join(dir, 'state.json')
  const fallback = () => ({ count: 0 })
  const normalize = (raw) => ({ count: Number(raw?.count) || 0 })
  assert.deepEqual(readJson(file, { normalizer: normalize, fallback }), { count: 0 })
  writeFileSync(file, '{not json')
  assert.deepEqual(readJson(file, { normalizer: normalize, fallback }), { count: 0 })
  writeFileSync(file, JSON.stringify({ count: 3 }))
  assert.deepEqual(readJson(file, { normalizer: normalize }), { count: 3 })
  rmSync(dir, { recursive: true, force: true })
})

test('json-store：migrate 在 normalize 之前执行', () => {
  const dir = tmpDir('json-store-migrate')
  const file = path.join(dir, 'state.json')
  writeFileSync(file, JSON.stringify({ oldCount: 7 }))
  const state = readJson(file, {
    migrate: (raw) => ({ count: raw.oldCount }),
    normalizer: (raw) => ({ count: raw.count }),
  })
  assert.deepEqual(state, { count: 7 })
  rmSync(dir, { recursive: true, force: true })
})

test('json-store：原子写 + 备份轮转 + 校验', () => {
  const dir = tmpDir('json-store-write')
  const file = path.join(dir, 'state.json')
  const store = createJsonStore({ file, normalizer: (raw) => ({ count: Number(raw?.count) || 0 }), backup: true })
  store.write({ count: 1 })
  store.write({ count: 2 })
  store.write({ count: 3 })
  store.write({ count: 4 })
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).count, 4)
  const backups = readdirSync(dir).filter((name) => name.includes('.bak-'))
  assert.ok(backups.length <= 3, `备份应轮转，实际 ${backups.length}`)
  assert.throws(() => writeJson(file, { bad: true }, { validate: () => 'bad state' }))
  rmSync(dir, { recursive: true, force: true })
})

test('state-schema：dry-run 只报告，不写文件', () => {
  const dir = tmpDir('state-dry')
  const file = path.join(dir, 'worldview.json')
  fsWrite(file, JSON.stringify({ v: 1, essay: { text: '旧版' }, beliefs: [] }))
  const before = readFileSync(file, 'utf8')
  const registry = createStateRegistry([
    {
      id: 'worldview',
      file,
      version: 2,
      normalizer: (raw) => ({ v: 2, essay: { text: raw.essay.text, version: 7 }, beliefs: [] }),
    },
  ])
  const result = migrateAll(registry, { dryRun: true })
  assert.equal(result.changed, 1)
  assert.equal(readFileSync(file, 'utf8'), before, 'dry-run 不应改写文件')
  rmSync(dir, { recursive: true, force: true })
})

test('state-schema：需要时写回并备份，损坏文件报错不写', () => {
  const dir = tmpDir('state-write')
  const file = path.join(dir, 'worldview.json')
  fsWrite(file, JSON.stringify({ essay: { text: '旧版' }, history: [{ version: 4 }] }))
  const registry = createStateRegistry([
    {
      id: 'worldview',
      file,
      version: 5,
      normalizer: (raw) => ({ v: 5, essay: { text: raw.essay.text, version: 5 }, history: raw.history }),
    },
  ])
  const result = migrateAll(registry)
  assert.equal(result.changed, 1)
  assert.equal(result.errors, 0)
  const written = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(written.essay.version, 5)
  assert.ok(
    readdirSync(dir).some((name) => name.includes('.bak-')),
    '应留备份',
  )

  const corrupt = path.join(dir, 'broken.json')
  fsWrite(corrupt, '{oops')
  const badResult = migrateAll(
    createStateRegistry([{ id: 'broken', file: corrupt, version: 1, normalizer: (raw) => raw }]),
  )
  assert.equal(badResult.errors, 1)
  assert.equal(readFileSync(corrupt, 'utf8'), '{oops', '损坏文件不应被覆盖')
  rmSync(dir, { recursive: true, force: true })
})

function fsWrite(file, content) {
  writeFileSync(file, content, 'utf8')
}

test('model-call：空响应自动换更大 token 重试', async () => {
  const calls = []
  const caller = createModelCaller({
    invoke: async (options) => {
      calls.push(options.maxTokens)
      if (calls.length === 1) return null
      return { text: '{"ok":1}' }
    },
  })
  const result = await caller.callRole('worldview', {
    attempts: [
      { maxTokens: 5000, prompt: 'p' },
      { maxTokens: 8000, prompt: 'p' },
    ],
    parse: (text) => JSON.parse(text),
  })
  assert.equal(result.ok, true)
  assert.equal(result.attempts, 2)
  assert.deepEqual(calls, [5000, 8000])
})

test('model-call：解析失败落 debug 文件并报告 invalid', async () => {
  const dir = tmpDir('model-call')
  const debugFile = path.join(dir, 'debug.json')
  const caller = createModelCaller({ invoke: async () => ({ text: 'not json' }) })
  const result = await caller.callRole('knowledge_extract', {
    attempts: [
      { maxTokens: 1000, prompt: 'p' },
      { maxTokens: 2000, prompt: 'p' },
    ],
    parse: () => null,
    debugFile,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid')
  const debug = JSON.parse(readFileSync(debugFile, 'utf8'))
  assert.equal(debug.raw, 'not json')
  assert.equal(debug.profile, 'knowledge_extract')
  rmSync(dir, { recursive: true, force: true })
})

test('model-call：两次都空 → empty', async () => {
  const caller = createModelCaller({ invoke: async () => null })
  const result = await caller.callRole('worldview', { attempts: [{ maxTokens: 100, prompt: 'p' }] })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'empty')
})

test('config：默认值、布尔/数字/枚举解析与非法回退', () => {
  const defaults = readConfig({})
  assert.equal(defaults.twin, false)
  assert.equal(defaults.dailyLife, true)
  assert.equal(defaults.migrate, 'on')
  assert.equal(defaults.wanderMin, 40)
  const custom = readConfig({
    DSH_POETRY_TWIN: 'on',
    DSH_POETRY_LOCAL_VOICE: 'MOOD',
    DSH_POETRY_MIGRATE: 'dry-run',
    DSH_POETRY_WANDER_MIN: '15',
  })
  assert.equal(custom.twin, true)
  assert.equal(custom.localVoice, 'mood')
  assert.equal(custom.migrate, 'dry-run')
  assert.equal(custom.wanderMin, 15)
  const invalid = readConfig({ DSH_POETRY_LOCAL_VOICE: 'loud', DSH_POETRY_WANDER_MIN: 'abc' })
  assert.equal(invalid.localVoice, 'off')
  assert.equal(invalid.wanderMin, 40)
  assert.ok(describeConfig().length >= 30)
  assert.equal(describeConfig().find((row) => row.name === 'deepseekApiKey').default, '（已隐藏）')
})

test('logger：转发底层日志并统计静默失败', () => {
  const lines = []
  const base = { info: (m) => lines.push(['info', m]), warn: (m) => lines.push(['warn', m]) }
  const logger = createPluginLogger(base)
  logger.info('a')
  logger.warn('b')
  logger.error('c')
  assert.equal(lines.length, 3)
  const snapshot = logger.snapshot()
  assert.equal(snapshot.counters.warn, 1)
  assert.equal(snapshot.counters.error, 1)
  assert.equal(snapshot.lastWarn, 'b')
  assert.equal(snapshot.lastError, 'c')
  assert.equal(snapshot.silentFailures, 2)
  logger.reset()
  assert.equal(logger.snapshot().silentFailures, 0)
})

test('service：契约与注册表（重复注册报错、快照聚合、stop 全部）', () => {
  const stopped = []
  const registry = createServiceRegistry()
  registry.register({ name: 'a', start: () => {}, stop: () => stopped.push('a'), snapshot: () => ({ ok: 1 }) })
  registry.register({ name: 'b', stop: () => stopped.push('b') })
  assert.deepEqual(registry.names(), ['a', 'b'])
  assert.deepEqual(registry.snapshot(), { a: { ok: 1 }, b: {} })
  assert.throws(() => registry.register({ name: 'a' }))
  registry.stopAll()
  assert.deepEqual(stopped, ['a', 'b'])
})

// ---------------------------------------------------------------------------
// Gate A1：模型网关加固（并发/队列/排队超时/预算写盘节流/health 可观测）
// ---------------------------------------------------------------------------

test('model-gate A1：并发上限 + 释放后继续排队', async () => {
  const gate = createModelGate({ maxConcurrent: 2 })
  const releaseFirst = await gate.acquire()
  const releaseSecond = await gate.acquire()
  assert.deepEqual({ active: gate.snapshot().active, queued: gate.snapshot().queued }, { active: 2, queued: 0 })
  let thirdGranted = false
  const thirdSlot = gate.acquire({ role: 'mood' }).then((release) => {
    thirdGranted = true
    return release
  })
  await Promise.resolve()
  assert.equal(thirdGranted, false, '超过并发上限应排队')
  assert.equal(gate.snapshot().queued, 1)
  releaseFirst()
  const releaseThird = await thirdSlot
  assert.equal(thirdGranted, true, '释放槽位后队首继续')
  assert.equal(gate.snapshot().active, 2)
  assert.equal(gate.snapshot().queued, 0)
  releaseSecond()
  releaseThird()
  assert.equal(gate.snapshot().active, 0)
  assert.equal(gate.snapshot().lastReject, null, '正常排队不产生拒绝')
})

test('model-gate A1：队列满立即拒绝，不无限排队', async () => {
  const gate = createModelGate({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 10_000 })
  const releaseFirst = await gate.acquire()
  const queuedSlot = gate.acquire().then((release) => release)
  await Promise.resolve()
  assert.equal(gate.snapshot().queued, 1)
  const rejection = await gate.acquire({ role: 'selfTalk' }).then(
    () => null,
    (error) => error,
  )
  assert.ok(rejection instanceof Error, '队列满必须 reject')
  assert.equal(rejection.code, MODEL_GATE_REJECT_CODES.queueFull)
  assert.equal(rejection.reason, 'queue-full')
  const snapshot = gate.snapshot()
  assert.equal(snapshot.queued, 1, '拒绝不占用队列')
  assert.equal(snapshot.rejected.queueFull, 1)
  assert.equal(snapshot.lastReject.reason, 'queue-full')
  assert.equal(snapshot.lastReject.role, 'selfTalk')
  assert.match(snapshot.lastReject.message, /排队已满/)
  releaseFirst()
  const releaseQueued = await queuedSlot
  releaseQueued()
  assert.equal(gate.snapshot().active, 0)
})

test('model-gate A1：排队超时拒绝且队列自愈（后续调用不受影响）', async () => {
  const timers = createFakeTimers()
  const gate = createModelGate({ maxConcurrent: 1, maxQueue: 5, queueTimeoutMs: 50, timers, now: () => 1000 })
  const releaseFirst = await gate.acquire()
  const rejection = gate.acquire({ role: 'mood' }).then(
    (release) => release,
    (error) => error,
  )
  await Promise.resolve()
  assert.equal(gate.snapshot().queued, 1)
  assert.equal(timers.size, 1, '排队中应挂一个超时定时器')
  timers.fireAll()
  const error = await rejection
  assert.equal(error.code, MODEL_GATE_REJECT_CODES.queueTimeout)
  assert.equal(error.reason, 'queue-timeout')
  const snapshot = gate.snapshot()
  assert.equal(snapshot.queued, 0, '超时项必须出队')
  assert.equal(snapshot.rejected.timeout, 1)
  assert.equal(snapshot.lastReject.reason, 'queue-timeout')
  releaseFirst()
  const releaseNext = await gate.acquire()
  releaseNext()
  assert.equal(gate.snapshot().active, 0)
})

test('model-gate A1：env 可覆盖并发/队列/超时默认值', () => {
  const gate = createModelGate({
    env: {
      DSH_POETRY_MODEL_MAX_CONCURRENT: '3',
      DSH_POETRY_MODEL_MAX_QUEUE: '7',
      DSH_POETRY_MODEL_QUEUE_TIMEOUT_MS: '1234',
    },
  })
  assert.equal(gate.snapshot().maxConcurrent, 3)
  assert.equal(gate.snapshot().maxQueue, 7)
  assert.equal(gate.snapshot().queueTimeoutMs, 1234)
  const fallback = createModelGate({ env: {} })
  assert.equal(fallback.snapshot().maxConcurrent, MODEL_GATE_DEFAULTS.maxConcurrent)
  assert.equal(fallback.snapshot().maxQueue, MODEL_GATE_DEFAULTS.maxQueue)
  assert.equal(fallback.snapshot().queueTimeoutMs, MODEL_GATE_DEFAULTS.queueTimeoutMs)
})

test('model-budget A1：写盘节流合并 + flush 强制落盘（崩溃最多丢一个窗口）', () => {
  const dir = tmpDir('budget-throttle')
  const file = path.join(dir, 'model-budget.json')
  const timers = createFakeTimers()
  const writes = []
  const budget = createModelBudget({
    file,
    env: {},
    now: () => 1000,
    timers,
    flushIntervalMs: 1000,
    write: (target, value) => writes.push({ target, value }),
  })
  assert.equal(budget.tryConsume('mood').ok, true)
  assert.equal(budget.tryConsume('mood').ok, true)
  assert.equal(budget.tryConsume('selfTalk').ok, true)
  assert.equal(writes.length, 0, '调用期间不同步写盘')
  const pending = budget.snapshot()
  assert.equal(pending.total, 3, '内存计数口径不变')
  assert.equal(pending.pendingWrite, true)
  assert.equal(pending.flushIntervalMs, 1000)
  assert.equal(timers.size, 1, '窗口内只挂一个合并定时器')
  timers.fireAll()
  assert.equal(writes.length, 1, '窗口结束合并成一次写')
  assert.equal(writes[0].target, file)
  assert.equal(writes[0].value.total, 3)
  assert.equal(writes[0].value.counts.mood, 2)
  assert.equal(budget.snapshot().pendingWrite, false)

  assert.equal(budget.tryConsume('growth').ok, true)
  assert.equal(writes.length, 1)
  budget.flush()
  assert.equal(writes.length, 2, 'flush 强制立即落盘')
  assert.equal(writes[1].value.total, 4)
  assert.equal(timers.size, 0, 'flush 取消待执行定时器')
  assert.equal(budget.snapshot().pendingWrite, false)
  rmSync(dir, { recursive: true, force: true })
})

test('model-budget A1：默认写盘路径 flush 后文件可读回且拒绝原因可观测', () => {
  const dir = tmpDir('budget-flush')
  const file = path.join(dir, 'model-budget.json')
  const budget = createModelBudget({ file, env: { DSH_POETRY_DAILY_MOOD: '1' }, now: () => 1000 })
  assert.equal(budget.tryConsume('mood').ok, true)
  const rejected = budget.tryConsume('mood')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'MODEL_BUDGET_EXHAUSTED')
  assert.equal(rejected.scope, 'role')
  budget.flush()
  const persisted = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(persisted.total, 1)
  assert.equal(persisted.counts.mood, 1)
  const snapshot = budget.snapshot()
  assert.equal(snapshot.lastReject.reason, 'budget')
  assert.equal(snapshot.lastReject.role, 'mood')
  assert.equal(snapshot.lastReject.scope, 'role')
  rmSync(dir, { recursive: true, force: true })
})

test('llm-call A1：闸门拒绝返回可识别错误、不发请求、不换候选', async () => {
  const { llm, calls } = makeStreamLlm(['不应该被调用'])
  const gate = {
    acquire: () =>
      Promise.reject(
        Object.assign(new Error('模型调用排队已满（24/24），本次调用被拒绝'), {
          code: MODEL_GATE_REJECT_CODES.queueFull,
          reason: 'queue-full',
        }),
      ),
  }
  configureModelRuntime({ budget: null, gate })
  try {
    const single = await callCandidate({
      candidate: { provider: 'p1', model: 'm1' },
      resolveLlm: () => llm,
      system: 's',
      prompt: 'p',
      maxTokens: 16,
      timeoutMs: 200,
      timeoutCode: 'LLM_TIMEOUT',
      timeoutMessage: '模型调用超时',
      role: 'mood',
    })
    assert.equal(single.ok, false)
    assert.equal(single.reason, 'queue-full')
    assert.equal(single.code, MODEL_GATE_REJECT_CODES.queueFull)
    assert.equal(single.retryable, false, '闸门拒绝不换候选')
    assert.equal(calls.length, 0, '闸门拒绝不应发模型请求')

    const result = await callModelForRole({
      role: 'mood',
      policy: {
        resolveCandidates: () => [
          { provider: 'p1', model: 'm1' },
          { provider: 'p2', model: 'm2' },
        ],
      },
      system: 's',
      prompt: 'p',
      resolveLlm: () => llm,
      maxTokens: 16,
      timeoutMs: 200,
      timeoutCode: 'LLM_TIMEOUT',
      timeoutMessage: '模型调用超时',
    })
    assert.equal(result, null)
    assert.equal(calls.length, 0, '按候选循环时闸门拒绝也不回退')
  } finally {
    resetModelRuntime()
  }
})

test('llm-call A1：闸门成功路径在调用结束后释放槽位', async () => {
  const gate = createModelGate({ maxConcurrent: 1 })
  const { llm } = makeStreamLlm(['好'])
  configureModelRuntime({ budget: null, gate })
  try {
    const result = await callModelForRole({
      role: 'mood',
      policy: { resolveCandidates: () => [{ provider: 'p1', model: 'm1' }] },
      system: 's',
      prompt: 'p',
      resolveLlm: () => llm,
      maxTokens: 16,
      timeoutMs: 500,
      timeoutCode: 'LLM_TIMEOUT',
      timeoutMessage: '模型调用超时',
    })
    assert.equal(result.text, '好')
    assert.equal(gate.snapshot().active, 0, '成功后必须释放')
    assert.equal(gate.snapshot().queued, 0)
  } finally {
    resetModelRuntime()
  }
})

test('health A1：gate/budget 快照归一化（含最近拒绝原因）', () => {
  const gate = summarizeModelGate({
    active: 1,
    queued: 2,
    maxConcurrent: 2,
    maxQueue: 4,
    queueTimeoutMs: 100,
    rejected: { queueFull: 1, timeout: 2 },
    lastReject: { reason: 'queue-timeout', at: 123, message: '排队超时', role: 'mood' },
  })
  assert.deepEqual(gate, {
    active: 1,
    queued: 2,
    maxConcurrent: 2,
    maxQueue: 4,
    queueTimeoutMs: 100,
    rejected: { queueFull: 1, timeout: 2 },
    lastReject: { reason: 'queue-timeout', at: 123, message: '排队超时', role: 'mood' },
  })
  assert.deepEqual(summarizeModelGate(null), {
    active: 0,
    queued: 0,
    maxConcurrent: 0,
    maxQueue: 0,
    queueTimeoutMs: 0,
    rejected: { queueFull: 0, timeout: 0 },
    lastReject: null,
  })

  const budget = summarizeModelBudget({
    day: '2026-11-18',
    total: 2,
    totalLimit: 0,
    counts: { mood: 2 },
    limits: { mood: 0 },
    lastReject: { reason: 'budget', scope: 'role', role: 'mood', at: 456, message: '预算用完' },
    pendingWrite: true,
    flushIntervalMs: 1000,
  })
  assert.deepEqual(budget, {
    day: '2026-11-18',
    total: 2,
    totalLimit: 0,
    counts: { mood: 2 },
    limits: { mood: 0 },
    lastReject: { reason: 'budget', scope: 'role', role: 'mood', at: 456, message: '预算用完' },
    pendingWrite: true,
    flushIntervalMs: 1000,
  })
  assert.deepEqual(summarizeModelBudget(undefined), {
    day: '',
    total: 0,
    totalLimit: 0,
    counts: {},
    limits: {},
    lastReject: null,
    pendingWrite: false,
    flushIntervalMs: 0,
  })
})

// ---------------------------------------------------------------------------
// Gate A2：Task 监管骨架（租约/超时/取消/幂等/并发/状态机）
// ---------------------------------------------------------------------------

test('task-supervisor A2：状态机主路径与非法迁移', () => {
  const clock = 1000
  const events = []
  const sup = createTaskSupervisor({
    now: () => clock,
    leaseMs: 1000,
    maxRunning: 2,
    onEvent: (event) => events.push(event.type),
  })
  const submitted = sup.submit({ kind: 'chat', owner: 'hub', meta: { turn: 1 } })
  assert.equal(submitted.ok, true)
  assert.equal(submitted.duplicate, false)
  assert.equal(submitted.task.state, 'running', '有空槽时 submit 直接开跑')
  assert.equal(submitted.task.attempts, 1)
  assert.equal(submitted.task.owner, 'hub')
  assert.equal(submitted.task.leaseExpiresAt, clock + 1000)
  assert.deepEqual(submitted.task.meta, { turn: 1 })
  const id = submitted.task.id

  assert.equal(sup.wait(id).task.state, 'waiting')
  assert.equal(sup.resume(id).task.state, 'running')
  assert.equal(sup.block(id).task.state, 'blocked')
  assert.equal(sup.get(id).leaseExpiresAt, null, 'blocked 不持有租约')
  assert.equal(sup.block(id).code, TASK_ERROR_CODES.invalidTransition, 'blocked→blocked 非法')
  assert.equal(sup.resume(id).task.state, 'running')
  const done = sup.complete(id, { text: 'ok' })
  assert.equal(done.task.state, 'done')
  assert.deepEqual(sup.get(id).result, { text: 'ok' })
  assert.ok(sup.get(id).finishedAt !== null)

  // 终态不可再迁移 / 未知状态 / 不存在
  const again = sup.transition(id, 'running')
  assert.equal(again.ok, false)
  assert.equal(again.code, TASK_ERROR_CODES.invalidTransition)
  assert.equal(sup.transition('missing', 'running').code, TASK_ERROR_CODES.notFound)
  assert.equal(sup.transition(id, 'bogus').code, TASK_ERROR_CODES.invalidArgument)

  // queued 不能直接 waiting；done 的迁移表为空
  const sup2 = createTaskSupervisor({ now: () => clock, maxRunning: 1 })
  sup2.submit({})
  const queued = sup2.submit({}).task
  assert.equal(queued.state, 'queued')
  assert.equal(sup2.transition(queued.id, 'waiting').code, TASK_ERROR_CODES.invalidTransition)
  assert.equal(canTransition('queued', 'running'), true)
  assert.equal(canTransition('done', 'running'), false)
  assert.deepEqual(TASK_ALLOWED_TRANSITIONS.done, [])

  for (const type of ['task/queued', 'task/started', 'task/waiting', 'task/blocked', 'task/resumed', 'task/done']) {
    assert.ok(events.includes(type), `应上报 ${type}`)
  }
})

test('task-supervisor A2：并发上限、补位与槽位释放', () => {
  const sup = createTaskSupervisor({ now: () => 1, leaseMs: 10_000, maxRunning: 2 })
  const a = sup.submit({ key: 'a' }).task
  const b = sup.submit({ key: 'b' }).task
  const c = sup.submit({ key: 'c' }).task
  assert.equal(a.state, 'running')
  assert.equal(b.state, 'running')
  assert.equal(c.state, 'queued', '超过 maxRunning 必须排队')
  assert.deepEqual(sup.snapshot().byState, {
    queued: 1,
    running: 2,
    waiting: 0,
    blocked: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  })
  assert.equal(sup.snapshot().slotsUsed, 2)
  assert.equal(sup.snapshot().maxRunning, 2)

  sup.complete(a.id)
  assert.equal(sup.get(c.id).state, 'running', '完成一个补一个')

  const d = sup.submit({ key: 'd' }).task
  assert.equal(d.state, 'queued', '两个槽位都被占用')
  sup.block(b.id)
  assert.equal(sup.get(d.id).state, 'running', 'blocked 释放槽位后队列补位')
  const noCapacity = sup.resume(b.id)
  assert.equal(noCapacity.code, TASK_ERROR_CODES.noCapacity, '无空槽时恢复被明确拒绝')

  sup.complete(c.id)
  assert.equal(sup.resume(b.id).task.state, 'running', '有槽位后可恢复')
  assert.equal(sup.snapshot().slotsUsed, 2)
})

test('task-supervisor A2：租约过期自动 failed + 取消信号 + 心跳续租', () => {
  let clock = 0
  const events = []
  const sup = createTaskSupervisor({
    now: () => clock,
    leaseMs: 100,
    maxRunning: 1,
    onEvent: (event) => events.push(event.type),
  })
  const task = sup.submit({ key: 'long', owner: 'hub' }).task
  const signal = sup.signalFor(task.id)
  let cancelSignals = 0
  signal.onCancel(() => {
    cancelSignals += 1
  })
  assert.equal(signal.cancelled, false)

  clock = 50
  assert.equal(sup.renew(task.id, { owner: 'hub' }).ok, true)
  assert.equal(sup.get(task.id).leaseExpiresAt, 150, '续租从当前时间重新计时')
  clock = 120
  assert.equal(sup.tick().expired, 0, '续租后不超时')
  assert.equal(sup.get(task.id).state, 'running')

  clock = 151
  const swept = sup.tick()
  assert.equal(swept.expired, 1)
  assert.equal(swept.tasks[0].state, 'failed')
  assert.equal(swept.tasks[0].error.code, TASK_ERROR_CODES.leaseExpired)
  assert.equal(cancelSignals, 1, '租约过期触发取消信号')
  assert.equal(sup.get(task.id).leaseExpiresAt, null)
  assert.equal(sup.snapshot().slotsUsed, 0, '过期后释放槽位')
  assert.ok(events.includes('task/lease-expired'))

  // 心跳时才发现已过期 → 明确 leaseExpired 错误，任务置 failed
  clock = 1000
  const second = sup.submit({ key: 'expire-on-renew', owner: 'a' }).task
  clock = 1101
  const late = sup.renew(second.id, { owner: 'a' })
  assert.equal(late.code, TASK_ERROR_CODES.leaseExpired)
  assert.equal(sup.get(second.id).state, 'failed')

  // owner 不匹配
  const third = sup.submit({ key: 'owner', owner: 'a' }).task
  const mismatch = sup.renew(third.id, { owner: 'b' })
  assert.equal(mismatch.code, TASK_ERROR_CODES.ownerMismatch)
  assert.equal(sup.get(third.id).state, 'running')

  // 终态不可续租
  sup.complete(third.id)
  assert.equal(sup.renew(third.id).code, TASK_ERROR_CODES.terminal)
})

test('task-supervisor A2：取消（running/queued）与取消信号', () => {
  const sup = createTaskSupervisor({ now: () => 1, leaseMs: 10_000, maxRunning: 1 })
  const running = sup.submit({ key: 'cancel-me' }).task
  const signal = sup.signalFor(running.id)
  const reasons = []
  const off = signal.onCancel((payload) => reasons.push(payload.reason))
  assert.equal(typeof off, 'function')
  const cancelled = sup.cancel(running.id, { reason: '用户取消' })
  assert.equal(cancelled.ok, true)
  assert.equal(cancelled.task.state, 'cancelled')
  assert.equal(cancelled.task.error.code, 'TASK_CANCELLED')
  assert.equal(reasons.length, 1)
  assert.equal(reasons[0], '用户取消')
  assert.equal(signal.cancelled, true)
  assert.equal(sup.get(running.id).leaseExpiresAt, null)
  assert.equal(sup.snapshot().slotsUsed, 0)

  const again = sup.cancel(running.id)
  assert.equal(again.ok, true)
  assert.equal(again.already, true, '重复取消幂等')
  assert.equal(sup.complete(running.id).code, TASK_ERROR_CODES.invalidTransition, '取消后不能完成')

  // queued 任务可取消，且不占用槽位
  const holder = sup.submit({ key: 'holder' }).task
  const queued = sup.submit({ key: 'queued-cancel' }).task
  assert.equal(queued.state, 'queued')
  const queuedCancelled = sup.cancel(queued.id)
  assert.equal(queuedCancelled.ok, true)
  assert.equal(sup.get(queued.id).state, 'cancelled')
  assert.equal(sup.get(holder.id).state, 'running')
  assert.equal(sup.snapshot().byState.cancelled, 2)

  // 取消 done 任务 → 终态错误
  sup.complete(holder.id)
  assert.equal(sup.cancel(holder.id).code, TASK_ERROR_CODES.terminal)
})

test('task-supervisor A2：幂等键去重（并发/终态/显式重试）', () => {
  const sup = createTaskSupervisor({ now: () => 1, leaseMs: 10_000, maxRunning: 1 })
  const first = sup.submit({ key: 'daily-report', kind: 'report' })
  assert.equal(first.ok, true)
  assert.equal(first.task.state, 'running')

  const duplicate = sup.submit({ key: 'daily-report', kind: 'report' })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.terminal, false)
  assert.equal(duplicate.task.id, first.task.id, '同 key 不会并发执行')
  assert.equal(sup.list().length, 1)

  sup.complete(first.task.id)
  const terminalDuplicate = sup.submit({ key: 'daily-report' })
  assert.equal(terminalDuplicate.duplicate, true)
  assert.equal(terminalDuplicate.terminal, true)
  assert.equal(sup.list().length, 1)

  const retried = sup.submit({ key: 'daily-report', retry: true })
  assert.equal(retried.duplicate, false)
  assert.notEqual(retried.task.id, first.task.id)
  assert.equal(retried.task.attempts, 2, '重试延续 attempts')
  assert.equal(sup.list({ key: 'daily-report' }).length, 2)

  // 无 key 不去重
  const a = sup.submit({})
  const b = sup.submit({})
  assert.notEqual(a.task.id, b.task.id)
})

test('task-supervisor A2：事件回调异常不影响监管，非法迁移有事件', () => {
  const rejected = []
  const sup = createTaskSupervisor({
    now: () => 1,
    maxRunning: 1,
    onEvent: (event) => {
      if (event.type === 'task/transition-rejected') rejected.push(event.detail)
      throw new Error('观测回调故障')
    },
  })
  const task = sup.submit({ key: 'evt' })
  assert.equal(task.ok, true, 'onEvent 抛错不能影响 submit')
  assert.equal(task.task.state, 'running')
  const illegal = sup.transition(task.task.id, 'queued')
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, TASK_ERROR_CODES.invalidTransition)
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason, 'illegal-transition')
  const invalid = sup.transition(task.task.id, 'nope')
  assert.equal(invalid.code, TASK_ERROR_CODES.invalidArgument)
  assert.equal(rejected.length, 2)
})

// ---------------------------------------------------------------------------
// Gate A3：Activity manifest 契约与权限校验（默认拒绝）
// ---------------------------------------------------------------------------

function validManifest(overrides) {
  return {
    id: 'reading',
    version: '1.0.0',
    name: '读书',
    events: ['reading.started', 'reading.highlight', 'reading.finished'],
    tasks: [{ kind: 'reading.read', goal: '读一章并留下笔记', priority: 30, success: '章节完成 + 笔记' }],
    tools: ['book.open', 'book.page', 'book.highlight', 'book.note'],
    permissions: ['fs.read:~/Books', 'model', 'tool:book.open'],
    resources: { model: true, foreground: false, maxMinutes: 60 },
    ...(overrides ?? {}),
  }
}

test('activity-manifest A3：合法 manifest 通过并归一化默认值', () => {
  const result = validateActivityManifest(validManifest())
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  const manifest = result.manifest
  assert.equal(manifest.id, 'reading')
  assert.equal(manifest.version, '1.0.0')
  assert.equal(manifest.name, '读书')
  assert.equal(manifest.schemaVersion, 1)
  assert.deepEqual(manifest.events, ['reading.started', 'reading.highlight', 'reading.finished'])
  assert.deepEqual(manifest.tasks, [
    { kind: 'reading.read', goal: '读一章并留下笔记', priority: 30, success: '章节完成 + 笔记' },
  ])
  assert.deepEqual(manifest.permissions, [
    { permission: 'fs.read', scope: '~/Books', raw: 'fs.read:~/Books' },
    { permission: 'model', scope: null, raw: 'model' },
    { permission: 'tool', scope: 'book.open', raw: 'tool:book.open' },
  ])
  assert.deepEqual(manifest.resources, { model: true, foreground: false, maxMinutes: 60 })
  assert.equal(manifest.world, null)

  // 默认值：resources 省略字段、name 省略、world 省略
  const minimal = validateActivityManifest({
    id: 'mood',
    version: '0.1.0',
    events: ['mood.changed'],
    tasks: [{ kind: 'mood.refresh', goal: '刷新心情' }],
    tools: ['mood.refresh'],
    permissions: [],
    resources: {},
  })
  assert.equal(minimal.ok, true)
  assert.equal(minimal.manifest.name, 'mood')
  assert.deepEqual(minimal.manifest.resources, { model: false, foreground: false, maxMinutes: 60 })
  assert.deepEqual(minimal.manifest.permissions, [], '无权限 = 默认拒绝')

  // world 可选字段
  const withWorld = validateActivityManifest(
    validManifest({ world: { entry: './world.mjs', isolate: 'process', health: 'reading.health' } }),
  )
  assert.equal(withWorld.ok, true)
  assert.deepEqual(withWorld.manifest.world, { entry: './world.mjs', isolate: 'process', health: 'reading.health' })
})

test('activity-manifest A3：缺字段与类型错误被拒绝（一次收集全部）', () => {
  const empty = validateActivityManifest({})
  assert.equal(empty.ok, false)
  assert.equal(empty.manifest, null)
  const missingFields = empty.errors.filter((item) => item.code === ACTIVITY_MANIFEST_ERROR_CODES.missingField)
  assert.deepEqual(
    missingFields.map((item) => item.path),
    ['id', 'version', 'events', 'tasks', 'tools', 'permissions', 'resources'],
  )

  assert.equal(validateActivityManifest(null).errors[0].code, ACTIVITY_MANIFEST_ERROR_CODES.invalidType)
  const wrongTypes = validateActivityManifest({
    id: 'reading',
    version: '1.0.0',
    events: 'reading.started',
    tasks: {},
    tools: 'book.open',
    permissions: 'fs.read',
    resources: [],
  })
  assert.equal(wrongTypes.ok, false)
  const paths = wrongTypes.errors.map((item) => item.path)
  for (const path of ['events', 'tasks', 'tools', 'permissions', 'resources']) {
    assert.ok(paths.includes(path), `应报告 ${path} 类型错误`)
  }
})

test('activity-manifest A3：id/version/events/tools/tasks 校验与数量上限', () => {
  const badId = validateActivityManifest(validManifest({ id: 'Reading' }))
  assert.equal(badId.ok, false)
  assert.equal(badId.errors[0].path, 'id')
  assert.equal(validateActivityManifest(validManifest({ version: 'v1' })).errors[0].path, 'version')
  assert.equal(validateActivityManifest(validManifest({ name: '' })).errors[0].path, 'name')

  const badEvent = validateActivityManifest(validManifest({ events: ['reading.started', 'noDot', 'reading.started'] }))
  assert.equal(badEvent.ok, false)
  const eventErrors = badEvent.errors.map((item) => item.code)
  assert.ok(eventErrors.includes(ACTIVITY_MANIFEST_ERROR_CODES.invalidValue))
  assert.ok(eventErrors.includes(ACTIVITY_MANIFEST_ERROR_CODES.duplicateEntry))

  const badTool = validateActivityManifest(validManifest({ tools: ['Book.Open'] }))
  assert.equal(badTool.ok, false)
  assert.equal(badTool.errors[0].path, 'tools[0]')

  const badTask = validateActivityManifest(
    validManifest({
      tasks: [
        { kind: 'reading.read', goal: '' },
        { kind: 'reading.read', goal: '重复 kind' },
      ],
    }),
  )
  assert.equal(badTask.ok, false)
  const taskPaths = badTask.errors.map((item) => item.path)
  assert.ok(taskPaths.includes('tasks[0].goal'))
  assert.ok(taskPaths.includes('tasks[1].kind'))

  const tooMany = validateActivityManifest(
    validManifest({ events: Array.from({ length: 65 }, (_, index) => `reading.e${index}`) }),
  )
  assert.equal(tooMany.ok, false)
  assert.ok(tooMany.errors.some((item) => item.code === ACTIVITY_MANIFEST_ERROR_CODES.tooManyEntries))
})

test('activity-manifest A3：越权/非法权限被拒绝，合法 scope 被归一化', () => {
  assert.deepEqual(ACTIVITY_PERMISSIONS, ['fs.read', 'fs.write', 'net', 'model', 'tool'])
  assert.equal(isActivityPermission('fs.read:~/Books'), true)
  assert.equal(isActivityPermission('fs.read:'), false)
  assert.equal(isActivityPermission('fs.delete'), false)
  assert.equal(isActivityPermission('root'), false)
  assert.equal(isActivityPermission(42), false)

  const unknown = validateActivityManifest(validManifest({ permissions: ['fs.read:~/Books', 'fs.delete', 'root'] }))
  assert.equal(unknown.ok, false)
  const codes = unknown.errors.map((item) => item.code)
  assert.ok(codes.includes(ACTIVITY_MANIFEST_ERROR_CODES.unknownPermission))
  assert.ok(unknown.errors.some((item) => item.path === 'permissions[1]'))
  assert.ok(unknown.errors.some((item) => item.path === 'permissions[2]'))

  const emptyScope = validateActivityManifest(validManifest({ permissions: ['fs.write:'] }))
  assert.equal(emptyScope.ok, false)
  assert.equal(emptyScope.errors[0].code, ACTIVITY_MANIFEST_ERROR_CODES.invalidPermission)

  const control = validateActivityManifest(validManifest({ permissions: ['fs.read:~/Bad\u0007Path'] }))
  assert.equal(control.ok, false)
  assert.equal(control.errors[0].code, ACTIVITY_MANIFEST_ERROR_CODES.invalidPermission)

  const duplicate = validateActivityManifest(validManifest({ permissions: ['model', 'model'] }))
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.errors[0].code, ACTIVITY_MANIFEST_ERROR_CODES.duplicateEntry)

  const parsed = parseActivityPermission('  fs.write:~/Notes/  ')
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.permission, { permission: 'fs.write', scope: '~/Notes/', raw: 'fs.write:~/Notes/' })
})

test('activity-manifest A3：checkActivityPermission 默认拒绝 + scope 匹配', () => {
  // 默认拒绝：无 manifest / 空权限 / 未声明权限 / 非法请求
  assert.deepEqual(checkActivityPermission(null, 'fs.read'), {
    allowed: false,
    reason: PERMISSION_REASONS.noManifest,
    permission: 'fs.read',
    scope: null,
  })
  const empty = validateActivityManifest(validManifest({ permissions: [] })).manifest
  assert.equal(checkActivityPermission(empty, 'model').reason, PERMISSION_REASONS.notGranted)
  assert.equal(checkActivityPermission(validManifest(), 'nope').reason, PERMISSION_REASONS.invalidPermission)
  assert.equal(checkActivityPermission(validManifest(), 'fs.write').reason, PERMISSION_REASONS.notGranted)

  const manifest = validateActivityManifest(validManifest()).manifest
  // fs.* 路径前缀
  assert.equal(checkActivityPermission(manifest, 'fs.read:~/Books').allowed, true)
  assert.equal(checkActivityPermission(manifest, 'fs.read:~/Books/a.md').allowed, true)
  assert.equal(checkActivityPermission(manifest, 'fs.read:~/Books/2026/b.md').allowed, true)
  assert.equal(checkActivityPermission(manifest, 'fs.read:~/Other').allowed, false)
  assert.equal(checkActivityPermission(manifest, 'fs.read:~/Bookshelf').allowed, false, '前缀必须按路径边界')
  assert.equal(checkActivityPermission(manifest, 'fs.read').reason, PERMISSION_REASONS.scopeRequired)
  assert.equal(checkActivityPermission(manifest, 'fs.write:~/Books/a.md').allowed, false)

  // 非 fs 权限：未带 scope 的授权覆盖整个权限；带 scope 要求精确
  assert.equal(checkActivityPermission(manifest, 'model').allowed, true)
  assert.equal(checkActivityPermission(manifest, 'tool:book.open').allowed, true)
  assert.equal(checkActivityPermission(manifest, 'tool:book.page').allowed, false)
  assert.equal(checkActivityPermission(manifest, 'tool:book.open').reason, PERMISSION_REASONS.granted)

  // 原始（未校验）manifest 也可判定；非法条目按未授权
  const raw = { permissions: ['model', 'fs.read:~/Books', 'bogus', 42] }
  assert.equal(checkActivityPermission(raw, 'model').allowed, true)
  assert.equal(checkActivityPermission(raw, 'fs.read:~/Books/x').allowed, true)
  assert.equal(checkActivityPermission(raw, 'net').allowed, false)

  // UI/文档摘要
  assert.deepEqual(
    listActivityPermissions(manifest).map((item) => item.raw),
    ['fs.read:~/Books', 'model', 'tool:book.open'],
  )
  const described = describeActivityPermissions(manifest)
  assert.equal(described[0].label, '读取本机文件')
  assert.equal(described[1].label, '调用模型')
})

test('activity-manifest A3：resources/world 校验与未知字段容忍', () => {
  const badResources = validateActivityManifest(
    validManifest({ resources: { model: 'yes', foreground: 1, maxMinutes: 0 } }),
  )
  assert.equal(badResources.ok, false)
  const paths = badResources.errors.map((item) => item.path)
  assert.ok(paths.includes('resources.model'))
  assert.ok(paths.includes('resources.foreground'))
  assert.ok(paths.includes('resources.maxMinutes'))

  const tooLong = validateActivityManifest(validManifest({ resources: { maxMinutes: 24 * 60 + 1 } }))
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.errors[0].path, 'resources.maxMinutes')

  const badWorld = validateActivityManifest(validManifest({ world: { isolate: 'vm' } }))
  assert.equal(badWorld.ok, false)
  assert.equal(badWorld.errors[0].path, 'world.isolate')

  // 未知顶层字段容忍（向前兼容），不影响校验结果
  const forward = validateActivityManifest(validManifest({ futureField: { a: 1 } }))
  assert.equal(forward.ok, true)
  assert.equal(forward.manifest.futureField, undefined)
})

// ---------------------------------------------------------------------------
// Gate A4：状态备份 / 恢复演练 / 迁移方案（scripts/state-backup.mjs 等）
// ---------------------------------------------------------------------------

const STATE_TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function createStateFixture() {
  const home = tmpDir('state-home')
  const stateDir = path.join(home, '.dsh-poetry')
  const memoryDir = path.join(home, 'agent-memory')
  mkdirSync(path.join(stateDir, 'nested'), { recursive: true })
  mkdirSync(path.join(memoryDir, 'backups', 'old'), { recursive: true })
  mkdirSync(path.join(memoryDir, 'works'), { recursive: true })
  writeFileSync(path.join(stateDir, 'settings.json'), JSON.stringify({ scale: 1 }))
  writeFileSync(path.join(stateDir, 'nested', 'state.json'), '{"v":1}')
  writeFileSync(path.join(memoryDir, 'journal.jsonl'), '{"kind":"thought"}\n')
  writeFileSync(path.join(memoryDir, 'works', 'note.md'), '作品')
  // 不应被备份：嵌套备份 / 临时文件
  writeFileSync(path.join(memoryDir, 'backups', 'old', 'manifest.json'), '{"kind":"old"}')
  writeFileSync(path.join(memoryDir, 'pending.tmp'), 'tmp')
  return { home, stateDir, memoryDir }
}

function listFilesRecursive(root) {
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

test('state-backup A4：manifest 记录大小/哈希，排除嵌套备份与临时文件', () => {
  const { home } = createStateFixture()
  const report = createStateBackup({ home, keep: 3, now: 1_700_000_000_000 })
  assert.equal(report.ok, true)
  assert.equal(report.dryRun, false)
  assert.equal(report.id, formatBackupStamp(1_700_000_000_000))
  assert.equal(report.totals.files, 4)
  assert.ok(report.totals.bytes > 0)

  const manifestPath = path.join(report.dir, 'manifest.json')
  assert.ok(existsSync(manifestPath), '应写入 manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.kind, STATE_BACKUP_KIND)
  assert.equal(manifest.v, 1)
  assert.equal(manifest.totals.files, 4)
  assert.deepEqual(manifest.files.map((item) => item.path).sort(), [
    'agent-memory/journal.jsonl',
    'agent-memory/works/note.md',
    'dsh-poetry/nested/state.json',
    'dsh-poetry/settings.json',
  ])
  for (const item of manifest.files) {
    const full = path.join(report.dir, ...item.path.split('/'))
    const buffer = readFileSync(full)
    assert.equal(item.size, buffer.length)
    assert.equal(item.sha256, sha256Hex(buffer), `${item.path} 哈希应一致`)
  }
  const skippedReasons = report.skipped.map((item) => item.reason)
  assert.ok(skippedReasons.includes('excluded-dir'), '嵌套 backups 应跳过')
  assert.ok(skippedReasons.includes('temp-file'), '.tmp 应跳过')
  assert.deepEqual(
    listStateBackups(report.outDir).map((item) => item.id),
    [report.id],
  )
  rmSync(home, { recursive: true, force: true })
})

test('state-backup A4：dry-run 不写盘；保留策略只清理自己的备份', () => {
  const { home } = createStateFixture()
  const dry = createStateBackup({ home, keep: 2, dryRun: true, now: 1_700_000_000_000 })
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.totals.files, 4)
  assert.equal(existsSync(dry.outDir), false, 'dry-run 不应创建备份目录')

  const first = createStateBackup({ home, keep: 2, now: 1_700_000_000_000 })
  const second = createStateBackup({ home, keep: 2, now: 1_700_000_010_000 })
  const third = createStateBackup({ home, keep: 2, now: 1_700_000_020_000 })
  assert.deepEqual(third.kept, [third.id, second.id])
  assert.deepEqual(third.pruned, [first.id])
  assert.equal(existsSync(first.dir), false, '超出保留份数的旧备份被清理')
  assert.equal(existsSync(second.dir), true)
  assert.equal(existsSync(third.dir), true)

  // 外来目录（没有本脚本 manifest）不会被清理
  const foreign = path.join(third.outDir, 'manual-backup')
  mkdirSync(foreign, { recursive: true })
  writeFileSync(path.join(foreign, 'keep.txt'), 'do not delete')
  createStateBackup({ home, keep: 1, now: 1_700_000_030_000 })
  assert.equal(existsSync(foreign), true, '非本脚本生成的目录必须保留')
  assert.equal(readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'do not delete')

  // --no-prune 不清理
  const noPrune = createStateBackup({ home, keep: 1, prune: false, now: 1_700_000_040_000 })
  assert.ok(noPrune.pruned.length >= 1)
  assert.equal(existsSync(noPrune.dir), true)
  rmSync(home, { recursive: true, force: true })
})

test('state-restore-check A4：备份→临时恢复→校验通过，live 数据不变', () => {
  const { home, stateDir } = createStateFixture()
  const backup = createStateBackup({ home, keep: 3, now: 1_700_000_000_000 })
  assert.equal(backup.ok, true)
  const liveBefore = listFilesRecursive(stateDir).map((file) => [
    path.relative(home, file),
    sha256Hex(readFileSync(file)),
  ])

  const verified = verifyStateBackup(backup.dir)
  assert.equal(verified.ok, true)
  assert.equal(verified.totals.files, 4)
  assert.ok(verified.files.every((item) => item.ok))

  const drill = restoreStateBackup({ backupDir: backup.dir, home })
  assert.equal(drill.ok, true, JSON.stringify(drill.errors))
  assert.equal(drill.restored.files, 4)
  assert.equal(drill.restored.bytes, verified.totals.bytes)
  assert.equal(drill.keptTemp, false)
  assert.equal(existsSync(drill.tempDir), false, '默认演练后删除临时目录')
  assert.ok(drill.tempDir.startsWith(os.tmpdir()), '演练目录必须在系统临时目录下')

  const liveAfter = listFilesRecursive(stateDir).map((file) => [
    path.relative(home, file),
    sha256Hex(readFileSync(file)),
  ])
  assert.deepEqual(liveAfter, liveBefore, '演练不得改动 live 数据')

  const kept = restoreStateBackup({ backupDir: backup.dir, home, keepTemp: true })
  assert.equal(kept.ok, true)
  assert.equal(existsSync(kept.tempDir), true)
  assert.ok(existsSync(path.join(kept.tempDir, 'dsh-poetry', 'settings.json')))
  assert.ok(existsSync(path.join(kept.tempDir, 'restore-check-report.json')))
  rmSync(kept.tempDir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test('state-restore-check A4：坏文件/路径穿越/错 kind 被拒绝', () => {
  const { home } = createStateFixture()
  const backup = createStateBackup({ home, keep: 3, now: 1_700_000_000_000 })
  // 篡改备份文件（保持长度，只改内容）→ 哈希不一致
  const target = path.join(backup.dir, 'dsh-poetry', 'settings.json')
  const original = readFileSync(target)
  writeFileSync(target, Buffer.from('x'.repeat(original.length)))
  const corrupted = verifyStateBackup(backup.dir)
  assert.equal(corrupted.ok, false)
  assert.ok(corrupted.files.some((item) => item.error === '哈希不一致'))
  const drill = restoreStateBackup({ backupDir: backup.dir, home })
  assert.equal(drill.ok, false, '校验失败不得继续恢复')

  // 路径穿越 manifest → 结构校验拒绝
  const evilDir = path.join(backup.outDir, 'evil')
  mkdirSync(evilDir, { recursive: true })
  writeFileSync(
    path.join(evilDir, 'manifest.json'),
    JSON.stringify({
      ok: true,
      v: 1,
      kind: STATE_BACKUP_KIND,
      id: 'evil',
      createdAt: 1,
      files: [{ path: '../escape.json', source: 'x', size: 1, sha256: 'a'.repeat(64) }],
      totals: { files: 1, bytes: 1 },
    }),
  )
  const evil = verifyStateBackup(evilDir)
  assert.equal(evil.ok, false)
  assert.ok(evil.errors.some((error) => error.includes('安全的相对路径')))

  // kind 不对 → 拒绝
  const wrongKind = path.join(backup.outDir, 'wrong-kind')
  mkdirSync(wrongKind, { recursive: true })
  writeFileSync(path.join(wrongKind, 'manifest.json'), JSON.stringify({ ok: true, v: 1, kind: 'other', files: [] }))
  assert.equal(verifyStateBackup(wrongKind).ok, false)
  rmSync(home, { recursive: true, force: true })
})

test('state-restore-check A4：拒绝在 live 目录内演练；无备份时 latest 为空', () => {
  const { home } = createStateFixture()
  const inside = resolveRestoreWorkRoot({ home, workdir: path.join(home, 'tmp-drill') })
  assert.equal(inside.ok, false)
  assert.match(inside.errors[0], /live 数据目录内/)
  const outside = resolveRestoreWorkRoot({ home, workdir: os.tmpdir() })
  assert.equal(outside.ok, true)
  assert.equal(resolveStateHome({ env: {}, home }), home)

  const emptyHome = tmpDir('state-empty')
  assert.equal(findLatestStateBackup(path.join(emptyHome, 'state-backups')), null)
  const backup = createStateBackup({ home, keep: 2, now: 1_700_000_000_000 })
  const latest = findLatestStateBackup(backup.outDir)
  assert.equal(latest.id, backup.id)
  rmSync(home, { recursive: true, force: true })
  rmSync(emptyHome, { recursive: true, force: true })
})

test('state-backup A4：CLI 可 dry-run / JSON 输出（不触碰真实 home）', () => {
  const { home } = createStateFixture()
  const dry = execFileSync(
    process.execPath,
    [path.join(STATE_TEST_ROOT, 'scripts', 'state-backup.mjs'), '--home', home, '--dry-run', '--json'],
    { encoding: 'utf8' },
  )
  const dryReport = JSON.parse(dry)
  assert.equal(dryReport.ok, true)
  assert.equal(dryReport.dryRun, true)
  assert.equal(dryReport.totals.files, 4)

  const real = createStateBackup({ home, keep: 2, now: 1_700_000_000_000 })
  const check = execFileSync(
    process.execPath,
    [
      path.join(STATE_TEST_ROOT, 'scripts', 'state-restore-check.mjs'),
      '--backup',
      real.dir,
      '--home',
      home,
      '--no-copy',
      '--json',
    ],
    { encoding: 'utf8' },
  )
  const checkReport = JSON.parse(check)
  assert.equal(checkReport.ok, true)
  assert.equal(checkReport.copy, false)
  assert.equal(checkReport.restored.files, 4)
  assert.equal(formatBackupStamp(0).length, 15)
  rmSync(home, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate A5：健康指标/告警（lib/composition/health.mjs）与日志轮转（scripts/log-rotate.mjs）
// ---------------------------------------------------------------------------

function snapshotOf(value = {}) {
  return { snapshot: () => value }
}

function makeHealthDeps(overrides = {}) {
  const dir = tmpDir('health-deps')
  return {
    growth: snapshotOf(),
    selfDrive: snapshotOf(),
    selfWander: snapshotOf(),
    selfReading: snapshotOf(),
    selfNetlang: snapshotOf(),
    memoryConsolidator: snapshotOf(),
    serviceRuntime: snapshotOf({ services: [] }),
    modelBudget: snapshotOf({
      day: '2026-11-18',
      total: 9,
      totalLimit: 10,
      counts: { mood: 9 },
      limits: { mood: 0 },
      lastReject: null,
      pendingWrite: false,
      flushIntervalMs: 1000,
    }),
    modelGate: snapshotOf({
      active: 2,
      queued: 20,
      maxConcurrent: 2,
      maxQueue: 24,
      queueTimeoutMs: 30_000,
      rejected: { queueFull: 1, timeout: 0 },
      lastReject: { reason: 'queue-full', at: 1, message: '排队已满', role: 'mood' },
    }),
    heartbeat: snapshotOf({ jobs: [] }),
    webAccess: snapshotOf(),
    summarizeModelErrors: () => ({ since: 0, total: 25, byRole: { mood: 25 }, byCode: { TIMEOUT: 25 }, lastAt: 1 }),
    modelErrorsPath: path.join(dir, 'model-errors.jsonl'),
    growthMetrics: snapshotOf(),
    selfWorks: snapshotOf(),
    mediaBudget: snapshotOf(),
    outbox: snapshotOf(),
    attention: { mode: () => 'observe', pending: () => [] },
    promptLayersVersion: 1,
    selfEvents: snapshotOf(),
    selfMetabolism: snapshotOf(),
    worldFeedback: { recent: () => [] },
    selfLifecycle: snapshotOf(),
    twinEnabled: false,
    webBench: snapshotOf(),
    agentLoop: snapshotOf(),
    knowledgeGraph: snapshotOf(),
    selfTrainer: snapshotOf(),
    relationship: snapshotOf(),
    emotional: snapshotOf(),
    dailyLife: snapshotOf(),
    migrationSummary: null,
    commitments: snapshotOf(),
    guiPush: snapshotOf(),
    localVoice: snapshotOf(),
    worldview: snapshotOf({
      essay: { version: 1, at: 1 },
      beliefs: [],
      concepts: [],
      questions: [],
      contradictions: [],
    }),
    domainServices: {},
    taskSupervisor: snapshotOf({
      total: 3,
      active: 3,
      queued: 1,
      running: 1,
      waiting: 1,
      blocked: 0,
      slotsUsed: 2,
      maxRunning: 4,
      byState: { queued: 1, running: 1, waiting: 1, blocked: 0, done: 0, failed: 0, cancelled: 0 },
    }),
    eventBacklog: snapshotOf({ queued: 2, capacity: 10, dropped: 0, oldestQueuedAt: 1 }),
    minecraftWorld: snapshotOf({ ok: true, observationAt: Date.now(), permission: 'control', granted: true }),
    ...overrides,
  }
}

test('health A5：metrics 结构化指标（gate/tasks/events/memory/disk/modelErrors/minecraft）', () => {
  const deps = makeHealthDeps()
  const metrics = buildHealthMetrics(deps, 1_700_000_000_000)
  assert.equal(metrics.generatedAt, 1_700_000_000_000)
  assert.equal(metrics.gate.active, 2)
  assert.equal(metrics.gate.queued, 20)
  assert.equal(metrics.gate.maxConcurrent, 2)
  assert.ok(Math.abs(metrics.gate.saturation - 20 / 24) < 1e-9, '队列饱和度可观测')
  assert.equal(metrics.gate.rejected.queueFull, 1)
  assert.equal(metrics.gate.lastReject.reason, 'queue-full')
  assert.equal(metrics.budget.total, 9)
  assert.equal(metrics.budget.totalLimit, 10)
  assert.ok(Math.abs(metrics.budget.usageRatio - 0.9) < 1e-9)
  assert.equal(metrics.tasks.available, true)
  assert.equal(metrics.tasks.total, 3)
  assert.equal(metrics.tasks.queued, 1)
  assert.equal(metrics.tasks.running, 1)
  assert.equal(metrics.tasks.waiting, 1)
  assert.equal(metrics.tasks.maxRunning, 4)
  assert.equal(metrics.events.available, true)
  assert.equal(metrics.events.queued, 2)
  assert.equal(metrics.events.capacity, 10)
  assert.equal(metrics.memory.available, true)
  assert.ok(metrics.memory.rssBytes > 0)
  assert.ok(metrics.memory.heapUsedRatio >= 0)
  assert.equal(metrics.disk.available, true)
  assert.ok(metrics.disk.totalBytes > 0)
  assert.ok(metrics.disk.freeBytes > 0)
  assert.equal(metrics.modelErrors.total, 25)
  assert.equal(metrics.modelErrors.byRole.mood, 25)
  assert.equal(metrics.minecraft.available, true)
  assert.equal(metrics.minecraft.permission, 'control')
  assert.equal(metrics.minecraft.granted, true)
  assert.ok(metrics.minecraft.staleMs !== null && metrics.minecraft.staleMs >= 0)

  // 缺失可选依赖 → 占位（available:false），不影响其他指标
  const empty = buildHealthMetrics({}, 1000)
  assert.equal(empty.tasks.available, false)
  assert.equal(empty.tasks.total, 0)
  assert.equal(empty.events.available, false)
  assert.equal(empty.events.note, 'placeholder')
  assert.equal(empty.minecraft.available, false)
  assert.equal(empty.minecraft.reason, 'not-wired')
  assert.equal(empty.modelErrors.total, 0)
  assert.equal(empty.gate.active, 0)
  assert.equal(empty.disk.available, false)
  assert.equal(empty.memory.available, true)
})

test('health A5：alerts 阈值告警（可配置阈值、健康时为空）', () => {
  const metrics = buildHealthMetrics(makeHealthDeps(), 1_700_000_000_000)
  const alerts = buildHealthAlerts(metrics)
  const codes = alerts.map((item) => item.code)
  for (const code of ['gate-queue-saturated', 'gate-rejections', 'budget-near-limit', 'model-errors-spike']) {
    assert.ok(codes.includes(code), `应产生 ${code}，实际 ${codes.join(',')}`)
  }
  for (const alert of alerts) {
    assert.ok(['warn', 'critical'].includes(alert.level))
    assert.equal(typeof alert.message, 'string')
  }
  assert.equal(HEALTH_ALERT_THRESHOLDS.gateQueueRatio, 0.8)

  // 健康指标 + 自定义阈值（避免受真实磁盘/堆占用影响）→ 无告警
  const healthy = buildHealthMetrics({}, 1000)
  const noAlerts = buildHealthAlerts(healthy, { heapUsedRatio: 0.999, diskFreeRatio: 0.0001, budgetRatio: 0.999 })
  assert.deepEqual(noAlerts, [])

  // 事件积压 / 任务 blocked / minecraft stale 的告警
  const backlog = buildHealthAlerts(
    {
      ...healthy,
      events: { available: true, queued: 9, capacity: 10 },
      tasks: { available: true, blocked: 6 },
      minecraft: { available: true, staleMs: 11 * 60 * 1000 },
    },
    { heapUsedRatio: 0.999, diskFreeRatio: 0.0001 },
  )
  const backlogCodes = backlog.map((item) => item.code)
  assert.ok(backlogCodes.includes('event-backlog'))
  assert.ok(backlogCodes.includes('tasks-blocked'))
  assert.ok(backlogCodes.includes('minecraft-stale'))
})

test('health A5：buildRuntimeSnapshot 兼容旧字段并附带 metrics/alerts', () => {
  const deps = makeHealthDeps()
  const snapshot = buildRuntimeSnapshot(deps)
  // 旧字段兼容
  for (const key of [
    'growth',
    'drive',
    'wander',
    'reading',
    'netlang',
    'consolidate',
    'services',
    'domainServices',
    'budget',
    'gate',
    'heartbeat',
    'web',
    'modelErrors',
    'growthMetrics',
    'works',
    'mediaBudget',
    'outbox',
    'attention',
    'promptLayers',
    'events',
    'metabolism',
    'worldFeedback',
    'lifecycle',
    'twin',
    'webBench',
    'agentLoop',
    'knowledgeGraph',
    'selfTrainer',
    'relationship',
    'emotional',
    'dailyLife',
    'stateMigrations',
    'commitments',
    'guiPush',
    'localVoice',
    'worldview',
  ]) {
    assert.ok(Object.hasOwn(snapshot, key), `health.runtime.${key} 应保留`)
  }
  assert.equal(snapshot.gate.active, 2)
  assert.equal(snapshot.gate.maxQueue, 24)
  assert.equal(snapshot.budget.total, 9)
  assert.equal(snapshot.modelErrors.total, 25)
  // 新字段
  assert.equal(typeof snapshot.metrics, 'object')
  assert.equal(snapshot.metrics.tasks.available, true)
  assert.equal(snapshot.metrics.minecraft.available, true)
  assert.ok(Array.isArray(snapshot.alerts))
  assert.ok(snapshot.alerts.length > 0)
  assert.equal(snapshot.worldview.version, 1)
})

function createLogFixture() {
  const dir = tmpDir('whale-logs')
  writeFileSync(path.join(dir, 'whale-minecraft-bot.log'), 'x'.repeat(4096))
  writeFileSync(path.join(dir, 'whale-minecraft-server.log'), 'y'.repeat(1024))
  writeFileSync(path.join(dir, 'whale-small.log'), 'tiny')
  writeFileSync(path.join(dir, 'other-app.log'), 'z'.repeat(8192))
  writeFileSync(path.join(dir, 'whale-minecraft-bot.20260101-000000.log'), 'old-bot')
  writeFileSync(path.join(dir, 'whale-minecraft-bot.20260102-000000.log'), 'newer-bot')
  return dir
}

test('log-rotate A5：dry-run 不改文件；apply 轮转/清理且不碰其他日志', () => {
  const dir = createLogFixture()
  const before = readdirSync(dir).sort()
  const plan = planLogRotation({ dir, maxBytes: 2048, keep: 1, now: 1_780_000_000_000 })
  assert.equal(plan.ok, true)
  assert.deepEqual(
    plan.actions.rotate.map((item) => item.name),
    ['whale-minecraft-bot.log'],
  )
  assert.equal(plan.dryRun, true)
  assert.deepEqual(readdirSync(dir).sort(), before, 'dry-run 不应改目录')

  const applied = rotateLogs({ dir, maxBytes: 2048, keep: 1, now: 1_780_000_000_000, apply: true })
  assert.equal(applied.ok, true)
  assert.equal(applied.dryRun, false)
  assert.deepEqual(
    applied.applied.rotated.map((item) => item.name),
    ['whale-minecraft-bot.log'],
  )
  const rotatedName = applied.applied.rotated[0].target
  assert.equal(isRotatedLogName(rotatedName), true)
  assert.equal(statSync(path.join(dir, 'whale-minecraft-bot.log')).size, 0, 'copytruncate 后活动日志清空')
  assert.equal(readFileSync(path.join(dir, rotatedName), 'utf8').length, 4096, '轮转文件保留原内容')
  assert.equal(readFileSync(path.join(dir, 'other-app.log'), 'utf8').length, 8192, '非 whale-*.log 不动')
  assert.equal(readFileSync(path.join(dir, 'whale-small.log'), 'utf8'), 'tiny', '未超阈值不动')
  // keep=1：该 base 的旧轮转（20260101/20260102）被清理，只剩本次
  const botRotated = readdirSync(dir).filter(
    (name) => name.startsWith('whale-minecraft-bot.') && isRotatedLogName(name),
  )
  assert.deepEqual(botRotated, [rotatedName])
  rmSync(dir, { recursive: true, force: true })
})

test('log-rotate A5：restore 拼回旧内容；rename 模式重建空日志', () => {
  const dir = createLogFixture()
  const applied = rotateLogs({ dir, maxBytes: 2048, keep: 5, now: 1_780_000_000_000, apply: true })
  const rotatedName = applied.applied.rotated[0].target
  writeFileSync(path.join(dir, 'whale-minecraft-bot.log'), 'new-line\n')

  const dryRestore = restoreRotatedLog({ dir, restore: rotatedName })
  assert.equal(dryRestore.ok, true)
  assert.equal(dryRestore.dryRun, true)
  assert.equal(dryRestore.restoredBytes, 4096)
  assert.ok(existsSync(path.join(dir, rotatedName)), 'dry-run 不删轮转文件')

  const restored = restoreRotatedLog({ dir, restore: rotatedName, apply: true })
  assert.equal(restored.ok, true)
  assert.equal(restored.deleted, true)
  const content = readFileSync(path.join(dir, 'whale-minecraft-bot.log'), 'utf8')
  assert.equal(content.length, 4096 + 'new-line\n'.length, '旧内容拼在新内容之前')
  assert.ok(content.endsWith('new-line\n'))
  assert.equal(existsSync(path.join(dir, rotatedName)), false)
  assert.equal(restoreRotatedLog({ dir, restore: rotatedName, apply: true }).ok, false, '重复恢复应失败')

  // rename 模式：活动日志重建为空文件
  writeFileSync(path.join(dir, 'whale-minecraft-server.log'), 'q'.repeat(4096))
  const renamed = rotateLogs({ dir, maxBytes: 1024, keep: 3, mode: 'rename', now: 1_780_000_100_000, apply: true })
  assert.equal(renamed.ok, true)
  const serverRotated = renamed.applied.rotated.find((item) => item.name === 'whale-minecraft-server.log')
  assert.ok(serverRotated)
  assert.equal(statSync(path.join(dir, 'whale-minecraft-server.log')).size, 0)
  assert.equal(readFileSync(path.join(dir, serverRotated.target), 'utf8').length, 4096)
  rmSync(dir, { recursive: true, force: true })
})

test('log-rotate A5：参数/命名/安全（目录缺失、非法恢复名、大小解析）', () => {
  assert.equal(parseSize('10M'), 10 * 1024 * 1024)
  assert.equal(parseSize('1.5G'), Math.floor(1.5 * 1024 * 1024 * 1024))
  assert.equal(parseSize('2048'), 2048)
  assert.equal(parseSize('bogus', 123), 123)
  assert.equal(isActiveLogName('whale-bot.log'), true)
  assert.equal(isActiveLogName('whale-bot.20260101-000000.log'), false)
  assert.equal(isActiveLogName('other.log'), false)
  assert.equal(isRotatedLogName('whale-bot.20260101-000000.log'), true)
  assert.equal(isRotatedLogName('whale-bot.log'), false)

  const missing = planLogRotation({ dir: path.join(tmpDir('no-logs'), 'missing') })
  assert.equal(missing.ok, false)
  assert.match(missing.errors[0], /目录不存在/)

  const dir = createLogFixture()
  const badRestore = restoreRotatedLog({ dir, restore: '../evil.log' })
  assert.equal(badRestore.ok, false)
  assert.match(badRestore.errors[0], /不是轮转文件命名/)
  const traversal = restoreRotatedLog({ dir, restore: 'whale-bot.20260101-000000.log' })
  assert.equal(traversal.ok, false, '文件不存在应失败')
  assert.equal(formatRotateStamp(1_700_000_000_000).length, 15)
  rmSync(dir, { recursive: true, force: true })
})

test('log-rotate A5：CLI dry-run/apply/restore --json 冒烟', () => {
  const dir = createLogFixture()
  const script = path.join(STATE_TEST_ROOT, 'scripts', 'log-rotate.mjs')
  const dry = JSON.parse(
    execFileSync(process.execPath, [script, '--dir', dir, '--max-size', '2K', '--keep', '1', '--json'], {
      encoding: 'utf8',
    }),
  )
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.actions.rotate.length, 1)

  const applied = JSON.parse(
    execFileSync(process.execPath, [script, '--dir', dir, '--max-size', '2K', '--keep', '1', '--apply', '--json'], {
      encoding: 'utf8',
    }),
  )
  assert.equal(applied.ok, true)
  assert.equal(applied.dryRun, false)
  assert.equal(applied.applied.rotated.length, 1)
  const rotatedName = applied.applied.rotated[0].target

  const listed = JSON.parse(execFileSync(process.execPath, [script, '--dir', dir, '--list'], { encoding: 'utf8' }))
  assert.equal(listed.ok, true)
  assert.ok(listed.rotated.some((item) => item.name === rotatedName))

  const restoreDry = JSON.parse(
    execFileSync(process.execPath, [script, '--dir', dir, '--restore', rotatedName, '--json'], { encoding: 'utf8' }),
  )
  assert.equal(restoreDry.ok, true)
  assert.equal(restoreDry.dryRun, true)
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate A6：成本治理（lib/domain/host/cost-guard.mjs）——窗口限流/软告警/配置优先级
// ---------------------------------------------------------------------------

const SHANGHAI_DAY_START = Date.parse('2026-11-18T00:00:00+08:00')

test('cost-guard A6：默认策略不设硬上限、只有软告警阈值', () => {
  const policy = resolveCostPolicy({ env: {} })
  assert.equal(policy.enabled, true)
  assert.equal(policy.tokenLimit, 0)
  assert.deepEqual(policy.limits.total, { minute: 0, day: 0 })
  assert.deepEqual(policy.limits.roles, {})
  assert.deepEqual(policy.limits.activities, {})
  assert.deepEqual(policy.softAlerts.total, { minute: 20, day: 600 })
  assert.equal(policy.softAlerts.roles.mood.day, 100)
  assert.equal(policy.softAlerts.roles.selfTalk.day, 120)
  assert.equal(DEFAULT_COST_POLICY.enabled, true)
  assert.equal(DEFAULT_COST_POLICY.limits.total.day, 0)

  // settings.modelTokenLimit 被读入策略（0 = 不封顶）
  assert.equal(resolveCostPolicy({ env: {}, settings: { modelTokenLimit: 1200 } }).tokenLimit, 1200)
  assert.equal(resolveCostPolicy({ env: {}, settings: { modelTokenLimit: -5 } }).tokenLimit, 0)
  const described = describeCostPolicy(policy)
  assert.match(described, /成本闸门：开启/)
  assert.match(described, /软告警 分钟 20 \/ 日 600/)
})

test('cost-guard A6：分钟窗口限流（滑动窗口恢复 + retryAfterMs）', () => {
  let clock = SHANGHAI_DAY_START
  const guard = createCostGuard({
    now: () => clock,
    env: { DSH_POETRY_COST_MINUTE_TOTAL: '2' },
  })
  assert.equal(guard.acquire({ role: 'mood' }).ok, true)
  assert.equal(guard.acquire({ role: 'mood' }).ok, true)
  const rejected = guard.acquire({ role: 'mood' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, COST_REJECT_CODE)
  assert.equal(rejected.reason, 'rate-limit')
  assert.equal(rejected.scope, 'total')
  assert.equal(rejected.window, 'minute')
  assert.equal(rejected.limit, 2)
  assert.equal(rejected.used, 2)
  assert.ok(rejected.retryAfterMs > 0 && rejected.retryAfterMs <= 60_000)
  assert.match(rejected.message, /每分.*上限 2 已用完/)

  // 滑动窗口：60s 后旧时间戳出窗，恢复可用
  clock += 61_000
  assert.equal(guard.acquire({ role: 'mood' }).ok, true)
  const snapshot = guard.snapshot()
  assert.equal(snapshot.rejected.minute, 1)
  assert.equal(snapshot.rejectedByScope.total, 1)
  assert.equal(snapshot.usage.total.minute, 1)
})

test('cost-guard A6：日窗口限流与上海本地日重置', () => {
  let clock = SHANGHAI_DAY_START + 12 * 60 * 60 * 1000
  const guard = createCostGuard({
    now: () => clock,
    overrides: { limits: { roles: { mood: { day: 2 } } } },
  })
  assert.equal(guard.acquire({ role: 'mood' }).ok, true)
  assert.equal(guard.acquire({ role: 'mood' }).ok, true)
  const rejected = guard.acquire({ role: 'mood' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.scope, 'role')
  assert.equal(rejected.name, 'mood')
  assert.equal(rejected.window, 'day')
  assert.ok(rejected.retryAfterMs > 0 && rejected.retryAfterMs <= 24 * 60 * 60 * 1000)
  // 其他 role 不受影响（总量不限）
  assert.equal(guard.acquire({ role: 'selfTalk' }).ok, true)

  // 跨日重置
  clock = SHANGHAI_DAY_START + 24 * 60 * 60 * 1000 + 1000
  assert.equal(guard.snapshot().day, '2026-11-19')
  assert.equal(guard.acquire({ role: 'mood' }).ok, true)
  assert.equal(guard.snapshot().usage.roles.mood.day, 1)
})

test('cost-guard A6：role/activity 维度独立限流与观测快照', () => {
  const guard = createCostGuard({
    now: () => SHANGHAI_DAY_START,
    overrides: {
      limits: {
        roles: { mood: { minute: 1 } },
        activities: { chat: { day: 1 } },
      },
    },
  })
  assert.equal(guard.acquire({ role: 'mood', activity: 'chat' }).ok, true)
  const roleRejected = guard.acquire({ role: 'mood', activity: 'chat' })
  assert.equal(roleRejected.ok, false)
  assert.equal(roleRejected.scope, 'role')
  assert.equal(roleRejected.window, 'minute')
  // 同 activity 换 role：activity 日限流命中
  const activityRejected = guard.acquire({ role: 'selfTalk', activity: 'chat' })
  assert.equal(activityRejected.ok, false)
  assert.equal(activityRejected.scope, 'activity')
  assert.equal(activityRejected.window, 'day')
  // 其他 activity 正常
  assert.equal(guard.acquire({ role: 'selfTalk', activity: 'minecraft' }).ok, true)

  const snapshot = guard.snapshot()
  assert.equal(snapshot.usage.roles.mood.minute, 1)
  assert.equal(snapshot.usage.activities.chat.day, 1)
  assert.equal(snapshot.rejectedByScope.role, 1)
  assert.equal(snapshot.rejectedByScope.activity, 1)
  assert.equal(snapshot.tokenLimit, 0)
})

test('cost-guard A6：软告警不拒绝调用，带冷却且可从快照看到', () => {
  const alerts = []
  let clock = SHANGHAI_DAY_START
  const guard = createCostGuard({
    now: () => clock,
    overrides: {
      softAlerts: { total: { minute: 0, day: 2 } },
      alertCooldownMs: { day: 60 * 60 * 1000 },
    },
    onAlert: (alert) => alerts.push(alert),
  })
  assert.equal(guard.acquire({}).ok, true)
  assert.equal(alerts.length, 0)
  const second = guard.acquire({})
  assert.equal(second.ok, true, '软告警不拒绝')
  assert.equal(second.softAlerts.length, 1)
  assert.equal(second.softAlerts[0].code, COST_SOFT_ALERT_CODE)
  assert.equal(second.softAlerts[0].window, 'day')
  assert.equal(second.softAlerts[0].used, 2)
  assert.equal(alerts.length, 1)
  // 冷却期内不重复告警
  guard.acquire({})
  assert.equal(alerts.length, 1)
  // 冷却结束后再次告警
  clock += 61 * 60 * 1000
  guard.acquire({})
  assert.equal(alerts.length, 2)
  assert.equal(guard.snapshot().recentAlerts.length, 2)
})

test('cost-guard A6：配置优先级（overrides > env > 默认）与关闭开关', () => {
  // env 覆盖默认
  const fromEnv = resolveCostPolicy({
    env: {
      DSH_POETRY_COST_MINUTE_TOTAL: '3',
      DSH_POETRY_COST_ROLE_SELF_TALK_DAY: '4',
      DSH_POETRY_COST_ACTIVITY_CHAT_MINUTE: '5',
    },
  })
  assert.equal(fromEnv.limits.total.minute, 3)
  assert.equal(fromEnv.limits.roles.selfTalk.day, 4)
  assert.equal(fromEnv.limits.activities.chat.minute, 5)
  // overrides 覆盖 env
  const merged = resolveCostPolicy({
    env: { DSH_POETRY_COST_MINUTE_TOTAL: '1' },
    overrides: { limits: { total: { minute: 3 } }, tokenLimit: 900 },
  })
  assert.equal(merged.limits.total.minute, 3)
  assert.equal(merged.tokenLimit, 900)

  // 关闭：不拒绝也不计数
  const off = createCostGuard({
    env: { DSH_POETRY_COST_GUARD: 'off' },
    overrides: { limits: { total: { minute: 1 } } },
  })
  assert.equal(off.enabled, false)
  for (let index = 0; index < 5; index += 1) assert.equal(off.acquire({ role: 'mood' }).ok, true)
  assert.equal(off.snapshot().usage.total.minute, 0)
  assert.equal(off.snapshot().rejected.minute, 0)
  // options.enabled=false 同样生效
  assert.equal(createCostGuard({ enabled: false }).acquire({}).disabled, true)
})

test('cost-guard A6：与 model-budget 不重复计数（各自独立统计）', () => {
  const dir = tmpDir('cost-budget')
  const budget = createModelBudget({
    file: path.join(dir, 'model-budget.json'),
    env: {},
    now: () => SHANGHAI_DAY_START,
  })
  const guard = createCostGuard({ now: () => SHANGHAI_DAY_START, env: {} })
  // 模拟未来接线：一次模型调用 = budget.tryConsume + guard.acquire 各一次
  for (let index = 0; index < 3; index += 1) {
    assert.equal(guard.acquire({ role: 'mood', activity: 'chat' }).ok, true)
    assert.equal(budget.tryConsume('mood').ok, true)
  }
  assert.equal(budget.snapshot().total, 3, 'budget 只记自己的 3 次')
  assert.equal(budget.snapshot().counts.mood, 3)
  const usage = guard.snapshot().usage
  assert.equal(usage.total.day, 3, 'cost-guard 只记自己的 3 次')
  assert.equal(usage.roles.mood.day, 3)
  assert.equal(usage.activities.chat.day, 3)
  // guard 的拒绝不影响 budget 计数口径（反之亦然）
  const rejectingGuard = createCostGuard({
    now: () => SHANGHAI_DAY_START,
    overrides: { limits: { total: { day: 1 } } },
  })
  assert.equal(rejectingGuard.acquire({}).ok, true)
  assert.equal(rejectingGuard.acquire({}).ok, false)
  assert.equal(rejectingGuard.snapshot().usage.total.day, 1, '被拒绝的调用不计入窗口')
  budget.flush()
  rmSync(dir, { recursive: true, force: true })
})

test('cost-guard A6：peek/record/reset 与空输入', () => {
  const guard = createCostGuard({
    now: () => SHANGHAI_DAY_START,
    overrides: { limits: { total: { minute: 2 } } },
  })
  assert.equal(guard.peek({}).ok, true)
  assert.equal(guard.snapshot().usage.total.minute, 0, 'peek 不计数')
  assert.equal(guard.record({ role: 'mood' }).ok, true)
  assert.equal(guard.snapshot().usage.total.minute, 1)
  assert.equal(guard.acquire({ role: 'mood' }).ok, true)
  assert.equal(guard.peek({}).ok, false, 'peek 也能看到超限')
  assert.equal(guard.acquire(null).ok, false, '空输入只受总量限制')
  guard.reset()
  assert.equal(guard.snapshot().usage.total.minute, 0)
  assert.equal(guard.acquire({}).ok, true)
})

// ---------------------------------------------------------------------------
// Gate A7：事件契约（lib/core/event-schema.mjs）——envelope 校验/幂等键/版本兼容/背压默认值
// ---------------------------------------------------------------------------

function validEvent(overrides = {}) {
  return {
    id: 'evt-abc12345-00000001',
    activity: 'reading',
    type: 'reading.highlight',
    version: 1,
    at: 1_700_000_000_000,
    subject: 'book-42',
    topics: ['reading', 'reading.highlight'],
    payload: { page: 3, note: '好句' },
    correlationId: 'evt-abc12345-00000001',
    ...overrides,
  }
}

test('event-schema A7：合法 envelope 通过并补默认值', () => {
  const result = validateEventEnvelope(validEvent())
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.event.type, 'reading.highlight')
  assert.equal(result.event.version, 1)
  assert.equal(result.event.payload.page, 3)

  // createEventEnvelope 自动补 id/at/correlationId/topics
  const created = createEventEnvelope(
    { activity: 'chat', type: 'chat.message.received', version: 1, subject: 'peer-1', payload: { text: 'hi' } },
    { now: 1_700_000_000_000, random: () => 0.25 },
  )
  assert.equal(created.ok, true, JSON.stringify(created.errors))
  assert.match(created.event.id, /^evt-[a-z0-9]+-[a-z0-9]{8}$/)
  assert.equal(created.event.at, 1_700_000_000_000)
  assert.equal(created.event.correlationId, created.event.id)
  assert.deepEqual(created.event.topics, ['chat', 'chat.message.received'])
  // 显式 correlationId 保留（重投同一逻辑链）
  const correlated = createEventEnvelope(validEvent({ correlationId: 'corr-00000001' }))
  assert.equal(correlated.event.correlationId, 'corr-00000001')
  // payload 省略 → {}
  const noPayload = validateEventEnvelope({ ...validEvent(), payload: undefined })
  assert.equal(noPayload.ok, true)
  assert.deepEqual(noPayload.event.payload, {})
})

test('event-schema A7：缺字段/非法字段被拒绝（错误路径明确）', () => {
  assert.equal(validateEventEnvelope(null).errors[0].code, EVENT_ERROR_CODES.invalidType)
  const empty = validateEventEnvelope({})
  assert.equal(empty.ok, false)
  const missing = empty.errors.filter((item) => item.code === EVENT_ERROR_CODES.missingField).map((item) => item.path)
  assert.deepEqual(missing, ['id', 'activity', 'type', 'version', 'at', 'subject'])

  const bad = validateEventEnvelope(
    validEvent({ id: 'short', activity: 'Reading!', type: 'nodots', version: 0, at: -1, subject: '' }),
  )
  assert.equal(bad.ok, false)
  const paths = bad.errors.map((item) => item.path)
  for (const path of ['id', 'activity', 'type', 'version', 'at', 'subject']) {
    assert.ok(paths.includes(path), `应报告 ${path}`)
  }
  assert.ok(bad.errors.some((item) => item.code === EVENT_ERROR_CODES.invalidTypeName))
  assert.equal(validateEventEnvelope(validEvent({ version: EVENT_SCHEMA_LIMITS.versionMax + 1 })).ok, false)
  assert.equal(validateEventEnvelope(validEvent({ version: 1.5 })).ok, false)
  assert.equal(validateEventEnvelope(validEvent({ correlationId: 'bad id!' })).ok, false)
})

test('event-schema A7：topics/payload 上限与 JSON 可序列化', () => {
  const tooMany = validateEventEnvelope(
    validEvent({ topics: Array.from({ length: EVENT_SCHEMA_LIMITS.topicsMax + 1 }, (_, index) => 'topic-' + index) }),
  )
  assert.equal(tooMany.ok, false)
  assert.ok(tooMany.errors.some((item) => item.code === EVENT_ERROR_CODES.tooManyTopics))
  const duplicated = validateEventEnvelope(validEvent({ topics: ['reading', 'reading'] }))
  assert.ok(duplicated.errors.some((item) => item.code === EVENT_ERROR_CODES.duplicateTopic))
  const badTopic = validateEventEnvelope(validEvent({ topics: ['Bad Topic'] }))
  assert.ok(badTopic.errors.some((item) => item.code === EVENT_ERROR_CODES.invalidValue))

  assert.equal(validateEventEnvelope(validEvent({ payload: [] })).ok, false)
  const circular = {}
  circular.self = circular
  const circularResult = validateEventEnvelope(validEvent({ payload: circular }))
  assert.equal(circularResult.ok, false)
  assert.ok(circularResult.errors.some((item) => item.code === EVENT_ERROR_CODES.payloadNotJson))
  const huge = validateEventEnvelope(
    validEvent({ payload: { text: 'x'.repeat(EVENT_SCHEMA_LIMITS.payloadMaxBytes + 1) } }),
  )
  assert.equal(huge.ok, false)
  assert.ok(huge.errors.some((item) => item.code === EVENT_ERROR_CODES.payloadTooLarge))
})

test('event-schema A7：事件 id 生成与类型/命名空间解析', () => {
  const first = generateEventId({ now: 1_700_000_000_000, random: () => 0 })
  const second = generateEventId({ now: 1_700_000_000_000, random: () => 0.9999 })
  assert.notEqual(first, second, '随机源不同应生成不同 id')
  assert.equal(first, generateEventId({ now: 1_700_000_000_000, random: () => 0 }), '同输入确定性可测')
  assert.ok(validateEventEnvelope(validEvent({ id: first, correlationId: first })).ok)

  const parsed = parseEventType('task.queued')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.namespace, 'task')
  assert.deepEqual(parsed.segments, ['task', 'queued'])
  assert.equal(parsed.reservedNamespace, true)
  assert.equal(isReservedNamespace('chat'), true)
  assert.equal(isReservedNamespace('reading'), false)
  assert.ok(EVENT_RESERVED_NAMESPACES.includes('task'))
  assert.equal(parseEventType('nodots').ok, false)
  assert.equal(parseEventType('Bad.Type').ok, false)
})

test('event-schema A7：幂等键（重投一致、内容哈希稳定）', () => {
  const event = validEvent()
  const key = buildIdempotencyKey(event)
  assert.equal(key, 'reading:reading.highlight:book-42:evt-abc12345-00000001')
  // 重投：同 correlationId/subject/type → 同 key（id/at 可变）
  assert.equal(buildIdempotencyKey({ ...event, id: 'evt-other00001', at: 1_700_000_001_000 }), key)
  // 不同 subject → 不同 key
  assert.notEqual(buildIdempotencyKey({ ...event, subject: 'book-43' }), key)
  // 内容哈希：键顺序无关、payload 变化会变
  assert.equal(contentHashOf({ b: 1, a: 2 }), contentHashOf({ a: 2, b: 1 }))
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}')
  const withHash = buildIdempotencyKey(event, { includeContentHash: true })
  assert.ok(withHash.startsWith(key + ':'))
  assert.equal(
    buildIdempotencyKey({ ...event, payload: { page: 4 } }, { includeContentHash: true }) === withHash,
    false,
  )
  // 非法输入 → ''
  assert.equal(buildIdempotencyKey(null), '')
  assert.equal(buildIdempotencyKey({ activity: 'reading' }), '')
})

test('event-schema A7：版本兼容判断与未知事件保留策略', () => {
  const event = validEvent({ type: 'reading.highlight', version: 2 })
  const compatible = checkEventVersion(event, { types: ['reading.highlight'], minVersion: 1, maxVersion: 2 })
  assert.equal(compatible.ok, true)
  assert.equal(compatible.status, EVENT_VERSION_STATUS.compatible)
  assert.equal(compatible.action, 'process')
  assert.equal(isVersionCompatible(event, { types: ['reading.highlight'], maxVersion: 2 }), true)
  assert.equal(isVersionCompatible(event, { types: ['reading.highlight'], maxVersion: 1 }), false)

  const unknown = checkEventVersion(event, { types: ['chat.message.received'] })
  assert.equal(unknown.status, EVENT_VERSION_STATUS.unknownType)
  assert.equal(unknown.action, 'retain')
  assert.equal(UNKNOWN_EVENT_POLICY, 'retain')
  assert.match(unknown.reason, /retain/)

  const tooNew = checkEventVersion(event, { types: ['reading.highlight'], maxVersion: 1 })
  assert.equal(tooNew.status, EVENT_VERSION_STATUS.tooNew)
  assert.equal(tooNew.action, 'retain')

  const tooOld = checkEventVersion(validEvent({ version: 1 }), { types: ['reading.highlight'], minVersion: 2 })
  assert.equal(tooOld.status, EVENT_VERSION_STATUS.tooOld)
  assert.equal(tooOld.action, 'skip')

  const invalid = checkEventVersion({ id: 'x' }, { types: '*' })
  assert.equal(invalid.status, EVENT_VERSION_STATUS.invalid)
  assert.equal(invalid.action, 'drop')
  // types: '*' 表示接受所有类型
  assert.equal(checkEventVersion(event, { types: '*' }).status, EVENT_VERSION_STATUS.compatible)
})

test('event-schema A7：背压默认值与 env 解析', () => {
  assert.equal(EVENT_BACKPRESSURE_DEFAULTS.retentionHours, 72)
  assert.equal(EVENT_BACKPRESSURE_DEFAULTS.maxEventsInMemory, 10_000)
  assert.equal(EVENT_BACKPRESSURE_DEFAULTS.maxReplayEvents, 5_000)
  assert.equal(EVENT_BACKPRESSURE_DEFAULTS.unknownEventRetention, 'retain')
  assert.equal(EVENT_BACKPRESSURE_DEFAULTS.maxPayloadBytes, EVENT_SCHEMA_LIMITS.payloadMaxBytes)
  assert.ok(EVENT_BACKPRESSURE_DEFAULTS.diskHardLimitBytes > EVENT_BACKPRESSURE_DEFAULTS.diskSoftLimitBytes)

  const defaults = resolveEventBackpressure({})
  assert.equal(defaults.retentionHours, 72)
  const custom = resolveEventBackpressure({
    DSH_POETRY_EVENT_RETENTION_HOURS: '24',
    DSH_POETRY_EVENT_MAX_MEMORY: '500',
    DSH_POETRY_EVENT_MAX_REPLAY: '100',
    DSH_POETRY_EVENT_DISK_SOFT_BYTES: '1024',
    DSH_POETRY_EVENT_DISK_HARD_BYTES: '2048',
  })
  assert.equal(custom.retentionHours, 24)
  assert.equal(custom.maxEventsInMemory, 500)
  assert.equal(custom.maxReplayEvents, 100)
  assert.equal(custom.diskSoftLimitBytes, 1024)
  assert.equal(custom.diskHardLimitBytes, 2048)
  const invalid = resolveEventBackpressure({ DSH_POETRY_EVENT_RETENTION_HOURS: 'bogus' })
  assert.equal(invalid.retentionHours, 72, '非法值回退默认')
})

// ---------------------------------------------------------------------------
// Gate A8：基线压测与故障注入（scripts/load-baseline.mjs / scripts/fault-inject.mjs）
// ---------------------------------------------------------------------------

test('load-baseline A8：dry-run 不执行；配置归一化与确定性工具', async () => {
  const dry = await runLoadBaseline({ dryRun: true })
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.model, null)
  assert.equal(dry.tasks, null)
  assert.equal(dry.events, null)
  assert.match(dry.plan, /dry-run/)
  assert.equal(dry.durationMs >= 0, true)

  const normalized = normalizeLoadOptions({ requests: 0, concurrency: -1, maxQueue: -5, scenario: 'bogus' })
  assert.equal(normalized.requests, 1)
  assert.equal(normalized.concurrency, 1)
  assert.equal(normalized.maxQueue, 0)
  assert.equal(normalized.scenario, LOAD_DEFAULTS.scenario)
  assert.equal(normalizeLoadOptions({}).seed, LOAD_DEFAULTS.seed)

  const first = createSeededRandom(42)
  const second = createSeededRandom(42)
  const values = [first(), first(), first()]
  assert.deepEqual(values, [second(), second(), second()], '同 seed 序列一致')
  assert.deepEqual(percentile([1, 2, 3, 4, 5], 0.5), 3)
  assert.deepEqual(percentile([], 0.95), 0)
  assert.deepEqual(percentile([10], 0.99), 10)
})

test('load-baseline A8：模型场景复现队列满且统计完整', async () => {
  const report = await runModelScenario({
    requests: 40,
    concurrency: 10,
    maxConcurrent: 1,
    maxQueue: 2,
    queueTimeoutMs: 20,
    serviceMs: 1,
    slowRatio: 0,
    hangRatio: 0,
    seed: 7,
  })
  assert.equal(report.requests, 40)
  const rejectedTotal = report.rejected.queueFull + report.rejected.timeout + report.rejected.other
  assert.equal(report.granted + rejectedTotal, 40, '每次请求要么通过要么被拒绝')
  assert.ok(rejectedTotal > 0, '小队列下应出现拒绝（复现队列满）')
  assert.ok(report.rejected.queueFull > 0)
  assert.ok(report.queue.peak <= 2, '峰值队列不超过 maxQueue')
  assert.equal(report.queue.final.active, 0, '压测结束并发槽位应归零')
  assert.equal(report.latencyMs.count, report.granted)
  assert.ok(report.latencyMs.p50 >= 0 && report.latencyMs.p95 >= report.latencyMs.p50)
  assert.ok(report.throughputPerSec >= 0)
})

test('load-baseline A8：任务/事件场景统计与背压', () => {
  const tasks = runTaskScenario({ tasks: 30, maxRunning: 2, taskMs: 10, cancelRatio: 0, seed: 3 })
  assert.equal(tasks.total, 30)
  assert.equal(tasks.completed, 30, '不取消时应全部完成')
  assert.equal(tasks.cancelled, 0)
  assert.equal(tasks.slotsUsed, 0, '结束后不占槽位')
  assert.ok(tasks.durationMsStats.p50 > 0 && tasks.durationMsStats.p95 >= tasks.durationMsStats.p50)

  const cancelledRun = runTaskScenario({ tasks: 30, maxRunning: 2, taskMs: 10, cancelRatio: 1, seed: 3 })
  assert.equal(cancelledRun.cancelled, 30, 'cancelRatio=1 应全部取消')

  const events = runEventScenario({ events: 100, eventCapacity: 50, unknownRatio: 0.2, seed: 5 })
  assert.equal(events.produced, 100)
  assert.equal(events.invalid, 0)
  assert.equal(events.peakDepth, 50, '队列应打满到容量')
  assert.equal(events.dropped, 50, '容量外事件应被背压丢弃')
  assert.equal(events.peakDepth + events.dropped, 100)
  assert.ok(events.retainedUnknown > 0, '未知事件应保留')
  assert.ok(events.processed > 0, '已知事件应处理')
  assert.equal(events.processed + events.retainedUnknown, 50, '入队事件被处理或保留')
  assert.equal(events.backpressure.retentionHours, 72)
})

test('load-baseline A8：CLI dry-run / json 冒烟（无外部副作用）', () => {
  const script = path.join(STATE_TEST_ROOT, 'scripts', 'load-baseline.mjs')
  const dry = JSON.parse(
    execFileSync(process.execPath, [script, '--scenario', 'task', '--tasks', '10', '--dry-run', '--json'], {
      encoding: 'utf8',
    }),
  )
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.tasks, null)
  const real = JSON.parse(
    execFileSync(process.execPath, [script, '--scenario', 'event', '--events', '20', '--json'], { encoding: 'utf8' }),
  )
  assert.equal(real.ok, true)
  assert.equal(real.events.produced, 20)
})

test('fault-inject A8：全部场景通过；dry-run/单场景/list 可用', async () => {
  const report = await runFaultInjection()
  assert.equal(report.ok, true, JSON.stringify(report.scenarios.filter((item) => !item.ok)))
  assert.equal(report.scenarios.length, FAULT_SCENARIOS.length)
  for (const scenario of report.scenarios) {
    assert.equal(scenario.ok, true, `${scenario.id} 应通过：${scenario.error ?? ''}`)
    assert.equal(typeof scenario.durationMs, 'number')
  }
  const ids = report.scenarios.map((item) => item.id)
  for (const expected of ['model-timeout', 'model-empty', 'task-cancel', 'process-restart', 'disk-write-failure']) {
    assert.ok(ids.includes(expected), `应包含 ${expected}`)
  }

  const dry = await runFaultInjection({ dryRun: true })
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.scenarios.length, FAULT_SCENARIOS.length)
  assert.ok(dry.scenarios.every((item) => item.ok === null))

  const single = await runFaultInjection({ scenario: 'task-cancel' })
  assert.equal(single.ok, true)
  assert.equal(single.scenarios.length, 1)
  assert.equal(single.scenarios[0].id, 'task-cancel')

  assert.equal(listFaultScenarios().length, FAULT_SCENARIOS.length)
  assert.deepEqual(parseFaultArgs(['--scenario', 'model-empty', '--json']).scenario, 'model-empty')
  assert.equal(parseFaultArgs(['--dry-run']).dryRun, true)
  assert.equal(parseFaultArgs(['--list']).list, true)
})

test('fault-inject A8：CLI 冒烟（json / 单场景 / dry-run）', () => {
  const script = path.join(STATE_TEST_ROOT, 'scripts', 'fault-inject.mjs')
  const all = JSON.parse(execFileSync(process.execPath, [script, '--json'], { encoding: 'utf8' }))
  assert.equal(all.ok, true)
  const single = JSON.parse(
    execFileSync(process.execPath, [script, '--scenario', 'model-empty', '--json'], { encoding: 'utf8' }),
  )
  assert.equal(single.ok, true)
  assert.equal(single.scenarios.length, 1)
  const dry = JSON.parse(execFileSync(process.execPath, [script, '--dry-run', '--json'], { encoding: 'utf8' }))
  assert.equal(dry.ok, true)
  assert.equal(dry.dryRun, true)
})
