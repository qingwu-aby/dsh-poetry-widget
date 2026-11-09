// lib/domain/integration/index.mjs —— integration 域 facade（W2）
// 只做 re-export：内部模块稳定后逐步移到本目录，index.js 只依赖 facade。

export * from '../../routes.mjs'
export * from '../../safe-web.mjs'
export * from '../../trust.mjs'
export * from '../../image-ocr.mjs'
export * from '../../assets.mjs'
