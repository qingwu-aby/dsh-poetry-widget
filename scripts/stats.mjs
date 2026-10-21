#!/usr/bin/env node
/**
 * stats.mjs —— 数据产物统计报告（只读 data/，不构建）
 *
 * 用法：
 *   node scripts/stats.mjs            # 人类可读报告
 *   node scripts/stats.mjs --json     # 机器可读 JSON（供 Lead/CI 汇总）
 *   node scripts/stats.mjs --data <dir>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUDGETS, CI_TARGET, POEM_TARGET } from './build-data.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA = path.resolve(HERE, '..', 'data')

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function topEntries(counter, n = 10) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
}

function countBy(items, pick) {
  const counter = {}
  for (const item of items) {
    const key = pick(item)
    counter[key] = (counter[key] ?? 0) + 1
  }
  return counter
}

/** 汇总 data/ 下全部产物的统计信息。 */
export function collectStats(dataDir = DEFAULT_DATA) {
  const manifest = readJSON(path.join(dataDir, 'manifest.json'))
  const poems = readJSON(path.join(dataDir, 'poems.json')).items
  const ci = readJSON(path.join(dataDir, 'ci.json')).items
  const yun = readJSON(path.join(dataDir, 'yun.json')).volumes
  const knowledge = readJSON(path.join(dataDir, 'knowledge.json'))
  const bytes = {}
  for (const name of Object.keys(BUDGETS)) {
    bytes[name] = fs.statSync(path.join(dataDir, name)).size
  }
  bytes['manifest.json'] = fs.statSync(path.join(dataDir, 'manifest.json')).size

  const poemAuthors = {}
  const poemVariances = {}
  for (const poem of poems) {
    poemAuthors[poem.author] = (poemAuthors[poem.author] ?? 0) + 1
    const match = /含 (\d+) 处变格/.exec(poem.analysis ?? '')
    const variances = match ? Number(match[1]) : 0
    poemVariances[variances] = (poemVariances[variances] ?? 0) + 1
  }
  const ciAuthors = countBy(ci, (item) => item.author)
  const ciRhythmic = countBy(ci, (item) => item.rhythmic)

  return {
    dataVersion: manifest.dataVersion,
    builtAt: manifest.builtAt,
    source: manifest.source,
    counts: {
      poems: poems.length,
      ci: ci.length,
      yunChapters: yun.reduce((sum, volume) => sum + volume.chapters.length, 0),
      cards: knowledge.cards.length,
      ciCards: knowledge.ciCards.length,
    },
    targets: { poems: POEM_TARGET, ci: CI_TARGET },
    bytes,
    budget: BUDGETS,
    poems: {
      dynasty: countBy(poems, (item) => item.dynasty),
      forms: countBy(poems, (item) => item.form),
      meters: countBy(poems, (item) => item.meter),
      sources: countBy(poems, (item) => item.source),
      variances: poemVariances,
      topAuthors: topEntries(poemAuthors, 10),
      scoreRange: {
        min: Math.min(...poems.map((item) => item.score)),
        max: Math.max(...poems.map((item) => item.score)),
      },
    },
    ci: {
      topAuthors: topEntries(ciAuthors, 10),
      topRhythmic: topEntries(ciRhythmic, 10),
      withQuote: ci.filter((item) => item.quote).length,
      distinctAuthors: Object.keys(ciAuthors).length,
      distinctRhythmic: Object.keys(ciRhythmic).length,
    },
    manifestStats: manifest.stats,
  }
}

/** 人类可读报告。 */
export function formatStats(stats) {
  const lines = []
  lines.push(`dataVersion=${stats.dataVersion}  builtAt=${stats.builtAt}`)
  lines.push(`source=${stats.source.repo} @ ${stats.source.commit} (${stats.source.license})`)
  lines.push('')
  lines.push(
    `counts: poems=${stats.counts.poems} ci=${stats.counts.ci} yun=${stats.counts.yunChapters} cards=${stats.counts.cards} ciCards=${stats.counts.ciCards}`,
  )
  lines.push(`  targets: poems ${stats.targets.poems.min}–${stats.targets.poems.max} / ci ${stats.targets.ci.min}–${stats.targets.ci.max}`)
  lines.push('')
  lines.push('files:')
  for (const [name, bytes] of Object.entries(stats.bytes)) {
    const budget = stats.budget[name]
    const suffix = budget ? `  预算 ${formatBytes(budget)}（${((bytes / budget) * 100).toFixed(1)}%）` : ''
    lines.push(`  ${name.padEnd(16)} ${formatBytes(bytes).padStart(10)}${suffix}`)
  }
  lines.push('')
  lines.push(`诗：朝代 ${JSON.stringify(stats.poems.dynasty)}`)
  lines.push(`    诗体 ${JSON.stringify(stats.poems.forms)}`)
  lines.push(`    格式 ${JSON.stringify(stats.poems.meters)}`)
  lines.push(`    来源 ${JSON.stringify(stats.poems.sources)}  变格分布 ${JSON.stringify(stats.poems.variances)}`)
  lines.push(`    top10 作者：${stats.poems.topAuthors.map(([name, count]) => `${name}×${count}`).join('、')}`)
  lines.push(`    score 范围：${stats.poems.scoreRange.min} ~ ${stats.poems.scoreRange.max}`)
  lines.push('')
  lines.push(
    `词：${stats.ci.distinctAuthors} 位作者 / ${stats.ci.distinctRhythmic} 个词牌；名句覆盖 ${stats.ci.withQuote}/${stats.counts.ci}`,
  )
  lines.push(`    top10 作者：${stats.ci.topAuthors.map(([name, count]) => `${name}×${count}`).join('、')}`)
  lines.push(`    top10 词牌：${stats.ci.topRhythmic.map(([name, count]) => `${name}×${count}`).join('、')}`)
  const m = stats.manifestStats ?? {}
  lines.push('')
  lines.push(`构建统计（manifest.stats）：`)
  lines.push(
    `  curated 诗 refs=${m.curatedPoemRefs} 命中=${m.curatedPoemMatched} 补足=${m.poemFilled}` +
      `（全串命中 ${m.curatedFullTextMatched} / 兜底 ${m.curatedFallbackMatched} / 黑名单 ${m.curatedBlacklisted} / 作者修正 ${m.curatedAuthorFixed}）；` +
      `词 refs=${m.curatedCiRefs} 入选=${m.curatedCiMatched}（源 ${m.curatedCiSource}）`,
  )
  lines.push(
    `  词正文：语料命中 ${m.ciCorpusMatched} / 替换选集缺字 ${m.ciCorpusReplaced} / 回退选集 ${m.ciCorpusFallback}；` +
      `词牌拆分 ${m.ciRhythmicSplit} / 作者修正 ${m.ciAuthorFixed} / 补名篇 ${m.ciAppended} + 卡位补 ${m.ciCardFill}`,
  )
  lines.push(`  简体残留：${m.simplifiedResidual} 种 / ${m.simplifiedResidualOccurrences} 次（目标 0）；生僻字过滤：${m.droppedPoem?.astralChars ?? 0} 首`)
  lines.push(
    `  押韵门：校验 ${m.rhymeChecked} / 通过 ${m.rhymePassed} / 丢弃 ${m.rhymeDropped} / 合法借邻韵 ${m.rhymeFirstBorrowOk}` +
      `；明细 ${JSON.stringify(m.rhymeDroppedByReason ?? {})}`,
  )
  if (m.droppedPoem) {
    const drops = Object.entries(m.droppedPoem).sort((a, b) => b[1] - a[1])
    lines.push(`  诗丢弃：${drops.map(([reason, count]) => `${reason}=${count}`).join(' ')}`)
  }
  lines.push(`  构建耗时：${(m.durationMs ?? 0) / 1000}s（smoke=${m.smoke}）`)
  return lines.join('\n')
}

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--data') opts.dataDir = argv[++i]
    else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return opts
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.help) {
      console.log('用法：node scripts/stats.mjs [--json] [--data <dir>]')
      process.exit(0)
    }
    const stats = collectStats(path.resolve(opts.dataDir ?? DEFAULT_DATA))
    if (opts.json) console.log(JSON.stringify(stats, null, 2))
    else console.log(formatStats(stats))
  } catch (error) {
    console.error(`[stats] 失败：${error?.stack ?? error}`)
    process.exitCode = 1
  }
}
