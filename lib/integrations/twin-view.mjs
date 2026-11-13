// lib/integrations/twin-view.mjs —— 镜像实例只读状态（v0.2.0 从 dsh-little-whale-twin 并入）
//
// 读 `.dsh-poetry-twin` 与 twin-bridge 信件；不运行、不写入镜像。路由：
//   GET /api/dsh-poetry/twin-state.json
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_LETTERS = 200

function baseDir(env) {
  return env && env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(os.homedir(), '.dsh')
}

function readJson(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function readJsonl(file, limit = MAX_LETTERS) {
  try {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .slice(-limit)
  } catch {
    return []
  }
}

export function buildTwinState(options = {}) {
  const base = baseDir(options.env)
  const stateDir = path.join(base, '.dsh-poetry-twin')
  const bridgeDir = path.join(base, '.dsh-poetry')
  const enabled = String((options.env ?? {}).DSH_POETRY_TWIN ?? 'on').toLowerCase() !== 'off'
  if (!enabled) return { ok: true, enabled: false, note: '镜像已停用' }
  const state = readJson(path.join(stateDir, 'self-state.json'))
  const actions = readJson(path.join(stateDir, 'self-actions.json'))
  const projects = readJson(path.join(stateDir, 'projects.json'))
  const primaryProjects = readJson(path.join(bridgeDir, 'projects.json'))
  const events = readJson(path.join(stateDir, 'events.json'))
  const metabolism = readJson(path.join(stateDir, 'metabolism.json'))
  return {
    ok: true,
    enabled: true,
    updatedAt: Date.now(),
    state,
    actions: Array.isArray(actions?.actions) ? actions.actions.slice(-5) : [],
    project: projects?.current ?? null,
    primaryProject: primaryProjects?.current ?? null,
    events: events?.current ?? null,
    metabolism: metabolism ?? null,
    letters: readJsonl(path.join(bridgeDir, 'twin-bridge', 'letters.jsonl'), MAX_LETTERS),
    session: readJson(path.join(bridgeDir, 'twin-bridge', 'session.json'), null),
  }
}

export function createTwinStateHandler(options = {}) {
  return async (req, res) => {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    const body = JSON.stringify(buildTwinState({ env: options.env ?? process.env }))
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    if (method === 'HEAD') res.end()
    else res.end(body)
  }
}
