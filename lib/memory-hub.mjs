// lib/memory-hub.mjs —— 记忆中枢（契约 v1.30 §2.17，task-57）。
//
// 用户担心记忆丢失：把散落的记忆文件统一登记、健康检查、定期备份、必要时恢复。
//
// 登记文件：
//   · <agent-memory>/journal.md, journal.jsonl, topics.json, README.md
//   · <$DSH_HOME/.dsh-poetry>/learning-log.md, topics-candidates.json, experience.json, self-state.json
//
// 能力：
//   · healthCheck：缺失/JSON 损坏/大小骤减>50% → issue（只告警，不改文件）；
//   · backup(reason)：复制到 <agent-memory>/backups/<时间>-<reason>/ + manifest.json（sha256/size/mtime，
//     原子写），保留最近 20 份；
//   · recover：只恢复**缺失**文件（不覆盖已存在文件；坏文件只标记不自动覆盖）；
//   · start：启动时若上次备份 >6h 就备份，之后每 6h 一次（unref 定时器）；
//   · snapshot：files/health/backups/recovered（只读，供 memory.json 路由）。
// 所有异常吞掉只 warn，绝不抛给宿主。
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { resolveMemoryDir } from './memory-journal.mjs'
import { resolveExperiencePath } from './experience.mjs'
import { resolveSelfStatePath } from './self-state.mjs'
import { maskPath } from './paths.mjs'

/** 只读记忆快照路由（unfenced）。 */
export const MEMORY_ROUTE = '/api/dsh-poetry/memory.json'
/** 手动备份路由（fenced POST）。 */
export const MEMORY_BACKUP_ROUTE = '/api/dsh-poetry/memory/backup.json'
/** 自动备份间隔。 */
export const MEMORY_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000
/** 保留备份份数。 */
export const MEMORY_BACKUP_MAX = 20
/** 大小骤减告警阈值（相对最近备份）。 */
export const MEMORY_SIZE_DROP_RATIO = 0.5

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 备份目录名时间戳 `YYYYMMDD-HHmmss`。 */
function timestampName(ms) {
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sanitizeReason(reason) {
  const raw = typeof reason === 'string' ? reason.toLowerCase() : ''
  const cleaned = raw.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 40) || 'manual'
}

/** 解析记忆中枢涉及的所有路径（agent-memory + .dsh-poetry）。 */
export function resolveMemoryHubPaths(env = process.env, home = null) {
  const memoryDir = resolveMemoryDir(env, home)
  const stateDir = path.dirname(resolveSelfStatePath(env, home))
  return {
    memoryDir,
    stateDir,
    backupsDir: path.join(memoryDir, 'backups'),
    files: [
      { id: 'journal.md', kind: 'md', path: path.join(memoryDir, 'journal.md') },
      { id: 'journal.jsonl', kind: 'jsonl', path: path.join(memoryDir, 'journal.jsonl') },
      { id: 'topics.json', kind: 'json', path: path.join(memoryDir, 'topics.json') },
      { id: 'README.md', kind: 'md', path: path.join(memoryDir, 'README.md') },
      { id: 'learning-log.md', kind: 'md', path: path.join(stateDir, 'learning-log.md') },
      { id: 'topics-candidates.json', kind: 'json', path: path.join(stateDir, 'topics-candidates.json') },
      { id: 'experience.json', kind: 'json', path: resolveExperiencePath(env, home) },
      { id: 'self-state.json', kind: 'json', path: resolveSelfStatePath(env, home) },
    ],
  }
}

/**
 * 创建记忆中枢。
 * @param {{
 *   paths?: ReturnType<typeof resolveMemoryHubPaths>,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   maxBackups?: number,
 *   backupIntervalMs?: number,
 *   backupDelayMs?: number,
 * }} [options]
 */
export function createMemoryHub(options = {}) {
  const paths = options.paths ?? resolveMemoryHubPaths(options.env, options.home)
  const files = paths.files
  const backupsDir = paths.backupsDir
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxBackups =
    Number.isFinite(options.maxBackups) && options.maxBackups > 0 ? Math.floor(options.maxBackups) : MEMORY_BACKUP_MAX
  const backupIntervalMs =
    Number.isFinite(options.backupIntervalMs) && options.backupIntervalMs > 0
      ? options.backupIntervalMs
      : MEMORY_BACKUP_INTERVAL_MS
  // 测试用：备份时人为等待一小会儿，让并发 409 可稳定复现。
  const backupDelayMs = Number.isFinite(options.backupDelayMs) && options.backupDelayMs >= 0 ? options.backupDelayMs : 0
  const home = options.home ?? process.env.HOME ?? os.homedir()
  const dshHome =
    typeof options.env?.DSH_HOME === 'string' && options.env.DSH_HOME.trim().length > 0
      ? path.resolve(options.env.DSH_HOME.trim())
      : null

  let backingUp = false
  let disposed = false
  let timer = null
  let lastRecovered = null

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function info(message) {
    try {
      logger?.info?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function displayPath(filePath) {
    return maskPath(filePath, { home, dshHome })
  }

  function sha256File(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  }

  /** 列出备份（按创建时间新→旧）。 */
  function readBackups() {
    const out = []
    try {
      if (!existsSync(backupsDir)) return out
      for (const name of readdirSync(backupsDir)) {
        const dir = path.join(backupsDir, name)
        try {
          if (!statSync(dir).isDirectory()) continue
          const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
          if (!isPlainObject(manifest) || manifest.ok !== true) continue
          out.push({ name, dir, manifest })
        } catch {
          /* 跳过损坏备份 */
        }
      }
    } catch {
      /* ignore */
    }
    out.sort((left, right) => {
      const leftAt = typeof left.manifest.createdAt === 'number' ? left.manifest.createdAt : 0
      const rightAt = typeof right.manifest.createdAt === 'number' ? right.manifest.createdAt : 0
      return rightAt - leftAt || right.name.localeCompare(left.name)
    })
    return out
  }

  /** 统计文件内容（entries 与 health 判定；不改文件）。 */
  function inspectContent(entry, text) {
    if (entry.id === 'journal.jsonl') {
      let valid = 0
      let invalid = 0
      for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue
        try {
          JSON.parse(line)
          valid += 1
        } catch {
          invalid += 1
        }
      }
      return { entries: valid, health: invalid > 0 ? 'corrupt' : 'ok', invalidLines: invalid }
    }
    if (entry.kind === 'json') {
      try {
        const parsed = JSON.parse(text)
        const entries =
          entry.id === 'topics.json' || entry.id === 'topics-candidates.json'
            ? Array.isArray(parsed?.topics)
              ? parsed.topics.length
              : 0
            : undefined
        return entries === undefined ? { health: 'ok' } : { entries, health: 'ok' }
      } catch {
        return { health: 'invalid' }
      }
    }
    // md：journal.md / learning-log.md 统计 `^## ` 条目数
    if (entry.kind === 'md') {
      const entries = (text.match(/^## /gm) ?? []).length
      return { entries, health: 'ok' }
    }
    return { health: 'ok' }
  }

  /** 校验单个登记文件（缺失/内容损坏/大小骤减）。 */
  function inspectFile(entry, latestBackup) {
    let stat = null
    try {
      stat = statSync(entry.path)
    } catch {
      stat = null
    }
    if (stat === null || !stat.isFile()) {
      return {
        id: entry.id,
        kind: entry.kind,
        path: entry.path,
        exists: false,
        size: 0,
        mtimeMs: null,
        health: 'missing',
        issues: ['missing'],
      }
    }
    const issues = []
    let content = null
    try {
      // 文本文件读入做内容统计/JSON 校验；超大文件跳过内容校验（仍记录 size）。
      if (stat.size <= 20 * 1024 * 1024) content = readFileSync(entry.path, 'utf8')
    } catch {
      content = null
    }
    let contentHealth = 'ok'
    let entries = undefined
    if (content !== null) {
      const inspected = inspectContent(entry, content)
      contentHealth = inspected.health
      entries = inspected.entries
      if (contentHealth === 'invalid') issues.push('invalid')
      if (contentHealth === 'corrupt') issues.push('corrupt')
    }
    if (latestBackup !== null && Array.isArray(latestBackup.manifest.files)) {
      const previous = latestBackup.manifest.files.find((item) => isPlainObject(item) && item.id === entry.id)
      if (previous && previous.exists === true && typeof previous.size === 'number' && previous.size > 0) {
        if (stat.size < previous.size * (1 - MEMORY_SIZE_DROP_RATIO)) issues.push('size-drop')
      }
    }
    let health = contentHealth
    if (health === 'ok' && issues.includes('size-drop')) health = 'warn'
    return {
      id: entry.id,
      kind: entry.kind,
      path: entry.path,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ...(entries === undefined ? {} : { entries }),
      health,
      issues,
    }
  }

  /** 健康检查：返回 files/status（不改文件，不抛）。 */
  function healthCheck() {
    const backups = readBackups()
    const latest = backups.length > 0 ? backups[0] : null
    const inspected = files.map((entry) => inspectFile(entry, latest))
    const issues = []
    let status = 'ok'
    for (const file of inspected) {
      for (const issue of file.issues) issues.push({ id: file.id, issue })
      if (file.health === 'missing' || file.health === 'invalid' || file.health === 'corrupt') {
        status = 'error'
        if (file.health === 'missing') warn(`记忆文件缺失：${displayPath(file.path)}`)
        if (file.health === 'invalid') warn(`记忆文件 JSON 损坏：${displayPath(file.path)}`)
        if (file.health === 'corrupt') warn(`记忆文件 JSONL 含损坏行：${displayPath(file.path)}`)
      } else if (file.health === 'warn' && status === 'ok') {
        status = 'warn'
        warn(`记忆文件大小骤减（<50% 上次备份）：${displayPath(file.path)}`)
      }
    }
    return { status, files: inspected, issues }
  }

  /** 删除超出保留份数的旧备份（最旧优先）。 */
  function pruneBackups() {
    try {
      const backups = readBackups()
      for (const backup of backups.slice(maxBackups)) {
        rmSync(backup.dir, { recursive: true, force: true })
      }
    } catch (error) {
      warn(`清理旧备份失败：${shortMessage(error)}`)
    }
  }

  /** 创建一次备份（复制+manifest 原子写）；返回 {ok, backup} 或 {ok:false}。 */
  async function backup(request = {}) {
    if (disposed) return { ok: false, busy: false, message: 'disposed' }
    if (backingUp) return { ok: false, busy: true, message: 'backup already running' }
    backingUp = true
    try {
      if (backupDelayMs > 0) await sleep(backupDelayMs)
      const createdAt = now()
      const reason = sanitizeReason(request.reason)
      const baseName = `${timestampName(createdAt)}-${reason}`
      let name = baseName
      let index = 2
      while (existsSync(path.join(backupsDir, name))) {
        name = `${baseName}-${index}`
        index += 1
      }
      const dir = path.join(backupsDir, name)
      mkdirSync(dir, { recursive: true })
      const manifestFiles = []
      for (const entry of files) {
        const info = { id: entry.id, kind: entry.kind, exists: false }
        try {
          const stat = statSync(entry.path)
          if (!stat.isFile()) {
            manifestFiles.push(info)
            continue
          }
          const backupFile = path.join(dir, entry.id)
          const tmpFile = `${backupFile}.tmp`
          copyFileSync(entry.path, tmpFile)
          renameSync(tmpFile, backupFile)
          manifestFiles.push({
            id: entry.id,
            kind: entry.kind,
            exists: true,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sha256: sha256File(entry.path),
          })
        } catch {
          manifestFiles.push(info)
        }
      }
      const manifest = { ok: true, v: 1, createdAt, reason, files: manifestFiles }
      writeJsonAtomic(path.join(dir, 'manifest.json'), manifest)
      pruneBackups()
      const count = manifestFiles.filter((file) => file.exists === true).length
      info(`记忆备份完成：${name}（${count} 个文件）`)
      return { ok: true, backup: { name, createdAt, reason, files: count } }
    } catch (error) {
      warn(`记忆备份失败：${shortMessage(error)}`)
      return { ok: false, busy: false, message: shortMessage(error) }
    } finally {
      backingUp = false
    }
  }

  /** 若最近备份早于 backupIntervalMs（含从未备份）则备份。 */
  async function maybeBackup() {
    try {
      const backups = readBackups()
      const latest = backups.length > 0 ? backups[0] : null
      const latestAt = latest !== null && typeof latest.manifest.createdAt === 'number' ? latest.manifest.createdAt : 0
      if (latestAt > 0 && now() - latestAt < backupIntervalMs) {
        return { ok: true, skipped: true, backup: null }
      }
      return await backup({ reason: 'startup' })
    } catch (error) {
      warn(`定时备份失败：${shortMessage(error)}`)
      return { ok: false, message: shortMessage(error) }
    }
  }

  /**
   * 从最近备份恢复**缺失**文件；绝不覆盖已存在文件；坏文件只标记不自动覆盖。
   * @returns {{ok:boolean, backupName?:string, recovered:string[], skipped:Array<{id:string,reason:string}>, message?:string}}
   */
  function recover() {
    try {
      const backups = readBackups()
      if (backups.length === 0) {
        lastRecovered = { ok: true, backupName: null, recovered: [], skipped: [], message: 'no backup' }
        return lastRecovered
      }
      const latest = backups[0]
      const recovered = []
      const skipped = []
      for (const item of Array.isArray(latest.manifest.files) ? latest.manifest.files : []) {
        if (!isPlainObject(item) || typeof item.id !== 'string') continue
        const entry = files.find((file) => file.id === item.id)
        if (entry === undefined) {
          skipped.push({ id: item.id, reason: 'unregistered' })
          continue
        }
        if (item.exists !== true) {
          skipped.push({ id: item.id, reason: 'backup-missing' })
          continue
        }
        if (existsSync(entry.path)) {
          skipped.push({ id: item.id, reason: 'exists' })
          continue
        }
        try {
          const source = path.join(latest.dir, entry.id)
          const tmpFile = `${entry.path}.recover-${process.pid}.tmp`
          mkdirSync(path.dirname(entry.path), { recursive: true })
          copyFileSync(source, tmpFile)
          renameSync(tmpFile, entry.path)
          recovered.push(entry.id)
        } catch (error) {
          skipped.push({ id: entry.id, reason: `copy-failed: ${shortMessage(error)}` })
        }
      }
      if (recovered.length > 0) {
        info(`记忆恢复完成：从 ${latest.name} 恢复 ${recovered.join('、')}`)
      }
      lastRecovered = { ok: true, backupName: latest.name, recovered, skipped }
      return lastRecovered
    } catch (error) {
      warn(`记忆恢复失败：${shortMessage(error)}`)
      return { ok: false, backupName: null, recovered: [], skipped: [], message: shortMessage(error) }
    }
  }

  /** 只读快照：{ok,health,files,backups,recovered,updatedAt}（路径脱敏）。 */
  function snapshot() {
    const health = healthCheck()
    const backups = readBackups()
    const backupSummary = {
      count: backups.length,
      lastAt: backups.length > 0 && typeof backups[0].manifest.createdAt === 'number' ? backups[0].manifest.createdAt : null,
      latestId: backups.length > 0 ? backups[0].name : null,
    }
    return {
      ok: true,
      health: health.status,
      files: health.files.map((file) => ({
        id: file.id,
        kind: file.kind,
        path: displayPath(file.path),
        exists: file.exists,
        size: file.size,
        mtimeMs: file.mtimeMs,
        ...(file.entries === undefined ? {} : { entries: file.entries }),
        health: file.health,
        ...(file.issues.length > 0 ? { issues: file.issues } : {}),
      })),
      backups: backupSummary,
      recovered: lastRecovered !== null && Array.isArray(lastRecovered.recovered) ? [...lastRecovered.recovered] : [],
      updatedAt: now(),
    }
  }

  /** 启动：上次备份 >6h（或从未备份）则立即备份，之后每 6h 一次。 */
  function start() {
    if (disposed || timer !== null) return
    try {
      mkdirSync(backupsDir, { recursive: true })
    } catch (error) {
      warn(`创建备份目录失败：${shortMessage(error)}`)
    }
    maybeBackup().catch(() => {})
    timer = setInterval(() => {
      maybeBackup().catch(() => {})
    }, backupIntervalMs)
    timer.unref?.()
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function dispose() {
    disposed = true
    stop()
  }

  return {
    paths,
    files,
    backup,
    maybeBackup,
    recover,
    healthCheck,
    snapshot,
    start,
    stop,
    dispose,
    isBackingUp: () => backingUp,
  }
}

/** GET/HEAD 记忆快照处理器（unfenced，只读、no-store、永不 5xx）。 */
export function createMemorySnapshotHandler(options = {}) {
  const hub = options.hub
  return async function memorySnapshotHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end('method not allowed')
      return
    }
    let payload
    try {
      payload = hub.snapshot()
    } catch (error) {
      payload = { ok: false, error: { code: 'MEMORY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) } }
    }
    const body = JSON.stringify(payload)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    if (method === 'HEAD') {
      res.end()
      return
    }
    res.end(body)
  }
}

/** POST 手动备份处理器（fenced；并发时 409）。 */
export function createMemoryBackupHandler(options = {}) {
  const hub = options.hub
  const fence = options.fence ?? null
  return async function memoryBackupHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'POST') {
      res.writeHead(405, {
        Allow: 'POST',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end('method not allowed')
      return
    }
    // 信任栅栏（与其它 JSON 路由一致、fail-closed）。
    if (fence !== null && typeof fence.check === 'function') {
      let denial = null
      try {
        denial = fence.check(req)
      } catch {
        denial = { status: 403, code: 'FORBIDDEN', message: '信任校验异常，已拒绝。' }
      }
      if (denial !== null) {
        const body = JSON.stringify({ ok: false, error: { code: denial.code, message: denial.message } })
        res.writeHead(denial.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': String(Buffer.byteLength(body)),
        })
        res.end(body)
        return
      }
    }
    let result
    try {
      result = await hub.backup({ reason: 'manual' })
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    if (result !== null && result !== undefined && result.busy === true) {
      const body = JSON.stringify({ ok: false, error: { code: 'BACKUP_IN_PROGRESS', message: '已有备份正在进行，请稍后再试' } })
      res.writeHead(409, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': String(Buffer.byteLength(body)),
      })
      res.end(body)
      return
    }
    let payload
    if (result !== null && result !== undefined && result.ok === true && isPlainObject(result.backup)) {
      payload = {
        ok: true,
        backup: {
          id: result.backup.name,
          at: result.backup.createdAt,
          files: result.backup.files,
          reason: result.backup.reason,
        },
      }
    } else {
      payload = result !== null && result !== undefined && result.ok === false
        ? { ok: false, error: { code: 'MEMORY_BACKUP_FAILED', message: String(result.message ?? '备份失败') } }
        : { ok: false, error: { code: 'MEMORY_UNAVAILABLE', message: '记忆中枢不可用' } }
    }
    const body = JSON.stringify(payload)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    res.end(body)
  }
}
