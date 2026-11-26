import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupCombinedKnowledge } from '../../lib/domain/play/minecraft-tactics.mjs'
import { lookupWorldgen, worldgenTopics } from '../../lib/domain/play/minecraft-worldgen.mjs'

test('worldgen：羊/铁/煤/钻石都能查到高度与地形', () => {
  const sheep = lookupWorldgen('羊在哪里')
  assert.equal(sheep.source, 'worldgen')
  assert.ok(sheep.steps.some((step) => step.includes('草方块')))
  assert.ok(sheep.steps.some((step) => step.includes('线')), '给出“没有羊用线合成”的替代路线')

  const iron = lookupWorldgen('铁矿怎么找')
  assert.match(iron.method, /y=72/)

  const coal = lookupWorldgen('煤炭在哪')
  assert.match(coal.method, /y=0/)
  assert.ok(coal.steps.some((step) => step.includes('火把')))

  const diamond = lookupWorldgen('钻石')
  assert.match(diamond.method, /-64/)
  assert.ok(diamond.steps.some((step) => step.includes('铁镐')))
})

test('worldgen：组合查询先给“在哪找”，战斗词仍走战术', () => {
  assert.equal(lookupCombinedKnowledge('羊毛在哪找').source, 'worldgen')
  const combat = lookupCombinedKnowledge('苦力怕怎么打')
  assert.equal(combat.source, 'tactics')
  assert.equal(lookupWorldgen('完全无关的话题'), null)
  assert.ok(worldgenTopics().includes('铁'))
})
