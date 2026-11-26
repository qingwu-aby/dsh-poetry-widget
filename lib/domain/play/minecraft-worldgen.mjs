// @ts-check
// 世界生成知识：什么资源在什么高度/地形。她自己 mc_guide 查，宿主不推送。

const ENTRIES = [
  {
    keys: ['羊', '羊毛', 'sheep', '床'],
    method: '羊在草方块上，开阔地形（草原/草甸/稀树草原）最多；找不到时还有一条替代路。',
    steps: [
      '羊只生成在草方块上，喜欢草原、草甸、稀树草原这类平坦开阔地形；山地缓坡也常有。',
      '白天看得清，但羊夜里也在；y 和你差不多高就在附近地表，别去洞里找。',
      '顺着一个方向走 60–100 格仍没有，说明这片地形不对：往开阔、平坦、草多的地方走，别在原地反复查。',
      '拿到羊毛两条路：① 用剪刀 mc_shear（不杀羊）② mc_attack 打死也掉 1 块。',
      '没有羊也可以用 4 个线（蜘蛛掉）合成 1 块羊毛——你打过蜘蛛，背包里可能有线。',
    ],
  },
  {
    keys: ['铁', '铁矿', 'iron', '铁锭', '炼铁'],
    method: '铁矿在 y=72 以下，最常见在 y=16 附近和深板岩层（y<0）。',
    steps: [
      '铁矿分布 y=-64 到 72，峰值在 y=16 和 y=-24 附近；地表少见，要往下挖。',
      'y<0 是深板岩层，矿更密但更硬；挖铁需要石镐。',
      '挖矿用台阶往下（mc_stair_up 反过来就是往下），别垂直挖坑；每挖几格插火把。',
      '挖到 raw_iron 要熔炉烧成铁锭（mc_smelt），8 圆石做一个熔炉。',
    ],
  },
  {
    keys: ['煤', '煤炭', 'coal', '火把'],
    method: '煤在 y=0 以上到处都有，山地崖壁常直接露出来。',
    steps: [
      '煤矿石分布 y=0 到 320，地表/山崖上常见，不用深处找。',
      '一块煤 + 一根木棍 = 4 支火把，是夜里最便宜的照明。',
      '没有煤可以烧木头得到木炭（熔炉 + 原木），同样能做火把。',
    ],
  },
  {
    keys: ['石头', '圆石', '石镐', 'cobblestone', 'stone'],
    method: '石头在地表下一层；挖掉地表草/土就能看到。',
    steps: [
      '地表往下挖 3–4 格就是石头层，整片都是。',
      '石头用木镐以上才能挖；挖 8 块圆石做熔炉，3 块做石镐。',
      '山崖/河岸的侧面直接能看到石头，不用专门挖坑。',
    ],
  },
  {
    keys: ['木', '木头', '原木', 'log', '树'],
    method: '树在森林/平原/山地最常见；沙漠和雪原稀少。',
    steps: [
      '森林、平原、山地都有树；沙漠只有仙人掌，雪原树稀疏。',
      '看到树直接 mc_mine block=oak_log，靠近 4 格内就能砍。',
      '一片区域完全没有树，就朝绿色/林地走（mc_explore），别在原地找。',
    ],
  },
  {
    keys: ['食物', '吃', '肉', '动物', '牛', '猪', '鸡'],
    method: '动物都在草方块上；找不到就往开阔草地走。',
    steps: [
      '牛/猪/鸡/羊只生成在草方块上，草原和山坡最多。',
      '打死后生肉别直接吃，用熔炉烤熟（mc_smelt）营养更高。',
      '没有动物时找草打种子种地（mc_till → mc_plant），或找苹果/甜浆果。',
    ],
  },
  {
    keys: ['钻石', 'diamond', '下界合金'],
    method: '钻石在 y=-64 到 16，越深越多，需要铁镐。',
    steps: [
      '钻石分布 y=-64 到 16，常见 y=-59 附近（深板岩层）。',
      '必须铁镐以上；挖之前先备好火把、食物、退路。',
      '挖到钻石先做钻石镐，再考虑其他装备。',
    ],
  },
  {
    keys: ['山洞', '洞穴', '下矿', '矿洞'],
    method: '洞里矿多但怪也多；洞口常在山脚/崖壁。',
    steps: [
      '洞穴入口多在山脚、崖壁、地表裂缝；顺着洞口往下就是矿脉区。',
      '进洞先插火把（背后留路），听到怪声先堵窄口再决定打还是撤。',
      '洞里 y<0 是深板岩层，铁矿钻石都在那；没铁镐别急着下。',
    ],
  },
]

/** 按主题匹配世界生成知识；匹配不到返回 null。 */
export function lookupWorldgen(topic) {
  const text = String(topic ?? '').toLowerCase()
  if (text.length === 0) return null
  let best = null
  let bestScore = 0
  for (const entry of ENTRIES) {
    let score = 0
    for (const key of entry.keys) if (text.includes(key.toLowerCase())) score += key.length >= 2 ? 2 : 1
    if (score > bestScore) { best = entry; bestScore = score }
  }
  if (best === null) return null
  return { method: best.method, steps: best.steps.slice(), caveat: '世界生成知识（不联网）', source: 'worldgen', title: best.keys[0] }
}

export function worldgenTopics() {
  return ENTRIES.map((entry) => entry.keys[0])
}
