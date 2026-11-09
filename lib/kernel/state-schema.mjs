// @ts-check
// lib/kernel/state-schema.mjs —— 状态文件注册表与迁移（W1）
//
// 用法：
//   const registry = createStateRegistry(createStateSpecs(stateDir))
//   const result = migrateAll(registry, { dryRun: env.DSH_POETRY_MIGRATE === 'dry-run', logger })
//
// 每个 spec：{ id, file, version, normalizer, migrate?, fallback? }
// 读 → migrate（旧版本字段）→ normalizer（补齐/清洗）→ 与原文比较 → 变了才写（默认先备份）。
import { existsSync, readFileSync } from 'node:fs'
import { writeJson } from './json-store.mjs'

export function createStateRegistry(specs) {
  const entries = []
  for (const spec of Array.isArray(specs) ? specs : []) {
    if (!spec || typeof spec.file !== 'string' || spec.file.length === 0) continue
    if (typeof spec.normalizer !== 'function') throw new Error(`state spec ${spec.id} missing normalizer`)
    entries.push({
      id: String(spec.id ?? spec.file),
      file: spec.file,
      version: Number.isFinite(spec.version) ? spec.version : 1,
      normalizer: spec.normalizer,
      migrate: typeof spec.migrate === 'function' ? spec.migrate : null,
      fallback: typeof spec.fallback === 'function' ? spec.fallback : null,
      backup: spec.backup !== false,
    })
  }
  return {
    entries,
    list: () => entries.map((entry) => ({ id: entry.id, file: entry.file, version: entry.version })),
    get: (id) => entries.find((entry) => entry.id === id) ?? null,
  }
}

/** 只读比较：返回某个文件是否需要迁移/规范化。 */
export function inspectEntry(entry) {
  const result = {
    id: entry.id,
    file: entry.file,
    exists: false,
    changed: false,
    fromVersion: null,
    toVersion: entry.version,
    error: null,
  }
  if (!existsSync(entry.file)) return result
  result.exists = true
  let rawText = ''
  try {
    rawText = readFileSync(entry.file, 'utf8')
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }
  let raw = null
  try {
    raw = JSON.parse(rawText)
  } catch (error) {
    result.error = `corrupt json: ${error instanceof Error ? error.message : String(error)}`
    return result
  }
  result.fromVersion = Number.isFinite(raw?.v) ? raw.v : null
  try {
    const migrated = entry.migrate !== null ? entry.migrate(raw) : raw
    const normalized = entry.normalizer(migrated)
    result.changed = JSON.stringify(raw) !== JSON.stringify(normalized)
    result.normalized = normalized
  } catch (error) {
    result.error = `normalize failed: ${error instanceof Error ? error.message : String(error)}`
  }
  return result
}

/**
 * 批量迁移。dryRun 只报告不动文件；非 dryRun 时 changed 才写（写前备份）。
 * @returns {{ ok: boolean, total: number, changed: number, errors: number, items: Array }}
 */
export function migrateAll(registry, options = {}) {
  const dryRun = options.dryRun === true
  const logger = options.logger ?? null
  const items = []
  let changed = 0
  let errors = 0
  for (const entry of registry.entries) {
    const item = inspectEntry(entry)
    items.push(item)
    if (item.error !== null) {
      errors += 1
      logger?.warn?.(`[dsh-little-whale] 状态文件 ${entry.id} 检查失败：${item.error}`)
      continue
    }
    if (item.changed !== true) continue
    changed += 1
    if (dryRun) {
      logger?.info?.(`[dsh-little-whale] 状态迁移（dry-run）：${entry.id} 需要规范化（v${item.fromVersion ?? '?'}）`)
      continue
    }
    try {
      writeJson(entry.file, item.normalized, { normalizer: (value) => value, backup: entry.backup })
      logger?.info?.(`[dsh-little-whale] 状态迁移：${entry.id}（v${item.fromVersion ?? '?'} → v${entry.version}）`)
    } catch (error) {
      errors += 1
      logger?.warn?.(
        `[dsh-little-whale] 状态迁移失败 ${entry.id}：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { ok: errors === 0, total: registry.entries.length, changed, errors, items }
}

/** 把 registry 结果压成 health 可用的摘要。 */
export function summarizeMigrations(result) {
  return {
    ok: result.ok,
    total: result.total,
    changed: result.changed,
    errors: result.errors,
    files: result.items.map((item) => ({ id: item.id, exists: item.exists, changed: item.changed, error: item.error })),
  }
}
