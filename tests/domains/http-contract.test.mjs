// tests/domains/http-contract.test.mjs —— HTTP JSON 契约测试（W3）
//
// 用假宿主把插件 apply 起来，直接调用注册的 handler，校验每个 JSON 路由的顶层形状。
// 目的：以后路由重构/字段改名会在这里先炸，而不是等客户端坏掉。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply as pluginApply } from '../../index.js'

function tmpDir(prefix = 'dshp-contract') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

class MockResponse {
  constructor() { this.statusCode = 200; this.headers = {}; this.body = '' }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers || {} }
  end(chunk) { this.body = chunk === undefined ? '' : String(chunk) }
  json() { return JSON.parse(this.body) }
}

function mockRequest({ method = 'GET', url = '/', body } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  request.method = method
  request.url = url
  request.headers = { host: '127.0.0.1:57623' }
  return request
}

function makeHarness() {
  const dshHome = tmpDir('dshp-contract-home')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  const routes = []
  const cleanups = []
  const fakeCtx = {
    logger: { info() {}, warn() {}, error() {} },
    on() { return () => {} },
    effect(execute) { const disposer = execute(); cleanups.push(disposer); return disposer },
    inject(_keys, callback) {
      callback({
        get(name) {
          if (name === 'webServer') return { register(route) { routes.push(route); return () => {} } }
          if (name === 'connection') return { requestRejection: () => undefined }
          return {
            requestRejection: () => undefined,
            prompt: async () => {},
            list: async () => [],
            create: async () => ({}),
          }
        },
        effect(execute) { const disposer = execute(); cleanups.push(disposer); return disposer },
      })
    },
  }
  return {
    dshHome,
    routes,
    cleanups,
    async start() { await pluginApply(fakeCtx) },
    async call(routePath, request = mockRequest()) {
      const route = routes.find((item) => item.path === routePath)
      assert.ok(route, `路由未注册：${routePath}`)
      const response = new MockResponse()
      await route.handler(request, response)
      return response
    },
    dispose() {
      for (const cleanup of cleanups) {
        try { cleanup() } catch { /* ignore */ }
      }
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    },
  }
}

let harness
test.before(async () => {
  harness = makeHarness()
  await harness.start()
})
test.after(() => harness.dispose())

const contract = [
  ['/api/dsh-poetry/health.json', ['ok', 'runtime']],
  ['/api/dsh-poetry/self.json', ['ok', 'state']],
  ['/api/dsh-poetry/memory.json', ['ok']],
  ['/api/dsh-poetry/graph.json', ['ok', 'nodes', 'edges', 'claims']],
  ['/api/dsh-poetry/works.json', ['ok']],
  ['/api/dsh-poetry/model-errors.json', ['ok']],
  ['/api/dsh-poetry/settings.json', ['ok', 'settings']],
  ['/api/dsh-poetry/bootstrap.json', ['ok']],
]

for (const [routePath, keys] of contract) {
  test(`契约：${routePath} 返回 200 且包含 ${keys.join('/')}`, async () => {
    const response = await harness.call(routePath)
    assert.equal(response.statusCode, 200, `${routePath} 应 200`)
    const body = response.json()
    for (const key of keys) assert.ok(key in body, `${routePath} 缺字段 ${key}`)
  })
}

test('契约：graph.json?view=1 返回 HTML，其余返回 JSON', async () => {
  const html = await harness.call('/api/dsh-poetry/graph.json', mockRequest({ url: '/api/dsh-poetry/graph.json?view=1' }))
  assert.equal(html.statusCode, 200)
  assert.match(html.headers['Content-Type'], /text\/html/)
  assert.match(html.body, /<svg|<script/)
  const json = await harness.call('/api/dsh-poetry/graph.json')
  assert.equal(json.statusCode, 200)
  assert.match(json.headers['Content-Type'], /application\/json/)
})

test('契约：未知路径/错误方法有明确错误码', async () => {
  const chatGet = await harness.call('/api/dsh-poetry/chat.json', mockRequest({ method: 'GET' }))
  assert.ok(chatGet.statusCode >= 400, 'chat.json 非 POST 应拒绝')
  assert.match(String(chatGet.body), /method not allowed/)
})
