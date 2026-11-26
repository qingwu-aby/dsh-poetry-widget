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

test('tactics：未知生物走通用战斗流程，种田类不误触发', async () => {
  const { genericCombatTactic } = await import('../../lib/domain/play/minecraft-tactics.mjs')
  const generic = genericCombatTactic('bogged 怎么打')
  assert.equal(generic.source, 'tactics')
  assert.ok(generic.steps.some((step) => step.includes('mc_inventory')))
  assert.ok(generic.steps.some((step) => step.includes('撤')))
  assert.equal(genericCombatTactic('怎么种小麦'), null)
})

test('tactics：找羊给出“山坡/草原、别原地重复查”的打法', async () => {
  const { lookupTactics } = await import('../../lib/domain/play/minecraft-tactics.mjs')
  const tactic = lookupTactics('羊在哪里')
  assert.ok(tactic)
  assert.match(tactic.method, /草方块/)
  assert.ok(tactic.steps.some((step) => step.includes('山坡') || step.includes('高处')))
  assert.ok(tactic.steps.some((step) => step.includes('mc_explore')))
})
