// @ts-check
// 两个看门狗：
//  1) 自驱心跳：每 2 分钟跑一次立项/复盘（不依赖决策轮，断连也继续想）；
//  2) 断连检测：世界超过 STALE_MS 没收到观察 → 先告警，再（有冷却地）重启 bot。
import { execFile } from 'node:child_process'

export const CURRICULUM_INTERVAL_MS = 2 * 60 * 1000
export const STALE_MS = 5 * 60 * 1000
const RESTART_COOLDOWN_MS = 10 * 60 * 1000

/**
 * @param {{ world?: any, logger?: any, now?: () => number, restartBot?: (() => void)|null, env?: any }} options
 * @returns {{ start: () => void, stop: () => void, checkNow: () => object }}
 */
export function createMinecraftWatchdog(options = {}) {
  const world = options.world ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const env = /** @type {any} */ (options.env && typeof options.env === 'object' ? options.env : {})
  const curriculumEnabled = env.DSH_MC_CURRICULUM !== 'off'
  const watchdogEnabled = env.DSH_MC_WATCHDOG !== 'off'
  const restartBot = typeof options.restartBot === 'function' ? options.restartBot : defaultRestartBot(logger)
  let curriculumTimer = null
  let watchdogTimer = null
  let lastRestartAt = 0
  let lastWarnAt = 0
  let curriculumRunning = false

  async function tickCurriculum() {
    if (world === null || typeof world.tickCurriculum !== 'function' || curriculumRunning) return
    curriculumRunning = true
    try {
      await world.tickCurriculum()
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 自驱心跳失败：${error instanceof Error ? error.message : String(error)}`)
      } catch (_error) {
        void _error
      }
    } finally {
      curriculumRunning = false
    }
  }

  function checkNow() {
    const snapshot = world !== null && typeof world.snapshot === 'function' ? world.snapshot() : null
    const observationAt = Number(snapshot?.observationAt) || 0
    const idleMs = observationAt > 0 ? now() - observationAt : Number.POSITIVE_INFINITY
    const stale = idleMs > STALE_MS
    if (stale && restartBot !== null) {
      const cooled = now() - lastRestartAt > RESTART_COOLDOWN_MS
      if (cooled) {
        lastRestartAt = now()
        try {
          logger?.warn?.(`[dsh-little-whale] 世界 ${Math.round(idleMs / 60000)} 分钟没有观察，重启 bot`)
        } catch (_error) {
          void _error
        }
        try {
          restartBot()
        } catch (_error) {
          void _error
        }
      } else if (now() - lastWarnAt > 60000) {
        lastWarnAt = now()
        try {
          logger?.warn?.(`[dsh-little-whale] 世界仍然没有观察（已等待 ${Math.round(idleMs / 60000)} 分钟）`)
        } catch (_error) {
          void _error
        }
      }
    }
    return { ok: !stale, observationAt, idleMs, stale }
  }

  return {
    start() {
      if (curriculumEnabled && curriculumTimer === null)
        curriculumTimer = setInterval(() => {
          void tickCurriculum()
        }, CURRICULUM_INTERVAL_MS)
      if (watchdogEnabled && watchdogTimer === null)
        watchdogTimer = setInterval(() => {
          checkNow()
        }, 60000)
    },
    stop() {
      if (curriculumTimer !== null) clearInterval(curriculumTimer)
      if (watchdogTimer !== null) clearInterval(watchdogTimer)
      curriculumTimer = null
      watchdogTimer = null
    },
    checkNow,
  }
}

function defaultRestartBot(logger) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  if (uid === null) return null
  return () => {
    execFile('launchctl', ['kickstart', '-k', `gui/${uid}/com.yangyuan.whale.minecraft-bot`], (error) => {
      if (error) {
        try {
          logger?.warn?.(`[dsh-little-whale] 重启 bot 失败：${error.message}`)
        } catch (_error2) {
          void _error2
        }
      }
    })
  }
}
