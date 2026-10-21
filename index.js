// dsh-poetry-widget —— 宿主半区（M2）。
//
// 职责（契约 docs/contract.md §1/§2/§3）：
//   · 静态资源：GET /api/dsh-poetry/assets?f=<相对路径>（M0 形态，只读、越界 404）；
//   · 数据接口：GET health / bootstrap / poems / ci / yun / knowledge / settings / weather / about；
//   · 设置接口：GET/PUT settings.json（PUT 仅回环来源、白名单校验、原子写 $DSH_HOME/.dsh-poetry/）；
//   · 天气接口：GET weather.json（Open-Meteo 地理编码 + forecast，20min 缓存，失败降级永 200）；
//   · 心情统计：监听 session/event 累计当日活跃数据，GET mood.json；防抖原子写 mood.json；
//   · 所有新增路由接入宿主信任栅栏（lib/trust.mjs，委托 connection.requestRejection）。
//
// 数据来自包内 data/*.json（只读），宿主进程内按 mtime + dataVersion 缓存；
// data/ 缺失或损坏时优雅降级（200 + DATA_UNAVAILABLE），不会让插件加载失败。
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAssetHandler } from './lib/assets.mjs'
import { createDataStore } from './lib/data-store.mjs'
import { readPackageMeta } from './lib/paths.mjs'
import { createRouteTable } from './lib/routes.mjs'
import { createSettingsStore, resolveSettingsPath } from './lib/settings-store.mjs'
import { createMoodTracker } from './lib/mood.mjs'
import { createTrustFence } from './lib/trust.mjs'
import { createWeatherService } from './lib/weather.mjs'

/** Cordis 插件名（loader 诊断用；与 package.json 的 dsh.bundle 行 id 一致）。 */
export const name = 'dsh-poetry-widget'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_META = readPackageMeta(path.join(PACKAGE_ROOT, 'package.json'))
/** 版本号唯一来源：package.json（不在插件里重复维护字符串）。 */
const VERSION = PACKAGE_META.version ?? '0.0.0'
const DATA_DIR = path.join(PACKAGE_ROOT, 'data')
const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets')
const ASSETS_ROUTE = '/api/dsh-poetry/assets'

/**
 * 宿主插件入口。
 * 必须走 inject —— apply 运行时刻 webServer / connection 的 fiber 可能尚未创建。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const logger = ctx?.logger ?? null
  const env = process.env
  const home = env.HOME || os.homedir()
  const settingsPath = resolveSettingsPath(env, home)

  // —— 当日心情统计：尽早注册 session/event 监听（webServer 就绪前也累计）——
  // moodTracker 防抖写 $DSH_HOME/.dsh-poetry/mood.json；插件卸载时落盘并清定时器。
  const moodTracker = createMoodTracker({
    file: path.join(settingsPath.dir, 'mood.json'),
    persistDebounceMs: 15000,
    onWarn: (message) => logger?.warn?.(`[dsh-poetry-widget] ${message}`),
  })
  const disposeMoodEffect = () => {
    try {
      moodTracker.dispose()
    } catch (error) {
      logger?.warn?.(`[dsh-poetry-widget] mood 落盘失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    ctx.effect(() => {
      let disposeListener = null
      try {
        // DSH session/event 为 emit 广播：参数 (session, event)；同一日志事件对所有监听者各发一次。
        disposeListener = ctx.on('session/event', (session, event) => {
          try {
            moodTracker.record(session, event)
          } catch (error) {
            logger?.warn?.(`[dsh-poetry-widget] mood 事件处理异常：${error instanceof Error ? error.message : String(error)}`)
          }
        })
      } catch (error) {
        logger?.warn?.(`[dsh-poetry-widget] session/event 监听注册失败（mood.json 将只返回零值）：${error instanceof Error ? error.message : String(error)}`)
      }
      return () => {
        try {
          disposeListener?.()
        } catch {
          /* ignore */
        }
        disposeMoodEffect()
      }
    }, 'dsh-poetry-widget: 心情统计（session/event）')
  } catch (error) {
    // effect 注册失败（极旧宿主）：至少保证卸载时落盘不抛出。
    logger?.warn?.(`[dsh-poetry-widget] mood effect 注册失败：${error instanceof Error ? error.message : String(error)}`)
  }

  ctx.inject(['webServer', 'connection'], (hostCtx) => {
    try {
      const webServer = hostCtx.get('webServer')
      const connection = hostCtx.get('connection')

      const dataStore = createDataStore({ dataDir: DATA_DIR })
      const settingsStore = createSettingsStore({
        file: settingsPath.file,
        knownPoemIds: () => dataStore.knownPoemIds(),
        onWarn: (message) => logger?.warn?.(`[dsh-poetry-widget] ${message}`),
      })
      const fence = createTrustFence({ getConnection: () => connection, logger })
      // 天气服务：Open-Meteo 免密钥；fetch 用宿主 Node 的全局 fetch，请求 6s 超时、进程内缓存。
      const weatherService = createWeatherService({
        fetchImpl: typeof globalThis.fetch === 'function' ? (url, init) => globalThis.fetch(url, init) : null,
      })
      const routes = createRouteTable({
        dataStore,
        settingsStore,
        fence,
        version: VERSION,
        settingsFile: settingsPath.file,
        weatherService,
        moodTracker,
        env,
        home,
      })

      /** @type {Array<() => void>} */
      const disposers = []
      // M0 静态资源路由：行为原样保留（不套信任栅栏；只读、无敏感信息）。
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: ASSETS_ROUTE,
          handler: createAssetHandler({ assetsDir: ASSETS_DIR }),
        }),
      )
      for (const route of routes) disposers.push(webServer.register(route))

      hostCtx.effect(
        () => () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch (error) {
              logger?.warn?.(`[dsh-poetry-widget] 路由注销失败：${error instanceof Error ? error.message : String(error)}`)
            }
          }
        },
        'dsh-poetry-widget: HTTP 路由',
      )
      logger?.info?.(
        `[dsh-poetry-widget] 已挂载 ${routes.length + 1} 条路由（/api/dsh-poetry/*，version ${VERSION}，` +
          `dataVersion ${dataStore.getDataVersion() ?? '(数据未就绪)'}）`,
      )
    } catch (error) {
      // 路由注册失败只影响本插件，不能让宿主 apply 抛未捕获异常。
      logger?.error?.(
        `[dsh-poetry-widget] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      )
    }
  })
}
