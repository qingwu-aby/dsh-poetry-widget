// lib/gui-push.mjs —— 把她的主动留言真正推到对话里（v2.77）
//
// 问题：主动消息只会排进 gui-inbox，等用户下次在「小鲸鱼（对话）」里开口才被带出；
// 用户不开口就永远看不到，于是“很少主动发消息”。
// 做法：她真有一条要留的话时，用宿主的 schedule 服务，在对话会话里投递一条一次性提醒；
// 会话被激活后由传话层用 drainOnly 调 little_whale_chat，把留言原样输出——不用用户先说话。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const GUI_PUSH_TITLE = '小鲸鱼留言'
export const GUI_PUSH_PROMPT =
  '【小鲸鱼留言检查】这条不是你用户说的话，不要把它转给她。调用 little_whale_chat 工具：peerId 用 gui，drainOnly 传 true；把工具返回的文字原样输出；如果返回「（没有新留言）」，就只回这一句。'
export const GUI_PUSH_MAX_AGE_MS = 10 * 60 * 1000

/** Session 目录名：cwd 的每个 / 换成 -，再包一层 --...--。 */
export function sessionDirName(cwd) {
  return '-' + String(cwd).replace(/\//g, '-') + '--'
}

/** 从 workspace 存储里找出该工作区分组的最新会话（按会话目录 mtime）。 */
export function findRelaySessionId(options = {}) {
  const workspaceFile = String(options.workspaceFile ?? '')
  const sessionsRoot = String(options.sessionsRoot ?? '')
  const workspacePath = String(options.workspacePath ?? '')
  if (workspaceFile.length === 0 || sessionsRoot.length === 0 || workspacePath.length === 0) return null
  let tables = null
  try {
    tables = JSON.parse(readFileSync(workspaceFile, 'utf8'))
  } catch {
    return null
  }
  const workspaces = tables && tables.tables && tables.tables.workspaces && typeof tables.tables.workspaces === 'object' ? tables.tables.workspaces : null
  if (workspaces === null) return null
  const target = Object.values(workspaces).find((item) => item && item.path === workspacePath)
  if (!target || !Array.isArray(target.sessionIds) || target.sessionIds.length === 0) return null
  const dir = path.join(sessionsRoot, sessionDirName(workspacePath))
  let newest = null
  for (const sessionId of target.sessionIds) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue
    const sessionDir = path.join(dir, `session-${sessionId}`)
    const log = path.join(sessionDir, 'session.v4.jsonl.zstd')
    if (!existsSync(log)) continue
    let mtime = 0
    try {
      mtime = statSync(log).mtimeMs
    } catch {
      continue
    }
    if (newest === null || mtime > newest.mtime) newest = { sessionId, mtime }
  }
  return newest === null ? null : newest.sessionId
}

export function createGuiPush(options = {}) {
  const schedule = options.schedule ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const env = options.env ?? process.env
  const workspaceFile = options.workspaceFile
  const sessionsRoot = options.sessionsRoot
  const workspacePath = options.workspacePath
  const minGapMs = Number.isFinite(options.minGapMs) && options.minGapMs > 0 ? options.minGapMs : 60 * 1000
  const getSessionId = typeof options.getSessionId === 'function' ? options.getSessionId : () => findRelaySessionId({ workspaceFile, sessionsRoot, workspacePath })
  const disabled = String(env.DSH_POETRY_PUSH ?? '').toLowerCase() === 'off'
  let lastArmAt = 0
  let inFlight = false

  async function hasArmedReminder(sessionId) {
    try {
      if (typeof schedule.list !== 'function') return false
      const records = await schedule.list({ sessionId })
      if (!Array.isArray(records)) return false
      return records.some((record) => record && record.title === GUI_PUSH_TITLE)
    } catch {
      return false
    }
  }

  /** 她有一条留言 → 在对话会话里预约一次提醒（有几条就投一次；已有一条待投就不重复）。 */
  async function ping() {
    if (disabled || schedule === null || typeof schedule.create !== 'function') return { ok: false, reason: 'disabled' }
    if (inFlight) return { ok: false, reason: 'busy' }
    if (lastArmAt > 0 && now() - lastArmAt < minGapMs) return { ok: false, reason: 'recent' }
    inFlight = true
    try {
      const sessionId = getSessionId()
      if (sessionId === null) return { ok: false, reason: 'no-session' }
      if (await hasArmedReminder(sessionId)) {
        lastArmAt = now()
        return { ok: false, reason: 'already-armed' }
      }
      await schedule.create(sessionId, { title: GUI_PUSH_TITLE, prompt: GUI_PUSH_PROMPT, after_seconds: 2 })
      lastArmAt = now()
      logger?.info?.(`[dsh-little-whale] 已在对话会话里预约推送：${sessionId}`)
      return { ok: true, sessionId }
    } catch (error) {
      logger?.warn?.(`[dsh-little-whale] 对话推送预约失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    } finally {
      inFlight = false
    }
  }

  return { ping, snapshot: () => ({ disabled, lastArmAt: lastArmAt || null }) }
}
