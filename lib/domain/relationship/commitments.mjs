// lib/commitments.mjs —— 承诺账本（v2.99）
//
// 记：她答应用户的事、你们约定的事；到期/逾期会出现在 prompt 里提醒她。
// 不自动判定“做完了”——那需要她自己在自处/对话里说；这里只管记账与提醒。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

export const COMMITMENTS_VERSION = 1
export const COMMITMENTS_MAX = 48

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
function similar(a, b, threshold = 0.7) {
  const A = bigrams(a); const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return false
  let n = 0
  for (const g of A) if (B.has(g)) n += 1
  return (2 * n) / (A.size + B.size) >= threshold
}

export function emptyCommitments() {
  return { ok: true, v: COMMITMENTS_VERSION, updatedAt: 0, entries: [] }
}
export function normalizeCommitments(raw) {
  const out = emptyCommitments()
  if (!raw || typeof raw !== 'object') return out
  out.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  out.entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((entry) => ({
      id: clean(entry.id, 60) || `cm-${Math.random().toString(36).slice(2, 8)}`,
      text: clean(entry.text, 120),
      who: entry.who === 'user' ? 'user' : 'whale',
      dueAt: Number.isFinite(entry.dueAt) ? entry.dueAt : 0,
      status: ['open', 'done', 'dropped', 'failed'].includes(entry.status) ? entry.status : 'open',
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
    }))
    .filter((entry) => entry.text.length >= 3)
    .slice(-COMMITMENTS_MAX)
  return out
}
export function readCommitments(file) {
  try { return normalizeCommitments(JSON.parse(readFileSync(file, 'utf8'))) } catch { return emptyCommitments() }
}
export function saveCommitments(file, state) {
  try { mkdirSync(path.dirname(file), { recursive: true }); writeJsonAtomic(file, normalizeCommitments(state)); return true } catch { return false }
}
/** 从关系记忆的 agreement 条目落账；没有 due 就留 0（靠她自处时自己判断）。 */
export function addAgreement(state, text, at = Date.now()) {
  const commitments = normalizeCommitments(state)
  const value = clean(text, 120)
  if (value.length < 3) return { commitments, added: false }
  if (commitments.entries.some((entry) => entry.status === 'open' && similar(entry.text, value))) return { commitments, added: false }
  commitments.entries.push({ id: `cm-${at}-${commitments.entries.length + 1}`, text: value, who: 'whale', dueAt: 0, status: 'open', createdAt: at, updatedAt: at })
  commitments.entries = commitments.entries.slice(-COMMITMENTS_MAX)
  commitments.updatedAt = at
  return { commitments, added: true }
}
export function markCommitment(state, id, status = 'done', at = Date.now()) {
  const commitments = normalizeCommitments(state)
  const entry = commitments.entries.find((item) => item.id === id)
  if (entry === undefined) return { commitments, updated: false }
  entry.status = ['done', 'dropped', 'failed', 'open'].includes(status) ? status : 'done'
  entry.updatedAt = at
  commitments.updatedAt = at
  return { commitments, updated: true }
}
/** 还开着的承诺：逾期优先、其次今天到期、再其次没定日期的。 */
export function formatCommitmentsDigest(state, at = Date.now(), limit = 3) {
  const commitments = normalizeCommitments(state)
  const open = commitments.entries.filter((entry) => entry.status === 'open')
  if (open.length === 0) return []
  const rank = (entry) => {
    if (entry.dueAt > 0 && entry.dueAt < at) return 0
    if (entry.dueAt > 0 && entry.dueAt - at <= 24 * 3600000) return 1
    if (entry.dueAt > 0) return 2
    return 3
  }
  const label = (entry) => {
    if (entry.dueAt > 0 && entry.dueAt < at) return `已逾期 ${Math.round((at - entry.dueAt) / 3600000)} 小时`
    if (entry.dueAt > 0) return `约在 ${new Date(entry.dueAt).toLocaleString('zh-CN', { hour12: false })}`
    return '还没定时间'
  }
  return open
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((entry) => {
      const suffix = entry.dueAt > 0 || entry.status === 'open' ? '→ 如果今天有空，就先做这个；做不了就直说，不要假装忘了' : ''
      return `答应过：${entry.text}（${label(entry)}）${suffix}`
    })
}

/** 执行意图（如果…就…）：把到期的承诺改写成可执行的条件句，供 prompt 使用。 */
export function formatImplementationIntentions(state, at = Date.now(), limit = 2) {
  const commitments = normalizeCommitments(state)
  const open = commitments.entries.filter((entry) => entry.status === 'open')
  const dueSoon = open
    .filter((entry) => entry.dueAt > 0 && entry.dueAt - at <= 48 * 3600000)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, limit)
  return dueSoon.map((entry) => {
    const when = entry.dueAt < at ? '如果现在有空' : '如果到了时间或今天有空'
    return `${when}，就直接做「${entry.text}」；如果做不了，就在话里说明原因。`
  })
}
export function createCommitments(options = {}) {
  const file = path.resolve(options.file ?? path.join(process.cwd(), 'commitments.json'))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = readCommitments(file)
  function save(next) { saveCommitments(file, next); state = next }
  function addAgreementEntry(text) { const result = addAgreement(state, text, now()); if (result.added) save(result.commitments); return result.added }
  function mark(id, status) { const result = markCommitment(state, id, status, now()); if (result.updated) save(result.commitments); return result.updated }
  function digest(limit = 3) { return formatCommitmentsDigest(state, now(), limit) }
  function intentions(limit = 2) { return formatImplementationIntentions(state, now(), limit) }
  function snapshot() { return { updatedAt: state.updatedAt, open: state.entries.filter((e) => e.status === 'open').length, total: state.entries.length } }
  return { file, addAgreement: addAgreementEntry, mark, digest, intentions, snapshot, read: () => state }
}
