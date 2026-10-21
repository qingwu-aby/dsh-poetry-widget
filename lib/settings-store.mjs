// lib/settings-store.mjs —— 设置持久化（$DSH_HOME/.dsh-poetry/settings.json）。
//
// 契约（docs/contract.md §2.6）：
//   · 白名单字段 + 类型/枚举校验；未知字段忽略；非法值 → 400 INVALID_SETTINGS（fields 列表）；
//   · scale clamp 到 [0.6, 1.6]；autoplay 只接受 0|30|60|300；lastPoemId 不在诗列表则置 null；
//   · M7 天气：weatherCity（trim 1–20 字符，非法/空/超长→默认「北京」）、weatherPoem（bool，默认 true）；
//   · M8 心情：mood / spontaneousPoem（bool，默认 true，仅影响客户端展示，host 侧持续统计）；
//   · 原子写（同目录 tmp + fsync + rename）；损坏文件先备份 .bak 再回退默认，不崩溃。
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_CITY, normalizeCity } from './weather.mjs'

/** 设置 schema 版本（宿主管理，客户端不可改）。 */
export const SETTINGS_SCHEMA_VERSION = 1

/** 契约 §2.6 的默认设置（唯一默认值来源）。 */
export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  scale: 1.0,
  showTones: true,
  mode: 'daily',
  autoplay: 0,
  snap: 'left',
  script: 'simplified',
  hidden: false,
  theme: 'auto',
  weatherCity: DEFAULT_CITY,
  weatherPoem: true,
  mood: true,
  spontaneousPoem: true,
  lastPoemId: null,
  tutorialSeen: false,
  updatedAt: 0,
})

/** 枚举字段的合法值。 */
export const SETTINGS_ENUMS = Object.freeze({
  mode: Object.freeze(['daily', 'random']),
  autoplay: Object.freeze([0, 30, 60, 300]),
  snap: Object.freeze(['left', 'right', 'free']),
  script: Object.freeze(['simplified', 'original']),
  theme: Object.freeze(['auto', 'light', 'dark']),
})

const SCALE_MIN = 0.6
const SCALE_MAX = 1.6
/** PUT 请求体上限：设置对象很小，超过即视为异常请求。 */
export const MAX_SETTINGS_BODY_BYTES = 16 * 1024

/**
 * 原子写 JSON 文件（同目录 tmp 0600 → fsync → rename；失败清理 tmp）。
 * settings.json 与 mood.json 共用；调用方负责保证 value 可 JSON 序列化。
 * @param {string} file - 目标文件绝对路径
 * @param {unknown} value
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function writeJsonAtomic(file, value) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  let fd = null
  try {
    mkdirSync(dir, { recursive: true })
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmp, file)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampScale(value) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value))
}

/** 解析设置文件位置：$DSH_HOME/.dsh-poetry/settings.json；DSH_HOME 未设时 ~/.dsh/.dsh-poetry/settings.json。 */
export function resolveSettingsPath(env = process.env, home = null) {
  const base =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.resolve(env.DSH_HOME.trim())
      : path.join(home ?? process.env.HOME ?? os.homedir(), '.dsh')
  const dir = path.join(base, '.dsh-poetry')
  return { base, dir, file: path.join(dir, 'settings.json') }
}

/**
 * 宽松归一化：用于"从磁盘读到的设置"。
 * 非法/未知字段丢弃并回退默认值，保证任何损坏文件都不会让宿主崩溃。
 * @param {unknown} raw
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS }
  if (!isPlainObject(raw)) return settings
  if (typeof raw.scale === 'number' && Number.isFinite(raw.scale)) settings.scale = clampScale(raw.scale)
  for (const key of ['showTones', 'hidden', 'tutorialSeen', 'weatherPoem', 'mood', 'spontaneousPoem']) {
    if (typeof raw[key] === 'boolean') settings[key] = raw[key]
  }
  for (const [key, allowed] of Object.entries(SETTINGS_ENUMS)) {
    if (allowed.includes(raw[key])) settings[key] = raw[key]
  }
  if (typeof raw.weatherCity === 'string') settings.weatherCity = normalizeCity(raw.weatherCity)
  if (raw.lastPoemId === null) settings.lastPoemId = null
  else if (typeof raw.lastPoemId === 'string') settings.lastPoemId = raw.lastPoemId
  if (typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0) {
    settings.updatedAt = raw.updatedAt
  }
  return settings
}

/**
 * 严格校验 PUT 增量（白名单 + 类型/枚举）。未知字段忽略。
 * @param {unknown} patch
 * @returns {{ok: true, patch: object} | {ok: false, fields: string[], message: string}}
 */
export function validateSettingsPatch(patch) {
  if (!isPlainObject(patch)) {
    return { ok: false, fields: ['body'], message: '请求体必须是 JSON 对象' }
  }
  const fields = []
  const normalized = {}

  if (Object.prototype.hasOwnProperty.call(patch, 'scale')) {
    if (typeof patch.scale === 'number' && Number.isFinite(patch.scale)) normalized.scale = clampScale(patch.scale)
    else fields.push('scale')
  }
  for (const key of ['showTones', 'hidden', 'tutorialSeen', 'weatherPoem', 'mood', 'spontaneousPoem']) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (typeof patch[key] === 'boolean') normalized[key] = patch[key]
    else fields.push(key)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'weatherCity')) {
    // 契约 §2.6：trim 后 1–20 字符，空串/超长/非字符串一律归一为默认「北京」（不报 400）。
    normalized.weatherCity = normalizeCity(patch.weatherCity)
  }
  for (const [key, allowed] of Object.entries(SETTINGS_ENUMS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (allowed.includes(patch[key])) normalized[key] = patch[key]
    else fields.push(key)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastPoemId')) {
    const value = patch.lastPoemId
    if (value === null) normalized.lastPoemId = null
    else if (typeof value === 'string') normalized.lastPoemId = value
    else fields.push('lastPoemId')
  }
  // schemaVersion / updatedAt 由宿主维护；客户端传入一律忽略（白名单里存在但不接受外部写）。

  if (fields.length > 0) {
    return { ok: false, fields, message: `非法设置字段：${fields.join('、')}` }
  }
  return { ok: true, patch: normalized }
}

/**
 * 创建设置存储。
 * @param {{
 *   file: string,
 *   knownPoemIds?: () => Set<string>|null,
 *   now?: () => number,
 *   onWarn?: (message: string) => void,
 * }} options
 */
export function createSettingsStore(options) {
  const file = options.file
  const dir = path.dirname(file)
  const knownPoemIds = options.knownPoemIds ?? (() => null)
  const now = options.now ?? (() => Date.now())
  const onWarn = options.onWarn ?? (() => {})

  /** 已处理过的损坏文件版本（mtime+size），避免每个 GET 都重复备份。 */
  let handledCorrupt = null

  /** 读原始文件：missing / ok / corrupt 三态。 */
  function readRaw() {
    let stat
    try {
      stat = statSync(file)
    } catch {
      return { kind: 'missing' }
    }
    if (!stat.isFile()) return { kind: 'missing' }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!isPlainObject(parsed)) throw new Error('settings.json 顶层不是 JSON 对象')
      return { kind: 'ok', raw: parsed, mtimeMs: stat.mtimeMs, size: stat.size }
    } catch (error) {
      return {
        kind: 'corrupt',
        message: error instanceof Error ? error.message : String(error),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      }
    }
  }

  /** 损坏文件备份为 `.bak`（每个损坏版本只备份一次；备份失败不影响回退默认）。 */
  function backupCorrupt(state) {
    if (handledCorrupt !== null && handledCorrupt.mtimeMs === state.mtimeMs && handledCorrupt.size === state.size) {
      return
    }
    handledCorrupt = { mtimeMs: state.mtimeMs, size: state.size }
    try {
      copyFileSync(file, `${file}.bak`)
      onWarn(`settings.json 损坏，已备份为 settings.json.bak：${state.message}`)
    } catch (error) {
      onWarn(`settings.json 损坏且备份失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** lastPoemId 不在诗列表内 → null（诗列表不可用时无法判定，保留原值）。 */
  function normalizeLastPoem(settings) {
    if (typeof settings.lastPoemId !== 'string') {
      settings.lastPoemId = null
      return settings
    }
    if (settings.lastPoemId.length === 0) {
      settings.lastPoemId = null
      return settings
    }
    const ids = knownPoemIds()
    if (ids !== null && !ids.has(settings.lastPoemId)) settings.lastPoemId = null
    return settings
  }

  /** 当前设置（默认值 / 文件值 + lastPoemId 归一化）。永远不抛异常。 */
  function get() {
    const state = readRaw()
    if (state.kind === 'missing') return { ...DEFAULT_SETTINGS }
    if (state.kind === 'corrupt') {
      backupCorrupt(state)
      return { ...DEFAULT_SETTINGS }
    }
    handledCorrupt = null
    return normalizeLastPoem(normalizeSettings(state.raw))
  }

  /** 原子写：同目录 tmp（0600）→ fsync → rename；失败清理 tmp。 */
  function writeAtomic(settings) {
    return writeJsonAtomic(file, settings)
  }

  /**
   * 合并写入部分设置；返回 {ok:true, settings:完整设置} 或 {ok:false, error}。
   * @param {unknown} patch
   */
  function put(patch) {
    const validated = validateSettingsPatch(patch)
    if (!validated.ok) {
      return {
        ok: false,
        error: { code: 'INVALID_SETTINGS', message: validated.message, fields: validated.fields },
      }
    }
    const current = get()
    const merged = normalizeLastPoem({ ...current, ...validated.patch })
    merged.schemaVersion = SETTINGS_SCHEMA_VERSION
    merged.updatedAt = now()
    const written = writeAtomic(merged)
    if (!written.ok) {
      return {
        ok: false,
        error: { code: 'SETTINGS_WRITE_FAILED', message: `设置写入失败：${written.message}` },
      }
    }
    return { ok: true, settings: merged }
  }

  return { file, dir, get, put, validate: validateSettingsPatch }
}
