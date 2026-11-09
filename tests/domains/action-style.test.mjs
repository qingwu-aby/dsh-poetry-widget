// tests/domains/action-style.test.mjs —— 动作策略权重 + 旧句子语言参照（v3.16）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  bucketOf,
  createActionPolicy,
  emptyPolicy,
  normalizePolicy,
  recordAction,
  suggestActions,
  digestActions,
} from '../../lib/domain/being/action-policy.mjs'
import {
  createStyleExemplars,
  pickExemplars,
} from '../../lib/domain/voice/style-exemplars.mjs'

function tmpDir(prefix = 'dshp-action') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('动作策略：按情境桶记账、成功率高者优先、探索项仍有机会', () => {
  const t0 = new Date('2026-11-09T10:00:00+08:00').getTime()
  const bucket = bucketOf('有点空的时候', t0)
  let result = recordAction(emptyPolicy(), { kind: 'learn', bucket, ok: true }, t0)
  result = recordAction(result.policy, { kind: 'learn', bucket, ok: true }, t0 + 1)
  result = recordAction(result.policy, { kind: 'probe', bucket, ok: false }, t0 + 2)
  const suggestions = suggestActions(result.policy, { bucket, at: t0 + 3, limit: 8 })
  assert.equal(suggestions[0].kind, 'learn')
  assert.ok(suggestions[0].rate > suggestions.find((item) => item.kind === 'probe').rate)
  assert.ok(digestActions(result.policy, { bucket, at: t0 + 3 }).some((line) => line.includes('learn')))
  assert.equal(normalizePolicy({ entries: [{ kind: 'bad-kind', bucket: 'x', attempts: 1 }] }).entries.length, 0)
})

test('动作策略服务：写入文件后可读回，情境桶含时段', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'policy.json')
  const policy = createActionPolicy({ file, now: () => new Date('2026-11-09T09:00:00+08:00').getTime() })
  policy.record({ kind: 'make', bucket: bucketOf('想动手做点东西'), ok: true })
  const reopen = createActionPolicy({ file })
  assert.ok(reopen.suggest('想动手做点东西', { kinds: ['make', 'probe'] }).some((item) => item.kind === 'make'))
  assert.match(bucketOf('x'), /\|/)
})

test('旧句子参照：过滤技术词/过短，去重且排除最近说过的话', () => {
  const candidates = [
    '窗边那盆绿萝又冒出一片新叶子，我盯着看了一会儿。',
    '窗边那盆绿萝又冒出一片新叶子，我盯着看了一会儿。',
    '提示词里那条规则又让我别扭了。',
    '嗯',
    '今天风有点大，楼下晾的被子被吹得老高。',
    '刚才把水杯碰倒了，擦了半天。',
  ]
  const picked = pickExemplars(candidates, { limit: 3, exclude: ['刚才把水杯碰倒了，擦了半天。'] })
  assert.equal(picked.length, 2)
  assert.ok(picked[0].includes('绿萝'))
  assert.ok(!picked.join('').includes('提示词'))
})

test('旧句子服务：从 journal/chat-history 读取并去重', () => {
  const dir = tmpDir()
  const journal = path.join(dir, 'journal.jsonl')
  const chat = path.join(dir, 'chat-history.json')
  fs.writeFileSync(
    journal,
    [
      JSON.stringify({ kind: 'thought', text: '今天的云压得很低，像要下雨又没下。' }),
      JSON.stringify({ kind: 'murmur', text: '今天的云压得很低，像要下雨又没下。' }),
      JSON.stringify({ kind: 'mood', text: '心里有点空，说不上来为什么。' }),
    ].join('\n'),
  )
  fs.writeFileSync(chat, JSON.stringify({ gui: [{ role: 'whale', text: '刚把窗关上，风小一点了。' }] }))
  const store = createStyleExemplars({ journalPath: journal, chatHistoryPath: chat, now: () => 1000 })
  const picked = store.pick({ limit: 3 })
  assert.ok(picked.length >= 2)
  assert.ok(picked.some((line) => line.includes('云压得很低')))
  assert.ok(picked.some((line) => line.includes('风小一点')))
  assert.equal(new Set(picked).size, picked.length)
})
