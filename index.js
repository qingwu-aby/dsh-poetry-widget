// dsh-poetry-widget —— 宿主半区（M2）。
//
// 职责（契约 docs/contract.md §1/§2/§3）：
//   · 静态资源：GET /api/dsh-poetry/assets?f=<相对路径>（M0 形态，只读、越界 404）；
//   · 数据接口：GET health / bootstrap / poems / ci / yun / knowledge / settings / weather / about；
//   · 设置接口：GET/PUT settings.json（PUT 仅回环来源、白名单校验、原子写 $DSH_HOME/.dsh-poetry/）；
//   · 天气接口：GET weather.json（Open-Meteo 地理编码 + forecast，20min 缓存，失败降级永 200）；
//   · 心情统计：监听 session/event 累计当日活跃数据，GET mood.json；防抖原子写 mood.json；
//   · 实时自言自语：GET self-talk.json，用宿主当前默认模型生成（llm/agentDefaultModel 可选，缺失安全降级）；
//   · 模型心情：GET mood-ai.json，模型读本地 92 张心情图鉴 + 当天情境自主决定心情/配图（缺失安全降级）；
//   · 心情动画素材：GET/HEAD pet-media?f=…（dsh-pet MIT webm，不随包；不套栅栏，与 assets 并列）；
//   · 自主记忆：self-talk / mood-ai 新生成成功时，把模型输出**只追加**写入 $DSH_HOME/agent-memory/；
//   · 飞花令全量校验：GET feihua-full.json 按令字懒加载项目同级 _ref/feihua-full/<字>.json（LRU≤4、gzip、缺失降级）；
//   · 所有新增路由接入宿主信任栅栏（lib/trust.mjs，委托 connection.requestRejection）。
//
// 数据来自包内 data/*.json（只读），宿主进程内按 mtime + dataVersion 缓存；
// data/ 缺失或损坏时优雅降级（200 + DATA_UNAVAILABLE），不会让插件加载失败。
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAssetHandler } from './lib/assets.mjs'
import { createDataStore } from './lib/data-store.mjs'
import { createFeihuaFullService, resolveFeihuaFullDir } from './lib/feihua-full.mjs'
import { readPackageMeta } from './lib/paths.mjs'
import { createMemoryJournal, resolveMemoryDir } from './lib/memory-journal.mjs'
import { createMoodAiService, loadMoodCatalog } from './lib/mood-ai.mjs'
import {
  PET_MEDIA_ROUTE,
  createPetMediaHandler,
  loadPetMediaCatalog,
  mergePetMediaIntoMoodCatalog,
  petMediaDirExists,
  resolvePetMediaDir,
} from './lib/pet-media.mjs'
import { createRouteTable } from './lib/routes.mjs'
import { createSelfTalkService } from './lib/self-talk.mjs'
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
  // 自主记忆日志（契约 §2.13）：只追加写模型自己生成的内容；与 llm 是否可用无关，先建好等待写入。
  const memoryDir = resolveMemoryDir(env, home)
  const journal = createMemoryJournal({ dir: memoryDir, logger })

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
      // 模型调用：llm / agentDefaultModel 是 optional 服务（用 get 取，不放进 inject 硬依赖）。
      // 用 getter 延迟解析：宿主模型服务晚于本插件就绪、或 HMR 后换实例时仍能拿到最新引用。
      const getLlm = () => {
        try {
          return hostCtx.get('llm')
        } catch {
          return undefined
        }
      }
      const getSelection = () => {
        try {
          const agentDefaultModel = hostCtx.get('agentDefaultModel')
          return typeof agentDefaultModel?.currentSelection === 'function' ? agentDefaultModel.currentSelection() : null
        } catch {
          return null
        }
      }
      const selfTalkService = createSelfTalkService({ getLlm, getSelection, logger })
      // 心情动画素材（dsh-pet MIT webm，不随包）：读图鉴并并入 mood-ai 图鉴（106 个动画也可被模型选中）。
      const petMediaDir = resolvePetMediaDir(env, PACKAGE_ROOT)
      const petCatalog = loadPetMediaCatalog({ dir: petMediaDir, logger })
      if (petCatalog.ok === true) {
        logger?.info?.(`[dsh-poetry-widget] 心情动画素材：${petMediaDir}（${petCatalog.entries.length} 个视频）`)
      } else if (petMediaDirExists(petMediaDir)) {
        logger?.warn?.(`[dsh-poetry-widget] 心情动画素材不可用：${petCatalog.message}（mood-ai 仅用静态图）`)
      } else {
        logger?.warn?.(`[dsh-poetry-widget] 心情动画素材目录不存在（mood-ai 仅用静态图）：${petMediaDir}`)
      }
      // 模型心情：启动时读包内 92 张心情图鉴（缺失 → 服务降级为 MOOD_AI_UNAVAILABLE，不抛）。
      const moodCatalog = loadMoodCatalog()
      if (moodCatalog.ok !== true) {
        logger?.warn?.(`[dsh-poetry-widget] 心情图鉴不可用：${moodCatalog.message}`)
      }
      const moodCatalogForAi =
        petCatalog.ok === true && petCatalog.entries.length > 0
          ? mergePetMediaIntoMoodCatalog(moodCatalog.ok === true ? moodCatalog.catalog : null, petCatalog.entries)
          : moodCatalog.ok === true
            ? moodCatalog.catalog
            : null
      const moodAiService = createMoodAiService({
        getLlm,
        getSelection,
        catalog: moodCatalogForAi,
        logger,
      })
      // 飞花令全量校验句库：项目同级 _ref/feihua-full（不随包）；DSH_POETRY_FULL_INDEX 可覆盖。
      // 目录不存在时路由仍注册，只返回 FEIHUA_FULL_UNAVAILABLE（客户端回退本地句库）。
      const feihuaFullDir = resolveFeihuaFullDir(env, PACKAGE_ROOT)
      const feihuaFullService = createFeihuaFullService({ dir: feihuaFullDir, logger })
      if (existsSync(feihuaFullDir)) {
        logger?.info?.(`[dsh-poetry-widget] 飞花令全量校验目录：${feihuaFullDir}`)
      } else {
        logger?.warn?.(
          `[dsh-poetry-widget] 飞花令全量校验目录不存在（feihua-full 将返回 FEIHUA_FULL_UNAVAILABLE）：${feihuaFullDir}`,
        )
      }
      const routes = createRouteTable({
        dataStore,
        settingsStore,
        fence,
        version: VERSION,
        settingsFile: settingsPath.file,
        weatherService,
        moodTracker,
        selfTalkService,
        moodAiService,
        journal,
        feihuaFullService,
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
      // dsh-pet 动画素材静态路由（只读、无用户数据；供 <video> 直接加载，与 assets 同类不套栅栏）。
      disposers.push(
        webServer.register({
          kind: 'exact',
          path: PET_MEDIA_ROUTE,
          handler: createPetMediaHandler({ dir: petMediaDir, logger }),
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
        `[dsh-poetry-widget] 已挂载 ${routes.length + 2} 条路由（assets + pet-media + ${routes.length} 条 JSON，version ${VERSION}，` +
          `dataVersion ${dataStore.getDataVersion() ?? '(数据未就绪)'}）`,
      )
      logger?.info?.(`[dsh-poetry-widget] 自主记忆日志目录：${memoryDir}`)
    } catch (error) {
      // 路由注册失败只影响本插件，不能让宿主 apply 抛未捕获异常。
      logger?.error?.(
        `[dsh-poetry-widget] 路由注册失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      )
    }
  })
}
