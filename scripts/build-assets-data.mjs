#!/usr/bin/env node
/**
 * build-assets-data.mjs —— 生成扩展数据资产（assets/data/，不进「今日一诗」默认路径）
 *
 * 产出（只写 assets/data/，**不修改 data/ 主产物**）：
 *   1) anthology.json   扩展诗库：诗经 305 + 楚辞 + 千家诗 219 + 唐诗三百首古体/乐府 147
 *                       形状 {ok,dataVersion,items:[{id,category,title,author,lines:[]}],categories:[]}
 *   2) poems-bank.json  全唐诗/全宋诗精选库（诗库 / 飞花令用）3000–5000 首
 *                       形状 {ok,dataVersion,items:[{id,title,author,dynasty,lines,tones?,form?,start?,firstRhyme?,rhymeIdx?,source:'bank'}]}
 *   3) pingshui.json    平水韵 106 韵部 + charIndex（格律检测用）
 *   4) ci-bank.json     全量宋词库（约 20,968 首，词牌别名归一 + 去重 + 简体）≤12MB
 *   5) manifest.json    上述四文件的 bytes/sha256/dataVersion/生成命令
 *
 * 数据全部来自本地只读源（离线可构建）：
 *   - curated 快照：项目内 data-src/（诗经/楚辞/千家诗/唐诗三百首/声律启蒙…）
 *   - 完整语料：项目同级 _ref/poetry-source/<commit>/（全唐诗/全宋诗/strains/rank）
 *   - 平水韵表：_ref/pingshui/pingshui_rhyme/data/organized_ping_ze_rhyme_dict.json
 *
 * 用法：
 *   node scripts/build-assets-data.mjs --offline                  # 离线构建（推荐）
 *   node scripts/build-assets-data.mjs --offline --bank-target 4500
 *   node scripts/build-assets-data.mjs --offline --out <dir>
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CANDIDATE_MAX_VARIANCES,
  DEFAULT_PINGSHUI,
  FAMOUS_POETS,
  MAX_VARIANCES,
  TONE_CHARS,
  chars,
  charLength,
  findTraditionalResiduals,
  firstClauseContent,
  hasAstralChars,
  isCJK,
  isGenericTitle,
  loadCuratedPoemRefs,
  loadPoemChunk,
  loadRhymeTable,
  makeCiTitle,
  matchCuratedPoems,
  normalizePoemText,
  normalizeRhythmic,
  simplifyChar,
  toSimplified,
} from './build-data.mjs'
import { PROJECT_ROOT, SOURCE, resolveCuratedFiles, resolveSource, scanSource } from './fetch-data.mjs'

/* ================================================================== *
 * 0. 常量与基础工具
 * ================================================================== */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DATA_DIR = path.join(PROJECT_ROOT, 'assets', 'data')
const MAIN_MANIFEST = path.join(PROJECT_ROOT, 'data', 'manifest.json')

/** 与 data/ 主产物保持同一数据版本（本脚本不改主产物）。 */
export const DEFAULT_DATA_VERSION = '2026-10-21.4'
/** 三份资产的体积预算（bytes）。 */
export const ASSET_BUDGETS = {
  'anthology.json': 400 * 1024,
  'poems-bank.json': 8 * 1024 * 1024,
  'pingshui.json': 400 * 1024,
  'ci-bank.json': 12 * 1024 * 1024,
}
/** 诗库条数目标区间。 */
export const BANK_TARGET = { min: 3000, max: 5000, default: 4500 }
/** 诗库单作者配额（放宽版，相对主数据集的 ≤10）。 */
export const BANK_MAX_PER_AUTHOR = 30

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function tryReadJSON(file) {
  try {
    return readJSON(file)
  } catch {
    return null
  }
}

function resolveDataVersion() {
  const main = tryReadJSON(MAIN_MANIFEST)
  return main?.dataVersion ?? DEFAULT_DATA_VERSION
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 简体化一行/一句：opencc t2s（长度不变）+ 异体补充表；若简化结果是 CJK Ext-B（字体缺字形），
 * 保留原 BMP 字，避免浏览器豆腐块。
 */
export function safeSimplified(text) {
  const src = String(text ?? '')
  const { text: converted } = toSimplified(src)
  const sourceChars = chars(src)
  const outChars = chars(converted)
  if (outChars.length !== sourceChars.length) return { text: converted, residual: [] }
  let changed = false
  for (let i = 0; i < outChars.length; i += 1) {
    if (outChars[i].codePointAt(0) > 0xffff && sourceChars[i].codePointAt(0) <= 0xffff) {
      outChars[i] = sourceChars[i]
      changed = true
    }
  }
  let out = changed ? outChars.join('') : converted
  // 兜底：仍可被简化的字（理论上 toSimplified 已处理）
  const fixed = chars(out).map((ch) => {
    const simplified = simplifyChar(ch)
    if (simplified !== ch && !hasAstralChars(simplified)) return simplified
    return ch
  })
  out = fixed.join('')
  // 残留扫描忽略「简体化结果是 Ext-B 生僻字」的字（已按可显示优先保留原 BMP 字）
  const residual = findTraditionalResiduals(out).filter((ch) => !hasAstralChars(simplifyChar(ch)))
  return { text: out, residual }
}

/** 一组行（联/句）→ 简体行数组（去空行）。 */
export function simplifyLines(lines) {
  const out = []
  for (const line of Array.isArray(lines) ? lines : []) {
    const { text } = safeSimplified(line)
    const trimmed = text.trim()
    if (trimmed) out.push(trimmed)
  }
  return out
}

/** 用于去重的正文 key（简体、只留汉字）。 */
function dedupeKey(lines) {
  return chars(simplifyLines(lines).join('')).filter(isCJK).join('')
}

/* ================================================================== *
 * 1. anthology.json —— 扩展诗库
 * ================================================================== */

const NEAR_FORM_TAGS = new Set(['五言绝句', '七言绝句', '五言律诗', '七言律诗'])

/** 千家诗/唐诗三百首里偶尔出现 {subchapter, paragraphs} 嵌套结构 → 摊平成行数组。 */
function flattenParagraphs(paragraphs) {
  const out = []
  for (const item of Array.isArray(paragraphs) ? paragraphs : []) {
    if (typeof item === 'string') {
      out.push(item)
    } else if (item && Array.isArray(item.paragraphs)) {
      out.push(...item.paragraphs.filter((line) => typeof line === 'string'))
    }
  }
  return out
}

const ANTHOLOGY_CATEGORY_META = {
  shijing: { id: 'shijing', name: '诗经', order: 0 },
  chuci: { id: 'chuci', name: '楚辞', order: 1 },
  qianjiashi: { id: 'qianjiashi', name: '千家诗', order: 2 },
  'tang-gushi': { id: 'tang-gushi', name: '唐诗三百首·古体乐府', order: 3 },
}

/**
 * 生成 anthology 数据。
 * @param {{ files: Record<string, { path: string }> }} curated resolveCuratedFiles() 的结果
 */
export function buildAnthology(curated, dataVersion) {
  const items = []
  const counters = {}
  const globalSeen = new Set()

  const pushItem = (categoryKey, id, title, author, lines) => {
    const cleanLines = simplifyLines(lines)
    if (cleanLines.length === 0) return false
    if (cleanLines.some((line) => hasAstralChars(line))) return false
    const key = dedupeKey(cleanLines)
    if (!key || globalSeen.has(key)) return false
    globalSeen.add(key)
    const cleanTitle = safeSimplified(title).text.trim() || '（无题）'
    const cleanAuthor = safeSimplified(author).text.trim() || '佚名'
    items.push({ id, category: ANTHOLOGY_CATEGORY_META[categoryKey].name, title: cleanTitle, author: cleanAuthor, lines: cleanLines })
    counters[categoryKey] = (counters[categoryKey] ?? 0) + 1
    return true
  }

  // 1) 诗经 305
  const shijing = tryReadJSON(curated.files.shijing?.path)
  if (Array.isArray(shijing)) {
    shijing.forEach((entry, index) => {
      pushItem('shijing', `shijing-${String(index + 1).padStart(3, '0')}`, entry.title, '佚名', flattenParagraphs(entry.content))
    })
  }
  // 2) 楚辞
  const chuci = tryReadJSON(curated.files.chuci?.path)
  if (Array.isArray(chuci)) {
    chuci.forEach((entry, index) => {
      pushItem('chuci', `chuci-${String(index + 1).padStart(3, '0')}`, entry.title, entry.author ?? '佚名', flattenParagraphs(entry.content))
    })
  }
  // 3) 千家诗 219（按 type 分组，保持源顺序）
  const qianjiashi = tryReadJSON(curated.files.qianjiashi?.path)
  if (qianjiashi && Array.isArray(qianjiashi.content)) {
    let seq = 0
    for (const group of qianjiashi.content) {
      for (const entry of group.content ?? []) {
        seq += 1
        pushItem(
          'qianjiashi',
          `qianjiashi-${String(seq).padStart(3, '0')}`,
          entry.chapter,
          String(entry.author ?? '').replace(/^[（(][^）)]*[）)]\s*/g, ''),
          flattenParagraphs(entry.paragraphs),
        )
      }
    }
  }
  // 4) 唐诗三百首：非近体（五言古诗/七言古诗/乐府等）147 条
  const tang300 = tryReadJSON(curated.files.tangshisanbaishou?.path)
  if (Array.isArray(tang300)) {
    let seq = 0
    for (const entry of tang300) {
      const tags = Array.isArray(entry.tags) ? entry.tags : []
      if (tags.some((tag) => NEAR_FORM_TAGS.has(tag))) continue
      seq += 1
      pushItem('tang-gushi', `tang-gushi-${String(seq).padStart(3, '0')}`, entry.title, entry.author, flattenParagraphs(entry.paragraphs))
    }
  }

  const categories = Object.values(ANTHOLOGY_CATEGORY_META)
    .sort((a, b) => a.order - b.order)
    .map((meta) => ({ id: meta.id, name: meta.name, count: counters[meta.id] ?? 0 }))
  return { payload: { ok: true, dataVersion, items, categories }, counters }
}

/* ================================================================== *
 * 2. pingshui.json —— 平水韵 106 韵部 + charIndex
 * ================================================================== */

const PINGSHUI_HALVES = [
  { group: 'ping', half: '上平聲部', tone: 'ping', prefix: '上平聲' },
  { group: 'ping', half: '下平聲部', tone: 'ping', prefix: '下平聲' },
  { group: 'ze', half: '上聲部', tone: 'shang', prefix: '上聲' },
  { group: 'ze', half: '去聲部', tone: 'qu', prefix: '去聲' },
  { group: 'ze', half: '入聲部', tone: 'ru', prefix: '入聲' },
]

/**
 * 生成平水韵全表（106 韵部 + charIndex）。
 * 原始结构：{ping:{上平聲部:{韵部名:[整串字]},...}, ze:{上聲部/去聲部/入聲部:{...}}}，
 * 每个韵部的值是「单元素数组装着一整串字」，必须 join('') 后再逐字拆。
 * charIndex 同时登记原字与其简体/异体归一结果（数据正文是简体，查表更方便）。
 */
export function buildPingshui(pingshuiPath, dataVersion) {
  const raw = readJSON(pingshuiPath)
  if (!raw?.ping || !raw?.ze) throw new Error(`平水韵表结构异常：${pingshuiPath}`)
  const categories = []
  const charIndexMap = new Map() // char -> Set<index>
  const register = (ch, index) => {
    if (!isCJK(ch)) return
    if (!charIndexMap.has(ch)) charIndexMap.set(ch, new Set())
    charIndexMap.get(ch).add(index)
    const simplified = simplifyChar(ch)
    if (simplified !== ch && !hasAstralChars(simplified) && isCJK(simplified)) {
      if (!charIndexMap.has(simplified)) charIndexMap.set(simplified, new Set())
      charIndexMap.get(simplified).add(index)
    }
  }
  const toneCounts = {}
  for (const spec of PINGSHUI_HALVES) {
    const group = raw[spec.group]?.[spec.half]
    if (!group || typeof group !== 'object') throw new Error(`平水韵表缺少分组：${spec.half}`)
    for (const [name, value] of Object.entries(group)) {
      const text = Array.isArray(value) ? value.join('') : String(value ?? '')
      if (!text) continue
      const index = categories.length
      const short = toSimplified(name.replace(new RegExp(`^${spec.prefix}`), '')).text.trim()
      const charsList = [...new Set(chars(text).filter(isCJK))]
      categories.push({ name, short, tone: spec.tone, chars: charsList.join('') })
      for (const ch of charsList) register(ch, index)
      toneCounts[spec.tone] = (toneCounts[spec.tone] ?? 0) + 1
    }
  }
  // charIndex：按码点排序保证可复现；值只存 category 下标数组（多音字多下标）
  const codes = [...charIndexMap.keys()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
  const charIndex = {}
  for (const ch of codes) charIndex[ch] = [...charIndexMap.get(ch)].sort((a, b) => a - b)
  const totalChars = categories.reduce((sum, category) => sum + charLength(category.chars), 0)
  return {
    payload: {
      ok: true,
      dataVersion,
      source: {
        repo: SOURCE.repo,
        commit: SOURCE.commit,
        license: SOURCE.license,
        pingShui: {
          repo: 'rbnyng/pingshui_rhyme',
          license: 'MIT',
          note: 'organized_ping_ze_rhyme_dict.json（Wikisource《平水韻》整理）',
        },
      },
      tones: ['平', '仄'],
      categories,
      charIndex,
    },
    stats: { categories: categories.length, toneCounts, totalChars, charIndexKeys: codes.length },
  }
}

/* ================================================================== *
 * 3. poems-bank.json —— 全唐诗/全宋诗精选库
 * ================================================================== */

function createStats() {
  return {
    counters: {},
    dropped: {},
    drop(bucket, reason) {
      this.dropped[bucket] ??= {}
      this.dropped[bucket][reason] = (this.dropped[bucket][reason] ?? 0) + 1
    },
  }
}

/**
 * 生成诗库：全唐诗 + 全宋诗近体候选，沿用主构建的质量门（shape / strains / 押韵 / 无 Ext-B），
 * 再按「精选 → 名家白名单 → rank 排序」分层选取，单作者 ≤30 首，非泛题/残句。
 */
export function buildPoemsBank(scanned, opts = {}) {
  const target = Math.max(BANK_TARGET.min, Math.min(BANK_TARGET.max, opts.target ?? BANK_TARGET.default))
  const stats = createStats()
  const rhymeTable = loadRhymeTable()
  const candidates = []
  for (const chunk of scanned.tang) {
    candidates.push(...loadPoemChunk(scanned, 'tang', chunk, stats, { rhymeTable, maxVariances: CANDIDATE_MAX_VARIANCES }))
  }
  for (const chunk of scanned.song) {
    candidates.push(...loadPoemChunk(scanned, 'song', chunk, stats, { rhymeTable, maxVariances: CANDIDATE_MAX_VARIANCES }))
  }
  // 精选（唐诗三百首/千家诗）命中项优先入选
  const refs = loadCuratedPoemRefs(scanned, () => {})
  const curatedMatched = matchCuratedPoems(candidates, refs, stats)
  const curatedIds = new Set(curatedMatched.map((item) => item.id))
  const curatedByScore = [...curatedMatched].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))

  const items = []
  const seenText = new Set()
  const seenIds = new Set()
  const perAuthor = new Map()
  const tiers = { curated: 0, famous: 0, ranked: 0 }
  const pushCandidate = (candidate, tier) => {
    if (!candidate || seenIds.has(candidate.id)) return false
    if (candidate._placeholderTitle) {
      stats.drop('bank', 'placeholderTitle')
      return false
    }
    if (isGenericTitle(candidate.title)) {
      stats.drop('bank', 'genericTitle')
      return false
    }
    const author = candidate.author ?? ''
    if ((perAuthor.get(author) ?? 0) >= BANK_MAX_PER_AUTHOR) {
      stats.drop('bank', 'authorQuota')
      return false
    }
    const textKey = normalizePoemText(candidate.linesOriginal)
    if (!textKey || seenText.has(textKey)) {
      stats.drop('bank', 'duplicate')
      return false
    }
    seenText.add(textKey)
    seenIds.add(candidate.id)
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1)
    tiers[tier] += 1
    items.push({
      id: `bank-${candidate.id}`,
      title: candidate.title,
      author,
      dynasty: candidate.dynasty,
      lines: candidate.lines,
      tones: candidate.tones,
      form: candidate.form,
      start: candidate.start,
      firstRhyme: candidate.firstRhyme,
      rhymeIdx: candidate.rhymeIdx,
      source: 'bank',
    })
    return true
  }

  // 第 1 层：精选命中（含少量著名拗体；已过 shape/strains/押韵/无 Ext-B 门）
  for (const candidate of curatedByScore) {
    pushCandidate(candidate, 'curated')
    if (items.length >= target) break
  }
  // 第 2 层：名家白名单 + rank 排序（变格 ≤2，质量优先）
  const remaining = candidates.filter((candidate) => !curatedIds.has(candidate.id))
  const eligible = (candidate) => (candidate._variances ?? 0) <= MAX_VARIANCES
  const famous = remaining
    .filter((candidate) => FAMOUS_POETS.has(candidate.author) && eligible(candidate))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
  for (const candidate of famous) {
    pushCandidate(candidate, 'famous')
    if (items.length >= target) break
  }
  // 第 3 层：其余非泛题候选按 rank 排序补足
  if (items.length < target) {
    const ranked = remaining
      .filter((candidate) => !FAMOUS_POETS.has(candidate.author) && eligible(candidate))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    for (const candidate of ranked) {
      pushCandidate(candidate, 'ranked')
      if (items.length >= target) break
    }
  }
  const dynasty = items.reduce((acc, item) => {
    acc[item.dynasty] = (acc[item.dynasty] ?? 0) + 1
    return acc
  }, {})
  const formCounts = items.reduce((acc, item) => {
    acc[item.form] = (acc[item.form] ?? 0) + 1
    return acc
  }, {})
  return {
    payload: { ok: true, dataVersion: opts.dataVersion, items },
    stats: {
      candidates: candidates.length,
      curatedMatched: curatedMatched.length,
      kept: items.length,
      tiers,
      dynasty,
      forms: formCounts,
      dropped: stats.dropped.bank ?? {},
    },
  }
}

/* ================================================================== *
 * 4. ci-bank.json —— 全量宋词精选库（诗库/飞花令用，不进「今日一诗」默认路径）
 * ================================================================== */

/**
 * 词牌专名保留字：宋词里「徵招」（五音之徵）与「於中好」是词牌专名，
 * 简化成「征/于」会改变词牌写法，因此词牌/标题中保留原字（正文仍全部简体化）。
 */
const PROPER_NOUN_TITLE_CHARS = new Set(['徵', '於'])

/** 单字安全简化（保留专名、避免 Ext-B 结果）。 */
function safeCharSimplified(ch) {
  if (PROPER_NOUN_TITLE_CHARS.has(ch)) return ch
  const simplified = simplifyChar(ch)
  return simplified !== ch && !hasAstralChars(simplified) ? simplified : ch
}

/** 源数据里的缺字占位符（□/■/�）——含此类字符的条目视为损坏数据，整首剔除。 */
const PLACEHOLDER_CHARS = new Set(['\u25a1', '\u25a0', '\ufffd'])

function hasPlaceholderChars(text) {
  for (const ch of chars(text)) if (PLACEHOLDER_CHARS.has(ch)) return true
  return false
}

/** 词标题用「首句」：跳过行首非汉字（标点/空格），取第一个分句的汉字串。 */
function ciTitleFirstClause(line) {
  const arr = chars(String(line ?? ''))
  let i = 0
  while (i < arr.length && !isCJK(arr[i])) i += 1
  let out = ''
  for (; i < arr.length; i += 1) {
    if (!isCJK(arr[i])) break
    out += arr[i]
  }
  return out
}

/** 一首词的首句「去标点前 6 字」key（用于去重）。 */
function ciDedupeFirst6(line) {
  return String(line ?? '').replace(/[，。！？；、：,.!?;:（）()「」『』《》〈〉…—·\s]/g, '').slice(0, 6)
}

/**
 * 生成全量宋词库：
 *  - 源：宋词 22 个 chunk（约 21,050 条）；
 *  - 去重 key = author + rhythmic + 首句去标点前 6 字（词牌先做别名归一，保证输出无「・」且无重复）；
 *  - t2s + 残留扫描；CJK Ext-B 整首剔除并计数；空行/纯标点行剔除；
 *  - id 按源顺序稳定编号 `ci-bank-00001`；title = 词牌·首句（≤40）。
 */
export function buildCiBank(scanned, dataVersion) {
  const raws = []
  for (const chunk of scanned.ci) {
    const list = tryReadJSON(path.join(scanned.dirs.ci, chunk.file))
    if (Array.isArray(list)) for (const raw of list) if (raw) raws.push(raw)
  }
  const rhythmicFreq = new Map()
  for (const raw of raws) {
    const rhythmic = String(raw.rhythmic ?? '').trim()
    if (rhythmic) rhythmicFreq.set(rhythmic, (rhythmicFreq.get(rhythmic) ?? 0) + 1)
  }
  const stats = {
    sourceTotal: raws.length,
    invalid: 0,
    dedupeDropped: 0,
    astralDropped: 0,
    purePunctLines: 0,
    placeholderDropped: 0,
    kept: 0,
    lines: 0,
    residual: 0,
    rhythmicBefore: 0,
    rhythmicAfter: 0,
    rhythmicSplit: 0,
  }
  const seen = new Set()
  const rhythmicBefore = new Set()
  const rhythmicAfter = new Set()
  const residualChars = new Set()
  const items = []
  for (const raw of raws) {
    const author = safeSimplified(String(raw.author ?? '')).text.trim()
    const rawRhythmic = String(raw.rhythmic ?? '').trim()
    if (!author || !rawRhythmic || !Array.isArray(raw.paragraphs)) {
      stats.invalid += 1
      continue
    }
    rhythmicBefore.add(rawRhythmic)
    const localStats = { counters: { ciRhythmicSplit: 0 } }
    const normalizedRhythmic = normalizeRhythmic(rawRhythmic, rhythmicFreq, localStats)
    stats.rhythmicSplit += localStats.counters.ciRhythmicSplit ?? 0
    const rhythmic = chars(normalizedRhythmic).map(safeCharSimplified).join('')
    if (chars(rhythmic).some((ch) => PROPER_NOUN_TITLE_CHARS.has(ch))) stats.properNounItems = (stats.properNounItems ?? 0) + 1
    rhythmicAfter.add(rhythmic)
    // 简体 + 空行/纯标点行剔除
    const lines = []
    for (const line of raw.paragraphs) {
      const { text } = safeSimplified(String(line ?? ''))
      const trimmed = text.trim()
      if (!trimmed) continue
      if (!ciDedupeFirst6(trimmed) && !/\p{Script=Han}/u.test(trimmed)) {
        stats.purePunctLines += 1
        continue
      }
      lines.push(trimmed)
    }
    if (lines.length === 0) {
      stats.invalid += 1
      continue
    }
    // 缺字占位符（□/■/�）整首剔除：正文残缺、无法作为可用数据
    if (hasPlaceholderChars(author + rhythmic + lines.join(''))) {
      stats.placeholderDropped += 1
      continue
    }
    // 去重（词牌已归一）
    const key = `${author}\u0000${rhythmic}\u0000${ciDedupeFirst6(lines[0])}`
    if (seen.has(key)) {
      stats.dedupeDropped += 1
      continue
    }
    seen.add(key)
    // CJK Ext-B+ 生僻字整首剔除（浏览器字形缺失）
    if (hasAstralChars(author + rhythmic + lines.join(''))) {
      stats.astralDropped += 1
      continue
    }
    // 残留扫描只覆盖正文（词牌/标题按专名保留 徵/於，见 PROPER_NOUN_TITLE_CHARS）
    for (const ch of findTraditionalResiduals(author + lines.join(''))) {
      if (!hasAstralChars(simplifyChar(ch))) residualChars.add(ch)
    }
    stats.lines += lines.length
    stats.kept += 1
    const firstClause = ciTitleFirstClause(lines[0])
    let title = firstClause ? `${rhythmic}·${firstClause}` : rhythmic
    if (charLength(title) > 40) title = chars(title).slice(0, 40).join('')
    items.push({
      id: `ci-bank-${String(items.length + 1).padStart(5, '0')}`,
      author,
      rhythmic,
      title,
      lines,
    })
  }
  stats.rhythmicBefore = rhythmicBefore.size
  stats.rhythmicAfter = rhythmicAfter.size
  stats.residual = residualChars.size
  return { payload: { ok: true, dataVersion, count: items.length, items }, stats }
}

/* ================================================================== *
 * 4. 写文件 / manifest / 报告
 * ================================================================== */

function writeAsset(outDir, name, payload) {
  const text = JSON.stringify(payload)
  const file = path.join(outDir, name)
  fs.writeFileSync(file, text)
  const bytes = Buffer.byteLength(text)
  return { name, bytes, sha256: sha256(text), file }
}

/**
 * 构建全部 assets/data 资产。
 * @param {{ offline?: boolean, outDir?: string, source?: string, dataSrcDir?: string, bankTarget?: number, log?: Function }} [opts]
 */
export async function buildAssetsData(opts = {}) {
  const log = opts.log ?? ((message) => console.log(message))
  const warn = (message) => console.warn(`[warn] ${message}`)
  const startedAt = Date.now()
  const offline = Boolean(opts.offline)
  const outDir = path.resolve(opts.outDir ?? ASSETS_DATA_DIR)
  const dataVersion = resolveDataVersion()

  log(`assets/data 构建${offline ? '（离线模式 --offline）' : ''}  dataVersion=${dataVersion}`)

  // ---- 源解析（完整语料 + curated 快照） ----
  log('[1/6] 解析本地源数据 ...')
  const source = await resolveSource({
    source: opts.source,
    offline,
    log,
  })
  const scanned = scanSource(source.dir)
  const curated = resolveCuratedFiles({ fullDir: source.dir, dataSrcDir: opts.dataSrcDir, offline })
  scanned.curated = curated.files
  log(
    `  curated 快照：${curated.complete ? '✓ 齐全' : `✗ 缺 ${curated.missing.length}`}（` +
      `${[...new Set(Object.values(curated.files).map((file) => file.from))].join(' + ') || '无'}）`,
  )
  const curatedMissing = ['shijing', 'chuci', 'qianjiashi', 'tangshisanbaishou'].filter((key) => !curated.files[key])
  if (curatedMissing.length > 0) throw new Error(`anthology 所需 curated 源缺失：${curatedMissing.join('、')}（请检查 data-src/）`)

  // ---- anthology ----
  log('[2/6] 生成 anthology.json（诗经/楚辞/千家诗/唐诗三百首古体乐府） ...')
  const anthology = buildAnthology(curated, dataVersion)
  log(
    `  条目 ${anthology.payload.items.length}：` +
      Object.entries(anthology.counters)
        .map(([key, count]) => `${ANTHOLOGY_CATEGORY_META[key].name} ${count}`)
        .join(' / '),
  )
  const RESIDUAL_ANTHOLOGY = new Set()
  for (const item of anthology.payload.items) {
    for (const ch of findTraditionalResiduals(item.title + item.author + item.lines.join(''))) {
      if (!hasAstralChars(simplifyChar(ch))) RESIDUAL_ANTHOLOGY.add(ch)
    }
  }
  if (RESIDUAL_ANTHOLOGY.size > 0) warn(`anthology 简体残留：${[...RESIDUAL_ANTHOLOGY].join('')}`)

  // ---- pingshui ----
  log('[3/6] 生成 pingshui.json（平水韵 106 韵部 + charIndex） ...')
  const { payload: pingshui, stats: pingshuiStats } = buildPingshui(opts.pingshuiPath ?? DEFAULT_PINGSHUI, dataVersion)
  log(
    `  韵部 ${pingshuiStats.categories}（平 ${pingshuiStats.toneCounts.ping} / 上 ${pingshuiStats.toneCounts.shang} / ` +
      `去 ${pingshuiStats.toneCounts.qu} / 入 ${pingshuiStats.toneCounts.ru}），共 ${pingshuiStats.totalChars} 字，charIndex ${pingshuiStats.charIndexKeys} 键`,
  )
  if (pingshuiStats.categories !== 106) warn(`平水韵韵部数 ${pingshuiStats.categories} ≠ 106`)

  // ---- poems bank ----
  log(`[4/6] 生成 poems-bank.json（目标 ${opts.bankTarget ?? BANK_TARGET.default} 首） ...`)
  const bank = buildPoemsBank(scanned, {
    target: opts.bankTarget ?? BANK_TARGET.default,
    dataVersion,
  })
  log(
    `  入选 ${bank.stats.kept}（唐 ${bank.stats.dynasty.tang ?? 0} / 宋 ${bank.stats.dynasty.song ?? 0}；` +
      `精选 ${bank.stats.tiers.curated} / 名家 ${bank.stats.tiers.famous} / rank ${bank.stats.tiers.ranked}）`,
  )

  // ---- ci bank ----
  log('[5/6] 生成 ci-bank.json（全量宋词） ...')
  const ciBank = buildCiBank(scanned, dataVersion)
  log(
    `  源 ${ciBank.stats.sourceTotal} → 入选 ${ciBank.stats.kept}（去重 -${ciBank.stats.dedupeDropped} / Ext-B -${ciBank.stats.astralDropped}），` +
      `共 ${ciBank.stats.lines} 句；词牌 ${ciBank.stats.rhythmicBefore} → 归一后 ${ciBank.stats.rhythmicAfter}（拆分 ${ciBank.stats.rhythmicSplit} 处）`,
  )
  if (ciBank.stats.residual > 0) warn(`ci-bank 正文简体残留 ${ciBank.stats.residual} 种`)
  if ((ciBank.stats.properNounItems ?? 0) > 0) {
    log(`  词牌专名保留：徵招/於中好 等 ${ciBank.stats.properNounItems} 首（词牌不改写，正文仍全简体）`)
  }

  // ---- 写盘 ----
  log('[6/6] 写入 assets/data/ ...')
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  written.push(writeAsset(outDir, 'anthology.json', anthology.payload))
  written.push(writeAsset(outDir, 'pingshui.json', pingshui))
  // 超预算时先降诗库数量（≥3000），保持质量
  let bankPayload = bank.payload
  let bankResult = writeAsset(outDir, 'poems-bank.json', bankPayload)
  while (bankResult.bytes > ASSET_BUDGETS['poems-bank.json'] && bankPayload.items.length > BANK_TARGET.min) {
    const keep = Math.max(BANK_TARGET.min, Math.floor(bankPayload.items.length * 0.9))
    if (keep >= bankPayload.items.length) break
    bankPayload = { ...bankPayload, items: bankPayload.items.slice(0, keep) }
    bankResult = writeAsset(outDir, 'poems-bank.json', bankPayload)
    warn(`诗库超出 8MB 预算，已裁减到 ${bankPayload.items.length} 首`)
  }
  written.push(bankResult)
  written.push(writeAsset(outDir, 'ci-bank.json', ciBank.payload))

  const files = {}
  for (const record of written) files[record.name] = { bytes: record.bytes, sha256: record.sha256 }
  const manifest = {
    dataVersion,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-assets-data.mjs',
    command: 'node scripts/build-assets-data.mjs --offline',
    source: { repo: SOURCE.repo, commit: SOURCE.commit, license: SOURCE.license },
    counts: {
      anthology: anthology.payload.items.length,
      anthologyCategories: Object.fromEntries(Object.entries(anthology.counters)),
      poemsBank: bankPayload.items.length,
      ciBank: ciBank.payload.count,
      ciBankLines: ciBank.stats.lines,
      pingshuiCategories: pingshuiStats.categories,
      pingshuiChars: pingshuiStats.totalChars,
      charIndexKeys: pingshuiStats.charIndexKeys,
    },
    files,
    stats: {
      bank: {
        candidates: bank.stats.candidates,
        curatedMatched: bank.stats.curatedMatched,
        tiers: bank.stats.tiers,
        dynasty: bank.stats.dynasty,
        forms: bank.stats.forms,
        dropped: bank.stats.dropped,
        maxPerAuthor: BANK_MAX_PER_AUTHOR,
      },
      ciBank: {
        sourceTotal: ciBank.stats.sourceTotal,
        kept: ciBank.stats.kept,
        dedupeDropped: ciBank.stats.dedupeDropped,
        astralDropped: ciBank.stats.astralDropped,
        placeholderDropped: ciBank.stats.placeholderDropped,
        invalid: ciBank.stats.invalid,
        purePunctLines: ciBank.stats.purePunctLines,
        lines: ciBank.stats.lines,
        rhythmicBefore: ciBank.stats.rhythmicBefore,
        rhythmicAfter: ciBank.stats.rhythmicAfter,
        rhythmicSplit: ciBank.stats.rhythmicSplit,
        properNounItems: ciBank.stats.properNounItems ?? 0,
        residual: ciBank.stats.residual,
      },
    },
  }
  const manifestRecord = writeAsset(outDir, 'manifest.json', manifest)

  // ---- 报告 ----
  const durationMs = Date.now() - startedAt
  console.log('')
  console.log(`构建完成：${outDir}  用时 ${(durationMs / 1000).toFixed(1)}s  dataVersion=${dataVersion}`)
  const rows = [
    ['anthology.json', anthology.payload.items.length, '首（诗经/楚辞/千家诗/唐古体乐府）'],
    ['poems-bank.json', bankPayload.items.length, '首（唐/宋精选诗库）'],
    ['ci-bank.json', ciBank.payload.count, '首（全量宋词）'],
    ['pingshui.json', pingshuiStats.categories, '韵部 + charIndex'],
    ['manifest.json', null, 'bytes/sha256 清单'],
  ]
  for (const record of [...written, manifestRecord]) {
    const budget = ASSET_BUDGETS[record.name]
    const suffix = budget ? `（预算 ${formatBytes(budget)}，占 ${((record.bytes / budget) * 100).toFixed(1)}%）` : ''
    console.log(`  ${record.name.padEnd(18)} ${formatBytes(record.bytes).padStart(10)}  ${suffix}`)
    if (budget && record.bytes > budget) warn(`${record.name} 超出体积预算：${record.bytes} B > ${budget} B`)
  }
  console.log(`  sha256：`)
  for (const record of written) console.log(`    ${record.name.padEnd(18)} ${record.sha256}`)
  const counts = manifest.counts
  console.log(
    `  条数：anthology=${counts.anthology}（${Object.entries(counts.anthologyCategories).map(([k, v]) => `${k}=${v}`).join(' ')}）` +
      `；bank=${counts.poemsBank}（唐 ${bank.stats.dynasty.tang ?? 0}/宋 ${bank.stats.dynasty.song ?? 0}）` +
      `；pingshui=${counts.pingshuiCategories} 韵部/${counts.pingshuiChars} 字/charIndex ${counts.charIndexKeys} 键` +
      `；ci-bank=${counts.ciBank} 首/${counts.ciBankLines} 句`,
  )
  if (RESIDUAL_ANTHOLOGY.size > 0) warn(`anthology 简体残留 ${RESIDUAL_ANTHOLOGY.size} 种`)
  void rows
  return { outDir, dataVersion, manifest, anthology, bank: bankPayload, ciBank: ciBank.payload, pingshui, manifestRecord }
}

/* ================================================================== *
 * 5. CLI
 * ================================================================== */

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`参数 ${arg} 缺少取值`)
      return v
    }
    if (arg === '--offline') opts.offline = true
    else if (arg === '--out') opts.outDir = value()
    else if (arg === '--source') opts.source = value()
    else if (arg === '--bank-target') opts.bankTarget = Number(value())
    else if (arg === '--pingshui') opts.pingshuiPath = value()
    else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return opts
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.help) {
      console.log(
        '用法：node scripts/build-assets-data.mjs [--offline] [--out <dir>] [--source <dir>] [--bank-target <n>] [--pingshui <json>]',
      )
      process.exit(0)
    }
    await buildAssetsData(opts)
  } catch (error) {
    console.error(`[build-assets-data] 失败：${error?.stack ?? error}`)
    process.exitCode = 1
  }
}
