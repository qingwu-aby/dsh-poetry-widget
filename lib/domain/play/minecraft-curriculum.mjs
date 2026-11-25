// @ts-check
// Voyager 式“自动课程”的最小版：根据她现在的真实缺口，算出几个“下一步候选”。
// 只给候选与前置条件，不指派；她自己挑，或者都不挑继续做手头的事。

const PLANK = /^(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_planks$/
const WOOL = /_wool$/

function inv(observation) {
  const list = Array.isArray(observation?.inventory) ? observation.inventory : []
  const map = new Map()
  for (const line of list) {
    const match = String(line).match(/^(.+?)[×x](\d+)$/)
    if (match) map.set(match[1], Number(match[2]))
  }
  return map
}
function countMatching(map, pattern) {
  let total = 0
  for (const [name, count] of map) if (pattern.test(name)) total += count
  return total
}

/**
 * @param {{observation?: object, project?: object|null, layer?: number}} input
 * @returns {Array<{goal: string, why: string, ready: boolean}>}
 */
export function curriculumCandidates(input = {}) {
  const observation = /** @type {any} */ (input.observation && typeof input.observation === 'object' ? input.observation : {})
  const facilities = observation.facilities && typeof observation.facilities === 'object' ? observation.facilities : {}
  const has = (key) => Number(facilities[key]) > 0
  const bag = inv(observation)
  const planks = countMatching(bag, PLANK)
  const wool = countMatching(bag, WOOL)
  const cobble = bag.get('cobblestone') || 0
  const food = Number(observation.food)
  const out = []

  // 床：第 3 层的门槛，缺羊毛是最常见的卡点。
  if (!has('bed')) {
    if (wool >= 3 && planks >= 3) out.push({ goal: '用 3 羊毛 + 3 木板做一张床，放到屋子里', why: '有床才能睡过夜、设重生点', ready: true })
    else if (planks >= 3) out.push({ goal: '找羊剪/杀羊毛 → 凑 3 羊毛做床', why: '差羊毛就能睡过夜了', ready: false })
  }
  // 熔炉：生肉/原矿的加工前提。
  if (!has('furnace')) {
    if (cobble >= 8) out.push({ goal: '用 8 圆石做熔炉并放下', why: '能把生肉烤熟、把原矿炼成锭', ready: true })
    else out.push({ goal: `挖圆石凑 8 块（现在 ${cobble} 块）做熔炉`, why: '熔炉是熟食和金属的前提', ready: false })
  }
  // 箱子：物资别再全塞背包。
  if (!has('chest')) {
    if (planks >= 8) out.push({ goal: '用 8 木板做一个箱子放下，把杂物存进去', why: '背包空间就是安全边界', ready: true })
  }
  // 照明：夜里最便宜的保命手段。
  if (!has('torch')) {
    const coal = bag.get('coal') || bag.get('charcoal') || 0
    const logs = (bag.get('oak_log') || 0) + (bag.get('birch_log') || 0) + (bag.get('spruce_log') || 0)
    if (coal > 0 || logs > 0) out.push({ goal: '做几支火把，放在门口和屋里', why: '照明能显著减少夜里被怪贴脸', ready: coal > 0 })
  }
  // 食物：饿了又没吃的，优先解决。
  if (Number.isFinite(food) && food <= 14) out.push({ goal: '先搞吃的：打动物/找作物，烤熟再吃', why: `饥饿只有 ${food}/20`, ready: false })
  // 农场地基：长期解放生产力。
  if (has('chest') && has('furnace') && !has('crops') && planks >= 4) out.push({ goal: '开一小块农田（锄地 → 播种 → 浇水）', why: '食物能自给，就不用一直出门打猎', ready: false })

  return out.slice(0, 3)
}

/** 渲染成 prompt 里的一段话；没有候选就返回空串。 */
export function curriculumLines(input = {}) {
  const candidates = curriculumCandidates(input)
  if (candidates.length === 0) return ''
  const lines = candidates.map((item, index) => `${index + 1}) ${item.goal}${item.ready ? '（材料够了）' : '（还差前置）'} —— 因为${item.why}`)
  return ['按你现在的状况，能往上走的几个方向（只是候选，你想做别的也完全可以）：', ...lines].join('\n')
}
