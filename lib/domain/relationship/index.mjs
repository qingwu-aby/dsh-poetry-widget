// lib/domain/relationship/index.mjs —— relationship 域 facade（W2 已内迁）
// 外部只依赖这个文件；旧路径 lib/<name>.mjs 保留为 shim。

export * from './relationship-memory.mjs'
export * from './commitments.mjs'
export * from './attention.mjs'
