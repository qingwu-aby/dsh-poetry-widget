// lib/core/hub-control-api.mjs —— Hub 控制面最小 API（Gate B5，纯 service，不绑定 HTTP）。
//
// 目标：把 Scheduler / Task Board / Activity Registry / Event Bus 的指标与控制能力，
// 收敛成一套稳定的“控制面契约”，后续 Gate 的控制面（HTTP/CLI/GUI）直接复用：
//   · 只读：snapshot()（四层指标）、listTasks/listActivities、checkPermission；
//   · 任务控制：pauseTask（running→waiting）、resumeTask（waiting→running）、cancelTask；
//   · 活动控制：enableActivity/disableActivity；
//   · 全局：pauseAll/resumeAll（调度器急停/恢复）。
//
// 约定：
//   · 统一返回 {ok:true, data} 或 {ok:false, error:{code,message,details?}}，调用方不解析字符串；
//   · 依赖注入（scheduler/taskBoard/registry/eventBus 可部分缺失）：缺失 → HUB_CONTROL_NOT_READY；
//   · 不新增 HTTP 路由、不接现有业务、不做鉴权（鉴权在宿主/控制面层；本层只返回明确错误）；
//   · 纯 service：不读盘/不联网/无宿主依赖；时钟可注入。

/** 控制 API 版本。 */
export const HUB_CONTROL_VERSION = 1

/** 错误码（控制面据此映射 HTTP 状态/提示）。 */
export const HUB_CONTROL_CODES = Object.freeze({
  notReady: 'HUB_CONTROL_NOT_READY',
  notFound: 'HUB_CONTROL_NOT_FOUND',
  invalidArgument: 'HUB_CONTROL_INVALID_ARGUMENT',
  invalidFilter: 'HUB_CONTROL_INVALID_FILTER',
  dependencyError: 'HUB_CONTROL_DEPENDENCY_ERROR',
  forbidden: 'HUB_CONTROL_FORBIDDEN',
})

/** 任务状态（过滤白名单）。 */
export const HUB_CONTROL_TASK_STATUSES = Object.freeze([
  'queued',
  'running',
  'waiting',
  'blocked',
  'done',
  'failed',
  'cancelled',
])

/** 活动健康状态（过滤白名单）。 */
export const HUB_CONTROL_ACTIVITY_HEALTH = Object.freeze(['healthy', 'degraded', 'stopped', 'error'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(data) {
  return { ok: true, data }
}

function fail(code, message, details) {
  return {
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  }
}

/** 依赖形态校验：存在则必须是对象且具备关键方法。 */
function validateDependency(name, value, requiredMethods) {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (!isPlainObject(value)) throw new TypeError(`hub-control-api: ${name} 必须是对象`)
  for (const method of requiredMethods) {
    if (typeof value[method] !== 'function') throw new TypeError(`hub-control-api: ${name}.${method} 必须是函数`)
  }
  return { ok: true, value }
}

function safeSnapshot(name, service) {
  try {
    const value = service.snapshot()
    return { available: true, value }
  } catch (error) {
    return {
      available: false,
      value: null,
      error: { code: HUB_CONTROL_CODES.dependencyError, message: `${name} 快照失败：${error instanceof Error ? error.message : String(error)}` },
    }
  }
}

/**
 * 创建 Hub 控制 API。
 * @param {{
 *   scheduler?: object|null,
 *   taskBoard?: object|null,
 *   registry?: object|null,
 *   eventBus?: object|null,
 *   now?: () => number,
 * }} [options]
 */
export function createHubControlApi(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const scheduler = validateDependency('scheduler', options.scheduler, ['snapshot', 'pauseAll', 'resumeAll']).value
  const taskBoard = validateDependency('taskBoard', options.taskBoard, ['snapshot', 'list', 'get', 'waiting', 'resume', 'cancel']).value
  const registry = validateDependency('registry', options.registry, ['snapshot', 'list', 'enable', 'disable']).value
  const eventBus = validateDependency('eventBus', options.eventBus, ['snapshot']).value

  function notReady(name) {
    return fail(HUB_CONTROL_CODES.notReady, `${name} 未接入（Hub 尚未装配该组件）`)
  }

  /** 把依赖返回的 {ok, task|activity|...} 统一包装；错误码原样透传。 */
  function wrapResult(result, pickData) {
    if (result === null || result === undefined) {
      return fail(HUB_CONTROL_CODES.dependencyError, '依赖返回空结果')
    }
    if (isPlainObject(result) && result.ok === false) {
      return fail(
        typeof result.code === 'string' ? result.code : HUB_CONTROL_CODES.dependencyError,
        typeof result.message === 'string' ? result.message : '控制操作失败',
        result.reject === undefined ? undefined : { reject: result.reject },
      )
    }
    const data = typeof pickData === 'function' ? pickData(result) : result
    return ok(data)
  }

  function safeCall(fn) {
    try {
      return { ok: true, result: fn() }
    } catch (error) {
      return {
        ok: false,
        result: fail(HUB_CONTROL_CODES.dependencyError, error instanceof Error ? error.message : String(error)),
      }
    }
  }

  /** 只读快照：四层指标（缺失的组件标记 available:false，不影响其他层）。 */
  function snapshot() {
    const at = now()
    const sections = {
      scheduler: safeSnapshot('scheduler', scheduler),
      tasks: safeSnapshot('taskBoard', taskBoard),
      activities: safeSnapshot('registry', registry),
      events: safeSnapshot('eventBus', eventBus),
    }
    const errors = Object.values(sections)
      .filter((section) => section.available !== true && section.error !== undefined)
      .map((section) => section.error)
    const paused = scheduler !== null && sections.scheduler.available ? sections.scheduler.value.paused === true : false
    return ok({
      at,
      paused,
      available: {
        scheduler: scheduler !== null,
        taskBoard: taskBoard !== null,
        registry: registry !== null,
        eventBus: eventBus !== null,
      },
      scheduler: sections.scheduler.available ? sections.scheduler.value : null,
      tasks: sections.tasks.available ? sections.tasks.value : null,
      activities: sections.activities.available ? sections.activities.value : null,
      events: sections.events.available ? sections.events.value : null,
      errors,
    })
  }

  /** 任务列表（过滤：status/activity/owner/sort/limit）。 */
  function listTasks(filter) {
    if (taskBoard === null) return notReady('taskBoard')
    const spec = isPlainObject(filter) ? filter : {}
    if (spec.status !== undefined) {
      const statuses = Array.isArray(spec.status) ? spec.status : [spec.status]
      for (const status of statuses) {
        if (typeof status !== 'string' || HUB_CONTROL_TASK_STATUSES.indexOf(status) < 0) {
          return fail(HUB_CONTROL_CODES.invalidFilter, `未知任务状态：${String(status)}`, {
            allowed: HUB_CONTROL_TASK_STATUSES,
          })
        }
      }
    }
    if (spec.sort !== undefined && spec.sort !== 'priority' && spec.sort !== 'created' && spec.sort !== 'updated') {
      return fail(HUB_CONTROL_CODES.invalidFilter, `未知排序：${String(spec.sort)}`, { allowed: ['priority', 'created', 'updated'] })
    }
    if (spec.limit !== undefined && (!Number.isFinite(Number(spec.limit)) || Number(spec.limit) < 1)) {
      return fail(HUB_CONTROL_CODES.invalidFilter, 'limit 必须是正整数')
    }
    const called = safeCall(() => taskBoard.list(spec))
    if (called.ok !== true) return called.result
    const tasks = Array.isArray(called.result) ? called.result : []
    return ok({ tasks, total: tasks.length })
  }

  function getTask(id) {
    if (taskBoard === null) return notReady('taskBoard')
    if (typeof id !== 'string' || id.length === 0) return fail(HUB_CONTROL_CODES.invalidArgument, 'task id 必须是非空字符串')
    const called = safeCall(() => taskBoard.get(id))
    if (called.ok !== true) return called.result
    if (called.result === null || called.result === undefined) {
      return fail(HUB_CONTROL_CODES.notFound, `任务不存在：${id}`)
    }
    return ok({ task: called.result })
  }

  /** 暂停任务：running → waiting（保留任务，之后可 resume）。 */
  function pauseTask(id) {
    if (taskBoard === null) return notReady('taskBoard')
    if (typeof id !== 'string' || id.length === 0) return fail(HUB_CONTROL_CODES.invalidArgument, 'task id 必须是非空字符串')
    const called = safeCall(() => taskBoard.waiting(id))
    if (called.ok !== true) return called.result
    return wrapResult(called.result, (result) => ({ task: result.task ?? null }))
  }

  /** 恢复任务：waiting → running（受并发槽限制，可能仍 queued）。 */
  function resumeTask(id) {
    if (taskBoard === null) return notReady('taskBoard')
    if (typeof id !== 'string' || id.length === 0) return fail(HUB_CONTROL_CODES.invalidArgument, 'task id 必须是非空字符串')
    const called = safeCall(() => taskBoard.resume(id))
    if (called.ok !== true) return called.result
    return wrapResult(called.result, (result) => ({ task: result.task ?? null }))
  }

  /** 取消任务（终态 cancelled；重复取消幂等）。 */
  function cancelTask(id, reason) {
    if (taskBoard === null) return notReady('taskBoard')
    if (typeof id !== 'string' || id.length === 0) return fail(HUB_CONTROL_CODES.invalidArgument, 'task id 必须是非空字符串')
    const called = safeCall(() => taskBoard.cancel(id, { reason: typeof reason === 'string' ? reason : 'control-api' }))
    if (called.ok !== true) return called.result
    return wrapResult(called.result, (result) => ({ task: result.task ?? null }))
  }

  /** 活动列表（过滤：enabled/health）。 */
  function listActivities(filter) {
    if (registry === null) return notReady('registry')
    const spec = isPlainObject(filter) ? filter : {}
    if (spec.health !== undefined && (typeof spec.health !== 'string' || HUB_CONTROL_ACTIVITY_HEALTH.indexOf(spec.health) < 0)) {
      return fail(HUB_CONTROL_CODES.invalidFilter, `未知健康状态：${String(spec.health)}`, {
        allowed: HUB_CONTROL_ACTIVITY_HEALTH,
      })
    }
    if (spec.enabled !== undefined && typeof spec.enabled !== 'boolean') {
      return fail(HUB_CONTROL_CODES.invalidFilter, 'enabled 必须是布尔')
    }
    const called = safeCall(() => registry.list(spec))
    if (called.ok !== true) return called.result
    const activities = Array.isArray(called.result) ? called.result : []
    return ok({ activities, total: activities.length })
  }

  function enableActivity(id) {
    if (registry === null) return notReady('registry')
    if (typeof id !== 'string' || id.length === 0) return fail(HUB_CONTROL_CODES.invalidArgument, 'activity id 必须是非空字符串')
    const called = safeCall(() => registry.enable(id))
    if (called.ok !== true) return called.result
    return wrapResult(called.result, (result) => ({ activity: result.activity ?? null }))
  }

  function disableActivity(id) {
    if (registry === null) return notReady('registry')
    if (typeof id !== 'string' || id.length === 0) return fail(HUB_CONTROL_CODES.invalidArgument, 'activity id 必须是非空字符串')
    const called = safeCall(() => registry.disable(id))
    if (called.ok !== true) return called.result
    return wrapResult(called.result, (result) => ({ activity: result.activity ?? null }))
  }

  /** 只读权限查询（不执行判定）：allowed=false 时也返回 ok:true + reason，供控制面展示。 */
  function checkPermission(activityId, request) {
    if (registry === null) return notReady('registry')
    if (typeof registry.checkPermission !== 'function') {
      return fail(HUB_CONTROL_CODES.notReady, 'registry 未提供 checkPermission')
    }
    if (typeof activityId !== 'string' || activityId.length === 0) {
      return fail(HUB_CONTROL_CODES.invalidArgument, 'activity id 必须是非空字符串')
    }
    const called = safeCall(() => registry.checkPermission(activityId, request))
    if (called.ok !== true) return called.result
    const verdict = called.result
    if (isPlainObject(verdict) && verdict.ok === false) {
      return fail(
        typeof verdict.code === 'string' ? verdict.code : HUB_CONTROL_CODES.notFound,
        typeof verdict.message === 'string' ? verdict.message : '权限查询失败',
      )
    }
    return ok({
      activityId,
      allowed: verdict.allowed === true,
      reason: typeof verdict.reason === 'string' ? verdict.reason : '',
      permission: typeof verdict.permission === 'string' ? verdict.permission : '',
      scope: verdict.scope ?? null,
    })
  }

  /** 全局急停：调度器暂停（默认 park 当前前台），返回 paused/parked。 */
  function pauseAll(optionsArg) {
    if (scheduler === null) return notReady('scheduler')
    const spec = isPlainObject(optionsArg) ? optionsArg : {}
    const called = safeCall(() => scheduler.pauseAll(spec))
    if (called.ok !== true) return called.result
    return wrapResult(called.result, (result) => ({ paused: result.paused === true, parked: result.parked ?? [] }))
  }

  function resumeAll() {
    if (scheduler === null) return notReady('scheduler')
    const called = safeCall(() => scheduler.resumeAll())
    if (called.ok !== true) return called.result
    return wrapResult(called.result, (result) => ({ paused: result.paused === true }))
  }

  /** 等待依赖的异步操作（异步 adapter 启停/持久化）完成。 */
  async function flush() {
    const jobs = []
    if (taskBoard !== null && typeof taskBoard.flush === 'function') jobs.push(taskBoard.flush())
    if (registry !== null && typeof registry.flush === 'function') jobs.push(registry.flush())
    await Promise.allSettled(jobs)
    return ok({ flushed: jobs.length })
  }

  /** 能力自检（控制面启动时确认哪些层可用）。 */
  function capabilities() {
    return ok({
      version: HUB_CONTROL_VERSION,
      now: now(),
      scheduler: scheduler !== null,
      taskBoard: taskBoard !== null,
      registry: registry !== null,
      eventBus: eventBus !== null,
      methods: {
        read: ['snapshot', 'listTasks', 'getTask', 'listActivities', 'checkPermission', 'capabilities'],
        control: ['pauseTask', 'resumeTask', 'cancelTask', 'enableActivity', 'disableActivity', 'pauseAll', 'resumeAll'],
        maintenance: ['flush'],
      },
    })
  }

  return {
    snapshot,
    listTasks,
    getTask,
    pauseTask,
    resumeTask,
    cancelTask,
    listActivities,
    enableActivity,
    disableActivity,
    checkPermission,
    pauseAll,
    resumeAll,
    flush,
    capabilities,
  }
}
