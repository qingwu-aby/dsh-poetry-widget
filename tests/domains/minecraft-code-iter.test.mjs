import assert from 'node:assert/strict'
import test from 'node:test'
import { createActivityToolRegistry } from '../../lib/core/activity-tool-registry.mjs'
import { toolFailureLines } from '../../lib/domain/play/minecraft-code-iter.mjs'

const ALLOWED = new Set(['mc_wait', 'mc_move_to'])

test('code-iter：代码报错会被记录，并生成“可以改”的提示', () => {
  const registry = createActivityToolRegistry({ prefix: 'mc_', file: '', allowedTools: ALLOWED })
  const defined = registry.defineCode({ name: 'mc_probe_bad', purpose: '测试', code: 'throw new Error("boom")' })
  assert.equal(defined.ok, true)
  assert.equal(registry.expand('mc_probe_bad', {}), null)
  const failures = registry.failures()
  assert.equal(failures.length, 1)
  assert.equal(failures[0].name, 'mc_probe_bad')
  assert.match(failures[0].error, /boom/)
  const lines = toolFailureLines(failures)
  assert.match(lines, /执行失败/)
  assert.match(lines, /mc_define_code/)
})

test('code-iter：正常工具不会进失败列表；没有失败时提示为空', () => {
  const registry = createActivityToolRegistry({ prefix: 'mc_', file: '', allowedTools: ALLOWED })
  registry.defineCode({ name: 'mc_probe_ok', purpose: '好的', code: 'return [{"tool":"mc_wait","arguments":{"seconds":1}}]' })
  assert.equal(registry.expand('mc_probe_ok', {}).length, 1)
  assert.deepEqual(registry.failures(), [])
  assert.equal(toolFailureLines([]), '')
})
