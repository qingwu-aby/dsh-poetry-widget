// scripts/experiment-loop-scope.mjs —— 打转/饱和机制的有效范围实验（v2.17+）。
//
// 不联网、不调用真实模型；用脚本化 LLM 驱动真实模块，观察：
// 1) 同一主题同一动作：是否被事件饱和停住？
// 2) 同一事件换 topic 标签：是否绕过？
// 3) 只反刍、不行动：是否有任何机制停住？
// 4) 碎碎念/叙事循环：是否有饱和？
// 5) 作品生成循环：是否有饱和？
//
// 运行：node scripts/experiment-loop-scope.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSelfDrive } from '../lib/self-drive.mjs'
import { createSelfEvents } from '../lib/self-events.mjs'
import { createSelfTalkService } from '../lib/self-talk.mjs'
import { createSelfWorks } from '../lib/self-works.mjs'

function makeMockLlm(responder) {
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      return (async function* iterator() {
        const value = await (typeof responder === 'function' ? responder(options, calls.length) : responder)
        if (typeof value === 'string') yield { type: 'text-delta', index: 0, text: value }
        yield { type: 'finish', reason: 'stop' }
      })()
    },
  }
}

function makeDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function makeDriveHarness(prefix, responder) {
  let clock = 1_700_000_000_000
  const dir = makeDir(prefix)
  const llm = makeMockLlm(responder)
  const events = createSelfEvents({ file: path.join(dir, 'events.json'), now: () => clock, logger: { warn() {} } })
  const state = {
    snapshot: () => ({ sleeping: false, felt: '', lastActionAt: null }),
    setFelt() {},
    setExperiencing() {},
    markChecked() {},
    applyEvent() {},
  }
  const drive = createSelfDrive({
    state,
    llm,
    events,
    actionsPath: path.join(dir, 'self-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => clock,
    minGapMs: 0,
    checkMinMs: 1,
    checkMaxMs: 2,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  return { drive, events, advance: (ms = 10_000) => (clock += ms), now: () => clock }
}

async function runDriveScenario(name, responder, checks = 6) {
  const h = makeDriveHarness(`dshp-exp-${name}-`, responder)
  let actions = 0
  let pauses = 0
  for (let i = 0; i < checks; i += 1) {
    h.advance(10_000)
    const result = await h.drive.check(h.now())
    if (result && result.action) actions += 1
    if (result && result.paused) pauses += 1
  }
  h.drive.dispose()
  return { actions, pauses, events: h.events.snapshot() }
}

function formatEvents(events) {
  const current = events.current
  return current
    ? `${current.topic}（attempts=${current.attempts}, salience=${current.salience.toFixed(2)}, satiated=${current.satiatedAt !== null}）`
    : '无'
}

const scenarios = []

scenarios.push({
  id: 'A',
  label: '同一主题 + 同一动作',
  result: await runDriveScenario('same', () =>
    JSON.stringify({
      felt: '我还想再尝一次，虽然已经试过好几回。',
      doing: '再尝一口两碗汤',
      topic: '两碗汤的咸淡',
    }),
  ),
})

const relabelTopics = ['两碗汤的咸淡', '盐和换水温的时机', '尝两口到底分不分得出', '两碗汤到底哪碗咸', '汤面油花和咸味的关系', '搅动次数与咸淡', '先放盐还是后放盐', '水温对化盐速度的影响']
scenarios.push({
  id: 'B',
  label: '同一事件，换 topic 标签',
  result: await runDriveScenario(
    'relabel',
    (options, n) => {
      const topic = relabelTopics[(n - 1) % relabelTopics.length]
      return JSON.stringify({ felt: '我还是在琢磨那两碗汤，换了个说法。', doing: '再试一次那两碗汤', topic })
    },
  ),
})

scenarios.push({
  id: 'C',
  label: '只反刍，不行动',
  result: await runDriveScenario('rumination', () =>
    JSON.stringify({
      felt: '我还是在想那两碗汤，但什么也没做。',
      doing: '',
      experiencing: '两碗汤的咸淡一直在我脑子里转。',
    }),
  ),
})

// 碎碎念/叙事层：同一上下文反复生成，观察是否有饱和（只统计模型调用与输出）。
{
  let clock = 1_700_000_000_000
  const llm = makeMockLlm(() => '汤面上那层油又凝住了，我盯着它看了一会儿。')
  const service = createSelfTalkService({
    llm,
    getSelection: () => ({ provider: 'p', model: 'm' }),
    policy: { resolveCandidates: (role) => (role === 'selfTalk' ? [{ provider: 'p', model: 'm' }] : []) },
    now: () => clock,
    minIntervalMs: 0,
    timeoutMs: 300,
    logger: { warn() {} },
  })
  const lines = []
  for (let i = 0; i < 4; i += 1) {
    clock += 60_000
    const result = await service.generate({ kind: 'murmur', moodLabel: '安静', recent: [] })
    lines.push(result && result.line ? result.line : '(无)')
  }
  scenarios.push({
    id: 'D',
    label: '碎碎念/叙事层（同一上下文）',
    result: { calls: llm.calls.length, outputs: lines, stopped: false },
  })
}

// 作品层：同一 idea 反复生成，观察是否有饱和。
{
  let clock = 1_700_000_000_000
  const dir = makeDir('dshp-exp-works-')
  const llm = makeMockLlm(() =>
    JSON.stringify({ title: '两碗汤', kind: 'text', body: '汤面上那层油又凝住了，我盯着它看了一会儿。' }),
  )
  const works = createSelfWorks({ dir, llm, now: () => clock, policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] }, logger: { warn() {} } })
  for (let i = 0; i < 4; i += 1) {
    clock += 60_000
    await works.makeNow({ idea: '两碗汤的咸淡' })
  }
  scenarios.push({
    id: 'E',
    label: '作品/背景生成层（同一 idea）',
    result: { works: works.list(10).length, stopped: false },
  })
}

console.log('实验：打转/饱和机制的有效范围\n')
console.log('| # | 场景 | 执行动作 | 暂停 | 事件状态 | 结论 |')
console.log('|---|---|---|---|---|---|')
for (const item of scenarios) {
  const r = item.result
  if (item.id === 'A' || item.id === 'B' || item.id === 'C') {
    const stopped = r.pauses > 0
    const verdict = item.id === 'A' ? (stopped ? '会停' : '没停') : item.id === 'B' ? (stopped ? '意外停' : '换壳绕过') : '没有动作可停'
    console.log(`| ${item.id} | ${item.label} | ${r.actions} | ${r.pauses} | ${formatEvents(r.events)} | ${verdict} |`)
  } else if (item.id === 'D') {
    console.log(`| ${item.id} | ${item.label} | ${r.calls} 次生成 | 0 | 不适用 | 没有饱和，一直说 |`)
  } else {
    console.log(`| ${item.id} | ${item.label} | ${r.works} 件作品 | 0 | 不适用 | 没有饱和，一直产 |`)
  }
}
console.log('\n说明：A/B/C 用真实 self-drive + self-events；D 用 self-talk；E 用 self-works。全部脚本化模型，不联网。')
