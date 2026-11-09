// lib/composition/learning-loop-services.mjs —— 溜达/读小说/看大家说话组装（W2）
import path from 'node:path'
import { createSelfNetlang } from '../domain/learning/self-netlang.mjs'
import { createSelfReading } from '../domain/learning/self-reading.mjs'
import { createSelfWander } from '../domain/learning/self-wander.mjs'

function registerLoop({ name, service, heartbeat, serviceRuntime, logger }) {
  service.start({ heartbeat: true })
  heartbeat.add(name, () => service.tick())
  serviceRuntime.register(name, {
    dispose: () => {
      try {
        service.dispose()
      } catch (error) {
        logger?.warn?.(`[dsh-little-whale] ${name}清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })
}

export function createWanderService({ selfState, getLlm, modelPolicy, modelErrorsPath, logger, webAccess, memoryDir, settingsDir, autonomy, env, heartbeat, serviceRuntime }) {
  const service = createSelfWander({
    state: selfState,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    webAccess,
    learningLogPath: path.join(memoryDir, 'learning-log.md'),
    statePath: path.join(settingsDir, 'wander-state.json'),
    gapMs: autonomy.wanderGapMs,
    firstMinMs: autonomy.wanderFirstMinMs,
    firstMaxMs: autonomy.wanderFirstMaxMs,
    env,
  })
  registerLoop({ name: '网络溜达', service, heartbeat, serviceRuntime, logger })
  logger?.info?.(
    `[dsh-little-whale] 网络溜达已启动（间隔 ${Math.round(autonomy.wanderGapMs / 60000)}min；${
      String(env.DSH_POETRY_WANDER ?? '').toLowerCase() === 'off' ? '已禁用' : '允许公开页面只读浏览'
    }；网页抓取${String(env.DSH_POETRY_WEB ?? '').toLowerCase() === 'off' ? '关' : '开'}）`,
  )
  return service
}

export function createReadingService({ selfState, getLlm, modelPolicy, modelErrorsPath, logger, memoryDir, settingsDir, autonomy, env, heartbeat, serviceRuntime }) {
  const service = createSelfReading({
    state: selfState,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    learningLogPath: path.join(memoryDir, 'learning-log.md'),
    statePath: path.join(settingsDir, 'read-state.json'),
    gapMs: autonomy.readingGapMs,
    firstMinMs: autonomy.readingFirstMinMs,
    firstMaxMs: autonomy.readingFirstMaxMs,
    env,
  })
  registerLoop({ name: '读小说', service, heartbeat, serviceRuntime, logger })
  logger?.info?.(
    `[dsh-little-whale] 读小说已启动（间隔 ${Math.round(autonomy.readingGapMs / 60000)}min；${
      String(env.DSH_POETRY_READING ?? '').toLowerCase() === 'off' ? '已禁用' : '公版现代文学作品，只读'
    }）`,
  )
  return service
}

export function createNetlangService({ selfState, getLlm, modelPolicy, modelErrorsPath, logger, memoryDir, settingsDir, autonomy, env, heartbeat, serviceRuntime }) {
  const service = createSelfNetlang({
    state: selfState,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    learningLogPath: path.join(memoryDir, 'learning-log.md'),
    statePath: path.join(settingsDir, 'netlang-state.json'),
    gapMs: autonomy.netlangGapMs,
    firstMinMs: autonomy.netlangFirstMinMs,
    firstMaxMs: autonomy.netlangFirstMaxMs,
    env,
  })
  registerLoop({ name: '看大家说话', service, heartbeat, serviceRuntime, logger })
  logger?.info?.(
    `[dsh-little-whale] 看大家说话已启动（间隔 ${Math.round(autonomy.netlangGapMs / 60000)}min；${
      String(env.DSH_POETRY_NETLANG ?? '').toLowerCase() === 'off' ? '已禁用' : '只读公开热搜'
    }）`,
  )
  return service
}
