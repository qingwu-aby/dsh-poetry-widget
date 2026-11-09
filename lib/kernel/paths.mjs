// lib/paths.mjs —— 包元数据、本地日期、路径脱敏等纯函数。
// 单独成文件的目的：不碰文件系统副作用，可被单测直接 import。
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 读 package.json 的 name/version（版本号唯一来源，宿主不重复维护字符串）。
 * 读不到 / 解析失败时返回 null 字段，调用方自行回退，绝不抛异常。
 * @param {string} packageJsonPath
 * @returns {{name: string|null, version: string|null}}
 */
export function readPackageMeta(packageJsonPath) {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    return {
      name: typeof parsed?.name === 'string' ? parsed.name : null,
      version: typeof parsed?.version === 'string' ? parsed.version : null,
    }
  } catch {
    return { name: null, version: null }
  }
}

/**
 * 本地时区的 `YYYY-MM-DD`（今日诗按"用户本地日期"轮换）。
 * @param {Date} [date]
 * @returns {string}
 */
export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** child 是否等于 parent 或位于其下（按路径段比较，防 `/a/bc` 误判为 `/a/b` 的子路径）。 */
function isInside(parent, child) {
  return child === parent || child.startsWith(parent + path.sep)
}

function toPosix(rel) {
  return rel.split(path.sep).join('/')
}

/**
 * 路径脱敏：HOME 前缀替换为 `~`，自定义 DSH_HOME 前缀替换为 `$DSH_HOME`，其余保持绝对路径。
 * 例：`/Users/x/.dsh/.dsh-poetry/settings.json` → `~/.dsh/.dsh-poetry/settings.json`；
 *     `DSH_HOME=/opt/dsh` 时 → `$DSH_HOME/.dsh-poetry/settings.json`。
 * @param {string} absPath
 * @param {{home?: string, dshHome?: string}} [options]
 * @returns {string}
 */
export function maskPath(absPath, options = {}) {
  if (typeof absPath !== 'string' || absPath.length === 0) return ''
  const home = typeof options.home === 'string' && options.home.length > 0 ? path.resolve(options.home) : null
  const resolved = path.resolve(absPath)
  if (home !== null && isInside(home, resolved)) {
    return `~/${toPosix(path.relative(home, resolved))}`
  }
  const dshHome = typeof options.dshHome === 'string' && options.dshHome.trim().length > 0 ? path.resolve(options.dshHome) : null
  if (dshHome !== null && isInside(dshHome, resolved)) {
    return `$DSH_HOME/${toPosix(path.relative(dshHome, resolved))}`
  }
  return resolved
}

/**
 * 当前进程的 HOME / DSH_HOME 信息（供 maskPath 与设置目录解析共用）。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{home: string, dshHome: string|null}}
 */
export function homeContext(env = process.env) {
  const home = typeof env?.HOME === 'string' && env.HOME.length > 0 ? env.HOME : os.homedir()
  const dshHome = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0 ? env.DSH_HOME.trim() : null
  return { home, dshHome }
}
