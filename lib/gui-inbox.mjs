// lib/gui-inbox.mjs —— 她的“想对你说的话”队列（v2.69）。
//
// 用户不再用 QQ 以后，主动消息/放行的注意力草稿不再往 QQ 送，而是先存进这个队列；
// 下次你在「小鲸鱼（对话）」里说话时，传话工具会把队列里的消息一并带给你（每条各起一行），
// 然后她再回你。这样既可以“自己提起”，又不需要另开一套推送通道。
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveSettingsPath, writeJsonAtomic } from './settings-store.mjs'

export const GUI_INBOX_MAX = 20
export const GUI_INBOX_TEXT_MAX = 500

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function resolveGuiInboxPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'gui-inbox.json')
}

export function readGuiInbox(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const items = Array.isArray(parsed?.items) ? parsed.items.filter((item) => isPlainObject(item) && typeof item.text === 'string') : []
    return items.slice(-GUI_INBOX_MAX)
  } catch {
    return []
  }
}

/** 追加一条；返回落盘后的队列。 */
export function pushGuiInbox(file, entry = {}) {
  const text = cleanInline(entry.text, GUI_INBOX_TEXT_MAX)
  if (text.length === 0) return readGuiInbox(file)
  const items = readGuiInbox(file)
  items.push({
    id: `gui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    kind: cleanInline(entry.kind, 20) || 'proactive',
    reason: cleanInline(entry.reason, 120),
    at: Date.now(),
  })
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeJsonAtomic(file, { ok: true, v: 1, items: items.slice(-GUI_INBOX_MAX) })
  } catch {
    /* 落盘失败不影响内存队列的调用方 */
  }
  return items.slice(-GUI_INBOX_MAX)
}

/** 取走全部（清空）——给传话层用。 */
export function drainGuiInbox(file, limit = 5) {
  const items = readGuiInbox(file)
  if (items.length === 0) return []
  const taken = items.slice(0, Math.max(1, Math.min(limit, GUI_INBOX_MAX)))
  const rest = items.slice(taken.length)
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeJsonAtomic(file, { ok: true, v: 1, items: rest })
  } catch {
    /* ignore */
  }
  return taken
}

export function createGuiInbox(options = {}) {
  const file = path.resolve(options.file ?? resolveGuiInboxPath(options.env ?? process.env, options.home ?? null))
  return {
    file,
    push: (entry) => pushGuiInbox(file, entry),
    drain: (limit) => drainGuiInbox(file, limit),
    peek: () => readGuiInbox(file),
  }
}
