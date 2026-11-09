// lib/relationship-memory.mjs —— 她和用户之间的关系记忆（v2.98）
//
// 存：他的偏好/边界/在意的事/约定/共同经历；聊天时按相关性和固定条目注入。
// 抽取是异步的，不阻塞回复；失败静默。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from '../../llm-call.mjs'
import { writeJsonAtomic } from '../../settings-store.mjs'

export const RELATIONSHIP_VERSION = 1
export const RELATIONSHIP_MAX = 60
export const RELATIONSHIP_DIGEST_LIMIT = 4

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}
function bigrams(value) {
  const chars = Array.from(String(value ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase())
  const set = new Set()
  for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}
function overlapScore(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let n = 0
  for (const g of A) if (B.has(g)) n += 1
  return n / A.size
}

export function emptyRelationship() {
  return { ok: true, v: RELATIONSHIP_VERSION, updatedAt: 0, entries: [] }
}
export function normalizeRelationship(raw) {
  const out = emptyRelationship()
  if (!raw || typeof raw !== 'object') return out
  out.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  out.entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => ({
      id: clean(entry.id, 60) || `rel-${Math.random().toString(36).slice(2, 8)}`,
      kind: ['preference', 'boundary', 'important', 'agreement', 'memory'].includes(entry.kind) ? entry.kind : 'memory',
      text: clean(entry.text, 160),
      pinned: entry.pinned === true,
      confidence: ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : 'medium',
      evidence: clean(entry.evidence, 120),
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
    }))
    .filter((entry) => entry.text.length >= 4)
    .slice(-RELATIONSHIP_MAX)
  return out
}
export function buildRelationshipExtractionPrompt(messages) {
  const lines = (Array.isArray(messages) ? messages : []).map((m) => `${m.role === 'user' ? '他' : '你'}：${clean(m.text, 140)}`)
  return [
    '这是你和他的对话。只提取关于“他”或“你们之间”的稳定信息，不要提取你的心情、天气或一次性闲聊。',
    ...lines,
    '提取规则：',
    '1) preference：他喜欢/不喜欢/在意的具体事物（≤40字），如“他喜欢晚上做事”“他不爱被追问”。',
    '2) boundary：他明确说过不要/别做/受不了的事，或你需要守的边界。',
    '3) important：对他在意的事（工作压力、家人、健康、约定日期）。',
    '4) agreement：你们明确约定、答应过的事（谁答应做什么、什么时候）。',
    '5) memory：你们共同经历过、以后可以自然提起的小事。',
    '没有就不写；最多 4 条；每条给 evidence（对话里的原话片段，≤30字）和 confidence（high/medium/low）。',
    '只输出严格 JSON：{"entries":[{"kind":"preference|boundary|important|agreement|memory","text":"…","evidence":"…","confidence":"high|medium|low"}]}',
  ].join('\n')
}
export function parseRelationshipExtraction(text) {
  const source = String(text ?? '')
  const first = source.indexOf('{'); const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw = null
  try { raw = JSON.parse(source.slice(first, last + 1)) } catch { return null }
  const entries = (Array.isArray(raw?.entries) ? raw.entries : [])
    .filter((e) => e && typeof e.text === 'string' && e.text.trim().length >= 4)
    .slice(0, 5)
    .map((e) => ({
      kind: ['preference', 'boundary', 'important', 'agreement', 'memory'].includes(e.kind) ? e.kind : 'memory',
      text: clean(e.text, 40),
      evidence: clean(e.evidence, 30),
      confidence: ['high', 'medium', 'low'].includes(e.confidence) ? e.confidence : 'medium',
    }))
  return entries.length > 0 ? entries : null
}
export function mergeRelationship(state, entries, at = Date.now()) {
  const rel = normalizeRelationship(state)
  let added = 0
  for (const entry of entries) {
    const existing = rel.entries.find((item) => overlapScore(item.text, entry.text) >= 0.7)
    if (existing) {
      if (entry.confidence === 'high') existing.confidence = 'high'
      if (entry.evidence && !existing.evidence.includes(entry.evidence)) existing.evidence = entry.evidence
      existing.updatedAt = at
      continue
    }
    rel.entries.push({
      id: `rel-${at}-${rel.entries.length + 1}`,
      kind: entry.kind,
      text: entry.text,
      pinned: entry.kind === 'boundary' || entry.confidence === 'high',
      confidence: entry.confidence,
      evidence: entry.evidence,
      createdAt: at,
      updatedAt: at,
    })
    added += 1
  }
  rel.entries = rel.entries.slice(-RELATIONSHIP_MAX)
  rel.updatedAt = at
  return { relationship: rel, added }
}
export function formatRelationshipDigest(state, query = '') {
  const rel = normalizeRelationship(state)
  if (rel.entries.length === 0) return []
  const pinned = rel.entries.filter((entry) => entry.pinned).slice(-3)
  const relevant = rel.entries
    .map((entry) => ({ entry, score: overlapScore(query, entry.text) }))
    .filter((item) => item.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.entry)
  const chosen = []
  for (const entry of [...pinned, ...relevant]) if (!chosen.some((item) => item.id === entry.id)) chosen.push(entry)
  if (chosen.length === 0) return []
  const label = { preference: '他喜欢/在意', boundary: '他的边界', important: '对他的重要事', agreement: '你们的约定', memory: '你们的共同经历' }
  return chosen.slice(0, RELATIONSHIP_DIGEST_LIMIT).map((entry) => `（${label[entry.kind]}）${entry.text}${entry.evidence ? `（依据：${entry.evidence}）` : ''}`)
}
export function createRelationshipMemory(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'relationship.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const policy = options.policy ?? null
  const resolveLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const disabled = String((options.env ?? process.env).DSH_POETRY_RELATIONSHIP ?? '').toLowerCase() === 'off'
  let state = readFile(file)
  function readFile() {
    try { return normalizeRelationship(JSON.parse(readFileSync(file, 'utf8'))) } catch { return emptyRelationship() }
  }
  function save(next) {
    try { mkdirSync(path.dirname(file), { recursive: true }); writeJsonAtomic(file, normalizeRelationship(next)); state = next } catch { /* ignore */ }
  }
  function snapshot() { return { updatedAt: state.updatedAt, entries: state.entries.length, pinned: state.entries.filter((e) => e.pinned).length } }
  function digest(query = '') { return formatRelationshipDigest(state, query) }
  async function ingest(messages) {
    if (disabled) return { ok: false, reason: 'disabled' }
    if (!Array.isArray(messages) || messages.length === 0) return { ok: false, reason: 'empty' }
    try {
      const prompt = buildRelationshipExtractionPrompt(messages)
      const result = await callModelForRole({ role: 'consolidate', policy, resolveLlm, system: '你在维护小鲸鱼与用户之间的关系记忆；只根据对话提取，不编造。', prompt, maxTokens: 1500, timeoutMs: 60000, timeoutCode: 'RELATIONSHIP_TIMEOUT', timeoutMessage: '关系记忆抽取超时', prefix: '关系记忆候选失败', modelErrorsPath, warn: (m) => logger?.warn?.(`[dsh-little-whale] ${m}`) })
      const entries = result === null ? null : parseRelationshipExtraction(result.text)
      if (entries === null) return { ok: false, reason: 'invalid' }
      const merged = mergeRelationship(state, entries, now())
      save(merged.relationship)
      return { ok: true, added: merged.added, entries }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
  return { file, digest, ingest, snapshot, read: () => state }
}
