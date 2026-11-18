// @ts-check
// lib/composition/http-wiring.mjs —— HTTP 路由装配与启动标记（W2）

import { CHAT_ROUTE, createChatHandler } from '../domain/chat/chat-bridge.mjs'
import { createRouteTable } from '../domain/integration/routes.mjs'
import { createTwinSystem } from '../domain/twin/twin-system.mjs'
import { readConfig } from '../kernel/config.mjs'
import { createChatHttpService } from './chat-service.mjs'
import { buildRuntimeSnapshot } from './health.mjs'
import { registerHubRoute } from './hub-routes.mjs'
import {
  registerAttentionRoutes,
  registerGameRoute,
  registerManualReadRoute,
  registerProjectRoutes,
  registerTwinRoutes,
} from './interactive-routes.mjs'
import { disposeAll } from './lifecycle.mjs'
import { registerModelPolicyRoute } from './model-policy-routes.mjs'
import { registerReadonlyRoutes } from './readonly-routes.mjs'
import { registerTrainingRoute } from './training-routes.mjs'

export function wireHttp(deps) {
  const {
    webServer,
    disposers,
    serviceRuntime,
    logger,
    env,
    home,
    host,
    hostCtx,
    dataStore,
    settingsStore,
    fence,
    weatherService,
    selfTalkService,
    moodAiService,
    emotional,
    localVoice,
    getLocalVoiceMode,
    journal,
    feihuaFullService,
    getSelfState,
    getReadings,
    memoryHub,
    runtimeDeps,
    twin: twinDeps,
    readonly: readonlyDeps,
    chat: chatDeps,
    interactive: interactiveDeps,
    logVersion,
  } = deps

  const routes = createRouteTable({
    dataStore,
    settingsStore,
    fence,
    version: logVersion,
    settingsFile: deps.settingsFile,
    weatherService,
    selfTalkService,
    moodAiService: {
      ...moodAiService,
      async generate(context, options) {
        const result = await moodAiService.generate(context, options)
        if (result && result.ok === true && result.mood) {
          try {
            emotional.record({
              topic: String(result.mood.reason || result.mood.label || ''),
              emotion: String(result.mood.label || ''),
              note: '',
              intensity: 0.5,
            })
          } catch {
            /* ignore */
          }
        }
        const voiceMode = String(getLocalVoiceMode ? getLocalVoiceMode() : '').toLowerCase()
        if (
          result &&
          result.ok === true &&
          result.mood &&
          typeof result.mood.reason === 'string' &&
          (voiceMode === 'on' || voiceMode === 'mood')
        ) {
          try {
            const polished = await localVoice.polish(result.mood.reason, { maxChars: 40 })
            if (polished !== null) result.mood.reason = polished
          } catch {
            /* 保留原句 */
          }
        }
        return result
      },
    },
    journal,
    feihuaFullService,
    getSelfState,
    getReadings,
    memoryHub,
    getRuntime: () => buildRuntimeSnapshot(runtimeDeps),
    env,
    home,
  })

  const twinEnabled = readConfig(env).twin && settingsStore.get().twinSystem !== false
  let twinSystem = null
  if (twinEnabled) {
    twinSystem = createTwinSystem(twinDeps)
    disposers.push(() => twinSystem.stop())
    twinSystem.start()
  }

  registerReadonlyRoutes({ webServer, disposers, logger, ...readonlyDeps })
  const chatService = createChatHttpService(chatDeps)
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: CHAT_ROUTE,
      handler: createChatHandler({ service: chatService, tokenFile: deps.chatTokenFile }),
    }),
  )
  registerTwinRoutes({ webServer, disposers, twinEnabled, twinSystem, env, logger })
  registerGameRoute({ webServer, disposers, fence, ...interactiveDeps })
  // Gate F2：Hub 控制 API（受 chat token / DSH trust fence 保护；无 Hub 时降级，不影响现有路由）。
  registerHubRoute({ webServer, disposers, tokenFile: deps.chatTokenFile, fence, logger })
  // Gate G1：模型策略管理 API（默认空配置 = 现有行为；token/fence 保护）。
  registerModelPolicyRoute({ webServer, disposers, home, tokenFile: deps.chatTokenFile, fence, logger })
  // Gate H2：训练旁路管理 API（默认关闭；只读状态/计划 + 受 confirm 保护的操作）。
  registerTrainingRoute({
    webServer,
    disposers,
    service: deps.training ? deps.training.service : null,
    tokenFile: deps.chatTokenFile,
    fence,
    logger,
  })
  registerManualReadRoute({ webServer, disposers, ...interactiveDeps })
  registerAttentionRoutes({ webServer, disposers, ...interactiveDeps })
  registerProjectRoutes({ webServer, disposers, ...interactiveDeps })
  for (const route of routes) disposers.push(webServer.register(route))

  serviceRuntime.register('HTTP 路由', { dispose: () => disposeAll(disposers, logger) })
  host.effect(
    hostCtx,
    () => {
      serviceRuntime.startAll()
      return () => serviceRuntime.disposeAll()
    },
    'dsh-little-whale: 后台服务',
  )
  logger?.info?.(
    `[dsh-little-whale] 已挂载 ${routes.length + 5} 条路由（assets + pet-media + self + memory + model-errors + ${routes.length} 条 JSON，version ${logVersion}，` +
      `dataVersion ${dataStore.getDataVersion() ?? '(数据未就绪)'}）`,
  )
  logger?.info?.(`[dsh-little-whale] 自主记忆日志目录：${deps.memoryDir}`)
  return { routes, twinEnabled, twinSystem }
}
