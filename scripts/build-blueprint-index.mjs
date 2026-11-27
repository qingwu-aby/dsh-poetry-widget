#!/usr/bin/env node
// 扫描蓝图库，生成索引（index.json + INDEX.md）：分类、尺寸、方块数、材料清单。
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DIR = path.join(homedir(), '.dsh', '.dsh-poetry', 'blueprints')
const SOURCE_HINT = path.join(DIR, 'sources.json')

function categorize(blueprint) {
  const counts = new Map((blueprint.materials || []).map((m) => [m.name, m.count]))
  const sum = (pattern) => [...counts.entries()].filter(([name]) => pattern.test(name)).reduce((total, [, n]) => total + n, 0)
  const blocks = blueprint.blocks.length
  const redstone = sum(/^(hopper|observer|piston|sticky_piston|repeater|comparator|dropper|dispenser|redstone|redstone_torch|redstone_lamp|redstone_block|note_block|lever|tripwire_hook)$/)
  const rails = sum(/^(rail|powered_rail|detector_rail|activator_rail)$/)
  const crops = sum(/^(farmland|carrots|potatoes|wheat|beetroots|sugar_cane|pumpkin|melon|beehive|composter)$/)
  if (redstone >= 30 && redstone / blocks > 0.02) return 'redstone'
  if (rails >= 30 && rails / blocks > 0.02) return 'transport'
  if (crops >= 60 && crops / blocks > 0.05) return 'farm'
  const footprint = Math.max(1, blueprint.size.x * blueprint.size.z)
  const slenderness = blueprint.size.y / Math.sqrt(footprint)
  if (slenderness >= 2) return 'tower'
  if (blocks >= 3000) return 'mega'
  return 'house'
}

const sources = existsSync(SOURCE_HINT) ? JSON.parse(readFileSync(SOURCE_HINT, 'utf8')) : {}
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'sources.json') : []
const index = []
for (const file of files) {
  try {
    const blueprint = JSON.parse(readFileSync(path.join(DIR, file), 'utf8'))
    if (!Array.isArray(blueprint.blocks)) continue
    const name = file.replace(/\.json$/, '')
    index.push({
      name,
      title: blueprint.name || name,
      category: categorize(blueprint),
      size: blueprint.size,
      blocks: blueprint.blocks.length,
      format: blueprint.format || 'schem',
      materials: (blueprint.materials || []).slice(0, 12),
      materialKinds: (blueprint.materials || []).length,
      source: sources[name] || '',
    })
  } catch (_error) { void _error }
}
index.sort((a, b) => a.blocks - b.blocks)
writeFileSync(path.join(DIR, 'index.json'), JSON.stringify({ generatedAt: Date.now(), count: index.length, items: index }, null, 2) + '\n')

const lines = ['# 蓝图索引', '', `共 ${index.length} 张。按方块数从小到大。`, '']
for (const item of index) {
  lines.push(`## ${item.title}（${item.name}）`)
  lines.push(`- 类别：${item.category}`)
  lines.push(`- 尺寸：${item.size.x}×${item.size.y}×${item.size.z}，${item.blocks} 块`)
  lines.push(`- 格式：${item.format}${item.source ? `　来源：${item.source}` : ''}`)
  lines.push(`- 主材：${item.materials.slice(0, 6).map((m) => `${m.name}×${m.count}`).join('、')}`)
  lines.push('')
}
const requestFile = path.join(DIR, 'requests.jsonl')
if (existsSync(requestFile)) {
  const requests = readFileSync(requestFile, 'utf8').trim().split('\n').filter(Boolean).slice(-20)
  if (requests.length > 0) {
    lines.push('## 她想要的蓝图', '')
    for (const line of requests) {
      try { const item = JSON.parse(line); lines.push(`- [${item.category || '未分类'}] ${item.need || ''}（${new Date(item.at).toLocaleString('zh-CN')}）`) } catch (_error) { void _error }
    }
    lines.push('')
  }
}
writeFileSync(path.join(DIR, 'INDEX.md'), lines.join('\n'))
console.log(`✓ 索引已生成：${index.length} 张蓝图`)
for (const item of index) console.log(`  ${item.name.padEnd(20)} ${item.category.padEnd(9)} ${String(item.blocks).padStart(6)} 块  ${item.size.x}×${item.size.y}×${item.size.z}`)
