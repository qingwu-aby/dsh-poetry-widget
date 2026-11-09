// lib/domain/voice/index.mjs —— voice 域 facade（W2）
// 外部只依赖这个文件；旧路径 lib/<name>.mjs 保留为 shim。

export * from './voice-memory.mjs'
export * from './local-voice.mjs'
export * from './language-style.mjs'
export * from './prompt-layers.mjs'
