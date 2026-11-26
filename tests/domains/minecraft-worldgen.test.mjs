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
  assert.match(lookupWorldgen('铁矿').method, /-24~56/)
  assert.match(lookupWorldgen('钻石').method, /-64~16/)
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

test('tutorials：教程沉淀能按主题命中，并优先于材料知识', async () => {
  const { loadTutorials, lookupTutorial } = await import('../../lib/domain/play/minecraft-tutorials.mjs')
  const os = await import('node:os')
  const path = await import('node:path')
  const data = loadTutorials(path.join(os.homedir(), '.dsh', '.dsh-poetry', 'wiki-tutorials.json'))
  if (data === null) return // 没跑过抓取脚本时跳过
  const house = lookupTutorial('怎么造房子', data)
  assert.ok(house)
  assert.equal(house.source, 'tutorial')
  assert.ok(house.steps.length >= 2)
  const combined = lookupCombinedKnowledge('怎么造房子', data)
  assert.equal(combined.source, 'tutorial')
  const material = lookupCombinedKnowledge('钻石在哪', data)
  assert.equal(material.source, 'worldgen')
})
