import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSkillContext, contextKey, createToolSkills } from '../../lib/domain/play/tool-skills.mjs'

test('tool-skills：情境特征与 key 稳定', () => {
  const context = buildSkillContext({ inventory: [], food: 5, timeOfDay: '夜晚', stuck: true })
  assert.equal(context.empty, true)
  assert.equal(context.hungry, true)
  assert.equal(context.night, true)
  assert.equal(context.stuck, true)
  assert.equal(contextKey(context), 'empty:true+hungry:true+night:true+stuck:true')
})

test('tool-skills：成功/失败累计并按成功率排序，持久化', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-skill-'))
  const file = path.join(dir, 'tool-skills.json')
  const skills = createToolSkills({ file, now: () => 1 })
  const context = { empty: true }
  skills.record({ tool: 'mc_find', ok: true, context })
  skills.record({ tool: 'mc_find', ok: true, context })
  skills.record({ tool: 'mc_explore', ok: false, context })
  const list = skills.summary(context)
  assert.equal(list[0].tool, 'mc_find')
  assert.equal(list[0].success, 2)
  assert.equal(list[1].tool, 'mc_explore')
  const fresh = createToolSkills({ file, now: () => 2 })
  assert.equal(fresh.summary(context)[0].tool, 'mc_find')
  fs.rmSync(dir, { recursive: true, force: true })
})
