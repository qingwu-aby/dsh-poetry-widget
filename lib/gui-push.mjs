// lib/gui-push.mjs —— 把她的主动留言真正推到对话里（v2.77）
//
// 问题：主动消息只会排进 gui-inbox，等用户下次在「小鲸鱼（对话）」里开口才被带出；
// 用户不开口就永远看不到，于是“很少主动发消息”。
// 做法：她真有一条要留的话时，用宿主的 schedule 服务，在对话会话里投递一条一次性提醒；
// 会话被激活后由传话层用 drainOnly 调 little_whale_chat，把留言原样输出——不用用户先说话。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

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
  const getPendingCount = typeof options.getPendingCount === 'function' ? options.getPendingCount : () => 0
  const sendPrompt = typeof options.sendPrompt === 'function' ? options.sendPrompt : null
  const stateFile = typeof options.stateFile === 'string' && options.stateFile.length > 0 ? path.resolve(options.stateFile) : null
  const disabled = String(env.DSH_POETRY_PUSH ?? '').toLowerCase() === 'off'
  let lastArmAt = 0
  let inFlight = false
  let timer = null
  let disposed = false
  let lastResult = null

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
      if (sendPrompt !== null) {
        try {
          await sendPrompt(sessionId, GUI_PUSH_PROMPT)
          lastArmAt = now()
          lastResult = { at: now(), ok: true, via: 'prompt', sessionId }
          persistState()
          logger?.info?.(`[dsh-little-whale] 已推送留言到对话会话：${sessionId}`)
          return { ok: true, sessionId, via: 'prompt' }
        } catch (error) {
          lastResult = { at: now(), ok: false, via: 'prompt', sessionId, reason: error instanceof Error ? error.message : String(error) }
          persistState()
          logger?.warn?.(`[dsh-little-whale] prompt 推送失败：${lastResult.reason}`)
          // 继续尝试 schedule 兜底
        }
      }
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

  function persistState() {
    if (stateFile === null) return
    try {
      mkdirSync(path.dirname(stateFile), { recursive: true })
      writeJsonAtomic(stateFile, { ok: true, v: 1, last: lastResult, lastArmAt: lastArmAt || 0, updatedAt: now() })
    } catch {
      /* ignore */
    }
  }

  /** 补投：即使错过队列时刻，只要队列里还有留言，就定期再预约一次。 */
  function start(options = {}) {
    if (disposed || timer !== null) return
    const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : 5 * 60 * 1000
    const firstMs = Number.isFinite(options.firstMs) && options.firstMs >= 0 ? options.firstMs : 20 * 1000
    const tick = async () => {
      try {
        if (getPendingCount() > 0) await ping()
      } catch {
        /* ignore */
      }
    }
    timer = setTimeout(() => {
      tick().catch(() => {})
      timer = setInterval(() => tick().catch(() => {}), intervalMs)
      timer.unref?.()
    }, firstMs)
    timer.unref?.()
  }

  function stop() {
    disposed = true
    if (timer !== null) {
      try {
        clearTimeout(timer)
        clearInterval(timer)
      } catch {
        /* ignore */
      }
      timer = null
    }
  }

  return {
    ping,
    start,
    stop,
    snapshot: () => ({ disabled, lastArmAt: lastArmAt || null, last: lastResult, stateFile }),
  }
}
