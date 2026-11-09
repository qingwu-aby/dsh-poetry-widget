// tests/domains/emotion-habits.test.mjs —— 情绪评价 + 习惯记忆（v3.11）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  appraiseLearningEntry,
  createAppraisalLoop,
  formatAppraisal,
  readLearningEntries,
} from '../../lib/domain/emotion/appraisal.mjs'
import {
  createHabitMemory,
  emptyHabits,
  recordHabit,
  suggestHabits,
} from '../../lib/domain/being/habit-memory.mjs'

function tmpDir(prefix = 'dshp-emotion') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('appraisal：成功/失败/不确定映射到不同情绪与效价', () => {
  const success = appraiseLearningEntry({ kind: '自主研究', title: '黄册与鱼鳞图册', body: '我读到了正文，确认了登记单位。' })
  assert.equal(success.valence > 0, true)
  assert.ok(['踏实', '有点亮'].includes(success.emotion))
  assert.ok(success.intensity > 0)

  const failed = appraiseLearningEntry({ kind: '自学', title: '党锢解禁年份', body: '查了几次都没找到，材料不可用。' })
  assert.ok(failed.valence < 0)
  assert.ok(['闷', '不甘'].includes(failed.emotion))
  assert.ok(failed.dimensions.certainty < 0.4)

  const uncertain = appraiseLearningEntry({ kind: '自主研究', title: '卫所钱从哪来', body: '材料说不好，只有目录，没法确认。' })
  assert.equal(uncertain.emotion, '悬着')
  assert.ok(formatAppraisal(uncertain, { title: '卫所钱从哪来' }).includes('悬着'))
})

test('appraisal loop：只评价新条目、写入情绪线程并推进游标', async () => {
  const dir = tmpDir('appraisal-loop')
  const log = path.join(dir, 'learning-log.md')
  const stateFile = path.join(dir, 'appraisal-state.json')
  fs.writeFileSync(
    log,
    [
      '## 2026-11-09 10:00 · 自学',
      'Q: 一条足够长的学习标题是什么',
      '答：找到了正文，可以做判断。',
      '',
    ].join('\n'),
  )
  const records = []
  const thoughts = []
  const loop = createAppraisalLoop({
    learningLogPath: log,
    emotional: { record: (entry) => records.push(entry) },
    journal: { append: async (entry) => thoughts.push(entry) },
    env: {},
    stateFile,
    now: () => new Date(2026, 10, 9, 11, 0, 0).getTime(),
  })
  const first = await loop.runOnce({ since: new Date(2026, 10, 9, 9, 0, 0).getTime() })
  assert.equal(first.scanned, 1)
  assert.equal(records.length, 1)
  assert.ok(thoughts.length >= 1)
  const second = await loop.runOnce()
  assert.equal(second.scanned, 0, '游标推进后不重复评价')
})

test('habit：情境→动作→结果记账、成功率与建议', () => {
  const t0 = 1000000000
  let result = recordHabit(emptyHabits(), { situation: '有点空的时候', action: '翻两页书', ok: true }, t0)
  result = recordHabit(result.habits, { situation: '有点空的时候', action: '翻两页书', ok: true }, t0 + 1000)
  result = recordHabit(result.habits, { situation: '有点空的时候', action: '擦桌子', ok: false }, t0 + 2000)
  assert.equal(result.habits.entries.length, 2)
  const book = result.habits.entries.find((entry) => entry.action === '翻两页书')
  assert.equal(book.attempts, 2)
  assert.equal(book.successes, 2)
  const hints = suggestHabits(result.habits, { situation: '有点空的时候', at: t0 + 3000 })
  assert.ok(hints.some((line) => line.includes('翻两页书')))
  assert.ok(hints.some((line) => /100% 成|成过/.test(line)))
})

test('habit service：写入文件后还能读回建议', () => {
  const dir = tmpDir('habits')
  const file = path.join(dir, 'habits.json')
  const habits = createHabitMemory({ file, now: () => 1000 })
  habits.record({ situation: '早上', action: '先看一眼窗外', ok: true })
  const reopen = createHabitMemory({ file, now: () => 2000 })
  assert.ok(reopen.suggest('早上', 2).some((line) => line.includes('先看一眼窗外')))
})
