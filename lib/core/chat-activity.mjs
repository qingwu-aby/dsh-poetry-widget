// lib/core/chat-activity.mjs —— Chat Activity 适配器（Gate D1，纯逻辑/依赖注入）。
//
// 目标：把聊天收成统一 Activity（manifest / event envelope / Task / Receipt），**不改现有聊天行为**：
//   · manifest：id=chat，events chat.received/chat.replied/chat.interrupted，tools chat.reply，task kind chat.turn；
//   · toEvent(message)：把一条聊天消息转成 Gate A7 统一 event envelope（chat.received）；
//   · createTask(message)：生成 chat.turn Task 描述 + 幂等键（peerId + messageId）；
//   · execute(task, ctx)：调用注入的 reply 函数（不直接调模型/HTTP），返回 receipt（replyId/at/ok）；
//     ctx.signal 取消 → 返回 cancelled receipt（调用方负责停止底层工作）；
//   · toRepliedEvent / toInterruptedEvent：把执行结果转成 chat.replied / chat.interrupted 事件；
//   · 不写入现有 chat service：本模块只产出对象，落库/发送由调用方（Gate D4 Hub 装配）负责。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟、reply、随机源均可注入。

import { validateActivityManifest } from './activity-manifest.mjs'
import { createEventEnvelope, validateEventEnvelope } from './event-schema.mjs'

/** 实现版本。 */
export const CHAT_ACTIVITY_VERSION = 1

/** Activity id / 版本。 */
export const CHAT_ACTIVITY_ID = 'chat'
export const CHAT_ACTIVITY_MANIFEST_VERSION = '1.0.0'

/** 事件类型。 */
export const CHAT_EVENTS = Object.freeze({
  received: 'chat.received',
  replied: 'chat.replied',
  interrupted: 'chat.interrupted',
})

/** Task kind / 工具名。 */
export const CHAT_TASK_KIND = 'chat.turn'
export const CHAT_TOOL_REPLY = 'chat.reply'

/** 错误码。 */
export const CHAT_ACTIVITY_CODES = Object.freeze({
  invalidMessage: 'CHAT_INVALID_MESSAGE',
  invalidTask: 'CHAT_INVALID_TASK',
  invalidEvent: 'CHAT_INVALID_EVENT',
  noReplyFunction: 'CHAT_NO_REPLY_FUNCTION',
  invalidReply: 'CHAT_INVALID_REPLY',
  replyFailed: 'CHAT_REPLY_FAILED',
  cancelled: 'CHAT_CANCELLED',
})

/** 限制。 */
export const CHAT_ACTIVITY_LIMITS = Object.freeze({
  peerIdMax: 120,
  messageIdMax: 128,
  textMax: 4000,
  channelMax: 40,
  taskKeyMax: 128,
  replyIdMax: 128,
})

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function boundedText(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max || CONTROL_CHARS.test(trimmed)) return null
  return trimmed
}

function normalizeMessage(raw) {
  if (!isPlainObject(raw)) return errorResult(CHAT_ACTIVITY_CODES.invalidMessage, 'message 必须是对象')
  const peerId = boundedText(raw.peerId, CHAT_ACTIVITY_LIMITS.peerIdMax)
  if (peerId === null) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidMessage, `peerId 必须是 1–${CHAT_ACTIVITY_LIMITS.peerIdMax} 字非空字符串`)
  }
  const messageId = boundedText(raw.messageId, CHAT_ACTIVITY_LIMITS.messageIdMax)
  if (messageId === null) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidMessage, `messageId 必须是 1–${CHAT_ACTIVITY_LIMITS.messageIdMax} 字非空字符串`)
  }
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text.length === 0 || text.length > CHAT_ACTIVITY_LIMITS.textMax) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidMessage, `text 必须是 1–${CHAT_ACTIVITY_LIMITS.textMax} 字`)
  }
  const at = Number.isFinite(Number(raw.at)) ? Number(raw.at) : null
  const channel = boundedText(raw.channel, CHAT_ACTIVITY_LIMITS.channelMax)
  const kind = boundedText(raw.kind, CHAT_ACTIVITY_LIMITS.channelMax)
  return {
    ok: true,
    message: {
      peerId,
      messageId,
      text,
      at,
      channel: channel ?? '',
      kind: kind ?? '',
    },
  }
}

/** 幂等键（peerId + messageId；超长时截断并带长度，保证 ≤128）。 */
export function chatTaskKey(message) {
  const peerId = String(message?.peerId ?? '').slice(0, 60)
  const messageId = String(message?.messageId ?? '').slice(0, 60)
  return ('chat.turn:' + peerId + ':' + messageId).slice(0, CHAT_ACTIVITY_LIMITS.taskKeyMax)
}

/** Chat Activity manifest 原始声明（可交给 validateActivityManifest 校验）。 */
export const CHAT_MANIFEST_RAW = Object.freeze({
  id: CHAT_ACTIVITY_ID,
  version: CHAT_ACTIVITY_MANIFEST_VERSION,
  name: '聊天',
  events: Object.freeze([CHAT_EVENTS.received, CHAT_EVENTS.replied, CHAT_EVENTS.interrupted]),
  tasks: Object.freeze([Object.freeze({ kind: CHAT_TASK_KIND, goal: '回复一条聊天消息并记录回执', success: '回复已发送且回执已记录', priority: 50 })]),
  tools: Object.freeze([CHAT_TOOL_REPLY]),
  permissions: Object.freeze(['model']),
  resources: Object.freeze({ model: true, foreground: true, maxMinutes: 5 }),
})

/** Chat Activity 规范化 manifest（模块加载时校验一次；返回冻结副本）。 */
export const CHAT_MANIFEST = (() => {
  const validated = validateActivityManifest(CHAT_MANIFEST_RAW)
  if (validated.ok !== true) {
    throw new Error('Chat manifest 非法：' + validated.errors.map((item) => item.message).join('; '))
  }
  return Object.freeze(validated.manifest)
})()

/** 获取 Chat manifest（冻结副本）。 */
export function getChatManifest() {
  return JSON.parse(JSON.stringify(CHAT_MANIFEST))
}

function buildEvent(type, payload, subject, options) {
  const envelope = createEventEnvelope(
    {
      activity: CHAT_ACTIVITY_ID,
      type,
      version: 1,
      at: options.at,
      subject,
      topics: options.topics,
      payload,
    },
    { now: options.now, prefix: 'chat', random: options.random },
  )
  if (envelope.ok !== true) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidEvent, '事件 envelope 未通过校验', { errors: envelope.errors })
  }
  return { ok: true, event: envelope.event }
}

/**
 * 聊天消息 → chat.received 事件 envelope。
 * @param {object} message {peerId, messageId, text, at?, channel?, kind?}
 * @param {{now?: () => number, random?: () => number, at?: number}} [options]
 */
export function toEvent(message, options = {}) {
  const normalized = normalizeMessage(message)
  if (normalized.ok !== true) return normalized
  const spec = normalized.message
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const at = Number.isFinite(Number(options.at)) ? Number(options.at) : spec.at ?? now()
  const topicPeer = 'peer:' + spec.peerId.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').slice(0, 60)
  return buildEvent(
    CHAT_EVENTS.received,
    {
      peerId: spec.peerId,
      messageId: spec.messageId,
      text: spec.text,
      ...(spec.channel.length > 0 ? { channel: spec.channel } : {}),
      ...(spec.kind.length > 0 ? { kind: spec.kind } : {}),
    },
    'peer:' + spec.peerId,
    {
      at,
      topics: ['chat.received', topicPeer],
      now: options.now,
      random: options.random,
    },
  )
}

/**
 * 聊天消息 → chat.turn Task 描述（带幂等键 peerId+messageId）。
 * @param {object} message
 * @param {{priority?: number, now?: () => number}} [options]
 */
export function createTask(message, options = {}) {
  const normalized = normalizeMessage(message)
  if (normalized.ok !== true) return normalized
  const spec = normalized.message
  const specOptions = isPlainObject(options) ? options : {}
  const priority = Number.isFinite(Number(specOptions.priority)) ? Math.trunc(Number(specOptions.priority)) : 50
  return {
    ok: true,
    task: {
      activity: CHAT_ACTIVITY_ID,
      kind: CHAT_TASK_KIND,
      key: chatTaskKey(spec),
      priority,
      title: ('回复 ' + spec.peerId).slice(0, 120),
      payload: {
        peerId: spec.peerId,
        messageId: spec.messageId,
        text: spec.text,
        ...(spec.channel.length > 0 ? { channel: spec.channel } : {}),
      },
      meta: { tool: CHAT_TOOL_REPLY },
    },
  }
}

function normalizeReplyResult(result, options) {
  if (typeof result === 'string') {
    const text = result.trim()
    if (text.length === 0) return errorResult(CHAT_ACTIVITY_CODES.invalidReply, 'reply 返回空字符串')
    return {
      ok: true,
      replyId: options.replyId,
      text,
      at: options.at,
    }
  }
  if (!isPlainObject(result)) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidReply, 'reply 必须返回字符串或 {replyId, text?} 对象')
  }
  const replyId =
    typeof result.replyId === 'string' && result.replyId.trim().length > 0
      ? result.replyId.trim().slice(0, CHAT_ACTIVITY_LIMITS.replyIdMax)
      : options.replyId
  const text = typeof result.text === 'string' ? result.text.trim().slice(0, CHAT_ACTIVITY_LIMITS.textMax) : ''
  const at = Number.isFinite(Number(result.at)) ? Number(result.at) : options.at
  return { ok: true, replyId, text, at }
}

function abortWatch(signal) {
  let cleanup = () => {}
  const promise = new Promise((resolve) => {
    if (signal.aborted === true) {
      resolve({ cancelled: true })
      return
    }
    if (typeof signal.addEventListener !== 'function') return
    const onAbort = () => resolve({ cancelled: true })
    signal.addEventListener('abort', onAbort, { once: true })
    cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch (error) {
        void error
      }
    }
  })
  return { promise, cleanup }
}

/**
 * 执行 chat.turn：调用注入的 reply 函数，返回 receipt（不直接调模型/HTTP）。
 * @param {object} task createTask 产出的 task（或至少含 key/payload.peerId/messageId）
 * @param {{reply?: Function, signal?: AbortSignal, now?: () => number, timeoutMs?: number}} [ctx]
 * @returns {Promise<{ok: true, receipt: object} | {ok: false, cancelled?: boolean, code: string, message: string, receipt?: object}>}
 */
export async function execute(task, ctx = {}) {
  const context = isPlainObject(ctx) ? ctx : {}
  if (!isPlainObject(task) || !isPlainObject(task.payload)) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidTask, 'task 必须是 createTask 产出的对象')
  }
  const peerId = task.payload.peerId
  const messageId = task.payload.messageId
  if (typeof peerId !== 'string' || typeof messageId !== 'string' || peerId.length === 0 || messageId.length === 0) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidTask, 'task.payload 缺少 peerId/messageId')
  }
  const key = typeof task.key === 'string' && task.key.length > 0 ? task.key : chatTaskKey({ peerId, messageId })
  const now = typeof context.now === 'function' ? context.now : () => Date.now()
  const reply = typeof context.reply === 'function' ? context.reply : null
  const signal = context.signal ?? null
  const startedAt = now()
  const baseReceipt = { taskKey: key, peerId, messageId, startedAt }
  if (reply === null) return errorResult(CHAT_ACTIVITY_CODES.noReplyFunction, 'execute 需要注入 ctx.reply 函数')
  if (signal !== null && signal.aborted === true) {
    return {
      ok: false,
      cancelled: true,
      code: CHAT_ACTIVITY_CODES.cancelled,
      message: '任务在开始前已被取消',
      receipt: { ok: false, cancelled: true, at: startedAt, ...baseReceipt },
    }
  }
  let result
  try {
    const invocation = Promise.resolve().then(() =>
      reply({
        peerId,
        messageId,
        text: typeof task.payload.text === 'string' ? task.payload.text : '',
        task,
        signal,
      }),
    )
    if (signal !== null && typeof signal.addEventListener === 'function') {
      const watch = abortWatch(signal)
      try {
        result = await Promise.race([invocation, watch.promise])
      } finally {
        watch.cleanup()
      }
    } else {
      result = await invocation
    }
  } catch (error) {
    const at = now()
    return {
      ok: false,
      code: CHAT_ACTIVITY_CODES.replyFailed,
      message: error instanceof Error ? error.message : String(error),
      receipt: { ok: false, at, error: { message: error instanceof Error ? error.message : String(error) }, ...baseReceipt },
    }
  }
  const at = now()
  if (isPlainObject(result) && result.cancelled === true) {
    return {
      ok: false,
      cancelled: true,
      code: CHAT_ACTIVITY_CODES.cancelled,
      message: '任务在回复过程中被取消',
      receipt: { ok: false, cancelled: true, at, ...baseReceipt },
    }
  }
  const normalized = normalizeReplyResult(result, { replyId: 'reply:' + key + ':' + at, at })
  if (normalized.ok !== true) return normalized
  return {
    ok: true,
    receipt: {
      ok: true,
      cancelled: false,
      replyId: normalized.replyId,
      at: normalized.at,
      durationMs: Math.max(0, at - startedAt),
      ...(normalized.text.length > 0 ? { text: normalized.text } : {}),
      ...baseReceipt,
    },
  }
}

/** 执行成功 → chat.replied 事件 envelope。 */
export function toRepliedEvent(task, receipt, options = {}) {
  if (!isPlainObject(receipt) || receipt.ok !== true) {
    return errorResult(CHAT_ACTIVITY_CODES.invalidReply, 'toRepliedEvent 需要成功的 receipt')
  }
  const peerId = typeof receipt.peerId === 'string' ? receipt.peerId : ''
  const messageId = typeof receipt.messageId === 'string' ? receipt.messageId : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const topicPeer = 'peer:' + peerId.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').slice(0, 60)
  return buildEvent(
    CHAT_EVENTS.replied,
    {
      peerId,
      messageId,
      replyId: receipt.replyId,
      taskKey: receipt.taskKey,
      durationMs: receipt.durationMs,
      ...(typeof receipt.text === 'string' && receipt.text.length > 0 ? { text: receipt.text } : {}),
    },
    'peer:' + peerId,
    {
      at: Number.isFinite(Number(options.at)) ? Number(options.at) : Number(receipt.at) || now(),
      topics: ['chat.replied', topicPeer],
      now: options.now,
      random: options.random,
    },
  )
}

/** 取消 → chat.interrupted 事件 envelope。 */
export function toInterruptedEvent(task, receipt, options = {}) {
  const spec = isPlainObject(task) && isPlainObject(task.payload) ? task.payload : {}
  const peerId = typeof spec.peerId === 'string' ? spec.peerId : ''
  const messageId = typeof spec.messageId === 'string' ? spec.messageId : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const topicPeer = 'peer:' + peerId.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').slice(0, 60)
  return buildEvent(
    CHAT_EVENTS.interrupted,
    {
      peerId,
      messageId,
      taskKey: typeof task?.key === 'string' ? task.key : '',
      reason: typeof options.reason === 'string' ? options.reason : 'cancelled',
      ...(isPlainObject(receipt) && receipt.at !== undefined ? { at: receipt.at } : {}),
    },
    'peer:' + peerId,
    {
      at: Number.isFinite(Number(options.at)) ? Number(options.at) : now(),
      topics: ['chat.interrupted', topicPeer],
      now: options.now,
      random: options.random,
    },
  )
}

/**
 * 便捷工厂：注入默认 reply/时钟，返回绑定的 Activity 方法。
 * @param {{reply?: Function, now?: () => number, random?: () => number}} [options]
 */
export function createChatActivity(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const random = typeof spec.random === 'function' ? spec.random : undefined
  const defaultReply = typeof spec.reply === 'function' ? spec.reply : null
  return {
    manifest: getChatManifest(),
    toEvent(message) {
      return toEvent(message, { now, random })
    },
    createTask(message, taskOptions = {}) {
      return createTask(message, taskOptions)
    },
    execute(task, ctx = {}) {
      const context = isPlainObject(ctx) ? ctx : {}
      return execute(task, {
        ...context,
        now: context.now ?? now,
        reply: context.reply ?? defaultReply,
      })
    },
    toRepliedEvent(task, receipt) {
      return toRepliedEvent(task, receipt, { now, random })
    },
    toInterruptedEvent(task, receipt, interruptOptions = {}) {
      return toInterruptedEvent(task, receipt, { now, random, ...interruptOptions })
    },
  }
}
