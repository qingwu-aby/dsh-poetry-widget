// lib/twin-bridge.mjs —— 两只小鲸鱼之间的信件（v2.28）。
//
// 只交换“写下来的话”，不共享记忆、状态、文件。消息落在一个公共 transcript 里；
// 每个个体只读写给自己的信；自己的记忆/情感永远在各自目录。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveSettingsPath } from './settings-store.mjs'

export const TWIN_LETTER_MAX = 5000
export const TWIN_LETTER_DAILY_MAX = 200
export const TWIN_TRANSCRIPT_MAX = 200
export const TWIN_LETTER_MIN_GAP_MS = 30 * 1000
export const TWIN_SESSION_MAX_LETTERS = 12
export const TWIN_SESSION_MAX_MS = 30 * 60 * 1000
export const TWIN_SESSION_COOLDOWN_MS = 30 * 60 * 1000
export const TWIN_WINDOW_MS = 30 * 60 * 1000
export const TWIN_WINDOW_MAX = 40

function cleanText(value, max = TWIN_LETTER_MAX) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function resolveTwinBridgeDir(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'twin-bridge')
}

export function createTwinBridge(options = {}) {
  const dir = path.resolve(options.dir ?? resolveTwinBridgeDir(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const transcriptPath = path.join(dir, 'letters.jsonl')
  const sessionPath = path.join(dir, 'session.json')
  let session = null
  try {
    if (existsSync(sessionPath)) {
      const parsed = JSON.parse(readFileSync(sessionPath, 'utf8'))
      if (parsed && Number.isFinite(parsed.startedAt)) session = parsed
    }
  } catch {
    session = null
  }

  function ensureDir() {
    mkdirSync(dir, { recursive: true })
  }

  function readAll() {
    try {
      if (!existsSync(transcriptPath)) return []
      return readFileSync(transcriptPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line, index) => {
          try {
            const message = JSON.parse(line)
            return message && typeof message.text === 'string' ? { ...message, line: index } : null
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  function normText(text) {
    return String(text ?? '').replace(/[\s，。！？；：、,.!?;:…—\-"'“”‘’（）()]/g, '')
  }

  function bigramSet(text) {
    const value = normText(text)
    const out = new Set()
    for (let i = 0; i + 1 < value.length; i += 1) out.add(value.slice(i, i + 2))
    return out
  }

  function textSimilarity(a, b) {
    const left = bigramSet(a)
    const right = bigramSet(b)
    if (left.size === 0 || right.size === 0) return 0
    let overlap = 0
    for (const gram of left) if (right.has(gram)) overlap += 1
    return (2 * overlap) / (left.size + right.size)
  }

  function saveSession() {
    try {
      ensureDir()
      writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }

  /**
   * 对话轮次的终止条件：一个 session 内最多 12 封或 30 分钟；
   * 到点后关闭 session，并冷却 30 分钟；冷却结束后自动开始新 session。
   */
  function ensureSession(at = now()) {
    if (session === null) {
      session = { startedAt: at, letters: 0, closedAt: null, cooldownUntil: null, reason: '' }
      saveSession()
    }
    if (session.closedAt !== null) {
      if (session.cooldownUntil !== null && at < session.cooldownUntil) return session
      session = { startedAt: at, letters: 0, closedAt: null, cooldownUntil: null, reason: '' }
      saveSession()
    }
    if (session.letters >= TWIN_SESSION_MAX_LETTERS || at - session.startedAt >= TWIN_SESSION_MAX_MS) {
      session.closedAt = at
      session.cooldownUntil = at + TWIN_SESSION_COOLDOWN_MS
      session.reason = session.letters >= TWIN_SESSION_MAX_LETTERS ? 'max_letters' : 'max_time'
      saveSession()
    }
    return session
  }

  function bumpSession(at = now()) {
    const current = ensureSession(at)
    if (current.closedAt !== null) return current
    current.letters += 1
    if (current.letters >= TWIN_SESSION_MAX_LETTERS) {
      current.closedAt = at
      current.cooldownUntil = at + TWIN_SESSION_COOLDOWN_MS
      current.reason = 'max_letters'
    }
    saveSession()
    return current
  }

  /** 通信饱和：频率/窗口/重复度/对话轮次；返回 false 时不应再调用模型写信。 */
  function canSend(agent, kind = 'letter') {
    const current = ensureSession()
    if (current.closedAt !== null) return false
    const who = agent === 'twin' ? 'twin' : 'primary'
    const all = readAll()
    const at = now()
    const day = new Date(at).toISOString().slice(0, 10)
    const sentToday = all.filter((message) => message.from === who && new Date(message.at).toISOString().slice(0, 10) === day).length
    if (sentToday >= TWIN_LETTER_DAILY_MAX) return false
    const recent = all.filter((message) => at - message.at <= TWIN_WINDOW_MS)
    if (recent.length >= TWIN_WINDOW_MAX) return false
    const last = all.length > 0 ? all[all.length - 1] : null
    if (kind === 'reply') return last !== null && last.to === who
    if (last !== null && last.from === who && at - last.at < TWIN_LETTER_MIN_GAP_MS) return false
    return true
  }

  function append(input) {
    const from = input.from === 'twin' ? 'twin' : 'primary'
    const to = input.to === 'twin' ? 'twin' : 'primary'
    if (from === to) return null
    const text = cleanText(input.text)
    if (text.length < 1) return null
    const kind = typeof input.kind === 'string' ? input.kind.slice(0, 20) : 'letter'
    if (!canSend(from, kind)) return { ok: false, error: 'saturated' }
    const previousSame = readAll().filter((message) => message.from === from).slice(-2)
    if (previousSame.some((message) => textSimilarity(message.text, text) >= 0.95)) {
      return { ok: false, error: 'duplicate' }
    }
    const at = now()
    const day = new Date(at).toISOString().slice(0, 10)
    const sentToday = readAll().filter((message) => message.from === from && new Date(message.at).toISOString().slice(0, 10) === day).length
    if (sentToday >= TWIN_LETTER_DAILY_MAX) return { ok: false, error: 'daily_limit' }
    const message = {
      id: `letter-${at}-${Math.floor(Math.random() * 1000)}`,
      from,
      to,
      kind: typeof input.kind === 'string' ? input.kind.slice(0, 20) : 'letter',
      text,
      at,
    }
    try {
      ensureDir()
      appendFileSync(transcriptPath, JSON.stringify(message) + '\n', 'utf8')
      bumpSession(at)
      return { ok: true, message, session: ensureSession(at) }
    } catch (error) {
      logger?.warn?.(`[dsh-little-whale] 信件写入失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, error: 'write_failed' }
    }
  }

  function readFor(agent, limit = 10) {
    const who = agent === 'twin' ? 'twin' : 'primary'
    return readAll()
      .filter((message) => message.to === who)
      .slice(-limit)
  }

  function markRead(agent, ts) {
    try {
      ensureDir()
      writeFileSync(path.join(dir, `read-${agent}.json`), JSON.stringify({ agent, ts, at: now() }), 'utf8')
      return true
    } catch {
      return false
    }
  }

  function lastRead(agent) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, `read-${agent}.json`), 'utf8'))
      return Number.isFinite(parsed.ts) ? parsed.ts : 0
    } catch {
      return 0
    }
  }

  function unread(agent) {
    const since = lastRead(agent)
    return readFor(agent, TWIN_TRANSCRIPT_MAX).filter((message) => message.at > since)
  }

  function transcript(limit = 20) {
    return readAll().slice(-limit)
  }

  return {
    dir,
    append,
    canSend,
    session: () => ensureSession(),
    readFor,
    unread,
    markRead,
    lastRead,
    transcript,
    clearRead: (agent) => markRead(agent, 0),
  }
}
