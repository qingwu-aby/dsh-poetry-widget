// lib/outbox.mjs —— 小鲸鱼的最小 durable outbox（v2.55）。
//
// 借鉴 dsh-superagent：消息先落盘，再发送；失败退避重试；同一目标顺序；
// 只有发送成功才标 sent；连续失败三次才进 health，避免一次网络抖动就报警。
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

export const OUTBOX_VERSION = 1
export const OUTBOX_MAX = 200
export const OUTBOX_MAX_ATTEMPTS = 3

export function createOutbox(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'outbox.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const senders = options.senders && typeof options.senders === 'object' ? options.senders : {}
  let state = load()
  let flushing = false

  function load() {
    try {
      if (!existsSync(file)) return { ok: true, v: OUTBOX_VERSION, items: [], updatedAt: now() }
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      return {
        ok: true,
        v: OUTBOX_VERSION,
        items: Array.isArray(parsed.items)
          ? parsed.items
              .filter((item) => item && typeof item.text === 'string' && typeof item.source === 'string')
              .map((item) => ({
                id: String(item.id || ''),
                source: String(item.source),
                threadId: String(item.threadId || ''),
                kind: String(item.kind || 'message'),
                text: String(item.text).slice(0, 5000),
                status: ['pending', 'sent', 'failed', 'dropped'].includes(item.status) ? item.status : 'pending',
                attempts: Number.isFinite(item.attempts) ? item.attempts : 0,
                nextAt: Number.isFinite(item.nextAt) ? item.nextAt : 0,
                createdAt: Number.isFinite(item.createdAt) ? item.createdAt : now(),
                sentAt: Number.isFinite(item.sentAt) ? item.sentAt : 0,
                error: String(item.error || '').slice(0, 300),
              }))
              .slice(-OUTBOX_MAX)
          : [],
        updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : now(),
      }
    } catch {
      return { ok: true, v: OUTBOX_VERSION, items: [], updatedAt: now() }
    }
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ...state, updatedAt: now() })
    } catch (error) {
      logger?.warn?.(`[dsh-little-whale] outbox 写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function enqueue(input = {}) {
    const source = String(input.source || 'qq')
    const text = String(input.text || '').trim()
    if (!text) return { ok: false, error: 'empty' }
    const id = String(input.id || `out-${now()}-${Math.random().toString(36).slice(2, 7)}`)
    const existing = state.items.find((item) => item.id === id)
    if (existing) return { ok: true, item: existing, duplicate: true }
    const item = {
      id,
      source,
      threadId: String(input.threadId || ''),
      kind: String(input.kind || 'message'),
      text: text.slice(0, 5000),
      status: 'pending',
      attempts: 0,
      nextAt: 0,
      createdAt: now(),
      sentAt: 0,
      error: '',
    }
    state.items.push(item)
    state.items = state.items.slice(-OUTBOX_MAX)
    persist()
    return { ok: true, item }
  }

  async function flush() {
    if (flushing) return { ok: false, error: 'busy' }
    flushing = true
    let sent = 0
    let failed = 0
    try {
      for (const item of state.items) {
        if (item.status !== 'pending') continue
        if (item.nextAt > now()) continue
        const sender = senders[item.source]
        if (typeof sender !== 'function') {
          item.status = 'failed'
          item.error = `no_sender:${item.source}`
          persist()
          failed += 1
          continue
        }
        try {
          const result = await sender(item)
          if (result && result.ok === true) {
            item.status = 'sent'
            item.sentAt = now()
            item.error = ''
            sent += 1
          } else {
            item.attempts += 1
            item.error = String(result?.error || 'send_failed').slice(0, 300)
            item.status = item.attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending'
            item.nextAt = now() + Math.min(300_000, 2000 * 2 ** Math.max(0, item.attempts - 1))
            failed += 1
          }
        } catch (error) {
          item.attempts += 1
          item.error = (error instanceof Error ? error.message : String(error)).slice(0, 300)
          item.status = item.attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending'
          item.nextAt = now() + Math.min(300_000, 2000 * 2 ** Math.max(0, item.attempts - 1))
          failed += 1
        }
        persist()
      }
    } finally {
      flushing = false
    }
    return { ok: true, sent, failed, pending: state.items.filter((item) => item.status === 'pending').length }
  }

  async function deliverNow(input = {}) {
    const queued = enqueue(input)
    if (queued.ok !== true) return queued
    await flush()
    const item = state.items.find((entry) => entry.id === queued.item.id)
    return { ok: item?.status === 'sent', status: item?.status || 'pending', error: item?.error || '' }
  }

  function pending() {
    return state.items.filter((item) => item.status === 'pending')
  }

  function snapshot() {
    return {
      pending: pending().length,
      failed: state.items.filter((item) => item.status === 'failed').length,
      sent: state.items.filter((item) => item.status === 'sent').length,
      recentFailed: state.items.filter((item) => item.status === 'failed').slice(-3).map((item) => ({ id: item.id, source: item.source, error: item.error })),
    }
  }

  return { file, enqueue, flush, deliverNow, pending, snapshot }
}
