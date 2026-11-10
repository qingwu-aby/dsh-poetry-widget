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

const LONG_TEXT = Array.from({ length: 12 }, (_, index) => `这是第${index + 1}段正文，这一段要足够长，才会被当作文本段落保留下来，用来说明一个论证的前提、层次和可以检验的结论。`).join('\n')

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
  assert.ok(thoughts.length >= 1)
  assert.ok(thoughts.some((entry) => /读哲学|读完/.test(entry.text)))
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

test('整本书分多次读完：进度推进到最后一段，合成总结合同并记判断/思维链', async () => {
  const dir = tmpDir('full-book')
  const log = path.join(dir, 'learning-log.md')
  const statePath = path.join(dir, 'philosophy-state.json')
  const longText = Array.from({ length: 320 }, (_, index) =>
    `第${index + 1}段：这是用于测试整本书阅读的正文段落，包含一个前提、一个论证层次和一个可以检验的判断，长度足够被切进同一块。`,
  ).join('\n')
  const replies = [
    JSON.stringify({ question: '第一段的问题是什么？', claim: '第一段主张', argument: '第一段的论证', objection: '第一段的反方', ownView: '第一段我的看法', method: { name: '辩证法', howTo: '从矛盾双方的关系入手' }, position: { stance: 'accept', claim: '矛盾比结论更值得看', reason: '结论会变，矛盾结构稳定' } }),
    JSON.stringify({ question: '第二段的问题是什么？', claim: '第二段主张', argument: '第二段的论证', objection: '第二段的反方', ownView: '第二段我的看法', method: { name: '怀疑法', howTo: '先悬置判断再找依据' }, position: { stance: 'open', claim: '先悬置判断', reason: '证据不够' } }),
    JSON.stringify({ question: '这本书在回答什么？', skeleton: '从矛盾出发重建判断。', accept: [{ claim: '先看矛盾结构', reason: '比抄结论有用' }], reject: [{ claim: '怀疑一切', reason: '会失去行动' }], open: [{ claim: '先验论证的边界', reason: '没读透' }], changed: '我以前只看结论，现在先看矛盾。', leftover: '矛盾分析能用到哪些日常事上？' }),
    JSON.stringify({ trigger: '读到矛盾分析', steps: [{ kind: 'question', text: '我卡住的是目标没分清？' }, { kind: 'premise', text: '我把做完和做好混了。' }, { kind: 'judgment', text: '先分清再做。' }], conclusion: '先分清目标，再决定顺序。', method: '矛盾分析', test: '记录一周卡住的时刻，看是不是老在同一种混。' }),
  ]
  const llm = makeGrowthLlm(replies)
  const { createSelfPhilosophy } = await import('../../lib/domain/learning/self-philosophy.mjs')
  const { createMethodMemory } = await import('../../lib/domain/learning/method-memory.mjs')
  const { createThoughtChain } = await import('../../lib/domain/learning/thought-chain.mjs')
  let clock = new Date('2026-11-09T09:00:00+08:00').getTime()
  const methodMemory = createMethodMemory({ file: path.join(dir, 'methods.json') })
  const thoughtChain = createThoughtChain({ positionsFile: path.join(dir, 'positions.json'), chainsFile: path.join(dir, 'chains.jsonl'), journal: { append: async () => {} } })
  const service = createSelfPhilosophy({
    env: {},
    getLlm: () => llm,
    policy: { resolveCandidates: () => [{ provider: 'mock', model: 'mock' }] },
    logger: { warn() {}, info() {} },
    journal: { append: async () => {} },
    methodMemory,
    thoughtChain,
    learningLogPath: log,
    statePath,
    fetchImpl: makeFetchMock({ text: longText }),
    now: () => clock,
    gapMs: 0,
  })
  const first = await service.runOnce({ force: true })
  assert.equal(first.completed, false)
  assert.equal(first.chunk, 1)
  clock += 2 * 60 * 60 * 1000
  const second = await service.runOnce({})
  assert.equal(second.completed, true)
  assert.equal(second.chunk, 2)
  assert.ok(second.synthesis && second.synthesis.changed.includes('矛盾'))
  const logText = fs.readFileSync(log, 'utf8')
  assert.match(logText, /哲学·总/)
  assert.match(logText, /思维链/)
  const positions = JSON.parse(fs.readFileSync(path.join(dir, 'positions.json'), 'utf8'))
  assert.ok(positions.entries.length >= 3)
  const chains = fs.readFileSync(path.join(dir, 'chains.jsonl'), 'utf8').trim().split('\n')
  assert.ok(chains.length >= 1)
  const snap = service.snapshot()
  assert.equal(snap.completed, 1)
  service.dispose()
})

test('心跳模式：start({heartbeat:true}) 后 tick 能真正读一段（不再被 heartbeatMode 卡死）', async () => {
  const dir = tmpDir('heartbeat')
  const log = path.join(dir, 'learning-log.md')
  const statePath = path.join(dir, 'philosophy-state.json')
  const llm = makeGrowthLlm([
    JSON.stringify({ question: '这段在问什么？', claim: '一个判断', argument: '一个论证', objection: '一个反方', ownView: '我的看法', method: { name: '辩证法', howTo: '从矛盾双方入手' }, position: { stance: 'accept', claim: '矛盾比结论更值得看', reason: '结构稳定' } }),
    JSON.stringify({ question: '总问题', skeleton: '骨架', accept: [{ claim: '接受一条判断', reason: '理由' }], reject: [], open: [], changed: '我变了', leftover: '留下的问题' }),
    JSON.stringify({ trigger: 't', steps: [{ kind: 'judgment', text: '先分清' }], conclusion: '先分清再做', method: '矛盾分析', test: '记录一周' }),
  ])
  const { createSelfPhilosophy } = await import('../../lib/domain/learning/self-philosophy.mjs')
  const { createMethodMemory } = await import('../../lib/domain/learning/method-memory.mjs')
  const { createThoughtChain } = await import('../../lib/domain/learning/thought-chain.mjs')
  const service = createSelfPhilosophy({
    env: {},
    getLlm: () => llm,
    policy: { resolveCandidates: () => [{ provider: 'mock', model: 'mock' }] },
    logger: { warn() {}, info() {} },
    journal: { append: async () => {} },
    methodMemory: createMethodMemory({ file: path.join(dir, 'methods.json') }),
    thoughtChain: createThoughtChain({ positionsFile: path.join(dir, 'positions.json'), chainsFile: path.join(dir, 'chains.jsonl'), journal: { append: async () => {} } }),
    learningLogPath: log,
    statePath,
    fetchImpl: makeFetchMock(),
    now: () => new Date('2026-11-09T10:00:00+08:00').getTime(),
    gapMs: 0,
  })
  service.start({ heartbeat: true })
  const tickResult = service.tick()
  assert.equal(tickResult.ok, true, 'heartbeat tick 应该真正触发阅读')
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.ok(fs.existsSync(statePath), '心跳模式应写出阅读进度')
  assert.ok(fs.existsSync(log), '心跳模式应写学习日志')
  service.dispose()
})

test('编码兜底：GB18030 的 txt 不会读成乱码', async () => {
  const { decodeBookBytes } = await import('../../lib/domain/learning/self-philosophy-core.mjs')
  // GBK 编码的「的中」重复：B5C4 D6D0（首字节 B5 不是合法 UTF-8 起始）
  const gbk = new Uint8Array(Array.from({ length: 600 }, (_, index) => [0xb5, 0xc4, 0xd6, 0xd0][index % 4]))
  assert.match(decodeBookBytes(gbk), /的中/)
  const fetched = await fetchPhilosophyBook({
    fetchImpl: async (url) => ({ ok: true, url, arrayBuffer: async () => gbk.buffer }),
    book: { repo: 'JuneFreer/philosophy-book', branch: 'master', path: 'x.txt' },
  })
  assert.ok(fetched && fetched.text.length >= 200)
  assert.match(fetched.text, /的中/)
})
