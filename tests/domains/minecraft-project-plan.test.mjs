import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'
import { createMinecraftProjectStore } from '../../lib/domain/play/minecraft-project.mjs'

const FILE = '/tmp/dsh-project-plan-test.json'

test('project↔plan：蓝图挂到项目上，施工进度累计，放完划掉里程碑', () => {
  rmSync(FILE, { force: true })
  const store = createMinecraftProjectStore({ file: FILE, now: () => 1000 })
  store.handle({ action: 'open', title: '能睡的屋子', milestones: ['搭出三面墙的顶'] })
  store.attachPlan({ goal: '搭出三面墙的顶', name: '小棚', blocks: Array.from({ length: 7 }, () => ({ block: 'dirt' })) })
  assert.match(store.promptLines().join('\n'), /蓝图 7 块，已放 0 块/)
  store.noteBuild({ ok: true, facts: { placed: 4 } })
  assert.match(store.promptLines().join('\n'), /已放 4 块/)
  store.noteBuild({ ok: true, facts: { placed: 3 } })
  const lines = store.promptLines().join('\n')
  assert.doesNotMatch(lines, /施工中的计划/)
  assert.doesNotMatch(lines, /还没做完的里程碑/)
  assert.match(lines, /施工完成/)
})

test('project↔plan：项目落盘后重开还在', () => {
  const reloaded = createMinecraftProjectStore({ file: FILE })
  const project = reloaded.get()
  assert.equal(project.title, '能睡的屋子')
  assert.match(project.stage, /施工完成/)
})
