#!/usr/bin/env node
// 从 ~/.dsh/.credentials.yaml 读取 OPENCODE_GO_API_KEY（兼容扁平值与 refs 嵌套结构）。
// 用法：node read-key.mjs <credentials.yaml>  → stdout 输出 key（找不到则空）。
import { readFileSync } from 'node:fs'

const file = process.argv[2]
let text = ''
try {
  text = readFileSync(file, 'utf8')
} catch {
  process.exit(0)
}
const lines = text.split(/\r?\n/)
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]
  const at = line.indexOf('OPENCODE_GO_API_KEY')
  if (at < 0) continue
  const tail = line.slice(at + 'OPENCODE_GO_API_KEY'.length)
  const inline = tail.match(/["']?([A-Za-z0-9_-]{16,})["']?/)
  if (inline) {
    console.log(inline[1])
    process.exit(0)
  }
  for (const next of lines.slice(i + 1, i + 8)) {
    if (!/(value|token|secret|key)\s*:/i.test(next)) continue
    const match = next.match(/["']?([A-Za-z0-9_-]{16,})["']?/)
    if (match) {
      console.log(match[1])
      process.exit(0)
    }
  }
}
