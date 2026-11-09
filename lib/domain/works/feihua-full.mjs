// lib/feihua-full.mjs —— 飞花令「全量校验句库」按令字分片读取（契约 v1.11 §2.14，M17a）。
//
// 数据由 `scripts/build-feihua-full.mjs` 从全量 chinese-poetry 语料构建，产物在项目同级
// `_ref/feihua-full/<令字>.json`（**不随插件包**），格式：
//   {ok:true, v:1, char:"花", entries:[["句子","作者《篇名》"], …]}
// 本模块只负责：路径解析、单字校验、按 char 读取/校验/进程内 LRU 缓存（≤4）、并发去重。
// 任何失败都收敛成 {ok:false,error:{code:'FEIHUA_FULL_UNAVAILABLE'}}，绝不把异常抛给路由。
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** 缓存容量上限（契约 §2.14：LRU ≤4）。 */
export const FEIHUA_FULL_MAX_CACHE = 4
/** 失败码。 */
export const FEIHUA_FULL_UNAVAILABLE_CODE = 'FEIHUA_FULL_UNAVAILABLE'

/**
 * 解析全量句库目录：
 *   · `DSH_POETRY_FULL_INDEX` 优先（测试/自定义语料）；
 *   · 否则 `<pkgRoot>/../_ref/feihua-full`（项目同级，不随包）。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} pkgRoot
 * @returns {string}
 */
export function resolveFeihuaFullDir(env = process.env, pkgRoot) {
  const custom = typeof env?.DSH_POETRY_FULL_INDEX === 'string' ? env.DSH_POETRY_FULL_INDEX.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  return path.resolve(String(pkgRoot ?? '.'), '..', '_ref', 'feihua-full')
}

/**
 * 是否合法令字：单个 CJK 统一表意文字（繁简均可）。多字/标点/空白/emoji/数字都拒绝。
 * @param {unknown} value
 */
export function isValidFeihuaChar(value) {
  if (typeof value !== 'string') return false
  const chars = Array.from(value)
  if (chars.length !== 1) return false
  return /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$/u.test(chars[0])
}

/** 统一失败响应体。 */
export function feihuaFullUnavailable(message) {
  return { ok: false, error: { code: FEIHUA_FULL_UNAVAILABLE_CODE, message: String(message ?? '全量校验句库不可用') } }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 创建全量校验句库服务。
 * @param {{
 *   dir: string,
 *   logger?: {warn?: Function}|null,
 *   now?: () => number,
 *   maxChars?: number,
 *   readFile?: (file: string) => Promise<string|Buffer>, // 便于测试 mock fs
 * }} options
 */
export function createFeihuaFullService(options) {
  const dir = path.resolve(options.dir)
  const logger = options.logger ?? null
  const maxChars =
    Number.isFinite(options.maxChars) && options.maxChars > 0 ? Math.floor(options.maxChars) : FEIHUA_FULL_MAX_CACHE
  const readFileImpl =
    typeof options.readFile === 'function' ? options.readFile : (file) => readFile(file, 'utf8')

  /** @type {Map<string, {char:string, count:number, entries:Array<[string,string]>}>} */
  const cache = new Map()
  /** @type {Map<string, Promise<object>>} */
  const inFlight = new Map()

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  /** 写入缓存并按 LRU 淘汰最旧条目（Map 插入顺序即访问顺序，命中时会 refresh）。 */
  function cacheSet(char, result) {
    if (!cache.has(char) && cache.size >= maxChars) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.delete(char)
    cache.set(char, result)
  }

  function cacheTouch(char) {
    const hit = cache.get(char)
    if (hit === undefined) return null
    cache.delete(char)
    cache.set(char, hit)
    return hit
  }

  /** 读盘 + 解析 + 校验；失败返回统一错误体（不缓存）。 */
  async function loadUncached(char) {
    const file = path.join(dir, `${char}.json`)
    const root = path.resolve(dir)
    const resolved = path.resolve(file)
    if (resolved !== path.join(root, `${char}.json`) || !resolved.startsWith(root + path.sep)) {
      return feihuaFullUnavailable('令字路径非法')
    }
    let raw
    try {
      raw = await readFileImpl(file)
    } catch (error) {
      const code = typeof error === 'object' && error !== null ? String(error.code ?? '') : ''
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return feihuaFullUnavailable(`全量校验分片不存在：${char}.json（目录或文件缺失）`)
      }
      warn(`全量校验分片读取失败（${char}.json）：${shortMessage(error)}`)
      return feihuaFullUnavailable(`全量校验分片读取失败：${shortMessage(error)}`)
    }
    let parsed
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
    } catch (error) {
      warn(`全量校验分片 JSON 损坏（${char}.json）：${shortMessage(error)}`)
      return feihuaFullUnavailable(`全量校验分片 JSON 损坏：${char}.json`)
    }
    if (!isPlainObject(parsed) || parsed.ok !== true || parsed.v !== 1) {
      return feihuaFullUnavailable(`全量校验分片格式不符：${char}.json`)
    }
    if (!Array.isArray(parsed.entries)) {
      return feihuaFullUnavailable(`全量校验分片缺少 entries：${char}.json`)
    }
    const entries = []
    for (const item of parsed.entries) {
      if (!Array.isArray(item) || item.length < 2) continue
      const text = typeof item[0] === 'string' ? item[0].trim() : ''
      const source = typeof item[1] === 'string' ? item[1].trim() : ''
      if (text.length === 0) continue
      entries.push([text, source])
    }
    if (entries.length === 0) {
      return feihuaFullUnavailable(`全量校验分片没有可用句子：${char}.json`)
    }
    return { ok: true, char, count: entries.length, entries }
  }

  /**
   * 读取某令字的全量校验句库。
   * 并发去重：同一 char 同时只读一次盘；先到者 cached:false，等待者 cached:true。
   * @param {string} rawChar
   * @returns {Promise<{ok:true,char:string,count:number,entries:Array<[string,string]>,cached:boolean}|{ok:false,error:{code:string,message:string}}>}
   */
  async function load(rawChar) {
    const char = typeof rawChar === 'string' ? rawChar.trim() : ''
    if (!isValidFeihuaChar(char)) {
      return feihuaFullUnavailable('非法令字：只接受单个汉字')
    }
    const hit = cacheTouch(char)
    if (hit !== null) return { ok: true, char: hit.char, count: hit.count, entries: hit.entries, cached: true }

    const pending = inFlight.get(char)
    if (pending !== undefined) {
      const shared = await pending
      if (shared.ok === true) return { ...shared, cached: true }
      return shared
    }

    const task = loadUncached(char)
      .then((result) => {
        if (result.ok === true) {
          cacheSet(char, { char: result.char, count: result.count, entries: result.entries })
          return { ...result, cached: false }
        }
        return result
      })
      .catch((error) => {
        warn(`全量校验读取异常（${char}）：${shortMessage(error)}`)
        return feihuaFullUnavailable(`全量校验读取异常：${shortMessage(error)}`)
      })
      .finally(() => {
        if (inFlight.get(char) === task) inFlight.delete(char)
      })
    inFlight.set(char, task)
    return task
  }

  return {
    dir,
    load,
    /** 测试/诊断用：当前缓存里的令字（LRU 顺序，旧→新）。 */
    cacheKeys: () => [...cache.keys()],
    cacheSize: () => cache.size,
    clearCache: () => cache.clear(),
  }
}
