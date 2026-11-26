import assert from 'node:assert/strict'
import test from 'node:test'
import { createMinecraftProjectStore } from '../../lib/domain/play/minecraft-project.mjs'

test('minecraft-project：开项目/推进/收尾，且只保留一个活跃项目', () => {
  let t = 1000
  const store = createMinecraftProjectStore({ now: () => t })
  assert.equal(store.get(), null)
  const opened = store.handle({ action: 'open', title: '带屋顶的院子', why: '夜里能安全看星星', milestones: ['找平地', '备料', '围墙'] })
  assert.equal(opened.ok, true)
  assert.equal(store.get().milestones.length, 3)
  t += 60000
  const stepped = store.handle({ action: 'step', done: '找平地', stage: '备料', blocker: '缺木头' })
  assert.equal(stepped.ok, true)
  assert.equal(store.get().stage, '备料')
  assert.equal(store.get().blockers[0], '缺木头')
  assert.equal(store.get().milestones.includes('找平地'), false)
  const closed = store.handle({ action: 'close', note: '改主意了' })
  assert.equal(closed.ok, true)
  assert.equal(store.get(), null)
})

test('minecraft-project：无项目时提示可选；停滞超过 12h 提醒收尾', () => {
  let t = 1000
  const store = createMinecraftProjectStore({ now: () => t })
  assert.match(store.promptLines()[0], /可以|没关系/)
  store.handle({ action: 'open', title: '修一条路' })
  t += 13 * 3600 * 1000
  const lines = store.promptLines()
  assert.ok(lines.some((line) => line.includes('12') || line.includes('小时没推进')))
  assert.ok(lines.some((line) => line.includes('生存')))
})

test('project：动作事实能登记成“已具备”，并进入 prompt', async () => {
  const { createMinecraftProjectStore } = await import('../../lib/domain/play/minecraft-project.mjs')
  const store = createMinecraftProjectStore({ file: '', now: () => 1000 })
  store.handle({ action: 'open', title: '搭个能过夜的地方', milestones: ['挖一个能躲的空间'] })
  assert.equal(store.noteEvidence({ milestoneEvidence: 'enclosed_space' }).ok, true)
  const lines = store.promptLines().join('\n')
  assert.match(lines, /你已经做到的事实/)
  assert.match(lines, /封闭空间/)
  assert.equal(store.get().evidence.kind, 'enclosed_space')
})
