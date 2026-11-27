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
import { CATALOG_TOOL_NAMES, approvedCatalogNames } from './capability-catalog.mjs'
import { createMinecraftProjectStore } from './minecraft-project.mjs'
import { createWikiGuide } from './minecraft-wiki.mjs'
import { MC_FAST_CANDIDATES, deathHint, homeFactLine, hungerHint, planHint, repetitionHint, stallHint, threatLines } from './minecraft-signals.mjs'
import { genericCombatTactic, lookupCombinedKnowledge } from './minecraft-tactics.mjs'
import { createProjectReviewer, createSelfGoal } from './minecraft-goals.mjs'
import { toolFailureLines } from './minecraft-code-iter.mjs'
import { skillProfile, toolCountsOf, toolStatsOf } from './minecraft-skill-map.mjs'
import { buildStatusReport, ladderLines, roughText } from './minecraft-status.mjs'
import { MINECRAFT_TOOLS } from './minecraft-tools.mjs'
import { createMemoryV2 } from './minecraft-memory-v2.mjs'
import { enforceReceiptHonesty } from './minecraft-tool-contract.mjs'
import { jsonObjects } from './minecraft-parse.mjs'
export { MINECRAFT_TOOLS }
const TOOL_NAMES = new Set(MINECRAFT_TOOLS.map((tool) => tool.name))
const CONTROL_TOOLS = new Set(['mc_move_to', 'mc_mine', 'mc_place', 'mc_use', 'mc_smelt', 'mc_sleep', 'mc_till', 'mc_harvest', 'mc_plant', 'mc_fish', 'mc_trade', 'mc_use_container', 'mc_bonemeal', 'mc_compost', 'mc_activate', 'mc_inspect', 'mc_store', 'mc_take', 'mc_automate', 'mc_craft', 'mc_eat', 'mc_attack', 'mc_shoot', 'mc_block', 'mc_recipe', 'mc_autofarm', 'mc_defend', 'mc_flee', 'mc_escape', 'mc_hide', 'mc_stair_up', 'mc_shelter', 'mc_throw', 'mc_boat', 'mc_minecart', 'mc_ride', 'mc_drive', 'mc_project', 'mc_macro', 'mc_task', 'mc_drop', 'mc_gather', 'mc_tunnel', 'mc_farm_loop', 'mc_haul', 'mc_smelt_batch', 'mc_guard', 'mc_collect', 'mc_equip', 'mc_assess', 'mc_status', 'mc_say', 'mc_follow', 'mc_build', 'mc_explore', 'mc_plan'])
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
    const LOCKED_PRIMITIVES = ['mc_gather', 'mc_tunnel', 'mc_farm_loop', 'mc_haul', 'mc_smelt_batch', 'mc_guard']
  const unlockedText = Array.isArray(obs.capability && obs.capability.unlocked) ? obs.capability.unlocked.join(' ') : ''
  const gatedTools = MINECRAFT_TOOLS.filter((tool) => !LOCKED_PRIMITIVES.includes(tool.name) || unlockedText.includes(tool.name))
  const blocks = Array.isArray(obs.nearbyBlocks) ? obs.nearbyBlocks.slice(0, 8).join('、') : ''
  const homeText = homeFactLine(obs)
  const buildFact = (() => {
    const bp = obs.buildProgress && typeof obs.buildProgress === 'object' ? obs.buildProgress : null
    if (bp === null) return ''
    if (bp.done === true) return `；你盖的《${bp.name}》已经完工（${bp.total} 块）`
    const shortages = Array.isArray(bp.shortages) && bp.shortages.length > 0 ? bp.shortages.map((item) => `${item.name}×${item.need}`).join('、') : ''
    return `；你正在盖《${bp.name}》：${bp.nextIndex}/${bp.total} 块${shortages ? `，还缺 ${shortages}` : '，材料够了'}`
  })()
  const sit = obs.situation && typeof obs.situation === 'object' ? obs.situation : null, situationText = sit === null ? '' : sit.enclosed ? '（有顶有墙）' : sit.skyExposed === true ? '（露天）' : ''
  const threats = threatLines(obs)
  const inv = Array.isArray(obs.inventory) ? obs.inventory.slice(0, 8).join('、') : ''
  const memoryLines = Array.isArray(context.memoryLines) ? context.memoryLines : []
  const availableTools = Array.isArray(context.availableTools) ? context.availableTools : (typeof gatedTools !== 'undefined' ? gatedTools : MINECRAFT_TOOLS)
  const toolLines = availableTools.map((tool) => `- ${tool.name}(${JSON.stringify(tool.parameters.properties)})：${tool.description}`).join('\n')
  const recentCommands = Array.isArray(context.recentCommands) ? context.recentCommands : []
  const skillLines = Array.isArray(context.skillLines) ? context.skillLines : []
  const projectLines = Array.isArray(context.projectLines) ? context.projectLines : []
  const repeatHint = typeof context.repeatHint === 'string' ? context.repeatHint : '', demand = clean(context.demandHint, 240)
  const deathLine = deathHint(context.lastDeathAt)
  const hungerLine = hungerHint(obs), stallLine = context.intentState ? stallHint(context.intentState) : '', planLine = planHint(obs), toolFailLine = toolFailureLines(context.toolFailures)
  const recentLine = recentCommands.length > 0 ? '最近动作：' + recentCommands.map((item) => `${item.tool}(${item.ok === true ? '成功' : item.ok === false ? '失败' : '?'})`).join(' → ') : ''
  const dynamicTools = Array.isArray(context.dynamicTools) ? context.dynamicTools : []
  const dynamicLines = dynamicTools.map((tool) => `- ${tool.name}：${tool.purpose || '我保存的宏工具'}（${tool.kind || 'macro'}）`).join('\n')
  return [
    '你在玩 Minecraft。下面的观察是游戏真实状态，你只能通过工具行动。',
    '长期目标：把这个世界慢慢改造成你自己喜欢的样子；没有固定步骤，也没有必须完成的任务，你自己决定先做什么。',
    '长期路线：先活下来（工具/食物/安全屋）→ 再安家（选址/材料/储物/农田）→ 再盖漂亮的房子（比例/屋顶/内饰/照明）。不要用泥土盒子直接当“漂亮房子”。',
    '生存优先级：食物、庇护所、工具、火把还不稳定时，不要接大房子/漂亮装饰/自动化；资源匮乏时选低消耗、高回报的方案，先活下来。资源充足后再做审美和自动化。',
    '每次大动作前先自检：不会就先 mc_guide/mc_learn，会了就直接做；不要为显得勤奋而查，也不要明明不会就硬挖硬搭。',
    '大多数物品和方块都是「拿在手上右键使用」（mc_use / mc_place）；不确定某个东西怎么用，就 mc_guide 查「XX 怎么用」，别靠猜。',
    '工具怎么选（按当前需要，不是固定任务）：成批采集一种材料用 mc_gather（一次调用里自己反复找+挖+捡，累了自动存箱），别用 mc_find/mc_collect 一块块磨；背包/材料不明先 mc_inventory；缺木板/工作台/工具先 mc_craft；饿先 mc_eat；生肉/原矿用 mc_smelt（没熔炉就 8 圆石做 furnace）；夜晚有床先 mc_sleep；盖建筑先 mc_build action=list 看蓝图库，再 mc_build from=名字 开工（会告诉你还缺什么材料），连续两次施工失败就换位置或用 mc_stair_up 垫高；长任务交给 mc_task（一次下令后台连续执行，缺材料会回报）；重复做过很多次的动作可以用 mc_macro save 存下来以后一次跑完；不会/卡住用 mc_learn/mc_guide/mc_inquire，查配方用 mc_recipe，查自己的状态用 mc_status，评估房子用 mc_assess。战斗：近战 mc_attack、远程 mc_shoot、格挡 mc_block；夜里没武器/血少就先 mc_hide 或 mc_flee，天亮用 mc_stair_up 回地表。不要连续三次调用同一个失败动作。',
    'mc_build 是按块分批的：回执说“再调一次接着放”就再调一次，进度会接上，不用重新规划。',
    '做完一步或失败后，先复盘：这次学到什么、下次想先查还是先试；复盘是你自己的方法，不是额外作业。',
    '工具有层级（木→石→铁→钻石）：手上有对应材料就升一级，别一直反复做木镐；石头够就先石镐/石剑/石斧，铁够再升铁器。',
    '建设/红石/农场/交通/装饰都没有固定剧本：先看资源地形，自己决定建不建、建什么、按什么顺序；宿主不强制任务树。',
    '遇到不会的合成/结构/机制：先 mc_recipe 查本地配方，查不到再用 mc_learn 查资料或 mc_guide 找攻略；查完自己判断要不要试，失败也算探索，不要卡死循环。',
    `位置：${clean(obs.position, 60) || '未知'}${situationText}${homeText}${buildFact}；血量：${obs.health ?? '?'}；饥饿：${obs.food ?? '?'}；时间：${clean(obs.timeOfDay, 20) || '未知'}。`,
    players ? `附近玩家：${players}` : '附近没有其他玩家。',
    ...threats,
    ...(Array.isArray(context.memoryLinesV2) ? context.memoryLinesV2 : []),
    deathLine,
    hungerLine,
    stallLine,
    planLine,
    blocks ? `附近方块：${blocks}` : '',
    inv ? `背包：${inv}` : '背包是空的。',
    obs.lastChat ? `最近有人说话：${clean(obs.lastChat, 80)}` : '',
    obs.stuck ? '注意：你似乎卡在原地或洞窟里（最近位置几乎没变）。不要重复刚才失败的动作；先用 mc_escape 挖开面前一格再小步挪；还不行再 mc_inquire 查原因，或用 mc_mine/mc_place 自己开路，并把有效方法记下来。卡住时不要用 mc_wait；移动只能通过 mc_move_to 的物理寻路或挖掘/垫脚完成，宿主不会强制位移。' : '',
    memoryLines.length > 0 ? `你记得的：${memoryLines.join('；')}` : '',
    recentLine,
    skillLines.length > 0 ? '你从经验里学到的：' + skillLines.join('；') : '',
    ...projectLines,
    repeatHint,    '',
    /redstone|piston|observer|hopper|lever|repeater|comparator|torch/.test(String(obs.inventory || '') + ' ' + String(obs.nearbyBlocks || '')) ? '你手边有红石相关物品：可以先 mc_inspect 看状态，再用 mc_place/mc_activate 搭小回路；不必为了“像在做事”去挖无关方块。' : '',
    /farmland|wheat|carrot|potato|beetroot|bone_meal|compost/.test(String(obs.inventory || '') + ' ' + String(obs.nearbyBlocks || '')) ? '附近有农田/作物/骨粉时：可以用 mc_autofarm 收菜补种，mc_bonemeal 催熟，mc_compost 堆肥，形成农业循环。' : '',
    /minecart|rail|boat/.test(String(obs.inventory || '') + ' ' + String(obs.nearbyBlocks || '')) ? '交通配方：矿车=5铁锭，铁轨=6铁锭+1木棍；有轨道时用 mc_minecart→mc_ride→mc_drive。boat 当前版本可能生成不了，不要反复试。' : '',
    '可用工具：',
    context.lastReceipt ? `最近一次回执：${context.lastReceipt.tool} ${context.lastReceipt.ok ? '成功' : '失败'} ${context.lastReceipt.detail || ''}` : '',
    demand,
    context.lastReceipt && context.lastReceipt.facts && context.lastReceipt.facts.verified === false ? '上次建造计划没有来源，是凭经验做的；如果结果不对，先查资料或复盘，不要重复同一个做法。' : '',
    toolLines,
    dynamicLines ? '我保存的自定义工具：\n' + dynamicLines : '',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown：',
    '{"tool":"mc_move_to","arguments":{...},"reason":"一句话为什么"}',
    '节奏很重要：能确定两步以上就一起给。加 "queue":[{"tool":"...","arguments":{...}}, ...]（最多 6 步）我会连续执行，不必每步都等我再想一遍。常见组合：mc_inventory→mc_craft；mc_find→mc_move_to→mc_mine；mc_craft crafting_table→mc_place→mc_craft 工具；mc_collect→mc_store。真的不确定时再只给一个动作。',
    obs.stuck ? '卡住时不要选 mc_wait；选一个游戏内动作尝试脱困。不要作弊、不要攻击玩家、不要破坏玩家建筑；血量太低时先照顾自己。' : '没有特别想做的事就选 mc_wait。不要作弊、不要攻击玩家、不要破坏玩家建筑；血量太低时先照顾自己。',
  ].filter(Boolean).join('\n')
}

export function parseWorldCommand(text, extraTools = null) {
  const candidates = jsonObjects(text)
  if (candidates.length === 0) return null
  let raw = null
  for (const candidate of candidates) {
    const name = clean(candidate.tool, 40)
    if (name && (extraTools instanceof Set ? extraTools : TOOL_NAMES).has(name)) { raw = candidate; break }
  }
  if (raw === null) return null
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
    return { tool, arguments: { target, maxDistance: Math.max(8, Math.min(128, Number(args.maxDistance) || 48)), gather: args.gather === true, count: Math.max(1, Math.min(576, Number(args.count) || 16)), maxSeconds: Math.max(10, Math.min(300, Number(args.maxSeconds) || 90)) }, reason: clean(raw.reason, 120) }
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
    return { tool, arguments: { goal: clean(args.goal, 120), maxBlocks: Math.max(6, Math.min(48, Number(args.maxBlocks) || 30)), research: raw.arguments && raw.arguments.research === true, reset: raw.arguments && raw.arguments.reset === true }, reason: clean(raw.reason, 120) }
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
  if (['mc_bonemeal', 'mc_compost'].includes(tool)) return { tool, arguments: { target: clean(args.target, 60) }, reason: clean(raw.reason, 120) }
  if (['mc_bonemeal', 'mc_compost', 'mc_activate', 'mc_inspect', 'mc_store', 'mc_take'].includes(tool)) return { tool, arguments: { target: clean(args.target, 60), at: clean(args.at, 40), item: clean(args.item, 60), count: Math.max(1, Math.min(64, Number(args.count) || 1)) }, reason: clean(raw.reason, 120) }
  if (['mc_shoot', 'mc_block', 'mc_throw'].includes(tool)) return { tool, arguments: { target: clean(args.target, 60) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_project') return { tool, arguments: { action: clean(args.action, 12) || 'show', title: clean(args.title, 80), why: clean(args.why, 200), milestones: Array.isArray(args.milestones) ? args.milestones.slice(0, 5) : [], stage: clean(args.stage, 40), done: clean(args.done, 60), blocker: clean(args.blocker, 80), note: clean(args.note, 160) }, reason: clean(raw.reason, 120) }
  if (['mc_boat', 'mc_minecart', 'mc_ride', 'mc_drive'].includes(tool)) return { tool, arguments: { target: clean(args.target, 60), seconds: Math.max(1, Math.min(15, Number(args.seconds) || 3)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_gather') return { tool, arguments: { target: clean(args.target, 24) || 'wood', count: Math.max(1, Math.min(576, Number(args.count) || 32)), maxSeconds: Math.max(10, Math.min(600, Number(args.maxSeconds) || 120)), deposit: args.deposit !== false }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_tunnel') return { tool, arguments: { length: Math.max(2, Math.min(32, Number(args.length) || 12)), direction: clean(args.direction, 10) || 'forward' }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_farm_loop') return { tool, arguments: { rounds: Math.max(1, Math.min(10, Number(args.rounds) || 3)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_haul') return { tool, arguments: { category: clean(args.category, 10) || 'ore', count: Math.max(1, Math.min(576, Number(args.count) || 64)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_smelt_batch') return { tool, arguments: { item: clean(args.item, 60), count: Math.max(1, Math.min(64, Number(args.count) || 8)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_guard') return { tool, arguments: { seconds: Math.max(5, Math.min(120, Number(args.seconds) || 20)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_macro') return { tool, arguments: { action: clean(args.action, 12) || 'list', name: clean(args.name, 24) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_task') return { tool, arguments: { action: clean(args.action, 12) || 'status', name: clean(args.name, 40), tool: clean(args.tool, 40), arguments: args.arguments && typeof args.arguments === 'object' ? args.arguments : {}, maxSteps: Math.max(1, Math.min(200, Number(args.maxSteps) || 20)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_drop') return { tool, arguments: { item: clean(args.item, 60), category: clean(args.category, 20), count: Math.max(1, Math.min(576, Number(args.count) || 1)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_build') return { tool, arguments: { action: clean(args.action, 12), from: clean(args.from, 24), category: clean(args.category, 20), need: clean(args.need, 120), maxBlocks: Math.max(1, Math.min(64, Number(args.maxBlocks) || 24)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_recipe') return { tool, arguments: { item: clean(args.item, 60) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_shelter') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_stair_up') return { tool, arguments: { steps: Math.max(1, Math.min(16, Number(args.steps) || 8)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_hide') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_escape') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_flee') return { tool, arguments: { distance: Math.max(6, Math.min(32, Number(args.distance) || 16)) }, reason: clean(raw.reason, 120) }
  if (['mc_autofarm', 'mc_defend'].includes(tool)) return { tool, arguments: { rounds: Math.max(1, Math.min(8, Number(args.rounds) || 3)), seconds: Math.max(1, Math.min(15, Number(args.seconds) || 5)) }, reason: clean(raw.reason, 120) }
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
  if (tool === 'mc_eat') return { tool, arguments: { radius: Math.max(8, Math.min(32, Number(args.radius) || 24)) }, reason: clean(raw.reason, 120) }
  if (tool === 'mc_collect') return { tool, arguments: { radius: Math.max(8, Math.min(32, Number(args.radius) || 24)), item: clean(args.item, 40), until: Math.max(0, Math.min(576, Number(args.until) || 0)) }, reason: clean(raw.reason, 120) }
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
    return capability ? { tool, arguments: { capability, reason: clean(args.reason, 400), evidence: clean(args.evidence, 600), steps: Array.isArray(args.steps) ? args.steps.slice(0, 12) : [] }, reason: clean(raw.reason, 120) } : null
  }
  if (tool === 'mc_assess') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_status') return { tool, arguments: {}, reason: clean(raw.reason, 120) }
  if (tool === 'mc_wait') return { tool, arguments: { seconds: Math.max(1, Math.min(10, numberOr(args.seconds, 3))) }, reason: clean(raw.reason, 120) }
  return { tool, arguments: { block: clean(args.block, 40), ...(args.facing ? { facing: clean(args.facing, 8) } : {}), ...(args.at ? { at: clean(args.at, 40) } : {}) }, reason: clean(raw.reason, 120) }
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
  const demand = clean(context.demandHint, 240)
  return [
    '你在 Minecraft 里，要设计一个可以立刻施工的小建筑/改造计划。',
    `你站的位置：${clean(context.position, 60) || '未知'}；背包：${inv || '空'}。`,
    vision ? `你的愿景/记得的：${vision}` : '',
    research ? `你刚查到的资料：${research}` : '',
    resourceHint ? `资源情况：${resourceHint}` : '',
    demand,
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
  const memoryV2 = options.memoryV2 || (options.memoryDir ? createMemoryV2({ dir: options.memoryDir, legacyFiles: options.memoryLegacyFiles || [] }) : null)
  const getLlm = options.getLlm
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const tokenFile = options.tokenFile ?? ''
  const gameMemory = options.gameMemory ?? null
  const inquiry = options.inquiry ?? null
  const guide = options.guide ?? null
  const toolRegistry = options.toolRegistry ?? null
  const capabilityProposals = options.capabilityProposals ?? null
  const callMcModel = async (callOptions = {}) => {
    const raw = typeof options.mcCandidates === 'function' ? options.mcCandidates() : options.mcCandidates
    const candidates = Array.isArray(raw) ? raw : raw === null ? null : MC_FAST_CANDIDATES
    const result = candidates === null ? await callModel(callOptions) : await callModel({ ...callOptions, candidates })
    if (result && typeof result === 'object') state.lastModelUsed = `${result.provider || '?'}/${result.model || '?'}`
    else state.lastModelUsed = candidates === null ? 'policy-unknown' : `${candidates[0].provider || '?'}/${candidates[0].model || '?'}`
    return result
  }
  const toolSkills = options.toolSkills ?? null, catalogNames = new Set(CATALOG_TOOL_NAMES)
  const projectStore = options.projectStore ?? createMinecraftProjectStore({ file: options.projectFile || '' })
  const wikiGuide = options.wikiGuide === null ? null : options.wikiGuide ?? createWikiGuide({ fetchImpl: options.fetchImpl, summarize: options.wikiSummarize })
  function availableToolsForPrompt() { const approved = approvedCatalogNames(capabilityProposals); return MINECRAFT_TOOLS.filter((tool) => !catalogNames.has(tool.name) || approved.has(tool.name)) }
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
      model: clean(payload.model, 60),
      observation: shadowObservation(observation),
    })
  }

  const goalCall = (code, message, prefix) => (options) => callMcModel({ role: 'drive', policy, resolveLlm: getLlm, modelErrorsPath, timeoutCode: code, timeoutMessage: message, prefix, ...options })
  const selfGoal = createSelfGoal({ debugFile: options.goalDebugFile || '', projectStore, now, toolSkills, toolCountsOf, skillProfile, gameMemory, roughTextOf: () => roughText(toolStatsOf(toolSkills)), callModel: goalCall('MC_GOAL_TIMEOUT', '立项思考超时', '立项思考失败') })
  const reviewProject = createProjectReviewer({ projectStore, now, ladderOf: (observation) => ladderLines(observation), callModel: goalCall('MC_REVIEW_TIMEOUT', '项目复盘超时', '项目复盘失败') })
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
    const prompt = buildWorldPrompt(state.observation, { memoryLines: [...memoryLines, ...selfStateLines()], lastReceipt: state.lastReceipt, dynamicTools, recentCommands: state.commandHistory.slice(-6), skillLines, projectLines: projectStore.promptLines(), repeatHint: repetitionHint(state, now()), intentState: state, hasProject: projectStore.get() !== null, toolFailures: toolRegistry && typeof toolRegistry.failures === 'function' ? toolRegistry.failures() : [], toolCounts: toolCountsOf(toolSkills), lastDeathAt: state.lastDeathAt || 0, demandHint: state.lastPlan && state.lastPlan.demandHint ? state.lastPlan.demandHint : '', availableTools: availableToolsForPrompt() })
    let result = null
    try {
      result = await callMcModel({
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
    state.commandHistory.push({ tool: command.tool, arguments: command.arguments, reason: command.reason || '', ok: null, queueCount: Array.isArray(command.queue) ? command.queue.length : 0, at: now() })
    state.commandHistory = state.commandHistory.slice(-20)
    return { ok: true, command: state.lastCommand, permission: state.permission, observationAt: state.updatedAt, model: state.lastModelUsed || '' }
  }

  const decide = async (observation) => {
    state.decideInFlight = Number(state.decideInFlight || 0) + 1
    try {
      const result = await decideInner(observation)
      emitShadowObserve(observation, result)
      return result
    } finally { state.decideInFlight -= 1 }
  }

  const statusReport = () => {
    const base = buildStatusReport({ observation: state.observation, project: projectStore.get(), plan: state.observation && state.observation.plan, toolStats: toolStatsOf(toolSkills) })
    const metrics = state.observation && state.observation.metrics && typeof state.observation.metrics === 'object' ? state.observation.metrics : null
    const counts = toolCountsOf(toolSkills)
    const untried = ['mc_gather', 'mc_tunnel', 'mc_farm_loop', 'mc_haul', 'mc_smelt_batch', 'mc_guard', 'mc_task', 'mc_macro', 'mc_build'].filter((name) => !counts[name])
    const untriedLine = untried.length > 0 ? `\n你还没试过的省力工具：${untried.join('、')}。` : ''
    const metricLine = metrics ? `\n过程量：自动化率 ${metrics.automationRate}%、手工占比 ${metrics.manualShare}%、自动化动作 ${metrics.automationActions} 次。` : ''
    return base + metricLine + untriedLine
  }
  async function guideLookup(input = {}) {
    if (guide === null || typeof guide.lookup !== 'function') return { ok: false, error: 'guide_unavailable' }
    const topic = clean(input.topic, 120)
    if (topic.length === 0) return { ok: false, error: 'topic_required' }
    const tactical = lookupCombinedKnowledge(topic, loadTutorials(options.tutorialsFile || ''))
    if (tactical !== null) return { ok: true, cached: false, topic, guide: tactical }
    const fromWiki = wikiGuide !== null && typeof wikiGuide.lookup === 'function'
      ? await wikiGuide.lookup({ topic, question: input.question }).catch(() => null)
      : null
    const generic = fromWiki && fromWiki.ok === true ? null : genericCombatTactic(topic)
    if (generic !== null) return { ok: true, cached: false, topic, guide: generic }
    const result = fromWiki && fromWiki.ok === true
      ? fromWiki
      : await guide.lookup({ topic, question: input.question, activity: 'minecraft' }).catch((error) => ({
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
    const activeProject = projectStore.get()
    const goalFromProject = activeProject && Array.isArray(activeProject.milestones) && activeProject.milestones.length > 0 ? activeProject.milestones[0] : ''
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
      result = await callMcModel({
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
    plan.goal = clean(input.goal || goalFromProject, 120)
    plan.demandHint = demandHint(plan.blocks, state.observation && state.observation.inventory)
    if (typeof projectStore.attachPlan === 'function') projectStore.attachPlan(plan)
    plan.resourceBudget = { available: availableBlocks, requested: requestedBlocks, capped: maxBlocks }
    plan.verified = research !== null
    plan.sources = research && research.guide ? [{ title: research.guide.title || '', url: research.guide.url || '' }] : []
    state.lastPlan = plan
    if (gameMemory && typeof gameMemory.record === 'function') {
      try { gameMemory.record({ category: 'build', text: `建造计划「${plan.name}」：${plan.blocks.length} 块（${plan.goal || '自选目标'}）`, source: 'plan' }) } catch (_error) {}
    }
    return { ok: true, plan, demandHint: plan.demandHint || '' }
  }
  function recordReceipt(receipt) {
    try {
      const facts = receipt && receipt.facts && typeof receipt.facts === 'object' ? receipt.facts : {}
      const blueprint = typeof facts.blueprint === 'string' ? facts.blueprint : ''
      if (blueprint.length > 0 && projectStore.get() !== null && facts.placedCount > 0) {
        const done = facts.done === true
        projectStore.handle({ action: 'step', note: done ? `盖完了《${blueprint}》` : `在盖《${blueprint}》：${facts.nextIndex}/${facts.total}` })
      }
    } catch (_error) { void _error }
    try {
      const actor = 'self'
      if (memoryV2) memoryV2.appendLedger({ actor, kind: String(receipt && receipt.tool || 'tool'), text: `${receipt && receipt.tool} ${receipt && receipt.ok ? '成功' : '失败'}：${String(receipt && receipt.detail || '').slice(0, 120)}` })
    } catch (_error) { void _error }
    projectStore.noteEvidence(receipt && receipt.facts)
    const command = state.lastCommand
    const payload = receipt && typeof receipt === 'object' ? receipt : {}
    const tool = clean(payload.tool || (command && command.tool), 40), honest = enforceReceiptHonesty(tool, payload), ok = honest.ok
    const detail = clean(payload.detail, 240) + (honest.corrected ? honest.note : '')
    const facts = payload.facts && typeof payload.facts === 'object' ? payload.facts : {}
    // 工具发现：她用完老工具（find/collect/mine）就顺带在回执里说一句“有更省力的做法”
    const TOOL_UPGRADES = { mc_find: 'mc_gather 能一次连续采同一类材料，不用一块块找', mc_collect: 'mc_gather 一次调用就能连挖带捡连存箱', mc_mine: '成批挖同一种用 mc_gather；挖矿道用 mc_tunnel' }
    let detailWithHint = detail
    if (tool in TOOL_UPGRADES) {
      state.upgradeHints = state.upgradeHints || new Set()
      const primitiveUsed = Object.keys(toolCountsOf(toolSkills)).some((name) => /mc_(gather|tunnel)/.test(name))
      if (!state.upgradeHints.has(tool) && !primitiveUsed) {
        state.upgradeHints.add(tool)
        detailWithHint = detail + `（更省力的做法：${TOOL_UPGRADES[tool]}）`
      }
    }
    state.lastReceipt = { commandId: command && command.id, tool, ok, detail: detailWithHint, facts, at: now() }
    if (tool === 'mc_build' && typeof projectStore.noteBuild === 'function') projectStore.noteBuild({ ok, facts, done: facts.done === true })
    if (toolSkills && typeof toolSkills.record === 'function') {
      try { toolSkills.record({ tool, ok, arguments: command && command.arguments, context: buildSkillContext(state.observation) }) } catch (_error) {}
    }
    if (command && command.id) {
      const hist = state.commandHistory.find((item) => item.tool === tool && item.at <= now() && item.ok === null)
      if (hist) { hist.ok = ok; if (facts && typeof facts.position === 'string') hist.positionAfter = facts.position }
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
      observation: state.observation,
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
      else if (payload.action === 'status') send(200, { ok: true, report: statusReport() + (memoryV2 ? `\n记忆：${JSON.stringify(memoryV2.stats())}` : '') })
      else if (payload.action === 'knowledge') { const found = lookupCombinedKnowledge(clean(payload.topic, 120)); send(200, found === null ? { ok: false, error: 'no_knowledge' } : { ok: true, guide: found }) }
      else if (payload.action === 'project' || /^(open|step|grow|shrink|close|drop|suspend|resume|evidence|show)$/.test(String(payload.action || ''))) send(200, projectStore.handle(payload))
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
        try { const ev = payload.event || {}; if (memoryV2 && (ev.type === 'reflex' || ev.type === 'lease')) memoryV2.appendLedger({ actor: ev.type, kind: String(ev.type), text: String(ev.detail || '').slice(0, 120) }) } catch (_error) { void _error }
        const event = payload.event && typeof payload.event === 'object' ? payload.event : {}
        const type = clean(event.type, 40)
        const detail = clean(event.detail, 240)
        if (!type) { send(400, { ok: false, error: 'invalid_event' }); return }
        if (gameMemory && typeof gameMemory.record === 'function') {
          if (type === 'death') state.lastDeathAt = now()
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

  const tickCurriculum = async () => { if (Number(state.decideInFlight) > 0) return snapshot(); await selfGoal(state); await reviewProject(state); return snapshot() }
  return { handler, decide, recordReceipt, setPermission, grant, tickCurriculum, snapshot, memoryV2, projectSnapshot: () => projectStore.snapshot(), interrupt: (reason) => { state.interrupted = true; state.interruptReason = clean(reason, 120); return snapshot() } }
}
