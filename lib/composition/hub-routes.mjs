// @ts-check
// lib/composition/hub-routes.mjs —— Hub 控制 HTTP API（Gate F2，本地受保护接口）。
//
// 目标：把 F1 的 Hub 图暴露成一个稳定、受保护的本地 HTTP API，供控制面/CLI 使用：
//   · GET  /api/dsh-poetry/hub.json：snapshot（hub/tasks/activities/memory/health）；
//   · POST /api/dsh-poetry/hub.json：{action} →
//       task.pause | task.resume | task.cancel
//       activity.enable | activity.disable
//       hub.pauseAll | hub.resumeAll
//       memory.query（只读，limit ≤50）
//   · 鉴权：GET 用 DSH trust fence 或 chat token（?token=）；POST 用 chat token（body.token）
//     或 trust fence 二选一；token 未配置时只接受 fence。
//   · 无 Hub 时降级为 {ok:true, available:false}（GET）/ {ok:false, code:'HUB_UNAVAILABLE'}（POST），
//     不抛错；所有处理异常隔离为 500 JSON。
//   · 不接 UI；不改变现有路由。

import { readChatToken } from '../domain/chat/facade.mjs'
import { getActiveHubRuntime } from './hub-runtime.mjs'

/** Hub 控制路由。 */
export const HUB_ROUTE = '/api/dsh-poetry/hub.json'

/** 支持的 POST action。 */
export const HUB_ACTIONS = Object.freeze([
  'task.pause',
  'task.resume',
  'task.cancel',
  'activity.enable',
  'activity.disable',
  'hub.pauseAll',
  'hub.resumeAll',
  'memory.query',
])

/** 请求体上限（防止大 body 拖垮路由）。 */
const MAX_BODY_BYTES = 256 * 1024

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * 创建 Hub 控制 handler。
 * @param {{
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   hubRuntime?: object|null,
 *   hubRuntimeProvider?: (() => object|null)|null,
 *   logger?: object|null,
 *   now?: () => number,
 * }} [options]
 */
export function createHubHandler(options = {}) {
  const tokenFile = typeof options.tokenFile === 'string' ? options.tokenFile : ''
  const fence = options.fence ?? null
  const fixedRuntime = options.hubRuntime ?? null
  const provider = typeof options.hubRuntimeProvider === 'function' ? options.hubRuntimeProvider : null
  const logger = /** @type {any} */ (options.logger ?? null)

  function resolveHub() {
    if (fixedRuntime !== null) return fixedRuntime
    if (provider !== null) {
      try {
        return provider()
      } catch (error) {
        void error
        return null
      }
    }
    return getActiveHubRuntime()
  }

  function fenceAllows(req) {
    try {
      if (fence === null || typeof fence.check !== 'function') return true
      return fence.check(req) === null
    } catch (error) {
      void error
      return false
    }
  }

  function tokenMatches(candidate) {
    try {
      const expected = readChatToken(tokenFile)
      return expected.length > 0 && candidate === expected
    } catch (error) {
      void error
      return false
    }
  }

  function queryToken(req) {
    try {
      const url = new URL(req?.url ?? '/', 'http://127.0.0.1')
      return url.searchParams.get('token') ?? ''
    } catch (error) {
      void error
      return ''
    }
  }

  function instancesOf(hubRuntime) {
    if (hubRuntime === null || typeof hubRuntime.getInstances !== 'function') return null
    try {
      return hubRuntime.getInstances()
    } catch (error) {
      void error
      return null
    }
  }

  function snapshotPayload(hubRuntime) {
    const instances = instancesOf(hubRuntime)
    let runtimeSnapshot = null
    let health = null
    try {
      runtimeSnapshot = hubRuntime.snapshot()
      health = hubRuntime.health()
    } catch (error) {
      void error
    }
    let tasks = null
    let activities = null
    let memory = { available: false }
    try {
      tasks =
        instances?.taskBoard && typeof instances.taskBoard.snapshot === 'function'
          ? instances.taskBoard.snapshot()
          : null
      activities =
        instances?.registry && typeof instances.registry.snapshot === 'function' ? instances.registry.snapshot() : null
      memory = typeof hubRuntime.memorySnapshot === 'function' ? hubRuntime.memorySnapshot() : { available: false }
    } catch (error) {
      void error
    }
    return {
      ok: true,
      available: true,
      mode: typeof hubRuntime.mode === 'function' ? hubRuntime.mode() : 'off',
      assembled: runtimeSnapshot !== null ? runtimeSnapshot.assembled === true : false,
      hub: runtimeSnapshot,
      tasks,
      activities,
      memory,
      health,
    }
  }

  async function handleTask(hubRuntime, action, payload) {
    const instances = instancesOf(hubRuntime)
    const board = instances?.taskBoard ?? null
    if (board === null) return { ok: false, code: 'HUB_TASK_BOARD_UNAVAILABLE', message: '任务板未接入' }
    const taskId = typeof payload.taskId === 'string' && payload.taskId.length > 0 ? payload.taskId : ''
    if (taskId.length === 0) return { ok: false, code: 'HUB_INVALID_ARGUMENT', message: 'taskId 必须是非空字符串' }
    const result =
      action === 'task.pause'
        ? board.waiting(taskId)
        : action === 'task.resume'
          ? board.resume(taskId)
          : board.cancel(taskId, { reason: 'hub-control' })
    if (result && result.ok === true) return { ok: true, action, task: result.task ?? null }
    return {
      ok: false,
      code: typeof result?.code === 'string' ? result.code : 'HUB_TASK_ACTION_FAILED',
      message: typeof result?.message === 'string' ? result.message : '任务操作失败',
    }
  }

  function handleActivity(hubRuntime, action, payload) {
    const instances = instancesOf(hubRuntime)
    const registry = instances?.registry ?? null
    if (registry === null) return { ok: false, code: 'HUB_REGISTRY_UNAVAILABLE', message: 'Activity Registry 未接入' }
    const activityId = typeof payload.activityId === 'string' && payload.activityId.length > 0 ? payload.activityId : ''
    if (activityId.length === 0)
      return { ok: false, code: 'HUB_INVALID_ARGUMENT', message: 'activityId 必须是非空字符串' }
    const result = action === 'activity.enable' ? registry.enable(activityId) : registry.disable(activityId)
    if (result && result.ok === true) return { ok: true, action, activity: result.activity ?? null }
    return {
      ok: false,
      code: typeof result?.code === 'string' ? result.code : 'HUB_ACTIVITY_ACTION_FAILED',
      message: typeof result?.message === 'string' ? result.message : '活动操作失败',
    }
  }

  function handleHubControl(hubRuntime, action) {
    const instances = instancesOf(hubRuntime)
    const scheduler = instances?.scheduler ?? null
    if (scheduler === null) return { ok: false, code: 'HUB_SCHEDULER_UNAVAILABLE', message: 'Scheduler 未接入' }
    const result = action === 'hub.pauseAll' ? scheduler.pauseAll() : scheduler.resumeAll()
    if (result && result.ok === true) {
      return {
        ok: true,
        action,
        paused: result.paused === true,
        parked: Array.isArray(result.parked) ? result.parked : [],
      }
    }
    return { ok: false, code: 'HUB_CONTROL_FAILED', message: 'Hub 全局控制失败' }
  }

  return async function hubControlHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method === 'GET') {
        if (!fenceAllows(req) && !tokenMatches(queryToken(req))) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const hubRuntime = resolveHub()
        if (hubRuntime === null) {
          sendJson(res, 200, {
            ok: true,
            available: false,
            mode: 'off',
            hub: null,
            tasks: null,
            activities: null,
            memory: { available: false },
            health: null,
            note: 'Hub 未接入（默认 off 或尚未注册）',
          })
          return
        }
        sendJson(res, 200, snapshotPayload(hubRuntime))
        return
      }
      if (method !== 'POST') {
        res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let payload = null
      try {
        payload = await readBody(req)
      } catch (error) {
        void error
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const bodyToken =
        payload !== null && typeof payload === 'object' && typeof payload.token === 'string' ? payload.token : ''
      if (!tokenMatches(bodyToken) && !fenceAllows(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const action =
        payload !== null && typeof payload === 'object' && typeof payload.action === 'string' ? payload.action : ''
      if (HUB_ACTIONS.indexOf(action) < 0) {
        sendJson(res, 400, { ok: false, error: 'unknown_action', actions: HUB_ACTIONS })
        return
      }
      const hubRuntime = resolveHub()
      if (hubRuntime === null) {
        sendJson(res, 200, { ok: false, code: 'HUB_UNAVAILABLE', message: 'Hub 未接入' })
        return
      }
      let result = null
      if (action === 'task.pause' || action === 'task.resume' || action === 'task.cancel') {
        result = await handleTask(hubRuntime, action, payload)
      } else if (action === 'activity.enable' || action === 'activity.disable') {
        result = handleActivity(hubRuntime, action, payload)
      } else if (action === 'hub.pauseAll' || action === 'hub.resumeAll') {
        result = handleHubControl(hubRuntime, action)
      } else if (action === 'memory.query') {
        const filter =
          payload !== null &&
          typeof payload === 'object' &&
          payload.filter !== null &&
          typeof payload.filter === 'object'
            ? payload.filter
            : {}
        result = await hubRuntime.queryMemory(filter)
      }
      sendJson(res, 200, result ?? { ok: false, code: 'HUB_ACTION_FAILED', message: '未知动作' })
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] Hub 控制路由失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (warnError) {
        void warnError
      }
      try {
        sendJson(res, 500, {
          ok: false,
          error: { code: 'HUB_ROUTE_FAILED', message: error instanceof Error ? error.message : String(error) },
        })
      } catch (sendError) {
        void sendError
      }
    }
  }
}

/**
 * 注册 Hub 控制路由（http-wiring 调用）。
 * @param {{webServer: any, disposers: Array<Function>, tokenFile?: string, fence?: object|null, logger?: object|null, hubRuntime?: object|null, hubRuntimeProvider?: (() => object|null)|null}} deps
 */
export function registerHubRoute(deps) {
  const handler = createHubHandler({
    tokenFile: deps.tokenFile,
    fence: deps.fence ?? null,
    hubRuntime: deps.hubRuntime ?? null,
    hubRuntimeProvider: deps.hubRuntimeProvider ?? null,
    logger: deps.logger ?? null,
  })
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: HUB_ROUTE, handler }))
  return handler
}
