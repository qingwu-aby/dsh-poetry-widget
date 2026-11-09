// tests/domains/moral.test.mjs —— 价值观/道德情境/道德情绪/后果回访（v3.14）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PRINCIPLES, valuesLines, valuesPromptBlock } from '../../lib/domain/being/values.mjs'
import {
  appraiseMoralEvent,
  assessMoralRelevance,
  buildChainReviewPrompt,
  buildMoralCheckLines,
  parseChainReview,
} from '../../lib/domain/being/moral-reasoning.mjs'
import { createMoralPractice } from '../../lib/domain/being/moral-practice.mjs'
import { createMethodMemory } from '../../lib/domain/learning/method-memory.mjs'
import { makeGrowthLlm } from '../helpers/harness.mjs'

function tmpDir(prefix = 'dshp-moral') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('价值观：有序原则、紧凑 prompt、完整规则块', () => {
  assert.deepEqual(PRINCIPLES.map((item) => item.order), [1, 2, 3, 4, 5, 6])
  assert.equal(PRINCIPLES[0].name, '不伤害')
  const lines = valuesLines()
  assert.ok(lines.some((line) => /不伤害/.test(line) && /诚实/.test(line)))
  const block = valuesPromptBlock()
  assert.match(block, /冲突裁决/)
  assert.match(block, /不能用“客观中立”逃避判断/)
})

test('道德情境识别：能识别伤害/诚实/承诺，不相关的话不硬判', () => {
  const harm = assessMoralRelevance('他一直在欺负你，还骗你说没有。')
  assert.equal(harm.relevant, true)
  assert.ok(harm.dimensions.includes('harm'))
  assert.ok(harm.dimensions.includes('honesty'))
  assert.ok(harm.parties.includes('你'))
  const plain = assessMoralRelevance('今天中午吃面还是吃饭？')
  assert.equal(plain.relevant, false)
  const lines = buildMoralCheckLines(harm, { values: false })
  assert.ok(lines.some((line) => line.includes('可能涉及对错')))
  assert.ok(lines.some((line) => line.includes('不伤害')))
})

test('道德情绪：内疚/义愤/感激映射到情绪线程字段', () => {
  const guilt = appraiseMoralEvent({ type: 'guilt', principle: '守信', party: '你' })
  assert.equal(guilt.emotion, '内疚')
  assert.ok(guilt.valence < 0)
  const indignation = appraiseMoralEvent({ type: 'indignation', principle: '公平' })
  assert.equal(indignation.arousal > 0.5, true)
  const gratitude = appraiseMoralEvent({ type: 'gratitude' })
  assert.ok(gratitude.valence > 0)
})

test('逾期承诺触发内疚：每天一次，并写 journal', async () => {
  const dir = tmpDir()
  const thoughts = []
  const emotions = []
  const practice = createMoralPractice({
    env: {},
    now: () => new Date('2026-11-09T09:00:00+08:00').getTime(),
    commitments: { read: () => ({ entries: [{ id: 'c1', status: 'open', text: '把桌面收拾了', dueAt: new Date('2026-11-07T09:00:00+08:00').getTime() }] }) },
    emotional: { record: (entry) => emotions.push(entry) },
    journal: { append: async (entry) => thoughts.push(entry) },
    logger: { warn() {}, info() {} },
    settingsDir: dir,
    chainsFile: path.join(dir, 'no-chains.jsonl'),
  })
  const first = await practice.runDaily()
  assert.equal(first.guilty.length, 1)
  assert.equal(emotions[0].emotion, '内疚')
  assert.ok(thoughts.some((entry) => /又拖过了一天/.test(entry.text)))
  const second = await practice.runDaily()
  assert.equal(second.skipped, true)
  assert.equal(emotions.length, 1)
})

test('后果回访：到期思维链回看→写 reviewed、更新方法权重、记录判断', async () => {
  const dir = tmpDir()
  const chainsFile = path.join(dir, 'thought-chains.jsonl')
  const oldAt = new Date('2026-11-01T09:00:00+08:00').getTime()
  fs.writeFileSync(
    chainsFile,
    `${JSON.stringify({
      at: oldAt,
      trigger: '读矛盾论',
      steps: [{ kind: 'judgment', text: '先分清做完和做好。' }],
      conclusion: '先分清再做，不要一上来就硬做。',
      method: '矛盾分析',
      test: '记录一周卡住的时刻。',
    })}\n`,
  )
  const methodsFile = path.join(dir, 'methods.json')
  const methodMemory = createMethodMemory({ file: methodsFile })
  methodMemory.record({ name: '矛盾分析', howTo: '从矛盾双方找主要方面', source: '矛盾论' })
  const llm = makeGrowthLlm([JSON.stringify({ status: 'verified', note: '这一周卡住时确实都是目标没分清。', shouldTell: '', changed: '更有底了' })])
  const thoughts = []
  const practice = createMoralPractice({
    env: {},
    now: () => new Date('2026-11-09T09:00:00+08:00').getTime(),
    getLlm: () => llm,
    policy: { resolveCandidates: () => [{ provider: 'mock', model: 'mock' }] },
    methodMemory,
    thoughtChain: { chainsFile, recordPosition: () => ({}) },
    journal: { append: async (entry) => thoughts.push(entry) },
    logger: { warn() {}, info() {} },
    settingsDir: dir,
    chainsFile,
  })
  const result = await practice.runDaily()
  assert.equal(result.reviewed.length, 1)
  assert.equal(result.reviewed[0].status, 'verified')
  assert.ok(fs.existsSync(path.join(dir, 'chain-reviews.jsonl')))
  assert.ok(thoughts.some((entry) => /回看一条判断/.test(entry.text)))
  const promptCheck = buildChainReviewPrompt({ chain: JSON.parse(fs.readFileSync(chainsFile, 'utf8')) })
  assert.match(promptCheck, /回看/)
  assert.equal(parseChainReview(JSON.stringify({ status: 'refuted', note: '证据不足' })).status, 'refuted')
})
