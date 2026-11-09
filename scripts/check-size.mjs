#!/usr/bin/env node
// 体量检查（W0）：先宽后严。--strict 用于 W1 完成后收紧。
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const INDEX_MAX = 300
const MODULE_MAX = 1100 // 目标 800；4 个历史大模块（self-talk/mood-ai/self-drive/self-growth）待拆
const warnings = []

function lines(rel) {
  try {
    return readFileSync(path.join(ROOT, rel), 'utf8').split('\n').length
  } catch {
    return 0
  }
}
function walk(rel) {
  const out = []
  for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name)
    if (entry.isDirectory()) out.push(...walk(next))
    else if (entry.name.endsWith('.mjs') || entry.name === 'index.js' || entry.name === 'client.js') out.push(next)
  }
  return out
}

const files = ['index.js', ...walk('lib')]
for (const file of files) {
  const count = lines(file)
  if (file === 'index.js' && count > INDEX_MAX) warnings.push(`${file}: ${count} 行（上限 ${INDEX_MAX}）`)
  else if (file !== 'index.js' && count > MODULE_MAX) warnings.push(`${file}: ${count} 行（上限 ${MODULE_MAX}）`)
}
const fail = warnings.length > 0
if (warnings.length > 0) {
  console.error('体量检查失败：')
  for (const warning of warnings) console.error(`- ${warning}`)
  if (fail) process.exit(1)
}
console.log(`体量检查通过：${files.length} 个文件（index.js 上限 ${INDEX_MAX}；单模块上限 ${MODULE_MAX}）`)
