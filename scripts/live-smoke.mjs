#!/usr/bin/env node
// scripts/live-smoke.mjs —— 小鲸鱼线上冒烟检查（v1.77）
//
// 只读、不花钱、不触发模型：检查正在运行的插件是否还活着、记忆文件是否在更新、
// 最近模型错误是否可控。真正的“模型调用冒烟”仍建议在 UI 里点一次「刷新心情 / 说一句」，
// 然后看 journal 有没有新条目（会消耗一次模型调用）。
//
// 用法：npm run smoke
// 环境变量：DSH_HOME 可覆盖；DSH_POETRY_URL 可覆盖面板地址（默认 http://127.0.0.1:61506）
import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = process.env.HOME || os.homedir()
const dshHome = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(home, '.dsh')
const memoryDir = path.join(dshHome, 'agent-memory')
const stateDir = path.join(dshHome, '.dsh-poetry')
// 面板端口每次启动可能不同：只有显式设置 DSH_POETRY_URL 时才检查路由；否则跳过（不算失败）。
const baseUrl = typeof process.env.DSH_POETRY_URL === 'string' && process.env.DSH_POETRY_URL.trim().length > 0
  ? process.env.DSH_POETRY_URL.trim().replace(/\/$/, '')
  : null
const now = Date.now()

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'WARN'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function fileAge(file) {
  try {
    return Math.max(0, now - statSync(file).mtimeMs)
  } catch {
    return null
  }
}

function ageText(ms) {
  if (ms === null) return 'missing'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// 1) 关键记忆文件存在与新鲜度
const journal = path.join(memoryDir, 'journal.jsonl')
const layers = path.join(memoryDir, 'memory-layers.json')
const state = path.join(stateDir, 'self-state.json')
const journalAge = fileAge(journal)
check('journal.jsonl 存在', existsSync(journal))
check('journal 最近 6h 有更新', journalAge !== null && journalAge < 6 * 60 * 60 * 1000, ageText(journalAge))
check('self-state 最近 6h 有更新', fileAge(state) !== null && fileAge(state) < 6 * 60 * 60 * 1000, ageText(fileAge(state)))
check('memory-layers 已生成', existsSync(layers))
check('self-state 已迁到 v2', existsSync(state) && (() => {
  try {
    return JSON.parse(readFileSync(state, 'utf8')).v === 2
  } catch {
    return false
  }
})())

// 2) 分层记忆内容
if (existsSync(layers)) {
  try {
    const data = JSON.parse(readFileSync(layers, 'utf8'))
    check('分层记忆有 episode', Array.isArray(data.episodes) && data.episodes.length > 0, `${data.episodes?.length ?? 0} 条`)
    check('自我短句存在', Array.isArray(data.selfFacts) && data.selfFacts.length > 0, `${data.selfFacts?.length ?? 0} 条`)
  } catch {
    check('分层记忆可解析', false)
  }
}

// 3) 最近 30 分钟模型错误（只统计，不判定为失败）
const errorsFile = path.join(stateDir, 'model-errors.jsonl')
if (existsSync(errorsFile)) {
  const rows = readFileSync(errorsFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const recent = rows.filter((row) => typeof row.at === 'number' && now - row.at < 30 * 60 * 1000)
  check('最近 30m 模型错误可控（<10）', recent.length < 10, `${recent.length} 条`)
  const byRole = new Map()
  for (const row of recent) byRole.set(row.role, (byRole.get(row.role) ?? 0) + 1)
  if (byRole.size > 0) console.log('      错误分布：' + [...byRole.entries()].map(([role, count]) => `${role}×${count}`).join('、'))
} else {
  check('model-errors.jsonl 存在', false)
}

// 4) 面板路由是否还活着（fenced；未登录返回 UNAUTHORIZED 也算活着）
if (baseUrl === null) {
  console.log('SKIP  面板路由检查（未设置 DSH_POETRY_URL；面板端口每次启动可能不同）')
} else try {
  const response = await fetch(`${baseUrl}/api/dsh-poetry/health.json`, { signal: AbortSignal.timeout(5000) })
  const body = await response.json().catch(() => null)
  // 200 = 已登录/同源；401 = 服务活着但被登录栅栏挡住（也算可达）。
  check('面板 health.json 可达', (response.status === 200 || response.status === 401) && body !== null, `HTTP ${response.status}`)
  if (body && body.ok === true) console.log('      health:', JSON.stringify(body.runtime ? Object.keys(body.runtime) : []))
  if (body && body.ok === false && body.error) console.log(`      未登录/被栅栏拦截：${body.error.code ?? 'UNKNOWN'}（服务仍活着）`)
} catch (error) {
  check('面板 health.json 可达', false, error instanceof Error ? error.message : String(error))
}

const failed = results.filter((item) => !item.ok).length
console.log(`\n${failed === 0 ? 'SMOKE OK' : `SMOKE WARN（${failed} 项）`}  DSH_HOME=${dshHome}`)
if (failed > 0) {
  console.log('提示：模型调用冒烟请在 UI 里点一次「刷新心情 / 说一句」，再 `tail -1 agent-memory/journal.jsonl` 看新条目。')
  process.exitCode = 1
}
