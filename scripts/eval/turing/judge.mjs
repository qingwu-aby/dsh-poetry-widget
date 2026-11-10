#!/usr/bin/env node
// 交叉盲评：用 OpenCode Go 的其他模型对评测记录做“真人还是 AI”的盲判。
//
// 用法：
//   node scripts/eval/turing/judge.mjs scripts/eval/turing/runs/<stamp>
//   node scripts/eval/turing/judge.mjs <dir> --judges glm-5.3-flash,gpt-6-luna
//
// 说明：
//   · 只把“用户一句 + 回复一句”给评审，不带 id/类型，不告诉它这是谁；
//   · 默认 glm-5.3-flash + gpt-6-luna（glm-5.3-flash-free 在 zen/go 上不可用，会自动映射回 glm-5.3-flash）；
//   · 输出 runs/<stamp>/judge-results.jsonl 与 judge-report.md。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const HOME = os.homedir()
const dir = process.argv[2]
if (!dir) {
  console.error('用法：node scripts/eval/turing/judge.mjs scripts/eval/turing/runs/<stamp>')
  process.exit(1)
}
const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  const eq = process.argv.find((item) => item.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : fallback
}

const MODEL_ALIASES = { 'glm-5.3-flash-free': 'glm-5.3-flash' }
const REQUESTED_JUDGES = String(arg('judges', 'glm-5.3-flash,gpt-6-luna')).split(',').map((item) => item.trim()).filter(Boolean)
const JUDGES = REQUESTED_JUDGES.map((model) => MODEL_ALIASES[model] ?? model)
const CONCURRENCY = Math.max(1, Math.min(6, Number(arg('concurrency', '3'))))
const BASE = 'https://opencode.ai/zen/go/v1'
const SESSION = `turing-judge-${Math.random().toString(36).slice(2, 10)}`

function readKey() {
  const file = path.join(HOME, '.dsh/.credentials.yaml')
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('OPENCODE_GO_API_KEY')) continue
    const tail = lines[i].split('OPENCODE_GO_API_KEY')[1] || ''
    const inline = tail.match(/["']?([A-Za-z0-9_-]{16,})["']?/)
    if (inline) return inline[1]
    for (const next of lines.slice(i + 1, i + 8)) {
      if (!/(value|token|secret|key)\s*:/i.test(next)) continue
      const match = next.match(/["']?([A-Za-z0-9_-]{16,})["']?/)
      if (match) return match[1]
    }
  }
  return ''
}

const KEY = readKey()
if (!KEY) {
  console.error('找不到 OPENCODE_GO_API_KEY')
  process.exit(1)
}

const rows = readFileSync(path.join(dir, 'answers.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

function judgePrompt(row) {
  return [
    '你是一个严格的盲评员。下面是一段聊天记录，回复的作者身份未知。',
    '请不要因为内容里有“日记/研究/哲学”就下结论；只看句子本身像不像一个具体的人在说话。',
    '',
    `用户：${row.prompt}`,
    `回复：${row.answer}`,
    '',
    '只输出 JSON（不要 markdown）：',
    '{"verdict":"human|ai|unsure","naturalness":1到5,"coherence":1到5,"credibility":1到5,"seam":"最像 AI 的一句（没有就空）","reason":"一句话理由"}',
  ].join('\n')
}

function parseVerdict(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    const verdict = ['human', 'ai', 'unsure'].includes(parsed.verdict) ? parsed.verdict : 'unsure'
    const score = (value) => {
      const n = Number(value)
      return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : null
    }
    return {
      verdict,
      naturalness: score(parsed.naturalness),
      coherence: score(parsed.coherence),
      credibility: score(parsed.credibility),
      seam: String(parsed.seam ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
      reason: String(parsed.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    }
  } catch {
    return null
  }
}

async function callJudge(model, prompt) {
  const body = {
    model,
    messages: [
      { role: 'system', content: '你是严谨的图灵评测盲评员；只输出要求的 JSON。' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 700,
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${KEY}`,
          'x-opencode-session': SESSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      })
      const text = await response.text()
      if (!response.ok) {
        if (attempt === 0) continue
        return { error: `HTTP_${response.status}: ${text.slice(0, 160)}` }
      }
      const data = JSON.parse(text)
      const content = data?.choices?.[0]?.message?.content
      const parsed = parseVerdict(content)
      if (parsed !== null) return parsed
      if (attempt === 0) continue
      return { error: 'INVALID_JSON' }
    } catch (error) {
      if (attempt === 0) continue
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { error: 'FAILED' }
}

const results = []
const resultsFile = path.join(dir, 'judge-results.jsonl')
writeFileSync(resultsFile, '', 'utf8')
const tasks = JUDGES.flatMap((judgeModel) => rows.map((row) => ({ judgeModel, row })))
let cursor = 0
async function worker() {
  while (cursor < tasks.length) {
    const index = cursor
    cursor += 1
    const { judgeModel, row } = tasks[index]
    const startedAt = Date.now()
    const verdict = await callJudge(judgeModel, judgePrompt(row))
    const result = {
      id: row.id,
      kind: row.kind,
      probe: row.probe || null,
      judge: judgeModel,
      requestedModel: judgeModel,
      elapsedMs: Date.now() - startedAt,
      ...verdict,
    }
    results.push(result)
    appendFileSync(resultsFile, `${JSON.stringify(result)}\n`, 'utf8')
    console.log(`${judgeModel} ${row.id} -> ${verdict.verdict || verdict.error || '?'} (${result.elapsedMs}ms)`)
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()))

function summarize(items) {
  const valid = items.filter((item) => !item.error)
  const count = (verdict) => valid.filter((item) => item.verdict === verdict).length
  const avg = (field) => {
    const values = valid.map((item) => item[field]).filter((value) => Number.isFinite(value))
    return values.length === 0 ? null : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
  }
  return {
    total: items.length,
    valid: valid.length,
    human: count('human'),
    ai: count('ai'),
    unsure: count('unsure'),
    naturalness: avg('naturalness'),
    coherence: avg('coherence'),
    credibility: avg('credibility'),
    seams: valid.filter((item) => item.seam).slice(0, 5).map((item) => ({ id: item.id, seam: item.seam })),
  }
}

const byJudge = Object.fromEntries(JUDGES.map((model) => [model, summarize(results.filter((item) => item.judge === model))]))
// 交叉一致率
const byId = new Map()
for (const item of results) {
  if (!byId.has(item.id)) byId.set(item.id, {})
  byId.get(item.id)[item.judge] = item
}
const agreements = []
for (const [id, map] of byId) {
  const values = JUDGES.map((model) => map[model]).filter(Boolean).filter((item) => !item.error)
  if (values.length < 2) continue
  const same = values.every((item) => item.verdict === values[0].verdict)
  agreements.push({ id, verdicts: values.map((item) => item.verdict), agree: same })
}
const agreementRate = agreements.length === 0 ? null : agreements.filter((item) => item.agree).length / agreements.length
const humanRate = byJudge => (byJudge.valid === 0 ? null : byJudge.human / byJudge.valid)

const lines = [
  '# 交叉盲评报告',
  '',
  `- 来源记录：${rows.length} 条`,
  `- 评审模型：${JUDGES.join(' / ')}${REQUESTED_JUDGES.some((model) => MODEL_ALIASES[model]) ? `（请求 ${REQUESTED_JUDGES.join(' / ')}；不可用的模型映射为可用的别名）` : ''}`,
  `- 两模型判定一致率：${agreementRate === null ? '无' : `${Math.round(agreementRate * 100)}%（${agreements.filter((item) => item.agree).length}/${agreements.length}）`}`,
  '',
  '## 各模型汇总',
  '',
  '| 模型 | 有效 | 判 human | 判 ai | 不确定 | 自然度 | 连贯 | 可信 |',
  '|---|---|---|---|---|---|---|---|',
  ...Object.entries(byJudge).map(
    ([model, item]) =>
      `| ${model} | ${item.valid}/${item.total} | ${item.human} | ${item.ai} | ${item.unsure} | ${item.naturalness ?? '-'} | ${item.coherence ?? '-'} | ${item.credibility ?? '-'} |`,
  ),
  '',
  '## 不一致的条目',
  '',
  ...agreements.filter((item) => !item.agree).map((item) => `- ${item.id}：${item.verdicts.join(' / ')}`),
  '',
  '## 评审指出的“像 AI 的句子”',
  '',
  ...Object.entries(byJudge).flatMap(([model, item]) => item.seams.map((seam) => `- ${model} @ ${seam.id}：${seam.seam}`)),
  '',
  '> 说明：单条回复分类受模型偏见影响；交叉一致率与“指出哪句”比单一百分比更有参考价值。',
]
writeFileSync(path.join(dir, 'judge-report.md'), lines.join('\n'), 'utf8')
writeFileSync(
  path.join(dir, 'judge-summary.json'),
  `${JSON.stringify({ judges: JUDGES, byJudge, agreementRate, agreements, results }, null, 2)}\n`,
  'utf8',
)
console.log(lines.slice(0, 10).join('\n'))
console.log(`\n已写入：${dir}/judge-report.md`)
