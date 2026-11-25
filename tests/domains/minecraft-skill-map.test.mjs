import assert from 'node:assert/strict'
import test from 'node:test'
import { SKILL_CATEGORIES, skillGapLine, skillProfile } from '../../lib/domain/play/minecraft-skill-map.mjs'

test('skill-map：分类汇总工具次数，找出最薄的一层', () => {
  const counts = { mc_mine: 500, mc_find: 400, mc_craft: 300, mc_place: 100, mc_eat: 200, mc_till: 0 }
  const profile = skillProfile(counts)
  const farm = profile.categories.find((item) => item.id === 'farm')
  assert.equal(farm.count, 0)
  assert.equal(profile.weakest.count, 0)
  assert.ok(['farm', 'fight', 'redstone', 'transport', 'storage'].includes(profile.weakest.id))
  assert.match(profile.profile, /采集900/)
})

test('skill-map：样本太少时不给建议', () => {
  assert.equal(skillGapLine({ mc_mine: 3 }), '')
})

test('skill-map：有明显短板时给一条可选建议', () => {
  const line = skillGapLine({ mc_mine: 200, mc_craft: 100, mc_place: 50, mc_eat: 80 })
  assert.match(line, /最薄的一层/)
  assert.match(line, /不想碰也完全可以/)
  assert.ok(SKILL_CATEGORIES.length >= 6)
})
