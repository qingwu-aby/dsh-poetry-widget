// @ts-check
// lib/kernel/service.mjs —— 后台服务契约与注册表（W1/W2）
//
// 目标：所有定时/常驻服务按同一形状暴露，health 与清理逻辑不再各自实现。
// 不强制马上迁移；迁移一个域用一个。
export function defineService(spec) {
  const name = String(spec?.name ?? '').trim()
  if (name.length === 0) throw new Error('defineService: name required')
  const start = typeof spec.start === 'function' ? spec.start : () => {}
  const stop = typeof spec.stop === 'function' ? spec.stop : () => {}
  const tick = typeof spec.tick === 'function' ? spec.tick : null
  const snapshot = typeof spec.snapshot === 'function' ? spec.snapshot : () => ({})
  return {
    name,
    start,
    stop,
    tick,
    snapshot,
    dispose() {
      try {
        stop()
      } catch {
        /* 清理失败不阻塞其他服务 */
      }
    },
  }
}

export function createServiceRegistry({ logger = null } = {}) {
  const services = new Map()
  return {
    register(service) {
      const normalized = defineService(service)
      if (services.has(normalized.name)) throw new Error(`service already registered: ${normalized.name}`)
      services.set(normalized.name, normalized)
      return normalized
    },
    startAll() {
      for (const service of services.values()) {
        try {
          service.start()
        } catch (error) {
          logger?.warn?.(
            `[dsh-little-whale] 服务启动失败 ${service.name}：${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    },
    stopAll() {
      for (const service of services.values()) service.dispose()
      services.clear()
    },
    snapshot() {
      const out = {}
      for (const [name, service] of services) out[name] = service.snapshot()
      return out
    },
    names: () => [...services.keys()],
  }
}
