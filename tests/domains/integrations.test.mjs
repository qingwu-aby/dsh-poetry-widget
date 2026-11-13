// tests/domains/integrations.test.mjs —— 并入主包的子插件能力（QQ 工具 + 镜像只读视图）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { registerLittleWhaleChatTool } from '../../lib/integrations/qq-bridge.mjs'
import { buildTwinState, createTwinStateHandler } from '../../lib/integrations/twin-view.mjs'

function tmpDir(prefix = 'dshp-integrations') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

test('QQ 传话工具：注册 little_whale_chat 并可调用 chat.json', async () => {
  const dir = tmpDir()
  fs.mkdirSync(path.join(dir, '.dsh-poetry'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh-poetry', 'chat-token'), 'token-1234567890\n', 'utf8')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const registered = []
  const tools = { register(spec) { registered.push(spec); return () => {} } }
  const host = {
    get(_hostCtx, name) {
      if (name === 'tools') return tools
      if (name === 'webServer') return { getOrigin: () => 'http://127.0.0.1:5555' }
      if (name === 'attachments') return { saveImages: async () => [] }
      return undefined
    },
  }
  const originalFetch = globalThis.fetch
  let requested = null
  globalThis.fetch = async (url, init) => {
    requested = { url: String(url), body: JSON.parse(String(init && init.body)) }
    return { ok: true, status: 200, json: async () => ({ ok: true, reply: '我在。', pending: ['之前想说的'] }) }
  }
  try {
    const dispose = registerLittleWhaleChatTool({ host, hostCtx: {}, logger: { info() {}, warn() {} } })
    assert.equal(registered.length, 1)
    const spec = registered[0]
    assert.equal(spec.name, 'little_whale_chat')
    assert.deepEqual(spec.parameters.required, [])
    const result = await spec.execute({ text: '你好', peerId: 'qq-1' }, {})
    assert.equal(result.reply, '我在。')
    assert.deepEqual(result.pending, ['之前想说的'])
    assert.equal(requested.url, 'http://127.0.0.1:5555/api/dsh-poetry/chat.json')
    assert.equal(requested.body.token, 'token-1234567890')
    assert.equal(requested.body.text, '你好')
    assert.equal(requested.body.peerId, 'qq-1')
    dispose()
  } finally {
    globalThis.fetch = originalFetch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('QQ 传话工具：宿主没有 tools 时安全跳过', () => {
  const host = { get: () => undefined }
  const dispose = registerLittleWhaleChatTool({ host, hostCtx: {}, logger: null })
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('镜像只读视图：读 twin 状态、项目与信件', async () => {
  const dir = tmpDir()
  fs.mkdirSync(path.join(dir, '.dsh-poetry-twin'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.dsh-poetry', 'twin-bridge'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.dsh-poetry-twin', 'self-state.json'), JSON.stringify({ felt: '有点累' }), 'utf8')
  fs.writeFileSync(
    path.join(dir, '.dsh-poetry', 'twin-bridge', 'letters.jsonl'),
    [
      JSON.stringify({ id: 'l1', from: 'twin', kind: 'research', text: '我查到一点' }),
      JSON.stringify({ id: 'l2', from: 'primary', text: '收到' }),
    ].join('\n'),
    'utf8',
  )
  fs.writeFileSync(path.join(dir, '.dsh-poetry', 'projects.json'), JSON.stringify({ current: { title: '原体的项目' } }), 'utf8')
  const state = buildTwinState({ env: { DSH_HOME: dir } })
  assert.equal(state.ok, true)
  assert.equal(state.enabled, true)
  assert.equal(state.state.felt, '有点累')
  assert.equal(state.letters.length, 2)
  assert.equal(state.primaryProject.title, '原体的项目')
  assert.equal(buildTwinState({ env: { DSH_HOME: dir, DSH_POETRY_TWIN: 'off' } }).enabled, false)

  const handler = createTwinStateHandler({ env: { DSH_HOME: dir } })
  let status = 0
  let body = ''
  await handler(
    { method: 'GET' },
    { writeHead(code) { status = code }, end(chunk) { body = String(chunk || '') } },
  )
  assert.equal(status, 200)
  assert.match(body, /有点累/)

  let methodStatus = 0
  await handler(
    { method: 'POST' },
    { writeHead(code) { methodStatus = code }, end() {} },
  )
  assert.equal(methodStatus, 405)
})
