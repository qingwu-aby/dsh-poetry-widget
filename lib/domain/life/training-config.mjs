// @ts-check
// lib/domain/life/training-config.mjs —— 训练旁路配置（Gate G2，默认关闭）。
//
// 目标：给“训练旁路”一个可校验的配置文件与默认值，但**不启动训练、不写 adapter**：
//   · 文件：$DSH_HOME/.dsh-poetry/training-config.json（原子写、schema 版本 1、默认关闭）；
//   · 字段：enabled(默认 false)、intervalDays、dataset{sources,minEntries}、
//     hyperparams{rank,steps,lr}、eval{minScore}、adapter{current,candidate,previous?}；
//   · 读取：缺文件/坏 JSON/非法字段 → 默认值 + errors[]（不抛错）；
//   · 写入：先归一化（非法值回退默认并报告），再原子写（0600）。
//
// 纯逻辑：只读写这一个配置文件；不联网/无宿主依赖；时钟可注入。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'

/** 配置 schema 版本。 */
export const TRAINING_CONFIG_VERSION = 1

/** 配置文件名（相对 $DSH_HOME/.dsh-poetry/）。 */
export const TRAINING_CONFIG_FILE_NAME = 'training-config.json'

/** 允许的数据来源白名单。 */
export const TRAINING_DATASET_SOURCES = Object.freeze(['journal', 'chat', 'game-memory', 'methods', 'feedback'])

/** 默认配置（默认关闭；空配置 = 不训练）。 */
export function defaultTrainingConfig() {
  return {
    enabled: false,
    intervalDays: 7,
    dataset: { sources: [], minEntries: 200 },
    hyperparams: { rank: 8, steps: 300, lr: 0.0001 },
    eval: { minScore: 0.6 },
    adapter: { current: 'adapters-live', candidate: null, previous: null },
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readInt(value, fallback, min, max) {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

function readNumber(value, fallback, min, max) {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

function readName(value, fallback, max = 80) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max && !/[\p{Cc}]/u.test(trimmed) ? trimmed : fallback
}

/** $DSH_HOME/.dsh-poetry/training-config.json 的绝对路径。 */
export function resolveTrainingConfigFile(home) {
  const base = typeof home === 'string' && home.length > 0 ? home : process.env.HOME || process.cwd()
  return path.join(base, '.dsh-poetry', TRAINING_CONFIG_FILE_NAME)
}

/**
 * 归一化训练配置（纯函数）：非法值回退默认并记录 errors，永不抛错。
 * @param {unknown} raw
 * @returns {{ok: true, config: object, errors: Array<{path: string, message: string}>}}
 */
export function normalizeTrainingConfig(raw) {
  const config = defaultTrainingConfig()
  const errors = []
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) errors.push({ path: '$', message: '训练配置必须是对象' })
    return { ok: true, config, errors }
  }
  const source = /** @type {Record<string, any>} */ (raw)
  if (source.enabled !== undefined) {
    if (typeof source.enabled !== 'boolean') errors.push({ path: 'enabled', message: 'enabled 必须是布尔' })
    else config.enabled = source.enabled
  }
  if (source.intervalDays !== undefined) {
    const value = readInt(source.intervalDays, null, 1, 90)
    if (value === null) errors.push({ path: 'intervalDays', message: 'intervalDays 必须是 1–90 的整数' })
    else config.intervalDays = value
  }
  if (source.dataset !== undefined) {
    if (!isPlainObject(source.dataset)) {
      errors.push({ path: 'dataset', message: 'dataset 必须是对象' })
    } else {
      if (source.dataset.sources !== undefined) {
        if (!Array.isArray(source.dataset.sources)) {
          errors.push({ path: 'dataset.sources', message: 'dataset.sources 必须是数组' })
        } else {
          const sources = []
          for (const item of source.dataset.sources) {
            if (typeof item === 'string' && TRAINING_DATASET_SOURCES.indexOf(item.trim()) >= 0) {
              if (sources.indexOf(item.trim()) < 0) sources.push(item.trim())
            } else {
              errors.push({ path: 'dataset.sources', message: `未知数据来源：${String(item)}` })
            }
          }
          config.dataset.sources = sources
        }
      }
      if (source.dataset.minEntries !== undefined) {
        const value = readInt(source.dataset.minEntries, null, 1, 100_000)
        if (value === null) errors.push({ path: 'dataset.minEntries', message: 'dataset.minEntries 必须是 1–100000 的整数' })
        else config.dataset.minEntries = value
      }
    }
  }
  if (source.hyperparams !== undefined) {
    if (!isPlainObject(source.hyperparams)) {
      errors.push({ path: 'hyperparams', message: 'hyperparams 必须是对象' })
    } else {
      if (source.hyperparams.rank !== undefined) {
        const value = readInt(source.hyperparams.rank, null, 1, 128)
        if (value === null) errors.push({ path: 'hyperparams.rank', message: 'rank 必须是 1–128 的整数' })
        else config.hyperparams.rank = value
      }
      if (source.hyperparams.steps !== undefined) {
        const value = readInt(source.hyperparams.steps, null, 1, 100_000)
        if (value === null) errors.push({ path: 'hyperparams.steps', message: 'steps 必须是 1–100000 的整数' })
        else config.hyperparams.steps = value
      }
      if (source.hyperparams.lr !== undefined) {
        const value = readNumber(source.hyperparams.lr, null, 0, 1)
        if (value === null || value === 0) errors.push({ path: 'hyperparams.lr', message: 'lr 必须是 (0,1] 内的数字' })
        else config.hyperparams.lr = value
      }
    }
  }
  if (source.eval !== undefined) {
    if (!isPlainObject(source.eval)) {
      errors.push({ path: 'eval', message: 'eval 必须是对象' })
    } else if (source.eval.minScore !== undefined) {
      const value = readNumber(source.eval.minScore, null, 0, 1)
      if (value === null) errors.push({ path: 'eval.minScore', message: 'eval.minScore 必须是 0–1 的数字' })
      else config.eval.minScore = value
    }
  }
  if (source.adapter !== undefined) {
    if (!isPlainObject(source.adapter)) {
      errors.push({ path: 'adapter', message: 'adapter 必须是对象' })
    } else {
      const current = readName(source.adapter.current, null)
      if (source.adapter.current !== undefined && current === null) {
        errors.push({ path: 'adapter.current', message: 'adapter.current 必须是 1–80 字非空字符串' })
      } else if (current !== null) {
        config.adapter.current = current
      }
      const candidate = source.adapter.candidate === null ? null : readName(source.adapter.candidate, null)
      if (source.adapter.candidate !== undefined && source.adapter.candidate !== null && candidate === null) {
        errors.push({ path: 'adapter.candidate', message: 'adapter.candidate 必须是 null 或非空字符串' })
      } else {
        config.adapter.candidate = candidate
      }
      const previous = source.adapter.previous === null ? null : readName(source.adapter.previous, null)
      if (source.adapter.previous !== undefined && source.adapter.previous !== null && previous === null) {
        errors.push({ path: 'adapter.previous', message: 'adapter.previous 必须是 null 或非空字符串' })
      } else {
        config.adapter.previous = previous
      }
    }
  }
  return { ok: true, config, errors }
}

/**
 * 创建训练配置存储。
 * @param {{home?: string, file?: string, logger?: {warn?: Function}|null, now?: () => number}} [options]
 */
export function createTrainingConfigStore(options = {}) {
  const file =
    typeof options.file === 'string' && options.file.length > 0 ? options.file : resolveTrainingConfigFile(options.home)
  const logger = /** @type {any} */ (options.logger ?? null)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  function read() {
    let raw = null
    let exists = false
    const errors = []
    try {
      exists = existsSync(file)
      if (exists) raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      errors.push({ path: '$', message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` })
      raw = null
    }
    const normalized = normalizeTrainingConfig(raw ?? undefined)
    return {
      ok: true,
      file,
      exists,
      config: normalized.config,
      errors: errors.concat(normalized.errors),
      updatedAt: isPlainObject(raw) && Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
    }
  }

  function write(rawConfig) {
    const normalized = normalizeTrainingConfig(rawConfig)
    const payload = {
      version: TRAINING_CONFIG_VERSION,
      updatedAt: now(),
      ...normalized.config,
    }
    const written = writeJsonAtomic(file, payload)
    if (written.ok !== true) {
      try {
        logger?.warn?.(`[dsh-little-whale] 写入训练配置失败：${written.message ?? ''}`)
      } catch (error) {
        void error
      }
      return { ok: false, message: written.message ?? 'write failed', config: normalized.config, errors: normalized.errors }
    }
    return { ok: true, config: normalized.config, errors: normalized.errors, updatedAt: payload.updatedAt }
  }

  function reset() {
    return write(defaultTrainingConfig())
  }

  function snapshot() {
    const state = read()
    return { ok: true, file, exists: state.exists, version: TRAINING_CONFIG_VERSION, config: state.config, errors: state.errors, updatedAt: state.updatedAt }
  }

  return { file, read, write, reset, snapshot }
}
