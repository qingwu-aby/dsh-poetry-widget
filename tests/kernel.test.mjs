// kernel 基础设施单测（W0/W1）

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { summarizeModelBudget, summarizeModelGate } from '../lib/composition/health.mjs'
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
  canTransition,
  createTaskSupervisor,
  TASK_ALLOWED_TRANSITIONS,
  TASK_ERROR_CODES,
} from '../lib/core/task-supervisor.mjs'
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
