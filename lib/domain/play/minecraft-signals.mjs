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
  return `你最近手动重复做：${text}。如果这类需求还会持续，可以考虑 mc_automate 或红石/农场自动化；继续手动做也完全可以。`
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
