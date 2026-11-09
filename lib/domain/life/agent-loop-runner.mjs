// lib/agent-loop-runner.mjs —— 常驻自进化巡检的宿主内 runner（v2.81）
//
// 为什么放在插件里而不是 launchd：macOS TCC 不允许 launchd 里的 bash 读 Documents，
// 但 DSH 宿主进程本身有权限；由它 spawn `dsh --profile resident` 就能正常读写工作区。
// 默认关闭：DSH_AGENT_LOOP=on 才启动；每 2 小时一轮，持久 session，日志在 ~/Library/Logs。
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const AGENT_LOOP_INTERVAL_MS = 2 * 60 * 60 * 1000
export const AGENT_LOOP_FIRST_MS = 5 * 60 * 1000

/** 从 session 事件的 JSON 行里取 sessionId。 */
export function parseSessionIdFromLine(line) {
  try {
    const event = JSON.parse(String(line ?? '').trim())
    return typeof event.sessionId === 'string' && event.sessionId.length > 0 ? event.sessionId : null
  } catch {
    return null
  }
}

/** 从 credentials 文件里取 OPENCODE_GO_API_KEY（refs 段）。 */
export function readApiKeyFromCredentials(file) {
  try {
    const text = readFileSync(file, 'utf8')
    const match = text.match(/OPENCODE_GO_API_KEY:\s*(\S+)/)
    return match === null ? '' : match[1].trim()
  } catch {
    return ''
  }
}

/** 构造 dsh 参数；首次（没有 session）用 --json 以便捕获 sessionId。 */
export function buildAgentLoopArgs(options = {}) {
  const profile = String(options.profile || 'resident')
  const prompt = String(options.prompt || '')
  const sessionId = typeof options.sessionId === 'string' && options.sessionId.length > 0 ? options.sessionId : null
  const args = ['--profile', profile]
  if (sessionId !== null) args.push('--session-id', sessionId)
  else args.push('--json')
  args.push(prompt)
  return args
}

export function buildAgentLoopEnv(baseEnv, apiKey) {
  const env = { ...baseEnv }
  if (apiKey.length > 0) env.OPENCODE_GO_API_KEY = apiKey
  return env
}

export function createAgentLoopRunner(options = {}) {
  const home = options.home || os.homedir()
  const workspace = String(options.workspace || path.join(home, 'Documents/deepseek-harness/default-workspace'))
  const dshBin = String(options.dshBin || path.join(home, 'Library/pnpm/dsh'))
  const profile = String(options.profile || 'resident')
  const promptFile = String(options.promptFile || path.join(workspace, 'agent-loop/prompt.md'))
  const stateDir = String(options.stateDir || path.join(home, 'Library/Application Support/dsh-whale-mlx/agent-loop'))
  const credentialFile = String(options.credentialFile || path.join(home, '.dsh/.credentials.yaml'))
  const logger = options.logger ?? null
  const env = options.env ?? process.env
  const enabled = String(env.DSH_AGENT_LOOP ?? '').toLowerCase() === 'on'
  const intervalMs = Number.parseInt(String(env.DSH_AGENT_LOOP_INTERVAL_MS ?? ''), 10) || AGENT_LOOP_INTERVAL_MS
  const firstMs = Number.parseInt(String(env.DSH_AGENT_LOOP_FIRST_MS ?? ''), 10) || AGENT_LOOP_FIRST_MS
  let timer = null
  let inFlight = false
  let lastRun = null

  function snapshot() {
    return { enabled, intervalMs, firstMs, lastRun, sessionFile: path.join(stateDir, 'session-id') }
  }

  function readSessionId() {
    try {
      const value = readFileSync(path.join(stateDir, 'session-id'), 'utf8').trim()
      return value.length > 0 ? value : null
    } catch {
      return null
    }
  }

  function writeSessionId(sessionId) {
    try {
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(path.join(stateDir, 'session-id'), sessionId + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }

  async function runOnce(options = {}) {
    if (!enabled || inFlight) return { ok: false, reason: enabled ? 'busy' : 'disabled' }
    const prompt = (() => {
      try {
        return readFileSync(promptFile, 'utf8')
      } catch {
        return ''
      }
    })()
    if (prompt.trim().length === 0) return { ok: false, reason: 'no-prompt' }
    inFlight = true
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logFile = path.join(stateDir, 'logs', `${stamp}.log`)
    try {
      mkdirSync(path.dirname(logFile), { recursive: true })
    } catch {
      /* ignore */
    }
    const sessionId = options.fresh === true ? null : readSessionId()
    const args = buildAgentLoopArgs({ profile, prompt, sessionId })
    const apiKey = readApiKeyFromCredentials(credentialFile)
    const result = await new Promise((resolve) => {
      let child
      try {
        child = spawn(dshBin, args, {
          cwd: workspace,
          env: buildAgentLoopEnv(env, apiKey),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        resolve({ ok: false, reason: error instanceof Error ? error.message : String(error), sessionId: null })
        return
      }
      let firstChunk = ''
      child.stdout.on('data', (chunk) => {
        try {
          appendFileSync(logFile, chunk)
        } catch {
          /* ignore */
        }
        if (sessionId === null && firstChunk.length < 4000) {
          firstChunk += chunk.toString()
          const found = firstChunk.split('\n').map(parseSessionIdFromLine).find((value) => value !== null)
          if (found) writeSessionId(found)
        }
      })
      child.stderr.on('data', (chunk) => {
        try {
          appendFileSync(logFile, chunk)
        } catch {
          /* ignore */
        }
      })
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
      }, 15 * 60 * 1000)
      killTimer.unref?.()
      child.on('close', (code) => {
        clearTimeout(killTimer)
        resolve({ ok: code === 0, code, sessionId: sessionId ?? readSessionId(), logFile })
      })
      child.on('error', (error) => {
        clearTimeout(killTimer)
        resolve({ ok: false, reason: error instanceof Error ? error.message : String(error), sessionId })
      })
    })
    inFlight = false
    lastRun = { at: Date.now(), ...result }
    logger?.info?.(`[dsh-little-whale] 常驻巡检一轮：${result.ok ? '完成' : `失败（${result.reason || result.code}）`}`)
    return result
  }

  function start() {
    if (!enabled || timer !== null) return
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => runOnce().catch(() => {}), intervalMs)
      timer.unref?.()
    }, firstMs)
    timer.unref?.()
    logger?.info?.(`[dsh-little-whale] 常驻巡检已启动：首次 ${Math.round(firstMs / 60000)} 分钟后，之后每 ${Math.round(intervalMs / 60000)} 分钟`)
  }

  function stop() {
    if (timer !== null) {
      try {
        clearTimeout(timer)
        clearInterval(timer)
      } catch {
        /* ignore */
      }
      timer = null
    }
  }

  return { start, stop, runOnce, snapshot }
}
