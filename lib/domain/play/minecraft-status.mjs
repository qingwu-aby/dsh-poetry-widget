// @ts-check
// 主动查询式的“状态镜子”：她想知道才问，宿主不再每轮推送。
import { SKILL_CATEGORIES } from './minecraft-skill-map.mjs'

const LAYERS = [
  [1, '露天地面', '一块能站住的地方'],
  [2, '有顶能挡', '带顶的空间'],
  [3, '能睡', '门/火把 + 床'],
  [4, '吃得稳', '存粮 + 熔炉或农田'],
  [5, '有仓库', '箱子'],
  [6, '有产出', '农场/自动机'],
]

function layerOf(facilities) {
  const has = (key) => Number(facilities[key]) > 0
  let id = 1
  if (has('torch') || has('door') || has('crafting_table') || has('shelterShell')) id = 2
  if (has('bed')) id = 3
  if (has('furnace') || has('crops')) id = 4
  if (has('chest')) id = 5
  return id
}

/**
 * @param {{observation?: object, project?: object|null, plan?: object|null, toolStats?: Record<string, {success:number,failure:number}>}} input
 */
export function buildStatusReport(input = {}) {
  const obs = /** @type {any} */ (input.observation && typeof input.observation === 'object' ? input.observation : {})
  const facilities = obs.facilities && typeof obs.facilities === 'object' ? obs.facilities : {}
  const extra = obs.facilitiesExtra && typeof obs.facilitiesExtra === 'object' ? obs.facilitiesExtra : {}
  const merged = { ...facilities, ...extra }
  const lines = []
  lines.push(`位置 ${obs.position || '未知'}；血 ${obs.health ?? '?'}/20；饥饿 ${obs.food ?? '?'}/20；时间 ${obs.timeOfDay || '未知'}。`)
  const owned = Object.entries(merged).filter(([key, value]) => Number(value) > 0 && key !== 'shelterDistance').map(([key, value]) => `${key}×${value}`)
  lines.push(owned.length > 0 ? `身边设施：${owned.join('、')}。` : '身边没有任何设施。')
  const layerId = layerOf(merged)
  const layer = LAYERS.find((item) => item[0] === layerId) || LAYERS[0]
  const next = LAYERS.find((item) => item[0] === layerId + 1) || null
  lines.push(`生活层级：第 ${layer[0]} 层「${layer[1]}」${next ? `；再往上是第 ${next[0]} 层「${next[1]}」（${next[2]}）` : ''}。`)
  if (typeof extra.shelterAt === 'string' && extra.shelterAt.length > 0) lines.push(`你盖的屋子在 ${extra.shelterAt}（${extra.shelterDistance ?? '?'} 格）。`)
  if (obs.anchor && typeof obs.anchor === 'object') lines.push(`重生点：${obs.anchor.at}（${obs.anchor.source === 'bed' ? '床' : '世界出生点'}，${obs.anchor.distance ?? '?'} 格）。`)
  const landmarks = Array.isArray(obs.landmarks) ? obs.landmarks.filter((item) => item && typeof item.name === 'string') : []
  if (landmarks.length > 0) {
    const text = landmarks.slice(0, 3).map((item) => `${item.name === 'shelter' ? '你盖过的小屋' : item.name} @${item.x},${item.y},${item.z}（${item.distance} 格）`).join('、')
    lines.push(`你以前在附近放过东西：${text}。`)
  }
  const plan = /** @type {any} */ (input.plan)
  if (plan && Number(plan.total) > 0 && plan.done !== true) lines.push(`未完成的蓝图「${plan.name || '未命名'}」：${plan.nextIndex}/${plan.total}。`)
  const project = /** @type {any} */ (input.project)
  if (project) lines.push(`你自己的项目「${project.title}」；阶段：${project.stage || '开始'}${Array.isArray(project.milestones) && project.milestones.length > 0 ? `；未完成里程碑：${project.milestones.join('、')}` : ''}。`)
  const stats = input.toolStats && typeof input.toolStats === 'object' ? input.toolStats : {}
  const categories = SKILL_CATEGORIES.map((category) => {
    let count = 0
    for (const tool of category.tools) {
      const stat = stats[tool]
      if (stat) count += Number(stat.success) + Number(stat.failure)
    }
    return { name: category.name, count }
  })
  const total = categories.reduce((sum, item) => sum + item.count, 0)
  if (total > 0) {
    lines.push(`经验分布：${categories.filter((item) => item.count > 0).map((item) => `${item.name} ${item.count}`).join('、')}。`)
    const rough = Object.entries(stats)
      .filter(([, stat]) => Number(stat.success) + Number(stat.failure) >= 5)
      .map(([tool, stat]) => ({ tool, rate: Number(stat.success) / (Number(stat.success) + Number(stat.failure)) }))
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 3)
    if (rough.length > 0) lines.push(`最不顺手的动作：${rough.map((item) => `${item.tool}（成功 ${Math.round(item.rate * 100)}%）`).join('、')}。`)
  }
  return lines.join('\n')
}


/** “最不顺手的三个动作”一行字，给立项和状态查询共用。 */
export function roughText(stats = {}) {
  const entries = stats && typeof stats === 'object' ? Object.entries(stats) : []
  return entries
    .filter(([, stat]) => Number(stat?.success ?? 0) + Number(stat?.failure ?? 0) >= 5)
    .map(([tool, stat]) => ({ tool, rate: Number(stat.success) / (Number(stat.success) + Number(stat.failure)) }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3)
    .map((item) => `${item.tool} 成功 ${Math.round(item.rate * 100)}%`)
    .join('、')
}


/** 生活层级梯子：现在第几层、下一层是什么。给“升级目标”用。 */
export function ladderLines(observation) {
  const obs = observation && typeof observation === 'object' ? observation : {}
  const facilities = obs.facilities && typeof obs.facilities === 'object' ? obs.facilities : {}
  const extra = obs.facilitiesExtra && typeof obs.facilitiesExtra === 'object' ? obs.facilitiesExtra : {}
  const merged = { ...facilities, ...extra }
  const layerId = layerOf(merged)
  const current = LAYERS.find((item) => item[0] === layerId) || LAYERS[0]
  const next = LAYERS.find((item) => item[0] === layerId + 1) || null
  const after = LAYERS.find((item) => item[0] === layerId + 2) || null
  const lines = [`你现在在第 ${current[0]} 层「${current[1]}」（${current[2]}）。`]
  if (next) lines.push(`下一层：第 ${next[0]} 层「${next[1]}」——${next[2]}。`)
  if (after) lines.push(`再往上：第 ${after[0]} 层「${after[1]}」——${after[2]}。`)
  return lines
}
