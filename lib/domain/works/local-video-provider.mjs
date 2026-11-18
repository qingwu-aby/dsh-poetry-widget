// @ts-check
// lib/domain/works/local-video-provider.mjs —— 本地视频 provider（Gate L7，不联网/不复制视频）。
//
// 供 Video Activity 注入：
//   · open({path})：本地文件；rootDir 默认 DSH_POETRY_VIDEOS_DIR 或 ~/Documents/little-whale-videos；
//     扩展名白名单；返回 {id,title,path,durationMs}；越界/缺失/不支持明确错误；
//   · ffprobe 可选：存在则读时长（秒→ms），不存在/失败 durationMs=null（不报错）；
//   · play/pause：只维护状态；summary()：读取同名 .md/.srt/.txt 旁注（无则 summary:null）。
// 不联网、不复制/转码视频、不写盘。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 实现版本。 */
export const LOCAL_VIDEO_PROVIDER_VERSION = 1

/** 默认视频目录。 */
export const DEFAULT_VIDEOS_DIR = path.join(os.homedir(), 'Documents', 'little-whale-videos')

/** 支持的扩展名。 */
export const VIDEO_EXTENSIONS = Object.freeze(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'])

/** 旁注扩展名（优先级从高到低）。 */
export const VIDEO_SIDECAR_EXTENSIONS = Object.freeze(['.md', '.srt', '.txt'])

/** 错误码。 */
export const LOCAL_VIDEO_CODES = Object.freeze({
  invalidPath: 'VIDEO_INVALID_PATH',
  outsideRoot: 'VIDEO_OUTSIDE_ROOT',
  unsupported: 'VIDEO_UNSUPPORTED_TYPE',
  notFound: 'VIDEO_NOT_FOUND',
  notFile: 'VIDEO_NOT_FILE',
  readFailed: 'VIDEO_READ_FAILED',
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function videoError(code, message) {
  const error = /** @type {any} */ (new Error(message))
  error.code = code
  return error
}

/** 读取 ffprobe 时长（不可用/失败 → null）。 */
function probeDurationMs(file, execFile) {
  try {
    const output = execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8', timeout: 10000 })
    const seconds = Number(String(output ?? '').trim())
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
  } catch (error) {
    void error
    return null
  }
}

/**
 * 创建本地视频 provider。
 * @param {{
 *   rootDir?: string|null,
 *   now?: () => number,
 *   execFile?: Function|null,
 *   readFile?: ((file: string) => string)|null,
 *   env?: Record<string, string|undefined>|null,
 *   logger?: object|null,
 * }} [options]
 */
export function createLocalVideoProvider(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const env = isPlainObject(spec.env) ? spec.env : process.env
  const rootDir =
    typeof spec.rootDir === 'string' && spec.rootDir.length > 0
      ? path.resolve(spec.rootDir)
      : typeof env.DSH_POETRY_VIDEOS_DIR === 'string' && env.DSH_POETRY_VIDEOS_DIR.length > 0
        ? path.resolve(env.DSH_POETRY_VIDEOS_DIR)
        : path.resolve(DEFAULT_VIDEOS_DIR)
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const execFile = typeof spec.execFile === 'function' ? spec.execFile : execFileSync
  const readFile = typeof spec.readFile === 'function' ? spec.readFile : (file) => readFileSync(file, 'utf8')
  const logger = /** @type {any} */ (spec.logger ?? null)
  let current = null

  function resolvePath(input) {
    const raw = typeof input === 'string' ? input : isPlainObject(input) && typeof input.path === 'string' ? input.path : ''
    const trimmed = raw.trim()
    if (trimmed.length === 0) throw videoError(LOCAL_VIDEO_CODES.invalidPath, '需要 path')
    if (trimmed.indexOf('\0') >= 0) throw videoError(LOCAL_VIDEO_CODES.invalidPath, 'path 含非法字符')
    const resolved = path.resolve(rootDir, trimmed)
    const relative = path.relative(rootDir, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw videoError(LOCAL_VIDEO_CODES.outsideRoot, 'path 越界（不在视频目录内）')
    return { ok: true, file: resolved }
  }

  function open(input) {
    const resolved = resolvePath(input)
    const file = resolved.file
    if (existsSync(file)) {
      let isDirectory = false
      try {
        isDirectory = statSync(file).isDirectory()
      } catch (error) {
        throw videoError(LOCAL_VIDEO_CODES.readFailed, error instanceof Error ? error.message : String(error))
      }
      if (isDirectory) throw videoError(LOCAL_VIDEO_CODES.notFile, 'path 是目录，不是视频文件')
    }
    const ext = path.extname(file).toLowerCase()
    if (VIDEO_EXTENSIONS.indexOf(ext) < 0) throw videoError(LOCAL_VIDEO_CODES.unsupported, '只支持 ' + VIDEO_EXTENSIONS.join('/') + '：' + ext)
    if (!existsSync(file)) throw videoError(LOCAL_VIDEO_CODES.notFound, '视频不存在：' + file)
    const title = path.basename(file, ext).slice(0, 120) || '未命名视频'
    const durationMs = probeDurationMs(file, execFile)
    current = { id: 'local-video-' + title.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').slice(0, 60), title, path: file, durationMs, status: 'opened', openedAt: now() }
    try {
      logger?.info?.(`[dsh-little-whale] 本地视频已打开：${title}`)
    } catch (error) {
      void error
    }
    return {
      ok: true,
      id: current.id,
      title: current.title,
      url: current.path,
      duration: current.durationMs === null ? 0 : Math.round(current.durationMs / 1000),
      durationMs: current.durationMs,
      video: { ...current },
    }
  }

  function requireCurrent() {
    if (current === null) throw videoError('VIDEO_NO_CURRENT', '还没有打开视频（先 open）')
  }

  function play() {
    requireCurrent()
    current.status = 'playing'
    return { ok: true, video: { ...current }, status: 'playing' }
  }

  function pause() {
    requireCurrent()
    current.status = 'paused'
    return { ok: true, video: { ...current }, status: 'paused' }
  }

  /** 读取同名旁注（.md > .srt > .txt；无则 summary:null）。 */
  function summary() {
    requireCurrent()
    const base = current.path.slice(0, current.path.length - path.extname(current.path).length)
    for (const ext of VIDEO_SIDECAR_EXTENSIONS) {
      const candidate = base + ext
      if (!existsSync(candidate)) continue
      try {
        const text = String(readFile(candidate) ?? '').trim().slice(0, 20000)
        return { ok: true, summary: text.length > 0 ? text : null, source: candidate, kind: ext.slice(1) }
      } catch (error) {
        throw videoError(LOCAL_VIDEO_CODES.readFailed, error instanceof Error ? error.message : String(error))
      }
    }
    return { ok: true, summary: null, source: null, kind: null }
  }

  function snapshot() {
    return { ok: true, version: LOCAL_VIDEO_PROVIDER_VERSION, id: 'local-video', kind: 'local', rootDir, current: current === null ? null : { ...current }, now: now() }
  }

  return { id: 'local-video', kind: 'local', rootDir, open, play, pause, summary, snapshot }
}
