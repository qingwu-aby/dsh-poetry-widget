#!/usr/bin/env node
// 本机部署：把版本化的运维脚本/launchd 模板渲染并安装到本机。
//
// 用法：
//   node scripts/ops/install.mjs            # 只补缺失文件，不覆盖（安全默认）
//   node scripts/ops/install.mjs --force    # 覆盖本机脚本/plist
//   node scripts/ops/install.mjs --dry-run  # 只打印将做什么
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const OPS = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(OPS, '..', '..')
const WORKSPACE = process.env.WHALE_WORKSPACE || path.join(HOME, 'Documents/deepseek-harness/default-workspace')
const MLX_HOME = process.env.WHALE_MLX_HOME || path.join(HOME, 'Library/Application Support/dsh-whale-mlx')
const LAUNCH_AGENTS = path.join(HOME, 'Library/LaunchAgents')
const args = new Set(process.argv.slice(2))
const force = args.has('--force')
const dryRun = args.has('--dry-run')

const copies = [
  ...['run.sh', 'read-key.mjs', 'prompt.md', 'health-check.mjs', 'self-train.mjs', 'self-train.sh'].map((name) => ({
    from: path.join(OPS, 'agent-loop', name),
    to: path.join(WORKSPACE, 'agent-loop', name),
    mode: name.endsWith('.sh') ? 0o755 : 0o644,
  })),
  { from: path.join(OPS, 'mlx', 'server.sh'), to: path.join(MLX_HOME, 'server.sh'), mode: 0o755 },
]

const templates = [
  {
    from: path.join(OPS, 'launchd', 'com.yangyuan.whale.mlx-server.plist.template'),
    to: path.join(LAUNCH_AGENTS, 'com.yangyuan.whale.mlx-server.plist'),
    values: { __HOME__: HOME, __MLX_HOME__: MLX_HOME },
  },
  {
    from: path.join(OPS, 'launchd', 'com.yangyuan.whale.agent-loop.plist.template'),
    to: path.join(LAUNCH_AGENTS, 'com.yangyuan.whale.agent-loop.plist'),
    values: { __HOME__: HOME, __WORKSPACE__: WORKSPACE },
  },
]

function ensureDir(dir) {
  if (!dryRun) mkdirSync(dir, { recursive: true })
}

let changed = 0
for (const item of copies) {
  if (existsSync(item.to) && !force) {
    console.log(`skip（已存在，用 --force 覆盖）：${item.to}`)
    continue
  }
  changed += 1
  console.log(`${dryRun ? '[dry-run] ' : ''}安装脚本：${item.to}`)
  if (!dryRun) {
    ensureDir(path.dirname(item.to))
    copyFileSync(item.from, item.to)
    chmodSync(item.to, item.mode)
  }
}

for (const item of templates) {
  if (existsSync(item.to) && !force) {
    console.log(`skip（已存在，用 --force 覆盖）：${item.to}`)
    continue
  }
  changed += 1
  let content = readFileSync(item.from, 'utf8')
  for (const [key, value] of Object.entries(item.values)) content = content.split(key).join(value)
  console.log(`${dryRun ? '[dry-run] ' : ''}安装 plist：${item.to}`)
  if (!dryRun) {
    ensureDir(path.dirname(item.to))
    writeFileSync(item.to, content, 'utf8')
  }
}

console.log(`
完成：${changed} 个文件${dryRun ? '（dry-run，未落盘）' : ''}

加载/重启本地语言层服务：
  launchctl bootout gui/$(id -u)/com.yangyuan.whale.mlx-server 2>/dev/null || true
  launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.yangyuan.whale.mlx-server.plist"

常驻巡检（可选，默认由插件内定时器触发，不需要 launchd）：
  launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.yangyuan.whale.agent-loop.plist"
`)
