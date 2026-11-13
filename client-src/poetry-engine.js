// client-src/poetry-engine.js —— 平仄/格律/诗词检测纯函数（v0.4.0 从 widget-plugin 拆出）

  export const TONE_QUATRAINS = {
    '仄起不入韵': ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],
    '仄起入韵': ['仄仄仄平平', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],
    '平起不入韵': ['平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'],
    '平起入韵': ['平平仄仄平', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'],
  }
  const TONE_ANY_CHARS = '○〇'
  const PUNCTUATION = '，。！？；、：,.!?;:「」『』（）()《》〈〉“”‘’—…·'

  export function isPunctuation(ch) {
  if (!ch) return true
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\u3000') return true
  return PUNCTUATION.indexOf(ch) >= 0
  }

  /** '平'→ping，'仄'→ze，'○'→any，其它→unknown；标点由调用方先行分流。 */
  export function toneKindOf(tone) {
  if (tone === '平') return 'ping'
  if (tone === '仄') return 'ze'
  if (tone && TONE_ANY_CHARS.indexOf(tone) >= 0) return 'any'
  if (tone && TONE_QUESTION_CHARS.indexOf(tone) >= 0) return 'unknown'
  return 'unknown'
  }

  /**

  */
  export function buildToneCells(line, toneLine, options) {
  const opts = options || {}
  const showTones = opts.showTones !== false
  const rhymeLine = opts.rhymeLine === true
  const chars = Array.from(String(line == null ? '' : line))
  const tones = Array.from(String(toneLine == null ? '' : toneLine))
  let lastCharIndex = -1
  for (let i = 0; i < chars.length; i++) {
   if (!isPunctuation(chars[i])) lastCharIndex = i
  }
  const cells = []
  for (let i = 0; i < chars.length; i++) {
   const ch = chars[i]
   const punctuation = isPunctuation(ch)
   const kind = punctuation ? 'punct' : toneKindOf(tones[i] || '')
   const annotated = showTones && !punctuation && (kind === 'ping' || kind === 'ze' || kind === 'any')
   const rhyme = rhymeLine && i === lastCharIndex
   const classes = ['dshp-ch']
   if (punctuation) classes.push('dshp-ch-punct')
   if (annotated) classes.push('dshp-ch-' + kind)
   if (rhyme) classes.push('dshp-ch-rhyme')
   cells.push({
    ch,
    tone: annotated ? (tones[i] || '') : '',
    kind,
    punctuation,
    rhyme,
    index: i,
    className: classes.join(' '),
   })
  }
  return cells
  }

  /** 按 settings.script 选诗文本：simplified→lines/title/author，original→*Original。 */
  export function selectPoemText(poem, script) {
  const src = poem && typeof poem === 'object' ? poem : {}
  const original = script === 'original'
  const lines = original && Array.isArray(src.linesOriginal) && src.linesOriginal.length
   ? src.linesOriginal
   : (Array.isArray(src.lines) ? src.lines : [])
  const title = original && src.titleOriginal ? src.titleOriginal : (src.title || '')
  const author = original && src.authorOriginal ? src.authorOriginal : (src.author || '')
  return {
   title: String(title || ''),
   author: String(author || ''),
   lines: lines.map((line) => (typeof line === 'string' ? line : '')),
  }
  }

  export function selectCiText(ci) {
  const src = ci && typeof ci === 'object' ? ci : {}
  return {
   title: String(src.title || src.rhythmic || ''),
   author: String(src.author || ''),
   lines: (Array.isArray(src.lines) ? src.lines : []).map((line) => (typeof line === 'string' ? line : '')),
  }
  }

  /** 韵脚行号（0-based）；数据缺失时退化为偶数行。 */
  export function poemRhymeLines(poem) {
  const src = poem && typeof poem === 'object' ? poem : {}
  if (Array.isArray(src.rhymeIdx) && src.rhymeIdx.length) {
   return src.rhymeIdx.filter((i) => Number.isInteger(i) && i >= 0)
  }
  const count = Array.isArray(src.lines) ? src.lines.length : 0
  const fallback = []
  for (let i = 1; i < count; i += 2) fallback.push(i)
  return fallback
  }

  /** 设置归一化：clamp scale、白名单枚举、布尔/字符串/数值类型兜底。 */
  export function buildPingshuiIndex(raw) {
  const sourceCategories = raw && Array.isArray(raw.categories) ? raw.categories : []
  const categories = sourceCategories.map((cat, index) => {
   const value = cat && typeof cat === 'object' ? cat : {}
   return {
    index,
    name: String(value.name || value.short || '韵部' + (index + 1)),
    short: String(value.short || value.name || '韵部' + (index + 1)),
    tone: (String(value.tone || '').toLowerCase() === 'ping' || value.tone === '平') ? '平' : '仄',
    chars: String(value.chars == null ? '' : value.chars),
   }
  })
  const charMap = {}
  const addChar = (ch, index) => {
   if (!ch) return
   const list = charMap[ch] || (charMap[ch] = [])
   if (list.indexOf(index) < 0) list.push(index)
  }
  const rawIndex = raw && raw.charIndex && typeof raw.charIndex === 'object' ? raw.charIndex : null
  if (rawIndex) {
   for (const ch of Object.keys(rawIndex)) {
    const arr = Array.isArray(rawIndex[ch]) ? rawIndex[ch] : []
    for (const index of arr) if (Number.isInteger(index) && categories[index]) addChar(ch, index)
   }
  }
  for (const cat of categories) for (const ch of Array.from(cat.chars)) addChar(ch, cat.index)
  function charInfo(ch) {
   const indices = charMap[ch] || []
   const cats = indices.map((index) => categories[index]).filter(Boolean)
   const tones = []
   for (const cat of cats) if (tones.indexOf(cat.tone) < 0) tones.push(cat.tone)
   const rhymes = []
   for (const cat of cats) if (cat.tone === '平' && rhymes.indexOf(cat.short) < 0) rhymes.push(cat.short)
   const candidates = []
   for (const cat of cats) candidates.push({ tone: cat.tone, name: cat.short })
   return { ch, tones, rhymes, candidates }
  }
  return { categories, charMap, charInfo, ready: categories.length > 0 }
  }

  function tonesFromToneChar(toneChar) {
  if (toneChar === '平') return ['平']
  if (toneChar === '仄') return ['仄']
  if (toneChar === '○' || toneChar === '〇') return ['平', '仄']
  return []
  }

  /** 逐字平仄标注：优先用数据里的 tones，否则查平水韵 charIndex（多音字列出候选）。 */
  export function annotatePoemLines(lines, tones, pingshui) {
  const out = []
  const toneLines = Array.isArray(tones) ? tones : []
  for (let lineIndex = 0; lineIndex < (Array.isArray(lines) ? lines.length : 0); lineIndex += 1) {
   const lineChars = Array.from(String(lines[lineIndex] == null ? '' : lines[lineIndex]))
   const toneChars = Array.from(String(toneLines[lineIndex] == null ? '' : toneLines[lineIndex]))
   const cells = []
   for (let index = 0; index < lineChars.length; index += 1) {
    const ch = lineChars[index]
    if (isPunctuation(ch)) continue
    const rawTone = toneChars[index] || ''
    const info = pingshui && typeof pingshui.charInfo === 'function' ? pingshui.charInfo(ch) : { tones: [], rhymes: [], candidates: [] }
    const allowed = rawTone ? tonesFromToneChar(rawTone) : (info.tones || [])
    cells.push({
     ch,
     allowed,
     tone: allowed.length === 0 ? '？' : allowed.length > 1 ? '○' : allowed[0],
     rhymes: info.rhymes || [],
     candidates: info.candidates || [],
    })
   }
   out.push(cells)
  }
  return out
  }

  export function patternForShape(form, start, firstRhyme) {
  const key = start + (firstRhyme ? '入韵' : '不入韵')
  const five = TONE_QUATRAINS[key] || TONE_QUATRAINS['平起不入韵']
  const size = form && form.charAt(0) === '七' ? 7 : 5
  const base = size === 7 ? five.map((line) => (line.charAt(0) === '平' ? '仄仄' : '平平') + line) : five.slice()
  const lines = form && form.charAt(1) === '律' ? base.concat(base) : base
  return lines
  }

  export function allowedRelation(cellA, cellB, relation) {
  const listA = cellA && Array.isArray(cellA.allowed) ? cellA.allowed : []
  const listB = cellB && Array.isArray(cellB.allowed) ? cellB.allowed : []
  if (!listA.length || !listB.length) return null
  for (const a of listA) {
   for (const b of listB) {
    if (relation === 'dui' ? a !== b : a === b) return true
   }
  }
  return false
  }

  export function rhymeSetOf(cell) {
  const names = cell && Array.isArray(cell.rhymes) ? cell.rhymes : []
  return names
  }

  /** 格律检测：入参为逐行 cells（annotatePoemLines 结果），返回可读报告对象。 */
  export function detectMetre(annotation, pingshui) {
  const report = {
   ok: true,
   errors: [],
   form: '',
   start: '',
   firstRhyme: false,
   meter: '',
   weakTones: !pingshui || !pingshui.ready,
   rhymeError: '',
   rhymeLines: [],
   rhymeGroup: [],
   violations: [],
   sticky: [],
   sanPing: [],
   guPing: [],
   summary: '',
  }
  const lineCount = Array.isArray(annotation) ? annotation.length : 0
  const size = lineCount ? annotation[0].length : 0
  if (![4, 8].includes(lineCount) || ![5, 7].includes(size) || annotation.some((line) => line.length !== size)) {
   report.ok = false
   report.errors.push('需要 4 句或 8 句、每句 5 或 7 个字（当前 ' + lineCount + ' 句 / 首句 ' + size + ' 字）')
   return report
  }
  report.form = (size === 5 ? '五' : '七') + (lineCount === 4 ? '绝' : '律')
  const firstLine = annotation[0]
  const startOptions = []
  const secondTones = firstLine[1] ? firstLine[1].allowed : []
  if (secondTones.indexOf('平') >= 0) startOptions.push('平起')
  if (secondTones.indexOf('仄') >= 0) startOptions.push('仄起')
  if (!startOptions.length) startOptions.push('平起', '仄起')
  const lastTones = firstLine[firstLine.length - 1] ? firstLine[firstLine.length - 1].allowed : []
  const rhymeOptions = lastTones.indexOf('平') >= 0 ? [true] : lastTones.length ? [false] : [true, false]
  if (lastTones.indexOf('平') >= 0 && lastTones.indexOf('仄') >= 0) rhymeOptions.length = 0
  if (rhymeOptions.length === 0) rhymeOptions.push(true, false)
  const mandatory = size === 5 ? [1, 3] : [1, 3, 5]
  let best = null
  for (const start of startOptions) {
   for (const firstRhyme of rhymeOptions) {
    const pattern = patternForShape(report.form, start, firstRhyme)
    let violations = 0
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
     for (const position of mandatory) {
      const cell = annotation[lineIndex][position]
      const expected = pattern[lineIndex] ? pattern[lineIndex].charAt(position) : ''
      if (!cell || !cell.allowed.length || !expected) continue
      if (cell.allowed.indexOf(expected) < 0) violations += 1
     }
    }
    if (!best || violations < best.violations) best = { start, firstRhyme, pattern, violations }
   }
  }
  report.start = best.start
  report.firstRhyme = best.firstRhyme
  report.meter = best.start + '首句' + (best.firstRhyme ? '入韵' : '不入韵')
  const pattern = best.pattern
  const rhymeIndexes = []
  for (let lineIndex = 1; lineIndex < lineCount; lineIndex += 2) rhymeIndexes.push(lineIndex)
  if (best.firstRhyme) rhymeIndexes.unshift(0)
  rhymeIndexes.sort((a, b) => a - b)
  // 拗字（二四六分明；一三五不论不报）
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
   for (const position of mandatory) {
    const cell = annotation[lineIndex][position]
    const expected = pattern[lineIndex] ? pattern[lineIndex].charAt(position) : ''
    if (!cell || !cell.allowed.length || !expected) continue
    if (cell.allowed.indexOf(expected) < 0) {
     report.violations.push({ line: lineIndex + 1, position: position + 1, ch: cell.ch, expected, actual: cell.tone })
    }
   }
  }
  // 韵脚 + 韵部（多音字取候选；首句允许借邻韵）
  const rhymeSets = []
  for (const lineIndex of rhymeIndexes) {
   const cell = annotation[lineIndex][annotation[lineIndex].length - 1]
   const isPing = cell && (cell.allowed.indexOf('平') >= 0)
   if (!isPing) report.violations.push({ line: lineIndex + 1, position: annotation[lineIndex].length, ch: cell ? cell.ch : '', expected: '平', actual: cell ? cell.tone : '？', rhyme: true })
   rhymeSets.push({ line: lineIndex, cell, names: rhymeSetOf(cell) })
  }
  if (report.weakTones) {
   report.rhymeError = '缺少平水韵数据，韵部判定已跳过'
  } else {
   const mainSets = rhymeSets.filter((entry) => entry.line !== 0)
   const anchor = mainSets.length ? mainSets[0].names : (rhymeSets[0] ? rhymeSets[0].names : [])
   const group = []
   for (const name of anchor) {
    if (mainSets.every((entry) => entry.names.indexOf(name) >= 0)) group.push(name)
   }
   report.rhymeGroup = group
   for (const entry of rhymeSets) {
    const borrowed = entry.line === 0 && !entry.names.some((name) => group.indexOf(name) >= 0)
    report.rhymeLines.push({
     line: entry.line + 1,
     ch: entry.cell ? entry.cell.ch : '',
     names: entry.names,
     borrowed: Boolean(borrowed && best.firstRhyme),
    })
    if (!group.length) continue
    if (borrowed) continue
    if (!entry.names.some((name) => group.indexOf(name) >= 0)) report.rhymeError = '第 ' + (entry.line + 1) + ' 句韵脚出韵（' + (entry.names.join('/') || '未知') + '）'
   }
   if (!group.length) report.rhymeError = report.rhymeError || '韵脚没有共同韵部（可能出韵或平水韵数据缺失）'
  }
  // 粘对（二四六分明位置）
  for (let lineIndex = 0; lineIndex + 1 < lineCount; lineIndex += 1) {
   const relation = lineIndex % 2 === 0 ? 'dui' : 'nian'
   for (const position of mandatory) {
    const ok = allowedRelation(annotation[lineIndex][position], annotation[lineIndex + 1][position], relation)
    if (ok === false) {
     report.sticky.push({ pair: (lineIndex + 1) + '-' + (lineIndex + 2), type: relation === 'dui' ? '对' : '粘', position: position + 1 })
    }
   }
  }
  // 三平调 / 孤平
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
   const cells = annotation[lineIndex]
   if (cells.length >= 3) {
    const tail = cells.slice(-3)
    if (tail.every((cell) => cell.allowed.indexOf('平') >= 0)) report.sanPing.push(lineIndex + 1)
   }
   const expectedLine = pattern[lineIndex] || ''
   const lonelyPattern = size === 5 ? '平平仄仄平' : '仄仄平平仄仄平'
   if (expectedLine === lonelyPattern) {
    const position = size === 5 ? 0 : 2
    const cell = cells[position]
    if (cell && cell.allowed.length === 1 && cell.allowed[0] === '仄') report.guPing.push(lineIndex + 1)
   }
  }
  report.annotation = annotation
  const rhymeText = report.rhymeLines.map((entry) => entry.ch + (entry.names.length ? '（' + entry.names.join('/') + '）' : '') + (entry.borrowed ? '[借韵]' : '')).join('、')
  report.summary = report.form + '，' + report.meter + '；韵脚：' + (rhymeText || '—')
   + (report.rhymeGroup.length ? '，韵部 ' + report.rhymeGroup.join('/') : '')
   + (report.rhymeError ? '；' + report.rhymeError : '')
   + '；粘对' + (report.sticky.length ? '有 ' + report.sticky.length + ' 处失粘/失对' : '成立')
   + '；拗字 ' + report.violations.filter((item) => !item.rhyme).length + ' 处'
   + (report.sanPing.length ? '；三平调：第 ' + report.sanPing.join('、') + ' 句' : '')
   + (report.guPing.length ? '；孤平：第 ' + report.guPing.join('、') + ' 句' : '')
  return report
  }

  export function detectPoem(poem, pingshui) {
  const lines = poem && Array.isArray(poem.lines) ? poem.lines : []
  const tones = poem && Array.isArray(poem.tones) ? poem.tones : null
  return detectMetre(annotatePoemLines(lines, tones, pingshui), pingshui)
  }

  /** 用户文本框输入：按换行/标点切成句，校验 4/8 句 × 5/7 字。 */
  export function parsePoemInput(text) {
  const source = String(text == null ? '' : text).trim()
  if (!source) return { error: '请输入诗句' }
  const clauses = []
  for (const row of source.split(/[\n\r]+/)) {
   for (const part of String(row).split(/[，,。.！!？?；;：:、\s]+/)) {
    const chars = Array.from(part.replace(/[^\u4e00-\u9fff]/g, ''))
    if (chars.length) clauses.push({ raw: part.trim(), chars })
   }
  }
  if (![4, 8].includes(clauses.length)) return { error: '需要 4 句或 8 句（当前 ' + clauses.length + ' 句），请用换行或标点分隔' }
  const size = clauses[0].chars.length
  if (![5, 7].includes(size)) return { error: '每句需要 5 或 7 个字（首句为 ' + size + ' 字）' }
  for (let index = 0; index < clauses.length; index += 1) {
   if (clauses[index].chars.length !== size) return { error: '第 ' + (index + 1) + ' 句为 ' + clauses[index].chars.length + ' 字，与前句 ' + size + ' 字不一致' }
  }
  return { lines: clauses }
  }

  export function detectPoemText(text, pingshui) {
  const parsed = parsePoemInput(text)
  if (parsed.error) return { ok: false, errors: [parsed.error], summary: parsed.error }
  const annotation = parsed.lines.map((clause) => annotatePoemLines([clause.raw], null, pingshui)[0])
  return detectMetre(annotation, pingshui)
  }

  export function formatDetectionReport(report) {
  if (!report) return ''
  const lines = ['【格律检测】' + (report.summary || '')]
  for (const error of report.errors || []) lines.push('⚠ ' + error)
  for (const item of report.violations || []) lines.push('· 第 ' + item.line + ' 句第 ' + item.position + ' 字「' + item.ch + '」宜' + item.expected + '（实际 ' + item.actual + '）')
  for (const item of report.sticky || []) lines.push('· 第 ' + item.pair + ' 句失' + item.type + '（第 ' + item.position + ' 字）')
  for (const line of report.sanPing || []) lines.push('· 第 ' + line + ' 句疑似三平调')
  for (const line of report.guPing || []) lines.push('· 第 ' + line + ' 句疑似孤平')
  return lines.join('\n')
  }

  export function detectionRhymeIndexes(report) {
  const set = {}
  for (const item of (report && report.rhymeLines) || []) set[item.line - 1] = true
  return set
  }

  /* ---- 剩余立绘彩蛋（双击表情 / 每日 greet / idle 姿态限频） ---- */
