// @ts-check
// lib/composition/lifecycle.mjs —— 清理函数登记与统一释放（W1）
export function createDisposerRegistry(logger) {
  const disposers = []
  return {
    disposers,
    add(dispose) {
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    disposeAll() {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          logger?.warn?.(`[dsh-little-whale] 清理失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      disposers.length = 0
    },
  }
}

/** 释放一组清理函数（数组）；单个失败只 warn。 */
export function disposeAll(disposers, logger) {
  for (const dispose of disposers) {
    try {
      dispose()
    } catch (error) {
      logger?.warn?.(`[dsh-little-whale] 清理失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  disposers.length = 0
}
