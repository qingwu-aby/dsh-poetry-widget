import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStatusReport, roughText } from '../../lib/domain/play/minecraft-status.mjs'

test('status：把状态、层级、家、重生点、蓝图、项目、经验一次说清', () => {
  const report = buildStatusReport({
    observation: {
      position: '1,64,1',
      health: 12,
      food: 9,
      timeOfDay: '夜晚',
      facilities: { crafting_table: 1 },
      facilitiesExtra: { shelterShell: 1, shelterAt: '-66,63,8', shelterDistance: 40 },
      anchor: { at: '2,68,0', source: 'spawn', distance: 60 },
    },
    plan: { name: '小屋', total: 18, nextIndex: 17, done: false },
    project: { title: '给屋子装门', stage: '开始', milestones: ['砍 2 块橡木'] },
    toolStats: { mc_mine: { success: 20, failure: 1 }, mc_craft: { success: 2, failure: 8 } },
  })
  assert.match(report, /生活层级：第 2 层/)
  assert.match(report, /你盖的屋子在 -66,63,8/)
  assert.match(report, /重生点：2,68,0/)
  assert.match(report, /17\/18/)
  assert.match(report, /给屋子装门/)
  assert.match(report, /经验分布/)
  assert.match(report, /最不顺手的动作：mc_craft/)
})

test('status：空状态也不崩', () => {
  const report = buildStatusReport({})
  assert.match(report, /位置 未知/)
  assert.match(report, /身边没有任何设施/)
})

test('status：roughText 只统计样本足够的工具', () => {
  assert.match(roughText({ mc_craft: { success: 1, failure: 9 }, mc_mine: { success: 9, failure: 1 } }), /mc_craft 成功 10%/)
  assert.equal(roughText({ mc_wait: { success: 1, failure: 0 } }), '')
})

test('status：能说出“你以前在附近放过什么”', () => {
  const report = buildStatusReport({
    observation: {
      position: '1,64,1',
      facilities: {},
      landmarks: [
        { name: 'chest', x: 5, y: 64, z: 5, distance: 8 },
        { name: 'shelter', x: -20, y: 70, z: -21, distance: 40 },
      ],
    },
  })
  assert.match(report, /你以前在附近放过东西/)
  assert.match(report, /chest @5,64,5（8 格）/)
  assert.match(report, /你盖过的小屋/)
})

test('selfView：优先用 bot 的 self 快照，缺字段回退旧字段', async () => {
  const { selfView } = await import('../../lib/domain/play/minecraft-status.mjs')
  const canonical = selfView({
    position: '1,2,3',
    facilities: { bed: 0 },
    self: { at: { x: 10, y: 20, z: 30 }, shelter: { verified: true, at: '40,50,60', distance: 12 }, facilities: { bed: 1 }, landmarks: [{ name: 'chest' }] },
  })
  assert.equal(canonical.position, '10,20,30')
  assert.equal(canonical.shelter.at, '40,50,60')
  assert.equal(canonical.facilities.bed, 1)
  assert.equal(canonical.landmarks.length, 1)

  const fallback = selfView({ position: '1,2,3', facilitiesExtra: { shelterAt: '7,8,9', shelterDistance: 5 } })
  assert.equal(fallback.position, '1,2,3')
  assert.equal(fallback.shelter.at, '7,8,9')
})
