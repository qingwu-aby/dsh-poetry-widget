// lib/domain/life/index.mjs —— life 域 facade（W2）
// 只做 re-export：内部模块稳定后逐步移到本目录，index.js 只依赖 facade。

export * from '../../daily-life.mjs'
export * from '../../weather.mjs'
export * from '../../self-trainer.mjs'
export * from '../../agent-loop-runner.mjs'
