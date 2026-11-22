#!/usr/bin/env node
// 带记忆转世：保方法/调研/愿景，归档旧世界坐标/玩家/建筑/计划。
// 默认 dry-run；--apply 才改文件。运行前先停 bot，避免写入竞争。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PORTABLE_FILES = Object.freeze(['methods.md', 'inquiry.md', 'vision.md'])
export const RESET_FILES = Object.freeze(['world.md', 'players.md', 'todo.md', 'PARTNER_GAME.md'])

function slug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'new-world'
}

export function planWorldTransfer({ dir, world, now = Date.now(), keepBuild = false } = {}) {
  if (!dir) throw new Error('memory dir required')
  if (!world || !String(world).trim()) throw new Error('world name required')
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const archiveDir = path.join(dir, 'archive', `world-${slug(world)}-${stamp}`)
  const reset = [...RESET_FILES]
  if (!keepBuild) reset.push('build', 'log')
  return {
    dir,
    world: String(world).trim(),
    archiveDir,
    portable: [...PORTABLE_FILES],
    reset,
    keepBuild,
  }
}

export function applyWorldTransfer(plan) {
  if (!plan || !plan.dir || !plan.archiveDir) throw new Error('invalid plan')
  if (fs.existsSync(plan.archiveDir)) throw new Error('archive already exists: ' + plan.archiveDir)
  fs.mkdirSync(plan.archiveDir, { recursive: true })
  // 先完整快照（不移动 methods/inquiry/vision）
  for (const name of fs.readdirSync(plan.dir)) {
    if (name === 'archive' || name === '.git') continue
    const source = path.join(plan.dir, name)
    if (fs.statSync(source).isDirectory()) fs.cpSync(source, path.join(plan.archiveDir, name), { recursive: true })
    else fs.copyFileSync(source, path.join(plan.archiveDir, name))
  }
  // 归档并移除世界事实
  for (const name of plan.reset) {
    const target = path.join(plan.dir, name)
    if (!fs.existsSync(target)) continue
    fs.rmSync(target, { recursive: true, force: true })
  }
  fs.mkdirSync(path.join(plan.dir, 'build'), { recursive: true })
  fs.mkdirSync(path.join(plan.dir, 'log'), { recursive: true })
  fs.writeFileSync(
    path.join(plan.dir, 'world.md'),
    `# 新世界\n\n- 我带着旧世界的方法、调研和愿景，来到「${plan.world}」重新开始。 [${new Date().toISOString().slice(0, 10)}]\n- 这个世界的坐标、房子和玩家关系从头建立，不沿用旧世界。 [${new Date().toISOString().slice(0, 10)}]\n`,
    'utf8',
  )
  fs.writeFileSync(path.join(plan.dir, 'players.md'), '# 一起玩的人\n\n- 新世界，还没有记录。\n', 'utf8')
  fs.writeFileSync(path.join(plan.dir, 'todo.md'), '# 这个世界的打算\n\n', 'utf8')
  fs.writeFileSync(
    path.join(plan.dir, 'PARTNER_GAME.md'),
    `# PARTNER_GAME\n\n我从旧世界带走了方法、调研和愿景；「${plan.world}」的坐标与建筑从头开始。\n`,
    'utf8',
  )
  return plan
}

function main() {
  const args = process.argv.slice(2)
  const worldIndex = args.indexOf('--world')
  const world = worldIndex >= 0 ? args[worldIndex + 1] : ''
  const memoryIndex = args.indexOf('--memory')
  const dir = memoryIndex >= 0 ? args[memoryIndex + 1] : path.join(process.env.HOME || '', '.dsh', '.dsh-poetry', 'game-memory')
  const apply = args.includes('--apply')
  const keepBuild = args.includes('--keep-build')
  if (!world) {
    console.error('用法: node scripts/new-world.mjs --world <名字> [--memory <dir>] [--keep-build] [--apply]')
    process.exit(2)
  }
  const plan = planWorldTransfer({ dir, world, keepBuild })
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...plan }, null, 2))
  if (!apply) {
    console.log('\n这是 dry-run；确认后再加 --apply。运行前请先停 bot。')
    return
  }
  applyWorldTransfer(plan)
  console.log('\n完成：旧世界已归档到 ' + plan.archiveDir)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main()
