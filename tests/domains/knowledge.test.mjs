// tests/domains/knowledge.test.mjs —— 认知图谱扩散激活 + 夜间巩固（v3.10）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  emptyGraph,
  formatSpreadingDigest,
  normalizeGraph,
  spreadActivation,
} from '../../lib/domain/knowledge/knowledge-graph.mjs'
import {
  collectRecentLearning,
  consolidateGraphState,
} from '../../lib/domain/knowledge/nightly-consolidation.mjs'

function makeTmpDir(prefix = 'dshp-knowledge') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

const DEMO_GRAPH = normalizeGraph({
  nodes: [
    { id: 'n1', name: '党锢', type: 'event', summary: '东汉士人遭禁锢' },
    { id: 'n2', name: '黄巾', type: 'event', summary: '东汉末年民变' },
    { id: 'n3', name: '吕强', type: 'person', summary: '中常侍，建议大赦' },
  ],
  edges: [
    { id: 'e1', from: '黄巾', to: '党锢', relation: 'causal', note: '黄巾起后解禁', confidence: 'high' },
    { id: 'e2', from: '吕强', to: '党锢', relation: 'causal', note: '进言', confidence: 'medium' },
  ],
  claims: [{ id: 'c1', text: '黄巾起后，吕强建议大赦，党锢才解。', nodes: ['吕强', '党锢'], confidence: 'medium' }],
})

test('扩散激活：种子命中后沿关系扩散，一跳节点带 via', () => {
  const result = spreadActivation(DEMO_GRAPH, '党锢之祸怎么解开的')
  assert.ok(result.seeds.includes('党锢'))
  const names = result.nodes.map((node) => node.name)
  assert.ok(names.includes('党锢'))
  assert.ok(names.includes('黄巾') || names.includes('吕强'), '应激活至少一个邻居')
  const neighbor = result.nodes.find((node) => node.name !== '党锢')
  assert.ok(neighbor.activation > 0)
  assert.equal(neighbor.via.hop, 1)
  assert.ok(neighbor.via.from)
  assert.ok(formatSpreadingDigest(result).length > 0)
})

test('扩散激活：不相关查询返回空，不硬塞', () => {
  const result = spreadActivation(DEMO_GRAPH, '量子色动力学胶子禁闭')
  assert.equal(result.nodes.length, 0)
  assert.equal(formatSpreadingDigest(result).length, 0)
})

test('夜间巩固：合并近似节点、校准判断置信度', () => {
  const graph = normalizeGraph({
    nodes: [
      { id: 'a', name: '黄册', type: 'institution', summary: '户籍册' },
      { id: 'b', name: '黄册册', type: 'institution', summary: '户籍簿册', aliases: ['黄册'] },
      { id: 'c', name: '鱼鳞图册', type: 'institution', summary: '田亩册' },
    ],
    edges: [{ id: 'e', from: '黄册册', to: '鱼鳞图册', relation: 'part_of', confidence: 'high' }],
    claims: [
      { id: 'h', text: '黄册是户籍册。', nodes: ['黄册'], confidence: 'high', sources: [1] },
      { id: 'l', text: '鱼鳞图册是田亩册。', nodes: ['鱼鳞图册'], confidence: 'low', sources: [1, 2, 3] },
    ],
  })
  const { graph: next, stats } = consolidateGraphState(graph)
  assert.equal(stats.mergedNodes, 1)
  assert.equal(next.nodes.length, 2)
  assert.equal(next.claims[0].confidence, 'medium', '单来源 high 降为 medium')
  assert.equal(next.claims[1].confidence, 'medium', '多来源 low 升为 medium')
  assert.ok(next.nodes.some((node) => node.name === '黄册' || node.name === '黄册册'))
})

test('collectRecentLearning：按时间过滤 learning-log 段', () => {
  const dir = makeTmpDir('learning')
  const file = path.join(dir, 'learning-log.md')
  fs.writeFileSync(
    file,
    [
      '## 2026-11-09 10:00 · 自学',
      'Q: 党锢是怎么解开的？',
      '答：黄巾起后，吕强建议大赦。',
      '',
      '## 2026-11-09 12:00 · 溜达',
      '地方：東西橋（ja.wikipedia.org）',
      '',
      '## 2026-11-08 09:00 · 读小说',
      '作品：故乡',
      '',
    ].join('\n'),
  )
  const recent = collectRecentLearning(file, new Date(2026, 10, 9, 8, 0, 0).getTime())
  assert.equal(recent.length, 1)
  assert.equal(recent[0].kind, '自学')
  assert.match(recent[0].title, /党锢/)
  const all = collectRecentLearning(file, 0)
  assert.equal(all.length, 2, '自学+读小说，溜达不算学习')
})

test('夜间巩固：检测同一节点上的极性/年份冲突', async () => {
  const { detectClaimConflicts } = await import('../../lib/domain/knowledge/nightly-consolidation.mjs')
  const graph = normalizeGraph({
    nodes: [{ id: 'n', name: '党锢', type: 'event', summary: '东汉党锢' }],
    claims: [
      { id: 'a', text: '党锢是黄巾起后才解开的。', nodes: ['党锢'], confidence: 'medium' },
      { id: 'b', text: '党锢不是黄巾起后才解开的。', nodes: ['党锢'], confidence: 'low' },
      { id: 'c', text: '党锢在184年解禁。', nodes: ['党锢'], confidence: 'low' },
      { id: 'd', text: '党锢在168年解禁。', nodes: ['党锢'], confidence: 'low' },
    ],
  })
  const conflicts = detectClaimConflicts(graph)
  assert.ok(conflicts.some((item) => item.reason === 'negation'))
  assert.ok(conflicts.some((item) => item.reason === 'year'))
})
