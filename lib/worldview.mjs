// lib/worldview.mjs —— 她的世界观档案（v2.75）
//
// 和 journal / memory-layers 不同：这里存的不是“发生过什么”，而是她**自己整理过的判断**：
//   - beliefs：她信什么（带置信度、依据等级、反证）
//   - concepts：她怎么定义关键概念（用自己的话，不是抄词典）
//   - questions：她还没弄明白的问题
//   - essay：她这一版“世界是怎么运作的”（第一人称短篇，带版本历史）
// 定期从最近的学习、方法论、书架上重建一版；不追求漂亮，只要求：具体、可检验、允许被推翻。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveSettingsPath, writeJsonAtomic } from './settings-store.mjs'

export const WORLDVIEW_VERSION = 1
export const WORLDVIEW_BELIEF_MAX = 24
export const WORLDVIEW_CONCEPT_MAX = 24
export const WORLDVIEW_QUESTION_MAX = 12
export const WORLDVIEW_HISTORY_MAX = 8
export const WORLDVIEW_ESSAY_MAX = 1400
export const WORLDVIEW_ESSENCE_DIGEST_CHARS = 220
export const WORLDVIEW_DIGEST_BELIEFS = 4

const CONFIDENCE_WORDS = Object.freeze({ high: '高', medium: '中', low: '低' })
const BASIS_WORDS = Object.freeze({ primary: '一手材料', secondary: '二手转述', inference: '推出来的' })

function cleanInline(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function bigrams(text) {
  const value = String(text ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase()
  const chars = Array.from(value)
  const set = new Set()
  for (let index = 0; index + 1 < chars.length; index += 1) set.add(`${chars[index]}${chars[index + 1]}`)
  return set
}

function similar(left, right, threshold = 0.82) {
  const a = bigrams(left)
  const b = bigrams(right)
  if (a.size === 0 || b.size === 0) return cleanInline(left, 200) === cleanInline(right, 200)
  let overlap = 0
  for (const gram of a) if (b.has(gram)) overlap += 1
  return (2 * overlap) / (a.size + b.size) >= threshold
}

export function resolveWorldviewPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'worldview.json')
}

export function emptyWorldview() {
  return {
    ok: true,
    v: WORLDVIEW_VERSION,
    beliefs: [],
    concepts: [],
    questions: [],
    contradictions: [],
    essay: { text: '', at: 0, version: 0 },
    history: [],
  }
}

/** 置信度降一档（反证出现时用；low 不再降）。 */
function demoteConfidence(value) {
  if (value === 'high') return 'medium'
  if (value === 'medium') return 'low'
  return 'low'
}

export function normalizeWorldview(raw) {
  const out = emptyWorldview()
  if (!raw || typeof raw !== 'object') return out
  const list = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [])
  out.beliefs = list(raw.beliefs)
    .map((item) => ({
      id: cleanInline(item.id, 60) || `belief-${Math.random().toString(36).slice(2, 8)}`,
      claim: cleanInline(item.claim, 200),
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium',
      basis: ['primary', 'secondary', 'inference'].includes(item.basis) ? item.basis : 'inference',
      evidence: cleanInline(item.evidence, 200),
      counter: cleanInline(item.counter, 200),
      tension: Array.isArray(item.tension) ? item.tension.map((value) => cleanInline(value, 160)).filter((value) => value.length > 0).slice(-3) : [],
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
      timesRevised: Number.isFinite(item.timesRevised) ? item.timesRevised : 0,
    }))
    .filter((item) => item.claim.length >= 4)
    .slice(-WORLDVIEW_BELIEF_MAX)
  out.concepts = list(raw.concepts)
    .map((item) => ({
      id: cleanInline(item.id, 60) || `concept-${Math.random().toString(36).slice(2, 8)}`,
      term: cleanInline(item.term, 20),
      definition: cleanInline(item.definition, 200),
      example: cleanInline(item.example, 160),
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
    }))
    .filter((item) => item.term.length > 0 && item.definition.length > 0)
    .slice(-WORLDVIEW_CONCEPT_MAX)
  out.questions = list(raw.questions)
    .map((item) => ({
      id: cleanInline(item.id, 60) || `question-${Math.random().toString(36).slice(2, 8)}`,
      question: cleanInline(item.question, 160),
      status: ['open', 'parked', 'closed'].includes(item.status) ? item.status : 'open',
      attempts: Number.isFinite(item.attempts) ? item.attempts : 0,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
    }))
    .filter((item) => item.question.length >= 4)
    .slice(-WORLDVIEW_QUESTION_MAX)
  out.contradictions = list(raw.contradictions)
    .map((item) => ({
      id: cleanInline(item.id, 60) || `contra-${Math.random().toString(36).slice(2, 8)}`,
      a: cleanInline(item.a, 200),
      b: cleanInline(item.b, 200),
      why: cleanInline(item.why, 200),
      at: Number.isFinite(item.at) ? item.at : 0,
      status: item.status === 'resolved' ? 'resolved' : 'open',
    }))
    .filter((item) => item.a.length >= 4 && item.b.length >= 4)
    .slice(-8)
  if (raw.essay && typeof raw.essay === 'object' && typeof raw.essay.text === 'string') {
    out.essay = {
      text: cleanInline(raw.essay.text, WORLDVIEW_ESSAY_MAX),
      at: Number.isFinite(raw.essay.at) ? raw.essay.at : 0,
      version: Number.isFinite(raw.essay.version) ? raw.essay.version : 0,
    }
  }
  out.history = list(raw.history)
    .map((item) => ({ at: Number.isFinite(item.at) ? item.at : 0, version: Number.isFinite(item.version) ? item.version : 0, changed: cleanInline(item.changed, 240) }))
    .slice(-WORLDVIEW_HISTORY_MAX)
  return out
}

export function readWorldview(file) {
  try {
    return normalizeWorldview(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return emptyWorldview()
  }
}

/** 把模型返回的 JSON 解析成合成输入；失败返回 null。 */
export function parseWorldviewSynthesis(raw) {
  const source = String(raw ?? '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed = null
  try {
    parsed = JSON.parse(source.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const essence = cleanInline(parsed.essence, WORLDVIEW_ESSAY_MAX)
  if (essence.length < 20) return null
  const beliefs = (Array.isArray(parsed.beliefs) ? parsed.beliefs : [])
    .filter((item) => item && typeof item.claim === 'string' && item.claim.trim().length >= 4)
    .slice(0, 10)
    .map((item) => ({
      claim: cleanInline(item.claim, 200),
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium',
      basis: ['primary', 'secondary', 'inference'].includes(item.basis) ? item.basis : 'inference',
      evidence: cleanInline(item.evidence, 200),
      counter: cleanInline(item.counter, 200),
    }))
  const concepts = (Array.isArray(parsed.concepts) ? parsed.concepts : [])
    .filter((item) => item && typeof item.term === 'string' && typeof item.definition === 'string' && item.term.trim().length > 0 && item.definition.trim().length >= 4)
    .slice(0, 8)
    .map((item) => ({ term: cleanInline(item.term, 20), definition: cleanInline(item.definition, 200), example: cleanInline(item.example, 160) }))
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .filter((item) => item && typeof item.question === 'string' && item.question.trim().length >= 4)
    .slice(0, 6)
    .map((item) => ({ question: cleanInline(item.question, 160) }))
  const contradictions = (Array.isArray(parsed.contradictions) ? parsed.contradictions : [])
    .filter((item) => item && typeof item.a === 'string' && typeof item.b === 'string' && item.a.trim().length >= 4 && item.b.trim().length >= 4)
    .slice(0, 3)
    .map((item) => ({ a: cleanInline(item.a, 200), b: cleanInline(item.b, 200), why: cleanInline(item.why, 200) }))
  return {
    ok: true,
    essence,
    beliefs,
    concepts,
    questions,
    contradictions,
    changed: cleanInline(parsed.changed, 240),
  }
}

/** 合成结果合并进档案：相似主张更新，不重复堆；概念按词去重；问题按相似去重。 */
export function applyWorldviewSynthesis(state, synthesis, at = Date.now()) {
  const next = normalizeWorldview(state)
  let changed = 0
  for (const item of synthesis.beliefs ?? []) {
    const existing = next.beliefs.find((entry) => similar(entry.claim, item.claim))
    const hasNewCounter = item.counter.length > 0 && !existing?.counter?.includes(item.counter)
    const nextConfidence = hasNewCounter ? demoteConfidence(item.confidence) : item.confidence
    if (existing) {
      const changedConfidence = existing.confidence !== nextConfidence
      const changedEvidence = item.evidence.length > 0 && item.evidence !== existing.evidence
      const changedCounter = item.counter.length > 0 && item.counter !== existing.counter
      if (changedConfidence || changedEvidence || changedCounter) {
        existing.confidence = nextConfidence
        existing.basis = item.basis
        if (changedEvidence) existing.evidence = item.evidence
        if (changedCounter) existing.counter = item.counter
        existing.updatedAt = at
        existing.timesRevised += 1
        changed += 1
      }
      continue
    }
    next.beliefs.push({
      id: `belief-${at}-${next.beliefs.length + 1}`,
      claim: item.claim,
      confidence: nextConfidence,
      basis: item.basis,
      evidence: item.evidence,
      counter: item.counter,
      tension: [],
      createdAt: at,
      updatedAt: at,
      timesRevised: 0,
    })
    changed += 1
  }
  next.beliefs = next.beliefs.slice(-WORLDVIEW_BELIEF_MAX)

  for (const item of synthesis.concepts ?? []) {
    const existing = next.concepts.find((entry) => entry.term === item.term || similar(entry.term, item.term, 0.95))
    if (existing) {
      if (item.definition !== existing.definition) {
        existing.definition = item.definition
        existing.example = item.example
        existing.updatedAt = at
        changed += 1
      }
      continue
    }
    next.concepts.push({ id: `concept-${at}-${next.concepts.length + 1}`, term: item.term, definition: item.definition, example: item.example, updatedAt: at })
    changed += 1
  }
  next.concepts = next.concepts.slice(-WORLDVIEW_CONCEPT_MAX)

  for (const item of synthesis.questions ?? []) {
    if (next.questions.some((entry) => similar(entry.question, item.question, 0.78))) continue
    next.questions.push({ id: `question-${at}-${next.questions.length + 1}`, question: item.question, status: 'open', attempts: 0, createdAt: at })
    changed += 1
  }
  next.questions = next.questions.slice(-WORLDVIEW_QUESTION_MAX)

  // 矛盾账：她自己发现的两条互相打架的判断；不能悄悄丢掉。
  for (const item of synthesis.contradictions ?? []) {
    const existing = next.contradictions.find(
      (entry) =>
        (similar(entry.a, item.a) && similar(entry.b, item.b)) ||
        (similar(entry.a, item.b) && similar(entry.b, item.a)),
    )
    if (existing) {
      if (item.why.length > 0 && item.why !== existing.why) {
        existing.why = item.why
        changed += 1
      }
      continue
    }
    next.contradictions.push({
      id: `contra-${at}-${next.contradictions.length + 1}`,
      a: item.a,
      b: item.b,
      why: item.why,
      at,
      status: 'open',
    })
    const markTension = (claim, other) => {
      const belief = next.beliefs.find((entry) => similar(entry.claim, claim, 0.8))
      if (belief) belief.tension = [...new Set([...(belief.tension ?? []), other])].slice(-3)
    }
    markTension(item.a, item.b)
    markTension(item.b, item.a)
    changed += 1
  }
  next.contradictions = next.contradictions.slice(-8)

  const version = next.essay.version + 1
  next.essay = { text: synthesis.essence, at, version }
  next.history = [...next.history, { at, version, changed: synthesis.changed || '' }].slice(-WORLDVIEW_HISTORY_MAX)
  return { state: next, changed: changed + 1 }
}

export function saveWorldview(file, state) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeJsonAtomic(file, normalizeWorldview(state))
    return true
  } catch {
    return false
  }
}

/** prompt 用：她自己的世界观摘要（短、可读，不是清单堆）。 */
export function formatWorldviewDigest(state) {
  const view = normalizeWorldview(state)
  const lines = []
  if (view.essay.text.length > 0) {
    lines.push(`你上一版的世界观（第 ${view.essay.version} 版）：${cleanInline(view.essay.text, WORLDVIEW_ESSENCE_DIGEST_CHARS)}`)
  }
  if (view.beliefs.length > 0) {
    const beliefs = view.beliefs.slice(-WORLDVIEW_DIGEST_BELIEFS)
    lines.push(`你现在的核心判断：${beliefs.map((item) => `${item.claim}（置信${CONFIDENCE_WORDS[item.confidence] ?? '中'}，${BASIS_WORDS[item.basis] ?? '推出来的'}）`).join('；')}`)
  }
  if (view.questions.length > 0) {
    lines.push(`你还没弄明白的：${view.questions.slice(-2).map((item) => item.question).join('；')}`)
  }
  if (view.concepts.length > 0) {
    const concept = view.concepts[view.concepts.length - 1]
    lines.push(`你最近在重新定义的概念：“${concept.term}”——${cleanInline(concept.definition, 100)}`)
  }
  const openContradictions = view.contradictions.filter((item) => item.status === 'open').slice(-2)
  if (openContradictions.length > 0) {
    lines.push(`你还没解决的自相矛盾：${openContradictions.map((item) => `${item.a} ｜ ${item.b}`).join('；')}`)
  }
  return lines
}

/** 世界观合成 prompt：从最近的学习/方法论/书架/自我短句里，重写一版。 */
export function buildWorldviewSynthesisPrompt(context = {}) {
  const ctx = context && typeof context === 'object' ? context : {}
  const state = normalizeWorldview(ctx.state)
  const lines = [
    '这是你每周一次的“世界观整理”。不是总结学到了什么，而是把你最近的判断、证据和疑问，重写成你自己的一版“世界是怎么运作的”。',
    '要求：第一人称；具体（能指出是什么关系在起作用：土地、赋税、权力、观念、偶然）；允许不确定；不要写成励志句，也不要罗列成清单。',
    'beliefs 只留你现在真的信的判断（≤6 条），每条带置信度（high/medium/low）和依据等级（primary=一手材料/secondary=二手转述/inference=推出来的），有反证就写在 counter。',
    'concepts 用你自己的话定义 2–4 个关键概念（不要抄词典），questions 写 2–3 个你还没弄清的问题。',
    '至少一条 belief 要来自你最近学到的具体内容（写清那个点：一个年份、一个制度、一个论证），不要只写感受；其他 belief 可以来自你的经历。',
    '如果你发现两条判断互相打架，不要装作没看见：写进 contradictions（a、b 用两条判断的原话，why 写它们怎么冲突）；解决不了就保留为 open。遇到新的反证，把对应信念的 counter 写上——置信度会被自动降一档；不要为了显得坚定而藏起反证。',
    'changed 写这次你改变了哪一个旧看法（没有就留空）。',
    state.essay.text.length > 0 ? `你上一版的世界观：${state.essay.text}` : '你还没有成文的世界观，这是第一版。',
    state.beliefs.length > 0
      ? `你档案里的旧判断：${state.beliefs.map((item) => `${item.claim}（置信${item.confidence}）`).join('；')}`
      : '',
    Array.isArray(ctx.learning) && ctx.learning.length > 0 ? `你最近自学到的：${ctx.learning.slice(-4).join('；')}` : '',
    Array.isArray(ctx.methodology) && ctx.methodology.length > 0 ? `你自己的方法规则：${ctx.methodology.slice(-5).join('；')}` : '',
    Array.isArray(ctx.bookshelf) && ctx.bookshelf.length > 0 ? `你书架上最近看完的：${ctx.bookshelf.slice(0, 3).join('；')}` : '',
    Array.isArray(ctx.selfFacts) && ctx.selfFacts.length > 0 ? `你慢慢认出来的自己：${ctx.selfFacts.slice(-6).join('；')}` : '',
    Array.isArray(ctx.graphLines) && ctx.graphLines.length > 0
      ? `你的认知图谱里已有的关系和判断（用它提炼“世界怎么运作”，不要复述事件）：${ctx.graphLines.slice(0, 10).join('；')}`
      : '',
    '只输出严格 JSON：{"essence":"第一人称的世界观（≤500字）","beliefs":[{"claim":"≤60字","confidence":"high|medium|low","basis":"primary|secondary|inference","evidence":"依据（可空）","counter":"反证（可空）"}],"concepts":[{"term":"≤10字","definition":"≤80字","example":"例子（可空）"}],"questions":[{"question":"≤60字"}],"contradictions":[{"a":"判断一","b":"判断二","why":"怎么冲突（可空）"}],"changed":"改变了哪个旧看法（可空）"}',
  ]
  return lines.filter((line) => typeof line === 'string' && line.length > 0).join('\n')
}

export function createWorldview(options = {}) {
  const file = path.resolve(options.file ?? resolveWorldviewPath(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = readWorldview(file)
  function snapshot() { return normalizeWorldview(state) }
  function digest() { return formatWorldviewDigest(state) }
  function apply(synthesis) {
    const result = applyWorldviewSynthesis(state, synthesis, now())
    state = result.state
    saveWorldview(file, state)
    return result
  }
  return { file, snapshot, digest, apply, state: () => normalizeWorldview(state) }
}
