// lib/attention.mjs —— 注意力闸门（v2.53）。
//
// 借鉴 dsh-superagent：内部生成可以无限，对外说话必须有一件具体的事；
// 主动模式默认 observe：她可以准备，但不直接发；人看过后再切 auto。
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../settings-store.mjs'

export const ATTENTION_ROUTE = '/api/dsh-poetry/attention.json'
export const ATTENTION_VERSION = 1
export const ATTENTION_MODES = Object.freeze(['observe', 'auto'])
export const ATTENTION_MAX_PENDING = 5
export const ATTENTION_MAX_SOCIAL = 1

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeText(value) {
  return clean(value, 500).replace(/[，。；：、,.!?;:\s]/g, '').toLowerCase()
}

export function resolveAttentionPath(env = process.env, home = null, stateDir = null) {
  if (typeof stateDir === 'string' && stateDir.length > 0) return path.join(stateDir, 'attention.json')
  const base = env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(home ?? '', '.dsh')
  return path.join(base, '.dsh-poetry', 'attention.json')
}

export function createAttentionStore(options = {}) {
  const file = path.resolve(options.file ?? resolveAttentionPath(options.env ?? process.env, options.home ?? null, options.stateDir ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  let cache = null

  function fresh() {
    return { ok: true, v: ATTENTION_VERSION, mode: 'observe', items: [], updatedAt: now() }
  }

  function normalizeMode(value) {
    return ATTENTION_MODES.includes(value) ? value : 'observe'
  }

  function load() {
    try {
      if (!existsSync(file)) return fresh()
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!parsed || typeof parsed !== 'object') return fresh()
      const items = Array.isArray(parsed.items)
        ? parsed.items
            .filter((item) => item && typeof item.text === 'string')
            .map((item) => ({
              id: clean(item.id, 80) || `att-${now()}`,
              kind: ['question', 'result', 'social'].includes(item.kind) ? item.kind : 'social',
              text: clean(item.text, 500),
              reason: clean(item.reason, 160),
              source: clean(item.source, 40) || 'self',
              threadId: clean(item.threadId, 80),
              draft: item.draft === true,
              status: ['pending', 'sent', 'dismissed', 'expired', 'failed'].includes(item.status) ? item.status : 'pending',
              createdAt: Number.isFinite(item.createdAt) ? item.createdAt : now(),
              sentAt: Number.isFinite(item.sentAt) ? item.sentAt : 0,
              meta: item.meta && typeof item.meta === 'object' ? item.meta : {},
            }))
            .filter((item) => item.text.length > 0)
            .slice(-100)
        : []
      return { ok: true, v: ATTENTION_VERSION, mode: normalizeMode(parsed.mode), items, updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : now() }
    } catch {
      return fresh()
    }
  }

  function ensure() {
    if (cache === null) {
      const existed = existsSync(file)
      cache = load()
      if (!existed) persist(cache)
    }
    return cache
  }

  function persist(state) {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ...state, ok: true, v: ATTENTION_VERSION, updatedAt: now() })
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] attention 写入失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
    }
  }

  function pending() {
    return ensure().items.filter((item) => item.status === 'pending')
  }

  function add(input = {}) {
    const state = ensure()
    const text = clean(input.text, 500)
    if (text.length < 2) return { ok: false, reason: 'empty' }
    const kind = ['question', 'result', 'social'].includes(input.kind) ? input.kind : 'social'
    const normalized = normalizeText(text)
    const existing = state.items.find((item) => item.status === 'pending' && normalizeText(item.text) === normalized)
    if (existing) return { ok: true, item: existing, duplicate: true }
    if (kind === 'social' && pending().filter((item) => item.kind === 'social').length >= ATTENTION_MAX_SOCIAL) {
      return { ok: false, reason: 'social_pending' }
    }
    if (pending().length >= ATTENTION_MAX_PENDING) return { ok: false, reason: 'too_many' }
    const item = {
      id: clean(input.id, 80) || `att-${now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      text,
      reason: clean(input.reason, 160),
      source: clean(input.source, 40) || 'self',
      threadId: clean(input.threadId, 80),
      draft: input.draft === true,
      status: 'pending',
      createdAt: now(),
      sentAt: 0,
      meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    }
    state.items.push(item)
    state.items = state.items.slice(-100)
    persist(state)
    return { ok: true, item }
  }

  function mark(id, status, extra = {}) {
    const state = ensure()
    const item = state.items.find((entry) => entry.id === id)
    if (!item) return { ok: false, reason: 'not_found' }
    item.status = status
    if (status === 'sent') item.sentAt = now()
    if (extra && typeof extra === 'object') item.meta = { ...item.meta, ...extra }
    persist(state)
    return { ok: true, item }
  }

  function dismiss(id) {
    return mark(id, 'dismissed')
  }

  function expire(olderThanMs = 24 * 60 * 60 * 1000) {
    const state = ensure()
    let changed = 0
    const cutoff = now() - olderThanMs
    for (const item of state.items) {
      if (item.status === 'pending' && item.createdAt < cutoff) {
        item.status = 'expired'
        changed += 1
      }
    }
    if (changed > 0) persist(state)
    return changed
  }

  function setMode(mode) {
    const state = ensure()
    state.mode = normalizeMode(mode)
    persist(state)
    return state.mode
  }

  function list(limit = 20) {
    return ensure().items.slice(-Math.max(1, Math.min(100, limit))).reverse()
  }

  return {
    file,
    mode: () => ensure().mode,
    setMode,
    add,
    pending,
    list,
    dismiss,
    markSent: (id, extra) => mark(id, 'sent', extra),
    markFailed: (id, extra) => mark(id, 'failed', extra),
    expire,
    snapshot: () => ({ ...ensure(), pending: pending().length }),
  }
}

/** GET /attention.json；POST 支持 send / dismiss / mode。 */
export function createAttentionHandler(options = {}) {
  const store = options.attention
  const sendText = typeof options.sendText === 'function' ? options.sendText : null
  const onSent = typeof options.onSent === 'function' ? options.onSent : null
  const onAnswer = typeof options.onAnswer === 'function' ? options.onAnswer : null
  return async function attentionHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    if (method === 'GET' || method === 'HEAD') {
      send(200, { ok: true, mode: store.mode(), items: store.list(20), pending: store.pending().length })
      return
    }
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, HEAD, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    const action = String(payload?.action ?? '')
    if (action === 'mode') {
      if (!ATTENTION_MODES.includes(payload?.mode)) {
        send(400, { ok: false, error: 'bad_mode' })
        return
      }
      send(200, { ok: true, mode: store.setMode(payload.mode) })
      return
    }
    const id = String(payload?.id ?? '')
    const item = store.list(100).find((entry) => entry.id === id)
    if (!item || item.status !== 'pending') {
      send(404, { ok: false, error: 'not_found' })
      return
    }
    if (action === 'dismiss') {
      store.dismiss(id)
      send(200, { ok: true, dismissed: id })
      return
    }
    if (action === 'answer') {
      if (onAnswer === null) {
        send(400, { ok: false, error: 'answer_unsupported' })
        return
      }
      const text = cleanText(payload?.text, 400)
      if (text.length < 1) {
        send(400, { ok: false, error: 'empty_answer' })
        return
      }
      try {
        const result = await onAnswer(item, text)
        if (result === null || result === undefined || result === false) {
          send(400, { ok: false, error: 'answer_refused' })
          return
        }
        store.dismiss(id)
        send(200, { ok: true, answered: id })
      } catch {
        send(500, { ok: false, error: 'answer_failed' })
      }
      return
    }
    if (action === 'send') {
      if (sendText === null) {
        send(503, { ok: false, error: 'qq_unavailable' })
        return
      }
      const result = await sendText(item)
      if (result && result.ok === true) {
        store.markSent(id)
        send(200, { ok: true, sent: id })
      } else if (result && result.status === 'pending') {
        // 已进入 durable outbox；保留 pending，等它真正发出后再由 onSent 标记。
        send(202, { ok: true, queued: true, id })
      } else {
        store.markFailed(id, { error: String(result?.error ?? 'send_failed') })
        send(502, { ok: false, error: result?.error || 'send_failed' })
      }
      return
    }
    send(400, { ok: false, error: 'bad_action' })
  }
}
