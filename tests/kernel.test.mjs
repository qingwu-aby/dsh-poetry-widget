// kernel 基础设施单测（W0/W1）

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createJsonStore, readJson, writeJson } from '../lib/kernel/json-store.mjs'
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
