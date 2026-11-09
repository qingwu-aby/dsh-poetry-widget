// lib/domain/voice/style-exemplars.mjs —— 用她自己的旧句子当语言参照（v3.16）
//
// 方向：少写“说话规则”，多给她自己以前说过的句子。从 journal / chat-history 里取，
// 过滤技术词与太短的句子，去重，并排除最近刚说过的（避免复读）。
import { existsSync, readFileSync, statSync } from 'node:fs'

const CACHE_MS = 10 * 60 * 1000
const JUNK = /(AI|模型|提示词|系统|JSON|http|https|路径|配置|接口|代码|bug|日志|参数|prompt|token)/i

function clean(value, max = 80) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function bigrams(value) {
  const chars = Array.from(String(value ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}

function similarity(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let overlap = 0
  for (const gram of A) if (B.has(gram)) overlap += 1
  return (2 * overlap) / (A.size + B.size)
}

function readJournalLines(file, limit) {
  try {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch (error) {
          return null
        }
      })
      .filter((entry) => entry && ['thought', 'murmur', 'mood', 'selfTalk'].includes(entry.kind))
      .map((entry) => clean(entry.text))
      .filter(Boolean)
  } catch (error) {
    return []
  }
}

function readChatLines(file, limit) {
  try {
    if (!existsSync(file)) return []
    const history = JSON.parse(readFileSync(file, 'utf8'))
    const lines = []
    for (const peer of Object.values(history)) {
      if (!Array.isArray(peer)) continue
      for (const message of peer.slice(-limit)) {
        if (message && message.role === 'whale') lines.push(clean(message.text))
      }
    }
    return lines.filter(Boolean)
  } catch (error) {
    return []
  }
}

/** 从候选句里挑 3 条：长度合适、无技术词、不与最近重复、相互去重。 */
export function pickExemplars(candidates, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 3
  const exclude = Array.isArray(options.exclude) ? options.exclude.map((line) => clean(line, 200)).filter(Boolean) : []
  const picked = []
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const text = clean(raw, 80)
    if (text.length < 8 || text.length > 80) continue
    if (JUNK.test(text)) continue
    if (/^\d+$/.test(text)) continue
    if (exclude.some((line) => similarity(line, text) >= 0.45)) continue
    if (picked.some((line) => similarity(line, text) >= 0.6)) continue
    picked.push(text)
    if (picked.length >= limit) break
  }
  return picked
}

export function createStyleExemplars(options = {}) {
  const journalPath = String(options.journalPath ?? '')
  const chatHistoryPath = String(options.chatHistoryPath ?? '')
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const cacheMs = Number.isFinite(options.cacheMs) && options.cacheMs > 0 ? options.cacheMs : CACHE_MS
  let cache = null
  let cachedAt = 0
  let cachedMtime = 0

  function corpus() {
    const mtime = (() => {
      try {
        return Math.max(
          existsSync(journalPath) ? statSync(journalPath).mtimeMs : 0,
          existsSync(chatHistoryPath) ? statSync(chatHistoryPath).mtimeMs : 0,
        )
      } catch (error) {
        return 0
      }
    })()
    const stale = cache === null || now() - cachedAt > cacheMs || mtime !== cachedMtime
    if (!stale) return cache
    const merged = [...readChatLines(chatHistoryPath, 80), ...readJournalLines(journalPath, 500)].reverse()
    cache = merged
    cachedAt = now()
    cachedMtime = mtime
    return cache
  }

  /** @returns {string[]} 可直接作为语气参照的旧句子 */
  function pick(pickOptions = {}) {
    try {
      return pickExemplars(corpus(), pickOptions)
    } catch (error) {
      return []
    }
  }

  return { pick, snapshot: () => ({ size: corpus().length, cachedAt }) }
}
