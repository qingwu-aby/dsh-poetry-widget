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
import { buildSkillContext } from './tool-skills.mjs'

export const MINECRAFT_TOOLS = Object.freeze([
  {
    name: 'mc_move_to',
    description: '走到附近一个坐标。成功回执带实际到达位置与剩余距离。',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, range: { type: 'number' } }, required: ['x', 'z'] },
  },
  {
    name: 'mc_find',
    description: '在附近搜索一种方块/资源（如 oak_log、water、动物），返回方向与坐标，不要靠随机探索碰运气。',
    parameters: { type: 'object', properties: { target: { type: 'string' }, maxDistance: { type: 'number' } }, required: ['target'] },
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
    name: 'mc_craft',
    description: '用背包材料合成一个物品；需要工作台的配方要先放好工作台。',
    parameters: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] },
  },
  {
    name: 'mc_eat',
    description: '吃背包里的食物，恢复饱食度。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_use',
    description: '右键使用附近的方块或实体（门、箱子、熔炉、工作台、羊等）。',
    parameters: { type: 'object', properties: { target: { type: 'string' } }, required: [] },
  },
  {
    name: 'mc_smelt',
    description: '用附近熔炉烧炼/烹饪物品（需要燃料）。',
    parameters: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] },
  },
  {
    name: 'mc_sleep',
    description: '躺到附近的床上睡觉，跳过夜晚。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  { name: 'mc_till', description: '用锄头把附近泥土/草方块翻成耕地。', parameters: { type: 'object', properties: {} } },
  { name: 'mc_harvest', description: '收割附近成熟的小麦/胡萝卜/土豆/甜菜。', parameters: { type: 'object', properties: {} } },
  {
    name: 'mc_plant',
    description: '在附近耕地上种下背包里的种子。',
    parameters: { type: 'object', properties: { item: { type: 'string' } }, required: [] },
  },
  {
    name: 'mc_fish',
    description: '装备鱼竿并钓鱼。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_trade',
    description: '和附近村民交易。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_use_container',
    description: '打开附近的箱子/桶并读取或拿取物品。',
    parameters: { type: 'object', properties: { target: { type: 'string' }, take: { type: 'boolean' } }, required: [] },
  },
  {
    name: 'mc_inventory',
    description: '读取当前背包与手上装备的完整清单。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_attack',
    description: '攻击附近最近的动物/敌对生物。',
    parameters: { type: 'object', properties: { target: { type: 'string' } }, required: [] },
  },
  {
    name: 'mc_collect',
    description: '走到附近掉落物旁捡起来。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_equip',
    description: '把背包里的工具/武器拿到手上。',
    parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
  },
  {
    name: 'mc_define_tool',
    description: '定义一个可复用的宏工具（只能组合已有动作），适合把“做木镐”这类固定步骤保存下来。',
    parameters: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' }, steps: { type: 'array' } }, required: ['name', 'steps'] },
  },
  {
    name: 'mc_define_code',
    description: '定义一个受限代码工具：代码只能读取观察、返回步骤数组，不能访问文件/网络/进程。',
    parameters: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' }, code: { type: 'string' } }, required: ['name', 'code'] },
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
    name: 'mc_guide',
    description: '按主题去 B 站找攻略视频、读字幕并提炼成可执行步骤；卡住/不会做时用它。',
    parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  },
  {
    name: 'mc_learn',
    description: '上网查一个 Minecraft 主题，把方法写进记忆。',
    parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  },
  {
    name: 'mc_build',
    description: '按你保存的建造计划施工；没有计划时先调用 mc_plan。回执带放下/总数与失败原因。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_plan',
    description: '根据你的愿景和现有材料设计一个建造计划（相对坐标 + 方块名），保存后可 mc_build 施工。设计前先自检：不会就先 mc_guide/mc_learn，或传 research=true 自动查；已经会就直接按自己的判断设计。',
    parameters: { type: 'object', properties: { goal: { type: 'string' }, maxBlocks: { type: 'number' }, research: { type: 'boolean' } }, required: [] },
  },
  {
    name: 'mc_automate',
    description: '创建/管理自动机：按饥饿、低血、夜晚、背包满、间隔触发一组动作；支持停止条件、次数、冷却、启停、删除、立即执行。',
    parameters: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' }, trigger: { type: 'object' }, steps: { type: 'array' }, stopWhen: { type: 'object' }, maxRuns: { type: 'number' }, cooldownMs: { type: 'number' }, continueOnError: { type: 'boolean' } }, required: ['action'] },
  },
  {
    name: 'mc_request_capability',
    description: '当现有动作无法完成目标时，向系统提交一个新的底层能力提案（只记录，不会自动执行代码）。',
    parameters: { type: 'object', properties: { capability: { type: 'string' }, reason: { type: 'string' }, evidence: { type: 'string' } }, required: ['capability'] },
  },
  {
    name: 'mc_wait',
    description: '原地等一会儿，不做别的事。',
    parameters: { type: 'object', properties: { seconds: { type: 'number' } }, required: [] },
  },
  {
    name: 'mc_explore',
    description: '从当前位置朝一个方向走很远；没有固定原点、没有范围上限（实际受世界边界/地形限制），可以反复同一方向一直向外。',
    parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['north', 'south', 'east', 'west', 'random'] }, distance: { type: 'number' } }, required: [] },
  },
  {
    name: 'mc_inquire',
    description: '遇到重复失败/看不懂结果时，停下来分析原因、查资料、提出假设和验证方法。由你决定用不用。',
    parameters: { type: 'object', properties: { problem: { type: 'string' } }, required: ['problem'] },
  },
])
const TOOL_NAMES = new Set(MINECRAFT_TOOLS.map((tool) => tool.name))
const CONTROL_TOOLS = new Set(['mc_move_to', 'mc_mine', 'mc_place', 'mc_use', 'mc_smelt', 'mc_sleep', 'mc_till', 'mc_harvest', 'mc_plant', 'mc_fish', 'mc_trade', 'mc_use_container', 'mc_automate', 'mc_craft', 'mc_eat', 'mc_attack', 'mc_collect', 'mc_equip', 'mc_say', 'mc_follow', 'mc_build', 'mc_explore', 'mc_plan'])

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
  const recentCommands = Array.isArray(context.recentCommands) ? context.recentCommands : []
  const skillLines = Array.isArray(context.skillLines) ? context.skillLines : []
  const recentLine = recentCommands.length > 0 ? '最近动作：' + recentCommands.map((item) => `${item.tool}(${item.ok === true ? '成功' : item.ok === false ? '失败' : '?'})`).join(' → ') : ''
  const dynamicTools = Array.isArray(context.dynamicTools) ? context.dynamicTools : []
  const dynamicLines = dynamicTools.map((tool) => `- ${tool.name}：${tool.purpose || '我保存的宏工具'}（${tool.kind || 'macro'}）`).join('\n')
  return [
    '你在玩 Minecraft。下面的观察是游戏真实状态，你只能通过工具行动。',
    '长期目标：把这个世界慢慢改造成你自己喜欢的样子；没有固定步骤，也没有必须完成的任务，你自己决定先做什么。',
    '长期路线：先活下来（工具/食物/安全屋）→ 再安家（选址/材料/储物/农田）→ 再盖漂亮的房子（比例/屋顶/内饰/照明）。不要用泥土盒子直接当“漂亮房子”。',
    '生存优先级：食物、庇护所、工具、火把还不稳定时，不要接大房子/漂亮装饰/自动化；资源匮乏时选低消耗、高回报的方案，先活下来。资源充足后再做审美和自动化。',
    '每次大动作前先做一次自我检查：这件事我知道怎么做吗？不知道就先 mc_guide 或 mc_learn 查/学；已经会就直接做。不要为了显得勤奋而查，也不要明明不会就硬挖硬搭。',
    '工具选择顺序（按当前需要，不是固定任务）：背包/材料不明先 mc_inventory；找不到树/水/动物先 mc_find；缺木板/工作台/工具先 mc_craft；饿先 mc_eat；夜晚有床先 mc_sleep；要盖房先 mc_plan，连续两次施工失败就换材料/位置，不要重复 mc_build；想长期自动做一件事用 mc_automate；种地先 mc_till 翻地，再 mc_plant 播种，成熟后 mc_harvest；不会/卡住用 mc_learn/mc_guide/mc_inquire。不要连续三次调用同一个失败动作。',
    '做完一步或失败后，先复盘：这次学到什么、下次想先查还是先试；复盘是你自己的方法，不是额外作业。',
    `位置：${clean(obs.position, 60) || '未知'}；血量：${obs.health ?? '?'}；饥饿：${obs.food ?? '?'}；时间：${clean(obs.timeOfDay, 20) || '未知'}。`,
    players ? `附近玩家：${players}` : '附近没有其他玩家。',
    blocks ? `附近方块：${blocks}` : '',
    inv ? `背包：${inv}` : '背包是空的。',
    obs.lastChat ? `最近有人说话：${clean(obs.lastChat, 80)}` : '',
    obs.stuck ? '注意：你似乎卡在原地或洞窟里（最近位置几乎没变）。不要重复刚才失败的动作；先用 mc_inquire 查脱困方法，或用 mc_learn 学习，再尝试 mc_mine 向上/向前挖、mc_place 垫脚或 mc_move_to 找出口，并把有效方法记下来。卡住时不要用 mc_wait；移动只能通过 mc_move_to 的物理寻路或挖掘/垫脚完成，宿主不会强制位移。' : '',
    memoryLines.length > 0 ? `你记得的：${memoryLines.join('；')}` : '',
    recentLine,
    skillLines.length > 0 ? '你从经验里学到的：' + skillLines.join('；') : '',    '',
    '可用工具：',
    context.lastReceipt ? `最近一次回执：${context.lastReceipt.tool} ${context.lastReceipt.ok ? '成功' : '失败'} ${context.lastReceipt.detail || ''}` : '',
    context.lastReceipt && context.lastReceipt.facts && context.lastReceipt.facts.verified === false ? '上次建造计划没有来源，是凭经验做的；如果结果不对，先查资料或复盘，不要重复同一个做法。' : '',
    toolLines,
    dynamicLines ? '我保存的自定义工具：\n' + dynamicLines : '',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown：',
    '{"tool":"mc_move_to","arguments":{...},"reason":"一句话为什么"}',
    '如果接下来 2–6 个动作都很确定（先走过去再挖、连续放几块、先计划再施工），可以加 "queue":[{"tool":"mc_mine","arguments":{"block":"dirt"}}, ...]，我会连续执行；不确定就只给一个动作。',
    obs.stuck ? '卡住时不要选 mc_wait；选一个游戏内动作尝试脱困。不要作弊、不要攻击玩家、不要破坏玩家建筑；血量太低时先照顾自己。' : '没有特别想做的事就选 mc_wait。不要作弊、不要攻击玩家、不要破坏玩家建筑；血量太低时先照顾自己。',
  ].filter(Boolean).join('\n')
}

export function parseWorldCommand(text, extraTools = null) {
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
  const allowedTools = extraTools instanceof Set ? extraTools : TOOL_NAMES
  if (!allowedTools.has(tool)) return null
  const args = raw.arguments && typeof raw.arguments === 'object' ? raw.arguments : {}
  if (tool === 'mc_move_to') {
    const x = numberOr(args.x, NaN)
    const z = numberOr(args.z, NaN)
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    return { tool, arguments: { x, y: numberOr(args.y, NaN), z, range: Math.max(1, Math.min(4, numberOr(args.range, 2))) }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_find') {
    const target = clean(args.target, 60)
    if (!target) return null
    return { tool, arguments: { target, maxDistance: Math.max(8, Math.min(64, Number(args.maxDistance) || 48)) }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_say') {
    const text = clean(args.text, 80)
    return text.length > 0 ? { tool, arguments: { text }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_follow') {
    const player = clean(args.player, 32)
    return player.length > 0 ? { tool, arguments: { player }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_plan') {
    return { tool, arguments: { goal: clean(args.goal, 120), maxBlocks: Math.max(6, Math.min(48, Number(args.maxBlocks) || 30)), research: raw.arguments && raw.arguments.research === true }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_guide') {
    const topic = clean(args.topic, 120)
    if (topic.length === 0) return null
    return { tool, arguments: { topic }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_explore') {
    const direction = ['north', 'south', 'east', 'west', 'random'].includes(raw.arguments && raw.arguments.direction) ? raw.arguments.direction : 'random'
    const distance = Math.max(16, Math.min(1024, Number.isFinite(Number(args.distance)) ? Number(args.distance) : 96))
    return { tool, arguments: { direction, distance }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_inquire') {
    const problem = clean(args.problem, 160)
    return problem.length > 0 ? { tool, arguments: { problem }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_learn') {
    const topic = clean(args.topic, 80)
    return topic.length > 0 ? { tool, arguments: { topic }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_use') return { tool, arguments: { target: clean(args.target, 60) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_smelt') {
    const item = clean(args.item, 60)
    return item ? { tool, arguments: { item, count: Math.max(1, Math.min(8, Number(args.count) || 1)) }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_till') return { tool, arguments: { maxDistance: Math.max(2, Math.min(8, Number(args.maxDistance) || 5)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_harvest') return { tool, arguments: { maxDistance: Math.max(2, Math.min(8, Number(args.maxDistance) || 5)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_plant') return { tool, arguments: { item: clean(args.item, 60) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_fish') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_trade') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_use_container') return { tool, arguments: { target: clean(args.target, 60), take: args.take === true }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_sleep' || tool === 'mc_inventory') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_craft') {
    const item = clean(args.item, 60)
    if (!item) return null
    return { tool, arguments: { item, count: Math.max(1, Math.min(8, Number(args.count) || 1)) }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_eat' || tool === 'mc_collect') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_attack') return { tool, arguments: { target: clean(args.target, 60) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_equip') {
    const item = clean(args.item, 60)
    return item ? { tool, arguments: { item }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_define_tool') {
    const name = clean(args.name, 32).toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!/^mc_[a-z0-9_]{2,28}$/.test(name)) return null
    return { tool, arguments: { name, purpose: clean(args.purpose, 120), steps: Array.isArray(args.steps) ? args.steps.slice(0, 8) : [] }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_define_code') {
    const name = clean(args.name, 32).toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!/^mc_[a-z0-9_]{2,28}$/.test(name)) return null
    return { tool, arguments: { name, purpose: clean(args.purpose, 120), code: String(args.code ?? '').slice(0, 4000) }, reason: clean(raw.reason, 120) }
  }
  if (extraTools instanceof Set && extraTools.has(tool)) return { tool, arguments: args, reason: clean(raw.reason, 120) }
  if (tool === 'mc_automate') {
    const action = clean(args.action, 20)
    if (!action) return null
    return { tool, arguments: { action, name: clean(args.name, 40), trigger: args.trigger && typeof args.trigger === 'object' ? args.trigger : {}, steps: Array.isArray(args.steps) ? args.steps.slice(0, 12) : [], stopWhen: args.stopWhen && typeof args.stopWhen === 'object' ? args.stopWhen : {}, maxRuns: Number(args.maxRuns) || 0, cooldownMs: Number(args.cooldownMs) || 5000, continueOnError: args.continueOnError === true }, reason: clean(raw.reason, 120) }
  }
  if (tool === 'mc_request_capability') {
    const capability = clean(args.capability, 160)
    return capability ? { tool, arguments: { capability, reason: clean(args.reason, 400), evidence: clean(args.evidence, 600) }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_wait') return { tool, arguments: { seconds: Math.max(1, Math.min(10, numberOr(args.seconds, 3))) }, reason: clean(raw.reason, 120) }
  return { tool, arguments: { block: clean(args.block, 40) }, reason: clean(raw.reason, 120) }
}

export function parseQueuedCommands(text, limit = 6, extraTools = null) {
  const source = String(text ?? '')
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return []
  let raw = null
  try { raw = JSON.parse(source.slice(first, last + 1)) } catch (_error) { return [] }
  if (!raw || !Array.isArray(raw.queue)) return []
  const out = []
  for (const item of raw.queue.slice(0, Math.max(0, limit))) {
    const command = parseWorldCommand(JSON.stringify(item), extraTools)
    if (command) out.push(command)
  }
  return out
}

export const PLAN_BLOCK_NAMES = Object.freeze(['dirt', 'cobblestone', 'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'stone', 'sand', 'glass', 'torch', 'oak_log', 'birch_log', 'spruce_log'])

export function buildBlueprintPrompt(context = {}) {
  const inv = Array.isArray(context.inventory) ? context.inventory.slice(0, 12).join('、') : ''
  const vision = Array.isArray(context.memoryLines) ? context.memoryLines.slice(0, 4).join('；') : ''
  const research = clean(context.research, 600)
  const maxBlocks = Math.max(6, Math.min(30, Number(context.maxBlocks) || 30))
  const resourceHint = clean(context.resourceHint, 240)
  const availableBlocks = Array.isArray(context.availableBlocks) ? context.availableBlocks.slice(0, 12).filter((item) => typeof item === 'string' && item.length > 0) : []
  return [
    '你在 Minecraft 里，要设计一个可以立刻施工的小建筑/改造计划。',
    `你站的位置：${clean(context.position, 60) || '未知'}；背包：${inv || '空'}。`,
    vision ? `你的愿景/记得的：${vision}` : '',
    research ? `你刚查到的资料：${research}` : '',
    resourceHint ? `资源情况：${resourceHint}` : '',
    availableBlocks.length > 0 ? `背包里真实可用的方块：${availableBlocks.join('、')}。计划只能使用这些方块，不能用没有的材料。` : '',
    `请只输出一个 JSON：{"name":"计划名","blocks":[{"dx":0,"dy":0,"dz":0,"block":"dirt"}]}`,
    '要求：dx、dz 在 -6..6，dy 在 0..5；block 必须是这些之一：' + PLAN_BLOCK_NAMES.join('、') + '。',
    `至少 6 块，至多 ${maxBlocks} 块；先设计一个能站进去的小空间，再考虑装饰。不要设计作弊/破坏别人的东西。`,
    research ? '计划要体现资料里的技能/材料顺序；资料没提到的不要假装知道。' : '没有资料也可以设计；按自己的判断来，但把你还不确定的地方留出来，之后可以试。',
  ].filter(Boolean).join('\n')
}

export function filterBlueprintByMaterials(plan, availableBlocks) {
  if (!plan || !Array.isArray(plan.blocks)) return plan
  const allowed = Array.isArray(availableBlocks) ? availableBlocks.filter((name) => typeof name === 'string' && name.length > 0) : []
  if (allowed.length === 0) return plan
  const set = new Set(allowed)
  const blocks = plan.blocks.filter((item) => item && set.has(item.block))
  return { ...plan, blocks, filtered: blocks.length !== plan.blocks.length }
}

export function parseBlueprint(text, maxBlocks = 60) {
  const source = String(text ?? '')
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw = null
  try { raw = JSON.parse(source.slice(first, last + 1)) } catch (_error) { return null }
  if (!raw || !Array.isArray(raw.blocks)) return null
  const blocks = []
  for (const item of raw.blocks.slice(0, Math.max(1, Math.min(80, maxBlocks)))) {
    if (!item || typeof item !== 'object') continue
    const dx = Math.round(Number(item.dx)); const dy = Math.round(Number(item.dy)); const dz = Math.round(Number(item.dz))
    const block = clean(item.block, 40).replace(/^minecraft:/, '')
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) continue
    if (dx < -6 || dx > 6 || dz < -6 || dz > 6 || dy < 0 || dy > 5) continue
    if (!PLAN_BLOCK_NAMES.includes(block)) continue
    blocks.push({ dx, dy, dz, block })
  }
  if (blocks.length < 6) return null
  return { name: clean(raw.name, 80) || '我的建造计划', blocks }
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
  const inquiry = options.inquiry ?? null
  const guide = options.guide ?? null
  const toolRegistry = options.toolRegistry ?? null
  const capabilityProposals = options.capabilityProposals ?? null
  const toolSkills = options.toolSkills ?? null
  const getSelfState = typeof options.getSelfState === 'function' ? options.getSelfState : () => null
  const getTokenLimit = typeof options.getTokenLimit === 'function' ? options.getTokenLimit : () => 0
  const logger = options.logger ?? null
  const permissionFile = options.permissionFile ?? ''
  // Gate E3：shadow 观察钩子（由 composition 注入；只读事实，失败不影响 bot/路由）。
  const onShadowEvent = typeof options.onShadowEvent === 'function' ? options.onShadowEvent : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let sequence = 0
  const state = {
    observation: null,
    lastCommand: null,
    lastReceipt: null,
    lastPlan: null,
    research: {},
    commandHistory: [],
    interrupted: false,
    interruptReason: '',
    permission: 'control',
    grantedUntil: 0,
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

  /** Gate E3：把观察/回执事实交给 shadow 钩子；任何失败只记录，不影响返回值。 */
  function emitShadow(kind, payload) {
    if (onShadowEvent === null) return
    try {
      onShadowEvent({ kind, at: now(), ...payload })
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] minecraft shadow 钩子失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (warnError) {
        void warnError
      }
    }
  }

  /** 观察摘要（白名单字段，不含 token/额外字段）。 */
  function shadowObservation(observation) {
    const obs = observation && typeof observation === 'object' ? observation : {}
    const list = (value, max, length) =>
      Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, max).map((item) => clean(item, length)) : []
    return {
      position: clean(obs.position, 60),
      players: list(obs.players, 6, 80),
      health: Number.isFinite(Number(obs.health)) ? Number(obs.health) : null,
      food: Number.isFinite(Number(obs.food)) ? Number(obs.food) : null,
      timeOfDay: clean(obs.timeOfDay, 20),
      inventory: list(obs.inventory, 8, 80),
      nearbyBlocks: list(obs.nearbyBlocks, 8, 80),
      lastChat: clean(obs.lastChat, 120),
    }
  }

  function emitShadowObserve(observation, result) {
    if (onShadowEvent === null) return
    const payload = result && typeof result === 'object' ? result : {}
    const command = payload.command && typeof payload.command === 'object' ? payload.command : null
    emitShadow('observe', {
      ok: payload.ok === true,
      interrupted: payload.interrupt === true,
      tool: command !== null ? clean(command.tool, 40) : '',
      reason: clean(payload.reason || (command !== null ? command.reason : '') || payload.error, 120),
      permission: clean(payload.permission, 20),
      blocked: command !== null && payload.blocked ? clean(payload.blocked.tool, 40) : '',
      observation: shadowObservation(observation),
    })
  }

  async function decideInner(observation) {
    state.observation = observation && typeof observation === 'object' ? observation : {}
    state.updatedAt = now()
    if (state.interrupted) {
      state.interrupted = false
      const reason = state.interruptReason
      state.interruptReason = ''
      return { ok: true, interrupt: true, reason, command: null, permission: state.permission }
    }
    const memoryLines = gameMemory && typeof gameMemory.promptLines === 'function' ? gameMemory.promptLines(3) : []
    const dynamicTools = toolRegistry && typeof toolRegistry.list === 'function' ? toolRegistry.list() : []
    const allTools = new Set([...TOOL_NAMES, ...dynamicTools.map((tool) => tool.name)])
    const skillLines = toolSkills && typeof toolSkills.summary === 'function' ? toolSkills.summary(buildSkillContext(state.observation), 4).map((item) => `${item.tool} 成功率 ${Math.round(item.rate * 100)}%（${item.success}/${item.attempts}）`) : []
    const prompt = buildWorldPrompt(state.observation, { memoryLines: [...memoryLines, ...selfStateLines()], lastReceipt: state.lastReceipt, dynamicTools, recentCommands: state.commandHistory.slice(-6), skillLines })
    let result = null
    try {
      result = await callModel({
        role: 'drive',
        policy,
        resolveLlm: getLlm,
        system: '你住在 DSH 的鲸鱼娘插件里，现在通过 Minecraft World 的工具行动。只输出 JSON 工具调用。',
        prompt,
        maxTokens: getTokenLimit(),
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
    let command = parseWorldCommand(result.text, allTools)
    if (command === null) command = mapLegacyAction(parseMinecraftAction(result.text, { players: state.observation.players }))
    if (command === null) command = { tool: 'mc_wait', arguments: { seconds: 2 }, reason: '模型没有给出合法工具' }
    const queue = parseQueuedCommands(result.text, 6, allTools)
    if (queue.length > 0) command.queue = queue
    if (toolRegistry && command.tool && toolRegistry.has(command.tool)) {
      const expanded = toolRegistry.expand(command.tool, state.observation)
      if (!expanded || expanded.length === 0) return { ok: false, error: 'tool_unavailable', command: { tool: 'mc_wait', arguments: { seconds: 2 }, reason: '自定义工具没有可用步骤' }, permission: state.permission }
      const [first, ...rest] = expanded
      command = { ...first, reason: '自定义工具 ' + command.tool, queue: rest }
    }
    const askOnceBlocked = state.permission === 'ask-once' && now() > state.grantedUntil
    if (state.permission === 'observe' || state.permission === 'view' || state.permission === 'never' || askOnceBlocked) {
      if (CONTROL_TOOLS.has(command.tool)) {
        return { ok: true, command: { tool: 'mc_wait', arguments: { seconds: 2 }, reason: '当前只能观察' }, blocked: command, permission: state.permission }
      }
    }
    sequence += 1
    state.lastCommand = { id: `cmd-${sequence}-${now()}`, tool: command.tool, arguments: command.arguments, reason: command.reason || '', at: now() }
    state.commandHistory.push({ tool: command.tool, arguments: command.arguments, reason: command.reason || '', ok: null, at: now() })
    state.commandHistory = state.commandHistory.slice(-12)
    return { ok: true, command: state.lastCommand, permission: state.permission, observationAt: state.updatedAt }
  }

  /** decide 包装：结果不变，只额外把观察事实交给 shadow 钩子（Gate E3）。 */
  async function decide(observation) {
    const result = await decideInner(observation)
    emitShadowObserve(observation, result)
    return result
  }

  async function guideLookup(input = {}) {
    if (guide === null || typeof guide.lookup !== 'function') return { ok: false, error: 'guide_unavailable' }
    const topic = clean(input.topic, 120)
    if (topic.length === 0) return { ok: false, error: 'topic_required' }
    const result = await guide.lookup({ topic, question: input.question, activity: 'minecraft' }).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    if (result && result.ok === true && gameMemory && typeof gameMemory.record === 'function') {
      try {
        gameMemory.record({ category: 'method', text: `攻略「${topic}」：${result.guide.method || ''} ${(result.guide.steps || []).join('；')}`.slice(0, 1200), source: 'guide' })
      } catch (_error) {}
    }
    return result
  }

  async function planBuild(input = {}) {
    if (state.permission === 'observe' || state.permission === 'view' || state.permission === 'never') {
      return { ok: false, error: 'forbidden' }
    }
    const memoryLines = gameMemory && typeof gameMemory.promptLines === 'function' ? gameMemory.promptLines(3) : []
    const goalKey = clean(input.goal, 120)
    const inventory = Array.isArray(state.observation && state.observation.inventory) ? state.observation.inventory : []
    let availableBlocks = 0
    for (const line of inventory) {
      const match = /×\s*(\d+)/.exec(String(line))
      if (match) availableBlocks += Number(match[1]) || 0
    }
    const availableBlockNames = []
    for (const line of inventory) {
      const name = String(line).split(/×|x/)[0].trim()
      if (name.length > 0 && !availableBlockNames.includes(name)) availableBlockNames.push(name)
    }
    const requestedBlocks = Math.max(6, Math.min(48, Number(input.maxBlocks) || 30))
    const maxBlocks = Number.isFinite(availableBlocks) && availableBlocks > 0 ? Math.max(6, Math.min(requestedBlocks, availableBlocks)) : requestedBlocks
    const resourceHint = availableBlocks > 0 ? `背包里大约 ${availableBlocks} 个可放材料；计划不要超过 ${maxBlocks} 块，资源少时优先能站进去的小空间。` : '背包材料未知；先按小计划设计，不要假设材料充足。'
    let research = goalKey.length > 0 ? state.research[goalKey] ?? null : null
    if (input.research === true && goalKey.length > 0) {
      const found = await guideLookup({ topic: goalKey, question: `要在 Minecraft 完成「${goalKey}」，需要先学哪些技能、准备哪些材料、避免哪些风险？` })
      if (found && found.ok === true && found.guide) {
        research = { at: now(), goal: goalKey, guide: found.guide }
        state.research[goalKey] = research
        memoryLines.push(`调研「${goalKey}」：${clean(found.guide.method, 240)} ${Array.isArray(found.guide.steps) ? found.guide.steps.slice(0, 3).join('；') : ''}`)
        if (gameMemory && typeof gameMemory.record === 'function') {
          try { gameMemory.record({ category: 'plan', text: `调研「${goalKey}」：${clean(found.guide.method, 400)}`, source: 'research' }) } catch (_error) {}
        }
      }
    }
    let result = null
    try {
      result = await callModel({
        role: 'thinking',
        policy,
        resolveLlm: getLlm,
        system: '你住在 DSH 的鲸鱼娘插件里，你在设计 Minecraft 建筑。只输出 JSON。',
        prompt: buildBlueprintPrompt({ position: state.observation && state.observation.position, inventory: state.observation && state.observation.inventory, memoryLines, maxBlocks, resourceHint, availableBlocks: availableBlockNames, research: research ? `${research.guide.method} ${(research.guide.steps || []).join('；')}` : '' }),
        maxTokens: getTokenLimit(),
        timeoutMs: 60000,
        timeoutCode: 'MINECRAFT_PLAN_TIMEOUT',
        timeoutMessage: 'Minecraft 建造计划超时',
        prefix: 'Minecraft 建造计划失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (result === null) return { ok: false, error: 'llm' }
    let plan = parseBlueprint(result.text, Math.max(6, Math.min(48, Number(input.maxBlocks) || 30)))
    if (plan) plan = filterBlueprintByMaterials(plan, availableBlockNames)
    if (!plan) {
      logger?.warn?.('[dsh-little-whale] 建造计划 JSON 无效：' + clean(result.text, 300))
      return { ok: false, error: 'invalid' }
    }
    if (availableBlockNames.length > 0 && plan.blocks.length < 6) {
      return { ok: false, error: 'insufficient_available_blocks', availableBlocks: availableBlockNames }
    }
    plan.goal = clean(input.goal, 120)
    plan.resourceBudget = { available: availableBlocks, requested: requestedBlocks, capped: maxBlocks }
    plan.verified = research !== null
    plan.sources = research && research.guide ? [{ title: research.guide.title || '', url: research.guide.url || '' }] : []
    state.lastPlan = plan
    if (gameMemory && typeof gameMemory.record === 'function') {
      try { gameMemory.record({ category: 'build', text: `建造计划「${plan.name}」：${plan.blocks.length} 块（${plan.goal || '自选目标'}）`, source: 'plan' }) } catch (_error) {}
    }
    return { ok: true, plan }
  }

  function recordReceipt(receipt) {
    const command = state.lastCommand
    const payload = receipt && typeof receipt === 'object' ? receipt : {}
    const ok = payload.ok === true
    const tool = clean(payload.tool || (command && command.tool), 40)
    const detail = clean(payload.detail, 240)
    const facts = payload.facts && typeof payload.facts === 'object' ? payload.facts : {}
    state.lastReceipt = { commandId: command && command.id, tool, ok, detail, facts, at: now() }
    if (toolSkills && typeof toolSkills.record === 'function') {
      try { toolSkills.record({ tool, ok, arguments: command && command.arguments, context: buildSkillContext(state.observation) }) } catch (_error) {}
    }
    if (command && command.id) {
      const hist = state.commandHistory.find((item) => item.tool === tool && item.at <= now() && item.ok === null)
      if (hist) hist.ok = ok
    }
    // Gate E3：回执事实交给 shadow 钩子（不改返回值/记忆写入）。
    emitShadow('receipt', { receipt: state.lastReceipt })
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
      lastPlan: state.lastPlan,
      tools: toolRegistry && typeof toolRegistry.list === 'function' ? toolRegistry.list() : [],
      interrupted: state.interrupted,
      interruptReason: state.interruptReason,
      permission: state.permission,
      granted: state.permission === 'ask-once' ? now() <= state.grantedUntil : state.permission === 'control',
      grantedUntil: state.grantedUntil,
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
      else if (payload.action === 'guide') send(200, await guideLookup(payload))
      else if (payload.action === 'define_tool') {
        if (!toolRegistry) { send(200, { ok: false, error: 'registry_unavailable' }); return }
        send(200, toolRegistry.defineMacro(payload))
      }
      else if (payload.action === 'define_code') {
        if (!toolRegistry) { send(200, { ok: false, error: 'registry_unavailable' }); return }
        send(200, toolRegistry.defineCode(payload))
      }
      else if (payload.action === 'propose_capability') {
        if (!capabilityProposals) { send(200, { ok: false, error: 'proposal_unavailable' }); return }
        send(200, capabilityProposals.propose(payload))
      }
      else if (payload.action === 'expand_tool') {
        if (!toolRegistry || !toolRegistry.has(payload.name)) send(404, { ok: false, error: 'tool_not_found' })
        else {
          const steps = toolRegistry.expand(payload.name, payload.observation && typeof payload.observation === 'object' ? payload.observation : state.observation)
          send(200, steps && steps.length > 0 ? { ok: true, name: payload.name, steps } : { ok: false, error: 'expand_empty' })
        }
      }
      else if (payload.action === 'plan_build') send(200, await planBuild(payload))
      else if (payload.action === 'inquire') {
        if (!inquiry) { send(200, { ok: false, error: 'unavailable' }); return }
        const memoryLines = gameMemory && typeof gameMemory.promptLines === 'function' ? gameMemory.promptLines(3) : []
        const result = await inquiry.inquire({ problem: payload.problem, observations: state.observation ? [JSON.stringify(state.observation).slice(0, 400)] : [], receipts: state.lastReceipt ? [state.lastReceipt] : [], memoryLines })
        send(200, result)
      }
      else if (payload.action === 'event') {
        const event = payload.event && typeof payload.event === 'object' ? payload.event : {}
        const type = clean(event.type, 40)
        const detail = clean(event.detail, 240)
        if (!type) { send(400, { ok: false, error: 'invalid_event' }); return }
        if (gameMemory && typeof gameMemory.record === 'function') {
          try { gameMemory.record({ category: type === 'death' ? 'event' : 'session', text: `${type}：${detail || '无详情'}`, source: 'world-event' }) } catch (_error) {}
        }
        send(200, { ok: true, accepted: true })
      }
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

  function grant(minutes = 30) {
    state.grantedUntil = now() + Math.max(1, Math.min(1440, Number(minutes) || 30)) * 60000
    return { granted: true, grantedUntil: state.grantedUntil }
  }

  function setPermission(level) {
    state.permission = ['observe', 'view', 'control', 'ask-once', 'never'].includes(level) ? level : state.permission
    if (permissionFile) {
      try { writeFileSync(permissionFile, JSON.stringify({ level: state.permission, updatedAt: now() }, null, 2) + '\n') } catch (_error) {}
    }
    return state.permission
  }

  return { handler, decide, recordReceipt, setPermission, grant, interrupt: (reason) => { state.interrupted = true; state.interruptReason = clean(reason, 120); return snapshot() }, snapshot }
}
