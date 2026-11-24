import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNeedBridge } from '../../lib/domain/being/need-bridge.mjs'

const NOW = 1_000_000_000_000

test('need-bridge：只在两边都成立时并排，且不给排序', () => {
  const lines = buildNeedBridge({
    now: NOW,
    state: { hunger: 80, thirst: 60, energy: 40, lastMealAt: NOW - 8 * 3600_000, lastDrinkAt: NOW - 5 * 3600_000 },
    project: { title: '带屋顶的院子', stage: '备料', lastStepAt: NOW - 3 * 24 * 3600_000 },
  })
  assert.ok(lines.some((line) => line.startsWith('身体这边：') && line.includes('挺饿')))
  assert.ok(lines.some((line) => line.startsWith('想做的事那边：') && line.includes('带屋顶的院子')))
  const closing = lines[lines.length - 1]
  assert.match(closing, /你自己定/)
  assert.doesNotMatch(closing, /先吃|必须先|应该先/)
})

test('need-bridge：身体都好或没有项目时不出桥，不硬凑', () => {
  assert.deepEqual(buildNeedBridge({ now: NOW, state: { hunger: 10, thirst: 10, energy: 90, lastMealAt: NOW - 3600_000 }, project: null }), [])
  assert.equal(buildNeedBridge({ now: NOW, state: {}, project: { title: '修一条路' } }).length, 1)
})
