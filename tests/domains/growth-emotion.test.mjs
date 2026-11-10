// tests/domains/growth-emotion.test.mjs —— 成长时间 + 喜怒哀乐（v3.18）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  appraiseEmotionalEvent,
  createEmotionalEpisodes,
  emptyEpisodes,
  normalizeEpisodes,
  observeUserText,
} from '../../lib/domain/emotion/emotional-episodes.mjs'
import {
  GROWTH_STAGES,
  buildAutobiography,
  collectGrowthStats,
  computeGrowthStage,
  createGrowthArc,
} from '../../lib/domain/being/growth-arc.mjs'
import { createChatBridge } from '../../lib/domain/chat/chat-bridge.mjs'
import { makeMockLlm } from '../helpers/harness.mjs'

const DAY = 24 * 3600 * 1000
function tmpDir(prefix = 'dshp-growth') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('情绪事件：四族映射、有原因、可复发', async () => {
  assert.equal(appraiseEmotionalEvent({ type: 'user_hurt', cause: '他说我烦' }).family, '怒')
  assert.equal(appraiseEmotionalEvent({ type: 'user_warmth', cause: '他记得我' }).family, '喜')
  assert.equal(appraiseEmotionalEvent({ type: 'user_sadness', cause: '他很难过' }).label, '心疼')
  assert.equal(appraiseEmotionalEvent({ type: 'user_joke', cause: '他讲了个笑话' }).family, '乐')

  const dir = tmpDir()
  const records = []
  const affects = []
  const episodes = createEmotionalEpisodes({
    file: path.join(dir, 'episodes.json'),
    emotional: { record: (entry) => records.push(entry) },
    affect: { update: (entry) => affects.push(entry) },
    now: () => 1000,
  })
  await episodes.record({ type: 'learning_success', cause: '读懂了罗素的桌子' })
  await episodes.record({ type: 'learning_success', cause: '读懂了罗素的桌子' })
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'episodes.json'), 'utf8'))
  assert.equal(state.episodes.length, 1)
  assert.equal(state.episodes[0].count, 2)
  assert.equal(records.length, 2)
  assert.equal(affects.length, 2)
  assert.ok(episodes.digest(3).some((line) => line.includes('罗素的桌子')))
})

test('从用户一句话里察觉情绪事件', () => {
  assert.equal(observeUserText('谢谢你记得我', { at: 1000 }).type, 'user_warmth')
  assert.equal(observeUserText('滚，别烦我', { at: 1000 }).type, 'user_hurt')
  assert.equal(observeUserText('今天好累，想哭', { at: 1000 }).type, 'user_sadness')
  assert.equal(observeUserText('哈哈这也太逗了', { at: 1000 }).type, 'user_joke')
  assert.equal(observeUserText('隔了很久回来', { at: 10 * 3600 * 1000, previousAt: 0 }), null)
  assert.equal(observeUserText('隔了很久回来', { at: 10 * 3600 * 1000, previousAt: 1000 }).type, 'user_return')
})

test('成长统计与阶段：按她自己的天数 + 真实积累推进', () => {
  const dir = tmpDir()
  const now = 100 * DAY
  const journalPath = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(
    journalPath,
    Array.from({ length: 130 }, (_, index) =>
      JSON.stringify({ ts: now - (60 - index) * 3600 * 1000, kind: 'thought', text: `第${index}条想法` }),
    ).join('\n'),
  )
  const learningLog = path.join(dir, 'learning-log.md')
  fs.writeFileSync(learningLog, Array.from({ length: 45 }, (_, i) => `## 2026-11-0${(i % 9) + 1} 10:00 · 自学\n问题${i}`).join('\n'))
  const settings = path.join(dir, 'state')
  fs.mkdirSync(settings, { recursive: true })
  fs.writeFileSync(path.join(settings, 'worldview.json'), JSON.stringify({ essay: { version: 3 } }))
  fs.writeFileSync(path.join(settings, 'methods.json'), JSON.stringify({ entries: [{ name: 'a' }, { name: 'b' }] }))
  fs.writeFileSync(path.join(settings, 'positions.json'), JSON.stringify({ entries: [{ claim: 'x' }] }))
  const stats = collectGrowthStats({ now, journalPath, learningLogPath: learningLog, settingsDir: settings })
  assert.equal(stats.days, 2)
  const stage = computeGrowthStage(stats)
  assert.equal(stage.stage.id, 'looking_out')
  assert.ok(stage.milestones.some((item) => item.key === 'days'))

  const longJourney = { ...stats, days: 20, journalEntries: 131 }
  const advanced = computeGrowthStage(longJourney)
  assert.notEqual(advanced.stage.id, stage.stage.id)
  assert.ok(GROWTH_STAGES.some((item) => item.id === advanced.stage.id))
})

test('成长史：按周分章、引用她自己的句子、写真实统计', () => {
  const dir = tmpDir()
  const now = 20 * DAY
  const journalPath = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(
    journalPath,
    [
      JSON.stringify({ ts: now - 16 * DAY, kind: 'thought', text: '今天开始记得一些事了。' }),
      JSON.stringify({ ts: now - 8 * DAY, kind: 'thought', text: '我在想，桌上那些字到底算不算数，盯了好一会儿也没动。' }),
      JSON.stringify({ ts: now - 8 * DAY, kind: 'mood', reason: '心里有点没底。' }),
    ].join('\n'),
  )
  const stats = { days: 18, journalEntries: 3, learningEntries: 2, booksCompleted: 1, methodsCount: 3, positionsCount: 2, worldviewVersion: 2 }
  const stageInfo = computeGrowthStage({ ...stats, days: 20, journalEntries: 200, learningEntries: 50 })
  const text = buildAutobiography({ journalPath, learningLogPath: '', stats, stageInfo, now })
  assert.match(text, /小鲸鱼的成长史/)
  assert.match(text, /我在想，桌上那些字到底算不算数/)
  assert.match(text, /读完的书：1 本/)
})

test('成长弧服务：启动后写 growth-arc.json + 成长史', async () => {
  const dir = tmpDir()
  const now = 30 * DAY
  const journalPath = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(journalPath, JSON.stringify({ ts: now - 16 * DAY, kind: 'thought', text: '开始记住一点事。' }) + '\n', 'utf8')
  const settings = path.join(dir, 'state')
  fs.mkdirSync(settings, { recursive: true })
  const service = createGrowthArc({
    env: {},
    home: dir,
    settingsDir: settings,
    memoryDir: dir,
    journalPath,
    learningLogPath: path.join(dir, 'learning-log.md'),
    statePath: path.join(settings, 'growth-arc.json'),
    autobiographyPath: path.join(dir, 'autobiography.md'),
    journal: { append: async () => {} },
    now: () => now,
  })
  const state = await service.runOnce()
  assert.ok(state.stage)
  assert.ok(fs.existsSync(path.join(settings, 'growth-arc.json')))
  assert.ok(fs.existsSync(path.join(dir, 'autobiography.md')))
  assert.match(fs.readFileSync(path.join(dir, 'autobiography.md'), 'utf8'), /小鲸鱼的成长史/)
})

test('聊天会观察用户语句并产生情绪事件', async () => {
  const dir = tmpDir()
  const observed = []
  const llm = makeMockLlm(() => JSON.stringify({ reply: '嗯。', felt: '', experiencing: '', murmur: '' }))
  const bridge = createChatBridge({
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    journal: { append: async () => {} },
    selfState: { snapshot: () => ({ felt: '', experiencing: '', sleeping: false }) },
    recall: { digest: () => ({ todayJournal: [] }) },
    episodes: { observeUserText: async (text) => observed.push(text) },
    stateDir: dir,
    logger: { warn() {} },
    now: () => Date.now(),
  })
  await bridge.chat({ text: '谢谢你记得我', peerId: 'growth-test' })
  assert.equal(observed.length, 1)
})

test('成长阶段：读完半本或完成 1 个项目即可进入「把经验变成自己」', () => {
  const base = {
    days: 16,
    journalEntries: 400,
    learningEntries: 80,
    booksCompleted: 0,
    booksCredits: 0.65,
    projectsCompleted: 0,
    methodsCount: 5,
    positionsCount: 2,
    worldviewVersion: 5,
  }
  assert.equal(computeGrowthStage(base).stage.id, 'making_it_mine')
  assert.equal(computeGrowthStage({ ...base, booksCredits: 0.4, projectsCompleted: 1 }).stage.id, 'making_it_mine')
  assert.equal(computeGrowthStage({ ...base, booksCredits: 0.3 }).stage.id, 'own_direction')
})

test('每周成长报告：对比上周、统计阅读选择与情绪多样性', async () => {
  const { buildWeeklyReport } = await awaitImportGrowth()
  const now = 10 * 24 * 3600 * 1000
  const stats = { days: 16, journalEntries: 3300, learningEntries: 1320, booksCompleted: 0, booksCredits: 0.65, methodsCount: 5, positionsCount: 4, worldviewVersion: 16 }
  const report = buildWeeklyReport({
    stats,
    previousStats: { days: 9, journalEntries: 3000, learningEntries: 1280, methodsCount: 3, positionsCount: 2 },
    stageInfo: computeGrowthStage(stats),
    now,
    decisions: [
      { at: now - 1000, type: 'action', kind: 'learn', doing: '接着读那本书' },
      { at: now - 2000, type: 'idle' },
      { at: now - 3000, type: 'action', kind: 'drink', doing: '喝水' },
    ],
    episodes: [
      { at: now - 1000, family: '喜', label: '暖' },
      { at: now - 2000, family: '哀', label: '闷' },
      { at: now - 3000, family: '喜', label: '暖' },
    ],
  })
  assert.match(report, /每周成长报告/)
  assert.match(report, /接着读书.*\*\*1 次\*\*/)
  assert.match(report, /覆盖 2 族/)
  assert.match(report, /读书进度/)
})

async function awaitImportGrowth() {
  return import('../../lib/domain/being/growth-arc.mjs')
}

test('关系记忆按 peer 隔离：不同人的偏好/约定不串', async () => {
  const { formatRelationshipDigest, mergeRelationship, emptyRelationship } = await import('../../lib/domain/relationship/relationship-memory.mjs')
  const gui = mergeRelationship(emptyRelationship(), [{ kind: 'preference', text: '他喜欢晚上做事', confidence: 'high' }], 1000, 'gui')
  const other = mergeRelationship(gui.relationship, [{ kind: 'preference', text: '他喜欢早起跑步', confidence: 'high' }], 2000, 'friend-a')
  const guiDigest = formatRelationshipDigest(other.relationship, '晚上', 'gui').join('\n')
  const friendDigest = formatRelationshipDigest(other.relationship, '早起', 'friend-a').join('\n')
  assert.match(guiDigest, /晚上做事/)
  assert.ok(!guiDigest.includes('早起跑步'))
  assert.match(friendDigest, /早起跑步/)
  assert.ok(!friendDigest.includes('晚上做事'))
})
