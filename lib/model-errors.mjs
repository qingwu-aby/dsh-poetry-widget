// lib/model-errors.mjs —— 模型调用失败诊断（契约 v1.41 §2.22，task-69）。
//
// 目的：OpenCode Go 仍 400 时，能从 `$DSH_HOME/.dsh-poetry/model-errors.jsonl` 直接看到
// 真实 status / code / message 与请求元数据。**绝不写提示词/消息正文/用户内容**。
//
// 文件为 JSONL：每行一条 record；超过 200 行时保留最近 200 行（原子写）。
// 另提供只读 unfenced GET /api/dsh-poetry/model-errors.json 返回最近 20 条。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { resolveSettingsPath } from './settings-store.mjs'

/** 错误记录保留上限（行）。 */
export const MODEL_ERRORS_MAX_LINES = 200
/** message 字段最大字符数。 */
export const MODEL_ERRORS_MESSAGE_MAX = 500
/** 只读诊断路由（unfenced，无敏感内容）。 */
export const MODEL_ERRORS_ROUTE = '/api/dsh-poetry/model-errors.json'

/** 解析错误文件位置：$DSH_HOME/.dsh-poetry/model-errors.jsonl。 */
export function resolveModelErrorsPath(env = process.env, home = null) {
  const { dir } = resolveSettingsPath(env, home)
  return path.join(dir, 'model-errors.jsonl')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function charLength(value) {
  return Array.from(String(value ?? '')).length
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? `${chars.slice(0, max - 3).join('')}...` : chars.join('')
}

function errorStatus(error) {
  if (error === null || error === undefined) return undefined
  if (typeof error === 'number') return error
  if (!isPlainObject(error)) return undefined
  const candidates = [error.status, error.statusCode, isPlainObject(error.response) ? error.response.status : undefined]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function errorCode(error) {
  if (!isPlainObject(error)) return undefined
  const value = error.code ?? (isPlainObject(error.failure) ? error.failure.code : undefined)
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 80) : undefined
}

function errorMessage(error) {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (isPlainObject(error)) {
    if (typeof error.message === 'string' && error.message.length > 0) return error.message
    if (typeof error.reason === 'string') return error.reason
  }
  return String(error ?? 'unknown error')
}

/** 从 llm.stream options + prompt 提取**不含正文**的请求元数据。 */
export function describeModelRequest(options, promptText) {
  const opts = isPlainObject(options) ? options : {}
  return {
    hasTemperature: Object.hasOwn(opts, 'temperature'),
    reasoningEffort: typeof opts.reasoningEffort === 'string' ? opts.reasoningEffort : null,
    maxTokens: typeof opts.maxTokens === 'number' ? opts.maxTokens : null,
    systemChars: charLength(opts.system),
    promptChars: charLength(promptText),
    messagesCount: Array.isArray(opts.messages) ? opts.messages.length : 0,
  }
}

/**
 * 构造一条安全错误记录（无提示词/正文/用户内容）。
 * @param {{
 *   role: string, provider: string, model: string,
 *   error: unknown, request?: object, now?: number,
 * }} input
 */
export function buildModelErrorRecord(input) {
  return {
    at: typeof input.now === 'number' ? input.now : Date.now(),
    role: String(input.role ?? '').slice(0, 40),
    provider: String(input.provider ?? '').slice(0, 80),
    model: String(input.model ?? '').slice(0, 120),
    ...(errorStatus(input.error) !== undefined ? { status: errorStatus(input.error) } : {}),
    ...(errorCode(input.error) !== undefined ? { code: errorCode(input.error) } : {}),
    message: clampText(errorMessage(input.error), MODEL_ERRORS_MESSAGE_MAX),
    request: isPlainObject(input.request) ? input.request : describeModelRequest(null, ''),
  }
}

/**
 * 追加一条错误记录；超过 200 行保留最近 200 行（tmp+rename 原子写）。
 * @returns {{ok: true, lines: number} | {ok: false, message: string}}
 */
export function appendModelError(file, record) {
  if (typeof file !== 'string' || file.length === 0) return { ok: false, message: 'no model-errors path' }
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    let lines = []
    if (existsSync(file)) {
      try {
        lines = readFileSync(file, 'utf8')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      } catch {
        lines = []
      }
    }
    lines.push(JSON.stringify(record))
    if (lines.length > MODEL_ERRORS_MAX_LINES) lines = lines.slice(-MODEL_ERRORS_MAX_LINES)
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, file)
    return { ok: true, lines: lines.length }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 记录一次候选失败：写诊断文件 + 简短 warn（含 provider/model/status/message，无提示词）。
 * @returns {object} 写入的 record（即使写失败也返回，便于测试）
 */
export function recordModelFailure(input) {
  const record = buildModelErrorRecord(input)
  const errorsPath = typeof input.errorsPath === 'string' && input.errorsPath.length > 0 ? input.errorsPath : null
  if (errorsPath !== null) {
    const result = appendModelError(errorsPath, record)
    if (result.ok !== true) {
      try {
        input.warnFn?.(`${input.prefix ?? '模型调用失败'}（诊断写入失败：${result.message}）`)
      } catch {
        /* ignore */
      }
    }
  }
  try {
    const status = record.status !== undefined ? ` HTTP ${record.status}` : ''
    input.warnFn?.(`${input.prefix ?? '模型调用失败'}（${record.provider}/${record.model}${status}）：${record.message}`)
  } catch {
    /* ignore */
  }
  return record
}

/** 读取最近 limit 条（坏行跳过；按时间顺序旧→新返回）。 */
export function readModelErrors(file, limit = 20) {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  try {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const out = []
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (isPlainObject(parsed)) out.push(parsed)
      } catch {
        /* skip bad line */
      }
    }
    return out.slice(-max)
  } catch {
    return []
  }
}

/**
 * 汇总最近一段时间的模型失败（health.runtime.modelErrors 用；只读、无 prompt 正文）。
 * @param {string} file
 * @param {{since?: number, limit?: number}} [options]
 */
export function summarizeModelErrors(file, options = {}) {
  const since = typeof options.since === 'number' && Number.isFinite(options.since) ? options.since : 0
  const rows = readModelErrors(file, Number.isFinite(options.limit) ? options.limit : MODEL_ERRORS_MAX_LINES)
  const byRole = {}
  const byCode = {}
  let total = 0
  let lastAt = null
  for (const row of rows) {
    const at = typeof row.at === 'number' ? row.at : 0
    if (at < since) continue
    total += 1
    const role = typeof row.role === 'string' && row.role.length > 0 ? row.role : 'unknown'
    const code = typeof row.code === 'string' && row.code.length > 0 ? row.code : 'UNKNOWN'
    byRole[role] = (byRole[role] ?? 0) + 1
    byCode[code] = (byCode[code] ?? 0) + 1
    if (lastAt === null || at > lastAt) lastAt = at
  }
  return { since, total, byRole, byCode, lastAt }
}

/** unfenced 只读路由：GET/HEAD /api/dsh-poetry/model-errors.json（最近 20 条，无敏感）。 */
export function createModelErrorsHandler(options = {}) {
  const file = typeof options.file === 'string' ? options.file : null
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 20
  return async function modelErrorsHandler(req, res) {
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
      const errors = file !== null ? readModelErrors(file, limit) : []
      payload = { ok: true, errors, updatedAt: Date.now() }
    } catch (error) {
      payload = {
        ok: false,
        error: { code: 'MODEL_ERRORS_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) },
      }
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
