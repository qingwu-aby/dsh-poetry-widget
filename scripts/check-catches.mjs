#!/usr/bin/env node
// 静默失败预算门禁（P1）：防止新代码继续增加 `catch {` 兜底，同时给 legacy 债一个可见基线。
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const BUDGET = {
  newLayers: 60, // lib/kernel + lib/composition
  domain: 405, // lib/domain（历史债，只降不升）
}
const counts = { newLayers: 0, domain: 0 }

function walk(rel) {
  const out = []
  for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name)
    if (entry.isDirectory()) out.push(...walk(next))
    else if (entry.name.endsWith('.mjs')) out.push(next)
  }
  return out
}
function countSilent(files) {
  let n = 0
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), 'utf8')
    n += (source.match(/catch\s*\{/g) || []).length
  }
  return n
}

counts.newLayers = countSilent([...walk('lib/kernel'), ...walk('lib/composition')])
counts.domain = countSilent(walk('lib/domain'))

let failed = false
for (const [area, budget] of Object.entries(BUDGET)) {
  const used = counts[area]
  const ok = used <= budget
  console.log(`${area}: ${used}/${budget} ${ok ? 'ok' : 'OVER BUDGET'}`)
  if (!ok) failed = true
}
if (failed) {
  console.error('静默 catch 超出预算：新增代码请显式处理错误（logger/counter），不要用空 catch。')
  process.exit(1)
}
