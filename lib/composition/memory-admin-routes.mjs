// @ts-check
// lib/composition/memory-admin-routes.mjs —— 记忆质量/隐私管理 API（Gate K3，受保护本地接口）。
//
// GET  /api/dsh-poetry/memory-admin.json：providers/conflicts/quality summary（样本来自 hubRuntime.queryMemory）。
// POST /api/dsh-poetry/memory-admin.json：
//   · quality.analyze：返回 items/actions（keep/merge/archive/drop）——只分析，不执行；
//   · privacy.export：buildMemoryExport 生成脱敏 JSON；默认只返回内容/大小，save:true 才写 exports 目录；
//   · privacy.delete.plan：buildMemoryDeletePlan dry-run；confirm:true 仍只返回 approved 计划，不删除任何 live 记忆。
// 鉴权：chat token（body/query）或 DSH trust fence。无 hubRuntime 降级 {ok:true, available:false}。
// 不新增依赖；不修改记忆文件。

import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildMemoryDeletePlan, buildMemoryExport } from '../core/memory-privacy.mjs'
import { analyzeMemoryQuality, MEMORY_QUALITY_ACTIONS } from '../core/memory-quality.mjs'
import { readChatToken } from '../domain/chat/facade.mjs'
import { getActiveHubRuntime } from './hub-runtime.mjs'

/** 路由。 */
export const MEMORY_ADMIN_ROUTE = '/api/dsh-poetry/memory-admin.json'

/** 支持的 POST action。 */
export const MEMORY_ADMIN_ACTIONS = Object.freeze(['quality.analyze', 'privacy.export', 'privacy.delete.plan'])

const MAX_BODY_BYTES = 128 * 1024
const MAX_SAMPLE_ENTRIES = 50

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (size === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function queryToken(req) {
  const url = typeof req?.url === 'string' ? req.url : ''
  const index = url.indexOf('?')
  if (index < 0) return ''
  try {
    return new URLSearchParams(url.slice(index + 1)).get('token') ?? ''
  } catch (error) {
    void error
    return ''
  }
}

const INLINE_SECRET_PATTERNS = [
  /\b(?:sk|pk|ghp|gho|ghs|xoxb|xoxp|AKIA)[-_A-Za-z0-9]{8,}\b/g,
  /\bBearer\s+\S{8,}\b/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b(?:api[-_]?key|access[-_]?token|token|password|passwd|secret)\s*[:=]\s*\S+/gi,
]

/** 导出前对正文做一次行内脱敏（C4 只处理“整值像凭证”的情况）。 */
function redactEntries(entries) {
  return entries.map((entry) => {
    if (!isPlainObject(entry) || typeof entry.text !== 'string') return entry
    let text = entry.text
    for (const pattern of INLINE_SECRET_PATTERNS) text = text.replace(pattern, '[redacted]')
    return { ...entry, text }
  })
}

function writeAtomic(file, content) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.tmp')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
    return { ok: true }
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch (cleanupError) {
      void cleanupError
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 创建记忆管理 handler。
 * @param {{
 *   hubRuntime?: object|null,
 *   hubRuntimeProvider?: (() => object|null)|null,
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   exportsDir?: string|null,
 *   now?: () => number,
 *   logger?: object|null,
 * }} [options]
 */
export function createMemoryAdminHandler(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const fixedRuntime = spec.hubRuntime ?? null
  const provider = typeof spec.hubRuntimeProvider === 'function' ? spec.hubRuntimeProvider : null
  const tokenFile = typeof spec.tokenFile === 'string' ? spec.tokenFile : ''
  const fence = spec.fence ?? null
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const logger = /** @type {any} */ (spec.logger ?? null)
  const exportsDir =
    typeof spec.exportsDir === 'string' && spec.exportsDir.length > 0
      ? spec.exportsDir
      : path.join(os.homedir(), '.dsh-poetry', 'memory-exports')

  function resolveHub() {
    if (fixedRuntime !== null) return fixedRuntime
    if (provider !== null) {
      try {
        return provider()
      } catch (error) {
        void error
        return null
      }
    }
    return getActiveHubRuntime()
  }

  function tokenMatches(value) {
    if (typeof value !== 'string' || value.length === 0) return false
    const expected = readChatToken(tokenFile)
    return typeof expected === 'string' && expected.length > 0 && value === expected
  }

  function fenceAllows(req) {
    try {
      if (fence === null || typeof fence.check !== 'function') return true
      return fence.check(req) === null
    } catch (error) {
      void error
      return false
    }
  }

  function allows(req, bodyToken) {
    return fenceAllows(req) || tokenMatches(bodyToken) || tokenMatches(queryToken(req))
  }

  /** 从运行时取样本（只读；失败隔离）。 */
  async function sampleEntries(hubRuntime, filter) {
    try {
      const result = await hubRuntime.queryMemory({ ...filter, limit: MAX_SAMPLE_ENTRIES })
      if (result !== null && result !== undefined && result.ok === true && Array.isArray(result.entries))
        return result.entries
      return []
    } catch (error) {
      void error
      return []
    }
  }

  function memorySummary(hubRuntime) {
    try {
      const snapshot = typeof hubRuntime.memorySnapshot === 'function' ? hubRuntime.memorySnapshot() : null
      return isPlainObject(snapshot) ? snapshot : { available: false }
    } catch (error) {
      void error
      return { available: false }
    }
  }

  return async function memoryAdminHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'POST') {
        res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let payload = null
      if (method === 'POST') {
        try {
          payload = await readBody(req)
        } catch (error) {
          void error
          sendJson(res, 400, { ok: false, error: 'invalid_json' })
          return
        }
      }
      const bodyToken = isPlainObject(payload) && typeof payload.token === 'string' ? payload.token : ''
      if (!allows(req, bodyToken)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const hubRuntime = resolveHub()
      if (hubRuntime === null || hubRuntime === undefined) {
        sendJson(res, 200, {
          ok: true,
          available: false,
          reason: 'hub-unavailable',
          actions: MEMORY_ADMIN_ACTIONS.slice(),
        })
        return
      }
      if (method === 'GET') {
        const entries = await sampleEntries(hubRuntime, {})
        const quality = analyzeMemoryQuality(entries, { now: now() })
        sendJson(res, 200, {
          ok: true,
          available: true,
          memory: memorySummary(hubRuntime),
          sample: entries.length,
          quality:
            quality.ok === true
              ? {
                  summary: quality.summary,
                  groups: quality.groups.length,
                  conflicts: quality.conflicts.length,
                  invalid: quality.invalid.length,
                }
              : { error: quality.code ?? 'quality-failed' },
          actions: MEMORY_ADMIN_ACTIONS.slice(),
        })
        return
      }
      const action = typeof payload?.action === 'string' ? payload.action : ''
      if (MEMORY_ADMIN_ACTIONS.indexOf(action) < 0) {
        sendJson(res, 400, { ok: false, error: 'unknown_action', actions: MEMORY_ADMIN_ACTIONS })
        return
      }
      const filter = isPlainObject(payload.filter) ? payload.filter : {}
      const entries = await sampleEntries(hubRuntime, filter)
      if (action === 'quality.analyze') {
        const quality = analyzeMemoryQuality(entries, { now: now() })
        if (quality.ok !== true) {
          sendJson(res, 200, {
            ok: false,
            available: true,
            code: quality.code ?? 'quality-failed',
            message: quality.message ?? '',
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          available: true,
          executed: false,
          summary: quality.summary,
          groups: quality.groups,
          conflicts: quality.conflicts,
          invalid: quality.invalid,
          items: quality.items.slice(0, 100),
          actions: MEMORY_QUALITY_ACTIONS.slice(),
          note: '只分析，不执行任何 keep/merge/archive/drop',
        })
        return
      }
      if (action === 'privacy.export') {
        const exported = buildMemoryExport({
          entries: redactEntries(entries),
          filter,
          now: now(),
          limit: payload.limit,
        })
        if (exported.ok !== true) {
          sendJson(res, 200, {
            ok: false,
            available: true,
            code: exported.code ?? 'export-failed',
            message: exported.message ?? '',
          })
          return
        }
        const json = exported.export.json
        const sizeBytes = Buffer.byteLength(json, 'utf8')
        let saved = false
        let file = null
        if (payload.save === true) {
          file = path.join(exportsDir, 'memory-export-' + new Date(now()).toISOString().replace(/[:.]/g, '-') + '.json')
          const written = writeAtomic(file, json)
          if (written.ok !== true) {
            sendJson(res, 200, {
              ok: false,
              available: true,
              code: 'export-write-failed',
              message: written.message ?? '',
            })
            return
          }
          saved = true
        }
        sendJson(res, 200, {
          ok: true,
          available: true,
          executed: false,
          saved,
          file,
          sizeBytes,
          manifest: exported.export.manifest,
          entries: exported.export.entries.length,
          json: saved ? undefined : json,
          note: saved ? '已写入 exports 目录（脱敏）' : '未写文件；save:true 才落盘',
        })
        return
      }
      // privacy.delete.plan
      const planResult = buildMemoryDeletePlan({
        entries,
        filter,
        now: now(),
        dryRun: payload.dryRun !== false,
        confirm: payload.confirm === true,
      })
      if (planResult.ok !== true) {
        sendJson(res, 200, {
          ok: false,
          available: true,
          code: planResult.code ?? 'delete-plan-failed',
          message: planResult.message ?? '',
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        available: true,
        executed: false,
        plan: planResult.plan,
        note: '只生成删除计划；confirm:true 也不会删除 live 记忆（执行需后续文件层）',
      })
    } catch (error) {
      try {
        logger?.warn?.(
          `[dsh-little-whale] memory-admin 失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } catch (warnError) {
        void warnError
      }
      sendJson(res, 500, { ok: false, error: 'internal_error' })
    }
  }
}

/**
 * 注册记忆管理路由（http-wiring 调用）。
 * @param {{webServer: any, disposers?: Array<Function>, hubRuntime?: object|null, hubRuntimeProvider?: (() => object|null)|null, tokenFile?: string, fence?: object|null, exportsDir?: string|null, logger?: object|null}} deps
 */
export function registerMemoryAdminRoute(deps) {
  const handler = createMemoryAdminHandler({
    hubRuntime: deps.hubRuntime ?? null,
    hubRuntimeProvider: deps.hubRuntimeProvider ?? null,
    tokenFile: deps.tokenFile,
    fence: deps.fence ?? null,
    exportsDir: deps.exportsDir ?? null,
    logger: deps.logger ?? null,
  })
  const registration = deps.webServer.register({ kind: 'exact', path: MEMORY_ADMIN_ROUTE, handler })
  if (Array.isArray(deps.disposers) && registration !== null && registration !== undefined) {
    if (typeof registration === 'function') deps.disposers.push(registration)
    else if (typeof registration.dispose === 'function') deps.disposers.push(() => registration.dispose())
  }
  return handler
}
