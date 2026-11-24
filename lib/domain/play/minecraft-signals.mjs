// @ts-check
// 给 World 的中性信号：只陈述“你在重复什么/要多少材料”，不命令她自动化。
const REPEAT_MIN = 6
const REPEAT_WINDOW = 20
const REPEAT_COOLDOWN_MS = 10 * 60 * 1000
const DEMAND_MIN = 32

function signature(command) {
  const tool = String(command?.tool ?? '')
  const args = command?.arguments && typeof command.arguments === 'object' ? command.arguments : {}
  const target = String(args.block ?? args.item ?? args.target ?? '').slice(0, 24)
  return target.length > 0 ? `${tool}:${target}` : tool
}

/** 最近几步都是单动作 → 提醒可以合并成队列，减少等待。 */
function oneStepNudge(state) {
  const history = Array.isArray(state.commandHistory) ? state.commandHistory.slice(-6) : []
  if (history.length < 5) return ''
  const singles = history.filter((item) => !(Number(item?.queueCount) > 0)).length
  if (singles < history.length) return ''
  return ' 你最近每一步都只做一个动作，节奏会被想的时间拖慢；如果下一步做什么很清楚，就把 2–3 步一起放进 queue。'
}

/** 最近动作里同一件事重复够多次 → 给一句事实；同一签名 10 分钟内只提一次。 */
export function repetitionHint(state = {}, now = Date.now()) {
  const history = Array.isArray(state.commandHistory) ? state.commandHistory.slice(-REPEAT_WINDOW) : []
  if (history.length < REPEAT_MIN) return ''
  const counts = new Map()
  for (const command of history) {
    const key = signature(command)
    if (key.length === 0) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const cooldown = state.repeatHintAt && typeof state.repeatHintAt === 'object' ? state.repeatHintAt : {}
  const inCooldown = (key) => Number(cooldown[key] || 0) > 0 && now - Number(cooldown[key]) < REPEAT_COOLDOWN_MS
  const candidates = [...counts.entries()].filter(([key, count]) => count >= REPEAT_MIN && !inCooldown(key)).sort((a, b) => b[1] - a[1]).slice(0, 2)
  if (candidates.length === 0) return ''
  state.repeatHintAt = { ...cooldown }
  for (const [key] of candidates) state.repeatHintAt[key] = now
  const text = candidates.map(([key, count]) => `${key.replace(':', ' ×')}（${count} 次）`).join('、')
  const hint = `你最近手动重复做：${text}。如果这类需求还会持续，可以考虑 mc_automate 或红石/农场自动化；继续手动做也完全可以。`
  return hint + oneStepNudge(state)
}

/**
 * 建造计划的材料需求：某种方块要得多、背包又不够 → 给出量化事实。
 * @param {Array<{block?: string}>} blocks
 * @param {Array<string>} inventory 形如 "oak_planks×12"
 */
export function demandHint(blocks, inventory = []) {
  const need = new Map()
  for (const item of Array.isArray(blocks) ? blocks : []) {
    const name = String(item?.block ?? '')
    if (name.length === 0) continue
    need.set(name, (need.get(name) || 0) + 1)
  }
  const have = new Map()
  for (const line of Array.isArray(inventory) ? inventory : []) {
    const match = String(line).match(/^(.+?)[×x](\d+)$/)
    if (match) have.set(match[1], Number(match[2]))
  }
  const gaps = []
  for (const [name, count] of need) {
    if (count < DEMAND_MIN) continue
    const owned = have.get(name) || 0
    if (owned >= count) continue
    if (owned > count * 0.5) continue
    gaps.push(`${name} 需要 ${count} 块，现有 ${owned} 块`)
  }
  if (gaps.length === 0) return ''
  gaps.sort((a, b) => b.length - a.length)
  return `这次要用的材料量不小：${gaps.slice(0, 2).join('；')}。手挖/手砍会很久，可以想批量采集或自动化；想先少建一点也合理。`
}


const HOSTILE_NAME = /zombie|skeleton|creeper|spider|witch|drowned|pillager|phantom|husk|stray|slime|enderman|wither|blaze|ghast|zoglin|hoglin|piglin|brute|vex|warden|guardian|shulker|ravager|evoker|vindicator|illusioner|silverfish|magma|zombified/i
const PASSIVE_NAME = /cow|pig|sheep|chicken|rabbit|horse|cat|dog|wolf|villager|fox|panda|frog|axolotl|bee|llama|turtle|fish|squid|bat|golem|allay/i

function entityName(entry) {
  if (typeof entry === 'string') return entry.split('@')[0]
  if (entry && typeof entry === 'object') return String(entry.name ?? entry.type ?? '')
  return ''
}
function isHostile(entry) {
  if (entry && typeof entry === 'object') {
    const type = String(entry.type ?? '').toLowerCase()
    if (type === 'hostile' || type === 'monster') return true
    if (entry.hostile === true) return true
    if (entry.hostile === false) return false
    const name = entityName(entry)
    if (PASSIVE_NAME.test(name)) return false
    return HOSTILE_NAME.test(name)
  }
  const name = entityName(entry)
  return HOSTILE_NAME.test(name) && !PASSIVE_NAME.test(name)
}
function describeEntity(entry) {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return ''
  const name = entityName(entry)
  const distance = Number(entry.distance)
  return Number.isFinite(distance) ? `${name}（${distance} 格）` : name
}

/** 外部威胁：附近敌对生物 + 血量；按 type/hostile 判断，不依赖固定名单。 */
export function threatLines(observation = {}) {
  const obs = /** @type {any} */ (observation && typeof observation === 'object' ? observation : {})
  const entities = Array.isArray(obs.nearbyEntities) ? obs.nearbyEntities.filter((item) => item !== null && item !== undefined).slice(0, 8) : []
  const hostiles = entities.filter((entry) => isHostile(entry))
  const health = Number(obs.health)
  const lines = []
  if (entities.length > 0) lines.push(`附近生物：${entities.map(describeEntity).filter(Boolean).join('、')}`)
  if (hostiles.length > 0) {
    const inventory = Array.isArray(obs.inventory) ? obs.inventory.map(String).join(' ') : ''
    const armed = /_(sword|axe)\b|\bsword\b|\baxe\b/i.test(inventory)
    const hp = Number.isFinite(health) ? health : null
    const advice = !armed
      ? '你手上没有武器：不要空手 mc_attack，先跑开、垫高或封口，脱身之后再做武器。'
      : hp !== null && hp <= 8
        ? '血量偏低：能跑就跑，别为了捡东西硬拼。'
        : '能打就 mc_attack/mc_defend（打一下退一步），打不过就跑开、垫高或封住入口。'
    lines.push(`附近有敌对生物：${hostiles.map(describeEntity).join('、')}。血量 ${hp === null ? '?' : hp}/20。优先保命：${advice}`)
  } else if (Number.isFinite(health) && health <= 8) {
    lines.push(`你血量只剩 ${health}/20，附近暂时没看到敌对生物。先吃东西/撤退/封口，别硬撑。`)
  }
  if (hostiles.length > 0) {
    const unknown = hostiles.map(entityName).filter((name) => name.length > 0 && !HOSTILE_NAME.test(name))
    if (unknown.length > 0) lines.push(`不熟悉的生物（${unknown.join('、')}）：先 mc_guide 查「${unknown[0]} 怎么打」再决定，别空手硬上。`)
  }
  return lines
}


/** Minecraft 专用模型候选：先关 thinking 求快，失败再退回带 thinking 的模型。 */
export const MC_FAST_CANDIDATES = Object.freeze([
  { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off', maxTokensFloor: 1200 },
  { provider: 'dsh-opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'low', maxTokensFloor: 2200 },
])


/** 刚死过：提醒她背包清空、优先活下来；超过 15 分钟不再提。 */
export function deathHint(lastDeathAt, now = Date.now()) {
  const at = Number(lastDeathAt)
  if (!Number.isFinite(at) || at <= 0) return ''
  const minutes = Math.round((now - at) / 60000)
  if (minutes < 0 || minutes > 15) return ''
  return `你大约 ${Math.max(1, minutes)} 分钟前死了一次，背包大概率清空了。先活下来：找安全处、徒手弄木头做工具、天黑前封口；别空手打怪，也别急着捡回东西。`
}


/** 背包压力：快满时提示做箱子/存东西，而不是继续捡。 */
export function storageHint(observation = {}) {
  const obs = /** @type {any} */ (observation && typeof observation === 'object' ? observation : {})
  const free = Number(obs.slotsFree)
  if (!Number.isFinite(free) || free > 6) return ''
  const hasChest = /chest|barrel|shulker/i.test(Array.isArray(obs.nearbyBlocks) ? obs.nearbyBlocks.join(' ') : '')
  return hasChest
    ? `背包只剩 ${free} 格：把暂时用不上的方块/杂物 mc_store 进旁边的箱子，别一路捡到满。`
    : `背包只剩 ${free} 格：可以先 mc_craft chest（8 块木板）→ mc_place 放下 → 再把杂物 mc_store 进去；也可以先 mc_inventory 清点，丢掉最没用的。`
}


const RAW_FOOD = /^(beef|porkchop|chicken|mutton|rabbit|cod|salmon|tropical_fish|potato)$/
const RAW_ORE = /^(raw_iron|raw_gold|raw_copper|iron_ore|gold_ore|copper_ore|sand)$/

/** 有生食/原矿时提示用熔炉，没有熔炉就提示先做一个。 */
export function smeltHint(observation = {}) {
  const obs = /** @type {any} */ (observation && typeof observation === 'object' ? observation : {})
  const inv = Array.isArray(obs.inventory) ? obs.inventory.map(String) : []
  const names = inv.map((line) => line.split('×')[0].trim())
  const rawFood = names.filter((name) => RAW_FOOD.test(name))
  const rawOre = names.filter((name) => RAW_ORE.test(name))
  if (rawFood.length === 0 && rawOre.length === 0) return ''
  const hasFurnace = /furnace/i.test(Array.isArray(obs.nearbyBlocks) ? obs.nearbyBlocks.join(' ') : '')
  const hasCobble = inv.some((line) => /^(cobblestone|stone)×/.test(line))
  const target = rawFood.length > 0 ? rawFood[0] : rawOre[0]
  if (hasFurnace) return `你身上有 ${target}：附近有熔炉，mc_smelt 烤熟/炼掉比生吃/带原矿划算。`
  if (hasCobble) return `你身上有 ${target}，但没有熔炉：8 块圆石可以 mc_craft furnace，mc_place 放下后 mc_smelt。`
  return `你身上有 ${target}：生吃/原矿收益低，先挖点圆石做熔炉（8 圆石）再 mc_smelt。`
}


/**
 * 目标锚：她每条指令都带 reason，把“连续同一件事”串起来，避免每轮换目标乱走。
 * 返回空串表示还不该提。
 */
export function intentAnchor(state = {}, now = Date.now()) {
  const history = Array.isArray(state.commandHistory) ? state.commandHistory.slice(-8) : []
  if (history.length < 3) return ''
  const last = history[history.length - 1]
  if (!last || typeof last.reason !== 'string' || last.reason.trim().length === 0) return ''
  // 从后往前数：同一种工具、理由相似，算同一件事。
  const norm = (text) => String(text ?? '').replace(/\s+/g, '')
  const base = norm(last.reason)
  let streak = 0
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i]
    if (!item || item.tool !== last.tool) break
    if (!norm(item.reason).includes(base.slice(0, 6)) && !base.includes(norm(item.reason).slice(0, 6))) break
    streak += 1
  }
  if (streak < 3) return ''
  return `你连续 ${streak} 步都在做同一件事（${last.tool}），你写的理由是「${String(last.reason).slice(0, 60)}」。先把这件事做完再换目标，别做一半就去别处。`
}


/**
 * 生活水平镜像：只陈述她现在的日子缺什么，不命令她去补。
 * 依据是 bot 扫描 16 格内的设施（床/箱子/熔炉/工作台/火把/作物/门）。
 */
export function livingHint(observation = {}) {
  const obs = /** @type {any} */ (observation && typeof observation === 'object' ? observation : {})
  const f = obs.facilities && typeof obs.facilities === 'object' ? obs.facilities : null
  if (f === null) return ''
  const inv = Array.isArray(obs.inventory) ? obs.inventory.map(String) : []
  const lines = []
  if (!(Number(f.bed) > 0)) {
    const wool = inv.some((line) => /_wool×/.test(line))
    lines.push(`你现在没有床（睡觉得 3 羊毛 + 3 木板），天黑只能硬撑、躲起来或挖进地面。${wool ? '背包里有羊毛，木板也够的话可以试着做一张。' : ''}`)
  }
  if (!(Number(f.chest) > 0)) lines.push('你也没有放东西的地方（箱子），所有物资都塞在背包里。')
  if (!(Number(f.crops) > 0) && !(Number(f.furnace) > 0)) lines.push('你还没有农场和熔炉：食物靠现打、生肉直接吃，吃饱基本靠运气。')
  if (!(Number(f.door) > 0) && !(Number(f.torch) > 0)) lines.push('你附近没有门也没有火把：晚上没有能挡怪、能照亮的小屋。')
  return lines.slice(0, 3).join(' ')
}


const LAYERS = [
  { id: 1, name: '露天地面', needs: '一块能站住的地方，别一晚上都在跑' },
  { id: 2, name: '有顶能挡', needs: '几块方块围出带顶的空间，夜里能躲' },
  { id: 3, name: '能睡', needs: '门/火把 + 一张床（3 羊毛 + 3 木板）' },
  { id: 4, name: '吃得稳', needs: '存粮 + 熔炉（8 圆石）或一小块农田' },
  { id: 5, name: '有仓库', needs: '箱子，物资不再全塞背包' },
  { id: 6, name: '有产出', needs: '农场/自动机，让一部分劳动不用自己动手' },
]

/**
 * 生活层级：只陈述“你现在停在第几层、下一层是什么样、你手上已有什么”，不指派任务。
 */
export function livingLayer(observation = {}) {
  const obs = /** @type {any} */ (observation && typeof observation === 'object' ? observation : {})
  const f = obs.facilities && typeof obs.facilities === 'object' ? obs.facilities : null
  const inv = Array.isArray(obs.inventory) ? obs.inventory.map(String) : []
  if (f === null) return ''
  const has = (key) => Number(f[key]) > 0
  const hasFood = inv.some((line) => /^(cooked_|bread|apple|carrot|baked_potato|golden_)/.test(line))
  const automations = Number(obs.automations)
  let id = 1
  if (has('torch') || has('door') || has('crafting_table')) id = 2
  if (has('bed')) id = 3
  if (hasFood && (has('furnace') || has('crops'))) id = 4
  if (has('chest')) id = 5
  if (automations > 0 || has('crops') && has('chest') && has('furnace')) id = 6
  const cur = LAYERS[Math.min(id, LAYERS.length) - 1]
  const next = LAYERS[Math.min(id, LAYERS.length)] || null
  const owned = []
  if (has('crafting_table')) owned.push('工作台')
  if (has('torch')) owned.push(`火把×${f.torch}`)
  if (has('door')) owned.push('门')
  if (has('bed')) owned.push('床')
  if (has('furnace')) owned.push('熔炉')
  if (has('chest')) owned.push('箱子')
  if (has('crops')) owned.push(`作物×${f.crops}`)
  if (automations > 0) owned.push(`自动机×${automations}`)
  const goods = inv.filter((line) => /^(oak_planks|birch_planks|_wool|_log|torch|furnace|chest|bed|bread|cooked_)/.test(line)).slice(0, 5)
  return `你现在的日子停在第 ${cur.id} 层「${cur.name}」。${next ? `再往上一层（第 ${next.id} 层）意味着：${next.needs}。` : '这层已经比较完整了。'}${owned.length > 0 ? `你手上已经有：${owned.join('、')}。` : ''}${goods.length > 0 ? `背包里相关的：${goods.join('、')}。` : ''}要不要往上走、先走哪一步，你自己定。`
}
