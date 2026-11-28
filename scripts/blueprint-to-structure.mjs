#!/usr/bin/env node
// 把蓝图 JSON 写成 Minecraft 结构模板（.nbt），放到世界目录后用 /place template 一次放置。
// 好处：方块状态（楼梯朝向、门、栅栏连接）原样保留，且一条命令放整栋。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

// —— 最小 NBT 写入器 ——
const TAG = { Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6, String: 8, List: 9, Compound: 10 }
function str(value) { const body = Buffer.from(String(value), 'utf8'); const head = Buffer.alloc(2); head.writeUInt16BE(body.length); return Buffer.concat([head, body]) }
function named(type, name, payload) { return Buffer.concat([Buffer.from([type]), str(name), payload]) }
const nInt = (name, v) => named(TAG.Int, name, int(v))
const nStr = (name, v) => named(TAG.String, name, str(v))
function int(v) { const b = Buffer.alloc(4); b.writeInt32BE(v | 0); return b }
function compound(children) { return Buffer.concat([...children, Buffer.from([0])]) }
function listOf(type, items) { const head = Buffer.alloc(5); head[0] = type; head.writeInt32BE(items.length, 1); return Buffer.concat([head, ...items]) }
function intArray(name, values) { return named(TAG.List, name, listOf(TAG.Int, values.map((v) => int(v)))) }
function compoundList(name, compounds) { return named(TAG.List, name, listOf(TAG.Compound, compounds)) }

/** 蓝图 → 结构 NBT 字节。 */
export function blueprintToStructureNbt(blueprint) {
  const palette = []
  const paletteIndex = new Map()
  const paletteCompounds = []
  const blocks 	= []
  const addState = (entry) => {
    const name = 'minecraft:' + entry.name
    const props = entry.properties && Object.keys(entry.properties).length > 0 ? entry.properties : null
    const key = props ? `${name}${JSON.stringify(props)}` : name
    if (paletteIndex.has(key)) return paletteIndex.get(key)
    const idx = palette.length
    paletteIndex.set(key, idx)
    palette.push({ name, props })
    const children = [nStr('Name', name)]
    if (props) children.push(named(TAG.Compound, 'Properties', compound(Object.entries(props).map(([k, v]) => nStr(k, String(v))))))
    paletteCompounds.push(compound(children))
    return idx
  }
  for (const block of blueprint.blocks) {
    const state = addState(block)
    const pos = [block.x, block.y, block.z]
    blocks.push(compound([nInt('state', state), intArray('pos', pos)]))
  }
  const root = compound([
    intArray('size', [blueprint.size.x, blueprint.size.y, blueprint.size.z]),
    compoundList('palette', paletteCompounds),
    compoundList('blocks', blocks),
    named(TAG.List, 'entities', listOf(TAG.Compound, [])),
    nInt('DataVersion', 3955),
  ])
  const rootNamed = Buffer.concat([Buffer.from([TAG.Compound]), str(''), root])
  return gzipSync(rootNamed)
}

const args = process.argv.slice(2)
const [blueprintPath, structuresDir, outName] = args
if (!blueprintPath || !structuresDir) {
  console.log('用法: node scripts/blueprint-to-structure.mjs <蓝图.json> <世界 structures 目录> [结构名]')
  process.exit(1)
}
const blueprint = JSON.parse(readFileSync(blueprintPath, 'utf8'))
const name = (outName || path.basename(blueprintPath, '.json')).replace(/[^a-z0-9_-]/gi, '_').toLowerCase()
mkdirSync(structuresDir, { recursive: true })
const target = path.join(structuresDir, `${name}.nbt`)
writeFileSync(target, blueprintToStructureNbt(blueprint))
console.log(`✓ ${name}.nbt  ${blueprint.size.x}×${blueprint.size.y}×${blueprint.size.z}  ${blueprint.blocks.length} 块  → ${target}`)
