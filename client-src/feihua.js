// client-src/feihua.js —— 飞花令纯逻辑（v1.84 从 client.js 抽出）。
//
// 负责索引、句子查找、出题/判定、最佳成绩更新；不碰 DOM、不 fetch、不读 localStorage。
import { num } from './base.js'

export const FEIHUA_CANDIDATE_CHARS = Array.from('花月风春山水人天云雨夜秋江酒白红舟愁梦心柳雪霜日星海玉金长何不无')
export const FEIHUA_MIN_ENTRIES = 8
export const FEIHUA_CANDIDATE_LIMIT = 12
export const FEIHUA_ATLAS_LIMIT = 200

export function completeSentencesFromLines(lines) {
const text = (Array.isArray(lines) ? lines : []).map((value) => String(value == null ? '' : value)).join('').trim()
if (!text) return []
const out = []
let start = 0
for (let i = 0; i < text.length; i += 1) {
 const ch = text.charAt(i)
 if (ch !== '。' && ch !== '！' && ch !== '？') continue
 const sentence = text.slice(start, i + 1).trim()
 start = i + 1
 if (!sentence) continue
 const plain = sentence.replace(/[，。！？；、：,.!?;:\s]/g, '')
 if (plain.length < 5) continue
 out.push(sentence)
}
return out
}

export function feihuaPlainOf(text) {
return String(text == null ? '' : text)
 .replace(/[，。！？；、：,.!?;:\s"'“”‘’「」『』《》〈〉（）()\[\]【】·—…～~]/g, '')
}

export function registerFeihuaLookup(index, entry) {
if (!index || !entry) return
const plain = feihuaPlainOf(entry.text)
if (!plain) return
entry.plain = plain
if (!index.byPlain[plain]) index.byPlain[plain] = entry
const clauses = String(entry.text).split(/[，、；：,;:]/)
for (const clause of clauses) {
 const clausePlain = feihuaPlainOf(clause)
 if (clausePlain.length < 2 || index.clauseMap[clausePlain]) continue
 index.clauseMap[clausePlain] = entry
}
}

export function feihuaLookup(index, input) {
if (!index || !index.entries) return null
const plain = feihuaPlainOf(input)
if (!plain) return null
if (index.clauseMap && index.clauseMap[plain]) return { entry: index.clauseMap[plain], match: 'clause' }
if (index.byPlain && index.byPlain[plain]) return { entry: index.byPlain[plain], match: 'sentence' }
if (plain.length < 5) return null
for (const entry of index.entries) {
 const entryPlain = entry.plain || feihuaPlainOf(entry.text)
 if (entryPlain.indexOf(plain) >= 0) return { entry, match: 'contains' }
}
return null
}

export function buildFeihuaIndex(poemsData, ciData, anthologyData, bankData, ciBankData) {
const entries = []
const seen = new Set()
const byChar = {}
const counts = {}
for (const char of FEIHUA_CANDIDATE_CHARS) {
 byChar[char] = []
 counts[char] = 0
}
function addSentence(text, source) {
 if (!text || seen.has(text)) return
 if (!/[。！？]$/.test(text)) return
 seen.add(text)
 const entry = { text, source: source || '' }
 entries.push(entry)
 for (const char of FEIHUA_CANDIDATE_CHARS) {
  if (text.indexOf(char) >= 0) {
  byChar[char].push(entry)
  counts[char] += 1
  }
 }
}
function addItem(item, source) {
 for (const sentence of completeSentencesFromLines(item && item.lines)) addSentence(sentence, source)
}
const poemItems = poemsData && Array.isArray(poemsData.items) ? poemsData.items : []
for (const poem of poemItems) {
 if (!poem) continue
 const author = typeof poem.author === 'string' ? poem.author : ''
 const title = typeof poem.title === 'string' ? poem.title : ''
 const source = author && title ? author + '《' + title + '》' : (author || title)
 addItem(poem, source)
}
const ciItems = ciData && Array.isArray(ciData.items) ? ciData.items : []
for (const ci of ciItems) {
 if (!ci) continue
 const author = typeof ci.author === 'string' ? ci.author : ''
 const label = (typeof ci.rhythmic === 'string' && ci.rhythmic)
  ? ci.rhythmic
  : (typeof ci.title === 'string' ? ci.title : '')
 const source = author && label ? author + '《' + label + '》' : (author || label)
 addItem(ci, source)
}
const addExtraSource = (data) => {
 for (const item of data && Array.isArray(data.items) ? data.items : []) {
  if (!item) continue
  const author = typeof item.author === 'string' ? item.author : ''
  const title = typeof item.title === 'string' ? item.title : ''
  const source = author && title ? author + '《' + title + '》' : (author || title)
  addItem(item, source)
 }
}
addExtraSource(anthologyData)
addExtraSource(bankData)
const candidates = []
for (const char of FEIHUA_CANDIDATE_CHARS) {
 if (counts[char] >= FEIHUA_MIN_ENTRIES) candidates.push({ char, count: counts[char] })
}
const index = { entries, byChar, counts, clauseMap: {}, byPlain: {} }
for (const entry of entries) registerFeihuaLookup(index, entry)
if (ciBankData) mergeFeihuaItems(index, ciBankData && Array.isArray(ciBankData.items) ? ciBankData.items : (Array.isArray(ciBankData) ? ciBankData : []))
return finishFeihuaIndex(index)
}

export function mergeFeihuaFullEntries(index, char, entries) {
if (!index || !index.entries || !Array.isArray(entries)) return 0
const key = String(char == null ? '' : char)
if (!key) return 0
if (!index.__seen) index.__seen = new Set(index.entries.map((entry) => entry.text))
if (!index.__plainSeen) {
 index.__plainSeen = new Set()
 for (const entry of index.entries) {
  const plain = entry.plain || feihuaPlainOf(entry.text)
  if (plain) index.__plainSeen.add(plain)
 }
}
if (!index.__fullMerged) index.__fullMerged = {}
if (index.__fullMerged[key]) return 0
if (!Array.isArray(index.byChar[key])) index.byChar[key] = []
index.counts[key] = index.counts[key] || 0
let added = 0
for (const item of entries) {
 let text = ''
 let source = ''
 if (Array.isArray(item)) {
  text = String(item[0] == null ? '' : item[0]).trim()
  source = String(item[1] == null ? '' : item[1]).trim()
 } else if (item && typeof item === 'object' && typeof item.text === 'string') {
  text = item.text.trim()
  source = String(item.source || '').trim()
 } else {
  continue
 }
 if (!text || !/[。！？]$/.test(text) || text.indexOf(key) < 0) continue
 const plain = feihuaPlainOf(text)
 if (!plain || index.__seen.has(text) || index.__plainSeen.has(plain)) continue
 index.__seen.add(text)
 index.__plainSeen.add(plain)
 const entry = { text, source, plain }
 index.entries.push(entry)
 registerFeihuaLookup(index, entry)
 index.byChar[key].push(entry)
 index.counts[key] += 1
 added += 1
}
index.__fullMerged[key] = true
finishFeihuaIndex(index)
return added
}

export function feihuaSourceOf(item) {
const author = typeof item.author === 'string' ? item.author : ''
const label = item.title || item.rhythmic || item.rhythm || ''
const title = typeof label === 'string' ? label : ''
return author && title ? author + '《' + title + '》' : (author || title)
}

export function mergeFeihuaItems(index, items) {
if (!index || !index.entries) return index
if (!index.__seen) index.__seen = new Set(index.entries.map((entry) => entry.text))
for (const item of Array.isArray(items) ? items : []) {
 if (!item) continue
 const source = feihuaSourceOf(item)
 for (const text of completeSentencesFromLines(item.lines)) {
  if (!text || !/[。！？]$/.test(text) || index.__seen.has(text)) continue
  index.__seen.add(text)
  const entry = { text, source }
  index.entries.push(entry)
  registerFeihuaLookup(index, entry)
  for (const char of FEIHUA_CANDIDATE_CHARS) {
   if (text.indexOf(char) >= 0) {
    index.byChar[char].push(entry)
    index.counts[char] = (index.counts[char] || 0) + 1
   }
  }
 }
}
return index
}

export function finishFeihuaIndex(index) {
if (!index || !index.counts) return index
const candidates = []
for (const char of FEIHUA_CANDIDATE_CHARS) {
 const count = index.counts[char] || 0
 if (count >= FEIHUA_MIN_ENTRIES) candidates.push({ char, count })
}
candidates.sort((a, b) => b.count - a.count || a.char.localeCompare(b.char, 'zh'))
index.candidates = candidates.slice(0, FEIHUA_CANDIDATE_LIMIT)
return index
}

export function feihuaRandomIndex(length, random) {
if (!length || length <= 0) return 0
const value = typeof random === 'function' ? Number(random()) : Math.random()
let index = Math.floor((Number.isFinite(value) ? value : 0) * length)
if (index < 0) index = 0
if (index >= length) index = length - 1
return index
}

export function feihuaSampleUnique(pool, count, random) {
const rest = Array.isArray(pool) ? pool.slice() : []
const picked = []
while (picked.length < count && rest.length) {
 picked.push(rest.splice(feihuaRandomIndex(rest.length, random), 1)[0])
}
return picked
}

export function feihuaShuffle(list, random) {
const out = Array.isArray(list) ? list.slice() : []
for (let i = out.length - 1; i > 0; i -= 1) {
 const j = feihuaRandomIndex(i + 1, random)
 const temp = out[i]
 out[i] = out[j]
 out[j] = temp
}
return out
}

export function feihuaPickSystem(index, char, usedPlains, random) {
if (!index || !index.byChar) return null
const used = usedPlains instanceof Set ? usedPlains : new Set(Array.isArray(usedPlains) ? usedPlains : [])
const pool = (index.byChar[char] || []).filter((entry) => !used.has(entry.plain || feihuaPlainOf(entry.text)))
if (!pool.length) return null
return pool[feihuaRandomIndex(pool.length, random)]
}

export function feihuaStart(index, char, random) {
const charValue = String(char || '花')
const system = feihuaPickSystem(index, charValue, new Set(), random)
if (!system) {
 return {
  char: charValue,
  phase: 'cleared',
  score: 0,
  used: [],
  system: null,
  feedback: null,
  message: '这一字暂时没有句子，换一个令字吧',
 }
}
return {
 char: charValue,
 phase: 'playing',
 score: 0,
 used: [system],
 system,
 feedback: null,
 message: '请接一句含「' + charValue + '」的诗句',
}
}

export function feihuaSubmit(state, index, input, random) {
if (!state || state.phase !== 'playing') return state
const raw = String(input == null ? '' : input).trim()
const plain = feihuaPlainOf(raw)
if (plain.length < 2) {
 return Object.assign({}, state, { feedback: { kind: 'bad', text: '请输入一句完整的诗/词' } })
}
if (plain.indexOf(state.char) < 0) {
 return Object.assign({}, state, { feedback: { kind: 'bad', text: '这句里没有「' + state.char + '」哦' } })
}
const used = Array.isArray(state.used) ? state.used : []
const usedPlains = new Set(used.map((entry) => entry.plain || feihuaPlainOf(entry.text)))
if (usedPlains.has(plain)) {
 return Object.assign({}, state, { feedback: { kind: 'bad', text: '这句本局已经用过了' } })
}
const lookup = feihuaLookup(index, raw)
if (lookup && usedPlains.has(lookup.entry.plain || feihuaPlainOf(lookup.entry.text))) {
 return Object.assign({}, state, { feedback: { kind: 'bad', text: '这句本局已经用过了' } })
}
if (!lookup) {
 return Object.assign({}, state, {
  feedback: { kind: 'bad', text: '本地诗库没查到这句的出处，可能是记错了，或还没收录' },
 })
}
const entry = lookup.entry
const nextUsed = used.concat([entry])
const nextPlains = new Set(nextUsed.map((item) => item.plain || feihuaPlainOf(item.text)))
const system = feihuaPickSystem(index, state.char, nextPlains, random)
const score = state.score + 1
const feedback = {
 kind: 'good',
 text: '接上了：' + entry.text + (entry.source ? ' —— ' + entry.source : ''),
}
if (!system) {
 return Object.assign({}, state, {
  phase: 'cleared',
  score,
  used: nextUsed,
  system: null,
  feedback,
  message: '这一字的句子被接完了，换一个令字吧',
 })
}
return Object.assign({}, state, {
 phase: 'playing',
 score,
 used: nextUsed,
 system,
 feedback,
 message: '请接一句含「' + state.char + '」的诗句',
})
}

export function normalizeFeihuaBest(raw) {
const source = raw && typeof raw === 'object' ? raw : {}
const chars = {}
if (source.chars && typeof source.chars === 'object') {
 for (const key of Object.keys(source.chars)) {
  const value = Number(source.chars[key])
  if (Number.isFinite(value) && value > 0) chars[key] = Math.floor(value)
 }
}
const overallRaw = Number(source.overall)
return { overall: Number.isFinite(overallRaw) && overallRaw > 0 ? Math.floor(overallRaw) : 0, chars }
}

export function feihuaBestUpdate(best, char, score) {
const base = normalizeFeihuaBest(best)
const safeScore = Math.max(0, Math.floor(num(score, 0)))
const chars = Object.assign({}, base.chars)
chars[char] = Math.max(chars[char] || 0, safeScore)
return { overall: Math.max(base.overall, safeScore), chars }
}
