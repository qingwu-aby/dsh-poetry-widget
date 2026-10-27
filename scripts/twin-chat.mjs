// scripts/twin-chat.mjs —— 在终端查看两只小鲸鱼的信件。
// 用法：npm run twin:chat -- [数量]   默认 20 封。
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const limit = Math.max(1, Math.min(500, Number(process.argv[2]) || 20))
const file = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.dsh-poetry', 'twin-bridge', 'letters.jsonl')
if (!existsSync(file)) {
  console.log('还没有信件：' + file)
  process.exit(0)
}
const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })
  .filter(Boolean)
  .slice(-limit)

for (const message of rows) {
  const time = new Date(message.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  const from = message.from === 'twin' ? '镜像' : '原体'
  const to = message.to === 'twin' ? '镜像' : '原体'
  const kind = message.kind === 'research' ? '研究' : message.kind === 'reply' ? '回信' : '信'
  console.log(`\n[${time}] ${from} -> ${to}（${kind}）`)
  console.log(message.text)
}
console.log(`\n共显示 ${rows.length} 封 / ${file}`)
