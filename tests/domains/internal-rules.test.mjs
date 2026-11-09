// tests/domains/internal-rules.test.mjs —— 内生规则 + 底层情绪状态（v3.15）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  addRule,
  applicableRules,
  buildRuleSynthesisPrompt,
  createInternalRules,
  digestRules,
  emptyRules,
  normalizeRules,
  parseRuleProposal,
  recordRuleOutcome,
} from '../../lib/domain/being/internal-rules.mjs'
import { createRuleSynthesizer } from '../../lib/domain/being/rule-synthesis.mjs'
import {
  affectLabel,
  createAffectState,
  effectiveAffect,
  emptyAffect,
  formatAffectLines,
  updateAffect,
} from '../../lib/domain/emotion/affect-homeostasis.mjs'
import { makeGrowthLlm } from '../helpers/harness.mjs'

function tmpDir(prefix = 'dshp-rules') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('内生规则：加入/相似合并/结果校准/置信度过滤', () => {
  const t0 = 1000
  let result = addRule(emptyRules(), { scope: 'behavior', rule: '卡住的时候先做手边最小的一件事，不要坐着耗', trigger: '卡住' }, t0)
  assert.equal(result.added, true)
  result = addRule(result.rules, { scope: 'behavior', rule: '卡住时先做手边最小的一件事，别坐着耗', trigger: '卡住' }, t0 + 1)
  assert.equal(result.merged, true)
  const entry = result.rules.entries[0]
  assert.equal(entry.evidence, 2)
  const before = entry.confidence
  const updated = recordRuleOutcome(result.rules, entry.id, false, t0 + 2)
  assert.ok(updated.rules.entries[0].confidence < before)
  const applicable = applicableRules(updated.rules, '又卡住了', { limit: 3 })
  assert.equal(applicable.length, 1)
  assert.match(digestRules(updated.rules, { context: '卡住' })[0], /最小的一件事/)
  assert.equal(normalizeRules({ entries: [{ rule: '' }] }).entries.length, 0)
})

test('规则总结：解析 JSON 数组/对象、prompt 含经验材料', () => {
  const rules = parseRuleProposal(JSON.stringify([{ scope: 'social', rule: '他情绪不好的时候先接住，不急着讲道理', trigger: '他低落' }]))
  assert.equal(rules.length, 1)
  assert.equal(rules[0].scope, 'social')
  const fromObject = parseRuleProposal(JSON.stringify({ rules: [{ scope: 'language', rule: '说具体的动作和物件，少用形容词', trigger: '' }] }))
  assert.equal(fromObject[0].scope, 'language')
  const prompt = buildRuleSynthesisPrompt({ thoughts: ['今天又卡住了'], actions: ['先擦了桌子'], methods: ['从矛盾入手'] })
  assert.match(prompt, /今天又卡住了/)
  assert.match(prompt, /先擦了桌子/)
  assert.match(prompt, /第一人称/)
})

test('规则总结服务：从最近材料里长规则并写 journal', async () => {
  const dir = tmpDir()
  const rules = createInternalRules({ file: path.join(dir, 'rules.json'), now: () => 5000 })
  const llm = makeGrowthLlm([
    JSON.stringify([{ scope: 'behavior', rule: '卡住的时候先做手边最小的一件事，不要坐着耗', trigger: '卡住' }]),
  ])
  const thoughts = []
  const synthesizer = createRuleSynthesizer({
    env: {},
    rules,
    getLlm: () => llm,
    policy: { resolveCandidates: () => [{ provider: 'mock', model: 'mock' }] },
    logger: { warn() {}, info() {} },
    journal: { append: async (entry) => thoughts.push(entry) },
    thoughtChain: { chainDigest: () => ['先分清再做'] },
    methodMemory: { digest: () => ['「矛盾分析」：从矛盾入手'] },
    habitMemory: { snapshot: () => ({ entries: 2, top: [{ action: '擦桌子', situation: '有点空' }] }) },
    recall: { recentThoughts: () => ['今天又卡住了'] },
    now: () => 5000,
  })
  const result = await synthesizer.runOnce()
  assert.equal(result.ok, true)
  assert.equal(result.added.length, 1)
  assert.ok(thoughts.some((entry) => /我给自己留了条规则/.test(entry.text)))
  assert.equal(rules.list().length, 1)
  const empty = createRuleSynthesizer({ env: {}, rules, logger: { warn() {} } })
  const skipped = await empty.runOnce()
  assert.equal(skipped.skipped, true)
})

test('情绪状态：事件累加 + 衰减 + 时段/饥饿基线 + 标签', () => {
  const t0 = new Date('2026-11-09T10:00:00+08:00').getTime()
  let state = updateAffect(emptyAffect(), { valence: 0.6, arousal: 0.7, weight: 0.8, tag: '踏实' }, t0)
  assert.ok(state.valence > 0)
  const later = effectiveAffect(state, { at: t0 + 30 * 60 * 60 * 1000 })
  assert.ok(Math.abs(later.valence) < Math.abs(state.valence), '过了一天多应衰减')
  const immediate = effectiveAffect(state, { at: t0 })
  const hungry = effectiveAffect(state, { at: t0, selfState: { lastMealAt: t0 - 9 * 3600 * 1000 } })
  assert.ok(hungry.valence < immediate.valence)
  assert.ok(hungry.reasons.includes('空腹'))
  assert.equal(affectLabel(-0.6, 0.7), '绷着/烦')
  assert.equal(affectLabel(-0.4, 0.2), '低落/没什么力气')
  const lines = formatAffectLines({ valence: -0.3, arousal: 0.7, label: '绷着/烦', reasons: ['空腹'] })
  assert.ok(lines.some((line) => line.includes('底层状态')))
  const dir = tmpDir()
  const store = createAffectState({ file: path.join(dir, 'affect.json'), now: () => t0 })
  store.update({ valence: -0.4, arousal: 0.5, weight: 0.6, tag: '内疚' })
  assert.ok(store.effective().valence < 0)
})
