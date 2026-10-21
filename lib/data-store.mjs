// lib/data-store.mjs —— 包内 data/*.json 的只读加载器。
//
// 契约（docs/contract.md §1/§2/§5）：
//   · 数据文件缺失 / JSON 损坏 / 顶层形状不符 → 返回 {ok:false, error:{code:"DATA_UNAVAILABLE"}}，
//     路由层仍回 HTTP 200，绝不抛未捕获异常；
//   · 内存缓存按「文件 mtime + manifest.dataVersion」失效（数据重新生成后宿主进程无需重启）；
//   · dataVersion / source / builtAt 唯一来源是 data/manifest.json。
//
// 所有路径通过构造参数传入（宿主用 import.meta.url 推包根），单测可换临时目录。
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** 契约里的数据文件（顺序即 about.files 的展示顺序）。 */
export const DATA_FILES = Object.freeze([
  'manifest.json',
  'poems.json',
  'ci.json',
  'yun.json',
  'knowledge.json',
])

/** 各数据文件的最小顶层形状校验（字段级质量门由 data-pipeline 的 validate-data 负责）。 */
const SHAPE_VALIDATORS = Object.freeze({
  'poems.json': (doc) => Array.isArray(doc.items),
  'ci.json': (doc) => Array.isArray(doc.items),
  'yun.json': (doc) => Array.isArray(doc.volumes),
  'knowledge.json': (doc) => Array.isArray(doc.cards) && Array.isArray(doc.ciCards),
})

/** JSON 里可以出现的长字符串（错误信息）截断，避免异常信息把日志/响应撑大。 */
function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 统一的数据不可用响应体（路由层原样 JSON 化）。 */
export function dataUnavailable(message) {
  return { ok: false, error: { code: 'DATA_UNAVAILABLE', message } }
}

/**
 * 今日诗选择：`sha256(YYYY-MM-DD + dataVersion) % count`。
 * 纯函数，便于单测复算；客户端只使用返回值，不重复实现。
 * @param {string} date - 本地日期 `YYYY-MM-DD`
 * @param {string} dataVersion
 * @param {number} count - 诗总数
 * @returns {string|null} - 0-based 下标；count 非法时 null
 */
export function pickPoemIndex(date, dataVersion, count) {
  if (!Number.isInteger(count) || count <= 0) return null
  const digest = createHash('sha256').update(`${date}${dataVersion}`, 'utf8').digest('hex')
  // 契约字面：把 sha256 摘要视为无符号大整数后对诗总数取模（跨 Node/浏览器一致）。
  return Number(BigInt(`0x${digest}`) % BigInt(count))
}

/**
 * 创建数据存储。
 * @param {{dataDir: string}} options
 */
export function createDataStore({ dataDir }) {
  /** @type {Map<string, {mtimeMs: number, size: number, manifestVersion: string|null, result: object}>} */
  const fileCache = new Map()
  /** @type {{mtimeMs: number, size: number, result: object}|null} */
  let manifestCache = null

  function absolute(name) {
    return path.join(dataDir, name)
  }

  /** stat 一个普通文件；不存在 / 不是文件 / 无权限 → null。 */
  function statFile(name) {
    try {
      const stat = statSync(absolute(name))
      return stat.isFile() ? stat : null
    } catch {
      return null
    }
  }

  /** 读 manifest：{ok:true, dataVersion, source, builtAt, bytes} 或 {ok:false, ...DATA_UNAVAILABLE}。 */
  function getManifest() {
    const stat = statFile('manifest.json')
    if (stat === null) {
      manifestCache = null
      return dataUnavailable('data/manifest.json 不存在或不可读')
    }
    if (manifestCache !== null && manifestCache.mtimeMs === stat.mtimeMs && manifestCache.size === stat.size) {
      return manifestCache.result
    }
    let result
    try {
      const parsed = JSON.parse(readFileSync(absolute('manifest.json'), 'utf8'))
      if (!isPlainObject(parsed)) throw new Error('manifest.json 顶层不是 JSON 对象')
      if (typeof parsed.dataVersion !== 'string' || parsed.dataVersion.trim().length === 0) {
        throw new Error('manifest.json 缺少 dataVersion')
      }
      result = {
        ok: true,
        dataVersion: parsed.dataVersion,
        source: normalizeSource(parsed.source),
        builtAt: typeof parsed.builtAt === 'string' && parsed.builtAt.length > 0 ? parsed.builtAt : null,
        bytes: stat.size,
      }
    } catch (error) {
      result = dataUnavailable(`data/manifest.json 无法解析：${shortMessage(error)}`)
      // 解析失败不缓存：文件修好后下一次请求立即恢复。
      manifestCache = null
      return result
    }
    manifestCache = { mtimeMs: stat.mtimeMs, size: stat.size, result }
    return result
  }

  /** manifest 里的数据版本；manifest 不可用时 null。 */
  function getDataVersion() {
    const manifest = getManifest()
    return manifest.ok ? manifest.dataVersion : null
  }

  /**
   * 读一个数据文件。缓存命中条件是「mtime + size 未变」且「manifest.dataVersion 未变」。
   * @param {'poems.json'|'ci.json'|'yun.json'|'knowledge.json'} name
   */
  function load(name) {
    const validator = SHAPE_VALIDATORS[name]
    if (validator === undefined) throw new Error(`data-store: 未知数据文件 ${name}`)
    const stat = statFile(name)
    if (stat === null) return dataUnavailable(`data/${name} 不存在或不可读`)
    const manifestVersion = getDataVersion()
    const cached = fileCache.get(name)
    if (
      cached !== undefined &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      cached.manifestVersion === manifestVersion
    ) {
      return cached.result
    }
    let result
    try {
      const parsed = JSON.parse(readFileSync(absolute(name), 'utf8'))
      if (!isPlainObject(parsed)) throw new Error('顶层不是 JSON 对象')
      if (parsed.ok === false) throw new Error('文件自身声明 ok:false')
      if (!validator(parsed)) throw new Error('顶层字段不符合契约')
      const fileVersion =
        typeof parsed.dataVersion === 'string' && parsed.dataVersion.length > 0 ? parsed.dataVersion : null
      result = { ok: true, value: parsed, dataVersion: fileVersion ?? manifestVersion, bytes: stat.size }
    } catch (error) {
      // 损坏文件不进缓存：修好后无需等宿主重启。
      fileCache.delete(name)
      return dataUnavailable(`data/${name} 无法解析：${shortMessage(error)}`)
    }
    fileCache.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, manifestVersion, result })
    return result
  }

  /** 诗 id 集合（设置校验 lastPoemId 用）；数据不可用时 null 表示"无法判定，接受原值"。 */
  function knownPoemIds() {
    const poems = load('poems.json')
    if (!poems.ok) return null
    const ids = new Set()
    for (const item of poems.value.items) {
      if (isPlainObject(item) && typeof item.id === 'string' && item.id.length > 0) ids.add(item.id)
    }
    return ids
  }

  /** bootstrap/about 用的计数；缺失文件按 0 计（bootstrap 另要求 poems 可用）。 */
  function getCounts() {
    const poems = load('poems.json')
    const ci = load('ci.json')
    const yun = load('yun.json')
    const knowledge = load('knowledge.json')
    let yunCount = 0
    if (yun.ok) {
      for (const volume of yun.value.volumes) {
        if (Array.isArray(volume?.chapters)) yunCount += volume.chapters.length
      }
    }
    return {
      poems: poems.ok ? poems.value.items.length : 0,
      ci: ci.ok ? ci.value.items.length : 0,
      yun: yunCount,
      cards: knowledge.ok ? knowledge.value.cards.length : 0,
      ciCards: knowledge.ok ? knowledge.value.ciCards.length : 0,
    }
  }

  /** about.files：每个数据文件的字节数与可解析状态（不泄露绝对路径）。 */
  function getStatuses() {
    return DATA_FILES.map((name) => {
      const stat = statFile(name)
      let ok = false
      let error = null
      if (stat === null) {
        error = 'missing'
      } else if (name === 'manifest.json') {
        const manifest = getManifest()
        ok = manifest.ok
        if (!manifest.ok) error = manifest.error.message
      } else {
        const loaded = load(name)
        ok = loaded.ok
        if (!loaded.ok) error = loaded.error.message
      }
      const status = { name, bytes: stat === null ? null : stat.size, ok }
      if (error !== null) status.error = error
      return status
    })
  }

  /**
   * 今日诗：{ok:true, date, poemId, dataVersion}；manifest 或 poems 不可用时 DATA_UNAVAILABLE。
   * @param {Date} [now]
   */
  function getToday(now = new Date()) {
    const manifest = getManifest()
    if (!manifest.ok) return manifest
    const poems = load('poems.json')
    if (!poems.ok) return poems
    const date = formatDate(now instanceof Date ? now : new Date(now))
    const index = pickPoemIndex(date, manifest.dataVersion, poems.value.items.length)
    const poem = index === null ? null : poems.value.items[index]
    return {
      ok: true,
      date,
      poemId: isPlainObject(poem) && typeof poem.id === 'string' && poem.id.length > 0 ? poem.id : null,
      dataVersion: manifest.dataVersion,
    }
  }

  /** health 用：manifest + poems 都可用即视为"数据已就绪"（bootstrap 的最低要求）。 */
  function isDataAvailable() {
    return getManifest().ok && load('poems.json').ok
  }

  return { dataDir, getManifest, getDataVersion, load, knownPoemIds, getCounts, getStatuses, getToday, isDataAvailable }
}

/** 本地日期（与 lib/paths.mjs 的 formatLocalDate 等价，此处内联避免循环依赖）。 */
function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 数据源三元组归一化；manifest 缺 source 时保留字段但值为 null（降级场景）。 */
function normalizeSource(source) {
  if (!isPlainObject(source)) return { repo: null, commit: null, license: null }
  return {
    repo: typeof source.repo === 'string' ? source.repo : null,
    commit: typeof source.commit === 'string' ? source.commit : null,
    license: typeof source.license === 'string' ? source.license : null,
  }
}
