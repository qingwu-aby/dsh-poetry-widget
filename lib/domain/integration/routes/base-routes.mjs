// lib/domain/integration/routes/base-routes.mjs —— 基础/数据/关于路由（v0.2.4 从 routes.mjs 拆出）
import { createMemoryBackupHandler } from '../../memory/index.mjs'
import { maskPath } from '../../../kernel/paths.mjs'

export function createBaseRoutes(ctx) {
  const { route, dataGet, guarded, sendJson, DATA_UNAVAILABLE, dataStore, settingsStore, version, getRuntime, now, memoryHub, fence, settingsFile, home, env } = ctx
  return [
    route(
      'health.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'data',
        handler: async (req, res) => {
          const manifest = dataStore.getManifest()
          sendJson(res, 200, {
            ok: true,
            version,
            dataVersion: manifest.ok ? manifest.dataVersion : null,
            dataAvailable: dataStore.isDataAvailable(),
            // v1.73：后台服务的运行快照（只含 lastRun/nextRun 等元数据，不含内容）。
            ...(typeof getRuntime === 'function' ? { runtime: getRuntime() } : {}),
          })
        },
      }),
    ),
    route(
      'bootstrap.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'data',
        handler: async (req, res) => {
          const manifest = dataStore.getManifest()
          if (!manifest.ok) {
            sendJson(res, 200, DATA_UNAVAILABLE(manifest.error.message))
            return
          }
          const poems = dataStore.load('poems.json')
          if (!poems.ok) {
            sendJson(res, 200, DATA_UNAVAILABLE(poems.error.message))
            return
          }
          const today = dataStore.getToday(now())
          if (!today.ok) {
            sendJson(res, 200, DATA_UNAVAILABLE(today.error.message))
            return
          }
          sendJson(res, 200, {
            ok: true,
            version,
            dataVersion: manifest.dataVersion,
            source: manifest.source,
            today: { date: today.date, poemId: today.poemId },
            counts: dataStore.getCounts(),
            settings: settingsStore.get(),
          })
        },
      }),
    ),
    route('poems.json', dataGet('poems.json')),
    route('ci.json', dataGet('ci.json')),
    route('yun.json', dataGet('yun.json')),
    route('knowledge.json', dataGet('knowledge.json')),
    route(
      'memory/backup.json',
      createMemoryBackupHandler({
        hub: memoryHub ?? null,
        fence,
      }),
    ),
    route(
      'about.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'data',
        handler: async (req, res) => {
          const manifest = dataStore.getManifest()
          sendJson(res, 200, {
            ok: true,
            version,
            dataVersion: manifest.ok ? manifest.dataVersion : null,
            source: manifest.ok ? manifest.source : null,
            files: dataStore.getStatuses(),
            settingsPath: maskPath(settingsFile, { home, dshHome: env.DSH_HOME }),
            builtAt: manifest.ok ? manifest.builtAt : null,
          })
        },
      }),
    ),
  ]
}
