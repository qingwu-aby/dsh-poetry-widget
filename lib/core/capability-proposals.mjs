// @ts-check
// 能力提案：她发现缺原语时只记录提案，不自动注册代码/插件。
import fs from 'node:fs'
import path from 'node:path'

const MAX = 200
function clean(value, max) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
export function createCapabilityProposals(options = {}) {
  const file = typeof options.file === 'string' ? options.file : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let items = []
  try { if (file && fs.existsSync(file)) { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(raw.items)) items = raw.items.slice(0, MAX) } } catch (error) { void error }
  function persist() {
    if (!file) return
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify({ v: 1, items }, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file) } catch (error) { void error }
  }
  function propose(input = {}) {
    const capability = clean(input.capability, 160)
    if (capability.length < 2) return { ok: false, error: 'capability_required' }
    const existing = items.find((item) => item.status === 'pending' && item.capability === capability && item.activityId === clean(input.activityId || 'minecraft', 40))
    if (existing) return { ok: true, duplicate: true, item: { ...existing } }
    const item = { id: 'cap-' + now().toString(36), activityId: clean(input.activityId || 'minecraft', 40), capability, reason: clean(input.reason, 400), evidence: clean(input.evidence, 600), status: 'pending', at: now() }
    items.push(item); if (items.length > MAX) items = items.slice(-MAX); persist()
    return { ok: true, item: { ...item } }
  }
  function setStatus(id, status, note = '') {
    const normalized = ['pending', 'approved', 'implemented', 'rejected'].includes(status) ? status : ''
    if (!normalized) return { ok: false, error: 'invalid_status' }
    const item = items.find((entry) => entry.id === clean(id, 80))
    if (!item) return { ok: false, error: 'not_found' }
    item.status = normalized
    item.reviewNote = clean(note, 300)
    item.reviewedAt = now()
    persist()
    return { ok: true, item: { ...item } }
  }
  function list() { return { ok: true, items: items.slice(-100).map((item) => ({ ...item })) } }
  return { file, propose, list, setStatus }
}
