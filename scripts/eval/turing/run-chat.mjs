#!/usr/bin/env node
// 图灵式评测：把 cases.json（+ 自动生成记忆探针）逐条发给正在运行的小鲸鱼，记录回答。
//
// 用法：
//   node scripts/eval/turing/run-chat.mjs --url http://127.0.0.1:63109
//   node scripts/eval/turing/run-chat.mjs --url ... --memory-probes 6 --limit 12
// 输出：scripts/eval/turing/runs/<timestamp>/answers.jsonl / transcript.md
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const HOME = os.homedir()

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  const eq = process.argv.find((item) => item.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  return fallback
}

const URL_BASE = arg('url', process.env.WHALE_URL || 'http://127.0.0.1:63109').replace(/\/+$/, '')
const TOKEN_FILE = arg('token-file', path.join(HOME, '.dsh/.dsh-poetry/chat-token'))
const LIMIT = Number(arg('limit', '0'))
const MEMORY_PROBES = Number(arg('memory-probes', '5'))
const DELAY_MS = Number(arg('delay-ms', '800'))
const PEER = arg('peer', 'turing-eval')

function clean(text, max = 400) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function readToken() {
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

/** 从较旧的 journal 条目生成记忆探针：问题里给一句提示，评分时看回答是否命中原条目关键词。 */
function buildMemoryProbes(count, journalPath) {
  if (count <= 0) return []
  let rows = []
  try {
    rows = readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter((entry) => entry && ['thought', 'mood', 'murmur'].includes(entry.kind))
      .filter((entry) => typeof entry.text === 'string' && entry.text.length >= 24 && entry.text.length <= 100)
      .filter((entry) => Date.now() - entry.ts > 36 * 3600 * 1000)
  } catch {
    return []
  }
  if (rows.length === 0) return []
  // 均匀采样，避免都来自同一时段。
  const step = Math.max(1, Math.floor(rows.length / (count + 1)))
  const picked = []
  for (let i = step; i < rows.length && picked.length < count; i += step) picked.push(rows[i])
  const probes = []
  const stopWords = /^(这个|那个|什么|我们|你们|他们|现在|今天|昨天|时候|事情|感觉|有点|还是|就是|可以|没有)/
  picked.forEach((entry, index) => {
    const text = clean(entry.text, 200)
    const hint = text.slice(0, 18)
    // 关键词：取原条目里 3–5 个 2~4 字片段，跳过常见词。
    const tokens = [...new Set((text.match(/[\u4e00-\u9fff]{2,4}/g) || []).filter((token) => !stopWords.test(token)))].slice(0, 6)
    probes.push({
      id: `m${String(index + 1).padStart(2, '0')}`,
      prompt: `你还记得吗？之前你在日记里写过跟「${hint}」有关的一件事。能说说当时的细节，或者后来的进展吗？`,
      kind: 'memory',
      expectedKeywords: tokens,
      sourceAt: entry.ts,
    })
  })
  return probes
}

const casesFile = JSON.parse(readFileSync(path.join(HERE, 'cases.json'), 'utf8'))
const journalPath = process.env.WHALE_JOURNAL || path.join(HOME, '.dsh/agent-memory/journal.jsonl')
const cases = [
  ...casesFile.dialogue.map((item) => ({ ...item, kind: 'dialogue' })),
  ...casesFile.adversarial.map((item) => ({ ...item, kind: 'adversarial' })),
  ...buildMemoryProbes(MEMORY_PROBES, journalPath),
]
const selected = LIMIT > 0 ? cases.slice(0, LIMIT) : cases

const token = readToken()
if (token.length === 0) {
  console.error(`找不到 chat token：${TOKEN_FILE}（先用 GUI 跟她说过话会生成）`)
  process.exit(1)
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = path.join(HERE, 'runs', stamp)
mkdirSync(outDir, { recursive: true })
const answersFile = path.join(outDir, 'answers.jsonl')

async function ask(prompt) {
  const response = await fetch(`${URL_BASE}/api/dsh-poetry/chat.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, peerId: PEER, text: prompt }),
    signal: AbortSignal.timeout(180000),
  })
  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = { ok: false, error: text.slice(0, 200) }
  }
  return { status: response.status, data }
}

const transcript = [`# 图灵式评测 ${stamp}`, `- 目标：${URL_BASE}`, `- peer：${PEER}`, '']
for (const item of selected) {
  const startedAt = Date.now()
  const reply = await ask(item.prompt)
  const answer = reply.data && (reply.data.reply || reply.data.text) ? String(reply.data.reply || reply.data.text) : ''
  const record = {
    id: item.id,
    kind: item.kind,
    probe: item.probe || null,
    prompt: item.prompt,
    expectedKeywords: item.expectedKeywords || null,
    answer: clean(answer, 2000),
    ok: reply.data ? reply.data.ok === true : false,
    status: reply.status,
    elapsedMs: Date.now() - startedAt,
    at: Date.now(),
  }
  appendFileSync(answersFile, `${JSON.stringify(record)}\n`, 'utf8')
  transcript.push(`## ${item.id}（${item.kind}${item.probe ? `/${item.probe}` : ''}）`, '', `**用户**：${item.prompt}`, '', `**她**：${record.answer || '(空)'}`, '')
  console.log(`${item.id} ${item.kind}${item.probe ? `/${item.probe}` : ''} -> ${record.answer ? record.answer.slice(0, 50) : '(空)'} [${record.elapsedMs}ms]`)
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
}
writeFileSync(path.join(outDir, 'transcript.md'), transcript.join('\n'), 'utf8')
console.log(`\n已保存：${outDir}`)
