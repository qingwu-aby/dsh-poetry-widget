// lib/domain/play/minecraft-world.mjs —— Minecraft World（v0.9.0，P0）
//
// World 只通过“事件 + 工具 + 回执”和 Bot 沟通：
//   observe：bot 把可观察事实交给 World，World 让模型选一个工具；
//   receipt：bot 把工具执行后可验证的事实交回，World 记录下来；
//   interrupt：聊天/用户接管时可以打断当前工具，回执照实说明。
// 旧 game-decide 的 JSON action 保留为降级路径（parseMinecraftAction）。
import { callModel } from '../../kernel/model-call.mjs'
import { readChatToken } from '../chat/facade.mjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseMinecraftAction } from './minecraft-brain.mjs'

export const MINECRAFT_TOOLS = Object.freeze([
  {
    name: 'mc_move_to',
    description: '走到附近一个坐标。成功回执带实际到达位置与剩余距离。',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, range: { type: 'number' } }, required: ['x', 'z'] },
  },
  {
    name: 'mc_mine',
    description: '挖附近一个自然方块（木头/石头/沙土），并尝试把掉落物收进背包。回执带方块名与背包变化。',
    parameters: { type: 'object', properties: { block: { type: 'string' } }, required: [] },
  },
  {
    name: 'mc_place',
    description: '在面前放一块背包里的方块。回执带目标坐标和读回的方块名。',
    parameters: { type: 'object', properties: { block: { type: 'string' } }, required: [] },
  },
  {
    name: 'mc_say',
    description: '在游戏里说一句话。',
    parameters: { type: 'object', properties: { text: { type: 'string', maxLength: 80 } }, required: ['text'] },
  },
  {
    name: 'mc_follow',
    description: '朝一个附近玩家走一小段。回执带与对方的距离。',
    parameters: { type: 'object', properties: { player: { type: 'string' } }, required: ['player'] },
  },
  {
    name: 'mc_learn',
    description: '上网查一个 Minecraft 主题，把方法写进记忆。',
    parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  },
  {
    name: 'mc_build',
    description: '尝试给自己盖一座 3×3 的小屋。回执带放下的方块数与总数。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_wait',
    description: '原地等一会儿，不做别的事。',
    parameters: { type: 'object', properties: { seconds: { type: 'number' } }, required: [] },
  },
])
const TOOL_NAMES = new Set(MINECRAFT_TOOLS.map((tool) => tool.name))
const CONTROL_TOOLS = new Set(['mc_move_to', 'mc_mine', 'mc_place', 'mc_say', 'mc_follow', 'mc_build'])

function clean(text, max = 240) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? value.slice(0, max) : value
}
function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

export function buildWorldPrompt(observation = {}, context = {}) {
  const obs = observation && typeof observation === 'object' ? observation : {}
  const players = Array.isArray(obs.players) ? obs.players.slice(0, 6).join('、') : ''
  const blocks = Array.isArray(obs.nearbyBlocks) ? obs.nearbyBlocks.slice(0, 8).join('、') : ''
  const inv = Array.isArray(obs.inventory) ? obs.inventory.slice(0, 8).join('、') : ''
  const memoryLines = Array.isArray(context.memoryLines) ? context.memoryLines : []
  const toolLines = MINECRAFT_TOOLS.map((tool) => `- ${tool.name}(${JSON.stringify(tool.parameters.properties)})：${tool.description}`).join('\n')
  return [
    '你在玩 Minecraft。下面的观察是游戏真实状态，你只能通过工具行动。',
    `位置：${clean(obs.position, 60) || '未知'}；血量：${obs.health ?? '?'}；饥饿：${obs.food ?? '?'}；时间：${clean(obs.timeOfDay, 20) || '未知'}。`,
    players ? `附近玩家：${players}` : '附近没有其他玩家。',
    blocks ? `附近方块：${blocks}` : '',
    inv ? `背包：${inv}` : '背包是空的。',
    obs.lastChat ? `最近有人说话：${clean(obs.lastChat, 80)}` : '',
    memoryLines.length > 0 ? `你记得的：${memoryLines.join('；')}` : '',
    '',
    '可用工具：',
    toolLines,
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown：',
    '{"tool":"mc_move_to","arguments":{...},"reason":"一句话为什么"}',
    '没有特别想做的事就选 mc_wait。不要作弊、不要攻击玩家、不要破坏玩家建筑；血量太低时先照顾自己。',
  ].filter(Boolean).join('\n')
}

export function parseWorldCommand(text) {
  const source = String(text ?? '')
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw = null
  try {
    raw = JSON.parse(source.slice(first, last + 1))
  } catch (_error) {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const tool = clean(raw.tool, 40)
  if (!TOOL_NAMES.has(tool)) return null
  const args = raw.arguments && typeof raw.arguments === 'object' ? raw.arguments : {}
  if (tool === 'mc_move_to') {
    const x = numberOr(args.x, NaN)
    const z = numberOr(args.z, NaN)
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    return { tool, arguments: { x, y: numberOr(args.y, NaN), z, range: Math.max(1, Math.min(4, numberOr(args.range, 2))) }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_say') {
    const text = clean(args.text, 80)
    return text.length > 0 ? { tool, arguments: { text }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_follow') {
    const player = clean(args.player, 32)
    return player.length > 0 ? { tool, arguments: { player }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_learn') {
    const topic = clean(args.topic, 80)
    return topic.length > 0 ? { tool, arguments: { topic }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_wait') return { tool, arguments: { seconds: Math.max(1, Math.min(10, numberOr(args.seconds, 3))) }, reason: clean(raw.reason, 120) }
  return { tool, arguments: { block: clean(args.block, 40) }, reason: clean(raw.reason, 120) }
}

function mapLegacyAction(action) {
  if (!action || typeof action !== 'object') return null
  if (action.action === 'chat' && action.say) return { tool: 'mc_say', arguments: { text: action.say }, reason: '旧动作降级' }
  if (action.action === 'follow' && action.player) return { tool: 'mc_follow', arguments: { player: action.player }, reason: '旧动作降级' }
  return { tool: 'mc_legacy', arguments: { action }, reason: '旧动作降级' }
}

export function createMinecraftWorld(options = {}) {
  const getLlm = options.getLlm
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const tokenFile = options.tokenFile ?? ''
  const gameMemory = options.gameMemory ?? null
  const getSelfState = typeof options.getSelfState === 'function' ? options.getSelfState : () => null
  const logger = options.logger ?? null
  const permissionFile = options.permissionFile ?? ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let sequence = 0
  const state = {
    observation: null,
    lastCommand: null,
    lastReceipt: null,
    interrupted: false,
    interruptReason: '',
    permission: 'control',
    updatedAt: 0,
  }
  if (permissionFile) {
    try {
      const saved = JSON.parse(readFileSync(permissionFile, 'utf8'))
      if (saved && ['observe', 'view', 'control', 'ask-once', 'never'].includes(saved.level)) state.permission = saved.level
    } catch (_error) {}
  }

  function selfStateLines() {
    try {
      const snap = getSelfState()
      return snap && (snap.felt || snap.experiencing) ? [clean([snap.felt, snap.experiencing].filter(Boolean).join('；'), 120)] : []
    } catch (_error) {
      return []
    }
  }

  async function decide(observation) {
    state.observation = observation && typeof observation === 'object' ? observation : {}
    state.updatedAt = now()
    if (state.interrupted) {
      state.interrupted = false
      const reason = state.interruptReason
      state.interruptReason = ''
      return { ok: true, interrupt: true, reason, command: null, permission: state.permission }
    }
    const memoryLines = gameMemory && typeof gameMemory.promptLines === 'function' ? gameMemory.promptLines(3) : []
    const prompt = buildWorldPrompt(state.observation, { memoryLines: [...memoryLines, ...selfStateLines()] })
    let result = null
    try {
      result = await callModel({
        role: 'drive',
        policy,
        resolveLlm: getLlm,
        system: '你住在 DSH 的鲸鱼娘插件里，现在通过 Minecraft World 的工具行动。只输出 JSON 工具调用。',
        prompt,
        maxTokens: 600,
        timeoutMs: 30000,
        timeoutCode: 'MINECRAFT_WORLD_TIMEOUT',
        timeoutMessage: 'Minecraft World 决策超时',
        prefix: 'Minecraft World 决策失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), command: { tool: 'mc_wait', arguments: { seconds: 2 } }, permission: state.permission }
    }
    if (result === null) {
      return { ok: false, error: 'llm', command: { tool: 'mc_wait', arguments: { seconds: 2 } }, permission: state.permission }
    }
    let command = parseWorldCommand(result.text)
    if (command === null) command = mapLegacyAction(parseMinecraftAction(result.text, { players: state.observation.players }))
    if (command === null) command = { tool: 'mc_wait', arguments: { seconds: 2 }, reason: '模型没有给出合法工具' }
    if (state.permission === 'observe' || state.permission === 'view') {
      if (CONTROL_TOOLS.has(command.tool)) {
        return { ok: true, command: { tool: 'mc_wait', arguments: { seconds: 2 }, reason: '当前只能观察' }, blocked: command, permission: state.permission }
      }
    }
    sequence += 1
    state.lastCommand = { id: `cmd-${sequence}-${now()}`, tool: command.tool, arguments: command.arguments, reason: command.reason || '', at: now() }
    return { ok: true, command: state.lastCommand, permission: state.permission, observationAt: state.updatedAt }
  }

  function recordReceipt(receipt) {
    const command = state.lastCommand
    const payload = receipt && typeof receipt === 'object' ? receipt : {}
    const ok = payload.ok === true
    const tool = clean(payload.tool || (command && command.tool), 40)
    const detail = clean(payload.detail, 240)
    const facts = payload.facts && typeof payload.facts === 'object' ? payload.facts : {}
    state.lastReceipt = { commandId: command && command.id, tool, ok, detail, facts, at: now() }
    if (gameMemory && typeof gameMemory.record === 'function') {
      try {
        gameMemory.record({ category: 'event', text: `${tool}${ok ? '成功' : '失败'}：${detail || '无回执'}`, source: 'tool' })
        if (ok && facts && facts.position) gameMemory.record({ category: 'session', text: `在 ${String(facts.position).slice(0, 60)} 做了 ${tool}`, source: 'tool' })
      } catch (_error) {}
    }
    return { ok: true, accepted: true, lastReceipt: state.lastReceipt }
  }

  function snapshot() {
    return {
      ok: true,
      observationAt: state.updatedAt,
      lastCommand: state.lastCommand,
      lastReceipt: state.lastReceipt,
      interrupted: state.interrupted,
      interruptReason: state.interruptReason,
      permission: state.permission,
    }
  }

  function handler(req, res) {
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method === 'GET') {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const expected = readChatToken(tokenFile)
      const token = url.searchParams.get('token') || ''
      if (expected.length > 0 && token === expected) send(200, snapshot())
      else send(403, { ok: false, error: 'forbidden' })
      return
    }
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    ;(async () => {
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
      if (expected.length === 0 || payload.token !== expected) {
        send(403, { ok: false, error: 'forbidden' })
        return
      }
      if (payload.action === 'observe') send(200, await decide(payload.observation))
      else if (payload.action === 'receipt') send(200, recordReceipt(payload.receipt))
      else if (payload.action === 'interrupt') {
        state.interrupted = true
        state.interruptReason = clean(payload.reason, 120)
        send(200, { ok: true, interrupt: true })
      } else if (payload.action === 'permission') {
        state.permission = ['observe', 'view', 'control', 'ask-once', 'never'].includes(payload.level) ? payload.level : state.permission
        if (permissionFile) {
          try { writeFileSync(permissionFile, JSON.stringify({ level: state.permission, updatedAt: now() }, null, 2) + '\n') } catch (_error) {}
        }
        send(200, { ok: true, permission: state.permission })
      } else send(400, { ok: false, error: 'unknown_action' })
    })().catch((error) => send(500, { ok: false, error: error instanceof Error ? error.message : String(error) }))
  }

  function setPermission(level) {
    state.permission = ['observe', 'view', 'control', 'ask-once', 'never'].includes(level) ? level : state.permission
    if (permissionFile) {
      try { writeFileSync(permissionFile, JSON.stringify({ level: state.permission, updatedAt: now() }, null, 2) + '\n') } catch (_error) {}
    }
    return state.permission
  }

  return { handler, decide, recordReceipt, setPermission, interrupt: (reason) => { state.interrupted = true; state.interruptReason = clean(reason, 120); return snapshot() }, snapshot }
}
