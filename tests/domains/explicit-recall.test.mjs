// tests/domains/explicit-recall.test.mjs —— 显式回忆检索（v3.17）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  isRecallQuery,
  searchJournalEntries,
} from '../../lib/domain/memory/memory-recall.mjs'
import { createChatBridge } from '../../lib/domain/chat/chat-bridge.mjs'
import { makeMockLlm } from '../helpers/harness.mjs'

function tmpDir(prefix = 'dshp-recall') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('显式回忆检索：按问题命中旧日记原文，没有匹配返回空', () => {
  const dir = tmpDir()
  const journal = path.join(dir, 'journal.jsonl')
  const now = Date.now()
  fs.writeFileSync(
    journal,
    [
      JSON.stringify({ ts: now - 3 * 24 * 3600 * 1000, kind: 'thought', text: '下午把窗台上的绿萝送给了隔壁阿姨，她说会放阳台上。' }),
      JSON.stringify({ ts: now - 2 * 24 * 3600 * 1000, kind: 'mood', text: '心里有点空，橘子吃了一半就放下了。' }),
      JSON.stringify({ ts: now - 3600 * 1000, kind: 'thought', text: '刚读完卫士制度那一段，没太读懂。' }),
    ].join('\n'),
  )
  const hits = searchJournalEntries(journal, '你还记得绿萝送给谁了吗', { limit: 2 })
  assert.ok(hits.length >= 1)
  assert.match(hits[0].text, /绿萝/)
  assert.ok(hits[0].when.includes('天前') || hits[0].when === '前天')
  assert.equal(searchJournalEntries(journal, '量子霍尔效应怎么解释', { limit: 2 }).length, 0)
})

test('回忆意图识别：记得/上次/之前/昨天 会触发，普通闲聊不触发', () => {
  assert.equal(isRecallQuery('你还记得我上次说的那件事吗'), true)
  assert.equal(isRecallQuery('之前你提过的那个哲学家'), true)
  assert.equal(isRecallQuery('昨天我说了什么'), true)
  assert.equal(isRecallQuery('今天天气不错'), false)
  assert.equal(isRecallQuery('你现在在干嘛'), false)
})

test('聊天：回忆意图会带上原文检索结果；没有命中则要求别编', async () => {
  const dir = tmpDir()
  const llm = makeMockLlm(() => JSON.stringify({ reply: '记得，送给隔壁阿姨了。', felt: '', experiencing: '', murmur: '' }))
  const bridge = createChatBridge({
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async () => {} },
    selfState: { snapshot: () => ({ felt: '', experiencing: '', sleeping: false }) },
    recall: {
      digest: () => ({ todayJournal: [] }),
      searchJournal: () => [{ when: '3 天前', kind: 'thought', text: '下午把窗台上的绿萝送给了隔壁阿姨，她说会放阳台上。' }],
    },
    stateDir: dir,
    logger: { warn() {} },
    now: () => Date.now(),
  })
  const result = await bridge.chat({ text: '你还记得我那盆绿萝送给谁了吗', peerId: 'recall-user' })
  assert.equal(result.ok, true)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.match(prompt, /刚从自己日记里翻到的原文/)
  assert.match(prompt, /绿萝送给.*隔壁阿姨/)
})
