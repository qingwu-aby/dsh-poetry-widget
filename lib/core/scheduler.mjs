// lib/core/scheduler.mjs —— Hub 调度器（Gate B3，单前台 + 抢占/恢复 + 后台槽位）。
//
// 目标：唯一调度决策点，保证“同一时刻只有一个前台任务”，后台低优先级只在空闲时跑。
//   · 前台优先级：user > chat > game/build > reading/video > background（可按 activity 覆盖）；
//   · 抢占：更高优先级任务到来时，把当前前台置 waiting（任务保留在 Task Board，lease/检查点不丢），
//     高优先级跑完/让位后自动 resume（re-claim）被抢占的任务；
//   · 后台：只有没有前台可跑时才启动 background 任务，最多 maxBackground 个（默认 1）；
//   · tick(now) 只做“选择 + 任务板状态迁移”（claim/waiting/resume），**不执行任务**，返回决策对象；
//   · pauseAll/resumeAll：急停（默认把当前前台 park 成 waiting）与恢复；
//   · 饥饿检测：排队超过 starvationMs 的前台任务在 snapshot/decision 里标出（不自动提权）。
//
// 槽位语义：监管器的 running 与 waiting 都占并发槽（Gate A2 契约），因此 Hub 配置
// maxRunning 建议 ≥ 2（默认 4）：调度器负责“单前台”，监管器只负责总并发上限；
// 若 maxRunning=1，抢占后新任务无槽可跑，调度器会回滚抢占（reason:'preempt-no-capacity'）。
//
// 依赖注入：board 只需提供 Task Board 的查询/状态接口：
//   { list(filter?), get(id?), claim(id, owner), waiting(id), resume(id) }
// 不直接 import 具体实现；时钟/回调均可注入。纯逻辑：不读盘/不联网/无宿主依赖。

/** 调度器实现版本。 */
export const SCHEDULER_VERSION = 1

/** 决策动作。 */
export const SCHEDULER_ACTIONS = Object.freeze([
  'start',
  'preempt',
  'resume',
  'background',
  'idle',
  'paused',
  'error',
])

/** 错误码。 */
export const SCHEDULER_CODES = Object.freeze({
  noBoard: 'SCHEDULER_NO_BOARD',
  claimFailed: 'SCHEDULER_CLAIM_FAILED',
  resumeFailed: 'SCHEDULER_RESUME_FAILED',
  boardError: 'SCHEDULER_BOARD_ERROR',
})

/** 默认优先级类（activity → 分值；数字越大越优先）。 */
export const DEFAULT_PRIORITY_CLASSES = Object.freeze({
  user: 100,
  chat: 80,
  game: 60,
  build: 60,
  minecraft: 60,
  reading: 40,
  video: 40,
  background: 0,
})

/** 默认配置。 */
export const SCHEDULER_DEFAULTS = Object.freeze({
  maxBackground: 1,
  starvationMs: 10 * 60 * 1000,
  owner: 'scheduler',
  parkOnPause: true,
  maxRecentDecisions: 20,
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function readNonNegativeInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

function errorResult(code, message, extra) {
  return { ok: false, code, message, ...(extra === undefined ? {} : extra) }
}

/** 合并优先级类（默认 ← 覆盖）；返回 activity → 分值。 */
export function resolvePriorityClasses(overrides) {
  const classes = { ...DEFAULT_PRIORITY_CLASSES }
  if (isPlainObject(overrides)) {
    for (const [key, value] of Object.entries(overrides)) {
      const n = Number(value)
      if (Number.isFinite(n)) classes[String(key).toLowerCase()] = Math.trunc(n)
    }
  }
  return classes
}

/** 任务的前台优先级分值：activity 命中 → 分值；否则按 kind；都不命中 → background(0)。 */
export function priorityClassOf(task, classes) {
  const table = isPlainObject(classes) ? classes : DEFAULT_PRIORITY_CLASSES
  const source = isPlainObject(task) ? task : {}
  const activity = typeof source.activity === 'string' ? source.activity.trim().toLowerCase() : ''
  if (activity.length > 0 && Object.hasOwn(table, activity)) return table[activity]
  const kind = typeof source.kind === 'string' ? source.kind.trim().toLowerCase() : ''
  if (kind.length > 0 && Object.hasOwn(table, kind)) return table[kind]
  return 0
}

function isBackgroundClass(value) {
  return Number(value) <= 0
}

function compareTasks(classes) {
  return (left, right) => {
    const classDiff = priorityClassOf(right, classes) - priorityClassOf(left, classes)
    if (classDiff !== 0) return classDiff
    const priorityDiff = (Number(right.priority) || 0) - (Number(left.priority) || 0)
    if (priorityDiff !== 0) return priorityDiff
    const createdDiff = (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0)
    if (createdDiff !== 0) return createdDiff
    return String(left.id).localeCompare(String(right.id))
  }
}

/**
 * 创建调度器。
 * @param {{
 *   board: {list?: Function, get?: Function, claim: Function, waiting: Function, resume: Function},
 *   now?: () => number,
 *   maxBackground?: number,
 *   starvationMs?: number,
 *   owner?: string,
 *   parkOnPause?: boolean,
 *   priorityClasses?: object,
 *   onDecision?: (decision: object) => void,
 * }} options
 */
export function createScheduler(options = {}) {
  const board = isPlainObject(options.board) ? options.board : null
  if (board === null) throw new TypeError('createScheduler 需要注入 board（Task Board 接口）')
  for (const method of ['list', 'claim', 'waiting', 'resume']) {
    if (typeof board[method] !== 'function') throw new TypeError(`board.${method} 必须是函数`)
  }
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const maxBackground = readNonNegativeInt(options.maxBackground, SCHEDULER_DEFAULTS.maxBackground)
  const starvationMs = readPositiveInt(options.starvationMs, SCHEDULER_DEFAULTS.starvationMs)
  const owner = typeof options.owner === 'string' && options.owner.length > 0 ? options.owner : SCHEDULER_DEFAULTS.owner
  const parkOnPause = options.parkOnPause !== false
  const classes = resolvePriorityClasses(options.priorityClasses)
  const onDecision = typeof options.onDecision === 'function' ? options.onDecision : null
  const maxRecentDecisions = readPositiveInt(options.maxRecentDecisions, SCHEDULER_DEFAULTS.maxRecentDecisions)
  const compare = compareTasks(classes)

  let paused = false
  let foregroundId = null
  const backgroundIds = new Set()
  const preemptedIds = new Set()
  const firstSeen = new Map()
  const recentDecisions = []
  let lastDecision = null
  let lastError = null
  const metrics = {
    ticks: 0,
    starts: 0,
    preemptions: 0,
    resumes: 0,
    backgroundStarts: 0,
    idleTicks: 0,
    pausedTicks: 0,
    parks: 0,
    errors: 0,
  }

  function safeCall(callback, payload) {
    if (callback === null) return
    try {
      callback(payload)
    } catch (error) {
      void error
    }
  }

  function recordDecision(decision) {
    lastDecision = decision
    recentDecisions.push(decision)
    if (recentDecisions.length > maxRecentDecisions) recentDecisions.shift()
    safeCall(onDecision, decision)
    return decision
  }

  function fail(code, message, extra) {
    metrics.errors += 1
    lastError = { code, message, at: now(), ...(extra === undefined ? {} : extra) }
    return recordDecision({ ok: false, action: 'error', at: now(), code, message, ...(extra === undefined ? {} : extra) })
  }

  function allTasks() {
    const listed = board.list({})
    return Array.isArray(listed) ? listed : []
  }

  function taskById(id) {
    if (id === null || id === undefined) return null
    if (typeof board.get === 'function') {
      const task = board.get(id)
      return isPlainObject(task) ? task : null
    }
    return allTasks().find((task) => task !== null && task.id === id) ?? null
  }

  function reconcileBackground(tasks) {
    const runningIds = new Set(tasks.filter((task) => task.status === 'running').map((task) => task.id))
    for (const id of [...backgroundIds]) if (!runningIds.has(id)) backgroundIds.delete(id)
    for (const id of [...preemptedIds]) {
      const task = tasks.find((item) => item.id === id)
      if (task === undefined || (task.status !== 'waiting' && task.status !== 'queued')) preemptedIds.delete(id)
    }
  }

  /** 选择并执行一步调度（只做 Task Board 状态迁移，不执行任务）。 */
  function tick(nowArg) {
    const at = Number.isFinite(Number(nowArg)) ? Number(nowArg) : now()
    metrics.ticks += 1
    if (paused) {
      metrics.pausedTicks += 1
      return recordDecision({ ok: true, action: 'paused', at, foreground: null, queue: 0, background: 0 })
    }
    let tasks
    try {
      tasks = allTasks()
    } catch (error) {
      return fail(SCHEDULER_CODES.boardError, `读取任务板失败：${error instanceof Error ? error.message : String(error)}`)
    }
    reconcileBackground(tasks)
    const running = tasks.filter((task) => task.status === 'running' && !backgroundIds.has(task.id)).sort(compare)
    const queued = tasks.filter((task) => task.status === 'queued').sort(compare)
    const preemptedWaiting = tasks
      .filter((task) => task.status === 'waiting' && preemptedIds.has(task.id))
      .sort(compare)
    const backgroundRunning = tasks.filter((task) => backgroundIds.has(task.id) && task.status === 'running')

    // 1) 单前台：若同时有多个 running 前台（监管器自动补位等），保留最高优先级，其余置 waiting。
    const preemptedNow = []
    if (running.length > 1) {
      for (const extra of running.slice(1)) {
        const parked = safeBoardCall(() => board.waiting(extra.id))
        if (parked.ok === true) {
          preemptedIds.add(extra.id)
          preemptedNow.push(extra.id)
          metrics.preemptions += 1
        }
      }
    }
    const current = running.length > 0 ? running[0] : null
    if (current !== null) {
      foregroundId = current.id
      const best = queued.length > 0 ? queued[0] : null
      // 2) 抢占：更高优先级的前台任务到来 → 当前前台置 waiting，然后 claim 新任务。
      if (best !== null && priorityClassOf(best, classes) > priorityClassOf(current, classes)) {
        const parked = safeBoardCall(() => board.waiting(current.id))
        if (parked.ok !== true) {
          return fail(SCHEDULER_CODES.claimFailed, `抢占时置 waiting 失败：${parked.message ?? ''}`, {
            task: current,
            at,
          })
        }
        preemptedIds.add(current.id)
        metrics.preemptions += 1
        const claimed = safeBoardCall(() => board.claim(best.id, owner))
        if (claimed.ok !== true) {
          // 抢占失败：尽量把原前台恢复，避免丢任务。
          safeBoardCall(() => board.resume(current.id))
          preemptedIds.delete(current.id)
          return fail(SCHEDULER_CODES.claimFailed, `抢占后 claim 失败：${claimed.message ?? ''}`, { task: best, at })
        }
        if (claimed.queued === true) {
          // 监管器没有空槽（waiting 也占槽）：回滚抢占，避免出现“没有前台”的中间态。
          safeBoardCall(() => board.resume(current.id))
          preemptedIds.delete(current.id)
          metrics.idleTicks += 1
          return recordDecision({
            ok: true,
            action: 'idle',
            at,
            reason: 'preempt-no-capacity',
            foreground: current,
            preempted: preemptedNow,
            queue: queued.length,
            background: backgroundRunning.length,
            starved: computeStarved(tasks, at),
          })
        }
        metrics.starts += 1
        foregroundId = best.id
        return recordDecision({
          ok: true,
          action: 'preempt',
          at,
          task: claimed.task ?? best,
          preempted: [...preemptedNow, current.id],
          foreground: claimed.task ?? best,
          queue: queued.length - 1,
          background: backgroundRunning.length,
          starved: computeStarved(tasks, at),
        })
      }
      metrics.idleTicks += 1
      return recordDecision({
        ok: true,
        action: 'idle',
        at,
        reason: 'foreground-running',
        foreground: current,
        preempted: preemptedNow,
        queue: queued.length,
        background: backgroundRunning.length,
        starved: computeStarved(tasks, at),
      })
    }

    foregroundId = null
    // 3) 无前台：优先恢复被抢占的任务（re-claim），再跑前台队列，最后才跑后台。
    if (preemptedWaiting.length > 0) {
      const candidate = preemptedWaiting[0]
      const resumed = safeBoardCall(() => board.resume(candidate.id))
      if (resumed.ok !== true) {
        preemptedIds.delete(candidate.id)
        return fail(SCHEDULER_CODES.resumeFailed, `恢复被抢占任务失败：${resumed.message ?? ''}`, { task: candidate, at })
      }
      preemptedIds.delete(candidate.id)
      metrics.resumes += 1
      foregroundId = candidate.id
      return recordDecision({
        ok: true,
        action: 'resume',
        at,
        task: resumed.task ?? candidate,
        foreground: resumed.task ?? candidate,
        queue: queued.length,
        background: backgroundRunning.length,
        starved: computeStarved(tasks, at),
      })
    }
    const nextForeground = queued.find((task) => !isBackgroundClass(priorityClassOf(task, classes))) ?? null
    if (nextForeground !== null) {
      const claimed = safeBoardCall(() => board.claim(nextForeground.id, owner))
      if (claimed.ok !== true || claimed.queued === true) {
        metrics.idleTicks += 1
        return recordDecision({
          ok: true,
          action: 'idle',
          at,
          reason: 'claim-failed',
          queue: queued.length,
          background: backgroundRunning.length,
          starved: computeStarved(tasks, at),
        })
      }
      metrics.starts += 1
      foregroundId = nextForeground.id
      return recordDecision({
        ok: true,
        action: 'start',
        at,
        task: claimed.task ?? nextForeground,
        foreground: claimed.task ?? nextForeground,
        queue: queued.length - 1,
        background: backgroundRunning.length,
        starved: computeStarved(tasks, at),
      })
    }
    // 4) 空闲：才允许启动后台任务（最多 maxBackground 个）。
    const nextBackground = queued.find((task) => isBackgroundClass(priorityClassOf(task, classes))) ?? null
    if (nextBackground !== null && backgroundIds.size < maxBackground) {
      const claimed = safeBoardCall(() => board.claim(nextBackground.id, owner))
      if (claimed.ok === true && claimed.queued !== true) {
        backgroundIds.add(nextBackground.id)
        metrics.backgroundStarts += 1
        return recordDecision({
          ok: true,
          action: 'background',
          at,
          task: claimed.task ?? nextBackground,
          foreground: null,
          queue: queued.length - 1,
          background: backgroundIds.size,
          starved: computeStarved(tasks, at),
        })
      }
    }
    metrics.idleTicks += 1
    return recordDecision({
      ok: true,
      action: 'idle',
      at,
      reason: 'no-task',
      queue: queued.length,
      background: backgroundRunning.length,
      starved: computeStarved(tasks, at),
    })
  }

  function safeBoardCall(fn) {
    try {
      const result = fn()
      if (isPlainObject(result)) return result
      return { ok: true, task: null }
    } catch (error) {
      return errorResult(SCHEDULER_CODES.boardError, error instanceof Error ? error.message : String(error))
    }
  }

  /** 饥饿检测：排队（非后台）超过 starvationMs 的任务。 */
  function computeStarved(tasks, at) {
    const queuedIds = new Set()
    for (const task of tasks) {
      if (task.status !== 'queued') continue
      queuedIds.add(task.id)
      if (!firstSeen.has(task.id)) firstSeen.set(task.id, at)
    }
    for (const id of [...firstSeen.keys()]) if (!queuedIds.has(id)) firstSeen.delete(id)
    const starved = []
    for (const task of tasks) {
      if (task.status !== 'queued') continue
      if (isBackgroundClass(priorityClassOf(task, classes))) continue
      const since = firstSeen.get(task.id) ?? at
      const waitedMs = Math.max(0, at - since)
      if (waitedMs >= starvationMs) {
        starved.push({ id: task.id, activity: task.activity, waitedMs, since })
      }
    }
    return starved
  }

  /** 急停：停止调度；默认把当前前台 park 成 waiting（任务保留，resumeAll 后恢复）。 */
  function pauseAll(optionsArg) {
    const spec = isPlainObject(optionsArg) ? optionsArg : {}
    const park = spec.park === true || (spec.park !== false && parkOnPause)
    paused = true
    const parked = []
    if (park && foregroundId !== null) {
      const parkedResult = safeBoardCall(() => board.waiting(foregroundId))
      if (parkedResult.ok === true) {
        preemptedIds.add(foregroundId)
        parked.push(foregroundId)
        metrics.parks += 1
      }
    }
    foregroundId = null
    return { ok: true, paused: true, parked }
  }

  function resumeAll() {
    paused = false
    return { ok: true, paused: false }
  }

  function snapshot() {
    let tasks = []
    try {
      tasks = allTasks()
    } catch (error) {
      lastError = { code: SCHEDULER_CODES.boardError, message: error instanceof Error ? error.message : String(error) }
    }
    const at = now()
    const foreground = foregroundId === null ? null : taskById(foregroundId)
    const background = [...backgroundIds].map((id) => taskById(id)).filter((task) => task !== null)
    const queue = tasks.filter((task) => task.status === 'queued').sort(compare)
    return {
      ok: true,
      version: SCHEDULER_VERSION,
      at,
      paused,
      foreground,
      background,
      queue,
      preempted: [...preemptedIds],
      maxBackground,
      starvationMs,
      priorityClasses: { ...classes },
      metrics: { ...metrics },
      starved: computeStarved(tasks, at),
      lastDecision,
      recentDecisions: recentDecisions.slice(-10),
      lastError,
    }
  }

  return { tick, pauseAll, resumeAll, snapshot }
}
