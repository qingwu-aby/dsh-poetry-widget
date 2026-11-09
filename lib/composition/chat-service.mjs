// @ts-check
// lib/composition/chat-service.mjs —— 聊天 HTTP 服务（W1 从 index.js 抽出）
//
// 负责：用户文字/图片 → OCR + 关系/情绪/日常/承诺/图谱提示 → chatBridge → 本地语言层润色。
// 不处理路由注册（见 interactive-routes.mjs），只产出 { drainPending, graphDigest, chat }。
import path from 'node:path'
import { chatImagePayload, pickLatestWorkImage, shouldSendChatImage } from '../domain/chat/chat-media.mjs'
import { describeImages, extractImagePaths, sanitizeUserText } from '../domain/integration/image-ocr.mjs'

/** 判断是否要向用户附一张她的作品（有附件时只在明确要画时附）。 */
function wantsHerImage(text, hasAttachment) {
  if (hasAttachment) return /(给我看|你的画|你画的|自画像|发张|再来一张|再画|凑一张)/.test(text)
  return shouldSendChatImage(text)
}

export function createChatHttpService(deps) {
  const safeDigest = (fn, fallback) => {
    try {
      return typeof fn === 'function' ? fn() : fallback
    } catch {
      return fallback
    }
  }

  const service = {
    drainPending: (peerId) => deps.chatBridge.drainPending(peerId),
    graphDigest: (text) => deps.knowledgeGraph.digest(text, 3),
  }

  service.chat = async (input) => {
    const rawText = String(input?.text ? input.text : '')
    const imagePaths = extractImagePaths(rawText)
    let imageContext = ''
    let userText = rawText
    if (imagePaths.length > 0) {
      try {
        imageContext = describeImages(imagePaths).text
      } catch {
        imageContext = '他发来一张图，但这边读不出图上的字。'
      }
      userText = sanitizeUserText(rawText)
    }

    const asksImage = wantsHerImage(userText, imagePaths.length > 0)
    let imagePayload = null
    if (asksImage) {
      try {
        imagePayload = chatImagePayload(pickLatestWorkImage(path.join(deps.memoryDir, 'works')))
      } catch {
        imagePayload = null
      }
    }

    const graphLines = safeDigest(() => deps.knowledgeGraph.digest(userText, 3), [])
    const spreadLines = safeDigest(() => (typeof deps.knowledgeGraph.spread === 'function' ? deps.knowledgeGraph.spread(userText, 4) : []), [])
    const relationshipLines = safeDigest(() => deps.relationship.digest(userText), [])
    const emotionLines = safeDigest(() => deps.emotional.digest(3), [])
    const dailyLifeLines = safeDigest(() => deps.dailyLife.digest(3), [])
    const commitmentLines = safeDigest(() => deps.commitments.digest(3), [])

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
            relationshipLines,
            emotionLines,
            dailyLifeLines,
            commitmentLines,
          })
        : { ok: false, error: 'unavailable' }

    if (result && result.ok === true && imagePayload) result.images = [imagePayload]
    if (result && result.ok === true) {
      // 异步更新关系记忆与情绪线程，不阻塞回复。
      try {
        deps.relationship
          .ingest([
            { role: 'user', text: rawText },
            { role: 'assistant', text: String(result.reply || '') },
          ])
          .then((ingested) => {
            try {
              for (const entry of ingested?.entries || []) {
                if (entry.kind === 'agreement') deps.commitments.addAgreement(entry.text)
              }
            } catch {
              /* ignore */
            }
          })
          .catch(() => {})
      } catch {
        /* ignore */
      }
      try {
        deps.emotional.recordFromChat({
          felt: result.felt || '',
          murmur: result.murmur || '',
          reply: String(result.reply || ''),
        })
      } catch {
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
      } catch {
        /* 保留原句 */
      }
    }
    return result
  }

  return service
}
