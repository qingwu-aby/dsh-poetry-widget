// lib/domain/play/game-memory-workspace.mjs —— 文件化游戏记忆（v0.9.0，P1）
//
// 借鉴 Coopanion 的 workspace memory：
//   PARTNER_GAME.md 短画像每次进 prompt；细节按主题放文件；每条写入 git commit；
//   todo/ 与 archive/ 有明确归属；日志按年月、写绝对日期。
// 与原有 JSON 记忆同一 API（record/digest/promptLines），便于平滑迁移。
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GAME_MEMORY_CATEGORIES } from './game-memory.mjs'

const CATEGORY_FILE = Object.freeze({
  world: 'world.md',
  player: 'players.md',
  build: 'build/home.md',
  method: 'methods.md',
  plan: 'todo.md',
  event: 'log/YYYY-MM.md',
  session: 'log/YYYY-MM.md',
})
const CATEGORY_LABEL = Object.freeze({ world: '世界', player: '玩家', session: '游玩', event: '事件', plan: '打算', build: '建造', method: '方法' })
const PARTNER_FILE = 'PARTNER_GAME.md'
const PARTNER_LINES = Object.freeze({
  world: '我在这个世界的落脚处：',
  player: '一起玩的人：',
  build: '我正在盖的家：',
})

function clean(text, max = 240) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}
function nowIso(now) {
  const date = new Date(now())
  return date.toISOString().slice(0, 10)
}
function monthName(now) {
  return new Date(now()).toISOString().slice(0, 7)
}
function entryLine(text, at, source) {
  const date = new Date(at).toISOString().slice(0, 10)
  return `- ${text}${source ? `（${source}）` : ''} [${date}]\n`
}
function parseLines(category, content) {
  const out = []
  for (const line of String(content || '').split('\n')) {
    const match = /^- (.*?)(?:\s*\[(\d{4}-\d{2}-\d{2})\])?$/.exec(line.trim())
    if (!match) continue
    out.push({ category, text: clean(match[1], 240), at: match[2] ? Date.parse(match[2] + 'T00:00:00Z') : 0, source: '' })
  }
  return out
}

export function createGameMemoryWorkspace(options = {}) {
  const dir = options.dir
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const git = options.git !== false
  const legacyFile = options.legacyFile ?? ''
  const entries = []
  let gitReady = false
  const fileFor = (category) => path.join(dir, category === 'event' || category === 'session' ? CATEGORY_FILE[category].replace('YYYY-MM', monthName(now)) : CATEGORY_FILE[category])
  const ensureDir = () => {
    mkdirSync(dir, { recursive: true })
    mkdirSync(path.join(dir, 'build'), { recursive: true })
    mkdirSync(path.join(dir, 'log'), { recursive: true })
    mkdirSync(path.join(dir, 'archive'), { recursive: true })
    if (!existsSync(path.join(dir, '.gitignore'))) writeFileSync(path.join(dir, '.gitignore'), 'blobs/\n')
  }
  function gitCommit(message) {
    if (!git) return
    try {
      if (!gitReady) {
        if (!existsSync(path.join(dir, '.git'))) execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
        gitReady = true
      }
      execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['-c', 'user.name=whale', '-c', 'user.email=whale@local', 'commit', '-m', message], { cwd: dir, stdio: 'ignore' })
    } catch (_error) {}
  }
  function load() {
    ensureDir()
    if (!existsSync(path.join(dir, 'world.md')) && legacyFile && existsSync(legacyFile)) {
      try {
        const legacy = JSON.parse(readFileSync(legacyFile, 'utf8'))
        for (const item of Array.isArray(legacy.entries) ? legacy.entries : []) {
          if (!GAME_MEMORY_CATEGORIES.includes(item.category)) continue
          entries.push({ category: item.category, text: clean(item.text, 240), at: Number(item.at) || now(), source: clean(item.source, 40) })
        }
      } catch (_error) {}
      for (const entry of entries) writeEntry(entry, false)
    }
    for (const category of GAME_MEMORY_CATEGORIES) {
      const file = fileFor(category)
      if (!existsSync(file)) continue
      for (const entry of parseLines(category, readFileSync(file, 'utf8'))) {
        if (!entries.some((item) => item.category === entry.category && item.text === entry.text)) entries.push(entry)
      }
    }
  }
  function writeEntry(entry, commit = false) {
    ensureDir()
    const file = fileFor(entry.category)
    const line = entryLine(entry.text, entry.at, entry.source)
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (existing.includes(entry.text)) return false
    appendFileSync(file, line)
    if (entry.category === 'world' || entry.category === 'player' || entry.category === 'build') updatePartner(entry, commit)
    if (commit) gitCommit(`memory(${entry.category}): ${clean(entry.text, 60)}`)
    return true
  }
  function updatePartner(entry, commit) {
    const file = path.join(dir, PARTNER_FILE)
    let content = existsSync(file) ? readFileSync(file, 'utf8') : '# 游戏里的我\n\n'
    const prefix = PARTNER_LINES[entry.category]
    if (!content.includes(prefix)) content += `\n${prefix}\n`
    const line = `- ${clean(entry.text, 120)}\n`
    if (!content.includes(line.trim())) content = content.replace(prefix + '\n', prefix + '\n' + line)
    writeFileSync(file, content)
    if (commit) gitCommit('memory(partner): 更新短画像')
  }
  load()
  function record(input) {
    const category = GAME_MEMORY_CATEGORIES.includes(input && input.category) ? input.category : ''
    const text = clean(input && input.text, 240)
    if (!category || !text) return { ok: false, error: 'invalid' }
    const existing = entries.find((item) => item.category === category && item.text.toLowerCase() === text.toLowerCase())
    if (existing) {
      existing.at = now()
      return { ok: true, entry: existing, deduped: true }
    }
    const entry = { category, text, at: now(), source: clean(input && input.source, 40) }
    entries.push(entry)
    writeEntry(entry, true)
    return { ok: true, entry }
  }
  function digest(input = {}) {
    const category = GAME_MEMORY_CATEGORIES.includes(input.category) ? input.category : ''
    const limit = Math.max(1, Math.min(20, Math.round(Number(input.limit) || 6)))
    return entries
      .filter((item) => (category ? item.category === category : true))
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
  }
  function promptLines(limitPerCategory = 3) {
    const lines = []
    try {
      const partner = path.join(dir, PARTNER_FILE)
      if (existsSync(partner)) {
        const text = readFileSync(partner, 'utf8').replace(/^#.*\n?/gm, '').trim()
        if (text) lines.push(`游戏短画像：${clean(text, 300)}`)
      }
    } catch (_error) {}
    for (const category of GAME_MEMORY_CATEGORIES) {
      const items = digest({ category, limit: limitPerCategory })
      if (items.length === 0) continue
      lines.push(`${CATEGORY_LABEL[category]}：${items.map((item) => item.text).join('；')}`)
    }
    return lines
  }
  return { record, digest, promptLines, dir, snapshot: () => ({ ok: true, dir, entries: entries.slice() }) }
}
