#!/usr/bin/env node
/**
 * validate-data.mjs —— 数据质量门（contract §2 / §4 / §5）
 *
 * 校验 data/ 下的 manifest.json / poems.json / ci.json / yun.json / knowledge.json：
 *   - 顶层形状、dataVersion 一致性、manifest 记录与真实字节数
 *   - 诗：逐句等长、平仄字符集、无「？」、4/8 行 × 5/7 字、体式/起式/首句入韵/韵脚位置/解析文案
 *         与预计算规则一致、id 唯一、同诗去重、单作者 ≤10 首
 *   - 词：rhythmic/title/id 约束、行非空、标题生成规则、名句字段
 *   - 韵部：2 卷 × 15 章、三段原文、exampleChars 3–8 个汉字、exampleLine 出自首段
 *   - 知识：12 卡 + 15 词牌卡、id/name 唯一、summary ≤40 字、段落 ≤160 字
 *   - 体积预算：poems ≤620KB、ci ≤220KB、yun ≤80KB、knowledge ≤90KB
 *
 * 用法：node scripts/validate-data.mjs [--data <dir>] [--strict]
 *   默认：错误 → 退出码 1；warning 不阻塞（冒烟数据集应全绿）。
 *   --strict：把「数量不足 500/300」等 warning 也当失败（最终验收用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUDGETS,
  PUNCTUATION,
  TONE_CHARS,
  MAX_POEMS_PER_AUTHOR,
  MAX_VARIANCES,
  CANDIDATE_MAX_VARIANCES,
  analysisFor,
  checkRhyme,
  hasAstralChars,
  simplifyChar,
  evaluateStoredMeter,
  loadRhymeTable,
  resolveFirstLineFinal,
  DEFAULT_PINGSHUI,
  charLength,
  chars,
  firstClauseContent,
  isCJK,
  makeCiTitle,
} from './build-data.mjs'
import { SOURCE } from './fetch-data.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA = path.resolve(HERE, '..', 'data')

const POEM_FORMS = new Set(['五绝', '七绝', '五律', '七律'])
const STANCES = new Set(['平起', '仄起'])
const METERS = new Set(['平起首句入韵', '平起首句不入韵', '仄起首句入韵', '仄起首句不入韵'])
const ALLOWED_TONE_CHARS = new Set([...TONE_CHARS, ...PUNCTUATION])
const DATA_VERSION_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/

function cjkCount(text) {
  return chars(text).filter(isCJK).length
}

function readFileBuffer(file) {
  try {
    return fs.readFileSync(file)
  } catch {
    return null
  }
}

/**
 * 读取并校验全部数据文件。
 * @param {string} [dataDir]
 * @returns {{ errors: string[], warnings: string[], summary: object, data: object|null }}
 */
export function validateData(dataDir = DEFAULT_DATA) {
  const errors = []
  const warnings = []
  const err = (msg) => errors.push(msg)
  const warn = (msg) => warnings.push(msg)
  const summary = {}
  const data = { manifest: null, poems: null, ci: null, yun: null, knowledge: null, bytes: {} }
  // 押韵门 QA oracle（只读 _ref，不随包；缺失时跳过复检）
  const rhymeTable = loadRhymeTable(DEFAULT_PINGSHUI)

  // ---------- 读文件 ----------
  const manifestBuf = readFileBuffer(path.join(dataDir, 'manifest.json'))
  if (!manifestBuf) {
    err(`缺少 ${path.join(dataDir, 'manifest.json')}`)
    return { errors, warnings, summary, data }
  }
  for (const name of ['poems.json', 'ci.json', 'yun.json', 'knowledge.json']) {
    const buf = readFileBuffer(path.join(dataDir, name))
    if (!buf) {
      err(`缺少 data/${name}`)
      continue
    }
    data.bytes[name] = buf.length
    try {
      data[name.replace('.json', '')] = JSON.parse(buf.toString('utf8'))
    } catch (e) {
      err(`data/${name} 不是合法 JSON：${e.message}`)
    }
  }
  data.bytes['manifest.json'] = manifestBuf.length
  try {
    data.manifest = JSON.parse(manifestBuf.toString('utf8'))
  } catch (e) {
    err(`data/manifest.json 不是合法 JSON：${e.message}`)
    return { errors, warnings, summary, data }
  }
  const manifest = data.manifest

  // ---------- manifest ----------
  if (typeof manifest.dataVersion !== 'string' || !DATA_VERSION_RE.test(manifest.dataVersion)) {
    err(`manifest.dataVersion 形状错误（应形如 2026-10-21.1）：${manifest.dataVersion}`)
  }
  for (const key of ['repo', 'commit', 'license']) {
    if (!manifest.source || typeof manifest.source[key] !== 'string' || !manifest.source[key]) {
      err(`manifest.source.${key} 缺失或非字符串`)
    }
  }
  if (manifest.source?.repo !== SOURCE.repo) warn(`manifest.source.repo 与预期不同：${manifest.source?.repo}`)
  if (manifest.source?.commit !== SOURCE.commit) {
    warn(`manifest.source.commit=${manifest.source?.commit} 与脚本记录的 ${SOURCE.commit} 不同（源已更新？）`)
  }
  if (typeof manifest.builtAt !== 'string' || Number.isNaN(Date.parse(manifest.builtAt))) {
    err(`manifest.builtAt 不是合法 ISO 时间：${manifest.builtAt}`)
  }
  if (!manifest.files || typeof manifest.files !== 'object') {
    err('manifest.files 缺失')
  } else {
    for (const name of ['poems.json', 'ci.json', 'yun.json', 'knowledge.json']) {
      const want = data.bytes[name]
      if (manifest.files[name] !== want) {
        err(`manifest.files["${name}"]=${manifest.files[name]}，实际 ${want} 字节`)
      }
    }
  }
  if (!manifest.stats || typeof manifest.stats !== 'object') err('manifest.stats 缺失')

  const dataVersion = manifest.dataVersion

  // ---------- 诗 ----------
  const poems = data.poems
  const poemItems = poems?.items
  if (!Array.isArray(poemItems)) {
    err('poems.json: items 不是数组')
  } else {
    const ids = new Set()
    const dedupe = new Set()
    const perAuthor = new Map()
    const reported = new Set()
    const reportOnce = (key, msg) => {
      if (reported.has(key)) return
      reported.add(key)
      err(msg)
    }
    const forms = {}
    const dynasties = { tang: 0, song: 0 }
    const varianceHistogram = {}
    if (poems.ok !== true) err('poems.json: ok 应为 true')
    if (poems.dataVersion !== dataVersion) err(`poems.json: dataVersion=${poems.dataVersion} 与 manifest=${dataVersion} 不一致`)
    for (const [index, poem] of poemItems.entries()) {
      const where = `poems[${index}]${poem?.id ? `(${poem.id})` : ''}`
      if (!poem || typeof poem !== 'object') {
        reportOnce(`poem-obj-${index}`, `${where}: 不是对象`)
        continue
      }
      // id
      if (typeof poem.id !== 'string' || !/^(tang|song)-\d{6}$/.test(poem.id)) {
        reportOnce(`id-${index}`, `${where}: id 形状错误（应形如 tang-003217）：${poem.id}`)
      } else if (ids.has(poem.id)) {
        reportOnce(`id-dup-${poem.id}`, `${where}: id 重复`)
      } else ids.add(poem.id)
      if (!['tang', 'song'].includes(poem.dynasty)) reportOnce(`dyn-${index}`, `${where}: dynasty 非法：${poem.dynasty}`)
      else {
        dynasties[poem.dynasty] += 1
        if (typeof poem.id === 'string' && !poem.id.startsWith(`${poem.dynasty}-`)) {
          reportOnce(`dyn-id-${poem.id}`, `${where}: dynasty 与 id 前缀不一致`)
        }
      }
      for (const field of ['title', 'titleOriginal', 'author', 'authorOriginal', 'analysis', 'source', 'form', 'start', 'meter']) {
        if (typeof poem[field] !== 'string' || poem[field].length === 0) {
          reportOnce(`str-${field}-${index}`, `${where}: ${field} 应为非空字符串`)
        }
      }
      // 行/平仄等长
      if (!Array.isArray(poem.lines) || ![4, 8].includes(poem.lines.length)) {
        reportOnce(`lines-len-${index}`, `${where}: lines 长度应为 4 或 8`)
        continue
      }
      if (!Array.isArray(poem.linesOriginal) || poem.linesOriginal.length !== poem.lines.length) {
        reportOnce(`orig-len-${index}`, `${where}: linesOriginal 与 lines 行数不一致`)
        continue
      }
      if (!Array.isArray(poem.tones) || poem.tones.length !== poem.lines.length) {
        reportOnce(`tones-len-${index}`, `${where}: tones 与 lines 行数不一致`)
        continue
      }
      const widths = new Set()
      let lineOk = true
      for (let i = 0; i < poem.lines.length && lineOk; i += 1) {
        const line = poem.lines[i]
        const original = poem.linesOriginal[i]
        const tone = poem.tones[i]
        if (typeof line !== 'string' || typeof original !== 'string' || typeof tone !== 'string') {
          reportOnce(`line-str-${index}`, `${where}: lines/linesOriginal/tones 存在非字符串行`)
          lineOk = false
          break
        }
        if (charLength(line) !== charLength(original) || charLength(line) !== charLength(tone)) {
          reportOnce(
            `line-eq-${index}-${i}`,
            `${where} 第 ${i} 行逐字符不等长：line=${charLength(line)} original=${charLength(original)} tone=${charLength(tone)}`,
          )
          lineOk = false
          break
        }
        const width = cjkCount(line)
        if (![5, 7].includes(width)) {
          reportOnce(`line-width-${index}-${i}`, `${where} 第 ${i} 行去标点后 ${width} 字（应为 5 或 7）`)
          lineOk = false
          break
        }
        widths.add(width)
        for (const ch of chars(tone)) {
          if (!ALLOWED_TONE_CHARS.has(ch)) {
            reportOnce(`tone-char-${ch}-${index}`, `${where} tones 含非法字符「${ch}」`)
            lineOk = false
            break
          }
        }
        if (chars(tone).includes('？')) reportOnce(`tone-q-${index}`, `${where} tones 含「？」（存疑标记，应剔除）`)
        // 标点位置必须与原文一致
        const lineChars = chars(line)
        const toneChars = chars(tone)
        for (let p = 0; p < toneChars.length; p += 1) {
          if (!TONE_CHARS.has(toneChars[p]) && toneChars[p] !== lineChars[p]) {
            reportOnce(`punct-${index}-${i}-${p}`, `${where} 第 ${i} 行第 ${p} 字：平仄串标点与正文不一致`)
            lineOk = false
            break
          }
        }
      }
      if (!lineOk) continue
      if (widths.size !== 1) {
        reportOnce(`width-mix-${index}`, `${where}: 各行字数不一致（${[...widths].join('/')}）`)
        continue
      }
      const width = [...widths][0]
      const realForm = { 4: { 5: '五绝', 7: '七绝' }, 8: { 5: '五律', 7: '七律' } }[poem.lines.length]?.[width]
      if (!POEM_FORMS.has(poem.form)) reportOnce(`form-${index}`, `${where}: form 非法：${poem.form}`)
      else if (poem.form !== realForm) {
        reportOnce(`form-mismatch-${index}`, `${where}: form=${poem.form} 与行数/字数（${poem.lines.length}×${width}）不符`)
      }
      forms[poem.form] = (forms[poem.form] ?? 0) + 1
      // 起式 / 入韵 / 韵脚 / 解析：按存储的 (form,start,firstRhyme) 找标准格式重算违例数，
      // 保证「存储字段 ↔ 预生成文案」自洽，且不超出宽松阈值。
      const toneOnly = (line) => chars(line).filter((ch) => TONE_CHARS.has(ch))
      const firstTone = toneOnly(poem.tones[0])
      const firstFinal = firstTone[firstTone.length - 1]
      if (!STANCES.has(poem.start)) reportOnce(`start-${index}`, `${where}: start 非法：${poem.start}`)
      if (typeof poem.firstRhyme !== 'boolean') reportOnce(`first-${index}`, `${where}: firstRhyme 应为布尔`)
      if (!METERS.has(poem.meter)) reportOnce(`meter-${index}`, `${where}: meter 非法：${poem.meter}`)
      const expectedMeter = `${poem.start}首句${poem.firstRhyme ? '入韵' : '不入韵'}`
      if (poem.meter !== expectedMeter) reportOnce(`meter-mismatch-${index}`, `${where}: meter=${poem.meter}，应为 ${expectedMeter}`)
      if (poem.firstRhyme === true && !['平', '○'].includes(firstFinal)) {
        reportOnce(`first-rhyme-${index}`, `${where}: firstRhyme=true 但首句末字平仄为「${firstFinal}」`)
      }
      if (poem.firstRhyme === false && firstFinal === '平') {
        reportOnce(`first-norhyme-${index}`, `${where}: firstRhyme=false 但首句末字为平声`)
      }
      const secondTone = firstTone[1]
      if (secondTone === '平' && poem.start !== '平起') reportOnce(`start-check-${index}`, `${where}: 首句第二字为平，start 应为平起`)
      if (secondTone === '仄' && poem.start !== '仄起') reportOnce(`start-check-${index}`, `${where}: 首句第二字为仄，start 应为仄起`)
      const toneLines = poem.tones.map((tone) => toneOnly(tone).join(''))
      const stored = evaluateStoredMeter(toneLines, poem.form, poem.start, poem.firstRhyme)
      if (!stored.ok) {
        reportOnce(`meter-recompute-${index}`, `${where}: 按存储体式重算失败：${stored.reason}`)
        continue
      }
      varianceHistogram[stored.violations] = (varianceHistogram[stored.violations] ?? 0) + 1
      if (stored.violations > CANDIDATE_MAX_VARIANCES) {
        reportOnce(`variances-${index}`, `${where}: 变格数 ${stored.violations} 超过上限 ${CANDIDATE_MAX_VARIANCES}`)
      }
      if (poem.source === 'strains' && stored.violations > MAX_VARIANCES) {
        reportOnce(`variances-fill-${index}`, `${where}: 补足诗变格数 ${stored.violations} 超过 ${MAX_VARIANCES}`)
      }
      if (JSON.stringify(stored.rhymeIdx) !== JSON.stringify(poem.rhymeIdx)) {
        reportOnce(`rhymeidx-mismatch-${index}`, `${where}: rhymeIdx=${JSON.stringify(poem.rhymeIdx)}，重算应为 ${JSON.stringify(stored.rhymeIdx)}`)
      }
      for (const idx of poem.rhymeIdx) {
        if (!poem.tones[idx]) continue
        const finalTone = toneOnly(poem.tones[idx]).at(-1)
        if (!['平', '○'].includes(finalTone)) {
          reportOnce(`rhyme-final-${index}-${idx}`, `${where}: 韵脚行 ${idx} 末字平仄不是「平」`)
        }
      }
      for (let i = 0; i < poem.lines.length; i += 1) {
        if (poem.rhymeIdx.includes(i)) continue
        const finalTone = toneOnly(poem.tones[i]).at(-1)
        if (finalTone === '平') reportOnce(`nonrhyme-final-${index}-${i}`, `${where}: 非韵脚行 ${i} 末字却是平声`)
      }
      if (typeof poem.analysis !== 'string' || poem.analysis.length === 0) {
        reportOnce(`analysis-${index}`, `${where}: analysis 缺失`)
      } else {
        const expectedAnalysis = analysisFor(poem.form, poem.start, poem.firstRhyme, stored.violations)
        if (poem.analysis !== expectedAnalysis) {
          reportOnce(`analysis-mismatch-${index}`, `${where}: analysis 与预生成模板不一致（期望 ${expectedAnalysis}）`)
        }
      }
      // 押韵门复检（构建期 QA oracle 可用时）：韵脚必须同属平水韵平声韵部（首句可借韵）
      if (rhymeTable) {
        const rhyme = checkRhyme(poem.linesOriginal, poem.rhymeIdx, rhymeTable)
        if (!rhyme.ok) reportOnce(`rhyme-${index}`, `${where}: 押韵门不合格（${rhyme.reason}: ${rhyme.detail}）`)
      }
      if (typeof poem.score !== 'number' || !Number.isFinite(poem.score) || poem.score < 0) {
        reportOnce(`score-${index}`, `${where}: score 应为非负有限数字`)
      }
      if (!['strains', 'curated-matched'].includes(poem.source)) {
        reportOnce(`source-${index}`, `${where}: source 非法：${poem.source}`)
      }
      // 生僻字与简体残留（Lead 2026-10-21 v4 质量门）
      for (const field of [poem.title, poem.author]) {
        if (hasAstralChars(field)) reportOnce(`astral-${index}`, `${where}: 含 CJK Ext-B+ 生僻字（codepoint > 0xFFFF）`)
      }
      for (const [i, line] of poem.lines.entries()) {
        if (hasAstralChars(line)) reportOnce(`astral-line-${index}-${i}`, `${where} 第 ${i} 行含 CJK Ext-B+ 生僻字`)
      }
      for (const field of [poem.title, poem.author, ...poem.lines]) {
        for (const ch of chars(field)) {
          const simplified = simplifyChar(ch)
          if (isCJK(ch) && simplified !== ch && !hasAstralChars(simplified)) {
            reportOnce(`residual-${ch}-${index}`, `${where}: display 字段含未简化字「${ch}」（应为简体）`)
          }
        }
      }
      // 作者配额（仅补足诗受 ≤10 首约束；精选名篇按选集顺序保留）/ 去重
      const authorKey = poem.author ?? ''
      if (poem.source === 'strains') {
        const used = perAuthor.get(authorKey) ?? 0
        perAuthor.set(authorKey, used + 1)
        if (used >= MAX_POEMS_PER_AUTHOR) {
          reportOnce(`author-quota-${authorKey}`, `${where}: 补足诗作者「${authorKey}」超过 ${MAX_POEMS_PER_AUTHOR} 首配额`)
        }
      }
      const dupKey = `${poem.author}\u0000${poem.title}\u0000${firstClauseContent(poem.lines[0] ?? '')}`
      if (dedupe.has(dupKey)) reportOnce(`poem-dup-${dupKey}`, `${where}: 与已入选诗重复（author+title+首句）`)
      else dedupe.add(dupKey)
    }
    summary.poems = poemItems.length
    summary.poemDynasties = dynasties
    summary.poemForms = forms
    summary.poemVariances = varianceHistogram
    if (poemItems.length < 250) err(`诗数量 ${poemItems.length} < 250（质量下限）`)
    else if (poemItems.length < 320) warn(`诗数量 ${poemItems.length} < 320（最终目标区间 320–450；冒烟构建可忽略）`)
    if (manifest.stats?.poemsKept !== poemItems.length) {
      err(`manifest.stats.poemsKept=${manifest.stats?.poemsKept} 与实际 ${poemItems.length} 不一致`)
    }
  }

  // ---------- 词 ----------
  const ci = data.ci
  const ciItems = ci?.items
  if (!Array.isArray(ciItems)) {
    err('ci.json: items 不是数组')
  } else {
    const ids = new Set()
    const dedupe = new Set()
    let quoteCount = 0
    const reported = new Set()
    const reportOnce = (key, msg) => {
      if (reported.has(key)) return
      reported.add(key)
      err(msg)
    }
    if (ci.ok !== true) err('ci.json: ok 应为 true')
    if (ci.dataVersion !== dataVersion) err(`ci.json: dataVersion=${ci.dataVersion} 与 manifest 不一致`)
    for (const [index, item] of ciItems.entries()) {
      const where = `ci[${index}]${item?.id ? `(${item.id})` : ''}`
      if (!item || typeof item !== 'object') {
        reportOnce(`ci-obj-${index}`, `${where}: 不是对象`)
        continue
      }
      if (typeof item.id !== 'string' || !/^ci-\d{6}$/.test(item.id)) {
        reportOnce(`ci-id-${index}`, `${where}: id 形状错误（应形如 ci-000123）：${item.id}`)
      } else if (ids.has(item.id)) reportOnce(`ci-id-dup-${item.id}`, `${where}: id 重复`)
      else ids.add(item.id)
      if (typeof item.author !== 'string' || !item.author) reportOnce(`ci-author-${index}`, `${where}: author 非空字符串`)
      if (typeof item.rhythmic !== 'string' || !item.rhythmic) reportOnce(`ci-rhythmic-${index}`, `${where}: rhythmic 非空字符串`)
      if (!Array.isArray(item.lines) || item.lines.length < 2) {
        reportOnce(`ci-lines-${index}`, `${where}: lines 至少 2 行`)
      } else if (item.lines.some((line) => typeof line !== 'string' || !line.trim())) {
        reportOnce(`ci-lines-empty-${index}`, `${where}: lines 存在空行`)
      }
      if (typeof item.title !== 'string' || charLength(item.title) === 0 || charLength(item.title) > 40) {
        reportOnce(`ci-title-${index}`, `${where}: title 应为非空且 ≤40 字符`)
      } else if (Array.isArray(item.lines) && item.lines[0] && item.rhythmic) {
        const expected = makeCiTitle(item.rhythmic, item.lines)
        if (item.title !== expected) reportOnce(`ci-title-rule-${index}`, `${where}: title=${item.title}，按规则应为 ${expected}`)
      }
      if (typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0) {
        reportOnce(`ci-score-${index}`, `${where}: score 应为非负有限数字`)
      }
      // v4 质量门：作者不得单字截断；词牌不得含「・」合称；正文不得有未简化繁体/异体字
      if (typeof item.author === 'string' && charLength(item.author) < 2) {
        reportOnce(`ci-author-single-${index}`, `${where}: 作者「${item.author}」为单字截断`)
      }
      if (typeof item.rhythmic === 'string' && item.rhythmic.includes('・')) {
        reportOnce(`ci-rhythmic-split-${index}`, `${where}: rhythmic「${item.rhythmic}」仍含合称分隔符「・」`)
      }
      for (const field of [item.rhythmic, item.title, item.quote, ...(Array.isArray(item.lines) ? item.lines : [])]) {
        if (typeof field !== 'string') continue
        if (hasAstralChars(field)) reportOnce(`ci-astral-${index}`, `${where}: 词文本含 CJK Ext-B+ 生僻字`)
        for (const ch of chars(field)) {
          const simplified = simplifyChar(ch)
          if (isCJK(ch) && simplified !== ch && !hasAstralChars(simplified)) {
            reportOnce(`ci-residual-${ch}-${index}`, `${where}: 词文本含未简化字「${ch}」`)
          }
        }
      }
      if (typeof item.quote !== 'string') reportOnce(`ci-quote-${index}`, `${where}: quote 应为字符串`)
      else if (item.quote) quoteCount += 1
      if (Array.isArray(item.lines) && item.lines.length > 0 && item.author && item.rhythmic) {
        const dupKey = `${item.author}\u0000${item.rhythmic}\u0000${firstClauseContent(item.lines[0])}`
        if (dedupe.has(dupKey)) reportOnce(`ci-dup-${dupKey}`, `${where}: 与已入选词重复（author+rhythmic+首句）`)
        else dedupe.add(dupKey)
      }
    }
    summary.ci = ciItems.length
    summary.ciWithQuote = quoteCount
    if (ciItems.length < 150) err(`词数量 ${ciItems.length} < 150（质量下限）`)
    else if (ciItems.length < 150) warn(`词数量 ${ciItems.length} < 150`)
    if (manifest.stats?.ciKept !== ciItems.length) {
      err(`manifest.stats.ciKept=${manifest.stats?.ciKept} 与实际 ${ciItems.length} 不一致`)
    }
    if ((manifest.stats?.ciCorpusFallback ?? 0) > 5) {
      warn(`词典正文回退选集 ${manifest.stats.ciCorpusFallback} 首（选集正文有系统性缺字，建议全部用语料正文）`)
    }
    const covered = new Set(ciItems.map((item) => item.rhythmic))
    const missingCards = ['浣溪沙', '蝶恋花', '临江仙', '水调歌头', '念奴娇', '定风波', '雨霖铃', '声声慢', '如梦令', '虞美人', '鹊桥仙', '青玉案', '破阵子', '鹧鸪天', '满江红'].filter((name) => !covered.has(name))
    if (missingCards.length > 0) err(`15 张词牌卡缺对应词作：${missingCards.join('、')}`)
  }

  // ---------- 韵部 ----------
  const yun = data.yun
  if (!yun || !Array.isArray(yun.volumes)) {
    err('yun.json: volumes 不是数组')
  } else {
    if (yun.ok !== true) err('yun.json: ok 应为 true')
    if (yun.dataVersion !== dataVersion) err(`yun.json: dataVersion=${yun.dataVersion} 与 manifest 不一致`)
    if (yun.volumes.length !== 2) err(`yun.json: volumes 应为 2 卷，实际 ${yun.volumes.length}`)
    const names = new Set()
    let chapterTotal = 0
    for (const [vi, volume] of yun.volumes.entries()) {
      if (!volume || typeof volume.title !== 'string' || !volume.title) err(`yun.volumes[${vi}]: title 缺失`)
      if (!Array.isArray(volume?.chapters) || volume.chapters.length !== 15) {
        err(`yun.volumes[${vi}]: chapters 应为 15，实际 ${volume?.chapters?.length}`)
        continue
      }
      for (const [ci2, chapter] of volume.chapters.entries()) {
        chapterTotal += 1
        const where = `yun[${vi}][${ci2}]${chapter?.name ? `(${chapter.name})` : ''}`
        if (!chapter || typeof chapter !== 'object') {
          err(`${where}: 章节不是对象`)
          continue
        }
        if (typeof chapter.name !== 'string' || !/^[一二三四五六七八九十]+ [^\s]+$/.test(chapter.name)) {
          err(`${where}: name 应形如「一 东」：${chapter.name}`)
        } else if (names.has(chapter.name)) err(`${where}: name 重复`)
        else names.add(chapter.name)
        if (typeof chapter.rhyme !== 'string' || !chapter.rhyme) err(`${where}: rhyme 缺失`)
        else if (typeof chapter.name === 'string' && chapter.rhyme !== chapter.name.split(' ')[1]) {
          err(`${where}: rhyme=${chapter.rhyme} 应为 name 的韵目`)
        }
        if (!Array.isArray(chapter.paragraphs) || chapter.paragraphs.length !== 3) {
          err(`${where}: paragraphs 应为 3 段`)
        } else if (chapter.paragraphs.some((p) => typeof p !== 'string' || !p.trim())) {
          err(`${where}: paragraphs 存在空段`)
        }
        if (!Array.isArray(chapter.exampleChars) || chapter.exampleChars.length < 3 || chapter.exampleChars.length > 8) {
          err(`${where}: exampleChars 长度应为 3–8`)
        } else {
          for (const ch of chapter.exampleChars) {
            if (typeof ch !== 'string' || charLength(ch) !== 1 || !isCJK(ch)) err(`${where}: exampleChars 含非法字「${ch}」`)
          }
          if (new Set(chapter.exampleChars).size !== chapter.exampleChars.length) err(`${where}: exampleChars 有重复字`)
        }
        if (typeof chapter.exampleLine !== 'string' || !chapter.exampleLine) {
          err(`${where}: exampleLine 缺失`)
        } else if (Array.isArray(chapter.paragraphs) && typeof chapter.paragraphs[0] === 'string' && !chapter.paragraphs[0].startsWith(chapter.exampleLine)) {
          err(`${where}: exampleLine 不是首段开头的完整句`)
        }
      }
    }
    if (chapterTotal !== 30) err(`yun.json: 韵部总数应为 30，实际 ${chapterTotal}`)
    summary.yunChapters = chapterTotal
  }

  // ---------- 知识 ----------
  const knowledge = data.knowledge
  if (!knowledge) {
    err('knowledge.json 缺失')
  } else {
    if (knowledge.ok !== true) err('knowledge.json: ok 应为 true')
    if (knowledge.dataVersion !== dataVersion) err(`knowledge.json: dataVersion=${knowledge.dataVersion} 与 manifest 不一致`)
    const cards = knowledge.cards
    const ciCards = knowledge.ciCards
    if (!Array.isArray(cards) || cards.length !== 12) err(`knowledge.cards 应为 12 张，实际 ${Array.isArray(cards) ? cards.length : '非数组'}`)
    if (!Array.isArray(ciCards) || ciCards.length !== 15) err(`knowledge.ciCards 应为 15 张，实际 ${Array.isArray(ciCards) ? ciCards.length : '非数组'}`)
    const cardIds = new Set()
    for (const [index, card] of (Array.isArray(cards) ? cards : []).entries()) {
      const where = `cards[${index}]${card?.id ? `(${card.id})` : ''}`
      if (typeof card?.id !== 'string' || !card.id) err(`${where}: id 缺失`)
      else if (cardIds.has(card.id)) err(`${where}: id 重复`)
      else cardIds.add(card.id)
      if (typeof card?.title !== 'string' || !card.title) err(`${where}: title 缺失`)
      if (typeof card?.summary !== 'string' || charLength(card.summary) > 40) err(`${where}: summary 应 ≤40 字符`)
      if (!Array.isArray(card?.paragraphs) || card.paragraphs.length === 0) err(`${where}: paragraphs 缺失`)
      else if (card.paragraphs.some((p) => typeof p !== 'string' || charLength(p) > 160)) err(`${where}: paragraphs 存在超 160 字符或非字符串段落`)
      if (!Array.isArray(card?.examples)) err(`${where}: examples 应为数组`)
      else {
        for (const ex of card.examples) {
          if (typeof ex?.text !== 'string' || !ex.text) err(`${where}: examples[].text 缺失`)
          if (typeof ex?.note !== 'string') err(`${where}: examples[].note 应为字符串`)
        }
      }
    }
    const ciNames = new Set()
    const ciIds = new Set()
    for (const [index, card] of (Array.isArray(ciCards) ? ciCards : []).entries()) {
      const where = `ciCards[${index}]${card?.name ? `(${card.name})` : ''}`
      for (const field of ['id', 'name', 'form', 'rhyme', 'note', 'example']) {
        if (typeof card?.[field] !== 'string') err(`${where}: ${field} 应为字符串`)
      }
      if (typeof card?.name === 'string' && card.name) {
        if (ciNames.has(card.name)) err(`${where}: name 重复`)
        else ciNames.add(card.name)
      }
      if (typeof card?.id === 'string' && card.id) {
        if (ciIds.has(card.id)) err(`${where}: id 重复`)
        else ciIds.add(card.id)
      }
      if (!Array.isArray(card?.aliases)) err(`${where}: aliases 应为数组`)
    }
    summary.cards = Array.isArray(cards) ? cards.length : 0
    summary.ciCards = Array.isArray(ciCards) ? ciCards.length : 0
  }

  // ---------- 体积预算 ----------
  for (const [name, budget] of Object.entries(BUDGETS)) {
    const bytes = data.bytes[name]
    if (bytes === undefined) continue
    summary.bytes = summary.bytes ?? {}
    summary.bytes[name] = bytes
    if (bytes > budget) err(`${name} 体积 ${bytes} B 超出预算 ${budget} B`)
  }

  return { errors, warnings, summary, data }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--data') opts.dataDir = argv[++i]
    else if (arg === '--strict') opts.strict = true
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
      console.log('用法：node scripts/validate-data.mjs [--data <dir>] [--strict]')
      process.exit(0)
    }
    const dataDir = path.resolve(opts.dataDir ?? DEFAULT_DATA)
    const { errors, warnings, summary, data } = validateData(dataDir)
    const dv = data.manifest?.dataVersion ?? '?'
    console.log(`validate-data: ${dataDir}（dataVersion=${dv}）`)
    console.log(
      `  诗 ${summary.poems ?? 0} / 词 ${summary.ci ?? 0} / 韵部 ${summary.yunChapters ?? 0} / ` +
        `知识卡 ${summary.cards ?? 0} / 词牌卡 ${summary.ciCards ?? 0}`,
    )
    if (summary.poemForms) console.log(`  诗体分布：${JSON.stringify(summary.poemForms)}`)
    if (summary.bytes) {
      const bytesText = Object.entries(summary.bytes)
        .map(([name, bytes]) => `${name}=${bytes}B`)
        .join('  ')
      console.log(`  文件体积：${bytesText}`)
    }
    for (const warning of warnings) console.log(`  [warn] ${warning}`)
    if (errors.length > 0) {
      for (const message of errors.slice(0, 40)) console.error(`  ✗ ${message}`)
      if (errors.length > 40) console.error(`  …… 另有 ${errors.length - 40} 条错误未显示`)
      console.error(`\nvalidate-data：失败（${errors.length} 个错误，${warnings.length} 个 warning）`)
      process.exitCode = 1
    } else {
      const strictFail = Boolean(opts.strict) && warnings.length > 0
      console.log(`\nvalidate-data：通过（0 个错误，${warnings.length} 个 warning）${strictFail ? '；--strict 模式下 warning 视为失败' : ''}`)
      if (strictFail) process.exitCode = 1
    }
  } catch (error) {
    console.error(`[validate-data] 失败：${error?.stack ?? error}`)
    process.exitCode = 1
  }
}
