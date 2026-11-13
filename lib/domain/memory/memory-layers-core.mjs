// lib/domain/memory/memory-layers-core.mjs —— 分层记忆常量与小工具（v0.2.6 从 memory-layers.mjs 拆出）
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** 每轮整合覆盖的最短记忆年龄（太新的不急着压成概括）。 */
export const MEMORY_LAYERS_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000
/** 两次整合之间至少隔这么久。 */
export const MEMORY_LAYERS_INTERVAL_MS = 6 * 60 * 60 * 1000
/** 单条概括最多字数。 */
export const MEMORY_LAYERS_SUMMARY_MAX = 800
/** 自我短句最多字数。 */
/** 每条 episode 最多记录多少个来源条目 id（不复制原文，只留定位）。 */
export const MEMORY_LAYERS_SOURCE_IDS_MAX = 200

export const MEMORY_LAYERS_FACT_MAX = 80
/** 最多保留的自我短句条数（超出后仍保留在文件里，只是检索不注入）。 */
export const MEMORY_LAYERS_SELF_FACTS_MAX = 120
/** 单次整合最多处理多少条 journal（v2.7：300→800，跟上每日 600–1000 条的经历）。 */
export const MEMORY_LAYERS_BATCH_MAX = 800
/** 一次 tick 最多跑几批（避免 backlog 大时一次调用太久）。 */
export const MEMORY_LAYERS_MAX_BATCHES_PER_RUN = 2
/** 一次整合最多给模型多少条聚合片段（先聚合压缩，再调用模型）。 */
export const MEMORY_LAYERS_SNIPPET_MAX = 120

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function shortMessage(error) {
  return cleanInline(error instanceof Error ? error.message : String(error ?? ''), 160)
}

export function extractJson(text) {
  if (typeof text !== 'string') return null
  const raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 分层记忆文件路径（记忆目录下）。 */
