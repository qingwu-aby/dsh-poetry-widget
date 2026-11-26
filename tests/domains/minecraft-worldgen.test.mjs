import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupCombinedKnowledge } from '../../lib/domain/play/minecraft-tactics.mjs'
import { lookupWorldgen, worldgenTopics } from '../../lib/domain/play/minecraft-worldgen.mjs'

test('worldgen：覆盖面够广（材料/工具等级/主要矿物/生物材料）', () => {
  assert.ok(worldgenTopics().length >= 20)
  for (const topic of ['材料都有什么', '工具等级', '羊', '铁矿', '金矿', '钻石', '煤', '铜', '红石', '青金石', '绿宝石', '石头', '木头', '沙', '黏土', '黑曜石', '食物', '甘蔗', '蘑菇', '火药', '骨头', '皮革', '染料', '洞穴']) {
    const entry = lookupWorldgen(topic)
    assert.ok(entry, `缺少知识：${topic}`)
    assert.ok(entry.steps.length >= 2, `${topic} 步骤太少`)
  }
})

test('worldgen：关键事实正确（高度/工具/替代路线）', () => {
  assert.match(lookupWorldgen('铁矿').method, /y=72/)
  assert.match(lookupWorldgen('钻石').method, /-64/)
  assert.ok(lookupWorldgen('铁矿').steps.some((step) => step.includes('石镐')))
  assert.ok(lookupWorldgen('钻石').steps.some((step) => step.includes('铁镐')))
  assert.ok(lookupWorldgen('羊').steps.some((step) => step.includes('线')), '没有羊可用线合成羊毛')
  assert.match(lookupWorldgen('工具等级').method, /木镐/)
})

test('worldgen：组合查询优先给“在哪找”，战斗词仍走战术', () => {
  assert.equal(lookupCombinedKnowledge('羊毛在哪找').source, 'worldgen')
  assert.equal(lookupCombinedKnowledge('苦力怕怎么打').source, 'tactics')
  assert.equal(lookupWorldgen('完全无关的话题'), null)
})
