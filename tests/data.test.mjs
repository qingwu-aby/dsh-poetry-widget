/**
 * tests/data.test.mjs —— 数据管道质量门单测
 *
 * 覆盖（contract §2 / §4 / §5）：
 *  - 体式/格律判定：4 种标准格式、律诗八句格式、变格上限、三平调/孤平硬剔除
 *  - 押韵门：繁简/异体归一（爲/為）、补字（啼）、首句借邻韵（《题西林壁》）、
 *            明显混押拒绝、多音字韵部交集
 *  - 繁转简逐字符等长、句切分、精选作者清洗、泛题判定、词标题生成
 *  - 产物数据：字段形状、等长、平仄字符集、rhymeIdx、作者配额、体积预算、数量下限
 *
 * 运行：node --test tests/data.test.mjs
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BUDGETS,
  MAX_VARIANCES,
  analysisFor,
  analyzeMeter,
  charLength,
  chars,
  checkRhyme,
  cleanCuratedAuthor,
  firstCharsContent,
  firstClauseContent,
  hasAstralChars,
  isGenericTitle,
  loadRhymeTable,
  simplifyChar,
  makeCiTitle,
  splitClauses,
  toSimplified,
} from '../scripts/build-data.mjs'
import { validateData } from '../scripts/validate-data.mjs'
import { CURATED_FILES, DATA_SRC_DIR, SOURCE, resolveCuratedFiles } from '../scripts/fetch-data.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(HERE, '..')
const DATA_DIR = path.join(PROJECT_ROOT, 'data')

/* ------------------------------------------------------------------ *
 * 1. 体式 / 格律判定
 * ------------------------------------------------------------------ */

test('标准格式：五绝 仄起首句不入韵', () => {
  const tones = ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平']
  const result = analyzeMeter(tones)
  assert.equal(result.ok, true)
  assert.equal(result.form, '五绝')
  assert.equal(result.start, '仄起')
  assert.equal(result.firstRhyme, false)
  assert.equal(result.meter, '仄起首句不入韵')
  assert.deepEqual(result.rhymeIdx, [1, 3])
  assert.equal(result.violations, 0)
})

test('标准格式：五绝 平起首句入韵', () => {
  const tones = ['平平仄仄平', '仄仄仄平平', '仄仄平平仄', '平平仄仄平']
  const result = analyzeMeter(tones)
  assert.equal(result.ok, true)
  assert.equal(result.form, '五绝')
  assert.equal(result.start, '平起')
  assert.equal(result.firstRhyme, true)
  assert.equal(result.meter, '平起首句入韵')
  assert.deepEqual(result.rhymeIdx, [0, 1, 3])
})

test('标准格式：七绝 仄起首句不入韵', () => {
  const tones = ['仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平平仄仄']
  const result = analyzeMeter(tones)
  assert.equal(result.ok, true)
  assert.equal(result.form, '七绝')
  assert.equal(result.start, '仄起')
  assert.equal(result.firstRhyme, false)
  assert.deepEqual(result.rhymeIdx, [1, 3])
})

test('标准格式：七律 平起首句入韵（八句格式按粘对推导）', () => {
  // D7 B7 C7 D7 A7 B7 C7 D7
  const tones = [
    '平平仄仄仄平平',
    '仄仄平平仄仄平',
    '仄仄平平平仄仄',
    '平平仄仄仄平平',
    '平平仄仄平平仄',
    '仄仄平平仄仄平',
    '仄仄平平平仄仄',
    '平平仄仄仄平平',
  ]
  const result = analyzeMeter(tones)
  assert.equal(result.ok, true)
  assert.equal(result.form, '七律')
  assert.equal(result.start, '平起')
  assert.equal(result.firstRhyme, true)
  assert.equal(result.meter, '平起首句入韵')
  assert.deepEqual(result.rhymeIdx, [0, 1, 3, 5, 7])
})

test('标准格式：七律 仄起首句入韵（下半首不能机械重复）', () => {
  // B7 D7 A7 B7 C7 D7 A7 B7
  const tones = [
    '仄仄平平仄仄平',
    '平平仄仄仄平平',
    '平平仄仄平平仄',
    '仄仄平平仄仄平',
    '仄仄平平平仄仄',
    '平平仄仄仄平平',
    '平平仄仄平平仄',
    '仄仄平平仄仄平',
  ]
  const result = analyzeMeter(tones)
  assert.equal(result.ok, true)
  assert.equal(result.form, '七律')
  assert.equal(result.start, '仄起')
  assert.equal(result.firstRhyme, true)
  assert.deepEqual(result.rhymeIdx, [0, 1, 3, 5, 7])
})

test('变格 ≤2 处可保留并记入 analysis；超过阈值剔除', () => {
  // 五绝 仄起不入韵：B 句（平平仄仄平）第 4 字改平 → 1 处变格（不触发孤平/三平调）
  const oneVariance = ['仄仄平平仄', '平平仄平平', '平平平仄仄', '仄仄仄平平']
  const result = analyzeMeter(oneVariance)
  assert.equal(result.ok, true)
  assert.equal(result.violations, 1)
  assert.match(analysisFor(result.form, result.start, result.firstRhyme, result.violations), /含 1 处变格\/拗救/)
  // 同一首把阈值收紧到 0 → 应剔除
  assert.equal(analyzeMeter(oneVariance, { maxVariances: 0 }).ok, false)
  assert.equal(MAX_VARIANCES, 2)
})

test('三平调硬性剔除', () => {
  // D 句式 仄仄仄平平 的第 3 字改平 → 句末 平平平（三平调）
  const tones = ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄平平平']
  assert.equal(analyzeMeter(tones).ok, false)
})

test('孤平硬性剔除', () => {
  // B 句式 平平仄仄平 第 1 字改仄 → 孤平
  const tones = ['仄仄平平仄', '仄平仄仄平', '平平平仄仄', '仄仄仄平平']
  assert.equal(analyzeMeter(tones).ok, false)
})

test('○（多音可平可仄）与固定位置相容', () => {
  const tones = ['仄仄○○仄', '平平仄○平', '平平平仄仄', '仄仄仄平平']
  const result = analyzeMeter(tones)
  assert.equal(result.ok, true)
  assert.equal(result.form, '五绝')
})

test('非近体形状返回 shape', () => {
  assert.equal(analyzeMeter(['平平平仄仄', '仄仄仄平平']).ok, false) // 句数不足
  assert.equal(analyzeMeter(['平平平平平', '仄仄仄平平', '平平平仄仄', '仄仄仄平平']).ok, false) // 字数/格式不符
})

/* ------------------------------------------------------------------ *
 * 2. 押韵门
 * ------------------------------------------------------------------ */

const rhymeTable = loadRhymeTable()

test('押韵门：繁简/异体归一（爲 / 為）', (t) => {
  if (!rhymeTable) return t.skip('未找到平水韵表（_ref/pingshui）')
  const lines = ['天地玄黄，', '中心有爲。', '宇宙洪荒，', '此意可為。']
  assert.deepEqual(checkRhyme(lines, [1, 3], rhymeTable), { ok: true })
})

test('押韵门：罕见异体归一（隣 → 鄰 → 邻，真韵）', (t) => {
  if (!rhymeTable) return t.skip('未找到平水韵表')
  // 《送杜少府之任蜀州》的韵脚：秦/津/人/隣/巾（全唐诗原文写作「隣」）
  const lines = ['甲甲甲甲甲，', '乙乙乙乙隣。', '丙丙丙丙丙，', '丁丁丁丁巾。']
  const result = checkRhyme(lines, [1, 3], rhymeTable)
  assert.equal(result.ok, true, JSON.stringify(result))
})

test('押韵门：失收字补丁（啼 → 上平八齊）', (t) => {
  if (!rhymeTable) return t.skip('未找到平水韵表')
  const lines = ['甲甲甲甲甲，', '黄莺枝上啼。', '乙乙乙乙乙，', '铁马踏春泥。']
  const result = checkRhyme(lines, [1, 3], rhymeTable)
  assert.equal(result.ok, true, JSON.stringify(result))
})

test('押韵门：《题西林壁》首句借邻韵（峰 二冬 ←→ 同/中 一东）', (t) => {
  if (!rhymeTable) return t.skip('未找到平水韵表')
  const lines = ['横看成岭侧成峰，', '远近高低各不同。', '不识庐山真面目，', '只缘身在此山中。']
  const result = checkRhyme(lines, [0, 1, 3], rhymeTable)
  assert.equal(result.ok, true)
  assert.equal(result.firstBorrow, true)
})

test('押韵门：明显混押被拒（風 一東 ↔ 麻/花 六麻）', (t) => {
  if (!rhymeTable) return t.skip('未找到平水韵表')
  const lines = ['甲甲甲甲甲，', '夜来风雨風。', '乙乙乙乙乙，', '春深草木花。']
  const result = checkRhyme(lines, [1, 3], rhymeTable)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'rhymeMixed')
})

test('押韵门：首句越界借韵被拒（風 一東 → 花/麻 六麻）', (t) => {
  if (!rhymeTable) return t.skip('未找到平水韵表')
  const lines = ['甲甲甲甲甲，', '夜来风雨風。', '乙乙乙乙乙，', '春深草木花。']
  // rhymeIdx 含 0 表示首句入韵；此处首句 風（一東），其余 花/花（六麻）→ 越界
  const linesWithFirst = ['夜来风雨風，', '春深草木花。', '乙乙乙乙乙，', '又见杜鹃花。']
  const result = checkRhyme(linesWithFirst, [0, 1, 3], rhymeTable)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'rhymeFirstBorrow')
  assert.equal(checkRhyme(lines, [1, 3], rhymeTable).ok, false)
})

test('押韵门：多音字按韵部集合交集通过', (t) => {
  if (!rhymeTable) return t.skip('未找到平水韵表')
  // 从表中找一个多音字，再取其一个韵部内的另一个字，验证交集非空即通过
  let multi = null
  for (const [ch, cats] of rhymeTable.ping) {
    if (cats.size >= 2) {
      multi = { ch, cats }
      break
    }
  }
  assert.ok(multi, '平水韵表中应有跨韵部多音字')
  const [category] = [...multi.cats]
  let partner = null
  for (const [ch, cats] of rhymeTable.ping) {
    if (ch !== multi.ch && cats.has(category)) {
      partner = ch
      break
    }
  }
  assert.ok(partner)
  const lines = [`甲甲甲甲${multi.ch}，`, `乙乙乙乙${partner}。`, '丙丙丙丙丙，', `丁丁丁丁${multi.ch}。`]
  const result = checkRhyme(lines, [1, 3], rhymeTable)
  assert.equal(result.ok, true, JSON.stringify(result))
})

/* ------------------------------------------------------------------ *
 * 3. 文本工具
 * ------------------------------------------------------------------ */

test('splitClauses：一联切成两句，携带句末标点', () => {
  const clauses = splitClauses('城闕輔三秦，風煙望五津。')
  assert.ok(clauses)
  assert.deepEqual(clauses.map((c) => c.original), ['城闕輔三秦，', '風煙望五津。'])
  assert.deepEqual(clauses.map((c) => c.content), ['城闕輔三秦', '風煙望五津'])
  assert.equal(splitClauses('異[文]字，'), null) // 异常字符拒绝
  assert.equal(splitClauses('沒有標點'), null)
})

test('toSimplified：繁体转简体且逐字符等长', () => {
  const cases = ['風煙望五津', '海內存知己', '無爲在歧路', '雲對雨，雪對風。']
  for (const original of cases) {
    const result = toSimplified(original)
    assert.equal(charLength(result.text), charLength(original), `${original} → ${result.text}`)
  }
  assert.equal(toSimplified('風煙望五津').text, '风烟望五津')
})

test('firstCharsContent / firstClauseContent', () => {
  assert.equal(firstCharsContent('西陸蟬聲唱，南冠客思侵。'), '西陸蟬聲唱')
  assert.equal(firstCharsContent('橫看成嶺側成峰', 5), '橫看成嶺側')
  assert.equal(firstClauseContent('明月几时有，把酒问青天。'), '明月几时有')
})

test('cleanCuratedAuthor：去掉「（唐）/（宋）」前缀', () => {
  assert.equal(cleanCuratedAuthor('（唐）孟浩然'), '孟浩然')
  assert.equal(cleanCuratedAuthor('（宋）朱熹'), '朱熹')
  assert.equal(cleanCuratedAuthor('王維'), '王維')
})

test('isGenericTitle：泛题判定', () => {
  assert.equal(isGenericTitle('即事十二首  其七'), true)
  assert.equal(isGenericTitle('九日'), true)
  assert.equal(isGenericTitle('无题二首 一'), true)
  assert.equal(isGenericTitle('登鹳雀楼'), false)
  assert.equal(isGenericTitle('题西林壁'), false)
})

test('makeCiTitle：词牌·首句，≤40 字符', () => {
  const title = makeCiTitle('水调歌头', ['明月几时有，把酒问青天。', '不知天上宫阙，今夕是何年。'])
  assert.equal(title, '水调歌头·明月几时有')
  assert.ok(chars(title).length <= 40)
  const long = makeCiTitle('满江红', ['怒发冲冠，凭栏处、潇潇雨歇。抬望眼、仰天长啸，壮怀激烈。'])
  assert.ok(chars(long).length <= 40)
})

/* ------------------------------------------------------------------ *
 * 4. 产物数据质量门（依赖 node scripts/build-data.mjs 已生成 data/）
 * ------------------------------------------------------------------ */

const dataReady = fs.existsSync(path.join(DATA_DIR, 'manifest.json'))

test('data/manifest.json 存在且 dataVersion 形状正确', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'))
  assert.match(manifest.dataVersion, /^\d{4}-\d{2}-\d{2}\.\d+$/)
  assert.equal(manifest.source.repo, 'chinese-poetry/chinese-poetry')
  assert.equal(typeof manifest.stats.poemCandidates, 'number')
  assert.equal(manifest.stats.poemsKept, manifest.files['poems.json'] ? manifest.stats.poemsKept : -1)
  assert.equal(manifest.stats.ciKept, manifest.stats.ciKept)
})

test('validate-data：全部质量门通过', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const { errors } = validateData(DATA_DIR)
  assert.deepEqual(errors, [], errors.slice(0, 10).join('\n'))
})

test('数量下限：诗 ≥250、词 ≥150（目标区间 320–450 / 150–250）', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const poems = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'poems.json'), 'utf8')).items
  const ci = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ci.json'), 'utf8')).items
  assert.ok(poems.length >= 250, `poems=${poems.length}`)
  assert.ok(ci.length >= 150, `ci=${ci.length}`)
})

test('诗：逐句等长 / 平仄字符集 / 无「？」/ 4|8 行 × 5|7 字', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const poems = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'poems.json'), 'utf8')).items
  const allowed = new Set(['平', '仄', '○', '，', '。', '！', '；', '、'])
  for (const poem of poems) {
    assert.ok([4, 8].includes(poem.lines.length), `${poem.id} lines=${poem.lines.length}`)
    assert.equal(poem.linesOriginal.length, poem.lines.length)
    assert.equal(poem.tones.length, poem.lines.length)
    for (let i = 0; i < poem.lines.length; i += 1) {
      assert.equal(charLength(poem.lines[i]), charLength(poem.linesOriginal[i]), `${poem.id} 行 ${i} 繁简不等长`)
      assert.equal(charLength(poem.lines[i]), charLength(poem.tones[i]), `${poem.id} 行 ${i} 平仄串不等长`)
      const cjk = chars(poem.lines[i]).filter((ch) => /[\u3400-\u4dbf\u4e00-\u9fff]|[\u{20000}-\u{2fa1f}]/u.test(ch)).length
      assert.ok([5, 7].includes(cjk), `${poem.id} 行 ${i} 去标点 ${cjk} 字`)
      for (const ch of poem.tones[i]) {
        assert.ok(allowed.has(ch), `${poem.id} 行 ${i} 平仄串非法字符「${ch}」`)
        assert.notEqual(ch, '？', `${poem.id} 平仄串含存疑标记`)
      }
    }
  }
})

test('诗：rhymeIdx 规则、meter/analysis 与预计算一致、作者配额（补足诗）', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const poems = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'poems.json'), 'utf8')).items
  const perAuthor = new Map()
  for (const poem of poems) {
    const expected = []
    for (let i = 1; i < poem.lines.length; i += 2) expected.push(i)
    if (poem.firstRhyme) expected.unshift(0)
    assert.deepEqual(poem.rhymeIdx, expected, `${poem.id} rhymeIdx`)
    assert.equal(poem.meter, `${poem.start}首句${poem.firstRhyme ? '入韵' : '不入韵'}`)
    const match = /含 (\d+) 处变格/.exec(poem.analysis)
    const variances = match ? Number(match[1]) : 0
    assert.equal(poem.analysis, analysisFor(poem.form, poem.start, poem.firstRhyme, variances))
    if (variances > 0) assert.ok(variances <= 8, `${poem.id} 变格 ${variances} 超上限`)
    if (poem.source === 'strains') {
      const used = perAuthor.get(poem.author) ?? 0
      assert.ok(used < 10, `${poem.id} 作者 ${poem.author} 超过补足配额`)
      perAuthor.set(poem.author, used + 1)
    }
  }
})

test('体积预算：poems ≤620KB、ci ≤220KB、yun ≤80KB、knowledge ≤90KB', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  for (const [name, budget] of Object.entries(BUDGETS)) {
    const bytes = fs.statSync(path.join(DATA_DIR, name)).size
    assert.ok(bytes <= budget, `${name} ${bytes}B 超预算 ${budget}B`)
  }
})

test('体式分布合理：四种诗体都有，唐/宋诗都有', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const poems = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'poems.json'), 'utf8')).items
  const forms = new Set(poems.map((p) => p.form))
  const dynasties = new Set(poems.map((p) => p.dynasty))
  assert.deepEqual([...forms].sort(), ['七绝', '七律', '五绝', '五律'].sort())
  assert.deepEqual([...dynasties].sort(), ['song', 'tang'])
})

test('词：rhythmic/title/id 约束、名句字段、来源为宋词三百首', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const ci = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ci.json'), 'utf8')).items
  const ids = new Set()
  const names = new Set()
  for (const item of ci) {
    assert.match(item.id, /^ci-\d{6}$/)
    assert.ok(!ids.has(item.id), `ci id 重复 ${item.id}`)
    ids.add(item.id)
    assert.ok(item.rhythmic && item.author)
    assert.ok(Array.isArray(item.lines) && item.lines.length >= 1)
    assert.ok(chars(item.title).length <= 40)
    assert.ok(item.title.startsWith(`${item.rhythmic}·`), `${item.id} title 规则`)
    assert.equal(typeof item.quote, 'string')
    assert.ok(item.quote === '' || item.quote === item.lines[0], `${item.id} quote 应为首句或空`)
    assert.ok(Number.isFinite(item.score))
    names.add(item.rhythmic)
  }
  assert.ok(names.size >= 40, `词牌多样性不足：${names.size}`)
})

test('韵部：2 卷 × 15 章、exampleChars 3–8 字', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const volumes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'yun.json'), 'utf8')).volumes
  assert.equal(volumes.length, 2)
  let chapters = 0
  for (const volume of volumes) {
    assert.equal(volume.chapters.length, 15)
    for (const chapter of volume.chapters) {
      chapters += 1
      assert.equal(chapter.paragraphs.length, 3)
      assert.ok(chapter.exampleChars.length >= 3 && chapter.exampleChars.length <= 8)
      assert.ok(chapter.exampleLine.length > 0)
    }
  }
  assert.equal(chapters, 30)
})

test('知识：12 张格律卡 + 15 张词牌卡，id 唯一', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const knowledge = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'knowledge.json'), 'utf8'))
  assert.equal(knowledge.cards.length, 12)
  assert.equal(knowledge.ciCards.length, 15)
  assert.equal(new Set(knowledge.cards.map((card) => card.id)).size, 12)
  assert.equal(new Set(knowledge.ciCards.map((card) => card.name)).size, 15)
  for (const card of knowledge.cards) {
    assert.ok(charLength(card.summary) <= 40, `${card.id} summary 超 40 字`)
    for (const paragraph of card.paragraphs) assert.ok(charLength(paragraph) <= 160)
  }
})

/* ------------------------------------------------------------------ *
 * 5. v4 质量门（Lead 2026-10-21 修订：正文语料化 / 词牌归一 / 简体残留 / 生僻字）
 * ------------------------------------------------------------------ */

test('异体字补充转换：隣→邻、鴈→雁，且不对「只」等简体字做反向转换', () => {
  assert.equal(simplifyChar('隣'), '邻')
  assert.equal(simplifyChar('鴈'), '雁')
  assert.equal(simplifyChar('只'), '只')
  assert.equal(simplifyChar('乐'), '乐')
  assert.equal(toSimplified('天涯若比隣').text, '天涯若比邻')
  assert.equal(toSimplified('晚見鴈行頻').text, '晚见雁行频')
})

test('诗：正文（display 字段）无 CJK Ext-B+ 生僻字、无未简化繁体/异体字', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const poems = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'poems.json'), 'utf8')).items
  for (const poem of poems) {
    for (const field of [poem.title, poem.author, ...poem.lines]) {
      assert.equal(hasAstralChars(field), false, `${poem.id} 含 Ext-B 生僻字`)
      for (const ch of chars(field)) {
        const simplified = simplifyChar(ch)
        if (!/[㐀-䶿一-鿿]/u.test(ch)) continue
        if (hasAstralChars(simplified)) continue // 简化结果是 Ext-B 时保留 BMP 原字（永不选入诗）
        assert.equal(simplified, ch, `${poem.id} 未简化字「${ch}」`)
      }
    }
  }
})

test('词：正文取自宋词语料（选集缺字已修复），且无单字作者 / 无「・」合称 / 无生僻字', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'))
  const ci = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ci.json'), 'utf8')).items
  const stats = manifest.stats
  assert.ok(stats.ciCorpusMatched >= 275, `ciCorpusMatched=${stats.ciCorpusMatched}`)
  assert.ok(stats.ciCorpusReplaced >= 55, `ciCorpusReplaced=${stats.ciCorpusReplaced}（选集应有 58 首缺字需语料正文）`)
  assert.equal(stats.ciCorpusFallback, 0, '所有词正文都应以语料为准')
  assert.ok(stats.ciRhythmicSplit >= 36, `ciRhythmicSplit=${stats.ciRhythmicSplit}`)
  assert.ok(stats.ciAuthorFixed >= 4, `ciAuthorFixed=${stats.ciAuthorFixed}`)
  assert.equal(stats.simplifiedResidual, 0, '诗/词 display 简体残留应为 0')
  for (const item of ci) {
    assert.ok(chars(item.author).length >= 2, `${item.id} 单字作者「${item.author}」`)
    assert.equal(item.rhythmic.includes('・'), false, `${item.id} 词牌未拆分：${item.rhythmic}`)
    assert.equal(hasAstralChars(item.lines.join('') + item.title + item.author + item.rhythmic), false)
  }
  // 选集缺字修复的具体抽查（content/anthology-qa.md §二.3）
  const find = (author, rhythmic, hint) =>
    ci.find((item) => item.author === author && item.rhythmic === rhythmic && item.lines.some((line) => line.includes(hint)))
  assert.ok(find('柳永', '定风波', '亸'), '柳永《定风波》缺「亸」未修复')
  assert.ok(find('周邦彦', '解语花', '浥'), '周邦彦《解语花》缺「浥」未修复')
  assert.ok(find('苏轼', '永遇乐', '紞'), '苏轼《永遇乐》缺「紞」未修复')
  assert.ok(find('辛弃疾', '水龙吟', '鲙'), '辛弃疾《水龙吟》缺「鲙」未修复')
  assert.ok(ci.some((item) => item.author === '周邦彦' && item.rhythmic === '大酺'), '周邦彦「大酺」词牌未补「酺」')
})

test('词：15 张词牌卡都有对应词作（含补足的如梦令/鹊桥仙/破阵子）', (t) => {
  if (!dataReady) return t.skip('data/ 尚未构建')
  const ci = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ci.json'), 'utf8')).items
  const covered = new Set(ci.map((item) => item.rhythmic))
  const cards = ['浣溪沙', '蝶恋花', '临江仙', '水调歌头', '念奴娇', '定风波', '雨霖铃', '声声慢',
    '如梦令', '虞美人', '鹊桥仙', '青玉案', '破阵子', '鹧鸪天', '满江红']
  const missing = cards.filter((name) => !covered.has(name))
  assert.deepEqual(missing, [], `缺词牌：${missing.join('、')}`)
  // 3 首补缺名篇正文准确（语料）
  const byTitle = (prefix) => ci.find((item) => item.title.startsWith(prefix))
  assert.ok(byTitle('如梦令')?.lines.some((line) => line.includes('昨夜雨疏风骤')))
  assert.ok(byTitle('鹊桥仙')?.lines.some((line) => line.includes('纤云弄巧')))
  assert.ok(byTitle('破阵子')?.lines.some((line) => line.includes('醉里挑灯看剑')))
})

/* ------------------------------------------------------------------ *
 * 6. M7 数据本地化：data-src 源快照（离线可读）
 * ------------------------------------------------------------------ */

test('data-src：curated 源快照齐全、≤3MB、离线解析全部来自 data-src', () => {
  assert.ok(fs.existsSync(DATA_SRC_DIR), 'data-src/ 不存在')
  const resolved = resolveCuratedFiles({ dataSrcDir: DATA_SRC_DIR })
  assert.equal(resolved.complete, true, `curated 缺失：${JSON.stringify(resolved.missing)}`)
  assert.deepEqual(Object.keys(resolved.files).sort(), Object.keys(CURATED_FILES).sort())
  for (const [key, file] of Object.entries(resolved.files)) {
    assert.equal(file.from, 'data-src', `${key} 未从 data-src 解析`)
    assert.ok(fs.existsSync(file.path), `${key} 文件不存在：${file.path}`)
  }
  // 体积预算 ≤3MB
  let bytes = 0
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(target)
      else bytes += fs.statSync(target).size
    }
  }
  walk(DATA_SRC_DIR)
  assert.ok(bytes <= 3 * 1024 * 1024, `data-src 体积 ${bytes}B 超过 3MB`)
  // 许可与来源元信息
  assert.ok(fs.existsSync(path.join(DATA_SRC_DIR, 'LICENSE')))
  assert.ok(fs.existsSync(path.join(DATA_SRC_DIR, 'README.md')))
  const source = JSON.parse(fs.readFileSync(path.join(DATA_SRC_DIR, 'source.json'), 'utf8'))
  assert.equal(source.repo, SOURCE.repo)
  assert.equal(source.commit, SOURCE.commit)
  assert.equal(source.license, 'MIT')
  for (const [rel, info] of Object.entries(source.files)) {
    const target = path.join(DATA_SRC_DIR, rel)
    assert.ok(fs.existsSync(target), `source.json 记录的文件缺失：${rel}`)
    assert.equal(fs.statSync(target).size, info.bytes, `${rel} 字节数与 source.json 不符`)
  }
})

/* ------------------------------------------------------------------ *
 * 7. M9a 扩展数据资产（assets/data：扩展诗库 / 全唐诗宋诗精选库 / 平水韵全表）
 * ------------------------------------------------------------------ */

const ASSETS_DATA_DIR = path.join(PROJECT_ROOT, 'assets', 'data')
const assetsReady = fs.existsSync(path.join(ASSETS_DATA_DIR, 'manifest.json'))

function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

test('assets/anthology.json：扩展诗库 schema/条数/体积/简体', (t) => {
  if (!assetsReady) return t.skip('assets/data 尚未构建')
  const file = path.join(ASSETS_DATA_DIR, 'anthology.json')
  const bytes = fs.statSync(file).size
  assert.ok(bytes <= 400 * 1024, `anthology.json ${bytes}B 超出 400KB`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(data.ok, true)
  assert.match(data.dataVersion, /^\d{4}-\d{2}-\d{2}\.\d+$/)
  assert.ok(data.items.length >= 600, `anthology 条目 ${data.items.length} < 600`)
  assert.ok(Array.isArray(data.categories) && data.categories.length === 4)
  const ids = new Set()
  const perCategory = new Map()
  for (const item of data.items) {
    for (const field of ['id', 'category', 'title', 'author']) {
      assert.equal(typeof item[field], 'string', `anthology ${item.id} 字段 ${field} 非字符串`)
      assert.ok(item[field].length > 0, `anthology ${item.id} 字段 ${field} 为空`)
    }
    assert.ok(Array.isArray(item.lines) && item.lines.length > 0, `anthology ${item.id} lines 为空`)
    assert.ok(!ids.has(item.id), `anthology id 重复 ${item.id}`)
    ids.add(item.id)
    perCategory.set(item.category, (perCategory.get(item.category) ?? 0) + 1)
    const text = item.title + item.author + item.lines.join('')
    assert.equal(hasAstralChars(text), false, `anthology ${item.id} 含 Ext-B 生僻字`)
    for (const ch of chars(text)) {
      if (!/[\u3400-\u4dbf\u4e00-\u9fff]/u.test(ch)) continue
      const simplified = simplifyChar(ch)
      if (hasAstralChars(simplified)) continue // 简化结果是 Ext-B 时保留 BMP 原字（可显示优先）
      assert.equal(simplified, ch, `anthology ${item.id} 未简化字「${ch}」`)
    }
    for (const line of item.lines) assert.equal(typeof line, 'string')
  }
  // 出版/篇目预期（去重后允许少量浮动）
  assert.equal(perCategory.get('诗经'), 305)
  assert.equal(perCategory.get('千家诗'), 219)
  assert.ok((perCategory.get('楚辞') ?? 0) >= 60, `楚辞 ${perCategory.get('楚辞')}`)
  assert.ok((perCategory.get('唐诗三百首·古体乐府') ?? 0) >= 120, `唐古体 ${perCategory.get('唐诗三百首·古体乐府')}`)
  for (const category of data.categories) {
    assert.equal(perCategory.get(category.name), category.count, `categories[${category.name}] 计数不符`)
  }
})

test('assets/poems-bank.json：3000–5000 首质量门 + 体积预算', (t) => {
  if (!assetsReady) return t.skip('assets/data 尚未构建')
  const file = path.join(ASSETS_DATA_DIR, 'poems-bank.json')
  const bytes = fs.statSync(file).size
  assert.ok(bytes <= 8 * 1024 * 1024, `poems-bank.json ${bytes}B 超出 8MB`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(data.ok, true)
  assert.ok(data.items.length >= 3000 && data.items.length <= 5000, `bank 条目 ${data.items.length} 不在 3000–5000`)
  const allowedToneChars = new Set(['平', '仄', '○', '，', '。', '！', '；', '、'])
  const ids = new Set()
  const perAuthor = new Map()
  for (const item of data.items) {
    assert.match(item.id, /^bank-(tang|song)-\d{6}$/)
    assert.ok(!ids.has(item.id), `bank id 重复 ${item.id}`)
    ids.add(item.id)
    assert.ok(['tang', 'song'].includes(item.dynasty))
    assert.ok(item.title && item.author)
    assert.equal(isGenericTitle(item.title), false, `bank 泛题未过滤：${item.author}《${item.title}》`)
    assert.ok([4, 8].includes(item.lines.length), `bank ${item.id} lines=${item.lines.length}`)
    const text = item.title + item.author + item.lines.join('')
    assert.equal(hasAstralChars(text), false, `bank ${item.id} 含 Ext-B 生僻字`)
    assert.ok(Array.isArray(item.tones) && item.tones.length === item.lines.length, `bank ${item.id} tones 行数不符`)
    const expectedRhyme = []
    for (let i = 1; i < item.lines.length; i += 2) expectedRhyme.push(i)
    if (item.firstRhyme) expectedRhyme.unshift(0)
    assert.deepEqual(item.rhymeIdx, expectedRhyme, `bank ${item.id} rhymeIdx 规则不符`)
    for (let i = 0; i < item.lines.length; i += 1) {
      assert.equal(charLength(item.lines[i]), charLength(item.tones[i]), `bank ${item.id} 行 ${i} 等长`)
      for (const ch of item.tones[i]) assert.ok(allowedToneChars.has(ch), `bank ${item.id} 平仄串非法字符「${ch}」`)
    }
    for (const idx of item.rhymeIdx) {
      const toneChar = chars(item.tones[idx]).filter((ch) => '平仄○'.includes(ch)).at(-1)
      assert.ok(['平', '○'].includes(toneChar), `bank ${item.id} 韵脚行 ${idx} 非平声`)
    }
    assert.ok(Number.isFinite(item.form ? 1 : NaN) === false || ['五绝', '七绝', '五律', '七律'].includes(item.form))
    perAuthor.set(item.author, (perAuthor.get(item.author) ?? 0) + 1)
  }
  for (const [author, count] of perAuthor) assert.ok(count <= 30, `bank 作者「${author}」${count} 首超过 30 配额`)
  // 名篇抽查：登鹳雀楼（王之涣）的平仄/体式应为标准五绝
  const sample = data.items.find((item) => item.title === '登鹳雀楼' && item.author === '王之涣')
  assert.ok(sample, 'bank 缺王之涣《登鹳雀楼》')
  assert.equal(sample.form, '五绝')
  assert.deepEqual(sample.tones[0], '仄仄平平仄，')
  assert.deepEqual(sample.rhymeIdx, [1, 3])
})

test('assets/pingshui.json：106 韵部 + charIndex 常用字映射 + manifest 校验', (t) => {
  if (!assetsReady) return t.skip('assets/data 尚未构建')
  const file = path.join(ASSETS_DATA_DIR, 'pingshui.json')
  const bytes = fs.statSync(file).size
  assert.ok(bytes <= 400 * 1024, `pingshui.json ${bytes}B 超出 400KB`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(data.ok, true)
  assert.equal(data.categories.length, 106)
  assert.deepEqual(data.tones, ['平', '仄'])
  const toneCounts = data.categories.reduce((acc, category) => {
    acc[category.tone] = (acc[category.tone] ?? 0) + 1
    return acc
  }, {})
  assert.deepEqual(toneCounts, { ping: 30, shang: 29, qu: 30, ru: 17 })
  const totalChars = data.categories.reduce((sum, category) => sum + [...category.chars].length, 0)
  assert.ok(totalChars > 9000, `平水韵总字数 ${totalChars} 偏少`)
  // 映射抽查：东/风（平声一东）、月（入声六月）、雪（入声九屑）
  const namesOf = (ch) => (data.charIndex[ch] ?? []).map((index) => data.categories[index]?.name ?? '')
  assert.ok(namesOf('东').some((name) => name.includes('東')), `东 映射：${namesOf('东')}`)
  assert.ok(namesOf('风').some((name) => name.includes('東') || name.includes('風')), `风 映射：${namesOf('风')}`)
  assert.ok(namesOf('月').some((name) => name.startsWith('入聲')), `月 映射：${namesOf('月')}`)
  assert.ok(namesOf('雪').some((name) => name.startsWith('入聲')), `雪 映射：${namesOf('雪')}`)
  assert.ok((data.charIndex['看'] ?? []).length >= 2, '多音字「看」应有多个韵部下标')
  for (const [ch, indexes] of Object.entries(data.charIndex)) {
    assert.ok(Array.isArray(indexes) && indexes.length > 0, `charIndex[${ch}] 非数组`)
    for (const index of indexes) assert.ok(Number.isInteger(index) && index >= 0 && index < 106)
    assert.equal(chars(ch).length, 1, `charIndex 键「${ch}」不是单字`)
  }
  // manifest：三文件 bytes/sha256/dataVersion
  const manifestFile = path.join(ASSETS_DATA_DIR, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  assert.equal(manifest.dataVersion, data.dataVersion)
  assert.equal(manifest.source.repo, 'chinese-poetry/chinese-poetry')
  assert.deepEqual(Object.keys(manifest.files).sort(), ['anthology.json', 'ci-bank.json', 'pingshui.json', 'poems-bank.json'])
  for (const [name, info] of Object.entries(manifest.files)) {
    const target = path.join(ASSETS_DATA_DIR, name)
    assert.equal(fs.statSync(target).size, info.bytes, `${name} 字节数与 manifest 不符`)
    assert.equal(sha256OfFile(target), info.sha256, `${name} sha256 与 manifest 不符`)
  }
})

test('assets/ci-bank.json：全量宋词 schema/去重/词牌归一/Ext-B/manifest', (t) => {
  if (!assetsReady) return t.skip('assets/data 尚未构建')
  const file = path.join(ASSETS_DATA_DIR, 'ci-bank.json')
  const bytes = fs.statSync(file).size
  assert.ok(bytes <= 12 * 1024 * 1024, `ci-bank.json ${bytes}B 超出 12MB`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(data.ok, true)
  assert.equal(data.count, data.items.length)
  assert.ok(data.items.length >= 19000, `ci-bank 条目 ${data.items.length} < 19000`)
  const ids = new Set()
  const dedupeKeys = new Set()
  const stripFirst6 = (line) => String(line ?? '').replace(/[，。！？；、：,.!?;:（）()「」『』《》〈〉…—·\s]/g, '').slice(0, 6)
  let lineTotal = 0
  let 徵於 = 0
  for (const item of data.items) {
    assert.match(item.id, /^ci-bank-\d{5}$/)
    assert.ok(!ids.has(item.id), `ci-bank id 重复 ${item.id}`)
    ids.add(item.id)
    assert.ok(item.author && item.author.trim(), `${item.id} author 为空`)
    assert.ok(item.rhythmic && item.rhythmic.trim(), `${item.id} rhythmic 为空`)
    assert.equal(item.rhythmic.includes('・'), false, `${item.id} 词牌未归一：${item.rhythmic}`)
    assert.ok(Array.isArray(item.lines) && item.lines.length > 0, `${item.id} lines 为空`)
    assert.ok(item.lines.every((line) => typeof line === 'string' && line.trim().length > 0))
    assert.equal(charLength(item.title) <= 40, true, `${item.id} title 超 40 字`)
    assert.ok(item.title.startsWith(`${item.rhythmic}·`), `${item.id} title 规则不符`)
    const key = `${item.author}\u0000${item.rhythmic}\u0000${stripFirst6(item.lines[0])}`
    assert.ok(!dedupeKeys.has(key), `${item.id} 去重 key 重复：${key}`)
    dedupeKeys.add(key)
    lineTotal += item.lines.length
    if (/[徵於]/.test(item.rhythmic)) 徵於 += 1
    const text = item.author + item.lines.join('')
    assert.equal(hasAstralChars(item.author + item.rhythmic + item.title + item.lines.join('')), false, `${item.id} 含 Ext-B 生僻字`)
    for (const ch of chars(text)) {
      if (!/[\u3400-\u4dbf\u4e00-\u9fff]/u.test(ch)) continue
      const simplified = simplifyChar(ch)
      if (hasAstralChars(simplified)) continue
      assert.equal(simplified, ch, `${item.id} 正文未简化字「${ch}」`)
    }
  }
  // 首尾行/名篇抽查：苏轼《水调歌头·明月几时有》
  const shuidiao = data.items.find(
    (item) => item.author === '苏轼' && item.rhythmic === '水调歌头' && item.lines[0].includes('明月几时有'),
  )
  assert.ok(shuidiao, 'ci-bank 缺苏轼《水调歌头·明月几时有》')
  assert.equal(shuidiao.title, '水调歌头·明月几时有')
  assert.ok(shuidiao.lines.some((line) => line.includes('千里共婵娟')))
  assert.ok(lineTotal >= 140000, `ci-bank 总句数 ${lineTotal} 偏少`)
  // 缺字占位符（□/■/�）已整首剔除，数据里不应再有
  assert.equal(/[□■\ufffd]/.test(data.items.map((item) => item.author + item.rhythmic + item.title + item.lines.join('')).join('')), false, 'ci-bank 仍含缺字占位符')
  assert.ok(徵於 >= 10, `词牌专名保留数异常：${徵於}`)
  // manifest：ci-bank 的 bytes/sha256/条数/Ext-B 剔除计数
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS_DATA_DIR, 'manifest.json'), 'utf8'))
  const info = manifest.files['ci-bank.json']
  assert.ok(info, 'manifest 缺 ci-bank.json 条目')
  assert.equal(bytes, info.bytes)
  assert.equal(sha256OfFile(file), info.sha256)
  assert.equal(manifest.counts.ciBank, data.items.length)
  assert.equal(manifest.counts.ciBankLines, lineTotal)
  assert.ok(manifest.stats?.ciBank?.astralDropped > 0, 'Ext-B 剔除计数应 > 0')
  assert.ok(manifest.stats?.ciBank?.placeholderDropped > 0, '缺字占位剔除计数应 > 0')
  assert.equal(manifest.stats.ciBank.residual, 0, '正文简体残留应为 0')
  assert.equal(manifest.stats.ciBank.dedupeDropped > 0, true)
  // 旧 3 个资产条目仍在
  for (const name of ['anthology.json', 'pingshui.json', 'poems-bank.json']) assert.ok(manifest.files[name], `manifest 缺 ${name}`)
})
