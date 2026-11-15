// lib/domain/play/minecraft-brain.mjs —— Minecraft 行动决策（v0.6.0）
//
// 她在游戏里看到什么、能做什么，由她自己的模型决定；这里只做：
//   观察文本 → 严格 JSON 动作 → 白名单校验 → 返回给 bot。
// 不写 journal、不进聊天历史；游戏过程只通过 worldFeedback 记录摘要（由上层决定）。
import { callModel } from '../../kernel/model-call.mjs'
import { readChatToken } from '../chat/facade.mjs'

export const MINECRAFT_ACTIONS = Object.freeze(['idle', 'chat', 'look', 'jump', 'move', 'follow', 'eat', 'wander', 'explore', 'mine', 'collect', 'place', 'attack', 'plan'])
const DIRECTIONS = Object.freeze(['forward', 'back', 'left', 'right'])

function clean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function buildMinecraftDecisionPrompt(observation = {}, context = {}) {
  const obs = observation && typeof observation === 'object' ? observation : {}
  const state = context.selfState && typeof context.selfState === 'object' ? context.selfState : null
  const players = Array.isArray(obs.players) ? obs.players.filter((p) => typeof p === 'string').slice(0, 6) : []
  const lines = [
    '你正在玩 Minecraft。根据下面的观察，决定你下一件要做的事。',
    '',
    `位置：${clean(obs.position, 60) || '未知'}；血量：${obs.health ?? '?'}；饥饿：${obs.food ?? '?'}；时间：${clean(obs.timeOfDay, 20) || '未知'}。`,
    players.length > 0 ? `附近玩家：${players.join('、')}` : '附近没有其他玩家。',
    Array.isArray(obs.nearbyBlocks) && obs.nearbyBlocks.length > 0 ? `附近方块：${obs.nearbyBlocks.slice(0, 6).join('、')}` : '',
    Array.isArray(obs.inventory) && obs.inventory.length > 0 ? `背包：${obs.inventory.slice(0, 8).join('、')}` : '背包是空的。',
    obs.lastChat ? `最近有人说话：${clean(obs.lastChat, 80)}` : '',
    Array.isArray(context.memoryLines) && context.memoryLines.length > 0 ? `你记得的：${context.memoryLines.join('；')}` : '',
    state && (state.felt || state.experiencing)
      ? `你此刻：${clean([state.felt, state.experiencing].filter(Boolean).join('；'), 100)}`
      : '',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown、不要额外文字。可选动作：',
    '{"action":"idle"} —— 站着看看，什么都不做',
    '{"action":"chat","say":"不超过20字"} —— 在游戏里说一句话',
    '{"action":"look","yaw":0,"pitch":0} —— 转头（yaw 0–360，pitch -80–80）',
    '{"action":"jump"} —— 原地跳一下',
    '{"action":"move","direction":"forward|back|left|right","seconds":1|2|3} —— 走一小段',
    '{"action":"follow","player":"玩家名"} —— 朝一个附近玩家走过去一小段',
    '{"action":"eat"} —— 如果背包里有食物就吃',
    '{"action":"wander"} —— 在附近随便走走看看',
    '{"action":"explore"} —— 朝一个方向走远一点（10–20 秒）',
    '{"action":"mine"} —— 挖附近一个自然方块（木头/石头/沙土）',
    '{"action":"collect"} —— 捡附近掉落物',
    '{"action":"place"} —— 用背包里的方块在面前放一块',
    '{"action":"attack"} —— 只打靠近的敌对生物（僵尸/骷髅/苦力怕/蜘蛛）',
    '{"action":"plan","text":"一句话"} —— 记下你现在想做的事',
    '',
    '你可以自由活动：想走就走、想挖就挖、想说话就说话。',
    '唯一的安全边界：不攻击玩家、不在玩家建筑附近拆放方块、血量太低时先照顾自己。',
    '不确定时 idle 或 wander 都可以。',
  ]
  return lines.filter((line) => line.length > 0).join('\n')
}

function extractJson(text) {
  const source = String(text ?? '')
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  try {
    return JSON.parse(source.slice(first, last + 1))
  } catch (_error) {
    return null
  }
}

export function parseMinecraftAction(text, options = {}) {
  const raw = extractJson(text)
  if (!raw || typeof raw !== 'object') return null
  const action = clean(raw.action, 20).toLowerCase()
  if (!MINECRAFT_ACTIONS.includes(action)) return null
  if (action === 'chat') {
    const say = clean(raw.say, 40)
    return say.length > 0 ? { action, say } : null
  }
  if (action === 'look') {
    const yaw = Number(raw.yaw)
    const pitch = Number(raw.pitch)
    return {
      action,
      yaw: Number.isFinite(yaw) ? Math.max(-180, Math.min(360, yaw)) : 0,
      pitch: Number.isFinite(pitch) ? Math.max(-80, Math.min(80, pitch)) : 0,
    }
  }
  if (action === 'move') {
    const direction = DIRECTIONS.includes(raw.direction) ? raw.direction : 'forward'
    const seconds = Number.isFinite(Number(raw.seconds)) ? Math.max(1, Math.min(3, Math.round(Number(raw.seconds)))) : 2
    return { action, direction, seconds }
  }
  if (action === 'plan') {
    const text = clean(raw.text, 160)
    return text.length > 0 ? { action, text } : null
  }
  if (action === 'follow') {
    const player = clean(raw.player, 24)
    const players = Array.isArray(options.players) ? options.players : []
    if (player.length === 0 || (players.length > 0 && !players.includes(player))) return null
    return { action, player }
  }
  return { action }
}

export function createMinecraftBrain(options = {}) {
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const getSelfState = typeof options.getSelfState === 'function' ? options.getSelfState : () => null
  const gameMemory = options.gameMemory ?? null

  async function decide(observation) {
    const obs = observation && typeof observation === 'object' ? observation : {}
    const memoryLines = gameMemory && typeof gameMemory.promptLines === 'function' ? gameMemory.promptLines(3) : []
    const prompt = buildMinecraftDecisionPrompt(obs, { selfState: getSelfState(), memoryLines })
    let result = null
    try {
      result = await callModel({
        role: 'drive',
        policy,
        resolveLlm: getLlm,
        system: '你住在 DSH 的鲸鱼娘插件里，现在正在玩 Minecraft。你只输出 JSON 动作，不解释。',
        prompt,
        maxTokens: 500,
        timeoutMs: 25000,
        timeoutCode: 'MINECRAFT_DECISION_TIMEOUT',
        timeoutMessage: 'Minecraft 行动决策超时',
        prefix: 'Minecraft 行动决策失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error), action: { action: 'idle' } }
    }
    if (result === null) return { ok: false, reason: 'llm', action: { action: 'idle' } }
    const action = parseMinecraftAction(result.text, { players: obs.players })
    if (action === null) {
      logger?.warn?.('[dsh-little-whale] Minecraft 决策不是合法 JSON 动作，退回 idle')
      return { ok: false, reason: 'invalid', action: { action: 'idle' }, raw: clean(result.text, 200) }
    }
    return { ok: true, action }
  }
  return { decide }
}

export function createMinecraftDecisionHandler(options = {}) {
  const brain = options.brain ?? null
  const tokenFile = options.tokenFile ?? ''
  return async function minecraftDecisionHandler(req, res) {
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    if (String(req?.method ?? 'GET').toUpperCase() !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (_error) {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    const expected = readChatToken(tokenFile)
    if (expected.length === 0 || !payload || payload.token !== expected) {
      send(403, { ok: false, error: 'forbidden' })
      return
    }
    if (brain === null || typeof brain.decide !== 'function') {
      send(200, { ok: false, error: 'unavailable', action: { action: 'idle' } })
      return
    }
    try {
      const result = await brain.decide(payload.observation)
      send(200, result)
    } catch (error) {
      send(200, { ok: false, error: error instanceof Error ? error.message : String(error), action: { action: 'idle' } })
    }
  }
}

export function createGameMemoryHandler(options = {}) {
  const gameMemory = options.gameMemory ?? null
  const tokenFile = options.tokenFile ?? ''
  return async function gameMemoryHandler(req, res) {
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    if (String(req?.method ?? 'GET').toUpperCase() !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (_error) {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    const expected = readChatToken(tokenFile)
    if (expected.length === 0 || !payload || payload.token !== expected) {
      send(403, { ok: false, error: 'forbidden' })
      return
    }
    if (gameMemory === null || typeof gameMemory.record !== 'function') {
      send(200, { ok: false, error: 'unavailable' })
      return
    }
    send(200, gameMemory.record({ category: payload.category, text: payload.text, source: payload.source }))
  }
}
