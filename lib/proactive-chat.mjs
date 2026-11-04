// lib/proactive-chat.mjs —— 她主动找用户说话（v2.50）。
//
// 只在用户已经聊过、且最近没有在聊时，隔一段时间主动发一条；
// 不刷屏，不重复“在吗”，不在深夜打扰。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_INTERVAL_MS = 20 * 60 * 1000
const DEFAULT_INITIAL_MS = 2 * 60 * 1000
const DEFAULT_IDLE_MS = 15 * 60 * 1000

function hourShanghai(ts = Date.now()) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(ts)))
  } catch {
    return new Date(ts).getHours()
  }
}

export function startProactiveChat(options = {}) {
  const chat = options.chat
  const sendMessage =
    typeof options.sendMessage === 'function' ? options.sendMessage : typeof options.sendQQ === 'function' ? options.sendQQ : null
  const peerId = typeof options.peerId === 'string' && options.peerId.length > 0 ? options.peerId : 'gui'
  const attention = options.attention ?? null
  const stateFile = options.stateFile
  const logger = options.logger ?? null
  const env = options.env ?? process.env
  const intervalMs = Number.parseInt(String(env.DSH_POETRY_PROACTIVE_INTERVAL_MS ?? ''), 10) || DEFAULT_INTERVAL_MS
  const initialMs = Number.parseInt(String(env.DSH_POETRY_PROACTIVE_INITIAL_MS ?? ''), 10) || DEFAULT_INITIAL_MS
  const idleMs = Number.parseInt(String(env.DSH_POETRY_PROACTIVE_IDLE_MS ?? ''), 10) || DEFAULT_IDLE_MS
  let timer = null
  let disposed = false
  let busy = false

  function readState() {
    try {
      if (!existsSync(stateFile)) return { lastProactiveAt: 0 }
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'))
      return { lastProactiveAt: Number.isFinite(parsed.lastProactiveAt) ? parsed.lastProactiveAt : 0 }
    } catch {
      return { lastProactiveAt: 0 }
    }
  }

  function saveState(state) {
    try {
      writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }

  async function run() {
    if (disposed || busy) return
    const now = Date.now()
    const hour = hourShanghai(now)
    if (hour < 8 || hour >= 23) return
    const lastUserAt = typeof chat.lastUserAt === 'function' ? chat.lastUserAt() : 0
    if (lastUserAt === 0) return
    if (now - lastUserAt < idleMs) return
    const state = readState()
    if (now - state.lastProactiveAt < intervalMs) return
    // 注意力闸门：已有待处理的主动草稿时，不再生成第二条。
    if (attention !== null && typeof attention.pending === 'function') {
      const pending = attention.pending()
      if (pending.some((item) => item.kind === 'social')) return
    }
    busy = true
    try {
      const generated = await chat.proactive({ peerId, dryRun: true })
      if (!generated || generated.ok !== true) return
      const mode = attention !== null && typeof attention.mode === 'function' ? attention.mode() : 'auto'
      if (attention !== null && typeof attention.add === 'function') {
        const added = attention.add({
          kind: 'social',
          text: generated.reply,
          reason: '她有一件具体的事想说，先过注意力闸门',
          source: 'proactive',
          draft: mode === 'observe',
        })
        if (!added || added.ok !== true) return
        if (mode === 'observe') {
          logger?.info?.(`[dsh-little-whale] 主动消息进入观察：${generated.reply.slice(0, 60)}`)
          return
        }
        if (sendMessage === null) return
        const sent = await sendMessage(generated.reply, { attentionId: added.item.id })
        if (sent.ok === true) {
          attention.markSent(added.item.id)
          state.lastProactiveAt = now
          saveState(state)
          logger?.info?.(`[dsh-little-whale] 主动消息已排队：${generated.reply.slice(0, 60)}`)
        } else if (sent.status === 'pending') {
          logger?.info?.('[dsh-little-whale] 主动消息进入 outbox，等待重试')
        } else {
          attention.markFailed(added.item.id, { error: String(sent.error || 'send_failed') })
        }
        return
      }
      if (sendMessage === null) return
      const sent = await sendMessage(generated.reply)
      if (sent.ok === true) {
        if (typeof chat.recordProactive === 'function') chat.recordProactive('qq', generated.reply)
        state.lastProactiveAt = now
        saveState(state)
        logger?.info?.(`[dsh-little-whale] 主动发 QQ：${generated.reply.slice(0, 60)}`)
      }
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 主动聊天失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
    } finally {
      busy = false
    }
  }

  function schedule(delay) {
    if (disposed) return
    timer = setTimeout(async () => {
      timer = null
      await run()
      if (!disposed) schedule(intervalMs)
    }, delay)
    timer.unref?.()
  }

  schedule(initialMs)
  return {
    stop() {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
    triggerNow: run,
    snapshot: () => ({ intervalMs, initialMs, idleMs }),
  }
}
