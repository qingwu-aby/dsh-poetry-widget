#!/usr/bin/env node
/**
 * fetch-data.mjs —— 解析/物化 chinese-poetry 源数据（构建期用，不随插件发布）
 *
 * 设计目标：**离线优先、本地化、可复现**。源解析顺序（`--source` → `data-src/` →
 * `_ref/poetry-source/<commit>/` → 系统临时物化目录 → 网络）：
 *   1) `--source <dir>` / 环境变量 `POETRY_DATA_DIR`：显式指定的已物化源树；
 *   2) 项目内 `data-src/`：curated 源快照（唐诗三百首/宋词三百首/千家诗/声律启蒙/诗经/楚辞…），
 *      随项目保留、离线可用；curated 文件优先从这里读；
 *   3) 项目同级 `_ref/poetry-source/<commit>/`：完整语料缓存（329MB，不随包）；
 *   4) 系统临时目录旧物化缓存（历史兼容，可被 `--force` 迁移走）；
 *   5) 网络物化：`git -C _ref/poetry-data archive …`（`--offline` 时禁止）。
 *
 * 用法：
 *   node scripts/fetch-data.mjs                 # 解析源并打印路径/文件计数/curated 状态
 *   node scripts/fetch-data.mjs --offline       # 只允许本地源；离线验证（curated 必须齐全）
 *   node scripts/fetch-data.mjs --source <dir>  # 直接指定已物化的完整源树
 *   node scripts/fetch-data.mjs --force         # 丢弃旧缓存，重新从 _ref git 物化
 *   node scripts/fetch-data.mjs --ref <dir>     # 指定 chinese-poetry git 仓库（默认 ../_ref/poetry-data）
 *
 * 源数据只读：本脚本不改写 `_ref/poetry-data`；完整语料缓存落在 `_ref/poetry-source/`（项目外、不随包）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------------ *
 * 源数据元信息（与 docs/contract.md、data/manifest.json 对齐）
 * ------------------------------------------------------------------ */
export const SOURCE = {
  repo: 'chinese-poetry/chinese-poetry',
  commit: 'b8594f81a89752241442f2ce267d6f66f96704ee',
  license: 'MIT',
  commitDate: '2026-06-17',
  url: 'https://github.com/chinese-poetry/chinese-poetry',
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 项目根目录（scripts 的上一级）。 */
export const PROJECT_ROOT = path.resolve(HERE, '..')
/** 默认本地 git 仓库：<工作区>/_ref/poetry-data（与项目目录同级）。 */
export const DEFAULT_REF = path.resolve(PROJECT_ROOT, '..', '_ref', 'poetry-data')
/**
 * 完整语料本地缓存（项目同级 `_ref/poetry-source/<commit前12位>/`，329MB，不随包）。
 * 可用 `--cache` 覆盖；历史版本位于系统临时目录，作为兼容候选。
 */
export const CACHE_ROOT = path.resolve(PROJECT_ROOT, '..', '_ref', 'poetry-source')
export const DEFAULT_CACHE = path.join(CACHE_ROOT, SOURCE.commit.slice(0, 12))
/** 历史缓存位置（系统临时目录），仅作兼容候选，新物化一律写 DEFAULT_CACHE。 */
export const LEGACY_DEFAULT_CACHE = path.join(os.tmpdir(), 'dsh-poetry-source', SOURCE.commit.slice(0, 12))

/** 项目内 curated 源快照目录（随包、离线可用）。 */
export const DATA_SRC_DIR = path.join(PROJECT_ROOT, 'data-src')

/**
 * 构建真正需要的 curated 源文件：
 * - 首选 data-src/（本地快照），缺失时回退完整语料的对应相对路径；
 * - `full` 为完整语料里的相对路径，`dataSrc` 为 data-src 内相对路径。
 */
export const CURATED_FILES = {
  tangshisanbaishou: { full: '全唐诗/唐诗三百首.json', dataSrc: '全唐诗/唐诗三百首.json', label: '唐诗三百首' },
  songci300: { full: '宋词/宋词三百首.json', dataSrc: '宋词/宋词三百首.json', label: '宋词三百首' },
  qianjiashi: { full: '蒙学/qianjiashi.json', dataSrc: '蒙学/qianjiashi.json', label: '千家诗' },
  shenglvqimeng: { full: '蒙学/shenglvqimeng.json', dataSrc: '蒙学/shenglvqimeng.json', label: '声律启蒙' },
  tangshisanbaishouMengxue: {
    full: '蒙学/tangshisanbaishou.json',
    dataSrc: '蒙学/tangshisanbaishou.json',
    label: '唐诗三百首（蒙学版）',
  },
  shijing: { full: '诗经/shijing.json', dataSrc: '诗经/shijing.json', label: '诗经' },
  chuci: { full: '楚辞/chuci.json', dataSrc: '楚辞/chuci.json', label: '楚辞' },
}

/** 需要物化的顶层目录（相对仓库根）。rank 目录同时含 rank/poet 与 rank/ci。 */
const ARCHIVE_DIRS = ['全唐诗', 'strains', 'rank', '宋词', '蒙学']

/** 各类文件数量（用于完整性校验；数字为 chunk 个数）。 */
export const EXPECTED_COUNTS = {
  tang: 58, // 全唐诗/poet.tang.<n>.json
  song: 255, // 全唐诗/poet.song.<n>.json
  strains: 313, // strains/json/poet.{tang,song}.<n>.json
  rankPoet: 313, // rank/poet/poet.{tang,song}.rank.<n>.json
  ci: 22, // 宋词/ci.song.<n>.json（不含 ci.song.2019y.json）
  rankCi: 22, // rank/ci/ci.song.rank.<n>.json（不含 2019y）
}

/* ------------------------------------------------------------------ *
 * 目录扫描与完整性校验
 * ------------------------------------------------------------------ */

const CHUNK_RE = {
  tang: /^poet\.tang\.(\d+)\.json$/,
  song: /^poet\.song\.(\d+)\.json$/,
  strainsTang: /^poet\.tang\.(\d+)\.json$/,
  strainsSong: /^poet\.song\.(\d+)\.json$/,
  rankTang: /^poet\.tang\.rank\.(\d+)\.json$/,
  rankSong: /^poet\.song\.rank\.(\d+)\.json$/,
  ci: /^ci\.song\.(\d+)\.json$/,
  rankCi: /^ci\.song\.rank\.(\d+)\.json$/,
}

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * 列出某个目录下形如 `<prefix>.<n>.json` 的 chunk 文件，按 n 数字升序。
 * @returns {{ start: number, file: string, path: string }[]}
 */
export function listChunks(dir, regex) {
  const out = []
  for (const ent of readDirSafe(dir)) {
    if (!ent.isFile()) continue
    const m = ent.name.match(regex)
    if (!m) continue
    out.push({ start: Number(m[1]), file: ent.name, path: path.join(dir, ent.name) })
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

/** 源树里的所有 chunk 列表（供 build-data.mjs 使用）。 */
export function scanSource(root) {
  const dirs = {
    tang: path.join(root, '全唐诗'),
    strains: path.join(root, 'strains', 'json'),
    rankPoet: path.join(root, 'rank', 'poet'),
    ci: path.join(root, '宋词'),
    rankCi: path.join(root, 'rank', 'ci'),
    mengxue: path.join(root, '蒙学'),
  }
  return {
    root,
    dirs,
    tang: listChunks(dirs.tang, CHUNK_RE.tang),
    song: listChunks(dirs.tang, CHUNK_RE.song),
    strainsTang: listChunks(dirs.strains, CHUNK_RE.strainsTang),
    strainsSong: listChunks(dirs.strains, CHUNK_RE.strainsSong),
    rankTang: listChunks(dirs.rankPoet, CHUNK_RE.rankTang),
    rankSong: listChunks(dirs.rankPoet, CHUNK_RE.rankSong),
    ci: listChunks(dirs.ci, CHUNK_RE.ci),
    rankCi: listChunks(dirs.rankCi, CHUNK_RE.rankCi),
    mengxueFiles: {
      shenglvqimeng: path.join(dirs.mengxue, 'shenglvqimeng.json'),
      tangshisanbaishou: path.join(dirs.mengxue, 'tangshisanbaishou.json'),
      qianjiashi: path.join(dirs.mengxue, 'qianjiashi.json'),
    },
  }
}

/**
 * 校验一个目录是否是「完整可用」的源树。
 * @returns {{ ok: boolean, missing: string[], counts?: object }}
 */
export function checkSource(root) {
  const missing = []
  if (!root || !fs.existsSync(root)) return { ok: false, missing: ['<目录不存在>'] }
  const s = scanSource(root)
  const checks = [
    ['tang', s.tang.length, EXPECTED_COUNTS.tang],
    ['song', s.song.length, EXPECTED_COUNTS.song],
    ['strains(tang+song)', s.strainsTang.length + s.strainsSong.length, EXPECTED_COUNTS.strains],
    ['rank/poet', s.rankTang.length + s.rankSong.length, EXPECTED_COUNTS.rankPoet],
    ['ci', s.ci.length, EXPECTED_COUNTS.ci],
    ['rank/ci', s.rankCi.length, EXPECTED_COUNTS.rankCi],
  ]
  for (const [name, got, want] of checks) {
    if (got !== want) missing.push(`${name}: ${got}/${want}`)
  }
  for (const [name, file] of Object.entries(s.mengxueFiles)) {
    if (!fs.existsSync(file)) missing.push(`蒙学/${name}`)
  }
  const counts = {
    tang: s.tang.length,
    song: s.song.length,
    strains: s.strainsTang.length + s.strainsSong.length,
    rankPoet: s.rankTang.length + s.rankSong.length,
    ci: s.ci.length,
    rankCi: s.rankCi.length,
  }
  return { ok: missing.length === 0, missing, counts }
}

/* ------------------------------------------------------------------ *
 * 从本地 git 仓库物化源树（一次性 archive，不逐个 show）
 * ------------------------------------------------------------------ */

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: child.stdout })
      else reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}\n${stderr.trim()}`))
    })
    if (opts.collectStdout) {
      let out = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.on('close', () => resolve({ stdout: out }))
    }
  })
}

async function gitHead(ref) {
  const child = spawn('git', ['-C', ref, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => (out += d.toString()))
  const code = await new Promise((resolve) => child.on('close', resolve))
  return code === 0 ? out.trim() : null
}

/**
 * 用 `git archive | tar` 把需要的目录物化到 cacheDir。
 * @param {string} ref    本地 git 仓库路径
 * @param {string} cacheDir 目标目录
 * @param {{ log?: (msg: string) => void }} [opts]
 */
export async function materializeSource(ref, cacheDir, opts = {}) {
  const log = opts.log ?? (() => {})
  if (!fs.existsSync(path.join(ref, '.git'))) {
    throw new Error(
      `找不到本地 git 仓库：${ref}\n` +
        '请先准备 `_ref/poetry-data`（blobless clone），或用 --src 指定已物化的源树：\n' +
        '  git clone --filter=blob:none --no-checkout https://github.com/chinese-poetry/chinese-poetry.git _ref/poetry-data',
    )
  }
  const head = await gitHead(ref)
  if (head && head !== SOURCE.commit) {
    log(`⚠ 本地仓库 HEAD=${head}，与契约记录的源 commit=${SOURCE.commit} 不一致；构建结果可能与契约示例不同。`)
  }
  fs.mkdirSync(cacheDir, { recursive: true })
  log(`物化源数据：${ref} → ${cacheDir}（目录：${ARCHIVE_DIRS.join('、')}）`)

  await new Promise((resolve, reject) => {
    const git = spawn('git', ['-C', ref, 'archive', '--format=tar', 'HEAD', '--', ...ARCHIVE_DIRS], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tar = spawn('tar', ['-xf', '-', '-C', cacheDir], { stdio: ['pipe', 'ignore', 'pipe'] })
    let err = ''
    git.stderr.on('data', (d) => (err += d.toString()))
    tar.stderr.on('data', (d) => (err += d.toString()))
    git.stdout.pipe(tar.stdin)
    git.on('error', reject)
    tar.on('error', reject)
    let gitCode = null
    let tarCode = null
    const done = () => {
      if (gitCode === null || tarCode === null) return
      if (gitCode === 0 && tarCode === 0) resolve()
      else reject(new Error(`物化失败（git=${gitCode} tar=${tarCode}）\n${err.trim()}`))
    }
    git.on('close', (code) => {
      gitCode = code
      done()
    })
    tar.on('close', (code) => {
      tarCode = code
      done()
    })
  })

  const marker = {
    repo: SOURCE.repo,
    commit: head ?? SOURCE.commit,
    license: SOURCE.license,
    dirs: ARCHIVE_DIRS,
    materializedAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(cacheDir, '.source.json'), JSON.stringify(marker, null, 2) + '\n')
  const check = checkSource(cacheDir)
  if (!check.ok) throw new Error(`物化后完整性校验失败：${check.missing.join('; ')}`)
}

/* ------------------------------------------------------------------ *
 * 解析源路径（build-data.mjs 的入口）
 * ------------------------------------------------------------------ */

/**
 * 解析构建真正需要的 curated 源文件（带本地优先级）。
 * 顺序：data-src/（项目内快照） → 完整语料同级路径。
 * @param {{ fullDir?: string, dataSrcDir?: string, offline?: boolean, log?: Function }} [opts]
 * @returns {{ files: Record<string, { path: string, from: string }>, missing: { key: string, label: string }[], complete: boolean }}
 */
export function resolveCuratedFiles(opts = {}) {
  const log = opts.log ?? (() => {})
  const dataSrcDir = path.resolve(opts.dataSrcDir ?? DATA_SRC_DIR)
  const fullDir = opts.fullDir ? path.resolve(opts.fullDir) : null
  const files = {}
  const missing = []
  for (const [key, spec] of Object.entries(CURATED_FILES)) {
    const dataSrcPath = path.join(dataSrcDir, spec.dataSrc)
    if (fs.existsSync(dataSrcPath)) {
      files[key] = { path: dataSrcPath, from: 'data-src' }
      continue
    }
    const fullPath = fullDir ? path.join(fullDir, spec.full) : null
    if (fullPath && fs.existsSync(fullPath)) {
      files[key] = { path: fullPath, from: '完整语料' }
      continue
    }
    missing.push({ key, label: spec.label })
  }
  if (missing.length > 0) {
    log(`⚠ curated 源缺失：${missing.map((item) => item.label).join('、')}`)
  }
  return { files, missing, complete: missing.length === 0 }
}

/**
 * 解析一份完整可用的源树目录（完整语料：全唐诗 313 chunks + strains + rank + 宋词 + 蒙学）。
 * 顺序：--source/POETRY_DATA_DIR → data-src（完整语料通常不在其中，快速跳过）→
 *       _ref/poetry-source/<commit> → 系统临时旧缓存 → _ref/poetry-data 工作树 → 网络物化。
 * `--offline` 时只允许本地源，缺文件直接报错（并提示 curated 仍可从 data-src 离线读取）。
 * @param {{ source?: string, src?: string, ref?: string, cache?: string, force?: boolean, offline?: boolean, noFetch?: boolean, log?: (m: string) => void, dataSrcDir?: string }} [opts]
 * @returns {Promise<{ dir: string, from: string, counts: object, offline: boolean }>}
 */
export async function resolveSource(opts = {}) {
  const log = opts.log ?? (() => {})
  const offline = Boolean(opts.offline)
  const noFetch = offline || Boolean(opts.noFetch)
  const ref = path.resolve(opts.ref ?? DEFAULT_REF)
  const cache = path.resolve(opts.cache ?? DEFAULT_CACHE)
  const legacyCache = path.resolve(LEGACY_DEFAULT_CACHE)
  const dataSrcDir = path.resolve(opts.dataSrcDir ?? DATA_SRC_DIR)
  const explicitSource = opts.source ?? opts.src ?? process.env.POETRY_DATA_DIR
  const candidates = []
  if (explicitSource) {
    candidates.push({ dir: path.resolve(explicitSource), from: '--source 指定的源树' })
  }
  candidates.push({ dir: dataSrcDir, from: '项目 data-src 快照（curated，非完整语料）' })
  candidates.push({ dir: cache, from: '完整语料本地缓存 _ref/poetry-source' })
  if (legacyCache !== cache) candidates.push({ dir: legacyCache, from: '系统临时旧缓存（兼容）' })
  candidates.push({ dir: ref, from: '_ref 本地工作树' })

  for (const cand of candidates) {
    const check = checkSource(cand.dir)
    if (check.ok) {
      log(
        `源数据：${cand.dir}（${cand.from}；唐诗 ${check.counts.tang} 卷 / 宋诗 ${check.counts.song} 卷 / 词 ${check.counts.ci} 卷）`,
      )
      return { dir: cand.dir, from: cand.from, counts: check.counts, offline }
    }
  }
  if (noFetch) {
    const curated = resolveCuratedFiles({ fullDir: null, dataSrcDir, log })
    throw new Error(
      '找不到完整的本地语料源，且当前为离线模式（--offline）。\n' +
        `已尝试：${candidates.map((c) => c.dir).join(' ; ')}\n` +
        'curated 源状态：' +
        (curated.complete
          ? '✓ data-src/ 齐全，可离线读取 curated（但重跑 data/ 需要完整语料）'
          : `✗ 缺 ${curated.missing.map((m) => m.label).join('、')}`) +
        '\n可运行 `node scripts/fetch-data.mjs --force`（需网络或本地 _ref/poetry-data 对象）补全完整语料。',
    )
  }
  if (opts.force) fs.rmSync(cache, { recursive: true, force: true })
  log(`本地无完整语料缓存，开始从 _ref git 物化到：${cache}`)
  await materializeSource(ref, cache, { log })
  const check = checkSource(cache)
  if (!check.ok) throw new Error(`源数据不完整：${check.missing.join('; ')}`)
  return { dir: cache, from: '新物化的本地缓存', counts: check.counts, offline }
}

/* ------------------------------------------------------------------ *
 * 离线自检
 * ------------------------------------------------------------------ */

/** 统计目录文件数/字节数（用于打印缓存体积）。 */
export function dirStats(dir) {
  let files = 0
  let bytes = 0
  const walk = (current) => {
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.isFile()) {
        files += 1
        try {
          bytes += fs.statSync(target).size
        } catch {
          // ignore
        }
      }
    }
  }
  walk(dir)
  return { files, bytes }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`参数 ${a} 缺少取值`)
      return v
    }
    if (a === '--source' || a === '--src') opts.source = value()
    else if (a === '--ref') opts.ref = value()
    else if (a === '--cache') opts.cache = value()
    else if (a === '--data-src') opts.dataSrcDir = value()
    else if (a === '--offline') opts.offline = true
    else if (a === '--force') opts.force = true
    else if (a === '--help' || a === '-h') opts.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return opts
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(
      '用法：node scripts/fetch-data.mjs [--offline] [--source <dir>] [--data-src <dir>] [--ref <dir>] [--cache <dir>] [--force]',
    )
    return
  }
  const log = (m) => console.log(m)
  const offline = Boolean(opts.offline)
  console.log(`fetch-data${offline ? '（离线模式 --offline）' : ''}`)
  console.log(`来源仓库：${SOURCE.repo} @ ${SOURCE.commit}（${SOURCE.license}）`)

  // 1) curated 源（data-src 优先；离线核心保证）
  const curated = resolveCuratedFiles({
    fullDir: null,
    dataSrcDir: opts.dataSrcDir,
    offline,
    log,
  })
  console.log('')
  console.log(`curated 源：${curated.complete ? '✓ 齐全（离线可用）' : `✗ 缺 ${curated.missing.length} 个`}`)
  for (const [key, file] of Object.entries(curated.files)) {
    const bytes = fs.existsSync(file.path) ? fs.statSync(file.path).size : 0
    const spec = CURATED_FILES[key]
    console.log(`  ${(spec?.label ?? key).padEnd(20)} ${formatBytes(bytes).padStart(9)}  [${file.from}] ${file.path}`)
  }
  for (const item of curated.missing) {
    console.log(`  ${item.label.padEnd(20)} ${'—'.padStart(9)}  缺失`)
  }

  // 2) 完整语料（构建 data/ 才需要；离线缺失时给出明确提示）
  console.log('')
  let resolved = null
  try {
    resolved = await resolveSource({
      source: opts.source,
      ref: opts.ref,
      cache: opts.cache,
      force: opts.force,
      offline,
      log,
    })
  } catch (error) {
    if (curated.complete && offline) {
      console.log(`完整语料：✗ 本地不可用（离线下不影响 curated 读取）`)
      console.log(`  说明：${String(error.message ?? error).split('\n')[0]}`)
      console.log('')
      console.log('离线自检：通过（curated 源齐全，可离线读取 data-src/）')
      return
    }
    throw error
  }
  const stats = dirStats(resolved.dir)
  console.log('')
  console.log(`完整语料：${resolved.dir}`)
  console.log(`  来源：${resolved.from}`)
  console.log(`  文件计数：${JSON.stringify(resolved.counts)}`)
  console.log(`  体积：${formatBytes(stats.bytes)}（${stats.files} 个文件）`)
  console.log('')
  console.log(
    offline
      ? '离线自检：通过（curated 源齐全 + 完整语料本地可用，可完全离线重跑 data/）'
      : '源解析：完成',
  )
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[fetch-data] ${err?.message ?? err}`)
    process.exitCode = 1
  })
}
