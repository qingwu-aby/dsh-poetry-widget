import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReviewPrompt, createProjectReviewer, parseReview } from '../../lib/domain/play/minecraft-goals.mjs'
import { createMinecraftProjectStore } from '../../lib/domain/play/minecraft-project.mjs'

test('project：立新项目会把旧的挂起，且能恢复', () => {
  const store = createMinecraftProjectStore({ file: '', now: () => 1000 })
  store.handle({ action: 'open', title: '第一个项目' })
  store.handle({ action: 'open', title: '第二个项目' })
  assert.equal(store.get().title, '第二个项目')
  const suspended = store.listSuspended()
  assert.equal(suspended.length, 1)
  assert.equal(suspended[0].title, '第一个项目')
  assert.equal(store.handle({ action: 'resume', title: '第一个项目' }).ok, true)
  assert.equal(store.get().title, '第一个项目')
  assert.equal(store.listSuspended()[0].title, '第二个项目')
  assert.match(store.promptLines().join('\n'), /挂起/)
})

test('review：三个选项的解析与执行', async () => {
  assert.equal(parseReview('继续做'), null)
  const review = parseReview('{"decision":"shrink","note":"太大了","next":"先做一扇门"}')
  assert.equal(review.decision, 'shrink')

  const store = createMinecraftProjectStore({ file: '', now: () => 1000 })
  store.handle({ action: 'open', title: '大项目', milestones: ['造一座城'] })
  const reviewer = createProjectReviewer({ projectStore: store, now: () => 1000 + 8 * 3600 * 1000, callModel: async () => ({ text: '{"decision":"close","note":"不现实","next":""}' }) })
  const result = await reviewer({ observation: {} })
  assert.equal(result.ok, true)
  assert.equal(result.review.decision, 'close')
  assert.equal(store.get(), null, 'close 之后没有活跃项目')
})

test('review：项目刚推进过就不复盘；复盘有冷却', async () => {
  let calls = 0
  const store = createMinecraftProjectStore({ file: '', now: () => 1000 })
  store.handle({ action: 'open', title: '新项目', milestones: ['砍三块木头'] })
  const fresh = createProjectReviewer({ projectStore: store, now: () => 2000, callModel: async () => { calls += 1; return { text: '{}' } } })
  assert.equal(await fresh({ observation: {} }), null)
  assert.equal(calls, 0)

  const stale = createProjectReviewer({ projectStore: store, now: () => 1000 + 7 * 3600 * 1000, callModel: async () => { calls += 1; return { text: '{"decision":"continue","note":"继续","next":"砍木头"}' } } })
  assert.ok(await stale({ observation: {} }))
  assert.equal(calls, 1)
  await stale({ observation: {} })
  assert.equal(calls, 1, '冷却内不重复复盘')
})

test('review：prompt 只给三个选项，不给指定任务', () => {
  const prompt = buildReviewPrompt({ project: { title: '庇护所', milestones: ['木头'], stage: '开始' }, hours: 8 })
  assert.match(prompt, /continue/)
  assert.match(prompt, /shrink/)
  assert.match(prompt, /close/)
  assert.doesNotMatch(prompt, /你必须|马上/)
})

test('review：缩小目标不会把里程碑清空', async () => {
  const { runProjectReview } = await import('../../lib/domain/play/minecraft-goals.mjs')
  const store = createMinecraftProjectStore({ file: '', now: () => 1000 })
  store.handle({ action: 'open', title: '庇护所', milestones: ['采集木头和石头'] })
  const result = await runProjectReview({
    projectStore: store,
    observation: {},
    hours: 8,
    callModel: async () => ({ text: '{"decision":"shrink","note":"太大","next":""}' }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.review.decision, 'shrink')
  const project = store.get()
  assert.equal(project.stage, '缩小目标')
  assert.deepEqual(project.milestones, ['采集木头和石头'], '沿用原里程碑，不能清空')
})

test('review：没有里程碑的项目立刻算卡住（不用等 6 小时）', async () => {
  let calls = 0
  const store = createMinecraftProjectStore({ file: '', now: () => 1000 })
  store.handle({ action: 'open', title: '空项目' })
  store.handle({ action: 'step', milestones: [] })
  const reviewer = createProjectReviewer({
    projectStore: store,
    now: () => 1000 + 60 * 1000,
    callModel: async () => { calls += 1; return { text: '{"decision":"shrink","note":"没有下一步","next":"先砍三块木头"}' } },
  })
  const result = await reviewer({ observation: {} })
  assert.equal(calls, 1)
  assert.equal(result.ok, true)
  assert.equal(store.get().milestones[0], '先砍三块木头')
})
