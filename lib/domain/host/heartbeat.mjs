// lib/heartbeat.mjs —— 统一心跳（v1.82，P1）。
//
// 以前每个后台服务自己 setInterval；现在宿主只开一个 60s 心跳，按注册表依次触发
// 各活动的 tick，各活动内部仍按自己的 gap 判断是否真的做事（不改变语义）。
// 这样：只有 1 个定时器；失败隔离；谁在何时跑过一眼可见（health.runtime.heartbeat）。
function shortMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export const HEARTBEAT_INTERVAL_MS = 60 * 1000

/**
 * 创建心跳调度器。
 * @param {{logger?: {warn?: Function, info?: Function}|null, intervalMs?: number, now?: () => number,
 *   setIntervalImpl?: Function, clearIntervalImpl?: Function}} [options]
 */
export function createHeartbeat(options = {}) {
  const logger = options.logger ?? null
  const intervalMs =
    Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? Math.floor(options.intervalMs) : HEARTBEAT_INTERVAL_MS
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const setIntervalImpl = typeof options.setIntervalImpl === 'function' ? options.setIntervalImpl : setInterval
  const clearIntervalImpl = typeof options.clearIntervalImpl === 'function' ? options.clearIntervalImpl : clearInterval

  const jobs = new Map()
  let timer = null
  let disposed = false
  let startedAt = null
  let pulses = 0

  /** 注册/替换一个活动；name 相同则覆盖。 */
  function add(name, run, jobOptions = {}) {
    if (typeof name !== 'string' || name.length === 0 || typeof run !== 'function') return false
    const everyMs =
      Number.isFinite(jobOptions.everyMs) && jobOptions.everyMs > 0 ? Math.floor(jobOptions.everyMs) : intervalMs
    const offsetMs = Number.isFinite(jobOptions.offsetMs) && jobOptions.offsetMs > 0 ? Math.floor(jobOptions.offsetMs) : 0
    jobs.set(name, {
      name,
      run,
      everyMs,
      nextAt: now() + offsetMs,
      running: false,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastError: null,
      runs: 0,
      errors: 0,
    })
    return true
  }

  /** 所有到期的活动依次触发；每个活动同步启动、异步执行，失败只记录不抛。 */
  function pulse() {
    if (disposed) return 0
    const at = now()
    pulses += 1
    let fired = 0
    for (const job of jobs.values()) {
      if (at < job.nextAt) continue
      job.nextAt = at + job.everyMs
      if (job.running) continue
      job.running = true
      job.lastStartedAt = at
      job.runs += 1
      fired += 1
      let result = null
      try {
        result = job.run(at)
      } catch (error) {
        job.running = false
        job.errors += 1
        job.lastError = shortMessage(error)
        try {
          logger?.warn?.(`[dsh-little-whale] 心跳任务 ${job.name} 失败：${job.lastError}`)
        } catch {
          /* ignore */
        }
        continue
      }
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        Promise.resolve(result)
          .catch((error) => {
            job.errors += 1
            job.lastError = shortMessage(error)
            try {
              logger?.warn?.(`[dsh-little-whale] 心跳任务 ${job.name} 失败：${job.lastError}`)
            } catch {
              /* ignore */
            }
          })
          .finally(() => {
            job.running = false
            job.lastFinishedAt = now()
          })
      } else {
        job.running = false
        job.lastFinishedAt = now()
      }
    }
    return fired
  }

  function start() {
    if (disposed || timer !== null) return
    startedAt = now()
    timer = setIntervalImpl(pulse, intervalMs)
    timer?.unref?.()
    // 首拍立即执行一次：启动后各活动按自己的 firstDelay/nextAt 判断，不会同时刷模型。
    pulse()
  }

  function stop() {
    if (timer !== null) {
      clearIntervalImpl(timer)
      timer = null
    }
  }

  function dispose() {
    disposed = true
    stop()
    jobs.clear()
  }

  function snapshot() {
    return {
      intervalMs,
      startedAt,
      pulses,
      disposed,
      jobs: Array.from(jobs.values()).map((job) => ({
        name: job.name,
        everyMs: job.everyMs,
        running: job.running,
        runs: job.runs,
        errors: job.errors,
        lastStartedAt: job.lastStartedAt,
        lastFinishedAt: job.lastFinishedAt,
        lastError: job.lastError,
      })),
    }
  }

  return { add, pulse, start, stop, dispose, snapshot }
}
