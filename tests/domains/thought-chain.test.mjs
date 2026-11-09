// tests/domains/thought-chain.test.mjs —— 判断账本 + 思维链（v3.13）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildThoughtChainPrompt,
  createThoughtChain,
  digestPositions,
  emptyPositions,
  parseThoughtChain,
  recordPosition,
} from '../../lib/domain/learning/thought-chain.mjs'

function tmpDir(prefix = 'dshp-thought') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('思维链：解析 JSON、步骤过滤、prompt 含问题/前提/检验', () => {
  const chain = parseThoughtChain(
    JSON.stringify({
      trigger: '读到“矛盾是事物发展的动力”',
      steps: [
        { kind: 'question', text: '我现在卡住的事到底是什么？' },
        { kind: 'premise', text: '我把“做好”和“做完”混在了一起。' },
        { kind: 'judgment', text: '先分清这两件事，再决定先做哪个。' },
      ],
      conclusion: '先把目标拆成“做完”和“做好”，再选。',
      method: '矛盾分析',
      test: '这周记录一次：做完但没做好的事，看是不是目标没分清。',
    }),
  )
  assert.equal(chain.method, '矛盾分析')
  assert.equal(chain.steps.length, 3)
  const prompt = buildThoughtChainPrompt({ concern: '我卡住了', materials: ['矛盾论'], methods: ['矛盾分析'] })
  assert.match(prompt, /问题是什么/)
  assert.match(prompt, /怎么检验/)
  assert.match(prompt, /矛盾论/)
})

test('判断账本：同主题更新、立场改变保留旧条目并标 superseded', () => {
  const t0 = 1000
  let result = recordPosition(emptyPositions(), { claim: '先做完比做好重要', stance: 'accept', reason: '卡住时先推进' }, t0)
  result = recordPosition(result.positions, { claim: '先做完比做好重要', stance: 'accept', reason: '卡住时先推进，之后再补' }, t0 + 1)
  assert.equal(result.positions.entries.length, 1)
  result = recordPosition(result.positions, { claim: '先做完比做好重要', stance: 'reject', reason: '方向错了做完也没用' }, t0 + 2)
  assert.equal(result.positions.entries.length, 2)
  const old = result.positions.entries.find((entry) => entry.stance === 'accept')
  assert.ok(old.supersededBy)
  const digest = digestPositions(result.positions)
  assert.ok(digest.some((line) => line.includes('反对')))
})

test('判断/思维链持久化：写入文件，journal 有“想清楚一件事”', async () => {
  const dir = tmpDir()
  const thoughts = []
  const store = createThoughtChain({
    positionsFile: path.join(dir, 'positions.json'),
    chainsFile: path.join(dir, 'chains.jsonl'),
    journal: { append: async (entry) => thoughts.push(entry) },
    now: () => 5000,
  })
  store.recordPosition({ claim: '读原文比读二手解释重要', stance: 'accept', reason: '二手会漏掉论证' })
  const saved = await store.saveChain({
    trigger: '读完一本二手解释',
    steps: [{ kind: 'argument', text: '二手解释省事但会漏论证' }],
    conclusion: '以后先读原文的论证，再看解释。',
    method: '回到原典',
    test: '下次先读原文两页，再读解释。',
  })
  assert.equal(saved, true)
  assert.ok(fs.existsSync(path.join(dir, 'positions.json')))
  assert.ok(fs.existsSync(path.join(dir, 'chains.jsonl')))
  assert.ok(thoughts.some((entry) => /想清楚一件事/.test(entry.text)))
  assert.ok(store.chainDigest(2).some((line) => line.includes('回到原典') || line.includes('先读原文')))
})
