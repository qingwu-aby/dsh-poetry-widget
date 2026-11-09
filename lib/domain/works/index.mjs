// lib/domain/works/index.mjs —— works 域 facade（W2）
// 只做 re-export：内部模块稳定后逐步移到本目录，index.js 只依赖 facade。

export * from '../../self-works.mjs'
export * from '../../work-loop.mjs'
export * from '../../media-budget.mjs'
export * from '../../pet-media.mjs'
