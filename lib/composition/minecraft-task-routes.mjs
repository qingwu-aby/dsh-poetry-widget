// @ts-check
// lib/composition/minecraft-task-routes.mjs —— Minecraft 任务队列受保护路由（Gate J3）。
//
// 路由：POST /api/dsh-poetry/minecraft-tasks.json { token, action: 'claim'|'receipt'|'status', ... }
//   · token = chat token（与 game-world/game-decide 相同）；bot 专用；trust fence 亦可放行；
//   · claim：认领下一个任务（租约），返回 {taskId,tool,arguments,leaseUntil,attempts}；
//   · receipt：回传 {taskId, ok, detail, facts} → 完成任务队列 + Hub 任务板 + feedback 账本；
//   · status：只读队列快照。
// 不改变现有 game-world/game-decide 路由；默认队列为空 → claim 返回 task:null（bot 空转无副作用）。

import { readChatToken } from '../domain/chat/facade.mjs'

/** 路由路径。 */
export const MINECRAFT_TASKS_ROUTE = '/api/dsh-poetry/minecraft-tasks.json'

/** 支持的 action。 */
export const MINECRAFT_TASK_ACTIONS = Object.freeze(['claim', 'receipt', 'status'])

const MAX_BODY_BYTES = 64 * 1024

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (total === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function queryToken(req) {
  const url = typeof req?.url === 'string' ? req.url : ''
  const index = url.indexOf('?')
  if (index < 0) return ''
  try {
    return new URLSearchParams(url.slice(index + 1)).get('token') ?? ''
  } catch (error) {
    void error
    return ''
  }
}

/**
 * 创建 Minecraft 任务队列 handler。
 * @param {{
 *   queue: object,
 *   getHubRuntime?: (() => object|null)|null,
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   logger?: object|null,
 * }} options
 */
export function createMinecraftTaskHandler(options) {
  const spec = isPlainObject(options) ? options : {}
  const queue = spec.queue
  if (queue === null || queue === undefined || typeof queue.claim !== 'function') {
    throw new TypeError('createMinecraftTaskHandler 需要 queue')
  }
  const tokenFile = typeof spec.tokenFile === 'string' ? spec.tokenFile : ''
  const fence = isPlainObject(spec.fence) && typeof spec.fence.check === 'function' ? spec.fence : null
  const getHubRuntime =
    typeof spec.getHubRuntime === 'function' ? /** @type {() => object|null} */ (spec.getHubRuntime) : () => null
  const logger = /** @type {any} */ (spec.logger ?? null)

  function tokenMatches(value) {
    if (typeof value !== 'string' || value.length === 0) return false
    const expected = readChatToken(tokenFile)
    return typeof expected === 'string' && expected.length > 0 && value === expected
  }

  function allows(req) {
    if (fence !== null) {
      try {
        if (fence.check(req) === null) return true
      } catch (error) {
        void error
      }
    }
    return tokenMatches(queryToken(req))
  }

  function completeHubTask(taskId, ok, detail, facts) {
    const hubRuntime = getHubRuntime()
    if (hubRuntime === null || hubRuntime === undefined) return null
    const instances = typeof hubRuntime.getInstances === 'function' ? hubRuntime.getInstances() : null
    const board = instances === null || instances === undefined ? null : instances.taskBoard
    if (board === null || typeof board.get !== 'function') return null
    const task = board.get(String(taskId))
    if (task === null || task === undefined) return null
    const receipt = {
      ok: ok === true,
      at: Date.now(),
      detail: typeof detail === 'string' ? detail.slice(0, 200) : '',
      facts: isPlainObject(facts) ? facts : {},
    }
    try {
      if (receipt.ok) board.complete(task.id, receipt)
      else board.fail(task.id, { message: receipt.detail || 'minecraft 任务失败' })
    } catch (error) {
      void error
    }
    let feedback = null
    const ledger = instances.feedbackLedger
    if (ledger !== null && ledger !== undefined && typeof ledger.record === 'function') {
      try {
        const recorded = ledger.record({
          taskId: task.id,
          hypothesis: task.kind + '.' + task.activity,
          experiment: task.activity + ':' + (task.kind ?? 'run') + ':' + (task.key ?? task.id),
          receipt: { kind: 'event', at: receipt.at, ref: task.id, ok: receipt.ok },
          outcome: receipt.ok ? 'success' : 'failure',
          evidence: ['receipt.ok=' + receipt.ok, ...(receipt.detail.length > 0 ? [receipt.detail] : [])],
          provenance: { activity: task.activity },
        })
        if (recorded !== null && recorded !== undefined && recorded.ok === true) feedback = recorded.record ?? recorded
      } catch (error) {
        void error
      }
    }
    return { taskId: task.id, ok: receipt.ok, feedback }
  }

  return async function minecraftTaskHandler(req, res) {
    try {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
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
      const bodyToken = isPlainObject(payload) && typeof payload.token === 'string' ? payload.token : ''
      if (!tokenMatches(bodyToken) && !allows(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const action = isPlainObject(payload) && typeof payload.action === 'string' ? payload.action : ''
      if (MINECRAFT_TASK_ACTIONS.indexOf(action) < 0) {
        sendJson(res, 400, { ok: false, error: 'unknown_action', actions: MINECRAFT_TASK_ACTIONS })
        return
      }
      if (action === 'status') {
        sendJson(res, 200, queue.snapshot())
        return
      }
      if (action === 'claim') {
        const result = queue.claim({ owner: payload.owner, leaseMs: payload.leaseMs })
        sendJson(res, 200, { ok: result.ok === true, task: result.task ?? null })
        return
      }
      const taskId = typeof payload.taskId === 'string' ? payload.taskId : ''
      if (taskId.length === 0) {
        sendJson(res, 400, { ok: false, error: 'invalid_argument', message: '缺少 taskId' })
        return
      }
      const ok = payload.ok === true
      const result = ok
        ? queue.complete(taskId, { ok: true, detail: payload.detail, facts: payload.facts })
        : queue.fail(taskId, { message: payload.detail })
      if (result === null || result === undefined || result.ok !== true) {
        sendJson(res, 200, {
          ok: false,
          error: result && result.code ? result.code : 'receipt_failed',
          message: result && result.message ? result.message : '',
        })
        return
      }
      const hub = completeHubTask(taskId, ok, payload.detail, payload.facts)
      sendJson(res, 200, { ok: true, task: result.task, hub })
    } catch (error) {
      try {
        logger?.warn?.(
          `[dsh-little-whale] minecraft 任务路由失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } catch (warnError) {
        void warnError
      }
      sendJson(res, 500, { ok: false, error: 'internal_error' })
    }
  }
}

/**
 * 注册 Minecraft 任务队列路由。
 * @param {{webServer: any, disposers?: Array<() => void>, queue: object, getHubRuntime?: (() => object|null)|null, tokenFile?: string, fence?: object|null, logger?: object|null}} deps
 */
export function registerMinecraftTaskRoute(deps) {
  const handler = createMinecraftTaskHandler({
    queue: deps.queue,
    getHubRuntime: deps.getHubRuntime,
    tokenFile: deps.tokenFile,
    fence: deps.fence,
    logger: deps.logger,
  })
  const webServer = /** @type {any} */ (deps.webServer)
  const registration = webServer.register({ kind: 'exact', path: MINECRAFT_TASKS_ROUTE, handler })
  if (
    Array.isArray(deps.disposers) &&
    registration !== null &&
    registration !== undefined &&
    typeof registration.dispose === 'function'
  ) {
    deps.disposers.push(() => registration.dispose())
  }
  return handler
}
