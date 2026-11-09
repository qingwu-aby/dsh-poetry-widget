// lib/domain/being/index.mjs —— being 域 facade（W2）
// 只做 re-export：内部模块稳定后逐步移到本目录，index.js 只依赖 facade。

export * from '../../self-state.mjs'
export * from '../../self-being.mjs'
export * from '../../self-events.mjs'
export * from '../../self-actions.mjs'
export * from '../../self-lifecycle.mjs'
export * from '../../self-drive.mjs'
export * from '../../self-projects.mjs'
export * from '../../presence.mjs'
export * from '../../autonomy.mjs'
