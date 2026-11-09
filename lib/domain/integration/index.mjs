// lib/domain/integration/index.mjs —— integration 域 facade（W2）
// 外部只依赖这个文件；旧路径 lib/<name>.mjs 保留为 shim。

export * from './routes.mjs'
export * from './safe-web.mjs'
export * from './trust.mjs'
export * from './image-ocr.mjs'
export * from './assets.mjs'
