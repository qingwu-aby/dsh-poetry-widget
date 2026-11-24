// @ts-check
// 需求桥：把「身体欠着的事」和「想继续做的事」并排摆给她看，只陈述事实，不排序、不打分、不设闸门。
// 缺什么由她自己判断先补哪边——这是桥，不是调度器。
function hoursSince(at, now) {
  return typeof at === 'number' && at > 0 ? Math.max(0, Math.round((now - at) / 3600000)) : null
}
/** 越高越缺（饿/渴）。 */
function worseWhenHigh(value, mild, severe, mildText, severeText) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (n >= severe) return severeText
  if (n >= mild) return mildText
  return ''
}
/** 越低越缺（体力）。 */
function worseWhenLow(value, severe, mild, severeText, mildText) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (n <= severe) return severeText
  if (n <= mild) return mildText
  return ''
}

export function buildNeedBridge(input = {}) {
  const state = input.state && typeof input.state === 'object' ? input.state : {}
  const project = input.project && typeof input.project === 'object' ? input.project : null
  const now = typeof input.now === 'number' ? input.now : Date.now()
  const body = []
  const hunger = worseWhenHigh(state.hunger, 55, 75, '有点饿', '挺饿')
  if (hunger) body.push(hunger)
  const thirst = worseWhenHigh(state.thirst, 55, 75, '有点渴', '挺渴')
  if (thirst) body.push(thirst)
  const energy = worseWhenLow(state.energy, 30, 50, '很累', '有点乏')
  if (energy) body.push(energy)
  if (state.sleeping === true) body.push('在休息')
  const mealHours = hoursSince(state.lastMealAt, now)
  const drinkHours = hoursSince(state.lastDrinkAt, now)
  const gaps = []
  if (mealHours !== null && mealHours >= 6) gaps.push(`${mealHours} 小时没吃东西`)
  if (drinkHours !== null && drinkHours >= 4) gaps.push(`${drinkHours} 小时没喝水`)
  const lines = []
  if (body.length > 0 || gaps.length > 0) {
    const parts = []
    if (body.length > 0) parts.push(body.join('、'))
    if (gaps.length > 0) parts.push(gaps.join('、'))
    lines.push('身体这边：' + parts.join('；') + '。')
  }
  if (project !== null && typeof project.title === 'string' && project.title.length > 0) {
    const staleHours = hoursSince(project.lastStepAt ?? project.stepAt ?? project.updatedAt, now)
    const stage = typeof project.stage === 'string' && project.stage.length > 0 ? `（阶段：${project.stage}）` : ''
    const stale = staleHours !== null && staleHours >= 24 ? `，大约 ${Math.round(staleHours / 24)} 天没动` : ''
    lines.push(`想做的事那边：${project.title}${stage}${stale}。`)
  }
  if (lines.length >= 2) lines.push('两边都是真的；先顾哪边、各花多少力气，你自己定，不必都做，也不必分先后。')
  return lines
}
