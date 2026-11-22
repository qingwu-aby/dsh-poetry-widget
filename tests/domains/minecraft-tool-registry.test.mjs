import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMinecraftToolRegistry } from '../../lib/domain/play/minecraft-tool-registry.mjs'

test('tool-registry：宏工具只允许组合已有原语，持久化后可展开', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tools-'))
  const file = path.join(dir, 'minecraft-tools.json')
  const registry = createMinecraftToolRegistry({ file, allowedTools: new Set(['mc_craft', 'mc_eat']) })
  const bad = registry.defineMacro({ name: 'mc_do_evil', steps: [{ tool: 'mc_delete_world', arguments: {} }] })
  assert.equal(bad.ok, false)
  const good = registry.defineMacro({
    name: 'mc_make_planks',
    purpose: '做木板',
    steps: [{ tool: 'mc_craft', arguments: { item: 'oak_planks', count: 1 } }],
  })
  assert.equal(good.ok, true)
  assert.equal(registry.expand('mc_make_planks').length, 1)
  const fresh = createMinecraftToolRegistry({ file, allowedTools: new Set(['mc_craft', 'mc_eat']) })
  assert.equal(fresh.has('mc_make_planks'), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('tool-registry：代码工具受限运行，只返回步骤，拒绝危险访问', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tools-code-'))
  const registry = createMinecraftToolRegistry({ dir, allowedTools: new Set(['mc_craft', 'mc_eat']) })
  const dangerous = registry.defineCode({ name: 'mc_bad', code: 'return process.env.HOME' })
  assert.equal(dangerous.ok, false)
  assert.equal(dangerous.error, 'code_forbidden')
  const ok = registry.defineCode({
    name: 'mc_eat_if_hungry',
    purpose: '饿了就吃',
    code: 'return obs.food < 20 ? [{ tool: "mc_eat", arguments: {} }] : []',
  })
  assert.equal(ok.ok, true)
  assert.equal(registry.expand('mc_eat_if_hungry', { food: 10 }).length, 1)
  assert.equal(registry.expand('mc_eat_if_hungry', { food: 20 }).length, 0)
  const syntax = registry.defineCode({ name: 'mc_broken', code: 'return [' })
  assert.equal(syntax.ok, false)
  fs.rmSync(dir, { recursive: true, force: true })
})
