// DeepSeek API Key 安全落盘：只存在私有文件（0600），API 不回显完整 key。
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEEPSEEK_KEY_MIN = 20
export const DEEPSEEK_KEY_MAX = 300

export function resolveDeepSeekKeyPath(env = process.env, home = null) {
  const base =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.resolve(env.DSH_HOME.trim())
      : path.join(home ?? (typeof env?.HOME === 'string' && env.HOME.length > 0 ? env.HOME : os.homedir()), '.dsh')
  return path.join(base, '.dsh-poetry', 'deepseek-api-key')
}

function sanitize(value) {
  return typeof value === 'string' ? value.trim().replace(/[\r\n\t]/g, '') : ''
}

export function readStoredDeepSeekKey(env = process.env, home = null) {
  try {
    const raw = readFileSync(resolveDeepSeekKeyPath(env, home), 'utf8')
    const key = sanitize(raw)
    return key.length >= DEEPSEEK_KEY_MIN && key.length <= DEEPSEEK_KEY_MAX ? key : ''
  } catch {
    return ''
  }
}

export function writeStoredDeepSeekKey(key, env = process.env, home = null) {
  const value = sanitize(key)
  if (value.length < DEEPSEEK_KEY_MIN || value.length > DEEPSEEK_KEY_MAX) {
    return { ok: false, error: `key 长度必须是 ${DEEPSEEK_KEY_MIN}–${DEEPSEEK_KEY_MAX} 字符` }
  }
  const file = resolveDeepSeekKeyPath(env, home)
  const tmp = file + '.tmp-' + process.pid
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(tmp, value + '\n', { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, file)
    return { ok: true, file }
  } catch (error) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* ignore */ }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function clearStoredDeepSeekKey(env = process.env, home = null) {
  try {
    const file = resolveDeepSeekKeyPath(env, home)
    if (existsSync(file)) unlinkSync(file)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function deepSeekKeyStatus(env = process.env, home = null) {
  const file = resolveDeepSeekKeyPath(env, home)
  const envKey = sanitize(env?.DSH_POETRY_DEEPSEEK_API_KEY || env?.DEEPSEEK_API_KEY)
  const stored = readStoredDeepSeekKey(env, home)
  const key = envKey || stored
  return {
    ok: true,
    configured: key.length > 0,
    source: envKey ? 'env' : stored ? 'file' : 'none',
    last4: key.length >= 4 ? key.slice(-4) : '',
    file,
  }
}
