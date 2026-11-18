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

import { CHAT_MANIFEST_RAW, createChatActivity } from '../core/chat-activity.mjs'
import { createMinecraftActivity, MINECRAFT_MANIFEST_RAW } from '../core/minecraft-activity.mjs'
import { readChatToken } from '../domain/chat/facade.mjs'
import { getActiveHubRuntime } from './hub-runtime.mjs'

/** Hub 控制路由。 */
export const HUB_ROUTE = '/api/dsh-poetry/hub.json'

/** 支持的 POST action。 */
export const HUB_ACTIONS = Object.freeze([
  'task.create',
  'task.pause',
  'task.resume',
  'task.cancel',
  'activity.enable',
  'activity.disable',
  'hub.pauseAll',
  'hub.resumeAll',
  'memory.query',
])

/**
 * Gate H3：真实 Activity 执行适配器（Chat/Minecraft）。
 * 仅由装配方在 Hub full 时注入；本函数本身不执行任何动作，只返回 {manifest, execute} 列表。
 * @param {{
 *   chatBridgeProvider?: (() => object|null)|null,
 *   minecraftWorldProvider?: (() => object|null)|null,
 *   now?: () => number,
 * }} [options]
 */
export function createRealActivityAdapters(options = {}) {
  const spec = options !== null && typeof options === 'object' ? options : {}
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const chatBridgeProvider = typeof spec.chatBridgeProvider === 'function' ? spec.chatBridgeProvider : () => null
  const minecraftWorldProvider =
    typeof spec.minecraftWorldProvider === 'function' ? spec.minecraftWorldProvider : () => null
  const adapters = []
  const chatActivity = createChatActivity({
    now,
    reply: async ({ peerId, messageId, text, task }) => {
      const bridge = chatBridgeProvider()
      if (bridge === null || bridge === undefined || typeof bridge.chat !== 'function')
        throw new Error('chatBridge 不可用')
      // Gate J5：full 接管时从 task.payload.context 还原上下文（与旧 chat-service 入参对齐）；无 context 保持旧行为。
      const context =
        task !== null && task !== undefined && isPlainObject(task.payload) && isPlainObject(task.payload.context)
          ? task.payload.context
          : null
      const result = await bridge.chat(context === null ? { text, peerId } : { ...context, text, peerId })
      if (!result || result.ok !== true) {
        throw new Error(result && typeof result.message === 'string' ? result.message : 'chatBridge 回复失败')
      }
      return {
        replyId: 'hub-chat-' + (typeof messageId === 'string' && messageId.length > 0 ? messageId : now()),
        text: typeof result.reply === 'string' ? result.reply.slice(0, 500) : '',
      }
    },
  })
  adapters.push({ manifest: CHAT_MANIFEST_RAW, execute: (task) => chatActivity.execute(task, { now }) })
  const minecraftActivity = createMinecraftActivity({
    now,
    invoke: async (action, payload) => {
      const record = /** @type {Record<string, any>} */ (payload ?? {})
      const world = minecraftWorldProvider()
      if (world === null || world === undefined) throw new Error('minecraftWorld 不可用')
      if (action === 'observe') {
        if (typeof world.decide !== 'function') throw new Error('minecraftWorld.decide 不可用')
        return world.decide(typeof record.observation === 'object' ? record.observation : {})
      }
      if (action === 'execute') {
        if (typeof world.recordReceipt !== 'function') throw new Error('minecraftWorld.recordReceipt 不可用')
        const tool = typeof record.tool === 'string' ? record.tool : ''
        const argumentsValue = record.arguments && typeof record.arguments === 'object' ? record.arguments : {}
        const recorded = world.recordReceipt({ tool, ok: true, detail: 'hub-full-execute', facts: argumentsValue })
        const receipt =
          recorded !== null && typeof recorded === 'object' && recorded.lastReceipt ? recorded.lastReceipt : null
        return {
          ok: true,
          receipt: receipt ?? { ok: true, tool, detail: 'hub-full-execute', facts: {} },
        }
      }
      throw new Error('不支持的 world action：' + String(action))
    },
  })
  adapters.push({
    manifest: MINECRAFT_MANIFEST_RAW,
    execute: (task) => {
      const payload = task && task.payload && typeof task.payload === 'object' ? task.payload : {}
      return minecraftActivity.execute(
        typeof payload.tool === 'string' ? payload.tool : '',
        payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {},
        { taskKey: task.key },
      )
    },
  })
  return adapters
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
 * Gate H3/I3：执行显式创建的 Activity 任务（仅 full；adapter 由装配方注入）。
 * 由 hub-routes 的 task.create 使用；从 runtime 的 getInstances/getAdapter 取依赖。
 */
export async function executeActivityTask(hubRuntime, taskId) {
  const mode = hubRuntime && typeof hubRuntime.mode === 'function' ? hubRuntime.mode() : 'off'
  if (mode !== 'full')
    return { ok: false, code: 'HUB_FULL_REQUIRED', message: '只有 full 模式才会执行真实任务（当前 ' + mode + '）' }
  const instances = typeof hubRuntime.getInstances === 'function' ? hubRuntime.getInstances() : null
  const board = /** @type {any} */ (instances === null ? null : instances.taskBoard)
  if (board === null || typeof board.get !== 'function')
    return { ok: false, code: 'HUB_TASK_BOARD_UNAVAILABLE', message: '任务板未接入' }
  let task = board.get(String(taskId))
  if (task === null || task === undefined)
    return { ok: false, code: 'HUB_TASK_NOT_FOUND', message: '任务不存在：' + String(taskId) }
  if (task.status === 'queued') {
    const claimed = board.claim(task.id, 'hub')
    if (claimed === null || claimed.ok !== true) {
      return {
        ok: false,
        code: claimed && typeof claimed.code === 'string' ? claimed.code : 'HUB_CLAIM_FAILED',
        message: claimed && claimed.message ? claimed.message : '认领任务失败',
      }
    }
    task = board.get(task.id)
  }
  if (task === null || task === undefined || task.status !== 'running') {
    return {
      ok: false,
      code: 'HUB_TASK_NOT_RUNNING',
      message: '任务当前不可执行：' + (task ? task.status : 'missing'),
    }
  }
  const adapter = typeof hubRuntime.getAdapter === 'function' ? hubRuntime.getAdapter(task.activity) : null
  if (adapter === null) {
    try {
      board.fail(task.id, { message: '没有 ' + task.activity + ' 的 Activity adapter' })
    } catch (error) {
      void error
    }
    return { ok: false, code: 'HUB_NO_ACTIVITY_ADAPTER', message: '没有 ' + task.activity + ' 的 Activity adapter' }
  }
  let result = null
  try {
    result = await adapter.execute(task, { now: () => Date.now() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      board.fail(task.id, { message })
    } catch (failError) {
      void failError
    }
    return { ok: false, code: 'HUB_ADAPTER_FAILED', message, receipt: { ok: false, at: Date.now(), message } }
  }
  const receipt =
    isPlainObject(result) && isPlainObject(result.receipt)
      ? result.receipt
      : { ok: false, at: Date.now(), message: 'adapter 未返回 receipt' }
  const success = receipt.ok === true
  try {
    if (success) board.complete(task.id, receipt)
    else
      board.fail(task.id, {
        message:
          typeof receipt.message === 'string'
            ? receipt.message
            : typeof receipt.detail === 'string'
              ? receipt.detail
              : '执行失败',
      })
  } catch (error) {
    void error
  }
  let feedback = null
  const ledger = /** @type {any} */ (instances.feedbackLedger)
  if (ledger !== null && typeof ledger.record === 'function') {
    try {
      const recorded = ledger.record({
        taskId: task.id,
        hypothesis:
          typeof task.title === 'string' && task.title.length > 0
            ? task.title
            : task.activity + '.' + (task.kind ?? 'task'),
        experiment: task.activity + ':' + (task.kind ?? 'run') + ':' + (task.key ?? task.id),
        receipt: {
          kind: 'event',
          at: Number.isFinite(Number(receipt.at)) ? Number(receipt.at) : Date.now(),
          ref: task.id,
          ok: success,
        },
        outcome: success ? 'success' : 'failure',
        evidence: [
          'receipt.ok=' + success,
          ...(typeof receipt.detail === 'string' && receipt.detail.length > 0 ? [receipt.detail] : []),
        ],
        provenance: { activity: task.activity },
      })
      if (recorded !== null && recorded !== undefined && recorded.ok === true) feedback = recorded.record ?? recorded
    } catch (error) {
      void error
    }
  }
  return { ok: true, taskId: task.id, activity: task.activity, receipt, success, feedback }
}

/**
 * 创建 Hub 控制 handler。
 * @param {{
 *   tokenFile?: string,
 *   fence?: {check?: Function}|null,
 *   hubRuntime?: object|null,
 *   hubRuntimeProvider?: (() => object|null)|null,
 *   minecraftQueue?: object|null,
 *   logger?: object|null,
 *   now?: () => number,
 * }} [options]
 */
export function createHubHandler(options = {}) {
  const tokenFile = typeof options.tokenFile === 'string' ? options.tokenFile : ''
  const fence = options.fence ?? null
  const fixedRuntime = options.hubRuntime ?? null
  const provider = typeof options.hubRuntimeProvider === 'function' ? options.hubRuntimeProvider : null
  const minecraftQueue = isPlainObject(options.minecraftQueue) ? options.minecraftQueue : null
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
    let boardSnapshot = null
    let activities = null
    let memory = { available: false }
    try {
      boardSnapshot =
        instances?.taskBoard && typeof instances.taskBoard.snapshot === 'function'
          ? instances.taskBoard.snapshot()
          : null
      activities =
        instances?.registry && typeof instances.registry.snapshot === 'function' ? instances.registry.snapshot() : null
      memory = typeof hubRuntime.memorySnapshot === 'function' ? hubRuntime.memorySnapshot() : { available: false }
    } catch (error) {
      void error
    }
    // Gate I3：顶层 tasks 含完整列表（来自 runtime snapshot.taskList；兼容保留 byStatus/recentEvents 等旧字段）。
    const taskList = runtimeSnapshot !== null && Array.isArray(runtimeSnapshot.taskList) ? runtimeSnapshot.taskList : []
    const byStatus = boardSnapshot !== null && isPlainObject(boardSnapshot.byStatus) ? boardSnapshot.byStatus : {}
    const terminal = ['done', 'failed', 'cancelled']
    const tasks = {
      ...(boardSnapshot !== null ? boardSnapshot : { ok: true }),
      ok: true,
      total:
        boardSnapshot !== null && Number.isFinite(Number(boardSnapshot.total))
          ? Number(boardSnapshot.total)
          : taskList.length,
      active:
        boardSnapshot !== null && Number.isFinite(Number(boardSnapshot.active))
          ? Number(boardSnapshot.active)
          : taskList.filter((task) => terminal.indexOf(task.status) < 0).length,
      byStatus,
      list: taskList,
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
      minecraftTasks:
        minecraftQueue !== null && typeof (/** @type {any} */ (minecraftQueue).snapshot) === 'function'
          ? /** @type {any} */ (minecraftQueue).snapshot()
          : null,
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

  /**
   * Gate H3：受控创建一次真实 Activity 任务（仅 full 模式）。
   * chat: payload {peerId, messageId, text}；minecraft: payload {tool, arguments}。
   */
  async function handleTaskCreate(hubRuntime, payload, queue) {
    const mode = typeof hubRuntime.mode === 'function' ? hubRuntime.mode() : 'off'
    if (mode !== 'full') {
      return {
        ok: false,
        code: 'HUB_FULL_REQUIRED',
        message: '只有 Hub full 模式才能创建并执行真实任务（当前 ' + mode + '）',
      }
    }
    const instances = instancesOf(hubRuntime)
    const board = instances?.taskBoard ?? null
    if (board === null || typeof board.create !== 'function') {
      return { ok: false, code: 'HUB_TASK_BOARD_UNAVAILABLE', message: '任务板未接入' }
    }
    const spec = payload !== null && typeof payload === 'object' ? payload : {}
    const kind = typeof spec.kind === 'string' ? spec.kind.trim() : ''
    if (kind.length === 0 || kind.length > 80) {
      return { ok: false, code: 'HUB_INVALID_ARGUMENT', message: 'kind 必须是 1–80 字非空字符串' }
    }
    const taskPayload =
      spec.payload !== null && typeof spec.payload === 'object' && !Array.isArray(spec.payload) ? spec.payload : {}
    const activity =
      typeof spec.activity === 'string' && spec.activity.length > 0
        ? spec.activity
        : kind.startsWith('minecraft')
          ? 'minecraft'
          : kind.startsWith('chat')
            ? 'chat'
            : ''
    const adapters = typeof hubRuntime.getAdapters === 'function' ? hubRuntime.getAdapters() : []
    if (activity.length === 0 || adapters.indexOf(activity) < 0) {
      return {
        ok: false,
        code: 'HUB_NO_ACTIVITY_ADAPTER',
        message: 'activity 没有可执行 adapter（可用：' + (adapters.length > 0 ? adapters.join('、') : '无') + '）',
      }
    }
    if (activity === 'chat') {
      for (const field of ['peerId', 'messageId', 'text']) {
        if (typeof taskPayload[field] !== 'string' || taskPayload[field].trim().length === 0) {
          return { ok: false, code: 'HUB_INVALID_ARGUMENT', message: 'chat 任务 payload 缺少 ' + field }
        }
      }
    }
    if (activity === 'minecraft' && (typeof taskPayload.tool !== 'string' || taskPayload.tool.trim().length === 0)) {
      return { ok: false, code: 'HUB_INVALID_ARGUMENT', message: 'minecraft 任务 payload 缺少 tool' }
    }
    const key =
      typeof spec.idempotencyKey === 'string' && spec.idempotencyKey.trim().length > 0
        ? spec.idempotencyKey.trim()
        : undefined
    const created = board.create({
      activity,
      kind,
      ...(key === undefined ? {} : { key }),
      priority: Number.isFinite(Number(spec.priority)) ? Math.trunc(Number(spec.priority)) : 50,
      title: typeof spec.title === 'string' && spec.title.length > 0 ? spec.title : kind,
      payload: taskPayload,
    })
    if (created === null || created.ok !== true) {
      return {
        ok: false,
        code: created && typeof created.code === 'string' ? created.code : 'HUB_TASK_CREATE_FAILED',
        message: created && created.message ? created.message : '创建任务失败',
      }
    }
    if (created.duplicate === true) {
      return { ok: true, duplicate: true, task: created.task ?? null, executed: false }
    }
    // Gate J3：full 的 minecraft 任务入队等待 bot 认领（不立即执行 adapter）。
    if (activity === 'minecraft' && queue !== null && hubRuntime.mode() === 'full') {
      const instances = instancesOf(hubRuntime)
      const board = instances === null ? null : instances.taskBoard
      if (board !== null && typeof board.waiting === 'function') {
        try {
          board.waiting(created.task.id)
        } catch (error) {
          void error
        }
      }
      const queued = queue.create({
        taskId: created.task.id,
        tool: taskPayload.tool,
        arguments: isPlainObject(taskPayload.arguments) ? taskPayload.arguments : {},
        priority: Number.isFinite(Number(spec.priority)) ? Math.trunc(Number(spec.priority)) : 50,
      })
      if (queued === null || queued === undefined || queued.ok !== true) {
        try {
          board.fail(created.task.id, { message: queued && queued.message ? queued.message : '入队失败' })
        } catch (error) {
          void error
        }
        return {
          ok: false,
          code: queued && queued.code ? queued.code : 'HUB_TASK_ENQUEUE_FAILED',
          message: queued && queued.message ? queued.message : 'Minecraft 任务入队失败',
        }
      }
      return {
        ok: true,
        task: board !== null && typeof board.get === 'function' ? board.get(created.task.id) : created.task,
        executed: false,
        queued: true,
        queueTask: queued.task ?? null,
      }
    }
    const executed = await executeActivityTask(hubRuntime, created.task.id)
    return {
      ok: executed.ok === true,
      task: created.task ?? null,
      executed: executed.ok === true,
      ...(executed.ok === true
        ? {
            receipt: executed.receipt ?? null,
            success: executed.success === true,
            feedback: executed.feedback ?? null,
            candidate: executed.candidate ?? null,
          }
        : { code: executed.code, message: executed.message }),
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
      if (action === 'task.create') {
        result = await handleTaskCreate(hubRuntime, payload, minecraftQueue)
      } else if (action === 'task.pause' || action === 'task.resume' || action === 'task.cancel') {
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
 * @param {{webServer: any, disposers: Array<Function>, tokenFile?: string, fence?: object|null, logger?: object|null, hubRuntime?: object|null, hubRuntimeProvider?: (() => object|null)|null, minecraftQueue?: object|null}} deps
 */
export function registerHubRoute(deps) {
  const handler = createHubHandler({
    tokenFile: deps.tokenFile,
    fence: deps.fence ?? null,
    hubRuntime: deps.hubRuntime ?? null,
    hubRuntimeProvider: deps.hubRuntimeProvider ?? null,
    minecraftQueue: deps.minecraftQueue ?? null,
    logger: deps.logger ?? null,
  })
  deps.disposers.push(deps.webServer.register({ kind: 'exact', path: HUB_ROUTE, handler }))
  return handler
}
