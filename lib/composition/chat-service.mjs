// @ts-check
// lib/composition/chat-service.mjs —— 聊天 HTTP 服务（W1 从 index.js 抽出）
//
// 负责：用户文字/图片 → OCR + 关系/情绪/日常/承诺/图谱提示 → chatBridge → 本地语言层润色。
// 不处理路由注册（见 interactive-routes.mjs），只产出 { drainPending, graphDigest, chat }。
import { createHash } from 'node:crypto'
import path from 'node:path'
import { toEvent as chatToEvent } from '../core/chat-activity.mjs'
import { assessMoralRelevance, buildMoralCheckLines } from '../domain/being/moral-reasoning.mjs'
import { chatImagePayload, pickLatestWorkImage, shouldSendChatImage } from '../domain/chat/chat-media.mjs'
import { describeImages, extractImagePaths, sanitizeUserText } from '../domain/integration/image-ocr.mjs'
import { getActiveHubRuntime, sanitizeEventText } from './hub-runtime.mjs'

/** 自动生成稳定的聊天消息 id（同一 peer+文本+时间 → 同 id，供幂等/去重）。 */
function stableChatMessageId(peerId, text, at) {
  return (
    'auto:' +
    createHash('sha1')
      .update(peerId + '|' + text + '|' + String(at ?? ''))
      .digest('hex')
      .slice(0, 16)
  )
}

// Gate J5：Hub 接管时透传的上下文（与旧 chatBridge 入参对齐；每数组 ≤8 条、字符串 ≤400 字符）。
const HUB_CONTEXT_MAX_ITEMS = 8
const HUB_CONTEXT_MAX_CHARS = 400
const HUB_CONTEXT_LIST_FIELDS = Object.freeze([
  'graphLines',
  'spreadLines',
  'moralLines',
  'rulesLines',
  'exemplars',
  'relationshipLines',
  'emotionLines',
  'dailyLifeLines',
  'commitmentLines',
  'methodLines',
])

/** 归一化/截断 Hub 聊天上下文（不改变旧路径；只用于 full 的 task.payload.context）。 */
export function normalizeChatContext(context) {
  const spec = context !== null && typeof context === 'object' ? context : {}
  const out = {}
  for (const field of HUB_CONTEXT_LIST_FIELDS) {
    const list = Array.isArray(spec[field]) ? spec[field] : []
    out[field] = list
      .filter((item) => typeof item === 'string' && item.length > 0)
      .slice(0, HUB_CONTEXT_MAX_ITEMS)
      .map((item) => item.slice(0, HUB_CONTEXT_MAX_CHARS))
  }
  out.imageContext = typeof spec.imageContext === 'string' ? spec.imageContext.slice(0, HUB_CONTEXT_MAX_CHARS) : ''
  out.imageRequested = spec.imageRequested === true
  out.imageHint =
    spec.imageHint !== null && spec.imageHint !== undefined && typeof spec.imageHint.name === 'string'
      ? { name: spec.imageHint.name.slice(0, 80) }
      : null
  return out
}

/** Gate J2：Hub 接管时的结果映射（失败不回退旧路径，也不重复回复）。 */
async function runHubChatTurn(hubRuntime, input) {
  try {
    const turn = await hubRuntime.runChatTurn(input)
    if (turn === null || turn === undefined || turn.ok !== true) {
      return {
        ok: false,
        error: turn !== null && turn !== undefined && turn.code ? turn.code : 'HUB_CHAT_FAILED',
        message: turn !== null && turn !== undefined && turn.message ? turn.message : 'Hub 接管聊天失败',
        taskId: turn !== null && turn !== undefined && turn.taskId ? turn.taskId : null,
        receipt: turn !== null && turn !== undefined && turn.receipt ? turn.receipt : null,
      }
    }
    return {
      ok: true,
      reply: typeof turn.reply === 'string' ? turn.reply : '',
      receipt: turn.receipt,
      taskId: turn.taskId,
      duplicate: turn.duplicate === true,
      source: 'hub',
    }
  } catch (error) {
    return { ok: false, error: 'HUB_CHAT_FAILED', message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Gate E2：聊天 shadow 观察（只发事件，不改回复路径/不写记忆）。
 * off 或 Hub 缺失时完全 no-op；任何异常只记录，绝不影响聊天。
 */
function emitChatShadowEvent(deps, input, peerId, rawText) {
  try {
    const hub = deps.hubRuntime ?? getActiveHubRuntime()
    if (!hub || typeof hub.mode !== 'function' || typeof hub.ingest !== 'function') return
    const mode = hub.mode()
    if (mode !== 'shadow' && mode !== 'full') return
    const text = sanitizeEventText(rawText, { maxLength: 500 })
    if (text.length === 0) return
    const providedId = typeof input?.messageId === 'string' ? input.messageId.trim() : ''
    const at = Number.isFinite(Number(input?.at)) ? Number(input.at) : undefined
    const messageId = providedId.length > 0 ? providedId : stableChatMessageId(peerId, text, at)
    const event = chatToEvent({
      peerId,
      messageId,
      text,
      channel: typeof input?.channel === 'string' && input.channel.length > 0 ? input.channel : 'chat',
      ...(at === undefined ? {} : { at }),
    })
    if (event.ok !== true) return
    const ingested = hub.ingest('chat', event.event)
    if (ingested && ingested.ok !== true) {
      try {
        deps.logger?.warn?.(
          `[dsh-little-whale] chat shadow 事件入 Hub 失败：${ingested.message ?? ingested.code ?? ''}`,
        )
      } catch (error) {
        void error
      }
    }
  } catch (error) {
    try {
      deps.logger?.warn?.(
        `[dsh-little-whale] chat shadow 钩子失败：${error instanceof Error ? error.message : String(error)}`,
      )
    } catch (warnError) {
      void warnError
    }
  }
}

/** 判断是否要向用户附一张她的作品（有附件时只在明确要画时附）。 */
function wantsHerImage(text, hasAttachment) {
  if (hasAttachment) return /(给我看|你的画|你画的|自画像|发张|再来一张|再画|凑一张)/.test(text)
  return shouldSendChatImage(text)
}

/**
 * Gate J2：Hub full 接管聊天时的 chat.turn 执行器（创建/复用任务 → 执行 chat adapter → 回 receipt）。
 * 供 hub-runtime.runChatTurn 注入使用；不直接调用旧 chatBridge（adapter 内部才走 chatBridge）。
 * @param {object|Function} hubRuntimeOrGetter
 */
export function createChatTurnRunner(hubRuntimeOrGetter) {
  const getRuntime = () => (typeof hubRuntimeOrGetter === 'function' ? hubRuntimeOrGetter() : hubRuntimeOrGetter)
  return async function runChatTurn(input) {
    const runtime = getRuntime()
    if (runtime === null || runtime === undefined)
      return { ok: false, code: 'HUB_CHAT_UNAVAILABLE', message: 'Hub 未接入' }
    if (typeof runtime.mode === 'function' && runtime.mode() !== 'full') {
      return { ok: false, code: 'HUB_FULL_REQUIRED', message: '只有 full 模式才接管聊天' }
    }
    const spec = input !== null && typeof input === 'object' ? input : {}
    const peerId =
      typeof spec.peerId === 'string' && spec.peerId.trim().length > 0 ? spec.peerId.trim().slice(0, 80) : 'gui'
    const text = typeof spec.text === 'string' ? spec.text : ''
    if (text.trim().length === 0) return { ok: false, code: 'HUB_CHAT_EMPTY', message: '消息为空' }
    const messageId =
      typeof spec.messageId === 'string' && spec.messageId.length > 0
        ? spec.messageId.slice(0, 120)
        : stableChatMessageId(peerId, text, spec.at)
    const instances = typeof runtime.getInstances === 'function' ? runtime.getInstances() : null
    const board = instances === null || instances === undefined ? null : instances.taskBoard
    if (board === null || typeof board.create !== 'function') {
      return { ok: false, code: 'HUB_TASK_BOARD_UNAVAILABLE', message: '任务板未接入' }
    }
    const key = 'chat-turn:' + peerId + ':' + messageId
    const created = board.create({
      activity: 'chat',
      kind: 'chat.turn',
      key,
      idempotencyKey: key,
      payload: {
        peerId,
        messageId,
        text,
        ...(spec.context === undefined || spec.context === null ? {} : { context: normalizeChatContext(spec.context) }),
      },
      priority: 0,
    })
    if (created === null || created === undefined || created.ok !== true) {
      return { ok: false, code: 'HUB_CHAT_CREATE_FAILED', message: '创建聊天任务失败' }
    }
    const task = created.task
    if (task === null || task === undefined)
      return { ok: false, code: 'HUB_CHAT_CREATE_FAILED', message: '聊天任务为空' }
    // 幂等：已完成任务直接返回缓存 receipt（同 messageId 不重复回复）。
    if (task.result !== null && task.result !== undefined && typeof task.result === 'object') {
      const receipt = task.result
      return {
        ok: receipt.ok === true,
        reply: typeof receipt.text === 'string' ? receipt.text : '',
        receipt,
        taskId: task.id,
        duplicate: true,
      }
    }
    if (created.duplicate === true) {
      return { ok: false, code: 'HUB_CHAT_IN_PROGRESS', message: '同一条消息正在处理', taskId: task.id }
    }
    // canned reply（focus/deferred）：不跑 adapter，直接以 Hub receipt 形式返回。
    if (typeof spec.cannedReply === 'string' && spec.cannedReply.length > 0) {
      const receipt = { ok: true, at: Date.now(), text: spec.cannedReply.slice(0, 500), deferred: true }
      try {
        board.complete(task.id, receipt)
      } catch (error) {
        void error
      }
      return { ok: true, reply: receipt.text, receipt, taskId: task.id, duplicate: false }
    }
    const adapter = typeof runtime.getAdapter === 'function' ? runtime.getAdapter('chat') : null
    if (adapter === null) {
      try {
        board.fail(task.id, { message: 'chat adapter 未注入' })
      } catch (error) {
        void error
      }
      return { ok: false, code: 'HUB_NO_ACTIVITY_ADAPTER', message: 'chat adapter 未注入', taskId: task.id }
    }
    let result = null
    try {
      result = await adapter.execute(task)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        board.fail(task.id, { message })
      } catch (failError) {
        void failError
      }
      return { ok: false, code: 'HUB_CHAT_FAILED', message, taskId: task.id }
    }
    const receipt =
      result !== null && result !== undefined && result.receipt !== null && typeof result.receipt === 'object'
        ? result.receipt
        : { ok: false, at: Date.now(), message: 'adapter 未返回 receipt' }
    try {
      if (receipt.ok === true) board.complete(task.id, receipt)
      else board.fail(task.id, { message: typeof receipt.message === 'string' ? receipt.message : '聊天失败' })
    } catch (error) {
      void error
    }
    return {
      ok: receipt.ok === true,
      reply: typeof receipt.text === 'string' ? receipt.text : '',
      receipt,
      taskId: task.id,
      duplicate: false,
    }
  }
}

export function createChatHttpService(deps) {
  const safeDigest = (fn, fallback) => {
    try {
      return typeof fn === 'function' ? fn() : fallback
    } catch (_error) {
      return fallback
    }
  }

  const service = {
    drainPending: (peerId) => deps.chatBridge.drainPending(peerId),
    graphDigest: (text) => deps.knowledgeGraph.digest(text, 3),
  }

  service.chat = async (input) => {
    const rawText = String(input?.text ? input.text : '')
    // Gate J2：Hub full + chatTakeover 时由 Hub 接管（旧 chatBridge 路径停用；失败不回退）。
    const hubRuntime = deps.hubRuntime ?? null
    const hubMode = hubRuntime !== null && typeof hubRuntime.mode === 'function' ? hubRuntime.mode() : 'off'
    const chatTakeover = deps.chatTakeover !== false && hubMode === 'full'
    const peerId = (
      typeof input?.peerId === 'string' && input.peerId.trim().length > 0 ? input.peerId.trim() : 'gui'
    ).slice(0, 80)
    // Gate E2：shadow 观察（默认 off；不改变下面的回复路径）。
    emitChatShadowEvent(deps, input, peerId, rawText)
    // v0.7.0 单一注意力：她在游戏里时不并发跑聊天模型，先回一句短话并排队。
    const focus = deps.focus && typeof deps.focus.get === 'function' ? deps.focus.get() : null
    if (focus && focus.active && focus.mode !== 'idle' && input?.force !== true) {
      try {
        deps.focus.defer({ peerId, text: rawText })
        if (deps.world && typeof deps.world.interrupt === 'function') deps.world.interrupt('聊天打断')
      } catch (_error) {}
      const canned =
        focus.mode === 'game' ? '我在游戏里，手上正忙着，等会儿回你。' : '我这边正在专注做一件事，等会儿回你。'
      if (chatTakeover && typeof hubRuntime.runChatTurn === 'function') {
        const turn = await hubRuntime.runChatTurn({
          peerId,
          messageId: input?.messageId,
          text: rawText,
          cannedReply: canned,
        })
        if (turn !== null && turn !== undefined && turn.ok === true) {
          return {
            ok: true,
            peerId,
            reply: turn.reply || canned,
            deferred: true,
            focus: focus.mode,
            receipt: turn.receipt,
            taskId: turn.taskId,
          }
        }
        return {
          ok: false,
          peerId,
          error: turn && turn.code ? turn.code : 'HUB_CHAT_FAILED',
          message: turn && turn.message ? turn.message : 'Hub 接管聊天失败',
        }
      }
      return { ok: true, peerId, reply: canned, deferred: true, focus: focus.mode }
    }
    const imagePaths = extractImagePaths(rawText)
    let imageContext = ''
    let userText = rawText
    if (imagePaths.length > 0) {
      try {
        imageContext = describeImages(imagePaths).text
      } catch (_error) {
        imageContext = '他发来一张图，但这边读不出图上的字。'
      }
      userText = sanitizeUserText(rawText)
    }

    // 游戏结束后的第一条消息：带上她在游戏时排队的留言（不丢消息）。
    if (deps.focus && typeof deps.focus.drainDeferred === 'function') {
      try {
        const current = deps.focus.get()
        if (current && current.active === false) {
          const queued = deps.focus.drainDeferred()
          if (queued.length > 0) {
            const lines = queued
              .slice(-5)
              .map((item) => `- ${item.text}`)
              .join('\n')
            userText = `（你玩游戏时收到的留言：\n${lines}\n）\n` + userText
          }
        }
      } catch (_error) {}
    }

    const asksImage = wantsHerImage(userText, imagePaths.length > 0)
    let imagePayload = null
    if (asksImage) {
      try {
        imagePayload = chatImagePayload(pickLatestWorkImage(path.join(deps.memoryDir, 'works')))
      } catch (_error) {
        imagePayload = null
      }
    }

    const graphLines = safeDigest(() => deps.knowledgeGraph.digest(userText, 3), [])
    const spreadLines = safeDigest(
      () => (typeof deps.knowledgeGraph.spread === 'function' ? deps.knowledgeGraph.spread(userText, 4) : []),
      [],
    )
    const moralLines = buildMoralCheckLines(assessMoralRelevance(userText), { values: false })
    const rulesLines = safeDigest(
      () =>
        deps.internalRules && typeof deps.internalRules.digest === 'function'
          ? deps.internalRules.digest(userText, { limit: 3 })
          : [],
      [],
    )
    const exemplars = safeDigest(() => {
      if (!deps.styleExemplars || typeof deps.styleExemplars.pick !== 'function') return []
      const picked = deps.styleExemplars.pick({ exclude: [userText], limit: 3 })
      return Array.isArray(picked) ? picked : []
    }, [])
    const relationshipLines = safeDigest(() => deps.relationship.digest(userText, peerId), [])
    const emotionLines = safeDigest(() => deps.emotional.digest(3), [])
    const dailyLifeLines = safeDigest(() => deps.dailyLife.digest(3), [])
    const commitmentLines = safeDigest(() => deps.commitments.digest(3), [])
    const methodLines = safeDigest(
      () => (deps.methodMemory && typeof deps.methodMemory.digest === 'function' ? deps.methodMemory.digest(4) : []),
      [],
    )

    const result = chatTakeover
      ? await runHubChatTurn(hubRuntime, {
          peerId,
          messageId: input?.messageId,
          text: userText,
          at: input?.at,
          context: normalizeChatContext({
            graphLines,
            spreadLines,
            moralLines,
            rulesLines,
            exemplars,
            relationshipLines,
            emotionLines,
            dailyLifeLines,
            commitmentLines,
            methodLines,
            imageContext,
            imageRequested: asksImage,
            imageHint: imagePayload ? { name: imagePayload.name } : null,
          }),
        })
      : typeof deps.chatBridge.chat === 'function'
        ? await deps.chatBridge.chat({
            ...input,
            text: userText,
            imageContext,
            imageRequested: asksImage,
            imageHint: imagePayload ? { name: imagePayload.name } : null,
            graphLines,
            spreadLines,
            moralLines,
            rulesLines,
            exemplars,
            relationshipLines,
            emotionLines,
            dailyLifeLines,
            commitmentLines,
            methodLines,
          })
        : { ok: false, error: 'unavailable' }

    if (result && result.ok === true && imagePayload) result.images = [imagePayload]
    if (result && result.ok === true) {
      // 异步更新关系记忆与情绪线程，不阻塞回复。
      try {
        deps.relationship
          .ingest(
            [
              { role: 'user', text: rawText },
              { role: 'assistant', text: String(result.reply || '') },
            ],
            peerId,
          )
          .then((ingested) => {
            try {
              for (const entry of ingested?.entries || []) {
                if (entry.kind === 'agreement') deps.commitments.addAgreement(entry.text)
              }
            } catch (_error) {
              /* ignore */
            }
          })
          .catch(() => {})
      } catch (_error) {
        /* ignore */
      }
      try {
        deps.emotional.recordFromChat({
          felt: result.felt || '',
          murmur: result.murmur || '',
          reply: String(result.reply || ''),
        })
      } catch (_error) {
        /* ignore */
      }
    }

    const voiceMode = String(deps.getLocalVoiceMode ? deps.getLocalVoiceMode() : '').toLowerCase()
    if (
      result &&
      result.ok === true &&
      (voiceMode === 'on' || voiceMode === 'chat') &&
      typeof result.reply === 'string' &&
      Array.from(result.reply).length >= 4
    ) {
      try {
        const polished = await deps.localVoice.polish(result.reply, { maxChars: 240 })
        if (polished !== null) result.reply = polished
      } catch (_error) {
        /* 保留原句 */
      }
    }
    return result
  }

  return service
}
