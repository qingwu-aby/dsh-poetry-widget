#!/usr/bin/env node
// 把 zh.minecraft.wiki 的教程页面蒸馏成本地知识（一次性抓取，之后离线可查）。
// 用法：node scripts/ingest-wiki-tutorials.mjs [输出路径]
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const OUT = process.argv[2] || path.join(homedir(), '.dsh', '.dsh-poetry', 'wiki-tutorials.json')
const API = 'https://zh.minecraft.wiki/api.php'

const PAGES = [
  ['如何造房子', ['建造', '房子', '小屋', '盖房', '庇护所', '墙', '屋顶']],
  ['庇护所', ['庇护所', '过夜', '第一晚', '安全屋']],
  ['建造微型庇护所', ['微型庇护所', '火柴盒', '小房子']],
  ['房屋类型', ['房屋设计', '房子样式', '好看']],
  ['屋顶建造指南', ['屋顶', '房顶']],
  ['挖矿技巧', ['挖矿', '矿洞', '下矿']],
  ['在一个地区中长期生存下去', ['长期生存', '据点', '基地']],
  ['农作物种植', ['种植', '农', '食物来源']],
]

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`
  const res = await fetch(url, { headers: { 'user-agent': 'dsh-little-whale/1.0 (plugin knowledge ingest)' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

const HTML_ENTITIES = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'" }

function plain(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (match, code) => HTML_ENTITIES[code] ?? ' ')
    .replace(/\[\s*编辑[^\]]*\]?/g, ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
}

/** 按 h2/h3 切段，只保留成句的要点（去掉目录、表格、导航、编辑链接）。 */
function distill(html) {
  const cleaned = String(html)
    .replace(/<div[^>]*class="[^"]*(toc|navbox|infobox|mbox|ambox|hatnote|thumb)[^"]*"[\s\S]*?<\/div>/gi, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
  const parts = cleaned.split(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/i)
  const sections = []
  for (let i = 1; i < parts.length - 1; i += 3) {
    const heading = plain(parts[i + 1]).replace(/\s+/g, ' ').trim().slice(0, 30)
    const body = plain(parts[i + 2])
    const bullets = body
      .split(/(?<=[。！？])/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 10 && line.length <= 130)
      .slice(0, 6)
    if (heading.length > 0 && bullets.length > 0) sections.push({ heading, bullets })
    if (sections.length >= 14) break
  }
  return sections
}

const out = { version: 2, fetchedAt: Date.now(), source: 'zh.minecraft.wiki/api.php', pages: [] }
for (const [title, topics] of PAGES) {
  const page = `教程/${title}`
  try {
    const data = await api({ action: 'parse', page, prop: 'text', redirects: '1' })
    const html = data && data.parse && data.parse.text ? data.parse.text : ''
    const sections = distill(html)
    out.pages.push({ title, page, topics, sections })
    const bullets = sections.reduce((sum, section) => sum + section.bullets.length, 0)
    console.log(`✓ ${page}: ${sections.length} 段 / ${bullets} 条要点`)
  } catch (error) {
    console.log(`✗ ${page}: ${error instanceof Error ? error.message : String(error)}`)
  }
  await new Promise((r) => setTimeout(r, 500))
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`已写入 ${OUT}（${out.pages.length} 页）`)
