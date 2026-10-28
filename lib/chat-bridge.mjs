// lib/chat-bridge.mjs —— QQ / 外部聊天桥（v2.45）。
//
// 只把用户的一句话当成一次真实外部事件，交给她自己的记忆/状态/语气回复。
// 不读取 DSH 会话上下文；对话历史按 peer 单独存，不进入别人的记忆。
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { callModelForRole } from './llm-call.mjs'
import { formatMemoryDigest } from './memory-recall.mjs'
import { formatBeingLine } from './self-being.mjs'
import { naturalStyleLines } from './language-style.mjs'
import { resolveSettingsPath } from './settings-store.mjs'

export const CHAT_ROUTE = '/api/dsh-poetry/chat.json'
export const CHAT_TEXT_MAX = 240
export const CHAT_REPLY_MAX = 500
export const CHAT_HISTORY_MAX = 40
export const CHAT_RATE_MIN_MS = 300
export const CHAT_HOURLY_MAX = 0 // 0 = 不限；只保留最小间隔，避免刷屏

function cleanInline(value, max = CHAT_TEXT_MAX) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function resolveChatTokenPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'chat-token')
}

export function ensureChatToken(file) {
  try {
    if (existsSync(file)) {
      const token = readFileSync(file, 'utf8').trim()
      if (token.length >= 16) return token
    }
  } catch {
    /* ignore */
  }
  const token = randomBytes(24).toString('hex')
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, token + '\n', { encoding: 'utf8', mode: 0o600 })
    chmodSync(file, 0o600)
  } catch {
    /* ignore */
  }
  return token
}

export function readChatToken(file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

function extractJson(text) {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createChatBridge(options = {}) {
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => options.llm
  const policy = options.policy ?? null
  const journal = options.journal
  const selfState = options.selfState ?? null
  const recall = options.recall ?? null
  const voice = typeof options.voice === 'function' ? options.voice : null
  const events = options.events ?? null
  const onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : null
  const worldFeedback = options.worldFeedback ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const stateDir = options.stateDir ?? resolveSettingsPath(options.env ?? process.env, options.home ?? null).dir
  const historyPath = path.join(stateDir, 'chat-history.json')
  const rate = new Map()

  function readHistory() {
    try {
      if (!existsSync(historyPath)) return {}
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function saveHistory(data) {
    try {
      mkdirSync(path.dirname(historyPath), { recursive: true })
      writeFileSync(historyPath, JSON.stringify(data).slice(0, 200000), 'utf8')
    } catch {
      /* ignore */
    }
  }

  function lastUserAt() {
    const data = readHistory()
    let latest = 0
    for (const entries of Object.values(data)) {
      if (!Array.isArray(entries)) continue
      for (const item of entries) {
        if (item && item.role === 'user' && Number.isFinite(item.at)) latest = Math.max(latest, item.at)
      }
    }
    return latest
  }

  function allowPeer(peerId) {
    const key = cleanInline(peerId, 80) || 'default'
    const at = now()
    const record = rate.get(key) ?? { last: 0, hourStart: at, count: 0 }
    if (at - record.last < CHAT_RATE_MIN_MS) return false
    if (at - record.hourStart > 60 * 60 * 1000) {
      record.hourStart = at
      record.count = 0
    }
    if (CHAT_HOURLY_MAX > 0 && record.count >= CHAT_HOURLY_MAX) return false
    record.last = at
    record.count += 1
    rate.set(key, record)
    return true
  }

  async function chat(input = {}) {
    const text = cleanInline(input.text, CHAT_TEXT_MAX)
    if (text.length < 1) return { ok: false, error: 'empty' }
    const peerId = cleanInline(input.peerId, 80) || 'default'
    if (!allowPeer(peerId)) return { ok: false, error: 'rate_limited' }
    const history = readHistory()
    const peerHistory = Array.isArray(history[peerId]) ? history[peerId].slice(-CHAT_HISTORY_MAX) : []
    const state = selfState && typeof selfState.snapshot === 'function' ? selfState.snapshot() : null
    const voiceNow = voice !== null ? voice() : null
    let digest = ''
    try {
      if (recall && typeof recall.digest === 'function') digest = formatMemoryDigest(recall.digest({ recentTexts: [text] }))
    } catch {
      digest = ''
    }
    const prompt = [
      `你正在 QQ 上和一个具体的人说话。对方说：${text}`,
      state ? formatBeingLine(state) : '',
      state && state.experiencing ? `你最近在琢磨：${state.experiencing}` : '',
      voiceNow && typeof voiceNow.profile === 'string' ? `你自己的说话方式：${cleanInline(voiceNow.profile, 500)}` : '',
      digest,
      peerHistory.length > 0
        ? `你们最近聊过：\n${peerHistory.map((item) => `${item.role === 'user' ? '对方' : '你'}：${item.text}`).join('\n')}`
        : '',
      '请像在 QQ/微信上回消息一样说 1–3 句：可以短、可以反问你、可以说不知道；不要客服腔，不要报幕，不要提模型/系统/提示词，不要每次总结。',
      '不要重复你最近已经说过的话；不要反复写“嗓子干/说两句停一下/耳机线”这类状态。上面 history 里出现过的句子，换一个具体的事或干脆不写。',
      '这次对话可能会改变你此刻的状态。如果确实有变化，顺手写下来；没有变化就留空，不要为了每轮都填而重复同一句。',
      'felt：一句具体的此刻状态（≤60字，可空）；experiencing：最近在琢磨的事（≤80字，可空）；murmur：如果心里冒出一句碎碎念（≤80字，可空）。',
      ...naturalStyleLines(['reply 不要用“作为一个……”开头，也不要自称 AI。']),
      '只输出严格 JSON：{"reply":"你的回复（≤300 字）","felt":"可空","experiencing":"可空","murmur":"可空"}',
    ]
      .filter(Boolean)
      .join('\n')
    const result = await callModelForRole({
      role: 'selfTalk',
      agent: 'primary',
      policy,
      resolveLlm: getLlm,
      system: '你是小鲸鱼，在和一个具体的人说话；你不是客服。',
      prompt,
      maxTokens: 500,
      timeoutMs: 40000,
      timeoutCode: 'CHAT_TIMEOUT',
      timeoutMessage: '聊天回复超时',
      prefix: '聊天候选失败',
      modelErrorsPath,
      warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
    })
    if (result === null) return { ok: false, error: 'llm' }
    const parsed = extractJson(result.text)
    let reply = cleanInline(parsed?.reply || result.text, CHAT_REPLY_MAX)
    reply = reply.replace(/^["“]|["”]$/g, '').trim()
    if (reply.length === 0) return { ok: false, error: 'empty_reply' }
    const felt = parsed && typeof parsed.felt === 'string' ? cleanInline(parsed.felt, 60) : ''
    const experiencing = parsed && typeof parsed.experiencing === 'string' ? cleanInline(parsed.experiencing, 80) : ''
    const murmur = parsed && typeof parsed.murmur === 'string' ? cleanInline(parsed.murmur, 80) : ''
    peerHistory.push({ role: 'user', text, at: now() })
    peerHistory.push({ role: 'whale', text: reply, at: now() })
    history[peerId] = peerHistory.slice(-CHAT_HISTORY_MAX)
    saveHistory(history)
    let changed = false
    try {
      if (selfState && felt.length > 0 && typeof selfState.setFelt === 'function') {
        selfState.setFelt(felt, now())
        changed = true
      }
      if (selfState && experiencing.length > 0 && typeof selfState.setExperiencing === 'function') {
        selfState.setExperiencing(experiencing, now())
        changed = true
      }
    } catch {
      /* ignore */
    }
    try {
      if (journal && typeof journal.append === 'function') {
        await journal.append({ kind: 'thought', text: `QQ 上的人对你说：${text}\n你说：${reply}` })
        if (murmur.length > 0) {
          await journal.append({ kind: 'murmur', text: murmur })
          changed = true
        }
      }
    } catch {
      /* ignore */
    }
    if (changed && onStateChanged !== null) {
      try {
        const pending = onStateChanged()
        if (pending && typeof pending.catch === 'function') pending.catch(() => {})
      } catch {
        /* 状态通知失败不影响回复 */
      }
    }
    try {
      if (worldFeedback && typeof worldFeedback.record === 'function') {
        worldFeedback.record({ source: 'user', kind: 'chat', ok: true, summary: `QQ：${text.slice(0, 120)}` })
      }
    } catch {
      /* ignore */
    }
    return { ok: true, reply, peerId }
  }

  async function proactive(input = {}) {
    const peerId = cleanInline(input.peerId, 80) || 'qq'
    const history = readHistory()
    const peerHistory = Array.isArray(history[peerId]) ? history[peerId].slice(-CHAT_HISTORY_MAX) : []
    const state = selfState && typeof selfState.snapshot === 'function' ? selfState.snapshot() : null
    const voiceNow = voice !== null ? voice() : null
    const prompt = [
      '你想主动找 QQ 上的这个人说句话，不是等他先开口。',
      state ? formatBeingLine(state) : '',
      state && state.experiencing ? `你最近在琢磨：${state.experiencing}` : '',
      voiceNow && typeof voiceNow.profile === 'string' ? `你自己的说话方式：${cleanInline(voiceNow.profile, 500)}` : '',
      peerHistory.length > 0
        ? `你们最近聊过：\n${peerHistory.slice(-8).map((item) => `${item.role === 'user' ? '对方' : '你'}：${item.text}`).join('\n')}`
        : '你们刚认识，还没有聊过。',
      '直接说一件你此刻真的想告诉他/问他/给他看的事；1–2 句，像 QQ 上突然发来的一条消息。不要问“在吗”，不要客服腔，不要总结，不要重复最近说过的话。',
      '只输出严格 JSON：{"reply":"你想发的话（≤200字）"}',
    ].filter(Boolean).join('\n')
    const result = await callModelForRole({
      role: 'selfTalk',
      agent: 'primary',
      policy,
      resolveLlm: getLlm,
      system: '你是小鲸鱼；你正在主动给一个具体的人发 QQ 消息，不是在写文案。',
      prompt,
      maxTokens: 400,
      timeoutMs: 40000,
      timeoutCode: 'CHAT_PROACTIVE_TIMEOUT',
      timeoutMessage: '主动聊天生成超时',
      prefix: '主动聊天候选失败',
      modelErrorsPath,
      warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
    })
    if (result === null) return { ok: false, error: 'llm' }
    const parsed = extractJson(result.text)
    let reply = cleanInline(parsed?.reply || result.text, CHAT_REPLY_MAX)
    reply = reply.replace(/^["“]|["”]$/g, '').trim()
    if (reply.length === 0) return { ok: false, error: 'empty_reply' }
    peerHistory.push({ role: 'whale', text: reply, at: now(), proactive: true })
    history[peerId] = peerHistory.slice(-CHAT_HISTORY_MAX)
    saveHistory(history)
    try {
      if (journal && typeof journal.append === 'function') {
        await journal.append({ kind: 'thought', text: `我主动找 QQ 上的人：${reply}` })
      }
    } catch {
      /* ignore */
    }
    return { ok: true, reply, peerId }
  }

  return { chat, proactive, lastUserAt }
}

/** POST /chat.json，token 文件保护。 */
export function createChatHandler(options = {}) {
  const service = options.service
  const tokenFile = options.tokenFile
  return async function chatHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    const expected = readChatToken(tokenFile)
    if (expected.length === 0 || !payload || typeof payload.token !== 'string' || payload.token !== expected) {
      send(403, { ok: false, error: 'forbidden' })
      return
    }
    const result = await service.chat({ text: payload.text, peerId: payload.peerId, name: payload.name })
    send(result.ok === true ? 200 : 400, result)
  }
}
