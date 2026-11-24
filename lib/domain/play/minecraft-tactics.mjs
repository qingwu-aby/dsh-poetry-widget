// @ts-check
// 本地战斗/生存战术：wiki 没有“怎么打”的条目，这里给可直接照做的短步骤。
const TACTICS = [
  { keys: ['僵尸', 'zombie', '尸壳', 'husk', '溺尸', 'drowned'], method: '僵尸近战慢，边退边打，别背对；被围就垫高或封门。', steps: [
    '拿剑或斧，面对它后退一两步再打一下（打一下退一步），别站着不动对拼。',
    '血量低于 8 或一下来三只以上，立刻 mc_move_to 拉开距离，或垫两块站高处。',
    '夜里听到多个方向的声音就先封住入口/躲进洞里，不要硬拼。',
  ] },
  { keys: ['骷髅', 'skeleton', '流浪者', 'stray', '弓箭'], method: '骷髅远程，走之字形接近，别直线冲。', steps: [
    '左右横移接近（之字形），不要直线走，箭会打空。',
    '近身后贴脸打，它不会退；也可以先用方块挡一下再冲。',
    '有盾就举盾接近（mc_block），没盾就借墙/树挡视线。',
  ] },
  { keys: ['苦力怕', 'creeper', '爆炸'], method: '苦力怕贴脸会炸，打一下退一步，别站桩。', steps: [
    '打一下就后退，保持在爆炸范围外；听到“嘶”声立刻再退。',
    '把它引到水里，或让别人打它，再回来捡东西。',
    '别在它旁边挖矿/整理背包；被炸会掉大半血。',
  ] },
  { keys: ['蜘蛛', 'spider', '洞穴蜘蛛'], method: '蜘蛛会跳，站高处或在窄处打。', steps: [
    '白天蜘蛛中立，别主动惹；夜里它会主动扑。',
    '站到一格高的台子上打，它跳不上来。',
    '洞穴蜘蛛有毒，别在窄洞里被围。',
  ] },
  { keys: ['女巫', 'witch'], method: '女巫会喝药回血，别站桩消耗。', steps: [
    '快速近身连续打，不给她喝药时间。',
    '别在远处对射，她的药水比你快。',
  ] },
  { keys: ['夜晚', '晚上', '过夜', '天黑'], method: '天黑前封好口、点灯、睡床。', steps: [
    '日落前把入口用方块堵上，屋内插火把（mc_place torch）。',
    '有床就 mc_sleep；没床就待在封闭空间里等天亮。',
    '不要夜里在野外跑图或挖矿。',
  ] },
  { keys: ['洞穴', '挖矿', '地下'], method: '洞穴先插火把、留退路、别挖脚下。', steps: [
    '进去先插火把，保证背后有路可退。',
    '不垂直向下挖；遇到水/岩浆先停。',
    '听到怪声先堵窄口，再决定打还是撤。',
  ] },
]

/** 按主题匹配本地战术；命中返回 {method, steps, source:'tactics'}，否则 null。 */
export function lookupTactics(topic) {
  const text = String(topic ?? '').toLowerCase()
  if (text.length === 0) return null
  for (const entry of TACTICS) {
    if (entry.keys.some((key) => text.includes(key.toLowerCase()))) {
      return { method: entry.method, steps: entry.steps.slice(), caveat: '本地战术笔记（不需要联网）', source: 'tactics', title: entry.keys[0] }
    }
  }
  return null
}

export function tacticsTopics() {
  return TACTICS.map((entry) => entry.keys[0])
}
