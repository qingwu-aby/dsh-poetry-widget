// lib/memory-journal.mjs —— 「模型自己的记忆日志」只追加写入（契约 v1.10 §2.13，M14）。
//
// 用户要求：把模型**自己生成**的碎碎念（self-talk murmur）与心情决定（mood-ai）
// 持久保存到独立记忆文档，不随会话丢失；**只追加，不改写/删除**；绝不写入任何
// 聊天内容、用户原文、query 参数或运行数据——这里只有模型自己说出口的文字。
//
// 目录：`DSH_AGENT_MEMORY_DIR` 优先，否则 `$DSH_HOME/agent-memory`（DSH_HOME 未设则 ~/.dsh）。
// 文件：
//   · journal.jsonl —— 一行一条 JSON {ts, kind:'murmur'|'mood', text?, label?, reason?, image?, model?}
//   · journal.md    —— 人类可读追加条目（`## YYYY-MM-DD HH:mm · 类型` + 内容）
// 文件不存在时首次 append 会补 md 头部；已存在则绝不覆盖。写失败只 logger.warn，不抛给调用方。
//
// v1.21（M28）写入限频（仍只追加、不改写）：
//   · mood：**不再限频/去重**——用户要求「心情都是回忆的一部分」，每条 mood 都写（md/jsonl）；
//   · murmur：文本与上一条 murmur 相同则跳过；距上次 murmur 写入 <3min 也跳过（最多 3min 一条碎碎念）；
//   · thought：永远写（不受限）；
//   · 跳过只影响 journal（md/jsonl 同步跳过），不影响 mood-ai/self-talk 路由响应。
import { appendFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** journal.md 只在文件不存在时写入的头部。 */
export const MEMORY_JOURNAL_HEADER = '# 我的碎碎念与想法\n\n> 只追加。过去的条目不改写。\n'

/** 单条内容默认截断长度（按 Unicode 字符数）。 */
export const MEMORY_MAX_ENTRY_CHARS = 500

/** kind → journal.md 里的中文类型标签。 */
export const MEMORY_KIND_LABELS = Object.freeze({
  murmur: '碎碎念',
  mood: '心情',
  thought: '想法',
})

/** murmur 写入最小间隔：3 分钟（journal 里最多 3min 一条碎碎念；mood 不限频）。 */
export const JOURNAL_MURMUR_MIN_INTERVAL_MS = 3 * 60 * 1000

/**
 * 解析记忆目录：
 *   · `DSH_AGENT_MEMORY_DIR`（显式配置，优先）；
 *   · 否则 `$DSH_HOME/agent-memory`；DSH_HOME 未设则 `~/.dsh/agent-memory`。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string|null} [home]
 * @returns {string}
 */
export function resolveMemoryDir(env = process.env, home = null) {
  const custom = typeof env?.DSH_AGENT_MEMORY_DIR === 'string' ? env.DSH_AGENT_MEMORY_DIR.trim() : ''
  if (custom.length > 0) return path.resolve(custom)
  const dshHome =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
      ? path.resolve(env.DSH_HOME.trim())
      : path.join(home ?? (typeof env?.HOME === 'string' && env.HOME.length > 0 ? env.HOME : os.homedir()), '.dsh')
  return path.join(dshHome, 'agent-memory')
}

/** 时间戳 → journal.md 标题里的本地时间 `YYYY-MM-DD HH:mm`。 */
export function formatJournalTime(ts = Date.now()) {
  const date = new Date(ts)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 字段归一：去控制字符/换行、折叠空白、trim、按码点截断。 */
function normalizeField(value, maxChars) {
  if (typeof value !== 'string') return ''
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(cleaned)
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : cleaned
}

/** 只保留合法的 model 标识（provider/model），其余字段绝不上盘。 */
function normalizeModel(model) {
  if (!isPlainObject(model)) return null
  const provider = typeof model.provider === 'string' ? model.provider.trim() : ''
  const name = typeof model.model === 'string' ? model.model.trim() : ''
  if (provider.length === 0 && name.length === 0) return null
  return { ...(provider.length > 0 ? { provider } : {}), ...(name.length > 0 ? { model: name } : {}) }
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 创建记忆日志写入器（只追加）。
 * @param {{
 *   dir: string,
 *   logger?: {warn?: Function}|null,
 *   now?: () => number,
 *   maxEntryChars?: number,
 * }} options
 */
export function createMemoryJournal(options) {
  const dir = path.resolve(options.dir)
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxChars =
    Number.isFinite(options.maxEntryChars) && options.maxEntryChars > 0
      ? Math.floor(options.maxEntryChars)
      : MEMORY_MAX_ENTRY_CHARS
  const jsonlPath = path.join(dir, 'journal.jsonl')
  const mdPath = path.join(dir, 'journal.md')

  let dirReady = null
  let mdHeaderEnsured = false
  /** v1.20/1.21 限频状态：最近一条成功写入的 murmur（跳过不更新；mood 不再限频）。 */
  let lastMurmurWrite = null
  /** 串行队列：保证两条 append 的 md/jsonl 顺序一致、不交错。 */
  let queue = Promise.resolve()

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function ensureDir() {
    if (dirReady === null) {
      dirReady = mkdir(dir, { recursive: true }).catch((error) => {
        dirReady = null
        throw error
      })
    }
    return dirReady
  }

  /** journal.md 不存在时补头部（已存在绝不覆盖）。 */
  async function ensureMdHeader() {
    if (mdHeaderEnsured) return
    if (existsSync(mdPath)) {
      mdHeaderEnsured = true
      return
    }
    await appendFile(mdPath, MEMORY_JOURNAL_HEADER, 'utf8')
    mdHeaderEnsured = true
  }

  /** 由 entry 生成 jsonl 行与 md 块；非法 entry 返回 null。 */
  function buildEntry(entry) {
    if (!isPlainObject(entry)) return null
    const kind =
      entry.kind === 'mood' ? 'mood' : entry.kind === 'murmur' ? 'murmur' : entry.kind === 'thought' ? 'thought' : null
    if (kind === null) return null
    const ts = now()
    const model = normalizeModel(entry.model)
    const record = { ts, kind }

    let mdBody = ''
    if (kind === 'murmur' || kind === 'thought') {
      const text = normalizeField(entry.text, maxChars)
      if (text.length === 0) return null
      record.text = text
      mdBody = text
    } else {
      const label = normalizeField(entry.label, Math.min(maxChars, 80))
      const reason = normalizeField(entry.reason, Math.min(maxChars, 200))
      const image = normalizeField(entry.image, 120)
      if (label.length === 0) return null
      if (label.length > 0) record.label = label
      if (reason.length > 0) record.reason = reason
      if (image.length > 0) record.image = image
      mdBody = `心情：${label}${reason.length > 0 ? ` — ${reason}` : ''}${image.length > 0 ? `（${image}）` : ''}`
    }
    if (model !== null) record.model = model

    const jsonlLine = `${JSON.stringify(record)}\n`
    const mdBlock = `\n## ${formatJournalTime(ts)} · ${MEMORY_KIND_LABELS[kind]}\n${mdBody}\n`
    return { record, jsonlLine, mdBlock }
  }

  /**
   * 写入限频/去重：返回跳过原因或 null。
   * v1.21：mood 每条都写（回忆完整保留）；murmur 保留 3min 限频；thought 永远写。
   * 只影响 journal 写入；路由响应与视觉/接口实时性不受影响。
   */
  function throttleReason(record) {
    if (record.kind === 'mood') return null
    if (record.kind === 'murmur') {
      if (lastMurmurWrite === null) return null
      if (lastMurmurWrite.text === record.text) return 'same-murmur'
      if (record.ts - lastMurmurWrite.ts < JOURNAL_MURMUR_MIN_INTERVAL_MS) return 'murmur-throttled'
      return null
    }
    // thought（以及未来新增类型）：永远写。
    return null
  }

  async function doAppend(entry) {
    const built = buildEntry(entry)
    if (built === null) {
      warn('记忆日志收到无效条目，已忽略')
      return { ok: false, message: 'invalid entry' }
    }
    const skipReason = throttleReason(built.record)
    if (skipReason !== null) {
      return { ok: true, skipped: true, reason: skipReason, ts: built.record.ts }
    }
    try {
      await ensureDir()
      await ensureMdHeader()
      // 先写人类可读的 md，再写 jsonl；两者都只 append，绝不覆盖。
      await appendFile(mdPath, built.mdBlock, 'utf8')
      await appendFile(jsonlPath, built.jsonlLine, 'utf8')
      if (built.record.kind === 'murmur') {
        lastMurmurWrite = { ts: built.record.ts, text: built.record.text }
      }
      return { ok: true, ts: built.record.ts, jsonlPath, mdPath }
    } catch (error) {
      warn(`记忆日志写入失败：${shortMessage(error)}`)
      return { ok: false, message: shortMessage(error) }
    }
  }

  return {
    dir,
    jsonlPath,
    mdPath,
    /**
     * 追加一条记忆（只追加；失败只 warn，不抛）。
     * @param {{kind:'murmur'|'mood'|'thought', text?: string, label?: string, reason?: string, image?: string, model?: {provider?: string, model?: string}}} entry
     * @returns {Promise<{ok: boolean, ts?: number, skipped?: boolean, reason?: string, message?: string}>}
     */
    append(entry) {
      const run = queue.then(() => doAppend(entry))
      queue = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
}
