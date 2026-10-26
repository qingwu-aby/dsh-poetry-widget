#!/usr/bin/env node
// scripts/archive-memory.mjs —— 小鲸鱼记忆/状态归档（不删除，只搬进 archive）。
//
// 用途：把历史心情、状态、成长记录整体归档，让她从空白重新开始成长。
// 保留：插件代码/数据资产、settings.json（外观与开关）、README。
// 归档：agent-memory 与 .dsh-poetry 下的个人记忆/状态文件 + 备份目录。
//
// 用法：
//   npm run archive:memory -- --dry-run    # 只看会搬哪些文件
//   npm run archive:memory                # 执行归档（需要先停插件，避免边写边搬）
//   npm run archive:memory -- --restore <archiveId>
import { existsSync, mkdirSync, renameSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { seedMemoryBaseline } from '../lib/memory-baseline.mjs'

const home = process.env.HOME || os.homedir()
const dshHome = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(home, '.dsh')
const memoryDir = path.join(dshHome, 'agent-memory')
const stateDir = path.join(dshHome, '.dsh-poetry')
const archiveRoot = path.join(memoryDir, 'archives')

const MEMORY_FILES = [
  'journal.jsonl',
  'journal.md',
  'learning-log.md',
  'topics.json',
  'topics-candidates.json',
  'topics-archive.jsonl',
  'feelings.json',
  'voice.json',
  'memory-layers.json',
]
const STATE_FILES = [
  'self-state.json',
  'self-actions.json',
  'projects.json',
  'probe-state.json',
  'wander-state.json',
  'read-state.json',
  'netlang-state.json',
  'model-errors.jsonl',
  'model-budget.json',
]
const MEMORY_DIRS = ['backups']
const STATE_DIRS = ['backups']

function stamp() {
  const date = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sha256(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}

function collect() {
  const items = []
  for (const name of MEMORY_FILES) items.push({ dir: memoryDir, name, kind: 'memory' })
  for (const name of STATE_FILES) items.push({ dir: stateDir, name, kind: 'state' })
  for (const name of MEMORY_DIRS) {
    const target = path.join(memoryDir, name)
    if (existsSync(target)) items.push({ dir: memoryDir, name, kind: 'memory-dir' })
  }
  for (const name of STATE_DIRS) {
    const target = path.join(stateDir, name)
    if (existsSync(target)) items.push({ dir: stateDir, name, kind: 'state-dir' })
  }
  return items.filter((item) => existsSync(path.join(item.dir, item.name)))
}

function usage() {
  console.log('用法：npm run archive:memory [-- --dry-run | --restore <archiveId>]')
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const restoreIndex = args.indexOf('--restore')
const restoreId = restoreIndex >= 0 ? args[restoreIndex + 1] : ''

if (args.includes('--help') || args.includes('-h')) {
  usage()
  process.exit(0)
}

if (restoreId) {
  const archiveDir = path.join(archiveRoot, restoreId)
  const manifestPath = path.join(archiveDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    console.error(`找不到归档：${archiveDir}`)
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let restored = 0
  for (const item of manifest.items) {
    const source = path.join(archiveDir, item.kind.startsWith('memory') ? 'memory' : 'state', item.name)
    const target = path.join(item.dir, item.name)
    if (!existsSync(source)) continue
    if (existsSync(target)) {
      console.warn(`跳过（目标已存在）：${target}`)
      continue
    }
    mkdirSync(path.dirname(target), { recursive: true })
    renameSync(source, target)
    restored += 1
  }
  console.log(`已恢复 ${restored} 项到原位置（归档 ${restoreId}）`)
  process.exit(0)
}

const items = collect()
if (items.length === 0) {
  console.log('没有可归档的记忆/状态文件')
  process.exit(0)
}

const archiveId = stamp()
const archiveDir = path.join(archiveRoot, archiveId)
const memoryArchive = path.join(archiveDir, 'memory')
const stateArchive = path.join(archiveDir, 'state')
const manifest = {
  ok: true,
  v: 1,
  archiveId,
  createdAt: new Date().toISOString(),
  dshHome,
  mode: dryRun ? 'dry-run' : 'archive',
  items: items.map((item) => {
    const source = path.join(item.dir, item.name)
    const stat = statSync(source)
    return {
      ...item,
      source,
      size: stat.isDirectory() ? null : stat.size,
      sha256: stat.isDirectory() ? null : sha256(source),
    }
  }),
}

console.log(`归档批次：${archiveId}`)
for (const item of manifest.items) {
  console.log(`  ${item.kind.padEnd(10)} ${item.name}${item.size === null ? '' : ` (${item.size} B)`}`)
}
if (dryRun) {
  console.log(`\n[dry-run] 将归档到：${archiveDir}`)
  process.exit(0)
}

mkdirSync(memoryArchive, { recursive: true })
mkdirSync(stateArchive, { recursive: true })
for (const item of manifest.items) {
  const source = item.source
  const target = path.join(item.kind.startsWith('memory') ? memoryArchive : stateArchive, item.name)
  renameSync(source, target)
}
writeFileSync(path.join(archiveDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`\n已归档到：${archiveDir}`)
const seeded = seedMemoryBaseline({ env: process.env, home })
console.log(`已初始化空白记忆容器：${seeded.length > 0 ? seeded.join('、') : '（无需创建）'}`)
console.log('插件重新加载后会从空白记忆/状态开始。')
