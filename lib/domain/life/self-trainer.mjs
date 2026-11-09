// lib/self-trainer.mjs —— 每周一次“自训练”语言层（v2.97）
//
// 不训练主脑，只把最近的说话方式练进本地 1.5B 语言层（mlx adapter）。
// 流程在 agent-loop/self-train.mjs：收最近输出 → 生成中性对照 → LoRA → 评估闸门 → 通过才换 adapters-live。
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SELF_TRAIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export const SELF_TRAIN_FIRST_MS = 12 * 60 * 60 * 1000

export function createSelfTrainer(options = {}) {
  const home = options.home || os.homedir()
  const env = options.env ?? process.env
  const logger = options.logger ?? null
  const script = String(options.script || path.join(home, 'dsh-workspace/agent-loop/self-train.sh'))
  const stateDir = String(options.stateDir || path.join(home, 'Library/Application Support/dsh-whale-mlx/self-train'))
  const stateFile = path.join(stateDir, 'scheduler.json')
  const enabled = String(env.DSH_POETRY_SELF_TRAIN ?? '').toLowerCase() === 'on'
  const intervalMs = Number.parseInt(String(env.DSH_POETRY_SELF_TRAIN_INTERVAL_MS ?? ''), 10) || SELF_TRAIN_INTERVAL_MS
  const firstMs = Number.parseInt(String(env.DSH_POETRY_SELF_TRAIN_FIRST_MS ?? ''), 10) || SELF_TRAIN_FIRST_MS
  let timer = null
  let lastRun = null

  function readState() {
    try { return JSON.parse(readFileSync(stateFile, 'utf8')) } catch { return { lastRunAt: 0, runs: 0 } }
  }
  function snapshot() {
    return { enabled, intervalMs, firstMs, lastRun, state: readState(), script }
  }
  function start() {
    if (!enabled || timer !== null) return
    const state = readState()
    const due = Math.max(firstMs, (state.lastRunAt || 0) + intervalMs - Date.now())
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => runOnce().catch(() => {}), intervalMs)
      timer.unref?.()
    }, Math.max(60 * 1000, due))
    timer.unref?.()
    logger?.info?.(`[dsh-little-whale] 自训练已排期：约 ${Math.round(Math.max(firstMs, due) / 3600000)} 小时后首次`)
  }
  async function runOnce() {
    if (!enabled) return { ok: false, reason: 'disabled' }
    const state = readState()
    if (existsSync(script) !== true) {
      lastRun = { at: Date.now(), ok: false, reason: 'missing-script' }
      return lastRun
    }
    mkdirSync(stateDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logFile = path.join(stateDir, `scheduler-run-${stamp}.log`)
    const startedAt = Date.now()
    const result = await new Promise((resolve) => {
      let child
      try {
        child = spawn('/bin/bash', [script], { cwd: path.dirname(path.dirname(script)), env: { ...env, PATH: `${home}/.local/bin:${home}/.venvs/mlx/bin:/opt/homebrew/bin:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        resolve({ ok: false, reason: error instanceof Error ? error.message : String(error) })
        return
      }
      child.stdout.on('data', (chunk) => { try { appendFileSync(logFile, chunk) } catch {} })
      child.stderr.on('data', (chunk) => { try { appendFileSync(logFile, chunk) } catch {} })
      child.on('close', (code) => resolve({ ok: code === 0, code, logFile }))
      child.on('error', (error) => resolve({ ok: false, reason: error instanceof Error ? error.message : String(error), logFile }))
    })
    lastRun = { at: startedAt, ...result }
    const next = { lastRunAt: startedAt, runs: (state.runs || 0) + 1, last: lastRun }
    try { writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n') } catch { /* ignore */ }
    logger?.info?.(`[dsh-little-whale] 自训练一轮结束：${result.ok ? '成功' : '失败'}`)
    return lastRun
  }
  function stop() {
    if (timer !== null) { clearTimeout(timer); clearInterval(timer); timer = null }
  }
  return { start, stop, runOnce, snapshot }
}
