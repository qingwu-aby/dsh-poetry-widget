import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCapabilityProposals } from '../../lib/core/capability-proposals.mjs'

test('capability-proposals：只记录、不执行，重复 pending 去重', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cap-'))
  const file = path.join(dir, 'capability-proposals.json')
  const store = createCapabilityProposals({ file, now: () => 100 })
  const first = store.propose({ activityId: 'minecraft', capability: 'mc_smelt', reason: '没有熔炉动作' })
  assert.equal(first.ok, true)
  assert.equal(first.item.status, 'pending')
  const dup = store.propose({ activityId: 'minecraft', capability: 'mc_smelt', reason: 'again' })
  assert.equal(dup.duplicate, true)
  assert.equal(store.list().items.length, 1)
  assert.equal(fs.existsSync(file), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('capability-proposals：审核状态可更新', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cap-'))
  const store = createCapabilityProposals({ file: path.join(dir, 'capability-proposals.json'), now: () => 1 })
  const created = store.propose({ capability: 'mc_water', reason: '没有浇水原语' })
  assert.equal(created.ok, true)
  const id = created.item.id
  assert.equal(store.setStatus(id, 'implemented').item.status, 'implemented')
  assert.equal(store.setStatus(id, 'rejected').item.status, 'rejected')
  assert.equal(store.setStatus(id, 'bad').ok, false)
  fs.rmSync(dir, { recursive: true, force: true })
})
