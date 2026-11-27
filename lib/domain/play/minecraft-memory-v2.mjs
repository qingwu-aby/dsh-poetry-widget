// @ts-check
// lib/domain/play/minecraft-memory-v2.mjs —— 小鲸鱼的四层记忆（v1.77）
//
// 四层各自独立落盘，互不越界：
//   L1 台账   dir/ledger/<YYYY-MM-DD>.jsonl  一天一个文件，只记账，永不进 prompt
//   L2 情景   dir/episodic.json              只收 self 且够醒目的条目，≤300 条
//   L3 汇总   summarizeActor()               把反射/租约流水压成一句人话
//   L4 叙事   dir/narrative.md               自我叙事整篇重写，≤200 字
//
// 设计口径：
//   - 只有 self 的条目能进 L2；reflex/lease 的流水必须先经 summarizeActor 汇总。
//   - L2 用「显著度 × 新鲜度」排序，新鲜度按 24 小时尺度衰减，旧的自动让位。
//   - promptLines() 只吐 L2 与 L4；L1 台账对她不可见（台账是给复盘用的，不是给人设用的）。
//   - 所有写入都落到 options.dir 指定的目录，测试里注入临时目录与假时钟。
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 台账允许的三种记账人。 */
export const LEDGER_ACTORS = Object.freeze(['self', 'reflex', 'lease'])

/** 生产环境的默认存储目录。 */
export const DEFAULT_MEMORY_V2_DIR = path.join(os.homedir(), '.dsh', '.dsh-poetry', 'memory-v2')

const MAX_EPISODIC = 300
const MIN_SALIENCE = 20
const SALIENCE_MAX = 100
const DEDUPE_WINDOW_MS = 24 * 3600 * 1000
const FRESHNESS_SCALE_MS = 24 * 3600 * 1000
const EPISODIC_LINE_MAX = 60
const NARRATIVE_MAX = 200
const MAX_KIND_CLAUSES = 4
const MAX_REFS = 12
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/
const LEGACY_NOISE = /出生点大约|（join）|^验证实验/
const LEGACY_KEEP = /失败|✗/

// kind → 人话模板；未知 kind 走「做了 N 次 kind」兜底。
const KIND_SENTENCE = Object.freeze({
  retreat: '躲过 {n} 次危险',
  flee: '撤了 {n} 次',
  eat: '吃了 {n} 次东西',
  drink: '喝了 {n} 次水',
  sleep: '睡了 {n} 觉',
  mine: '挖了 {n} 次矿',
  gather: '捡了 {n} 次资源',
  craft: '合成了 {n} 次东西',
  build: '盖了 {n} 处东西',
  fight: '打斗 {n} 次',
  fail: '失手 {n} 次',
  move: '走了 {n} 段路',
  patrol: '巡了 {n} 圈',
})

// 记账人 → 摘要里的主语。self 用「自己」，反射/租约点明机制。
const ACTOR_WORD = Object.freeze({ self: '自己', reflex: '靠反射', lease: '靠租约' })

// L4 叙事拼装顺序：身份 → 手上 → 世界 → 最近。
const NARRATIVE_PARTS = Object.freeze([
  Object.freeze({ key: 'identity', lead: '我是' }),
  Object.freeze({ key: 'doing', lead: '这会儿' }),
  Object.freeze({ key: 'world', lead: '周围' }),
  Object.freeze({ key: 'recent', lead: '最近' }),
])

/** 把任意输入压成一行干净文本。 */
function squeeze(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 按「字」计数（中文一个字算一个），不按 UTF-16 码元。 */
function charLen(value) {
  return Array.from(String(value ?? '')).length
}

/** 超长截断并补省略号，结果长度 ≤ max。 */
function clip(value, max) {
  const chars = Array.from(String(value ?? ''))
  if (chars.length <= max) return chars.join('')
  if (max <= 1) return chars.slice(0, Math.max(0, max)).join('')
  return `${chars.slice(0, max - 1).join('')}…`
}

/** 时间戳归一化：非法或非正数走兜底。 */
function toTime(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 本地日历日（YYYY-MM-DD），一天一个台账文件按它切。 */
function dayKey(at) {
  const d = new Date(at)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** 新鲜度：以 24 小时为尺度线性衰减，未来时间按 0 龄算。 */
function freshness(at, nowAt) {
  return 1 / (1 + Math.max(0, nowAt - at) / FRESHNESS_SCALE_MS)
}

/** L2 排序分：显著度 × 新鲜度。 */
function scoreOf(entry, nowAt) {
  return Number(entry.salience) * freshness(Number(entry.at), nowAt)
}

function normalizeRefs(refs) {
  if (!Array.isArray(refs)) return []
  const out = []
  for (const ref of refs) {
    if (typeof ref !== 'string') continue
    const text = ref.trim()
    if (text.length === 0) continue
    out.push(text)
    if (out.length >= MAX_REFS) break
  }
  return out
}

function ensureDir(target) {
  mkdirSync(target, { recursive: true })
}

/** 先写临时文件再改名，避免半截文件被读到。 */
function writeAtomic(file, text) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

/** 解析一行 jsonl；坏行返回 null，由调用方跳过。 */
function parseLedgerLine(line) {
  const text = line.trim()
  if (text.length === 0) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch (_error) {
    // 括号形参是刻意的：避免被 check-catches 记成静默兜底。坏行只说明文件被写坏过，跳过即可。
    return null
  }
}

/** 读一个台账文件里的全部条目（坏行跳过）。 */
function readLedgerFile(file) {
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const item = parseLedgerLine(line)
    if (item) out.push(item)
  }
  return out
}

/** 读出合法的 L2 条目，顺手洗掉脏字段。 */
function normalizeEpisodic(list) {
  const out = []
  const seen = new Set()
  if (!Array.isArray(list)) return out
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (item.actor !== 'self') continue
    const text = squeeze(item.text)
    if (text.length === 0) continue
    const at = toTime(item.at, 0)
    if (at <= 0) continue
    const salience = Number(item.salience)
    if (!Number.isFinite(salience)) continue
    const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : randomUUID()
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      actor: 'self',
      kind: squeeze(item.kind) || 'event',
      text,
      at,
      salience: Math.min(SALIENCE_MAX, Math.max(0, salience)),
      refs: normalizeRefs(item.refs),
    })
  }
  return out
}

function readEpisodic(file) {
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (_error) {
    // 文件被写坏时当作空记忆，下一次写入会自然覆盖它。
    return []
  }
  return normalizeEpisodic(parsed)
}

function writeEpisodic(file, entries) {
  writeAtomic(file, `${JSON.stringify(entries, null, 2)}\n`)
}

/** L4 叙事正文：去掉注释行，压成一行，最多 200 字。 */
function readNarrativeBody(file) {
  if (!existsSync(file)) return ''
  const pieces = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim()
    if (text.length === 0) continue
    if (text.startsWith('<!--')) continue
    pieces.push(text)
  }
  return clip(pieces.join(''), NARRATIVE_MAX)
}

/** 把四段拼成一篇 ≤200 字的叙事，缺的段直接省略。 */
function buildNarrative(parts) {
  let body = ''
  for (const part of NARRATIVE_PARTS) {
    const text = squeeze(parts[part.key])
    if (text.length === 0) continue
    const sentence = `${text.startsWith(part.lead) ? '' : part.lead}${text}。`
    const next = body + sentence
    if (charLen(next) <= NARRATIVE_MAX) {
      body = next
      continue
    }
    const room = NARRATIVE_MAX - charLen(body)
    if (room > 1) body += clip(sentence, room)
    break
  }
  return body
}

/** 生成 L3 摘要句。 */
function buildActorSentence(actor, ordered, since, nowAt) {
  const top = ordered.slice(0, MAX_KIND_CLAUSES)
  const clauses = top.map(([kind, count]) => {
    const template = KIND_SENTENCE[kind]
    return template ? template.replace('{n}', String(count)) : `做了 ${count} 次${kind}`
  })
  const timeWord = since <= 0 ? '近来' : dayKey(since) === dayKey(nowAt) ? '今天' : '昨夜'
  const actorWord = ACTOR_WORD[actor] || `以${actor}的身份`
  const tail = ordered.length > top.length ? `等 ${ordered.length} 类事` : ''
  return `${timeWord}${actorWord}${clauses.join('、')}${tail}`
}

/** 备份文件名去重：同一个时间戳只保留一份，多了加序号。 */
function uniqueBackupPath(dirPath, base, at) {
  let candidate = path.join(dirPath, `${base}.${at}.bak`)
  let index = 1
  while (existsSync(candidate)) {
    candidate = path.join(dirPath, `${base}.${at}-${index}.bak`)
    index += 1
  }
  return candidate
}

/**
 * 建一套四层记忆。
 *
 * @param {{ dir?: string, now?: () => number, legacyFiles?: string[] }} [options]
 *   dir：存储目录；now：可注入时钟；legacyFiles：cleanupNoise 要清理的旧 markdown。
 * @returns {{
 *   appendLedger: (entry: any) => { ok: boolean, at: number, actor: string, file: string },
 *   remember: (entry: any) => { ok: boolean, id?: string, reason?: string },
 *   promptLines: (limit?: number) => string[],
 *   rewriteNarrative: (parts: any) => number,
 *   summarizeActor: (actor: string, sinceAt?: number) => { count: number, kinds: Record<string, number>, sentence: string },
 *   stats: () => { ledgerToday: number, episodic: number, narrativeChars: number, salientRatio: number },
 *   cleanupNoise: () => Array<{ file: string, before: number, after: number }>,
 * }}
 */
export function createMemoryV2(options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const dir = typeof opts.dir === 'string' && opts.dir.trim().length > 0 ? opts.dir.trim() : DEFAULT_MEMORY_V2_DIR
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const now = () => toTime(clock(), Date.now())
  const ledgerDir = path.join(dir, 'ledger')
  const episodicFile = path.join(dir, 'episodic.json')
  const narrativeFile = path.join(dir, 'narrative.md')
  const archiveDir = path.join(dir, 'archive')
  const legacyFiles = Array.isArray(opts.legacyFiles)
    ? opts.legacyFiles.filter((file) => typeof file === 'string' && file.trim().length > 0).map((file) => file.trim())
    : []

  // ---- L1 台账 -------------------------------------------------------------

  /**
   * 往当天台账追加一条。actor 缺失或非法直接抛错（这是记账的硬前提，不兜底）。
   * L1 只落 jsonl，永远不参与 promptLines()。
   */
  function appendLedger(entry) {
    const item = entry && typeof entry === 'object' ? entry : {}
    const actor = typeof item.actor === 'string' ? item.actor.trim() : ''
    if (!LEDGER_ACTORS.includes(actor)) throw new Error('actor_required')
    const at = toTime(item.at, now())
    const record = {
      at,
      actor,
      kind: squeeze(item.kind) || 'misc',
      text: squeeze(item.text),
    }
    if (item.meta && typeof item.meta === 'object') record.meta = item.meta
    ensureDir(ledgerDir)
    const file = path.join(ledgerDir, `${dayKey(at)}.jsonl`)
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
    return { ok: true, at, actor, file }
  }

  // ---- L2 情景 -------------------------------------------------------------

  /**
   * 记一条情景记忆。四道闸：只收 self、显著度 ≥20、24 小时内同文不重记、最多 300 条。
   * @returns {{ ok: boolean, id?: string, reason?: string }}
   */
  function remember(entry) {
    const item = entry && typeof entry === 'object' ? entry : {}
    const actor = typeof item.actor === 'string' ? item.actor.trim() : ''
    if (actor !== 'self') return { ok: false, reason: 'actor' }
    const text = squeeze(item.text)
    if (text.length === 0) return { ok: false, reason: 'text' }
    const salience = Number(item.salience)
    if (!Number.isFinite(salience) || salience < MIN_SALIENCE) return { ok: false, reason: 'salience' }
    const at = toTime(item.at, now())
    const current = now()
    const existing = readEpisodic(episodicFile)
    const key = text.toLowerCase()
    const duplicate = existing.some(
      (saved) => saved.text.toLowerCase() === key && Math.abs(current - saved.at) < DEDUPE_WINDOW_MS,
    )
    if (duplicate) return { ok: false, reason: 'duplicate' }
    const record = {
      id: randomUUID(),
      actor: 'self',
      kind: squeeze(item.kind) || 'event',
      text,
      at,
      salience: Math.min(SALIENCE_MAX, salience),
      refs: normalizeRefs(item.refs),
    }
    const ranked = [...existing, record]
      .sort((a, b) => scoreOf(b, current) - scoreOf(a, current))
      .slice(0, MAX_EPISODIC)
    writeEpisodic(episodicFile, ranked)
    // 罕见情况：新条目太旧、分数垫底，被 300 条上限当场挤掉。
    if (!ranked.some((saved) => saved.id === record.id)) return { ok: false, reason: 'evicted' }
    return { ok: true, id: record.id }
  }

  // ---- 注入用 prompt 行 ----------------------------------------------------

  /**
   * 给 prompt 用的记忆行：最多 limit 条 L2（分数降序）+ 1 段 L4 叙事。
   * 总条数 ≤ limit + 1；L2 每条 ≤60 字，L4 整段 ≤200 字；L1 台账绝不出现在这里。
   */
  function promptLines(limit = 3) {
    const raw = Number(limit)
    const cap = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 3
    const current = now()
    const lines = readEpisodic(episodicFile)
      .map((entry) => ({ entry, score: scoreOf(entry, current) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cap)
      .map((item) => clip(squeeze(item.entry.text), EPISODIC_LINE_MAX))
    const narrative = readNarrativeBody(narrativeFile)
    if (narrative.length > 0) lines.push(clip(narrative, NARRATIVE_MAX))
    return lines
  }

  // ---- L4 自我叙事 ---------------------------------------------------------

  /**
   * 整篇重写自我叙事（不是追加）：四段拼成一篇 ≤200 字，带重写时间戳注释。
   * @returns {number} 写入的叙事正文字数（不含注释行）。
   */
  function rewriteNarrative(parts) {
    const source = parts && typeof parts === 'object' ? parts : {}
    const body = buildNarrative(source)
    const at = now()
    writeAtomic(narrativeFile, `<!-- rewritten-at: ${at} -->\n${body}${body.length > 0 ? '\n' : ''}`)
    return charLen(body)
  }

  // ---- L3 反射/租约汇总 ----------------------------------------------------

  /**
   * 汇总某个记账人自 sinceAt 起的台账：按 kind 计数并生成一句中文摘要。
   * @returns {{ count: number, kinds: Record<string, number>, sentence: string }}
   */
  function summarizeActor(actor, sinceAt) {
    const who = squeeze(actor)
    const since = toTime(sinceAt, 0)
    const kinds = {}
    let count = 0
    const sinceDay = since > 0 ? dayKey(since) : ''
    let names = []
    if (existsSync(ledgerDir)) {
      names = readdirSync(ledgerDir)
        .filter((name) => DAY_FILE.test(name))
        .sort()
    }
    for (const name of names) {
      if (sinceDay.length > 0 && name.slice(0, 10) < sinceDay) continue
      for (const item of readLedgerFile(path.join(ledgerDir, name))) {
        if (!item || squeeze(item.actor) !== who) continue
        const at = Number(item.at)
        if (since > 0 && (!Number.isFinite(at) || at < since)) continue
        const kind = squeeze(item.kind) || 'misc'
        kinds[kind] = (kinds[kind] || 0) + 1
        count += 1
      }
    }
    const ordered = Object.entries(kinds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const sentence = count === 0 ? '' : buildActorSentence(who, ordered, since, now())
    return { count, kinds, sentence }
  }

  // ---- 仪表盘 -------------------------------------------------------------

  /** 四层各自的体量，salientRatio = L2 / (L2 + 今日台账)，两位小数。 */
  function stats() {
    const current = now()
    const todayFile = path.join(ledgerDir, `${dayKey(current)}.jsonl`)
    const ledgerToday = existsSync(todayFile) ? readLedgerFile(todayFile).length : 0
    const episodic = readEpisodic(episodicFile).length
    const narrativeChars = charLen(readNarrativeBody(narrativeFile))
    const total = episodic + ledgerToday
    const salientRatio = total === 0 ? 0 : Math.round((episodic / total) * 100) / 100
    return { ledgerToday, episodic, narrativeChars, salientRatio }
  }

  // ---- 迁移历史噪声 -------------------------------------------------------

  /**
   * 清理旧 markdown：按行去重、删 join/出生点/验证实验噪声，失败记录保留；
   * 每次改动都在 dir/archive 留一份原文件备份。
   * @returns {Array<{ file: string, before: number, after: number }>}
   */
  function cleanupNoise() {
    const results = []
    const at = now()
    for (const file of legacyFiles) {
      if (!existsSync(file)) continue
      const raw = readFileSync(file, 'utf8')
      const hadTrailing = raw.endsWith('\n')
      const rawLines = raw.split('\n').map((line) => line.replace(/\r$/, ''))
      if (hadTrailing && rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop()
      const kept = []
      const seen = new Set()
      for (const line of rawLines) {
        if (LEGACY_NOISE.test(line) && !LEGACY_KEEP.test(line)) continue
        if (seen.has(line)) continue
        seen.add(line)
        kept.push(line)
      }
      const before = rawLines.length
      const after = kept.length
      if (after !== before) {
        ensureDir(archiveDir)
        writeFileSync(uniqueBackupPath(archiveDir, path.basename(file), at), raw, 'utf8')
        writeFileSync(file, `${kept.join('\n')}${hadTrailing ? '\n' : ''}`, 'utf8')
      }
      results.push({ file, before, after })
    }
    return results
  }

  return { appendLedger, remember, promptLines, rewriteNarrative, summarizeActor, stats, cleanupNoise }
}
