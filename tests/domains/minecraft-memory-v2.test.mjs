// tests/domains/minecraft-memory-v2.test.mjs —— 四层记忆：台账 / 情景 / 汇总 / 叙事（v1.77）
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LEDGER_ACTORS, createMemoryV2 } from '../../lib/domain/play/minecraft-memory-v2.mjs'

const HOUR = 3600 * 1000
const MODULE_PATH = new URL('../../lib/domain/play/minecraft-memory-v2.mjs', import.meta.url)

/** 建一套临时目录里的记忆，时钟可手动推进。 */
function makeMemory(options = {}) {
  const dir = options.dir ?? mkdtempSync(path.join(os.tmpdir(), 'dshp-memory-v2-'))
  let clock = options.clock ?? new Date(2026, 0, 5, 12, 0, 0).getTime()
  const memory = createMemoryV2({
    dir,
    now: () => clock,
    legacyFiles: options.legacyFiles,
  })
  return {
    dir,
    memory,
    now: () => clock,
    advance: (ms) => {
      clock += ms
      return clock
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('L1 台账：缺 actor 或 actor 非法一律抛错', () => {
  const { memory, cleanup } = makeMemory()
  assert.deepEqual(LEDGER_ACTORS, ['self', 'reflex', 'lease'])
  assert.throws(() => memory.appendLedger({ kind: 'join', text: '进服了' }), /actor_required/)
  assert.throws(() => memory.appendLedger({ actor: 'robot', kind: 'join', text: '进服了' }), /actor_required/)
  assert.throws(() => memory.appendLedger({ actor: 42, kind: 'join' }), /actor_required/)
  assert.throws(() => memory.appendLedger(null), /actor_required/)
  cleanup()
})

test('L1 台账：一天一个 jsonl，只追加，且永不进 prompt', () => {
  const { memory, dir, advance, cleanup } = makeMemory()
  const first = memory.appendLedger({ actor: 'self', kind: 'mine', text: '挖了三块煤' })
  const files = readdirSync(path.join(dir, 'ledger'))
  assert.equal(files.length, 1)
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/)
  assert.equal(path.basename(first.file), files[0])

  advance(24 * HOUR)
  memory.appendLedger({ actor: 'reflex', kind: 'retreat', text: '躲开僵尸退到屋里' })
  assert.equal(readdirSync(path.join(dir, 'ledger')).length, 2)

  const lines = readFileSync(path.join(dir, 'ledger', files[0]), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).kind, 'mine')

  memory.remember({ actor: 'self', salience: 80, kind: 'mine', text: '挖了三块煤' })
  const prompt = memory.promptLines(3).join('\n')
  assert.ok(prompt.includes('挖了三块煤'))
  assert.ok(!prompt.includes('躲开僵尸退到屋里'))
  cleanup()
})

test('L2 情景：只收 self；低 salience 与 24 小时内重复文本都被拒', () => {
  const { memory, advance, cleanup } = makeMemory()
  assert.deepEqual(memory.remember({ actor: 'reflex', salience: 90, kind: 'retreat', text: '躲过僵尸' }), {
    ok: false,
    reason: 'actor',
  })
  assert.deepEqual(memory.remember({ actor: 'lease', salience: 90, kind: 'mine', text: '替主人挖矿' }), {
    ok: false,
    reason: 'actor',
  })
  assert.deepEqual(memory.remember({ actor: 'self', salience: 5, kind: 'event', text: '一点小事' }), {
    ok: false,
    reason: 'salience',
  })
  assert.deepEqual(memory.remember({ actor: 'self', kind: 'event', text: '没有显著度' }), {
    ok: false,
    reason: 'salience',
  })

  const saved = memory.remember({ actor: 'self', salience: 70, kind: 'event', text: '第一次见到羊' })
  assert.equal(saved.ok, true)
  assert.equal(typeof saved.id, 'string')
  assert.deepEqual(memory.remember({ actor: 'self', salience: 95, kind: 'event', text: '第一次见到羊' }), {
    ok: false,
    reason: 'duplicate',
  })

  advance(25 * HOUR)
  assert.equal(memory.remember({ actor: 'self', salience: 70, kind: 'event', text: '第一次见到羊' }).ok, true)
  cleanup()
})

test('L2 情景：最多留 300 条，按显著度 × 新鲜度淘汰低分', () => {
  const { memory, advance, cleanup } = makeMemory()
  for (let i = 0; i < 305; i += 1) {
    advance(1000)
    memory.remember({ actor: 'self', salience: 30 + (i % 60), kind: 'event', text: `第 ${i} 件小事` })
  }
  const { episodic } = memory.stats()
  assert.ok(episodic <= 300, `L2 条数应 ≤300，实际 ${episodic}`)
  assert.ok(episodic >= 1)
  cleanup()
})

test('promptLines：条数 ≤ limit+1、每条 ≤60 字、台账内容不出现', () => {
  const { memory, cleanup } = makeMemory()
  memory.appendLedger({ actor: 'self', kind: 'join', text: '台账绝密 join 记录' })
  const longText =
    '在矿洞深处遇到一群僵尸，边退边打，最后躲进一个废弃矿井里，点火把把整条通道插满，天亮以后才敢爬上来，身上只剩半颗心，背包里的铁矿全掉进了岩浆'
  memory.remember({ actor: 'self', salience: 95, kind: 'event', text: longText })
  memory.remember({ actor: 'self', salience: 60, kind: 'event', text: '学会了用工作台做木镐' })
  memory.remember({ actor: 'self', salience: 40, kind: 'event', text: '在河边看到一条鱼' })
  memory.remember({ actor: 'self', salience: 30, kind: 'event', text: '把箱子摆到家门口' })

  const lines = memory.promptLines(3)
  assert.ok(lines.length <= 4, `总条数应 ≤ limit+1，实际 ${lines.length}`)
  assert.equal(lines.length, 3)
  assert.ok(lines[0].startsWith('在矿洞深处'))
  assert.match(lines[0], /…$/)
  assert.ok(Array.from(lines[0]).length <= 60, 'L2 每条 ≤60 字')
  for (const line of lines) assert.ok(!line.includes('台账绝密'), 'L1 台账不应进 prompt')

  assert.ok(memory.promptLines(1).length <= 2)
  assert.equal(memory.promptLines(0).length, 0)
  cleanup()
})

test('promptLines：L4 叙事整段最多 1 条，且 ≤200 字', () => {
  const { memory, cleanup } = makeMemory()
  const chars = '一只会写诗的小鲸鱼'.repeat(5)
  memory.rewriteNarrative({ identity: chars, doing: '在给自己的小屋装门', world: '橡木林', recent: '学会了用工作台' })
  memory.remember({ actor: 'self', salience: 80, kind: 'event', text: '今天把门装好了' })
  const lines = memory.promptLines(3)
  assert.equal(lines.length, 2)
  const narrativeLine = lines[lines.length - 1]
  assert.ok(Array.from(narrativeLine).length <= 200, 'L4 整段 ≤200 字')
  assert.ok(!narrativeLine.includes('<!--'))
  assert.match(narrativeLine, /在给自己的小屋装门/)
  cleanup()
})

test('rewriteNarrative：整篇重写而非追加，第二次更短则文件变短', () => {
  const { memory, dir, cleanup } = makeMemory()
  const first = memory.rewriteNarrative({
    identity: '一只在服务器里活下去的小鲸鱼',
    doing: '白天砍树晚上挖矿',
    world: '一片橡木林，附近有条河',
    recent: '昨天第一次盖成带门的小屋',
  })
  const file = path.join(dir, 'narrative.md')
  const big = readFileSync(file, 'utf8')
  assert.match(big, /<!-- rewritten-at: \d+ -->/)
  assert.ok(first > 0 && first <= 200)

  const second = memory.rewriteNarrative({ recent: '刚醒' })
  const small = readFileSync(file, 'utf8')
  assert.ok(small.length < big.length, '第二次内容更短时文件应变短')
  assert.ok(second < first)
  assert.ok(!small.includes('橡木林'), '重写应把旧段落整段替换掉')
  assert.equal(small.trimEnd().split('\n').length, 2, '一行注释 + 一行正文')
  assert.equal(second, memory.stats().narrativeChars)
  cleanup()
})

test('summarizeActor：把反射流水压成一句中文摘要，并从 sinceAt 起算', () => {
  const { memory, now, advance, cleanup } = makeMemory()
  const sinceAt = now() - 2 * HOUR
  memory.appendLedger({ actor: 'reflex', kind: 'retreat', at: sinceAt - HOUR, text: '更早的一次后退' })
  for (let i = 0; i < 3; i += 1) {
    memory.appendLedger({ actor: 'reflex', kind: 'retreat', at: now(), text: `第 ${i} 次躲开怪物` })
    advance(60 * 1000)
  }
  memory.appendLedger({ actor: 'reflex', kind: 'eat', at: now(), text: '啃了面包' })
  memory.appendLedger({ actor: 'reflex', kind: 'eat', at: now(), text: '又啃了面包' })
  memory.appendLedger({ actor: 'self', kind: 'mine', at: now(), text: '自己挖了矿' })

  const summary = memory.summarizeActor('reflex', sinceAt)
  assert.equal(summary.count, 5)
  assert.deepEqual(summary.kinds, { retreat: 3, eat: 2 })
  assert.equal(typeof summary.sentence, 'string')
  assert.match(summary.sentence, /靠反射/)
  assert.match(summary.sentence, /躲过 3 次危险/)
  assert.match(summary.sentence, /吃了 2 次东西/)

  const empty = memory.summarizeActor('lease', sinceAt)
  assert.deepEqual(empty, { count: 0, kinds: {}, sentence: '' })
  cleanup()
})

test('stats：字段齐全、比例两位小数且数值合理', () => {
  const { memory, cleanup } = makeMemory()
  const zero = memory.stats()
  assert.deepEqual(Object.keys(zero).sort(), ['episodic', 'ledgerToday', 'narrativeChars', 'salientRatio'])
  assert.deepEqual(zero, { ledgerToday: 0, episodic: 0, narrativeChars: 0, salientRatio: 0 })

  for (let i = 0; i < 3; i += 1) memory.appendLedger({ actor: 'reflex', kind: 'eat', text: `第 ${i} 次吃东西` })
  memory.remember({ actor: 'self', salience: 60, kind: 'event', text: '看见一只狐狸' })
  memory.rewriteNarrative({ identity: '一只小鲸鱼' })

  const s = memory.stats()
  assert.equal(s.ledgerToday, 3)
  assert.equal(s.episodic, 1)
  assert.ok(s.narrativeChars > 0)
  assert.equal(s.salientRatio, 0.25)
  assert.ok(s.salientRatio >= 0 && s.salientRatio <= 1)
  assert.ok(Number.isInteger(s.salientRatio * 100), 'salientRatio 只保留两位小数')
  cleanup()
})

test('cleanupNoise：删 join/出生点噪声、去重、保留失败记录并留备份', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dshp-memory-v2-'))
  const legacy = path.join(dir, 'legacy-notes.md')
  const original = [
    '# 旧记忆',
    '出生点大约在 0 64 0',
    '（join）玩家进来了',
    '验证实验：试了三种挖矿路线',
    '验证实验：试了三种挖矿路线',
    '陷阱测试失败 ✗',
    '好记性：羊在河边',
    '好记性：羊在河边',
    '',
  ].join('\n')
  writeFileSync(legacy, original, 'utf8')
  const { memory, cleanup } = makeMemory({ dir, legacyFiles: [legacy] })

  const result = memory.cleanupNoise()
  assert.equal(result.length, 1)
  assert.equal(result[0].file, legacy)
  assert.ok(result[0].after < result[0].before)

  const cleaned = readFileSync(legacy, 'utf8')
  assert.ok(!cleaned.includes('出生点大约'))
  assert.ok(!cleaned.includes('（join）'))
  assert.ok(!cleaned.includes('验证实验：试了三种挖矿路线'))
  assert.ok(cleaned.includes('陷阱测试失败 ✗'), '失败记录要留下')
  assert.equal(cleaned.split('好记性：羊在河边').length, 2, '重复行只留一次')
  assert.ok(cleaned.startsWith('# 旧记忆'))

  const archives = readdirSync(path.join(dir, 'archive'))
  assert.equal(archives.length, 1)
  assert.match(archives[0], /^legacy-notes\.md\.\d+\.bak$/)
  assert.equal(readFileSync(path.join(dir, 'archive', archives[0]), 'utf8'), original)

  // 再跑一次：没有可删的行，不该再产生备份
  const again = memory.cleanupNoise()
  assert.equal(again[0].before, again[0].after)
  assert.equal(readdirSync(path.join(dir, 'archive')).length, 1)

  // 不存在的旧文件直接跳过
  const ghost = createMemoryV2({ dir, legacyFiles: [path.join(dir, '不存在的.md')] })
  assert.deepEqual(ghost.cleanupNoise(), [])
  cleanup()
})

test('模块约束：≤800 行，只 import node: 内置模块', () => {
  const source = readFileSync(MODULE_PATH, 'utf8')
  assert.ok(source.split('\n').length <= 800, `模块应 ≤800 行，实际 ${source.split('\n').length}`)
  const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
  assert.ok(specifiers.length > 0)
  for (const spec of specifiers) assert.ok(spec.startsWith('node:'), `不允许的外部依赖：${spec}`)
})
