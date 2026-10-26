// lib/presence.mjs —— 用户在场（v2.25，他者约束）。
//
// 只记录“用户出现过”这一件事，不记录点击内容、不记录输入文本。
// 客户端节流后 POST；主机端再限一次，避免刷新/连续操作刷屏。
import { WORLD_FEEDBACK_MAX_CHARS } from './world-feedback.mjs'

export const PRESENCE_ROUTE = '/api/dsh-poetry/presence.json'
export const PRESENCE_MIN_GAP_MS = 60 * 1000

function cleanKind(value) {
  const kind = String(value ?? '').trim().toLowerCase()
  if (kind === 'tap' || kind === 'panel' || kind === 'drag' || kind === 'read' || kind === 'settings') return kind
  return 'tap'
}

export function createPresenceHandler(options = {}) {
  const worldFeedback = options.worldFeedback
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  let lastAt = 0
  return async function presenceHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    const reject = (status, message) => {
      const body = JSON.stringify({ ok: false, error: { code: 'PRESENCE_REJECTED', message } })
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = {}
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      if (chunks.length > 0) payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      reject(400, '请求体不是合法 JSON')
      return
    }
    const at = now()
    if (lastAt > 0 && at - lastAt < PRESENCE_MIN_GAP_MS) {
      const body = JSON.stringify({ ok: true, skipped: true, updatedAt: lastAt })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
      return
    }
    lastAt = at
    try {
      worldFeedback.record({
        source: 'user',
        kind: 'presence',
        ok: true,
        summary: `用户在场（${cleanKind(payload.kind)}）`.slice(0, WORLD_FEEDBACK_MAX_CHARS),
      })
    } catch (error) {
      logger?.warn?.(`[dsh-little-whale] 用户在场记录失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const body = JSON.stringify({ ok: true, updatedAt: at })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    res.end(body)
  }
}
