#!/usr/bin/env node
/**
 * 从全量 chinese-poetry 语料构建「飞花令校验库」：
 *   _ref/feihua-full/<令字>.json = { char, count, entries: [[句子, 出处], ...] }
 *   _ref/feihua-full/manifest.json
 *
 * 只覆盖候选令字（FEIHUA_CHARS），诗句按 。！？ 切完整句、去重后按令字分片；
 * 繁体 → 简体（opencc-js t2s）。产物不随插件包发布（位于 _ref/，由宿主路由按需读取）。
 *
 * 用法：
 *   node scripts/build-feihua-full.mjs                       # 全量（全唐诗/宋诗/宋词/蒙学）
 *   node scripts/build-feihua-full.mjs --chars 花 --limit 20 # 抽样
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as OpenCC from 'opencc-js'

const ROOT = path.resolve(import.meta.dirname, '..')
const CHARS = Array.from('花月风春山水人天云雨夜秋江酒白红舟愁梦心柳雪霜日星海玉金长何不无')
const argv = process.argv.slice(2)
function arg(name, fallback) {
  const index = argv.indexOf('--' + name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const SRC = path.resolve(arg('src', path.join(ROOT, '..', '_ref', 'poetry-source', 'b8594f81a897')))
const OUT = path.resolve(arg('out', path.join(ROOT, '..', '_ref', 'feihua-full')))
const chars = arg('chars', '') ? Array.from(arg('chars', '')) : CHARS
const limit = Number(arg('limit', '0')) || 0
const toCn = OpenCC.Converter({ from: 't', to: 'cn' })

const PUNCT = /[，。！？；、：,.!?;:\s「」『』《》“”"'·]/g
const plain = (value) => String(value || '').replace(PUNCT, '')

/** 收集语料文件：全唐诗（含 poet.song 宋诗）、宋词、蒙学。rank/strains 是重复的排序/整理版，跳过。 */
async function collectFiles() {
  const files = []
  const push = async (dir, filter) => {
    let names = []
    try { names = await readdir(dir) } catch { return }
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue
      if (name.startsWith('author') || name === 'error' || name.startsWith('README')) continue
      if (filter && !filter(name)) continue
      files.push(path.join(dir, name))
    }
  }
  await push(path.join(SRC, '全唐诗'))
  await push(path.join(SRC, '宋词'))
  await push(path.join(SRC, '蒙学'))
  return limit > 0 ? files.slice(0, limit) : files
}

function sentencesOf(item) {
  if (!item || !Array.isArray(item.paragraphs) || !item.paragraphs.length) return []
  const text = toCn(item.paragraphs.join(''))
  const out = []
  const re = /[^。！？]+[。！？]?/g
  let match
  while ((match = re.exec(text)) !== null) {
    const sentence = match[0].trim()
    if (!sentence) continue
    const core = plain(sentence)
    if (core.length < 5) continue
    out.push(sentence)
  }
  return out
}

async function main() {
  const files = await collectFiles()
  console.log('[feihua-full] 语料文件 %d 个；令字 %d；输出 %s', files.length, chars.length, OUT)
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  const streams = new Map()
  const counts = {}
  const seen = {}
  const first = {}
  for (const char of chars) {
    counts[char] = 0
    first[char] = true
    seen[char] = new Set()
    streams.set(char, createWriteStream(path.join(OUT, char + '.json'), { encoding: 'utf8' }))
    streams.get(char).write('{"ok":true,"v":1,"char":' + JSON.stringify(char) + ',"entries":[')
  }
  let poems = 0
  let sentences = 0
  for (const file of files) {
    let data
    try { data = JSON.parse(await readFile(file, 'utf8')) } catch (error) {
      console.warn('[feihua-full] 跳过解析失败 %s: %s', path.basename(file), error.message)
      continue
    }
    if (!Array.isArray(data)) continue
    for (const item of data) {
      poems += 1
      const author = toCn(String(item && item.author || ''))
      const title = toCn(String(item && (item.title || item.rhythmic || '') ))
      const source = author && title ? author + '《' + title + '》' : (author || title)
      for (const sentence of sentencesOf(item)) {
        sentences += 1
        const core = plain(sentence)
        if (!core) continue
        for (const char of chars) {
          if (core.indexOf(char) < 0) continue
          const key = core
          if (seen[char].has(key)) continue
          seen[char].add(key)
          const line = (first[char] ? '' : ',') + JSON.stringify([sentence, source])
          first[char] = false
          streams.get(char).write(line)
          counts[char] += 1
        }
      }
    }
    if (poems % 20000 === 0) console.log('[feihua-full] 进度 poems=%d sentences=%d', poems, sentences)
  }
  for (const [char, stream] of streams) {
    await new Promise((resolve, reject) => {
      stream.write(']}')
      stream.end((error) => (error ? reject(error) : resolve()))
    })
  }
  const manifest = {
    ok: true,
    v: 1,
    builtAt: new Date().toISOString(),
    source: 'chinese-poetry@b8594f81a89752241442f2ce267d6f66f96704ee',
    files: files.length,
    poems,
    sentences,
    chars: {},
    total: 0,
  }
  for (const char of chars) {
    const file = path.join(OUT, char + '.json')
    let bytes = 0
    try { bytes = (await stat(file)).size } catch {}
    manifest.chars[char] = { count: counts[char], bytes }
    manifest.total += counts[char]
  }
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log('[feihua-full] 完成：poems=%d sentences=%d totalEntries=%d', poems, sentences, manifest.total)
  for (const char of chars) console.log('  %s: %d 句, %.1f MB', char, counts[char], manifest.chars[char].bytes / 1048576)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
