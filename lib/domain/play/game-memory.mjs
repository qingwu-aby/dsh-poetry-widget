// lib/domain/play/game-memory.mjs —— Minecraft 游戏记忆（v0.6.1）
//
// 与聊天/日记/学习记忆物理隔离：独立文件 game-memory.json，独立分类，只在游戏决策时读取。
// 分类固定为 world / player / session / event / plan，互不混用：
//   world   世界/服务器设定（世界名、规则、端口）
//   player  一起玩的人（谁、怎么称呼、偏好）
//   session 一次游玩的经过（开始/结束、一起做了什么）
//   event   值得记住的瞬间（第一次见面、死亡、被送东西）
//   plan    她在游戏里想做的事
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export const GAME_MEMORY_CATEGORIES = Object.freeze(['world', 'player', 'session', 'event', 'plan', 'build', 'method', 'inquiry', 'vision'])
const CAPS = Object.freeze({ world: 40, player: 80, session: 120, event: 200, plan: 40, build: 80, method: 80, inquiry: 80, vision: 20 })
const CATEGORY_LABEL = Object.freeze({ world: '世界', player: '玩家', session: '游玩', event: '事件', plan: '打算', build: '建造', method: '方法', inquiry: '调研', vision: '愿景' })

function clean(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}
function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

export function normalizeGameMemory(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const entries = []
  for (const category of GAME_MEMORY_CATEGORIES) {
    const list = Array.isArray(source.entries) ? source.entries.filter((item) => item && item.category === category) : []
    const seen = new Set()
    for (const item of list) {
      const text = clean(item.text, 240)
      if (text.length === 0) continue
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        category,
        text,
        at: numberOr(item.at, Date.now()),
        source: clean(item.source, 40),
        count: Math.max(1, Math.min(999, Math.round(numberOr(item.count, 1)))),
      })
    }
    while (entries.filter((item) => item.category === category).length > CAPS[category]) {
      const index = entries.findIndex((item) => item.category === category)
      if (index < 0) break
      entries.splice(index, 1)
    }
  }
  return { ok: true, version: 1, updatedAt: numberOr(source.updatedAt, 0), entries }
}

export function createGameMemory(options = {}) {
  const file = options.file ?? ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = normalizeGameMemory(options.seed ?? null)
  if (file) {
    try {
      state = normalizeGameMemory(JSON.parse(readFileSync(file, 'utf8')))
    } catch (_error) {}
  }
  function save() {
    if (!file) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      writeFileSync(temp, JSON.stringify(state, null, 2) + '\n')
      renameSync(temp, file)
    } catch (_error) {}
  }
  function record(input) {
    const category = GAME_MEMORY_CATEGORIES.includes(input && input.category) ? input.category : ''
    const text = clean(input && input.text, 240)
    if (category.length === 0 || text.length === 0) return { ok: false, error: 'invalid' }
    const list = state.entries
    const existing = list.find((item) => item.category === category && item.text.toLowerCase() === text.toLowerCase())
    if (existing) {
      existing.at = now()
      existing.count = Math.min(999, existing.count + 1)
      if (input.source) existing.source = clean(input.source, 40)
    } else {
      list.push({ category, text, at: now(), source: clean(input.source, 40), count: 1 })
      while (list.filter((item) => item.category === category).length > CAPS[category]) {
        const index = list.findIndex((item) => item.category === category)
        if (index < 0) break
        list.splice(index, 1)
      }
    }
    state.updatedAt = now()
    save()
    return { ok: true, entry: existing || list[list.length - 1] }
  }
  function digest(input = {}) {
    const category = GAME_MEMORY_CATEGORIES.includes(input.category) ? input.category : ''
    const limit = Math.max(1, Math.min(20, Math.round(numberOr(input.limit, 6))))
    const items = state.entries
      .filter((item) => (category ? item.category === category : true))
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
    return items
  }
  function promptLines(limitPerCategory = 3) {
    const lines = []
    for (const category of GAME_MEMORY_CATEGORIES) {
      const items = digest({ category, limit: limitPerCategory })
      if (items.length === 0) continue
      lines.push(`${CATEGORY_LABEL[category]}：${items.map((item) => item.text).join('；')}`)
    }
    return lines
  }
  return { record, digest, promptLines, snapshot: () => ({ ok: true, updatedAt: state.updatedAt, entries: state.entries.slice() }) }
}
