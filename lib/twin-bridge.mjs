// lib/twin-bridge.mjs —— 两只小鲸鱼之间的信件（v2.28）。
//
// 只交换“写下来的话”，不共享记忆、状态、文件。消息落在一个公共 transcript 里；
// 每个个体只读写给自己的信；自己的记忆/情感永远在各自目录。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveSettingsPath } from './settings-store.mjs'

export const TWIN_LETTER_MAX = 600
export const TWIN_LETTER_DAILY_MAX = 8
export const TWIN_TRANSCRIPT_MAX = 200

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

  function append(input) {
    const from = input.from === 'twin' ? 'twin' : 'primary'
    const to = input.to === 'twin' ? 'twin' : 'primary'
    if (from === to) return null
    const text = cleanText(input.text)
    if (text.length < 1) return null
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
      return { ok: true, message }
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

  return { dir, append, readFor, unread, markRead, lastRead, transcript, clearRead: (agent) => markRead(agent, 0) }
}
