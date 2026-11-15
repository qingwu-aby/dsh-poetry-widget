// tests/domains/minecraft-brain.test.mjs —— Minecraft 行动决策纯函数（v0.6.0）
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMinecraftDecisionPrompt, MINECRAFT_ACTIONS, parseMinecraftAction } from '../../lib/domain/play/minecraft-brain.mjs'

test('Minecraft 决策 prompt：带观察、玩家与安全约束', () => {
  const prompt = buildMinecraftDecisionPrompt(
    { position: '1,2,3', health: 20, food: 18, timeOfDay: '白天', players: ['Yuan_JY'], nearbyBlocks: ['oak_log'], inventory: ['bread×2'] },
    { selfState: { felt: '有点好奇' } },
  )
  assert.match(prompt, /只输出一个 JSON 对象/)
  assert.match(prompt, /Yuan_JY/)
  assert.match(prompt, /不要主动攻击玩家/)
  assert.match(prompt, /有点好奇/)
})

test('Minecraft 动作解析：idle/chat/move/look/follow', () => {
  assert.deepEqual(parseMinecraftAction('{"action":"idle"}'), { action: 'idle' })
  assert.deepEqual(parseMinecraftAction('{"action":"chat","say":"嗨"}'), { action: 'chat', say: '嗨' })
  assert.deepEqual(parseMinecraftAction('{"action":"move","direction":"left","seconds":9}'), { action: 'move', direction: 'left', seconds: 3 })
  assert.deepEqual(parseMinecraftAction('{"action":"move","direction":"sideways"}'), { action: 'move', direction: 'forward', seconds: 2 })
  assert.deepEqual(parseMinecraftAction('{"action":"look","yaw":999,"pitch":-999}'), { action: 'look', yaw: 360, pitch: -80 })
  assert.deepEqual(parseMinecraftAction('{"action":"follow","player":"Yuan_JY"}', { players: ['Yuan_JY'] }), { action: 'follow', player: 'Yuan_JY' })
})

test('Minecraft 动作解析：模型不听话时安全回退', () => {
  assert.equal(parseMinecraftAction('我在想要不要过去。'), null)
  assert.equal(parseMinecraftAction('{"action":"attack"}'), null)
  assert.equal(parseMinecraftAction('{"action":"follow","player":"NotHere"}', { players: ['Yuan_JY'] }), null)
  assert.equal(parseMinecraftAction('{"action":"chat","say":""}'), null)
  assert.deepEqual(parseMinecraftAction(JSON.stringify({ action: MINECRAFT_ACTIONS[0] })), { action: 'idle' })
})
