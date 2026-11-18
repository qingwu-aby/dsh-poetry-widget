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
      return {
        ok: true,
        peerId,
        reply: focus.mode === 'game' ? '我在游戏里，手上正忙着，等会儿回你。' : '我这边正在专注做一件事，等会儿回你。',
        deferred: true,
        focus: focus.mode,
      }
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

    const result =
      typeof deps.chatBridge.chat === 'function'
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
