// tests/domains/minecraft-world.test.mjs —— P0 World 工具/回执/打断（v0.9.0）
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildWorldPrompt, createMinecraftWorld, parseWorldCommand } from '../../lib/domain/play/minecraft-world.mjs'
import { createGameMemoryWorkspace } from '../../lib/domain/play/game-memory-workspace.mjs'

function fakeReq(method, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url: '/api/dsh-poetry/game-world.json',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload)
    },
  }
}
function fakeRes() {
  return {
    statusCode: 0,
    body: '',
    writeHead(status) { this.statusCode = status; return this },
    end(body) { this.body = String(body) },
    json() { return JSON.parse(this.body) },
  }
}
function tempToken() {
  const dir = mkdtempSync(path.join(tmpdir(), 'whale-world-'))
  const file = path.join(dir, 'token')
  writeFileSync(file, 'secret')
  return { dir, file }
}

test('World 工具解析：合法工具/参数夹取/非法回退', () => {
  assert.deepEqual(parseWorldCommand('{"tool":"mc_wait","arguments":{"seconds":99}}'), { tool: 'mc_wait', arguments: { seconds: 10 }, reason: '' })
  assert.deepEqual(parseWorldCommand('{"tool":"mc_say","arguments":{"text":"嗨"}}').tool, 'mc_say')
  assert.equal(parseWorldCommand('{"tool":"mc_move_to","arguments":{"x":1,"z":2}}').tool, 'mc_move_to')
  assert.equal(parseWorldCommand('{"tool":"mc_move_to","arguments":{"x":1}}'), null)
  assert.equal(parseWorldCommand('{"tool":"drop_all"}'), null)
  assert.equal(parseWorldCommand('不是 JSON'), null)
})

test('World prompt：列出工具、观察、记忆与安全边界', () => {
  const prompt = buildWorldPrompt({ position: '1,2,3', health: 20, food: 18, players: ['Yuan_JY'], nearbyBlocks: ['oak_log'], inventory: ['dirt×3'] }, { memoryLines: ['方法：先砍树'] })
  assert.match(prompt, /mc_move_to/)
  assert.match(prompt, /mc_say/)
  assert.match(prompt, /Yuan_JY/)
  assert.match(prompt, /先砍树/)
  assert.match(prompt, /不要攻击玩家/)
})

test('World 会话：打断与权限', async () => {
  const { dir, file } = tempToken()
  try {
    const world = createMinecraftWorld({ tokenFile: file })
    assert.equal(world.snapshot().permission, 'control')
    assert.equal(world.setPermission('observe'), 'observe')
    assert.equal(world.snapshot().permission, 'observe')
    assert.equal(world.interrupt('聊天').interruptReason, '聊天')
    const res = fakeRes()
    await world.handler(fakeReq('POST', { token: 'secret', action: 'receipt', receipt: { tool: 'mc_say', ok: true, detail: '说了嗨' } }), res)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().lastReceipt.tool, 'mc_say')
    const getRes = fakeRes()
    await world.handler({ method: 'GET', url: '/x?token=secret' }, getRes)
    assert.equal(getRes.json().interrupted, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('文件记忆：写入分类文件、短画像与 Git', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'whale-memory-'))
  try {
    const memory = createGameMemoryWorkspace({ dir, now: () => Date.parse('2026-11-17T10:00:00Z'), git: true })
    assert.equal(memory.record({ category: 'world', text: '住在丛林边' }).ok, true)
    assert.equal(memory.record({ category: 'method', text: '先砍树再做工具' }).ok, true)
    assert.equal(memory.record({ category: 'event', text: '第一次砍到丛林木' }).ok, true)
    assert.match(readFileSync(path.join(dir, 'PARTNER_GAME.md'), 'utf8'), /丛林边/)
    assert.match(readFileSync(path.join(dir, 'methods.md'), 'utf8'), /先砍树/)
    assert.match(readFileSync(path.join(dir, 'log/2026-11.md'), 'utf8'), /2026-11-17/)
    assert.ok(memory.promptLines(2).some((line) => line.includes('游戏短画像')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
