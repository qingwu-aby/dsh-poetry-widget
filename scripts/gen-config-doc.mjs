#!/usr/bin/env node
// 生成 docs/config.md（配置注册表单一来源：lib/kernel/config.mjs）
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describeConfig } from '../lib/kernel/config.mjs'

const rows = describeConfig()
const groups = [...new Set(rows.map((row) => row.group))]
const lines = [
  '# 配置注册表（自动生成）',
  '',
  '> 由 `scripts/gen-config-doc.mjs` 从 `lib/kernel/config.mjs` 生成，勿手改。',
  '',
]
for (const group of groups) {
  lines.push(`## ${group}`, '', '| 环境变量 | 类型 | 默认值 | 说明 |', '|---|---|---|---|')
  for (const row of rows.filter((item) => item.group === group)) {
    lines.push(`| \`${row.key}\` | ${row.type} | ${row.default} | ${row.doc} |`)
  }
  lines.push('')
}
const file = path.join(process.cwd(), 'docs', 'config.md')
writeFileSync(file, lines.join('\n'), 'utf8')
console.log(`已写入 ${file}（${rows.length} 项）`)
