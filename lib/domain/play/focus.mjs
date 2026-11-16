// lib/domain/play/focus.mjs —— 单一注意力（v0.7.0）
//
// 小鲸鱼同一时刻只有一个“当前专注”：
//   idle / chat / game / build
// 游戏进行中（focus=game 且心跳未过期）时，聊天走“她在游戏里”的简短回应并排队，
// 不再并发调用聊天模型；游戏结束由 bot 把 focus 置回 idle。
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import path from 'node:path'


const TTL_MS = 120000
const MAX_DEFERRED = 20

function clean(text, max = 240) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? value.slice(0, max) : value
}

export function createFocusState(options = {}) {
  const file = options.file ?? ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = { mode: 'idle', detail: '', at: 0, deferred: [] }
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        state = {
          mode: ['idle', 'chat', 'game', 'build'].includes(parsed.mode) ? parsed.mode : 'idle',
          detail: clean(parsed.detail, 160),
          at: Number(parsed.at) || 0,
          deferred: Array.isArray(parsed.deferred) ? parsed.deferred.slice(-MAX_DEFERRED) : [],
        }
      }
    } catch (_error) {}
  }
  function save() {
    if (!file) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      writeFileSync(temp, JSON.stringify(state, null, 2) + '\n')
      renameSync(temp, file)
    } catch (_error) {}
  }
  function set(mode, detail = '') {
    state.mode = ['idle', 'chat', 'game', 'build'].includes(mode) ? mode : 'idle'
    state.detail = clean(detail, 160)
    state.at = now()
    save()
    return snapshot()
  }
  function touch(mode = 'game', detail = '') {
    state.mode = mode
    state.detail = clean(detail, 160)
    state.at = now()
    save()
    return snapshot()
  }
  function get() {
    const active = state.mode !== 'idle' && now() - state.at < TTL_MS
    return {
      mode: active ? state.mode : 'idle',
      detail: active ? state.detail : '',
      at: state.at,
      active,
      deferred: state.deferred.slice(),
    }
  }
  function defer(entry) {
    const text = clean(entry && entry.text, 240)
    if (text.length === 0) return
    state.deferred.push({ peerId: clean(entry.peerId, 80) || 'gui', text, at: now() })
    if (state.deferred.length > MAX_DEFERRED) state.deferred = state.deferred.slice(-MAX_DEFERRED)
    save()
  }
  function drainDeferred() {
    const items = state.deferred.slice()
    state.deferred = []
    save()
    return items
  }
  function snapshot() {
    return { ok: true, ...get() }
  }
  return { set, touch, get, defer, drainDeferred, snapshot }
}

export function createFocusHandler(options = {}) {
  const focus = options.focus ?? null
  const tokenFile = options.tokenFile ?? ''
  return async function focusHandler(req, res) {
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method === 'GET') {
      send(200, focus ? focus.snapshot() : { ok: false, mode: 'idle' })
      return
    }
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (_error) {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    let expected = ''
    try { expected = String(readFileSync(tokenFile, 'utf8')).trim() } catch (_error) {}
    if (expected.length === 0 || payload.token !== expected) {
      send(403, { ok: false, error: 'forbidden' })
      return
    }
    if (!focus) {
      send(200, { ok: false, error: 'unavailable' })
      return
    }
    if (payload.active === false) send(200, focus.set('idle', '游戏结束'))
    else send(200, focus.touch(payload.mode === 'build' ? 'build' : 'game', payload.detail || '在 Minecraft 里'))
  }
}
