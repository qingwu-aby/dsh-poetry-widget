// lib/domain/play/minecraft-service.mjs —— Minecraft 服务一键启动/停止（v0.6.1）
//
// 两种启动方式：
//   background=true  → launchd 常驻（关掉 DSH 也继续跑）
//   background=false → 由当前 DSH 进程拉起子进程（DSH 退出即停止）
// 服务目录默认 ~/dsh-workspace/minecraft-bot。
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readChatToken } from '../chat/facade.mjs'

const LABELS = Object.freeze({
  server: 'com.yangyuan.whale.minecraft-server',
  proxy: 'com.yangyuan.whale.minecraft-proxy',
  bot: 'com.yangyuan.whale.minecraft-bot',
})
const SCRIPTS = Object.freeze({
  server: 'server261/start.sh',
  proxy: 'start-proxy.sh',
  bot: 'start-bot.sh',
})

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (_error) {
    return null
  }
}
function portListening(port, run) {
  try {
    const result = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 4000 })
    return result.status === 0 && String(result.stdout || '').trim().length > 0
  } catch (_error) {
    return false
  }
}

export function createMinecraftService(options = {}) {
  const home = options.home ?? os.homedir()
  const env = options.env ?? process.env
  const run = options.run ?? spawnSync
  const spawnFn = options.spawnFn ?? spawn
  const dir = path.resolve(home, options.dirName ?? env.MC_DIR ?? 'dsh-workspace/minecraft-bot')
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501
  const children = new Map()
  const plistFor = (key) => path.join(home, 'Library/LaunchAgents', `${LABELS[key]}.plist`)
  const logDir = path.join(home, 'Library/Logs')

  function status() {
    const botStatus = readJson(path.join(dir, 'bot-status.json'))
    const launchd = {}
    try {
      const result = run('launchctl', ['list'], { encoding: 'utf8', timeout: 4000 })
      const out = String(result.stdout || '')
      for (const key of Object.keys(LABELS)) launchd[key] = out.includes(LABELS[key])
    } catch (_error) {}
    return {
      ok: true,
      dir,
      background: launchd,
      foreground: Object.fromEntries([...children.keys()].map((key) => [key, children.get(key).pid])),
      ports: { server: portListening(25566, run), proxy: portListening(25568, run) },
      bot: botStatus,
    }
  }

  function startBackground() {
    const started = []
    for (const key of Object.keys(LABELS)) {
      const plist = plistFor(key)
      const boot = run('launchctl', ['bootstrap', `gui/${uid}`, plist], { encoding: 'utf8', timeout: 5000 })
      const kick = run('launchctl', ['kickstart', '-k', `gui/${uid}/${LABELS[key]}`], { encoding: 'utf8', timeout: 5000 })
      started.push({ key, ok: boot.status === 0 || kick.status === 0 })
    }
    const after = status()
    const ok = after.ports.server && after.background.proxy && after.background.bot
    return { ok, background: true, started, status: after }
  }

  function startForeground() {
    const started = []
    for (const key of Object.keys(SCRIPTS)) {
      if (children.has(key)) {
        started.push({ key, ok: true, pid: children.get(key).pid })
        continue
      }
      const child = spawnFn(path.join(dir, SCRIPTS[key]), [], {
        cwd: dir,
        detached: false,
        stdio: 'ignore',
        env: Object.assign({}, env, { MC_HOST: '127.0.0.1', MC_PORT: '25566', MC_VERSION: '26.1' }),
      })
      child.on?.('exit', () => children.delete(key))
      children.set(key, child)
      started.push({ key, ok: true, pid: child.pid })
    }
    return { ok: true, background: false, started, logs: logDir }
  }

  function stopBackground() {
    for (const key of Object.keys(LABELS)) {
      const plist = plistFor(key)
      run('launchctl', ['bootout', `gui/${uid}`, plist], { encoding: 'utf8', timeout: 5000 })
    }
    return { ok: true }
  }

  function stopForeground() {
    for (const [key, child] of children) {
      try {
        child.kill('SIGTERM')
      } catch (_error) {}
      children.delete(key)
    }
    return { ok: true }
  }

  async function start(input = {}) {
    const background = input.background !== false
    try {
      if (background) {
        stopForeground()
        return startBackground()
      }
      return startForeground()
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function stop(input = {}) {
    const background = input.background !== false
    try {
      if (background) stopBackground()
      else stopForeground()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return { start, stop, status }
}

export function createMinecraftControlHandler(options = {}) {
  const service = options.service ?? null
  const tokenFile = options.tokenFile ?? ''
  const fence = options.fence ?? null
  const gameWorld = options.gameWorld ?? null
  const readBody = async (req) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  const fenceAllows = (req) => {
    try {
      if (fence === null || typeof fence.check !== 'function') return true
      return fence.check(req) === null
    } catch (_error) {
      return false
    }
  }
  return async function minecraftControlHandler(req, res) {
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method === 'GET') {
      if (!fenceAllows(req)) {
        send(403, { ok: false, error: 'forbidden' })
        return
      }
      const base = service ? service.status() : { ok: false, error: 'unavailable' }
      send(200, gameWorld ? { ...base, world: gameWorld.snapshot() } : base)
      return
    }
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      payload = await readBody(req)
    } catch (_error) {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    const expected = readChatToken(tokenFile)
    const tokenOk = expected.length > 0 && payload && payload.token === expected
    if (!tokenOk && !fenceAllows(req)) {
      send(403, { ok: false, error: 'forbidden' })
      return
    }
    if (!service) {
      send(200, { ok: false, error: 'unavailable' })
      return
    }
    if (payload.action === 'permission' && gameWorld) {
      send(200, { ok: true, permission: gameWorld.setPermission(payload.level) })
      return
    }
    if (payload.action === 'start') send(200, await service.start({ background: payload.background !== false }))
    else if (payload.action === 'stop') send(200, await service.stop({ background: payload.background !== false }))
    else send(400, { ok: false, error: 'unknown_action' })
  }
}
