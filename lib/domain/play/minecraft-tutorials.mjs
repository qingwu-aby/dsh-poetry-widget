// @ts-check
// 教程知识（由 scripts/ingest-wiki-tutorials.mjs 从 zh.minecraft.wiki 抓取并蒸馏，落盘后可离线查）。
import { readFileSync, statSync } from 'node:fs'

let cache = { key: '', data: null }

/** 读取本地教程缓存（按 mtime 缓存，文件不在就返回 null）。 */
export function loadTutorials(file) {
  if (typeof file !== 'string' || file.length === 0) return null
  let key = ''
  try {
    const stat = statSync(file)
    key = `${file}:${stat.mtimeMs}:${stat.size}`
  } catch (_error) {
    return null
  }
  if (cache.key === key) return cache.data
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    cache = { key, data }
    return data
  } catch (_error) {
    return null
  }
}

/** 按主题匹配教程页；返回 method + steps，匹配不到返回 null。 */
export function lookupTutorial(topic, data) {
  const text = String(topic ?? '').toLowerCase()
  if (text.length === 0 || data === null || !Array.isArray(data.pages)) return null
  let best = null
  let bestScore = 0
  for (const page of data.pages) {
    let score = 0
    if (text.includes(String(page.title || '').toLowerCase())) score += 6
    for (const keyword of Array.isArray(page.topics) ? page.topics : []) {
      const k = String(keyword).toLowerCase()
      if (text.includes(k)) score += k.length
    }
    if (score > bestScore) { best = page; bestScore = score }
  }
  if (best === null || bestScore < 2) return null
  const sections = Array.isArray(best.sections) ? best.sections : []
  const steps = []
  for (const section of sections.slice(0, 4)) {
    for (const bullet of (Array.isArray(section.bullets) ? section.bullets : []).slice(0, 2)) {
      steps.push(`${section.heading}：${bullet}`)
    }
  }
  if (steps.length === 0) return null
  return {
    method: `《${best.title}》（wiki 教程，已沉淀）：${String(sections[0] && sections[0].bullets && sections[0].bullets[0] ? sections[0].bullets[0] : '').slice(0, 80)}`,
    steps: steps.slice(0, 8),
    caveat: '来自 zh.minecraft.wiki 教程页（本地沉淀，无需联网）',
    source: 'tutorial',
    title: best.title,
    url: `https://zh.minecraft.wiki/w/${encodeURIComponent(String(best.page || best.title))}`,
  }
}
