// lib/core/minecraft-activity.mjs —— Minecraft Activity 适配器（Gate D2，纯逻辑/依赖注入）。
//
// 目标：把现有 game-world 能力包成统一 Activity（manifest / Event / Task / Receipt），
// **不改变现有路由行为**，也不直接依赖具体 minecraft-world：
//   · manifest：id=minecraft，events minecraft.spawn/death/chat/tool_receipt，
//     tools 与 lib/domain/play/minecraft-world.mjs 的 MINECRAFT_TOOLS 对齐（11 个），
//     task kinds minecraft.explore/build/plan/inquire；
//   · 注入 world：{invoke(action, payload)}，本模块只转发（observe/execute），不启动进程、不写记忆、不接路由；
//   · observe(observation, ctx)：转发 world 决策，把 observation/command 映射为统一 Task；
//   · execute(tool, args, ctx)：转发 world 执行，校验 receipt（ok/tool/detail/facts），映射为 tool_receipt 事件；
//   · 中断：ctx.signal 取消 → cancelled receipt（调用方负责停止底层 bot）；
//   · 事件映射：toSpawnEvent/toDeathEvent/toChatEvent/toToolReceiptEvent → Gate A7 envelope；
//   · 不 import lib/domain/play/minecraft-world.mjs（工具清单以快照对齐，测试比对域名常量）。
//
// 纯逻辑：不读盘/不联网/无宿主依赖；时钟、world.invoke、随机源均可注入。

import { createHash } from 'node:crypto'
import { validateActivityManifest } from './activity-manifest.mjs'
import { createEventEnvelope, validateEventEnvelope } from './event-schema.mjs'

/** 实现版本。 */
export const MINECRAFT_ACTIVITY_VERSION = 1

/** Activity id / 版本。 */
export const MINECRAFT_ACTIVITY_ID = 'minecraft'
export const MINECRAFT_ACTIVITY_MANIFEST_VERSION = '1.0.0'

/** 事件类型。 */
export const MINECRAFT_EVENTS = Object.freeze({
  spawn: 'minecraft.spawn',
  death: 'minecraft.death',
  chat: 'minecraft.chat',
  toolReceipt: 'minecraft.tool_receipt',
})

/** Task kinds。 */
export const MINECRAFT_TASK_KINDS = Object.freeze([
  'minecraft.explore',
  'minecraft.build',
  'minecraft.plan',
  'minecraft.inquire',
])

/** 工具清单快照（与 lib/domain/play/minecraft-world.mjs MINECRAFT_TOOLS 对齐；只用于 manifest/校验）。 */
export const MINECRAFT_TOOLS_SNAPSHOT = Object.freeze([
  { name: 'mc_move_to', description: '走到附近一个坐标。', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, range: { type: 'number' } }, required: ['x', 'z'] } },
  { name: 'mc_find', description: '搜索附近资源。', parameters: { type: 'object', properties: { target: { type: 'string' }, maxDistance: { type: 'number' } }, required: ['target'] } },
  { name: 'mc_mine', description: '挖附近一个自然方块。', parameters: { type: 'object', properties: { block: { type: 'string' } }, required: [] } },
  { name: 'mc_place', description: '在面前放一块背包里的方块。', parameters: { type: 'object', properties: { block: { type: 'string' } }, required: [] } },
  { name: 'mc_craft', description: '用背包材料合成物品。', parameters: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] } },
  { name: 'mc_eat', description: '吃背包里的食物。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_autofarm', description: '自动收菜补种。', parameters: { type: 'object', properties: { rounds: { type: 'number' } } } },
  { name: 'mc_defend', description: '自动防守。', parameters: { type: 'object', properties: { seconds: { type: 'number' } } } },
  { name: 'mc_flee', description: '远离威胁。', parameters: { type: 'object', properties: { distance: { type: 'number' } } } },
  { name: 'mc_escape', description: '卡住时挖开再走。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_hide', description: '挖进地面躲着。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_stair_up', description: '挖台阶回地表。', parameters: { type: 'object', properties: { steps: { type: 'number' } } } },
  { name: 'mc_shelter', description: '一步搭小屋。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_use', description: '右键使用附近方块或实体。', parameters: { type: 'object', properties: { target: { type: 'string' } }, required: [] } },
  { name: 'mc_boat', description: '放船/上船。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_minecart', description: '放矿车并骑乘。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_drive', description: '骑矿车前进。', parameters: { type: 'object', properties: { seconds: { type: 'number' } } } },
  { name: 'mc_ride', description: '骑乘。', parameters: { type: 'object', properties: { target: { type: 'string' } } } },
  { name: 'mc_project', description: '她的长期项目草稿本。', parameters: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } },
  { name: 'mc_smelt', description: '用熔炉烧炼/烹饪。', parameters: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] } },
  { name: 'mc_sleep', description: '睡附近的床。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_till', description: '锄地成耕地。', parameters: { type: 'object', properties: { maxDistance: { type: 'number' } } } },
  { name: 'mc_harvest', description: '收割成熟作物。', parameters: { type: 'object', properties: { maxDistance: { type: 'number' } } } },
  { name: 'mc_water', description: '给耕地浇水。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_feed_animal', description: '喂动物。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_shear', description: '剪羊毛。', parameters: { type: 'object', properties: {} } }, { name: 'mc_milk', description: '挤奶。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_plant', description: '在附近耕地种下种子。', parameters: { type: 'object', properties: { item: { type: 'string' } }, required: [] } },
  { name: 'mc_fish', description: '装备鱼竿钓鱼。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_trade', description: '和附近村民交易。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_use_container', description: '打开附近容器。', parameters: { type: 'object', properties: { target: { type: 'string' }, take: { type: 'boolean' } }, required: [] } },  { name: 'mc_bonemeal', description: '骨粉催熟。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_compost', description: '堆肥。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_activate', description: '开关红石/门。', parameters: { type: 'object', properties: { target: { type: 'string' } } } },
  { name: 'mc_inspect', description: '查看方块状态。', parameters: { type: 'object', properties: { target: { type: 'string' } } } },
  { name: 'mc_store', description: '存入容器。', parameters: { type: 'object', properties: { target: { type: 'string' }, item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] } },
  { name: 'mc_take', description: '从容器取出。', parameters: { type: 'object', properties: { target: { type: 'string' }, item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] } },

  { name: 'mc_assess', description: '评判自己的屋子。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_status', description: '查整体状态。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_inventory', description: '读取背包清单。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_attack', description: '攻击附近目标。', parameters: { type: 'object', properties: { target: { type: 'string' } }, required: [] } },
  { name: 'mc_shoot', description: '弓弩射击。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_block', description: '盾牌格挡。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_throw', description: '投掷物。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_collect', description: '捡附近掉落物。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_equip', description: '把物品拿到手上。', parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] } },
  { name: 'mc_define_tool', description: '定义宏工具。', parameters: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' }, steps: { type: 'array' } }, required: ['name', 'steps'] } },
  { name: 'mc_define_code', description: '定义受限代码工具。', parameters: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' }, code: { type: 'string' } }, required: ['name', 'code'] } },
  { name: 'mc_say', description: '在游戏里说一句话。', parameters: { type: 'object', properties: { text: { type: 'string', maxLength: 80 } }, required: ['text'] } },
  { name: 'mc_follow', description: '朝一个附近玩家走一小段。', parameters: { type: 'object', properties: { player: { type: 'string' } }, required: ['player'] } },
  { name: 'mc_guide', description: '去 B 站找攻略视频。', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } },
  { name: 'mc_recipe', description: '查本地配方。', parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] } },
  { name: 'mc_learn', description: '上网查一个 Minecraft 主题。', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } },
  { name: 'mc_build', description: '按建造计划施工。', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mc_plan', description: '设计建造计划。', parameters: { type: 'object', properties: { goal: { type: 'string' }, maxBlocks: { type: 'number' }, research: { type: 'boolean' }, reset: { type: 'boolean' } }, required: [] } },
  { name: 'mc_automate', description: '管理自动机。', parameters: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' }, trigger: { type: 'object' }, steps: { type: 'array' }, stopWhen: { type: 'object' }, maxRuns: { type: 'number' }, cooldownMs: { type: 'number' }, continueOnError: { type: 'boolean' } }, required: ['action'] } },
  { name: 'mc_request_capability', description: '提交底层能力提案。', parameters: { type: 'object', properties: { capability: { type: 'string' }, reason: { type: 'string' }, evidence: { type: 'string' } }, required: ['capability'] } },
  { name: 'mc_wait', description: '原地等一会儿。', parameters: { type: 'object', properties: { seconds: { type: 'number' } }, required: [] } },
  { name: 'mc_explore', description: '朝一个方向走很远。', parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['north','south','east','west','random'] }, distance: { type: 'number' } }, required: [] } },
  { name: 'mc_inquire', description: '遇到重复失败时分析原因。', parameters: { type: 'object', properties: { problem: { type: 'string' } }, required: ['problem'] } },
])

/** 工具名集合（执行入口校验）。 */
export const MINECRAFT_TOOL_NAMES = Object.freeze(MINECRAFT_TOOLS_SNAPSHOT.map((tool) => tool.name))

/** 工具 → Task kind 映射（manifest 只声明 4 个 task kind）。 */
export const MINECRAFT_TASK_KIND_BY_TOOL = Object.freeze({
  mc_move_to: 'minecraft.explore',
  mc_mine: 'minecraft.explore',
  mc_say: 'minecraft.explore',
  mc_follow: 'minecraft.explore',
  mc_wait: 'minecraft.explore',
  mc_explore: 'minecraft.explore',
  mc_place: 'minecraft.build',
  mc_build: 'minecraft.build',
  mc_plan: 'minecraft.plan',
  mc_learn: 'minecraft.inquire',
  mc_inquire: 'minecraft.inquire',
})

/** 错误码。 */
export const MINECRAFT_ACTIVITY_CODES = Object.freeze({
  noInvoke: 'MINECRAFT_NO_INVOKE',
  invalidObservation: 'MINECRAFT_INVALID_OBSERVATION',
  invalidTool: 'MINECRAFT_INVALID_TOOL',
  invalidArguments: 'MINECRAFT_INVALID_ARGUMENTS',
  invalidReceipt: 'MINECRAFT_INVALID_RECEIPT',
  worldError: 'MINECRAFT_WORLD_ERROR',
  invalidEvent: 'MINECRAFT_INVALID_EVENT',
  cancelled: 'MINECRAFT_CANCELLED',
})

/** 限制。 */
export const MINECRAFT_ACTIVITY_LIMITS = Object.freeze({
  detailMax: 240,
  textMax: 200,
  worldIdMax: 40,
  taskKeyMax: 128,
})

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

function clean(value, max) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function boundedString(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max || CONTROL_CHARS.test(trimmed)) return null
  return trimmed
}

/** Minecraft Activity manifest 原始声明。 */
export const MINECRAFT_MANIFEST_RAW = Object.freeze({
  id: MINECRAFT_ACTIVITY_ID,
  version: MINECRAFT_ACTIVITY_MANIFEST_VERSION,
  name: 'Minecraft',
  events: Object.freeze([
    MINECRAFT_EVENTS.spawn,
    MINECRAFT_EVENTS.death,
    MINECRAFT_EVENTS.chat,
    MINECRAFT_EVENTS.toolReceipt,
  ]),
  tasks: Object.freeze([
    Object.freeze({ kind: 'minecraft.explore', goal: '在世界里移动/探索/采集', success: '回执确认位置或背包变化', priority: 40 }),
    Object.freeze({ kind: 'minecraft.build', goal: '放置方块/按计划施工', success: '回执确认放置数量与失败原因', priority: 45 }),
    Object.freeze({ kind: 'minecraft.plan', goal: '设计建造计划', success: '产出可施工的方块清单', priority: 35 }),
    Object.freeze({ kind: 'minecraft.inquire', goal: '失败/看不懂时调研原因', success: '产出假设与验证方法', priority: 30 }),
  ]),
  tools: Object.freeze(MINECRAFT_TOOL_NAMES.slice()),
  permissions: Object.freeze(['model', 'tool']),
  resources: Object.freeze({ model: true, foreground: true, maxMinutes: 30 }),
})

/** 规范化 manifest（模块加载时校验一次；冻结）。 */
export const MINECRAFT_MANIFEST = (() => {
  const validated = validateActivityManifest(MINECRAFT_MANIFEST_RAW)
  if (validated.ok !== true) {
    throw new Error('Minecraft manifest 非法：' + validated.errors.map((item) => item.message).join('; '))
  }
  return Object.freeze(validated.manifest)
})()

/** 获取 manifest（深拷贝）。 */
export function getMinecraftManifest() {
  return JSON.parse(JSON.stringify(MINECRAFT_MANIFEST))
}

function hashOf(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function buildEvent(type, payload, options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const worldId = boundedString(spec.worldId, MINECRAFT_ACTIVITY_LIMITS.worldIdMax) ?? 'main'
  const subject = ('world:' + worldId).slice(0, 200)
  const at = Number.isFinite(Number(spec.at)) ? Number(spec.at) : typeof spec.now === 'function' ? spec.now() : Date.now()
  const topics = [type]
  if (worldId.length > 0) topics.push('world:' + worldId.toLowerCase().replace(/[^a-z0-9._:-]/g, '-'))
  const envelope = createEventEnvelope(
    { activity: MINECRAFT_ACTIVITY_ID, type, version: 1, at, subject, topics, payload },
    { now: spec.now, prefix: 'mc', random: spec.random },
  )
  if (envelope.ok !== true) {
    return errorResult(MINECRAFT_ACTIVITY_CODES.invalidEvent, '事件 envelope 未通过校验', { errors: envelope.errors })
  }
  return { ok: true, event: envelope.event }
}

/** 通用事件构造：type 必须在 manifest 声明的 4 类事件内。 */
export function toEvent(type, payload, options = {}) {
  const allowed = Object.values(MINECRAFT_EVENTS)
  if (typeof type !== 'string' || allowed.indexOf(type) < 0) {
    return errorResult(MINECRAFT_ACTIVITY_CODES.invalidEvent, `未知事件类型：${String(type)}`, { allowed })
  }
  if (!isPlainObject(payload)) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidEvent, 'payload 必须是对象')
  return buildEvent(type, payload, options)
}

export function toSpawnEvent(info, options = {}) {
  const spec = isPlainObject(info) ? info : {}
  return toEvent(MINECRAFT_EVENTS.spawn, {
    player: clean(spec.player, 80),
    position: clean(spec.position, 60),
    ...(typeof spec.worldName === 'string' && spec.worldName.length > 0 ? { worldName: clean(spec.worldName, 80) } : {}),
  }, options)
}

export function toDeathEvent(info, options = {}) {
  const spec = isPlainObject(info) ? info : {}
  return toEvent(MINECRAFT_EVENTS.death, {
    player: clean(spec.player, 80),
    cause: clean(spec.cause, 120),
    ...(typeof spec.position === 'string' ? { position: clean(spec.position, 60) } : {}),
  }, options)
}

export function toChatEvent(info, options = {}) {
  const spec = isPlainObject(info) ? info : {}
  const text = clean(spec.text, MINECRAFT_ACTIVITY_LIMITS.textMax)
  if (text.length === 0) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidEvent, 'chat 事件需要非空 text')
  return toEvent(MINECRAFT_EVENTS.chat, { player: clean(spec.player, 80), text }, options)
}

/**
 * 校验 world 回执：{ok:boolean, tool?, detail?, facts?} → 规范化 receipt。
 * @param {unknown} receipt
 * @param {{tool?: string, now?: () => number}} [options]
 */
export function validateReceipt(receipt, options = {}) {
  if (!isPlainObject(receipt)) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidReceipt, 'receipt 必须是对象')
  if (typeof receipt.ok !== 'boolean') return errorResult(MINECRAFT_ACTIVITY_CODES.invalidReceipt, 'receipt.ok 必须是布尔')
  const spec = isPlainObject(options) ? options : {}
  const tool = boundedString(receipt.tool, 40) ?? boundedString(spec.tool, 40)
  if (tool === null) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidReceipt, 'receipt.tool 必须是非空字符串')
  if (MINECRAFT_TOOL_NAMES.indexOf(tool) < 0) {
    return errorResult(MINECRAFT_ACTIVITY_CODES.invalidTool, `未知工具：${tool}`, { allowed: MINECRAFT_TOOL_NAMES })
  }
  const facts = receipt.facts === undefined || receipt.facts === null ? {} : receipt.facts
  if (!isPlainObject(facts)) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidReceipt, 'receipt.facts 必须是对象')
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  return {
    ok: true,
    receipt: {
      ok: receipt.ok,
      tool,
      detail: clean(receipt.detail, MINECRAFT_ACTIVITY_LIMITS.detailMax),
      facts: JSON.parse(JSON.stringify(facts)),
      at: Number.isFinite(Number(receipt.at)) ? Number(receipt.at) : now(),
      ...(typeof receipt.commandId === 'string' && receipt.commandId.length > 0 ? { commandId: receipt.commandId.slice(0, 80) } : {}),
    },
  }
}

/** receipt → minecraft.tool_receipt 事件 envelope。 */
export function toToolReceiptEvent(receipt, task, options = {}) {
  const spec = isPlainObject(receipt) ? receipt : {}
  const taskSpec = isPlainObject(task) ? task : {}
  return toEvent(
    MINECRAFT_EVENTS.toolReceipt,
    {
      tool: spec.tool ?? '',
      ok: spec.ok === true,
      detail: spec.detail ?? '',
      facts: isPlainObject(spec.facts) ? spec.facts : {},
      ...(typeof spec.commandId === 'string' && spec.commandId.length > 0 ? { commandId: spec.commandId } : {}),
      ...(typeof taskSpec.key === 'string' && taskSpec.key.length > 0 ? { taskKey: taskSpec.key } : {}),
    },
    { ...options, at: Number.isFinite(Number(options.at)) ? Number(options.at) : spec.at },
  )
}

function taskKindForTool(tool) {
  return MINECRAFT_TASK_KIND_BY_TOOL[tool] ?? 'minecraft.explore'
}

/**
 * 把 world command 映射为统一 Task（kind ∈ 4 类；key 幂等：command.id 或 hash）。
 * @param {{tool: string, arguments?: object, reason?: string, id?: string, at?: number}} command
 * @param {{priority?: number, now?: () => number}} [options]
 */
export function toTask(command, options = {}) {
  if (!isPlainObject(command)) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidTool, 'command 必须是对象')
  const tool = boundedString(command.tool, 40)
  if (tool === null || MINECRAFT_TOOL_NAMES.indexOf(tool) < 0) {
    return errorResult(MINECRAFT_ACTIVITY_CODES.invalidTool, `未知工具：${String(command.tool)}`, { allowed: MINECRAFT_TOOL_NAMES })
  }
  const args = command.arguments === undefined || command.arguments === null ? {} : command.arguments
  if (!isPlainObject(args)) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidArguments, 'command.arguments 必须是对象')
  const spec = isPlainObject(options) ? options : {}
  const kind = taskKindForTool(tool)
  const commandId = boundedString(command.id, 80)
  const key = (
    'minecraft:' + kind + ':' + (commandId !== null ? commandId : hashOf({ tool, args, at: command.at ?? null }))
  ).slice(0, MINECRAFT_ACTIVITY_LIMITS.taskKeyMax)
  return {
    ok: true,
    task: {
      activity: MINECRAFT_ACTIVITY_ID,
      kind,
      key,
      priority: Number.isFinite(Number(spec.priority)) ? Math.trunc(Number(spec.priority)) : 40,
      title: ('Minecraft ' + tool).slice(0, 120),
      payload: { tool, arguments: JSON.parse(JSON.stringify(args)), reason: clean(command.reason, 160) },
      meta: { commandId: commandId ?? '' },
    },
  }
}

function abortWatch(signal) {
  let cleanup = () => {}
  const promise = new Promise((resolve) => {
    if (signal.aborted === true) {
      resolve({ cancelled: true })
      return
    }
    if (typeof signal.addEventListener !== 'function') return
    const onAbort = () => resolve({ cancelled: true })
    signal.addEventListener('abort', onAbort, { once: true })
    cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch (error) {
        void error
      }
    }
  })
  return { promise, cleanup }
}

async function invokeWithCancel(invoke, action, payload, signal) {
  const invocation = Promise.resolve().then(() => invoke(action, payload))
  if (signal !== null && typeof signal.addEventListener === 'function') {
    const watch = abortWatch(signal)
    try {
      return await Promise.race([invocation, watch.promise])
    } finally {
      watch.cleanup()
    }
  }
  return invocation
}

function normalizeObservation(raw) {
  if (!isPlainObject(raw)) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidObservation, 'observation 必须是对象')
  const out = {}
  if (raw.position !== undefined) {
    const position = clean(raw.position, 60)
    if (position.length === 0) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidObservation, 'position 必须是非空字符串')
    out.position = position
  }
  for (const key of ['players', 'nearbyBlocks', 'inventory']) {
    if (raw[key] !== undefined) {
      if (!Array.isArray(raw[key])) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidObservation, `${key} 必须是数组`)
      out[key] = raw[key].filter((item) => typeof item === 'string').slice(0, 20).map((item) => clean(item, 80))
    }
  }
  for (const key of ['health', 'food']) {
    if (raw[key] !== undefined) {
      if (!Number.isFinite(Number(raw[key]))) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidObservation, `${key} 必须是数字`)
      out[key] = Number(raw[key])
    }
  }
  if (raw.timeOfDay !== undefined) out.timeOfDay = clean(raw.timeOfDay, 40)
  if (raw.lastChat !== undefined) out.lastChat = clean(raw.lastChat, 120)
  if (out.position === undefined && (out.players === undefined || out.players.length === 0)) {
    return errorResult(MINECRAFT_ACTIVITY_CODES.invalidObservation, 'observation 至少需要 position 或 players')
  }
  return { ok: true, observation: out }
}

/**
 * 创建 Minecraft Activity 适配器。
 * @param {{
 *   invoke?: (action: string, payload: object) => object|Promise<object>,
 *   now?: () => number,
 *   random?: () => number,
 *   worldId?: string,
 * }} [options]
 */
export function createMinecraftActivity(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const invoke = typeof spec.invoke === 'function' ? spec.invoke : null
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const random = typeof spec.random === 'function' ? spec.random : undefined
  const worldId = boundedString(spec.worldId, MINECRAFT_ACTIVITY_LIMITS.worldIdMax) ?? 'main'
  const eventOptions = { now, random, worldId }

  /** 转发 world 决策：observation → command → 统一 Task。 */
  async function observe(observation, ctx = {}) {
    if (invoke === null) return errorResult(MINECRAFT_ACTIVITY_CODES.noInvoke, '需要注入 world.invoke')
    const context = isPlainObject(ctx) ? ctx : {}
    const normalized = normalizeObservation(observation)
    if (normalized.ok !== true) return normalized
    const signal = context.signal ?? null
    if (signal !== null && signal.aborted === true) {
      return {
        ok: false,
        cancelled: true,
        code: MINECRAFT_ACTIVITY_CODES.cancelled,
        message: '观察在开始前已被取消',
        receipt: { ok: false, cancelled: true, at: now() },
      }
    }
    let result
    try {
      result = await invokeWithCancel(invoke, 'observe', { observation: normalized.observation, activity: MINECRAFT_ACTIVITY_ID, signal }, signal)
    } catch (error) {
      return errorResult(MINECRAFT_ACTIVITY_CODES.worldError, error instanceof Error ? error.message : String(error))
    }
    if (isPlainObject(result) && result.cancelled === true) {
      return {
        ok: false,
        cancelled: true,
        code: MINECRAFT_ACTIVITY_CODES.cancelled,
        message: '观察被取消',
        receipt: { ok: false, cancelled: true, at: now() },
      }
    }
    if (!isPlainObject(result)) return errorResult(MINECRAFT_ACTIVITY_CODES.worldError, 'world.invoke 返回空结果')
    if (result.ok !== true) {
      return errorResult(MINECRAFT_ACTIVITY_CODES.worldError, typeof result.error === 'string' ? result.error : 'world 决策失败', {
        permission: typeof result.permission === 'string' ? result.permission : '',
      })
    }
    if (result.interrupt === true) {
      return {
        ok: true,
        interrupted: true,
        reason: clean(result.reason, 120),
        observation: normalized.observation,
        task: null,
      }
    }
    if (result.command === null || result.command === undefined) {
      return { ok: true, interrupted: false, observation: normalized.observation, command: null, task: null }
    }
    const mapped = toTask(result.command, { priority: context.priority })
    if (mapped.ok !== true) return mapped
    return {
      ok: true,
      interrupted: false,
      observation: normalized.observation,
      command: result.command,
      task: mapped.task,
      permission: typeof result.permission === 'string' ? result.permission : '',
    }
  }

  /** 转发 world 执行：tool/args → receipt（校验 ok/facts）+ tool_receipt 事件。 */
  async function execute(tool, args = {}, ctx = {}) {
    if (invoke === null) return errorResult(MINECRAFT_ACTIVITY_CODES.noInvoke, '需要注入 world.invoke')
    const toolName = boundedString(tool, 40)
    if (toolName === null || MINECRAFT_TOOL_NAMES.indexOf(toolName) < 0) {
      return errorResult(MINECRAFT_ACTIVITY_CODES.invalidTool, `未知工具：${String(tool)}`, { allowed: MINECRAFT_TOOL_NAMES })
    }
    const toolArgs = args === undefined || args === null ? {} : args
    if (!isPlainObject(toolArgs)) return errorResult(MINECRAFT_ACTIVITY_CODES.invalidArguments, 'arguments 必须是对象')
    const context = isPlainObject(ctx) ? ctx : {}
    const signal = context.signal ?? null
    const startedAt = now()
    const baseReceipt = { tool: toolName, startedAt }
    if (signal !== null && signal.aborted === true) {
      return {
        ok: false,
        cancelled: true,
        code: MINECRAFT_ACTIVITY_CODES.cancelled,
        message: '工具在开始前已被取消',
        receipt: { ok: false, cancelled: true, tool: toolName, at: startedAt, ...baseReceipt },
      }
    }
    let result
    try {
      result = await invokeWithCancel(
        invoke,
        'execute',
        { tool: toolName, arguments: JSON.parse(JSON.stringify(toolArgs)), activity: MINECRAFT_ACTIVITY_ID, signal },
        signal,
      )
    } catch (error) {
      const at = now()
      return {
        ok: false,
        code: MINECRAFT_ACTIVITY_CODES.worldError,
        message: error instanceof Error ? error.message : String(error),
        receipt: { ok: false, tool: toolName, at, detail: error instanceof Error ? error.message : String(error), facts: {}, ...baseReceipt },
      }
    }
    const at = now()
    if (isPlainObject(result) && result.cancelled === true) {
      return {
        ok: false,
        cancelled: true,
        code: MINECRAFT_ACTIVITY_CODES.cancelled,
        message: '工具执行被取消',
        receipt: { ok: false, cancelled: true, tool: toolName, at, ...baseReceipt },
      }
    }
    if (!isPlainObject(result)) return errorResult(MINECRAFT_ACTIVITY_CODES.worldError, 'world.invoke 返回空结果')
    const rawReceipt = isPlainObject(result.receipt) ? result.receipt : result
    const validated = validateReceipt({ ...rawReceipt, tool: rawReceipt.tool ?? toolName }, { tool: toolName, now })
    if (validated.ok !== true) return validated
    const receipt = { ...validated.receipt, durationMs: Math.max(0, at - startedAt) }
    const event = toToolReceiptEvent(receipt, { key: typeof context.taskKey === 'string' ? context.taskKey : '' }, eventOptions)
    return { ok: true, receipt, ...(event.ok === true ? { event: event.event } : {}) }
  }

  return {
    manifest: getMinecraftManifest(),
    observe,
    execute,
    toEvent(type, payload, eventSpec = {}) {
      return toEvent(type, payload, { ...eventOptions, ...eventSpec })
    },
    toSpawnEvent(info) {
      return toSpawnEvent(info, eventOptions)
    },
    toDeathEvent(info) {
      return toDeathEvent(info, eventOptions)
    },
    toChatEvent(info) {
      return toChatEvent(info, eventOptions)
    },
    toToolReceiptEvent(receipt, task = {}) {
      return toToolReceiptEvent(receipt, task, eventOptions)
    },
    toTask(command, taskOptions = {}) {
      return toTask(command, taskOptions)
    },
  }
}
