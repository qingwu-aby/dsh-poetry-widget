// @ts-check
// 同一主题/事务跨场景关联：Minecraft、Study、Video、Reading 都写同一个 topic。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MAX_TOPICS = 500
const MAX_LINKS = 12

export function normalizeTopic(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 80)
}

export function createTopicHub(options = {}) {
  const file = typeof options.file === 'string' ? options.file : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = { ok: true, v: 1, updatedAt: 0, topics: {} }
  try {
    if (file && existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      if (raw && raw.topics && typeof raw.topics === 'object') state = { ...state, ...raw }
    }
  } catch {
    /* 坏文件降级为空 */
  }
  function persist() {
    if (!file) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp-' + process.pid
      const payload = { ...state, updatedAt: now() }
      writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })
      renameSync(tmp, file)
      state = payload
    } catch {
      /* 写失败不影响内存 */
    }
  }
  function link(input = {}) {
    const topic = normalizeTopic(input.topic)
    if (!topic) return { ok: false, error: 'topic_required' }
    const entry = state.topics[topic] && typeof state.topics[topic] === 'object'
      ? state.topics[topic]
      : { topic, createdAt: now(), links: [], methods: [] }
    const link = {
      activity: String(input.activity || 'unknown').slice(0, 40),
      source: String(input.source || '').slice(0, 120),
      url: String(input.url || '').slice(0, 500),
      title: String(input.title || '').slice(0, 160),
      summary: String(input.summary || '').slice(0, 1200),
      at: now(),
    }
    entry.links.push(link)
    entry.links = entry.links.slice(-MAX_LINKS)
    if (input.method) entry.methods = [String(input.method).slice(0, 1200), ...entry.methods].slice(0, 8)
    entry.updatedAt = now()
    state.topics[topic] = entry
    const keys = Object.keys(state.topics)
    if (keys.length > MAX_TOPICS) {
      const oldest = keys.sort((a, b) => (state.topics[a].updatedAt || 0) - (state.topics[b].updatedAt || 0))[0]
      delete state.topics[oldest]
    }
    persist()
    return { ok: true, entry }
  }
  function query(topic) {
    const key = normalizeTopic(topic)
    return key && state.topics[key] ? { ok: true, entry: state.topics[key] } : { ok: false, error: 'not_found' }
  }
  function snapshot() {
    return { ok: true, v: 1, file, topics: Object.keys(state.topics).length, updatedAt: state.updatedAt }
  }
  return { file, link, query, snapshot }
}
