// tests/domains/game-memory.test.mjs —— Minecraft 分类记忆（v0.6.1）
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameMemory, GAME_MEMORY_CATEGORIES, normalizeGameMemory } from '../../lib/domain/play/game-memory.mjs'

test('游戏记忆：五类固定分类，互不混用', () => {
  const memory = createGameMemory({ seed: null, now: () => 1000 })
  memory.record({ category: 'world', text: '在 25566 的新世界玩' })
  memory.record({ category: 'player', text: 'Yuan_JY 是常一起玩的人' })
  memory.record({ category: 'session', text: '今天一起在出生点附近走了走' })
  memory.record({ category: 'event', text: '第一次见面时她跟了过去' })
  memory.record({ category: 'plan', text: '想学会砍树' })
  for (const category of GAME_MEMORY_CATEGORIES) {
    const items = memory.digest({ category })
    assert.equal(items.length, 1, category)
    assert.equal(items[0].category, category)
  }
  assert.equal(memory.digest({ category: 'nope' }).length, 5)
})

test('游戏记忆：同分类去重、跨分类不合并', () => {
  const memory = createGameMemory({ seed: null, now: () => 2000 })
  memory.record({ category: 'event', text: '和 Yuan_JY 说了晚安' })
  memory.record({ category: 'event', text: '和 Yuan_JY 说了晚安' })
  memory.record({ category: 'plan', text: '和 Yuan_JY 说了晚安' })
  assert.equal(memory.digest({ category: 'event' }).length, 1)
  assert.equal(memory.digest({ category: 'event' })[0].count, 2)
  assert.equal(memory.digest({ category: 'plan' }).length, 1)
})

test('游戏记忆：prompt 只输出存在的分类，且带分类标签', () => {
  const memory = createGameMemory({ seed: null, now: () => 3000 })
  memory.record({ category: 'world', text: '服务器 25566' })
  memory.record({ category: 'plan', text: '想看看海' })
  const lines = memory.promptLines()
  assert.ok(lines.some((line) => line.startsWith('世界：')))
  assert.ok(lines.some((line) => line.startsWith('打算：')))
  assert.ok(!lines.some((line) => line.startsWith('玩家：')))
  assert.deepEqual(normalizeGameMemory(null).entries, [])
})
