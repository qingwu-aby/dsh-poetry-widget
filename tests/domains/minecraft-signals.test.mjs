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

test('settings：mcThinking 默认关闭，可写回', async () => {
  const { DEFAULT_SETTINGS, normalizeSettings, settingsPatch } = await import('../../client-src/settings-model.js')
  assert.equal(DEFAULT_SETTINGS.mcThinking, false)
  assert.equal(normalizeSettings({ mcThinking: true }).mcThinking, true)
  assert.equal(settingsPatch({ mcThinking: true }).mcThinking, true)
})

test('signals：没武器时不鼓励空手打，死了会提醒先活下来', async () => {
  const { deathHint, threatLines } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const unarmed = threatLines({ nearbyEntities: [{ name: 'zombie', type: 'hostile', distance: 3 }], health: 18, inventory: [] })
  assert.ok(unarmed.some((line) => line.includes('没有武器') && line.includes('不要空手')))
  const armed = threatLines({ nearbyEntities: [{ name: 'zombie', type: 'hostile', distance: 3 }], health: 18, inventory: ['stone_sword×1'] })
  assert.ok(armed.some((line) => line.includes('mc_attack')))
  const now = 10_000_000
  assert.match(deathHint(now - 3 * 60_000, now), /死了一次/)
  assert.equal(deathHint(now - 30 * 60_000, now), '')
  assert.equal(deathHint(0, now), '')
})

test('signals：背包快满时提示箱子/存储，够用时不打扰', async () => {
  const { storageHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const full = storageHint({ slotsFree: 3, nearbyBlocks: ['grass_block'] })
  assert.match(full, /mc_craft chest/)
  assert.match(full, /mc_store/)
  const withChest = storageHint({ slotsFree: 2, nearbyBlocks: ['chest'] })
  assert.match(withChest, /mc_store/)
  assert.equal(storageHint({ slotsFree: 20, nearbyBlocks: [] }), '')
  assert.equal(storageHint({}), '')
})

test('signals：有生食/原矿时提示熔炉，没熔炉就提示先做', async () => {
  const { smeltHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  assert.match(smeltHint({ inventory: ['beef×2'], nearbyBlocks: ['furnace'] }), /mc_smelt/)
  assert.match(smeltHint({ inventory: ['raw_iron×3', 'cobblestone×12'], nearbyBlocks: [] }), /mc_craft furnace/)
  assert.match(smeltHint({ inventory: ['beef×1'], nearbyBlocks: [] }), /先挖点圆石/)
  assert.equal(smeltHint({ inventory: ['apple×1'] }), '')
})

test('signals：连续同一目标会提示先做完再换', async () => {
  const { intentAnchor } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const state = { commandHistory: Array.from({ length: 4 }, () => ({ tool: 'mc_mine', reason: '先挖圆石做石镐' })) }
  assert.match(intentAnchor(state), /先把这件事做完/)
  assert.equal(intentAnchor({ commandHistory: [] }), '')
  const switched = { commandHistory: [{ tool: 'mc_mine', reason: '挖石头' }, { tool: 'mc_move_to', reason: '换地方' }, { tool: 'mc_move_to', reason: '换地方' }] }
  assert.equal(intentAnchor(switched), '')
})

test('tactics：采矿类提问给台阶挖法', async () => {
  const { lookupTactics } = await import('../../lib/domain/play/minecraft-tactics.mjs')
  const tactic = lookupTactics('怎么挖铁矿')
  assert.ok(tactic.steps.some((step) => step.includes('台阶')))
  assert.ok(tactic.steps.some((step) => step.includes('火把')))
})

test('signals：生活镜像陈述缺什么，不写成命令', async () => {
  const { livingHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const bare = livingHint({ facilities: { bed: 0, chest: 0, furnace: 0, crafting_table: 1, torch: 0, crops: 0, door: 0 }, inventory: [] })
  assert.match(bare, /没有床/)
  assert.match(bare, /箱子/)
  assert.doesNotMatch(bare, /你必须|马上去/)
  const settled = livingHint({ facilities: { bed: 1, chest: 1, furnace: 1, torch: 2, crops: 3, door: 1 }, inventory: [] })
  assert.equal(settled, '')
  assert.equal(livingHint({}), '')
})
