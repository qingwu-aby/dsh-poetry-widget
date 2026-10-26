// lib/service-runtime.mjs —— 后台服务的启动/停止/快照收口（v1.73，P1）。
//
// index.js 里原来每个后台服务各写一段 hostCtx.effect(() => () => { try dispose... })，
// 9 段样板容易漏清理。这里把“注册 + 统一停止 + 健康快照”收到一处：
//   runtime.register(name, { start?, dispose?, snapshot? })
//   runtime.startAll(); runtime.disposeAll(); runtime.snapshot()
// 仍然保持单个服务失败不影响其它服务；错误写 logger.warn。
function shortMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
}

/**
 * @param {{logger?: {warn?: Function, info?: Function}|null, now?: () => number}} [options]
 */
export function createServiceRuntime(options = {}) {
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const services = []
  let startedAll = false
  let disposedAll = false

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-poetry-widget] ${message}`)
    } catch {
      /* ignore */
    }
  }

  function register(name, handlers = {}) {
    if (typeof name !== 'string' || name.length === 0) throw new Error('service name required')
    if (startedAll) throw new Error(`服务运行时已启动，不能再注册：${name}`)
    if (services.some((service) => service.name === name)) throw new Error(`服务重复注册：${name}`)
    services.push({
      name,
      start: typeof handlers.start === 'function' ? handlers.start : null,
      dispose: typeof handlers.dispose === 'function' ? handlers.dispose : null,
      snapshot: typeof handlers.snapshot === 'function' ? handlers.snapshot : null,
      started: false,
      startedAt: null,
      lastError: null,
    })
    return name
  }

  function startAll() {
    if (startedAll) return
    startedAll = true
    for (const service of services) {
      if (service.start === null) {
        service.started = true
        service.startedAt = now()
        continue
      }
      try {
        service.start()
        service.started = true
        service.startedAt = now()
      } catch (error) {
        service.lastError = shortMessage(error)
        warn(`服务启动失败：${service.name}（${service.lastError}）`)
      }
    }
  }

  function disposeAll() {
    if (disposedAll) return
    disposedAll = true
    for (let index = services.length - 1; index >= 0; index -= 1) {
      const service = services[index]
      if (service.dispose === null) continue
      try {
        service.dispose()
      } catch (error) {
        service.lastError = shortMessage(error)
        warn(`服务清理失败：${service.name}（${service.lastError}）`)
      }
    }
  }

  function snapshot() {
    return {
      ok: !disposedAll,
      services: services.map((service) => ({
        name: service.name,
        started: service.started,
        startedAt: service.startedAt,
        ...(service.lastError !== null ? { lastError: service.lastError } : {}),
        ...(service.snapshot !== null ? { data: service.snapshot() } : {}),
      })),
    }
  }

  return { register, startAll, disposeAll, snapshot }
}
