import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupTactics, tacticsTopics } from '../../lib/domain/play/minecraft-tactics.mjs'

test('tactics：常见威胁给出可执行步骤', () => {
  const zombie = lookupTactics('僵尸 怎么打')
  assert.equal(zombie.source, 'tactics')
  assert.match(zombie.method, /边退边打/)
  assert.ok(zombie.steps.length >= 2)
  assert.ok(lookupTactics('苦力怕 怎么办').steps.some((step) => step.includes('退')))
  assert.ok(lookupTactics('晚上有怪').steps.some((step) => step.includes('火把')))
})

test('tactics：无关主题不硬套', () => {
  assert.equal(lookupTactics('怎么种小麦'), null)
  assert.equal(lookupTactics(''), null)
  assert.ok(tacticsTopics().includes('僵尸'))
})
