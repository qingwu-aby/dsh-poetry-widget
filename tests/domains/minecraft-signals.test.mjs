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

test('signals：附近敌对生物会进入提示，并给出保命选项', async () => {
  const { threatLines } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const lines = threatLines({ nearbyEntities: ['zombie@10,64,20', 'cow@12,64,20'], health: 6 })
  assert.ok(lines.some((line) => line.includes('敌对生物') && line.includes('zombie')))
  assert.ok(lines.some((line) => line.includes('mc_attack') || line.includes('跑开')))
  assert.ok(lines.some((line) => line.includes('附近生物')))
})

test('signals：没有威胁且血量正常时不提示', async () => {
  const { threatLines } = await import('../../lib/domain/play/minecraft-signals.mjs')
  assert.deepEqual(threatLines({ nearbyEntities: [], health: 20 }), [])
})

test('signals：未知敌对生物按 type 识别，并提示先查名字', async () => {
  const { threatLines } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const lines = threatLines({ nearbyEntities: [{ name: 'bogged', type: 'hostile', distance: 4 }, { name: 'cow', type: 'animal', distance: 6 }], health: 20 })
  assert.ok(lines.some((line) => line.includes('敌对生物') && line.includes('bogged')))
  assert.ok(lines.some((line) => line.includes('不熟悉的生物')))
  assert.ok(lines.some((line) => line.includes('cow')))
})

test('signals：连续单动作会提示合并成队列', async () => {
  const { repetitionHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const singles = { commandHistory: Array.from({ length: 6 }, () => ({ tool: 'mc_mine', arguments: { block: 'dirt' }, queueCount: 0 })) }
  assert.match(repetitionHint(singles, 5000), /queue/)
  const queued = { commandHistory: Array.from({ length: 6 }, () => ({ tool: 'mc_mine', arguments: { block: 'dirt' }, queueCount: 2 })) }
  assert.doesNotMatch(repetitionHint(queued, 5000), /queue/)
})

test('signals：Minecraft 专用候选先关 thinking，再有兜底', async () => {
  const { MC_FAST_CANDIDATES } = await import('../../lib/domain/play/minecraft-signals.mjs')
  assert.equal(MC_FAST_CANDIDATES[0].reasoningEffort, 'off')
  assert.ok(MC_FAST_CANDIDATES.length >= 2)
  assert.ok(MC_FAST_CANDIDATES.some((item) => item.reasoningEffort !== 'off'))
})
