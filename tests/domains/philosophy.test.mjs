// tests/domains/philosophy.test.mjs —— 哲学阅读 / 方法论账本（v3.12）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  PHILOSOPHY_SOURCES,
  buildPhilosophyPrompt,
  fetchPhilosophyBook,
  isJunkPhilosophyFile,
  listPhilosophyBooks,
  parsePhilosophyReply,
  pickPhilosophyExcerpt,
  seedPhilosophyBooks,
} from '../../lib/domain/learning/self-philosophy.mjs'
import { createMethodMemory, digestMethods, recordMethod } from '../../lib/domain/learning/method-memory.mjs'
import { makeGrowthLlm } from '../helpers/harness.mjs'

function tmpDir(prefix = 'dshp-philosophy') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

const LONG_TEXT = Array.from({ length: 12 }, (_, index) => `这是第${index + 1}段正文，足够长到会被当作文本段落保留下来，说明一个论证的层次和前提。`).join('\n')

function makeFetchMock({ books = [{ path: '康德/未来形而上学导论.txt', type: 'blob', size: 1000 }], text = LONG_TEXT } = {}) {
  return async (url) => {
    if (String(url).includes('api.github.com')) {
      return { ok: true, url, json: async () => ({ tree: books }) }
    }
    if (String(url).includes('raw.githubusercontent.com')) {
      return { ok: true, url, text: async () => text }
    }
    return { ok: false, url }
  }
}

test('哲学会列目录：只保留可读文本、跳过 junk/超大文件，并有种子兜底', async () => {
  const books = await listPhilosophyBooks({
    fetchImpl: makeFetchMock({
      books: [
        { path: '康德/纯批.txt', type: 'blob', size: 1000 },
        { path: '康德/纯批.pdf', type: 'blob', size: 1000 },
        { path: '封面.txt', type: 'blob', size: 1000 },
        { path: '大文件.txt', type: 'blob', size: 9 * 1024 * 1024 },
      ],
    }),
    sources: [PHILOSOPHY_SOURCES[0]],
  })
  assert.equal(books.length, 1)
  assert.equal(books[0].title, '纯批')
  const seeds = seedPhilosophyBooks()
  assert.ok(seeds.length >= 10)
  assert.ok(seeds.every((book) => book.path.endsWith('.txt')))
  assert.equal(isJunkPhilosophyFile('目录.txt'), true)
})

test('哲学会取正文、截段、生成四步 prompt 并能解析 JSON', async () => {
  const fetched = await fetchPhilosophyBook({
    fetchImpl: makeFetchMock(),
    book: { repo: 'JuneFreer/philosophy-book', branch: 'master', path: '康德/未来形而上学导论.txt' },
  })
  assert.ok(fetched.text.length > 200)
  const excerpt = pickPhilosophyExcerpt(fetched.text, 1)
  assert.ok(excerpt.length > 40)
  const prompt = buildPhilosophyPrompt({ title: '未来形而上学导论', excerpt, methods: ['「辩证法」：从矛盾入手'] })
  assert.match(prompt, /按四步读/)
  assert.match(prompt, /辩证法/)
  const parsed = parsePhilosophyReply(
    JSON.stringify({ question: '先天综合判断如何可能？', claim: '有先天综合判断。', argument: '数学与自然科学已经包含它。', objection: '经验论会说没有。', ownView: '我还没判断。', method: { name: '先验论证', howTo: '从经验的可能性反推必要条件' } }),
  )
  assert.equal(parsed.method.name, '先验论证')
  assert.equal(parsed.ownView, '我还没判断。')
})

test('哲学阅读 runOnce：读一段、写学习日志、记方法、推进状态', async () => {
  const dir = tmpDir()
  const log = path.join(dir, 'learning-log.md')
  const statePath = path.join(dir, 'philosophy-state.json')
  const methodsFile = path.join(dir, 'methods.json')
  const llm = makeGrowthLlm([
    JSON.stringify({ question: '先天综合判断如何可能？', claim: '有先天综合判断。', argument: '数学与自然科学已经包含它。', objection: '经验论会说没有。', ownView: '我还没判断。', method: { name: '先验论证', howTo: '从经验的可能性反推必要条件' } }),
  ])
  const { createSelfPhilosophy } = await import('../../lib/domain/learning/self-philosophy.mjs')
  const methodMemory = createMethodMemory({ file: methodsFile })
  const thoughts = []
  const service = createSelfPhilosophy({
    env: {},
    getLlm: () => llm,
    policy: { resolveCandidates: () => [{ provider: 'mock', model: 'mock' }] },
    logger: { warn() {}, info() {} },
    journal: { append: async (entry) => thoughts.push(entry) },
    methodMemory,
    learningLogPath: log,
    statePath,
    fetchImpl: makeFetchMock(),
    now: () => new Date('2026-11-09T10:00:00+08:00').getTime(),
  })
  const result = await service.runOnce({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.method.name, '先验论证')
  const logText = fs.readFileSync(log, 'utf8')
  assert.match(logText, /· 哲学/)
  assert.match(logText, /方法：先验论证/)
  assert.equal(thoughts.length, 1)
  assert.match(thoughts[0].text, /读哲学/)
  assert.ok(methodMemory.digest(2).some((line) => line.includes('先验论证')))
  service.dispose()
})

test('方法论账本：同名去重、使用次数、失败不记 success', () => {
  const t0 = 1000
  let result = recordMethod({ entries: [] }, { name: '辩证法', howTo: '从矛盾入手找主要方面', source: '黑格尔' }, t0)
  result = recordMethod(result.methods, { name: '辩证法', howTo: '从矛盾入手找主要方面', source: '黑格尔', worked: true }, t0 + 1)
  assert.equal(result.methods.entries.length, 1)
  assert.equal(result.methods.entries[0].usedCount, 2)
  assert.equal(result.methods.entries[0].successCount, 1)
  const digest = digestMethods(result.methods)
  assert.match(digest[0], /辩证法/)
})
