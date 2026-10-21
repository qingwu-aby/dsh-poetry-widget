#!/usr/bin/env node
/**
 * build-data.mjs —— chinese-poetry 三源对齐 → 质量筛选 → 生成 data/*.json
 *
 * 输入（只读）：
 *   - 源诗数据 / strains 平仄 / rank 热度（见 scripts/fetch-data.mjs）
 *   - content/cards.json、content/ci-cards.json、content/yun-overrides.json（内容作者维护）
 * 输出（只写 data/）：
 *   - poems.json / ci.json / yun.json / knowledge.json / manifest.json
 *
 * 用法：
 *   node scripts/build-data.mjs                     # 最终构建（500 诗 / 300 词）
 *   node scripts/build-data.mjs --smoke             # 冒烟构建（约 60 诗 / 30 词，用于联调）
 *   node scripts/build-data.mjs --smoke --version 2026-10-21.1
 *   可选：--poems <n> --ci <n> --out <dir> --src <dir> --ref <dir> --no-fetch
 *         --version <dataVersion>（默认沿用已有 manifest 的版本；没有则用 <今天>.1）
 *
 * 数据格式与质量门见 docs/contract.md §2 / §4 / §5；本脚本把「诗体 / 起式 / 首句入韵 /
 * 韵脚位置 / 解析文案」全部预计算，客户端只渲染。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as OpenCC from 'opencc-js'
import { resolveSource, resolveCuratedFiles, CURATED_FILES, scanSource, PROJECT_ROOT, SOURCE } from './fetch-data.mjs'

/* ================================================================== *
 * 0. 常量
 * ================================================================== */

/** data/ 各文件体积预算（bytes），见 contract §4。 */
export const BUDGETS = {
  'poems.json': 620 * 1024,
  'ci.json': 220 * 1024,
  'yun.json': 80 * 1024,
  'knowledge.json': 90 * 1024,
}

/** 句子允许的标点（tones 与 lines 共用；`？` 在数据中等于「存疑标记」，整首剔除）。 */
export const PUNCTUATION = new Set(['，', '。', '！', '？', '；', '、'])
/** 平仄标注允许的字符。 */
export const TONE_CHARS = new Set(['平', '仄', '○'])
/** 源数据里「平仄存疑」的标记与中文问号是同一个字符，出现即整首丢弃。 */
const UNKNOWN_TONE = '？'

/** 单作者最多入选诗数（contract / PLAN §4.6）。 */
export const MAX_POEMS_PER_AUTHOR = 10

const CJK_RE = /\p{Script=Han}/u

/** 标题长度（code point）上限 / 作者名上限，用于过滤脏数据。 */
const MAX_TITLE_LEN = 30
const MAX_AUTHOR_LEN = 20

/** 源数据里的残句/佚名占位标题（「句」「无题」等），不是完整近体诗，整首剔除。 */
const PLACEHOLDER_TITLE_RE = /^(?:句|残句|失调名|无题)(?:[\s　].*)?$/

/** 默认平水韵表（构建期 QA oracle，只读、不随包；见 lead 提供路径）。 */
export const DEFAULT_PINGSHUI = path.resolve(
  PROJECT_ROOT,
  '..',
  '_ref',
  'pingshui',
  'pingshui_rhyme',
  'data',
  'organized_ping_ze_rhyme_dict.json',
)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.join(PROJECT_ROOT, 'content')
const DEFAULT_OUT = path.join(PROJECT_ROOT, 'data')

/** 平水韵校验补丁（content-author 交付的 QA 辅助数据：异体归一 + 失收字 + 邻韵组）。 */
export const DEFAULT_PINGSHUI_SUPPLEMENT = path.join(CONTENT_DIR, 'pingshui-supplement.json')

/* ================================================================== *
 * 1. 基础工具（导出给 tests/data.test.mjs 单测）
 * ================================================================== */

/** 按 code point 拆字符（避免代理对/罕见字被拆错）。 */
export function chars(text) {
  return Array.from(String(text ?? ''))
}

/** 是否汉字（含扩展 A / 兼容区 / 扩展 B 常用段）。 */
export function isCJK(ch) {
  return typeof ch === 'string' && ch.length > 0 && CJK_RE.test(ch)
}

/** 字符数（code point，而非 UTF-16 code unit）。 */
export function charLength(text) {
  return chars(text).length
}

let _converter = null
/** 惰性初始化 OpenCC 繁转简转换器（devDependency，仅构建期使用）。 */
export function getConverter() {
  if (!_converter) _converter = OpenCC.Converter({ from: 't', to: 'cn' })
  return _converter
}

/**
 * 扩展 B 及以上的生僻字（codepoint > 0xFFFF）在部分浏览器字体缺字形，会显示豆腐块。
 * 诗数据要求整首过滤（Lead 2026-10-21 修订）。
 */
export function hasAstralChars(text) {
  for (const ch of chars(text)) {
    if (ch.codePointAt(0) > 0xffff) return true
  }
  return false
}

/**
 * 常见异体字 → 简体补充表（opencc t2s 对《全唐诗》异体字覆盖不全）。
 * 只做 1:1 字形替换，不改动平仄对齐（长度不变）。
 * 另外会把 opencc-js 自带的「异体字→标准字」反向字典也叠加进来（见 getVariantSupplement）。
 */
const MANUAL_VARIANT_SUPPLEMENT = new Map(
  Object.entries({
    隣: '邻',
    鴈: '雁',
    峯: '峰',
    牀: '床',
    朞: '期',
    囘: '回',
    敎: '教',
    徧: '遍',
    况: '况',
    覩: '睹',
    覊: '羁',
    歎: '叹',
    嘆: '叹',
    卻: '却',
    旣: '既',
    敍: '叙',
    祕: '秘',
    竝: '并',
    竪: '竖',
    卽: '即',
    槩: '概',
    綑: '捆',
    舖: '铺',
    麪: '面',
    麫: '面',
    躭: '耽',
    麤: '粗',
    齩: '咬',
    嬭: '奶',
    妳: '你',
    囪: '囱',
    揑: '捏',
    敎: '教',
    旛: '幡',
    昇: '升',
    甯: '宁',
    祇: '只',
    祗: '只',
    囘: '回',
    彊: '强',
    硃: '朱',
    硏: '研',
    秊: '年',
    羮: '羹',
    秔: '粳',
    疎: '疏',
    薫: '熏',
    慚: '惭',
    圗: '图',
    亁: '干',
    賖: '赊',
    它: '它',
  }),
)

let _variantSupplement = null
/** 懒加载异体字补充表：手动表 + opencc 反向字典（variant → 标准字 → t2s）。 */
export function getVariantSupplement() {
  if (_variantSupplement) return _variantSupplement
  const supplement = new Map(MANUAL_VARIANT_SUPPLEMENT)
  try {
    const variantMap = loadVariantMap()
    for (const [variant, standard] of variantMap) {
      if (supplement.has(variant)) continue
      try {
        const simplified = getConverter()(standard)
        // 只有「标准字确实能被简化为另一个字」时才登记，避免 只→祇 这类反向异体造成简体残留
        if (charLength(simplified) === 1 && simplified !== standard && simplified !== variant) {
          supplement.set(variant, simplified)
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  _variantSupplement = supplement
  return supplement
}

let _charConverterCache = null
/** 单字繁转简（含异体补充表），返回单字符；无法转换时返回原字。 */
export function simplifyChar(ch) {
  if (!isCJK(ch)) return ch
  if (!_charConverterCache) _charConverterCache = new Map()
  if (_charConverterCache.has(ch)) return _charConverterCache.get(ch)
  let out = ch
  try {
    const converted = getConverter()(ch)
    if (charLength(converted) === 1) out = converted
  } catch {
    out = ch
  }
  if (out === ch) {
    const variant = getVariantSupplement().get(ch)
    if (variant && charLength(variant) === 1) out = variant
  }
  _charConverterCache.set(ch, out)
  return out
}

/**
 * 扫描文本里「仍可被简化」的残留字（用于构建后自检：简体正文字符应全部满足 simplifyChar(ch)===ch）。
 * @returns {string[]} 去重后的残留字符
 */
export function findTraditionalResiduals(text) {
  const out = new Set()
  for (const ch of chars(text)) {
    if (!isCJK(ch)) continue
    if (simplifyChar(ch) !== ch) out.add(ch)
  }
  return [...out]
}

/**
 * 繁转简，并保证转换前后「逐字符等长」（contract §2.2 / §5）。
 * 整行转换长度不一致时退化为逐字转换，再不一致则回退原文；
 * 最后再对「opencc 整行/逐字都未转换的异体字」套补充表（隣→邻、鴈→雁…），保证简体残留为 0。
 * @returns {{ text: string, fallback: boolean }}
 */
export function toSimplified(text) {
  const src = String(text ?? '')
  const conv = getConverter()
  let whole
  try {
    whole = conv(src)
  } catch {
    return { text: src, fallback: true }
  }
  let out = whole
  let fallback = false
  if (charLength(out) !== charLength(src)) {
    out = ''
    try {
      for (const ch of chars(src)) out += conv(ch)
    } catch {
      return { text: src, fallback: true }
    }
    if (charLength(out) !== charLength(src)) return { text: src, fallback: true }
    fallback = true
  }
  // 残留异体字补充转换（逐字 1:1，保持长度）
  const fixed = chars(out)
  let changed = false
  for (let i = 0; i < fixed.length; i += 1) {
    const ch = fixed[i]
    if (!isCJK(ch)) continue
    const simplified = simplifyChar(ch)
    if (simplified !== ch) {
      fixed[i] = simplified
      changed = true
    }
  }
  if (changed) {
    const joined = fixed.join('')
    if (charLength(joined) === charLength(src)) out = joined
  }
  return { text: out, fallback }
}

/**
 * 把一段「联」（如 "城闕輔三秦，風煙望五津。"）按标点切成句（逐句，含句末标点）。
 * 只接受「汉字 + 允许标点」组成的文本；出现其它字符（□、[、]、（）、「」…）返回 null。
 * @returns {{ original: string, content: string }[] | null}
 */
export function splitClauses(text) {
  const clauses = []
  let cur = ''
  for (const ch of chars(text)) {
    if (isCJK(ch)) {
      cur += ch
      continue
    }
    if (PUNCTUATION.has(ch)) {
      if (!cur) return null
      clauses.push({ original: cur + ch, content: cur })
      cur = ''
      continue
    }
    return null
  }
  if (cur) return null // 末尾汉字没有标点收束
  return clauses
}

/* ---------------------------- 体式与格律 ---------------------------- */

/**
 * 五言基本句式（四种）。七言 = 该句式前加两个「相反」的字，见 BASE7。
 * A 仄起仄收 / B 平起平收 / C 平起仄收 / D 仄起平收
 */
export const BASE5 = {
  A: '仄仄平平仄',
  B: '平平仄仄平',
  C: '平平平仄仄',
  D: '仄仄仄平平',
}
export const BASE7 = {
  A: '平平仄仄平平仄',
  B: '仄仄平平仄仄平',
  C: '仄仄平平平仄仄',
  D: '平平仄仄仄平平',
}

/**
 * 四种标准格式的句序（同一句序重复一遍即得律诗）。
 * 顺序：仄起首句不入韵 / 仄起首句入韵 / 平起首句不入韵 / 平起首句入韵。
 */
const FOUR_FORMAT_KEYS = [
  ['A', 'B', 'C', 'D'],
  ['D', 'B', 'C', 'D'],
  ['C', 'D', 'A', 'B'],
  ['B', 'D', 'A', 'B'],
]



/** 固定平仄的位置（0-based）：五言第 2/4/5 字，七言第 2/4/6/7 字。 */
const FIXED_POS = { 5: [1, 3, 4], 7: [1, 3, 5, 6] }

/** 按句数与每句字数判定诗体（contract §2.2 的 form 枚举）。 */
export function detectForm(clauseCount, width) {
  if (width === 5) {
    if (clauseCount === 4) return '五绝'
    if (clauseCount === 8) return '五律'
  }
  if (width === 7) {
    if (clauseCount === 4) return '七绝'
    if (clauseCount === 8) return '七律'
  }
  return null
}

/**
 * 由绝句四式（4 句）按「联内相对、联间相粘」推导律诗八句。
 * 注意：五言/七言的基本句式不同，第二字平仄分布不同，不能把绝句四式机械重复。
 * @param {string[]} keys 绝句句式 key 序列（A/B/C/D）
 * @param {Record<string,string>} base 该字数的四种基本句式
 */
function extendLushiKeys(keys, base) {
  const second = (key) => chars(base[key])[1]
  const last = (key) => chars(base[key]).at(-1)
  const out = [...keys]
  while (out.length < 8) {
    const prev = out[out.length - 1]
    // 出句（奇数句）：粘上一对句 → 第二字同声调类别、仄收
    const nextKey = Object.keys(base).find((key) => second(key) === second(prev) && last(key) === '仄')
    out.push(nextKey)
    // 对句（偶数句）：与出句相对 → 第二字相反、平收
    const opposite = second(nextKey) === '平' ? '仄' : '平'
    const pairKey = Object.keys(base).find((key) => second(key) === opposite && last(key) === '平')
    out.push(pairKey)
  }
  return out
}

/** 生成某个诗体对应的 4 种标准格式（含起点/入韵信息）。 */
function patternsFor(clauseCount, width) {
  const base = width === 5 ? BASE5 : BASE7
  const seqs = clauseCount === 4 ? FOUR_FORMAT_KEYS : FOUR_FORMAT_KEYS.map((keys) => extendLushiKeys(keys, base))
  return seqs.map((keys) => {
    const lines = keys.map((k) => base[k])
    const first = chars(lines[0])
    return {
      keys,
      lines,
      start: first[1] === '仄' ? '仄起' : '平起',
      firstRhyme: first[first.length - 1] === '平',
    }
  })
}

/**
 * 单句与标准句式的比对：返回硬错误，或「固定位置违例数」。
 *  - 一三五不论：非固定位置（五言 1/3、七言 1/3/5）不计违例；
 *  - 二四六分明：固定位置（五言 2/4/5、七言 2/4/6/7）不一致记 1 处；
 *  - 三仄尾记 1 处变格；三平调、孤平是硬错误（必须剔除）。
 */
function clauseViolations(actualTone, expectedTone) {
  const got = chars(actualTone)
  const expected = chars(expectedTone)
  const width = expected.length
  if (got.length !== width) return { hard: 'shape', violations: 0 }
  for (const ch of got) if (!TONE_CHARS.has(ch)) return { hard: 'shape', violations: 0 }
  const last3 = got.slice(-3)
  // 三平调：句末三字全平 → 硬性剔除（近体诗大忌）
  if (last3.every((c) => c === '平')) return { hard: 'sanPing', violations: 0 }
  // 孤平：B 句式（平收）除韵脚外只剩一个平声字 → 硬性剔除
  if (width === 5 && expected.join('') === BASE5.B && got[0] === '仄') return { hard: 'guPing', violations: 0 }
  if (width === 7 && expected.join('') === BASE7.B && got[2] === '仄') return { hard: 'guPing', violations: 0 }
  let violations = 0
  for (const pos of FIXED_POS[width]) {
    if (got[pos] !== '○' && got[pos] !== expected[pos]) violations += 1
  }
  // 三仄尾（仄收句末三字全仄）：不硬性剔除，记 1 处变格
  if (last3.every((c) => c === '仄')) violations += 1
  return { hard: null, violations }
}

/** 补足/通用候选允许的变格上限（2026-10-21 Lead 修订：≤2 处可留，三平调/孤平仍剔除）。 */
export const MAX_VARIANCES = 2
/**
 * 候选生成阶段允许的变格上限（精选源里的名篇存在折腰/拗体，先按宽松阈值建候选，
 * 再由精选匹配决定是否入选；补足路径仍按 MAX_VARIANCES=2 严格过滤）。
 */
export const CANDIDATE_MAX_VARIANCES = 8

/**
 * 由逐句平仄串（纯平仄○，无标点）判定诗体 / 起式 / 首句入韵 / 韵脚位置 / 变格数。
 *
 * 规则（2026-10-21 修订）：
 *  - 允许 ≤2 处「二四六」固定位置变格（记入 analysis 的「含 N 处变格/拗救」）；
 *  - 三平调、孤平仍硬性剔除；
 *  - 多个格式同为最小违例数且结论（起式/入韵）不同 → 判为 ambiguous 丢弃。
 * @param {string[]} toneLines 逐句平仄串
 * @param {{ maxVariances?: number }} [options]
 * @returns {{ ok: true, form: string, start: string, firstRhyme: boolean, meter: string, rhymeIdx: number[], violations: number } | { ok: false, reason: string }}
 */
export function analyzeMeter(toneLines, options = {}) {
  const maxVariances = options.maxVariances ?? MAX_VARIANCES
  if (!Array.isArray(toneLines) || toneLines.length === 0) return { ok: false, reason: 'shape' }
  const widths = new Set(toneLines.map((line) => chars(line).length))
  if (widths.size !== 1) return { ok: false, reason: 'shape' }
  const width = [...widths][0]
  const form = detectForm(toneLines.length, width)
  if (!form) return { ok: false, reason: 'shape' }
  // 首句的两个「硬」信息：第 2 字定起式、末字定首句是否入韵（○=多音，无法判定时留空）
  const firstLineTone = chars(toneLines[0])
  const startThird = firstLineTone[1]
  const actualStart = startThird === '平' ? '平起' : startThird === '仄' ? '仄起' : null
  const lastTone = firstLineTone[firstLineTone.length - 1]
  const actualFirstRhyme =
    options.firstLineFinal === '平' || options.firstLineFinal === '仄'
      ? options.firstLineFinal === '平'
      : lastTone === '平'
        ? true
        : lastTone === '仄'
          ? false
          : null
  const allPatterns = patternsFor(toneLines.length, width)
  // 首句信息可判定时，先硬性约束格式，避免「违例最少但起式反了」的误判
  const constrained = allPatterns.filter(
    (p) => (actualStart === null || p.start === actualStart) && (actualFirstRhyme === null || p.firstRhyme === actualFirstRhyme),
  )
  const feasible = []
  for (const pattern of constrained.length > 0 ? constrained : allPatterns) {
    let hard = null
    let violations = 0
    for (let i = 0; i < toneLines.length && !hard; i += 1) {
      const result = clauseViolations(toneLines[i], pattern.lines[i])
      if (result.hard) hard = result.hard
      else violations += result.violations
    }
    if (!hard) feasible.push({ pattern, violations })
  }
  if (feasible.length === 0) return { ok: false, reason: 'nonstandard' }
  feasible.sort((a, b) => a.violations - b.violations)
  const minViolations = feasible[0].violations
  if (minViolations > maxVariances) return { ok: false, reason: 'nonstandard' }
  const best = feasible.filter((c) => c.violations === minViolations)
  const signatures = new Set(best.map((b) => `${b.pattern.start}|${b.pattern.firstRhyme}`))
  if (signatures.size > 1) return { ok: false, reason: 'ambiguous' }
  const match = best[0]
  const rhymeIdx = []
  match.pattern.lines.forEach((line, i) => {
    if (chars(line).at(-1) === '平') rhymeIdx.push(i)
  })
  return {
    ok: true,
    form,
    start: match.pattern.start,
    firstRhyme: match.pattern.firstRhyme,
    meter: `${match.pattern.start}首句${match.pattern.firstRhyme ? '入韵' : '不入韵'}`,
    rhymeIdx,
    violations: minViolations,
  }
}

/**
 * 校验用：按存储的 (form, start, firstRhyme) 找到唯一标准格式并重算违例数。
 * @returns {{ ok: true, violations: number, rhymeIdx: number[] } | { ok: false, reason: string }}
 */
export function evaluateStoredMeter(toneLines, form, start, firstRhyme) {
  if (!Array.isArray(toneLines) || toneLines.length === 0) return { ok: false, reason: 'shape' }
  const widths = new Set(toneLines.map((line) => chars(line).length))
  if (widths.size !== 1) return { ok: false, reason: 'shape' }
  const width = [...widths][0]
  if (detectForm(toneLines.length, width) !== form) return { ok: false, reason: 'form' }
  const pattern = patternsFor(toneLines.length, width).find((p) => p.start === start && p.firstRhyme === firstRhyme)
  if (!pattern) return { ok: false, reason: 'pattern' }
  let violations = 0
  for (let i = 0; i < toneLines.length; i += 1) {
    const result = clauseViolations(toneLines[i], pattern.lines[i])
    if (result.hard) return { ok: false, reason: result.hard }
    violations += result.violations
  }
  const rhymeIdx = []
  pattern.lines.forEach((line, i) => {
    if (chars(line).at(-1) === '平') rhymeIdx.push(i)
  })
  return { ok: true, violations, rhymeIdx }
}

/** 用平水韵表消解首句末字的 ○（多音）：只用于判定「首句是否入韵」。 */
export function resolveFirstLineFinal(toneLine, originalLine, rhymeTable) {
  const last = chars(toneLine).at(-1)
  if (last === '平' || last === '仄') return last
  if (!rhymeTable) return null
  const ch = lastCJKChar(originalLine)
  const normalized = rhymeTable.normalize ? rhymeTable.normalize(ch) : rhymeTable.t2s(ch)
  const isPing = rhymeTable.ping.has(ch) || rhymeTable.ping.has(normalized)
  const isZe = rhymeTable.ze.has(ch) || rhymeTable.ze.has(normalized)
  if (isPing && !isZe) return '平'
  if (!isPing && isZe) return '仄'
  return null
}

/**
 * 生成解析文案（简体，预生成；客户端直接展示）。
 * @param {number} [variances] 变格/拗救处数（0 时使用标准文案）
 */
export function analysisFor(form, start, firstRhyme, variances = 0) {
  const head = `${form}，${start}首句${firstRhyme ? '入韵' : '不入韵'}`
  const tail = form.endsWith('律') ? '；颔联、颈联对仗。' : '。'
  const middle = variances > 0 ? `（含 ${variances} 处变格/拗救）` : '。二四六分明，粘对成立'
  return `${head}${middle}${tail}`
}

/* ------------------------------ 热度 ------------------------------ */

/** 各搜索引擎热度权重（对数归一化前的原始加权值）。 */
const RANK_WEIGHTS = { baidu: 1.2, bing: 1.0, google: 0.8, bing_en: 0.5, so360: 0.4 }

/**
 * 热度原始加权值：把各引擎的搜索条数加权求和。
 * 同一输入 → 同一分值，保证排序确定；客户端只用于展示/排序。
 */
export function scoreOf(rank) {
  if (!rank || typeof rank !== 'object') return 0
  let score = 0
  for (const [key, weight] of Object.entries(RANK_WEIGHTS)) {
    const value = Number(rank[key])
    if (Number.isFinite(value) && value > 0) score += weight * Math.min(value, 1e9)
  }
  return Math.round(score * 100) / 100
}

/* ------------------------------ 标题/ID ------------------------------ */

/** 取第一句（到第一个标点为止）的汉字内容，用于词标题/名句。 */
export function firstClauseContent(text) {
  let out = ''
  for (const ch of chars(text)) {
    if (isCJK(ch)) out += ch
    else break
  }
  return out
}

/** 构造稳定 id：`<dynasty>-<源序号补 6 位>`（源序号 = chunk 起始 + 序号）。 */
export function makeId(dynasty, ordinal) {
  return `${dynasty}-${String(ordinal).padStart(6, '0')}`
}

/** 词标题：词牌 + "·" + 首句截断，≤40 字符（contract §2.3）。 */
export function makeCiTitle(rhythmic, paragraphs) {
  const head = firstClauseContent(paragraphs[0] ?? '')
  let title = head ? `${rhythmic}·${head}` : rhythmic
  const arr = chars(title)
  if (arr.length > 40) title = arr.slice(0, 40).join('')
  return title
}

/* ================================================================== *
 * 2. 读数工具
 * ================================================================== */

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

/** 生成计数器：累加 + 取快照。 */
function createStats() {
  const dropped = Object.create(null)
  return {
    counters: {
      poemCandidates: 0,
      poemsKept: 0,
      ciCandidates: 0,
      ciKept: 0,
      simplifiedFallbacks: 0,
      rankFallbacks: 0,
      rhymeChecked: 0,
      rhymePassed: 0,
      rhymeDropped: 0,
      rhymeFirstBorrowOk: 0,
      ciRankExact: 0,
      ciRankWindow: 0,
      ciRankPositional: 0,
      chunksSkipped: 0,
      curatedPoemRefs: 0,
      curatedPoemMatched: 0,
      poemFilled: 0,
      simplifiedResidual: 0,
      curatedCiRefs: 0,
      curatedCiMatched: 0,
      curatedCiSource: 'none',
      ciFilled: 0,
      ciCorpusMatched: 0,
      ciCorpusReplaced: 0,
      ciCorpusFallback: 0,
      ciRhythmicSplit: 0,
      ciAuthorFixed: 0,
      ciAppended: 0,
      ciCardFill: 0,
      tangChunks: 0,
      songChunks: 0,
      ciChunks: 0,
    },
    dropped,
    drop(bucket, reason) {
      dropped[bucket] ??= Object.create(null)
      dropped[bucket][reason] = (dropped[bucket][reason] ?? 0) + 1
    },
  }
}

/* ---------------------------- 平水韵校验门 ---------------------------- */

/**
 * 从 opencc-js 自带的「异体字→标准字」字典里加载罕见的繁体异体归一表
 * （opencc-js 的 t2s 链不覆盖 隣→鄰、乗→乘 这类日式/异体写法）。
 * 只读取 devDependency 的数据文件；缺失时静默跳过（退化为仅 t2s 归一）。
 * @returns {Map<string, string>}
 */
function loadVariantMap() {
  const map = new Map()
  const base = path.join(PROJECT_ROOT, 'node_modules', 'opencc-js', 'dist', 'esm-lib', 'dict')
  const files = ['JPShinjitaiCharactersRev.js', 'TWVariantsRev.js', 'HKVariantsRev.js']
  for (const name of files) {
    try {
      const text = fs.readFileSync(path.join(base, name), 'utf8')
      const body = text.replace(/^\s*export default "/, '').replace(/";?\s*$/, '')
      for (const pair of body.split('|')) {
        const parts = pair.split(' ')
        if (parts.length !== 2) continue
        const [standard, variant] = parts
        if (charLength(standard) !== 1 || charLength(variant) !== 1) continue
        if (standard !== variant) map.set(variant, standard)
      }
    } catch {
      // 数据文件不可用时忽略（t2s 归一仍生效）
    }
  }
  return map
}

/**
 * 载入平水韵表（构建期 QA oracle，只读；不进入 data/、不随包发布），并叠加
 * content/pingshui-supplement.json 的归一化/失收字/邻韵组补丁：
 *  - 表内字与韵脚字都做 OpenCC t2s 归一（原字与简体字都登记，避免 峯/爲 等异体查不到）；
 *  - pingOverrides 补 17 个表内失收的常用韵脚字；
 *  - neighborGroups / yuanDualNeighbor 用于「首句借邻韵」判定。
 * @param {string} [file]
 * @param {string} [supplementFile]
 * @returns {{ ping: Map<string, Set<string>>, ze: Set<string>, neighbors: Map<string, Set<string>>, t2s: (ch: string) => string } | null}
 */
export function loadRhymeTable(file = DEFAULT_PINGSHUI, supplementFile = DEFAULT_PINGSHUI_SUPPLEMENT) {
  const raw = tryReadJSON(file)
  if (!raw || !raw.ping) return null
  const converter = getConverter()
  const t2s = (ch) => {
    try {
      const out = converter(String(ch))
      return charLength(out) === 1 ? out : ch
    } catch {
      return ch
    }
  }
  const ping = new Map()
  const ze = new Set()
  const register = (map, ch, name) => {
    if (!map.has(ch)) map.set(ch, new Set())
    map.get(ch).add(name)
  }
  for (const half of Object.keys(raw.ping)) {
    for (const [name, value] of Object.entries(raw.ping[half])) {
      const text = Array.isArray(value) ? value.join('') : String(value ?? '')
      for (const ch of chars(text)) {
        register(ping, ch, name)
        const simplified = t2s(ch)
        if (simplified !== ch) register(ping, simplified, name)
      }
    }
  }
  for (const half of Object.keys(raw.ze ?? {})) {
    for (const value of Object.values(raw.ze[half])) {
      const text = Array.isArray(value) ? value.join('') : String(value ?? '')
      for (const ch of chars(text)) {
        ze.add(ch)
        const simplified = t2s(ch)
        if (simplified !== ch) ze.add(simplified)
      }
    }
  }
  const variantMap = loadVariantMap()
  const normalize = (ch) => {
    let current = String(ch ?? '')
    for (let i = 0; i < 2; i += 1) {
      const next = variantMap.get(current)
      if (!next) break
      current = next
    }
    return t2s(current)
  }
  const supplement = supplementFile ? tryReadJSON(supplementFile) : null
  const overrides = supplement?.pingOverrides ?? {}
  for (const [ch, groups] of Object.entries(overrides)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      register(ping, ch, group)
      const simplified = t2s(ch)
      if (simplified !== ch) register(ping, simplified, group)
    }
  }
  // 邻韵关系（对称）：neighborGroups + 十三元双组补充
  const neighbors = new Map()
  const addEdge = (a, b) => {
    if (!a || !b || a === b) return
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    if (!neighbors.has(b)) neighbors.set(b, new Set())
    neighbors.get(a).add(b)
    neighbors.get(b).add(a)
  }
  for (const group of Array.isArray(supplement?.neighborGroups) ? supplement.neighborGroups : []) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) addEdge(group[i], group[j])
    }
  }
  const yuanDual = Array.isArray(supplement?.yuanDualNeighbor) ? supplement.yuanDualNeighbor : []
  if (yuanDual.length > 0) {
    const yuan = '上平聲十三元'
    for (const other of yuanDual) addEdge(yuan, other)
  }
  return { ping, ze, neighbors, t2s, variantMap, normalize }
}

/** 取一行最后一个汉字（行尾是标点）。 */
function lastCJKChar(text) {
  const arr = chars(text).filter(isCJK)
  return arr.length > 0 ? arr[arr.length - 1] : ''
}

/** 查一个韵脚字的平声韵部集合（先原字，再 t2s 归一）。 */
function rhymeCategories(table, ch) {
  return table.ping.get(ch) ?? (table.normalize ? table.ping.get(table.normalize(ch)) : table.ping.get(table.t2s(ch))) ?? null
}

/** 是否仄声字（仅用于把「查不到」细分为 rhymeNoPing / rhymeUnknown）。 */
function isZeChar(table, ch) {
  const normalized = table.normalize ? table.normalize(ch) : table.t2s(ch)
  return table.ze.has(ch) || table.ze.has(normalized)
}

/** 集合是否有交集。 */
function intersects(a, b) {
  for (const item of a) if (b.has(item)) return true
  return false
}

/** 集合交集。 */
function intersection(sets) {
  if (sets.length === 0) return new Set()
  let result = new Set(sets[0])
  for (const set of sets.slice(1)) result = new Set([...result].filter((item) => set.has(item)))
  return result
}

/**
 * 押韵校验门（含繁体异体归一、失收字补丁、邻韵借韵）：
 *  1) 韵脚 = rhymeIdx 各行 linesOriginal 最后一个汉字；
 *  2) 归一化查平声韵部；查不到 / 只落仄声 → rhymeUnknown / rhymeNoPing；
 *  3) 非首句韵脚：所有韵部集合交集非空，否则 rhymeMixed；
 *  4) 首句入韵：允许同韵或邻韵组内借韵，越界 → rhymeFirstBorrow；
 *  5) 多音字一律按「韵部集合交集」处理，不硬判单一韵部。
 * @returns {{ ok: true, firstBorrow?: boolean } | { ok: false, reason: string, detail: string }}
 */
export function checkRhyme(linesOriginal, rhymeIdx, table) {
  if (!table || !Array.isArray(rhymeIdx) || rhymeIdx.length === 0) return { ok: true }
  const finals = rhymeIdx.map((idx) => lastCJKChar(linesOriginal[idx] ?? ''))
  const categories = []
  for (const ch of finals) {
    const cats = rhymeCategories(table, ch)
    if (!cats) {
      const reason = isZeChar(table, ch) ? 'rhymeNoPing' : 'rhymeUnknown'
      return { ok: false, reason, detail: ch }
    }
    categories.push(cats)
  }
  // 首句入韵：首句韵脚允许借邻韵，先单独拿出来
  const firstRhymeIncluded = rhymeIdx[0] === 0
  const nonFirst = firstRhymeIncluded ? categories.slice(1) : categories
  if (nonFirst.length >= 2) {
    const inter = intersection(nonFirst)
    if (inter.size === 0) return { ok: false, reason: 'rhymeMixed', detail: finals.join('') }
    if (firstRhymeIncluded) {
      const firstCats = categories[0]
      const sameRhyme = intersects(firstCats, inter)
      if (!sameRhyme) {
        let neighbor = false
        for (const firstCat of firstCats) {
          const neighbors = table.neighbors.get(firstCat)
          if (neighbors && intersects(neighbors, inter)) {
            neighbor = true
            break
          }
        }
        if (!neighbor) return { ok: false, reason: 'rhymeFirstBorrow', detail: finals.join('') }
        return { ok: true, firstBorrow: true }
      }
    }
  }
  return { ok: true }
}

/* ================================================================== *
 * 3. 诗：三源对齐 → 质量门 → 候选
 * ================================================================== */

/**
 * 从一首源诗 + strains + rank 生成候选记录；任何质量门不通过返回 null。
 * @returns {object|null}
 */
export function buildPoemCandidate(raw, strainEntry, rankEntry, dynasty, ordinal, stats, options = {}) {
  stats.counters.poemCandidates += 1
  const fail = (reason) => {
    stats.drop('poem', reason)
    return null
  }
  // Lead 2026-10-21 修订：含 CJK Ext-B+（codepoint > 0xFFFF）的诗整首剔除，避免浏览器豆腐块
  if (
    hasAstralChars(raw.title ?? '') ||
    hasAstralChars(raw.author ?? '') ||
    (Array.isArray(raw.paragraphs) && raw.paragraphs.some((line) => hasAstralChars(line)))
  ) {
    return fail('astralChars')
  }
  if (!strainEntry) return fail('noStrain')
  if (!rankEntry) return fail('noRank')
  const paragraphs = Array.isArray(raw.paragraphs) ? raw.paragraphs : null
  const strains = Array.isArray(strainEntry.strains) ? strainEntry.strains : null
  if (!paragraphs || !strains) return fail('shape')
  // 近体诗：绝句 = 2 联（4 句），律诗 = 4 联（8 句）
  if (paragraphs.length !== 2 && paragraphs.length !== 4) return fail('shape')
  if (strains.length !== paragraphs.length) return fail('rowMismatch')

  const lines = []
  const linesOriginal = []
  const tones = []
  for (let i = 0; i < paragraphs.length; i += 1) {
    const pchars = chars(paragraphs[i])
    const tchars = chars(strains[i])
    if (pchars.length !== tchars.length) return fail('mismatch')
    let curText = ''
    let curTone = ''
    for (let j = 0; j < pchars.length; j += 1) {
      const pc = pchars[j]
      const tc = tchars[j]
      if (isCJK(pc)) {
        if (!TONE_CHARS.has(tc) && tc !== UNKNOWN_TONE) return fail('mismatch')
        if (tc === UNKNOWN_TONE) return fail('question')
        curText += pc
        curTone += tc
        continue
      }
      if (PUNCTUATION.has(pc)) {
        if (tc !== pc) return fail('mismatch')
        if (pc === UNKNOWN_TONE) return fail('question')
        if (!curText) return fail('shape')
        linesOriginal.push(curText + pc)
        tones.push(curTone + pc)
        curText = ''
        curTone = ''
        continue
      }
      return fail('weirdChar')
    }
    if (curText) return fail('shape')
  }

  const toneLines = tones.map((tone) => chars(tone).filter((ch) => TONE_CHARS.has(ch)).join(''))
  const firstLineFinal = resolveFirstLineFinal(tones[0], linesOriginal[0], options.rhymeTable)
  const meter = analyzeMeter(toneLines, {
    maxVariances: options.maxVariances ?? MAX_VARIANCES,
    firstLineFinal,
  })
  if (!meter.ok) return fail(meter.reason)

  // 韵脚字校正：strains 给「仄」但该字在平水韵里有平声读法（押韵门已确认）→ 改为「○（多音）」
  // 避免出现「rhymeIdx 标为韵脚、tones 却标仄声」的自相矛盾展示。
  let violations = meter.violations
  if (options.rhymeTable) {
    const toneArr = tones.map((tone) => chars(tone))
    for (const idx of meter.rhymeIdx) {
      const lineChars = toneArr[idx]
      const toneCharsFiltered = lineChars.filter((ch) => TONE_CHARS.has(ch))
      const lastToneIndex = lineChars.lastIndexOf(toneCharsFiltered[toneCharsFiltered.length - 1])
      if (lastToneIndex >= 0 && lineChars[lastToneIndex] === '仄') lineChars[lastToneIndex] = '○'
    }
    tones.length = 0
    for (const lineChars of toneArr) tones.push(lineChars.join(''))
    // 校正后重算违例数（○ 与平/仄均相容，违例可能变少），保证 analysis 与 tones 自洽
    const correctedLines = tones.map((tone) => chars(tone).filter((ch) => TONE_CHARS.has(ch)).join(''))
    const corrected = evaluateStoredMeter(correctedLines, meter.form, meter.start, meter.firstRhyme)
    if (corrected.ok) violations = corrected.violations
  }
  // 非韵脚句必须是仄收（或○）；出现平收说明是拗体/古体混入，与「平声韵」标注冲突，整首剔除
  for (let i = 0; i < tones.length; i += 1) {
    if (meter.rhymeIdx.includes(i)) continue
    const finalTone = chars(tones[i]).filter((ch) => TONE_CHARS.has(ch)).at(-1)
    if (finalTone === '平') return fail('rhymeMisaligned')
  }
  const meterViolations = violations


  // 繁转简：逐行逐字等长（contract §2.2 / §5）
  for (const original of linesOriginal) {
    const simplified = toSimplified(original)
    if (simplified.fallback) stats.counters.simplifiedFallbacks += 1
    lines.push(simplified.text)
  }

  const title = toSimplified(String(raw.title ?? '').trim())
  const author = toSimplified(String(raw.author ?? '').trim())
  if (!title.text || charLength(title.text) > MAX_TITLE_LEN) return fail('badTitle')
  if (!author.text || charLength(author.text) > MAX_AUTHOR_LEN) return fail('badAuthor')
  // 繁简转换也可能产生 CJK Ext-B+ 字（如 醲→𬪩），转换后再检查一次并整首剔除
  if (hasAstralChars(title.text) || hasAstralChars(author.text) || lines.some((line) => hasAstralChars(line))) {
    return fail('astralChars')
  }

  // 押韵校验门：韵脚必须同属平水韵平声韵部（首句允许借韵）——数据可信度的关键一环
  if (options.rhymeTable) {
    stats.counters.rhymeChecked += 1
    const rhyme = checkRhyme(linesOriginal, meter.rhymeIdx, options.rhymeTable)
    if (!rhyme.ok) {
      stats.counters.rhymeDropped += 1
      return fail(rhyme.reason)
    }
    stats.counters.rhymePassed += 1
    if (rhyme.firstBorrow) stats.counters.rhymeFirstBorrowOk += 1
  }

  return {
    id: makeId(dynasty, ordinal),
    title: title.text,
    titleOriginal: String(raw.title ?? '').trim(),
    author: author.text,
    authorOriginal: String(raw.author ?? '').trim(),
    dynasty,
    lines,
    linesOriginal,
    tones,
    form: meter.form,
    start: meter.start,
    firstRhyme: meter.firstRhyme,
    rhymeIdx: meter.rhymeIdx,
    meter: meter.meter,
    analysis: analysisFor(meter.form, meter.start, meter.firstRhyme, meterViolations),
    score: scoreOf(rankEntry),
    source: 'strains',
    // 内部标记（写盘前剔除）：
    //  - 残句/佚名占位标题只允许在「精选匹配」路径使用，补足路径排除；
    //  - _variances 供补足路径按 ≤MAX_VARIANCES 过滤。
    _placeholderTitle: PLACEHOLDER_TITLE_RE.test(title.text),
    _variances: meterViolations,
  }
}

/* ---------------------------- 精选（修订版选诗策略） ---------------------------- */

/** 目标数量（2026-10-21 Lead 修订：诗 320–450 首、词 150–250 首；宁缺毋滥）。 */
export const POEM_TARGET = { min: 320, max: 450 }
// 词的主源是《宋词三百首》全量（280 首）+ 3 首缺牌名篇补充
export const CI_TARGET = { min: 150, max: 300 }

/** 名家白名单（匹配不足时的补足池）：唐诗 + 宋诗。 */
export const FAMOUS_POETS = new Set([
  // 唐
  '李白', '杜甫', '王维', '白居易', '李商隐', '杜牧', '刘禹锡', '王昌龄', '孟浩然', '韦应物',
  '韩愈', '柳宗元', '李贺', '岑参', '高适', '王勃', '张九龄', '元稹', '温庭筠', '王之涣',
  '贺知章', '崔颢', '王翰', '王湾', '常建', '祖咏', '刘长卿', '张籍', '王建', '李益',
  '司空曙', '钱起', '许浑', '杜荀鹤', '宋之问', '沈佺期', '陈子昂', '张若虚', '王绩', '骆宾王',
  // 宋
  '苏轼', '王安石', '陆游', '杨万里', '范成大', '朱熹', '欧阳修', '梅尧臣', '黄庭坚', '秦观',
])

/** 名家白名单（词）。 */
export const FAMOUS_CI_POETS = new Set([
  '苏轼', '辛弃疾', '李清照', '柳永', '晏殊', '欧阳修', '秦观', '周邦彦', '姜夔', '贺铸',
  '晏几道', '范仲淹', '岳飞', '陆游', '张孝祥', '陈与义', '朱淑真', '吴文英', '王沂孙', '蒋捷',
  '张炎', '宋祁', '潘阆',
])

/** 泛题前缀（补足阶段只在「名家白名单 + rank 顺序」下使用，避免「即事十二首 其七」这类占榜）。 */
export const GENERIC_TITLE_PREFIXES = [
  '诗一首', '诗二首', '无题', '有感', '即事', '感事', '杂诗', '绝句', '春日', '秋日',
  '九日', '夜坐', '自遣', '偶成', '闲居', '村居', '漫兴', '遣兴', '句',
]

/** 去标点后取前 n 个汉字（用于精选匹配 key；n 默认 5）。 */
export function firstCharsContent(text, n = 5) {
  let out = ''
  let count = 0
  for (const ch of chars(text)) {
    if (!isCJK(ch)) continue
    out += ch
    count += 1
    if (count >= n) break
  }
  return out
}

/** 清洗精选源的作者名：去掉「（唐）/（宋）」等前缀。 */
export function cleanCuratedAuthor(author) {
  return String(author ?? '')
    .replace(/^[（(][^）)]*[）)]\s*/g, '')
    .trim()
}

/** 是否泛题（补足阶段用于降权/后置）。 */
export function isGenericTitle(title) {
  const text = String(title ?? '').replace(/[\s　]+/g, '')
  return GENERIC_TITLE_PREFIXES.some((prefix) => text.startsWith(prefix))
}

const CURATED_FORM_BY_TAG = {
  五言绝句: '五绝',
  七言绝句: '七绝',
  五言律诗: '五律',
  七言律诗: '七律',
  // 千家诗 / 部分源文件用繁体类型名
  五言絕句: '五绝',
  七言絕句: '七绝',
  五言律詩: '五律',
  七言律詩: '七律',
  五言律: '五律',
  七言律: '七律',
}

/**
 * 读取「精选源」：唐诗三百首（近体 4 类）+ 千家诗（近体 4 类）。
 * @returns {{ book: string, author: string, title: string, paragraphs: string[], form: string }[]}
 */
export function loadCuratedPoemRefs(source, warn = () => {}) {
  const refs = []
  // 1) 唐诗三百首（全唐诗/唐诗三百首.json，按 tags 过滤近体）
  const tssbsPath = source.curated?.tangshisanbaishou?.path ?? path.join(source.dirs.tang, '唐诗三百首.json')
  const tssbs = tryReadJSON(tssbsPath)
  if (Array.isArray(tssbs)) {
    for (const entry of tssbs) {
      const tags = Array.isArray(entry?.tags) ? entry.tags : []
      let form = null
      for (const tag of tags) if (CURATED_FORM_BY_TAG[tag]) form = CURATED_FORM_BY_TAG[tag]
      if (!form) continue
      if (!Array.isArray(entry.paragraphs) || entry.paragraphs.length === 0) continue
      refs.push({ book: 'tangshisanbaishou', author: entry.author, title: entry.title, paragraphs: entry.paragraphs, form })
    }
  } else {
    warn('未找到 全唐诗/唐诗三百首.json，跳过唐诗三百首精选匹配。')
  }
  // 2) 千家诗（蒙学/qianjiashi.json，4 类分组）
  const qjsPath = source.curated?.qianjiashi?.path ?? source.mengxueFiles?.qianjiashi
  const qjs = tryReadJSON(qjsPath)
  if (qjs && Array.isArray(qjs.content)) {
    for (const group of qjs.content) {
      const form = CURATED_FORM_BY_TAG[String(group?.type ?? '').trim()]
      if (!form) continue
      for (const entry of group.content ?? []) {
        if (!Array.isArray(entry?.paragraphs) || entry.paragraphs.length === 0) continue
        refs.push({ book: 'qianjiashi', author: entry.author, title: entry.chapter, paragraphs: entry.paragraphs, form })
      }
    }
  } else {
    warn('未找到 蒙学/qianjiashi.json，跳过千家诗精选匹配。')
  }
  return refs
}

/**
 * 选集 QA 给出的剔除清单（author+title，见 content/anthology-qa.md §1）：
 * 错编/异文重复条，直接跳过，避免重复篇目与错误归属进入精选。
 */
export const CURATED_POEM_BLACKLIST = new Set([
  '王建\u0000故行宮',
  '杜荀鶴\u0000春宮怨',
  '周朴\u0000春宮怨',
  '孫革\u0000訪羊尊師',
  '朱斌\u0000登樓',
  '釋明辯\u0000頌古三十二首 其二三',
  '張佖\u0000寄人二首 其一',
  '蔡襄\u0000度南澗',
])

/** 选集 QA 给出的作者修正表（author+title → 正确作者，见 anthology-qa.md §1）。 */
export const CURATED_POEM_AUTHOR_FIX = new Map([['黄拱\u0000還鄉偶書 其二', '賀知章']])

/** 把「联列表」正文归一成纯汉字串（去标点 + t2s），用于全集精确匹配。 */
export function normalizePoemText(paragraphs) {
  const raw = (Array.isArray(paragraphs) ? paragraphs : []).join('')
  const simplified = toSimplified(raw).text
  return chars(simplified).filter(isCJK).join('')
}

/** 按选集条目解析出：是否命中、命中的语料候选。 */
function pickCuratedCandidate(list, ref, resolvedAuthor) {
  const sameForm = list.filter((c) => c.form === ref.form)
  const pool = sameForm.length > 0 ? sameForm : list
  const authorMatched = pool.filter((c) => toSimplified(c.authorOriginal).text === resolvedAuthor)
  const found = authorMatched[0] ?? pool[0]
  return found ?? null
}

/**
 * 把精选条目与语料候选对齐（优先「正文全串 t2s 精确比对」，退化到 author+首句前 5 字）；
 * 命中则**以语料文本/平仄为准**。顺序：唐诗三百首 → 千家诗；按正文去重。
 */
export function matchCuratedPoems(candidates, refs, stats) {
  const fullTextIndex = new Map()
  const authorFirstIndex = new Map()
  for (const candidate of candidates) {
    const author = toSimplified(candidate.authorOriginal).text
    const fullText = normalizePoemText(candidate.linesOriginal)
    if (!fullTextIndex.has(fullText)) fullTextIndex.set(fullText, [])
    fullTextIndex.get(fullText).push(candidate)
    const firstClause = toSimplified(firstClauseContent(candidate.linesOriginal[0])).text
    const key = `${author}\u0000${firstCharsContent(firstClause)}`
    if (!authorFirstIndex.has(key)) authorFirstIndex.set(key, [])
    authorFirstIndex.get(key).push(candidate)
  }
  const seenRef = new Set()
  const seenId = new Set()
  const matched = []
  stats.counters.curatedByBook = stats.counters.curatedByBook ?? {}
  stats.counters.curatedBlacklisted = 0
  stats.counters.curatedAuthorFixed = 0
  stats.counters.curatedFullTextMatched = 0
  stats.counters.curatedFallbackMatched = 0
  for (const ref of refs) {
    const bookKey = `${ref.book}\u0000refs`
    stats.counters.curatedByBook[bookKey] = (stats.counters.curatedByBook[bookKey] ?? 0) + 1
    const rawAuthor = String(ref.author ?? '').trim()
    const refKey = `${rawAuthor}\u0000${String(ref.title ?? '').trim()}`
    if (CURATED_POEM_BLACKLIST.has(refKey)) {
      stats.counters.curatedBlacklisted += 1
      stats.drop('curatedPoem', 'blacklist')
      continue
    }
    let correctedAuthor = rawAuthor
    if (CURATED_POEM_AUTHOR_FIX.has(refKey)) {
      correctedAuthor = CURATED_POEM_AUTHOR_FIX.get(refKey)
      stats.counters.curatedAuthorFixed += 1
    }
    const author = toSimplified(cleanCuratedAuthor(correctedAuthor)).text
    const clauses = splitClauses(String(ref.paragraphs?.[0] ?? ''))
    if (!clauses || clauses.length === 0) {
      stats.drop('curatedPoem', 'badRef')
      continue
    }
    const fullText = normalizePoemText(ref.paragraphs)
    const refDedupeKey = `${author}\u0000${fullText}`
    if (seenRef.has(refDedupeKey)) {
      stats.drop('curatedPoem', 'duplicateRef')
      continue
    }
    seenRef.add(refDedupeKey)
    // 1) 正文全串精确匹配（优先）
    let found = null
    let viaFullText = false
    const fullList = fullTextIndex.get(fullText)
    if (fullList && fullList.length > 0) {
      found = pickCuratedCandidate(fullList, ref, author)
      viaFullText = Boolean(found)
    }
    // 2) 退化：author + 首句前 5 字
    if (!found) {
      const simplifiedFirst = toSimplified(clauses[0].content).text
      const key = `${author}\u0000${firstCharsContent(simplifiedFirst)}`
      const list = authorFirstIndex.get(key)
      if (list && list.length > 0) found = pickCuratedCandidate(list, ref, author)
    }
    if (!found) {
      stats.drop('curatedPoem', 'unmatched')
      continue
    }
    if (found.form !== ref.form) {
      stats.drop('curatedPoem', 'formMismatch')
      continue
    }
    if (seenId.has(found.id)) {
      stats.drop('curatedPoem', 'duplicateMatched')
      continue
    }
    seenId.add(found.id)
    if (viaFullText) stats.counters.curatedFullTextMatched += 1
    else stats.counters.curatedFallbackMatched += 1
    found.source = 'curated-matched'
    matched.push(found)
    const matchedKey = `${ref.book}\u0000matched`
    stats.counters.curatedByBook[matchedKey] = (stats.counters.curatedByBook[matchedKey] ?? 0) + 1
  }
  return matched
}

/**
 * 补足路径：仅在精选命中不足 min 时使用。
 * 白名单作者 + 泛题后置 + rank 仅作同池排序；单作者 ≤10 首。
 */
export function selectFillPoems(candidates, excludeIds, need, stats, maxPerAuthor = MAX_POEMS_PER_AUTHOR) {
  if (need <= 0) return []
  const pool = candidates.filter(
    (candidate) =>
      !excludeIds.has(candidate.id) &&
      !candidate._placeholderTitle &&
      (candidate._variances ?? 0) <= MAX_VARIANCES &&
      FAMOUS_POETS.has(candidate.author),
  )
  const nonGeneric = []
  const generic = []
  for (const candidate of pool) (isGenericTitle(candidate.title) ? generic : nonGeneric).push(candidate)
  const cmp = (a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  nonGeneric.sort(cmp)
  generic.sort(cmp)
  const perAuthor = new Map()
  const kept = []
  for (const candidate of nonGeneric.concat(generic)) {
    const used = perAuthor.get(candidate.author) ?? 0
    if (used >= maxPerAuthor) {
      stats.drop('fillPoem', 'authorQuota')
      continue
    }
    perAuthor.set(candidate.author, used + 1)
    kept.push(candidate)
    if (kept.length >= need) break
  }
  return kept
}

/** 写盘前剔除内部字段（下划线开头）。 */
export function stripInternalFields(record) {
  const out = {}
  for (const [key, value] of Object.entries(record)) if (!key.startsWith('_')) out[key] = value
  return out
}

/** 从源数据读取一个诗 chunk（诗人 + strains + rank），按 id/位置对齐。 */
export function loadPoemChunk(source, dynasty, chunk, stats, options = {}) {
  const dirs = source.dirs
  const poetFile = path.join(dirs.tang, chunk.file)
  const strainFile = path.join(dirs.strains, chunk.file)
  const rankFile = path.join(
    dirs.rankPoet,
    `poet.${dynasty}.rank.${chunk.start}.json`,
  )
  const rawList = tryReadJSON(poetFile)
  const strainList = tryReadJSON(strainFile)
  const rankList = tryReadJSON(rankFile)
  if (!Array.isArray(rawList) || !Array.isArray(strainList) || !Array.isArray(rankList)) {
    stats.counters.chunksSkipped += 1
    return []
  }
  const byId = new Map()
  for (const entry of strainList) if (entry && entry.id) byId.set(entry.id, entry)
  const rankByKey = new Map()
  for (const entry of rankList) {
    if (entry && entry.author && entry.title) rankByKey.set(`${entry.author}\u0000${entry.title}`, entry)
  }
  const out = []
  for (let i = 0; i < rawList.length; i += 1) {
    const raw = rawList[i]
    if (!raw) continue
    const ordinal = chunk.start + i
    const strainEntry = byId.get(raw.id) ?? (strainList.length === rawList.length ? strainList[i] : null)
    // rank 对齐：同位置 author+title 精确一致最可信；否则按 author+title 查映射；都对不上则视为缺失
    const rankKey = `${raw.author}\u0000${raw.title}`
    const positionalRank = rankList[i]
    let rankEntry = null
    if (positionalRank && positionalRank.author === raw.author && positionalRank.title === raw.title) {
      rankEntry = positionalRank
    } else {
      rankEntry = rankByKey.get(rankKey) ?? null
      if (!rankEntry) stats.counters.rankFallbacks += 1
    }
    const candidate = buildPoemCandidate(raw, strainEntry, rankEntry, dynasty, ordinal, stats, options)
    if (candidate) out.push(candidate)
  }
  return out
}

/* ================================================================== *
 * 4. 词：宋词三百首（篇目主源）+ 宋词语料（正文主源）
 * ================================================================== */

/** 选集 QA 给出的作者截断修正（antology-qa.md §二.1）。 */
export const CI_AUTHOR_FIX = new Map([
  ['韩', '韩疁'],
  ['赵令', '赵令畤'],
  ['张', '张鎡'],
])

/** 36 首「别名・正名」合称词牌的归一映射（antology-qa.md §二.2，32 条）。 */
export const RHYTHMIC_SPLIT_MAP = new Map(
  Object.entries({
    '一丛花令・一丛花': '一丛花',
    '人南渡・感皇恩': '感皇恩',
    '伴云来・天香': '天香',
    '关河令・清商怨': '清商怨',
    '减字浣溪沙・浣溪沙': '浣溪沙',
    '凤栖梧・蝶恋花': '蝶恋花',
    '凤箫吟・芳草': '芳草',
    '夜飞鹊・夜飞鹊慢': '夜飞鹊慢',
    '宴山亭・燕山亭': '燕山亭',
    '庆宫春・高阳台': '高阳台',
    '拜星月・拜星月慢': '拜星月慢',
    '木兰花・玉楼春': '玉楼春',
    '江神子・江城子': '江城子',
    '江神子慢・江城子慢': '江城子慢',
    '浪涛沙・浪淘沙': '浪淘沙',
    '渡江云三犯・渡江云': '渡江云',
    '玉胡蝶・玉蝴蝶': '玉蝴蝶',
    '琵琶仙・自度曲': '琵琶仙',
    '甘州・八声甘州': '八声甘州',
    '石州引・石州慢': '石州慢',
    '秦楼月・忆秦娥': '忆秦娥',
    '竹马子・竹马儿': '竹马儿',
    '绣鸾凤花犯・花犯': '花犯',
    '绿头鸭・多丽': '多丽',
    '绿意・疏影': '疏影',
    '解佩环・疏影': '疏影',
    '蹋莎行・踏莎行': '踏莎行',
    '醉中真・浣溪沙': '浣溪沙',
    '金缕歌・贺新郎': '贺新郎',
    '锁窗寒・琐寒窗': '琐寒窗',
    '长亭怨・长亭怨慢': '长亭怨慢',
    '青门引・青门饮': '青门饮',
  }),
)

/** 语料/选集中被截断的个别词牌正名（anthology-qa.md：周邦彦「大酺」缺「酺」）。 */
export const RHYTHMIC_NAME_FIX = new Map([['大', '大酺']])

/** 15 张词牌卡的词牌名（用于确保每张卡都有对应词作）。 */
export const CI_CARD_RHYTHMICS = [
  '浣溪沙', '蝶恋花', '临江仙', '水调歌头', '念奴娇', '定风波', '雨霖铃', '声声慢',
  '如梦令', '虞美人', '鹊桥仙', '青玉案', '破阵子', '鹧鸪天', '满江红',
]

/** 选集缺的 3 个词牌名篇（从宋词语料补，antology-qa.md §三）。 */
export const CI_MISSING_TARGETS = [
  { author: '李清照', rhythmic: '如梦令', firstLine: '昨夜雨疏风骤' },
  { author: '秦观', rhythmic: '鹊桥仙', firstLine: '纤云弄巧' },
  { author: '辛弃疾', rhythmic: '破阵子', firstLine: '醉里挑灯看剑' },
]

/**
 * 规范化一行词正文（t2s + 去首尾空白）。
 * 注意：opencc 会把少数 BMP 字简化成 Ext-B 生僻字（紞→𬘘），浏览器字体缺字形，
 * 此时保留原字（BMP）以保证可显示——这比显示豆腐块更符合「正文准确」目标。
 */
export function normalizeCiLine(line) {
  const src = String(line ?? '')
  const { text } = toSimplified(src)
  const sourceChars = chars(src)
  const outChars = chars(text)
  if (outChars.length === sourceChars.length) {
    let changed = false
    for (let i = 0; i < outChars.length; i += 1) {
      if (outChars[i].codePointAt(0) > 0xffff && sourceChars[i].codePointAt(0) <= 0xffff) {
        outChars[i] = sourceChars[i]
        changed = true
      }
    }
    if (changed) return outChars.join('').trim()
  }
  return text.trim()
}

/** 取一行里的汉字串（去标点/空格），用于匹配。 */
export function ciContentChars(line) {
  return chars(normalizeCiLine(line)).filter(isCJK).join('')
}

/** a 是否为 b 的子序列（用于「选集缺字」场景：选集首句是语料首句删字后的结果）。 */
function isSubsequence(a, b) {
  if (!a) return true
  let j = 0
  for (const ch of chars(b)) {
    if (ch === chars(a)[j]) j += 1
    if (j >= chars(a).length) return true
  }
  return false
}

/** 最长公共子序列长度（短串 DP，用于异文容错）。 */
function lcsLength(a, b) {
  const aa = chars(a)
  const bb = chars(b)
  const dp = new Array(bb.length + 1).fill(0)
  for (let i = 1; i <= aa.length; i += 1) {
    let prev = 0
    for (let j = 1; j <= bb.length; j += 1) {
      const tmp = dp[j]
      dp[j] = aa[i - 1] === bb[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[bb.length]
}

/** 首句相似度：2=完全相同，1.5=一方是另一方子序列（缺字），(0,1)=LCS 比例，0=不匹配。 */
export function ciFirstLineScore(refLine, corpusLine) {
  const a = ciContentChars(refLine)
  const b = ciContentChars(corpusLine)
  if (!a || !b) return 0
  if (a === b) return 2
  if (Math.abs(a.length - b.length) <= 6 && (isSubsequence(a, b) || isSubsequence(b, a))) return 1.5
  const ratio = lcsLength(a, b) / Math.max(a.length, b.length)
  return ratio >= 0.9 ? ratio : 0
}

/** 词牌归一：先查合称映射；否则按「・」切分取语料高频一段。 */
export function normalizeRhythmic(rhythmic, rhythmicFreq = new Map(), stats = null) {
  const raw = String(rhythmic ?? '').trim()
  if (RHYTHMIC_NAME_FIX.has(raw)) {
    if (stats) stats.counters.ciRhythmicSplit += 1
    return RHYTHMIC_NAME_FIX.get(raw)
  }
  if (RHYTHMIC_SPLIT_MAP.has(raw)) {
    if (stats) stats.counters.ciRhythmicSplit += 1
    return RHYTHMIC_SPLIT_MAP.get(raw)
  }
  if (!raw.includes('・')) return raw
  const parts = raw.split('・').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return raw
  let best = parts[0]
  let bestFreq = -1
  for (const part of parts) {
    const freq = rhythmicFreq.get(part) ?? 0
    if (freq > bestFreq || (freq === bestFreq && charLength(part) > charLength(best))) {
      best = part
      bestFreq = freq
    }
  }
  if (stats) stats.counters.ciRhythmicSplit += 1
  return best
}

/**
 * 读词精选条目（篇目主源）。
 * 主源：`宋词/宋词三百首.json`（280 首）；可选覆盖：`content/curated-ci.json`（存在时优先）。
 * 正文在 buildCiItems 里会用宋词语料替换（选集正文有系统性缺字）。
 */
export function loadCuratedCiEntries(source, warn = () => {}) {
  const sources = []
  const contentRaw = tryReadJSON(path.join(CONTENT_DIR, 'curated-ci.json'))
  if (contentRaw) {
    const list = Array.isArray(contentRaw)
      ? contentRaw
      : Array.isArray(contentRaw.items)
        ? contentRaw.items
        : Array.isArray(contentRaw.ci)
          ? contentRaw.ci
          : Array.isArray(contentRaw.curated)
            ? contentRaw.curated
            : null
    if (Array.isArray(list)) sources.push({ name: 'content/curated-ci.json', list })
  }
  const bookPath = source.curated?.songci300?.path ?? path.join(source.dirs.ci, '宋词三百首.json')
  const book = tryReadJSON(bookPath)
  if (Array.isArray(book)) {
    const exists = sources.some((item) => item.name === 'content/curated-ci.json')
    if (!exists) sources.unshift({ name: '宋词/宋词三百首.json', list: book })
    else sources.push({ name: '宋词/宋词三百首.json（补充）', list: book })
  }
  if (sources.length === 0) {
    warn('未找到词精选源（宋词三百首.json / content/curated-ci.json），词数据将为空。')
    return { entries: [], from: null }
  }
  const entries = []
  let index = 0
  const seen = new Set()
  for (const { name, list } of sources) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const author = String(item.author ?? '').trim()
      const rhythmic = String(item.rhythmic ?? item.name ?? '').trim()
      const rawParagraphs = Array.isArray(item.paragraphs) ? item.paragraphs : Array.isArray(item.lines) ? item.lines : []
      const paragraphs = rawParagraphs.map((line) => normalizeCiLine(line)).filter(Boolean)
      if (!author || !rhythmic || paragraphs.length === 0) continue
      const key = `${author}\u0000${rhythmic}\u0000${firstCharsContent(firstClauseContent(paragraphs[0]))}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ index: index++, author, rhythmic, paragraphs, book: name })
    }
  }
  return { entries, from: sources.map((item) => item.name).join(' + ') }
}

/** 宋词语料索引：按作者分组 + 词牌频次（供正文替换 / 词牌归一 / 缺牌补篇）。 */
export function buildCiCorpusIndex(scanned) {
  const entries = []
  const byAuthor = new Map()
  const rhythmicFreq = new Map()
  for (const chunk of scanned.ci) {
    const rawList = tryReadJSON(path.join(scanned.dirs.ci, chunk.file))
    const rankList = tryReadJSON(path.join(scanned.dirs.rankCi, `ci.song.rank.${chunk.start}.json`))
    if (!Array.isArray(rawList) || !Array.isArray(rankList)) continue
    for (let i = 0; i < rawList.length; i += 1) {
      const raw = rawList[i]
      const rank = rankList[i]
      if (!raw || !rank) continue
      const author = toSimplified(String(raw.author ?? '')).text.trim()
      const rhythmic = toSimplified(String(raw.rhythmic ?? '')).text.trim()
      const lines = (Array.isArray(raw.paragraphs) ? raw.paragraphs : [])
        .map((line) => normalizeCiLine(line))
        .filter(Boolean)
      if (!author || !rhythmic || lines.length === 0) continue
      const entry = { author, rhythmic, lines, score: scoreOf(rank) }
      entries.push(entry)
      if (!byAuthor.has(author)) byAuthor.set(author, [])
      byAuthor.get(author).push(entry)
      rhythmicFreq.set(rhythmic, (rhythmicFreq.get(rhythmic) ?? 0) + 1)
    }
  }
  return { entries, byAuthor, rhythmicFreq }
}

/** 在语料里为一条词精选找最合适的正文：作者相同 + 首句相似（同词牌优先）。 */
export function matchCiCorpus(entry, corpusIndex) {
  // 语料里「韩」「张」也可能被截断：合并「修正后作者」与「原始作者」两边的候选
  const authorKeys = [...new Set([entry.author, entry.originalAuthor].filter(Boolean))]
  const seenCandidates = new Set()
  const candidates = []
  for (const key of authorKeys) {
    for (const item of corpusIndex.byAuthor.get(key) ?? []) {
      if (seenCandidates.has(item)) continue
      seenCandidates.add(item)
      candidates.push(item)
    }
  }
  if (candidates.length === 0) return null
  const refFirst = entry.paragraphs?.[0] ?? ''
  let best = null
  let bestScore = 0
  for (const candidate of candidates) {
    const similarity = ciFirstLineScore(refFirst, candidate.lines[0])
    if (similarity <= 0) continue
    const rhythmicBonus = candidate.rhythmic === entry.rhythmic ? 0.8 : 0
    const score = similarity + rhythmicBonus
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/**
 * 由词精选条目生成 contract §2.3 的 ci 记录：
 *  - 正文以宋词语料为准（选集缺字时用作者+首句相似度匹配；取不到才回退选集文本并计数）
 *  - author 修正（韩→韩疁 / 赵令→赵令畤 / 张→张鎡）、词牌合称拆分归一、t2s 转写
 *  - 补 3 首缺牌名篇（如梦令/鹊桥仙/破阵子），保证 15 张词牌卡都有对应词作
 *  - title = 词牌 + "·" + 首句截断（≤40 字符）；quote = 首句（过长则 ""）
 */
export function buildCiItems(entries, corpusIndex, stats) {
  const items = []
  const seen = new Set()
  const usedCorpus = new Set()
  const pushItem = (id, author, rhythmic, lines, score) => {
    const firstLine = lines[0] ?? ''
    const dedupeKey = `${author}\u0000${rhythmic}\u0000${firstCharsContent(firstClauseContent(firstLine))}`
    if (seen.has(dedupeKey)) return false
    seen.add(dedupeKey)
    items.push({
      id,
      author,
      rhythmic,
      lines,
      title: makeCiTitle(rhythmic, lines),
      score,
      quote: charLength(firstLine) <= 48 ? firstLine : '',
    })
    return true
  }

  for (const entry of entries) {
    stats.counters.ciCandidates += 1
    let author = entry.author
    if (CI_AUTHOR_FIX.has(author)) {
      author = toSimplified(CI_AUTHOR_FIX.get(author)).text
      stats.counters.ciAuthorFixed += 1
    }
    const rhythmic = normalizeRhythmic(entry.rhythmic, corpusIndex.rhythmicFreq, stats)
    const refLines = entry.paragraphs.map(normalizeCiLine).filter(Boolean)
    const corpus = matchCiCorpus(
      { author, originalAuthor: entry.author, rhythmic, paragraphs: refLines },
      corpusIndex,
    )
    let lines = refLines
    let score = 0
    let finalRhythmic = rhythmic
    if (corpus) {
      lines = corpus.lines
      score = corpus.score
      stats.counters.ciCorpusMatched += 1
      if (corpus.lines.join('') !== refLines.join('')) stats.counters.ciCorpusReplaced += 1
      // 选集词牌也可能被截断（如「大」→「大酺」）：语料里的正名更长且无合称分隔符时采用语料词牌
      if (
        corpus.rhythmic &&
        !corpus.rhythmic.includes('・') &&
        corpus.rhythmic !== rhythmic &&
        (corpus.rhythmic.startsWith(rhythmic) || rhythmic.startsWith(corpus.rhythmic)) &&
        charLength(corpus.rhythmic) > charLength(rhythmic)
      ) {
        finalRhythmic = corpus.rhythmic
        stats.counters.ciRhythmicFixed = (stats.counters.ciRhythmicFixed ?? 0) + 1
      }
      usedCorpus.add(`${corpus.author}\u0000${corpus.rhythmic}\u0000${firstCharsContent(firstClauseContent(corpus.lines[0]))}`)
    } else {
      stats.counters.ciCorpusFallback += 1
    }
    pushItem(makeId('ci', entry.index), author, finalRhythmic, lines, score)
  }

  // 补 3 首缺牌名篇（从宋词语料直接取，确保正文准确）
  let extraIndex = 900000
  for (const target of CI_MISSING_TARGETS) {
    const candidates = corpusIndex.byAuthor.get(target.author) ?? []
    const found = candidates
      .filter((candidate) => candidate.rhythmic === target.rhythmic)
      .map((candidate) => ({
        candidate,
        similarity: Math.max(
          ciFirstLineScore(target.firstLine, candidate.lines[0]),
          ciFirstLineScore(target.firstLine, firstClauseContent(candidate.lines[0])),
        ),
      }))
      .filter((item) => item.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity || b.candidate.score - a.candidate.score)[0]
    if (!found) {
      warnSkip(stats, target)
      continue
    }
    const key = `${target.author}\u0000${target.rhythmic}\u0000${firstCharsContent(firstClauseContent(found.candidate.lines[0]))}`
    if (usedCorpus.has(key)) continue
    if (pushItem(makeId('ci', extraIndex++), target.author, target.rhythmic, found.candidate.lines, found.candidate.score)) {
      stats.counters.ciAppended += 1
      usedCorpus.add(key)
    }
  }

  // 兜底：确保 15 张词牌卡都有对应词作（仍缺则从语料名家名篇里补）
  const covered = new Set(items.map((item) => item.rhythmic))
  for (const rhythmic of CI_CARD_RHYTHMICS) {
    if (covered.has(rhythmic)) continue
    const candidates = corpusIndex.entries
      .filter((entry) => entry.rhythmic === rhythmic && FAMOUS_CI_POETS.has(entry.author))
      .sort((a, b) => b.score - a.score)
    for (const candidate of candidates) {
      const key = `${candidate.author}\u0000${candidate.rhythmic}\u0000${firstCharsContent(firstClauseContent(candidate.lines[0]))}`
      if (usedCorpus.has(key)) continue
      if (pushItem(makeId('ci', extraIndex++), candidate.author, candidate.rhythmic, candidate.lines, candidate.score)) {
        stats.counters.ciCardFill += 1
        usedCorpus.add(key)
        break
      }
    }
  }
  return items
}

/** 缺牌补篇失败时记一笔（不中断构建）。 */
function warnSkip(stats, target) {
  stats.drop('ciExtra', 'notFound')
  void target
}

/* ================================================================== *
 * 5. 韵部：《声律启蒙》30 韵部
 * ================================================================== */

/** 从《声律启蒙》一段原文里提取句末字作为韵脚例字（override 缺失时的兜底）。 */
export function extractExampleChars(paragraphs, rhyme) {
  const lastChars = []
  for (const paragraph of paragraphs) {
    for (const sentence of String(paragraph).split(/[。；]/)) {
      const cjk = chars(sentence).filter(isCJK)
      if (cjk.length === 0) continue
      const last = cjk[cjk.length - 1]
      if (!lastChars.includes(last)) lastChars.push(last)
    }
  }
  const out = []
  if (rhyme && isCJK(rhyme)) out.push(rhyme)
  for (const ch of lastChars) if (!out.includes(ch)) out.push(ch)
  if (out.length < 3) {
    for (const paragraph of paragraphs) {
      for (const ch of chars(paragraph)) {
        if (isCJK(ch) && !out.includes(ch)) out.push(ch)
        if (out.length >= 3) break
      }
      if (out.length >= 3) break
    }
  }
  return out.slice(0, 8)
}

/** 读取 content/yun-overrides.json；缺失/无效返回 null。 */
function loadYunOverrides(warn) {
  const file = path.join(CONTENT_DIR, 'yun-overrides.json')
  const data = tryReadJSON(file)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    warn('未找到 content/yun-overrides.json，本次从《声律启蒙》原文提取韵脚例字。')
    return null
  }
  return data
}

/** 由《声律启蒙》源数据 + override 生成 contract §2.4 的 yun 结构。 */
export function buildYun(raw, overrides, stats) {
  if (!raw || !Array.isArray(raw.content) || raw.content.length !== 2) {
    throw new Error('《声律启蒙》结构异常：期望 2 卷')
  }
  const volumes = raw.content.map((volume, vi) => {
    if (!Array.isArray(volume.content) || volume.content.length !== 15) {
      throw new Error(`《声律启蒙》第 ${vi + 1} 卷章节数异常：期望 15`)
    }
    const chapters = volume.content.map((chapter) => {
      const simplifiedName = toSimplified(String(chapter.chapter ?? '').trim())
      const name = simplifiedName.text.replace(/\s+/g, ' ').trim()
      const rhyme = name.split(' ')[1] ?? chars(name).at(-1) ?? ''
      const paragraphs = (chapter.paragraphs ?? []).map((p) => toSimplified(String(p)).text)
      if (paragraphs.length !== 3) {
        throw new Error(`韵部「${name}」段数异常：期望 3，实际 ${paragraphs.length}`)
      }
      let exampleChars = null
      const override = overrides?.[name]
      if (Array.isArray(override)) {
        const cleaned = override
          .map((ch) => String(ch).trim())
          .filter((ch) => charLength(ch) === 1 && isCJK(ch))
        const deduped = [...new Set(cleaned)]
        if (deduped.length >= 3) exampleChars = deduped.slice(0, 8)
        else stats.counters.yunOverridesRejected = (stats.counters.yunOverridesRejected ?? 0) + 1
      }
      if (!exampleChars) exampleChars = extractExampleChars(paragraphs, rhyme)
      const firstSentence = String(paragraphs[0]).split('。')[0]
      const exampleLine = firstSentence ? `${firstSentence}。` : String(paragraphs[0] ?? '')
      return { name, rhyme, paragraphs, exampleChars, exampleLine }
    })
    return { title: toSimplified(String(volume.title ?? '').trim()).text, chapters }
  })
  return { volumes }
}

/* ================================================================== *
 * 6. 知识卡：content/ 合并（缺失时占位）
 * ================================================================== */

const PLACEHOLDER_CARDS = [
  ['tones', '四声与平仄', '平声为平，上去入为仄；入声散入今音，尤须留意。'],
  ['rhyme', '平水韵与押韵', '近体诗一韵到底，首句可借韵；平声三十韵部是押韵的底本。'],
  ['forms', '近体诗与古体诗', '近体讲平仄、粘对与对仗；古体相对自由。'],
  ['patterns', '四种基本句式', '五言四式、七言四式，是格律的最小积木。'],
  ['formats', '四种标准格式', '平起/仄起 × 首句入韵/不入韵，共四种标准格式。'],
  ['join', '粘与对', '联内相对、联间相粘，是近体诗声律的骨架。'],
  ['parallelism', '对仗', '律诗颔联、颈联对仗；绝句可对可不对。'],
  ['isolated-ping', '孤平', '平收句式若只剩一个平声字，即为孤平，格律所忌。'],
  ['rescue', '拗救', '出句拗、对句救，是唐宋诗人常用的变通手法。'],
  ['sanping', '三平调与三仄尾', '句末三平或三仄，近体一般视为病。'],
  ['ci-forms', '词牌与词谱基础', '词按词牌填，上下阕、字数、韵位皆有定格。'],
  ['roadmap', '怎么用这个挂件学格律', '先读名篇，再看平仄与解析，日积月累。'],
].map(([id, title, summary]) => ({
  id,
  title,
  summary,
  paragraphs: ['（知识卡占位）内容作者完成后由 scripts/build-data.mjs 合并进 data/knowledge.json。'],
  examples: [{ text: '白日依山尽，黄河入海流。', note: '（占位例句）' }],
}))

const PLACEHOLDER_CI_CARDS = [
  '浣溪沙', '蝶恋花', '临江仙', '水调歌头', '念奴娇', '定风波', '雨霖铃', '声声慢',
  '如梦令', '虞美人', '鹊桥仙', '青玉案', '破阵子', '鹧鸪天', '满江红',
].map((name) => ({
  id: 'placeholder',
  name,
  aliases: [],
  form: '（词牌卡占位）',
  rhyme: '平韵',
  note: '（词牌卡占位）内容作者完成后由构建脚本合并。',
  example: '',
}))

/** 规范化知识卡字段顺序，只保留契约字段。 */
function normalizeCards(cards) {
  return cards.map((card) => ({
    id: String(card.id ?? ''),
    title: String(card.title ?? ''),
    summary: String(card.summary ?? ''),
    paragraphs: (card.paragraphs ?? []).map((p) => String(p ?? '')),
    examples: (card.examples ?? []).map((ex) => ({
      text: String(ex?.text ?? ''),
      note: String(ex?.note ?? ''),
    })),
  }))
}

function normalizeCiCards(cards) {
  return cards.map((card) => ({
    id: String(card.id ?? ''),
    name: String(card.name ?? ''),
    aliases: (card.aliases ?? []).map((a) => String(a ?? '')),
    form: String(card.form ?? ''),
    rhyme: String(card.rhyme ?? ''),
    note: String(card.note ?? ''),
    example: String(card.example ?? ''),
  }))
}

/** 读取内容作者交付的 12 张格律卡 / 15 张词牌卡；缺失时返回占位并在 stats 标记。 */
export function buildKnowledge(stats, warn) {
  const cardsFile = path.join(CONTENT_DIR, 'cards.json')
  const ciCardsFile = path.join(CONTENT_DIR, 'ci-cards.json')
  const rawCards = tryReadJSON(cardsFile)
  const rawCiCards = tryReadJSON(ciCardsFile)

  let cards
  if (Array.isArray(rawCards)) {
    cards = normalizeCards(rawCards)
    if (cards.length !== 12) throw new Error(`content/cards.json 应为 12 项，实际 ${cards.length} 项`)
    stats.counters.knowledgeSource = 'content'
  } else {
    cards = PLACEHOLDER_CARDS
    stats.counters.knowledgeSource = 'placeholder'
    warn('未找到 content/cards.json，本次使用 12 张占位知识卡（TODO：内容作者交付后重跑构建）。')
  }

  let ciCards
  if (Array.isArray(rawCiCards)) {
    ciCards = normalizeCiCards(rawCiCards)
    if (ciCards.length !== 15) throw new Error(`content/ci-cards.json 应为 15 项，实际 ${ciCards.length} 项`)
    stats.counters.ciCardsSource = 'content'
  } else {
    ciCards = PLACEHOLDER_CI_CARDS
    stats.counters.ciCardsSource = 'placeholder'
    warn('未找到 content/ci-cards.json，本次使用 15 张占位词牌卡（TODO：内容作者交付后重跑构建）。')
  }

  // 词牌占位卡 id 需要唯一（真实内容由内容作者提供固定 id）
  const seen = new Set()
  for (const card of ciCards) {
    let id = card.id
    if (!id || seen.has(id)) id = `ci-${card.name}`
    card.id = id
    seen.add(id)
  }
  return { cards, ciCards }
}

/* ================================================================== *
 * 7. 构建主流程
 * ================================================================== */

function todayLocalDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function resolveDataVersion(explicit) {
  if (explicit) return explicit
  if (process.env.DATA_VERSION) return process.env.DATA_VERSION
  const existing = tryReadJSON(path.join(DEFAULT_OUT, 'manifest.json'))
  if (existing?.dataVersion) return existing.dataVersion
  return `${todayLocalDate()}.1`
}

function sampleEvenly(list, count) {
  if (list.length <= count) return list
  const out = []
  for (let i = 0; i < count; i += 1) {
    out.push(list[Math.floor((i * (list.length - 1)) / Math.max(1, count - 1))])
  }
  return [...new Set(out)]
}

function writeDataFile(outDir, name, payload) {
  const text = JSON.stringify(payload) + '\n'
  fs.writeFileSync(path.join(outDir, name), text)
  return Buffer.byteLength(text)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 分布统计（报告用）：诗。 */
export function summarizePoemDistribution(items) {
  const dynasty = {}
  const forms = {}
  const authors = new Map()
  const sources = {}
  for (const item of items) {
    dynasty[item.dynasty] = (dynasty[item.dynasty] ?? 0) + 1
    forms[item.form] = (forms[item.form] ?? 0) + 1
    authors.set(item.author, (authors.get(item.author) ?? 0) + 1)
    sources[item.source] = (sources[item.source] ?? 0) + 1
  }
  const topAuthors = [...authors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  return { dynasty, forms, sources, topAuthors }
}

/** 分布统计（报告用）：词。 */
export function summarizeCiDistribution(items) {
  const authors = new Map()
  const rhythmic = new Map()
  let quotes = 0
  for (const item of items) {
    authors.set(item.author, (authors.get(item.author) ?? 0) + 1)
    rhythmic.set(item.rhythmic, (rhythmic.get(item.rhythmic) ?? 0) + 1)
    if (item.quote) quotes += 1
  }
  return {
    topAuthors: [...authors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10),
    topRhythmic: [...rhythmic.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10),
    quotes,
  }
}

function printDrops(label, drops, total) {
  const entries = Object.entries(drops ?? {})
  if (entries.length === 0) return
  entries.sort((a, b) => b[1] - a[1])
  console.log(`  ${label}丢弃（共 ${entries.reduce((s, [, v]) => s + v, 0)} / 候选 ${total}）：`)
  for (const [reason, count] of entries) {
    console.log(`    ${reason.padEnd(16)} ${String(count).padStart(7)}`)
  }
}

/**
 * 构建全部数据文件。
 * @param {{ smoke?: boolean, outDir?: string, poems?: number, ci?: number, version?: string,
 *           src?: string, ref?: string, cache?: string, noFetch?: boolean, log?: Function }} [opts]
 */
export async function buildData(opts = {}) {
  const log = opts.log ?? ((msg) => console.log(msg))
  const warn = (msg) => console.warn(`[warn] ${msg}`)
  const smoke = Boolean(opts.smoke)
  const targetPoems = opts.poems ?? (smoke ? 60 : 500)
  const targetCi = opts.ci ?? (smoke ? 30 : 300)
  const outDir = path.resolve(opts.outDir ?? DEFAULT_OUT)
  const startedAt = Date.now()
  const stats = createStats()

  log(`[1/6] 解析源数据${smoke ? '（冒烟模式）' : '（最终构建）'}${opts.offline ? '（离线模式）' : ''} ...`)
  const source = await resolveSource({
    source: opts.source ?? opts.src,
    ref: opts.ref,
    cache: opts.cache,
    force: opts.force,
    noFetch: opts.noFetch,
    offline: opts.offline,
    dataSrcDir: opts.dataSrcDir,
    log,
  })
  const scanned = scanSource(source.dir)
  // curated 源优先用项目内 data-src/ 快照（离线可用），缺失再回退完整语料
  const curated = resolveCuratedFiles({
    fullDir: source.dir,
    dataSrcDir: opts.dataSrcDir,
    offline: opts.offline,
    log,
  })
  scanned.curated = curated.files
  const curatedFrom = [...new Set(Object.values(curated.files).map((file) => file.from))]
  log(
    `curated 源：${curated.complete ? '✓ 齐全' : `✗ 缺 ${curated.missing.length} 个`}` +
      `（${curatedFrom.join(' + ') || '无'}；${Object.keys(curated.files).length}/${Object.keys(CURATED_FILES).length}）`,
  )
  stats.counters.curatedFileCount = Object.keys(curated.files).length
  stats.counters.curatedFileMissing = curated.missing.length

  // ---- 平水韵校验门（构建期 QA oracle） ----
  const rhymeTablePath = opts.pingshuiPath ?? process.env.PINGSHUI_DICT ?? DEFAULT_PINGSHUI
  const rhymeTable = opts.noRhymeGate ? null : loadRhymeTable(rhymeTablePath)
  if (opts.noRhymeGate) warn('已通过 --no-rhyme-gate 关闭押韵校验门（不推荐，最终数据必须开启）。')
  else if (!rhymeTable) warn(`未找到平水韵表（${rhymeTablePath}），本次跳过押韵校验门。`)
  else log(`押韵门：已载入平水韵表 ${path.relative(PROJECT_ROOT, rhymeTablePath)}（${rhymeTable.ping.size} 个平声字）`)

  // ---- 诗 ----
  log(`[2/6] 对齐诗 / strains / rank 并筛选近体诗 ...`)
  const tangChunks = smoke ? sampleEvenly(scanned.tang, 8) : scanned.tang
  const songChunks = smoke ? sampleEvenly(scanned.song, 4) : scanned.song
  const candidates = []
  for (const chunk of tangChunks) {
    candidates.push(
      ...loadPoemChunk(scanned, 'tang', chunk, stats, { rhymeTable, maxVariances: CANDIDATE_MAX_VARIANCES }),
    )
    stats.counters.tangChunks += 1
  }
  for (const chunk of songChunks) {
    candidates.push(
      ...loadPoemChunk(scanned, 'song', chunk, stats, { rhymeTable, maxVariances: CANDIDATE_MAX_VARIANCES }),
    )
    stats.counters.songChunks += 1
  }
  // 精选优先：唐诗三百首 / 千家诗 → 与语料对齐（以 corpus 文本 + strains 为准）
  const curatedPoemRefs = loadCuratedPoemRefs(scanned, warn)
  const curatedPoems = matchCuratedPoems(candidates, curatedPoemRefs, stats)
  stats.counters.curatedPoemRefs = curatedPoemRefs.length
  stats.counters.curatedPoemMatched = curatedPoems.length
  const curatedByBook = stats.counters.curatedByBook ?? {}
  const bookReport = ['tangshisanbaishou', 'qianjiashi']
    .map((book) => `${book} ${curatedByBook[`${book}\u0000matched`] ?? 0}/${curatedByBook[`${book}\u0000refs`] ?? 0}`)
    .join('，')
  log(
    `  精选：${bookReport}（合计命中 ${curatedPoems.length} 首；` +
      `未命中 ${stats.dropped.curatedPoem?.unmatched ?? 0} / 体式不符 ${stats.dropped.curatedPoem?.formMismatch ?? 0} / 重复 ${stats.dropped.curatedPoem?.duplicateRef ?? 0}）`,
  )
  let poems
  let poemFilled = []
  if (smoke) {
    const curatedTaken = curatedPoems.slice(0, targetPoems)
    if (curatedTaken.length < targetPoems) {
      poemFilled = selectFillPoems(candidates, new Set(curatedTaken.map((p) => p.id)), targetPoems - curatedTaken.length, stats)
    }
    poems = [...curatedTaken, ...poemFilled].map(stripInternalFields)
  } else {
    const curatedTaken = curatedPoems.slice(0, POEM_TARGET.max)
    if (curatedTaken.length < POEM_TARGET.min) {
      poemFilled = selectFillPoems(
        candidates,
        new Set(curatedTaken.map((p) => p.id)),
        POEM_TARGET.min - curatedTaken.length,
        stats,
      )
    }
    poems = [...curatedTaken, ...poemFilled].map(stripInternalFields)
  }
  stats.counters.poemFilled = poemFilled.length
  stats.counters.poemsKept = poems.length
  // 简体残留自检：display 字段（title/author/lines）里不应再有可被简化的繁体/异体字
  const residualChars = new Set()
  let residualOccurrences = 0
  for (const poem of poems) {
    for (const field of [poem.title, poem.author, ...poem.lines]) {
      for (const ch of chars(field)) {
        if (!isCJK(ch)) continue
        if (simplifyChar(ch) !== ch) {
          residualChars.add(ch)
          residualOccurrences += 1
        }
      }
    }
  }
  stats.counters.simplifiedResidualOccurrences = residualOccurrences
  stats.counters.simplifiedResidual = residualChars.size
  if (residualChars.size > 0) {
    warn(`简体残留字 ${residualChars.size} 种（${[...residualChars].join('')}），出现 ${residualOccurrences} 次（目标 0）。`)
  }
  if (!smoke && poems.length < POEM_TARGET.min) {
    warn(`精选+补足后仅 ${poems.length} 首，低于目标下限 ${POEM_TARGET.min}（宁缺毋滥，不放宽质量门）。`)
  }

  // ---- 词 ----
  log(`[3/6] 词：宋词三百首选目 + 宋词语料正文 ...`)
  const { entries: ciEntries, from: ciSource } = loadCuratedCiEntries(scanned, warn)
  const ciCorpusIndex = buildCiCorpusIndex(scanned)
  const ci = buildCiItems(ciEntries, ciCorpusIndex, stats)
  stats.counters.ciChunks = scanned.ci.length
  stats.counters.curatedCiRefs = ciEntries.length
  stats.counters.curatedCiMatched = ci.length
  stats.counters.curatedCiSource = ciSource ?? 'none'
  stats.counters.ciKept = ci.length
  const ciCovered = new Set(ci.map((item) => item.rhythmic))
  const missingCards = CI_CARD_RHYTHMICS.filter((name) => !ciCovered.has(name))
  log(
    `  词精选源：${ciSource ?? '无'}（条目 ${ciEntries.length} → 入选 ${ci.length}；` +
      `语料替换正文 ${stats.counters.ciCorpusReplaced} / 回退选集 ${stats.counters.ciCorpusFallback}；` +
      `词牌拆分 ${stats.counters.ciRhythmicSplit} / 作者修正 ${stats.counters.ciAuthorFixed} / 补名篇 ${stats.counters.ciAppended}）`,
  )
  if (missingCards.length > 0) warn(`15 张词牌卡仍缺词作：${missingCards.join('、')}`)
  else log(`  15 张词牌卡覆盖：✓ 全部有对应词作`)
  if (ci.length < CI_TARGET.min) warn(`词数量 ${ci.length} < 下限 ${CI_TARGET.min}`)

  // ---- 韵部 ----
  log(`[4/6] 生成《声律启蒙》30 韵部 ...`)
  const shenglvPath = scanned.curated?.shenglvqimeng?.path ?? scanned.mengxueFiles.shenglvqimeng
  const shenglv = readJSON(shenglvPath)
  const overrides = loadYunOverrides(warn)
  const yun = buildYun(shenglv, overrides, stats)
  const chapterCount = yun.volumes.reduce((sum, v) => sum + v.chapters.length, 0)
  if (chapterCount !== 30) throw new Error(`韵部章节数应为 30，实际 ${chapterCount}`)
  if (overrides) {
    const known = new Set(yun.volumes.flatMap((v) => v.chapters.map((c) => c.name)))
    for (const key of Object.keys(overrides)) {
      if (!known.has(key) && key !== 'schemaVersion') warn(`content/yun-overrides.json 含未知韵部键「${key}」`)
    }
    const sample = yun.volumes[0].chapters.slice(0, 3).map((c) => `${c.name}:${c.exampleChars.join('')}`)
    log(`  韵脚例字（content/yun-overrides.json 校正）：${sample.join('  ')} …（共 ${chapterCount} 韵部）`)
  } else {
    const sample = yun.volumes[0].chapters.slice(0, 3).map((c) => `${c.name}:${c.exampleChars.join('')}`)
    log(`  韵脚例字（从原文提取，待抽查）：${sample.join('  ')} …`)
  }

  // ---- 知识卡 ----
  log(`[5/6] 合并知识卡 content/cards.json + content/ci-cards.json ...`)
  const knowledge = buildKnowledge(stats, warn)
  log(`  知识卡 ${knowledge.cards.length} 张（${stats.counters.knowledgeSource}）/ 词牌卡 ${knowledge.ciCards.length} 张（${stats.counters.ciCardsSource}）`)

  // ---- 写文件 ----
  log(`[6/6] 写入 data/ ...`)
  fs.mkdirSync(outDir, { recursive: true })
  const dataVersion = resolveDataVersion(opts.version)
  const files = {}
  files['poems.json'] = writeDataFile(outDir, 'poems.json', { ok: true, dataVersion, items: poems })
  files['ci.json'] = writeDataFile(outDir, 'ci.json', { ok: true, dataVersion, items: ci })
  files['yun.json'] = writeDataFile(outDir, 'yun.json', { ok: true, dataVersion, volumes: yun.volumes })
  files['knowledge.json'] = writeDataFile(outDir, 'knowledge.json', {
    ok: true,
    dataVersion,
    cards: knowledge.cards,
    ciCards: knowledge.ciCards,
  })

  const builtAt = new Date().toISOString()
  const manifest = {
    dataVersion,
    source: { repo: SOURCE.repo, commit: SOURCE.commit, license: SOURCE.license },
    builtAt,
    stats: {
      poemCandidates: stats.counters.poemCandidates,
      poemsKept: stats.counters.poemsKept,
      ciCandidates: stats.counters.ciCandidates,
      ciKept: stats.counters.ciKept,
      poemDynasty: poems.reduce((acc, p) => { acc[p.dynasty] = (acc[p.dynasty] ?? 0) + 1; return acc }, {}),
      poemSources: poems.reduce((acc, p) => { acc[p.source] = (acc[p.source] ?? 0) + 1; return acc }, {}),
      poemForms: poems.reduce((acc, p) => { acc[p.form] = (acc[p.form] ?? 0) + 1; return acc }, {}),
      rhymeDroppedByReason: {
        rhymeMixed: stats.dropped.poem?.rhymeMixed ?? 0,
        rhymeNoPing: stats.dropped.poem?.rhymeNoPing ?? 0,
        rhymeUnknown: stats.dropped.poem?.rhymeUnknown ?? 0,
        rhymeFirstBorrow: stats.dropped.poem?.rhymeFirstBorrow ?? 0,
      },
      curatedByBook: stats.counters.curatedByBook ?? {},
      curatedPoemRefs: stats.counters.curatedPoemRefs,
      curatedPoemMatched: stats.counters.curatedPoemMatched,
      poemFilled: stats.counters.poemFilled,
      simplifiedResidual: stats.counters.simplifiedResidual,
      simplifiedResidualOccurrences: stats.counters.simplifiedResidualOccurrences ?? 0,
      curatedBlacklisted: stats.counters.curatedBlacklisted ?? 0,
      curatedAuthorFixed: stats.counters.curatedAuthorFixed ?? 0,
      curatedFullTextMatched: stats.counters.curatedFullTextMatched ?? 0,
      curatedFallbackMatched: stats.counters.curatedFallbackMatched ?? 0,
      curatedCiRefs: stats.counters.curatedCiRefs,
      curatedCiMatched: stats.counters.curatedCiMatched,
      curatedCiSource: stats.counters.curatedCiSource,
      ciCorpusMatched: stats.counters.ciCorpusMatched,
      ciCorpusReplaced: stats.counters.ciCorpusReplaced,
      ciCorpusFallback: stats.counters.ciCorpusFallback,
      ciRhythmicSplit: stats.counters.ciRhythmicSplit,
      ciAuthorFixed: stats.counters.ciAuthorFixed,
      ciAppended: stats.counters.ciAppended,
      ciCardFill: stats.counters.ciCardFill,
      ciFilled: stats.counters.ciFilled,
      droppedPoem: stats.dropped.poem ?? {},
      droppedCi: stats.dropped.ci ?? {},
      droppedCuratedPoem: stats.dropped.curatedPoem ?? {},
      droppedCuratedCi: stats.dropped.curatedCi ?? {},
      droppedFillPoem: stats.dropped.fillPoem ?? {},
      droppedFillCi: stats.dropped.fillCi ?? {},
      tangChunks: stats.counters.tangChunks,
      songChunks: stats.counters.songChunks,
      ciChunks: stats.counters.ciChunks,
      simplifiedFallbacks: stats.counters.simplifiedFallbacks,
      rankFallbacks: stats.counters.rankFallbacks,
      rhymeChecked: stats.counters.rhymeChecked,
      rhymePassed: stats.counters.rhymePassed,
      rhymeDropped: stats.counters.rhymeDropped,
      rhymeFirstBorrowOk: stats.counters.rhymeFirstBorrowOk,
      ciRankExact: stats.counters.ciRankExact,
      ciRankWindow: stats.counters.ciRankWindow,
      ciRankPositional: stats.counters.ciRankPositional,
      chunksSkipped: stats.counters.chunksSkipped,
      knowledgeSource: stats.counters.knowledgeSource,
      ciCardsSource: stats.counters.ciCardsSource,
      smoke,
      durationMs: Date.now() - startedAt,
    },
    files,
  }
  const manifestBytes = writeDataFile(outDir, 'manifest.json', manifest)

  // ---- 报告 ----
  const durationMs = Date.now() - startedAt
  log('')
  log(`构建完成：dataVersion=${dataVersion}  用时 ${(durationMs / 1000).toFixed(1)}s  模式=${smoke ? '冒烟' : '最终'}`)
  log(`  源：${SOURCE.repo} @ ${SOURCE.commit}`)
  const poemDist = summarizePoemDistribution(poems)
  const ciDist = summarizeCiDistribution(ci)
  log(
    `  诗：候选 ${stats.counters.poemCandidates} → 精选命中 ${stats.counters.curatedPoemMatched} + 补足 ${stats.counters.poemFilled} = 入选 ${poems.length}`,
  )
  log(`    朝代：${JSON.stringify(poemDist.dynasty)}；诗体：${JSON.stringify(poemDist.forms)}；来源：${JSON.stringify(poemDist.sources)}`)
  log(`    top10 作者：${poemDist.topAuthors.map(([name, count]) => `${name}×${count}`).join('、')}`)
  printDrops('诗 ', stats.dropped.poem, stats.counters.poemCandidates)
  printDrops('精选诗 ', stats.dropped.curatedPoem, stats.counters.curatedPoemRefs)
  printDrops('补足诗 ', stats.dropped.fillPoem, stats.counters.poemFilled + (stats.dropped.fillPoem?.authorQuota ?? 0))
  log(
    `  词：选集条目 ${stats.counters.curatedCiRefs} → 入选 ${ci.length}` +
      `（语料替换正文 ${stats.counters.ciCorpusReplaced} / 语料命中 ${stats.counters.ciCorpusMatched} / 回退选集 ${stats.counters.ciCorpusFallback}；` +
      `词牌拆分 ${stats.counters.ciRhythmicSplit} / 作者修正 ${stats.counters.ciAuthorFixed} / 补名篇 ${stats.counters.ciAppended} + ${stats.counters.ciCardFill}）`,
  )
  log(`    top10 作者：${ciDist.topAuthors.map(([name, count]) => `${name}×${count}`).join('、')}`)
  log(`    词牌 top5：${ciDist.topRhythmic.slice(0, 5).map(([name, count]) => `${name}×${count}`).join('、')}；名句覆盖 ${ciDist.quotes}/${ci.length}`)
  printDrops('词 ', stats.dropped.ci, stats.counters.ciCandidates)
  log(`  韵部：2 卷 / ${chapterCount} 章；知识：${knowledge.cards.length} 卡 / ${knowledge.ciCards.length} 词牌卡`)
  log(
    `  押韵门：校验 ${stats.counters.rhymeChecked} 首 / 通过 ${stats.counters.rhymePassed} / 丢弃 ${stats.counters.rhymeDropped}` +
      `（rhymeMixed ${stats.dropped.poem?.rhymeMixed ?? 0} / rhymeNoPing ${stats.dropped.poem?.rhymeNoPing ?? 0} / rhymeUnknown ${stats.dropped.poem?.rhymeUnknown ?? 0} / 首句越界借韵 ${stats.dropped.poem?.rhymeFirstBorrow ?? 0}；首句合法借邻韵 ${stats.counters.rhymeFirstBorrowOk} 首）`,
  )
  log(
    `  繁转简回退：${stats.counters.simplifiedFallbacks} 行；简体残留：${stats.counters.simplifiedResidual} 种 / ${stats.counters.simplifiedResidualOccurrences ?? 0} 次（目标 0）；跳过 chunk：${stats.counters.chunksSkipped}`,
  )
  log('  文件：')
  for (const name of ['poems.json', 'ci.json', 'yun.json', 'knowledge.json', 'manifest.json']) {
    const bytes = name === 'manifest.json' ? manifestBytes : files[name]
    const budget = BUDGETS[name]
    const suffix = budget ? `（预算 ${formatBytes(budget)}，占 ${((bytes / budget) * 100).toFixed(1)}%）` : ''
    console.log(`    ${name.padEnd(16)} ${String(bytes).padStart(8)} B  ${formatBytes(bytes).padStart(9)}${suffix}`)
    if (budget && bytes > budget) warn(`${name} 超出体积预算：${bytes} > ${budget} B`)
  }
  if (stats.counters.simplifiedFallbacks > 0) warn(`有 ${stats.counters.simplifiedFallbacks} 行繁转简长度不匹配，已回退原文。`)
  return { dataVersion, manifest, poems, ci, yun, knowledge, stats }
}

/* ================================================================== *
 * 8. CLI
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
    if (arg === '--smoke') opts.smoke = true
    else if (arg === '--offline') opts.offline = true
    else if (arg === '--source') opts.source = value()
    else if (arg === '--data-src') opts.dataSrcDir = value()
    else if (arg === '--version') opts.version = value()
    else if (arg === '--poems') opts.poems = Number(value())
    else if (arg === '--ci') opts.ci = Number(value())
    else if (arg === '--out') opts.outDir = value()
    else if (arg === '--src') opts.src = value()
    else if (arg === '--ref') opts.ref = value()
    else if (arg === '--cache') opts.cache = value()
    else if (arg === '--force') opts.force = true
    else if (arg === '--no-fetch') opts.noFetch = true
    else if (arg === '--pingshui') opts.pingshuiPath = value()
    else if (arg === '--no-rhyme-gate') opts.noRhymeGate = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return opts
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(
      '用法：node scripts/build-data.mjs [--smoke] [--version <YYYY-MM-DD.n>] [--poems <n>] [--ci <n>]\n' +
        '         [--out <dir>] [--source <dir>] [--data-src <dir>] [--ref <dir>] [--cache <dir>]\n' +
        '         [--offline] [--force] [--no-fetch] [--pingshui <平水韵表 json>] [--no-rhyme-gate]',
    )
  } else {
    buildData(opts).catch((err) => {
      console.error(`[build-data] 失败：${err?.stack ?? err}`)
      process.exitCode = 1
    })
  }
}
