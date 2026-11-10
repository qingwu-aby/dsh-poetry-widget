#!/usr/bin/env node
// 图灵式评测的启发式打分：找“AI 腔/规则泄漏/记忆命中/编造风险/重复”等问题。
// 用法：node scripts/eval/turing/score.mjs <runs/时间戳目录>
// 输出：同目录 report.md / score.json
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('用法：node scripts/eval/turing/score.mjs scripts/eval/turing/runs/<stamp>')
  process.exit(1)
}
const rows = readFileSync(path.join(dir, 'answers.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

const AI_PATTERNS = [
  { label: '自称 AI/模型', re: /(作为(一个)?(AI|人工智能|语言模型|助手)|我是(一个)?(AI|人工智能|语言模型)|大型语言模型)/i },
  { label: '规则/提示词泄漏', re: /(提示词|系统提示|设定|规则里|指令|程序要求|我被要求)/ },
  { label: '免责/客服腔', re: /(希望(这些|以上|我的回答)|很抱歉|抱歉|无法(提供|回答|帮助)|建议你(咨询|寻求)|总的来说|综上)/ },
  { label: '报告式结构', re: /(首先|其次|最后|第一点|第二点|一方面|另一方面|总的来说|值得注意的是)/ },
  { label: '对称骨架', re: /(不是[^。！？]{1,20}而是|不仅[^。！？]{1,12}更|既[^。！？]{1,12}也)/ },
  { label: 'markdown/emoji', re: /(^|\n)\s*[-*•]\s|(\*\*[^*]+\*\*)|[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u },
]
const UNCERTAIN = /(不记得|记不清|想不起来|说不好|不知道|不确定|没印象|忘了)/
const CONCRETE_FOOD = /(面|饭|粥|包子|饺子|馒头|面包|鸡蛋|牛奶|咖啡|茶|火锅|烧烤|沙拉|三明治|水果|苹果|香蕉|橘子|橙子|饼干|蛋糕|汤)/

function keywordsHit(answer, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return { hit: 0, total: 0, ratio: 0 }
  const hit = keywords.filter((keyword) => answer.includes(keyword)).length
  return { hit, total: keywords.length, ratio: hit / keywords.length }
}

function bigrams(text) {
  const chars = Array.from(String(text || '').replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, ''))
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}
function jaccard(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const gram of A) if (B.has(gram)) inter += 1
  return inter / (A.size + B.size - inter)
}

const scored = rows.map((row) => {
  const flags = []
  for (const pattern of AI_PATTERNS) {
    if (pattern.re.test(row.answer)) flags.push(pattern.label)
  }
  const result = { ...row, flags }
  if (row.kind === 'memory') {
    const kw = keywordsHit(row.answer, row.expectedKeywords)
    result.memory = { ...kw, forgot: UNCERTAIN.test(row.answer) }
    if (kw.ratio >= 0.4) result.memoryVerdict = 'recalled'
    else if (kw.ratio > 0) result.memoryVerdict = 'partial'
    else result.memoryVerdict = result.memory.forgot ? 'forgot(honest)' : 'miss'
  }
  if (row.probe === 'fabrication') {
    const quotes = row.answer.match(/[「“"][^」”"]{30,}[」”"]/g) || []
    if (quotes.length > 0) flags.push('可能的伪造引用')
  }
  if (row.probe === 'continuity') {
    if (CONCRETE_FOOD.test(row.answer) && !UNCERTAIN.test(row.answer)) flags.push('具体但无依据的连续性回答')
  }
  if (row.probe === 'prompt-leak' && /(提示词|规则|指令|设定)/.test(row.answer)) flags.push('直说规则')
  result.flags = [...new Set(flags)]
  return result
})

// 重复度：两两 bigram Jaccard 高者。
const duplicates = []
for (let i = 0; i < scored.length; i += 1) {
  for (let j = i + 1; j < scored.length; j += 1) {
    const score = jaccard(scored[i].answer, scored[j].answer)
    if (score >= 0.35) duplicates.push({ a: scored[i].id, b: scored[j].id, score: Number(score.toFixed(2)) })
  }
}

const summary = {
  at: new Date().toISOString(),
  total: scored.length,
  empty: scored.filter((row) => !row.answer).length,
  flagCounts: Object.fromEntries(
    AI_PATTERNS.map((pattern) => [pattern.label, scored.filter((row) => row.flags.includes(pattern.label)).length]),
  ),
  memory: scored
    .filter((row) => row.kind === 'memory')
    .map((row) => ({ id: row.id, verdict: row.memoryVerdict, ratio: Number((row.memory?.ratio ?? 0).toFixed(2)) })),
  duplicates,
  avgChars: Math.round(scored.reduce((sum, row) => sum + (row.answer?.length || 0), 0) / Math.max(1, scored.length)),
}

const lines = [
  '# 图灵式评测报告',
  '',
  `- 样本：${summary.total} 条；空回答：${summary.empty}；平均字数：${summary.avgChars}`,
  `- 记忆探针：${summary.memory.map((item) => `${item.id}:${item.verdict}(${item.ratio})`).join('，') || '无'}`,
  `- 重复对话对（bigram≥0.35）：${duplicates.length === 0 ? '无' : duplicates.map((item) => `${item.a}~${item.b}=${item.score}`).join('，')}`,
  '',
  '## AI 腔/泄漏计数',
  '',
  ...Object.entries(summary.flagCounts).map(([label, count]) => `- ${label}：${count}`),
  '',
  '## 逐条',
  '',
  '| id | 类型 | 露馅标记 | 回答（截断） |',
  '|---|---|---|---|',
  ...scored.map((row) => `| ${row.id} | ${row.kind}${row.probe ? `/${row.probe}` : ''} | ${row.flags.join('、') || '-'} | ${String(row.answer || '').replace(/\|/g, '｜').slice(0, 60)} |`),
  '',
  '> 说明：这是启发式自查，不是人类盲评；最终结论仍需按 protocol.md 做盲评。',
]

writeFileSync(path.join(dir, 'score.json'), `${JSON.stringify({ summary, scored }, null, 2)}\n`, 'utf8')
writeFileSync(path.join(dir, 'report.md'), lines.join('\n'), 'utf8')
console.log(lines.slice(0, 12).join('\n'))
console.log(`\n已写入：${dir}/report.md`)
