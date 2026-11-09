#!/usr/bin/env node
// agent-loop/self-train.mjs —— 小鲸鱼的“自训练”闭环：收她最近的话 → 生成中性对照 → LoRA → 评估 → 过闸才换线上语言层。
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const LIB = process.env.WHALE_MLX_HOME || path.join(HOME, 'Library/Application Support/dsh-whale-mlx')
const DSH_HOME = process.env.WHALE_DSH_HOME || path.join(HOME, '.dsh')
const WORK = path.join(LIB, 'self-train')
const DATA = path.join(WORK, 'data')
const ADAPTERS = path.join(WORK, 'adapters')
const LIVE = path.join(LIB, 'adapters-live')
const MODEL = path.join(LIB, 'model-1.5b')
const STATE = path.join(WORK, 'state.json')
const REPORT = path.join(WORK, 'report.md')
const PY = path.join(HOME, '.venvs/mlx/bin/python3.12')
const MLX = path.join(HOME, '.venvs/mlx/bin/mlx_lm.lora')
const SERVER_PLIST = process.env.WHALE_MLX_PLIST || 'com.yangyuan.whale.mlx-server'
const JOURNAL = path.join(DSH_HOME, 'agent-memory/journal.jsonl')
const CHAT = path.join(DSH_HOME, '.dsh-poetry/chat-history.json')
const CREDS = path.join(DSH_HOME, '.credentials.yaml')

mkdirSync(DATA, { recursive: true })
mkdirSync(ADAPTERS, { recursive: true })
const creds = readFileSync(CREDS, 'utf8')
const key = (creds.match(/OPENCODE_GO_API_KEY:\s*(\S+)/) || [])[1]
if (!key) throw new Error('no OPENCODE_GO_API_KEY')

function sh(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: options.timeout || 120000, ...options })
  if (result.error) return { ok: false, error: String(result.error) }
  return { ok: result.status === 0, code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}
const launch = (args) => sh('launchctl', args)

function readState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return { lastTrainedAt: 0, runs: 0 } }
}
function saveState(next) {
  writeFileSync(STATE, JSON.stringify(next, null, 2) + '\n')
  appendFileSync(path.join(WORK, 'history.log'), `${new Date().toISOString()} ${JSON.stringify(next.lastResult || {})}\n`)
}

function collectTexts(state) {
  const texts = []
  try {
    for (const line of readFileSync(JOURNAL, 'utf8').trim().split('\n')) {
      try {
        const entry = JSON.parse(line)
        if (!(entry.ts >= state.lastTrainedAt)) continue
        if (entry.kind === 'mood' && typeof entry.reason === 'string') texts.push(entry.reason.trim())
        if (entry.kind === 'murmur' && typeof entry.text === 'string') texts.push(entry.text.trim())
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    const history = JSON.parse(readFileSync(CHAT, 'utf8'))
    for (const messages of Object.values(history)) {
      for (const m of Array.isArray(messages) ? messages : []) {
        if (m.role === 'whale' && typeof m.text === 'string' && m.at >= state.lastTrainedAt) texts.push(m.text.trim())
      }
    }
  } catch { /* ignore */ }
  return [...new Set(texts)].filter((text) => Array.from(text).length >= 8 && Array.from(text).length <= 160).slice(-200)
}

const SYSTEM = '你在做数据标注。把每句话改写成“平实、中性、信息等价”的一版：保留原意和具体事实，去掉个人语气和情绪词，不添加新信息，长度相近。只输出严格 JSON：{"sentences":["...","..."]}，数组长度顺序与输入一致。'
async function makePlain(texts) {
  const pairs = []
  const batches = []
  for (let start = 0; start < texts.length; start += 8) batches.push(texts.slice(start, start + 8))
  let index = 0
  async function worker() {
    while (index < batches.length) {
      const batch = batches[index]
      index += 1
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await fetch('https://opencode.ai/inference/go/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'x-opencode-session': 'selftrain-' + Date.now() },
            body: JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(batch) }], max_tokens: 8000, temperature: 0.3 }),
            signal: AbortSignal.timeout(120000),
          })
          if (!res.ok) continue
          const data = await res.json()
          const text = data?.choices?.[0]?.message?.content || ''
          const first = text.indexOf('{')
          const last = text.lastIndexOf('}')
          let parsed = null
          if (first >= 0 && last > first) { try { parsed = JSON.parse(text.slice(first, last + 1)) } catch {} }
          const sentences = Array.isArray(parsed?.sentences) ? parsed.sentences : []
          if (sentences.length !== batch.length) continue
          for (let i = 0; i < batch.length; i += 1) {
            const plain = String(sentences[i] || '').replace(/\s+/g, ' ').trim()
            if (plain.length >= 4) pairs.push({ plain, her: batch[i] })
          }
          console.log('plain progress', index, '/', batches.length, 'pairs', pairs.length)
          break
        } catch { /* retry */ }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))
  return pairs
}

function buildData(pairs) {
  const rows = pairs.map((p) => ({ prompt: '用她自己的口吻重写这句话：' + p.plain, completion: p.her }))
  for (let index = rows.length - 1; index > 0; index -= 1) { const j = Math.floor(Math.random() * (index + 1)); [rows[index], rows[j]] = [rows[j], rows[index]] }
  const valid = Math.max(16, Math.round(rows.length * 0.1))
  writeFileSync(path.join(DATA, 'train.jsonl'), rows.slice(valid).map((r) => JSON.stringify(r)).join('\n') + '\n')
  writeFileSync(path.join(DATA, 'valid.jsonl'), rows.slice(0, valid).map((r) => JSON.stringify(r)).join('\n') + '\n')
  return { train: rows.length - valid, valid }
}

function train() {
  launch(['bootout', `gui/${process.getuid()}/${SERVER_PLIST}`])
  mkdirSync(ADAPTERS, { recursive: true })
  const env = { ...process.env, PATH: `${HOME}/.venvs/mlx/bin:/opt/homebrew/bin:/usr/bin:/bin` }
  const base = ['--model', MODEL, '--train', '--data', DATA, '--fine-tune-type', 'lora', '--batch-size', '1', '--grad-accumulation-steps', '4', '--learning-rate', '0.0001', '--max-seq-length', '256', '--mask-prompt', '--adapter-path', ADAPTERS, '--seed', '42']
  const first = sh(PY, [MLX, ...base, '--num-layers', '8', '--iters', '400', '--steps-per-report', '50', '--steps-per-eval', '100', '--val-batches', '6', '--save-every', '100'], { timeout: 1800000, env })
  if (first.ok === true) return { ok: true, log: String(first.stdout || '').slice(-1600) }
  const retry = sh(PY, [MLX, ...base, '--num-layers', '4', '--iters', '300', '--steps-per-report', '50', '--steps-per-eval', '100', '--val-batches', '4', '--save-every', '150'], { timeout: 1800000, env })
  return { ok: retry.ok === true, log: String(retry.stdout || '').slice(-1600), firstFail: String(first.stderr || '').slice(-400) }
}

function dice(a, b) {
  const grams = (value) => {
    const chars = Array.from(String(value || '').replace(/[^\\u3400-\\u4dbf\\u4e00-\\u9fffA-Za-z0-9]+/gu, ''))
    const set = new Set()
    for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
    return set
  }
  const A = grams(a)
  const B = grams(b)
  if (!A.size || !B.size) return 0
  let n = 0
  for (const g of A) if (B.has(g)) n += 1
  return (2 * n) / (A.size + B.size)
}

async function startEvalServer() {
  const child = spawn(PY, ['-m', 'mlx_lm.server', '--model', MODEL, '--adapter-path', ADAPTERS, '--host', '127.0.0.1', '--port', '8083'], {
    env: { ...process.env, PATH: `${HOME}/.venvs/mlx/bin:/opt/homebrew/bin:/usr/bin:/bin` },
    stdio: 'ignore',
    detached: false,
  })
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const res = await fetch('http://127.0.0.1:8083/v1/models', { signal: AbortSignal.timeout(2000) })
      if (res.ok) return child
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  try { child.kill('SIGTERM') } catch {}
  return null
}

async function runEval(validRows) {
  const server = await startEvalServer()
  if (server === null) return { ok: false, reason: 'eval-server-failed', avg: 0, samples: [] }
  const samples = []
  try {
    for (const row of validRows.slice(0, 14)) {
      const plain = row.prompt.replace('用她自己的口吻重写这句话：', '')
      try {
        const res = await fetch('http://127.0.0.1:8083/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'default_model', messages: [
            { role: 'user', content: '用她自己的口吻重写这句话：' + plain },
          ], max_tokens: 120, temperature: 0.7 }),
        })
        const data = await res.json()
        const actual = String(data?.choices?.[0]?.message?.content || '').replace(/^["“]|["”]$/g, '').trim()
        samples.push({ plain, expected: row.completion, actual, expectedSim: dice(row.completion, actual), plainSim: dice(plain, actual) })
      } catch { /* skip */ }
    }
  } finally {
    try { server.kill('SIGTERM') } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  const avg = samples.length > 0 ? samples.reduce((sum, s) => sum + s.expectedSim, 0) / samples.length : 0
  const nonEmpty = samples.filter((s) => s.actual.length >= 4).length
  const pass = samples.length >= 8 && nonEmpty >= 8 && avg >= 0.3
  return { ok: pass, avg: Number(avg.toFixed(2)), nonEmpty, total: samples.length, samples }
}

function swapLive() {
  const backup = path.join(WORK, `backup-live-${Date.now()}`)
  mkdirSync(backup, { recursive: true })
  for (const file of ['adapter_config.json', 'adapters.safetensors']) {
    if (existsSync(path.join(LIVE, file))) copyFileSync(path.join(LIVE, file), path.join(backup, file))
  }
  for (const file of ['adapter_config.json', 'adapters.safetensors']) {
    if (!existsSync(path.join(ADAPTERS, file))) return { ok: false, reason: 'missing-adapter-file' }
    copyFileSync(path.join(ADAPTERS, file), path.join(LIVE, file))
  }
  const plist = path.join(HOME, 'Library/LaunchAgents/com.yangyuan.whale.mlx-server.plist')
  launch(['bootout', `gui/${process.getuid()}/${SERVER_PLIST}`])
  launch(['bootstrap', `gui/${process.getuid()}`, plist])
  return { ok: true, backup }
}

function restoreServer() {
  const plist = path.join(HOME, 'Library/LaunchAgents/com.yangyuan.whale.mlx-server.plist')
  launch(['bootout', `gui/${process.getuid()}/${SERVER_PLIST}`])
  launch(['bootstrap', `gui/${process.getuid()}`, plist])
}

async function main() {
  const state = readState()
  const texts = collectTexts(state)
  console.log('collect texts', texts.length)
  if (texts.length < 40) { console.log('not enough texts', texts.length); process.exit(0) }
  const pairs = await makePlain(texts)
  console.log('plain pairs', pairs.length)
  if (pairs.length < 30) { console.log('not enough pairs'); process.exit(0) }
  const built = buildData(pairs)
  console.log('data', built)
  const trained = train()
  console.log('trained', trained.ok, (trained.firstFail || '').slice(0, 200))
  const reportLines = [`# 自训练 ${new Date().toISOString()}`, '', `- 文本 ${texts.length} 条 → 对照对 ${pairs.length} 对，训练 ${built.train} / 验证 ${built.valid}`, `- 训练：${trained.ok ? '完成' : '失败'}`, '']
  let evalResult = null
  if (trained.ok === true) {
    const validRows = readFileSync(path.join(DATA, 'valid.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    evalResult = await runEval(validRows)
    console.log('eval', JSON.stringify({ ok: evalResult.ok, avg: evalResult.avg, nonEmpty: evalResult.nonEmpty, total: evalResult.total }))
    reportLines.push(`- 评估：${evalResult.ok ? '通过' : '未通过'}（期望相似度均值 ${evalResult.avg}，${evalResult.nonEmpty}/${evalResult.total} 有输出）`)
    if (evalResult.ok === true) {
      const swapped = swapLive()
      reportLines.push(`- 换线：${swapped.ok ? '已切换' : '失败 ' + swapped.reason}（旧层备份 ${swapped.backup || '无'}）`)
      if (swapped.ok !== true) restoreServer()
      else {
        await new Promise((resolve) => setTimeout(resolve, 4000))
        try { const res = await fetch('http://127.0.0.1:8080/v1/models', { signal: AbortSignal.timeout(3000) }); reportLines.push(`- 线上服务：${res.ok ? '正常' : '异常'}`) } catch { reportLines.push('- 线上服务：未就绪') }
      }
    } else {
      restoreServer()
      reportLines.push('- 未过闸，保留旧语言层，线上服务已恢复')
    }
    for (const sample of (evalResult.samples || []).slice(0, 8)) reportLines.push(`  - 原句：${sample.plain}`, `    期望：${sample.expected}`, `    实际：${sample.actual}（相似度 ${sample.expectedSim.toFixed(2)}）`)
  } else {
    restoreServer()
    reportLines.push('- 训练失败，保留旧语言层，线上服务已恢复')
  }
  writeFileSync(REPORT, reportLines.join('\n') + '\n')
  appendFileSync(path.join(WORK, 'history.log'), `${new Date().toISOString()} trained=${trained.ok} eval=${evalResult ? evalResult.ok : 'n/a'}\n`)
  saveState({ lastTrainedAt: Date.now(), runs: (state.runs || 0) + 1, pairs: pairs.length, lastResult: { train: built, trained: trained.ok, eval: evalResult ? { ok: evalResult.ok, avg: evalResult.avg } : null, at: Date.now() } })
  process.exit(0)
}
await main()
