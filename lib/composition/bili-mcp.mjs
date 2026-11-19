// @ts-check
// 直接启动 dsh-bili-scroll 的 Python MCP，避免宿主 tool scope 差异。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function readConfig(home) {
  try {
    return JSON.parse(readFileSync(path.join(home, '.dsh', 'bili-duty', 'config.json'), 'utf8'))
  } catch (error) {
    void error
    return {}
  }
}

class MiniMcp {
  constructor({ command, args, cwd, env, timeoutMs = 60000 }) {
    this.command = command
    this.args = args
    this.cwd = cwd
    this.env = env
    this.timeoutMs = timeoutMs
    this.proc = null
    this.buf = ''
    this.nextId = 1
    this.pending = new Map()
    this.starting = null
  }
  async start() {
    if (this.proc) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      this.proc = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...(this.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.proc.stdout.setEncoding('utf8')
      this.proc.stdout.on('data', (chunk) => this.#onData(chunk))
      this.proc.stderr.on('data', () => {})
      this.proc.on('exit', () => {
        for (const [, item] of this.pending) item.reject(new Error('MCP 子进程退出'))
        this.pending.clear()
        this.proc = null
      })
      await this.#request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dsh-little-whale-guide', version: '0.1.0' },
      })
      this.#notify('notifications/initialized', {})
    })()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }
  #onData(chunk) {
    this.buf += chunk
    for (;;) {
      const index = this.buf.indexOf('\n')
      if (index < 0) break
      const line = this.buf.slice(0, index).trim()
      this.buf = this.buf.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch (error) {
        void error
        continue
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const item = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) item.reject(new Error(String(message.error?.message || message.error)))
        else item.resolve(message.result)
      }
    }
  }
  #send(value) {
    if (!this.proc?.stdin?.writable) throw new Error('MCP 管道不在')
    this.proc.stdin.write(JSON.stringify(value) + '\n')
  }
  #notify(method, params) {
    this.#send({ jsonrpc: '2.0', method, params })
  }
  #request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('MCP 超时：' + method))
      }, this.timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.#send({ jsonrpc: '2.0', id, method, params })
    })
  }
  async call(name, args = {}) {
    await this.start()
    const result = await this.#request('tools/call', { name, arguments: args })
    const text = (Array.isArray(result?.content) ? result.content : [])
      .map((block) => (typeof block?.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (result?.isError) throw new Error(text || 'MCP 工具失败')
    try {
      return text ? JSON.parse(text) : {}
    } catch (error) {
      void error
      return text
    }
  }
  stop() {
    try {
      this.proc?.kill()
    } catch (error) {
      void error
    }
    this.proc = null
  }
}

export function createBiliMcpSource(options = {}) {
  const home = typeof options.home === 'string' && options.home.length > 0 ? options.home : os.homedir()
  const stateDir = path.join(home, '.dsh', 'bili-duty')
  const logger = options.logger ?? null
  const config = readConfig(home)
  const python = typeof config.pythonPath === 'string' && config.pythonPath.length > 0 ? config.pythonPath : 'python3'
  const script = path.join(stateDir, 'mcp_server.py')
  const available = existsSync(script) && existsSync(python)
  let client = null
  function getClient() {
    if (!available) return null
    if (client === null)
      client = new MiniMcp({ command: python, args: [script], cwd: stateDir, env: { PYTHONIOENCODING: 'utf-8' } })
    return client
  }
  async function searchVideos(topic, count = 3) {
    const mcp = getClient()
    if (mcp === null) return []
    const base = String(topic || '')
      .replace(/minecraft/gi, '我的世界')
      .slice(0, 80)
    const queries = base.includes('我的世界')
      ? [base + ' 教程', '我的世界 新手 生存 教程']
      : [base + ' 教程', base + ' 攻略']
    const out = []
    const seen = new Set()
    for (const query of queries) {
      let value = null
      try {
        value = await mcp.call('bili_search', { keyword: query, num: Math.max(1, Math.min(10, count)), order: 'click' })
      } catch (error) {
        void error
        continue
      }
      const list = value && typeof value === 'object' && Array.isArray(value.videos) ? value.videos : []
      for (const item of list) {
        const bvid = String(item.bvid || '').slice(0, 40)
        if (bvid.length === 0 || seen.has(bvid)) continue
        seen.add(bvid)
        out.push({
          bvid,
          title: String(item.title || '').slice(0, 160),
          author: String(item.author || '').slice(0, 80),
        })
        if (out.length >= count) return out
      }
    }
    return out
  }

  async function fetchSubtitle(bvid) {
    const mcp = getClient()
    if (mcp === null) return ''
    const value = await mcp.call('bili_subtitle', { bvid: String(bvid || '') })
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && typeof value.text === 'string') return value.text
    return ''
  }
  return { available, searchVideos, fetchSubtitle, stop: () => client?.stop?.() }
}
