// tests/domains/minecraft-world.test.mjs —— P0 World 工具/回执/打断（v0.9.0）
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildBlueprintPrompt, buildWorldPrompt, createMinecraftWorld, filterBlueprintByMaterials, parseQueuedCommands, parseWorldCommand } from '../../lib/domain/play/minecraft-world.mjs'
import { registerGameRoute } from '../../lib/composition/interactive-routes.mjs'
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
  assert.deepEqual(parseWorldCommand('{"tool":"mc_explore","arguments":{"direction":"east","distance":9999}}'), { tool: 'mc_explore', arguments: { direction: 'east', distance: 1024 }, reason: '' })
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
  const stuckPrompt = buildWorldPrompt({ position: '1,2,3', health: 20, food: 18, stuck: true }, {})
  assert.match(stuckPrompt, /mc_inquire/)
  assert.match(stuckPrompt, /mc_learn/)
  assert.match(stuckPrompt, /卡在原地或洞窟/)
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

test('World 路由注册的是 handler 函数，不是 World 对象', () => {
  const handlers = new Map()
  const fakeWebServer = { register: (route) => { handlers.set(route.path, route.handler); return () => {} } }
  const world = { handler: async () => {}, snapshot: () => ({}) }
  registerGameRoute({
    webServer: fakeWebServer,
    disposers: [],
    gameBrain: {},
    gameMemory: {},
    gameFocus: {},
    gameLearning: { handler: async () => {} },
    minecraftWorld: world,
    minecraftService: {},
    chatTokenFile: '/tmp/none-token',
    fence: null,
    logger: { info() {} },
  })
  assert.equal(typeof handlers.get('/api/dsh-poetry/game-world.json'), 'function')
  assert.equal(handlers.get('/api/dsh-poetry/game-world.json'), world.handler)
})

test('建造计划解析：相对坐标边界、方块白名单、最少块数', async () => {
  const { parseBlueprint } = await import('../../lib/domain/play/minecraft-world.mjs')
  const plan = parseBlueprint('{"name":"小屋","blocks":[{"dx":0,"dy":0,"dz":0,"block":"dirt"},{"dx":1,"dy":0,"dz":0,"block":"oak_planks"},{"dx":2,"dy":1,"dz":0,"block":"glass"},{"dx":3,"dy":2,"dz":0,"block":"torch"},{"dx":4,"dy":0,"dz":0,"block":"stone"},{"dx":5,"dy":1,"dz":0,"block":"cobblestone"}]}')
  assert.ok(plan)
  assert.equal(plan.name, '小屋')
  assert.equal(plan.blocks.length, 6)
  assert.equal(parseBlueprint('{"blocks":[{"dx":99,"dy":0,"dz":0,"block":"dirt"}]}'), null)
  assert.equal(parseBlueprint('{"blocks":[{"dx":0,"dy":0,"dz":0,"block":"command_block"}]}'), null)
  assert.equal(parseBlueprint('不是 JSON'), null)
})

test('minecraft-world：大项目先调研，蓝图 prompt 带上资料', () => {
  const prompt = buildWorldPrompt({ position: '1,2,3' }, {})
  assert.match(prompt, /长期路线/)
  assert.match(prompt, /自检/)
  assert.match(prompt, /不会就先 mc_guide\/mc_learn/)
  const blueprint = buildBlueprintPrompt({ research: '先做木镐，再挖石头，避免垂直下挖' })
  assert.match(blueprint, /你刚查到的资料/)
  assert.match(blueprint, /先做木镐/)
  assert.match(blueprint, /资料没提到的不要假装知道/)
  const noResearch = buildBlueprintPrompt({})
  assert.match(noResearch, /没有资料也可以设计/)
})

test('minecraft-world：可解析 2–6 步动作队列，非法步骤丢弃', () => {
  const text = JSON.stringify({
    tool: 'mc_move_to', arguments: { x: 1, z: 2 },
    queue: [
      { tool: 'mc_mine', arguments: { block: 'dirt' } },
      { tool: 'mc_bad', arguments: {} },
      { tool: 'mc_place', arguments: { block: 'dirt' } },
    ],
  })
  const queue = parseQueuedCommands(text)
  assert.equal(queue.length, 2)
  assert.deepEqual(queue.map((item) => item.tool), ['mc_mine', 'mc_place'])
  assert.equal(parseQueuedCommands('not json').length, 0)
})

test('minecraft-world：使用/熔炼/睡觉/背包工具可解析', () => {
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_use', arguments: { target: 'furnace' } })).arguments.target, 'furnace')
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_smelt', arguments: { item: 'beef', count: 2 } })).arguments.count, 2)
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_sleep', arguments: {} })).tool, 'mc_sleep')
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_inventory', arguments: {} })).tool, 'mc_inventory')
})

test('minecraft-world：资源不足时蓝图缩小，并写入生存优先级', () => {
  const prompt = buildWorldPrompt({ position: '1,2,3' }, {})
  assert.match(prompt, /生存优先级/)
  assert.match(prompt, /资源匮乏时选低消耗/)
  const blueprint = buildBlueprintPrompt({ inventory: ['dirt×3'], maxBlocks: 8, resourceHint: '背包里大约 3 个可放材料' })
  assert.match(blueprint, /至多 8 块/)
  assert.match(blueprint, /资源情况/)
})

test('minecraft-world：自动机工具可解析', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_automate', arguments: { action: 'create', name: 'auto_eat', trigger: { type: 'hunger' }, steps: [{ tool: 'mc_eat', arguments: {} }], stopWhen: { foodGte: 20 } } }))
  assert.equal(cmd.tool, 'mc_automate')
  assert.equal(cmd.arguments.name, 'auto_eat')
  assert.equal(cmd.arguments.steps.length, 1)
})

test('minecraft-world：工具选择指南与重复动作约束', () => {
  const prompt = buildWorldPrompt({ position: '1,2,3' }, { recentCommands: [{ tool: 'mc_plan', ok: false }, { tool: 'mc_build', ok: false }] })
  assert.match(prompt, /工具选择顺序/)
  assert.match(prompt, /不要连续三次调用同一个失败动作/)
  assert.match(prompt, /最近动作：mc_plan\(失败\) → mc_build\(失败\)/)
})

test('minecraft-world：mc_find 可解析', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_find', arguments: { target: 'oak_log', maxDistance: 48 } }))
  assert.equal(cmd.tool, 'mc_find')
  assert.equal(cmd.arguments.target, 'oak_log')
  assert.equal(cmd.arguments.maxDistance, 48)
})

test('minecraft-world：蓝图只保留背包已有材料', () => {
  const plan = { name: 'x', blocks: [{ dx: 0, dy: 0, dz: 0, block: 'oak_planks' }, { dx: 1, dy: 0, dz: 0, block: 'diamond_block' }] }
  const filtered = filterBlueprintByMaterials(plan, ['oak_planks'])
  assert.equal(filtered.blocks.length, 1)
  assert.equal(filtered.blocks[0].block, 'oak_planks')
  assert.equal(filtered.filtered, true)
})

test('minecraft-world：耕地工具可解析', () => {
  const till = parseWorldCommand(JSON.stringify({ tool: 'mc_till', arguments: { maxDistance: 4 } }))
  assert.equal(till.tool, 'mc_till')
  assert.equal(till.arguments.maxDistance, 4)
  const harvest = parseWorldCommand(JSON.stringify({ tool: 'mc_harvest', arguments: {} }))
  assert.equal(harvest.tool, 'mc_harvest')
})

test('minecraft-world：红石/容器原语可解析', () => {
  const activate = parseWorldCommand(JSON.stringify({ tool: 'mc_activate', arguments: { target: 'lever' } }))
  assert.equal(activate.tool, 'mc_activate')
  assert.equal(activate.arguments.target, 'lever')
  const inspect = parseWorldCommand(JSON.stringify({ tool: 'mc_inspect', arguments: { target: 'observer' } }))
  assert.equal(inspect.tool, 'mc_inspect')
  const store = parseWorldCommand(JSON.stringify({ tool: 'mc_store', arguments: { item: 'wheat', count: 8 } }))
  assert.equal(store.arguments.item, 'wheat')
  assert.equal(store.arguments.count, 8)
  const take = parseWorldCommand(JSON.stringify({ tool: 'mc_take', arguments: { item: 'redstone', count: 4 } }))
  assert.equal(take.tool, 'mc_take')
})

test('minecraft-world：mc_place 支持 facing', () => {
  const place = parseWorldCommand(JSON.stringify({ tool: 'mc_place', arguments: { block: 'observer', facing: 'north' } }))
  assert.equal(place.tool, 'mc_place')
  assert.equal(place.arguments.facing, 'north')
})

test('minecraft-world：P2 农业原语可解析', () => {
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_bonemeal', arguments: {} })).tool, 'mc_bonemeal')
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_compost', arguments: {} })).tool, 'mc_compost')
})

test('minecraft-world：P3 战斗原语可解析', () => {
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_shoot', arguments: { target: 'zombie' } })).tool, 'mc_shoot')
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_block', arguments: {} })).tool, 'mc_block')
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_throw', arguments: { target: 'skeleton' } })).tool, 'mc_throw')
})

test('minecraft-world：P4 交通原语可解析', () => {
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_boat', arguments: {} })).tool, 'mc_boat')
  assert.equal(parseWorldCommand(JSON.stringify({ tool: 'mc_ride', arguments: { target: 'horse' } })).tool, 'mc_ride')
})

test('minecraft-world：mc_place 精确坐标', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_place', arguments: { block: 'observer', facing: 'east', at: '10,64,20' } }))
  assert.equal(cmd.arguments.at, '10,64,20')
  assert.equal(cmd.arguments.facing, 'east')
})

test('minecraft-world：红石/农场情境提示', () => {
  const prompt = buildWorldPrompt({ position: '0,0,0', inventory: 'redstone', nearbyBlocks: 'farmland' })
  assert.match(prompt, /红石相关物品/)
  assert.match(prompt, /mc_autofarm/)
})

test('minecraft-world：交通情境提示', () => {
  const prompt = buildWorldPrompt({ position: '0,0,0', inventory: 'minecart', nearbyBlocks: 'rail' })
  assert.match(prompt, /矿车=5铁锭/)
  assert.match(prompt, /mc_drive/)
})

test('minecraft-world：本地配方查询可解析', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_recipe', arguments: { item: 'minecart' } }))
  assert.equal(cmd.tool, 'mc_recipe')
  assert.equal(cmd.arguments.item, 'minecart')
})

test('minecraft-world：建设场景属于自主探索', () => {
  const prompt = buildWorldPrompt({ position: '0,0,0' })
  assert.match(prompt, /没有固定剧本/)
  assert.match(prompt, /mc_recipe 查本地配方/)
})

test('minecraft-world：建设场景自主设计提示', () => {
  const prompt = buildWorldPrompt({ position: '0,0,0' })
  assert.match(prompt, /没有固定剧本/)
  assert.match(prompt, /mc_recipe/)
})

test('minecraft-world：工具有层级升级提示', () => {
  const prompt = buildWorldPrompt({ position: '0,0,0' })
  assert.match(prompt, /工具有层级/)
  assert.match(prompt, /石镐/)
})

test('minecraft-world：mc_project 可解析并保留字段', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_project', arguments: { action: 'open', title: '带屋顶的院子', milestones: ['找平地', '备料'] } }))
  assert.equal(cmd.tool, 'mc_project')
  assert.equal(cmd.arguments.action, 'open')
  assert.equal(cmd.arguments.title, '带屋顶的院子')
  assert.equal(cmd.arguments.milestones.length, 2)
})

test('minecraft-world：mc_flee 可解析', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_flee', arguments: { distance: 14 } }))
  assert.equal(cmd.tool, 'mc_flee')
  assert.equal(cmd.arguments.distance, 14)
})

test('minecraft-world：mc_escape 可解析，卡住提示优先自救', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_escape', arguments: {} }))
  assert.equal(cmd.tool, 'mc_escape')
  const prompt = buildWorldPrompt({ position: '0,0,0', stuck: true })
  assert.match(prompt, /mc_escape/)
})

test('minecraft-world：mc_stair_up 可解析', () => {
  const cmd = parseWorldCommand(JSON.stringify({ tool: 'mc_stair_up', arguments: { steps: 10 } }))
  assert.equal(cmd.tool, 'mc_stair_up')
  assert.equal(cmd.arguments.steps, 10)
})
