// @ts-check
// lib/composition/interactive-routes.mjs —— 交互/写操作路由（W1 从 index.js 抽出）

import { createManualReadHandler } from '../domain/learning/manual-reading.mjs'
import { ATTENTION_ROUTE, createAttentionHandler } from '../domain/relationship/attention.mjs'

export function registerTwinRoutes({ webServer, disposers, twinEnabled, twinSystem, logger }) {
  const handler = async (_req, res) => {
    const payload = twinEnabled && twinSystem !== null ? twinSystem.status() : { enabled: false, note: '镜像已停用' }
    const body = JSON.stringify({ ok: true, ...payload })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    res.end(body)
  }
  disposers.push(webServer.register({ kind: 'exact', path: '/api/dsh-poetry/twin.json', handler }))
  if (!twinEnabled) logger?.info?.('[dsh-little-whale] 镜像已停用（DSH_POETRY_TWIN=on 可恢复）')
}

export function registerManualReadRoute({ webServer, disposers, manualReading, worldFeedback, tokenFile }) {
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-poetry/manual-read.json',
      handler: createManualReadHandler({
        service: {
          read: async (input) => {
            const result = await manualReading.read(input)
            worldFeedback.record({
              source: 'manual-reading',
              kind: 'read',
              ok: result.ok === true,
              summary: result.ok
                ? `${result.title}：${String(result.thought || '').slice(0, 80)}`
                : result.error || '没读成',
            })
            return result
          },
        },
        tokenFile,
      }),
    }),
  )
}

export function registerAttentionRoutes({ webServer, disposers, attention, outbox, selfProjects }) {
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: ATTENTION_ROUTE,
      handler: createAttentionHandler({
        attention,
        sendText: (item) =>
          outbox.deliverNow({
            source: 'gui',
            text: item.text,
            id: `att-${item.id}`,
            kind: 'attention',
            meta: { attentionId: item.id },
          }),
        onAnswer: async (item, text) => {
          const projectId = item?.meta && typeof item.meta.projectId === 'string' ? item.meta.projectId : ''
          if (!projectId || typeof selfProjects.answerAttention !== 'function') return null
          return selfProjects.answerAttention(projectId, text)
        },
      }),
    }),
  )
}

export function registerProjectRoutes({ webServer, disposers, selfProjects }) {
  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-poetry/project.json',
      handler: async (req, res) => {
        const isGet = String(req?.method ?? 'GET').toUpperCase() === 'GET'
        const body = isGet
          ? JSON.stringify({
              ok: true,
              current: selfProjects.current(),
              stage: selfProjects.snapshot().stage,
              latestReport: selfProjects.snapshot().latestReport,
              attention: selfProjects.snapshot().attention,
              steps: (selfProjects.current() && Array.isArray(selfProjects.current().steps)
                ? selfProjects.current().steps
                : []
              ).slice(-24),
              completed: selfProjects
                .completed()
                .slice(-10)
                .map((item) => ({
                  id: item.id,
                  title: item.title,
                  outcome: item.outcome,
                  endedAt: item.endedAt,
                  steps: (Array.isArray(item.steps) ? item.steps : []).slice(-3),
                })),
            })
          : JSON.stringify({ ok: false, error: 'method_not_allowed' })
        res.writeHead(isGet ? 200 : 405, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': String(Buffer.byteLength(body)),
        })
        res.end(body)
      },
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-poetry/project-action.json',
      handler: async (req, res) => {
        const send = (status, payload) => {
          const body = JSON.stringify(payload)
          res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Length': String(Buffer.byteLength(body)),
          })
          res.end(body)
        }
        if ((req.method || 'GET').toUpperCase() !== 'POST') {
          res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('method not allowed')
          return
        }
        let payload = null
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          send(400, { ok: false, error: 'invalid_json' })
          return
        }
        const action = String(payload?.action ?? '')
        const current = selfProjects.current()
        const id = String(payload?.id ?? (current ? current.id : ''))
        if (!current || current.id !== id) {
          send(404, { ok: false, error: 'not_found' })
          return
        }
        let result = null
        if (action === 'retry') result = selfProjects.retryProject(id)
        else if (action === 'pause') result = selfProjects.pauseProject(id)
        else if (action === 'drop') result = selfProjects.dropProject(id)
        if (result === null) {
          send(400, { ok: false, error: 'action_refused' })
          return
        }
        send(200, { ok: true, action, project: selfProjects.snapshot() })
      },
    }),
  )
}
