import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createWorkflowRegistry, validateWorkflow } from '../../lib/core/workflow-registry.mjs'

test('workflow：校验步骤/预算并持久化', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-workflow-'))
  const file = path.join(dir, 'workflows.json')
  const registry = createWorkflowRegistry({ file, now: () => 1000 })
  const validated = validateWorkflow({
    name: 'study_then_mine',
    trigger: { type: 'interval', everyMs: 60000 },
    steps: [
      { activity: 'study', tool: 'study.ask', arguments: { question: '怎么挖矿' } },
      { activity: 'minecraft', tool: 'mc_mine', arguments: { block: 'stone' } },
    ],
    budget: { maxSteps: 4, maxTokens: 1000, maxDurationMs: 60000, maxRuns: 2 },
  })
  assert.equal(validated.ok, true)
  assert.equal(validated.workflow.steps.length, 2)
  assert.equal(registry.upsert(validated).ok, true)
  assert.equal(registry.list().length, 1)
  const fresh = createWorkflowRegistry({ file, now: () => 2000 })
  assert.equal(fresh.get('study_then_mine').budget.maxRuns, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('workflow：预算耗尽/禁用/记录运行', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-workflow-budget-'))
  const registry = createWorkflowRegistry({ file: path.join(dir, 'workflows.json'), now: () => 1 })
  const v = validateWorkflow({ name: 'run_once', steps: [{ activity: 'study', tool: 'study.ask' }], budget: { maxRuns: 1 } })
  registry.upsert(v)
  assert.equal(registry.canRun('run_once').ok, true)
  assert.equal(registry.beginRun('run_once').ok, true)
  registry.finishRun('run_once', { ok: true, durationMs: 100 })
  assert.equal(registry.canRun('run_once').error, 'runs_exhausted')
  registry.setEnabled('run_once', false)
  assert.equal(registry.canRun('run_once').error, 'disabled')
  const fresh = createWorkflowRegistry({ file: path.join(dir, 'workflows.json'), now: () => 2 })
  assert.equal(fresh.canRun('run_once').error, 'disabled')
  fresh.setEnabled('run_once', false)
  assert.equal(fresh.canRun('run_once').error, 'disabled')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('workflow：非法名称/触发器/空步骤拒绝', () => {
  assert.equal(validateWorkflow({ name: 'Bad Name', steps: [{ activity: 'study', tool: 'x' }] }).ok, false)
  assert.equal(validateWorkflow({ name: 'ok', trigger: { type: 'event' }, steps: [{ activity: 'study', tool: 'x' }] }).ok, false)
  assert.equal(validateWorkflow({ name: 'ok', steps: [] }).ok, false)
})

test('workflow：waiting/resume 状态可恢复', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-workflow-wait-'))
  const registry = createWorkflowRegistry({ file: path.join(dir, 'workflows.json'), now: () => 10 })
  const v = validateWorkflow({ name: 'wait_flow', steps: [{ activity: 'minecraft', tool: 'mc_mine' }] })
  registry.upsert(v)
  assert.equal(registry.beginRun('wait_flow').ok, true)
  assert.equal(registry.setWaiting('wait_flow', { cursor: 1, pendingTaskId: 'tb-1' }).workflow.lastStatus, 'waiting')
  assert.equal(registry.resume('wait_flow').workflow.runState.status, 'running')
  assert.equal(registry.finishRun('wait_flow', { ok: true }).workflow.lastStatus, 'success')
  fs.rmSync(dir, { recursive: true, force: true })
})
