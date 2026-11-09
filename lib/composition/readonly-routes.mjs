// lib/composition/readonly-routes.mjs —— 只读/静态 HTTP 路由（W1 抽取）
//
// 这些路由只读服务快照或她自己生成的文件；不套信任栅栏，无用户内容。
import path from 'node:path'
import { createAssetHandler } from '../assets.mjs'
import { createMemorySnapshotHandler } from '../memory-hub.mjs'
import { createModelErrorsHandler } from '../model-errors.mjs'
import { createPetMediaHandler } from '../pet-media.mjs'
import { createPresenceHandler } from '../presence.mjs'
import { createSelfBeingHandler } from '../self-being.mjs'
import { createWorksHandler, createWorksMediaHandler } from '../self-works.mjs'
import { formatGraphViewHtml } from './graph-page.mjs'

/**
 * @param {{
 *   webServer: object, disposers: Array<Function>,
 *   assetsRoute: string, assetsDir: string,
 *   petMediaRoute: string, petMediaDir: string,
 *   memoryRoute: string, memoryHub: object,
 *   modelErrorsRoute: string, modelErrorsPath: string,
 *   presenceRoute: string, worldFeedback: object, logger: object|null,
 *   selfWorks: object,
 *   getSelfState: Function, getGrowth: Function, getActions: Function, getProject: Function,
 *   graph: { getSnapshot: Function, readGraph: Function, stateDir: string },
 * }} deps
 */
export function registerReadonlyRoutes(deps) {
  const { webServer, disposers } = deps
  const register = (kind, path, handler) => disposers.push(webServer.register({ kind, path, handler }))

  register('exact', deps.assetsRoute, createAssetHandler({ assetsDir: deps.assetsDir }))
  register('exact', deps.petMediaRoute, createPetMediaHandler({ dir: deps.petMediaDir, logger: deps.logger }))
  register('exact', deps.memoryRoute, createMemorySnapshotHandler({ hub: deps.memoryHub }))
  register('exact', deps.modelErrorsRoute, createModelErrorsHandler({ file: deps.modelErrorsPath }))
  register(
    'exact',
    deps.presenceRoute,
    createPresenceHandler({ worldFeedback: deps.worldFeedback, logger: deps.logger }),
  )
  register('exact', '/api/dsh-poetry/works.json', createWorksHandler({ works: deps.selfWorks }))
  register('exact', '/api/dsh-poetry/works/media', createWorksMediaHandler({ works: deps.selfWorks }))
  register(
    'exact',
    '/api/dsh-poetry/self.json',
    createSelfBeingHandler({
      getSnapshot: deps.getSelfState,
      getGrowth: deps.getGrowth,
      getActions: deps.getActions,
      getProject: deps.getProject,
    }),
  )

  // 旧可视化入口（兼容；新面板走 graph.json?view=1）。
  register('exact', '/api/dsh-poetry/graph-view', async (_req, res) => {
    const html = formatGraphViewHtml({ title: '小鲸鱼的认知图谱' })
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(html)),
    })
    res.end(html)
  })

  // 认知图谱：?view=1 时直接返回可视化页；否则返回全量 graph.json。
  register('exact', '/api/dsh-poetry/graph.json', async (req, res) => {
    try {
      if (/[?&]view=1/.test(String(req?.url ? req.url : ''))) {
        const html = formatGraphViewHtml({ title: '小鲸鱼的认知图谱' })
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': String(Buffer.byteLength(html)),
        })
        res.end(html)
        return
      }
      const graph = deps.graph.readGraph(
        deps.graph.stateDir ? path.join(deps.graph.stateDir, 'knowledge-graph.json') : '',
      )
      const body = JSON.stringify({
        ok: true,
        ...deps.graph.getSnapshot(),
        nodes: graph.nodes,
        edges: graph.edges,
        claims: graph.claims,
      })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': String(Buffer.byteLength(body)),
      })
      res.end(body)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(String(error instanceof Error ? error.message : error))
    }
  })
}
