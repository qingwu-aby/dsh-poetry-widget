// lib/domain/voice/index.mjs —— voice 域 facade（W2）
// 只做 re-export：内部模块稳定后逐步移到本目录，index.js 只依赖 facade。

export * from '../../voice-memory.mjs'
export * from '../../local-voice.mjs'
export * from '../../language-style.mjs'
export * from '../../prompt-layers.mjs'
