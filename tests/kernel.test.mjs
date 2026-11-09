// kernel 基础设施单测（W0/W1）

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { describeConfig, readConfig } from '../lib/kernel/config.mjs'
import { createJsonStore, readJson, writeJson } from '../lib/kernel/json-store.mjs'
import { createPluginLogger } from '../lib/kernel/logger.mjs'
import { createModelCaller } from '../lib/kernel/model-call.mjs'
import { createServiceRegistry } from '../lib/kernel/service.mjs'
import { createStateRegistry, migrateAll } from '../lib/kernel/state-schema.mjs'

function tmpDir(name) {
  return mkdtempSync(path.join(os.tmpdir(), `dshp-${name}-`))
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
