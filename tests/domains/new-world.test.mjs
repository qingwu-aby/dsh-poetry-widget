import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyWorldTransfer, planWorldTransfer } from '../../scripts/new-world.mjs'

test('new-world：保留方法/调研/愿景，归档世界事实', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-world-'))
  fs.writeFileSync(path.join(dir, 'methods.md'), '- 先做木镐 [2026-11-01]\n')
  fs.writeFileSync(path.join(dir, 'inquiry.md'), '- 洞窟先找水 [2026-11-01]\n')
  fs.writeFileSync(path.join(dir, 'vision.md'), '- 想有个家 [2026-11-01]\n')
  fs.writeFileSync(path.join(dir, 'world.md'), '- 旧世界 1,2,3\n')
  fs.writeFileSync(path.join(dir, 'todo.md'), '- 旧房子\n')
  fs.mkdirSync(path.join(dir, 'build'))
  fs.writeFileSync(path.join(dir, 'build', 'home.md'), '- 旧房子在 1,2,3\n')
  const plan = planWorldTransfer({ dir, world: 'second', now: Date.parse('2026-11-22T00:00:00Z') })
  applyWorldTransfer(plan)
  assert.match(fs.readFileSync(path.join(dir, 'methods.md'), 'utf8'), /先做木镐/)
  assert.match(fs.readFileSync(path.join(dir, 'inquiry.md'), 'utf8'), /洞窟先找水/)
  assert.match(fs.readFileSync(path.join(dir, 'vision.md'), 'utf8'), /想有个家/)
  assert.equal(fs.readFileSync(path.join(dir, 'world.md'), 'utf8').includes('旧世界 1,2,3'), false)
  assert.equal(fs.existsSync(path.join(dir, 'build', 'home.md')), false)
  assert.equal(fs.readFileSync(path.join(dir, 'todo.md'), 'utf8').includes('旧房子'), false)
  assert.equal(fs.existsSync(path.join(plan.archiveDir, 'world.md')), true)
  assert.equal(fs.existsSync(path.join(plan.archiveDir, 'build', 'home.md')), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('new-world：--keep-build 保留建筑，但 world/计划仍重置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-world-keep-'))
  fs.mkdirSync(path.join(dir, 'build'))
  fs.writeFileSync(path.join(dir, 'build', 'home.md'), '- 旧家\n')
  fs.writeFileSync(path.join(dir, 'world.md'), '- 旧坐标\n')
  const plan = planWorldTransfer({ dir, world: 'keep', keepBuild: true, now: 1 })
  applyWorldTransfer(plan)
  assert.match(fs.readFileSync(path.join(dir, 'build', 'home.md'), 'utf8'), /旧家/)
  assert.equal(fs.readFileSync(path.join(dir, 'world.md'), 'utf8').includes('旧坐标'), false)
  fs.rmSync(dir, { recursive: true, force: true })
})
