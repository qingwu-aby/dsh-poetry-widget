// @ts-check
// shadow 事件的脱敏/截断：从 plugin-runtime 抽出，避免主装配文件超行数预算。
import { isPlainObject } from './guide-services.mjs'
import { sanitizeEventText } from './hub-runtime.mjs'

const SENSITIVE_FACT_KEY =
  /(api[-_]?key|access[-_]?token|secret|token|password|passwd|authorization|cookie|credential|private[-_]?key)/i

export function sanitizeFacts(value, depth = 0) {
  if (depth > 3) return null
  if (typeof value === 'string') return sanitizeEventText(value, { maxLength: 200 })
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeFacts(item, depth + 1))
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, item] of Object.entries(value).slice(0, 20)) {
      const safeKey = sanitizeEventText(key, { maxLength: 60 })
      out[safeKey] = SENSITIVE_FACT_KEY.test(key) ? '[redacted]' : sanitizeFacts(item, depth + 1)
    }
    return out
  }
  return null
}

export function truncateFacts(facts) {
  if (!isPlainObject(facts)) return {}
  const sanitized = sanitizeFacts(facts)
  const json = JSON.stringify(sanitized)
  if (typeof json === 'string' && json.length <= 2000) return sanitized
  return { truncated: true, preview: sanitizeEventText(json, { maxLength: 500 }) }
}

function listStrings(value, max) {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string')
        .slice(0, max)
        .map((item) => sanitizeEventText(item, { maxLength: 80 }))
    : []
}

export function truncateObservation(observation) {
  if (!isPlainObject(observation)) return null
  return {
    position: sanitizeEventText(observation.position, { maxLength: 60 }),
    players: listStrings(observation.players, 6),
    health: Number.isFinite(Number(observation.health)) ? Number(observation.health) : null,
    food: Number.isFinite(Number(observation.food)) ? Number(observation.food) : null,
    timeOfDay: sanitizeEventText(observation.timeOfDay, { maxLength: 20 }),
    inventory: listStrings(observation.inventory, 8),
    nearbyBlocks: listStrings(observation.nearbyBlocks, 8),
    lastChat: sanitizeEventText(observation.lastChat, { maxLength: 120 }),
  }
}
