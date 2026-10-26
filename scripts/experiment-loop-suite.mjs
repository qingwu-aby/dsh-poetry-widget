// scripts/experiment-loop-suite.mjs —— 顺序覆盖打转场景的统一实验任务（v2.19）。
//
// 一个任务、一条时间线、顺序执行：
//   A 固定事件重复 → 事件饱和是否生效
//   B 同一事件换说法 → 能否绕过精确 topic
//   C 只反刍不行动 → 有没有任何机制停住
//   D 碎碎念循环 → 叙事层是否饱和
//   E 作品生成循环 → 产出层是否饱和
//
// 输出 JSON 报告到 docs/experiments/loop-suite-<date>.json，并打印摘要。
// 不联网、不调用真实模型；真实模块 + 脚本化 LLM。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSelfDrive } from '../lib/self-drive.mjs'
import { createSelfEvents } from '../lib/self-events.mjs'
import { createSelfTalkService } from '../lib/self-talk.mjs'
import { createSelfWorks } from '../lib/self-works.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DAY = new Date().toISOString().slice(0, 10).replace(/-/g, '')

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

function makeState() {
  let felt = ''
  let experiencing = ''
  return {
    snapshot: () => ({ sleeping: false, felt, experiencing, lastActionAt: null }),
    setFelt: (text) => { felt = text },
    setExperiencing: (text) => { experiencing = text },
    markChecked() {},
    applyEvent() {},
  }
}

function makeDrive(prefix, responder, events, clockRef) {
  const dir = makeDir(prefix)
  const state = makeState()
  const llm = makeMockLlm(responder)
  const drive = createSelfDrive({
    state,
    llm,
    events,
    actionsPath: path.join(dir, 'self-actions.json'),
    policy: { resolveCandidates: (role) => (role === 'drive' ? [{ provider: 'p', model: 'm' }] : []) },
    logger: { warn() {}, info() {} },
    now: () => clockRef.value,
    minGapMs: 0,
    checkMinMs: 1,
    checkMaxMs: 2,
    firstMinMs: 0,
    firstMaxMs: 0,
  })
  drive.load()
  return { drive, llm, state }
}

async function runPhase(prefix, responder, events, clockRef, checks) {
  const { drive } = makeDrive(prefix, responder, events, clockRef)
  let actions = 0
  let pauses = 0
  for (let i = 0; i < checks; i += 1) {
    clockRef.value += 10_000
    const result = await drive.check(clockRef.value)
    if (result && result.action) actions += 1
    if (result && result.paused) pauses += 1
  }
  drive.dispose()
  return { actions, pauses }
}

const clock = { value: 1_700_000_000_000 }
const dir = makeDir('dshp-suite-')
const events = createSelfEvents({ file: path.join(dir, 'events.json'), now: () => clock.value, logger: { warn() {} } })

const phases = []

// A：固定事件重复
{
  const r = await runPhase(
    'phase-a',
    () => JSON.stringify({ felt: '我还想再试一次。', doing: '再尝一口两碗汤', topic: '两碗汤的咸淡' }),
    events,
    clock,
    6,
  )
  phases.push({ id: 'A', label: '固定事件重复', ...r, satiated: events.describe(clock.value).satiated, topic: events.describe(clock.value).topic })
}

// B：同一事件换说法（独立事件环境；模型承认 eventRelation=same）
{
  const bareEvents = createSelfEvents({ file: path.join(dir, 'events-b.json'), now: () => clock.value, logger: { warn() {} } })
  const aliases = ['盐和换水温的时机', '尝两口到底分不分得出', '两碗汤到底哪碗咸', '汤面油花和咸味的关系', '搅动次数与咸淡', '先放盐还是后放盐']
  const r = await runPhase(
    'phase-b',
    (options, n) => JSON.stringify({
      felt: '还是在想那两碗汤。',
      doing: '再试那两碗汤',
      topic: aliases[(n - 1) % aliases.length],
      eventRelation: n === 1 ? 'new' : 'same',
    }),
    bareEvents,
    clock,
    aliases.length,
  )
  phases.push({ id: 'B', label: '同一事件换说法（关系=same）', ...r, currentTopic: bareEvents.describe(clock.value).topic, bypass: r.pauses === 0, satiated: bareEvents.describe(clock.value).satiated })
}

// C：只反刍，不行动（新的空事件环境，观察动作/反刍通道）
{
  const bareEvents = createSelfEvents({ file: path.join(dir, 'events-c.json'), now: () => clock.value, logger: { warn() {} } })
  const r = await runPhase(
    'phase-c',
    () => JSON.stringify({ felt: '那两碗汤还在脑子里。', doing: '', experiencing: '两碗汤的咸淡一直在我脑子里转。' }),
    bareEvents,
    clock,
    4,
  )
  phases.push({ id: 'C', label: '只反刍不行动', ...r, satiated: bareEvents.describe(clock.value).satiated })
}

// D：碎碎念循环 + 共享事件状态（叙事通道也计入 engagement）
{
  const dEvents = createSelfEvents({ file: path.join(dir, 'events-d.json'), now: () => clock.value, logger: { warn() {} } })
  dEvents.observe('两碗汤的咸淡', clock.value)
  const dLines = [
    '汤面上的油花散开又聚拢。',
    '窗外的车声过去，屋里更静了。',
    '杯口的水汽凉了一点。',
    '桌角的纸被风掀起来又落下。',
    '我想起下午那阵光斜着照进来。',
    '椅子腿在地板上挪了半寸。',
  ]
  const llm = makeMockLlm((options, n) => dLines[(n - 1) % dLines.length])
  const service = createSelfTalkService({
    llm,
    events: dEvents,
    getSelection: () => ({ provider: 'p', model: 'm' }),
    policy: { resolveCandidates: (role) => (role === 'selfTalk' ? [{ provider: 'p', model: 'm' }] : []) },
    now: () => clock.value,
    minIntervalMs: 0,
    timeoutMs: 300,
    logger: { warn() {} },
  })
  const outputs = []
  for (let i = 0; i < 7; i += 1) {
    clock.value += 60_000
    const result = await service.generate({ kind: 'murmur', moodLabel: '安静', recent: [] })
    outputs.push(result && result.line ? result.line : '')
  }
  const lastCall = llm.calls.length > 0 ? llm.calls[llm.calls.length - 1] : null
  const lastPrompt =
    lastCall && lastCall.messages && lastCall.messages[0] && lastCall.messages[0].content && lastCall.messages[0].content[0] && typeof lastCall.messages[0].content[0].text === 'string'
      ? lastCall.messages[0].content[0].text
      : ''
  phases.push({
    id: 'D',
    label: '碎碎念循环（共享事件状态）',
    generations: llm.calls.length,
    outputs,
    satiated: dEvents.describe(clock.value).satiated,
    warned: lastPrompt.includes('已经说够了'),
    stopped: false,
  })
}

// E：作品生成循环
{
  const llm = makeMockLlm(() => JSON.stringify({ title: '两碗汤', kind: 'text', body: '汤面上那层油又凝住了。' }))
  const works = createSelfWorks({
    dir: path.join(dir, 'works'),
    llm,
    policy: { resolveCandidates: () => [{ provider: 'p', model: 'm' }] },
    now: () => clock.value,
    logger: { warn() {} },
  })
  for (let i = 0; i < 4; i += 1) {
    clock.value += 60_000
    await works.makeNow({ idea: '两碗汤的咸淡' })
  }
  phases.push({ id: 'E', label: '作品生成循环', works: works.list(10).length, stopped: false })
}

const summary = {
  task: 'loop-scope-suite',
  ranAt: new Date().toISOString(),
  phases,
  effective: {
    actionLayer: phases[0].pauses > 0 && phases[1].bypass !== true,
    relabelBypass: phases[1].bypass === true,
    ruminationStopped: phases[2].pauses > 0,
    selfTalkStopped: phases[3].stopped === true,
    worksStopped: phases[4].stopped === true,
  },
}

const outDir = path.join(ROOT, 'docs', 'experiments')
mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `loop-suite-${DAY}.json`)
writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf8')

console.log('Loop scope suite（顺序覆盖）\n')
console.log('| 阶段 | 场景 | 动作/生成 | 暂停 | 结论 |')
console.log('|---|---|---|---|---|')
for (const phase of phases) {
  if (phase.id === 'D') console.log(`| ${phase.id} | ${phase.label} | ${phase.generations} 次生成 | 0 | ${phase.satiated ? '叙事已饱和' : '无饱和'}${phase.warned ? '，prompt 已提示' : ''}（仍会生成） |`)
  else if (phase.id === 'E') console.log(`| ${phase.id} | ${phase.label} | ${phase.works} 件 | 0 | 无饱和 |`)
  else if (phase.id === 'C') console.log(`| ${phase.id} | ${phase.label} | ${phase.actions} | ${phase.pauses} | 无动作可停 |`)
  else console.log(`| ${phase.id} | ${phase.label} | ${phase.actions} | ${phase.pauses} | ${phase.id === 'A' ? (phase.pauses > 0 ? '会停（随后关闭事件）' : '没停') : phase.bypass ? '换壳绕过' : '停/已闭合'} |`)
}
console.log(`\n报告：${path.relative(ROOT, outPath)}`)
