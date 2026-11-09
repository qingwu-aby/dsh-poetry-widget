// @ts-check
// lib/kernel/logger.mjs —— 插件日志与静默失败计数（W1）
//
// 不改变现有 logger 接口（info/warn），额外提供 snapshot() 给 health 用：
// 记录 warn/error 次数与最近一条，方便发现“静默失败”。
export function createPluginLogger(baseLogger = null) {
  const counters = { info: 0, warn: 0, error: 0 }
  let lastWarn = ''
  let lastError = ''
  const safeBase = (level) => {
    const fn = baseLogger && typeof baseLogger[level] === 'function' ? baseLogger[level] : null
    return fn ? fn.bind(baseLogger) : null
  }
  const write = (level, message) => {
    counters[level] = (counters[level] ?? 0) + 1
    if (level === 'warn') lastWarn = String(message).slice(0, 300)
    if (level === 'error') lastError = String(message).slice(0, 300)
    try {
      let write = safeBase(level)
      if (write === null && level === 'error') write = safeBase('warn')
      write?.(message)
    } catch {
      /* 日志失败不影响主流程 */
    }
  }
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    snapshot: () => ({
      counters: { ...counters },
      lastWarn,
      lastError,
      silentFailures: counters.warn + counters.error,
    }),
    reset: () => {
      counters.info = 0
      counters.warn = 0
      counters.error = 0
      lastWarn = ''
      lastError = ''
    },
  }
}
