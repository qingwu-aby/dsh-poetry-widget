// lib/domain/chat/index.mjs —— chat 域 facade（W2）
// 只做 re-export：内部模块稳定后逐步移到本目录，index.js 只依赖 facade。

export * from '../../chat-bridge.mjs'
export * from '../../chat-media.mjs'
export * from '../../proactive-chat.mjs'
export * from '../../gui-inbox.mjs'
export * from '../../gui-push.mjs'
export * from '../../message-domain.mjs'
export * from '../../outbox.mjs'
