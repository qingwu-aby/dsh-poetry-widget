// @ts-check
// 生存里“照着蓝图盖建筑”的做法（她自己 mc_guide 查）。
const ENTRIES = [
  {
    keys: ['蓝图', '照着盖', '照着蓝图', '按图盖', '施工方法'],
    method: '照蓝图盖大建筑：先备料 → 定基 → 分层 → 封顶 → 收尾，一层一层来。',
    steps: [
      '备料：先 mc_build action=list 选蓝图，再 mc_build from=名字 看「还缺材料」，把缺口列成清单去采集/烧炼。',
      '定基：找一块平地，先把蓝图四角的地基垫平（悬空会放不上）。',
      '分层：从最低层开始一层层往上放，别跳层；每层放完检查有没有漏块。',
      '跳不过去就绕：够不到的方块先放脚手架（泥土柱子）站上去，或者从另一侧放。',
      '封顶后再补门窗、火把、床、箱子这些内部件。',
      '大工程分多次：一次 mc_build 只放一批，进度会记住，下次接着放。',
    ],
  },
  {
    keys: ['材料不够', '备料', '缺材料', '攒材料'],
    method: '大建筑的材料要提前算：按主材分组，一次备一大类。',
    steps: [
      '先看蓝图材料清单：哪种方块最多，就先去搞那一种。',
      '木材类：找树林连片砍，原木烧成炭或者直接做木板。',
      '石类：挖矿道（mc_tunnel）最省事，一路挖一路收。',
      '烧炼类（玻璃/砖/石砖）：先在熔炉批量烧（mc_smelt_batch），别一块一块烧。',
      '材料先堆进箱子（mc_store），按类别放，别全背身上。',
    ],
  },
  {
    keys: ['脚手架', '够不到', '放不上', '放不上去'],
    method: '够不到就垫脚：站在离目标 3 格内、脚下要有实心方块。',
    steps: [
      '先走到目标旁边，距离超过 4 格就放不上。',
      '脚下垫一格（mc_place 泥土/圆石），站上去再放。',
      '太高就搭一个临时的梯子/柱子，放完再拆。',
      '别站在要放方块的位置上——会被自己挡住。',
    ],
  },
]
export function lookupBuilding(topic) {
  const text = String(topic ?? '').toLowerCase()
  if (text.length === 0) return null
  let best = null
  let bestScore = 0
  for (const entry of ENTRIES) {
    let score = 0
    for (const key of entry.keys) { const k = key.toLowerCase(); if (text.includes(k)) score += k.length }
    if (score > bestScore) { best = entry; bestScore = score }
  }
  if (best === null || bestScore < 2) return null
  return { method: best.method, steps: best.steps.slice(), caveat: '施工做法（本地知识）', source: 'building', title: best.keys[0] }
}
