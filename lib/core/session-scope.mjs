// @ts-check
// lib/core/session-scope.mjs —— 多会话隔离基础（Gate N2，纯逻辑）。
//
// 目标：为多会话/多用户提供任务/预算隔离底座（不接真实多 session 路由）：
//   · sessionId 归一化：空/缺省 → default；白名单 [A-Za-z0-9_-]{1,64}，非法拒绝；
//   · 任务归属：payload.sessionId 必须与当前 session 一致（越权拒绝）；
//   · 每会话 active 上限（默认 8）；每会话预算（modelCalls 默认 200 / tokens 默认 200000）；
//   · isolate(task) 返回带 session 的包装；snapshot 暴露每会话计数；
//   · 默认单会话（default）行为不变：不传 sessionId 即 default，计数独立但不影响旧逻辑。
// 纯逻辑：不读盘/不联网；board 只读（active 统计），不写任务。

/** 实现版本。 */
export const SESSION_SCOPE_VERSION = 1

/** 默认 session。 */
export const DEFAULT_SESSION_ID = 'default'

/** sessionId 白名单（1–64 位字母/数字/下划线/连字符）。 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 默认限制。 */
export const SESSION_SCOPE_DEFAULTS = Object.freeze({
  maxActivePerSession: 8,
  budget: Object.freeze({ modelCalls: 200, tokens: 200000 }),
})

/** 错误码。 */
export const SESSION_SCOPE_CODES = Object.freeze({
  invalidSession: 'SESSION_INVALID_ID',
  activeLimit: 'SESSION_ACTIVE_LIMIT',
  budgetExceeded: 'SESSION_BUDGET_EXCEEDED',
  forbidden: 'SESSION_FORBIDDEN',
  invalidTask: 'SESSION_INVALID_TASK',
})

const ACTIVE_TASK_STATUSES = Object.freeze(['queued', 'running', 'waiting'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * 归一化 sessionId：空/缺省 → default；非法（类型/字符/长度）→ 错误。
 * @param {unknown} value
 * @param {string} [defaultSession]
 */
export function normalizeSessionId(value, defaultSession = DEFAULT_SESSION_ID) {
  const fallback = typeof defaultSession === 'string' && SESSION_ID_PATTERN.test(defaultSession) ? defaultSession : DEFAULT_SESSION_ID
  if (value === undefined || value === null || value === '') return { ok: true, sessionId: fallback }
  if (typeof value !== 'string') return { ok: false, code: SESSION_SCOPE_CODES.invalidSession, message: 'sessionId 必须是字符串' }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: true, sessionId: fallback }
  if (!SESSION_ID_PATTERN.test(trimmed)) {
    return { ok: false, code: SESSION_SCOPE_CODES.invalidSession, message: 'sessionId 只允许 1–64 位字母/数字/下划线/连字符' }
  }
  return { ok: true, sessionId: trimmed }
}

/**
 * 创建会话作用域（纯逻辑；任务 active 计数由调用方配合 board 提供）。
 * @param {{
 *   maxActivePerSession?: number,
 *   defaultSession?: string,
 *   budget?: {modelCalls?: number, tokens?: number},
 *   now?: () => number,
 * }} [options]
 */
export function createSessionScope(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const defaultSession = typeof spec.defaultSession === 'string' && SESSION_ID_PATTERN.test(spec.defaultSession) ? spec.defaultSession : DEFAULT_SESSION_ID
  const maxActivePerSession = readPositiveInt(spec.maxActivePerSession, SESSION_SCOPE_DEFAULTS.maxActivePerSession)
  const budget = {
    modelCalls: readPositiveInt(isPlainObject(spec.budget) ? spec.budget.modelCalls : undefined, SESSION_SCOPE_DEFAULTS.budget.modelCalls),
    tokens: readPositiveInt(isPlainObject(spec.budget) ? spec.budget.tokens : undefined, SESSION_SCOPE_DEFAULTS.budget.tokens),
  }
  /** sessionId → {active:Set<string>, modelCalls, tokens, createdAt, updatedAt} */
  const sessions = new Map()

  function ensure(sessionId) {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      state = { active: new Set(), modelCalls: 0, tokens: 0, createdAt: now(), updatedAt: now() }
      sessions.set(sessionId, state)
    }
    return state
  }

  function resolve(value) {
    return normalizeSessionId(value, defaultSession)
  }

  /** 校验任务归属：payload.sessionId 必须等于 sessionId（缺省视作 default）。 */
  function assertOwnership(task, sessionId) {
    if (!isPlainObject(task)) return { ok: false, code: SESSION_SCOPE_CODES.invalidTask, message: 'task 必须是对象' }
    const payload = isPlainObject(task.payload) ? task.payload : {}
    const owned = typeof payload.sessionId === 'string' && payload.sessionId.length > 0 ? payload.sessionId : defaultSession
    if (owned !== sessionId) return { ok: false, code: SESSION_SCOPE_CODES.forbidden, message: '越权访问：任务属于会话 ' + owned }
    return { ok: true, sessionId }
  }

  /** 尝试占用一个 active 名额（taskId 可省略，仅计数用）。 */
  function admit(sessionId, taskId) {
    const state = ensure(sessionId)
    const id = typeof taskId === 'string' && taskId.length > 0 ? taskId : 'task-' + (state.active.size + 1)
    if (state.active.size >= maxActivePerSession) {
      return { ok: false, code: SESSION_SCOPE_CODES.activeLimit, message: '会话 ' + sessionId + ' active 任务已达上限 ' + maxActivePerSession, sessionId }
    }
    state.active.add(id)
    state.updatedAt = now()
    return { ok: true, sessionId, active: state.active.size, taskId: id }
  }

  function release(sessionId, taskId) {
    const state = sessions.get(sessionId)
    if (state === undefined) return { ok: true, released: false }
    const released = state.active.delete(String(taskId ?? ''))
    state.updatedAt = now()
    return { ok: true, released }
  }

  function usage(sessionId) {
    const state = ensure(sessionId)
    return {
      sessionId,
      active: state.active.size,
      modelCalls: state.modelCalls,
      tokens: state.tokens,
      remaining: { modelCalls: Math.max(0, budget.modelCalls - state.modelCalls), tokens: Math.max(0, budget.tokens - state.tokens) },
    }
  }

  function checkBudget(sessionId, cost = {}) {
    const state = ensure(sessionId)
    const modelCalls = Math.max(0, Math.floor(Number(cost.modelCalls) || 0))
    const tokens = Math.max(0, Math.floor(Number(cost.tokens) || 0))
    if (state.modelCalls + modelCalls > budget.modelCalls) {
      return { ok: false, code: SESSION_SCOPE_CODES.budgetExceeded, message: '会话 ' + sessionId + ' modelCalls 预算不足', sessionId }
    }
    if (state.tokens + tokens > budget.tokens) {
      return { ok: false, code: SESSION_SCOPE_CODES.budgetExceeded, message: '会话 ' + sessionId + ' tokens 预算不足', sessionId }
    }
    return { ok: true, sessionId, remaining: { modelCalls: budget.modelCalls - state.modelCalls - modelCalls, tokens: budget.tokens - state.tokens - tokens } }
  }

  function consume(sessionId, cost = {}) {
    const checked = checkBudget(sessionId, cost)
    if (checked.ok !== true) return checked
    const state = ensure(sessionId)
    state.modelCalls += Math.max(0, Math.floor(Number(cost.modelCalls) || 0))
    state.tokens += Math.max(0, Math.floor(Number(cost.tokens) || 0))
    state.updatedAt = now()
    return { ok: true, sessionId, usage: usage(sessionId) }
  }

  /** 包装任务（注入 sessionId；可校验归属）。 */
  function isolate(task, sessionId) {
    const resolved = resolve(sessionId)
    if (resolved.ok !== true) return resolved
    if (!isPlainObject(task)) return { ok: false, code: SESSION_SCOPE_CODES.invalidTask, message: 'task 必须是对象' }
    const payload = isPlainObject(task.payload) ? task.payload : {}
    return { ok: true, sessionId: resolved.sessionId, task: { ...task, payload: { ...payload, sessionId: resolved.sessionId } } }
  }

  function snapshot() {
    const list = []
    for (const [sessionId, state] of sessions.entries()) {
      list.push({
        sessionId,
        active: state.active.size,
        modelCalls: state.modelCalls,
        tokens: state.tokens,
        remaining: { modelCalls: Math.max(0, budget.modelCalls - state.modelCalls), tokens: Math.max(0, budget.tokens - state.tokens) },
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      })
    }
    return { ok: true, version: SESSION_SCOPE_VERSION, defaultSession, maxActivePerSession, budget: { ...budget }, sessions: list, now: now() }
  }

  function reset(sessionId) {
    if (sessionId === undefined) sessions.clear()
    else sessions.delete(String(sessionId))
    return { ok: true }
  }

  return { version: SESSION_SCOPE_VERSION, defaultSession, maxActivePerSession, budget, resolve, assertOwnership, admit, release, usage, checkBudget, consume, isolate, snapshot, reset }
}

/** 统计 board 中某会话的 active 任务数（只读）。 */
export function countActiveTasks(board, sessionId, defaultSession = DEFAULT_SESSION_ID) {
  if (board === null || board === undefined || typeof board.list !== 'function') return 0
  try {
    const tasks = board.list()
    if (!Array.isArray(tasks)) return 0
    return tasks.filter((task) => {
      if (!isPlainObject(task) || ACTIVE_TASK_STATUSES.indexOf(task.status) < 0) return false
      const payload = isPlainObject(task.payload) ? task.payload : {}
      const owned = typeof payload.sessionId === 'string' && payload.sessionId.length > 0 ? payload.sessionId : defaultSession
      return owned === sessionId
    }).length
  } catch (error) {
    void error
    return 0
  }
}

/** 从请求 URL 解析 sessionId（无则 null；非法 → null）。 */
export function sessionIdFromUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null
  const index = url.indexOf('?')
  if (index < 0) return null
  try {
    const value = new URLSearchParams(url.slice(index + 1)).get('sessionId')
    if (value === null) return null
    const resolved = normalizeSessionId(value)
    return resolved.ok === true ? resolved.sessionId : null
  } catch (error) {
    void error
    return null
  }
}

/** 从 board 取某会话的任务列表（只读；失败 → null）。 */
export function boardSessionTaskList(board, sessionId) {
  if (board === null || board === undefined || typeof board.list !== 'function') return null
  try {
    const tasks = board.list()
    return Array.isArray(tasks) ? filterTasksBySession(tasks, sessionId) : null
  } catch (error) {
    void error
    return null
  }
}

/** 选择 GET /hub.json 返回的 task list（session 过滤优先；失败回退 runtime 列表）。 */
export function selectTaskList(input = {}) {
  const spec = isPlainObject(input) ? input : {}
  const runtimeList = Array.isArray(spec.runtimeTaskList) ? spec.runtimeTaskList : []
  if (spec.sessionFilter === null || spec.sessionFilter === undefined) return runtimeList
  const filtered = boardSessionTaskList(spec.board ?? null, spec.sessionFilter)
  return filtered !== null ? filtered : runtimeList
}

const implicitScopes = new WeakMap()

/** 未显式注入 scope 时，按 board 懒创建并复用（默认单会话行为不变）。 */
function scopeFor(scope, board) {
  if (scope !== null && scope !== undefined) return scope
  if (board !== null && typeof board === 'object') {
    let implicit = implicitScopes.get(board)
    if (implicit === undefined) {
      implicit = createSessionScope()
      implicitScopes.set(board, implicit)
    }
    return implicit
  }
  return createSessionScope()
}

/** Hub task.create 会话准入（从 spec/payload 提取 sessionId；成功即记 1 modelCall）。 */
export function admitHubTaskSessionForCreate(scope, spec, payload, board) {
  const createSpec = isPlainObject(spec) ? spec : {}
  const createPayload = isPlainObject(payload) ? payload : {}
  const target = scopeFor(scope, board)
  const admitted = admitHubTaskSession({ scope: target, board, sessionId: createSpec.sessionId ?? createPayload.sessionId, payload: createPayload })
  if (admitted.ok === true) target.consume(admitted.sessionId, { modelCalls: 1 })
  return admitted
}

/** 过滤任务列表（按 payload.sessionId；缺省 default）。 */
export function filterTasksBySession(tasks, sessionId, defaultSession = DEFAULT_SESSION_ID) {
  if (!Array.isArray(tasks)) return []
  return tasks.filter((task) => {
    if (!isPlainObject(task)) return false
    const payload = isPlainObject(task.payload) ? task.payload : {}
    const owned = typeof payload.sessionId === 'string' && payload.sessionId.length > 0 ? payload.sessionId : defaultSession
    return owned === sessionId
  })
}

/**
 * Hub task.create 的会话准入：归一化 sessionId → active 上限 → 预算（每任务记 1 modelCall）。
 * 返回 {ok:true, sessionId} 或明确错误（HUB_INVALID_SESSION / SESSION_ACTIVE_LIMIT / SESSION_BUDGET_EXCEEDED）。
 * @param {{scope: object, board: object, sessionId: unknown, payload: object}} input
 */
export function admitHubTaskSession(input) {
  const spec = isPlainObject(input) ? input : {}
  const scope = spec.scope
  if (!isPlainObject(scope) || typeof scope.resolve !== 'function') {
    return { ok: false, code: 'HUB_SESSION_SCOPE_UNAVAILABLE', message: 'Session Scope 未接入' }
  }
  const resolved = scope.resolve(spec.sessionId)
  if (resolved.ok !== true) return { ok: false, code: 'HUB_INVALID_SESSION', message: resolved.message ?? '非法 sessionId' }
  const sessionId = resolved.sessionId
  const active = countActiveTasks(spec.board, sessionId, scope.defaultSession)
  if (active >= scope.maxActivePerSession) {
    return { ok: false, code: SESSION_SCOPE_CODES.activeLimit, message: '会话 ' + sessionId + ' active 任务已达上限 ' + scope.maxActivePerSession, sessionId }
  }
  const budgetCheck = scope.checkBudget(sessionId, { modelCalls: 1 })
  if (budgetCheck.ok !== true) return { ok: false, code: budgetCheck.code, message: budgetCheck.message, sessionId }
  return { ok: true, sessionId, active }
}
