// lib/world-feedback.mjs —— 真实世界反馈账本（v2.23，约束实验）。
//
// 只记录真实发生的事：网页抓取成功/失败、作品是否写成、文章是否读到、
// 手动阅读的结果……模型生成的“结果”不写这里；先让 observation 与 belief 分开。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveSettingsPath } from './settings-store.mjs'

export const WORLD_FEEDBACK_MAX_RECENT = 8
export const WORLD_FEEDBACK_MAX_CHARS = 200

function cleanInline(value, max = WORLD_FEEDBACK_MAX_CHARS) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function resolveWorldFeedbackPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'world-feedback.jsonl')
}

export function createWorldFeedback(options = {}) {
  const file = path.resolve(options.file ?? resolveWorldFeedbackPath(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null

  function record(input) {
    const source = cleanInline(typeof input?.source === 'string' ? input.source : 'world', 24)
    const kind = cleanInline(typeof input?.kind === 'string' ? input.kind : 'event', 24)
    const ok = input?.ok === true
    const summary = cleanInline(typeof input?.summary === 'string' ? input.summary : '', WORLD_FEEDBACK_MAX_CHARS)
    const entry = { ts: now(), source, kind, ok, summary: summary || (ok ? '成功' : '失败') }
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 世界反馈写入失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
    }
    return entry
  }

  function readAll() {
    try {
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          try {
            const entry = JSON.parse(line)
            return entry && typeof entry.ts === 'number' ? entry : null
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  function recent(limit = WORLD_FEEDBACK_MAX_RECENT) {
    const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : WORLD_FEEDBACK_MAX_RECENT
    return readAll().slice(-count)
  }

  /** 某时间点之后是否有真实反馈（用于禁止模型编造 outcome）。 */
  function hasSince(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return false
    return readAll().some((entry) => entry.ts > ts)
  }

  function formatForPrompt(limit = 5) {
    const items = recent(limit)
    if (items.length === 0) return ''
    const lines = ['最近世界上真实发生的事（这些是观测，不是你的想象；不要改写它们）：']
    for (const entry of items) {
      const time = new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
      lines.push(`- ${time} ${entry.source}/${entry.kind}：${entry.ok ? '成功' : '失败'}，${entry.summary}`)
    }
    return lines.join('\n')
  }

  return { file, record, recent, hasSince, formatForPrompt }
}
