// lib/integrations/qq-bridge.mjs —— QQ/对话传话工具（v0.2.0 从独立子插件并入主包）
//
// 只做传话：QQ agent 调 little_whale_chat，工具 POST 到本机小鲸鱼 chat.json。
// 工具名/参数/输出结构保持不变，dsh-qqbot 与两个 preset 无需改动。
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function stateDir() {
  const base = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh')
  return path.join(base, '.dsh-poetry')
}

function readToken() {
  try {
    return readFileSync(path.join(stateDir(), 'chat-token'), 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * 注册 little_whale_chat 工具。宿主没有 tools 服务时静默跳过（核心功能不受影响）。
 * @param {{host: object, hostCtx: object, logger?: object|null}} options
 * @returns {() => void} disposer
 */
export function registerLittleWhaleChatTool(options = {}) {
  const host = options.host ?? null
  const hostCtx = options.hostCtx ?? null
  const logger = options.logger ?? null
  const tools = host && typeof host.get === 'function' ? host.get(hostCtx, 'tools') : null
  if (!tools || typeof tools.register !== 'function') {
    logger?.info?.('[dsh-little-whale] 宿主未提供 tools，跳过 little_whale_chat')
    return () => {}
  }
  const webServer = host && typeof host.get === 'function' ? host.get(hostCtx, 'webServer') : null
  const origin = webServer && typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : 'http://127.0.0.1'
  const endpoint = String(origin).replace(/\/+$/, '') + '/api/dsh-poetry/chat.json'
  const attachments = host && typeof host.get === 'function' ? host.get(hostCtx, 'attachments') : null

  let dispose = null
  try {
    dispose = tools.register({
      name: 'little_whale_chat',
      description:
        '把小鲸鱼自己的回复带给对话。传入用户原话；返回她的 reply（可能还带着她攒着没发出的 pending 消息）。drainOnly=true 时只取她攒着的留言、不叫她回复（用于对话推送）。不要用它回答非小鲸鱼的问题。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '用户的原话（drainOnly 时可空）' },
          peerId: { type: 'string', description: '用户/会话的稳定标识（可选）' },
          drainOnly: { type: 'boolean', description: '只取她攒着的留言，不叫她回复（可选）' },
        },
        required: [],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            reply: { type: 'string' },
            pending: { type: 'array', items: { type: 'string' } },
            image: { type: 'object' },
          },
          required: ['reply'],
          additionalProperties: false,
        },
        render(_args, value) {
          const pending = Array.isArray(value && value.pending)
            ? value.pending.filter((item) => typeof item === 'string' && item.trim().length > 0)
            : []
          const parts = [...pending.map((item) => item.trim()), String(value && value.reply ? value.reply : '')].filter(
            (item) => item.length > 0,
          )
          const content = [{ type: 'text', text: parts.join('\n\n') }]
          if (value && value.image) content.push({ type: 'image', attachment: value.image })
          return content
        },
      },
      async execute(args, exec) {
        const token = readToken()
        if (token.length === 0) throw new Error('小鲸鱼 chat token 不存在')
        const drainOnly = args && args.drainOnly === true
        const text = String(args && args.text ? args.text : '').trim()
        if (!drainOnly && text.length === 0) throw new Error('text 为空')
        const peerId = String(args && args.peerId ? args.peerId : 'gui')
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(drainOnly ? { token, peerId, drainOnly: true } : { token, text, peerId }),
          signal: exec && exec.signal ? exec.signal : undefined,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok || !data || data.ok !== true) {
          throw new Error(`小鲸鱼暂时没有回复（${response.status}）`)
        }
        const pending = Array.isArray(data.pending)
          ? data.pending.map((item) => String(item || '')).filter((item) => item.length > 0)
          : []
        let image = null
        try {
          const list = Array.isArray(data.images) ? data.images.slice(0, 1) : []
          if (list.length > 0 && attachments && typeof attachments.saveImages === 'function') {
            const raw = String(list[0].dataBase64 || '')
            const buffer = raw.length > 0 ? Buffer.from(raw, 'base64') : null
            if (buffer && buffer.length > 0) {
              const refs = await attachments.saveImages([
                { data: buffer, mediaType: String(list[0].mediaType || 'image/png') },
              ])
              if (Array.isArray(refs) && refs.length > 0) image = refs[0]
            }
          }
        } catch {
          image = null
        }
        const reply = String(data.reply || '')
        if (drainOnly && pending.length === 0 && reply.length === 0) {
          return { reply: '（没有新留言）', pending, ...(image ? { image } : {}) }
        }
        return { reply, pending, ...(image ? { image } : {}) }
      },
      isConcurrencySafe() {
        return false
      },
      timeoutMs: 60000,
    })
  } catch (error) {
    logger?.warn?.(`[dsh-little-whale] 注册 little_whale_chat 失败：${error instanceof Error ? error.message : String(error)}`)
    return () => {}
  }
  return () => {
    try {
      if (typeof dispose === 'function') dispose()
    } catch {
      /* ignore */
    }
  }
}
