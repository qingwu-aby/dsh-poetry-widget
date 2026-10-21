// lib/assets.mjs —— `/api/dsh-poetry/assets?f=<相对路径>` 只读静态资源路由。
//
// 从 M0 的 index.js 原样重构出来，行为保持不变：只读、仅 GET/HEAD、
// `Cache-Control: public, max-age=3600`、路径越界/不存在统一 404。
// 不套信任栅栏（契约 §1：静态资源只读、不暴露敏感信息；宿主根路径护栏另由 Host 负责）。
import { createReadStream, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

/** 允许静态提供的扩展名 → MIME。 */
export const ASSET_MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
})

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders })
  res.end(text)
}

/**
 * 把请求参数 `f` 解析为 assets 目录内的安全路径；越界/非法返回 null。
 * @param {string} assetsDir - 已 resolve 的绝对目录
 * @param {string} relative
 * @returns {string|null}
 */
export function resolveAssetPath(assetsDir, relative) {
  if (typeof relative !== 'string' || relative.length === 0) return null
  if (relative.includes('\0') || relative.includes('\\')) return null
  const target = path.normalize(path.join(assetsDir, relative))
  if (target !== assetsDir && !target.startsWith(assetsDir + path.sep)) return null
  // 以 "." 开头的段（隐藏文件）不对外提供。
  const relFromRoot = path.relative(assetsDir, target)
  if (relFromRoot.split(path.sep).some((part) => part.startsWith('.'))) return null
  return target
}

/**
 * 创建静态资源 handler。
 * @param {{assetsDir: string}} options
 * @returns {(req: unknown, res: unknown) => Promise<void>}
 */
export function createAssetHandler({ assetsDir }) {
  const root = path.resolve(assetsDir)

  function realRoot() {
    try {
      return realpathSync(root)
    } catch {
      return root
    }
  }

  return async function assetHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, 'method not allowed', { Allow: 'GET, HEAD' })
      return
    }
    try {
      const url = new URL(String(req?.url ?? '/'), 'http://127.0.0.1')
      // f 的值可能带形如 `?v=3` 的版本尾巴（M0 客户端拼法），剥掉再解析。
      const relative = (url.searchParams.get('f') ?? '').split('?')[0]
      const file = resolveAssetPath(root, relative)
      if (file === null) {
        sendText(res, 404, 'not found')
        return
      }
      let stat
      try {
        stat = statSync(file)
      } catch {
        sendText(res, 404, 'not found')
        return
      }
      if (!stat.isFile()) {
        sendText(res, 404, 'not found')
        return
      }
      // 符号链接逃逸防护：真实路径必须仍在 assets 目录内。
      try {
        const real = realpathSync(file)
        const base = realRoot()
        if (real !== base && !real.startsWith(base + path.sep)) {
          sendText(res, 404, 'not found')
          return
        }
      } catch {
        sendText(res, 404, 'not found')
        return
      }
      const type = ASSET_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': String(stat.size),
        'Cache-Control': 'public, max-age=3600',
      })
      if (method === 'HEAD') {
        res.end()
        return
      }
      const stream = createReadStream(file)
      // 读流错误（stat 与 open 之间文件被删等）必须就地消化，否则会成未捕获异常。
      stream.on('error', () => {
        try {
          if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.destroy()
        } catch {
          /* ignore */
        }
      })
      res.on?.('close', () => stream.destroy())
      stream.pipe(res)
    } catch (error) {
      // 静态路由的兜底：任何异常都收敛成 404/400，绝不抛给宿主。
      sendText(res, 400, String(error instanceof Error ? error.message : error))
    }
  }
}
