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

test('signals：Minecraft 候选带 token 下限，避免 thinking 吃空正文', async () => {
  const { MC_FAST_CANDIDATES } = await import('../../lib/domain/play/minecraft-signals.mjs')
  assert.ok(MC_FAST_CANDIDATES.length >= 1)
  assert.ok(MC_FAST_CANDIDATES.every((item) => Number(item.maxTokensFloor) >= 1000))
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

test('signals：生活层级说明上下层，不下命令', async () => {
  const { livingLayer } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const bare = livingLayer({ facilities: { bed: 0, chest: 0, furnace: 0, crafting_table: 0, torch: 0, crops: 0, door: 0 }, inventory: [], automations: 0 })
  assert.match(bare, /第 1 层/)
  assert.match(bare, /再往上一层/)
  assert.match(bare, /你自己定/)
  const settled = livingLayer({ facilities: { bed: 1, chest: 1, furnace: 1, crafting_table: 1, torch: 4, crops: 6, door: 1 }, inventory: ['bread×5'], automations: 2 })
  assert.match(settled, /第 6 层/)
  assert.equal(livingLayer({}), '')
})

test('signals：饿了但没食物时不鼓励反复 mc_eat', async () => {
  const { hungerHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const empty = hungerHint({ food: 10, inventory: ['oak_log×5', 'stick×3'] })
  assert.match(empty, /只会失败/)
  assert.match(empty, /mc_find/)
  const hasFood = hungerHint({ food: 10, inventory: ['bread×2'] })
  assert.match(hasFood, /mc_eat/)
  assert.equal(hungerHint({ food: 20, inventory: [] }), '')
})

test('signals：长时间零散采集会提示可以用项目/蓝图，用过后不再提', async () => {
  const { longTaskNudge } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const gathering = { commandHistory: Array.from({ length: 12 }, (_, i) => ({ tool: i % 2 ? 'mc_find' : 'mc_mine', arguments: { block: 'dirt' } })) }
  assert.match(longTaskNudge(gathering, 1000), /mc_project/)
  assert.equal(longTaskNudge(gathering, 2000), '')
  const planned = { commandHistory: [...Array.from({ length: 11 }, () => ({ tool: 'mc_mine', arguments: { block: 'dirt' } })), { tool: 'mc_plan' }] }
  assert.equal(longTaskNudge(planned, 5000), '')
})

test('signals：Minecraft 统一用 dsh-opencode-go/deepseek-v4.1-flash', async () => {
  const { MC_FAST_CANDIDATES } = await import('../../lib/domain/play/minecraft-signals.mjs')
  assert.ok(MC_FAST_CANDIDATES.every((item) => item.provider === 'dsh-opencode-go'))
  assert.ok(MC_FAST_CANDIDATES.every((item) => item.model === 'deepseek-v4.1-flash'))
})

test('signals：同一步骤原地重复会提示换方法', async () => {
  const { stallHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const stuck = { commandHistory: Array.from({ length: 3 }, () => ({ tool: 'mc_move_to', arguments: { x: -51, z: -20 }, positionAfter: '-51.3,69.0,-20.5' })) }
  assert.match(stallHint(stuck), /走不通/)
  assert.match(stallHint(stuck), /mc_escape/)
  const moving = { commandHistory: ['1,1,1', '2,1,1', '3,1,1'].map((pos) => ({ tool: 'mc_move_to', arguments: { x: 5, z: 5 }, positionAfter: pos })) }
  assert.equal(stallHint(moving), '')
  assert.equal(stallHint({ commandHistory: [] }), '')
})

test('settings：hub 影子模式默认开启且能持久', async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await import('../../lib/kernel/settings-store.mjs')
  assert.equal(DEFAULT_SETTINGS.hub.enabled, true)
  assert.equal(DEFAULT_SETTINGS.hub.shadow, true)
  const kept = normalizeSettings({ hub: { enabled: true, shadow: false } })
  assert.deepEqual(kept.hub, { enabled: true, shadow: false })
  const disabled = normalizeSettings({ hub: { enabled: false } })
  assert.deepEqual(disabled.hub, { enabled: false, shadow: true })
  const broken = normalizeSettings({ hub: 'nope' })
  assert.deepEqual(broken.hub, { enabled: true, shadow: true })
})

test('signals：未完成蓝图会在 prompt 里可见', async () => {
  const { planHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const running = planHint({ plan: { name: 'Dirt_3x3_Shelter', total: 18, nextIndex: 17, done: false } })
  assert.match(running, /没盖完/)
  assert.match(running, /17\/18/)
  assert.match(running, /mc_build/)
  const done = planHint({ plan: { name: '小棚', total: 7, nextIndex: 7, done: true } })
  assert.match(done, /已经盖完/)
  assert.equal(planHint({}), '')
})

test('signals：盖好的壳子算进第 2 层，但仍提示缺门/火把', async () => {
  const { livingHint, livingLayer } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const obs = { facilities: { bed: 0, chest: 0, furnace: 0, torch: 0, crops: 0, door: 0, crafting_table: 0, shelterShell: 1 }, inventory: ['dirt×3'], food: 20 }
  assert.match(livingLayer(obs), /第 2 层/)
  assert.match(livingHint(obs), /壳子还没有门和火把/)
  const extra = { ...obs, facilities: {}, facilitiesExtra: { shelterShell: 1 } }
  assert.match(livingLayer(extra), /第 2 层/)
})

test('signals：家在哪里会被记住，远了也说得出来', async () => {
  const { homeHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const far = homeHint({ facilitiesExtra: { shelterName: '小棚', shelterAt: '-18,71,-60', shelterDistance: 70 } })
  assert.match(far, /-18,71,-60/)
  assert.match(far, /70 格/)
  assert.match(far, /mc_move_to/)
  const near = homeHint({ facilitiesExtra: { shelterName: '小棚', shelterAt: '-18,71,-60', shelterDistance: 5 } })
  assert.match(near, /旁边/)
  assert.equal(homeHint({}), '')
})

test('signals：重生锚点按床判定，没床就说明白', async () => {
  const { anchorHint } = await import('../../lib/domain/play/minecraft-signals.mjs')
  const noBed = anchorHint({ anchor: { at: '0,68,0', source: 'spawn', distance: 30 }, facilities: { bed: 0 } })
  assert.match(noBed, /世界出生点/)
  assert.match(noBed, /不是你盖的屋子/)
  const bedUnused = anchorHint({ anchor: { at: '0,68,0', source: 'spawn' }, facilities: { bed: 1 } })
  assert.match(bedUnused, /mc_sleep/)
  const bedSet = anchorHint({ anchor: { at: '-18,71,-60', source: 'bed' }, facilities: { bed: 1 } })
  assert.match(bedSet, /重生点定在床边/)
  assert.equal(anchorHint({}), '')
})
