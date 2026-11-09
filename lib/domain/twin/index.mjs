// lib/domain/twin/index.mjs —— twin 域 facade（W2）
// 只做 re-export：内部模块稳定后逐步移到本目录，index.js 只依赖 facade。

export * from '../../twin-system.mjs'
export * from '../../twin-bridge.mjs'
export * from '../../twin-research.mjs'
