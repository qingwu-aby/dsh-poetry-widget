// lib/work-loop.mjs —— 作品机会循环（v2.47）。
//
// 不是“每天必须交作品”，而是隔一段时间给她一次机会：想做就做，不想做就空着。
// 第一次安装后给一次非可选的“留点东西”机会，避免作品页长期不动。
export const WORK_INTERVAL_DEFAULT_MS = 90 * 60 * 1000
export const WORK_INITIAL_DEFAULT_MS = 45 * 1000

export function resolveWorkLoopTiming(env = process.env) {
  const read = (name, fallback) => {
    const value = Number.parseInt(String(env[name] ?? ''), 10)
    return Number.isFinite(value) && value >= 5000 ? value : fallback
  }
  return {
    intervalMs: read('DSH_POETRY_WORK_INTERVAL_MS', WORK_INTERVAL_DEFAULT_MS),
    initialMs: read('DSH_POETRY_WORK_INITIAL_MS', WORK_INITIAL_DEFAULT_MS),
  }
}

export function startWorkLoop(options = {}) {
  const works = options.works
  const selfState = options.selfState
  const metabolism = options.metabolism
  const worldFeedback = options.worldFeedback
  const logger = options.logger ?? null
  const env = options.env ?? process.env
  const timing = resolveWorkLoopTiming(env)
  let timer = null
  let disposed = false
  let first = true
  let running = false

  function snapshotState() {
    try {
      return selfState && typeof selfState.snapshot === 'function' ? selfState.snapshot() : null
    } catch {
      return null
    }
  }

  function energy() {
    try {
      const snap = metabolism && typeof metabolism.snapshot === 'function' ? metabolism.snapshot() : null
      return snap && Number.isFinite(snap.energy) ? snap.energy : 1
    } catch {
      return 1
    }
  }

  async function run() {
    if (disposed || running) return
    const state = snapshotState()
    if (state && state.sleeping === true) return
    if (energy() < 0.15) return
    running = true
    try {
      const force = first
      first = false
      const idea = [state && state.felt, state && state.experiencing].filter((item) => typeof item === 'string' && item.trim().length > 0).join('；')
      const result = await works.makeNow({ idea, optional: !force })
      if (result && result.ok === true) {
        try {
          worldFeedback?.record?.({
            source: 'works',
            kind: 'make',
            ok: true,
            summary: result.work ? result.work.title : '一件小作品',
          })
        } catch {
          /* ignore */
        }
        logger?.info?.(`[dsh-little-whale] 作品更新：${result.work ? result.work.title : '未命名'}`)
      }
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 作品机会失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
    } finally {
      running = false
    }
  }

  function schedule(delay) {
    if (disposed) return
    timer = setTimeout(async () => {
      timer = null
      await run()
      if (!disposed) schedule(timing.intervalMs)
    }, delay)
    timer.unref?.()
  }

  // 新进程第一次：给一次非可选机会，让作品页不会一直空着；之后都是可选。
  schedule(timing.initialMs)

  return {
    stop() {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
    triggerNow: run,
    snapshot: () => ({ intervalMs: timing.intervalMs, initialMs: timing.initialMs, first }),
  }
}
