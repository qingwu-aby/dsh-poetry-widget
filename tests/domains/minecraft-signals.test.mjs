import assert from 'node:assert/strict'
import test from 'node:test'
import { demandHint, repetitionHint } from '../../lib/domain/play/minecraft-signals.mjs'

test('signals：重复动作提示出现一次，冷却内不再重复', () => {
  const state = { commandHistory: Array.from({ length: 8 }, () => ({ tool: 'mc_mine', arguments: { block: 'dirt' } })) }
  const first = repetitionHint(state, 1_000_000)
  assert.match(first, /续手动做也完全可以/)
  assert.match(first, /dirt/)
  assert.equal(repetitionHint(state, 1_000_000 + 60_000), '')
  assert.ok(repetitionHint(state, 1_000_000 + 11 * 60_000).length > 0)
})

test('signals：只做几次不提示', () => {
  const state = { commandHistory: Array.from({ length: 3 }, () => ({ tool: 'mc_mine', arguments: { block: 'dirt' } })) }
  assert.equal(repetitionHint(state, 1000), '')
})

test('signals：材料缺口大才提示，够用不打扰', () => {
  const blocks = Array.from({ length: 40 }, () => ({ block: 'oak_planks' }))
  assert.match(demandHint(blocks, ['oak_planks×12']), /需要 40 块/)
  assert.equal(demandHint(blocks, ['oak_planks×40']), '')
  assert.equal(demandHint(Array.from({ length: 10 }, () => ({ block: 'dirt' })), []), '')
})
