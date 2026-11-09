// lib/domain/host/index.mjs —— host 域 facade（W2）
// 外部只依赖这个文件；旧路径 lib/<name>.mjs 保留为 shim。

export * from './dsh-host.mjs'
export * from './service-runtime.mjs'
export * from './heartbeat.mjs'
export * from './model-budget.mjs'
export * from '../../kernel/model-policy.mjs'
export * from '../../kernel/model-errors.mjs'
export * from '../../kernel/llm-call.mjs'
