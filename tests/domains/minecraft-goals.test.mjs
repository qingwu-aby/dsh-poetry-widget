import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGoalPrompt, createSelfGoal, parseGoal, runGoalRoundIfDue } from '../../lib/domain/play/minecraft-goals.mjs'
import { createMinecraftProjectStore } from '../../lib/domain/play/minecraft-project.mjs'

test('goals：立目标的 prompt 只给事实，不给建议清单', () => {
  const prompt = buildGoalPrompt({
    observation: { position: '1,2,3', health: 12, food: 8, timeOfDay: '夜晚', inventory: ['dirt×3'], facilities: {} },
    skillText: '采集 900、制作 30',
    failures: ['mc_craft 没成功'],
    memoryLines: ['记得砍树'],
  })
  assert.match(prompt, /最想做成哪一件事/)
  assert.match(prompt, /只有|只输出 JSON/)
  assert.match(prompt, /mc_/)
  assert.doesNotMatch(prompt, /你必须建|马上去做/)
})

test('goals：解析她写的目标，并写进她自己的项目本子', async () => {
  assert.equal(parseGoal('我想砍树'), null)
  const goal = parseGoal('{"title":"给屋子装一扇门","why":"夜里僵尸能进来","first":"砍 2 块橡木"}')
  assert.equal(goal.title, '给屋子装一扇门')
  assert.equal(goal.firstStep, '砍 2 块橡木')

  const store = createMinecraftProjectStore({ file: '' })
  const selfGoal = createSelfGoal({
    projectStore: store,
    now: () => 1000,
    toolCountsOf: () => ({}),
    skillProfile: () => ({ categories: [] }),
    callModel: async () => ({ text: '{"title":"给屋子装一扇门","why":"夜里僵尸能进来","first":"砍 2 块橡木"}' }),
  })
  const state = { observation: { inventory: [], facilities: {} }, commandHistory: [] }
  const written = await selfGoal(state)
  assert.equal(written.title, '给屋子装一扇门')
  assert.equal(store.get().title, '给屋子装一扇门')
})

test('goals：有活跃项目或未到间隔就不重复立项', async () => {
  let calls = 0
  const store = createMinecraftProjectStore({ file: '' })
  store.handle({ action: 'open', title: '已有项目' })
  const state = { observation: {}, commandHistory: [] }
  const skipped = await runGoalRoundIfDue({ state, projectStore: store, callModel: async () => { calls += 1; return { text: '{}' } } })
  assert.equal(skipped, null)
  assert.equal(calls, 0)

  const empty = createMinecraftProjectStore({ file: '' })
  const first = await runGoalRoundIfDue({
    state,
    projectStore: empty,
    now: () => 1000,
    callModel: async () => { calls += 1; return { text: '{"title":"先弄个火把","why":"太黑","first":"做 4 支火把"}' } },
  })
  assert.equal(first.title, '先弄个火把')
  const second = await runGoalRoundIfDue({ state, projectStore: createMinecraftProjectStore({ file: '' }), now: () => 2000, callModel: async () => { calls += 1; return { text: '{}' } } })
  assert.equal(second, null)
  assert.equal(calls, 1)
})
