// lib/pet-media.mjs —— dsh-pet 透明动画素材（webm）接入（契约 v1.12 §2.15，M18a）。
//
// 素材来自 PC2005-cloud/dsh-pet（MIT）：106 个透明 webm（52MB）+ catalog.json + ATTRIBUTION，
// 落在项目同级 `_ref/pet-media/`（**不随插件包**，`DSH_PET_MEDIA_DIR` 可覆盖）。
//
// 本模块提供三件事：
//   1. 启动时读取/校验 catalog.json，把 `media:'video'` 条目并入心情图鉴（mood-ai 的模型
//      可以从 106 个动画里选，`image` 返回 `webm/<名>.webm`）；
//   2. 只读静态路由处理器 `GET/HEAD /api/dsh-poetry/pet-media?f=<相对路径>`
//      （白名单 catalog.json + webm/*.webm；**不套信任栅栏**，供 `<video>` 直接加载）；
//   3. 路径/图鉴校验失败一律静默降级（404 或空条目），绝不抛异常。
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

/** 静态路由路径（与 assets 并列）。 */
export const PET_MEDIA_ROUTE = '/api/dsh-poetry/pet-media'
/** 允许的媒体类型。 */
export const PET_MEDIA_KINDS = Object.freeze(['video'])
/** 缓存头（与 assets 一致）。 */
export const PET_MEDIA_CACHE_CONTROL = 'public, max-age=3600'

/**
 * 解析素材目录：`DSH_PET_MEDIA_DIR` 优先，否则 `<pkgRoot>/../_ref/pet-media`。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} pkgRoot
 * @returns {string}
 */
export function resolvePetMediaDir(env = process.env, pkgRoot) {
  const custom = typeof env?.DSH_PET_MEDIA_DIR === 'string' ? env.DSH_PET_MEDIA_DIR.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  return path.resolve(String(pkgRoot ?? '.'), '..', '_ref', 'pet-media')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** 合法的 webm 相对路径：`webm/<非空文件名>.webm`，无 `..`/反斜杠/空字节/额外目录。 */
export function isSafeWebmRelative(file) {
  if (typeof file !== 'string') return false
  const rel = file.trim()
  if (rel.length === 0 || rel.length > 300) return false
  if (rel.includes('\0') || rel.includes('\\')) return false
  if (path.isAbsolute(rel)) return false
  const segments = rel.split('/')
  if (segments.length !== 2) return false
  const [dirName, fileName] = segments
  if (dirName !== 'webm') return false
  if (fileName.length === 0 || fileName === '.' || fileName === '..') return false
  return fileName.toLowerCase().endsWith('.webm')
}

/** 归一化 tags：字符串数组、去空/去重、上限 12。 */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null
  const out = []
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const value = tag.trim()
    if (value.length === 0 || out.includes(value)) continue
    out.push(value)
    if (out.length >= 12) break
  }
  return out
}

/**
 * 读取并校验 `<dir>/catalog.json`；失败返回 {ok:false,message}，绝不抛。
 * 返回的 entries 已过滤非法项、去重，且形状统一为：
 *   {file:'webm/x.webm', label, media:'video', scope:'mood', tags:[…]}
 * @param {{dir: string, logger?: {warn?: Function}|null}} options
 */
export function loadPetMediaCatalog(options) {
  const dir = path.resolve(options.dir)
  const logger = options.logger ?? null
  const warn = (message) => {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }
  const catalogFile = path.join(dir, 'catalog.json')
  let raw
  try {
    raw = readFileSync(catalogFile, 'utf8')
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? String(error.code ?? '') : ''
    const message =
      code === 'ENOENT' || code === 'ENOTDIR'
        ? `心情动画素材目录/图鉴不存在：${catalogFile}`
        : `心情动画素材图鉴读取失败：${shortMessage(error)}`
    return { ok: false, message, dir }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, message: `心情动画素材图鉴 JSON 损坏：${shortMessage(error)}`, dir }
  }
  if (!isPlainObject(parsed) || parsed.ok !== true || parsed.v !== 1) {
    return { ok: false, message: '心情动画素材图鉴格式不符（ok/v）', dir }
  }
  if (!Array.isArray(parsed.entries)) {
    return { ok: false, message: '心情动画素材图鉴缺少 entries 数组', dir }
  }

  const entries = []
  const seen = new Set()
  let dropped = 0
  for (const item of parsed.entries) {
    if (!isPlainObject(item)) {
      dropped += 1
      continue
    }
    const file = typeof item.file === 'string' ? item.file.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const tags = normalizeTags(item.tags)
    const media = typeof item.media === 'string' ? item.media.trim() : ''
    if (!isSafeWebmRelative(file) || label.length === 0 || media !== 'video' || tags === null) {
      dropped += 1
      continue
    }
    if (seen.has(file)) continue
    seen.add(file)
    entries.push({
      file,
      label,
      media: 'video',
      scope: 'mood',
      tags,
    })
  }
  if (entries.length === 0) {
    return { ok: false, message: '心情动画素材图鉴没有可用视频条目', dir }
  }
  if (dropped > 0) warn(`心情动画素材图鉴已过滤 ${dropped} 条非法条目`)
  return {
    ok: true,
    dir,
    entries,
    source: typeof parsed.source === 'string' ? parsed.source : '',
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null,
  }
}

/**
 * 把视频条目并入 mood-ai 图鉴（返回新对象，绝不修改入参）。
 *   · 原有图片补 `media:'image'`（若没有），视频条目追加 `media:'video', scope:'mood'`；
 *   · 按 file 去重；保留 panelImages / version 等其它字段；
 *   · petEntries 为空时返回浅拷贝（moodImages 内容保持原样）。
 * @param {object|null|undefined} moodCatalog - normalizeMoodCatalog 结果
 * @param {Array<object>|null|undefined} petEntries - loadPetMediaCatalog().entries
 */
export function mergePetMediaIntoMoodCatalog(moodCatalog, petEntries) {
  const base = isPlainObject(moodCatalog) ? moodCatalog : null
  const baseMoodImages = Array.isArray(base?.moodImages) ? base.moodImages : []
  const basePanelImages = Array.isArray(base?.panelImages) ? base.panelImages : []
  const entries = Array.isArray(petEntries) ? petEntries.filter(isPlainObject) : []
  const baseFiles = base?.files instanceof Set ? base.files : new Set()

  if (entries.length === 0) {
    return {
      ...(base ?? {}),
      moodImages: baseMoodImages.map((image) =>
        isPlainObject(image) ? { ...image, tags: Array.isArray(image.tags) ? [...image.tags] : [] } : image,
      ),
      panelImages: [...basePanelImages],
      files: new Set(baseFiles),
    }
  }

  const files = new Set()
  const moodImages = []
  for (const image of baseMoodImages) {
    if (!isPlainObject(image) || typeof image.file !== 'string') continue
    files.add(image.file)
    moodImages.push({
      ...image,
      tags: Array.isArray(image.tags) ? [...image.tags] : [],
      media: image.media === 'video' ? 'video' : 'image',
    })
  }
  for (const entry of entries) {
    if (typeof entry.file !== 'string' || files.has(entry.file)) continue
    files.add(entry.file)
    moodImages.push({
      file: entry.file,
      label: typeof entry.label === 'string' ? entry.label : '',
      tags: normalizeTags(entry.tags) ?? [],
      media: 'video',
      scope: 'mood',
    })
  }
  return {
    ...(base ?? {}),
    moodImages,
    panelImages: [...basePanelImages],
    files,
    videoCount: entries.filter((entry) => typeof entry.file === 'string').length,
  }
}

/**
 * 白名单路径解析：只允许 `catalog.json` 与 `webm/<文件名>.webm`。
 * @returns {{file: string, contentType: string}|null}
 */
function resolveAllowedFile(root, relative) {
  if (typeof relative !== 'string' || relative.length === 0) return null
  const rel = relative.trim()
  if (rel.length === 0 || rel.includes('\0') || rel.includes('\\')) return null
  if (path.isAbsolute(rel)) return null
  const segments = rel.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return null

  let contentType = ''
  if (rel === 'catalog.json') {
    contentType = 'application/json; charset=utf-8'
  } else if (segments.length === 2 && segments[0] === 'webm' && segments[1].toLowerCase().endsWith('.webm')) {
    contentType = 'video/webm'
  } else {
    return null
  }
  const file = path.resolve(root, rel)
  if (!file.startsWith(root + path.sep)) return null
  return { file, contentType }
}

function notFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end('not found')
}

/**
 * 创建 pet-media 静态资源处理器（只读，不套信任栅栏）。
 * @param {{dir: string, logger?: {warn?: Function}|null}} options
 */
export function createPetMediaHandler(options) {
  const root = path.resolve(options.dir)
  let rootReal = null
  function realRoot() {
    if (rootReal === null) {
      try {
        rootReal = realpathSync(root)
      } catch {
        rootReal = root
      }
    }
    return rootReal
  }

  return async function petMediaHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end('method not allowed')
      return
    }
    try {
      const url = new URL(String(req?.url ?? '/'), 'http://127.0.0.1')
      const allowed = resolveAllowedFile(root, url.searchParams.get('f') ?? '')
      if (allowed === null) {
        notFound(res)
        return
      }
      let stat
      try {
        stat = statSync(allowed.file)
      } catch {
        notFound(res)
        return
      }
      if (!stat.isFile()) {
        notFound(res)
        return
      }
      // 符号链接逃逸防护：真实路径必须仍在素材目录内。
      try {
        const real = realpathSync(allowed.file)
        const base = realRoot()
        if (real !== base && !real.startsWith(base + path.sep)) {
          notFound(res)
          return
        }
      } catch {
        notFound(res)
        return
      }
      res.writeHead(200, {
        'Content-Type': allowed.contentType,
        'Content-Length': String(stat.size),
        'Cache-Control': PET_MEDIA_CACHE_CONTROL,
      })
      if (method === 'HEAD') {
        res.end()
        return
      }
      const stream = createReadStream(allowed.file)
      stream.on('error', () => {
        try {
          if (!res.headersSent) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('not found')
          } else {
            res.destroy()
          }
        } catch {
          /* ignore */
        }
      })
      res.on?.('close', () => stream.destroy())
      stream.pipe(res)
    } catch {
      // 任何异常都收敛为 404，不向客户端泄漏内部细节。
      notFound(res)
    }
  }
}

/** 仅用于诊断：素材目录是否存在。 */
export function petMediaDirExists(dir) {
  try {
    return existsSync(dir)
  } catch {
    return false
  }
}
