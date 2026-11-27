#!/usr/bin/env node
// 把网上的 .schem 建筑导入成她可施工的蓝图。
// 用法：
//   node scripts/import-schematic.mjs <url 或本地文件> [蓝图名]
//   node scripts/import-schematic.mjs --page <建筑页面 URL> [蓝图名]   （自动找页面里的 .schem 链接）
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { litematicToBlueprint, parseSchematicBytes, schematicToBlueprint } from '../lib/domain/play/minecraft-schematic.mjs'

const OUT_DIR = path.join(homedir(), '.dsh', '.dsh-poetry', 'blueprints')
const UA = 'dsh-little-whale/1.0 (schematic import)'

async function fetchBytes(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

function findSchemLink(html, pageUrl) {
  const match = html.match(/[A-Za-z0-9_./-]+\.schem/)
  if (!match) return null
  const rel = match[0]
  if (/^https?:/.test(rel)) return rel
  const base = new URL(pageUrl)
  return new URL(rel.startsWith('/') ? rel : `/${rel}`, base.origin).toString()
}

const args = process.argv.slice(2)
if (args[0] === '--dir') {
  const dir = args[1]
  if (!dir) { console.log('用法：node scripts/import-schematic.mjs --dir <目录>'); process.exit(1) }
  const { readdirSync } = await import('node:fs')
  const files = readdirSync(dir).filter((f) => /\.(schem|litematic)$/i.test(f))
  if (files.length === 0) { console.log('目录里没有 .schem / .litematic'); process.exit(2) }
  for (const file of files) {
    const full = path.join(dir, file)
    const name = file.replace(/\.(schem|litematic)$/i, '')
    try {
      const buffer = readFileSync(full)
      const parsed = parseSchematicBytes(buffer)
      const blueprint = parsed && parsed.Regions ? litematicToBlueprint(parsed, name) : schematicToBlueprint(parsed, name)
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(path.join(OUT_DIR, `${blueprint.name}.json`), JSON.stringify(blueprint, null, 2) + '\n')
      console.log(`✓ ${file} → ${blueprint.name}（${blueprint.size.x}×${blueprint.size.y}×${blueprint.size.z}，${blueprint.blocks.length} 块）`)
    } catch (error) {
      console.log(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  process.exit(0)
}
const pageMode = args[0] === '--page'
const source = pageMode ? args[1] : args[0]
const nameArg = pageMode ? args[2] : args[1]
if (!source) {
  console.log('用法：node scripts/import-schematic.mjs <url|文件> [名字]')
  process.exit(1)
}

let bytes
let name = nameArg || ''
if (existsSync(source)) {
  bytes = readFileSync(source)
  if (!name) name = path.basename(source, path.extname(source))
} else if (pageMode) {
  const res = await fetch(source, { headers: { 'user-agent': UA } })
  const html = await res.text()
  const link = findSchemLink(html, source)
  if (!link) { console.log('页面上没找到 .schem 链接'); process.exit(2) }
  console.log('找到蓝图文件:', link)
  bytes = await fetchBytes(link)
  if (!name) name = decodeURIComponent(link.split('/').pop().replace(/\.schem$/i, ''))
} else {
  bytes = await fetchBytes(source)
  if (!name) name = decodeURIComponent(source.split('/').pop().replace(/\.schem$/i, ''))
}

name = name.replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 24) || '蓝图'
const parsed = parseSchematicBytes(bytes)
const blueprint = parsed && parsed.Regions ? litematicToBlueprint(parsed, name) : schematicToBlueprint(parsed, name)
mkdirSync(OUT_DIR, { recursive: true })
const file = path.join(OUT_DIR, `${name}.json`)
writeFileSync(file, JSON.stringify(blueprint, null, 2) + '\n')

console.log(`✓ 导入蓝图「${name}」`)
console.log(`  尺寸 ${blueprint.size.x}×${blueprint.size.y}×${blueprint.size.z}，方块 ${blueprint.blocks.length}`)
console.log('  主要材料:', blueprint.materials.slice(0, 8).map((m) => `${m.name}×${m.count}`).join('、'))
console.log('  保存到:', file)
