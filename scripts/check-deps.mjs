#!/usr/bin/env node
// 依赖规则检查（W0）：循环依赖、分层反向依赖。失败 exit 1。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SCAN = [
  'index.js',
  ...listFiles('lib').map((file) => path.join('lib', file)),
  ...(exists('lib/kernel') ? listFiles('lib/kernel').map((file) => path.join('lib/kernel', file)) : []),
  ...(exists('lib/domain') ? listFiles('lib/domain').map((file) => path.join('lib/domain', file)) : []),
  ...(exists('lib/composition') ? listFiles('lib/composition').map((file) => path.join('lib/composition', file)) : []),
]

function exists(rel) {
  try {
    return statSync(path.join(ROOT, rel)).isDirectory()
  } catch {
    return false
  }
}
function listFiles(rel) {
  const out = []
  for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    if (entry.isDirectory())
      for (const inner of listFiles(path.join(rel, entry.name))) out.push(path.join(entry.name, inner))
    else if (entry.name.endsWith('.mjs')) out.push(entry.name)
  }
  return out
}

const imports = new Map()
for (const rel of SCAN) {
  const source = readFileSync(path.join(ROOT, rel), 'utf8')
  const deps = []
  for (const match of source.matchAll(/(?:import|export)[^'"]*from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
    const resolved = path.normalize(path.join(path.dirname(rel), match[1]))
    deps.push(resolved.endsWith('.mjs') || resolved.endsWith('.js') ? resolved : `${resolved}.mjs`)
  }
  imports.set(rel, deps)
}

const violations = []

// 1) 循环依赖
const state = new Map()
function visit(node, stack) {
  const status = state.get(node)
  if (status === 'done') return
  if (status === 'visiting') return
  state.set(node, 'visiting')
  for (const dep of imports.get(node) ?? []) {
    if (!imports.has(dep)) continue
    if (state.get(dep) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(dep)), node, dep].join(' -> ')
      if (!violations.some((item) => item.type === 'cycle' && item.detail === cycle)) {
        violations.push({ type: 'cycle', file: node, detail: cycle })
      }
      continue
    }
    visit(dep, [...stack, node])
  }
  state.set(node, 'done')
}
for (const node of imports.keys()) visit(node, [])

// 2) 分层：kernel 不得依赖 domain/composition/index
for (const [file, deps] of imports) {
  if (!file.startsWith('lib/kernel/')) continue
  for (const dep of deps) {
    if (dep === 'index.js' || dep.startsWith('lib/domain/') || dep.startsWith('lib/composition/')) {
      violations.push({ type: 'layer', file, detail: `${file} -> ${dep}（kernel 不能依赖上层）` })
    }
  }
}

// 3) domain 内部文件不得被其他 domain 直接 import（有 domain 目录后再启用）
const _domainRoot = path.join(ROOT, 'lib/domain')
if (exists('lib/domain')) {
  for (const [file, deps] of imports) {
    if (!file.startsWith('lib/domain/')) continue
    const own = file.split('/')[2]
    for (const dep of deps) {
      if (!dep.startsWith('lib/domain/')) continue
      const other = dep.split('/')[2]
      if (other !== own && !/index\.mjs$/.test(dep)) {
        violations.push({ type: 'domain', file, detail: `${file} -> ${dep}（跨域只能依赖对方 index.mjs/facade）` })
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`依赖检查失败（${violations.length} 项）：`)
  for (const item of violations) console.error(`- [${item.type}] ${item.detail}`)
  process.exit(1)
}
console.log(`依赖检查通过：${imports.size} 个模块，0 循环、0 分层违规`)
