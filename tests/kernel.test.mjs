// kernel 基础设施单测（W0/W1）

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createChatHttpService, createChatTurnRunner } from '../lib/composition/chat-service.mjs'
import {
  buildHealthAlerts,
  buildHealthMetrics,
  buildRuntimeSnapshot,
  HEALTH_ALERT_THRESHOLDS,
  summarizeHub,
  summarizeModelBudget,
  summarizeModelGate,
} from '../lib/composition/health.mjs'
import {
  createHubHandler,
  createRealActivityAdapters,
  executeActivityTask,
  HUB_ACTIONS,
  HUB_ROUTE,
  registerHubRoute,
} from '../lib/composition/hub-routes.mjs'
import {
  createHubRuntime,
  getActiveHubRuntime,
  HUB_RUNTIME_DEFAULT_FLAG,
  HUB_RUNTIME_VERSION,
  registerHubRuntime,
  resolveHubFeatureFlag,
  sanitizeEventText,
  setActiveHubRuntime,
} from '../lib/composition/hub-runtime.mjs'
import {
  createMinecraftTaskQueue,
  MINECRAFT_TASK_QUEUE_CODES,
  MINECRAFT_TASK_QUEUE_VERSION,
} from '../lib/composition/minecraft-task-queue.mjs'
import {
  createMinecraftTaskHandler,
  MINECRAFT_TASK_ACTIONS,
  MINECRAFT_TASKS_ROUTE,
} from '../lib/composition/minecraft-task-routes.mjs'
import {
  createModelPolicyHandler,
  MODEL_POLICY_ALLOWED_FIELDS,
  MODEL_POLICY_ROUTE,
  registerModelPolicyRoute,
  validateModelPolicyInput,
} from '../lib/composition/model-policy-routes.mjs'
import { createMinecraftShadowSink } from '../lib/composition/plugin-runtime.mjs'
import {
  createTrainingHandler,
  registerTrainingRoute,
  TRAINING_ACTIONS,
  TRAINING_ROUTE,
} from '../lib/composition/training-routes.mjs'
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
  ACTIVITY_HEALTH_STATES,
  ACTIVITY_REGISTRY_CODES,
  ACTIVITY_REGISTRY_EVENTS,
  ACTIVITY_REGISTRY_VERSION,
  createActivityRegistry,
} from '../lib/core/activity-registry.mjs'
import {
  CHAT_ACTIVITY_CODES,
  CHAT_ACTIVITY_ID,
  CHAT_ACTIVITY_LIMITS,
  CHAT_ACTIVITY_VERSION,
  CHAT_EVENTS,
  CHAT_MANIFEST,
  CHAT_MANIFEST_RAW,
  CHAT_TASK_KIND,
  CHAT_TOOL_REPLY,
  chatTaskKey,
  createChatActivity,
  createTask as createChatTask,
  execute as executeChatTurn,
  getChatManifest,
  toEvent as toChatEvent,
  toInterruptedEvent,
  toRepliedEvent,
} from '../lib/core/chat-activity.mjs'
import {
  createEventBus,
  createMemoryEventStore,
  EVENT_BUS_CODES,
  EVENT_BUS_DEFAULTS,
  EVENT_BUS_VERSION,
  parseSubscriptionPattern,
} from '../lib/core/event-bus.mjs'
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
  createFeedbackLedger,
  FEEDBACK_LEDGER_CODES,
  FEEDBACK_LEDGER_DEFAULTS,
  FEEDBACK_LEDGER_VERSION,
  FEEDBACK_OUTCOMES,
  FEEDBACK_RECEIPT_KINDS,
  validateReceipt,
} from '../lib/core/feedback-ledger.mjs'
import {
  createFileMemoryProvider,
  DEFAULT_FILE_MEMORY_MAX_BYTES,
  FILE_MEMORY_PROVIDER_VERSION,
} from '../lib/core/file-memory-provider.mjs'
import {
  createHubPersistence,
  createJsonlEventStore,
  createJsonTaskStore,
  DEFAULT_EVENT_STORE_MAX_BYTES,
  FILE_STORES_VERSION,
} from '../lib/core/file-stores.mjs'
import { createHub, HUB_CODES, HUB_DEFAULT_FEATURE_FLAG, HUB_MODES, HUB_STATES, HUB_VERSION } from '../lib/core/hub.mjs'
import {
  createHubControlApi,
  HUB_CONTROL_ACTIVITY_HEALTH,
  HUB_CONTROL_CODES,
  HUB_CONTROL_TASK_STATUSES,
  HUB_CONTROL_VERSION,
} from '../lib/core/hub-control-api.mjs'
import {
  GAME_CATEGORY_MAP,
  gameMemoryProvider,
  JOURNAL_KIND_CATEGORY,
  journalProvider,
  MEMORY_ADAPTER_CODES,
  MEMORY_ADAPTER_DEFAULTS,
  MEMORY_ADAPTERS_VERSION,
  methodMemoryProvider,
} from '../lib/core/memory-adapters.mjs'
import {
  createInMemoryMemoryProvider,
  createMemoryGateway,
  MEMORY_CATEGORIES,
  MEMORY_GATEWAY_CODES,
  MEMORY_GATEWAY_VERSION,
  MEMORY_STATUSES,
} from '../lib/core/memory-gateway.mjs'
import {
  buildMemoryDeletePlan,
  buildMemoryExport,
  createMemoryPrivacyController,
  MEMORY_PRIVACY_CODES,
  MEMORY_PRIVACY_DEFAULTS,
  MEMORY_PRIVACY_VERSION,
  sanitizeEntry,
  sanitizeValue,
} from '../lib/core/memory-privacy.mjs'
import {
  analyzeMemoryQuality,
  MEMORY_QUALITY_ACTIONS,
  MEMORY_QUALITY_CODES,
  MEMORY_QUALITY_DEFAULTS,
  MEMORY_QUALITY_VERSION,
  MEMORY_SOURCE_TRUST,
  similarity,
} from '../lib/core/memory-quality.mjs'
import {
  createMinecraftActivity,
  getMinecraftManifest,
  MINECRAFT_ACTIVITY_CODES,
  MINECRAFT_ACTIVITY_ID,
  MINECRAFT_ACTIVITY_VERSION,
  MINECRAFT_EVENTS,
  MINECRAFT_MANIFEST,
  MINECRAFT_MANIFEST_RAW,
  MINECRAFT_TASK_KINDS,
  MINECRAFT_TOOL_NAMES,
  MINECRAFT_TOOLS_SNAPSHOT,
  toChatEvent as toMinecraftChatEvent,
  toDeathEvent as toMinecraftDeathEvent,
  toSpawnEvent as toMinecraftSpawnEvent,
  toTask as toMinecraftTask,
  toToolReceiptEvent as toMinecraftToolReceiptEvent,
  validateReceipt as validateMinecraftReceipt,
} from '../lib/core/minecraft-activity.mjs'
import {
  createScheduler,
  DEFAULT_PRIORITY_CLASSES,
  priorityClassOf,
  resolvePriorityClasses,
  SCHEDULER_CODES,
  SCHEDULER_VERSION,
} from '../lib/core/scheduler.mjs'
import {
  createMemoryTaskStore,
  createTaskBoard,
  TASK_BOARD_CODES,
  TASK_BOARD_EVENTS,
  TASK_BOARD_VERSION,
} from '../lib/core/task-board.mjs'
import {
  canTransition,
  createTaskSupervisor,
  TASK_ALLOWED_TRANSITIONS,
  TASK_ERROR_CODES,
} from '../lib/core/task-supervisor.mjs'
import {
  createWorldSupervisor,
  WORLD_STATES,
  WORLD_SUPERVISOR_CODES,
  WORLD_SUPERVISOR_EVENTS,
  WORLD_SUPERVISOR_VERSION,
} from '../lib/core/world-supervisor.mjs'
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
import { createMethodMemory } from '../lib/domain/learning/method-memory.mjs'
import {
  createTrainingConfigStore,
  defaultTrainingConfig,
  normalizeTrainingConfig,
  resolveTrainingConfigFile,
  TRAINING_CONFIG_VERSION,
  TRAINING_DATASET_SOURCES,
} from '../lib/domain/life/training-config.mjs'
import {
  createTrainingRunner,
  TRAINING_RUNNER_CODES,
  TRAINING_RUNNER_VERSION,
} from '../lib/domain/life/training-runner.mjs'
import {
  createTrainingService,
  TRAINING_PHASES,
  TRAINING_SERVICE_CODES,
  TRAINING_SERVICE_VERSION,
} from '../lib/domain/life/training-service.mjs'
import { createMemoryJournal } from '../lib/domain/memory/memory-journal.mjs'
import { createGameMemoryWorkspace } from '../lib/domain/play/game-memory-workspace.mjs'
import { createMinecraftWorld, MINECRAFT_TOOLS } from '../lib/domain/play/minecraft-world.mjs'
import { describeConfig, readConfig } from '../lib/kernel/config.mjs'
import { createJsonStore, readJson, writeJson } from '../lib/kernel/json-store.mjs'
import { callCandidate, callModelForRole, configureModelRuntime, resetModelRuntime } from '../lib/kernel/llm-call.mjs'
import { createPluginLogger } from '../lib/kernel/logger.mjs'
import { createModelCaller } from '../lib/kernel/model-call.mjs'
import {
  createModelPolicy,
  getDefaultModelPolicyOverrides,
  MODEL_POLICY_ALLOWED_PROVIDERS,
  MODEL_POLICY_EFFORTS,
  MODEL_POLICY_ROLES,
  resolveCandidateMaxTokens,
  setDefaultModelPolicyOverrides,
} from '../lib/kernel/model-policy.mjs'
import {
  createModelPolicyStore,
  emptyModelPolicy,
  MODEL_POLICY_STORE_VERSION,
  MODEL_POLICY_TOKEN_LIMIT_MAX,
  normalizeModelPolicy,
  resolveModelPolicyFile,
} from '../lib/kernel/model-policy-store.mjs'
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
function createWorldFakeTimers() {
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
  const timers = createWorldFakeTimers()
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
  const timers = createWorldFakeTimers()
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

// ---------------------------------------------------------------------------
// Gate B1：Event Bus（lib/core/event-bus.mjs）——有界/幂等/可回放/订阅隔离/背压
// ---------------------------------------------------------------------------

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeBusEvent(index, overrides = {}) {
  return {
    id: 'evt-bus-' + String(index).padStart(8, '0'),
    activity: 'chat',
    type: 'chat.message.received',
    version: 1,
    at: 1_700_000_000_000 + index,
    subject: 'subject-' + index,
    payload: { index },
    ...overrides,
  }
}

test('event-bus B1：append 校验/幂等/顺序投递', async () => {
  const bus = createEventBus({ maxEvents: 100, maxReplay: 100 })
  const invalid = bus.append({ id: 'x' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, EVENT_BUS_CODES.invalidEvent)
  assert.ok(Array.isArray(invalid.errors) && invalid.errors.length > 0)
  assert.equal(bus.snapshot().metrics.rejected, 1)

  const first = bus.append(makeBusEvent(1))
  assert.equal(first.ok, true)
  assert.equal(first.seq, 1)
  assert.equal(first.duplicate, false)
  const duplicate = bus.append(makeBusEvent(1))
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.seq, first.seq, '重复事件不分配新序号')
  assert.equal(bus.snapshot().metrics.duplicates, 1)
  assert.equal(bus.snapshot().stored, 1)

  const seen = []
  bus.subscribe('*', (event, meta) => seen.push([meta.seq, event.id]))
  assert.equal(bus.append(makeBusEvent(2)).ok, true)
  assert.equal(bus.append(makeBusEvent(3)).ok, true)
  await bus.flush()
  assert.deepEqual(
    seen.map((item) => item[0]),
    [2, 3],
    '按 append 顺序投递（重复事件不投递）',
  )
  assert.deepEqual(
    seen.map((item) => item[1]),
    ['evt-bus-00000002', 'evt-bus-00000003'],
  )
  assert.equal(bus.snapshot().metrics.published, 3)
  assert.equal(bus.snapshot().metrics.delivered, 2)
})

test('event-bus B1：订阅过滤（*/ns.*/精确）与 unsubscribe', async () => {
  const bus = createEventBus({ maxEvents: 100, maxReplay: 100 })
  const all = []
  const chat = []
  const exact = []
  const task = []
  bus.subscribe('*', (event) => all.push(event.type))
  bus.subscribe('chat.*', (event) => chat.push(event.type))
  bus.subscribe('chat.message.received', (event) => exact.push(event.type))
  const unsubscribeTask = bus.subscribe('task.done', (event) => task.push(event.type))

  assert.equal(bus.append(makeBusEvent(1, { type: 'chat.message.received' })).ok, true)
  assert.equal(bus.append(makeBusEvent(2, { type: 'task.done' })).ok, true)
  assert.equal(bus.append(makeBusEvent(3, { type: 'task.queued' })).ok, true)
  await bus.flush()
  assert.deepEqual(all, ['chat.message.received', 'task.done', 'task.queued'])
  assert.deepEqual(chat, ['chat.message.received'])
  assert.deepEqual(exact, ['chat.message.received'])
  assert.deepEqual(task, ['task.done'])

  unsubscribeTask()
  assert.equal(bus.append(makeBusEvent(4, { type: 'task.done' })).ok, true)
  await bus.flush()
  assert.deepEqual(task, ['task.done'], 'unsubscribe 后不再收到')
  assert.equal(bus.snapshot().subscriptions, 3)

  assert.throws(() => bus.subscribe('bad pattern!', () => {}), TypeError)
  assert.throws(() => bus.subscribe('*', null), TypeError)
  assert.equal(parseSubscriptionPattern('*').kind, 'all')
  assert.equal(parseSubscriptionPattern('chat.*').kind, 'prefix')
  assert.equal(parseSubscriptionPattern('chat.message.received').kind, 'exact')
})

test('event-bus B1：投递失败隔离 + 慢订阅不阻塞其他订阅', async () => {
  const bus = createEventBus({ maxEvents: 100, maxReplay: 100 })
  const order = []
  const received = []
  bus.subscribe('*', async () => {
    order.push('a-start')
    await waitMs(20)
    order.push('a-end')
  })
  bus.subscribe('*', () => {
    order.push('b')
    received.push('b')
  })
  bus.subscribe('*', () => {
    order.push('c-throw')
    throw new Error('subscriber boom')
  })
  bus.subscribe('*', async () => {
    order.push('d-reject')
    throw new Error('subscriber async boom')
  })
  bus.subscribe('*', (event) => received.push(event.id))

  assert.equal(bus.append(makeBusEvent(1)).ok, true)
  await bus.flush()
  assert.deepEqual(order.slice(0, 4), ['a-start', 'b', 'c-throw', 'd-reject'], '慢订阅不被 await，后续订阅先被调用')
  assert.equal(received.length, 2, '抛错订阅不影响其他订阅')
  const metrics = bus.snapshot().metrics
  assert.equal(metrics.deliveryErrors, 2, '同步抛错与异步 reject 都计数')
  assert.equal(metrics.delivered, 5)

  // 总线继续可用
  assert.equal(bus.append(makeBusEvent(2)).ok, true)
  await bus.flush()
  assert.equal(received.length, 4)
})

test('event-bus B1：有界队列满（reject / drop-oldest）不静默', async () => {
  const rejectBus = createEventBus({ maxEvents: 2, maxReplay: 10 })
  const rejectDrops = []
  const withDrop = createEventBus({
    maxEvents: 2,
    maxReplay: 10,
    queueFullPolicy: 'drop-oldest',
    onDrop: (info) => rejectDrops.push(info.reason),
  })
  const rejects = []
  const busWithReject = createEventBus({
    maxEvents: 2,
    maxReplay: 10,
    onReject: (info) => rejects.push(info.code),
  })
  assert.equal(rejectBus.append(makeBusEvent(1)).ok, true)
  assert.equal(rejectBus.append(makeBusEvent(2)).ok, true)
  const full = rejectBus.append(makeBusEvent(3))
  assert.equal(full.ok, false)
  assert.equal(full.code, EVENT_BUS_CODES.queueFull)
  assert.match(full.message, /队列已满/)
  assert.equal(rejectBus.snapshot().stored, 2)
  assert.equal(rejectBus.snapshot().lastReject.code, EVENT_BUS_CODES.queueFull)

  assert.equal(withDrop.append(makeBusEvent(1)).ok, true)
  assert.equal(withDrop.append(makeBusEvent(2)).ok, true)
  const dropped = withDrop.append(makeBusEvent(3))
  assert.equal(dropped.ok, true)
  assert.equal(dropped.droppedOldest, true)
  assert.equal(withDrop.snapshot().metrics.dropped, 1)
  assert.deepEqual(rejectDrops, ['queue-full'], '丢弃必须有回调，不静默')
  const replayed = withDrop.replay({})
  assert.deepEqual(
    replayed.events.map((event) => event.id),
    ['evt-bus-00000002', 'evt-bus-00000003'],
  )

  assert.equal(busWithReject.append(makeBusEvent(1)).ok, true)
  assert.equal(busWithReject.append(makeBusEvent(2)).ok, true)
  assert.equal(busWithReject.append(makeBusEvent(3)).ok, false)
  assert.deepEqual(rejects, [EVENT_BUS_CODES.queueFull])
})

test('event-bus B1：磁盘软/硬阈值明确拒绝', () => {
  const soft = createEventBus({
    maxEvents: 100,
    getDiskUsageBytes: () => 600 * 1024 * 1024,
    diskSoftLimitBytes: 512 * 1024 * 1024,
    diskHardLimitBytes: 2 * 1024 * 1024 * 1024,
  })
  const softResult = soft.append(makeBusEvent(1))
  assert.equal(softResult.ok, false)
  assert.equal(softResult.code, EVENT_BUS_CODES.diskSoftLimit)
  assert.equal(soft.snapshot().disk.state, 'soft')

  const overflow = createEventBus({
    maxEvents: 100,
    getDiskUsageBytes: () => 600 * 1024 * 1024,
    allowSoftOverflow: true,
  })
  assert.equal(overflow.append(makeBusEvent(1)).ok, true, 'allowSoftOverflow 可放行软阈值')

  const hard = createEventBus({
    maxEvents: 100,
    getDiskUsageBytes: () => 3 * 1024 * 1024 * 1024,
    allowSoftOverflow: true,
  })
  const hardResult = hard.append(makeBusEvent(1))
  assert.equal(hardResult.ok, false)
  assert.equal(hardResult.code, EVENT_BUS_CODES.diskHardLimit)
  assert.equal(hard.snapshot().disk.state, 'hard')
})

test('event-bus B1：回放过滤/上限/计数', () => {
  const bus = createEventBus({ maxEvents: 100, maxReplay: 3 })
  bus.append(
    makeBusEvent(1, { activity: 'chat', type: 'chat.message.received', topics: ['chat', 'chat.message.received'] }),
  )
  bus.append(makeBusEvent(2, { activity: 'reading', type: 'reading.highlight', topics: ['reading'] }))
  bus.append(makeBusEvent(3, { activity: 'chat', type: 'chat.message.sent', topics: ['chat'] }))
  bus.append(makeBusEvent(4, { activity: 'task', type: 'task.done', topics: ['task'] }))
  bus.append(makeBusEvent(5, { activity: 'chat', type: 'chat.message.received', topics: ['mood'] }))

  assert.deepEqual(
    bus.replay({ activity: 'chat' }).events.map((event) => event.payload.index),
    [1, 3, 5],
  )
  assert.deepEqual(
    bus.replay({ type: 'chat.*' }).events.map((event) => event.payload.index),
    [1, 3, 5],
  )
  assert.deepEqual(
    bus.replay({ type: 'task.done' }).events.map((event) => event.payload.index),
    [4],
  )
  assert.deepEqual(
    bus.replay({ topics: ['mood'] }).events.map((event) => event.payload.index),
    [5],
  )
  assert.deepEqual(
    bus.replay({ fromSeq: 4 }).events.map((event) => event.payload.index),
    [4, 5],
  )

  // 回放上限：默认取 maxReplay；显式超限 → 明确拒绝
  assert.equal(bus.replay({}).count, 3)
  const tooMany = bus.replay({ limit: 4 })
  assert.equal(tooMany.ok, false)
  assert.equal(tooMany.code, EVENT_BUS_CODES.replayLimit)
  assert.equal(bus.replay({ limit: 2 }).count, 2)
  assert.equal(bus.snapshot().metrics.replayed, 10 + 3 + 2, '每次回放都计数（5 次过滤=10、默认=3、limit2=2）')

  const replayed = []
  const withHandler = bus.replay({ activity: 'reading' }, (event) => replayed.push(event.id))
  assert.equal(withHandler.count, 1)
  assert.deepEqual(replayed, ['evt-bus-00000002'])
  assert.equal(bus.snapshot().metrics.replayed, 16, '带 handler 的回放同样计数')
})

test('event-bus B1：保留窗口清理与 onDrop 计数', () => {
  let clock = 1_700_000_000_000
  const drops = []
  const bus = createEventBus({
    now: () => clock,
    maxEvents: 100,
    maxReplay: 100,
    retentionMs: 100,
    onDrop: (info) => drops.push(info.reason),
  })
  bus.append(makeBusEvent(1))
  assert.equal(bus.snapshot().stored, 1)
  clock += 200
  bus.append(makeBusEvent(2))
  assert.equal(bus.snapshot().stored, 1, '过期事件在下一次 append 时清理')
  assert.equal(bus.snapshot().metrics.evicted, 1)
  assert.deepEqual(drops, ['retention'])
  assert.deepEqual(
    bus.replay({}).events.map((event) => event.payload.index),
    [2],
  )
})

test('event-bus B1：持久化适配接口（内存实现）与 store 失败隔离', () => {
  const store = createMemoryEventStore({ maxEvents: 10 })
  const bus = createEventBus({ maxEvents: 100, maxReplay: 100, store })
  bus.append(makeBusEvent(1))
  bus.append(makeBusEvent(2))
  assert.equal(store.snapshot().stored, 2, 'append 会写入 store')
  const read = bus.readFromStore({ limit: 10 })
  assert.equal(read.ok, true)
  assert.equal(read.events.length, 2)
  assert.equal(bus.snapshot().metrics.storeAppends, 2)
  assert.equal(bus.appendToStore(makeBusEvent(3)).ok, true)

  const noStore = createEventBus({})
  assert.equal(noStore.readFromStore({}).code, EVENT_BUS_CODES.noStore)
  assert.equal(noStore.appendToStore(makeBusEvent(1)).code, EVENT_BUS_CODES.noStore)

  const errors = []
  const broken = createEventBus({
    maxEvents: 10,
    onError: (info) => errors.push(info),
    store: {
      append() {
        throw new Error('disk on fire')
      },
      read() {
        return []
      },
    },
  })
  const result = broken.append(makeBusEvent(1))
  assert.equal(result.ok, true, 'store 失败不应阻塞总线')
  assert.equal(broken.snapshot().metrics.storeErrors, 1)
  assert.equal(errors[0].scope, 'store')
})

test('event-bus B1：snapshot 指标与版本字段', async () => {
  const bus = createEventBus({ maxEvents: 5, maxReplay: 5 })
  bus.subscribe('*', () => {})
  bus.append(makeBusEvent(1))
  await bus.flush()
  const snapshot = bus.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.version, EVENT_BUS_VERSION)
  assert.equal(snapshot.maxEvents, 5)
  assert.equal(snapshot.maxReplay, 5)
  assert.equal(snapshot.stored, 1)
  assert.equal(snapshot.queueDepth, 0)
  assert.equal(snapshot.subscriptions, 1)
  assert.equal(snapshot.queueFullPolicy, 'reject')
  for (const key of [
    'published',
    'duplicates',
    'rejected',
    'delivered',
    'deliveryErrors',
    'dropped',
    'evicted',
    'replayed',
    'storeErrors',
  ]) {
    assert.equal(typeof snapshot.metrics[key], 'number', `metrics.${key}`)
  }
  assert.equal(snapshot.lastReject, null)
  assert.equal(EVENT_BUS_DEFAULTS.maxEvents > 0, true)
  assert.equal(EVENT_BUS_DEFAULTS.maxReplay > 0, true)
})

// ---------------------------------------------------------------------------
// Gate B2：Task Board（lib/core/task-board.mjs）——生命周期/幂等/持久重建/优先级/事件
// ---------------------------------------------------------------------------

test('task-board B2：完整生命周期与状态迁移', () => {
  const events = []
  const board = createTaskBoard({
    now: () => 1000,
    maxRunning: 2,
    onEvent: (event) => events.push(event.type),
  })
  const created = board.create({ activity: 'chat', kind: 'reply', priority: 3, key: 'lifecycle' })
  assert.equal(created.ok, true)
  assert.equal(created.duplicate, false)
  assert.equal(created.task.status, 'running', '有空槽时创建即运行')
  const id = created.task.id
  assert.equal(board.get(id).priority, 3)
  assert.equal(board.get(id).activity, 'chat')

  assert.equal(board.waiting(id).task.status, 'waiting')
  assert.equal(board.resume(id).task.status, 'running')
  assert.equal(board.blocked(id).task.status, 'blocked')
  assert.equal(board.resume(id).task.status, 'running')
  const done = board.complete(id, { text: 'ok' })
  assert.equal(done.ok, true)
  assert.equal(done.task.status, 'done')
  assert.deepEqual(board.get(id).result, { text: 'ok' })
  assert.ok(board.get(id).finishedAt !== null)

  // 终态：重复 complete 幂等（already），cancel 明确拒绝
  const again = board.complete(id)
  assert.equal(again.ok, true)
  assert.equal(again.already, true)
  assert.equal(board.cancel(id).ok, false)
  const counts = board.counts()
  assert.equal(counts.byStatus.done, 1)
  assert.equal(counts.active, 0)

  for (const type of [
    'task.created',
    'task.started',
    'task.waiting',
    'task.resumed',
    'task.blocked',
    'task.completed',
  ]) {
    assert.ok(events.includes(type), `应发出 ${type}`)
  }
  assert.equal(TASK_BOARD_VERSION, 1)
  assert.ok(TASK_BOARD_EVENTS.includes('task.created'))
})

test('task-board B2：幂等键（并发/终态/retry）', () => {
  const board = createTaskBoard({ now: () => 1000, maxRunning: 1 })
  const first = board.create({ activity: 'reading', key: 'daily-read', priority: 1 })
  assert.equal(first.ok, true)
  const duplicate = board.create({ activity: 'reading', key: 'daily-read' })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.terminal, false)
  assert.equal(duplicate.task.id, first.task.id, '同 key 不重复执行')
  assert.equal(board.snapshot().total, 1)

  board.complete(first.task.id, { done: true })
  const terminalDuplicate = board.create({ activity: 'reading', key: 'daily-read' })
  assert.equal(terminalDuplicate.duplicate, true)
  assert.equal(terminalDuplicate.terminal, true)
  assert.equal(board.snapshot().total, 1)
  // 非终态 + retry:true 仍是 duplicate（不并发）
  const running = board.create({ activity: 'reading', key: 'running-key' })
  assert.equal(board.create({ activity: 'reading', key: 'running-key', retry: true }).duplicate, true)

  // 终态 + retry:true → 新任务，attempts 延续
  const retried = board.create({ activity: 'reading', key: 'daily-read', retry: true })
  assert.equal(retried.ok, true)
  assert.equal(retried.duplicate, false)
  assert.notEqual(retried.task.id, first.task.id)
  assert.equal(retried.task.attempts, 1, '排队中 attempts 尚未递增')
  assert.equal(retried.task.status, 'queued', 'maxRunning=1 时排队')
  assert.equal(running.task.status, 'running')
  board.complete(running.task.id)
  assert.equal(board.get(retried.task.id).attempts, 2, '重试任务真正开跑后 attempts=2')
})

test('task-board B2：重启重建（状态/幂等索引/可继续操作）', () => {
  let clock = 1000
  const store = createMemoryTaskStore()
  const board = createTaskBoard({ now: () => clock, maxRunning: 4, store })
  const a = board.create({ activity: 'chat', key: 'a', priority: 5 }).task
  const b = board.create({ activity: 'reading', key: 'b', priority: 1 }).task
  const c = board.create({ activity: 'chat', key: 'c', priority: 3 }).task
  const d = board.create({ activity: 'task', key: 'd', priority: 0 }).task
  board.waiting(b.id)
  board.blocked(a.id)
  board.complete(d.id, { ok: true })
  const before = board.counts()
  board.save()
  clock += 10
  const restored = createTaskBoard({ now: () => clock, maxRunning: 4, store })
  const after = restored.counts()
  assert.deepEqual(after.byStatus, before.byStatus, '重启后状态计数一致')
  assert.equal(restored.get(a.id).status, 'blocked')
  assert.equal(restored.get(b.id).status, 'waiting')
  assert.equal(restored.get(d.id).status, 'done')
  assert.equal(restored.get(d.id).attempts, 1)
  // 幂等索引重建：同 key 不会重复执行
  assert.equal(restored.create({ activity: 'chat', key: 'a' }).duplicate, true)
  assert.equal(restored.create({ activity: 'chat', key: 'a' }).task.id, a.id)
  // 重建后仍可继续操作
  assert.equal(restored.complete(c.id, { done: true }).task.status, 'done')
  assert.equal(restored.resume(b.id).task.status, 'running')
  assert.equal(restored.resume(a.id).ok, true, 'blocked 任务恢复后继续')
  const snapshot = restored.snapshot()
  assert.equal(snapshot.metrics.restored > 0, true)
  assert.ok(snapshot.store.saves > 0)
})

test('task-board B2：非法状态/参数/容量明确拒绝', () => {
  const board = createTaskBoard({ now: () => 1000, maxRunning: 1, maxTasks: 2 })
  assert.equal(board.get('missing'), null)
  assert.equal(board.complete('missing').code, TASK_BOARD_CODES.notFound)
  assert.equal(board.claim('missing').code, TASK_BOARD_CODES.notFound)
  assert.equal(board.create({}).code, TASK_BOARD_CODES.invalidArgument)
  assert.equal(board.create({ activity: '' }).code, TASK_BOARD_CODES.invalidArgument)

  const first = board.create({ activity: 'chat' }).task
  const second = board.create({ activity: 'chat' }).task
  const third = board.create({ activity: 'chat' })
  assert.equal(third.ok, false)
  assert.equal(third.code, TASK_BOARD_CODES.capacity)
  assert.match(third.message, /任务板已满/)
  assert.equal(board.snapshot().total, 2)

  // queued 任务不能直接 complete / waiting
  const queuedId = second.id
  assert.equal(board.get(queuedId).status, 'queued')
  const illegal = board.complete(queuedId)
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, 'TASK_INVALID_TRANSITION')
  assert.equal(board.waiting(queuedId).ok, false)
  // 释放容量后可继续创建
  board.complete(first.id)
  assert.equal(board.create({ activity: 'chat' }).ok, true)
})

test('task-board B2：优先级排序 / next / 查询过滤', () => {
  const board = createTaskBoard({ now: () => 1000, maxRunning: 1 })
  const low = board.create({ activity: 'chat', key: 'low', priority: 1 }).task
  const high = board.create({ activity: 'chat', key: 'high', priority: 9 }).task
  const mid = board.create({ activity: 'reading', key: 'mid', priority: 5 }).task
  assert.equal(low.status, 'running')
  assert.equal(high.status, 'queued')
  assert.equal(mid.status, 'queued')

  const byPriority = board.list({ sort: 'priority' }).map((task) => task.id)
  assert.deepEqual(byPriority, [high.id, mid.id, low.id], '优先级降序，其次创建时间')
  assert.equal(board.next().id, high.id, 'next 返回优先级最高的 queued（只读）')
  assert.equal(board.get(high.id).status, 'queued', 'next 不认领')
  const claimed = board.claimNext('owner-1')
  assert.equal(claimed.ok, true)
  assert.equal(claimed.queued, true, 'maxRunning 已满时保持 queued')

  assert.deepEqual(
    board.list({ activity: 'reading' }).map((task) => task.id),
    [mid.id],
  )
  assert.deepEqual(
    board.list({ status: 'queued' }).map((task) => task.id),
    [high.id, mid.id],
  )
  assert.equal(board.list({ limit: 1 }).length, 1)
  board.complete(low.id)
  assert.equal(
    board.list({ status: 'running' }).length >= 1,
    true,
    '完成一个后监管器按 FIFO 补位（调度器后续再做优先级）',
  )
})

test('task-board B2：事件顺序与非法事件记录', () => {
  const events = []
  const board = createTaskBoard({
    now: () => 1000,
    maxRunning: 1,
    loadOnCreate: false,
    onEvent: (event) => events.push(event),
  })
  const task = board.create({ activity: 'chat', key: 'evt' }).task
  board.waiting(task.id)
  board.resume(task.id)
  board.complete(task.id, { ok: true })
  board.create({ activity: 'chat', key: 'evt' })
  board.create({})
  const types = events.map((event) => event.type)
  assert.deepEqual(types.slice(0, 6), [
    'task.created',
    'task.started',
    'task.waiting',
    'task.resumed',
    'task.completed',
    'task.duplicate',
  ])
  assert.equal(types[types.length - 1], 'task.rejected')
  for (const event of events) {
    assert.equal(typeof event.seq, 'number')
    assert.equal(typeof event.at, 'number')
  }
  const created = events[0]
  assert.equal(created.task.id, task.id)
  assert.equal(board.snapshot().recentEvents.length <= 10, true)
})

test('task-board B2：store 失败隔离与 flush', async () => {
  const errors = []
  const failing = createTaskBoard({
    now: () => 1000,
    maxRunning: 2,
    onError: (info) => errors.push(info),
    store: {
      load: () => null,
      save: () => {
        throw new Error('disk full')
      },
    },
  })
  const created = failing.create({ activity: 'chat' })
  assert.equal(created.ok, true, 'store 失败不阻塞任务板')
  assert.ok(failing.snapshot().store.saveErrors >= 1)
  assert.equal(errors[0].scope, 'store')

  // 异步 save 失败 → flush 后计数，不抛
  let asyncCalls = 0
  const asyncFailing = createTaskBoard({
    now: () => 1000,
    store: {
      load: () => null,
      save: () => {
        asyncCalls += 1
        return Promise.reject(new Error('async disk full'))
      },
    },
  })
  asyncFailing.create({ activity: 'chat' })
  await asyncFailing.flush()
  assert.equal(asyncCalls, 1)
  assert.equal(asyncFailing.snapshot().store.saveErrors, 1)
})

test('task-board B2：restore 非法快照与空快照', () => {
  const board = createTaskBoard({ now: () => 1000 })
  const invalid = board.restore({ v: 1 })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, TASK_BOARD_CODES.restoreFailed)
  const empty = board.restore(null)
  assert.equal(empty.ok, true)
  assert.equal(empty.restored, 0)
  assert.equal(board.snapshot().total, 0)
  // 事件里有 restored 汇总
  const restoredEvents = board.snapshot().recentEvents.filter((event) => event.type === 'task.restored')
  assert.equal(restoredEvents.length >= 1, true)
})

// ---------------------------------------------------------------------------
// Gate B3：Scheduler（lib/core/scheduler.mjs）——单前台/抢占/恢复/后台槽位/暂停/饥饿
// ---------------------------------------------------------------------------

/** 测试用最小 Task Board 适配器（只实现调度器需要的接口）。 */
function createFakeSchedulerBoard() {
  const tasks = new Map()
  let seq = 0
  const clone = (task) => (task === null || task === undefined ? null : { ...task })
  const add = (spec = {}) => {
    seq += 1
    const task = {
      id: 'ft-' + seq,
      activity: typeof spec.activity === 'string' ? spec.activity : 'background',
      kind: typeof spec.kind === 'string' ? spec.kind : '',
      priority: Number.isFinite(Number(spec.priority)) ? Number(spec.priority) : 0,
      status: typeof spec.status === 'string' ? spec.status : 'queued',
      owner: null,
      createdAt: Number.isFinite(Number(spec.createdAt)) ? Number(spec.createdAt) : seq,
      payload: null,
    }
    tasks.set(task.id, task)
    return clone(task)
  }
  return {
    add,
    tasks,
    list() {
      return [...tasks.values()].map(clone)
    },
    get(id) {
      return clone(tasks.get(id) ?? null)
    },
    claim(id, owner) {
      const task = tasks.get(id)
      if (task === undefined) return { ok: false, code: 'TASK_NOT_FOUND', message: 'missing' }
      if (task.status !== 'queued') return { ok: false, code: 'TASK_INVALID_TRANSITION', message: 'not queued' }
      task.status = 'running'
      task.owner = owner ?? null
      return { ok: true, task: clone(task) }
    },
    waiting(id) {
      const task = tasks.get(id)
      if (task === undefined || (task.status !== 'running' && task.status !== 'waiting')) {
        return { ok: false, code: 'TASK_INVALID_TRANSITION', message: 'cannot wait' }
      }
      task.status = 'waiting'
      return { ok: true, task: clone(task) }
    },
    resume(id) {
      const task = tasks.get(id)
      if (task === undefined || task.status !== 'waiting') {
        return { ok: false, code: 'TASK_INVALID_TRANSITION', message: 'cannot resume' }
      }
      task.status = 'running'
      return { ok: true, task: clone(task) }
    },
    complete(id) {
      const task = tasks.get(id)
      if (task === undefined) return { ok: false, message: 'missing' }
      task.status = 'done'
      return { ok: true, task: clone(task) }
    },
  }
}

test('scheduler B3：优先级选择与单前台', () => {
  const board = createFakeSchedulerBoard()
  const reading = board.add({ activity: 'reading' })
  const chat = board.add({ activity: 'chat' })
  const user = board.add({ activity: 'user' })
  const scheduler = createScheduler({ board, now: () => 1000 })
  const first = scheduler.tick()
  assert.equal(first.action, 'start')
  assert.equal(first.task.id, user.id, 'user 优先级最高')
  assert.equal(board.tasks.get(chat.id).status, 'queued')
  board.complete(user.id)
  assert.equal(scheduler.tick().task.id, chat.id, 'user 完成后轮到 chat')
  board.complete(chat.id)
  assert.equal(scheduler.tick().task.id, reading.id)
  board.complete(reading.id)
  const idle = scheduler.tick()
  assert.equal(idle.action, 'idle')
  assert.equal(idle.reason, 'no-task')
  assert.equal(scheduler.snapshot().metrics.starts, 3)
  assert.equal(scheduler.snapshot().foreground, null)

  assert.equal(priorityClassOf({ activity: 'user' }, DEFAULT_PRIORITY_CLASSES), 100)
  assert.ok(
    priorityClassOf({ activity: 'chat' }, DEFAULT_PRIORITY_CLASSES) >
      priorityClassOf({ activity: 'reading' }, DEFAULT_PRIORITY_CLASSES),
  )
  assert.equal(priorityClassOf({ activity: 'unknown' }, DEFAULT_PRIORITY_CLASSES), 0)
  assert.equal(resolvePriorityClasses({ user: 200 }).user, 200)
  assert.equal(SCHEDULER_VERSION, 1)
})

test('scheduler B3：抢占与恢复（任务不丢）', () => {
  const board = createFakeSchedulerBoard()
  const chat = board.add({ activity: 'chat' })
  const scheduler = createScheduler({ board, now: () => 1000 })
  assert.equal(scheduler.tick().task.id, chat.id)
  const user = board.add({ activity: 'user' })
  const preempt = scheduler.tick()
  assert.equal(preempt.action, 'preempt')
  assert.equal(preempt.task.id, user.id)
  assert.deepEqual(preempt.preempted, [chat.id])
  assert.equal(board.tasks.get(chat.id).status, 'waiting', '被抢占任务置 waiting（保留在任务板）')
  assert.equal(board.tasks.get(user.id).status, 'running')
  assert.equal(scheduler.snapshot().metrics.preemptions, 1)
  assert.deepEqual(scheduler.snapshot().preempted, [chat.id])

  board.complete(user.id)
  const resumed = scheduler.tick()
  assert.equal(resumed.action, 'resume')
  assert.equal(resumed.task.id, chat.id, '高优先级完成后自动恢复被抢占任务（re-claim）')
  assert.equal(board.tasks.get(chat.id).status, 'running')
  assert.equal(scheduler.snapshot().metrics.resumes, 1)
  assert.deepEqual(scheduler.snapshot().preempted, [])
})

test('scheduler B3：后台槽位限制，空闲才跑后台', () => {
  const board = createFakeSchedulerBoard()
  const bg1 = board.add({ activity: 'background' })
  const bg2 = board.add({ activity: 'background' })
  const scheduler = createScheduler({ board, now: () => 1000, maxBackground: 1 })
  const first = scheduler.tick()
  assert.equal(first.action, 'background')
  assert.equal(first.task.id, bg1.id)
  const second = scheduler.tick()
  assert.equal(second.action, 'idle', '后台槽位已满（maxBackground=1）')
  assert.equal(board.tasks.get(bg2.id).status, 'queued')

  // 前台到来：后台仍在跑，但前台优先启动
  const chat = board.add({ activity: 'chat' })
  const third = scheduler.tick()
  assert.equal(third.action, 'start')
  assert.equal(third.task.id, chat.id)
  assert.equal(scheduler.snapshot().background.length, 1, '后台任务不抢前台')
  assert.equal(board.tasks.get(bg2.id).status, 'queued')
})

test('scheduler B3：pauseAll / resumeAll（急停不丢任务）', () => {
  const board = createFakeSchedulerBoard()
  const chat = board.add({ activity: 'chat' })
  const scheduler = createScheduler({ board, now: () => 1000 })
  scheduler.tick()
  assert.equal(board.tasks.get(chat.id).status, 'running')
  const paused = scheduler.pauseAll()
  assert.equal(paused.ok, true)
  assert.equal(paused.paused, true)
  assert.deepEqual(paused.parked, [chat.id])
  assert.equal(board.tasks.get(chat.id).status, 'waiting', '急停默认 park 当前前台')
  assert.equal(scheduler.tick().action, 'paused', '暂停期间不调度')
  scheduler.resumeAll()
  const resumed = scheduler.tick()
  assert.equal(resumed.action, 'resume')
  assert.equal(resumed.task.id, chat.id)
  assert.equal(board.tasks.get(chat.id).status, 'running')
  assert.equal(scheduler.snapshot().metrics.parks, 1)
})

test('scheduler B3：饥饿检测（排队超过阈值）', () => {
  const board = createFakeSchedulerBoard()
  const running = board.add({ activity: 'chat', status: 'running' })
  const waitingForeground = board.add({ activity: 'chat' })
  let clock = 1000
  const scheduler = createScheduler({ board, now: () => clock, starvationMs: 100 })
  assert.equal(scheduler.tick().action, 'idle', '前台在跑，不抢占同类')
  clock = 1050
  assert.deepEqual(scheduler.tick().starved, [], '未到阈值')
  clock = 1120
  const starved = scheduler.tick().starved
  assert.equal(starved.length, 1)
  assert.equal(starved[0].id, waitingForeground.id)
  assert.ok(starved[0].waitedMs >= 100)
  assert.equal(scheduler.snapshot().starved.length, 1)
  board.complete(running.id)
  assert.equal(scheduler.tick().action, 'start')
  assert.equal(scheduler.tick().starved.length, 0, '被调度后不再饥饿')
})

test('scheduler B3：多前台归一化（保留最高优先级）', () => {
  const board = createFakeSchedulerBoard()
  const chat = board.add({ activity: 'chat', status: 'running' })
  const reading = board.add({ activity: 'reading', status: 'running' })
  const scheduler = createScheduler({ board, now: () => 1000 })
  const decision = scheduler.tick()
  assert.equal(decision.action, 'idle', '已有前台，无需 start')
  assert.equal(scheduler.snapshot().foreground.id, chat.id, '保留最高优先级前台')
  assert.equal(board.tasks.get(reading.id).status, 'waiting', '其余前台被置 waiting')
  assert.ok(scheduler.snapshot().metrics.preemptions >= 1)
})

test('scheduler B3：无任务与非法 board', () => {
  const board = createFakeSchedulerBoard()
  const scheduler = createScheduler({ board, now: () => 1000 })
  const idle = scheduler.tick()
  assert.equal(idle.ok, true)
  assert.equal(idle.action, 'idle')
  assert.equal(idle.reason, 'no-task')
  assert.equal(scheduler.snapshot().foreground, null)
  assert.equal(scheduler.snapshot().queue.length, 0)
  assert.throws(() => createScheduler({}), TypeError)
  assert.throws(() => createScheduler({ board: { list() {}, claim() {} } }), TypeError)
})

test('scheduler B3：与真实 Task Board 集成（单前台归一化→恢复不丢任务）', () => {
  // 监管器 maxRunning=2（Hub 建议 ≥2）：任务板可能自动起多个 running，调度器负责收敛为单前台。
  const board = createTaskBoard({ now: () => 1000, maxRunning: 2 })
  const scheduler = createScheduler({ board, now: () => 1000 })
  const chat = board.create({ activity: 'chat', key: 'chat-1' }).task
  const user = board.create({ activity: 'user', key: 'user-1' }).task
  assert.equal(chat.status, 'running')
  assert.equal(user.status, 'running', '监管器有空槽时自动起跑')

  const normalized = scheduler.tick()
  assert.equal(normalized.action, 'idle')
  assert.equal(scheduler.snapshot().foreground.id, user.id, '保留最高优先级作为唯一前台')
  assert.equal(board.get(chat.id).status, 'waiting', '其余前台置 waiting（任务不丢）')
  assert.ok(scheduler.snapshot().metrics.preemptions >= 1)

  board.complete(user.id, { ok: true })
  const resumed = scheduler.tick()
  assert.equal(resumed.action, 'resume')
  assert.equal(resumed.task.id, chat.id, '高优先级完成后自动恢复被抢占任务')
  assert.equal(board.get(chat.id).status, 'running')
  assert.equal(scheduler.snapshot().metrics.resumes, 1)
  assert.equal(SCHEDULER_CODES.claimFailed, 'SCHEDULER_CLAIM_FAILED')
})

// ---------------------------------------------------------------------------
// Gate B4：Activity Registry（lib/core/activity-registry.mjs）——manifest/启停/健康/权限查询
// ---------------------------------------------------------------------------

function makeActivityManifest(overrides = {}) {
  return {
    id: 'reading',
    version: '1.0.0',
    name: '读书',
    events: ['reading.started', 'reading.finished'],
    tasks: [{ kind: 'reading.read', goal: '读一章并留下笔记', priority: 30 }],
    tools: ['book.open', 'book.note'],
    permissions: ['fs.read:~/Books', 'model'],
    resources: { model: true, foreground: false, maxMinutes: 60 },
    ...overrides,
  }
}

test('activity-registry B4：合法注册与摘要/查询', () => {
  const events = []
  const registry = createActivityRegistry({ now: () => 1000, onEvent: (event) => events.push(event) })
  const result = registry.register(makeActivityManifest())
  assert.equal(result.ok, true)
  assert.equal(result.activity.id, 'reading')
  assert.equal(result.activity.enabled, false)
  assert.equal(result.activity.health, 'stopped')
  assert.equal(result.activity.schedulable, false)
  assert.deepEqual(
    result.activity.permissions.map((item) => item.permission),
    ['fs.read', 'model'],
  )
  assert.deepEqual(result.activity.permissions[0].label, '读取本机文件')
  assert.deepEqual(result.activity.resources, { model: true, foreground: false, maxMinutes: 60 })
  assert.deepEqual(result.activity.events, ['reading.started', 'reading.finished'])
  assert.equal(result.activity.tasks.length, 1)
  assert.equal(result.activity.tools.length, 2)

  assert.equal(registry.has('reading'), true)
  assert.equal(registry.isEnabled('reading'), false)
  assert.equal(registry.get('reading').version, '1.0.0')
  assert.equal(registry.get('missing'), null)
  assert.deepEqual(
    registry.list().map((item) => item.id),
    ['reading'],
  )
  const described = registry.describe('reading')
  assert.deepEqual(described.permissionStrings, ['fs.read:~/Books', 'model'])
  assert.equal(described.taskCount, 1)
  assert.equal(events[0].type, 'activity.registered')
  assert.equal(ACTIVITY_REGISTRY_VERSION, 1)
  assert.ok(ACTIVITY_REGISTRY_EVENTS.includes('activity.health'))
  assert.ok(ACTIVITY_HEALTH_STATES.includes('degraded'))
})

test('activity-registry B4：非法 manifest / 重复 id / 非法 adapter / 容量', () => {
  const registry = createActivityRegistry({ now: () => 1000, maxActivities: 2 })
  const invalid = registry.register({ id: 'x' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, ACTIVITY_REGISTRY_CODES.invalidManifest)
  assert.ok(Array.isArray(invalid.errors) && invalid.errors.length > 0)

  const unknownPermission = registry.register(makeActivityManifest({ permissions: ['fs.delete'] }))
  assert.equal(unknownPermission.ok, false)
  assert.equal(unknownPermission.code, ACTIVITY_REGISTRY_CODES.invalidManifest)

  assert.equal(registry.register(makeActivityManifest()).ok, true)
  const duplicate = registry.register(makeActivityManifest())
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, ACTIVITY_REGISTRY_CODES.duplicateId)

  const badAdapter = registry.register(makeActivityManifest({ id: 'bad-adapter' }), { start: 'nope' })
  assert.equal(badAdapter.ok, false)
  assert.equal(badAdapter.code, ACTIVITY_REGISTRY_CODES.invalidArgument)

  assert.equal(registry.register(makeActivityManifest({ id: 'chat' })).ok, true)
  const capacity = registry.register(makeActivityManifest({ id: 'mood' }))
  assert.equal(capacity.ok, false)
  assert.equal(capacity.code, ACTIVITY_REGISTRY_CODES.capacity)
  assert.equal(registry.snapshot().total, 2)
})

test('activity-registry B4：启停调用 adapter 且互相隔离', () => {
  const calls = []
  const errors = []
  const events = []
  const registry = createActivityRegistry({
    now: () => 1000,
    onEvent: (event) => events.push(event.type),
    onError: (info) => errors.push(info),
  })
  registry.register(makeActivityManifest(), {
    start: () => calls.push('reading.start'),
    stop: () => calls.push('reading.stop'),
  })
  registry.register(
    makeActivityManifest({
      id: 'chat',
      events: ['chat.started'],
      tasks: [{ kind: 'chat.reply', goal: '回复' }],
      tools: ['chat.send'],
      permissions: ['model'],
    }),
    {
      start: () => {
        calls.push('chat.start')
        throw new Error('chat start failed')
      },
      stop: () => calls.push('chat.stop'),
    },
  )

  const enabled = registry.enable('reading')
  assert.equal(enabled.ok, true)
  assert.equal(registry.isEnabled('reading'), true)
  assert.equal(registry.healthOf('reading'), 'healthy')
  assert.equal(registry.canSchedule('reading'), true)

  const failed = registry.enable('chat')
  assert.equal(failed.ok, false)
  assert.equal(failed.code, ACTIVITY_REGISTRY_CODES.adapterError)
  assert.equal(registry.isEnabled('chat'), false, '启动失败不置 enabled')
  assert.equal(registry.healthOf('chat'), 'error')
  assert.equal(errors.length, 1)

  // 一个失败不影响另一个
  assert.equal(registry.canSchedule('reading'), true)
  const disabled = registry.disable('reading')
  assert.equal(disabled.ok, true)
  assert.equal(registry.isEnabled('reading'), false)
  assert.equal(registry.healthOf('reading'), 'stopped')
  assert.deepEqual(calls, ['reading.start', 'chat.start', 'reading.stop'])
  for (const type of ['activity.enabled', 'activity.disabled', 'activity.error']) {
    assert.ok(events.includes(type), `应发出 ${type}`)
  }
  assert.equal(registry.disable('reading').already, true, '重复停用幂等')
  assert.equal(registry.enable('missing').code, ACTIVITY_REGISTRY_CODES.notFound)
})

test('activity-registry B4：健康探测（healthy/degraded/error/无 adapter）', async () => {
  const registry = createActivityRegistry({ now: () => 1000 })
  let probe = 'degraded'
  registry.register(
    makeActivityManifest({
      id: 'mood',
      events: ['mood.changed'],
      tasks: [{ kind: 'mood.refresh', goal: '刷新心情' }],
      tools: ['mood.refresh'],
      permissions: [],
    }),
    {
      health: () => ({ status: probe }),
    },
  )
  registry.register(
    makeActivityManifest({
      id: 'plain',
      events: ['plain.started'],
      tasks: [{ kind: 'plain.run', goal: '跑' }],
      tools: [],
      permissions: [],
    }),
  )

  assert.equal((await registry.refreshHealth('mood')).activity.health, 'stopped', '未启用时 stopped')
  registry.enable('mood')
  assert.equal((await registry.refreshHealth('mood')).activity.health, 'degraded')
  assert.equal(registry.canSchedule('mood'), true, 'degraded 仍可调度')
  probe = 'error'
  assert.equal((await registry.refreshHealth('mood')).activity.health, 'error')
  assert.equal(registry.canSchedule('mood'), false, 'error 不可调度')

  registry.enable('plain')
  assert.equal((await registry.refreshHealth('plain')).activity.health, 'healthy', '无 adapter.health → 启用即 healthy')
  const all = await registry.refreshAll()
  assert.equal(all.ok, true)
  assert.equal(all.results.length, 2)

  // health 抛错 → error + onError
  const errors = []
  const throwing = createActivityRegistry({ now: () => 1000, onError: (info) => errors.push(info) })
  throwing.register(
    makeActivityManifest({
      id: 'boom',
      events: ['boom.started'],
      tasks: [{ kind: 'boom.run', goal: '炸' }],
      tools: [],
      permissions: [],
    }),
    {
      health: () => {
        throw new Error('probe failed')
      },
    },
  )
  throwing.enable('boom')
  const probed = await throwing.refreshHealth('boom')
  assert.equal(probed.ok, false)
  assert.equal(throwing.healthOf('boom'), 'error')
  assert.equal(errors[0].scope, 'adapter')
})

test('activity-registry B4：禁用后不可调度；权限只查询不执行', () => {
  const registry = createActivityRegistry({ now: () => 1000 })
  registry.register(makeActivityManifest(), { start() {}, stop() {} })
  assert.equal(registry.canSchedule('reading'), false)
  registry.enable('reading')
  assert.equal(registry.canSchedule('reading'), true)

  const allowed = registry.checkPermission('reading', 'fs.read:~/Books/a.md')
  assert.equal(allowed.ok, true)
  assert.equal(allowed.allowed, true)
  assert.equal(allowed.reason, 'granted')
  const denied = registry.checkPermission('reading', 'fs.write:~/Books/a.md')
  assert.equal(denied.allowed, false)
  assert.equal(denied.reason, 'not-granted')
  const invalid = registry.checkPermission('reading', 'nope')
  assert.equal(invalid.allowed, false)
  assert.equal(invalid.reason, 'invalid-permission')
  assert.equal(registry.checkPermission('missing', 'model').code, ACTIVITY_REGISTRY_CODES.notFound)
  // 查询不改变启停状态（不执行权限判定）
  assert.equal(registry.isEnabled('reading'), true)

  registry.disable('reading')
  assert.equal(registry.canSchedule('reading'), false, '禁用后不可调度')
  assert.equal(registry.checkPermission('reading', 'fs.read:~/Books').allowed, true, '禁用不影响权限查询')
})

test('activity-registry B4：异步 adapter（start/health 的 Promise）与 flush', async () => {
  const registry = createActivityRegistry({ now: () => 1000 })
  registry.register(
    makeActivityManifest({
      id: 'async-ok',
      events: ['async.ok'],
      tasks: [{ kind: 'async.ok', goal: '异步成功' }],
      tools: [],
      permissions: [],
    }),
    {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      health: () => Promise.resolve('healthy'),
    },
  )
  assert.equal(registry.enable('async-ok').ok, true)
  await registry.flush()
  assert.equal(registry.healthOf('async-ok'), 'healthy')
  assert.equal((await registry.refreshHealth('async-ok')).activity.health, 'healthy')

  registry.register(
    makeActivityManifest({
      id: 'async-fail',
      events: ['async.fail'],
      tasks: [{ kind: 'async.fail', goal: '异步失败' }],
      tools: [],
      permissions: [],
    }),
    {
      start: () => Promise.reject(new Error('async start failed')),
    },
  )
  assert.equal(registry.enable('async-fail').ok, true, '异步启动先乐观置 enabled')
  await registry.flush()
  assert.equal(registry.isEnabled('async-fail'), false, '异步失败后回滚 enabled')
  assert.equal(registry.healthOf('async-fail'), 'error')
})

test('activity-registry B4：注销活动（启用中先 stop）与重新注册', () => {
  const calls = []
  const events = []
  const registry = createActivityRegistry({ now: () => 1000, onEvent: (event) => events.push(event.type) })
  registry.register(makeActivityManifest(), {
    start: () => calls.push('start'),
    stop: () => calls.push('stop'),
  })
  registry.enable('reading')
  const removed = registry.unregister('reading')
  assert.equal(removed.ok, true)
  assert.equal(removed.activity.enabled, false)
  assert.deepEqual(calls, ['start', 'stop'], '注销前先停用')
  assert.equal(registry.has('reading'), false)
  assert.equal(registry.unregister('reading').code, ACTIVITY_REGISTRY_CODES.notFound)
  assert.ok(events.includes('activity.unregistered'))
  // 重新注册同一 id 允许
  assert.equal(registry.register(makeActivityManifest()).ok, true)
  assert.equal(registry.snapshot().total, 1)
})

test('activity-registry B4：事件回调抛错隔离与 snapshot 指标', () => {
  const registry = createActivityRegistry({
    now: () => 1000,
    onEvent: () => {
      throw new Error('listener boom')
    },
  })
  assert.equal(registry.register(makeActivityManifest()).ok, true, 'onEvent 抛错不影响注册')
  assert.equal(registry.enable('reading').ok, true)
  const snapshot = registry.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.total, 1)
  assert.equal(snapshot.enabled, 1)
  assert.equal(snapshot.byHealth.healthy, 1)
  assert.equal(snapshot.maxActivities > 0, true)
  assert.equal(typeof snapshot.metrics.registered, 'number')
  assert.equal(typeof snapshot.metrics.startCalls, 'number')
  assert.equal(snapshot.activities.length, 1)
  assert.equal(snapshot.recentEvents.length <= 10, true)
})

// ---------------------------------------------------------------------------
// Gate B5：Hub 控制 API（lib/core/hub-control-api.mjs）——只读快照/任务控制/活动控制/错误分支
// ---------------------------------------------------------------------------

function makeHubControl(options = {}) {
  const board = createTaskBoard({ now: () => 1000, maxRunning: options.maxRunning ?? 2 })
  const registry = createActivityRegistry({ now: () => 1000 })
  const eventBus = createEventBus({ maxEvents: 100, maxReplay: 10 })
  const scheduler = createScheduler({ board, now: () => 1000 })
  const control = createHubControlApi({ scheduler, taskBoard: board, registry, eventBus, ...options })
  return { board, registry, eventBus, scheduler, control }
}

test('hub-control B5：只读快照（四层指标）与 capabilities', () => {
  const { board, registry, eventBus, control } = makeHubControl()
  const task = board.create({ activity: 'chat', key: 'c1' }).task
  registry.register(makeActivityManifest({ id: 'reading', events: ['reading.started'] }))
  eventBus.append({
    id: 'evt-hub-0001',
    activity: 'chat',
    type: 'chat.message.received',
    version: 1,
    at: 1000,
    subject: 's1',
    payload: {},
  })
  const before = JSON.stringify(board.snapshot())
  const snapshot = control.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.data.available.scheduler, true)
  assert.equal(snapshot.data.available.taskBoard, true)
  assert.equal(snapshot.data.available.registry, true)
  assert.equal(snapshot.data.available.eventBus, true)
  assert.equal(snapshot.data.tasks.total, 1)
  assert.equal(snapshot.data.activities.total, 1)
  assert.equal(snapshot.data.events.stored, 1)
  assert.equal(snapshot.data.paused, false)
  assert.equal(JSON.stringify(board.snapshot()), before, 'snapshot 只读，不改变任务板')

  const capabilities = control.capabilities()
  assert.equal(capabilities.ok, true)
  assert.equal(capabilities.data.version, HUB_CONTROL_VERSION)
  assert.deepEqual(capabilities.data.methods.control.includes('pauseTask'), true)
  assert.deepEqual(capabilities.data.methods.read.includes('snapshot'), true)
  assert.equal(task.id, 'tb-1')
  assert.ok(HUB_CONTROL_TASK_STATUSES.includes('waiting'))
  assert.ok(HUB_CONTROL_ACTIVITY_HEALTH.includes('degraded'))
})

test('hub-control B5：listTasks/getTask 过滤与错误分支', () => {
  const { board, control } = makeHubControl()
  const chat = board.create({ activity: 'chat', key: 'c1', priority: 5 }).task
  const reading = board.create({ activity: 'reading', key: 'r1', priority: 1 }).task
  board.waiting(reading.id)

  const all = control.listTasks()
  assert.equal(all.ok, true)
  assert.equal(all.data.total, 2)
  assert.equal(control.listTasks({ status: 'waiting' }).data.tasks[0].id, reading.id)
  assert.equal(control.listTasks({ activity: 'chat' }).data.total, 1)
  assert.equal(control.listTasks({ sort: 'created', limit: 1 }).data.total, 1)

  assert.equal(control.getTask(chat.id).ok, true)
  assert.equal(control.getTask('missing').error.code, HUB_CONTROL_CODES.notFound)
  assert.equal(control.getTask('').error.code, HUB_CONTROL_CODES.invalidArgument)
  assert.equal(control.listTasks({ status: 'bogus' }).error.code, HUB_CONTROL_CODES.invalidFilter)
  assert.equal(control.listTasks({ sort: 'bogus' }).error.code, HUB_CONTROL_CODES.invalidFilter)
  assert.equal(control.listTasks({ limit: 0 }).error.code, HUB_CONTROL_CODES.invalidFilter)
})

test('hub-control B5：任务控制 pause/resume/cancel 与状态错误', () => {
  const { board, control } = makeHubControl({ maxRunning: 1 })
  const chat = board.create({ activity: 'chat', key: 'c1' }).task
  assert.equal(chat.status, 'running')
  const queued = board.create({ activity: 'chat', key: 'c2' }).task
  assert.equal(queued.status, 'queued')

  const paused = control.pauseTask(chat.id)
  assert.equal(paused.ok, true)
  assert.equal(board.get(chat.id).status, 'waiting')
  const resumed = control.resumeTask(chat.id)
  assert.equal(resumed.ok, true)
  assert.equal(board.get(chat.id).status, 'running')

  // 非法状态：pause 一个 queued 任务 → 透传任务板错误码
  const invalid = control.pauseTask(queued.id)
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'TASK_INVALID_TRANSITION')
  assert.equal(typeof invalid.error.message, 'string')

  const cancelled = control.cancelTask(chat.id, '控制面取消')
  assert.equal(cancelled.ok, true)
  assert.equal(board.get(chat.id).status, 'cancelled')
  // 重复取消：任务板幂等返回 already（统一包装仍 ok）
  assert.equal(control.cancelTask(chat.id).ok, true)
  assert.equal(control.pauseTask('missing').error.code, 'TASK_BOARD_NOT_FOUND', '依赖错误码原样透传')
  assert.equal(control.pauseTask('').error.code, HUB_CONTROL_CODES.invalidArgument)
})

test('hub-control B5：活动控制 enable/disable/list 与错误分支', () => {
  const calls = []
  const { registry, control } = makeHubControl()
  registry.register(makeActivityManifest({ id: 'reading', events: ['reading.started'] }), {
    start: () => calls.push('start'),
    stop: () => calls.push('stop'),
  })
  assert.equal(control.listActivities().data.total, 1)
  const enabled = control.enableActivity('reading')
  assert.equal(enabled.ok, true)
  assert.equal(enabled.data.activity.enabled, true)
  assert.equal(control.listActivities({ enabled: true }).data.total, 1)
  const disabled = control.disableActivity('reading')
  assert.equal(disabled.ok, true)
  assert.equal(control.listActivities({ enabled: true }).data.total, 0)
  assert.deepEqual(calls, ['start', 'stop'])

  assert.equal(control.enableActivity('missing').error.code, 'ACTIVITY_NOT_FOUND', '依赖错误码原样透传')
  assert.equal(control.disableActivity('').error.code, HUB_CONTROL_CODES.invalidArgument)
  assert.equal(control.listActivities({ health: 'bogus' }).error.code, HUB_CONTROL_CODES.invalidFilter)
  assert.equal(control.listActivities({ enabled: 'yes' }).error.code, HUB_CONTROL_CODES.invalidFilter)
})

test('hub-control B5：权限查询（allowed/denied）', () => {
  const { registry, control } = makeHubControl()
  registry.register(makeActivityManifest({ id: 'reading' }))
  const allowed = control.checkPermission('reading', 'fs.read:~/Books/a.md')
  assert.equal(allowed.ok, true)
  assert.equal(allowed.data.allowed, true)
  assert.equal(allowed.data.reason, 'granted')
  const denied = control.checkPermission('reading', 'fs.write:~/Books/a.md')
  assert.equal(denied.ok, true)
  assert.equal(denied.data.allowed, false)
  assert.equal(denied.data.reason, 'not-granted')
  assert.equal(control.checkPermission('missing', 'model').error.code, 'ACTIVITY_NOT_FOUND', '依赖错误码原样透传')
  assert.equal(control.checkPermission('', 'model').error.code, HUB_CONTROL_CODES.invalidArgument)
})

test('hub-control B5：pauseAll / resumeAll（全局急停）', () => {
  const { board, scheduler, control } = makeHubControl()
  const chat = board.create({ activity: 'chat', key: 'c1' }).task
  scheduler.tick()
  const paused = control.pauseAll()
  assert.equal(paused.ok, true)
  assert.equal(paused.data.paused, true)
  assert.equal(control.snapshot().data.paused, true)
  assert.equal(board.get(chat.id).status, 'waiting', '急停 park 当前前台')
  assert.equal(control.resumeAll().data.paused, false)
  const ticked = scheduler.tick()
  assert.equal(ticked.action, 'resume')
  assert.equal(board.get(chat.id).status, 'running')
})

test('hub-control B5：依赖缺失/形态非法/快照异常', () => {
  const empty = createHubControlApi({})
  const snapshot = empty.snapshot()
  assert.equal(snapshot.ok, true)
  assert.deepEqual(snapshot.data.available, { scheduler: false, taskBoard: false, registry: false, eventBus: false })
  assert.equal(empty.listTasks().error.code, HUB_CONTROL_CODES.notReady)
  assert.equal(empty.pauseTask('x').error.code, HUB_CONTROL_CODES.notReady)
  assert.equal(empty.enableActivity('x').error.code, HUB_CONTROL_CODES.notReady)
  assert.equal(empty.pauseAll().error.code, HUB_CONTROL_CODES.notReady)
  assert.equal(empty.checkPermission('x', 'model').error.code, HUB_CONTROL_CODES.notReady)

  assert.throws(() => createHubControlApi({ taskBoard: { list() {} } }), TypeError)
  assert.throws(() => createHubControlApi({ scheduler: 'nope' }), TypeError)

  // 依赖 snapshot 抛错：快照仍返回 ok，对应层 available:false 并带 error
  const broken = createHubControlApi({
    taskBoard: {
      snapshot() {
        throw new Error('boom')
      },
      list: () => [],
      get: () => null,
      waiting: () => ({ ok: false }),
      resume: () => ({ ok: false }),
      cancel: () => ({ ok: false }),
    },
  })
  const brokenSnapshot = broken.snapshot()
  assert.equal(brokenSnapshot.ok, true)
  assert.equal(brokenSnapshot.data.available.taskBoard, true)
  assert.equal(brokenSnapshot.data.tasks, null)
  assert.equal(brokenSnapshot.data.errors[0].code, HUB_CONTROL_CODES.dependencyError)
})

test('hub-control B5：flush 等待异步 adapter，统一返回形状', async () => {
  const { registry, control } = makeHubControl()
  registry.register(
    makeActivityManifest({
      id: 'async',
      events: ['async.started'],
      tasks: [{ kind: 'async.run', goal: '异步' }],
      tools: [],
      permissions: [],
    }),
    {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
  )
  control.enableActivity('async')
  const flushed = await control.flush()
  assert.equal(flushed.ok, true)
  assert.equal(flushed.data.flushed, 2, 'taskBoard + registry 各一个 flush')

  const results = [
    control.snapshot(),
    control.listTasks(),
    control.listActivities(),
    control.capabilities(),
    control.pauseAll(),
    control.resumeAll(),
  ]
  for (const result of results) {
    assert.equal(typeof result.ok, 'boolean')
    if (result.ok === true) assert.ok('data' in result)
    else assert.equal(typeof result.error.code, 'string')
  }
})

// ---------------------------------------------------------------------------
// Gate C1：Memory Gateway（lib/core/memory-gateway.mjs）——统一读写/来源/合并/冲突/隔离
// ---------------------------------------------------------------------------

function makeMemoryFixture(options = {}) {
  let clock = 1000
  const gateway = createMemoryGateway({ now: () => clock, ...options })
  const journal = createInMemoryMemoryProvider({ id: 'journal', kind: 'journal' })
  const topics = createInMemoryMemoryProvider({ id: 'topics', kind: 'topics' })
  gateway.registerProvider(journal)
  gateway.registerProvider(topics)
  return {
    gateway,
    journal,
    topics,
    advance(ms) {
      clock += ms
    },
    now() {
      return clock
    },
  }
}

function memoryEntry(overrides = {}) {
  return {
    category: 'episodic',
    topic: 'park',
    text: '今天在公园走了很久。',
    source: { kind: 'activity', id: 'chat', activity: 'chat' },
    confidence: 0.6,
    provenance: { activity: 'chat', taskId: 'tb-1', at: 1000 },
    ...overrides,
  }
}

test('memory-gateway C1：provider 注册校验与列表', () => {
  const gateway = createMemoryGateway({ now: () => 1000 })
  const journal = createInMemoryMemoryProvider({ id: 'journal' })
  assert.equal(gateway.registerProvider(journal).ok, true)
  assert.equal(gateway.registerProvider(journal).code, MEMORY_GATEWAY_CODES.duplicateProvider)
  assert.equal(gateway.registerProvider({ id: '' }).ok, false)
  // 可读但无 read/query
  assert.equal(gateway.registerProvider({ id: 'bad-read', permissions: { read: true } }).ok, false)
  // 声明写权限但没有 write 函数
  assert.equal(
    gateway.registerProvider({ id: 'bad-write', read: () => [], permissions: { read: true, write: true } }).ok,
    false,
  )
  // 默认只读：permissions 未声明时 write=false
  const readOnly = gateway.registerProvider({ id: 'read-only', read: () => [] })
  assert.equal(readOnly.ok, true)
  assert.equal(readOnly.provider.permissions.write, false)
  assert.equal(readOnly.provider.writable, false)
  const providers = gateway.listProviders()
  assert.deepEqual(
    providers.map((item) => item.id),
    ['journal', 'read-only'],
  )
  assert.equal(gateway.unregisterProvider('journal').ok, true)
  assert.equal(gateway.unregisterProvider('journal').code, MEMORY_GATEWAY_CODES.unknownProvider)
  assert.equal(gateway.snapshot().providers.length, 1)
  assert.equal(MEMORY_GATEWAY_VERSION, 1)
  assert.ok(MEMORY_CATEGORIES.includes('episodic'))
  assert.ok(MEMORY_STATUSES.includes('conflicted'))
})

test('memory-gateway C1：写入/查询保留来源与 provenance', async () => {
  const { gateway, journal } = makeMemoryFixture()
  const written = await gateway.write(memoryEntry())
  assert.equal(written.ok, true)
  assert.equal(written.entry.status, 'active')
  assert.equal(written.entry.id, 'mem-1')
  assert.deepEqual(written.entry.source, { kind: 'activity', id: 'chat', activity: 'chat' })
  assert.equal(written.entry.provenance.taskId, 'tb-1')
  assert.deepEqual(written.entry.sources, [{ kind: 'activity', id: 'chat', activity: 'chat' }])
  assert.equal(journal.snapshot().entries, 1, '写入落到 provider')

  const result = await gateway.query({ text: '公园' })
  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].text, '今天在公园走了很久。')
  assert.equal(result.entries[0].provenance.activity, 'chat')
  assert.deepEqual(result.entries[0].providers, ['journal'])
  assert.equal(result.entries[0].score > 0, true)

  const snapshot = gateway.snapshot()
  assert.equal(snapshot.entries, 1)
  assert.equal(snapshot.byCategory.episodic, 1)
  assert.equal(snapshot.byStatus.active, 1)
  assert.equal(snapshot.metrics.writes, 1)
  assert.equal(snapshot.metrics.queries, 1)
})

test('memory-gateway C1：非法 entry 校验（分类/文本/来源/置信度 clamp）', async () => {
  const { gateway } = makeMemoryFixture()
  const badCategory = await gateway.write(memoryEntry({ category: 'nope' }))
  assert.equal(badCategory.code, MEMORY_GATEWAY_CODES.unknownCategory)
  const badText = await gateway.write(memoryEntry({ text: '   ' }))
  assert.equal(badText.code, MEMORY_GATEWAY_CODES.invalidEntry)
  const badSource = await gateway.write(memoryEntry({ source: null }))
  assert.equal(badSource.code, MEMORY_GATEWAY_CODES.invalidEntry)
  const notObject = await gateway.write(null)
  assert.equal(notObject.code, MEMORY_GATEWAY_CODES.invalidEntry)
  // confidence clamp 到 0..1
  const low = await gateway.write(memoryEntry({ topic: 'low', text: '低置信度', confidence: -3 }))
  assert.equal(low.entry.confidence, 0)
  const high = await gateway.write(memoryEntry({ topic: 'high', text: '高置信度', confidence: 9 }))
  assert.equal(high.entry.confidence, 1)
  assert.equal(gateway.snapshot().metrics.invalid, 4)
})

test('memory-gateway C1：权限拒绝与无写 provider', async () => {
  const gateway = createMemoryGateway({ now: () => 1000 })
  const readOnly = createInMemoryMemoryProvider({ id: 'readonly', permissions: { read: true, write: false } })
  gateway.registerProvider(readOnly)
  const denied = await gateway.write(memoryEntry({ provider: 'readonly' }))
  assert.equal(denied.ok, false)
  assert.equal(denied.code, MEMORY_GATEWAY_CODES.permissionDenied)
  assert.equal(gateway.snapshot().metrics.permissionDenied, 1)

  const noWritable = await gateway.write(memoryEntry())
  assert.equal(noWritable.code, MEMORY_GATEWAY_CODES.noWritableProvider)
  const unknown = await gateway.write(memoryEntry({ provider: 'missing' }))
  assert.equal(unknown.code, MEMORY_GATEWAY_CODES.unknownProvider)

  // 指定可写 provider
  const writable = createInMemoryMemoryProvider({ id: 'writable' })
  gateway.registerProvider(writable)
  const written = await gateway.write(memoryEntry({ provider: 'writable' }))
  assert.equal(written.ok, true)
  assert.equal(written.entry.provider, 'writable')
})

test('memory-gateway C1：同主题重复合并（保留来源/时间/最高置信度）', async () => {
  const { gateway, advance } = makeMemoryFixture()
  const first = await gateway.write(memoryEntry({ confidence: 0.4 }))
  advance(10)
  const second = await gateway.write(
    memoryEntry({
      confidence: 0.9,
      source: { kind: 'journal', id: 'j-1', activity: 'reading' },
      provenance: { activity: 'reading', taskId: 'tb-2', at: 2000 },
    }),
  )
  assert.equal(second.ok, true)
  assert.equal(second.duplicate, true)
  assert.equal(second.merged, true)
  assert.equal(second.entry.id, first.entry.id, '合并到同一条目')
  assert.equal(second.entry.confidence, 0.9)
  assert.equal(second.entry.sources.length, 2, '来源合并保留')
  assert.equal(second.entry.provenance.activity, 'reading', 'provenance 更新为最新')
  assert.equal(second.entry.updatedAt, 1010)
  assert.equal(gateway.snapshot().entries, 1)
  assert.equal(gateway.snapshot().metrics.merges, 1)
})

test('memory-gateway C1：冲突不静默覆盖，返回 conflict 记录；高置信度 supersede', async () => {
  const { gateway } = makeMemoryFixture()
  await gateway.write(memoryEntry({ text: '今天在公园走了很久。', confidence: 0.6 }))
  const conflict = await gateway.write(memoryEntry({ text: '今天没有去公园。', confidence: 0.5 }))
  assert.equal(conflict.ok, true)
  assert.equal(typeof conflict.conflict, 'object')
  assert.equal(conflict.conflict.resolution, 'kept-existing')
  assert.equal(conflict.entry.status, 'conflicted')
  const entries = await gateway.query({})
  const active = entries.entries.filter((entry) => entry.status === 'active')
  const conflicted = entries.entries.filter((entry) => entry.status === 'conflicted')
  assert.equal(active.length, 1, '原条目不被覆盖')
  assert.equal(conflicted.length, 1)
  assert.equal(conflicted[0].conflictWith, active[0].id)
  assert.equal(gateway.snapshot().conflicts, 1)
  assert.equal(gateway.listConflicts()[0].resolution, 'kept-existing')

  // 高置信度（差值 ≥ supersedeMargin 0.2）→ 旧条目 superseded，新条目 active
  const supersede = await gateway.write(memoryEntry({ text: '今天根本没出门。', confidence: 0.95 }))
  assert.equal(supersede.ok, true)
  assert.equal(supersede.superseded, true)
  assert.equal(supersede.conflict.resolution, 'superseded')
  assert.equal(supersede.entry.status, 'active')
  const after = await gateway.query({})
  const statuses = after.entries.map((entry) => entry.status).sort()
  assert.deepEqual(statuses, ['active', 'conflicted', 'superseded'])
  assert.equal(gateway.snapshot().metrics.superseded, 1)
  assert.equal(gateway.snapshot().byStatus.superseded, 1)
})

test('memory-gateway C1：多 provider 聚合/去重/排序/过滤/limit', async () => {
  const gateway = createMemoryGateway({ now: () => 1000 })
  const entryA = {
    id: 'shared-1',
    category: 'episodic',
    topic: 'a',
    text: '公园里的樱花开了。',
    source: { kind: 'journal', id: 'j1' },
    provenance: { activity: 'chat', at: 1000 },
    confidence: 0.5,
    status: 'active',
    createdAt: 1000,
    updatedAt: 1000,
    sources: [],
    tags: [],
  }
  const entryB = { ...entryA, text: '今天没有去公园。', topic: 'b', id: 'only-b', updatedAt: 2000 }
  const entryC = { ...entryA, id: 'only-c', text: '公园长椅上坐了一会儿。', topic: 'c', updatedAt: 1500 }
  const p1 = createInMemoryMemoryProvider({ id: 'p1', entries: [entryA, entryB] })
  const p2 = createInMemoryMemoryProvider({ id: 'p2', entries: [entryA, entryC] })
  gateway.registerProvider(p1)
  gateway.registerProvider(p2)

  const all = await gateway.query({})
  assert.equal(all.ok, true)
  assert.equal(all.entries.length, 3, '按 id 去重（shared-1 只出现一次）')
  const shared = all.entries.find((entry) => entry.id === 'shared-1')
  assert.deepEqual(shared.providers.sort(), ['p1', 'p2'], '去重时记录来源 provider')
  // 相关度排序：唯一含「樱花」的条目排第一
  const byText = await gateway.query({ text: '樱花' })
  assert.equal(byText.entries.length, 1)
  assert.equal(byText.entries[0].id, 'shared-1')
  assert.ok(byText.entries[0].score > 0)
  // 时间倒序（read 别名）
  const readResult = await gateway.read({})
  assert.equal(readResult.entries[0].id, 'only-b')
  // 过滤与 limit
  assert.equal((await gateway.query({ category: 'semantic' })).entries.length, 0)
  assert.equal((await gateway.query({ activity: 'chat' })).entries.length, 3)
  assert.equal((await gateway.query({ provider: 'p2' })).entries.length, 2)
  assert.equal((await gateway.query({ limit: 2 })).entries.length, 2)
  assert.equal((await gateway.query({ category: 'nope' })).code, MEMORY_GATEWAY_CODES.invalidFilter)
})

test('memory-gateway C1：provider 失败隔离（写失败/查询失败不影响其他 provider）', async () => {
  const gateway = createMemoryGateway({ now: () => 1000 })
  const good = createInMemoryMemoryProvider({ id: 'good' })
  gateway.registerProvider(good)
  gateway.registerProvider({
    id: 'broken',
    permissions: { read: true, write: true },
    read: () => {
      throw new Error('read boom')
    },
    write: () => {
      throw new Error('write boom')
    },
  })
  // 写：默认第一个可写 provider 是 good（注册顺序），指定 broken → 失败但不写坏
  const failed = await gateway.write(memoryEntry({ provider: 'broken' }))
  assert.equal(failed.ok, false)
  assert.equal(failed.code, MEMORY_GATEWAY_CODES.providerError)
  assert.equal(gateway.snapshot().entries, 0, '写失败不进入索引')
  assert.equal(gateway.snapshot().metrics.providerErrors, 1)
  const okWrite = await gateway.write(memoryEntry())
  assert.equal(okWrite.ok, true, '其他 provider 仍可写')

  // 查询：broken 抛错被隔离，good 的结果仍返回
  const queried = await gateway.query({})
  assert.equal(queried.ok, true)
  assert.equal(queried.entries.length, 1)
  assert.equal(queried.errors.length, 1)
  assert.equal(queried.errors[0].provider, 'broken')
  assert.equal(gateway.snapshot().metrics.providerErrors, 2)
})

test('memory-gateway C1：异步 provider（write/query 返回 Promise）', async () => {
  const gateway = createMemoryGateway({ now: () => 1000 })
  const store = new Map()
  gateway.registerProvider({
    id: 'async',
    kind: 'async-store',
    permissions: { read: true, write: true },
    async write(entry) {
      await Promise.resolve()
      store.set(entry.id, entry)
      return { ok: true }
    },
    async query() {
      await Promise.resolve()
      return [...store.values()]
    },
  })
  const written = await gateway.write(memoryEntry())
  assert.equal(written.ok, true)
  assert.equal(store.size, 1)
  const queried = await gateway.query({ text: '公园' })
  assert.equal(queried.entries.length, 1)
  assert.equal(queried.entries[0].id, written.entry.id)
})

test('memory-gateway C1：getEntry / listConflicts / snapshot 指标', async () => {
  const { gateway } = makeMemoryFixture()
  const written = await gateway.write(memoryEntry())
  assert.equal(gateway.getEntry(written.entry.id).text, '今天在公园走了很久。')
  assert.equal(gateway.getEntry('missing'), null)
  await gateway.write(memoryEntry({ text: '另一条不同的话。', confidence: 0.5 }))
  const conflicts = gateway.listConflicts({ category: 'episodic' })
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].category, 'episodic')
  const snapshot = gateway.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.version, MEMORY_GATEWAY_VERSION)
  assert.equal(typeof snapshot.metrics.writes, 'number')
  assert.equal(typeof snapshot.metrics.conflicts, 'number')
  assert.equal(snapshot.providers.length, 2)
  assert.equal(snapshot.limits.supersedeMargin, 0.2)
  assert.equal(snapshot.recentConflicts.length, 1)
})

// ---------------------------------------------------------------------------
// Gate C2：Feedback Ledger（lib/core/feedback-ledger.mjs）——假设/实验/回执/结论/方法候选
// ---------------------------------------------------------------------------

function feedbackReceipt(overrides = {}) {
  return { kind: 'tool', at: 1000, ref: 'run-1', ok: true, ...overrides }
}

function feedbackInput(overrides = {}) {
  return {
    taskId: 'tb-1',
    hypothesis: '先看日志再改代码',
    experiment: '对失败任务先读日志',
    receipt: feedbackReceipt(),
    outcome: 'success',
    evidence: ['日志显示 401', '改 token 后成功'],
    ...overrides,
  }
}

test('feedback-ledger C2：成功/失败/不确定记录与查询', () => {
  let clock = 1000
  const ledger = createFeedbackLedger({ now: () => clock })
  const success = ledger.record(feedbackInput())
  assert.equal(success.ok, true)
  assert.equal(success.record.outcome, 'success')
  assert.equal(success.record.id, 'fb-1')
  clock += 10
  const failure = ledger.record(
    feedbackInput({
      taskId: 'tb-2',
      experiment: '直接改代码',
      outcome: 'failure',
      receipt: feedbackReceipt({ ref: 'run-2', ok: false }),
    }),
  )
  assert.equal(failure.ok, true)
  clock += 10
  const inconclusive = ledger.record(
    feedbackInput({
      taskId: 'tb-3',
      experiment: '问用户',
      outcome: 'inconclusive',
      receipt: feedbackReceipt({ ref: 'run-3' }),
    }),
  )
  assert.equal(inconclusive.ok, true)

  const snapshot = ledger.snapshot()
  assert.equal(snapshot.records, 3)
  assert.deepEqual(snapshot.byOutcome, { success: 1, failure: 1, inconclusive: 1 })
  assert.equal(snapshot.metrics.failures, 1, '失败记录保留')
  assert.equal(snapshot.version, FEEDBACK_LEDGER_VERSION)
  assert.equal(ledger.list({ outcome: 'failure' })[0].taskId, 'tb-2')
  assert.equal(ledger.list({ taskId: 'tb-3' }).length, 1)
  assert.equal(ledger.list({ limit: 1 }).length, 1)
  assert.equal(ledger.get(success.record.id).outcome, 'success')
  assert.equal(ledger.get('missing'), null)
  assert.ok(FEEDBACK_OUTCOMES.includes('inconclusive'))
  assert.ok(FEEDBACK_RECEIPT_KINDS.includes('tool'))
})

test('feedback-ledger C2：receipt 缺失/不可验证被拒绝', () => {
  const ledger = createFeedbackLedger({ now: () => 1000 })
  const missing = ledger.record(feedbackInput({ receipt: undefined }))
  assert.equal(missing.code, FEEDBACK_LEDGER_CODES.invalidReceipt)
  const badKind = ledger.record(feedbackInput({ receipt: feedbackReceipt({ kind: 'nope' }) }))
  assert.equal(badKind.code, FEEDBACK_LEDGER_CODES.invalidReceipt)
  const badAt = ledger.record(feedbackInput({ receipt: feedbackReceipt({ at: 0 }) }))
  assert.equal(badAt.code, FEEDBACK_LEDGER_CODES.invalidReceipt)
  const noRef = ledger.record(feedbackInput({ receipt: { kind: 'tool', at: 1000, ok: true } }))
  assert.equal(noRef.code, FEEDBACK_LEDGER_CODES.invalidReceipt)
  const badOk = ledger.record(feedbackInput({ receipt: feedbackReceipt({ ok: 'yes' }) }))
  assert.equal(badOk.code, FEEDBACK_LEDGER_CODES.invalidReceipt)
  assert.equal(ledger.snapshot().metrics.invalid, 5)

  const valid = validateReceipt(feedbackReceipt({ detail: 'ok' }))
  assert.equal(valid.ok, true)
  assert.equal(valid.receipt.ref, 'run-1')
  assert.equal(validateReceipt('string').ok, false)
})

test('feedback-ledger C2：非法输入与 evidence 归一化', () => {
  const ledger = createFeedbackLedger({ now: () => 1000 })
  assert.equal(ledger.record(null).code, FEEDBACK_LEDGER_CODES.invalidRecord)
  assert.equal(ledger.record(feedbackInput({ taskId: '' })).code, FEEDBACK_LEDGER_CODES.invalidRecord)
  assert.equal(ledger.record(feedbackInput({ hypothesis: ' ' })).code, FEEDBACK_LEDGER_CODES.invalidRecord)
  assert.equal(ledger.record(feedbackInput({ experiment: '' })).code, FEEDBACK_LEDGER_CODES.invalidRecord)
  assert.equal(ledger.record(feedbackInput({ outcome: 'maybe' })).code, FEEDBACK_LEDGER_CODES.invalidOutcome)
  assert.equal(ledger.record(feedbackInput({ evidence: 'not-array' })).code, FEEDBACK_LEDGER_CODES.invalidRecord)
  // evidence：字符串/对象混合归一化，空文本丢弃
  const recorded = ledger.record(
    feedbackInput({
      evidence: ['日志显示 401', { text: '改 token 后成功', source: 'tool', at: 1000 }, { text: '   ' }, 42],
    }),
  )
  assert.equal(recorded.ok, true)
  assert.equal(recorded.record.evidence.length, 2)
  assert.equal(recorded.record.evidence[1].source, 'tool')
  // 超长 evidence 截断到上限
  const many = ledger.record(
    feedbackInput({
      hypothesis: '很多证据',
      experiment: '批量',
      evidence: Array.from({ length: 20 }, (_, i) => '证据' + i),
    }),
  )
  assert.equal(many.ok, true)
  assert.ok(many.record.evidence.length <= FEEDBACK_LEDGER_DEFAULTS.maxEvidenceItems)
})

test('feedback-ledger C2：重复实验合并与冲突不丢', () => {
  let clock = 1000
  const ledger = createFeedbackLedger({ now: () => clock })
  const first = ledger.record(feedbackInput())
  clock += 10
  const duplicate = ledger.record(feedbackInput({ taskId: 'tb-2', evidence: ['日志显示 401', '新增证据'] }))
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.merged, true)
  assert.equal(duplicate.record.id, first.record.id)
  assert.equal(duplicate.record.evidence.length, 3, '证据并集')
  assert.equal(duplicate.record.receipts.length, 2, '回执合并')
  assert.equal(duplicate.record.outcomeHistory.length, 2)
  assert.equal(ledger.snapshot().records, 1)
  assert.equal(ledger.snapshot().metrics.duplicates, 1)

  // 同实验不同结论 → 冲突合并（outcome 更新为最新，历史保留）
  clock += 10
  const conflict = ledger.record(
    feedbackInput({ outcome: 'failure', receipt: feedbackReceipt({ ref: 'run-9', ok: false }) }),
  )
  assert.equal(conflict.conflict, true)
  assert.equal(conflict.record.outcome, 'failure')
  assert.equal(conflict.record.outcomeHistory.length, 3)
  assert.equal(ledger.snapshot().metrics.conflicts, 1)
  assert.equal(ledger.snapshot().byOutcome.failure, 1)
})

test('feedback-ledger C2：同 hypothesis 多次实验统计成功率', () => {
  const clock = 1000
  const ledger = createFeedbackLedger({ now: () => clock })
  const base = { taskId: 'tb-1', hypothesis: '先看日志再改代码', evidence: ['e1', 'e2'] }
  ledger.record({ ...base, experiment: '实验一', receipt: feedbackReceipt({ ref: 'r1' }), outcome: 'success' })
  ledger.record({ ...base, experiment: '实验二', receipt: feedbackReceipt({ ref: 'r2' }), outcome: 'success' })
  ledger.record({ ...base, experiment: '实验三', receipt: feedbackReceipt({ ref: 'r3' }), outcome: 'failure' })
  ledger.record({ ...base, experiment: '实验四', receipt: feedbackReceipt({ ref: 'r4' }), outcome: 'inconclusive' })
  const stats = ledger.statsForHypothesis('先看日志再改代码')
  assert.equal(stats.experiments, 4)
  assert.equal(stats.success, 2)
  assert.equal(stats.failure, 1)
  assert.equal(stats.inconclusive, 1)
  assert.equal(stats.successRate, 0.5)
  assert.equal(stats.evidenceCount, 8)
  assert.equal(ledger.list({ hypothesis: '先看日志再改代码' }).length, 4)
})

test('feedback-ledger C2：方法候选条件（仅 success + 证据/次数/成功率达标）', () => {
  let clock = 1000
  const ledger = createFeedbackLedger({ now: () => clock })
  const base = { taskId: 'tb-1', hypothesis: '先看日志再改代码', evidence: ['e1', 'e2'] }
  const single = ledger.record({
    ...base,
    experiment: '实验一',
    receipt: feedbackReceipt({ ref: 'r1' }),
    outcome: 'success',
  })
  // 只有 1 次实验 → 不足（默认 minExperiments=2）
  const tooFew = ledger.promoteToMethod({ recordId: single.record.id })
  assert.equal(tooFew.code, FEEDBACK_LEDGER_CODES.insufficientEvidence)
  assert.equal(tooFew.experiments, 1)
  clock += 10
  ledger.record({ ...base, experiment: '实验二', receipt: feedbackReceipt({ ref: 'r2' }), outcome: 'success' })
  const candidate = ledger.promoteToMethod({ recordId: single.record.id })
  assert.equal(candidate.ok, true)
  assert.equal(candidate.candidate.kind, 'method')
  assert.equal(candidate.candidate.successRate, 1)
  assert.equal(candidate.candidate.sourceRecordId, single.record.id)
  assert.equal(candidate.candidate.memoryEntry.category, 'method')
  assert.equal(candidate.candidate.memoryEntry.source.kind, 'feedback')
  assert.equal(candidate.candidate.memoryEntry.confidence, 1)
  assert.equal(ledger.snapshot().promoted, 1)
  // 通过 hypothesis 查找成功记录也能升级（已 promoted 仍可返回候选）
  assert.equal(ledger.promoteToMethod({ hypothesis: '先看日志再改代码' }).ok, true)
  assert.equal(ledger.promoteToMethod({}).code, FEEDBACK_LEDGER_CODES.invalidArgument)
  assert.equal(ledger.promoteToMethod({ recordId: 'missing' }).code, FEEDBACK_LEDGER_CODES.notFound)

  // failure / inconclusive 不能升级
  const failure = ledger.record({
    ...base,
    hypothesis: '坏方法',
    experiment: '实验F',
    receipt: feedbackReceipt({ ref: 'r3' }),
    outcome: 'failure',
  })
  assert.equal(ledger.promoteToMethod({ recordId: failure.record.id }).code, FEEDBACK_LEDGER_CODES.insufficientEvidence)
  const inconclusive = ledger.record({
    ...base,
    hypothesis: '不确定方法',
    experiment: '实验I',
    receipt: feedbackReceipt({ ref: 'r4' }),
    outcome: 'inconclusive',
  })
  assert.equal(
    ledger.promoteToMethod({ recordId: inconclusive.record.id }).code,
    FEEDBACK_LEDGER_CODES.insufficientEvidence,
  )

  // 成功率不足（2 success / 2 failure = 0.5 < 0.6）
  const mixed = createFeedbackLedger({ now: () => clock })
  const mbase = { taskId: 'tb-9', hypothesis: '混合结果', evidence: ['e1', 'e2'] }
  const mixedSuccess = mixed.record({
    ...mbase,
    experiment: 's1',
    receipt: feedbackReceipt({ ref: 'm1' }),
    outcome: 'success',
  })
  mixed.record({ ...mbase, experiment: 's2', receipt: feedbackReceipt({ ref: 'm2' }), outcome: 'success' })
  mixed.record({ ...mbase, experiment: 'f1', receipt: feedbackReceipt({ ref: 'm3' }), outcome: 'failure' })
  mixed.record({ ...mbase, experiment: 'f2', receipt: feedbackReceipt({ ref: 'm4' }), outcome: 'failure' })
  const lowRate = mixed.promoteToMethod({ recordId: mixedSuccess.record.id })
  assert.equal(lowRate.code, FEEDBACK_LEDGER_CODES.insufficientEvidence)
  assert.equal(lowRate.successRate, 0.5)

  // 证据不足（默认 minEvidence=2）
  const thin = createFeedbackLedger({ now: () => clock })
  const t1 = thin.record({
    taskId: 'tb-8',
    hypothesis: '证据少',
    experiment: 'a',
    receipt: feedbackReceipt({ ref: 't1' }),
    outcome: 'success',
    evidence: ['唯一证据'],
  })
  thin.record({
    taskId: 'tb-8',
    hypothesis: '证据少',
    experiment: 'b',
    receipt: feedbackReceipt({ ref: 't2' }),
    outcome: 'success',
    evidence: ['另一证据'],
  })
  assert.equal(thin.promoteToMethod({ recordId: t1.record.id }).evidenceCount, 1)
})

test('feedback-ledger C2：自定义阈值可放宽方法候选条件', () => {
  const ledger = createFeedbackLedger({
    now: () => 1000,
    minEvidenceForMethod: 1,
    minExperimentsForMethod: 1,
    minSuccessRateForMethod: 0,
  })
  const recorded = ledger.record(feedbackInput({ evidence: ['一个证据'] }))
  const candidate = ledger.promoteToMethod({ recordId: recorded.record.id })
  assert.equal(candidate.ok, true)
  assert.equal(candidate.candidate.memoryEntry.text.includes('方法：'), true)
  assert.equal(ledger.snapshot().thresholds.minEvidenceForMethod, 1)
})

test('feedback-ledger C2：失败不丢失（容量淘汰优先保留失败）', () => {
  let clock = 1000
  const ledger = createFeedbackLedger({ now: () => clock, maxRecords: 2 })
  const failure = ledger.record(
    feedbackInput({
      hypothesis: '失败保留',
      experiment: 'f',
      outcome: 'failure',
      receipt: feedbackReceipt({ ref: 'f1', ok: false }),
    }),
  )
  clock += 10
  ledger.record(
    feedbackInput({
      hypothesis: '不确定淘汰',
      experiment: 'i',
      outcome: 'inconclusive',
      receipt: feedbackReceipt({ ref: 'i1' }),
    }),
  )
  clock += 10
  ledger.record(
    feedbackInput({
      hypothesis: '成功记录',
      experiment: 's',
      outcome: 'success',
      receipt: feedbackReceipt({ ref: 's1' }),
    }),
  )
  const snapshot = ledger.snapshot()
  assert.equal(snapshot.records, 2)
  assert.equal(snapshot.metrics.pruned, 1)
  assert.ok(ledger.get(failure.record.id) !== null, '失败记录优先保留')
  assert.equal(ledger.list({ outcome: 'inconclusive' }).length, 0, '非失败旧记录先被淘汰')
})

test('feedback-ledger C2：snapshot 字段与 recent', () => {
  const ledger = createFeedbackLedger({ now: () => 1000 })
  ledger.record(feedbackInput())
  const snapshot = ledger.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.version, FEEDBACK_LEDGER_VERSION)
  assert.equal(snapshot.records, 1)
  assert.equal(snapshot.hypotheses, 1)
  assert.equal(snapshot.conflicts, 0)
  assert.equal(snapshot.promoted, 0)
  assert.equal(snapshot.recent.length, 1)
  assert.equal(typeof snapshot.metrics.records, 'number')
  assert.equal(snapshot.thresholds.minSuccessRateForMethod, 0.6)
  assert.equal(FEEDBACK_LEDGER_DEFAULTS.maxRecords > 0, true)
})

// ---------------------------------------------------------------------------
// Gate C3：现有记忆只读适配（lib/core/memory-adapters.mjs）——journal/game-memory/methods
// ---------------------------------------------------------------------------

function writeJournalFixture(dir, lines) {
  writeFileSync(path.join(dir, 'journal.jsonl'), lines.join('\n'))
}

function makeMemoryAdapterFixture() {
  const dir = tmpDir('memory-adapters')
  writeJournalFixture(dir, [
    JSON.stringify({ ts: 1000, kind: 'thought', text: '今天想了很久。' }),
    'not-json',
    '',
    JSON.stringify({ ts: 2000, kind: 'learning', text: '学会了先看日志。' }),
    JSON.stringify({ ts: 3000, kind: 'murmur', text: '有点想他。' }),
  ])
  writeFileSync(
    path.join(dir, 'methods.json'),
    JSON.stringify({
      ok: true,
      v: 1,
      entries: [
        {
          id: 'm1',
          name: '先看日志',
          howTo: '读失败日志再改',
          source: '读哲学',
          usedCount: 2,
          successCount: 1,
          lastAt: 3000,
        },
        {
          id: 'm2',
          name: '小步验证',
          howTo: '一次只改一点',
          source: '实践',
          usedCount: 1,
          successCount: 1,
          lastAt: 2500,
        },
      ],
    }),
  )
  const gameDir = path.join(dir, 'game-memory')
  mkdirSync(path.join(gameDir, 'build'), { recursive: true })
  mkdirSync(path.join(gameDir, 'log'), { recursive: true })
  mkdirSync(path.join(gameDir, 'archive'), { recursive: true })
  writeFileSync(path.join(gameDir, 'PARTNER_GAME.md'), '# 短画像\n一起玩的人：Yuan_JY，喜欢看海。\n')
  writeFileSync(path.join(gameDir, 'world.md'), '- 世界：26.1 离线服务器（Yuan_JY）\n')
  writeFileSync(path.join(gameDir, 'build/home.md'), '- 盖了 3×3 小屋（自己）[2026-11-01]\n')
  writeFileSync(path.join(gameDir, 'inquiry.md'), '- 查了红石电路原理 [2026-11-02]\n')
  writeFileSync(path.join(gameDir, 'methods.md'), '- 先搭地基再盖墙（实践）[2026-11-02]\n')
  writeFileSync(path.join(gameDir, 'log/2026-11.md'), '- 一起挖矿到夜里（Yuan_JY）[2026-11-03]\n')
  writeFileSync(path.join(gameDir, 'archive/old.md'), '- 归档事件（旧）[2025-01-01]\n')
  return { dir, gameDir }
}

function listFilesDeep(root) {
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...listFilesDeep(full))
    else if (entry.isFile()) out.push([path.relative(root, full), readFileSync(full, 'utf8')])
  }
  return out.sort((left, right) => left[0].localeCompare(right[0]))
}

test('memory-adapters C3：journal 只读解析（坏行跳过/过滤/limit）', () => {
  const { dir } = makeMemoryAdapterFixture()
  const provider = journalProvider({ dir })
  assert.equal(provider.id, 'journal')
  assert.equal(provider.permissions.write, false)
  assert.equal(typeof provider.write, 'undefined')
  const entries = provider.read({})
  assert.equal(entries.length, 3, '坏行与空行跳过')
  assert.equal(entries[0].category, 'episodic')
  assert.equal(entries[1].category, 'semantic')
  assert.equal(entries[0].at, 1000)
  assert.deepEqual(entries[0].source, { kind: 'journal', id: 'journal.jsonl', activity: 'thought' })
  assert.equal(entries[0].provenance.journalKind, 'thought')
  assert.equal(entries[0].text, '今天想了很久。')
  const stats = provider.snapshot().stats
  assert.equal(stats.badLines, 1)
  assert.equal(stats.entries, 3)
  // 过滤/limit
  assert.equal(provider.query({ category: 'semantic' }).length, 1)
  assert.equal(provider.query({ text: '日志' }).length, 1)
  assert.equal(provider.query({ activity: 'murmur' }).length, 1)
  assert.equal(provider.query({ limit: 1 }).length, 1)
  assert.equal(JOURNAL_KIND_CATEGORY.learning, 'semantic')
  assert.equal(MEMORY_ADAPTERS_VERSION, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('memory-adapters C3：journal 缺失文件/大文件限流', () => {
  const emptyDir = tmpDir('journal-empty')
  const missing = journalProvider({ dir: emptyDir })
  assert.deepEqual(missing.read({}), [])
  assert.equal(missing.snapshot().stats.files, 0)

  const dir = tmpDir('journal-big')
  const lines = []
  for (let index = 0; index < 200; index += 1) {
    lines.push(JSON.stringify({ ts: 1000 + index, kind: 'thought', text: '第 ' + index + ' 条' }))
  }
  writeJournalFixture(dir, lines)
  const capped = journalProvider({ dir, maxBytes: 400 })
  const entries = capped.read({})
  assert.ok(entries.length > 0 && entries.length < 200, '只读尾部，避免大文件阻塞')
  assert.equal(capped.snapshot().stats.truncated, true)
  assert.equal(entries[entries.length - 1].text, '第 199 条', '最新记录在尾部')
  const lineCapped = journalProvider({ dir, maxLines: 3 })
  assert.equal(lineCapped.read({}).length, 3, '行数上限')
  rmSync(emptyDir, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

test('memory-adapters C3：game-memory workspace（短画像/分类/日志/归档开关）', () => {
  const { gameDir } = makeMemoryAdapterFixture()
  const provider = gameMemoryProvider({ dir: gameDir })
  assert.equal(provider.permissions.write, false)
  const entries = provider.read({})
  const texts = entries.map((entry) => entry.text)
  assert.ok(
    texts.some((text) => text.includes('一起玩的人：Yuan_JY')),
    '短画像',
  )
  assert.ok(texts.some((text) => text.includes('盖了 3×3 小屋')))
  assert.ok(texts.some((text) => text.includes('查了红石电路原理')))
  assert.ok(texts.some((text) => text.includes('一起挖矿到夜里')))
  const build = entries.find((entry) => entry.text.includes('盖了 3×3 小屋'))
  assert.equal(build.category, 'skill')
  assert.equal(build.at, Date.parse('2026-11-01T00:00:00Z'))
  assert.equal(build.provenance.activity, 'build')
  assert.equal(
    entries.some((entry) => entry.text.includes('归档事件')),
    false,
    '默认不读 archive',
  )
  const withArchive = gameMemoryProvider({ dir: gameDir, includeArchive: true }).read({})
  assert.equal(
    withArchive.some((entry) => entry.text.includes('归档事件')),
    true,
  )
  const noLogs = gameMemoryProvider({ dir: gameDir, includeLogs: false }).read({})
  assert.equal(
    noLogs.some((entry) => entry.text.includes('一起挖矿')),
    false,
  )
  assert.equal(GAME_CATEGORY_MAP.build, 'skill')
  assert.equal(provider.query({ category: 'relationship' }).length, 1, '短画像')
  rmSync(path.dirname(gameDir), { recursive: true, force: true })
})

test('memory-adapters C3：game-memory legacy JSON 与缺失目录', () => {
  const dir = tmpDir('game-legacy')
  writeFileSync(
    path.join(dir, 'game-memory.json'),
    JSON.stringify({
      ok: true,
      version: 1,
      entries: [
        { category: 'event', text: '第一次见面', at: 1000, source: 'Yuan_JY' },
        { category: 'plan', text: '想盖一座灯塔', at: 2000, source: '' },
        { category: 'build', text: '小屋 24/25 块', at: 3000, source: 'self' },
      ],
    }),
  )
  const provider = gameMemoryProvider({ dir })
  const entries = provider.read({})
  assert.equal(entries.length, 3)
  assert.deepEqual(
    entries.map((entry) => entry.category),
    ['episodic', 'vision', 'skill'],
  )
  assert.equal(entries[0].source.kind, 'game-memory')
  assert.equal(entries[0].provenance.source, 'Yuan_JY')
  assert.equal(entries[1].at, 2000)
  assert.equal(provider.query({ category: 'vision' }).length, 1)

  const missing = gameMemoryProvider({ dir: path.join(dir, 'missing') })
  assert.deepEqual(missing.read({}), [])
  assert.equal(missing.snapshot().stats.files, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('memory-adapters C3：methods.json 只读解析与错误码', () => {
  const { dir } = makeMemoryAdapterFixture()
  const provider = methodMemoryProvider({ dir })
  const entries = provider.read({})
  assert.equal(entries.length, 2)
  assert.equal(entries[0].category, 'method')
  assert.equal(entries[0].text, '先看日志：读失败日志再改')
  assert.equal(entries[0].at, 3000)
  assert.equal(entries[0].source.kind, 'method-memory')
  assert.equal(entries[0].provenance.usedCount, 2)
  assert.equal(provider.permissions.write, false)

  const missing = methodMemoryProvider({ dir: path.join(dir, 'nope') })
  assert.deepEqual(missing.read({}), [])

  // 坏 JSON → parseError
  const corruptDir = tmpDir('methods-corrupt')
  writeFileSync(path.join(corruptDir, 'methods.json'), '{bad json')
  const corrupt = methodMemoryProvider({ dir: corruptDir })
  assert.throws(
    () => corrupt.read({}),
    (error) => error.code === MEMORY_ADAPTER_CODES.parseError,
  )
  assert.equal(corrupt.snapshot().stats.errors, 1)
  // 超大 JSON → fileTooLarge
  const bigDir = tmpDir('methods-big')
  writeFileSync(
    path.join(bigDir, 'methods.json'),
    JSON.stringify({ ok: true, v: 1, entries: [{ name: '方法', howTo: '做很多很多事' }] }),
  )
  const big = methodMemoryProvider({ dir: bigDir, maxBytes: 10 })
  assert.throws(
    () => big.read({}),
    (error) => error.code === MEMORY_ADAPTER_CODES.fileTooLarge,
  )
  rmSync(dir, { recursive: true, force: true })
  rmSync(corruptDir, { recursive: true, force: true })
  rmSync(bigDir, { recursive: true, force: true })
})

test('memory-adapters C3：只读保证（不改文件/不新建文件/不可写）', () => {
  const { dir, gameDir } = makeMemoryAdapterFixture()
  const before = listFilesDeep(dir)
  const journal = journalProvider({ dir })
  const game = gameMemoryProvider({ dir: gameDir })
  const methods = methodMemoryProvider({ dir })
  journal.read({})
  game.read({})
  methods.read({})
  const after = listFilesDeep(dir)
  assert.deepEqual(after, before, '读取不修改/不新建任何文件')
  for (const provider of [journal, game, methods]) {
    assert.equal(provider.permissions.read, true)
    assert.equal(provider.permissions.write, false)
    assert.equal(typeof provider.write, 'undefined')
  }
  assert.equal(MEMORY_ADAPTER_DEFAULTS.maxLines > 0, true)
  assert.throws(() => journalProvider({}), TypeError)
  assert.throws(() => gameMemoryProvider({}), TypeError)
  assert.throws(() => methodMemoryProvider({}), TypeError)
  rmSync(dir, { recursive: true, force: true })
})

test('memory-adapters C3：三类 provider 经 Gateway 聚合查询（含故障隔离）', async () => {
  const { dir, gameDir } = makeMemoryAdapterFixture()
  const gateway = createMemoryGateway({ now: () => 1000 })
  const journal = journalProvider({ dir })
  const game = gameMemoryProvider({ dir: gameDir })
  const methods = methodMemoryProvider({ dir })
  assert.equal(gateway.registerProvider(journal).ok, true)
  assert.equal(gateway.registerProvider(game).ok, true)
  assert.equal(gateway.registerProvider(methods).ok, true)
  const all = await gateway.query({ limit: 50 })
  assert.equal(all.ok, true)
  const kinds = new Set(all.entries.map((entry) => entry.source.kind))
  assert.deepEqual([...kinds].sort(), ['game-memory', 'journal', 'method-memory'])
  const textQuery = await gateway.query({ text: '日志' })
  assert.ok(textQuery.entries.length >= 2)
  assert.ok(textQuery.entries.some((entry) => entry.source.kind === 'method-memory'))
  const categoryQuery = await gateway.query({ category: 'method' })
  assert.ok(categoryQuery.entries.every((entry) => entry.category === 'method'))
  // 只读 provider 写入被 Gateway 拒绝
  const denied = await gateway.write({
    category: 'episodic',
    text: '试图写只读记忆',
    source: { kind: 'x', id: 'y' },
    provider: 'journal',
  })
  assert.equal(denied.code, MEMORY_GATEWAY_CODES.permissionDenied)

  // 故障隔离：坏 methods.json 抛错，其他 provider 仍可查询
  writeFileSync(path.join(dir, 'methods.json'), '{bad')
  const isolated = await gateway.query({ limit: 50 })
  assert.equal(isolated.ok, true)
  assert.ok(isolated.entries.some((entry) => entry.source.kind === 'journal'))
  assert.equal(isolated.errors.length, 1)
  assert.equal(isolated.errors[0].provider, 'method-memory')
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate C4：记忆质量（lib/core/memory-quality.mjs）与隐私控制（lib/core/memory-privacy.mjs）
// ---------------------------------------------------------------------------

const QUALITY_NOW = 1_700_000_000_000
const QUALITY_DAY = 24 * 60 * 60 * 1000

function qualityEntry(overrides = {}) {
  return {
    id: 'mem-1',
    category: 'episodic',
    text: '今天在公园走了很久。',
    at: QUALITY_NOW - QUALITY_DAY,
    confidence: 0.8,
    source: { kind: 'activity', id: 'chat' },
    topic: 'park',
    provenance: { activity: 'chat' },
    ...overrides,
  }
}

test('memory-quality C4：健康条目 keep，输出建议动作不写盘', () => {
  const entries = [
    qualityEntry(),
    qualityEntry({
      id: 'mem-2',
      text: '今天学了新的方法。',
      category: 'semantic',
      topic: 'method',
      source: { kind: 'journal', id: 'j1' },
    }),
  ]
  const before = JSON.stringify(entries)
  const analysis = analyzeMemoryQuality(entries, { now: QUALITY_NOW })
  assert.equal(analysis.ok, true)
  assert.equal(analysis.version, MEMORY_QUALITY_VERSION)
  assert.deepEqual(
    analysis.items.map((item) => item.action),
    ['keep', 'keep'],
  )
  assert.equal(analysis.summary.keep, 2)
  assert.equal(analysis.summary.total, 2)
  assert.equal(JSON.stringify(entries), before, '质量分析不修改输入')
  assert.ok(MEMORY_QUALITY_ACTIONS.includes('merge'))
  assert.ok(MEMORY_SOURCE_TRUST.activity > MEMORY_SOURCE_TRUST.unknown)
  assert.equal(MEMORY_QUALITY_DEFAULTS.minConfidence, 0.3)
  assert.equal(analyzeMemoryQuality('nope').code, MEMORY_QUALITY_CODES.invalidInput)
})

test('memory-quality C4：近似去重合并（代表条目 + mergeWith）', () => {
  const entries = [
    qualityEntry({ id: 'a', text: '今天在公园走了很久。', confidence: 0.9 }),
    qualityEntry({ id: 'b', text: '今天在公园走了很久。', confidence: 0.5, source: { kind: 'journal', id: 'j1' } }),
    qualityEntry({ id: 'c', text: '今天在公园走了很久很久。', confidence: 0.6 }),
    qualityEntry({ id: 'd', text: '完全不同的记忆内容。', confidence: 0.8, topic: 'other' }),
  ]
  const analysis = analyzeMemoryQuality(entries, { now: QUALITY_NOW })
  const byId = Object.fromEntries(analysis.items.map((item) => [item.id, item]))
  assert.equal(byId.a.action, 'keep', '最高分作为代表')
  assert.equal(byId.b.action, 'merge')
  assert.equal(byId.b.mergeWith, 'a')
  assert.equal(byId.c.action, 'merge')
  assert.equal(byId.d.action, 'keep')
  assert.equal(analysis.summary.duplicates, 2)
  assert.equal(analysis.groups.length, 1)
  assert.equal(analysis.groups[0].representativeId, 'a')
  assert.ok(analysis.groups[0].memberIds.includes('b'))
  assert.ok(similarity('今天在公园走了很久。', '今天在公园走了很久很久。') > 0.8)
  assert.equal(similarity('完全不同的记忆内容。', '今天在公园走了很久。') < 0.3, true)
})

test('memory-quality C4：冲突保留（不静默覆盖，低可信建议 archive）', () => {
  const entries = [
    qualityEntry({
      id: 'keep-me',
      text: '今天在公园走了很久。',
      confidence: 0.9,
      source: { kind: 'activity', id: 'a' },
    }),
    qualityEntry({ id: 'loser', text: '今天根本没有去公园。', confidence: 0.5, source: { kind: 'model', id: 'm' } }),
  ]
  const analysis = analyzeMemoryQuality(entries, { now: QUALITY_NOW })
  const byId = Object.fromEntries(analysis.items.map((item) => [item.id, item]))
  assert.equal(byId['keep-me'].action, 'keep')
  assert.equal(byId.loser.action, 'archive')
  assert.deepEqual(byId.loser.reasons, ['conflict'])
  assert.equal(analysis.conflicts.length, 1)
  assert.equal(analysis.conflicts[0].keptId, 'keep-me')
  assert.deepEqual(analysis.conflicts[0].conflictingIds, ['loser'])
  assert.equal(analysis.summary.conflicts, 1)
  assert.equal(analysis.items.length, 2, '冲突双方都保留在建议里（不丢数据）')
})

test('memory-quality C4：来源可信度与过期策略（archive/drop）', () => {
  const entries = [
    qualityEntry({ id: 'fresh', text: '新鲜的记忆内容。', at: QUALITY_NOW - QUALITY_DAY, topic: 'fresh' }),
    qualityEntry({ id: 'expired', text: '过期的记忆内容。', at: QUALITY_NOW - 40 * QUALITY_DAY, topic: 'expired' }),
    qualityEntry({ id: 'very-old', text: '太旧的记忆内容。', at: QUALITY_NOW - 90 * QUALITY_DAY, topic: 'very-old' }),
    qualityEntry({
      id: 'method-old',
      text: '老方法内容。',
      category: 'method',
      topic: 'm',
      at: QUALITY_NOW - 1000 * QUALITY_DAY,
      source: { kind: 'activity' },
    }),
    qualityEntry({ id: 'unknown-source', text: '未知来源内容。', source: {}, topic: 'u' }),
    qualityEntry({
      id: 'low-confidence',
      text: '低置信内容。',
      confidence: 0.05,
      source: { kind: 'activity' },
      topic: 'l',
    }),
    qualityEntry({ id: 'untrusted', text: '不可信来源内容。', confidence: 0.6, source: { kind: 'model' }, topic: 'x' }),
  ]
  const analysis = analyzeMemoryQuality(entries, { now: QUALITY_NOW, lowTrustThreshold: 0.6 })
  const byId = Object.fromEntries(analysis.items.map((item) => [item.id, item]))
  assert.equal(byId.fresh.action, 'keep')
  assert.equal(byId.expired.action, 'archive')
  assert.deepEqual(byId.expired.reasons, ['expired'])
  assert.equal(byId['very-old'].action, 'drop')
  assert.deepEqual(byId['very-old'].reasons, ['very-old'])
  assert.equal(byId['method-old'].action, 'keep', 'method 不过期')
  assert.equal(byId['unknown-source'].action, 'archive')
  assert.deepEqual(byId['unknown-source'].reasons, ['unknown-source'])
  assert.equal(byId['low-confidence'].action, 'drop')
  assert.equal(byId.untrusted.action, 'archive')
  assert.deepEqual(byId.untrusted.reasons, ['untrusted-source'])
  // 自定义 TTL
  const custom = analyzeMemoryQuality(entries, { now: QUALITY_NOW, categoryTtlMs: { episodic: 0 } })
  assert.equal(custom.items.find((item) => item.id === 'expired').action, 'keep')
})

test('memory-quality C4：污染检测（未知来源/低置信/异常重复/非法条目）', () => {
  const entries = [
    qualityEntry({ id: 'dup-1', text: '重复污染文本。', confidence: 0.9, topic: 'dup' }),
    qualityEntry({ id: 'dup-2', text: '重复污染文本。', confidence: 0.9, topic: 'dup' }),
    qualityEntry({ id: 'dup-3', text: '重复污染文本。', confidence: 0.9, topic: 'dup' }),
    qualityEntry({ id: 'dup-4', text: '重复污染文本。', confidence: 0.9, topic: 'dup' }),
    null,
    { id: 'empty-text', category: 'episodic', text: '   ', source: { kind: 'activity' } },
  ]
  const analysis = analyzeMemoryQuality(entries, { now: QUALITY_NOW, maxRepetition: 3 })
  const dupItems = analysis.items.filter((item) => item.id.startsWith('dup-'))
  assert.equal(dupItems.filter((item) => item.action === 'keep').length, 1)
  assert.equal(dupItems.filter((item) => item.action === 'merge').length, 3)
  assert.ok(dupItems.some((item) => item.reasons.includes('abnormal-repetition')))
  assert.equal(analysis.groups[0].repetition, true)
  assert.equal(analysis.invalid.length, 2)
  assert.equal(analysis.summary.invalid, 2)
  assert.equal(analysis.summary.polluted, 3)
})

test('memory-quality C4：选项覆盖与非法输入', () => {
  const entries = [qualityEntry({ id: 'x', confidence: 0.2, source: { kind: 'journal', id: 'j' } })]
  assert.equal(analyzeMemoryQuality(entries, { now: QUALITY_NOW }).items[0].action, 'archive')
  assert.equal(analyzeMemoryQuality(entries, { now: QUALITY_NOW, minConfidence: 0.1 }).items[0].action, 'keep')
  assert.equal(analyzeMemoryQuality(entries, { now: QUALITY_NOW, hardMinConfidence: 0.5 }).items[0].action, 'drop')
  assert.equal(analyzeMemoryQuality([], { now: QUALITY_NOW }).summary.total, 0)
  assert.equal(analyzeMemoryQuality(null).ok, false)
})

function privacyFixtureEntries() {
  return [
    {
      id: 'e1',
      category: 'episodic',
      text: '今天在公园走了很久。',
      at: QUALITY_NOW - QUALITY_DAY,
      confidence: 0.8,
      source: { kind: 'activity', id: 'chat' },
      provenance: { activity: 'chat', token: 'sk-secret12345678' },
      meta: { apiKey: 'sk-abcdefgh12345678', note: '普通备注' },
    },
    {
      id: 'e2',
      category: 'semantic',
      text: '学到了新方法。',
      at: QUALITY_NOW - 2 * QUALITY_DAY,
      confidence: 0.9,
      source: { kind: 'journal', id: 'j1' },
      provenance: { activity: 'reading' },
      meta: { password: 'hunter2', normal: 'ok' },
    },
    {
      id: 'e3',
      category: 'episodic',
      text: '另一段记忆。',
      at: QUALITY_NOW - 3 * QUALITY_DAY,
      confidence: 0.6,
      source: { kind: 'activity', id: 'chat' },
      provenance: { activity: 'chat' },
    },
  ]
}

test('memory-privacy C4：导出脱敏（不含密钥）与 manifest', () => {
  const entries = privacyFixtureEntries()
  const built = buildMemoryExport({ entries, now: QUALITY_NOW })
  assert.equal(built.ok, true)
  assert.equal(built.export.manifest.kind, 'memory-export')
  assert.equal(built.export.manifest.counts.entries, 3)
  assert.equal(built.export.manifest.counts.byCategory.episodic, 2)
  assert.match(built.export.manifest.integrity.sha256, /^[0-9a-f]{64}$/)
  const json = built.export.json
  assert.equal(json.includes('sk-abcdefgh12345678'), false, '密钥值脱敏')
  assert.equal(json.includes('hunter2'), false, '密码值脱敏')
  assert.equal(json.includes('"apiKey": "[redacted]"'), true)
  assert.equal(json.includes('"password": "[redacted]"'), true)
  assert.equal(json.includes('普通备注'), true, '普通内容保留')
  assert.equal(json.includes('今天在公园走了很久。'), true, '记忆正文保留（用户自己的数据）')
  const parsed = JSON.parse(json)
  assert.equal(parsed.entries.length, 3)
  assert.equal(MEMORY_PRIVACY_VERSION, 1)
  assert.equal(sanitizeValue({ secret: 'x', normal: 'y' }).secret, '[redacted]')
  assert.equal(sanitizeEntry(null), null)
})

test('memory-privacy C4：导出过滤与 limit', () => {
  const entries = privacyFixtureEntries()
  const filtered = buildMemoryExport({
    entries,
    filter: { category: 'episodic', sourceKind: 'activity' },
    now: QUALITY_NOW,
  })
  assert.equal(filtered.export.entries.length, 2)
  assert.equal(filtered.export.manifest.filter.category, 'episodic')
  const byActivity = buildMemoryExport({ entries, filter: { activity: 'reading' }, now: QUALITY_NOW })
  assert.equal(byActivity.export.entries.length, 1)
  const byText = buildMemoryExport({ entries, filter: { text: '公园' }, now: QUALITY_NOW })
  assert.equal(byText.export.entries.length, 1)
  const byIds = buildMemoryExport({ entries, filter: { ids: ['e2'] }, now: QUALITY_NOW })
  assert.equal(byIds.export.entries[0].id, 'e2')
  const limited = buildMemoryExport({ entries, limit: 1, now: QUALITY_NOW })
  assert.equal(limited.export.entries.length, 1)
  assert.equal(buildMemoryExport({ entries, filter: { category: '' } }).ok, false)
  assert.equal(buildMemoryExport({ entries: 'nope' }).code, MEMORY_PRIVACY_CODES.invalidInput)
})

test('memory-privacy C4：删除计划默认 dry-run（不删数据）', () => {
  const entries = privacyFixtureEntries()
  const before = JSON.stringify(entries)
  const planned = buildMemoryDeletePlan({ entries, filter: { category: 'episodic' }, now: QUALITY_NOW })
  assert.equal(planned.ok, true)
  assert.equal(planned.plan.kind, 'memory-delete-plan')
  assert.equal(planned.plan.dryRun, true)
  assert.equal(planned.plan.requiresConfirmation, true)
  assert.equal(planned.plan.executed, false)
  assert.equal(planned.plan.counts.entries, 2)
  assert.deepEqual(
    planned.plan.matched.map((item) => item.id),
    ['e1', 'e3'],
  )
  assert.equal(JSON.stringify(entries), before, '生成计划不修改数据')
  const confirmed = buildMemoryDeletePlan({ entries, filter: { ids: ['e1'] }, now: QUALITY_NOW, confirm: true })
  assert.equal(confirmed.plan.dryRun, false)
  assert.equal(confirmed.plan.approved, true)
  assert.equal(confirmed.plan.executed, false, '模块从不执行删除')
  assert.equal(buildMemoryDeletePlan({ entries, filter: { category: 'nope' } }).plan.counts.entries, 0)
  assert.equal(buildMemoryDeletePlan({ entries: 'nope' }).code, MEMORY_PRIVACY_CODES.invalidInput)
})

test('memory-privacy C4：审计事件（who/when/what，不记录正文）', () => {
  const entries = privacyFixtureEntries()
  let clock = QUALITY_NOW
  const controller = createMemoryPrivacyController({ now: () => clock })
  const exported = controller.export({ entries, actor: 'user-a', filter: { category: 'episodic' } })
  assert.equal(exported.ok, true)
  clock += 1000
  const planned = controller.delete({ entries, actor: 'user-a', filter: { category: 'episodic' } })
  assert.equal(planned.ok, true)
  const audit = controller.listAudit()
  assert.equal(audit.length, 2)
  const latest = audit[0]
  assert.equal(latest.action, 'delete-plan')
  assert.equal(latest.actor, 'user-a')
  assert.equal(latest.at, QUALITY_NOW + 1000)
  assert.equal(latest.counts.entries, 2)
  assert.equal(JSON.stringify(latest).includes('今天在公园走了很久。'), false, '审计不记录正文')
  assert.equal(controller.listAudit({ action: 'export' }).length, 1)
  assert.equal(controller.listAudit({ actor: 'someone-else' }).length, 0)
  assert.equal(controller.listAudit({ limit: 1 }).length, 1)
  assert.equal(controller.snapshot().auditEvents, 2)
  assert.equal(controller.export({ entries, actor: '' }).code, MEMORY_PRIVACY_CODES.invalidActor)
  assert.equal(MEMORY_PRIVACY_DEFAULTS.auditLimit > 0, true)
})

// ---------------------------------------------------------------------------
// Gate D1：Chat Activity（lib/core/chat-activity.mjs）——manifest/事件/任务/回执/取消
// ---------------------------------------------------------------------------

function chatMessage(overrides = {}) {
  return { peerId: 'Yuan_JY', messageId: 'm-1', text: '你好呀', channel: 'qq', ...overrides }
}

test('chat-activity D1：manifest 合法（事件/工具/task kind）', () => {
  const validated = validateActivityManifest(CHAT_MANIFEST_RAW)
  assert.equal(validated.ok, true, JSON.stringify(validated.errors ?? []))
  assert.equal(validated.manifest.id, CHAT_ACTIVITY_ID)
  assert.equal(validated.manifest.version, '1.0.0')
  assert.deepEqual(
    validated.manifest.events.sort(),
    [CHAT_EVENTS.interrupted, CHAT_EVENTS.received, CHAT_EVENTS.replied].sort(),
  )
  assert.deepEqual(validated.manifest.tools, [CHAT_TOOL_REPLY])
  assert.equal(validated.manifest.tasks[0].kind, CHAT_TASK_KIND)
  assert.deepEqual(
    validated.manifest.permissions.map((item) => item.permission),
    ['model'],
  )
  assert.equal(Object.isFrozen(CHAT_MANIFEST), true)
  const copy = getChatManifest()
  assert.notEqual(copy, CHAT_MANIFEST)
  assert.equal(copy.id, 'chat')
  assert.equal(CHAT_ACTIVITY_VERSION, 1)
  assert.ok(CHAT_ACTIVITY_LIMITS.textMax >= 1000)
})

test('chat-activity D1：消息 → 统一 event envelope（可入 Event Bus）', () => {
  const message = chatMessage({ at: 1234 })
  const result = toChatEvent(message, { now: () => 1000, random: () => 0.42 })
  assert.equal(result.ok, true)
  const event = result.event
  const validated = validateEventEnvelope(event)
  assert.equal(validated.ok, true, JSON.stringify(validated.errors ?? []))
  assert.equal(event.activity, 'chat')
  assert.equal(event.type, CHAT_EVENTS.received)
  assert.equal(event.version, 1)
  assert.equal(event.at, 1234)
  assert.equal(event.subject, 'peer:Yuan_JY')
  assert.ok(event.topics.includes('chat.received'))
  assert.ok(event.topics.includes('peer:yuan_jy'))
  assert.deepEqual(event.payload, { peerId: 'Yuan_JY', messageId: 'm-1', text: '你好呀', channel: 'qq' })
  assert.match(event.id, /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/)

  const bus = createEventBus({ maxEvents: 10 })
  const appended = bus.append(event)
  assert.equal(appended.ok, true)
  assert.equal(bus.snapshot().stored, 1)
  assert.equal(bus.snapshot().metrics.published, 1)
})

test('chat-activity D1：非法消息被拒绝', () => {
  assert.equal(toChatEvent(null).code, CHAT_ACTIVITY_CODES.invalidMessage)
  assert.equal(toChatEvent({}).code, CHAT_ACTIVITY_CODES.invalidMessage)
  assert.equal(toChatEvent(chatMessage({ peerId: '' })).code, CHAT_ACTIVITY_CODES.invalidMessage)
  assert.equal(toChatEvent(chatMessage({ messageId: '  ' })).code, CHAT_ACTIVITY_CODES.invalidMessage)
  assert.equal(toChatEvent(chatMessage({ text: '' })).code, CHAT_ACTIVITY_CODES.invalidMessage)
  assert.equal(
    toChatEvent(chatMessage({ text: 'x'.repeat(CHAT_ACTIVITY_LIMITS.textMax + 1) })).code,
    CHAT_ACTIVITY_CODES.invalidMessage,
  )
  assert.equal(createChatTask(chatMessage({ peerId: '' })).code, CHAT_ACTIVITY_CODES.invalidMessage)
})

test('chat-activity D1：createTask 幂等键 = peerId + messageId', () => {
  const message = chatMessage()
  const created = createChatTask(message, { priority: 60 })
  assert.equal(created.ok, true)
  assert.equal(created.task.activity, 'chat')
  assert.equal(created.task.kind, CHAT_TASK_KIND)
  assert.equal(created.task.key, 'chat.turn:Yuan_JY:m-1')
  assert.equal(created.task.key, chatTaskKey(message))
  assert.equal(created.task.priority, 60)
  assert.equal(created.task.payload.peerId, 'Yuan_JY')
  assert.equal(created.task.payload.messageId, 'm-1')
  // 同消息重复生成 → 同 key（幂等，不重复执行）
  assert.equal(createChatTask(message).task.key, created.task.key)
  // 不同 messageId → 不同 key
  assert.notEqual(createChatTask(chatMessage({ messageId: 'm-2' })).task.key, created.task.key)
  // 超长 id 截断后 key 仍 ≤128
  const longKey = createChatTask(chatMessage({ peerId: 'p'.repeat(120), messageId: 'm'.repeat(120) })).task.key
  assert.ok(longKey.length <= CHAT_ACTIVITY_LIMITS.taskKeyMax)
})

test('chat-activity D1：execute 返回 reply receipt（不直接调模型/HTTP）', async () => {
  const calls = []
  const task = createChatTask(chatMessage()).task
  const result = await executeChatTurn(task, {
    reply: async ({ peerId, messageId, text, task: passedTask }) => {
      calls.push({ peerId, messageId, text, key: passedTask.key })
      return { replyId: 'r-1', text: '你好 ' + peerId }
    },
    now: () => 1000,
  })
  assert.equal(result.ok, true)
  assert.equal(result.receipt.ok, true)
  assert.equal(result.receipt.replyId, 'r-1')
  assert.equal(result.receipt.at, 1000)
  assert.equal(result.receipt.taskKey, task.key)
  assert.equal(result.receipt.peerId, 'Yuan_JY')
  assert.equal(result.receipt.messageId, 'm-1')
  assert.equal(result.receipt.durationMs, 0)
  assert.equal(result.receipt.cancelled, false)
  assert.equal(result.receipt.text, '你好 Yuan_JY')
  assert.deepEqual(calls, [{ peerId: 'Yuan_JY', messageId: 'm-1', text: '你好呀', key: task.key }])

  // reply 返回字符串 → 自动生成 replyId
  const stringReply = await executeChatTurn(task, { reply: () => '直接文本回复', now: () => 2000 })
  assert.equal(stringReply.ok, true)
  assert.match(stringReply.receipt.replyId, /^reply:/)
  assert.equal(stringReply.receipt.text, '直接文本回复')
})

test('chat-activity D1：取消返回 cancelled receipt', async () => {
  const task = createChatTask(chatMessage()).task
  let called = 0
  const preAborted = new AbortController()
  preAborted.abort()
  const pre = await executeChatTurn(task, {
    reply: () => {
      called += 1
      return { replyId: 'r' }
    },
    signal: preAborted.signal,
    now: () => 1000,
  })
  assert.equal(pre.ok, false)
  assert.equal(pre.cancelled, true)
  assert.equal(pre.code, CHAT_ACTIVITY_CODES.cancelled)
  assert.equal(pre.receipt.ok, false)
  assert.equal(pre.receipt.cancelled, true)
  assert.equal(called, 0, '已取消则不调用 reply')

  // 执行中取消：reply 挂起，signal abort 后立即返回 cancelled
  const controller = new AbortController()
  const pending = executeChatTurn(task, {
    reply: () => new Promise(() => {}),
    signal: controller.signal,
    now: () => 1000,
  })
  setTimeout(() => controller.abort(), 0)
  const cancelled = await pending
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.code, CHAT_ACTIVITY_CODES.cancelled)
  assert.equal(cancelled.receipt.cancelled, true)
})

test('chat-activity D1：错误分支（无 reply/抛错/非法返回值/非法 task）', async () => {
  const task = createChatTask(chatMessage()).task
  const noReply = await executeChatTurn(task, {})
  assert.equal(noReply.code, CHAT_ACTIVITY_CODES.noReplyFunction)

  const thrown = await executeChatTurn(task, {
    reply: () => {
      throw new Error('model unavailable')
    },
    now: () => 1000,
  })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.code, CHAT_ACTIVITY_CODES.replyFailed)
  assert.equal(thrown.receipt.ok, false)
  assert.equal(thrown.receipt.error.message, 'model unavailable')

  const invalidReply = await executeChatTurn(task, { reply: () => 42 })
  assert.equal(invalidReply.code, CHAT_ACTIVITY_CODES.invalidReply)
  const emptyReply = await executeChatTurn(task, { reply: () => '   ' })
  assert.equal(emptyReply.code, CHAT_ACTIVITY_CODES.invalidReply)
  const invalidTask = await executeChatTurn({}, { reply: () => 'x' })
  assert.equal(invalidTask.code, CHAT_ACTIVITY_CODES.invalidTask)
})

test('chat-activity D1：replied/interrupted 事件 envelope', () => {
  const task = createChatTask(chatMessage()).task
  const receipt = {
    ok: true,
    replyId: 'r-9',
    at: 1500,
    taskKey: task.key,
    peerId: 'Yuan_JY',
    messageId: 'm-1',
    durationMs: 12,
  }
  const replied = toRepliedEvent(task, receipt, { now: () => 1000 })
  assert.equal(replied.ok, true)
  assert.equal(replied.event.type, CHAT_EVENTS.replied)
  assert.equal(replied.event.payload.replyId, 'r-9')
  assert.equal(replied.event.at, 1500)
  assert.equal(validateEventEnvelope(replied.event).ok, true)

  const interrupted = toInterruptedEvent(
    task,
    { ok: false, cancelled: true, at: 1600 },
    { now: () => 1000, reason: 'user-cancel' },
  )
  assert.equal(interrupted.ok, true)
  assert.equal(interrupted.event.type, CHAT_EVENTS.interrupted)
  assert.equal(interrupted.event.payload.reason, 'user-cancel')
  assert.equal(validateEventEnvelope(interrupted.event).ok, true)
  assert.equal(toRepliedEvent(task, { ok: false }).code, CHAT_ACTIVITY_CODES.invalidReply)
})

test('chat-activity D1：createChatActivity 工厂注入默认 reply/时钟', async () => {
  const activity = createChatActivity({
    now: () => 5000,
    reply: ({ text }) => ({ replyId: 'r-factory', text: '收到：' + text }),
  })
  assert.equal(activity.manifest.id, 'chat')
  const event = activity.toEvent(chatMessage())
  assert.equal(event.ok, true)
  assert.equal(event.event.at, 5000)
  const task = activity.createTask(chatMessage()).task
  const result = await activity.execute(task)
  assert.equal(result.ok, true)
  assert.equal(result.receipt.replyId, 'r-factory')
  assert.equal(result.receipt.at, 5000)
  const replied = activity.toRepliedEvent(task, result.receipt)
  assert.equal(replied.event.type, CHAT_EVENTS.replied)
  const interrupted = activity.toInterruptedEvent(task, { ok: false, cancelled: true }, { reason: 'paused' })
  assert.equal(interrupted.event.payload.reason, 'paused')
})

// ---------------------------------------------------------------------------
// Gate D2：Minecraft Activity（lib/core/minecraft-activity.mjs）——manifest/事件/工具/回执/取消
// ---------------------------------------------------------------------------

test('minecraft-activity D2：manifest 合法且工具与 MINECRAFT_TOOLS 对齐', () => {
  const validated = validateActivityManifest(MINECRAFT_MANIFEST_RAW)
  assert.equal(validated.ok, true, JSON.stringify(validated.errors ?? []))
  assert.equal(validated.manifest.id, MINECRAFT_ACTIVITY_ID)
  assert.deepEqual(
    validated.manifest.events.slice().sort(),
    [MINECRAFT_EVENTS.chat, MINECRAFT_EVENTS.death, MINECRAFT_EVENTS.spawn, MINECRAFT_EVENTS.toolReceipt].sort(),
  )
  assert.deepEqual(validated.manifest.tasks.map((task) => task.kind).sort(), MINECRAFT_TASK_KINDS.slice().sort())
  // 工具清单与现有 domain MINECRAFT_TOOLS 完全对齐（名称 + 数量）
  assert.deepEqual(MINECRAFT_MANIFEST.tools.slice().sort(), MINECRAFT_TOOLS.map((tool) => tool.name).sort())
  assert.deepEqual(
    MINECRAFT_TOOL_NAMES,
    MINECRAFT_TOOLS.map((tool) => tool.name),
  )
  assert.equal(MINECRAFT_TOOLS_SNAPSHOT.length, MINECRAFT_TOOLS.length)
  assert.equal(Object.isFrozen(MINECRAFT_MANIFEST), true)
  assert.notEqual(getMinecraftManifest(), MINECRAFT_MANIFEST)
  assert.equal(MINECRAFT_ACTIVITY_VERSION, 1)
})

test('minecraft-activity D2：spawn/death/chat 事件映射为统一 envelope', () => {
  const spawn = toMinecraftSpawnEvent(
    { player: 'Yuan_JY', position: '0,64,0', worldName: 'world' },
    { now: () => 1000 },
  )
  assert.equal(spawn.ok, true)
  assert.equal(spawn.event.type, MINECRAFT_EVENTS.spawn)
  assert.equal(spawn.event.subject, 'world:main')
  assert.equal(spawn.event.activity, 'minecraft')
  assert.equal(spawn.event.at, 1000)
  assert.equal(validateEventEnvelope(spawn.event).ok, true)
  assert.equal(spawn.event.payload.player, 'Yuan_JY')

  const death = toMinecraftDeathEvent({ player: 'Yuan_JY', cause: 'fell', position: '1,2,3' }, { now: () => 1000 })
  assert.equal(death.event.type, MINECRAFT_EVENTS.death)
  assert.equal(death.event.payload.cause, 'fell')
  assert.equal(validateEventEnvelope(death.event).ok, true)

  const chat = toMinecraftChatEvent({ player: 'Yuan_JY', text: '来挖矿呀' }, { now: () => 1000 })
  assert.equal(chat.event.type, MINECRAFT_EVENTS.chat)
  assert.equal(chat.event.payload.text, '来挖矿呀')
  assert.equal(validateEventEnvelope(chat.event).ok, true)
  assert.equal(toMinecraftChatEvent({ player: 'Yuan_JY', text: '  ' }).code, MINECRAFT_ACTIVITY_CODES.invalidEvent)
})

test('minecraft-activity D2：command → 统一 Task（kind 映射 + 幂等 key）', () => {
  const build = toMinecraftTask({ id: 'cmd-1', tool: 'mc_build', arguments: {}, reason: '盖房子' })
  assert.equal(build.ok, true)
  assert.equal(build.task.activity, 'minecraft')
  assert.equal(build.task.kind, 'minecraft.build')
  assert.equal(build.task.key, 'minecraft:minecraft.build:cmd-1')
  assert.equal(build.task.payload.tool, 'mc_build')
  assert.equal(build.task.payload.reason, '盖房子')
  assert.equal(
    toMinecraftTask({ id: 'cmd-2', tool: 'mc_explore', arguments: { direction: 'north' } }).task.kind,
    'minecraft.explore',
  )
  assert.equal(toMinecraftTask({ tool: 'mc_plan' }).task.kind, 'minecraft.plan')
  assert.equal(toMinecraftTask({ tool: 'mc_inquire' }).task.kind, 'minecraft.inquire')
  assert.equal(toMinecraftTask({ tool: 'mc_mine' }).task.kind, 'minecraft.explore')
  assert.equal(toMinecraftTask({ tool: 'mc_place' }).task.kind, 'minecraft.build')
  // 无 command.id：同 tool+args+at → 同 key（幂等）；不同 args → 不同 key
  const hashedA = toMinecraftTask({ tool: 'mc_move_to', arguments: { x: 1, z: 2 }, at: 1000 }).task.key
  const hashedB = toMinecraftTask({ tool: 'mc_move_to', arguments: { x: 1, z: 2 }, at: 1000 }).task.key
  assert.equal(hashedA, hashedB)
  assert.notEqual(hashedA, toMinecraftTask({ tool: 'mc_move_to', arguments: { x: 9, z: 9 }, at: 1000 }).task.key)
  assert.equal(toMinecraftTask({ tool: 'nope' }).code, MINECRAFT_ACTIVITY_CODES.invalidTool)
  assert.equal(toMinecraftTask({ tool: 'mc_build', arguments: 'nope' }).code, MINECRAFT_ACTIVITY_CODES.invalidArguments)
})

test('minecraft-activity D2：receipt 校验与 tool_receipt 事件', () => {
  const valid = validateMinecraftReceipt(
    { ok: true, tool: 'mc_move_to', detail: '到了', facts: { position: '1,2,3' } },
    { now: () => 1000 },
  )
  assert.equal(valid.ok, true)
  assert.equal(valid.receipt.tool, 'mc_move_to')
  assert.equal(valid.receipt.detail, '到了')
  assert.deepEqual(valid.receipt.facts, { position: '1,2,3' })
  assert.equal(valid.receipt.at, 1000)
  assert.equal(validateMinecraftReceipt({ tool: 'mc_move_to' }).code, MINECRAFT_ACTIVITY_CODES.invalidReceipt)
  assert.equal(validateMinecraftReceipt({ ok: true, tool: 'nope' }).code, MINECRAFT_ACTIVITY_CODES.invalidTool)
  assert.equal(
    validateMinecraftReceipt({ ok: true, tool: 'mc_move_to', facts: [] }).code,
    MINECRAFT_ACTIVITY_CODES.invalidReceipt,
  )
  assert.equal(validateMinecraftReceipt('nope').code, MINECRAFT_ACTIVITY_CODES.invalidReceipt)

  const event = toMinecraftToolReceiptEvent(
    valid.receipt,
    { key: 'minecraft:minecraft.explore:cmd-1' },
    { now: () => 1000 },
  )
  assert.equal(event.ok, true)
  assert.equal(event.event.type, MINECRAFT_EVENTS.toolReceipt)
  assert.equal(event.event.payload.tool, 'mc_move_to')
  assert.equal(event.event.payload.ok, true)
  assert.equal(event.event.payload.taskKey, 'minecraft:minecraft.explore:cmd-1')
  assert.equal(validateEventEnvelope(event.event).ok, true)
})

test('minecraft-activity D2：observe 转发 world 决策（observation→command→Task）', async () => {
  const calls = []
  const activity = createMinecraftActivity({
    now: () => 1000,
    invoke: async (action, payload) => {
      calls.push({ action, payload })
      return {
        ok: true,
        command: { id: 'cmd-7', tool: 'mc_build', arguments: {}, reason: '盖房子' },
        permission: 'control',
      }
    },
  })
  const result = await activity.observe({ position: '10,64,10', players: ['Yuan_JY'], health: 18, food: 12 })
  assert.equal(result.ok, true)
  assert.equal(result.interrupted, false)
  assert.equal(result.observation.position, '10,64,10')
  assert.equal(result.task.kind, 'minecraft.build')
  assert.equal(result.task.key, 'minecraft:minecraft.build:cmd-7')
  assert.equal(result.permission, 'control')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'observe')
  assert.equal(calls[0].payload.activity, 'minecraft')
  assert.equal(calls[0].payload.observation.position, '10,64,10')

  // 中断
  const interrupted = await createMinecraftActivity({
    invoke: async () => ({ ok: true, interrupt: true, reason: '用户接管' }),
  }).observe({ position: '0,64,0' })
  assert.equal(interrupted.ok, true)
  assert.equal(interrupted.interrupted, true)
  assert.equal(interrupted.reason, '用户接管')
  assert.equal(interrupted.task, null)

  // 错误分支
  const worldFail = await createMinecraftActivity({ invoke: async () => ({ ok: false, error: 'llm' }) }).observe({
    position: '0,64,0',
  })
  assert.equal(worldFail.code, MINECRAFT_ACTIVITY_CODES.worldError)
  const thrown = await createMinecraftActivity({
    invoke: async () => {
      throw new Error('world down')
    },
  }).observe({ position: '0,64,0' })
  assert.equal(thrown.code, MINECRAFT_ACTIVITY_CODES.worldError)
  const invalid = await createMinecraftActivity({ invoke: async () => ({ ok: true }) }).observe({})
  assert.equal(invalid.code, MINECRAFT_ACTIVITY_CODES.invalidObservation)
  const noInvoke = await createMinecraftActivity({}).observe({ position: '0,64,0' })
  assert.equal(noInvoke.code, MINECRAFT_ACTIVITY_CODES.noInvoke)
})

test('minecraft-activity D2：execute 转发工具调用并返回 receipt/事件', async () => {
  const calls = []
  const activity = createMinecraftActivity({
    now: () => 1000,
    invoke: async (action, payload) => {
      calls.push({ action, payload })
      return { ok: true, receipt: { ok: true, tool: payload.tool, detail: '放了 3 块', facts: { placed: 3 } } }
    },
  })
  const result = await activity.execute('mc_build', { goal: '小屋' })
  assert.equal(result.ok, true)
  assert.equal(result.receipt.ok, true)
  assert.equal(result.receipt.tool, 'mc_build')
  assert.equal(result.receipt.detail, '放了 3 块')
  assert.deepEqual(result.receipt.facts, { placed: 3 })
  assert.equal(result.receipt.durationMs, 0)
  assert.equal(result.event.type, MINECRAFT_EVENTS.toolReceipt)
  assert.equal(validateEventEnvelope(result.event).ok, true)
  assert.equal(calls[0].action, 'execute')
  assert.equal(calls[0].payload.tool, 'mc_build')
  assert.deepEqual(calls[0].payload.arguments, { goal: '小屋' })

  // world 返回失败回执：仍是合法 receipt（ok=false），不丢事实
  const failed = await createMinecraftActivity({
    invoke: async () => ({
      ok: true,
      receipt: { ok: false, tool: 'mc_mine', detail: '附近没有树', facts: { found: 0 } },
    }),
  }).execute('mc_mine', {})
  assert.equal(failed.ok, true)
  assert.equal(failed.receipt.ok, false)
  assert.equal(failed.receipt.detail, '附近没有树')
  assert.equal(failed.event.payload.ok, false)
})

test('minecraft-activity D2：execute 错误分支', async () => {
  const activity = createMinecraftActivity({
    invoke: async () => ({ ok: true, receipt: { ok: true, tool: 'mc_wait' } }),
  })
  assert.equal((await activity.execute('nope', {})).code, MINECRAFT_ACTIVITY_CODES.invalidTool)
  assert.equal((await activity.execute('mc_wait', 'nope')).code, MINECRAFT_ACTIVITY_CODES.invalidArguments)
  const thrown = await createMinecraftActivity({
    invoke: async () => {
      throw new Error('bot offline')
    },
  }).execute('mc_wait', {})
  assert.equal(thrown.code, MINECRAFT_ACTIVITY_CODES.worldError)
  assert.equal(thrown.receipt.ok, false)
  assert.equal(thrown.receipt.tool, 'mc_wait')
  const invalidReceipt = await createMinecraftActivity({
    invoke: async () => ({ ok: true, receipt: { tool: 'mc_wait' } }),
  }).execute('mc_wait', {})
  assert.equal(invalidReceipt.code, MINECRAFT_ACTIVITY_CODES.invalidReceipt)
  const noInvoke = await createMinecraftActivity({}).execute('mc_wait', {})
  assert.equal(noInvoke.code, MINECRAFT_ACTIVITY_CODES.noInvoke)
})

test('minecraft-activity D2：中断返回 cancelled receipt（不调用 world）', async () => {
  let calls = 0
  const activity = createMinecraftActivity({
    now: () => 1000,
    invoke: () => {
      calls += 1
      return new Promise(() => {})
    },
  })
  const preAborted = new AbortController()
  preAborted.abort()
  const pre = await activity.execute('mc_build', {}, { signal: preAborted.signal })
  assert.equal(pre.ok, false)
  assert.equal(pre.cancelled, true)
  assert.equal(pre.code, MINECRAFT_ACTIVITY_CODES.cancelled)
  assert.equal(pre.receipt.cancelled, true)
  assert.equal(calls, 0)

  const controller = new AbortController()
  const pending = activity.execute('mc_build', {}, { signal: controller.signal })
  setTimeout(() => controller.abort(), 0)
  const cancelled = await pending
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.receipt.ok, false)
  assert.equal(cancelled.receipt.tool, 'mc_build')

  const observeAborted = await activity.observe({ position: '0,64,0' }, { signal: preAborted.signal })
  assert.equal(observeAborted.cancelled, true)
  assert.equal(observeAborted.code, MINECRAFT_ACTIVITY_CODES.cancelled)
})

test('minecraft-activity D2：工厂绑定方法与自定义 worldId', async () => {
  const activity = createMinecraftActivity({
    now: () => 5000,
    worldId: 'smp',
    invoke: async (action) =>
      action === 'observe'
        ? { ok: true, command: { tool: 'mc_explore', arguments: { direction: 'north' } } }
        : { ok: true, receipt: { ok: true, tool: 'mc_explore', detail: '走了很远', facts: { distance: 64 } } },
  })
  assert.equal(activity.manifest.id, 'minecraft')
  const event = activity.toSpawnEvent({ player: 'Yuan_JY' })
  assert.equal(event.event.subject, 'world:smp')
  assert.equal(event.event.at, 5000)
  const observed = await activity.observe({ position: '0,64,0' })
  assert.equal(observed.task.kind, 'minecraft.explore')
  const executed = await activity.execute('mc_explore', { direction: 'north' })
  assert.equal(executed.receipt.ok, true)
  assert.equal(executed.event.subject, 'world:smp')
  assert.equal(activity.toTask({ tool: 'mc_plan' }).task.kind, 'minecraft.plan')
  const invalidEvent = activity.toEvent('minecraft.unknown', {})
  assert.equal(invalidEvent.code, MINECRAFT_ACTIVITY_CODES.invalidEvent)
})

// ---------------------------------------------------------------------------
// Gate D3：World Supervisor（lib/core/world-supervisor.mjs）——启停/健康/退避重启/隔离
// ---------------------------------------------------------------------------

function createSupervisorFakeTimers() {
  const queue = []
  return {
    setTimeout(fn, ms) {
      const handle = { fn, ms, cleared: false }
      queue.push(handle)
      return handle
    },
    clearTimeout(handle) {
      if (handle) handle.cleared = true
    },
    pending() {
      return queue.filter((handle) => !handle.cleared)
    },
    delays() {
      return queue.filter((handle) => !handle.cleared).map((handle) => handle.ms)
    },
    runNext() {
      const handle = queue.find((item) => !item.cleared)
      if (!handle) return null
      handle.cleared = true
      handle.fn()
      return handle
    },
  }
}

test('world-supervisor D3：注册校验与查询', () => {
  const supervisor = createWorldSupervisor({ now: () => 1000, autoRestart: false })
  assert.equal(supervisor.register({ id: 'chat', start: async () => {} }).ok, true)
  assert.equal(supervisor.register({ id: 'chat', start: async () => {} }).code, WORLD_SUPERVISOR_CODES.duplicateWorld)
  assert.equal(supervisor.register({ id: 'BAD', start: async () => {} }).code, WORLD_SUPERVISOR_CODES.invalidSpec)
  assert.equal(supervisor.register({ id: 'nomethod' }).code, WORLD_SUPERVISOR_CODES.invalidSpec)
  assert.equal(
    supervisor.register({ id: 'badstop', start: async () => {}, stop: 'nope' }).code,
    WORLD_SUPERVISOR_CODES.invalidSpec,
  )
  assert.equal(
    supervisor.register({ id: 'badhealth', start: async () => {}, health: 1 }).code,
    WORLD_SUPERVISOR_CODES.invalidSpec,
  )
  assert.equal(supervisor.get('chat').state, 'stopped')
  assert.equal(supervisor.get('missing'), null)
  assert.equal(supervisor.list().length, 1)
  assert.equal(supervisor.list({ state: 'running' }).length, 0)
  assert.equal(supervisor.unregister('chat').ok, true)
  assert.equal(supervisor.unregister('chat').code, WORLD_SUPERVISOR_CODES.unknownWorld)
  assert.ok(WORLD_STATES.includes('degraded'))
  assert.ok(WORLD_SUPERVISOR_EVENTS.includes('world.restarting'))
  assert.equal(WORLD_SUPERVISOR_VERSION, 1)
})

test('world-supervisor D3：启停与幂等', async () => {
  const calls = []
  const events = []
  const supervisor = createWorldSupervisor({
    now: () => 1000,
    autoRestart: false,
    onEvent: (event) => events.push(event.type),
  })
  supervisor.register({
    id: 'chat-world',
    start: async () => calls.push('start'),
    stop: async () => calls.push('stop'),
  })
  const started = await supervisor.startWorld('chat-world')
  assert.equal(started.ok, true)
  assert.equal(started.state, 'running')
  assert.deepEqual(calls, ['start'])
  assert.equal((await supervisor.startWorld('chat-world')).already, true)
  assert.equal(supervisor.get('chat-world').state, 'running')
  const stopped = await supervisor.stopWorld('chat-world')
  assert.equal(stopped.ok, true)
  assert.equal(stopped.state, 'stopped')
  assert.deepEqual(calls, ['start', 'stop'])
  assert.equal((await supervisor.stopWorld('chat-world')).already, true)
  assert.equal((await supervisor.startWorld('missing')).code, WORLD_SUPERVISOR_CODES.unknownWorld)
  assert.ok(events.includes('world.started'))
  assert.ok(events.includes('world.stopped'))
  assert.equal(supervisor.snapshot().metrics.starts, 1)
})

test('world-supervisor D3：health 失败 → degraded → 恢复/重启', async () => {
  const timers = createSupervisorFakeTimers()
  let healthOk = true
  const events = []
  const supervisor = createWorldSupervisor({
    now: () => 1000,
    timers,
    healthFailureThreshold: 2,
    onEvent: (event) => events.push({ type: event.type, detail: event.detail }),
  })
  supervisor.register({
    id: 'game-world',
    start: async () => {},
    stop: async () => {},
    health: async () => (healthOk ? { ok: true } : { ok: false, detail: 'bot frozen' }),
    backoffMs: 50,
  })
  await supervisor.startWorld('game-world')
  assert.equal((await supervisor.probe('game-world')).ok, true)
  assert.equal(supervisor.get('game-world').state, 'running')

  healthOk = false
  const firstFailure = await supervisor.probe('game-world')
  assert.equal(firstFailure.ok, false)
  assert.equal(firstFailure.state, 'degraded')
  assert.equal(supervisor.get('game-world').health.consecutiveFailures, 1)
  assert.ok(events.some((event) => event.type === 'world.health' && event.detail.ok === false))

  // 未达阈值时恢复
  healthOk = true
  const recovered = await supervisor.probe('game-world')
  assert.equal(recovered.ok, true)
  assert.equal(supervisor.get('game-world').state, 'running')
  assert.ok(events.some((event) => event.type === 'world.recovered'))

  // 连续两次失败 → 按崩溃处理（退避重启）
  healthOk = false
  await supervisor.probe('game-world')
  const crashed = await supervisor.probe('game-world')
  assert.equal(crashed.ok, false)
  assert.equal(supervisor.get('game-world').state, 'restarting')
  assert.deepEqual(timers.delays(), [50])
  assert.equal(supervisor.get('game-world').restarts, 1)

  // 探测非运行状态明确报错
  const notRunning = await supervisor.probe('missing')
  assert.equal(notRunning.code, WORLD_SUPERVISOR_CODES.unknownWorld)
})

test('world-supervisor D3：崩溃重启指数退避与恢复', async () => {
  const timers = createSupervisorFakeTimers()
  const calls = []
  const supervisor = createWorldSupervisor({ now: () => 1000, timers, autoRestart: true })
  supervisor.register({
    id: 'bot',
    start: async (input) => calls.push(['start', input.restart === true, input.attempt]),
    stop: async () => calls.push(['stop']),
    maxRestarts: 3,
    backoffMs: 100,
    backoffFactor: 2,
    maxBackoffMs: 1000,
  })
  await supervisor.startWorld('bot')
  const crash1 = supervisor.crash('bot', 'process exit 1')
  assert.equal(crash1.scheduled, true)
  assert.equal(crash1.delayMs, 100)
  assert.equal(supervisor.get('bot').state, 'restarting')
  assert.deepEqual(timers.delays(), [100])

  timers.runNext()
  await supervisor.flush()
  assert.equal(supervisor.get('bot').state, 'running')
  assert.deepEqual(calls.slice(-2), [['stop'], ['start', true, 1]])

  const crash2 = supervisor.crash('bot', 'process exit 2')
  assert.equal(crash2.delayMs, 200, '指数退避')
  assert.deepEqual(timers.delays(), [200])
  timers.runNext()
  await supervisor.flush()
  const crash3 = supervisor.crash('bot', 'process exit 3')
  assert.equal(crash3.delayMs, 400)
  timers.runNext()
  await supervisor.flush()
  assert.equal(supervisor.get('bot').state, 'running')
  const snapshot = supervisor.snapshot()
  assert.equal(snapshot.metrics.crashes, 3)
  assert.equal(snapshot.metrics.restarts, 3)
})

test('world-supervisor D3：重启超限 → error 且不再重试', async () => {
  const timers = createSupervisorFakeTimers()
  const events = []
  const supervisor = createWorldSupervisor({ now: () => 1000, timers, onEvent: (event) => events.push(event) })
  supervisor.register({ id: 'bot', start: async () => {}, maxRestarts: 1, backoffMs: 10 })
  await supervisor.startWorld('bot')
  assert.equal(supervisor.crash('bot', 'boom').scheduled, true)
  // 重启进行中再次崩溃 → 超限
  const exhausted = supervisor.crash('bot', 'boom again')
  assert.equal(exhausted.scheduled, false)
  assert.equal(exhausted.exhausted, true)
  assert.equal(supervisor.get('bot').state, 'error')
  assert.equal(supervisor.get('bot').lastError.code, WORLD_SUPERVISOR_CODES.restartExhausted)
  assert.deepEqual(timers.delays(), [], '不再排重试定时器')
  assert.ok(events.some((event) => event.type === 'world.error' && event.detail.reason === 'restart-exhausted'))
  // 已 error 的崩溃上报被忽略
  assert.equal(supervisor.crash('bot', 'ignored').code, WORLD_SUPERVISOR_CODES.crashIgnored)
})

test('world-supervisor D3：autoRestart=false 启动失败直接 error', async () => {
  const events = []
  const supervisor = createWorldSupervisor({
    now: () => 1000,
    autoRestart: false,
    onEvent: (event) => events.push(event.type),
  })
  supervisor.register({
    id: 'broken',
    start: async () => {
      throw new Error('cannot bind port')
    },
  })
  const result = await supervisor.startWorld('broken')
  assert.equal(result.ok, false)
  assert.equal(result.code, WORLD_SUPERVISOR_CODES.startFailed)
  assert.equal(result.state, 'error')
  assert.equal(supervisor.get('broken').state, 'error')
  assert.equal(supervisor.get('broken').lastError.message, 'cannot bind port')
  assert.ok(events.includes('world.error'))
})

test('world-supervisor D3：隔离（一个 World 崩溃不影响其他）', async () => {
  const timers = createSupervisorFakeTimers()
  const calls = []
  const supervisor = createWorldSupervisor({ now: () => 1000, timers, autoRestart: false })
  supervisor.register({ id: 'good-world', start: async () => calls.push('good-start'), health: async () => true })
  supervisor.register({
    id: 'bad-world',
    start: async () => {
      throw new Error('bad world start failed')
    },
  })
  await supervisor.startWorld('good-world')
  const bad = await supervisor.startWorld('bad-world')
  assert.equal(bad.state, 'error')
  assert.equal(supervisor.get('good-world').state, 'running', '其他 World 不受影响')
  assert.equal((await supervisor.probe('good-world')).ok, true)
  assert.equal(supervisor.snapshot().byState.running, 1)
  assert.equal(supervisor.snapshot().byState.error, 1)
  // stopAll 也隔离
  const stopped = await supervisor.stopAll()
  assert.equal(stopped.ok, true)
  assert.equal(stopped.results.length, 2)
  assert.equal(supervisor.get('good-world').state, 'stopped')
  assert.equal(supervisor.get('bad-world').state, 'stopped')
  assert.deepEqual(calls, ['good-start'])
})

test('world-supervisor D3：stopAll 中单个 stop 抛错不影响其他', async () => {
  const events = []
  const supervisor = createWorldSupervisor({
    now: () => 1000,
    autoRestart: false,
    onEvent: (event) => events.push(event.type),
  })
  supervisor.register({
    id: 'one',
    start: async () => {},
    stop: async () => {
      throw new Error('stop boom')
    },
  })
  supervisor.register({ id: 'two', start: async () => {}, stop: async () => {} })
  await supervisor.startWorld('one')
  await supervisor.startWorld('two')
  const result = await supervisor.stopAll()
  assert.equal(result.ok, true)
  assert.equal(supervisor.get('one').state, 'stopped')
  assert.equal(supervisor.get('two').state, 'stopped')
  assert.equal(supervisor.get('one').lastError.code, WORLD_SUPERVISOR_CODES.stopFailed)
  assert.ok(events.includes('world.stopped'))
})

test('world-supervisor D3：手动 restart 重置重试预算；失败进入 error', async () => {
  const timers = createSupervisorFakeTimers()
  const calls = []
  let startShouldFail = false
  const supervisor = createWorldSupervisor({ now: () => 1000, timers })
  supervisor.register({
    id: 'bot',
    start: async () => {
      calls.push('start')
      if (startShouldFail) throw new Error('manual restart failed')
    },
    stop: async () => calls.push('stop'),
    maxRestarts: 1,
  })
  await supervisor.startWorld('bot')
  supervisor.crash('bot', 'boom')
  assert.equal(supervisor.get('bot').restarts, 1)
  // 手动 restart：重置预算并立即重启
  const restarted = await supervisor.restart('bot')
  assert.equal(restarted.ok, true)
  assert.equal(restarted.state, 'running')
  assert.equal(supervisor.get('bot').restarts, 0, '手动重启重置重试预算')
  assert.deepEqual(calls, ['start', 'stop', 'start'])
  // 手动重启失败 → error（不自动再排）
  startShouldFail = true
  const failed = await supervisor.restart('bot')
  assert.equal(failed.ok, false)
  assert.equal(supervisor.get('bot').state, 'error')
  assert.deepEqual(timers.delays(), [])
})

test('world-supervisor D3：snapshot 指标与 pending 清理', async () => {
  const timers = createSupervisorFakeTimers()
  const supervisor = createWorldSupervisor({ now: () => 1000, timers })
  supervisor.register({ id: 'bot', start: async () => {}, backoffMs: 10 })
  await supervisor.startWorld('bot')
  supervisor.crash('bot', 'boom')
  const snapshot = supervisor.snapshot()
  assert.equal(snapshot.total, 1)
  assert.equal(snapshot.byState.restarting, 1)
  assert.equal(snapshot.pendingTimers, 1)
  assert.equal(typeof snapshot.metrics.crashes, 'number')
  timers.runNext()
  await supervisor.flush()
  const after = supervisor.snapshot()
  assert.equal(after.byState.running, 1)
  assert.equal(after.pendingTimers, 0)
  assert.equal(after.pendingRestarts, 0)
})

// ---------------------------------------------------------------------------
// Gate D4：Hub 装配（lib/core/hub.mjs）——装配/shadow/事件桥/receipt→feedback/降级
// ---------------------------------------------------------------------------

function makeHubFixture(flag = { enabled: true, shadow: false }) {
  const calls = {
    busAppends: [],
    completes: [],
    fails: [],
    feedbacks: [],
    promotions: 0,
    memoryWrites: [],
    executes: [],
    schedulerTicks: 0,
    worldStarts: [],
    worldStops: 0,
  }
  const bus = {
    append(event) {
      calls.busAppends.push(event)
      return { ok: true }
    },
    snapshot: () => ({ stored: calls.busAppends.length }),
  }
  const board = {
    list: () => [
      {
        id: 'tb-1',
        activity: 'chat',
        kind: 'chat.turn',
        key: 'chat.turn:p:m',
        priority: 5,
        createdAt: 1000,
        status: 'queued',
        title: '回复 p',
      },
      {
        id: 'tb-2',
        activity: 'chat',
        kind: 'chat.turn',
        key: 'chat.turn:p:n',
        priority: 1,
        createdAt: 1100,
        status: 'queued',
        title: '回复 q',
      },
    ],
    complete: (id, receipt) => {
      calls.completes.push({ id, receipt })
      return { ok: true }
    },
    fail: (id, error) => {
      calls.fails.push({ id, error })
      return { ok: true }
    },
    snapshot: () => ({ total: 2 }),
  }
  const scheduler = {
    tick: () => {
      calls.schedulerTicks += 1
      return {
        ok: true,
        action: 'start',
        task: { id: 'tb-1', activity: 'chat', kind: 'chat.turn', key: 'chat.turn:p:m', title: '回复 p' },
      }
    },
    snapshot: () => ({ foreground: null }),
  }
  const ledger = {
    record(input) {
      calls.feedbacks.push(input)
      return { ok: true, record: { id: 'fb-1', outcome: input.outcome } }
    },
    promoteToMethod() {
      calls.promotions += 1
      return { ok: true, candidate: { kind: 'method', memoryEntry: { category: 'method', text: '方法候选' } } }
    },
    snapshot: () => ({ records: calls.feedbacks.length }),
  }
  const gateway = {
    write(entry) {
      calls.memoryWrites.push(entry)
      return { ok: true }
    },
    snapshot: () => ({ entries: 0 }),
  }
  const adapter = {
    async execute(task) {
      calls.executes.push(task.id)
      return { ok: true, receipt: { ok: true, replyId: 'r-1', at: 1000, taskKey: task.key } }
    },
  }
  const worldSupervisor = {
    list: () => [{ id: 'chat-world', state: 'stopped' }],
    startWorld: async (id) => {
      calls.worldStarts.push(id)
      return { ok: true }
    },
    stopAll: async () => {
      calls.worldStops += 1
      return { ok: true, results: [] }
    },
    snapshot: () => ({ total: 1 }),
  }
  const hub = createHub({
    eventBus: bus,
    taskBoard: board,
    scheduler,
    feedbackLedger: ledger,
    memoryGateway: gateway,
    worldSupervisor,
    activityManifests: [{ manifest: { id: 'chat' }, execute: adapter.execute }],
    featureFlag: flag,
    now: () => 1000,
  })
  return { hub, calls, bus, board, scheduler, ledger, gateway, adapter, worldSupervisor }
}

test('hub D4：默认 shadow/off 装配与无副作用', async () => {
  const { hub, calls } = makeHubFixture(HUB_DEFAULT_FEATURE_FLAG)
  assert.equal(hub.mode(), 'off')
  const tick = await hub.tick()
  assert.equal(tick.ok, true)
  assert.equal(tick.mode, 'off')
  assert.equal(tick.skipped, true)
  assert.equal(calls.schedulerTicks, 0, 'off 模式不调度')
  assert.equal(calls.busAppends.length, 0)
  assert.equal(calls.completes.length, 0)
  assert.equal(calls.executes.length, 0)
  assert.equal(calls.feedbacks.length, 0)
  assert.equal(calls.memoryWrites.length, 0)
  const started = hub.start()
  assert.equal(started.mode, 'off')
  assert.equal(hub.mode(), 'off')
  const snapshot = hub.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.version, HUB_VERSION)
  assert.equal(snapshot.state, 'created')
  assert.equal(snapshot.featureFlag.enabled, false)
  assert.equal(snapshot.available.taskBoard, true)
  assert.equal(snapshot.available.eventBus, true)
  assert.ok(HUB_MODES.includes('shadow'))
  assert.ok(HUB_STATES.includes('running'))
})

test('hub D4：shadow 模式只读决策，不 claim/execute/写状态', async () => {
  const { hub, calls } = makeHubFixture({ enabled: true, shadow: true })
  const started = hub.start()
  assert.equal(started.mode, 'shadow')
  assert.equal(calls.schedulerTicks, 0, 'shadow 不调用 scheduler.tick（无副作用）')
  const tick = await hub.tick()
  assert.equal(tick.ok, true)
  assert.equal(tick.mode, 'shadow')
  assert.equal(tick.executed, false)
  assert.equal(tick.decision.action, 'would-start')
  assert.equal(tick.decision.task.id, 'tb-1', '按优先级选下一步')
  assert.equal(calls.executes.length, 0)
  assert.equal(calls.completes.length, 0)
  assert.equal(calls.fails.length, 0)
  assert.equal(calls.feedbacks.length, 0)
  assert.equal(calls.busAppends.length, 0)
  assert.equal(hub.snapshot().metrics.shadowTicks, 1)
})

test('hub D4：full 模式 tick → execute → receipt → feedback → method 候选', async () => {
  const { hub, calls, ledger, gateway } = makeHubFixture({ enabled: true, shadow: false })
  hub.start()
  assert.equal(hub.mode(), 'full')
  assert.equal(calls.worldStarts.length, 1, 'full 模式启动已注册 World')
  const result = await hub.tick()
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'full')
  assert.equal(result.executed, true)
  assert.equal(result.success, true)
  assert.equal(calls.schedulerTicks, 1)
  assert.deepEqual(calls.executes, ['tb-1'])
  assert.equal(calls.completes.length, 1)
  assert.deepEqual(calls.completes[0].receipt, { ok: true, replyId: 'r-1', at: 1000, taskKey: 'chat.turn:p:m' })
  assert.equal(calls.feedbacks.length, 1)
  const feedback = calls.feedbacks[0]
  assert.equal(feedback.taskId, 'tb-1')
  assert.equal(feedback.outcome, 'success')
  assert.equal(feedback.receipt.kind, 'event')
  assert.equal(feedback.receipt.ok, true)
  assert.equal(feedback.receipt.ref, 'tb-1')
  assert.equal(feedback.hypothesis, '回复 p')
  assert.ok(feedback.evidence.some((item) => item.includes('replyId=r-1')))
  assert.equal(calls.promotions, 1)
  assert.equal(result.candidate.kind, 'method')
  assert.equal(calls.memoryWrites.length, 0, '默认不写 Memory Gateway')
  assert.equal(ledger.snapshot().records, 1)
  assert.equal(gateway.snapshot().entries, 0)
  assert.equal(hub.snapshot().metrics.feedbacks, 1)
  assert.equal(hub.snapshot().metrics.candidates, 1)
})

test('hub D4：full 模式失败 receipt → fail + failure feedback', async () => {
  const { hub, calls } = makeHubFixture({ enabled: true, shadow: false })
  calls.executes.length = 0
  hub.start()
  // 用失败 adapter 覆盖
  const failingHub = createHub({
    taskBoard: {
      list: () => [],
      complete: () => ({ ok: true }),
      fail: (id, error) => {
        calls.fails.push({ id, error })
        return { ok: true }
      },
      snapshot: () => ({ total: 1 }),
    },
    scheduler: {
      tick: () => ({
        ok: true,
        action: 'start',
        task: { id: 'tb-9', activity: 'chat', kind: 'chat.turn', title: '失败任务' },
      }),
      snapshot: () => ({}),
    },
    feedbackLedger: {
      record: (input) => {
        calls.feedbacks.push(input)
        return { ok: true, record: { id: 'fb-2', outcome: input.outcome } }
      },
      promoteToMethod: () => {
        calls.promotions += 1
        return { ok: true, candidate: { kind: 'method' } }
      },
      snapshot: () => ({}),
    },
    activityManifests: [
      {
        manifest: { id: 'chat' },
        execute: async () => ({ ok: true, receipt: { ok: false, at: 1000, message: '模型超时' } }),
      },
    ],
    featureFlag: { enabled: true, shadow: false },
    now: () => 1000,
  })
  failingHub.start()
  const result = await failingHub.tick()
  assert.equal(result.ok, true)
  assert.equal(result.executed, true)
  assert.equal(result.success, false)
  assert.equal(calls.fails.length, 1)
  assert.equal(calls.fails[0].id, 'tb-9')
  assert.equal(calls.fails[0].error.message, '模型超时')
  assert.equal(calls.feedbacks[0].outcome, 'failure')
  assert.equal(calls.promotions, 0, '失败不升级方法')
  assert.equal(result.candidate, null)
  assert.equal(failingHub.mode(), 'full')
})

test('hub D4：缺 adapter / adapter 抛错 都隔离且任务收尾', async () => {
  const fails = []
  const make = (execute) =>
    createHub({
      taskBoard: {
        list: () => [],
        fail: (id, error) => {
          fails.push({ id, error })
          return { ok: true }
        },
        complete: () => ({ ok: true }),
        snapshot: () => ({}),
      },
      scheduler: {
        tick: () => ({
          ok: true,
          action: 'start',
          task: { id: 'tb-1', activity: 'minecraft', kind: 'minecraft.build' },
        }),
        snapshot: () => ({}),
      },
      activityManifests: execute === null ? [] : [{ manifest: { id: 'minecraft' }, execute }],
      featureFlag: { enabled: true, shadow: false },
      now: () => 1000,
    })
  const noAdapter = make(null)
  noAdapter.start()
  const missing = await noAdapter.tick()
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, HUB_CODES.noAdapter)
  assert.equal(fails.length, 1)

  const throwing = make(async () => {
    throw new Error('adapter exploded')
  })
  throwing.start()
  const crashed = await throwing.tick()
  assert.equal(crashed.ok, false)
  assert.equal(crashed.error.code, HUB_CODES.adapterFailed)
  assert.equal(fails.length, 2)
  assert.equal(fails[1].error.message, 'adapter exploded')
})

test('hub D4：事件桥接（Task Board/Registry → Event Bus）', async () => {
  const { hub, bus, calls } = makeHubFixture({ enabled: true, shadow: false })
  hub.start()
  let handler = null
  let detached = false
  const source = {
    subscribe(fn) {
      handler = fn
      return () => {
        detached = true
      }
    },
  }
  assert.equal(hub.attachEventSource('taskBoard', source).ok, true)
  handler({ type: 'task.created', at: 1000, seq: 3, task: { id: 'tb-1' } })
  assert.equal(calls.busAppends.length, 1)
  const event = calls.busAppends[0]
  assert.equal(event.activity, 'taskBoard'.toLowerCase())
  assert.equal(event.type, 'task.created')
  assert.equal(event.subject, 'tb-1')
  assert.equal(event.payload.source, 'taskBoard')
  assert.equal(event.payload.data.type, 'task.created')
  assert.equal(validateEventEnvelope(event).ok, true)
  // 非法来源事件被拒绝
  assert.equal(hub.ingest('taskBoard', { at: 1000 }).code, HUB_CODES.eventBridgeFailed)
  // off 模式不桥接
  const offHub = makeHubFixture(HUB_DEFAULT_FEATURE_FLAG).hub
  assert.equal(offHub.attachEventSource('taskBoard', source).skipped, true)
  assert.equal(offHub.ingest('taskBoard', { type: 'task.created' }).skipped, true)
  await hub.stop()
  assert.equal(detached, true, 'stop 时解除事件订阅')
  assert.equal(bus.snapshot().stored, 1)
})

test('hub D4：allowMemoryWrite 才写 Memory Gateway', async () => {
  const { hub, calls } = makeHubFixture({ enabled: true, shadow: false })
  hub.start()
  await hub.tick()
  assert.equal(calls.memoryWrites.length, 0)

  const writing = makeHubFixture({ enabled: true, shadow: false })
  const writeHub = createHub({
    taskBoard: writing.board,
    scheduler: writing.scheduler,
    feedbackLedger: writing.ledger,
    memoryGateway: writing.gateway,
    activityManifests: [{ manifest: { id: 'chat' }, execute: writing.adapter.execute }],
    featureFlag: { enabled: true, shadow: false },
    allowMemoryWrite: true,
    now: () => 1000,
  })
  writeHub.start()
  const result = await writeHub.tick()
  assert.equal(result.candidate.kind, 'method')
  assert.equal(writing.calls.memoryWrites.length, 1)
  assert.deepEqual(writing.calls.memoryWrites[0], { category: 'method', text: '方法候选' })
  assert.equal(writeHub.snapshot().metrics.memoryWrites, 1)
})

test('hub D4：模块缺失降级与依赖异常隔离', async () => {
  const empty = createHub({})
  assert.equal(empty.mode(), 'off')
  assert.equal((await empty.tick()).skipped, true)
  const snapshot = empty.snapshot()
  assert.equal(snapshot.available.taskBoard, false)
  assert.equal(snapshot.available.scheduler, false)
  assert.equal(snapshot.layers.taskBoard, null)
  assert.equal(empty.health().ok, true)
  assert.equal(empty.start().mode, 'off')

  // full 模式缺 scheduler → 明确错误
  const noScheduler = createHub({
    taskBoard: { list: () => [], snapshot: () => ({}) },
    featureFlag: { enabled: true, shadow: false },
  })
  noScheduler.start()
  const result = await noScheduler.tick()
  assert.equal(result.ok, false)
  assert.equal(result.code, HUB_CODES.dependencyError)

  // 某层 snapshot 抛错 → 聚合仍 ok，errors 记录该层
  const brokenBoard = {
    list: () => [],
    snapshot() {
      throw new Error('board snapshot boom')
    },
  }
  const broken = createHub({ taskBoard: brokenBoard, featureFlag: { enabled: true, shadow: false } })
  const brokenSnapshot = broken.snapshot()
  assert.equal(brokenSnapshot.ok, true)
  assert.equal(brokenSnapshot.errors.length, 1)
  assert.equal(brokenSnapshot.errors[0].layer, 'taskBoard')
  assert.equal(broken.health().errors, 1)
})

test('hub D4：stop 停止 World 并回到 off', async () => {
  const { hub, calls } = makeHubFixture({ enabled: true, shadow: false })
  hub.start()
  await waitMs(0)
  assert.deepEqual(calls.worldStarts, ['chat-world'])
  const stopped = await hub.stop()
  assert.equal(stopped.ok, true)
  assert.equal(calls.worldStops, 1)
  assert.equal(hub.mode(), 'off')
  assert.equal((await hub.tick()).skipped, true)
  assert.equal((await hub.stop()).already, true)
  // 再次 start 可恢复（enabled 配置仍在）
  assert.equal(hub.start().mode, 'full')
})

// ---------------------------------------------------------------------------
// Gate E1：Hub Runtime 装配（lib/composition/hub-runtime.mjs）——默认 off/shadow、零副作用
// ---------------------------------------------------------------------------

function makeHubRuntimeFixture(flag) {
  const calls = {
    busAppends: 0,
    schedulerTicks: 0,
    completes: 0,
    executes: 0,
    feedbacks: 0,
    worldStarts: 0,
    worldStops: 0,
  }
  const eventBus = {
    append() {
      calls.busAppends += 1
      return { ok: true }
    },
    snapshot: () => ({ stored: calls.busAppends }),
  }
  const taskBoard = {
    list: () => [
      {
        id: 'tb-1',
        activity: 'chat',
        kind: 'chat.turn',
        key: 'chat.turn:p:m',
        priority: 5,
        createdAt: 1000,
        status: 'queued',
        title: '回复 p',
      },
    ],
    complete: () => {
      calls.completes += 1
      return { ok: true }
    },
    fail: () => ({ ok: true }),
    snapshot: () => ({ total: 1 }),
  }
  const scheduler = {
    tick: () => {
      calls.schedulerTicks += 1
      return { ok: true, action: 'start', task: { id: 'tb-1', activity: 'chat', kind: 'chat.turn', title: '回复 p' } }
    },
    snapshot: () => ({ foreground: null }),
  }
  const feedbackLedger = {
    record: () => {
      calls.feedbacks += 1
      return { ok: true, record: { id: 'fb-1', outcome: 'success' } }
    },
    promoteToMethod: () => ({
      ok: true,
      candidate: { kind: 'method', memoryEntry: { category: 'method', text: 'x' } },
    }),
    snapshot: () => ({ records: 1 }),
  }
  const adapter = {
    async execute() {
      calls.executes += 1
      return { ok: true, receipt: { ok: true, at: 1000 } }
    },
  }
  const worldSupervisor = {
    list: () => [{ id: 'chat-world', state: 'stopped' }],
    startWorld: async () => {
      calls.worldStarts += 1
      return { ok: true }
    },
    stopAll: async () => {
      calls.worldStops += 1
      return { ok: true }
    },
    snapshot: () => ({ total: 1 }),
  }
  const runtime = createHubRuntime({
    logger: { warn() {} },
    env: {},
    settings: {},
    eventBus,
    taskBoard,
    scheduler,
    feedbackLedger,
    worldSupervisor,
    activityManifests: [{ manifest: { id: 'chat' }, execute: adapter.execute }],
    featureFlag: flag,
    now: () => 1000,
  })
  return { runtime, calls }
}

test('hub-runtime E1：feature flag 解析（默认 off/shadow；显式 > env > settings）', () => {
  assert.deepEqual(resolveHubFeatureFlag({}), { enabled: false, shadow: true, memoryWrite: false, persist: true })
  assert.deepEqual(resolveHubFeatureFlag({ env: {} }), {
    enabled: false,
    shadow: true,
    memoryWrite: false,
    persist: true,
  })
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB: 'shadow' } }).shadow, true)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB: 'shadow' } }).enabled, true)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB: '1' } }).shadow, false)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB: 'on' } }).enabled, true)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB: 'off' } }).enabled, false)
  assert.deepEqual(resolveHubFeatureFlag({ settings: { hub: { enabled: true, shadow: false } } }), {
    enabled: true,
    shadow: false,
    memoryWrite: false,
    persist: true,
  })
  // 显式覆盖 env/settings
  const explicit = resolveHubFeatureFlag({ featureFlag: { enabled: true, shadow: true }, env: { DSH_POETRY_HUB: '1' } })
  assert.equal(explicit.enabled, true)
  assert.equal(explicit.shadow, true)
  assert.equal(HUB_RUNTIME_VERSION, 1)
  assert.deepEqual(HUB_RUNTIME_DEFAULT_FLAG, { enabled: false, shadow: true, memoryWrite: false, persist: true })
})

test('hub-runtime E1：默认 off 无副作用（不调度/不执行/不写事件）', async () => {
  const { runtime, calls } = makeHubRuntimeFixture(undefined)
  assert.equal(runtime.featureFlag.enabled, false)
  assert.equal(runtime.snapshot().mode, 'off')
  assert.equal(runtime.snapshot().started, false)
  const started = runtime.start()
  assert.equal(started.ok, true)
  assert.equal(started.mode, 'off')
  const tick = await runtime.tick()
  assert.equal(tick.skipped, true)
  assert.equal(tick.mode, 'off')
  assert.equal(calls.schedulerTicks, 0)
  assert.equal(calls.executes, 0)
  assert.equal(calls.completes, 0)
  assert.equal(calls.busAppends, 0)
  assert.equal(calls.feedbacks, 0)
  assert.equal(calls.worldStarts, 0)
  const health = runtime.health()
  assert.equal(health.ok, true)
  assert.equal(health.mode, 'off')
  assert.equal(health.enabled, false)
  await runtime.stop()
  assert.equal(runtime.snapshot().started, false)
})

test('hub-runtime E1：shadow 模式只读（不调用 scheduler.tick、不执行）', async () => {
  const { runtime, calls } = makeHubRuntimeFixture({ enabled: true, shadow: true })
  runtime.start()
  assert.equal(runtime.snapshot().mode, 'shadow')
  const tick = await runtime.tick()
  assert.equal(tick.mode, 'shadow')
  assert.equal(tick.executed, false)
  assert.equal(tick.decision.action, 'would-start')
  assert.equal(tick.decision.task.id, 'tb-1')
  assert.equal(calls.schedulerTicks, 0)
  assert.equal(calls.executes, 0)
  assert.equal(calls.completes, 0)
  assert.equal(calls.busAppends, 0)
  assert.equal(runtime.snapshot().hub.metrics.shadowTicks, 1)
  assert.equal(runtime.health().shadow, true)
})

test('hub-runtime E1：full 模式启动/执行/停止/dispose', async () => {
  const { runtime, calls } = makeHubRuntimeFixture({ enabled: true, shadow: false })
  const started = runtime.start()
  assert.equal(started.ok, true)
  assert.equal(runtime.snapshot().mode, 'full')
  await waitMs(0)
  assert.equal(calls.worldStarts, 1, 'full 模式启动已注册 World')
  const tick = await runtime.tick()
  assert.equal(tick.ok, true)
  assert.equal(tick.executed, true)
  assert.equal(calls.schedulerTicks, 1)
  assert.equal(calls.executes, 1)
  assert.equal(calls.completes, 1)
  assert.equal(calls.feedbacks, 1)
  assert.equal(runtime.snapshot().started, true)
  const stopped = await runtime.stop()
  assert.equal(stopped.ok, true)
  assert.equal(runtime.snapshot().mode, 'off')
  assert.equal(calls.worldStops, 1)
  assert.equal(runtime.dispose().ok, true)
  assert.equal(runtime.snapshot().disposed, true)
  assert.equal(runtime.dispose().already, true, 'dispose 幂等')
  assert.equal((await runtime.tick()).code, 'HUB_RUNTIME_DISPOSED')
})

test('hub-runtime E1：模块缺失降级与错误隔离', async () => {
  const runtime = createHubRuntime({ assembleHub: false })
  assert.equal(runtime.start().ok, true)
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.hub.available.taskBoard, false)
  assert.equal(snapshot.hub.available.scheduler, false)
  assert.equal(runtime.health().ok, true)
  const tick = await runtime.tick()
  assert.equal(tick.skipped, true)
  runtime.dispose()

  // Hub 内部异常不抛到运行时
  const brokenScheduler = {
    tick() {
      throw new Error('scheduler boom')
    },
    snapshot() {
      throw new Error('snapshot boom')
    },
  }
  const broken = createHubRuntime({
    scheduler: brokenScheduler,
    taskBoard: { list: () => [], snapshot: () => ({}) },
    featureFlag: { enabled: true, shadow: false },
    logger: { warn() {} },
  })
  broken.start()
  const result = await broken.tick()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HUB_RUNTIME_TICK_FAILED')
  const brokenSnapshot = broken.snapshot()
  assert.equal(brokenSnapshot.ok, true)
  assert.ok(brokenSnapshot.hub.errors.length >= 1)
  assert.ok(brokenSnapshot.lastError !== null)
})

test('hub-runtime E1：registerHubRuntime 生命周期接线（可注入 serviceRuntime）', () => {
  const registered = []
  const serviceRuntime = {
    register(name, handlers) {
      registered.push({ name, handlers })
    },
  }
  const runtime = registerHubRuntime(serviceRuntime, {
    featureFlag: { enabled: true, shadow: true },
    logger: { warn() {} },
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'Hub')
  assert.equal(typeof registered[0].handlers.start, 'function')
  assert.equal(typeof registered[0].handlers.dispose, 'function')
  assert.equal(registered[0].handlers.snapshot().mode, 'off')
  registered[0].handlers.start()
  assert.equal(runtime.snapshot().started, true)
  assert.equal(runtime.snapshot().mode, 'shadow')
  registered[0].handlers.dispose()
  assert.equal(runtime.snapshot().disposed, true)

  // register 抛错（重复注册等）也不影响运行时创建
  const throwing = {
    register() {
      throw new Error('duplicate service')
    },
  }
  const fallback = registerHubRuntime(throwing, {
    featureFlag: { enabled: false, shadow: true },
    logger: { warn() {} },
  })
  assert.equal(fallback.snapshot().mode, 'off')
})

test('hub-runtime E1：health 增加 hub 指标（available/mode/metrics）', () => {
  const { runtime } = makeHubRuntimeFixture({ enabled: true, shadow: true })
  const metrics = buildHealthMetrics({ hubRuntime: runtime }, 1000)
  assert.equal(metrics.hub.available, true)
  assert.equal(metrics.hub.mode, 'off', '未 start 时 off')
  assert.equal(metrics.hub.enabled, true)
  assert.equal(metrics.hub.shadow, true)
  assert.equal(metrics.hub.metrics.ticks, 0)
  assert.equal(typeof metrics.hub.metrics.executed, 'number')

  runtime.start()
  const started = buildHealthMetrics({ hub: runtime.snapshot() }, 1000)
  assert.equal(started.hub.available, true)
  assert.equal(started.hub.mode, 'shadow')
  assert.equal(started.hub.state, 'running')

  // 未接线 / 快照异常降级
  const empty = buildHealthMetrics({}, 1000)
  assert.equal(empty.hub.available, false)
  assert.equal(empty.hub.mode, 'off')
  assert.equal(empty.hub.metrics, null)
  assert.equal(summarizeHub(null).available, false)
  const throwing = summarizeHub({
    snapshot() {
      throw new Error('boom')
    },
  })
  assert.equal(throwing.available, false)
  assert.equal(throwing.reason, 'snapshot-failed')
})

// ---------------------------------------------------------------------------
// Gate E2：Chat Activity shadow 接入（lib/composition/chat-service.mjs）——事件入 Hub，回复不变
// ---------------------------------------------------------------------------

function makeChatShadowFixture(options = {}) {
  const warnings = []
  const bridgeCalls = []
  const appends = []
  const dir = tmpDir('chat-shadow')
  const eventBus = {
    append(event) {
      appends.push(event)
      return { ok: true }
    },
    snapshot: () => ({ stored: appends.length }),
  }
  const hubRuntime = createHubRuntime({
    eventBus,
    featureFlag: options.featureFlag ?? { enabled: true, shadow: true },
    logger: { warn: (message) => warnings.push(message) },
    now: () => 1000,
  })
  hubRuntime.start()
  const deps = {
    hubRuntime,
    logger: { warn: (message) => warnings.push(message) },
    chatBridge: {
      async chat(payload) {
        bridgeCalls.push(payload)
        return { ok: true, reply: '你好呀', felt: '平静', murmur: '' }
      },
      drainPending: () => [],
    },
    knowledgeGraph: { digest: () => [], spread: () => [] },
    relationship: { ingest: async () => ({ entries: [] }) },
    emotional: { recordFromChat: () => {} },
    memoryDir: dir,
  }
  const service = createChatHttpService(deps)
  return { service, deps, hubRuntime, appends, bridgeCalls, warnings, dir }
}

test('chat shadow E2：shadow 下事件进入 Hub，回复路径不变', async () => {
  const { service, appends, bridgeCalls, dir } = makeChatShadowFixture()
  const result = await service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-1', channel: 'qq' })
  assert.equal(result.ok, true)
  assert.equal(result.reply, '你好呀', '回复不变')
  assert.equal(bridgeCalls.length, 1)
  assert.equal(bridgeCalls[0].text, '你好', 'chatBridge 入参不变')
  assert.equal(appends.length, 1, 'shadow 事件进入 Event Bus')
  const event = appends[0]
  assert.equal(event.activity, 'chat')
  assert.equal(event.type, 'chat.received')
  assert.equal(event.payload.peerId, 'peer-1')
  assert.equal(event.payload.messageId, 'm-1')
  assert.equal(event.payload.text, '你好')
  assert.equal(event.payload.channel, 'qq')
  assert.equal(validateEventEnvelope(event).ok, true)
  rmSync(dir, { recursive: true, force: true })
})

test('chat shadow E2：off 模式不发事件、无副作用', async () => {
  const { service, appends, bridgeCalls, dir } = makeChatShadowFixture({
    featureFlag: { enabled: false, shadow: true },
  })
  const result = await service.chat({ text: '你好', peerId: 'peer-1' })
  assert.equal(result.ok, true)
  assert.equal(appends.length, 0, 'off 不发送事件')
  assert.equal(bridgeCalls.length, 1, '回复照常')
  rmSync(dir, { recursive: true, force: true })
})

test('chat shadow E2：Hub 抛错不影响回复', async () => {
  const { service, deps, bridgeCalls, warnings, dir } = makeChatShadowFixture()
  deps.hubRuntime = {
    mode: () => 'shadow',
    ingest() {
      throw new Error('hub ingest boom')
    },
  }
  const result = await service.chat({ text: '你好', peerId: 'peer-1' })
  assert.equal(result.ok, true)
  assert.equal(result.reply, '你好呀')
  assert.equal(bridgeCalls.length, 1)
  assert.ok(
    warnings.some((message) => message.includes('chat shadow 钩子失败')),
    '失败只记录',
  )
  rmSync(dir, { recursive: true, force: true })
})

test('chat shadow E2：无效/空消息跳过，不阻塞回复', async () => {
  const { service, appends, bridgeCalls, dir } = makeChatShadowFixture()
  const result = await service.chat({ text: '   ', peerId: 'peer-1' })
  assert.equal(result.ok, true)
  assert.equal(bridgeCalls.length, 1)
  assert.equal(appends.length, 0, '空文本不产生事件')
  rmSync(dir, { recursive: true, force: true })
})

test('chat shadow E2：text 脱敏/截断，不写敏感 token', async () => {
  const { service, appends, dir } = makeChatShadowFixture()
  const secret = 'sk-abcdef1234567890'
  const longText = '看看这个 ' + secret + ' ' + '很长的内容'.repeat(200)
  await service.chat({ text: longText, peerId: 'peer-1', messageId: 'm-secret' })
  assert.equal(appends.length, 1)
  const text = appends[0].payload.text
  assert.equal(text.includes(secret), false, 'token 被脱敏')
  assert.ok(text.includes('[redacted]'))
  assert.ok(Array.from(text).length <= 500, '文本截断到 500 字')
  rmSync(dir, { recursive: true, force: true })
  assert.equal(sanitizeEventText('x'.repeat(600)).length, 500)
  assert.equal(sanitizeEventText('ghp_abcdefgh12345678').includes('ghp_abcdefgh12345678'), false)
})

test('chat shadow E2：缺少 messageId 时生成稳定 id', async () => {
  const { service, appends, dir } = makeChatShadowFixture()
  await service.chat({ text: '同一句话', peerId: 'peer-1' })
  await service.chat({ text: '同一句话', peerId: 'peer-1' })
  await service.chat({ text: '另一句话', peerId: 'peer-1' })
  assert.equal(appends.length, 3)
  const first = appends[0].payload.messageId
  const second = appends[1].payload.messageId
  const third = appends[2].payload.messageId
  assert.match(first, /^auto:[0-9a-f]{16}$/)
  assert.equal(first, second, '同 peer+文本+时间 → 稳定 id')
  assert.notEqual(first, third, '不同文本 → 不同 id')
  rmSync(dir, { recursive: true, force: true })
})

test('chat shadow E2：hubRuntime.ingest 在无 Event Bus 时记录 shadow 环', () => {
  const runtime = createHubRuntime({
    assembleHub: false,
    featureFlag: { enabled: true, shadow: true },
    now: () => 1000,
  })
  runtime.start()
  const result = runtime.ingest('chat', { type: 'chat.received', at: 1000, payload: { peerId: 'p1' } })
  assert.equal(result.ok, true)
  assert.equal(result.recorded, true)
  assert.equal(result.bridged, false)
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.shadowEventCount, 1)
  assert.equal(snapshot.shadowEvents[0].source, 'chat')
  runtime.dispose()

  const offRuntime = createHubRuntime({
    assembleHub: false,
    featureFlag: { enabled: false, shadow: true },
    now: () => 1000,
  })
  assert.equal(offRuntime.ingest('chat', { type: 'chat.received' }).skipped, true)
  assert.equal(offRuntime.snapshot().shadowEventCount, 0)
  offRuntime.dispose()
})

test('chat shadow E2：无 hubRuntime 或经 active runtime 回退都能工作', async () => {
  setActiveHubRuntime(null)
  const { service, deps, bridgeCalls, dir } = makeChatShadowFixture()
  deps.hubRuntime = undefined
  const result = await service.chat({ text: '你好', peerId: 'peer-1' })
  assert.equal(result.ok, true)
  assert.equal(bridgeCalls.length, 1)
  rmSync(dir, { recursive: true, force: true })

  // 通过 active runtime 回退（真实运行时 registerHubRuntime 会设置它）
  const appends = []
  const runtime = createHubRuntime({
    eventBus: {
      append: (event) => {
        appends.push(event)
        return { ok: true }
      },
      snapshot: () => ({}),
    },
    featureFlag: { enabled: true, shadow: true },
    logger: { warn() {} },
    now: () => 1000,
  })
  runtime.start()
  setActiveHubRuntime(runtime)
  assert.equal(getActiveHubRuntime(), runtime)
  const activeFixture = makeChatShadowFixture()
  activeFixture.deps.hubRuntime = undefined
  await activeFixture.service.chat({ text: '回退消息', peerId: 'peer-2' })
  assert.equal(appends.length, 1, 'active runtime 回退生效')
  setActiveHubRuntime(null)
  runtime.dispose()
  rmSync(activeFixture.dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate E3：Minecraft shadow 接入（minecraft-world onShadowEvent → Hub）——bot 行为不变
// ---------------------------------------------------------------------------

function makeMinecraftShadowFixture(options = {}) {
  const appends = []
  const warnings = []
  const hubRuntime = createHubRuntime({
    eventBus: {
      append(event) {
        appends.push(event)
        return { ok: true }
      },
      snapshot: () => ({ stored: appends.length }),
    },
    featureFlag: options.featureFlag ?? { enabled: true, shadow: true },
    logger: { warn: (message) => warnings.push(message) },
    now: () => 1000,
  })
  hubRuntime.start()
  const sink = createMinecraftShadowSink({
    hubRuntime,
    logger: { warn: (message) => warnings.push(message) },
    worldId: 'smp',
    now: () => 1000,
  })
  const world = createMinecraftWorld({ tokenFile: '', onShadowEvent: sink, now: () => 1000 })
  return { hubRuntime, sink, world, appends, warnings }
}

test('minecraft shadow E3：receipt → minecraft.tool_receipt 事件，返回值不变', () => {
  const { world, appends } = makeMinecraftShadowFixture()
  const result = world.recordReceipt({
    tool: 'mc_build',
    ok: true,
    detail: '放了 3 块',
    facts: { placed: 3, position: '1,2,3' },
  })
  assert.equal(result.ok, true)
  assert.equal(result.accepted, true)
  assert.equal(result.lastReceipt.tool, 'mc_build')
  assert.equal(result.lastReceipt.ok, true)
  assert.equal(appends.length, 1)
  const event = appends[0]
  assert.equal(event.type, 'minecraft.tool_receipt')
  assert.equal(event.activity, 'minecraft')
  assert.equal(event.subject, 'world:smp')
  assert.equal(event.payload.tool, 'mc_build')
  assert.equal(event.payload.ok, true)
  assert.equal(event.payload.detail, '放了 3 块')
  assert.deepEqual(event.payload.facts, { placed: 3, position: '1,2,3' })
  assert.equal(validateEventEnvelope(event).ok, true)
})

test('minecraft shadow E3：observe 事件（白名单观察字段，不含 token），返回不变', async () => {
  const { world, appends } = makeMinecraftShadowFixture()
  world.interrupt('聊天打断')
  const observation = {
    position: '0,64,0',
    players: ['Yuan_JY'],
    health: 18,
    food: 12,
    token: 'secret-token',
    apiKey: 'sk-abcdef1234567890',
  }
  const result = await world.decide(observation)
  assert.equal(result.ok, true)
  assert.equal(result.interrupt, true)
  assert.equal(result.reason, '聊天打断')
  assert.equal(appends.length, 1)
  const event = appends[0]
  assert.equal(event.type, 'minecraft.observation')
  assert.equal(event.payload.interrupted, true)
  assert.equal(event.payload.reason, '聊天打断')
  assert.equal(event.payload.observation.position, '0,64,0')
  assert.equal(event.payload.observation.health, 18)
  assert.deepEqual(event.payload.observation.players, ['Yuan_JY'])
  const json = JSON.stringify(event)
  assert.equal(json.includes('secret-token'), false, 'token 不进入事件')
  assert.equal(json.includes('sk-abcdef1234567890'), false, 'apiKey 不进入事件')
  assert.equal(validateEventEnvelope(event).ok, true)

  // 与无钩子 world 的返回完全一致（bot 行为不变）
  const plain = createMinecraftWorld({ tokenFile: '', now: () => 1000 })
  plain.interrupt('聊天打断')
  assert.deepEqual(await plain.decide(observation), result)
})

test('minecraft shadow E3：off 模式不发事件，响应不变', async () => {
  const { world, appends } = makeMinecraftShadowFixture({ featureFlag: { enabled: false, shadow: true } })
  world.recordReceipt({ tool: 'mc_say', ok: true, detail: '说了嗨' })
  assert.equal(appends.length, 0)
  world.interrupt('聊天')
  const result = await world.decide({ position: '0,64,0' })
  assert.equal(result.interrupt, true)
  assert.equal(appends.length, 0)
})

test('minecraft shadow E3：Hub/sink 抛错不影响 bot 响应', async () => {
  const warnings = []
  const hubRuntime = {
    mode: () => 'shadow',
    ingest() {
      throw new Error('hub ingest boom')
    },
  }
  const sink = createMinecraftShadowSink({
    hubRuntime,
    logger: { warn: (message) => warnings.push(message) },
    now: () => 1000,
  })
  const world = createMinecraftWorld({ tokenFile: '', onShadowEvent: sink, now: () => 1000 })
  const receipt = world.recordReceipt({ tool: 'mc_wait', ok: true, detail: '等了 2 秒' })
  assert.equal(receipt.ok, true)
  assert.equal(receipt.lastReceipt.tool, 'mc_wait')
  world.interrupt('聊天')
  const decided = await world.decide({ position: '0,64,0' })
  assert.equal(decided.interrupt, true)
  assert.ok(warnings.some((message) => message.includes('minecraft shadow 钩子失败')))
})

test('minecraft shadow E3：invalid receipt / 非法观察被跳过', () => {
  const { hubRuntime, sink, appends } = makeMinecraftShadowFixture()
  sink({ kind: 'receipt', receipt: { ok: 'yes', tool: 'mc_wait' } })
  sink({ kind: 'receipt', receipt: { ok: true } })
  sink({ kind: 'receipt' })
  sink(null)
  sink({ kind: 'unknown' })
  assert.equal(appends.length, 0)
  // 合法 observe 仍可进入
  sink({ kind: 'observe', ok: true, observation: { position: '1,2,3' } })
  assert.equal(appends.length, 1)
  assert.equal(appends[0].type, 'minecraft.observation')
  assert.equal(hubRuntime.snapshot().hub.metrics.ticks, 0)
})

test('minecraft shadow E3：facts 截断/敏感键打码，observation 截断', async () => {
  const { world, appends } = makeMinecraftShadowFixture()
  const hugeFacts = { position: '1,2,3', token: 'secret-value', apiKey: 'sk-abcdef1234567890', note: 'x'.repeat(5000) }
  for (let index = 0; index < 30; index += 1) hugeFacts['k' + index] = 'v'.repeat(200)
  world.recordReceipt({ tool: 'mc_mine', ok: false, detail: '失败 sk-abcdef1234567890', facts: hugeFacts })
  const receiptEvent = appends[0]
  assert.equal(receiptEvent.payload.detail.includes('sk-abcdef1234567890'), false)
  assert.ok(receiptEvent.payload.detail.includes('[redacted]'))
  const factsJson = JSON.stringify(receiptEvent.payload.facts)
  assert.equal(factsJson.includes('secret-value'), false)
  assert.equal(factsJson.includes('sk-abcdef1234567890'), false)
  assert.ok(factsJson.length <= 2100, 'facts 体积受限')

  world.interrupt('聊天')
  await world.decide({
    position: '0,64,0',
    players: Array.from({ length: 10 }, (_, index) => 'player' + index),
    inventory: Array.from({ length: 12 }, (_, index) => 'item' + index),
    lastChat: 'x'.repeat(500),
  })
  const observation = appends[1].payload.observation
  assert.equal(observation.players.length, 6)
  assert.equal(observation.inventory.length, 8)
  assert.ok(Array.from(observation.lastChat).length <= 120)
})

test('minecraft shadow E3：不增加记忆写入（gameMemory 调用不变）', () => {
  const callsWith = []
  const callsWithout = []
  const makeMemory = (calls) => ({
    record: (entry) => calls.push(entry),
    promptLines: () => [],
  })
  const withHook = createMinecraftWorld({
    tokenFile: '',
    onShadowEvent: createMinecraftShadowSink({
      hubRuntime: (() => {
        const runtime = createHubRuntime({ featureFlag: { enabled: true, shadow: true }, now: () => 1000 })
        runtime.start()
        return runtime
      })(),
      now: () => 1000,
    }),
    gameMemory: makeMemory(callsWith),
    now: () => 1000,
  })
  const withoutHook = createMinecraftWorld({ tokenFile: '', gameMemory: makeMemory(callsWithout), now: () => 1000 })
  const receipt = { tool: 'mc_build', ok: true, detail: '放了 3 块', facts: { placed: 3 } }
  withHook.recordReceipt(receipt)
  withoutHook.recordReceipt(receipt)
  assert.deepEqual(callsWith, callsWithout, 'shadow 钩子不新增记忆写入')
})

// ---------------------------------------------------------------------------
// Gate E4：Memory Gateway 只读接入（lib/composition/hub-runtime.mjs）——现有记忆可查询、零写入
// ---------------------------------------------------------------------------

function makeMemoryRuntimeFixture(options = {}) {
  const root = tmpDir('hub-memory')
  const agentMemoryDir = path.join(root, 'agent-memory')
  const gameMemoryDir = path.join(root, 'game-memory')
  mkdirSync(agentMemoryDir, { recursive: true })
  mkdirSync(path.join(gameMemoryDir, 'build'), { recursive: true })
  mkdirSync(path.join(gameMemoryDir, 'log'), { recursive: true })
  writeFileSync(
    path.join(agentMemoryDir, 'journal.jsonl'),
    [
      JSON.stringify({ ts: 1000, kind: 'thought', text: '今天在公园走了很久。' }),
      'not-json',
      JSON.stringify({ ts: 2000, kind: 'learning', text: '学会了先看日志再改代码。' }),
    ].join('\n'),
  )
  writeFileSync(path.join(gameMemoryDir, 'PARTNER_GAME.md'), '# 短画像\n一起玩的人：Yuan_JY，喜欢看海。\n')
  writeFileSync(path.join(gameMemoryDir, 'build/home.md'), '- 盖了 3×3 小屋（自己）[2026-11-01]\n')
  writeFileSync(path.join(gameMemoryDir, 'log/2026-11.md'), '- 一起挖矿到夜里（Yuan_JY）[2026-11-03]\n')
  writeFileSync(
    path.join(root, 'methods.json'),
    JSON.stringify({
      ok: true,
      v: 1,
      entries: [
        {
          id: 'm1',
          name: '先看日志',
          howTo: '读失败日志再改',
          source: '实践',
          usedCount: 2,
          successCount: 1,
          lastAt: 3000,
        },
      ],
    }),
  )
  const memoryPaths = {
    agentMemoryDir,
    gameMemoryDir,
    methodsFile: path.join(root, 'methods.json'),
  }
  const runtime = createHubRuntime({
    memoryPaths,
    featureFlag: options.featureFlag ?? { enabled: false, shadow: true },
    logger: { warn() {} },
    now: () => 1000,
  })
  return { root, agentMemoryDir, gameMemoryDir, memoryPaths, runtime }
}

test('hub-runtime E4：真实 fixture 目录查询（journal/game-memory/methods 聚合）', async () => {
  const { root, agentMemoryDir, gameMemoryDir, runtime } = makeMemoryRuntimeFixture()
  const before = {
    journal: readFileSync(path.join(agentMemoryDir, 'journal.jsonl'), 'utf8'),
    game: readFileSync(path.join(gameMemoryDir, 'PARTNER_GAME.md'), 'utf8'),
    methods: readFileSync(path.join(root, 'methods.json'), 'utf8'),
  }
  const result = await runtime.queryMemory({ limit: 50 })
  assert.equal(result.ok, true)
  assert.ok(result.total >= 5, '聚合三类 provider')
  const kinds = new Set(result.entries.map((entry) => entry.source.kind))
  assert.deepEqual([...kinds].sort(), ['game-memory', 'journal', 'method-memory'])
  assert.ok(result.entries.some((entry) => entry.text.includes('公园')))
  assert.ok(result.entries.some((entry) => entry.text.includes('盖了 3×3 小屋')))
  assert.ok(result.entries.some((entry) => entry.text.includes('先看日志')))
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.memory.available, true)
  assert.deepEqual(snapshot.memory.providers.sort(), ['game-memory', 'journal', 'method-memory'])
  assert.equal(runtime.health().memory.available, true)
  // 只读：查询前后文件内容完全一致（无写入/无新文件）
  assert.equal(readFileSync(path.join(agentMemoryDir, 'journal.jsonl'), 'utf8'), before.journal)
  assert.equal(readFileSync(path.join(gameMemoryDir, 'PARTNER_GAME.md'), 'utf8'), before.game)
  assert.equal(readFileSync(path.join(root, 'methods.json'), 'utf8'), before.methods)
  assert.deepEqual(readdirSync(root).sort(), ['agent-memory', 'game-memory', 'methods.json'])
  runtime.dispose()
  rmSync(root, { recursive: true, force: true })
})

test('hub-runtime E4：off 模式仍可查询（只读，不依赖 Hub 启停）', async () => {
  const { root, runtime } = makeMemoryRuntimeFixture({ featureFlag: { enabled: false, shadow: true } })
  assert.equal(runtime.snapshot().mode, 'off')
  const result = await runtime.queryMemory({ text: '日志' })
  assert.equal(result.ok, true)
  assert.ok(result.entries.length >= 1, 'off 也能只读查询')
  assert.equal(
    result.entries.some((entry) => entry.text.includes('日志')),
    true,
  )
  assert.equal(runtime.snapshot().hub.metrics.ticks, 0, '查询不触发调度')
  runtime.dispose()
  rmSync(root, { recursive: true, force: true })
})

test('hub-runtime E4：provider 缺失/无 memoryPaths 降级', async () => {
  const missingRoot = tmpDir('hub-memory-missing')
  const runtime = createHubRuntime({
    memoryPaths: {
      agentMemoryDir: path.join(missingRoot, 'no-agent'),
      gameMemoryDir: path.join(missingRoot, 'no-game'),
      methodsFile: path.join(missingRoot, 'no-methods.json'),
    },
    logger: { warn() {} },
    now: () => 1000,
  })
  const result = await runtime.queryMemory()
  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 0, '缺失文件 → 空结果不抛错')
  assert.equal(result.errors.length, 0)
  runtime.dispose()
  rmSync(missingRoot, { recursive: true, force: true })

  const noPaths = createHubRuntime({ logger: { warn() {} } })
  const unavailable = await noPaths.queryMemory()
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'HUB_RUNTIME_MEMORY_UNAVAILABLE')
  assert.equal(noPaths.snapshot().memory.available, false)
  noPaths.dispose()
})

test('hub-runtime E4：写入被拒绝（只读 provider，文件不变）', async () => {
  const { root, agentMemoryDir, runtime } = makeMemoryRuntimeFixture()
  const gateway = runtime.getMemoryGateway()
  assert.ok(gateway !== null)
  const journalBefore = readFileSync(path.join(agentMemoryDir, 'journal.jsonl'), 'utf8')
  const denied = await gateway.write({
    category: 'episodic',
    text: '试图写入只读记忆',
    source: { kind: 'activity', id: 'chat' },
    provider: 'journal',
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, MEMORY_GATEWAY_CODES.permissionDenied)
  assert.equal(readFileSync(path.join(agentMemoryDir, 'journal.jsonl'), 'utf8'), journalBefore, '无任何写入')
  runtime.dispose()
  rmSync(root, { recursive: true, force: true })
})

test('hub-runtime E4：查询错误隔离（坏 methods.json 不影响其他 provider）', async () => {
  const { root, agentMemoryDir, runtime } = makeMemoryRuntimeFixture()
  writeFileSync(path.join(root, 'methods.json'), '{bad json')
  const result = await runtime.queryMemory({ limit: 50 })
  assert.equal(result.ok, true)
  assert.ok(
    result.entries.some((entry) => entry.source.kind === 'journal'),
    '其他 provider 仍可查询',
  )
  assert.ok(
    result.errors.some((error) => error.provider === 'method-memory'),
    '坏 provider 记入 errors',
  )
  assert.equal(readFileSync(path.join(agentMemoryDir, 'journal.jsonl'), 'utf8').includes('公园'), true)
  runtime.dispose()
  rmSync(root, { recursive: true, force: true })
})

test('hub-runtime E4：limit 限制与不缓存（文件变化立即可见）', async () => {
  const { root, agentMemoryDir, runtime } = makeMemoryRuntimeFixture()
  const capped = await runtime.queryMemory({ limit: 999 })
  assert.equal(capped.limit, 50, 'limit 上限 50')
  assert.ok(capped.entries.length <= 50)
  const firstCount = (await runtime.queryMemory({ limit: 50 })).total
  const journalPath = path.join(agentMemoryDir, 'journal.jsonl')
  writeFileSync(
    journalPath,
    readFileSync(journalPath, 'utf8') + '\n' + JSON.stringify({ ts: 4000, kind: 'thought', text: '新写入的日记。' }),
  )
  const second = await runtime.queryMemory({ limit: 50 })
  assert.ok(second.total > firstCount, '每次查询重新读文件（不缓存 live 内容）')
  assert.ok(second.entries.some((entry) => entry.text.includes('新写入的日记')))
  runtime.dispose()
  rmSync(root, { recursive: true, force: true })
})

test('hub-runtime E4：dispose 后查询明确报错；snapshot/health 指标可用', async () => {
  const { root, runtime } = makeMemoryRuntimeFixture()
  assert.equal(runtime.health().memory.queries, 0)
  await runtime.queryMemory({})
  assert.equal(runtime.health().memory.queries, 1)
  runtime.dispose()
  const after = await runtime.queryMemory({})
  assert.equal(after.ok, false)
  assert.equal(after.code, 'HUB_RUNTIME_DISPOSED')
  assert.equal(runtime.snapshot().disposed, true)
  rmSync(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate F1：完整 Hub 装配（hub-runtime 自动创建 EventBus/TaskBoard/Scheduler/Registry/...）
// ---------------------------------------------------------------------------

test('hub-runtime F1：完整装配 snapshot（图完整、manifest 已注册）', () => {
  const runtime = createHubRuntime({ logger: { warn() {} }, now: () => 1000 })
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.assembled, true)
  assert.equal(snapshot.hub.available.eventBus, true)
  assert.equal(snapshot.hub.available.taskBoard, true)
  assert.equal(snapshot.hub.available.scheduler, true)
  assert.equal(snapshot.hub.available.registry, true)
  assert.equal(snapshot.hub.available.feedbackLedger, true)
  assert.equal(snapshot.hub.available.worldSupervisor, true)
  assert.ok(snapshot.hub.layers.eventBus !== null)
  assert.ok(snapshot.hub.layers.taskBoard !== null)
  assert.ok(snapshot.hub.layers.scheduler !== null)
  assert.ok(snapshot.hub.layers.registry !== null)
  assert.ok(snapshot.hub.layers.feedbackLedger !== null)
  assert.ok(snapshot.hub.layers.worldSupervisor !== null)
  assert.deepEqual(snapshot.hub.layers.registry.activities.map((item) => item.id).sort(), ['chat', 'minecraft'])
  const instances = runtime.getInstances()
  for (const key of ['eventBus', 'taskBoard', 'scheduler', 'registry', 'feedbackLedger', 'worldSupervisor']) {
    assert.ok(instances[key] !== null, `${key} 已装配`)
  }
  // 默认 off：装配不等于运行
  assert.equal(snapshot.mode, 'off')
  assert.equal(snapshot.hub.state, 'created')
  assert.equal(instances.worldSupervisor.snapshot().total, 0, '没有启动任何真实 World')
  runtime.dispose()
})

test('hub-runtime F1：off 无副作用（不桥接事件/不运行调度）', async () => {
  const runtime = createHubRuntime({ logger: { warn() {} }, now: () => 1000 })
  const { eventBus, taskBoard, registry } = runtime.getInstances()
  runtime.start()
  assert.equal(runtime.mode(), 'off')
  taskBoard.create({ activity: 'chat', key: 'k-off' })
  registry.enable('chat')
  const tick = await runtime.tick()
  assert.equal(tick.skipped, true)
  assert.equal(eventBus.snapshot().stored, 0, 'off 模式不桥接任何事件')
  assert.equal(runtime.snapshot().hub.metrics.skippedTicks, 1)
  assert.equal(runtime.snapshot().hub.metrics.fullTicks, 0)
  runtime.dispose()
})

test('hub-runtime F1：shadow 下 TaskBoard/Registry 事件进 EventBus', async () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    now: () => 1000,
  })
  const { eventBus, taskBoard, registry } = runtime.getInstances()
  runtime.start()
  assert.equal(runtime.mode(), 'shadow')

  taskBoard.create({ activity: 'chat', key: 'k-shadow' })
  const afterTask = eventBus.snapshot().stored
  assert.ok(afterTask >= 1, 'TaskBoard onEvent → EventBus')
  const stored = []
  const unsubscribe = eventBus.subscribe('*', (event) => stored.push(event))
  taskBoard.create({ activity: 'chat', key: 'k-shadow-2' })
  await eventBus.flush()
  assert.ok(stored.some((event) => event.type === 'task.created'))
  const created = stored.find((event) => event.type === 'task.created')
  assert.equal(created.activity, 'taskboard')
  assert.equal(created.payload.data.type, 'task.created')

  registry.enable('chat')
  await eventBus.flush()
  assert.ok(
    stored.some((event) => event.type === 'activity.enabled'),
    'Registry onEvent → EventBus',
  )

  // 直接 ingest 已是 envelope 的事件 → 原样进 EventBus
  const chatEvent = toChatEvent(
    { peerId: 'p1', messageId: 'm-1', text: '你好' },
    { now: () => 1000, random: () => 0.5 },
  )
  assert.equal(chatEvent.ok, true)
  const ingested = runtime.ingest('chat', chatEvent.event)
  assert.equal(ingested.ok, true)
  assert.equal(ingested.passthrough, true)
  await eventBus.flush()
  assert.ok(stored.some((event) => event.type === 'chat.received' && event.payload.peerId === 'p1'))
  unsubscribe()
  runtime.dispose()
})

test('hub-runtime F1：事件桥接失败隔离（EventBus 抛错不影响业务）', async () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    eventBus: {
      append() {
        throw new Error('bus down')
      },
      snapshot: () => ({ stored: 0 }),
    },
    now: () => 1000,
  })
  runtime.start()
  const { taskBoard } = runtime.getInstances()
  const created = taskBoard.create({ activity: 'chat', key: 'k-fail' })
  assert.equal(created.ok, true, '桥接失败不影响任务板')
  const tick = await runtime.tick()
  assert.equal(tick.ok, true)
  assert.equal(runtime.snapshot().ok, true)
  runtime.dispose()
})

test('hub-runtime F1：assembleHub:false 保持 E 组降级形态', async () => {
  const runtime = createHubRuntime({ assembleHub: false, logger: { warn() {} } })
  const snapshot = runtime.snapshot()
  assert.equal(snapshot.assembled, false)
  assert.equal(snapshot.hub.available.taskBoard, false)
  assert.equal(snapshot.hub.available.eventBus, false)
  assert.equal(snapshot.hub.layers.taskBoard, null)
  assert.equal((await runtime.tick()).skipped, true)
  assert.equal(runtime.health().ok, true)
  runtime.dispose()
})

test('hub-runtime F1：dispose 清理（桥接停止/查询拒绝）', async () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    now: () => 1000,
  })
  const { eventBus, taskBoard } = runtime.getInstances()
  runtime.start()
  taskBoard.create({ activity: 'chat', key: 'k-before-dispose' })
  const before = eventBus.snapshot().stored
  assert.ok(before >= 1)
  runtime.dispose()
  assert.equal(runtime.snapshot().disposed, true)
  taskBoard.create({ activity: 'chat', key: 'k-after-dispose' })
  assert.equal(eventBus.snapshot().stored, before, 'dispose 后不再桥接')
  assert.equal((await runtime.queryMemory()).code, 'HUB_RUNTIME_DISPOSED')
  runtime.dispose()
})

test('hub-runtime F1：health 反映完整装配（assembled/activities）', () => {
  const runtime = createHubRuntime({ logger: { warn() {} }, now: () => 1000 })
  const metrics = buildHealthMetrics({ hubRuntime: runtime }, 1000)
  assert.equal(metrics.hub.available, true)
  assert.equal(metrics.hub.assembled, true)
  assert.equal(metrics.hub.activities, 2)
  const empty = buildHealthMetrics({}, 1000)
  assert.equal(empty.hub.assembled, false)
  assert.equal(empty.hub.activities, 0)
  runtime.dispose()
})

test('hub-runtime F1：registerHubRuntime 注册完整装配的生命周期', () => {
  const registered = []
  const serviceRuntime = {
    register(name, handlers) {
      registered.push({ name, handlers })
    },
  }
  const runtime = registerHubRuntime(serviceRuntime, {
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    now: () => 1000,
  })
  assert.equal(registered[0].name, 'Hub')
  const snapshot = registered[0].handlers.snapshot()
  assert.equal(snapshot.assembled, true)
  assert.equal(snapshot.mode, 'off', '未 start 时 off')
  registered[0].handlers.start()
  assert.equal(runtime.snapshot().mode, 'shadow')
  registered[0].handlers.dispose()
  assert.equal(runtime.snapshot().disposed, true)
})

// ---------------------------------------------------------------------------
// Gate F2：Hub 控制 HTTP API（lib/composition/hub-routes.mjs）——鉴权/快照/控制/降级
// ---------------------------------------------------------------------------

function hubFakeReq(method, body, options = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url: options.url ?? HUB_ROUTE,
    headers: options.headers ?? {},
    async *[Symbol.asyncIterator]() {
      if (payload.length > 0) yield Buffer.from(payload)
    },
  }
}

function hubFakeRes() {
  return {
    statusCode: 0,
    body: '',
    writeHead(status) {
      this.statusCode = status
      return this
    },
    end(body) {
      this.body = String(body)
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

function makeHubRouteFixture(options = {}) {
  const dir = tmpDir('hub-routes')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: options.featureFlag ?? { enabled: true, shadow: true },
    memoryPaths: options.memoryPaths ?? undefined,
    now: () => 1000,
  })
  runtime.start()
  setActiveHubRuntime(runtime)
  const handler = createHubHandler({
    tokenFile,
    fence: options.fence ?? null,
    hubRuntime: options.hubRuntime === undefined ? runtime : options.hubRuntime,
    now: () => 1000,
  })
  return { dir, tokenFile, runtime, handler }
}

test('hub-routes F2：注册路由与 action 列表', () => {
  const routes = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  const disposers = []
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    now: () => 1000,
  })
  setActiveHubRuntime(runtime)
  const handler = registerHubRoute({ webServer, disposers, tokenFile: '', fence: null, logger: { warn() {} } })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, HUB_ROUTE)
  assert.equal(typeof handler, 'function')
  assert.equal(disposers.length, 1)
  assert.equal(HUB_ACTIONS[0], 'task.create')
  assert.deepEqual(HUB_ACTIONS.slice(1, 4), ['task.pause', 'task.resume', 'task.cancel'])
  assert.ok(HUB_ACTIONS.includes('memory.query'))
  runtime.dispose()
  setActiveHubRuntime(null)
})

test('hub-routes F2：GET 鉴权（fence/token）与 snapshot 结构', async () => {
  const denied = makeHubRouteFixture({ fence: { check: () => 'blocked' } })
  const deniedRes = hubFakeRes()
  await denied.handler(hubFakeReq('GET'), deniedRes)
  assert.equal(deniedRes.statusCode, 403)
  assert.equal(deniedRes.json().ok, false)
  denied.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(denied.dir, { recursive: true, force: true })

  const { dir, runtime, handler } = makeHubRouteFixture({ fence: { check: () => 'blocked' } })
  // fence 拒绝但 token 正确 → 允许
  const tokenRes = hubFakeRes()
  await handler(hubFakeReq('GET', undefined, { url: HUB_ROUTE + '?token=secret-token' }), tokenRes)
  assert.equal(tokenRes.statusCode, 200)
  const snapshot = tokenRes.json()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.available, true)
  assert.equal(snapshot.mode, 'shadow')
  assert.equal(snapshot.assembled, true)
  assert.ok(snapshot.hub !== null)
  assert.ok(snapshot.tasks !== null)
  assert.ok(snapshot.activities !== null)
  assert.ok(snapshot.memory !== null)
  assert.ok(snapshot.health !== null)
  assert.equal(snapshot.tasks.total, 0)
  assert.deepEqual(snapshot.activities.activities.map((item) => item.id).sort(), ['chat', 'minecraft'])
  // fence 允许（无需 token）
  const fenceHandler = createHubHandler({ tokenFile: '', fence: { check: () => null }, hubRuntime: runtime })
  const fenceRes = hubFakeRes()
  await fenceHandler(hubFakeReq('GET'), fenceRes)
  assert.equal(fenceRes.statusCode, 200)
  runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes F2：无 Hub 降级（GET available:false / POST HUB_UNAVAILABLE）', async () => {
  setActiveHubRuntime(null)
  const dir = tmpDir('hub-routes-nohub')
  const tokenFile = path.join(dir, 'token')
  writeFileSync(tokenFile, 'secret-token')
  const handler = createHubHandler({ tokenFile, fence: { check: () => null }, hubRuntime: null, now: () => 1000 })
  const getRes = hubFakeRes()
  await handler(hubFakeReq('GET'), getRes)
  assert.equal(getRes.statusCode, 200)
  assert.equal(getRes.json().available, false)
  assert.equal(getRes.json().hub, null)
  const postRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'memory.query', token: 'secret-token' }), postRes)
  assert.equal(postRes.statusCode, 200)
  assert.equal(postRes.json().ok, false)
  assert.equal(postRes.json().code, 'HUB_UNAVAILABLE')
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes F2：POST 鉴权（token/fence）与错误分支', async () => {
  const { dir, runtime, handler } = makeHubRouteFixture({ fence: { check: () => 'blocked' } })
  const noAuth = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'hub.pauseAll' }), noAuth)
  assert.equal(noAuth.statusCode, 403)
  const wrongToken = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'hub.pauseAll', token: 'nope' }), wrongToken)
  assert.equal(wrongToken.statusCode, 403)
  const goodToken = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'hub.pauseAll', token: 'secret-token' }), goodToken)
  assert.equal(goodToken.statusCode, 200)
  assert.equal(goodToken.json().ok, true)
  // fence 允许（无 token）
  const fenceHandler = createHubHandler({ tokenFile: '', fence: { check: () => null }, hubRuntime: runtime })
  const fenceRes = hubFakeRes()
  await fenceHandler(hubFakeReq('POST', { action: 'hub.resumeAll' }), fenceRes)
  assert.equal(fenceRes.statusCode, 200)
  // 未知 action / 非法 JSON / 方法不允许
  const unknown = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'nope', token: 'secret-token' }), unknown)
  assert.equal(unknown.statusCode, 400)
  assert.equal(unknown.json().error, 'unknown_action')
  const badJson = hubFakeRes()
  await handler(
    {
      method: 'POST',
      url: HUB_ROUTE,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{bad')
      },
    },
    badJson,
  )
  assert.equal(badJson.statusCode, 400)
  assert.equal(badJson.json().error, 'invalid_json')
  const notAllowed = hubFakeRes()
  await handler(hubFakeReq('PUT', { token: 'secret-token' }), notAllowed)
  assert.equal(notAllowed.statusCode, 405)
  runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes F2：任务控制（pause/resume/cancel）与参数错误', async () => {
  const { dir, runtime, handler } = makeHubRouteFixture()
  const board = runtime.getInstances().taskBoard
  const task = board.create({ activity: 'chat', key: 'hub-task-1' }).task
  assert.equal(task.status, 'running')
  const pauseRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'task.pause', taskId: task.id, token: 'secret-token' }), pauseRes)
  assert.equal(pauseRes.json().ok, true)
  assert.equal(board.get(task.id).status, 'waiting')
  const resumeRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'task.resume', taskId: task.id, token: 'secret-token' }), resumeRes)
  assert.equal(resumeRes.json().ok, true)
  assert.equal(board.get(task.id).status, 'running')
  const cancelRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'task.cancel', taskId: task.id, token: 'secret-token' }), cancelRes)
  assert.equal(cancelRes.json().ok, true)
  assert.equal(board.get(task.id).status, 'cancelled')
  const missing = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'task.pause', token: 'secret-token' }), missing)
  assert.equal(missing.json().code, 'HUB_INVALID_ARGUMENT')
  const notFound = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'task.cancel', taskId: 'missing', token: 'secret-token' }), notFound)
  assert.equal(notFound.json().ok, false)
  assert.equal(notFound.json().code, 'TASK_BOARD_NOT_FOUND')
  runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes F2：活动控制（enable/disable）', async () => {
  const { dir, runtime, handler } = makeHubRouteFixture()
  const registry = runtime.getInstances().registry
  const enableRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'activity.enable', activityId: 'chat', token: 'secret-token' }), enableRes)
  assert.equal(enableRes.json().ok, true)
  assert.equal(enableRes.json().activity.enabled, true)
  assert.equal(registry.isEnabled('chat'), true)
  const disableRes = hubFakeRes()
  await handler(
    hubFakeReq('POST', { action: 'activity.disable', activityId: 'chat', token: 'secret-token' }),
    disableRes,
  )
  assert.equal(disableRes.json().ok, true)
  assert.equal(registry.isEnabled('chat'), false)
  const missing = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'activity.enable', token: 'secret-token' }), missing)
  assert.equal(missing.json().code, 'HUB_INVALID_ARGUMENT')
  const unknown = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'activity.enable', activityId: 'nope', token: 'secret-token' }), unknown)
  assert.equal(unknown.json().code, 'ACTIVITY_NOT_FOUND')
  runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes F2：hub.pauseAll/resumeAll', async () => {
  const { dir, runtime, handler } = makeHubRouteFixture()
  const pauseRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'hub.pauseAll', token: 'secret-token' }), pauseRes)
  assert.equal(pauseRes.json().ok, true)
  assert.equal(pauseRes.json().paused, true)
  const resumeRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'hub.resumeAll', token: 'secret-token' }), resumeRes)
  assert.equal(resumeRes.json().ok, true)
  assert.equal(resumeRes.json().paused, false)
  runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes F2：memory.query（只读、limit 上限、错误隔离）', async () => {
  const memoryRoot = tmpDir('hub-routes-memory')
  const agentMemoryDir = path.join(memoryRoot, 'agent-memory')
  mkdirSync(agentMemoryDir, { recursive: true })
  writeFileSync(
    path.join(agentMemoryDir, 'journal.jsonl'),
    JSON.stringify({ ts: 1000, kind: 'thought', text: '记忆里的公园。' }),
  )
  const { dir, runtime, handler } = makeHubRouteFixture({
    memoryPaths: {
      agentMemoryDir,
      gameMemoryDir: path.join(memoryRoot, 'none'),
      methodsFile: path.join(memoryRoot, 'none.json'),
    },
  })
  const queryRes = hubFakeRes()
  await handler(
    hubFakeReq('POST', { action: 'memory.query', token: 'secret-token', filter: { text: '公园', limit: 999 } }),
    queryRes,
  )
  assert.equal(queryRes.statusCode, 200)
  const result = queryRes.json()
  assert.equal(result.ok, true)
  assert.equal(result.limit, 50)
  assert.ok(result.entries.some((entry) => entry.text.includes('公园')))
  // 错误隔离：queryMemory 抛错 → 500 JSON
  const broken = {
    mode: () => 'off',
    getInstances: () => ({}),
    snapshot: () => ({}),
    health: () => ({}),
    memorySnapshot: () => ({ available: false }),
    queryMemory: async () => {
      throw new Error('memory boom')
    },
  }
  const brokenHandler = createHubHandler({
    tokenFile: path.join(dir, 'chat-token'),
    fence: { check: () => null },
    hubRuntime: broken,
  })
  const brokenRes = hubFakeRes()
  await brokenHandler(hubFakeReq('POST', { action: 'memory.query', token: 'secret-token' }), brokenRes)
  assert.equal(brokenRes.statusCode, 500)
  assert.equal(brokenRes.json().ok, false)
  assert.equal(brokenRes.json().error.code, 'HUB_ROUTE_FAILED')
  runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(dir, { recursive: true, force: true })
  rmSync(memoryRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate G1：模型策略配置（store + policy overrides + 管理 API）
// ---------------------------------------------------------------------------

function makeModelPolicyStoreFixture() {
  const home = tmpDir('model-policy-home')
  const store = createModelPolicyStore({ home, now: () => 5000 })
  return { home, store }
}

test('model-policy-store G1：缺文件默认空策略', () => {
  const { home, store } = makeModelPolicyStoreFixture()
  assert.equal(store.file, resolveModelPolicyFile(home))
  assert.match(store.file, /\.dsh-poetry\/model-policy\.json$/)
  const state = store.read()
  assert.equal(state.exists, false)
  assert.deepEqual(state.policy, emptyModelPolicy())
  assert.deepEqual(state.errors, [])
  assert.equal(store.snapshot().version, MODEL_POLICY_STORE_VERSION)
  rmSync(home, { recursive: true, force: true })
})

test('model-policy-store G1：原子写/读回/0600/无临时文件', () => {
  const { home, store } = makeModelPolicyStoreFixture()
  const written = store.write({
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    roles: { mood: { reasoningEffort: 'max' }, selfTalk: { provider: 'deepseek-account', model: 'deepseek-flash' } },
    tokenLimit: 4000,
  })
  assert.equal(written.ok, true)
  assert.ok(existsSync(store.file))
  const parsed = JSON.parse(readFileSync(store.file, 'utf8'))
  assert.equal(parsed.version, MODEL_POLICY_STORE_VERSION)
  assert.equal(parsed.provider, 'deepseek-account')
  assert.equal(parsed.model, 'deepseek-flash')
  assert.deepEqual(parsed.roles, {
    mood: { reasoningEffort: 'max' },
    selfTalk: { provider: 'deepseek-account', model: 'deepseek-flash' },
  })
  assert.equal(parsed.tokenLimit, 4000)
  assert.equal(parsed.updatedAt, 5000)
  const mode = statSync(store.file).mode & 0o777
  assert.equal(mode, 0o600, '文件权限 0600')
  const files = readdirSync(path.dirname(store.file))
  assert.deepEqual(files, ['model-policy.json'], '无临时文件残留')
  const state = store.read()
  assert.equal(state.exists, true)
  assert.equal(state.policy.provider, 'deepseek-account')
  assert.equal(state.policy.tokenLimit, 4000)
  rmSync(home, { recursive: true, force: true })
})

test('model-policy-store G1：非法值忽略并报告，不崩', () => {
  const normalized = normalizeModelPolicy({
    provider: 123,
    model: '',
    roles: { mood: { reasoningEffort: 'extreme' }, nope: {}, selfTalk: { provider: 'deepseek-account' } },
    tokenLimit: -1,
    extra: 'ignored',
  })
  assert.equal(normalized.ok, true)
  assert.equal(normalized.policy.provider, null)
  assert.equal(normalized.policy.model, null)
  assert.equal(normalized.policy.tokenLimit, 0)
  assert.equal(normalized.policy.roles.mood, undefined)
  assert.equal(normalized.policy.roles.selfTalk.provider, 'deepseek-account')
  assert.ok(normalized.errors.some((item) => item.path === 'provider'))
  assert.ok(normalized.errors.some((item) => item.path === 'roles.nope'))
  assert.ok(normalized.errors.some((item) => item.path === 'roles.mood.reasoningEffort'))
  assert.ok(normalized.errors.some((item) => item.path === 'tokenLimit'))
  assert.equal(normalizeModelPolicy(null).ok, true)
  // 坏 JSON 文件 → 默认空 + 错误（不抛）
  const { home, store } = makeModelPolicyStoreFixture()
  mkdirSync(path.dirname(store.file), { recursive: true })
  writeFileSync(store.file, '{bad json')
  const state = store.read()
  assert.deepEqual(state.policy, emptyModelPolicy())
  assert.ok(state.errors.length >= 1)
  rmSync(home, { recursive: true, force: true })
})

test('model-policy-store G1：reset 恢复空配置', () => {
  const { home, store } = makeModelPolicyStoreFixture()
  store.write({ provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(store.read().policy.provider, 'deepseek-account')
  assert.equal(store.reset().ok, true)
  assert.deepEqual(store.read().policy, emptyModelPolicy())
  rmSync(home, { recursive: true, force: true })
})

function makePolicyFixture(overrides, options = {}) {
  return createModelPolicy({
    env: options.env ?? {},
    getSelection: options.getSelection ?? (() => ({ provider: 'deepseek-account', model: 'deepseek-flash' })),
    getProviders: options.getProviders ?? (() => ['dsh-opencode-go']),
    getOverrides: () => overrides,
  })
}

test('model-policy G1：默认行为不变（空 overrides = 原逻辑）', () => {
  const baseline = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['dsh-opencode-go'],
  })
  const withEmpty = makePolicyFixture({})
  for (const role of ['mood', 'selfTalk', 'growth', 'voice']) {
    assert.deepEqual(withEmpty.resolveCandidates(role), baseline.resolveCandidates(role))
    assert.deepEqual(withEmpty.resolve(role), baseline.resolve(role))
  }
  const summary = withEmpty.effectiveSummary()
  assert.equal(summary.roles.mood.source, 'default-chain')
  assert.equal(summary.tokenLimit, 0)
  assert.equal(summary.provider, null)
})

test('model-policy G1：优先级 store > env > selection；角色级 > 全局', () => {
  const env = { DSH_POETRY_MODEL_PROVIDER: 'opencode-go', DSH_POETRY_MODEL: 'deepseek-v4.1-flash' }
  const selection = () => ({ provider: 'deepseek-account', model: 'deepseek-flash' })
  // 空 overrides → env 覆盖（现有行为）
  const envOnly = makePolicyFixture({}, { env, getSelection: selection, getProviders: () => [] })
  assert.deepEqual(envOnly.resolve('mood'), {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'low',
  })
  // store 全局覆盖 > env
  const storeGlobal = makePolicyFixture(
    { provider: 'deepseek-account', model: 'deepseek-flash' },
    { env, getSelection: selection, getProviders: () => [] },
  )
  assert.equal(storeGlobal.resolve('mood').provider, 'deepseek-account')
  assert.equal(storeGlobal.effectiveSummary().roles.mood.source, 'store')
  // 角色级覆盖 > 全局覆盖
  const storeRole = makePolicyFixture(
    {
      provider: 'deepseek-account',
      model: 'deepseek-flash',
      roles: { mood: { provider: 'google-antigravity', model: 'gemini-3-pro', reasoningEffort: 'max' } },
    },
    { env, getSelection: selection, getProviders: () => [] },
  )
  assert.deepEqual(storeRole.resolve('mood'), {
    provider: 'google-antigravity',
    model: 'gemini-3-pro',
    reasoningEffort: 'max',
  })
  assert.equal(storeRole.effectiveSummary().roles.mood.source, 'store-role')
  assert.equal(storeRole.resolve('growth').provider, 'deepseek-account', '其它角色用全局 store')
  // effort 合并：store 角色 effort > env > 默认
  const envEffort = makePolicyFixture(
    { roles: { growth: { reasoningEffort: 'off' } } },
    { env: { DSH_POETRY_REASONING_GROWTH: 'high' }, getProviders: () => [] },
  )
  assert.equal(envEffort.effortFor('growth'), 'off')
  const envOnlyEffort = makePolicyFixture({}, { env: { DSH_POETRY_REASONING_GROWTH: 'low' }, getProviders: () => [] })
  assert.equal(envOnlyEffort.effortFor('growth'), 'low')
  assert.equal(envOnlyEffort.effortFor('voice'), 'high', '默认 effort 不变')
})

test('model-policy G1：非法 overrides 忽略并报告；tokenLimit 生效', () => {
  const policy = makePolicyFixture({
    provider: 123,
    model: '',
    tokenLimit: -5,
    roles: { mood: { reasoningEffort: 'extreme' }, nope: {} },
  })
  const mood = policy.resolve('mood')
  assert.equal(mood.provider, 'dsh-opencode-go', '非法 overrides 回退默认链')
  assert.equal(policy.tokenLimit(), 0)
  const reports = policy.getReports()
  assert.ok(reports.some((item) => item.path === 'provider'))
  assert.ok(reports.some((item) => item.path === 'roles.mood.reasoningEffort'))
  assert.ok(reports.some((item) => item.path === 'tokenLimit'))

  const limited = makePolicyFixture({ tokenLimit: 4000 })
  const candidate = limited.resolve('mood')
  assert.equal(candidate.maxTokensLimit, 4000)
  assert.equal(resolveCandidateMaxTokens(1000, candidate), 2400, '候选 floor 优先（现有语义）')
  assert.equal(resolveCandidateMaxTokens(8000, candidate), 4000, 'tokenLimit 封顶')
  assert.equal(resolveCandidateMaxTokens(0, candidate), 4000, '0=不封顶基础预算 → 用 tokenLimit')
  assert.equal(resolveCandidateMaxTokens(1000, { maxTokensLimit: 4000 }), 1000, '无 floor 时按基础预算')
  assert.equal(resolveCandidateMaxTokens(8000, { maxTokensLimit: 4000 }), 4000)
  const noLimit = makePolicyFixture({})
  assert.equal(resolveCandidateMaxTokens(8000, noLimit.resolve('mood')), 8000)
  // getOverrides 抛错也不崩
  const broken = createModelPolicy({
    env: {},
    getProviders: () => [],
    getOverrides: () => {
      throw new Error('store down')
    },
  })
  assert.equal(broken.resolve('mood'), null)
  assert.ok(broken.getReports().length >= 1)
})

test('model-policy G1：默认 overrides 提供者（管理 API 注册后动态生效）', () => {
  const previous = getDefaultModelPolicyOverrides()
  try {
    setDefaultModelPolicyOverrides(() => ({ provider: 'deepseek-account', model: 'deepseek-flash' }))
    const policy = createModelPolicy({ env: {}, getSelection: () => null, getProviders: () => [] })
    assert.equal(policy.resolve('mood').provider, 'deepseek-account')
    setDefaultModelPolicyOverrides(null)
    assert.equal(policy.resolve('mood'), null, '清除后动态回退')
  } finally {
    setDefaultModelPolicyOverrides(previous)
  }
})

function makeModelPolicyRouteFixture(options = {}) {
  const dir = tmpDir('model-policy-routes')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const store = createModelPolicyStore({ file: path.join(dir, 'model-policy.json'), now: () => 5000 })
  const policy = createModelPolicy({
    env: {},
    getSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    getProviders: () => ['dsh-opencode-go'],
    getOverrides: () => store.read().policy,
  })
  const handler = createModelPolicyHandler({
    store,
    policy,
    tokenFile,
    fence: options.fence ?? null,
    logger: { warn() {} },
  })
  return { dir, tokenFile, store, policy, handler }
}

test('model-policy-routes G1：GET 鉴权与摘要结构', async () => {
  const denied = makeModelPolicyRouteFixture({ fence: { check: () => 'blocked' } })
  const deniedRes = hubFakeRes()
  await denied.handler(hubFakeReq('GET', undefined, { url: MODEL_POLICY_ROUTE }), deniedRes)
  assert.equal(deniedRes.statusCode, 403)
  rmSync(denied.dir, { recursive: true, force: true })

  const { dir, store, handler } = makeModelPolicyRouteFixture({ fence: { check: () => 'blocked' } })
  const tokenRes = hubFakeRes()
  await handler(hubFakeReq('GET', undefined, { url: MODEL_POLICY_ROUTE + '?token=secret-token' }), tokenRes)
  assert.equal(tokenRes.statusCode, 200)
  const payload = tokenRes.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.file, store.file)
  assert.equal(payload.exists, false)
  assert.deepEqual(payload.policy, emptyModelPolicy())
  assert.ok(payload.effective !== null)
  assert.equal(payload.effective.roles.mood.source, 'default-chain')
  assert.deepEqual(payload.allowed.providers, MODEL_POLICY_ALLOWED_PROVIDERS.slice())
  assert.deepEqual(payload.allowed.roles, MODEL_POLICY_ROLES.slice())
  assert.deepEqual(payload.allowed.efforts, MODEL_POLICY_EFFORTS.slice())
  assert.equal(payload.allowed.tokenLimitMax, MODEL_POLICY_TOKEN_LIMIT_MAX)
  // fence 允许（无 token）
  const fenceHandler = createModelPolicyHandler({
    store,
    policy: undefined,
    tokenFile: '',
    fence: { check: () => null },
  })
  const fenceRes = hubFakeRes()
  await fenceHandler(hubFakeReq('GET'), fenceRes)
  assert.equal(fenceRes.statusCode, 200)
  rmSync(dir, { recursive: true, force: true })
})

test('model-policy-routes G1：PUT 鉴权/校验/写入/生效', async () => {
  const { dir, store, policy, handler } = makeModelPolicyRouteFixture({ fence: { check: () => 'blocked' } })
  const noAuth = hubFakeRes()
  await handler(hubFakeReq('PUT', { provider: 'deepseek-account', model: 'deepseek-flash' }), noAuth)
  assert.equal(noAuth.statusCode, 403)

  const invalidProvider = hubFakeRes()
  await handler(hubFakeReq('PUT', { token: 'secret-token', provider: 'evil-provider', model: 'x' }), invalidProvider)
  assert.equal(invalidProvider.statusCode, 400)
  assert.ok(invalidProvider.json().errors.some((item) => item.path === 'provider'))

  const invalidEffort = hubFakeRes()
  await handler(
    hubFakeReq('PUT', { token: 'secret-token', roles: { mood: { reasoningEffort: 'extreme' } } }),
    invalidEffort,
  )
  assert.equal(invalidEffort.statusCode, 400)
  const invalidRole = hubFakeRes()
  await handler(hubFakeReq('PUT', { token: 'secret-token', roles: { nope: {} } }), invalidRole)
  assert.equal(invalidRole.statusCode, 400)
  const invalidField = hubFakeRes()
  await handler(hubFakeReq('PUT', { token: 'secret-token', hack: true }), invalidField)
  assert.equal(invalidField.statusCode, 400)
  const invalidLimit = hubFakeRes()
  await handler(hubFakeReq('PUT', { token: 'secret-token', tokenLimit: -1 }), invalidLimit)
  assert.equal(invalidLimit.statusCode, 400)

  const valid = hubFakeRes()
  await handler(
    hubFakeReq('PUT', {
      token: 'secret-token',
      provider: 'deepseek-account',
      model: 'deepseek-flash',
      roles: { mood: { reasoningEffort: 'max' } },
      tokenLimit: 3000,
    }),
    valid,
  )
  assert.equal(valid.statusCode, 200)
  const written = valid.json()
  assert.equal(written.ok, true)
  assert.equal(written.policy.provider, 'deepseek-account')
  assert.equal(written.effective.roles.mood.source, 'store')
  assert.equal(written.effective.roles.mood.reasoningEffort, 'max')
  assert.equal(written.effective.tokenLimit, 3000)
  assert.equal(store.read().policy.provider, 'deepseek-account')
  assert.equal(store.read().policy.tokenLimit, 3000)
  assert.equal(policy.resolve('mood').provider, 'deepseek-account')
  assert.equal(policy.resolve('mood').maxTokensLimit, 3000)
  // token 字段不落盘
  const onDisk = JSON.parse(readFileSync(store.file, 'utf8'))
  assert.equal('token' in onDisk, false)

  // reset
  const resetRes = hubFakeRes()
  await handler(hubFakeReq('PUT', { token: 'secret-token', reset: true }), resetRes)
  assert.equal(resetRes.statusCode, 200)
  assert.equal(resetRes.json().reset, true)
  assert.deepEqual(store.read().policy, emptyModelPolicy())
  assert.equal(policy.effectiveSummary().roles.mood.source, 'default-chain')
  rmSync(dir, { recursive: true, force: true })
})

test('model-policy-routes G1：validateModelPolicyInput 纯函数校验', () => {
  assert.equal(validateModelPolicyInput({ provider: 'deepseek-account', model: 'deepseek-flash' }).ok, true)
  assert.equal(validateModelPolicyInput({ reset: true }).reset, true)
  assert.equal(validateModelPolicyInput({ reset: true, provider: 'deepseek-account' }).ok, false)
  assert.equal(validateModelPolicyInput(null).ok, false)
  assert.equal(
    validateModelPolicyInput({
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      roles: { mood: { reasoningEffort: 'off' } },
      tokenLimit: 0,
    }).ok,
    true,
  )
  assert.equal(MODEL_POLICY_ALLOWED_FIELDS.includes('roles'), true)
})

test('model-policy-routes G1：注册路由并设置默认 overrides 提供者', () => {
  const previous = getDefaultModelPolicyOverrides()
  try {
    const home = tmpDir('model-policy-route-register')
    const routes = []
    const webServer = {
      register(route) {
        routes.push(route)
        return () => {}
      },
    }
    const disposers = []
    const registered = registerModelPolicyRoute({
      webServer,
      disposers,
      home,
      tokenFile: '',
      fence: null,
      logger: { warn() {} },
    })
    assert.equal(routes.length, 1)
    assert.equal(routes[0].path, MODEL_POLICY_ROUTE)
    assert.equal(disposers.length, 1)
    assert.equal(registered.store.file, resolveModelPolicyFile(home))
    assert.equal(typeof getDefaultModelPolicyOverrides(), 'function')
    // 写入 store 后，真实运行时（无 getOverrides 的 policy）动态读到
    registered.store.write({ provider: 'deepseek-account', model: 'deepseek-flash' })
    const runtimePolicy = createModelPolicy({ env: {}, getSelection: () => null, getProviders: () => [] })
    assert.equal(runtimePolicy.resolve('mood').provider, 'deepseek-account')
    rmSync(home, { recursive: true, force: true })
  } finally {
    setDefaultModelPolicyOverrides(previous)
  }
})

// ---------------------------------------------------------------------------
// Gate G2：训练配置与评估/回滚骨架（lib/domain/life/training-*.mjs，默认关闭）
// ---------------------------------------------------------------------------

function makeTrainingFixture(options = {}) {
  const home = tmpDir('training-home')
  const store = createTrainingConfigStore({ home, now: () => 5000 })
  if (options.config !== undefined) store.write(options.config)
  const calls = { runner: 0, evaluator: 0, cancel: 0, dataset: 0 }
  const runner =
    options.runner === undefined
      ? null
      : async (input) => {
          calls.runner += 1
          return options.runner(input, calls)
        }
  const evaluator =
    options.evaluator === undefined
      ? null
      : async (input) => {
          calls.evaluator += 1
          return options.evaluator(input, calls)
        }
  const cancelRun =
    options.cancelRun === undefined
      ? null
      : async (input) => {
          calls.cancel += 1
          return options.cancelRun(input, calls)
        }
  const datasetStats =
    options.datasetStats === undefined
      ? null
      : () => {
          calls.dataset += 1
          return options.datasetStats()
        }
  const service = createTrainingService({
    configStore: store,
    runner,
    evaluator,
    cancelRun,
    datasetStats,
    now: () => 5000,
    logger: { warn() {} },
  })
  return { home, store, service, calls }
}

test('training-config G2：默认关闭与默认值（缺文件）', () => {
  const { home, store } = makeTrainingFixture()
  const state = store.read()
  assert.equal(state.exists, false)
  assert.deepEqual(state.config, defaultTrainingConfig())
  assert.equal(state.config.enabled, false, '默认关闭')
  assert.equal(state.errors.length, 0)
  assert.equal(store.file, resolveTrainingConfigFile(home))
  assert.match(store.file, /\.dsh-poetry\/training-config\.json$/)
  assert.deepEqual(TRAINING_DATASET_SOURCES.slice(0, 2), ['journal', 'chat'])
  rmSync(home, { recursive: true, force: true })
})

test('training-config G2：非法值回退默认并报告（不崩）', () => {
  const normalized = normalizeTrainingConfig({
    enabled: 'yes',
    intervalDays: 0,
    dataset: { sources: ['journal', 'nope'], minEntries: 0 },
    hyperparams: { rank: 0, steps: -1, lr: 2 },
    eval: { minScore: 3 },
    adapter: { current: '', candidate: 5 },
    unknown: true,
  })
  assert.equal(normalized.ok, true)
  const config = normalized.config
  assert.equal(config.enabled, false)
  assert.equal(config.intervalDays, 7)
  assert.deepEqual(config.dataset.sources, ['journal'])
  assert.equal(config.dataset.minEntries, 200)
  assert.equal(config.hyperparams.rank, 8)
  assert.equal(config.hyperparams.steps, 300)
  assert.equal(config.hyperparams.lr, 0.0001)
  assert.equal(config.eval.minScore, 0.6)
  assert.equal(config.adapter.current, 'adapters-live')
  assert.equal(config.adapter.candidate, null)
  assert.ok(normalized.errors.length >= 8)
  assert.equal(normalizeTrainingConfig(null).ok, true)
  // 坏 JSON 文件 → 默认值 + errors
  const { home, store } = makeTrainingFixture()
  mkdirSync(path.dirname(store.file), { recursive: true })
  writeFileSync(store.file, '{bad')
  const state = store.read()
  assert.equal(state.config.enabled, false)
  assert.ok(state.errors.length >= 1)
  rmSync(home, { recursive: true, force: true })
})

test('training-config G2：原子写/0600/版本/reset', () => {
  const { home, store } = makeTrainingFixture()
  const written = store.write({
    enabled: true,
    intervalDays: 3,
    dataset: { sources: ['journal', 'feedback'], minEntries: 100 },
    hyperparams: { rank: 16, steps: 500, lr: 0.0002 },
    eval: { minScore: 0.8 },
    adapter: { current: 'adapters-live', candidate: null },
  })
  assert.equal(written.ok, true)
  const parsed = JSON.parse(readFileSync(store.file, 'utf8'))
  assert.equal(parsed.version, TRAINING_CONFIG_VERSION)
  assert.equal(parsed.enabled, true)
  assert.equal(parsed.intervalDays, 3)
  assert.deepEqual(parsed.dataset.sources, ['journal', 'feedback'])
  assert.equal(parsed.hyperparams.rank, 16)
  assert.equal(parsed.eval.minScore, 0.8)
  assert.equal(parsed.updatedAt, 5000)
  assert.equal(statSync(store.file).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(path.dirname(store.file)), ['training-config.json'])
  assert.equal(store.read().config.enabled, true)
  store.reset()
  assert.equal(store.read().config.enabled, false)
  rmSync(home, { recursive: true, force: true })
})

test('training-service G2：status 默认关闭/不启动 runner', async () => {
  const { home, service, calls } = makeTrainingFixture()
  const status = service.status()
  assert.equal(status.ok, true)
  assert.equal(status.version, TRAINING_SERVICE_VERSION)
  assert.equal(status.enabled, false)
  assert.equal(status.phase, 'idle')
  assert.equal(status.current, 'adapters-live')
  assert.equal(status.runnerAvailable, false)
  assert.equal(status.evaluatorAvailable, false)
  assert.equal(status.dataset.available, false)
  const result = await service.run({ confirm: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, TRAINING_SERVICE_CODES.disabled)
  assert.equal(calls.runner, 0, '默认不启动训练')
  assert.ok(TRAINING_PHASES.includes('succeeded'))
  rmSync(home, { recursive: true, force: true })
})

test('training-service G2：plan（禁用/数据不足/就绪）', () => {
  const disabled = makeTrainingFixture()
  const disabledPlan = disabled.service.plan()
  assert.equal(disabledPlan.ok, true)
  assert.equal(disabledPlan.ready, false)
  assert.equal(disabledPlan.blockedReason, 'disabled')
  assert.equal(disabledPlan.requiresConfirmation, true)
  assert.equal(disabledPlan.plan.steps.length, 5)
  disabled.service.configStore.write({ enabled: true })
  rmSync(disabled.home, { recursive: true, force: true })

  const small = makeTrainingFixture({
    config: { enabled: true },
    datasetStats: () => ({ entries: 50, sources: ['journal'] }),
  })
  const smallPlan = small.service.plan()
  assert.equal(smallPlan.ready, false)
  assert.equal(smallPlan.blockedReason, 'insufficient-data')
  assert.equal(smallPlan.plan.dataset.entries, 50)
  assert.equal(smallPlan.plan.dataset.required, 200)
  rmSync(small.home, { recursive: true, force: true })

  const ready = makeTrainingFixture({
    config: { enabled: true },
    datasetStats: () => ({ entries: 500, sources: ['journal', 'feedback'] }),
    runner: async () => ({ ok: true, candidate: { id: 'adapters-candidate-x' }, score: 0.9 }),
  })
  const readyPlan = ready.service.plan()
  assert.equal(readyPlan.ready, true)
  assert.equal(readyPlan.blockedReason, '')
  assert.match(readyPlan.plan.candidateId, /^adapters-candidate-/)
  assert.equal(readyPlan.plan.evalGate.minScore, 0.6)
  rmSync(ready.home, { recursive: true, force: true })

  const noRunner = makeTrainingFixture({ config: { enabled: true } })
  assert.equal(noRunner.service.plan().blockedReason, 'runner-unavailable')
  rmSync(noRunner.home, { recursive: true, force: true })
})

test('training-service G2：run 需要 enabled + confirm + runner + 数据量', async () => {
  const disabled = makeTrainingFixture({ runner: async () => ({ ok: true, candidate: { id: 'a' } }) })
  assert.equal((await disabled.service.run({ confirm: true })).code, TRAINING_SERVICE_CODES.disabled)
  rmSync(disabled.home, { recursive: true, force: true })

  const enabled = makeTrainingFixture({ config: { enabled: true } })
  const noConfirm = await enabled.service.run({})
  assert.equal(noConfirm.code, TRAINING_SERVICE_CODES.confirmationRequired)
  assert.equal(enabled.calls.runner, 0)
  const noRunner = await enabled.service.run({ confirm: true })
  assert.equal(noRunner.code, TRAINING_SERVICE_CODES.runnerUnavailable)
  rmSync(enabled.home, { recursive: true, force: true })

  const small = makeTrainingFixture({
    config: { enabled: true },
    datasetStats: () => ({ entries: 10 }),
    runner: async () => ({ ok: true, candidate: { id: 'a' } }),
  })
  const smallResult = await small.service.run({ confirm: true })
  assert.equal(smallResult.code, TRAINING_SERVICE_CODES.datasetTooSmall)
  assert.equal(smallResult.entries, 10)
  rmSync(small.home, { recursive: true, force: true })
})

test('training-service G2：run 成功 → eval 通过 → promote（confirm）上线', async () => {
  const { home, store, service, calls } = makeTrainingFixture({
    config: { enabled: true },
    datasetStats: () => ({ entries: 500 }),
    runner: async () => ({ ok: true, candidate: { id: 'adapters-candidate-1', path: '/tmp/candidate' }, score: 0.9 }),
  })
  const run = await service.run({ confirm: true })
  assert.equal(run.ok, true)
  assert.equal(run.passed, true)
  assert.equal(calls.runner, 1)
  assert.equal(service.status().phase, 'succeeded')
  assert.equal(service.status().candidate.passed, true)
  assert.equal(store.read().config.adapter.current, 'adapters-live', 'run 不改 current')
  const auditActions = service.audit().map((entry) => entry.action)
  assert.ok(auditActions.includes('run-start'))
  assert.ok(auditActions.includes('run-succeeded'))

  const noConfirm = service.promote({})
  assert.equal(noConfirm.code, TRAINING_SERVICE_CODES.confirmationRequired)
  assert.equal(store.read().config.adapter.current, 'adapters-live')
  const promoted = service.promote({ confirm: true })
  assert.equal(promoted.ok, true)
  assert.equal(promoted.current, 'adapters-candidate-1')
  assert.equal(promoted.previous, 'adapters-live')
  assert.equal(service.status().phase, 'promoted')
  const config = store.read().config
  assert.equal(config.adapter.current, 'adapters-candidate-1')
  assert.equal(config.adapter.previous, 'adapters-live')
  assert.equal(config.adapter.candidate, null)
  assert.ok(service.audit().some((entry) => entry.action === 'promoted'))
  rmSync(home, { recursive: true, force: true })
})

test('training-service G2：eval 未通过不可 promote；失败/取消不改 current', async () => {
  const evalFail = makeTrainingFixture({
    config: { enabled: true },
    runner: async () => ({ ok: true, candidate: { id: 'adapters-candidate-bad' }, score: 0.2 }),
  })
  const run = await evalFail.service.run({ confirm: true })
  assert.equal(run.ok, true)
  assert.equal(run.passed, false)
  assert.equal(run.candidate.passed, false)
  const rejected = evalFail.service.promote({ confirm: true })
  assert.equal(rejected.code, TRAINING_SERVICE_CODES.evalNotPassed)
  assert.equal(evalFail.store.read().config.adapter.current, 'adapters-live')
  rmSync(evalFail.home, { recursive: true, force: true })

  const failing = makeTrainingFixture({
    config: { enabled: true },
    runner: async () => ({ ok: false, message: 'OOM' }),
  })
  const failed = await failing.service.run({ confirm: true })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, TRAINING_SERVICE_CODES.runFailed)
  assert.equal(failing.service.status().phase, 'failed')
  assert.equal(failing.service.status().lastError.message, 'OOM')
  assert.equal(failing.store.read().config.adapter.current, 'adapters-live')
  assert.ok(failing.service.audit().some((entry) => entry.action === 'run-failed'))
  rmSync(failing.home, { recursive: true, force: true })

  const throwing = makeTrainingFixture({
    config: { enabled: true },
    runner: async () => {
      throw new Error('runner crashed')
    },
  })
  const crashed = await throwing.service.run({ confirm: true })
  assert.equal(crashed.code, TRAINING_SERVICE_CODES.runFailed)
  assert.equal(throwing.store.read().config.adapter.current, 'adapters-live')
  rmSync(throwing.home, { recursive: true, force: true })
})

test('training-service G2：取消（运行中）不改 current', async () => {
  let release = null
  const { home, store, service, calls } = makeTrainingFixture({
    config: { enabled: true },
    runner: () =>
      new Promise((resolve) => {
        release = resolve
      }),
    cancelRun: () => {
      release({ ok: false, cancelled: true })
    },
  })
  const pending = service.run({ confirm: true })
  await waitMs(0)
  assert.equal(service.status().phase, 'running')
  const cancelledRequest = await service.cancel()
  assert.equal(cancelledRequest.ok, true)
  assert.equal(cancelledRequest.requested, true)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.code, TRAINING_SERVICE_CODES.cancelled)
  assert.equal(calls.cancel, 1)
  assert.equal(service.status().phase, 'cancelled')
  assert.equal(store.read().config.adapter.current, 'adapters-live')
  assert.equal((await service.cancel()).code, TRAINING_SERVICE_CODES.notRunning)
  rmSync(home, { recursive: true, force: true })
})

test('training-service G2：rollback 回到 previous；无 previous 拒绝', async () => {
  const { home, store, service } = makeTrainingFixture({
    config: { enabled: true },
    runner: async () => ({ ok: true, candidate: { id: 'adapters-candidate-2' }, score: 0.95 }),
  })
  await service.run({ confirm: true })
  assert.equal(
    service.rollback({ confirm: true }).code,
    TRAINING_SERVICE_CODES.noPrevious,
    '尚未 promote 时无 previous',
  )
  service.promote({ confirm: true })
  assert.equal(store.read().config.adapter.current, 'adapters-candidate-2')
  const noConfirm = service.rollback({})
  assert.equal(noConfirm.code, TRAINING_SERVICE_CODES.confirmationRequired)
  const rolled = service.rollback({ confirm: true })
  assert.equal(rolled.ok, true)
  assert.equal(rolled.current, 'adapters-live')
  assert.equal(rolled.previous, 'adapters-candidate-2')
  assert.equal(store.read().config.adapter.current, 'adapters-live')
  assert.equal(service.status().phase, 'rolled-back')
  // 指定 target 回滚
  const toTarget = service.rollback({ confirm: true, target: 'adapters-candidate-2' })
  assert.equal(toTarget.ok, true)
  assert.equal(store.read().config.adapter.current, 'adapters-candidate-2')
  rmSync(home, { recursive: true, force: true })
})

test('training-service G2：evaluator 注入（评分来自评估器）与不写 adapter 文件', async () => {
  const { home, store, service, calls } = makeTrainingFixture({
    config: { enabled: true },
    runner: async () => ({ ok: true, candidate: { id: 'adapters-candidate-3' } }),
    evaluator: async () => ({ ok: true, score: 0.85, metrics: { ppl: 12.3 } }),
  })
  const run = await service.run({ confirm: true })
  assert.equal(run.ok, true)
  assert.equal(run.passed, true)
  assert.equal(run.candidate.score, 0.85)
  assert.deepEqual(run.candidate.metrics, { ppl: 12.3 })
  assert.equal(calls.evaluator, 1)
  service.promote({ confirm: true })
  // 只写 training-config.json，不写 adapter 产物
  const files = readdirSync(path.dirname(store.file)).sort()
  assert.deepEqual(files, ['training-config.json'])
  assert.equal(store.read().config.adapter.current, 'adapters-candidate-3')
  rmSync(home, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate H2：训练服务运行时接入（lib/composition/training-routes.mjs）——默认关闭/受保护 API
// ---------------------------------------------------------------------------

function makeTrainingRouteFixture(options = {}) {
  const dir = tmpDir('training-routes')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const store = createTrainingConfigStore({ file: path.join(dir, 'training-config.json'), now: () => 5000 })
  if (options.config !== undefined) store.write(options.config)
  const service = createTrainingService({
    configStore: store,
    runner: options.runner ?? null,
    now: () => 5000,
    logger: { warn() {} },
  })
  const handler = createTrainingHandler({ service, tokenFile, fence: options.fence ?? null, logger: { warn() {} } })
  return { dir, tokenFile, store, service, handler }
}

test('training-routes H2：GET 鉴权与默认关闭状态', async () => {
  const denied = makeTrainingRouteFixture({ fence: { check: () => 'blocked' } })
  const deniedRes = hubFakeRes()
  await denied.handler(hubFakeReq('GET', undefined, { url: TRAINING_ROUTE }), deniedRes)
  assert.equal(deniedRes.statusCode, 403)
  rmSync(denied.dir, { recursive: true, force: true })

  const { dir, store, handler } = makeTrainingRouteFixture({ fence: { check: () => 'blocked' } })
  const tokenRes = hubFakeRes()
  await handler(hubFakeReq('GET', undefined, { url: TRAINING_ROUTE + '?token=secret-token' }), tokenRes)
  assert.equal(tokenRes.statusCode, 200)
  const payload = tokenRes.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.available, true)
  assert.equal(payload.status.enabled, false, '默认关闭')
  assert.equal(payload.status.phase, 'idle')
  assert.equal(payload.status.runnerAvailable, false)
  assert.equal(payload.plan.ready, false)
  assert.equal(payload.plan.blockedReason, 'disabled')
  assert.equal(payload.config.file, store.file)
  assert.equal(payload.config.config.enabled, false)
  assert.ok(payload.actions.includes('run'))
  assert.deepEqual(TRAINING_ACTIONS.slice(0, 3), ['status', 'plan', 'config'])
  rmSync(dir, { recursive: true, force: true })
})

test('training-routes H2：POST 鉴权/默认关闭/confirm/无 runner', async () => {
  const { dir, store, service, handler } = makeTrainingRouteFixture({ fence: { check: () => 'blocked' } })
  const noAuth = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'run', confirm: true }), noAuth)
  assert.equal(noAuth.statusCode, 403)

  const disabled = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'run', confirm: true, token: 'secret-token' }), disabled)
  assert.equal(disabled.statusCode, 200)
  assert.equal(disabled.json().ok, false)
  assert.equal(disabled.json().code, 'TRAINING_DISABLED', '默认关闭时 run 一律拒绝')

  store.write({ enabled: true })
  const noConfirm = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'run', token: 'secret-token' }), noConfirm)
  assert.equal(noConfirm.json().code, 'TRAINING_CONFIRMATION_REQUIRED')
  const noRunner = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'run', confirm: true, token: 'secret-token' }), noRunner)
  assert.equal(noRunner.json().code, 'TRAINING_RUNNER_UNAVAILABLE', '运行时默认不注入 runner，不会启动训练')
  assert.equal(service.status().phase, 'idle')
  // 只读 action
  const planRes = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'plan', token: 'secret-token' }), planRes)
  assert.equal(planRes.json().ok, true)
  assert.equal(planRes.json().status.enabled, true)
  assert.equal(planRes.json().plan.blockedReason, 'runner-unavailable')
  rmSync(dir, { recursive: true, force: true })
})

test('training-routes H2：promote/rollback 需 confirm 且无候选时拒绝', async () => {
  const { dir, handler } = makeTrainingRouteFixture({ config: { enabled: true } })
  const promoteNoConfirm = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'promote', token: 'secret-token' }), promoteNoConfirm)
  assert.equal(promoteNoConfirm.json().code, 'TRAINING_CONFIRMATION_REQUIRED')
  const promote = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'promote', confirm: true, token: 'secret-token' }), promote)
  assert.equal(promote.json().code, 'TRAINING_NO_CANDIDATE')
  const rollback = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'rollback', confirm: true, token: 'secret-token' }), rollback)
  assert.equal(rollback.json().code, 'TRAINING_NO_PREVIOUS')
  const cancel = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'cancel', token: 'secret-token' }), cancel)
  assert.equal(cancel.json().code, 'TRAINING_NOT_RUNNING')
  rmSync(dir, { recursive: true, force: true })
})

test('training-routes H2：错误分支（未知 action/非法 JSON/方法不允许）', async () => {
  const { dir, handler } = makeTrainingRouteFixture()
  const unknown = hubFakeRes()
  await handler(hubFakeReq('POST', { action: 'nope', token: 'secret-token' }), unknown)
  assert.equal(unknown.statusCode, 400)
  assert.equal(unknown.json().error, 'unknown_action')
  const badJson = hubFakeRes()
  await handler(
    {
      method: 'POST',
      url: TRAINING_ROUTE,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{bad')
      },
    },
    badJson,
  )
  assert.equal(badJson.statusCode, 400)
  assert.equal(badJson.json().error, 'invalid_json')
  const notAllowed = hubFakeRes()
  await handler(hubFakeReq('PUT', { token: 'secret-token' }), notAllowed)
  assert.equal(notAllowed.statusCode, 405)
  // fence 允许（无 token）
  const fenceHandler = createTrainingHandler({ service: null, tokenFile: '', fence: { check: () => null } })
  const noServiceGet = hubFakeRes()
  await fenceHandler(hubFakeReq('GET', undefined, { url: TRAINING_ROUTE }), noServiceGet)
  assert.equal(noServiceGet.statusCode, 200)
  assert.equal(noServiceGet.json().available, false)
  const noServiceRun = hubFakeRes()
  await fenceHandler(hubFakeReq('POST', { action: 'run', confirm: true }), noServiceRun)
  assert.equal(noServiceRun.json().code, 'TRAINING_UNAVAILABLE')
  rmSync(dir, { recursive: true, force: true })
})

test('training-routes H2：注册路由（http-wiring 契约）', () => {
  const routes = []
  const disposers = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  const store = createTrainingConfigStore({
    file: path.join(tmpDir('training-register'), 'training-config.json'),
    now: () => 5000,
  })
  const service = createTrainingService({ configStore: store, now: () => 5000 })
  const handler = registerTrainingRoute({
    webServer,
    disposers,
    service,
    tokenFile: '',
    fence: null,
    logger: { warn() {} },
  })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, TRAINING_ROUTE)
  assert.equal(typeof handler, 'function')
  assert.equal(disposers.length, 1)
  assert.deepEqual(TRAINING_ACTIONS, ['status', 'plan', 'config', 'run', 'cancel', 'promote', 'rollback'])
})

test('training-routes H2：状态读取反映配置变更（仍不训练）', async () => {
  const { dir, store, service, handler } = makeTrainingRouteFixture()
  store.write({ enabled: true, intervalDays: 3, dataset: { sources: ['journal'], minEntries: 10 } })
  const res = hubFakeRes()
  await handler(hubFakeReq('GET', undefined, { url: TRAINING_ROUTE + '?token=secret-token' }), res)
  const payload = res.json()
  assert.equal(payload.status.enabled, true)
  assert.equal(payload.status.phase, 'idle', '打开 enabled 也不会自动训练')
  assert.equal(payload.config.config.intervalDays, 3)
  assert.equal(payload.config.config.dataset.minEntries, 10)
  assert.equal(payload.plan.blockedReason, 'runner-unavailable')
  assert.equal(service.audit().length, 0, '只读操作不产生训练审计')
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate H3：真实 Activity 执行适配器注入（hub-runtime + hub-routes task.create）
// ---------------------------------------------------------------------------

function makeH3Fixture(flag, options = {}) {
  const calls = { chat: 0, decide: 0, recordReceipt: 0 }
  const chatBridge = options.chatBridge ?? {
    async chat(input) {
      calls.chat += 1
      return { ok: true, reply: '好呀：' + String(input.text || '').slice(0, 20) }
    },
  }
  const minecraftWorld = options.minecraftWorld ?? {
    decide(observation) {
      calls.decide += 1
      return { ok: true, command: { id: 'cmd-hub-1', tool: 'mc_wait', arguments: {}, reason: 'hub' }, observation }
    },
    recordReceipt(receipt) {
      calls.recordReceipt += 1
      return { ok: true, accepted: true, lastReceipt: { ...receipt, at: 1000 } }
    },
  }
  const dir = tmpDir('h3-hub')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const activityManifests = createRealActivityAdapters({
    chatBridgeProvider: () => chatBridge,
    minecraftWorldProvider: () => minecraftWorld,
    now: () => 1000,
  })
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: flag,
    activityManifests,
    now: () => 1000,
  })
  runtime.start()
  setActiveHubRuntime(runtime)
  const handler = createHubHandler({ tokenFile, fence: { check: () => null }, hubRuntime: runtime })
  return { dir, tokenFile, runtime, handler, calls, chatBridge, minecraftWorld }
}

test('hub-runtime H3：off/shadow 不注入真实 adapter、不执行任务', async () => {
  const off = makeH3Fixture({ enabled: false, shadow: true })
  assert.deepEqual(off.runtime.getAdapters(), [], 'off 不注入 adapter')
  assert.deepEqual(off.runtime.snapshot().adapters, [])
  const offPost = hubFakeRes()
  await off.handler(
    hubFakeReq('POST', {
      action: 'task.create',
      kind: 'chat.turn',
      payload: { peerId: 'p', messageId: 'm', text: 'hi' },
    }),
    offPost,
  )
  assert.equal(offPost.statusCode, 200)
  assert.equal(offPost.json().ok, false)
  assert.equal(offPost.json().code, 'HUB_FULL_REQUIRED')
  assert.equal(off.runtime.getInstances().taskBoard.snapshot().total, 0, 'feature flag 关闭时不创建任务')
  assert.equal(off.calls.chat, 0)
  assert.equal((await executeActivityTask(off.runtime, 'missing')).code, 'HUB_FULL_REQUIRED')
  off.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(off.dir, { recursive: true, force: true })

  const shadow = makeH3Fixture({ enabled: true, shadow: true })
  assert.deepEqual(shadow.runtime.getAdapters(), [], 'shadow 不注入 adapter')
  const shadowPost = hubFakeRes()
  await shadow.handler(
    hubFakeReq('POST', {
      action: 'task.create',
      kind: 'chat.turn',
      payload: { peerId: 'p', messageId: 'm', text: 'hi' },
    }),
    shadowPost,
  )
  assert.equal(shadowPost.json().code, 'HUB_FULL_REQUIRED')
  assert.equal(shadow.runtime.getInstances().taskBoard.snapshot().total, 0)
  assert.equal(shadow.calls.chat, 0)
  shadow.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(shadow.dir, { recursive: true, force: true })
})

test('hub-runtime H3：full 模式 chat 任务经 chatBridge 执行并回 receipt', async () => {
  const fixture = makeH3Fixture({ enabled: true, shadow: false })
  assert.deepEqual(fixture.runtime.getAdapters().sort(), ['chat', 'minecraft'])
  const res = hubFakeRes()
  await fixture.handler(
    hubFakeReq('POST', {
      action: 'task.create',
      kind: 'chat.turn',
      payload: { peerId: 'peer-1', messageId: 'm-1', text: '你好' },
      idempotencyKey: 'hub-chat-1',
    }),
    res,
  )
  assert.equal(res.statusCode, 200)
  const result = res.json()
  assert.equal(result.ok, true)
  assert.equal(result.executed, true)
  assert.equal(result.success, true)
  assert.equal(result.receipt.ok, true)
  assert.equal(result.receipt.replyId, 'hub-chat-m-1')
  assert.equal(fixture.calls.chat, 1, 'chatBridge 被真实调用一次')
  const board = fixture.runtime.getInstances().taskBoard
  const task = board.get(result.task.id)
  assert.equal(task.status, 'done', 'receipt 回写任务板')
  assert.ok(result.feedback !== null, 'receipt 进入反馈账本')
  assert.ok(fixture.runtime.getInstances().feedbackLedger.snapshot().records >= 1)
  fixture.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('hub-runtime H3：full 模式 minecraft 任务经 world.recordReceipt 回写', async () => {
  const fixture = makeH3Fixture({ enabled: true, shadow: false })
  const res = hubFakeRes()
  await fixture.handler(
    hubFakeReq('POST', {
      action: 'task.create',
      kind: 'minecraft.build',
      payload: { tool: 'mc_build', arguments: { goal: '小屋' } },
      idempotencyKey: 'hub-mc-1',
    }),
    res,
  )
  const result = res.json()
  assert.equal(result.ok, true)
  assert.equal(result.executed, true)
  assert.equal(result.success, true)
  assert.equal(result.receipt.ok, true)
  assert.equal(result.receipt.tool, 'mc_build')
  assert.equal(fixture.calls.recordReceipt, 1, 'world.recordReceipt 被调用（receipt 回写）')
  const board = fixture.runtime.getInstances().taskBoard
  assert.equal(board.get(result.task.id).status, 'done')
  fixture.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('hub-runtime H3：idempotencyKey 去重（不重复执行）', async () => {
  const fixture = makeH3Fixture({ enabled: true, shadow: false })
  const payload = {
    action: 'task.create',
    kind: 'chat.turn',
    payload: { peerId: 'p', messageId: 'm', text: 'hi' },
    idempotencyKey: 'same-key',
  }
  const first = hubFakeRes()
  await fixture.handler(hubFakeReq('POST', payload), first)
  assert.equal(first.json().executed, true)
  const second = hubFakeRes()
  await fixture.handler(hubFakeReq('POST', payload), second)
  assert.equal(second.json().ok, true)
  assert.equal(second.json().duplicate, true)
  assert.equal(second.json().executed, false)
  assert.equal(fixture.calls.chat, 1, '重复 key 不重复执行')
  fixture.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('hub-runtime H3：执行错误隔离（bridge 抛错 → 任务失败但不崩）', async () => {
  const fixture = makeH3Fixture(
    { enabled: true, shadow: false },
    {
      chatBridge: {
        async chat() {
          throw new Error('bridge down')
        },
      },
    },
  )
  const res = hubFakeRes()
  await fixture.handler(
    hubFakeReq('POST', {
      action: 'task.create',
      kind: 'chat.turn',
      payload: { peerId: 'p', messageId: 'm', text: 'hi' },
    }),
    res,
  )
  const result = res.json()
  assert.equal(result.ok, true)
  assert.equal(result.executed, true)
  assert.equal(result.success, false)
  assert.equal(result.receipt.ok, false)
  assert.equal(fixture.runtime.snapshot().ok, true, 'Hub 自身不崩')
  const board = fixture.runtime.getInstances().taskBoard
  assert.equal(board.get(result.task.id).status, 'failed')
  // 下一个任务仍可执行
  const retry = hubFakeRes()
  await fixture.handler(
    hubFakeReq('POST', {
      action: 'task.create',
      kind: 'chat.turn',
      payload: { peerId: 'p', messageId: 'm2', text: 'hi again' },
    }),
    retry,
  )
  assert.equal(retry.json().ok, true)
  fixture.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('hub-runtime H3：task.create 参数校验', async () => {
  const fixture = makeH3Fixture({ enabled: true, shadow: false })
  const missingKind = hubFakeRes()
  await fixture.handler(hubFakeReq('POST', { action: 'task.create', payload: {} }), missingKind)
  assert.equal(missingKind.json().code, 'HUB_INVALID_ARGUMENT')
  const missingChatField = hubFakeRes()
  await fixture.handler(
    hubFakeReq('POST', { action: 'task.create', kind: 'chat.turn', payload: { peerId: 'p' } }),
    missingChatField,
  )
  assert.equal(missingChatField.json().code, 'HUB_INVALID_ARGUMENT')
  const unknownActivity = hubFakeRes()
  await fixture.handler(
    hubFakeReq('POST', { action: 'task.create', kind: 'unknown.run', activity: 'unknown', payload: {} }),
    unknownActivity,
  )
  assert.equal(unknownActivity.json().code, 'HUB_NO_ACTIVITY_ADAPTER')
  const noTask = hubFakeRes()
  await fixture.handler(
    hubFakeReq('POST', { action: 'task.create', kind: 'chat.turn', payload: { peerId: 'p', messageId: 'm' } }),
    noTask,
  )
  assert.equal(noTask.json().code, 'HUB_INVALID_ARGUMENT')
  assert.equal(fixture.runtime.getInstances().taskBoard.snapshot().total, 0, '校验失败不创建任务')
  fixture.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('hub-runtime H3：executeTask 直接执行已存在任务', async () => {
  const fixture = makeH3Fixture({ enabled: true, shadow: false })
  const board = fixture.runtime.getInstances().taskBoard
  const created = board.create({
    activity: 'chat',
    kind: 'chat.turn',
    payload: { peerId: 'p-direct', messageId: 'm-direct', text: '直接执行' },
  })
  assert.equal(created.ok, true)
  const result = await executeActivityTask(fixture.runtime, created.task.id)
  assert.equal(result.ok, true)
  assert.equal(result.success, true)
  assert.equal(result.receipt.replyId, 'hub-chat-m-direct')
  assert.equal(board.get(created.task.id).status, 'done')
  assert.equal((await executeActivityTask(fixture.runtime, 'missing')).code, 'HUB_TASK_NOT_FOUND')
  fixture.runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(fixture.dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate H5：Memory 写入桥（game-memory onRecord + Hub memoryWrite flag）
// ---------------------------------------------------------------------------

function h5WorkspaceFixture(options = {}) {
  const dir = tmpDir('h5-game-memory')
  const recorded = []
  const workspace = createGameMemoryWorkspace({
    dir,
    git: false,
    now: () => 1000,
    ...(options.withHook === false
      ? {}
      : {
          onRecord: (entry) => {
            recorded.push(entry)
            options.onRecord?.(entry)
          },
        }),
  })
  return { dir, workspace, recorded }
}

function h5DirFiles(dir) {
  const out = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out[entry.name] = h5DirFiles(full)
    else out[entry.name] = readFileSync(full, 'utf8')
  }
  return out
}

test('game-memory H5：onRecord 在旧写盘成功后调用，旧写入/文件不变', () => {
  const withHook = h5WorkspaceFixture()
  const withoutHook = h5WorkspaceFixture({ withHook: false })
  const input = { category: 'event', text: '第一次见面', source: 'Yuan_JY' }
  const first = withHook.workspace.record(input)
  const baseline = withoutHook.workspace.record(input)
  assert.equal(first.ok, true)
  assert.equal(baseline.ok, true)
  assert.deepEqual(first.entry, baseline.entry, '返回值不变')
  assert.equal(withHook.recorded.length, 1, '旧写盘成功后调用 onRecord')
  assert.deepEqual(withHook.recorded[0], { category: 'event', text: '第一次见面', at: 1000, source: 'Yuan_JY' })
  assert.deepEqual(h5DirFiles(withHook.dir), h5DirFiles(withoutHook.dir), '文件内容与无回调完全一致')
  // 重复记录 → 不写盘、不通知
  const dup = withHook.workspace.record(input)
  assert.equal(dup.ok, true)
  assert.equal(dup.deduped, true)
  assert.equal(withHook.recorded.length, 1, 'dedupe 不通知 onRecord')
  // 非法输入 → 不通知
  assert.equal(withHook.workspace.record({ category: 'event', text: '' }).ok, false)
  assert.equal(withHook.recorded.length, 1)
  rmSync(withHook.dir, { recursive: true, force: true })
  rmSync(withoutHook.dir, { recursive: true, force: true })
})

test('game-memory H5：onRecord 抛错隔离（不影响旧写入）', () => {
  const { dir, workspace, recorded } = h5WorkspaceFixture({
    onRecord: () => {
      throw new Error('bridge boom')
    },
  })
  const result = workspace.record({ category: 'build', text: '盖了 3×3 小屋', source: 'self' })
  assert.equal(result.ok, true, '回调抛错不影响 record 返回')
  assert.equal(recorded.length, 1)
  const files = h5DirFiles(dir)
  assert.ok(Object.keys(files).includes('build'), '旧路径仍写盘')
  assert.match(files.build['home.md'], /盖了 3×3 小屋/)
  assert.match(files['PARTNER_GAME.md'], /盖了 3×3 小屋/)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime H5：memoryWrite 默认关闭（不写 Gateway）', async () => {
  assert.equal(resolveHubFeatureFlag({}).memoryWrite, false)
  assert.equal(resolveHubFeatureFlag({ env: {} }).memoryWrite, false)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_MEMORY_WRITE: 'gateway' } }).memoryWrite, true)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_MEMORY_WRITE: 'off' } }).memoryWrite, false)
  assert.equal(resolveHubFeatureFlag({ settings: { memoryWrite: 'gateway' } }).memoryWrite, true)
  assert.equal(resolveHubFeatureFlag({ settings: { hub: { memoryWrite: 'gateway' } } }).memoryWrite, true)
  assert.equal(
    resolveHubFeatureFlag({ featureFlag: { enabled: true, shadow: false, memoryWrite: true } }).memoryWrite,
    true,
  )
  const writes = []
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: false, shadow: true, memoryWrite: false },
    memoryGateway: {
      registerProvider: () => ({ ok: true }),
      write: (entry) => {
        writes.push(entry)
        return { ok: true }
      },
      snapshot: () => ({ metrics: { writes: writes.length }, conflicts: 0 }),
    },
    now: () => 1000,
  })
  const result = await runtime.recordMemory({ category: 'event', text: '不该写网关' })
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'memory-write-disabled')
  assert.equal(writes.length, 0, 'flag 关闭零 Gateway 写入')
  assert.equal(runtime.snapshot().memory.write, false)
  runtime.dispose()
})

test('hub-runtime H5：memoryWrite 开启后 game-memory 记录进 Gateway', async () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    env: { DSH_POETRY_MEMORY_WRITE: 'gateway' },
    now: () => 1000,
  })
  assert.equal(runtime.featureFlag.memoryWrite, true)
  assert.equal(runtime.snapshot().memory.write, true)
  const result = await runtime.recordMemory({ category: 'event', text: '第一次见面', at: 1000, source: 'Yuan_JY' })
  assert.equal(result.ok, true)
  assert.ok(result.entry !== null)
  assert.equal(result.entry.category, 'episodic', 'game 分类映射到 Gateway category')
  assert.equal(result.entry.text, '第一次见面')
  assert.equal(result.entry.source.kind, 'game-memory')
  assert.equal(runtime.memorySnapshot().metrics.writes >= 1, true, 'Gateway 有写入计数')
  // 经 workspace onRecord 端到端：旧文件照写 + Gateway 记录
  const dir = tmpDir('h5-e2e')
  const workspace = createGameMemoryWorkspace({
    dir,
    git: false,
    now: () => 1000,
    onRecord: (entry) => {
      runtime.recordMemory(entry).catch(() => {})
    },
  })
  workspace.record({ category: 'player', text: '一起玩的人：Yuan_JY', source: 'self' })
  await waitMs(0)
  assert.match(readFileSync(path.join(dir, 'players.md'), 'utf8'), /一起玩的人：Yuan_JY/)
  assert.equal(runtime.memorySnapshot().metrics.writes >= 2, true)
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime H5：Gateway 失败不影响旧路径（失败隔离）', async () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: false, shadow: true, memoryWrite: true },
    memoryGateway: {
      registerProvider: () => ({ ok: true }),
      write: () => {
        throw new Error('gateway down')
      },
      snapshot: () => ({ metrics: {}, conflicts: 0 }),
    },
    now: () => 1000,
  })
  const failed = await runtime.recordMemory({ category: 'event', text: '网关失败' })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'HUB_MEMORY_WRITE_FAILED')
  assert.equal(runtime.snapshot().ok, true, 'Hub 不崩')
  const dir = tmpDir('h5-isolation')
  const workspace = createGameMemoryWorkspace({
    dir,
    git: false,
    now: () => 1000,
    onRecord: (entry) => {
      runtime.recordMemory(entry).catch(() => {})
    },
  })
  const recorded = workspace.record({ category: 'event', text: '旧路径仍然成功', source: 'self' })
  await waitMs(0)
  assert.equal(recorded.ok, true)
  assert.match(readFileSync(path.join(dir, 'log', '1970-01.md'), 'utf8'), /旧路径仍然成功/)
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate H6：训练 runner 注入（lib/domain/life/training-runner.mjs）——fake spawn，不真正训练
// ---------------------------------------------------------------------------

function makeFakeTrainingSpawn() {
  const calls = []
  const children = []
  const kills = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = (signal) => {
      kills.push(signal)
      return true
    }
    children.push(child)
    return child
  }
  return { spawn, calls, children, kills }
}

function makeTrainingRunnerFixture(options = {}) {
  const home = tmpDir('h6-runner')
  const script = path.join(home, 'self-train.sh')
  writeFileSync(script, '#!/bin/bash\necho training\n')
  const fake = makeFakeTrainingSpawn()
  const runner = createTrainingRunner({
    home,
    script,
    spawn: options.spawn ?? fake.spawn,
    logDir: path.join(home, 'logs'),
    now: () => 1000,
    ...(options.maxLogBytes === undefined ? {} : { maxLogBytes: options.maxLogBytes }),
    logger: { info() {} },
  })
  return { home, script, runner, fake }
}

test('training-runner H6：成功 spawn 返回 exitCode/logFile/candidate，环境变量可注入', async () => {
  const { home, script, runner, fake } = makeTrainingRunnerFixture()
  const promise = runner.run({
    runId: 'run-1',
    config: { hyperparams: { rank: 8, steps: 300, lr: 0.0001 } },
    plan: { candidateId: 'adapters-candidate-run1' },
  })
  const child = fake.children[0]
  child.stdout.emit('data', 'training output line\n')
  child.stderr.emit('data', 'warning line\n')
  child.emit('close', 0, null)
  const result = await promise
  assert.equal(result.ok, true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.runId, 'run-1')
  assert.equal(result.candidate.id, 'adapters-candidate-run1')
  assert.equal(result.candidate.path, result.logFile)
  assert.ok(existsSync(result.logFile), '日志文件存在')
  const log = readFileSync(result.logFile, 'utf8')
  assert.match(log, /training output line/)
  assert.match(log, /warning line/)
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].command, '/bin/bash')
  assert.deepEqual(fake.calls[0].args, [script])
  assert.equal(fake.calls[0].options.env.DSH_TRAINING_RUN_ID, 'run-1')
  assert.equal(fake.calls[0].options.env.DSH_TRAINING_RANK, '8')
  assert.equal(fake.calls[0].options.env.DSH_TRAINING_STEPS, '300')
  assert.equal(fake.calls[0].options.env.DSH_TRAINING_LR, '0.0001')
  assert.equal('DSH_TRAINING_UPLOAD' in fake.calls[0].options.env, false, '不注入上传/网络变量')
  assert.deepEqual(runner.snapshot().running, [])
  rmSync(home, { recursive: true, force: true })
})

test('training-runner H6：失败退出码/取消/spawn 错误', async () => {
  const failed = makeTrainingRunnerFixture()
  const failPromise = failed.runner.run({ runId: 'run-fail' })
  failed.fake.children[0].emit('close', 1, null)
  const failResult = await failPromise
  assert.equal(failResult.ok, false)
  assert.equal(failResult.exitCode, 1)
  assert.match(failResult.message, /退出码 1/)
  assert.ok(existsSync(failResult.logFile))
  rmSync(failed.home, { recursive: true, force: true })

  const cancelled = makeTrainingRunnerFixture()
  const pending = cancelled.runner.run({ runId: 'run-cancel' })
  assert.deepEqual(cancelled.runner.snapshot().running, ['run-cancel'])
  const cancelResult = cancelled.runner.cancel('run-cancel')
  assert.equal(cancelResult.ok, true)
  assert.deepEqual(cancelled.fake.kills, ['SIGTERM'])
  cancelled.fake.children[0].emit('close', null, 'SIGTERM')
  const cancelledResult = await pending
  assert.equal(cancelledResult.ok, false)
  assert.equal(cancelledResult.cancelled, true)
  assert.equal(cancelledResult.candidate, null)
  assert.equal(cancelled.runner.cancel('run-cancel').code, TRAINING_RUNNER_CODES.notRunning)
  rmSync(cancelled.home, { recursive: true, force: true })

  const broken = makeTrainingRunnerFixture()
  const brokenPromise = broken.runner.run({ runId: 'run-broken' })
  broken.fake.children[0].emit('error', new Error('spawn ENOENT'))
  const brokenResult = await brokenPromise
  assert.equal(brokenResult.ok, false)
  assert.equal(brokenResult.code, TRAINING_RUNNER_CODES.spawnFailed)
  rmSync(broken.home, { recursive: true, force: true })
})

test('training-runner H6：脚本缺失/日志上限/默认快照（不真正训练）', async () => {
  const home = tmpDir('h6-missing')
  const fake = makeFakeTrainingSpawn()
  const missingRunner = createTrainingRunner({
    home,
    script: path.join(home, 'nope.sh'),
    spawn: fake.spawn,
    now: () => 1000,
  })
  const missing = await missingRunner.run({ runId: 'x' })
  assert.equal(missing.code, TRAINING_RUNNER_CODES.scriptMissing)
  assert.equal(fake.calls.length, 0, '脚本缺失不 spawn')
  rmSync(home, { recursive: true, force: true })

  const capped = makeTrainingRunnerFixture({ maxLogBytes: 20 })
  const cappedPromise = capped.runner.run({ runId: 'run-cap' })
  capped.fake.children[0].stdout.emit('data', 'x'.repeat(200))
  capped.fake.children[0].emit('close', 0, null)
  const cappedResult = await cappedPromise
  assert.ok(readFileSync(cappedResult.logFile, 'utf8').length <= 20, '日志按上限截断')
  rmSync(capped.home, { recursive: true, force: true })

  const runner = createTrainingRunner({ home: tmpDir('h6-snapshot'), spawn: fake.spawn })
  const snapshot = runner.snapshot()
  assert.equal(snapshot.version, TRAINING_RUNNER_VERSION)
  assert.match(snapshot.script, /self-train\.sh$/)
  assert.deepEqual(snapshot.running, [])
  assert.equal(fake.calls.length, 0, '创建 runner 不 spawn')
  rmSync(snapshot.logDir.split('/.dsh-poetry')[0], { recursive: true, force: true })
})

test('training-runner H6：注入 training-service（run gate/成功/取消/失败不改 current）', async () => {
  const home = tmpDir('h6-service')
  const store = createTrainingConfigStore({ file: path.join(home, 'training-config.json'), now: () => 5000 })
  const fake = makeFakeTrainingSpawn()
  const script = path.join(home, 'self-train.sh')
  writeFileSync(script, '#!/bin/bash\necho ok\n')
  const runner = createTrainingRunner({
    home,
    script,
    spawn: fake.spawn,
    logDir: path.join(home, 'logs'),
    now: () => 5000,
    logger: { info() {} },
  })
  const makeService = () =>
    createTrainingService({
      configStore: store,
      runner: (input) => runner.run(input),
      cancelRun: (input) => runner.cancel(input && input.runId),
      evaluator: async () => ({ ok: true, score: 0.9 }),
      now: () => 5000,
      logger: { warn() {} },
    })
  const service = makeService()
  assert.equal((await service.run({ confirm: true })).code, TRAINING_SERVICE_CODES.disabled, '默认关闭不训练')
  store.write({ enabled: true })
  assert.equal((await service.run({})).code, TRAINING_SERVICE_CODES.confirmationRequired, '缺 confirm 拒绝')
  assert.equal(fake.calls.length, 0, '未满足条件不 spawn')
  const runPromise = service.run({ confirm: true })
  await waitMs(0)
  assert.equal(fake.calls.length, 1, '满足 enabled+confirm 才 spawn')
  fake.children[0].emit('close', 0, null)
  const runResult = await runPromise
  assert.equal(runResult.ok, true)
  assert.equal(runResult.passed, true, 'evaluator 通过后 candidate passed')
  assert.equal(store.read().config.adapter.current, 'adapters-live', 'run 不改 current')
  service.promote({ confirm: true })
  assert.equal(store.read().config.adapter.current, runResult.candidate.id)

  // 取消：kill 子进程，current 不变
  const currentBefore = store.read().config.adapter.current
  const cancelPromise = makeService().run({ confirm: true })
  await waitMs(0)
  const cancelChild = fake.children[fake.children.length - 1]
  const serviceForCancel = makeService()
  // 用新的 service 无法拿到上一个 run 的引用；直接验证 runner cancel + close 行为
  const cancelRunnerResult = runner.cancel('train-1-5000')
  assert.equal(cancelRunnerResult.ok, true)
  assert.deepEqual(fake.kills, ['SIGTERM'])
  cancelChild.emit('close', null, 'SIGTERM')
  await cancelPromise.catch(() => {})
  assert.equal(store.read().config.adapter.current, currentBefore, '取消不改 current')
  void serviceForCancel

  // 失败：current 不变
  const failService = makeService()
  const failPromise = failService.run({ confirm: true })
  await waitMs(0)
  fake.children[fake.children.length - 1].emit('close', 2, null)
  const failResult = await failPromise
  assert.equal(failResult.ok, false)
  assert.equal(failResult.code, TRAINING_SERVICE_CODES.runFailed)
  assert.equal(store.read().config.adapter.current, currentBefore, '失败不改 current')
  rmSync(home, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate I1：Hub 持久化（TaskBoard JSON 快照 + EventBus JSONL，opt-in）
// ---------------------------------------------------------------------------

test('file-stores I1：JSON 任务板 store 原子写/坏文件降级', () => {
  const dir = tmpDir('i1-taskstore')
  const file = path.join(dir, 'hub-taskboard.json')
  const store = createJsonTaskStore({ file, now: () => 5000 })
  assert.equal(store.load(), null, 'TaskBoard 契约：缺失 → null')
  const missing = store.read()
  assert.equal(missing.ok, true)
  assert.equal(missing.data, null)
  assert.equal(missing.exists, false)
  const saved = store.save({ ok: true, v: 1, tasks: [{ id: 'tb-1' }] })
  assert.equal(saved.ok, true)
  assert.equal(statSync(file).mode & 0o777, 0o600, '文件 0600')
  assert.deepEqual(readdirSync(dir), ['hub-taskboard.json'], '无临时文件残留')
  assert.deepEqual(store.load().tasks, [{ id: 'tb-1' }])
  const loaded = store.read()
  assert.deepEqual(loaded.data.tasks, [{ id: 'tb-1' }])
  assert.equal(store.snapshot().saves, 1)
  assert.equal(store.snapshot().bytes > 0, true)
  // 坏 JSON → null + errors（不抛）
  writeFileSync(file, '{bad json')
  assert.equal(store.load(), null)
  const bad = store.read()
  assert.equal(bad.data, null)
  assert.ok(bad.errors.length >= 1)
  // 空文件 → null
  writeFileSync(file, '   ')
  assert.equal(store.load(), null)
  assert.equal(store.clear().ok, true)
  assert.equal(existsSync(file), false)
  assert.equal(FILE_STORES_VERSION, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('file-stores I1：JSONL 事件 store append/有界读取/坏行/轮转', () => {
  const dir = tmpDir('i1-eventstore')
  const file = path.join(dir, 'hub-events.jsonl')
  const store = createJsonlEventStore({ file, maxBytes: 300, now: () => 5000 })
  assert.equal(store.append({ type: 'task.created', n: 1 }).ok, true)
  assert.equal(store.append({ type: 'task.created', n: 2 }).ok, true)
  assert.equal(store.append({ type: 'task.created', n: 3 }).ok, true)
  const all = store.readAll()
  assert.equal(all.ok, true)
  assert.deepEqual(
    all.events.map((event) => event.n),
    [1, 2, 3],
  )
  const tail = store.readTail({ maxLines: 2 })
  assert.deepEqual(
    tail.events.map((event) => event.n),
    [2, 3],
    'readTail 只取最近 N 条',
  )
  // 坏行跳过
  writeFileSync(file, readFileSync(file, 'utf8') + 'not-json\n')
  assert.equal(store.readAll().badLines, 1)
  // 文件上限轮转
  let last = null
  for (let index = 0; index < 20; index += 1)
    last = store.append({ type: 'task.created', n: 100 + index, pad: 'x'.repeat(40) })
  assert.equal(last.ok, true)
  assert.ok(store.snapshot().rotations >= 1, '超过 maxBytes 轮转')
  assert.equal(existsSync(`${file}.1`), true)
  assert.equal(DEFAULT_EVENT_STORE_MAX_BYTES > 0, true)
  assert.equal(store.clear().ok, true)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime J4：persist 默认开启（写盘/恢复），显式 off 零写盘', async () => {
  // 解析默认：默认 true；env=0/false 或 settings.persist=false 显式关闭
  assert.equal(resolveHubFeatureFlag({}).persist, true)
  assert.equal(resolveHubFeatureFlag({ env: {} }).persist, true)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB_PERSIST: '0' } }).persist, false)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB_PERSIST: 'false' } }).persist, false)
  assert.equal(resolveHubFeatureFlag({ env: { DSH_POETRY_HUB_PERSIST: '1' } }).persist, true)
  assert.equal(resolveHubFeatureFlag({ settings: { persist: false } }).persist, false)
  assert.equal(resolveHubFeatureFlag({ featureFlag: { persist: false } }).persist, false)
  // 默认（不传 flag）→ 自动创建 store 并写盘
  const dir = tmpDir('j4-default')
  const paths = { taskBoardFile: path.join(dir, 'hub-taskboard.json'), eventFile: path.join(dir, 'hub-events.jsonl') }
  const runtime = createHubRuntime({ logger: { warn() {} }, persistPaths: paths, now: () => 1000 })
  assert.equal(runtime.snapshot().persist.enabled, true, '默认开启 persist')
  assert.ok(runtime.snapshot().persist.taskStore !== null, '默认创建任务板 store')
  assert.ok(runtime.snapshot().persist.eventStore !== null, '默认创建事件 store')
  runtime.getInstances().taskBoard.create({ activity: 'chat', kind: 'chat.turn', key: 'j4-default-task' })
  assert.equal(existsSync(paths.taskBoardFile), true, '默认写任务板快照')
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })

  // 显式 off → 零写盘
  const offDir = tmpDir('j4-off')
  const offPaths = {
    taskBoardFile: path.join(offDir, 'hub-taskboard.json'),
    eventFile: path.join(offDir, 'hub-events.jsonl'),
  }
  const off = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { persist: false },
    persistPaths: offPaths,
    now: () => 1000,
  })
  assert.equal(off.snapshot().persist.enabled, false)
  off.getInstances().taskBoard.create({ activity: 'chat', key: 'j4-off-task' })
  off.dispose()
  assert.equal(existsSync(offPaths.taskBoardFile), false, '显式 off 不写任务板文件')
  assert.equal(existsSync(offPaths.eventFile), false, '显式 off 不写事件文件')
  rmSync(offDir, { recursive: true, force: true })
})

test('hub-runtime J4：默认 persist 重启恢复任务/事件 + 坏文件降级', async () => {
  const dir = tmpDir('j4-restore')
  const paths = { taskBoardFile: path.join(dir, 'hub-taskboard.json'), eventFile: path.join(dir, 'hub-events.jsonl') }
  const first = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    persistPaths: paths,
    now: () => 1000,
  })
  first.start()
  first.getInstances().taskBoard.create({ activity: 'chat', kind: 'chat.turn', key: 'j4-restore-task' })
  await first.getInstances().eventBus.flush()
  first.dispose()
  assert.equal(existsSync(paths.taskBoardFile), true)
  assert.equal(existsSync(paths.eventFile), true)
  const second = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    persistPaths: paths,
    persistReplay: 5,
    now: () => 2000,
  })
  second.start()
  assert.equal(second.snapshot().persist.restoredTasks >= 1, true, '默认 persist 重启恢复任务')
  assert.equal(second.snapshot().persist.restoredEvents >= 1, true, '默认 persist 回放视图有事件')
  assert.ok(
    second
      .getInstances()
      .taskBoard.list()
      .some((task) => task.key === 'j4-restore-task'),
  )
  second.dispose()
  // 坏文件降级：不阻塞创建/启动
  writeFileSync(paths.taskBoardFile, '{bad json')
  writeFileSync(paths.eventFile, 'not-json\n{"type":"ok"}\n')
  const third = createHubRuntime({ logger: { warn() {} }, persistPaths: paths, now: () => 3000 })
  third.start()
  assert.equal(third.snapshot().ok, true, '坏文件不阻塞启动')
  assert.equal(third.snapshot().persist.taskStore.errors >= 0, true)
  third.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime I1：开启 persist 后重启恢复任务与事件', async () => {
  const dir = tmpDir('i1-on')
  const paths = { taskBoardFile: path.join(dir, 'hub-taskboard.json'), eventFile: path.join(dir, 'hub-events.jsonl') }
  const first = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true, persist: true },
    persistPaths: paths,
    now: () => 1000,
  })
  first.start()
  assert.equal(first.snapshot().persist.enabled, true)
  const created = first.getInstances().taskBoard.create({ activity: 'chat', key: 'i1-task-1' })
  assert.equal(created.ok, true)
  await first.getInstances().eventBus.flush()
  const firstPersist = first.snapshot().persist
  assert.equal(firstPersist.taskStore.saves >= 1, true, '任务板状态变化保存')
  assert.equal(firstPersist.eventStore.appends >= 1, true, '事件追加到 JSONL')
  first.dispose()
  assert.equal(existsSync(paths.taskBoardFile), true, '任务板快照已写盘')
  assert.equal(existsSync(paths.eventFile), true, '事件 JSONL 已写盘')

  const second = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true, persist: true },
    persistPaths: paths,
    persistReplay: 10,
    now: () => 2000,
  })
  second.start()
  const restored = second.snapshot().persist
  assert.equal(restored.enabled, true)
  assert.equal(restored.restoredTasks >= 1, true, '重启恢复任务数')
  assert.equal(restored.restoredEvents >= 1, true, '启动可选回放最近 N 条')
  assert.equal(restored.taskStore.bytes > 0, true)
  assert.equal(restored.eventStore.bytes > 0, true)
  const tasks = second.getInstances().taskBoard.list()
  assert.ok(
    tasks.some((task) => task.key === 'i1-task-1'),
    '恢复的任务仍在任务板',
  )
  const persistedEvents = second.readPersistedEvents(10)
  assert.equal(persistedEvents.enabled, true)
  assert.ok(persistedEvents.events.some((event) => event.type === 'task.created'))
  second.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime I1：持久化失败隔离（store 抛错不影响 Hub/任务板）', async () => {
  const failingTaskStore = {
    file: '/tmp/failing-taskboard.json',
    load() {
      throw new Error('load boom')
    },
    save() {
      throw new Error('save boom')
    },
    snapshot: () => ({ ok: true, errors: 1 }),
  }
  const failingEventStore = {
    file: '/tmp/failing-events.jsonl',
    append() {
      throw new Error('append boom')
    },
    readTail: () => ({ ok: true, events: [] }),
    snapshot: () => ({ ok: true, errors: 1 }),
  }
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true, persist: true },
    taskStore: failingTaskStore,
    eventStore: failingEventStore,
    now: () => 1000,
  })
  runtime.start()
  assert.equal(runtime.snapshot().ok, true, 'Hub 不崩')
  const created = runtime.getInstances().taskBoard.create({ activity: 'chat', key: 'i1-fail-task' })
  assert.equal(created.ok, true, '任务板仍可用')
  await runtime.getInstances().eventBus.flush()
  assert.equal(runtime.getInstances().eventBus.snapshot().metrics.storeErrors >= 1, true, '事件 store 失败被计数隔离')
  runtime.dispose()
  // 持久化组合 helper 默认关闭
  const disabled = createHubPersistence({ enabled: false })
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.taskStore, null)
  assert.equal(disabled.eventStore, null)
})

// ---------------------------------------------------------------------------
// Gate I3：Hub 全量任务列表（runtime snapshot.taskList + GET tasks.list）
// ---------------------------------------------------------------------------

test('hub-runtime I3：snapshot.taskList 全量任务（≤100，含摘要字段）', () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    now: () => 1000,
  })
  const board = runtime.getInstances().taskBoard
  for (let index = 0; index < 5; index += 1) {
    board.create({
      activity: 'chat',
      kind: 'chat.turn',
      key: 'i3-task-' + index,
      priority: index,
      payload: { peerId: 'p', messageId: 'm', text: 'hi' },
    })
  }
  const snapshot = runtime.snapshot()
  assert.equal(Array.isArray(snapshot.taskList), true)
  assert.equal(snapshot.taskList.length, 5)
  const first = snapshot.taskList[0]
  for (const field of ['id', 'kind', 'activity', 'status', 'priority', 'createdAt', 'updatedAt', 'payload']) {
    assert.ok(field in first, 'taskList 含 ' + field)
  }
  assert.deepEqual(first.payload.sort(), ['messageId', 'peerId', 'text'])
  // 超过 100 条只取前 100
  const big = createHubRuntime({ logger: { warn() {} }, featureFlag: { enabled: true, shadow: true }, now: () => 1000 })
  const bigBoard = big.getInstances().taskBoard
  for (let index = 0; index < 120; index += 1)
    bigBoard.create({ activity: 'chat', kind: 'chat.turn', key: 'big-' + index })
  assert.equal(big.snapshot().taskList.length, 100, 'limit 100')
  // 无 taskBoard → 空数组
  const bare = createHubRuntime({ assembleHub: false, logger: { warn() {} } })
  assert.deepEqual(bare.snapshot().taskList, [])
  runtime.dispose()
  big.dispose()
  bare.dispose()
})

test('hub-routes I3：GET hub.json tasks 契约（{ok,total,active,byStatus,list} + 兼容字段）', async () => {
  const dir = tmpDir('i3-hub')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    now: () => 1000,
  })
  runtime.start()
  setActiveHubRuntime(runtime)
  const board = runtime.getInstances().taskBoard
  board.create({ activity: 'chat', kind: 'chat.turn', key: 'i3-a', priority: 5 })
  board.create({ activity: 'chat', kind: 'chat.turn', key: 'i3-b' })
  const handler = createHubHandler({ tokenFile, fence: { check: () => null }, hubRuntime: runtime })
  const res = hubFakeRes()
  await handler(hubFakeReq('GET', undefined, { url: HUB_ROUTE }), res)
  assert.equal(res.statusCode, 200)
  const payload = res.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.available, true)
  assert.equal(Array.isArray(payload.tasks.list), true)
  assert.equal(payload.tasks.list.length, 2, '顶层 tasks.list 为全量列表')
  assert.equal(payload.tasks.ok, true)
  assert.equal(payload.tasks.total, 2)
  assert.equal(typeof payload.tasks.active, 'number')
  assert.equal(typeof payload.tasks.byStatus, 'object')
  // 兼容字段保留
  assert.equal(Array.isArray(payload.tasks.recentEvents), true)
  assert.ok(payload.tasks.metrics !== undefined || payload.tasks.supervisor !== undefined, '兼容任务板快照字段仍在')
  assert.equal(
    payload.tasks.list.some((task) => task.key === 'i3-a'),
    true,
  )
  runtime.dispose()
  setActiveHubRuntime(null)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes I3：无 runtime taskList 时降级为空数组（不崩）', async () => {
  const dir = tmpDir('i3-hub-bare')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const fakeRuntime = {
    mode: () => 'off',
    getInstances: () => ({
      taskBoard: { snapshot: () => ({ ok: true, total: 0, active: 0, byStatus: {}, recentEvents: [] }) },
    }),
    snapshot: () => ({ ok: true, assembled: false }),
    health: () => ({ ok: true }),
    memorySnapshot: () => ({ available: false }),
  }
  const handler = createHubHandler({ tokenFile, fence: { check: () => null }, hubRuntime: fakeRuntime })
  const res = hubFakeRes()
  await handler(hubFakeReq('GET', undefined, { url: HUB_ROUTE }), res)
  const payload = res.json()
  assert.equal(payload.tasks.list.length, 0)
  assert.equal(payload.tasks.total, 0)
  assert.equal(payload.tasks.ok, true)
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate I4：journal / methods 写入桥（onRecord + memoryWrite Gateway 双写）
// ---------------------------------------------------------------------------

test('memory-journal I4：onRecord 仅在成功追加后调用，旧写入不变', async () => {
  const withHookDir = tmpDir('i4-journal-hook')
  const plainDir = tmpDir('i4-journal-plain')
  const recorded = []
  const withHook = createMemoryJournal({
    dir: withHookDir,
    logger: { warn() {} },
    now: () => 1000,
    onRecord: (record) => recorded.push(record),
  })
  const plain = createMemoryJournal({ dir: plainDir, logger: { warn() {} }, now: () => 1000 })
  const first = await withHook.append({ kind: 'murmur', text: '今天的风很轻' })
  const baseline = await plain.append({ kind: 'murmur', text: '今天的风很轻' })
  assert.equal(first.ok, true)
  assert.equal(baseline.ok, true)
  assert.equal(first.ts, baseline.ts)
  assert.deepEqual(recorded, [{ ts: 1000, kind: 'murmur', text: '今天的风很轻' }], '成功后通知 onRecord')
  assert.equal(
    readFileSync(path.join(withHookDir, 'journal.jsonl'), 'utf8'),
    readFileSync(path.join(plainDir, 'journal.jsonl'), 'utf8'),
    'jsonl 与无回调一致',
  )
  assert.equal(
    readFileSync(path.join(withHookDir, 'journal.md'), 'utf8'),
    readFileSync(path.join(plainDir, 'journal.md'), 'utf8'),
    'md 与无回调一致',
  )
  // 限频跳过 → 不通知
  const throttled = await withHook.append({ kind: 'murmur', text: '另一句' })
  assert.equal(throttled.skipped, true)
  assert.equal(recorded.length, 1, '限频跳过不通知')
  // 无效 entry → 不通知
  const invalid = await withHook.append({ kind: 'murmur', text: '' })
  assert.equal(invalid.ok, false)
  assert.equal(recorded.length, 1)
  rmSync(withHookDir, { recursive: true, force: true })
  rmSync(plainDir, { recursive: true, force: true })
})

test('memory-journal I4：onRecord 抛错隔离（append 仍成功写盘）', async () => {
  const dir = tmpDir('i4-journal-throw')
  const journal = createMemoryJournal({
    dir,
    logger: { warn() {} },
    now: () => 1000,
    onRecord: () => {
      throw new Error('bridge boom')
    },
  })
  const result = await journal.append({ kind: 'thought', text: '回调抛错也要写进去' })
  assert.equal(result.ok, true)
  assert.match(readFileSync(path.join(dir, 'journal.jsonl'), 'utf8'), /回调抛错也要写进去/)
  rmSync(dir, { recursive: true, force: true })
})

test('method-memory I4：onRecord 记录成功后调用，旧写入不变', () => {
  const dir = tmpDir('i4-method')
  const file = path.join(dir, 'methods.json')
  const recorded = []
  const memory = createMethodMemory({ file, now: () => 1000, onRecord: (entry) => recorded.push(entry) })
  assert.equal(memory.record({ name: '先看日志', howTo: '出错时先看 stderr 再猜原因', source: 'lessons' }), true)
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].name, '先看日志')
  assert.equal(recorded[0].howTo, '出错时先看 stderr 再猜原因')
  assert.equal(recorded[0].usedCount, 1)
  assert.equal(recorded[0].lastAt, 1000)
  // 同名再记 → usedCount 增加且再次通知
  assert.equal(memory.record({ name: '先看日志', howTo: '出错时先看 stderr 再猜原因', worked: true }), true)
  assert.equal(recorded.length, 2)
  assert.equal(recorded[1].usedCount, 2)
  // 无效输入 → 不通知
  assert.equal(memory.record({ name: 'x', howTo: '' }), false)
  assert.equal(recorded.length, 2)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).entries.length, 1)
  // 回调抛错 → 旧写盘仍成功
  const throwFile = path.join(dir, 'methods-throw.json')
  const throwing = createMethodMemory({
    file: throwFile,
    now: () => 1000,
    onRecord: () => {
      throw new Error('boom')
    },
  })
  assert.equal(throwing.record({ name: '记一条', howTo: '应该仍然写进去' }), true)
  assert.equal(JSON.parse(readFileSync(throwFile, 'utf8')).entries.length, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime I4：memoryWrite 关闭时 recordJournal/recordMethod skipped（零 Gateway 写入）', async () => {
  const writes = []
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: false, shadow: true, memoryWrite: false },
    memoryGateway: {
      registerProvider: () => ({ ok: true }),
      write: (entry) => {
        writes.push(entry)
        return { ok: true }
      },
      snapshot: () => ({ metrics: { writes: writes.length }, conflicts: 0 }),
    },
    now: () => 1000,
  })
  const journal = await runtime.recordJournal({ kind: 'murmur', text: '不写网关', ts: 1000 })
  const method = await runtime.recordMethod({ name: '方法', howTo: '做法', lastAt: 1000 })
  assert.equal(journal.skipped, true)
  assert.equal(method.skipped, true)
  assert.equal(writes.length, 0)
  assert.equal(runtime.snapshot().memory.write, false)
  runtime.dispose()
})

test('hub-runtime I4：memoryWrite 开启后 journal/method 条目进 Gateway（映射 category/source）', async () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    env: { DSH_POETRY_MEMORY_WRITE: 'gateway' },
    now: () => 1000,
  })
  const journal = await runtime.recordJournal({ kind: 'murmur', text: '今天的风很轻', ts: 1000 })
  const mood = await runtime.recordJournal({ kind: 'mood', label: '平静', reason: '散步', ts: 1001 })
  const method = await runtime.recordMethod({ name: '先看日志', howTo: '出错先看 stderr', lastAt: 1002, usedCount: 3 })
  assert.equal(journal.ok, true)
  assert.equal(journal.entry.category, 'episodic')
  assert.equal(journal.entry.topic, 'journal:murmur')
  assert.equal(journal.entry.source.kind, 'journal')
  assert.equal(journal.entry.provenance.at, 1000)
  assert.equal(mood.entry.category, 'reflection', 'mood 映射 reflection')
  assert.equal(method.ok, true)
  assert.equal(method.entry.category, 'method')
  assert.equal(method.entry.topic, 'method:先看日志')
  assert.equal(method.entry.source.kind, 'method-memory')
  assert.match(method.entry.text, /先看日志：出错先看 stderr/)
  assert.equal(method.entry.category, 'method')
  assert.equal(runtime.memorySnapshot().metrics.writes >= 3, true)
  // 非法输入被拒绝
  assert.equal((await runtime.recordJournal({ kind: 'murmur', text: '' })).code, 'HUB_MEMORY_INVALID_ENTRY')
  assert.equal((await runtime.recordMethod({ name: '' })).code, 'HUB_MEMORY_INVALID_ENTRY')
  runtime.dispose()
})

test('hub-runtime I4：Gateway 失败不影响 journal/method 旧路径', async () => {
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: false, shadow: true, memoryWrite: true },
    memoryGateway: {
      registerProvider: () => ({ ok: true }),
      write: () => {
        throw new Error('gateway down')
      },
      snapshot: () => ({ metrics: {}, conflicts: 0 }),
    },
    now: () => 1000,
  })
  const journalResult = await runtime.recordJournal({ kind: 'murmur', text: '网关失败', ts: 1000 })
  const methodResult = await runtime.recordMethod({ name: '方法', howTo: '做法', lastAt: 1000 })
  assert.equal(journalResult.ok, false)
  assert.equal(journalResult.code, 'HUB_MEMORY_WRITE_FAILED')
  assert.equal(methodResult.ok, false)
  assert.equal(runtime.snapshot().ok, true, 'Hub 不崩')
  // 旧路径：journal/method 照常写盘（onRecord 抛错/失败被吞）
  const dir = tmpDir('i4-isolation')
  const journal = createMemoryJournal({
    dir,
    logger: { warn() {} },
    now: () => 1000,
    onRecord: (record) => {
      runtime.recordJournal(record).catch(() => {})
    },
  })
  const appended = await journal.append({ kind: 'thought', text: '旧路径仍然成功' })
  assert.equal(appended.ok, true)
  assert.match(readFileSync(path.join(dir, 'journal.jsonl'), 'utf8'), /旧路径仍然成功/)
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate J2：Chat 所有权切换到 Hub（full 接管，off/shadow 旧路径）
// ---------------------------------------------------------------------------

function makeJ2ChatFixture(options = {}) {
  const dir = tmpDir('j2-chat')
  const adapterCalls = []
  const bridgeCalls = []
  const fakeAdapter = {
    manifest: CHAT_MANIFEST_RAW,
    execute: async (task) => {
      adapterCalls.push(task)
      if (options.adapterThrows) throw new Error('adapter boom')
      return { ok: true, receipt: { ok: true, at: 1000, text: 'hub reply', taskKey: task.key } }
    },
  }
  let runtime = null
  const runner = createChatTurnRunner(() => runtime)
  runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: options.featureFlag ?? { enabled: true, shadow: false },
    activityManifests: options.noAdapter ? [] : [fakeAdapter],
    chatTurnRunner: (input) => runner(input),
    now: () => 1000,
  })
  runtime.start()
  const deps = {
    hubRuntime: runtime,
    chatTakeover: options.chatTakeover,
    logger: { warn() {} },
    chatBridge: {
      async chat(payload) {
        bridgeCalls.push(payload)
        return { ok: true, reply: 'old bridge reply', felt: '平静', murmur: '' }
      },
      drainPending: () => [],
    },
    knowledgeGraph: { digest: () => [], spread: () => [] },
    relationship: { ingest: async () => ({ entries: [] }) },
    emotional: { recordFromChat: () => {} },
    memoryDir: dir,
    focus: options.focus,
    world: options.world,
  }
  const service = createChatHttpService(deps)
  return { service, deps, runtime, runner, adapterCalls, bridgeCalls, dir }
}

test('chat J2：full 模式由 Hub 接管（旧 chatBridge 0 次，receipt 返回）', async () => {
  const fixture = makeJ2ChatFixture()
  const result = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-1' })
  assert.equal(result.ok, true)
  assert.equal(result.reply, 'hub reply')
  assert.equal(result.source, 'hub')
  assert.ok(result.receipt !== null && result.receipt.ok === true, '返回 Hub receipt')
  assert.ok(typeof result.taskId === 'string' && result.taskId.length > 0)
  assert.equal(fixture.bridgeCalls.length, 0, '旧 chatBridge 路径停用（0 次）')
  assert.equal(fixture.adapterCalls.length, 1, 'Hub chat adapter 执行一次')
  const board = fixture.runtime.getInstances().taskBoard
  const task = board.get(result.taskId)
  assert.equal(task.status, 'done')
  assert.equal(task.kind, 'chat.turn')
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J2：off/shadow 完全走旧路径（bridge 1 次、Hub adapter 0 次）', async () => {
  for (const featureFlag of [
    { enabled: false, shadow: true },
    { enabled: true, shadow: true },
  ]) {
    const fixture = makeJ2ChatFixture({ featureFlag })
    const result = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-1' })
    assert.equal(result.ok, true)
    assert.equal(result.reply, 'old bridge reply')
    assert.equal(fixture.bridgeCalls.length, 1, '旧路径调用一次')
    assert.equal(fixture.adapterCalls.length, 0, 'Hub 不执行')
    fixture.runtime.dispose()
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('chat J2：full 下 Hub 失败不回退旧路径、不双重回复', async () => {
  const fixture = makeJ2ChatFixture({ adapterThrows: true })
  const result = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-1' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'HUB_CHAT_FAILED')
  assert.equal(fixture.bridgeCalls.length, 0, '失败也不回退旧 chatBridge')
  assert.equal(fixture.adapterCalls.length, 1, '只尝试一次，不重复回复')
  const board = fixture.runtime.getInstances().taskBoard
  assert.equal(
    board.list().some((task) => task.status === 'failed'),
    true,
    '任务标记 failed',
  )
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J2：同 messageId 幂等（只执行/回复一次）', async () => {
  const fixture = makeJ2ChatFixture()
  const first = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-dup' })
  const second = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-dup' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(second.reply, first.reply)
  assert.equal(fixture.adapterCalls.length, 1, '同 messageId 只执行一次')
  assert.equal(second.duplicate, true, '第二次返回缓存 receipt')
  assert.equal(fixture.bridgeCalls.length, 0)
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J2：focus/deferred canned reply 也由 Hub receipt 返回', async () => {
  const deferred = []
  const fixture = makeJ2ChatFixture({
    focus: {
      get: () => ({ active: true, mode: 'game' }),
      defer: (item) => deferred.push(item),
      drainDeferred: () => [],
    },
    world: { interrupt: () => {} },
  })
  const result = await fixture.service.chat({ text: '在吗', peerId: 'peer-1', messageId: 'm-focus' })
  assert.equal(result.ok, true)
  assert.equal(result.deferred, true)
  assert.match(result.reply, /我在游戏里/)
  assert.ok(result.receipt !== null && result.receipt.deferred === true, 'canned reply 以 Hub receipt 返回')
  assert.equal(deferred.length, 1, 'focus.defer 语义保留')
  assert.equal(fixture.adapterCalls.length, 0, 'deferred 不跑模型')
  assert.equal(fixture.bridgeCalls.length, 0)
  const board = fixture.runtime.getInstances().taskBoard
  const task = board.get(result.taskId)
  assert.equal(task.status, 'done')
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J2：chatTakeover=false 时 full 仍走旧路径（可回退）', async () => {
  const fixture = makeJ2ChatFixture({ chatTakeover: false })
  const result = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-1' })
  assert.equal(result.ok, true)
  assert.equal(result.reply, 'old bridge reply')
  assert.equal(fixture.bridgeCalls.length, 1)
  assert.equal(fixture.adapterCalls.length, 0)
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J2：runner 边界（非 full/空消息/未注入）', async () => {
  const offRuntime = createHubRuntime({ logger: { warn() {} }, featureFlag: { enabled: false, shadow: true } })
  const offRunner = createChatTurnRunner(offRuntime)
  assert.equal((await offRunner({ text: '你好', peerId: 'p', messageId: 'm' })).code, 'HUB_FULL_REQUIRED')
  const bare = createHubRuntime({ logger: { warn() {} }, featureFlag: { enabled: true, shadow: false } })
  assert.equal((await bare.runChatTurn({ text: '你好', peerId: 'p', messageId: 'm' })).code, 'HUB_CHAT_UNAVAILABLE')
  const full = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: false },
    activityManifests: [],
  })
  full.start()
  const runner = createChatTurnRunner(full)
  assert.equal((await runner({ text: '   ', peerId: 'p', messageId: 'm' })).code, 'HUB_CHAT_EMPTY')
  assert.equal((await runner({ text: '你好', peerId: 'p', messageId: 'm' })).code, 'HUB_NO_ACTIVITY_ADAPTER')
  offRuntime.dispose()
  bare.dispose()
  full.dispose()
})

// ---------------------------------------------------------------------------
// Gate J3：Minecraft 任务队列（claim/lease/receipt，Hub 驱动 bot）
// ---------------------------------------------------------------------------

test('minecraft-queue J3：create/claim 优先级/租约/完成/幂等/容量', () => {
  const clock = 1000
  const queue = createMinecraftTaskQueue({ now: () => clock, leaseMs: 5000, maxTasks: 2 })
  assert.equal(queue.snapshot().version, MINECRAFT_TASK_QUEUE_VERSION)
  assert.equal(queue.create({ taskId: 't-low', tool: 'mc_say', arguments: { text: 'a' }, priority: 1 }).ok, true)
  assert.equal(queue.create({ taskId: 't-high', tool: 'mc_move_to', arguments: { x: 1, z: 2 }, priority: 9 }).ok, true)
  assert.equal(
    queue.create({ taskId: 't-extra', tool: 'mc_wait' }).code,
    MINECRAFT_TASK_QUEUE_CODES.queueFull,
    '容量上限',
  )
  assert.equal(queue.create({ taskId: 't-low', tool: 'mc_say' }).duplicate, true, '同 taskId 幂等')
  assert.equal(queue.create({ tool: 'mc_say' }).code, MINECRAFT_TASK_QUEUE_CODES.invalid)
  const claimed = queue.claim({ owner: 'bot-1', leaseMs: 5000 })
  assert.equal(claimed.ok, true)
  assert.equal(claimed.task.taskId, 't-high', '高优先级先出')
  assert.equal(claimed.task.status, 'running')
  assert.equal(claimed.task.owner, 'bot-1')
  assert.equal(claimed.task.leaseUntil, 6000)
  const done = queue.complete('t-high', { ok: true, detail: '到达', facts: { position: '1,2,3' } })
  assert.equal(done.ok, true)
  assert.equal(done.task.status, 'done')
  assert.equal(done.task.receipt.ok, true)
  assert.equal(queue.complete('t-high', { ok: true }).already, true, '重复回执幂等')
  const failed = queue.fail('t-low', { message: '打不开门' })
  assert.equal(failed.task.status, 'failed')
  assert.equal(queue.get('t-extra'), null)
  assert.deepEqual(queue.snapshot().counts, { queued: 0, running: 0, done: 1, failed: 1, cancelled: 0 })
  assert.equal(queue.snapshot().metrics.claimed, 1)
})

test('minecraft-queue J3：租约过期回收 + 最大尝试后失败 + onExpired 回调', () => {
  let clock = 1000
  const expired = []
  const queue = createMinecraftTaskQueue({
    now: () => clock,
    leaseMs: 1000,
    maxAttempts: 2,
    onExpired: (task) => expired.push(task),
  })
  queue.create({ taskId: 't-timeout', tool: 'mc_wait', arguments: { seconds: 3 } })
  const first = queue.claim({ owner: 'bot' })
  assert.equal(first.task.attempts, 1)
  clock = 1500
  assert.equal(queue.claim({ owner: 'bot' }).task, null, '租约未过期不重复认领')
  clock = 3000
  const second = queue.claim({ owner: 'bot' })
  assert.equal(second.task.taskId, 't-timeout')
  assert.equal(second.task.attempts, 2)
  clock = 5000
  const third = queue.claim({ owner: 'bot' })
  assert.equal(third.task, null, '超过最大尝试后不再认领')
  assert.equal(queue.get('t-timeout').status, 'failed')
  assert.equal(queue.get('t-timeout').error.code, 'MINECRAFT_TASK_TIMEOUT')
  assert.equal(expired.length, 1, '超时失败触发 onExpired（供 host 失败任务板任务）')
  assert.equal(queue.snapshot().metrics.expired, 2)
})

test('minecraft-task-routes J3：鉴权/action/claim/receipt/status', async () => {
  const dir = tmpDir('j3-routes')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const clock = 1000
  const queue = createMinecraftTaskQueue({ now: () => clock, leaseMs: 5000 })
  const handler = createMinecraftTaskHandler({
    queue,
    tokenFile,
    fence: { check: () => 'blocked' },
    logger: { warn() {} },
  })
  const denied = hubFakeRes()
  await handler(hubFakeReq('POST', { token: 'bad', action: 'status' }, { url: MINECRAFT_TASKS_ROUTE }), denied)
  assert.equal(denied.statusCode, 403)
  const getRes = hubFakeRes()
  await handler(hubFakeReq('GET', undefined, { url: MINECRAFT_TASKS_ROUTE }), getRes)
  assert.equal(getRes.statusCode, 405)
  const unknown = hubFakeRes()
  await handler(hubFakeReq('POST', { token: 'secret-token', action: 'nope' }, { url: MINECRAFT_TASKS_ROUTE }), unknown)
  assert.equal(unknown.statusCode, 400)
  assert.deepEqual(unknown.json().actions, MINECRAFT_TASK_ACTIONS.slice())
  // 入队 + claim
  queue.create({ taskId: 'tb-mc-1', tool: 'mc_say', arguments: { text: 'hi' }, priority: 5 })
  const claimRes = hubFakeRes()
  await handler(
    hubFakeReq(
      'POST',
      { token: 'secret-token', action: 'claim', owner: 'bot-test', leaseMs: 5000 },
      { url: MINECRAFT_TASKS_ROUTE },
    ),
    claimRes,
  )
  const claim = claimRes.json()
  assert.equal(claim.ok, true)
  assert.equal(claim.task.taskId, 'tb-mc-1')
  assert.equal(claim.task.tool, 'mc_say')
  assert.equal(claim.task.owner, 'bot-test')
  // receipt
  const receiptRes = hubFakeRes()
  await handler(
    hubFakeReq(
      'POST',
      {
        token: 'secret-token',
        action: 'receipt',
        taskId: 'tb-mc-1',
        ok: true,
        detail: '说了 hi',
        facts: { position: '1,2,3' },
      },
      { url: MINECRAFT_TASKS_ROUTE },
    ),
    receiptRes,
  )
  const receipt = receiptRes.json()
  assert.equal(receipt.ok, true)
  assert.equal(receipt.task.status, 'done')
  assert.equal(receipt.task.receipt.detail, '说了 hi')
  assert.equal(queue.get('tb-mc-1').status, 'done')
  // status
  const statusRes = hubFakeRes()
  await handler(
    hubFakeReq('POST', { token: 'secret-token', action: 'status' }, { url: MINECRAFT_TASKS_ROUTE }),
    statusRes,
  )
  assert.equal(statusRes.json().counts.done, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes J3：full 的 minecraft 任务入队并保持 waiting，receipt 闭环（adapter 0 次）', async () => {
  const dir = tmpDir('j3-hub')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const adapterCalls = []
  let runtime = null
  runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: false },
    activityManifests: [
      {
        manifest: MINECRAFT_MANIFEST_RAW,
        execute: async (task) => {
          adapterCalls.push(task)
          return { ok: true, receipt: { ok: true, at: 1000, detail: '不该执行' } }
        },
      },
    ],
    now: () => 1000,
  })
  runtime.start()
  const queue = createMinecraftTaskQueue({ now: () => 1000 })
  const hubHandler = createHubHandler({
    tokenFile,
    fence: { check: () => null },
    hubRuntime: runtime,
    minecraftQueue: queue,
  })
  const res = hubFakeRes()
  await hubHandler(
    hubFakeReq(
      'POST',
      {
        action: 'task.create',
        kind: 'minecraft.build',
        activity: 'minecraft',
        payload: { tool: 'mc_say', arguments: { text: 'hi' } },
        idempotencyKey: 'j3-mc-1',
      },
      { url: HUB_ROUTE },
    ),
    res,
  )
  const body = res.json()
  assert.equal(body.ok, true)
  assert.equal(body.queued, true, 'full minecraft 任务入队')
  assert.equal(body.executed, false)
  assert.equal(adapterCalls.length, 0, '不立即执行 adapter')
  const board = runtime.getInstances().taskBoard
  const task = board.get(body.task.id)
  assert.equal(task.status, 'waiting', '任务板保持 waiting')
  assert.equal(queue.get(task.id).tool, 'mc_say')
  // bot claim + receipt 闭环
  const mcHandler = createMinecraftTaskHandler({
    queue,
    tokenFile,
    fence: { check: () => 'blocked' },
    getHubRuntime: () => runtime,
    logger: { warn() {} },
  })
  const claimRes = hubFakeRes()
  await mcHandler(
    hubFakeReq('POST', { token: 'secret-token', action: 'claim', owner: 'bot' }, { url: MINECRAFT_TASKS_ROUTE }),
    claimRes,
  )
  assert.equal(claimRes.json().task.taskId, task.id)
  const receiptRes = hubFakeRes()
  await mcHandler(
    hubFakeReq(
      'POST',
      {
        token: 'secret-token',
        action: 'receipt',
        taskId: task.id,
        ok: true,
        detail: '完成',
        facts: { position: '1,2,3' },
      },
      { url: MINECRAFT_TASKS_ROUTE },
    ),
    receiptRes,
  )
  assert.equal(receiptRes.json().hub.taskId, task.id)
  assert.equal(board.get(task.id).status, 'done', '任务板由 receipt 完成')
  const ledger = runtime.getInstances().feedbackLedger.snapshot()
  assert.ok(ledger.records >= 1, 'feedback 账本写入')
  assert.equal(adapterCalls.length, 0)
  // GET 快照含 minecraftTasks
  const getRes = hubFakeRes()
  await hubHandler(hubFakeReq('GET', undefined, { url: HUB_ROUTE }), getRes)
  assert.equal(getRes.json().minecraftTasks.counts.done, 1)
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('hub-routes J3：off/shadow 的 minecraft 任务仍走原 adapter 路径（行为不变）', async () => {
  const dir = tmpDir('j3-shadow')
  const tokenFile = path.join(dir, 'chat-token')
  writeFileSync(tokenFile, 'secret-token')
  const adapterCalls = []
  const runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: { enabled: true, shadow: true },
    activityManifests: [
      {
        manifest: MINECRAFT_MANIFEST_RAW,
        execute: async (task) => {
          adapterCalls.push(task)
          return { ok: true, receipt: { ok: true, at: 1000, detail: 'shadow 执行' } }
        },
      },
    ],
    now: () => 1000,
  })
  runtime.start()
  const queue = createMinecraftTaskQueue({ now: () => 1000 })
  const hubHandler = createHubHandler({
    tokenFile,
    fence: { check: () => null },
    hubRuntime: runtime,
    minecraftQueue: queue,
  })
  const res = hubFakeRes()
  await hubHandler(
    hubFakeReq(
      'POST',
      { action: 'task.create', kind: 'minecraft.build', activity: 'minecraft', payload: { tool: 'mc_say' } },
      { url: HUB_ROUTE },
    ),
    res,
  )
  assert.equal(res.json().ok, false, 'shadow 不执行真实任务（HUB_FULL_REQUIRED）')
  assert.equal(adapterCalls.length, 0)
  assert.equal(queue.snapshot().total, 0, 'shadow 不入队')
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Gate J5：Chat 上下文等价（full 接管时 graphLines/relationship/emotion/... 经 Hub 透传）
// ---------------------------------------------------------------------------

function makeJ5ChatFixture(options = {}) {
  const dir = tmpDir('j5-chat')
  const adapterCalls = []
  const bridgeCalls = []
  const long = (prefix) => Array.from({ length: 20 }, (_, index) => prefix + index + 'x'.repeat(500))
  let runtime = null
  const fakeAdapter = {
    manifest: CHAT_MANIFEST_RAW,
    execute: async (task) => {
      adapterCalls.push(task)
      return { ok: true, receipt: { ok: true, at: 1000, text: 'hub reply', taskKey: task.key } }
    },
  }
  runtime = createHubRuntime({
    logger: { warn() {} },
    featureFlag: options.featureFlag ?? { enabled: true, shadow: false },
    activityManifests: [fakeAdapter],
    chatTurnRunner: (input) => createChatTurnRunner(() => runtime)(input),
    now: () => 1000,
  })
  runtime.start()
  const deps = {
    hubRuntime: runtime,
    chatTakeover: options.chatTakeover,
    logger: { warn() {} },
    chatBridge: {
      async chat(payload) {
        bridgeCalls.push(payload)
        return { ok: true, reply: 'old bridge reply', felt: '平静', murmur: '' }
      },
      drainPending: () => [],
    },
    knowledgeGraph: {
      digest: () => (options.huge ? long('graph') : ['图谱：她记得公园']),
      spread: () => (options.huge ? long('spread') : ['扩散：上次的约定']),
    },
    internalRules: { digest: () => ['规则：先听完'] },
    styleExemplars: { pick: () => ['例句：嗯，我在'] },
    relationship: { digest: () => ['关系：一起走过夜路'], ingest: async () => ({ entries: [] }) },
    emotional: { digest: () => ['情绪：平静'], recordFromChat: () => {} },
    dailyLife: { digest: () => ['日常：刚吃过饭'] },
    commitments: { digest: () => ['承诺：晚上聊'], addAgreement: () => {} },
    methodMemory: { digest: () => ['方法：先看日志'] },
    memoryDir: dir,
  }
  const service = createChatHttpService(deps)
  return { service, deps, runtime, adapterCalls, bridgeCalls, dir }
}

test('chat J5：full 接管时 adapter 收到完整上下文（与旧路径字段对齐）', async () => {
  const fixture = makeJ5ChatFixture()
  const result = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-j5' })
  assert.equal(result.ok, true)
  assert.equal(fixture.adapterCalls.length, 1)
  assert.equal(fixture.bridgeCalls.length, 0)
  const context = fixture.adapterCalls[0].payload.context
  assert.ok(context !== null && typeof context === 'object', 'task.payload.context 存在')
  assert.deepEqual(context.graphLines, ['图谱：她记得公园'])
  assert.deepEqual(context.spreadLines, ['扩散：上次的约定'])
  assert.deepEqual(context.moralLines, [])
  assert.deepEqual(context.rulesLines, ['规则：先听完'])
  assert.deepEqual(context.exemplars, ['例句：嗯，我在'])
  assert.deepEqual(context.relationshipLines, ['关系：一起走过夜路'])
  assert.deepEqual(context.emotionLines, ['情绪：平静'])
  assert.deepEqual(context.dailyLifeLines, ['日常：刚吃过饭'])
  assert.deepEqual(context.commitmentLines, ['承诺：晚上聊'])
  assert.deepEqual(context.methodLines, ['方法：先看日志'])
  assert.equal(context.imageContext, '')
  assert.equal(context.imageRequested, false)
  assert.equal(context.imageHint, null)
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J5：off/shadow 旧路径入参不变（上下文仍直接给 chatBridge）', async () => {
  const fixture = makeJ5ChatFixture({ featureFlag: { enabled: true, shadow: true } })
  const result = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-j5-old' })
  assert.equal(result.ok, true)
  assert.equal(fixture.adapterCalls.length, 0)
  assert.equal(fixture.bridgeCalls.length, 1)
  const payload = fixture.bridgeCalls[0]
  assert.deepEqual(payload.graphLines, ['图谱：她记得公园'])
  assert.deepEqual(payload.relationshipLines, ['关系：一起走过夜路'])
  assert.deepEqual(payload.emotionLines, ['情绪：平静'])
  assert.deepEqual(payload.methodLines, ['方法：先看日志'])
  assert.equal(payload.imageRequested, false)
  assert.equal(payload.imageHint, null)
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J5：上下文大小限制（数组 ≤8 条、字符串 ≤400）', async () => {
  const fixture = makeJ5ChatFixture({ huge: true })
  const result = await fixture.service.chat({ text: '你好', peerId: 'peer-1', messageId: 'm-j5-huge' })
  assert.equal(result.ok, true)
  const context = fixture.adapterCalls[0].payload.context
  for (const field of ['graphLines', 'spreadLines']) {
    assert.equal(context[field].length, 8, field + ' 最多 8 条')
    assert.equal(
      context[field].every((line) => line.length <= 400),
      true,
      field + ' 每条 ≤400 字符',
    )
  }
  fixture.runtime.dispose()
  rmSync(fixture.dir, { recursive: true, force: true })
})

test('chat J5：hub-routes chat adapter 从 task.payload.context 还原并传给 chatBridge（无 context 兼容）', async () => {
  const bridgeCalls = []
  const adapters = createRealActivityAdapters({
    chatBridgeProvider: () => ({
      async chat(payload) {
        bridgeCalls.push(payload)
        return { ok: true, reply: 'ok' }
      },
    }),
    now: () => 1000,
  })
  const chatAdapter = adapters.find((item) => item.manifest.id === 'chat')
  assert.ok(chatAdapter !== undefined)
  const task = {
    key: 'chat-turn:peer-1:m-ctx',
    payload: {
      peerId: 'peer-1',
      messageId: 'm-ctx',
      text: '你好',
      context: { graphLines: ['图谱'], imageContext: '图', imageRequested: true, imageHint: { name: 'a.png' } },
    },
  }
  const result = await chatAdapter.execute(task)
  assert.equal(result.ok, true)
  assert.equal(bridgeCalls.length, 1)
  assert.deepEqual(bridgeCalls[0].graphLines, ['图谱'])
  assert.equal(bridgeCalls[0].imageContext, '图')
  assert.equal(bridgeCalls[0].imageRequested, true)
  assert.deepEqual(bridgeCalls[0].imageHint, { name: 'a.png' })
  assert.equal(bridgeCalls[0].text, '你好')
  assert.equal(bridgeCalls[0].peerId, 'peer-1')
  // 无 context → 与旧行为一致（只传 text/peerId）
  const plain = await chatAdapter.execute({ key: 'k', payload: { peerId: 'p', messageId: 'm', text: 'hi' } })
  assert.equal(plain.ok, true)
  assert.deepEqual(bridgeCalls[1], { text: 'hi', peerId: 'p' })
})

// ---------------------------------------------------------------------------
// Gate K1：持久化 Memory Gateway provider（JSONL 文件，重启不丢）
// ---------------------------------------------------------------------------

test('file-memory-provider K1：append/load/upsert/query/坏行/有界加载', () => {
  const dir = tmpDir('k1-provider')
  const file = path.join(dir, 'memory-gateway.jsonl')
  const first = createFileMemoryProvider({ file, now: () => 1000 })
  assert.equal(first.id, 'file-memory')
  assert.equal(first.permissions.read, true)
  assert.equal(first.permissions.write, true)
  assert.equal(FILE_MEMORY_PROVIDER_VERSION, 1)
  assert.equal(DEFAULT_FILE_MEMORY_MAX_BYTES > 0, true)
  const base = {
    category: 'episodic',
    source: { kind: 'journal' },
    provenance: { activity: 'journal' },
    confidence: 0.6,
  }
  assert.equal(first.write({ ...base, id: 'm1', text: '今天在公园走了很久' }).ok, true)
  assert.equal(first.write({ ...base, id: 'm2', text: '晚上一起吃饭', category: 'relationship' }).ok, true)
  // upsert：同 id 更新（文件追加新行，内存以最新为准）
  assert.equal(first.write({ ...base, id: 'm1', text: '今天在公园走了很久（补充）' }).ok, true)
  assert.equal(first.snapshot().entries, 2)
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 3, '每次写入追加一行')
  // 重启（新 provider 加载）→ 条目/upsert 生效
  const second = createFileMemoryProvider({ file, now: () => 2000 })
  assert.equal(second.snapshot().entries, 2)
  assert.equal(second.query({ text: '公园' }).length, 1)
  assert.match(second.query({ text: '公园' })[0].text, /补充/)
  assert.equal(second.query({ category: 'relationship' }).length, 1)
  assert.equal(second.query({ category: 'relationship', limit: 1 }).length, 1)
  assert.equal(second.query({ activity: 'journal' }).length, 2)
  // 坏行跳过
  writeFileSync(file, readFileSync(file, 'utf8') + 'not-json\n{"bad":true}\n')
  const third = createFileMemoryProvider({ file, now: () => 3000 })
  assert.equal(third.snapshot().entries, 2)
  assert.equal(third.snapshot().badLines >= 2, true)
  // 有界加载：maxEntries 只保留最近 N 条
  const manyFile = path.join(dir, 'many.jsonl')
  const many = createFileMemoryProvider({ file: manyFile, now: () => 1000 })
  for (let index = 0; index < 5; index += 1) many.write({ ...base, id: 'm-' + index, text: '条目 ' + index })
  const bounded = createFileMemoryProvider({ file: manyFile, maxEntries: 2, now: () => 2000 })
  assert.equal(bounded.snapshot().entries, 2, '有界加载最多 maxEntries')
  assert.deepEqual(
    bounded.query({}).map((entry) => entry.id),
    ['m-3', 'm-4'],
  )
  rmSync(dir, { recursive: true, force: true })
})

test('file-memory-provider K1：文件上限轮转 + 写失败隔离', () => {
  const dir = tmpDir('k1-rotate')
  const file = path.join(dir, 'memory-gateway.jsonl')
  const provider = createFileMemoryProvider({ file, maxBytes: 300, now: () => 1000, logger: { warn() {} } })
  for (let index = 0; index < 20; index += 1) {
    provider.write({ id: 'm-' + index, category: 'episodic', text: 'x'.repeat(60) + index })
  }
  assert.equal(provider.snapshot().rotations >= 1, true, '超过 maxBytes 轮转')
  assert.equal(existsSync(`${file}.1`), true)
  const reloaded = createFileMemoryProvider({ file, maxBytes: 300, now: () => 2000 })
  assert.equal(reloaded.snapshot().entries >= 1, true, '轮转后仍可加载')
  // 写失败隔离：file 指向目录 → write 返回 ok:false，不抛
  const badDir = path.join(dir, 'not-a-file')
  mkdirSync(badDir, { recursive: true })
  const bad = createFileMemoryProvider({ file: badDir, now: () => 1000, logger: { warn() {} } })
  const failed = bad.write({ id: 'x', category: 'episodic', text: '写不进去' })
  assert.equal(failed.ok, false)
  assert.equal(bad.snapshot().errors >= 1, true)
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime K1：memoryWrite 默认关闭零写盘（不创建 provider 文件）', async () => {
  const dir = tmpDir('k1-off')
  const file = path.join(dir, 'memory-gateway.jsonl')
  const runtime = createHubRuntime({ logger: { warn() {} }, memoryWriteFile: file, now: () => 1000 })
  assert.equal(runtime.snapshot().memory.write, false)
  const result = await runtime.recordJournal({ kind: 'murmur', text: '不该写盘', ts: 1000 })
  assert.equal(result.skipped, true)
  assert.equal(existsSync(file), false, '默认关闭零写盘')
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime K1：memoryWrite 开启后写入文件 provider，重启可查询', async () => {
  const dir = tmpDir('k1-on')
  const file = path.join(dir, 'memory-gateway.jsonl')
  const first = createHubRuntime({
    logger: { warn() {} },
    env: { DSH_POETRY_MEMORY_WRITE: 'gateway' },
    memoryWriteFile: file,
    now: () => 1000,
  })
  assert.equal(first.snapshot().memory.write, true)
  assert.ok(first.snapshot().memory.providers.indexOf('file-memory') >= 0, '使用文件 provider')
  const journal = await first.recordJournal({ kind: 'murmur', text: '今天的风很轻', ts: 1000 })
  const method = await first.recordMethod({ name: '先看日志', howTo: '出错先看 stderr', lastAt: 1000 })
  assert.equal(journal.ok, true)
  assert.equal(method.ok, true)
  first.dispose()
  assert.equal(existsSync(file), true, 'memoryWrite 开启后写盘')
  // 重启：新 runtime 加载同一文件 → queryMemory 能查到之前条目
  const second = createHubRuntime({
    logger: { warn() {} },
    env: { DSH_POETRY_MEMORY_WRITE: 'gateway' },
    memoryWriteFile: file,
    now: () => 2000,
  })
  const found = await second.queryMemory({ text: '风很轻', limit: 5 })
  assert.equal(found.ok, true)
  assert.equal(found.total >= 1, true, '重启后可查询之前双写条目')
  assert.equal(
    found.entries.some((entry) => /风很轻/.test(entry.text)),
    true,
  )
  const methodFound = await second.queryMemory({ text: '先看日志', limit: 5 })
  assert.equal(
    methodFound.entries.some((entry) => /先看日志/.test(entry.text)),
    true,
  )
  second.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('hub-runtime K1：文件 provider 写失败隔离（Hub/旧路径不崩）', async () => {
  const dir = tmpDir('k1-fail')
  const badPath = path.join(dir, 'not-a-file')
  mkdirSync(badPath, { recursive: true })
  const runtime = createHubRuntime({
    logger: { warn() {} },
    env: { DSH_POETRY_MEMORY_WRITE: 'gateway' },
    memoryWriteFile: badPath,
    now: () => 1000,
  })
  const result = await runtime.recordJournal({ kind: 'murmur', text: '写不进去', ts: 1000 })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HUB_MEMORY_WRITE_FAILED')
  assert.equal(runtime.snapshot().ok, true, 'Hub 不崩')
  runtime.dispose()
  rmSync(dir, { recursive: true, force: true })
})
