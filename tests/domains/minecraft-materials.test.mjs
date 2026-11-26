import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupCombinedKnowledge } from '../../lib/domain/play/minecraft-tactics.mjs'
import { lookupMaterial, materialCount, materialIndex } from '../../lib/domain/play/minecraft-materials.mjs'

test('materials：覆盖 100+ 种材料，八大类都有', () => {
  assert.ok(materialCount() >= 100, `材料只有 ${materialCount()} 条`)
  const index = materialIndex()
  for (const kind of ['矿物', '方块地形', '木材', '植物与作物', '生物掉落', '加工品', '食物']) {
    assert.ok(index.includes(kind), `目录缺类别：${kind}`)
  }
})

test('materials：单查给出 在哪找/怎么拿/用来做什么', () => {
  for (const topic of ['钻石', '盾牌', '下界合金', '面包', '羊毛', '甘蔗', '黑曜石']) {
    const entry = lookupMaterial(topic)
    assert.ok(entry, `查不到：${topic}`)
    assert.ok(entry.steps.some((step) => step.startsWith('在哪找') || step.startsWith('怎么拿')), `${topic} 缺来源`)
    assert.ok(entry.steps.some((step) => step.includes('用来做什么')), `${topic} 缺用途`)
  }
  assert.equal(lookupMaterial('完全不存在的东西'), null)
})

test('materials：总表目录与路由', () => {
  const all = lookupCombinedKnowledge('所有材料')
  assert.equal(all.title, '材料总表')
  assert.ok(all.steps.length >= 5)
  assert.match(all.steps.join('\n'), /钻石矿石/)
  assert.equal(lookupCombinedKnowledge('苦力怕怎么打').source, 'tactics')
  assert.equal(lookupCombinedKnowledge('远古残骸在哪').source, 'worldgen')
})
