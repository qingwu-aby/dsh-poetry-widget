// lib/memory-migrations.mjs —— 记忆文件的 schemaVersion 与迁移层（v1.73，P1）。
//
// 之前每个记忆文件各自“宽容解析”，字段演进没有统一版本与迁移记录。这里：
//   · memory-registry 的每条登记带 schemaVersion（目标版本）；
//   · 迁移按 id 登记成链（from → to），启动时把旧文件就地升级并原子写回；
//   · 缺失文件跳过；坏 JSON / 迁移失败只记日志，绝不阻塞插件启动。
import { readFileSync } from 'node:fs'
import { resolveMemoryRegistry } from './memory-registry.mjs'
import { writeJsonAtomic } from './settings-store.mjs'

/** 把一个旧 self-state 文件从 v1（数值版）迁移到 v2（事实时间线 + felt）。 */
function migrateSelfStateV1ToV2(data) {
  const next = { ...data, v: 2 }
  for (const key of ['energy', 'curiosity', 'social', 'hunger', 'moodValence', 'moodArousal', 'lastInteractionAt']) {
    delete next[key]
  }
  return next
}

/**
 * 迁移链：id → [{from, to, migrate}]。
 * 目前只有 self-state v1→v2（运行时的 normalize 也兼容 v1，这里顺便把文件清干净）。
 * 以后改 schema：在 memory-registry 提高 schemaVersion，并在这里补一条迁移。
 */
export const MEMORY_MIGRATIONS = Object.freeze({
  'self-state.json': Object.freeze([{ from: 1, to: 2, migrate: migrateSelfStateV1ToV2 }]),
})

function shortMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 对登记表里的 JSON 记忆文件执行迁移。
 * @param {{env?: object, home?: string|null, logger?: {warn?: Function, info?: Function}|null, migrations?: object, now?: () => number}} [options]
 * @returns {{ok: boolean, applied: Array<{id: string, from: number, to: number}>, skipped: Array<{id: string, reason: string}>}}
 */
export function runMemoryMigrations(options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? null
  const logger = options.logger ?? null
  const migrations = isPlainObject(options.migrations) ? options.migrations : MEMORY_MIGRATIONS
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const report = { ok: true, applied: [], skipped: [] }
  const warn = (message) => {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }
  const registry = resolveMemoryRegistry(env, home)
  for (const entry of registry.files) {
    if (entry.kind !== 'json') continue
    const target = typeof entry.schemaVersion === 'number' ? entry.schemaVersion : 1
    if (target <= 1) continue
    const chain = Array.isArray(migrations[entry.id]) ? migrations[entry.id] : []
    if (chain.length === 0) continue
    let data = null
    try {
      data = JSON.parse(readFileSync(entry.path, 'utf8'))
    } catch (error) {
      const code = error && error.code === 'ENOENT' ? 'missing' : 'invalid'
      report.skipped.push({ id: entry.id, reason: code })
      continue
    }
    if (!isPlainObject(data)) {
      report.skipped.push({ id: entry.id, reason: 'not-object' })
      continue
    }
    let version = Number.isFinite(data.v) ? data.v : Number.isFinite(data.schemaVersion) ? data.schemaVersion : 1
    let changed = false
    while (version < target) {
      const step = chain.find((item) => item.from === version)
      if (step === undefined) break
      try {
        data = step.migrate(data)
        if (!isPlainObject(data)) throw new Error('migration returned non-object')
        data.v = step.to
        data.schemaVersion = step.to
        version = step.to
        changed = true
      } catch (error) {
        warn(`记忆迁移失败：${entry.id} v${version}（${shortMessage(error)}）`)
        report.ok = false
        report.skipped.push({ id: entry.id, reason: 'migration-error' })
        break
      }
    }
    if (!changed) continue
    try {
      writeJsonAtomic(entry.path, { ...data, migratedAt: now() })
      report.applied.push({ id: entry.id, from: 1, to: version })
    } catch (error) {
      warn(`记忆迁移写回失败：${entry.id}（${shortMessage(error)}）`)
      report.ok = false
      report.skipped.push({ id: entry.id, reason: 'write-error' })
    }
  }
  return report
}
