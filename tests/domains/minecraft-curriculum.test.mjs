import assert from 'node:assert/strict'
import test from 'node:test'
import { curriculumCandidates, curriculumLines } from '../../lib/domain/play/minecraft-curriculum.mjs'

test('curriculum：缺床/熔炉/箱子时给候选，材料够的标 ready', () => {
  const list = curriculumCandidates({ observation: { inventory: ['oak_planks×30', 'cobblestone×12'], facilities: { bed: 0, chest: 0, furnace: 0, torch: 0, crops: 0 }, food: 18 } })
  assert.ok(list.length >= 2)
  assert.ok(list.some((item) => item.goal.includes('熔炉') && item.ready))
  assert.ok(list.some((item) => item.goal.includes('床') && !item.ready))
  assert.ok(list.length <= 3)
})

test('curriculum：设施齐全时不再打扰', () => {
  assert.equal(curriculumLines({ observation: { inventory: ['dirt×2'], facilities: { bed: 1, chest: 1, furnace: 1, torch: 3, crops: 4 }, food: 20 } }), '')
})

test('curriculum：饿的时候把找吃的排进来', () => {
  const list = curriculumCandidates({ observation: { inventory: [], facilities: {}, food: 8 } })
  assert.ok(list.some((item) => item.goal.includes('吃')))
})
