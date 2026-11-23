import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createToolExperience, experienceContextKey } from '../../lib/core/tool-experience.mjs'

test('tool-experience：scope 隔离，不把游戏经验混进学习', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-exp-'))
  const exp = createToolExperience({ file: path.join(dir, 'experience.json'), now: () => 1 })
  const context = { empty: true }
  exp.record({ scope: 'activity:minecraft', tool: 'mc_find', context, ok: true })
  exp.record({ scope: 'activity:study', tool: 'study.search', context, ok: false })
  assert.equal(exp.summary({ scope: 'activity:minecraft', context })[0].tool, 'mc_find')
  assert.equal(exp.summary({ scope: 'activity:study', context })[0].tool, 'study.search')
  assert.equal(exp.summary({ scope: 'activity:video', context }).length, 0)
  assert.equal(experienceContextKey(context), 'empty:true')
  fs.rmSync(dir, { recursive: true, force: true })
})
