#!/usr/bin/env node
// 查看小鲸鱼想要的蓝图（她 mc_build action=request 时写入）；--clear 清空已处理的。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const file = path.join(homedir(), '.dsh', '.dsh-poetry', 'blueprints', 'requests.jsonl')
const clear = process.argv.includes('--clear')
if (!existsSync(file)) { console.log('她还没有提过蓝图需求'); process.exit(0) }
const items = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
if (items.length === 0) { console.log('没有待处理的请求'); process.exit(0) }
console.log(`共 ${items.length} 条蓝图需求：`)
for (const item of items) console.log(`- [${item.category || '未分类'}] ${item.need}  （${new Date(item.at).toLocaleString('zh-CN')}）`)
if (clear) { writeFileSync(file, ''); console.log('已清空') }
