#!/usr/bin/env node
// agent-loop 健康检查：跑测试 + 看她的推送/队列/模型错误，写 state/health.json。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const REPO = process.env.WHALE_REPO || path.join(HOME, 'Documents/deepseek-harness/default-workspace/dsh-poetry-widget')
const STATE = path.join(ROOT, 'state', 'health.json')
const DSH_HOME = process.env.WHALE_DSH_HOME || path.join(HOME, '.dsh')
const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }

// 直接用 node --test 跑核心测试，避免依赖 npm/esbuild（headless 环境更稳）。
const testFiles = ['tests/data.test.mjs', 'tests/kernel.test.mjs']
try {
  for (const name of readdirSync(path.join(REPO, 'tests/domains'))) {
    if (name.endsWith('.test.mjs')) testFiles.push(path.join('tests/domains', name))
  }
} catch {
  /* tests/domains 不存在时只跑前两个 */
}
const tests = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: REPO,
  encoding: 'utf8',
  timeout: 300000,
  env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` },
})
const tail = String((tests.stdout || '') + (tests.stderr || '')).split('\n').filter((line) => /# (tests|pass|fail)/.test(line))
const pass = Number((tail.find((line) => /# pass/.test(line)) || '').replace(/\D+/g, '')) || 0
const fail = Number((tail.find((line) => /# fail/.test(line)) || '').replace(/\D+/g, '')) || 0
const testsOk = tests.status === 0 && fail === 0 && pass > 0

const push = readJson(path.join(DSH_HOME, '.dsh-poetry/gui-push-state.json'), {})
const inbox = readJson(path.join(DSH_HOME, '.dsh-poetry/gui-inbox.json'), { items: [] })
const proactive = readJson(path.join(DSH_HOME, '.dsh-poetry/proactive-chat-state.json'), {})
const errors = (() => {
  const file = path.join(DSH_HOME, '.dsh-poetry/model-errors.jsonl')
  if (!existsSync(file)) return { total: 0, byCode: {} }
  const since = Date.now() - 24 * 3600 * 1000
  const byCode = {}
  let total = 0
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    try {
      const entry = JSON.parse(line)
      if (!(entry.at > since)) continue
      total += 1
      byCode[entry.code || 'UNKNOWN'] = (byCode[entry.code || 'UNKNOWN'] || 0) + 1
    } catch { /* ignore */ }
  }
  return { total, byCode }
})()

const health = {
  at: new Date().toISOString(),
  tests: { ok: testsOk, pass, fail, tail },
  queue: { pending: (inbox.items || []).length },
  push: { last: push.last || null, updatedAt: push.updatedAt || null },
  proactive: { lastProactiveAt: proactive.lastProactiveAt || null },
  modelErrors24h: errors,
}
mkdirSync(path.dirname(STATE), { recursive: true })
writeFileSync(STATE, JSON.stringify(health, null, 2) + '\n')
console.log(JSON.stringify({ ok: testsOk, pass, fail, queue: health.queue.pending, push: health.push.last && health.push.last.ok, errors: errors.total }))
