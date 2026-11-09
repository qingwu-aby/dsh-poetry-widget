// @ts-check
// lib/kernel/json-store.mjs —— 统一 JSON 持久化（W1 基础设施，v0）
//
// - 读取：缺文件/坏文件 → fallback（并可选 onError 回调），不再抛异常；
// - 写入：临时文件 + rename 原子写；可选写前备份；
// - 版本：migrate(raw) 在 normalize 之前执行；
// - 所有域迁移到这个 store 后，状态文件才进入 schema 注册表。
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const BACKUP_LIMIT = 3

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function rotateBackups(file) {
  try {
    const dir = path.dirname(file)
    const base = path.basename(file)
    const backups = readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.bak-`))
      .sort()
    while (backups.length >= BACKUP_LIMIT) {
      const oldest = backups.shift()
      try {
        unlinkSync(path.join(dir, oldest))
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} file
 * @param {{ normalizer?: Function, migrate?: Function, fallback?: Function, onError?: Function }} options
 */
export function readJson(file, options = {}) {
  const fallback = typeof options.fallback === 'function' ? options.fallback : () => null
  try {
    if (!existsSync(file)) return fallback()
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const migrated = typeof options.migrate === 'function' ? options.migrate(raw) : raw
    return typeof options.normalizer === 'function' ? options.normalizer(migrated) : migrated
  } catch (error) {
    try {
      options.onError?.(error, file)
    } catch {
      /* ignore */
    }
    return fallback()
  }
}

/**
 * @param {string} file
 * @param {unknown} state
 * @param {{ normalizer?: Function, validate?: Function, backup?: boolean }} options
 */
export function writeJson(file, state, options = {}) {
  const normalizer = typeof options.normalizer === 'function' ? options.normalizer : (value) => value
  const next = normalizer(state)
  if (typeof options.validate === 'function') {
    const message = options.validate(next)
    if (typeof message === 'string' && message.length > 0) throw new Error(`invalid state for ${file}: ${message}`)
  }
  mkdirSync(path.dirname(file), { recursive: true })
  if (options.backup === true && existsSync(file)) {
    rotateBackups(file)
    copyFileSync(file, `${file}.bak-${timestamp()}`)
  }
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
  return next
}

/** 绑定一个文件的读写器：域模块只依赖这个对象，不再自己碰 fs。 */
export function createJsonStore(options = {}) {
  const file = path.resolve(String(options.file ?? ''))
  if (file.length === 0) throw new Error('createJsonStore: file required')
  const normalizer = typeof options.normalizer === 'function' ? options.normalizer : (value) => value
  const migrate = typeof options.migrate === 'function' ? options.migrate : null
  const fallback = typeof options.fallback === 'function' ? options.fallback : () => normalizer(options.empty ?? {})
  return {
    file,
    read() {
      return readJson(file, { normalizer, migrate, fallback, onError: options.onError })
    },
    write(state) {
      return writeJson(file, state, { normalizer, validate: options.validate, backup: options.backup === true })
    },
    exists() {
      return existsSync(file)
    },
  }
}
