#!/usr/bin/env node
// 端到端回归：真起创意服 → 布置场景 → 跑 bot 场景 → 断言回执诚实性。
// 用法：node e2e-regression.mjs [场景名...]
import { spawn, execSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import net from 'node:net'

const ROOT = new URL('.', import.meta.url).pathname
const SERVER_DIR = `${ROOT}verify-server`
const PORT = 25567
const RCON_PORT = 25576
const RCON_PASS = 'whale-verify-rcon'

const FLAT = ['fill 90 99 90 130 99 130 minecraft:grass_block', 'fill 90 100 90 130 112 130 minecraft:air']

const SCENARIOS = {
  find_missing: { checks: 'ok=false', fixture: ['tp XiaoJingyu 105 100 105', 'clear XiaoJingyu'] },
  craft_with_far_table: {
    checks: 'ok=true',
    fixture: ['tp XiaoJingyu 100 100 100', 'clear XiaoJingyu', 'give XiaoJingyu oak_planks 8', 'give XiaoJingyu stick 4', 'setblock 110 100 100 minecraft:crafting_table'],
  },
  shelter_full: {
    checks: 'ok=true',
    fixture: ['tp XiaoJingyu 105 100 105', 'clear XiaoJingyu', 'give XiaoJingyu dirt 120', 'give XiaoJingyu oak_door 1', 'give XiaoJingyu glass 8'],
  },
  escalate_find_log: {
    checks: 'ok=true',
    fixture: ['tp XiaoJingyu 105 100 105', 'clear XiaoJingyu', 'setblock 100 100 105 minecraft:birch_log', 'setblock 100 101 105 minecraft:birch_log'],
  },
  escalate_craft_table: {
    checks: 'ok=true',
    fixture: ['tp XiaoJingyu 105 100 105', 'clear XiaoJingyu', 'give XiaoJingyu oak_planks 12', 'give XiaoJingyu stick 8'],
  },
  shelter_low_material: { checks: 'ok=false', fixture: ['tp XiaoJingyu 105 100 105', 'clear XiaoJingyu', 'give XiaoJingyu dirt 12'] },
  assess_bare: { checks: 'ok=true score<=30', fixture: ['tp XiaoJingyu 105 100 105', 'clear XiaoJingyu'] },
  assess_room: {
    checks: 'ok=true score>=90',
    fixture: [
      ...Array.from({ length: 5 }, (_v, dx) => dx).flatMap((dx) => [100 + dx]).flatMap(() => []),
    ].length === 0 ? buildRoomFixture() : [],
  },
  hide_too_deep: {
    checks: 'ok=false',
    fixture: ['fill 100 48 100 110 48 110 minecraft:stone', 'fill 100 49 100 110 52 110 minecraft:air', 'tp XiaoJingyu 105 49 105'],
  },
  place_in_hole: {
    checks: 'ok=true',
    fixture: ['tp XiaoJingyu 105 100 105', 'clear XiaoJingyu', 'give XiaoJingyu dirt 8', 'fill 104 100 104 106 100 106 minecraft:air', 'fill 104 99 104 106 99 106 minecraft:dirt', 'fill 104 101 104 106 102 106 minecraft:dirt'],
  },
}

function buildRoomFixture() {
  const cmds = ['tp XiaoJingyu 110 100 110', 'clear XiaoJingyu']
  cmds.push('fill 105 99 105 115 99 115 minecraft:grass_block')
  cmds.push('fill 105 100 105 115 108 115 minecraft:air')
  for (let x = 108; x <= 112; x += 1) {
    for (let y = 100; y <= 102; y += 1) {
      for (let z = 108; z <= 112; z += 1) {
        const edge = x === 108 || x === 112 || z === 108 || z === 112
        if (edge) cmds.push(`setblock ${x} ${y} ${z} minecraft:dirt`)
      }
    }
  }
  for (let x = 108; x <= 112; x += 1) for (let z = 108; z <= 112; z += 1) cmds.push(`setblock ${x} 103 ${z} minecraft:dirt`)
  cmds.push('setblock 110 100 108 minecraft:oak_door')
  cmds.push('setblock 109 101 108 minecraft:glass', 'setblock 111 101 108 minecraft:glass')
  cmds.push('setblock 109 100 109 minecraft:chest', 'setblock 111 100 109 minecraft:furnace')
  cmds.push('setblock 109 100 111 minecraft:crafting_table', 'setblock 111 100 111 minecraft:red_bed')
  cmds.push('setblock 108 102 110 minecraft:torch')
  cmds.push('tp XiaoJingyu 110 100 110')
  return cmds
}

function rconPkt(id, type, body) {
  const payload = Buffer.from(body + '\0\0', 'utf8')
  const buf = Buffer.alloc(14 + payload.length)
  buf.writeInt32LE(10 + payload.length, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  payload.copy(buf, 12)
  return buf
}

async function rcon(cmds) {
  const sock = net.createConnection({ host: '127.0.0.1', port: RCON_PORT })
  await new Promise((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject) })
  let id = 1
  const outputs = []
  const send = (body) => new Promise((resolve) => {
    sock.write(rconPkt(++id, 2, body))
    sock.once('data', (chunk) => { outputs.push(chunk.slice(12).toString('utf8').replace(/\0+$/, '')); resolve() })
  })
  sock.write(rconPkt(id, 3, RCON_PASS))
  await new Promise((r) => sock.once('data', r))
  for (const cmd of cmds) await send(cmd)
  sock.end()
  return outputs
}

async function waitPlayer(name = 'XiaoJingyu', timeoutMs = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const out = (await rcon(['list'])).join(' ')
    if (out.includes(name)) return true
    await sleep(700)
  }
  return false
}

async function waitPort(port, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port })
      sock.once('connect', () => { sock.destroy(); resolve(true) })
      sock.once('error', () => resolve(false))
    })
    if (ok) return true
    await sleep(1000)
  }
  return false
}

function startServer() {
  const proc = spawn('./start.sh', [], { cwd: SERVER_DIR, stdio: ['ignore', 'ignore', 'ignore'], detached: true })
  proc.unref()
  return proc.pid
}

function stopServer() {
  for (const pattern of ['server.jar nogui']) {
    try { execSync(`pkill -f "${pattern}"`) } catch (_error) { void _error }
  }
}

function runBot(scenario) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      MC_HOST: '127.0.0.1', MC_PORT: String(PORT), MC_VERSION: '26.1',
      MC_VERIFY_SCENARIO: scenario, DSH_MC_HOST_TASKS: '0', MC_BRAIN_INTERVAL_MS: '600000', MC_AUTOBUILD: '0',
      MC_VERIFY_WAIT_MS: '15000',
    }
    const child = spawn(`${process.env.HOME}/.local/bin/node`, ['bot-play.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    child.stdout.on('data', (d) => { log += d.toString() })
    child.stderr.on('data', (d) => { log += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (_error) { void _error } }, 120000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      let result = null
      try { result = JSON.parse(readFileSync(`${ROOT}verify-e2e.json`, 'utf8')) } catch (_error) { result = null }
      rmSync(`${ROOT}verify-e2e.json`, { force: true })
      resolve({ code, result, log })
    })
  })
}

function checkAssertions(scenario, result) {
  const spec = SCENARIOS[scenario].checks
  const checks = []
  for (const part of spec.split(/\s+/).filter(Boolean)) {
    const m = part.match(/^([a-zA-Z]+)(>=|<=|=)(.+)$/)
    if (!m) continue
    const [, key, op, wantRaw] = m
    const want = wantRaw === 'true' ? true : wantRaw === 'false' ? false : Number(wantRaw)
    const facts = (result && result.facts) || {}
    const got = key === 'score' ? Number(facts.score) : key === 'ok' ? Boolean(result && result.pass !== undefined ? (result.checks || []).find((c) => c.name === 'ok')?.got : undefined) : undefined
    const pass = op === '=' ? got === want : op === '>=' ? got >= want : got <= want
    checks.push({ key, op, want, got, pass })
  }
  return checks
}

const wanted = process.argv.slice(2).filter((item) => !item.startsWith('--'))
const list = wanted.length > 0 ? wanted : Object.keys(SCENARIOS)
let failed = 0
const alreadyUp = await waitPort(PORT, 1500)
let startedByUs = false
if (!alreadyUp) {
  console.log('=== 启动创意验证服')
  startServer()
  startedByUs = true
  const ready = await waitPort(PORT, 90000)
  if (!ready) { console.log('✗ 服务器没起来'); process.exit(1) }
} else {
  console.log('=== 复用已在运行的验证服')
}
await rcon(['op XiaoJingyu', ...FLAT])
console.log('=== 服务器就绪，逐场景回归\n')
const rows = []
for (const scenario of list) {
  const spec = SCENARIOS[scenario]
  if (!spec) { console.log('跳过未知场景', scenario); continue }
  for (const file of ['shelter-mark.json', 'landmarks.json', 'verify-e2e.json', 'build-plan.json', 'plan-cache.json']) {
    rmSync(`${ROOT}${file}`, { force: true })
  }
  const botRun = runBot(scenario)
  const online = await waitPlayer('XiaoJingyu', 60000)
  if (!online) {
    const { log } = await botRun
    console.log(`✗ ${scenario.padEnd(22)} bot 没连上服务器`)
    if (log) console.log('   log:', log.split('\n').slice(-3).join(' | '))
    failed += 1
    rows.push({ scenario, pass: false, checks: [], detail: 'bot 未连接' })
    continue
  }
  const fixture = scenario === 'assess_room' ? buildRoomFixture() : spec.fixture
  const teleport = fixture.find((cmd) => cmd.startsWith('tp '))
  const rest = fixture.filter((cmd) => cmd !== teleport && cmd !== 'clear XiaoJingyu')
  await rcon(['op XiaoJingyu', ...FLAT])
  if (teleport) await rcon([teleport])
  await sleep(2500)                              // 等区块加载，否则 setblock/fill 会“位置未加载”
  await rcon(['clear XiaoJingyu', ...rest])
  await sleep(800)
  const { code, result, log } = await botRun
  const e2e = result || {}
  const detailOk = e2e.pass === true
  const expected = scenario === 'assess_room' || scenario === 'assess_bare'
  const checks = []
  const facts = e2e.facts || {}
  if (spec.checks.includes('ok=')) {
    const wantOk = spec.checks.includes('ok=true')
    const gotOk = (e2e.checks || []).find((c) => c.name === 'ok')?.got
    checks.push({ name: 'ok', pass: gotOk === wantOk, got: gotOk, want: wantOk })
  }
  const scoreMatch = spec.checks.match(/score(>=|<=)(\d+)/)
  if (scoreMatch) {
    const wantScore = Number(scoreMatch[2])
    const gotScore = Number(facts.score)
    const pass = scoreMatch[1] === '>=' ? gotScore >= wantScore : gotScore <= wantScore
    checks.push({ name: 'score', pass, got: gotScore, want: `${scoreMatch[1]}${wantScore}` })
  }
  const pass = checks.length > 0 && checks.every((c) => c.pass)
  if (!pass) failed += 1
  rows.push({ scenario, pass, checks, detail: String(e2e.detail || '').slice(0, 70) })
  console.log(`${pass ? '✓' : '✗'} ${scenario.padEnd(22)} ${checks.map((c) => `${c.name}:${c.pass ? '✓' : '✗(' + String(c.got) + ' want ' + String(c.want) + ')'}`).join(' ')}  ${String(e2e.detail || '').slice(0, 60)}`)
  if (!pass) console.log('   log:', log.split('\n').filter((l) => l.includes('回执') || l.includes('E2E')).slice(-3).join(' | '))
}
console.log('\n=== 结果：' + rows.filter((r) => r.pass).length + '/' + rows.length + ' 通过')
if (failed > 0) {
  console.log('\n失败明细：')
  for (const row of rows.filter((r) => !r.pass)) console.log(' -', row.scenario, JSON.stringify(row.checks))
}
if (startedByUs) stopServer()
process.exit(failed > 0 ? 1 : 0)
