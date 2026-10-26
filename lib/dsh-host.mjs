// lib/dsh-host.mjs —— DSH 宿主 API 的薄适配层（v1.75，P2）。
//
// index.js 直接依赖 ctx.inject / hostCtx.get / hostCtx.effect。宿主升级时这些调用点
// 会散落在组合根里。这里收一层：即使某个 API 缺失/抛异常，也给出安全的空实现，
// 插件最多降级，不会因为宿主 API 变化而 apply 抛未捕获异常。
//
// 只做“转发 + 兜底”，不改变语义：inject 的 keys 照旧、get 返回原值、effect 原样注册。

const EMPTY_HOST_CONTEXT = Object.freeze({
  get() {
    return undefined
  },
  effect() {
    return undefined
  },
  on() {
    return () => {}
  },
})

/**
 * @param {{inject?: Function, effect?: Function, logger?: object}|null|undefined} ctx
 * @param {{warn?: Function}|null} [fallbackLogger]
 */
export function createDshHost(ctx, fallbackLogger = null) {
  const host = ctx ?? {}
  const logger = host.logger ?? fallbackLogger ?? null

  function warn(message) {
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* ignore */
    }
  }

  /** 注册宿主注入；宿主没有 inject（极旧版本）时用空上下文降级。 */
  function inject(keys, callback) {
    if (typeof callback !== 'function') throw new Error('inject callback required')
    if (typeof host.inject === 'function') return host.inject(keys, callback)
    warn('宿主未提供 ctx.inject，按空上下文降级')
    return callback(EMPTY_HOST_CONTEXT)
  }

  /** 读取宿主服务（get 抛异常/缺失 → undefined）。 */
  function get(hostCtx, name) {
    const target = hostCtx ?? EMPTY_HOST_CONTEXT
    if (typeof target.get !== 'function') return undefined
    try {
      return target.get(name)
    } catch (error) {
      warn(`读取宿主服务失败（${name}）：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** 注册 effect 清理；优先 hostCtx.effect，其次 ctx.effect，缺失时返回 undefined。 */
  function effect(hostCtx, execute, label) {
    const target = hostCtx ?? EMPTY_HOST_CONTEXT
    if (typeof target.effect === 'function') {
      try {
        return target.effect(execute, label)
      } catch (error) {
        warn(`注册 effect 失败（${label ?? 'unknown'}）：${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    }
    if (typeof host.effect === 'function') {
      try {
        return host.effect(execute, label)
      } catch (error) {
        warn(`注册 effect 失败（${label ?? 'unknown'}）：${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    }
    return undefined
  }

  return { inject, get, effect, logger, warn }
}
