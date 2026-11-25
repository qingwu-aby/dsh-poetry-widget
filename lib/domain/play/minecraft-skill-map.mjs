// @ts-check
// ODYSSEY 式技能分层：把她用过的工具按能力域归类，找出“最薄的一层”。
// 依据是 tool-skills 的累计调用次数，不猜。

import { statSync, readFileSync } from 'node:fs'

export const SKILL_CATEGORIES = Object.freeze([
  { id: 'gather', name: '采集', tools: ['mc_mine', 'mc_find', 'mc_collect'] },
  { id: 'craft', name: '制作', tools: ['mc_craft', 'mc_recipe', 'mc_equip', 'mc_smelt'] },
  { id: 'build', name: '建造', tools: ['mc_plan', 'mc_build', 'mc_place', 'mc_project'] },
  { id: 'survive', name: '生存', tools: ['mc_eat', 'mc_sleep', 'mc_hide', 'mc_flee', 'mc_escape', 'mc_wait'] },
  { id: 'fight', name: '战斗', tools: ['mc_attack', 'mc_defend', 'mc_shoot', 'mc_block', 'mc_throw'] },
  { id: 'farm', name: '农业', tools: ['mc_till', 'mc_plant', 'mc_harvest', 'mc_bonemeal', 'mc_compost', 'mc_autofarm', 'mc_water', 'mc_feed_animal'] },
  { id: 'redstone', name: '红石', tools: ['mc_activate', 'mc_inspect'] },
  { id: 'transport', name: '交通', tools: ['mc_boat', 'mc_minecart', 'mc_ride', 'mc_drive'] },
  { id: 'storage', name: '储物', tools: ['mc_store', 'mc_take', 'mc_use_container'] },
])

const LOW_ACTIVITY = 5

/**
 * @param {Record<string, number>} toolCounts 每个工具的历史调用次数
 */
export function skillProfile(toolCounts = {}) {
  /** @type {Record<string, number>} */
  const counts = toolCounts && typeof toolCounts === 'object' ? toolCounts : {}
  /** @type {Array<{id:string,name:string,count:number,toolsUsed:number,toolTotal:number}>} */
  const categories = SKILL_CATEGORIES.map((category) => {
    let count = 0
    let toolsUsed = 0
    for (const tool of category.tools) {
      const value = Number(counts[tool]) || 0
      count += value
      if (value > 0) toolsUsed += 1
    }
    return { id: category.id, name: category.name, count, toolsUsed, toolTotal: category.tools.length }
  })
  const sorted = [...categories].sort((a, b) => a.count - b.count)
  /** @type {{id:string,name:string,count:number}|null} */
  const weakest = sorted.length > 0 && sorted[0].count <= LOW_ACTIVITY ? sorted[0] : null
  const total = categories.reduce((sum, item) => sum + item.count, 0)
  const profile = categories.filter((item) => item.count > 0).map((item) => `${item.name}${item.count}`).join(' / ')
  return { categories, weakest, total, profile }
}

/** 把“最薄的一层”变成一句可选建议；没有明显短板就返回空串。 */
export function skillGapLine(toolCounts = {}) {
  const { weakest, categories } = skillProfile(toolCounts)
  if (weakest === null) return ''
  const total = categories.reduce((sum, item) => sum + item.count, 0)
  if (total < 30) return ''
  /** @type {Record<string,string>} */
  const hints = {
    redstone: '可以先做一支火把、一个拉杆门这种最小回路（mc_place + mc_activate + mc_inspect）',
    farm: '可以先锄一小块地、播几颗种子（mc_till → mc_plant → mc_harvest）',
    transport: '可以先放一艘船或一辆矿车试试（mc_boat / mc_minecart / mc_ride）',
    storage: '可以先做箱子，把杂物存进去（mc_craft chest → mc_place → mc_store）',
    fight: '可以先练「打一下就退」的节奏（mc_attack + mc_flee）',
    build: '可以先 mc_project 写一个极小的目标（比如一个 3×3 的顶），再 mc_plan/mc_build',
    craft: '可以先把木→石→铁的工具升级链走一遍（mc_craft）',
    gather: '可以先用 mc_find 定点采集，而不是到处走',
    survive: '可以先把「夜里躲起来、白天再干活」变成习惯（mc_hide）',
  }
  const hint = hints[weakest.id] || ''
  return `你的经验分布：${categories.filter((item) => item.count > 0).map((item) => `${item.name} ${item.count}`).join('、')}。最薄的一层是「${weakest.name}」（${weakest.count} 次）。${hint ? `如果想补，${hint}；不想碰也完全可以。` : '想补就试一下，不想碰也完全可以。'}`
}


let countsCache = { key: '', counts: {} }

/** 从 tool-skills 的经验文件里汇总每个工具的调用次数（按 mtime 缓存，避免每轮读盘）。 */
export function toolCountsOf(toolSkills) {
  const file = toolSkills && typeof toolSkills.file === 'string' ? toolSkills.file : ''
  if (file.length === 0) return {}
  let key = ''
  try {
    const stat = statSync(file)
    key = `${file}:${stat.mtimeMs}:${stat.size}`
  } catch (_error) {
    return {}
  }
  if (key === countsCache.key) return countsCache.counts
  const counts = {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    for (const scope of Object.values(raw?.scopes || {})) {
      for (const payload of Object.values(scope?.contexts || {})) {
        for (const [tool, stat] of Object.entries(payload?.tools || {})) {
          counts[tool] = (counts[tool] || 0) + Number(stat?.success || 0) + Number(stat?.failure || 0)
        }
      }
    }
  } catch (_error) {
    return {}
  }
  countsCache = { key, counts }
  return counts
}
