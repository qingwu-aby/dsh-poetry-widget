// lib/qq-proactive.mjs —— 通过本机 dsh-qqbot 的 proactive 路由主动发一条 QQ 消息。
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function resolveQQProactiveTokenPath(env = process.env, home = null) {
  const base = env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(home ?? '', '.dsh')
  return path.join(base, '.dsh-poetry', 'qq-proactive-token')
}

export function ensureQQProactiveToken(file) {
  try {
    if (existsSync(file)) {
      const token = readFileSync(file, 'utf8').trim()
      if (token.length >= 16) return token
    }
  } catch {
    /* ignore */
  }
  const token = randomBytes(24).toString('hex')
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, token + '\n', { encoding: 'utf8', mode: 0o600 })
    chmodSync(file, 0o600)
  } catch {
    /* ignore */
  }
  return token
}

export function readQQProactiveToken(file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

export async function sendQQProactive({ origin, token, text, timeoutMs = 30000 }) {
  if (typeof origin !== 'string' || origin.length === 0) return { ok: false, error: 'no_origin' }
  const response = await fetch(origin.replace(/\/+$/, '') + '/api/qqbot/proactive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, text }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || data.ok !== true) return { ok: false, error: data?.error || `http_${response.status}` }
  return { ok: true }
}
