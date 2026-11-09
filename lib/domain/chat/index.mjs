// lib/domain/chat/index.mjs —— chat 域 facade（W2）
// 外部只依赖这个文件；旧路径 lib/<name>.mjs 保留为 shim。

export * from './chat-bridge.mjs'
export * from './chat-media.mjs'
export * from './proactive-chat.mjs'
export * from './gui-inbox.mjs'
export * from './gui-push.mjs'
export * from './message-domain.mjs'
export * from './outbox.mjs'
