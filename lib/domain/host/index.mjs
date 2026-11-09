// lib/domain/host/index.mjs —— host 域 facade（W2）
// 外部只依赖这个文件；旧路径 lib/<name>.mjs 保留为 shim。

export * from './dsh-host.mjs'
export * from './service-runtime.mjs'
export * from './heartbeat.mjs'
export * from './model-budget.mjs'
export * from './model-policy.mjs'
export * from './model-errors.mjs'
export * from './llm-call.mjs'
