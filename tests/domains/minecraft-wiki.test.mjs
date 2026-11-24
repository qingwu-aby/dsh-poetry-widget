import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWikiGuide, itemNameVariants, scoreCandidate, searchQueries, splitSections } from '../../lib/domain/play/minecraft-wiki.mjs'

test('minecraft-wiki：提问式查询去口水词并给出物品名变体', () => {
  const queries = searchQueries('怎么做石镐')
  assert.ok(queries.some((item) => item.includes('石镐')))
  assert.ok(itemNameVariants('石镐').includes('镐'))
})

test('minecraft-wiki：相关性优先精确标题、压低版本/概览类页面', () => {
  const good = scoreCandidate('石镐', { title: '镐', snippet: '镐是挖掘工具' })
  const bad = scoreCandidate('石镐', { title: 'Java版版本概览/Beta 1.5', snippet: '本版本概览' })
  assert.ok(good > bad)
})

test('minecraft-wiki：正文切成导语+小节，步骤优先行动小节', () => {
  const text = '床（Bed）是用于睡觉的方块。\n\n== 获取 ==\n用羊毛和木板合成。\n\n== 使用 ==\n对床使用可以跳过夜晚。\n'
  const { intro, sections } = splitSections(text)
  assert.equal(intro.length, 1)
  assert.deepEqual(sections.map((item) => item.title), ['获取', '使用'])
  const guide = buildWikiGuide('床 怎么睡觉', { title: '床', extract: text, url: 'https://zh.minecraft.wiki/w/床' })
  assert.equal(guide.title, '床')
  assert.ok(guide.steps.some((step) => step.includes('跳过夜晚')))
})
