/**
 * dsh-poetry-widget —— 客户端挂件单测（node:test，无需真实宿主 / 网络）。
 *
 * 做法：在 vm 沙箱里执行 client.js，mock `window.__ModuleLoader__.load`、
 *       `require('react')`、fetch、localStorage 与 ctx.slots；再断言：
 *       1) factory 注册 shell.overlay（id/order/组件）；
 *       2) 设置 PUT body 序列化 + 防抖 + 失败回调；
 *       3) 逐字平仄渲染 / 繁简选择 / 换一首策略等纯函数；
 *       4) 组件在主状态与 5 个面板 tab 下可渲染、不崩溃（轻量 React 桩）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLIENT_PATH = path.join(ROOT, 'client.js')
const CACHE_KEY = 'dshp.firstscreen.v1'

const POEM = {
  id: 'p1',
  title: '送杜少府之任蜀州',
  titleOriginal: '送杜少府之任蜀州',
  author: '王勃',
  authorOriginal: '王勃',
  dynasty: 'tang',
  lines: [
    '城阙辅三秦，风烟望五津。',
    '与君离别意，同是宦游人。',
    '海内存知己，天涯若比邻。',
    '无为在歧路，儿女共沾巾。',
  ],
  linesOriginal: [
    '城闕輔三秦，風煙望五津。',
    '與君離別意，同是宦遊人。',
    '海內存知己，天涯若比鄰。',
    '無爲在歧路，兒女共沾巾。',
  ],
  tones: [
    '平平仄仄平，平仄仄平平。',
    '仄平平仄仄，平仄仄平平。',
    '仄仄平平仄，平平仄仄平。',
    '平平仄仄仄，平仄仄平平。',
  ],
  form: '五律',
  start: '仄起',
  firstRhyme: true,
  rhymeIdx: [0, 1, 3],
  meter: '仄起首句入韵',
  analysis: '五律，仄起首句入韵。二四六分明，粘对成立；颔联、颈联对仗。',
  score: 128000,
  source: 'strains',
}

/* ------------------------------------------------------------------ */
/* 轻量 React 桩（支持本插件用到的 hooks / createElement / Component）   */
/* ------------------------------------------------------------------ */

function createReactMock() {
  const newState = () => ({ cursor: 0, states: [], refs: [], effects: [] })
  let state = newState()
  let cleanups = []

  const react = {
    _newInstance() {
      state = newState()
      cleanups = []
    },
    _beginRender() {
      state.cursor = 0
      state.effects = []
    },
    _state() {
      return state
    },
    /** 执行本轮收集到的 useEffect 回调（测试用；返回值即 cleanup，最后统一清理）。 */
    _runEffects() {
      const effects = state.effects.slice()
      state.effects = []
      for (const fn of effects) {
        try {
          const cleanup = fn()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        } catch (error) {
          /* 测试桩：单个 effect 失败不中断其余 effect，交给断言暴露 */
        }
      }
      return cleanups.slice()
    },
    _cleanup() {
      for (const fn of cleanups.splice(0)) {
        try {
          fn()
        } catch (error) {
          /* ignore */
        }
      }
    },
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2).flat(Infinity)
      return { type, props: props || {}, children }
    },
    useState(initial) {
      const index = state.cursor++
      if (!(index in state.states)) {
        state.states[index] = typeof initial === 'function' ? initial() : initial
      }
      return [state.states[index], (update) => {
        state.states[index] = typeof update === 'function' ? update(state.states[index]) : update
      }]
    },
    useRef(initial) {
      const index = state.cursor++
      if (!(index in state.refs)) state.refs[index] = { current: initial }
      return state.refs[index]
    },
    useEffect(fn) {
      state.cursor++
      if (typeof fn === 'function') state.effects.push(fn)
    },
    useMemo(factory) {
      state.cursor++
      return factory()
    },
    useCallback(callback) {
      state.cursor++
      return callback
    },
    Component: class Component {
      constructor(props) {
        this.props = props || {}
        this.state = {}
      }

      setState(update) {
        this.state = Object.assign({}, this.state, typeof update === 'function' ? update(this.state) : update)
      }
    },
    Fragment: Symbol('Fragment'),
  }
  return react
}

function createStorage(seed) {
  const map = new Map(Object.entries(seed || {}))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    clear() {
      map.clear()
    },
  }
}

function createDocumentMock() {
  return {
    head: { appendChild() {} },
    body: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return { style: {}, setAttribute() {}, appendChild() {}, remove() {}, textContent: '' }
    },
  }
}

/** 在 vm 里执行 client.js，返回 loader spec / 沙箱 context / React 桩 / require 桩。 */
function loadClient(options) {
  const opts = options || {}
  const react = createReactMock()
  // 默认把当天饭点标记为已触发，避免真实时间进入饭点窗口时干扰与饭点无关的 UI 测试
  const todayForMeal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const defaultMealSeed = {
    'dshp-meal-v1': JSON.stringify({ date: todayForMeal, meals: { breakfast: true, lunch: true, dinner: true } }),
  }
  const storage = createStorage(Object.assign({}, defaultMealSeed, opts.seed))
  const doc = createDocumentMock()
  let loaded = null

  const windowMock = {
    __ModuleLoader__: {
      load(spec) {
        loaded = spec
      },
    },
    localStorage: storage,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} }
    },
    setTimeout,
    clearTimeout,
  }

  const context = {
    console,
    window: windowMock,
    document: doc,
    localStorage: storage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    fetch: typeof opts.fetch === 'function'
      ? opts.fetch
      : async () => ({ ok: true, json: async () => ({ ok: true }) }),
  }

  vm.createContext(context)
  vm.runInContext(readFileSync(CLIENT_PATH, 'utf8'), context, { filename: CLIENT_PATH })

  assert.ok(loaded, 'client.js 必须调用 window.__ModuleLoader__.load')
  const requireMock = (id) => {
    if (id === 'react') return react
    throw new Error('测试桩未提供模块：' + id)
  }
  const mod = loaded.factory(requireMock)
  const debug = context.__dshPoetryDebug
  assert.ok(debug, 'factory 必须挂载 globalThis.__dshPoetryDebug 调试钩子')
  return { loaded, context, react, requireMock, storage, debug, mod }
}

/* ------------------------------------------------------------------ */
/* 树遍历：展开函数组件（测试桩里没有 hooks 依赖的纯展示组件）            */
/* ------------------------------------------------------------------ */

/* 只展开无 hooks 的纯展示组件；带 hooks 的组件必须由 renderFresh 直接渲染，
   否则测试桩的 hook 槽位会被嵌套调用打乱。 */
const EXPANDABLE_COMPONENTS = new Set([
  'PoemBody',
  'ToneLine',
  'Legend',
  'AnalysisBody',
  'CiBody',
  'KnowledgeCardView',
  'EmptyState',
  'LoadingState',
  'TodayTab',
  'DetectionView',
])

function expand(node) {
  let current = node
  let guard = 0
  while (current && typeof current === 'object' && !Array.isArray(current)
    && typeof current.type === 'function'
    && EXPANDABLE_COMPONENTS.has(current.type.name)
    && guard < 60) {
    guard += 1
    current = current.type(current.props || {})
  }
  return current
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false || node === true) return
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit))
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ text: String(node) })
    return
  }
  if (typeof node !== 'object') return
  const expanded = expand(node)
  if (expanded !== node) {
    walk(expanded, visit)
    return
  }
  visit(node)
  const children = Array.isArray(node.children) ? node.children : []
  children.forEach((child) => walk(child, visit))
}

function textOf(node) {
  const parts = []
  walk(node, (item) => {
    if (typeof item.text === 'string') parts.push(item.text)
  })
  return parts.join('')
}

function findAll(node, predicate) {
  const out = []
  walk(node, (item) => {
    if (item && item.type && predicate(item)) out.push(item)
  })
  return out
}

function renderFresh(react, component, props) {
  react._newInstance()
  return component(props)
}

function rerender(react, component, props) {
  react._beginRender()
  return component(props)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** vm 沙箱里创建的对象原型来自另一个 realm，先 JSON 归一化再比较结构。 */
function toPlain(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertDeep(actual, expected, message) {
  assert.deepEqual(toPlain(actual), expected, message)
}

/* ------------------------------------------------------------------ */
/* 1. 注册契约                                                          */
/* ------------------------------------------------------------------ */

test('factory 注册 shell.overlay：id=dsh-poetry-widget、order=80、组件为函数', () => {
  const { loaded, requireMock } = loadClient()
  assert.equal(loaded.id, 'dsh-poetry-widget')
  assert.equal(typeof loaded.factory, 'function')

  const mod = loaded.factory(requireMock)
  assertDeep(mod.inject, ['slots'])
  assert.equal(typeof mod.apply, 'function')

  const injections = []
  const registrations = []
  const ctx = {
    slots: {
      inject(name, callback) {
        injections.push(name)
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    effect(fn) {
      return fn()
    },
    logger: { info() {} },
  }
  mod.apply(ctx)

  assertDeep(injections, ['shell.overlay'])
  assert.equal(registrations.length, 1)
  const { options, component } = registrations[0]
  assert.equal(options.name, 'shell.overlay')
  assert.equal(options.id, 'dsh-poetry-widget')
  assert.equal(options.order, 80)
  assert.equal(typeof component, 'function')

  const hostElement = component({})
  assert.equal(typeof hostElement.type, 'function', '注册组件必须返回错误边界包裹的 React 元素')
})

/* ------------------------------------------------------------------ */
/* 2. 设置：归一化 / PUT body 序列化 / 防抖                              */
/* ------------------------------------------------------------------ */

test('normalizeSettings：clamp scale、枚举白名单、默认值', () => {
  const { debug } = loadClient()
  assert.equal(debug.normalizeSettings(null).scale, 1)
  assert.equal(debug.normalizeSettings({ scale: 3 }).scale, 1.6)
  assert.equal(debug.normalizeSettings({ scale: 0.1 }).scale, 0.6)
  assert.equal(debug.normalizeSettings({ scale: 'x' }).scale, 1)
  assert.equal(debug.normalizeSettings({ mode: 'nope' }).mode, 'daily')
  assert.equal(debug.normalizeSettings({ mode: 'random' }).mode, 'random')
  assert.equal(debug.normalizeSettings({ autoplay: 45 }).autoplay, 0)
  assert.equal(debug.normalizeSettings({ autoplay: 60 }).autoplay, 60)
  assert.equal(debug.normalizeSettings({ snap: 'right' }).snap, 'right')
  assert.equal(debug.normalizeSettings({ snap: 'diagonal' }).snap, 'left')
  assert.equal(debug.normalizeSettings({ script: 'original' }).script, 'original')
  assert.equal(debug.normalizeSettings({ showTones: false }).showTones, false)
  assert.equal(debug.normalizeSettings({ hidden: true }).hidden, true)
  assert.equal(debug.normalizeSettings({ lastPoemId: '' }).lastPoemId, null)
})

test('settingsPatch / buildSettingsRequest：白名单序列化 PUT body', () => {
  const { debug } = loadClient()
  const patch = debug.settingsPatch({
    scale: 1.2,
    mode: 'random',
    hidden: true,
    lastPoemId: 'p9',
    bogus: 1,
    schemaVersion: 9,
    updatedAt: 5,
  })
  assertDeep(patch, { scale: 1.2, mode: 'random', hidden: true, lastPoemId: 'p9' })
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'schemaVersion'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'updatedAt'), false)

  const request = debug.buildSettingsRequest({ scale: 1.25, showTones: false, snap: 'free' })
  assert.equal(request.url, '/api/dsh-poetry/settings.json')
  assert.equal(request.init.method, 'PUT')
  assert.equal(request.init.headers['Content-Type'], 'application/json')
  assertDeep(JSON.parse(request.init.body), { scale: 1.25, showTones: false, snap: 'free' })
})

test('createSettingsSaver：防抖合并多次改动为一次 PUT，失败回调不抛出', async () => {
  const { debug } = loadClient()
  const calls = []
  const errors = []
  const saver = debug.createSettingsSaver({
    delay: 25,
    put: async (patch) => {
      calls.push(patch)
      return { ok: true }
    },
    onError: (error) => errors.push(error),
  })

  saver.save({ scale: 1.1 })
  saver.save({ mode: 'random' })
  saver.save({ showTones: false })
  assert.equal(calls.length, 0, 'debounce 窗口内不应发请求')
  await sleep(90)
  assert.equal(calls.length, 1, '多次 save 应合并为一次 PUT')
  assertDeep(calls[0], { scale: 1.1, mode: 'random', showTones: false })

  const failing = debug.createSettingsSaver({
    delay: 10,
    put: () => Promise.reject(new Error('network down')),
    onError: (error) => errors.push(error),
  })
  assert.doesNotThrow(() => failing.save({ snap: 'left' }))
  await sleep(50)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /network down/)

  saver.dispose()
  failing.dispose()
})

/* ------------------------------------------------------------------ */
/* 3. 平仄渲染 / 繁简选择 / 换一首策略                                    */
/* ------------------------------------------------------------------ */

test('buildToneCells：平/仄/○/标点/韵脚下划线，平仄开关生效', () => {
  const { debug } = loadClient()
  const cells = debug.buildToneCells('城阙辅三秦，', '平平仄仄平，', { showTones: true, rhymeLine: true })
  assert.equal(cells.length, 6)
  assertDeep(cells.map((cell) => cell.ch), ['城', '阙', '辅', '三', '秦', '，'])
  assertDeep(cells.slice(0, 5).map((cell) => cell.kind), ['ping', 'ping', 'ze', 'ze', 'ping'])
  assertDeep(cells.slice(0, 5).map((cell) => cell.tone), ['平', '平', '仄', '仄', '平'])
  assert.equal(cells[5].punctuation, true)
  assert.equal(cells[5].tone, '')
  assert.ok(cells[0].className.includes('dshp-ch-ping'))
  assert.ok(cells[2].className.includes('dshp-ch-ze'))
  assert.equal(cells[4].rhyme, true)
  assert.ok(cells[4].className.includes('dshp-ch-rhyme'))
  assert.equal(cells[5].rhyme, false)

  // 关闭平仄标注：不出现平/仄 class，但韵脚下划线保留（自测模式）
  const plain = debug.buildToneCells('城阙辅三秦，', '平平仄仄平，', { showTones: false, rhymeLine: true })
  assert.equal(plain[0].tone, '')
  assert.ok(!plain[0].className.includes('dshp-ch-ping'))
  assert.ok(!plain[2].className.includes('dshp-ch-ze'))
  assert.ok(plain[4].className.includes('dshp-ch-rhyme'))

  // ○ = 多音可平可仄（灰）；未知/空 = 不标注
  const multi = debug.buildToneCells('看', '○', { showTones: true })
  assert.equal(multi[0].kind, 'any')
  assert.ok(multi[0].className.includes('dshp-ch-any'))
  const unknown = debug.buildToneCells('看', '', { showTones: true })
  assert.equal(unknown[0].className.trim(), 'dshp-ch')
})

test('selectPoemText：original 选 *Original，缺字段回落简体', () => {
  const { debug } = loadClient()
  assertDeep(debug.selectPoemText(POEM, 'original'), {
    title: '送杜少府之任蜀州',
    author: '王勃',
    lines: POEM.linesOriginal,
  })
  assertDeep(debug.selectPoemText(POEM, 'simplified'), {
    title: '送杜少府之任蜀州',
    author: '王勃',
    lines: POEM.lines,
  })
  const bare = { title: '静夜思', author: '李白', lines: ['床前明月光，'] }
  assertDeep(debug.selectPoemText(bare, 'original'), {
    title: '静夜思',
    author: '李白',
    lines: ['床前明月光，'],
  })
  assertDeep(debug.poemRhymeLines(POEM), [0, 1, 3])
  assertDeep(debug.poemRhymeLines({ lines: ['a', 'b', 'c', 'd'] }), [1, 3])
})

test('selectNextPoemId：daily 回到今日/顺序下一首，random 避开当前', () => {
  const { debug } = loadClient()
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(debug.selectNextPoemId({ items, currentId: 'b', todayId: 'a', mode: 'daily' }), 'a')
  assert.equal(debug.selectNextPoemId({ items, currentId: 'a', todayId: 'a', mode: 'daily' }), 'b')
  assert.equal(debug.selectNextPoemId({ items, currentId: 'b', todayId: 'a', mode: 'random', random: () => 0 }), 'a')
  assert.equal(debug.selectNextPoemId({ items, currentId: 'a', todayId: 'a', mode: 'random', random: () => 0 }), 'b')
  assert.equal(debug.selectNextPoemId({ items: [], mode: 'daily' }), null)
})

/* ------------------------------------------------------------------ */
/* 4. 数据层：失败友好提示 / 可重试                                      */
/* ------------------------------------------------------------------ */

test('fetchJson / loadResource：HTTP 错误与 DATA_UNAVAILABLE 友好降级，失败后可重试', async () => {
  const { context, debug } = loadClient()
  let calls = 0
  context.fetch = async () => {
    calls += 1
    if (calls === 1) return { ok: false, status: 404, json: async () => ({}) }
    if (calls === 2) return { ok: true, json: async () => ({ ok: false, error: { code: 'DATA_UNAVAILABLE', message: '缺失' } }) }
    return { ok: true, json: async () => ({ ok: true, items: [{ id: 'poem-1' }] }) }
  }

  await assert.rejects(() => debug.fetchJson('bootstrap.json'), (error) => {
    assert.equal(error.status, 404)
    return true
  })
  assert.match(debug.describeDataError({ status: 404 }), /接口尚未就绪/)
  assert.match(debug.describeDataError({ message: 'The operation was aborted' }), /超时/)

  await assert.rejects(() => debug.fetchJson('poems.json'), (error) => {
    assert.equal(error.code, 'DATA_UNAVAILABLE')
    return true
  })
  assert.match(debug.describeDataError({ code: 'DATA_UNAVAILABLE' }), /暂不可用/)

  let resourceCalls = 0
  context.fetch = async () => {
    resourceCalls += 1
    if (resourceCalls === 1) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, json: async () => ({ ok: true, items: [{ id: 'poem-1' }] }) }
  }
  await assert.rejects(() => debug.loadResource('poems'))
  const data = await debug.loadResource('poems')
  assert.equal(data.items.length, 1)
  assert.equal(resourceCalls, 2, '失败后 in-flight 必须清空，允许重试')
  debug.clearResourceCache()
})

test('clampPosition / anchorPosition：限制在视口内，贴左贴右', () => {
  const { debug } = loadClient()
  const viewport = { w: 1280, h: 800 }
  assertDeep(debug.clampPosition({ x: -50, y: 99999 }, 96, viewport), { x: 8, y: 800 - 96 - 8 })
  assertDeep(debug.anchorPosition('left', 96, viewport, { x: 900, y: 100 }), { x: 16, y: 100 })
  assertDeep(debug.anchorPosition('right', 96, viewport, { x: 20, y: 100 }), { x: 1280 - 96 - 16, y: 100 })
  assertDeep(debug.anchorPosition('free', 96, viewport, { x: 500, y: 300 }), { x: 500, y: 300 })
})

/* ------------------------------------------------------------------ */
/* 5. 组件渲染冒烟（轻量 React 桩）                                      */
/* ------------------------------------------------------------------ */

test('PoetryWidget：root 契约 / 形象资源 / 样式 / 首屏指引', () => {
  const { react, debug } = loadClient()
  const tree = renderFresh(react, debug.PoetryWidget, {})

  const roots = findAll(tree, (node) => node.props && node.props['data-dsh-poetry-widget'] === 'root')
  assert.equal(roots.length, 1)
  const root = roots[0]
  assert.equal(root.type, 'div')
  assert.equal(root.props.className, 'dshp-root')
  assert.equal(root.props.style.position, 'fixed')
  assert.equal(root.props.style.pointerEvents, 'auto')
  assert.equal(root.props.style.width, '96px')
  assert.equal(root.props.style.height, '96px')

  const images = findAll(tree, (node) => node.type === 'img')
  assert.equal(images.length, 1)
  assert.equal(images[0].props.src, '/api/dsh-poetry/assets?f=generated/dsh-whale-state-celebrate.webp')

  const styles = findAll(tree, (node) => node.type === 'style')
  assert.equal(styles.length, 1)
  const css = String(styles[0].children[0] || '')
  assert.match(css, /\.dshp-root/)
  assert.match(css, /dshp-ch-ping/)
  assert.match(css, /prefers-reduced-motion/)

  const text = textOf(tree)
  assert.match(text, /点我看今日一诗/)
  const tips = findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-tip')
  assert.equal(tips.length, 1)
})

test('PoetryWidget：hidden=true 时渲染恢复热区（长按/双击恢复）', () => {
  const seed = {}
  seed[CACHE_KEY] = JSON.stringify({
    dataVersion: '2026-10-21.1',
    bootstrap: {
      ok: true,
      version: '0.1.0',
      dataVersion: '2026-10-21.1',
      today: { date: '2026-10-21', poemId: 'p1' },
      settings: { hidden: true },
    },
    settings: { hidden: true },
    todayPoem: null,
  })
  const { react, debug } = loadClient({ seed })
  const tree = renderFresh(react, debug.PoetryWidget, {})
  const root = findAll(tree, (node) => node.props && node.props['data-dsh-poetry-widget'] === 'root')[0]
  assert.equal(root.props.style.width, '28px')
  assert.equal(root.props['data-dshp-hidden'], 'true')
  const restore = findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-restore')
  assert.equal(restore.length, 1)
  assert.equal(restore[0].props.role, 'button')
  assert.match(String(restore[0].props.title), /长按/)
  assert.equal(findAll(tree, (node) => node.type === 'img').length, 0)
})

test('TodayTab：诗题/作者/正文平仄着色 + 格律解析', () => {
  const { react, debug } = loadClient()
  const api = {
    poem: POEM,
    todayPoemId: 'p1',
    poemItems: [POEM],
    settings: debug.normalizeSettings({}),
    poemsRes: { status: 'ready', data: { ok: true, items: [POEM] } },
    boot: { status: 'ready', data: { version: '0.1.0' } },
    changePoem() {},
    backToToday() {},
  }
  const tree = renderFresh(react, debug.TodayTab, { api })
  const text = textOf(tree)
  assert.match(text, /送杜少府之任蜀州/)
  assert.match(text, /王勃/)
  assert.match(text.replace(/[平仄○]/g, ''), /城阙辅三秦/)
  assert.match(text, /换一首/)
  assert.match(text, /格律解析/)
  assert.match(text, /仄起首句入韵/)

  const pingCells = findAll(tree, (node) => node.type === 'span'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-ch-ping'))
  const zeCells = findAll(tree, (node) => node.type === 'span'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-ch-ze'))
  const rhymeCells = findAll(tree, (node) => node.type === 'span'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-ch-rhyme'))
  assert.ok(pingCells.length > 0, '应渲染平声字')
  assert.ok(zeCells.length > 0, '应渲染仄声字')
  assert.ok(rhymeCells.length >= 3, 'rhymeIdx 中每句应有一个韵脚下划线')
})

test('SettingsTab：全部设置项 + 关于信息（scope/slider 边界）', () => {
  const { react, debug } = loadClient()
  const api = {
    settings: debug.normalizeSettings({}),
    updateSettings() {},
    hideWidget() {},
    resetSettings() {},
    boot: {
      data: { version: '0.1.0', dataVersion: '2026-10-21.1', source: { commit: 'abcdef1234567890' } },
    },
  }
  const tree = renderFresh(react, debug.SettingsTab, { api })
  const text = textOf(tree)
  for (const label of ['大小', '平仄标注', '点诗模式', '自动轮播', '吸附', '显示文字', '隐藏挂件', '恢复默认', '关于', '数据版本']) {
    assert.ok(text.includes(label), '设置面板缺少：' + label)
  }
  const ranges = findAll(tree, (node) => node.type === 'input' && node.props.type === 'range')
  assert.equal(ranges.length, 1)
  assert.equal(ranges[0].props.min, 60)
  assert.equal(ranges[0].props.max, 160)
  assert.equal(ranges[0].props.value, 100)
  assert.ok(findAll(tree, (node) => node.props && node.props.role === 'switch').length >= 1)
  assert.ok(findAll(tree, (node) => node.type === 'select').length >= 1)
  assert.ok(findAll(tree, (node) => node.type === 'option').length >= 4)
  assert.equal(findAll(tree, (node) => node.type === 'button' && textOf(node) === '隐藏').length, 1)
  assert.equal(findAll(tree, (node) => node.type === 'button' && textOf(node) === '恢复默认').length, 1)
})

test('ClassTab / YunTab / CiTab：12 卡课堂、30 韵部结构、词牌卡与名篇词列表', () => {
  const { react, debug } = loadClient()

  const cards = [
    { id: 'tones', title: '四声与平仄', summary: '导语一', paragraphs: ['正文一'], examples: [{ text: '白日依山尽，', note: '例句注释' }] },
    { id: 'rhyme', title: '平水韵与押韵', summary: '导语二', paragraphs: ['正文二'], examples: [] },
  ]
  const classTree = renderFresh(react, debug.ClassTab, {
    api: { knowledgeRes: { status: 'ready', data: { cards } }, reloadKnowledge: async () => {} },
  })
  const classText = textOf(classTree)
  assert.match(classText, /四声与平仄/)
  assert.match(classText, /平水韵与押韵/)
  assert.match(classText, /白日依山尽/)
  assert.match(classText, /上一张/)
  assert.match(classText, /下一张/)

  const volumes = [
    {
      title: '上卷',
      chapters: [
        { name: '一 东', exampleChars: ['风', '空'], exampleLine: '云对雨，雪对风。', paragraphs: ['云对雨，雪对风。'] },
        { name: '二 冬', exampleChars: ['冬', '钟'], exampleLine: '春对夏，秋对冬。', paragraphs: ['春对夏，秋对冬。'] },
      ],
    },
    {
      title: '下卷',
      chapters: [
        { name: '一 先', exampleChars: ['先', '天'], exampleLine: '晴对雨，地对天。', paragraphs: ['晴对雨，地对天。'] },
      ],
    },
  ]
  const yunApi = { yunRes: { status: 'ready', data: { volumes } }, reloadYun: async () => {} }
  const yunTree = renderFresh(react, debug.YunTab, { api: yunApi })
  const yunText = textOf(yunTree)
  assert.match(yunText, /声律启蒙/)
  assert.match(yunText, /上卷/)
  assert.match(yunText, /下卷/)
  assert.match(yunText, /一 东/)
  assert.match(yunText, /一 先/)
  const rows = findAll(yunTree, (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)
  assert.equal(rows.length, 3)
  // 点击第一个韵部 → 展开正文（状态更新后重渲染）
  assert.equal(rows[0].props['aria-expanded'], false)
  rows[0].props.onClick()
  const yunTree2 = rerender(react, debug.YunTab, { api: yunApi })
  const expandedRows = findAll(yunTree2, (node) => node.type === 'button' && node.props['aria-expanded'] === true)
  assert.equal(expandedRows.length, 1)
  assert.match(textOf(yunTree2), /云对雨，雪对风。/)

  const ciItems = [
    { id: 'ci-1', author: '苏轼', rhythmic: '水调歌头', title: '水调歌头·明月几时有', lines: ['明月几时有，把酒问青天。'], quote: '但愿人长久，千里共婵娟。', score: 1 },
    { id: 'ci-2', author: '李清照', rhythmic: '如梦令', title: '如梦令·常记溪亭日暮', lines: ['常记溪亭日暮，沉醉不知归路。'], quote: '', score: 2 },
  ]
  const ciCards = [
    { id: 'shuidiaogetou', name: '水调歌头', aliases: ['元会曲'], form: '双调九十五字', rhyme: '平韵', note: '风格', example: '但愿人长久，千里共婵娟。' },
  ]
  const ciApi = {
    knowledgeRes: { status: 'ready', data: { ciCards } },
    ciRes: { status: 'ready', data: { items: ciItems } },
    reloadKnowledge: async () => {},
    reloadCi: async () => {},
  }
  const ciTree = renderFresh(react, debug.CiTab, { api: ciApi })
  const ciText = textOf(ciTree)
  assert.match(ciText, /名篇词/)
  assert.match(ciText, /词牌卡/)
  assert.match(ciText, /共 2 首/)
  assert.match(ciText, /水调歌头·明月几时有/)
  assert.match(ciText, /如梦令/)
  const searches = findAll(ciTree, (node) => node.type === 'input' && node.props.type === 'search')
  assert.equal(searches.length, 1)
  const filters = findAll(ciTree, (node) => node.type === 'select')
  assert.equal(filters.length, 1)
  // 切到词牌卡
  const segButtons = findAll(ciTree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-seg-btn'))
  assert.equal(segButtons.length, 2)
  segButtons[1].props.onClick()
  const ciTree2 = rerender(react, debug.CiTab, { api: ciApi })
  const ciText2 = textOf(ciTree2)
  assert.match(ciText2, /双调九十五字/)
  assert.match(ciText2, /元会曲/)
})

test('数据未就绪时组件显示空态 + 重试按钮，不崩溃', () => {
  const { react, debug } = loadClient()
  const api = {
    poem: null,
    poemItems: [],
    poemsRes: { status: 'error', error: { status: 404 } },
    boot: { status: 'error', error: { status: 404 } },
    settings: debug.normalizeSettings({}),
    poem: null,
    retryBootstrap() {},
    reloadPoems: async () => {},
    changePoem() {},
    backToToday() {},
  }
  const tree = renderFresh(react, debug.TodayTab, { api })
  const text = textOf(tree)
  assert.match(text, /数据尚未就绪|暂时不可用/)
  assert.match(text, /重试/)
  assert.ok(findAll(tree, (node) => node.type === 'button').length >= 1)
})

/* ------------------------------------------------------------------ */
/* 6. 首屏缓存与交互链路冒烟                                             */
/* ------------------------------------------------------------------ */

const CACHE_SEED = (() => {
  const bootstrap = {
    ok: true,
    version: '0.1.0',
    dataVersion: '2026-10-21.1',
    source: { repo: 'chinese-poetry/chinese-poetry', commit: 'b8594f81a897', license: 'MIT' },
    today: { date: '2026-10-21', poemId: POEM.id },
    counts: { poems: 500, ci: 300, yun: 30, cards: 12, ciCards: 15 },
    settings: {},
  }
  return {
    [CACHE_KEY]: JSON.stringify({
      dataVersion: '2026-10-21.1',
      bootstrap,
      settings: {},
      todayPoem: POEM,
    }),
  }
})()

function pointerEvent(pointerId) {
  return {
    pointerId,
    button: 0,
    clientX: 120,
    clientY: 740,
    cancelable: false,
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
    preventDefault() {},
  }
}

function findStage(tree) {
  return findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-stage')[0]
}

test('localStorage 首屏缓存：读写 / 损坏 JSON 安全降级', () => {
  const { storage, debug } = loadClient()
  const payload = {
    dataVersion: '2026-10-21.1',
    bootstrap: { ok: true, today: { date: '2026-10-21', poemId: 'p1' } },
    settings: { scale: 1.2 },
    todayPoem: POEM,
  }
  debug.writeFirstScreenCache(payload)
  const read = debug.readFirstScreenCache()
  assert.equal(read.dataVersion, '2026-10-21.1')
  assert.equal(read.bootstrap.today.poemId, 'p1')
  debug.clearFirstScreenCache()
  assert.equal(debug.readFirstScreenCache(), null)
  storage.setItem(CACHE_KEY, '{broken json')
  assert.equal(debug.readFirstScreenCache(), null)
})

test('气泡序列：点击形象依次推进 6 步后收起，再点回到第 1 步', () => {
  const { react, debug } = loadClient({ seed: CACHE_SEED })
  let tree = renderFresh(react, debug.PoetryWidget, {})
  let stage = findStage(tree)
  assert.ok(stage, '形象必须可点击')

  for (let index = 0; index < debug.STEPS.length; index++) {
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = rerender(react, debug.PoetryWidget, {})
    const bubbles = findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-bubble')
    assert.equal(bubbles.length, 1, '第 ' + (index + 1) + ' 步应显示气泡')
    assert.ok(textOf(bubbles[0]).includes(debug.STEPS[index]), '气泡标题应为「' + debug.STEPS[index] + '」')
    stage = findStage(tree)
    assert.ok(stage, '推进过程中形象应保持可见')
  }

  // 第 7 次点击 → 收起（无气泡）
  stage.props.onPointerDown(pointerEvent(2))
  stage.props.onPointerUp(pointerEvent(2))
  const closed = rerender(react, debug.PoetryWidget, {})
  assert.equal(findAll(closed, (node) => node.type === 'div' && node.props.className === 'dshp-bubble').length, 0)

  // 收起后再点 → 回到第 1 步
  const stageClosed = findStage(closed)
  stageClosed.props.onPointerDown(pointerEvent(3))
  stageClosed.props.onPointerUp(pointerEvent(3))
  const reopened = rerender(react, debug.PoetryWidget, {})
  const bubbles = findAll(reopened, (node) => node.type === 'div' && node.props.className === 'dshp-bubble')
  assert.equal(bubbles.length, 1)
  assert.match(textOf(bubbles[0]), /今日一诗/)
})

test('面板 7 tab 可切换；隐藏后热区双击可恢复', () => {
  const { react, debug } = loadClient({ seed: CACHE_SEED })
  let tree = renderFresh(react, debug.PoetryWidget, {})
  const stage = findStage(tree)
  stage.props.onContextMenu({ preventDefault() {} })
  tree = rerender(react, debug.PoetryWidget, {})

  const panels = findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-panel')
  assert.equal(panels.length, 1, '右键形象应打开面板')
  const tabs = findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-tab'))
  assert.equal(tabs.length, 7)
  assert.deepEqual(tabs.map((tab) => textOf(tab)), ['今日', '课堂', '韵部', '词牌', '诗库', '飞花', '设置'])

  for (let index = 0; index < tabs.length; index++) {
    tabs[index].props.onClick()
    tree = rerender(react, debug.PoetryWidget, {})
    assert.equal(
      findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-panel').length,
      1,
      'tab ' + index + ' 切换后面板不应消失',
    )
    assert.ok(textOf(tree).length > 0)
  }

  // 设置 tab：隐藏按钮（面板 tab 有 hooks 不展开，直接调 api）→ 只剩恢复热区
  const settingsElement = findAll(
    tree,
    (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab',
  )[0]
  assert.ok(settingsElement, '设置 tab 应渲染 SettingsTab')
  settingsElement.props.api.hideWidget()
  tree = rerender(react, debug.PoetryWidget, {})
  let root = findAll(tree, (node) => node.props && node.props['data-dsh-poetry-widget'] === 'root')[0]
  assert.equal(root.props.style.width, '28px')
  const restore = findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-restore')[0]
  assert.ok(restore)
  assert.equal(findAll(tree, (node) => node.type === 'img').length, 0)

  // 双击热区 → 恢复
  restore.props.onDoubleClick({ preventDefault() {}, stopPropagation() {} })
  tree = rerender(react, debug.PoetryWidget, {})
  root = findAll(tree, (node) => node.props && node.props['data-dsh-poetry-widget'] === 'root')[0]
  assert.equal(root.props.style.width, '96px')
  assert.equal(findAll(tree, (node) => node.type === 'img').length, 1)
})

test('CSS 变量与样式注入：宿主 token + 暗色兜底 + 花括号平衡', () => {
  const { react, debug } = loadClient()
  const tree = renderFresh(react, debug.PoetryWidget, {})
  const css = String(findAll(tree, (node) => node.type === 'style')[0].children[0] || '')
  assert.match(css, /--dsw-alias-bg-module-platform/)
  assert.match(css, /--dsw-alias-label-primary/)
  assert.match(css, /--dsw-alias-border-l2/)
  assert.match(css, /--dsw-static-accent/)
  assert.match(css, /prefers-color-scheme: dark/)
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'CSS 花括号必须平衡')
})

/* ------------------------------------------------------------------ */
/* 7. 真实 data/ 产物冒烟（只读；缺失时跳过）                             */
/* ------------------------------------------------------------------ */

const DATA_DIR = path.join(ROOT, 'data')
const REAL_DATA_FILES = ['poems.json', 'ci.json', 'yun.json', 'knowledge.json']
const HAS_REAL_DATA = REAL_DATA_FILES.every((name) => existsSync(path.join(DATA_DIR, name)))

test('真实数据冒烟：全部诗逐字渲染 / 30 韵部 / 全部词 / 12+15 卡', {
  skip: HAS_REAL_DATA ? false : 'data/ 产物尚未就绪',
}, () => {
  const readJson = (name) => JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'))
  const poems = readJson('poems.json')
  const ci = readJson('ci.json')
  const yun = readJson('yun.json')
  const knowledge = readJson('knowledge.json')
  const manifest = readJson('manifest.json')

  assert.ok(poems.items.length >= 30)
  assert.equal(yun.volumes.length, 2)
  assert.equal(knowledge.cards.length, 12)
  assert.equal(knowledge.ciCards.length, 15)

  const { react, debug } = loadClient()
  const settings = debug.normalizeSettings({})

  // 每一首诗的正文 + 平仄都能渲染（不崩溃、逐字单元格数 >= 字符数）
  for (const poem of poems.items) {
    const api = {
      poem,
      todayPoemId: poem.id,
      poemItems: poems.items,
      settings,
      poemsRes: { status: 'ready', data: poems },
      boot: { status: 'ready', data: { version: '0.1.0' } },
      changePoem() {},
      backToToday() {},
    }
    const tree = renderFresh(react, debug.TodayTab, { api })
    const cells = findAll(tree, (node) => node.type === 'span'
      && typeof node.props.className === 'string'
      && node.props.className.indexOf('dshp-ch') === 0)
    const expected = poem.lines.reduce((sum, line) => sum + Array.from(line).length, 0)
    assert.ok(cells.length >= expected, '诗 ' + poem.id + ' 的平仄单元格数量不足')
    const text = textOf(tree).replace(/[平仄○]/g, '')
    assert.ok(text.includes(Array.from(poem.title)[0]), '诗 ' + poem.id + ' 标题未渲染')
  }

  // 韵部：上下卷共 30 个可展开行
  const yunTree = renderFresh(react, debug.YunTab, {
    api: { yunRes: { status: 'ready', data: yun }, reloadYun: async () => {} },
  })
  const yunRows = findAll(yunTree, (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)
  assert.equal(yunRows.length, 30)

  // 课堂：12 张卡目录
  const classTree = renderFresh(react, debug.ClassTab, {
    api: { knowledgeRes: { status: 'ready', data: knowledge }, reloadKnowledge: async () => {} },
  })
  assert.match(textOf(classTree), /共 12 张卡/)

  // 词牌：全部名篇词 + 15 张词牌卡
  const ciTree = renderFresh(react, debug.CiTab, {
    api: {
      knowledgeRes: { status: 'ready', data: knowledge },
      ciRes: { status: 'ready', data: ci },
      reloadKnowledge: async () => {},
      reloadCi: async () => {},
    },
  })
  assert.match(textOf(ciTree), new RegExp('共 ' + ci.items.length + ' 首'))

  // 主挂件：真实 bootstrap + 今日诗（localStorage 首屏缓存路径）
  const bootstrap = {
    ok: true,
    version: '0.1.0',
    dataVersion: manifest.dataVersion,
    source: manifest.source,
    today: { date: '2026-10-21', poemId: poems.items[0].id },
    counts: { poems: poems.items.length, ci: ci.items.length, yun: 30, cards: 12, ciCards: 15 },
    settings: {},
  }
  const todayPoem = poems.items[0]
  const client = loadClient({
    seed: {
      [CACHE_KEY]: JSON.stringify({ dataVersion: manifest.dataVersion, bootstrap, settings: {}, todayPoem }),
    },
  })
  const mainTree = renderFresh(client.react, client.debug.PoetryWidget, {})
  assert.equal(findAll(mainTree, (node) => node.props && node.props['data-dsh-poetry-widget'] === 'root').length, 1)
  const stage = findStage(mainTree)
  stage.props.onPointerDown(pointerEvent(1))
  stage.props.onPointerUp(pointerEvent(1))
  const stepTree = rerender(client.react, client.debug.PoetryWidget, {})
  const bubbles = findAll(stepTree, (node) => node.type === 'div' && node.props.className === 'dshp-bubble')
  assert.equal(bubbles.length, 1)
  assert.ok(textOf(bubbles[0]).includes(todayPoem.title))
})

/* ------------------------------------------------------------------ */
/* 8. 气泡头部圆点直切卡片 + 面板关闭回归                                */
/* ------------------------------------------------------------------ */

function findBubble(tree) {
  return findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-bubble')[0]
}

function findDotButtons(tree) {
  return findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className.split(' ').indexOf('dshp-dot') >= 0)
}

function tapMascot(tree) {
  const stage = findStage(tree)
  assert.ok(stage, '形象应可点击')
  stage.props.onPointerDown(pointerEvent(1))
  stage.props.onPointerUp(pointerEvent(1))
}

test('气泡头部圆点：点第 i 个直达第 i 张，第 6 个收起，且不冒泡', () => {
  const { react, debug } = loadClient({ seed: CACHE_SEED })
  let tree = renderFresh(react, debug.PoetryWidget, {})
  tapMascot(tree)
  tree = rerender(react, debug.PoetryWidget, {})

  let bubble = findBubble(tree)
  assert.ok(bubble, '首次点击形象后应显示气泡')
  // 进度提示（当前 1 / 5）
  assert.match(textOf(bubble), new RegExp('1 / ' + debug.STEPS.length))

  let dots = findDotButtons(tree)
  assert.equal(dots.length, debug.STEPS.length + 1, '应为 5 个步骤点 + 1 个收起点')
  assert.equal(dots[0].props['aria-current'], 'step')
  assert.equal(dots[0].props.title, debug.STEPS[0])
  assert.ok(String(dots[0].props['aria-label']).includes(debug.STEPS[0]))

  // 依次点第 3 / 5 / 2 / 4 / 1 个点，直接跳转
  for (const index of [2, 4, 1, 3, 0]) {
    dots = findDotButtons(tree)
    let propagated = false
    dots[index].props.onClick({ stopPropagation() { propagated = true } })
    assert.equal(propagated, true, '点击圆点必须 stopPropagation，避免触发形象 tap/drag')
    tree = rerender(react, debug.PoetryWidget, {})
    bubble = findBubble(tree)
    assert.ok(bubble, '第 ' + (index + 1) + ' 个圆点点击后气泡应保持显示')
    assert.ok(
      textOf(bubble).includes(debug.STEPS[index]),
      '第 ' + (index + 1) + ' 个圆点应切到「' + debug.STEPS[index] + '」',
    )
    dots = findDotButtons(tree)
    assert.equal(dots[index].props['aria-current'], 'step')
    assert.equal(dots.filter((dot) => dot.props['aria-current'] === 'step').length, 1)
    assert.match(textOf(bubble), new RegExp((index + 1) + ' / ' + debug.STEPS.length))
  }

  // 第 6 个点（收起）→ 无气泡；再点形象 → 回到第 1 张
  dots = findDotButtons(tree)
  let propagated = false
  dots[debug.STEPS.length].props.onClick({ stopPropagation() { propagated = true } })
  assert.equal(propagated, true)
  tree = rerender(react, debug.PoetryWidget, {})
  assert.equal(findBubble(tree), undefined, '点击收起点后气泡应关闭')
  tapMascot(tree)
  tree = rerender(react, debug.PoetryWidget, {})
  bubble = findBubble(tree)
  assert.ok(bubble)
  assert.ok(textOf(bubble).includes(debug.STEPS[0]))
})

test('回归：开面板→点形象关闭面板→再点形象继续推进下一张', () => {
  const { react, debug } = loadClient({ seed: CACHE_SEED })
  let tree = renderFresh(react, debug.PoetryWidget, {})
  tapMascot(tree)
  tree = rerender(react, debug.PoetryWidget, {})
  let bubble = findBubble(tree)
  assert.ok(bubble)
  assert.ok(textOf(bubble).includes(debug.STEPS[0]))

  // 从气泡打开面板
  const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
  assert.ok(panelButton, '气泡底部应有「展开面板」')
  panelButton.props.onClick()
  tree = rerender(react, debug.PoetryWidget, {})
  assert.equal(
    findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-panel').length,
    1,
    '点击「展开面板」后面板应打开',
  )
  assert.equal(findBubble(tree), undefined, '面板打开时气泡应隐藏')

  // 点形象 → 只关闭面板，不推进
  tapMascot(tree)
  tree = rerender(react, debug.PoetryWidget, {})
  assert.equal(
    findAll(tree, (node) => node.type === 'div' && node.props.className === 'dshp-panel').length,
    0,
    '点形象应关闭面板',
  )
  bubble = findBubble(tree)
  assert.ok(bubble, '关闭面板后气泡应恢复')
  assert.ok(textOf(bubble).includes(debug.STEPS[0]), '关闭面板不应自己推进卡片')

  // 再点形象 → 正常推进到第 2 张
  tapMascot(tree)
  tree = rerender(react, debug.PoetryWidget, {})
  bubble = findBubble(tree)
  assert.ok(bubble, '关闭面板后再点形象应继续推进（不卡死）')
  assert.ok(textOf(bubble).includes(debug.STEPS[1]), '应推进到「' + debug.STEPS[1] + '」')
})

/* ------------------------------------------------------------------ */
/* 9. 飞花令：索引 / 选项 / 对局 / 最佳成绩 / 面板与气泡入口              */
/* ------------------------------------------------------------------ */

function makeFeihuaFixture() {
  const many = '花月风春山水人天云雨夜秋江酒白'.split('')
  const poemItems = many.map((char, index) => ({
    id: 'p' + index,
    author: '测试诗人',
    title: '测试诗' + (index + 1),
    lines: Array.from({ length: 9 }, (_, lineIndex) => char + '字第' + (lineIndex + 1) + '句。'),
  }))
  poemItems.push({
    id: 'p-decoy',
    author: '无名氏',
    title: '诱饵集',
    lines: ['一二三四五，六七八九十。', '子丑寅卯，辰巳午未。'],
  })
  const ciItems = [
    {
      id: 'c1',
      author: '苏轼',
      rhythmic: '水调歌头',
      title: '水调歌头·明月几时有',
      // 故意用「，」半句，验证会先合句再入库；末句与诗重复用于去重
      lines: ['明月几时有，', '把酒问青天。', '花落知多少。', '花字第1句。'],
    },
  ]
  return { poems: { ok: true, items: poemItems }, ci: { ok: true, items: ciItems } }
}

function findButtonsByClass(tree, className) {
  return findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className.split(' ').indexOf(className) >= 0)
}

test('飞花令 buildFeihuaIndex：诗+词行入库、按字计数、去重、来源', () => {
  const { debug } = loadClient()
  const fixture = makeFeihuaFixture()
  const index = debug.buildFeihuaIndex(fixture.poems, fixture.ci)

  // 去重：entries 数量 = 唯一句数 < 原始行数
  const uniqueTexts = new Set(index.entries.map((entry) => entry.text))
  assert.equal(index.entries.length, uniqueTexts.size)
  assert.ok(index.entries.length < fixture.poems.items.reduce((sum, poem) => sum + poem.lines.length, 0) + fixture.ci.items[0].lines.length)

  // 按字计数（「花」= 9 首诗行 + 1 句词；重复的「花字第1句，」只计一次）
  assert.equal(index.counts['花'], 10)
  assert.equal(index.counts['月'], 10)
  assert.equal(index.counts['白'], 9)
  assert.equal(index.byChar['花'].length, 10)
  assert.equal(index.byChar['花'].filter((entry) => entry.text === '花字第1句。').length, 1)

  // 来源：诗用 作者《标题》，词用 作者《词牌》
  const first = index.byChar['花'][0]
  assert.match(first.source, /测试诗人《测试诗1》/)
  const fromCi = index.byChar['花'].find((entry) => entry.text === '花落知多少。')
  assert.match(fromCi.source, /苏轼《水调歌头》/)

  // 候选字：>=8 句、按句数降序、最多 12 个
  assert.equal(index.candidates.length, 12)
  assert.ok(index.candidates.every((item) => item.count >= debug.FEIHUA_MIN_ENTRIES))
  assert.equal(index.candidates[0].count, 10)
  for (let i = 1; i < index.candidates.length; i += 1) {
    assert.ok(index.candidates[i - 1].count >= index.candidates[i].count)
  }

  // 默认令字：今日诗中出现且句数最多；否回退「花」
  assert.equal(debug.pickDefaultFeihuaChar(index, { lines: ['举头望明月，'] }), '月')
  assert.equal(debug.pickDefaultFeihuaChar(index, { lines: ['一二三四五，'] }), '花')
})

test('飞花令校验索引：plain / clauseMap / byPlain / 包含扫描 / merge 同步', () => {
  const { debug } = loadClient()
  const fixture = makeFeihuaFixture()
  const index = debug.buildFeihuaIndex(fixture.poems, fixture.ci)
  assert.equal(debug.feihuaPlainOf(' 花字第1句。 '), '花字第1句')
  assert.equal(debug.feihuaPlainOf('明月几时有，把酒问青天！'), '明月几时有把酒问青天')

  const sentence = debug.feihuaLookup(index, '明月几时有，把酒问青天。')
  assert.ok(sentence)
  assert.equal(sentence.match, 'sentence', '整句命中 byPlain')
  assert.equal(sentence.entry.text, '明月几时有，把酒问青天。')
  const clause = debug.feihuaLookup(index, '花字第1句')
  assert.ok(clause)
  assert.equal(clause.match, 'clause')
  assert.equal(clause.entry.text, '花字第1句。')
  // 标点/空格仍可命中
  assert.equal(debug.feihuaLookup(index, '“花 字 第 1 句。”').entry.text, '花字第1句。')

  const custom = debug.buildFeihuaIndex({ items: [{ id: 'x', author: '甲', title: '长句', lines: ['春风又绿江南岸，明月何时照我还。'] }] }, { items: [] })
  assert.equal(debug.feihuaLookup(custom, '明月何时照我还').match, 'clause')
  const contains = debug.feihuaLookup(custom, '春风又绿江南')
  assert.ok(contains, '长度≥5 的包含扫描应命中')
  assert.equal(contains.match, 'contains')
  assert.equal(debug.feihuaLookup(custom, '江南'), null, '过短输入不做包含扫描')
  assert.equal(debug.feihuaLookup(index, '完全不存在的句子'), null)

  // merge 宋词全库时同步补 lookup
  debug.mergeFeihuaItems(index, [{ author: '测试', title: '新词', lines: ['新句含花又一枝。'] }])
  debug.finishFeihuaIndex(index)
  const merged = debug.feihuaLookup(index, '新句含花又一枝')
  assert.ok(merged)
  assert.equal(merged.match, 'clause')
  assert.equal(merged.entry.source, '测试《新词》')
})
test('飞花令自由输入：校验出处/含令字/重复，非法不扣分可继续；系统接句与 cleared', () => {
  const { debug } = loadClient()
  const fixture = makeFeihuaFixture()
  const index = debug.buildFeihuaIndex(fixture.poems, fixture.ci)
  const plainOf = (entry) => debug.feihuaPlainOf(entry.text)
  const unusedEntry = (state) => {
    const used = new Set((state.used || []).map(plainOf))
    return (index.byChar['花'] || []).find((entry) => !used.has(plainOf(entry)))
  }

  let state = debug.feihuaStart(index, '花', () => 0.1)
  assert.equal(state.phase, 'playing')
  assert.equal(state.score, 0)
  assert.ok(state.system && state.system.text.includes('花'), '系统先出含令字的句子')
  assertDeep(state.used.map(plainOf), [plainOf(state.system)], '系统句计入 used')
  assert.equal(state.lives, undefined, '不再有生命值')
  assert.equal(state.round, undefined, '不再有选项')

  // 空 / 太短
  let next = debug.feihuaSubmit(state, index, '   ')
  assert.match(next.feedback.text, /完整的诗/)
  assert.equal(next.score, 0)
  next = debug.feihuaSubmit(state, index, '花')
  assert.match(next.feedback.text, /完整的诗/)

  // 不含令字
  next = debug.feihuaSubmit(state, index, '空山不见人，但闻人语响。')
  assert.match(next.feedback.text, /没有「花」/)
  assert.equal(next.score, 0)
  assert.equal(next.phase, 'playing')

  // 查无出处：提示未收录，不扣分、可继续
  next = debug.feihuaSubmit(state, index, '这句诗本地肯定没有收录过花')
  assert.match(next.feedback.text, /没查到|未收录/)
  assert.equal(next.score, 0)
  assert.equal(next.phase, 'playing')

  // 合法（带空格/标点）→ +1、used 增加、系统自动接下一句
  const firstEntry = unusedEntry(state)
  assert.ok(firstEntry)
  const firstInput = '  ' + firstEntry.text.replace('。', '') + '  '
  next = debug.feihuaSubmit(state, index, firstInput)
  assert.equal(next.phase, 'playing')
  assert.equal(next.score, 1)
  assert.match(next.feedback.text, /接上了/)
  assert.ok(next.feedback.text.includes(firstEntry.source))
  assert.ok(next.used.map(plainOf).includes(plainOf(firstEntry)))
  assert.ok(next.system && plainOf(next.system) !== plainOf(firstEntry), '系统接下一句')
  assert.ok(!next.used.map(plainOf).includes(plainOf(next.system)), '系统接句不在 used')

  // 重复（同一句/同句不同标点）
  const dup = debug.feihuaSubmit(next, index, firstEntry.text)
  assert.match(dup.feedback.text, /已经用过/)
  assert.equal(dup.score, 1)
  const dupClause = debug.feihuaSubmit(next, index, firstEntry.text.replace('。', ''))
  assert.match(dupClause.feedback.text, /已经用过/)

  // 继续接到 cleared
  let guard = 0
  while (next.phase === 'playing' && guard < 30) {
    const entry = unusedEntry(next)
    if (!entry) break
    next = debug.feihuaSubmit(next, index, entry.text, () => 0.3)
    guard += 1
  }
  assert.equal(next.phase, 'cleared', '句子被接完应进入 cleared')
  assert.match(next.message, /换一个令字/)
  assert.ok(next.score > 0)
  assert.equal(next.system, null)
})
test('飞花令 best：localStorage 读写 / 损坏降级 / 逐字与总最佳', () => {
  const { debug, storage } = loadClient()
  assertDeep(debug.normalizeFeihuaBest(null), { overall: 0, chars: {} })
  assertDeep(debug.normalizeFeihuaBest({ overall: 7, chars: { 花: 5, 月: 7 } }), { overall: 7, chars: { 花: 5, 月: 7 } })
  assertDeep(debug.normalizeFeihuaBest({ overall: 'x', chars: { 花: -3, 月: '4' } }), { overall: 0, chars: { 月: 4 } })

  const best1 = debug.feihuaBestUpdate(null, '花', 5)
  assert.equal(best1.overall, 5)
  assert.equal(best1.chars['花'], 5)
  const best2 = debug.feihuaBestUpdate(best1, '花', 3)
  assert.equal(best2.chars['花'], 5, 'best 只增不减')
  const best3 = debug.feihuaBestUpdate(best2, '月', 8)
  assert.equal(best3.overall, 8)
  assert.equal(best3.chars['月'], 8)

  debug.writeFeihuaBest(best3)
  const readBack = debug.readFeihuaBest()
  assert.equal(readBack.overall, 8)
  assert.equal(readBack.chars['花'], 5)
  assert.ok(storage.getItem(debug.FEIHUA_BEST_KEY).includes('overall'))

  storage.setItem(debug.FEIHUA_BEST_KEY, '{bad json')
  assert.equal(debug.readFeihuaBest().overall, 0, '损坏 best 应安全降级')
})

test('飞花 tab：自由输入对句（chips/来一局/输入/回车/反馈/图鉴）', () => {
  const { react, debug, storage } = loadClient()
  const fixture = makeFeihuaFixture()
  const index = debug.buildFeihuaIndex(fixture.poems, fixture.ci)
  const api = {
    poemsRes: { status: 'ready', data: fixture.poems },
    ciRes: { status: 'ready', data: fixture.ci },
    poem: { lines: ['举头望明月，'] },
    reloadPoems: async () => {},
    reloadCi: async () => {},
    feihuaLaunch: 0,
  }
  const cardText = (tree) => {
    const node = findAll(tree, (item) => item.type === 'div'
      && typeof item.props.className === 'string'
      && item.props.className === 'dshp-card')[0]
    return node ? textOf(node) : ''
  }
  const pickUnused = (currentText) => (index.byChar['花'] || []).find((entry) => !currentText.includes(entry.text))
  const findInput = (tree) => findAll(tree, (node) => node.type === 'input'
    && node.props['aria-label'] === '输入飞花令对句')[0]

  let tree = renderFresh(react, debug.FeihuaTab, { api })
  let text = textOf(tree)
  assert.match(text, /飞花令 · 对句/)
  assert.match(text, /对句/)
  assert.match(text, /图鉴/)
  assert.match(text, /来一局/)
  assert.match(text, /有出处、含令字、本局不重复/)
  assert.equal(findButtonsByClass(tree, 'dshp-fh-option').length, 0, '不应再有四选项')
  const chips = findButtonsByClass(tree, 'dshp-fh-chip')
  assert.ok(chips.length >= 13)

  const huaChip = chips.find((chip) => textOf(chip).indexOf('花') === 0)
  huaChip.props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  assert.match(textOf(tree), /句库 10 句/)

  const startButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '来一局')[0]
  startButton.props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  text = textOf(tree)
  assert.match(text, /对方：/)
  assert.match(text, /请接一句含「花」的诗句/)
  assert.equal(findButtonsByClass(tree, 'dshp-fh-option').length, 0)
  assert.equal(findAll(tree, (node) => node.props && node.props['aria-live'] === 'polite').length >= 1, true)
  let input = findInput(tree)
  assert.ok(input, '应有自由输入框')
  const firstEntry = pickUnused(cardText(tree))
  assert.ok(firstEntry)
  input.props.onChange({ target: { value: ' ' + firstEntry.text.replace('。', '') + ' ' } })
  tree = rerender(react, debug.FeihuaTab, { api })
  findAll(tree, (node) => node.type === 'button' && textOf(node) === '接一句')[0].props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  text = textOf(tree)
  assert.match(text, /本局已接 1 句/)
  assert.match(text, /接上了：/)
  assert.ok(text.includes(firstEntry.source))
  assert.equal(findInput(tree).props.value, '', '答对后输入框清空')
  assert.ok(debug.readFeihuaBest().chars['花'] >= 1, '接上后应更新本字最佳')

  // 重新开局后回车提交
  findAll(tree, (node) => node.type === 'button' && textOf(node) === '重新开局')[0].props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  input = findInput(tree)
  const enterEntry = pickUnused(cardText(tree))
  assert.ok(enterEntry)
  input.props.onChange({ target: { value: enterEntry.text } })
  tree = rerender(react, debug.FeihuaTab, { api })
  findInput(tree).props.onKeyDown({ key: 'Enter', preventDefault() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  assert.match(textOf(tree), /本局已接 1 句/, '回车应提交')

  // 查无出处：bad 反馈、分数不变、输入保留
  input = findInput(tree)
  input.props.onChange({ target: { value: '这句肯定没有出处的花' } })
  tree = rerender(react, debug.FeihuaTab, { api })
  findAll(tree, (node) => node.type === 'button' && textOf(node) === '接一句')[0].props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  text = textOf(tree)
  assert.match(text, /没查到|未收录/)
  assert.match(text, /本局已接 1 句/)
  assert.equal(findInput(tree).props.value, '这句肯定没有出处的花', '答错保留输入方便修改')

  // 图鉴
  findButtonsByClass(tree, 'dshp-seg-btn').find((button) => textOf(button) === '图鉴').props.onClick()
  tree = rerender(react, debug.FeihuaTab, { api })
  text = textOf(tree)
  assert.match(text, /共 10 句/)
  assert.equal(findAll(tree, (node) => node.type === 'div'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-fh-line').length, 10)
})
test('飞花令入口：面板第 6 个 tab 进入飞花页；气泡第 6 张卡 + 圆点直切', () => {
  const { react, debug } = loadClient({ seed: CACHE_SEED })
  let tree = renderFresh(react, debug.PoetryWidget, {})
  const stage = findStage(tree)
  stage.props.onContextMenu({ preventDefault() {} })
  tree = rerender(react, debug.PoetryWidget, {})

  const tabs = findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-tab'))
  assert.equal(tabs.length, 7)
  assert.equal(textOf(tabs[4]), '诗库')
  assert.equal(textOf(tabs[5]), '飞花')
  tabs[5].props.onClick()
  tree = rerender(react, debug.PoetryWidget, {})
  const feihuaElements = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'FeihuaTab')
  assert.equal(feihuaElements.length, 1, '点击「飞花」tab 应渲染 FeihuaTab')
  assert.ok(feihuaElements[0].props.api.poemsRes, 'FeihuaTab 应能拿到 poems 数据源')

  // 回到气泡：第 6 张「飞花令」，圆点直切
  let bubbleTree = renderFresh(react, debug.PoetryWidget, {})
  tapMascot(bubbleTree)
  bubbleTree = rerender(react, debug.PoetryWidget, {})
  let dots = findDotButtons(bubbleTree)
  assert.equal(dots.length, debug.STEPS.length + 1)
  assert.equal(debug.STEPS[5], '飞花令')
  dots[5].props.onClick({ stopPropagation() {} })
  bubbleTree = rerender(react, debug.PoetryWidget, {})
  const bubble = findBubble(bubbleTree)
  assert.ok(bubble, '第 6 张卡应显示气泡')
  assert.ok(textOf(bubble).includes('飞花令'))
  assert.match(textOf(bubble), new RegExp('6 / ' + debug.STEPS.length))
  assert.ok(
    textOf(bubble).includes('正在载入飞花令句库') || textOf(bubble).includes('今日令字'),
    '无资源注入时应为加载态，有资源时应显示今日令字',
  )
  dots = findDotButtons(bubbleTree)
  dots[6].props.onClick({ stopPropagation() {} })
  bubbleTree = rerender(react, debug.PoetryWidget, {})
  assert.equal(findBubble(bubbleTree), undefined, '第 7 个点是收起点')
})

test('真实数据飞花令：完整句口径下限 / 候选 12 / 图鉴分页', {
  skip: HAS_REAL_DATA ? false : 'data/ 产物尚未就绪',
}, () => {
  const readJson = (name) => JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'))
  const poems = readJson('poems.json')
  const ci = readJson('ci.json')
  const { react, debug } = loadClient()
  const index = debug.buildFeihuaIndex(poems, ci)

  assert.ok(index.counts['花'] >= 250, '完整句口径花应 ≥250，实际 ' + index.counts['花'])
  assert.ok(index.counts['月'] >= 180)
  assert.ok(index.counts['风'] >= 300)
  assert.ok(index.entries.length > 3000, '完整句口径基础句库应有 3000+ 句')
  assert.ok(index.entries.every((entry) => /[。！？]$/.test(entry.text)), '句库条目必须是完整句')
  assert.equal(index.candidates.length, 12)
  assert.ok(index.candidates.every((item) => item.count >= debug.FEIHUA_MIN_ENTRIES))

  // 真实数据下开局：系统句含令字、自由输入可校验出处
  const state = debug.feihuaStart(index, '花', () => 0.42)
  assert.equal(state.phase, 'playing')
  assert.ok(state.system.text.includes('花'))
  assert.ok(state.system.source.length > 0)
  const candidate = index.byChar['花'].find((entry) => entry !== state.system)
  const submitted = debug.feihuaSubmit(state, index, candidate.text)
  assert.equal(submitted.score, 1)
  assert.equal(submitted.phase, 'playing')
  assert.ok(submitted.feedback.text.includes(candidate.source))

  // FeihuaTab 用真实数据渲染：chips / 来一局 / 图鉴默认 60 条加载更多
  const api = {
    poemsRes: { status: 'ready', data: poems },
    ciRes: { status: 'ready', data: ci },
    poem: poems.items[0],
    reloadPoems: async () => {},
    reloadCi: async () => {},
    feihuaLaunch: 0,
  }
  let tree = renderFresh(react, debug.FeihuaTab, { api })
  let text = textOf(tree)
  assert.match(text, /对句/)
  const defaultChar = debug.pickDefaultFeihuaChar(index, poems.items[0])
  assert.ok(text.includes('「' + defaultChar + '」'))
  const atlasButton = findButtonsByClass(tree, 'dshp-seg-btn').find((button) => textOf(button) === '图鉴')
  assert.ok(atlasButton)
  atlasButton.props.onClick()
  tree = rerender(react, debug.FeihuaTab, { api })
  const rows = findAll(tree, (node) => node.type === 'div'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-fh-line')
  assert.ok(rows.length > 0)
  assert.ok(rows.length <= debug.FEIHUA_ATLAS_PAGE, '图鉴首屏最多 FEIHUA_ATLAS_PAGE 条')
  const atlasTexts = findAll(tree, (node) => node.type === 'div'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-fh-line-text')
  assert.ok(atlasTexts.length > 0)
  for (const node of atlasTexts) {
    assert.ok(/[。！？]$/.test(textOf(node)), '图鉴不得显示半句：' + textOf(node))
    assert.ok(!/…/.test(textOf(node)), '图鉴不得加省略号')
  }
})

/* ------------------------------------------------------------------ */
/* 10. 立绘状态映射 + 按天气推荐古诗词                                    */
/* ------------------------------------------------------------------ */

function makeWeatherPoemFixture() {
  return {
    poems: {
      items: [
        { id: 'p-rain-2', title: '雨诗', author: '甲', lines: ['夜来风雨声，', '花落知多少。'] },
        { id: 'p-rain-1', title: '春雨', author: '乙', lines: ['好雨知时节，', '当春乃发生。'] },
        { id: 'p-sun', title: '晴诗', author: '丙', lines: ['晴日暖风生麦气，'] },
        { id: 'p-none', title: '无', author: '丁', lines: ['一二三四五，'] },
      ],
    },
    ci: {
      items: [
        { id: 'c-rain', author: '苏', rhythmic: '浣溪沙', title: '雨', lines: ['一蓑烟雨任平生。'] },
      ],
    },
  }
}

test('立绘状态映射：rain/snow/thunder/cold/night/game-win/game-lose → 对应文件', () => {
  const { debug } = loadClient()
  assert.equal(debug.mascotStateFor({ category: 'rain', isDay: true }, true), 'rain')
  assert.equal(debug.mascotStateFor({ category: 'snow', isDay: true }, true), 'snow')
  assert.equal(debug.mascotStateFor({ category: 'thunder', isDay: true }, true), 'thunder')
  assert.equal(debug.mascotStateFor({ category: 'cold', isDay: true }, true), 'cold')
  assert.equal(debug.mascotStateFor({ category: 'clear', isDay: true }, true), 'idle')
  assert.equal(debug.mascotStateFor({ category: 'cloud', isDay: true }, true), 'idle')
  assert.equal(debug.mascotStateFor({ category: 'fog', isDay: true }, true), 'idle')
  assert.equal(debug.mascotStateFor({ category: 'wind', isDay: true }, true), 'idle')
  assert.equal(debug.mascotStateFor({ category: 'rain', isDay: false }, true), 'night', '夜间优先夜间立绘')
  assert.equal(debug.mascotStateFor({ category: 'rain', isDay: true }, false), 'celebrate', '关闭天气选诗时用默认')
  assert.equal(debug.mascotStateFor(null, true), 'celebrate', '天气不可用回默认')
  assert.equal(debug.mascotStateFor({}, true), 'celebrate')

  assert.equal(debug.mascotFileFor('rain'), 'dsh-whale-state-weather-umbrella.webp')
  assert.equal(debug.mascotFileFor('snow'), 'dsh-whale-state-weather-snow.webp')
  assert.equal(debug.mascotFileFor('thunder'), 'dsh-whale-state-weather-thunder.webp')
  assert.equal(debug.mascotFileFor('cold'), 'dsh-whale-state-weather-cold.webp')
  assert.equal(debug.mascotFileFor('idle'), 'dsh-whale-state-idle-cute.webp')
  assert.equal(debug.mascotFileFor('night'), 'dsh-whale-state-night.webp')
  assert.equal(debug.mascotFileFor('gameWin'), 'dsh-whale-state-game-win.webp')
  assert.equal(debug.mascotFileFor('gameLose'), 'dsh-whale-state-game-lose.webp')
  assert.equal(debug.mascotFileFor('gameThink'), 'dsh-whale-state-game-think.webp')
  assert.equal(debug.mascotFileFor('unknown-state'), 'dsh-whale-state-celebrate.webp')
  assert.equal(debug.mascotUrl(debug.mascotFileFor('rain')), '/api/dsh-poetry/assets?f=generated/dsh-whale-state-weather-umbrella.webp')
})

test('天气类别→诗词 tag / chip 文案 / 说明文案', () => {
  const { debug } = loadClient()
  assertDeep(debug.weatherPoemTags({ category: 'rain', isDay: true }), ['雨'])
  assertDeep(debug.weatherPoemTags({ category: 'snow', isDay: true }), ['雪'])
  assertDeep(debug.weatherPoemTags({ category: 'thunder', isDay: true }), ['雨', '雷'])
  assertDeep(debug.weatherPoemTags({ category: 'cloud', isDay: true }), ['云'])
  assertDeep(debug.weatherPoemTags({ category: 'fog', isDay: true }), ['云', '雾'])
  assertDeep(debug.weatherPoemTags({ category: 'clear', isDay: true }), ['晴', '日'])
  assertDeep(debug.weatherPoemTags({ category: 'wind', isDay: true }), ['风'])
  assertDeep(debug.weatherPoemTags({ category: 'cold', isDay: true }), ['霜', '露', '寒'])
  assertDeep(debug.weatherPoemTags({ category: 'cloud', isDay: false }), ['云', '月', '夜'])
  assertDeep(debug.weatherPoemTags(null), [])

  assert.equal(debug.weatherChipText('北京', { label: '小雨', tempC: 18.5 }), '北京 · 小雨 19℃')
  assert.equal(debug.weatherChipText('', { label: '小雨', tempC: 18.5 }), '小雨 19℃')
  assert.equal(debug.weatherChipText('北京', null), '')
  assert.match(debug.weatherExplainText({ category: 'rain', isDay: true }), /写雨/)
  assert.match(debug.weatherExplainText({ category: 'snow', isDay: true }), /写雪/)
  assert.match(debug.weatherExplainText({ category: 'thunder', isDay: true }), /写雨雷/)
  assert.match(debug.weatherExplainText({ category: 'clear', isDay: true }), /写晴日/)
  assert.match(debug.weatherExplainText({ category: 'cold', isDay: true }), /写霜寒/)
  assert.match(debug.weatherExplainText({ category: 'clear', isDay: false }), /写月夜/)
  assert.equal(debug.weatherUpdatedLabel(new Date(2026, 0, 2, 3, 4).getTime()), '03:04')
})

test('天气诗池：先诗后词、按命中数降序、确定性选择、空池回退', () => {
  const { debug } = loadClient()
  const fixture = makeWeatherPoemFixture()
  const rainTags = debug.weatherPoemTags({ category: 'rain', isDay: true })
  const pool = debug.buildWeatherPoemPool(fixture.poems, fixture.ci, rainTags, 20)
  assert.ok(pool.length >= 3)
  assert.equal(pool[0].kind, 'poem', '诗池优先使用诗')
  assert.ok(pool.some((entry) => entry.kind === 'ci' && entry.id === 'c-rain'), '诗不足时用词补足')
  for (let i = 1; i < pool.length; i += 1) {
    const prev = pool[i - 1]
    const cur = pool[i]
    if (prev.kind === cur.kind) assert.ok(prev.hits >= cur.hits, '同来源按命中数降序')
  }
  const poemsOnly = debug.buildWeatherPoemPool(fixture.poems, fixture.ci, rainTags, 2)
  assert.equal(poemsOnly.length, 2)
  assert.ok(poemsOnly.every((entry) => entry.kind === 'poem'), '诗够用时不用词')

  assert.equal(debug.buildWeatherPoemPool(fixture.poems, fixture.ci, ['不存在的字'], 20).length, 0)

  const meta = { date: '2026-10-21', category: 'rain', dataVersion: '2026-10-21.4' }
  const first = debug.selectWeatherPoemEntry(pool, meta)
  const second = debug.selectWeatherPoemEntry(pool, meta)
  assert.ok(first && first.id)
  assert.equal(first.id, second.id, '同日期/类别/数据版本选诗确定')
  assert.ok(pool.some((entry) => entry.id === first.id))
  assert.equal(debug.selectWeatherPoemEntry([], meta), null)
})

test('天气请求失败静默：requestWeather 可 reject、不影响无天气 UI', async () => {
  const { context, debug } = loadClient()
  context.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
  await assert.rejects(() => debug.requestWeather(), (error) => {
    assert.equal(error.status, 404)
    return true
  })
  assert.equal(debug.weatherChipText('北京', null), '')
  assert.equal(debug.mascotStateFor(null, true), 'celebrate')

  context.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      city: '北京',
      weather: { category: 'rain', label: '小雨', tempC: 18, isDay: true, updatedAt: 1760000000000 },
      stale: false,
    }),
  })
  const data = await debug.requestWeather()
  assert.equal(data.city, '北京')
  assert.equal(data.weather.category, 'rain')
})

test('天气 chip 渲染：有天气显示、无天气不显示；设置 tab 含城市/开关/刷新', () => {
  const { react, debug } = loadClient()
  const baseApi = {
    poem: POEM,
    todayPoemId: POEM.id,
    poemItems: [POEM],
    settings: debug.normalizeSettings({}),
    poemsRes: { status: 'ready', data: { ok: true, items: [POEM] } },
    boot: { status: 'ready', data: { version: '0.1.0' } },
    changePoem() {},
    backToToday() {},
  }
  const noWeather = renderFresh(react, debug.TodayTab, { api: baseApi })
  assert.equal(findAll(noWeather, (node) => node.type === 'div' && node.props.className === 'dshp-weather').length, 0)
  assert.ok(!textOf(noWeather).includes('℃'))

  const withWeather = renderFresh(react, debug.TodayTab, {
    api: Object.assign({}, baseApi, {
      weatherActive: true,
      weatherChip: '北京 · 小雨 18℃',
      weatherNote: '今日有雨，为你选了写雨的这首',
    }),
  })
  assert.equal(findAll(withWeather, (node) => node.type === 'div' && node.props.className === 'dshp-weather').length, 1)
  const weatherText = textOf(withWeather)
  assert.match(weatherText, /北京 · 小雨 18℃/)
  assert.match(weatherText, /今日有雨，为你选了写雨的这首/)
  assert.match(weatherText, /天气推荐/)

  const updates = []
  const refreshes = []
  const settingsApi = {
    settings: debug.normalizeSettings({ weatherCity: '北京' }),
    updateSettings: (patch) => updates.push(patch),
    hideWidget() {},
    resetSettings() {},
    weatherRes: { status: 'ready', at: new Date(2026, 0, 2, 3, 4).getTime() },
    weatherData: { ok: true, city: '北京', weather: { category: 'rain', label: '小雨', tempC: 18, isDay: true } },
    refreshWeather: (force) => refreshes.push(force),
    boot: { data: { version: '0.1.0', dataVersion: 'x', source: {} } },
  }
  let tree = renderFresh(react, debug.SettingsTab, { api: settingsApi })
  let text = textOf(tree)
  for (const label of ['天气城市', '按天气选诗', '刷新天气']) assert.ok(text.includes(label), '设置缺少：' + label)
  assert.match(text, /北京 · 小雨 18℃/)
  assert.match(text, /更新于 03:04/)

  const cityInput = findAll(tree, (node) => node.type === 'input' && node.props.type === 'text')[0]
  assert.ok(cityInput)
  assert.equal(cityInput.props.value, '北京')
  cityInput.props.onChange({ target: { value: '上海' } })
  tree = rerender(react, debug.SettingsTab, { api: settingsApi })
  const cityInput2 = findAll(tree, (node) => node.type === 'input' && node.props.type === 'text')[0]
  cityInput2.props.onBlur()
  assertDeep(updates[0], { weatherCity: '上海' })

  const weatherSwitch = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '按天气选诗开关')[0]
  assert.ok(weatherSwitch)
  weatherSwitch.props.onClick()
  assertDeep(updates[1], { weatherPoem: false })

  const weatherRes = findAll(tree, (node) => node.type === 'button' && textOf(node) === '刷新天气')[0]
  assert.ok(weatherRes, '设置应有刷新天气按钮')
  weatherRes.props.onClick()
  assertDeep(refreshes, [true])
})

test('settings weatherCity/weatherPoem：归一化与 PUT 序列化', () => {
  const { debug } = loadClient()
  assert.equal(debug.normalizeSettings({}).weatherCity, '北京')
  assert.equal(debug.normalizeSettings({}).weatherPoem, true)
  assert.equal(debug.normalizeSettings({ weatherCity: '  上海  ' }).weatherCity, '上海')
  assert.equal(debug.normalizeSettings({ weatherCity: '' }).weatherCity, '北京')
  assert.equal(debug.normalizeSettings({ weatherCity: 'x'.repeat(21) }).weatherCity, '北京')
  assert.equal(debug.normalizeSettings({ weatherPoem: false }).weatherPoem, false)
  const patch = debug.settingsPatch({ weatherCity: '上海', weatherPoem: false })
  assertDeep(patch, { weatherCity: '上海', weatherPoem: false })
  const request = debug.buildSettingsRequest({ weatherCity: '上海', weatherPoem: false })
  assertDeep(JSON.parse(request.init.body), { weatherCity: '上海', weatherPoem: false })
})

test('真实数据天气诗池：rain 20 首、按命中降序、确定性选诗', {
  skip: HAS_REAL_DATA ? false : 'data/ 产物尚未就绪',
}, () => {
  const readJson = (name) => JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'))
  const poems = readJson('poems.json')
  const ci = readJson('ci.json')
  const manifest = readJson('manifest.json')
  const { debug } = loadClient()
  const pool = debug.buildWeatherPoemPool(poems, ci, debug.weatherPoemTags({ category: 'rain', isDay: true }), 20)
  assert.equal(pool.length, 20)
  assert.ok(pool.every((entry) => entry.kind === 'poem'), 'rain 在真实数据中应足够 20 首诗')
  for (let i = 1; i < pool.length; i += 1) assert.ok(pool[i - 1].hits >= pool[i].hits)
  const meta = { date: '2026-10-21', category: 'rain', dataVersion: manifest.dataVersion }
  const first = debug.selectWeatherPoemEntry(pool, meta)
  const second = debug.selectWeatherPoemEntry(pool, meta)
  assert.equal(first.id, second.id)
  assert.ok(first.item.lines.join('').includes('雨'))
})

test('天气集成（假 React 跑 effects）：rain → 立绘切换 + 天气 chip + 天气池选诗', async () => {
  const rainPoems = Array.from({ length: 5 }, (_, index) => ({
    id: 'rp-' + index,
    title: '雨诗' + index,
    author: '诗人' + index,
    lines: ['夜来风雨声，', '花落知多少。'],
    tones: ['仄平平仄平，', '平仄平平仄。'],
    form: '五绝',
    start: '仄起',
    firstRhyme: true,
    rhymeIdx: [0, 1],
    meter: '仄起首句入韵',
    analysis: '测试',
  }))
  const todayPoem = { id: 'today-1', title: '晴日诗', author: '甲', lines: ['晴日暖风生，'], tones: ['平仄仄平平，'] }
  const dataVersion = 'test.weather.1'
  const bootstrap = {
    ok: true,
    version: '0.1.0',
    dataVersion,
    source: { repo: 'test', commit: 'abcdef', license: 'MIT' },
    today: { date: '2026-10-21', poemId: 'today-1' },
    counts: { poems: rainPoems.length + 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings: { weatherPoem: true, weatherCity: '北京' },
  }
  const responses = {
    'bootstrap.json': bootstrap,
    'poems.json': { ok: true, dataVersion, items: rainPoems.concat([todayPoem]) },
    'ci.json': { ok: true, dataVersion, items: [] },
    'weather.json': {
      ok: true,
      city: '北京',
      weather: { category: 'rain', label: '小雨', tempC: 18, isDay: true, code: 61, updatedAt: 1760000000000 },
      stale: false,
    },
    'settings.json': { ok: true, settings: bootstrap.settings },
  }
  const { react, debug } = loadClient({
    seed: {
      [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings: bootstrap.settings, todayPoem: null }),
    },
    fetch: async (url) => {
      let key = String(url).replace('/api/dsh-poetry/', '')
      if (key.indexOf('self-talk.json') === 0) key = 'self-talk.json'
      const data = responses[key]
      if (!data) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, json: async () => data }
    },
  })

  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 4; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }

    // 天气加载完成 → rain 立绘
    const mascotImages = findAll(tree, (node) => node.type === 'img')
    assert.ok(mascotImages.length >= 1)
    assert.ok(
      String(mascotImages[0].props.src).includes('dsh-whale-state-weather-umbrella.webp'),
      'rain 天气应切换雨伞立绘，实际：' + mascotImages[0].props.src,
    )

    // 打开第 1 张气泡 → 天气 chip + 说明 + 选中天气诗池中的雨诗
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const bubble = findBubble(tree)
    assert.ok(bubble, '点击形象应打开气泡')
    const bubbleText = textOf(bubble)
    assert.match(bubbleText, /北京 · 小雨 18℃/)
    assert.match(bubbleText, /今日有雨，为你选了写雨的这首/)
    assert.ok(
      rainPoems.some((poem) => bubbleText.includes(poem.title)),
      '应显示天气诗池中的雨诗，实际：' + bubbleText.slice(0, 100),
    )

    // 设置 tab：天气城市输入 / 开关 / 刷新按钮（真实 api 透传）
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    if (panelButton) {
      panelButton.props.onClick()
      tree = renderMain()
      const tabs = findAll(tree, (node) => node.type === 'button'
        && typeof node.props.className === 'string'
        && node.props.className.includes('dshp-tab'))
      const settingsTab = tabs.find((tab) => textOf(tab) === '设置')
      assert.ok(settingsTab)
      settingsTab.props.onClick()
      tree = renderMain()
      const settingsElement = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
      assert.ok(settingsElement)
      assert.equal(settingsElement.props.api.weatherData.city, '北京')
      assert.equal(typeof settingsElement.props.api.refreshWeather, 'function')
    }
  } finally {
    react._cleanup()
  }
})

test('飞花令 pulseMascot：来一局→gameThink、接上→gameWin、查无出处→gameLose', () => {
  const { react, debug } = loadClient()
  const fixture = makeFeihuaFixture()
  const index = debug.buildFeihuaIndex(fixture.poems, fixture.ci)
  const pulses = []
  const api = {
    poemsRes: { status: 'ready', data: fixture.poems },
    ciRes: { status: 'ready', data: fixture.ci },
    poem: { lines: ['举头望明月，'] },
    reloadPoems: async () => {},
    reloadCi: async () => {},
    feihuaLaunch: 0,
    pulseMascot: (key) => pulses.push(key),
  }
  const findInput = (tree) => findAll(tree, (node) => node.type === 'input'
    && node.props['aria-label'] === '输入飞花令对句')[0]
  const cardText = (tree) => {
    const node = findAll(tree, (item) => item.type === 'div'
      && typeof item.props.className === 'string'
      && item.props.className === 'dshp-card')[0]
    return node ? textOf(node) : ''
  }
  const pickUnused = (currentText) => (index.byChar['月'] || []).find((entry) => !currentText.includes(entry.text))

  let tree = renderFresh(react, debug.FeihuaTab, { api })
  const startButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '来一局')[0]
  assert.ok(startButton)
  startButton.props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  assertDeep(pulses, ['gameThink'])

  const entry = pickUnused(cardText(tree))
  assert.ok(entry)
  let input = findInput(tree)
  input.props.onChange({ target: { value: entry.text } })
  tree = rerender(react, debug.FeihuaTab, { api })
  findAll(tree, (node) => node.type === 'button' && textOf(node) === '接一句')[0].props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  assert.ok(pulses.includes('gameWin'), '接上应触发 gameWin 立绘')
  assertDeep(pulses.slice(0, 2), ['gameThink', 'gameWin'])

  input = findInput(tree)
  input.props.onChange({ target: { value: '这句没有出处但含月' } })
  tree = rerender(react, debug.FeihuaTab, { api })
  findAll(tree, (node) => node.type === 'button' && textOf(node) === '接一句')[0].props.onClick({ stopPropagation() {} })
  tree = rerender(react, debug.FeihuaTab, { api })
  assert.ok(pulses.includes('gameLose'), '查无出处/未接上应触发 gameLose 立绘')
})
/* ------------------------------------------------------------------ */
/* 11. 心情系统 + 低频「想读的诗」彩蛋                                    */
/* ------------------------------------------------------------------ */

function shanghaiTs(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - 8, minute || 0, 0)
}

function baseMoodInput(overrides) {
  const now = shanghaiTs(2026, 10, 21, 10, 0)
  const stats = Object.assign({
    userMessages: 0, assistantMessages: 0, toolCalls: 0, toolErrors: 0,
    turns: 0, turnsCompleted: 0, turnsErrored: 0, activeMs: 0, sessions: 0,
    firstActivityAt: 0, lastActivityAt: 0,
  }, overrides && overrides.stats)
  const signals = Object.assign({
    now,
    clicks: 1,
    lastInteractionAt: now - 60 * 1000,
    feihuaWins: 0,
    feihuaLosses: 0,
    panelOpens: 0,
  }, overrides && overrides.signals)
  return { stats, signals, weather: overrides ? overrides.weather : null }
}

test('心情引擎 computeMood：各分类 + 优先级（tired/sleepy/proud > happy > hungry/lonely > cozy > curious > calm）', () => {
  const { debug } = loadClient()
  const moodOf = (overrides) => debug.computeMood(baseMoodInput(overrides))

  assert.equal(moodOf({}).key, 'calm')
  assert.equal(debug.computeMood({}).key, 'calm', '未知数据按 0 → calm')
  assert.equal(moodOf({ stats: { toolCalls: 100 } }).key, 'tired')
  assert.equal(moodOf({ stats: { activeMs: 4 * 3600 * 1000 } }).key, 'tired')
  assert.equal(moodOf({ stats: { turnsErrored: 2 } }).key, 'tired')
  assert.equal(moodOf({ signals: { now: shanghaiTs(2026, 10, 21, 2, 0), lastInteractionAt: shanghaiTs(2026, 10, 21, 1, 59) } }).key, 'sleepy')
  assert.equal(moodOf({ signals: { lastInteractionAt: shanghaiTs(2026, 10, 21, 5, 0) } }).key, 'sleepy')
  assert.equal(moodOf({ signals: { feihuaWins: 3 } }).key, 'proud')
  assert.equal(moodOf({ signals: { feihuaWins: 1 } }).key, 'happy')
  assert.equal(moodOf({ stats: { userMessages: 12 } }).key, 'happy')
  assert.equal(moodOf({
    signals: { now: shanghaiTs(2026, 10, 21, 12, 10), lastInteractionAt: shanghaiTs(2026, 10, 21, 10, 0) },
    stats: { userMessages: 1 },
  }).key, 'hungry')
  assert.equal(moodOf({
    signals: { lastInteractionAt: shanghaiTs(2026, 10, 21, 8, 0) },
    stats: { userMessages: 0 },
  }).key, 'lonely')
  assert.equal(moodOf({ weather: { category: 'rain', isDay: true } }).key, 'cozy')
  assert.equal(moodOf({ weather: { category: 'clear', isDay: false, tempC: 15 } }).key, 'cozy')
  assert.equal(moodOf({ signals: { clicks: 0 }, stats: { userMessages: 3 } }).key, 'curious')

  // 优先级
  assert.equal(moodOf({ stats: { toolCalls: 100, userMessages: 20 }, weather: { category: 'rain', isDay: true } }).key, 'tired')
  assert.equal(moodOf({ signals: { now: shanghaiTs(2026, 10, 21, 23, 30), lastInteractionAt: shanghaiTs(2026, 10, 21, 23, 29), feihuaWins: 5 } }).key, 'sleepy')
  assert.equal(moodOf({ signals: { feihuaWins: 5 }, stats: { userMessages: 20 } }).key, 'proud')
  assert.equal(moodOf({ stats: { userMessages: 20 }, weather: { category: 'rain', isDay: true } }).key, 'happy')
  assert.equal(moodOf({ signals: { clicks: 0 }, stats: { userMessages: 3 }, weather: { category: 'rain', isDay: true } }).key, 'cozy')

  // label/image/reason 完整；图片映射文件均来自 92 张本地立绘
  for (const key of ['happy', 'proud', 'tired', 'sleepy', 'hungry', 'lonely', 'curious', 'cozy', 'calm']) {
    const mood = debug.computeMood(baseMoodInput({ stats: {} }))
    assert.equal(typeof debug.MOOD_LABELS[key], 'string')
    const file = debug.moodImageFor(key)
    assert.ok(file.endsWith('.webp'))
    assert.ok(existsSync(path.join(ROOT, 'assets', 'generated', file)), '缺少立绘：' + file)
    assert.ok(mood.label && mood.reason)
  }
})

test('心情限频 throttleMoodSwitch：20min 内不换、strong/force 可破例、同 key 只更新文案', () => {
  const { debug } = loadClient()
  const t0 = 1_800_000_000_000
  const calm = { key: 'calm', label: '平静', image: 'a.webp', reason: 'r', strong: false }
  const happy = { key: 'happy', label: '开心', image: 'b.webp', reason: 'r2', strong: false }
  const tired = { key: 'tired', label: '有点累', image: 'c.webp', reason: 'r3', strong: true }
  const first = debug.throttleMoodSwitch(null, calm, t0, false)
  assert.equal(first.changed, true)
  assert.equal(first.switchedAt, t0)

  const blocked = debug.throttleMoodSwitch(first, happy, t0 + 10 * 60 * 1000, false)
  assert.equal(blocked.key, 'calm', '20min 内非 strong 不换')
  assert.equal(blocked.changed, false)

  const later = debug.throttleMoodSwitch(first, happy, t0 + 21 * 60 * 1000, false)
  assert.equal(later.key, 'happy')
  assert.equal(later.changed, true)

  const strong = debug.throttleMoodSwitch(first, tired, t0 + 60 * 1000, false)
  assert.equal(strong.key, 'tired', 'strong 状态变化可破例')
  const forced = debug.throttleMoodSwitch(first, happy, t0 + 60 * 1000, true)
  assert.equal(forced.key, 'happy', '手动刷新可强制生效')

  const same = debug.throttleMoodSwitch(first, Object.assign({}, calm, { reason: '新理由' }), t0 + 5 * 60 * 1000, false)
  assert.equal(same.key, 'calm')
  assert.equal(same.reason, '新理由')
  assert.equal(same.changed, false)
  assert.equal(same.switchedAt, t0)
})

test('天气 + 心情合成立绘：恶劣天气优先，其次心情，最后默认', () => {
  const { debug } = loadClient()
  const moodHappy = { key: 'happy', image: debug.moodImageFor('happy') }
  assert.equal(debug.mascotImageFor({ weatherStateKey: 'rain', weatherEnabled: true, moodEnabled: true, mood: moodHappy }).stateKey, 'rain')
  assert.equal(debug.mascotImageFor({ weatherStateKey: 'night', weatherEnabled: true, moodEnabled: true, mood: moodHappy }).stateKey, 'night')
  const moodImage = debug.mascotImageFor({ weatherStateKey: 'idle', weatherEnabled: true, moodEnabled: true, mood: moodHappy })
  assert.equal(moodImage.source, 'mood')
  assert.equal(moodImage.file, debug.moodImageFor('happy'))
  assert.equal(debug.mascotImageFor({ weatherStateKey: 'idle', weatherEnabled: true, moodEnabled: false, mood: moodHappy }).stateKey, 'idle')
  assert.equal(debug.mascotImageFor({ weatherStateKey: 'celebrate', weatherEnabled: false, moodEnabled: false, mood: moodHappy }).source, 'default')
})

test('自言自语触发条件：开关/可见/面板/气泡/3s 安静，无硬底/无每日上限', () => {
  const { debug } = loadClient()
  const now = shanghaiTs(2026, 10, 21, 15, 0)
  const base = {
    enabled: true, hidden: false, panelOpen: false, bubbleOpen: false,
    visible: true, now, lastInteractionAt: now - 4 * 1000, lastShownAt: 0,
  }
  assert.equal(debug.canShowSpontaneous(base), true)
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { enabled: false })), false)
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { hidden: true })), false)
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { panelOpen: true })), false)
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { bubbleOpen: true })), false)
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { visible: false })), false, '页面后台不弹')
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { lastInteractionAt: now - 2 * 1000 })), false, '最近 3 秒有交互不弹')
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { lastInteractionAt: now - 3 * 1000 })), true)
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { lastInteractionAt: 0 })), true, '无交互记录视为可用')
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { todayCount: 999 })), true, '取消每日次数上限')
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { lastShownAt: now - 1000 })), true, '不再有最小间隔/硬底限制')
  assert.equal(debug.canShowSpontaneous(Object.assign({}, base, { moodKey: '' })), true, '不依赖心情 key')
  assert.equal(debug.SPONT_QUIET_MS, 3000)
})
test('自言自语记录：每日重置 / 7 天去重 / 最多 300 条 / lastType+lastTag / localStorage', () => {
  const { debug, storage } = loadClient()
  const now = shanghaiTs(2026, 10, 21, 15, 0)
  const old = debug.normalizeSpontState(
    {
      date: '2026-10-20',
      lastShownAt: now - 24 * 3600 * 1000,
      todayCount: 2,
      seenIds: [{ id: 'oldday', at: now - 24 * 3600 * 1000 }],
    },
    now,
  )
  assert.equal(old.todayCount, 0)
  assert.equal(old.lastShownAt, 0)
  assert.equal(old.date, '2026-10-21')

  const pruned = debug.normalizeSpontState(
    { date: '2026-10-21', todayCount: 1, lastShownAt: now, seenIds: [
      { id: 'recent', at: now - 6 * 24 * 3600 * 1000 },
      { id: 'stale', at: now - 8 * 24 * 3600 * 1000 },
    ], lastType: 'murmur', lastTag: 'tired' },
    now,
  )
  assertDeep(pruned.seenIds.map((entry) => entry.id), ['recent'])
  assert.equal(pruned.todayCount, 1)
  assert.equal(pruned.lastType, 'murmur')
  assert.equal(pruned.lastTag, 'tired')

  const many = Array.from({ length: 350 }, (_, index) => ({ id: 'p' + index, at: now }))
  const capped = debug.normalizeSpontState({ date: '2026-10-21', seenIds: many }, now)
  assert.equal(capped.seenIds.length, debug.SPONT_MAX_SEEN)
  assert.equal(debug.SPONT_MAX_SEEN, 300)

  const recorded = debug.recordSpontShown(capped, 'p999', now, 'hybrid', 'weather')
  assert.equal(recorded.todayCount, 1)
  assert.equal(recorded.lastShownAt, now)
  assert.equal(recorded.lastType, 'hybrid')
  assert.equal(recorded.lastTag, 'weather')
  assert.equal(recorded.seenIds[recorded.seenIds.length - 1].id, 'p999')
  assert.equal(debug.recordSpontShown(recorded, 'p1000', now + 1000, 'murmur', 'night').todayCount, 2)

  debug.writeSpontState(recorded)
  const readBack = debug.readSpontState(now)
  assert.equal(readBack.todayCount, 1)
  assert.equal(readBack.lastType, 'hybrid')
  assert.ok(readBack.seenIds.some((entry) => entry.id === 'p999'))
  storage.setItem(debug.SPONT_KEY, '{bad json')
  assert.equal(debug.readSpontState(now).todayCount, 0, '损坏记录安全降级')
})
test('自言自语轮询：20–40s 随机、事件唤醒 2–5s、失败重试 10s、卡片关闭 3s', () => {
  const { debug } = loadClient()
  assert.equal(debug.SPONT_POLL_MIN_MS, 20 * 1000)
  assert.equal(debug.SPONT_POLL_MAX_MS, 40 * 1000)
  assert.equal(debug.SPONT_RETRY_MS, 10 * 1000)
  assert.equal(debug.SPONT_EVENT_MIN_MS, 2000)
  assert.equal(debug.SPONT_EVENT_MAX_MS, 5000)
  assert.equal(debug.SPONT_CLOSE_RECHECK_MS, 3000)
  const low = debug.nextSpontPollDelay(() => 0)
  const high = debug.nextSpontPollDelay(() => 0.999999)
  const mid = debug.nextSpontPollDelay(() => 0.5)
  assert.equal(low, 20000)
  assert.ok(high <= 40000 && high >= 39000)
  assert.ok(mid > low && mid < high)
  const eventLow = debug.nextSpontEventDelay(() => 0)
  const eventHigh = debug.nextSpontEventDelay(() => 0.999999)
  assert.equal(eventLow, 2000)
  assert.ok(eventHigh <= 5000 && eventHigh >= 4900)
  for (const name of ['SPONT_BASE_MIN_MS', 'SPONT_BASE_MAX_MS', 'SPONT_IDLE_AFTER_MS', 'SPONT_IDLE_MIN_MS', 'SPONT_IDLE_MAX_MS', 'SPONT_HARD_MIN_MS', 'SPONT_DAILY_LIMIT', 'nextSpontDelay', 'isSpontIdle']) {
    assert.equal(typeof debug[name], 'undefined', '旧时间闸门应删除：' + name)
  }
})
test('settings mood/spontaneousPoem：归一化与 PUT 序列化', () => {
  const { debug } = loadClient()
  assert.equal(debug.normalizeSettings({}).mood, true)
  assert.equal(debug.normalizeSettings({}).spontaneousPoem, true)
  assert.equal(debug.normalizeSettings({ mood: false }).mood, false)
  assert.equal(debug.normalizeSettings({ spontaneousPoem: false }).spontaneousPoem, false)
  const patch = debug.settingsPatch({ mood: false, spontaneousPoem: true })
  assertDeep(patch, { mood: false, spontaneousPoem: true })
  const request = debug.buildSettingsRequest({ mood: false, spontaneousPoem: false })
  assertDeep(JSON.parse(request.init.body), { mood: false, spontaneousPoem: false })
})

test('心情 UI：今日 tab 心情 chip；设置 tab 开关/刷新心情/预览按钮', () => {
  const { react, debug } = loadClient()
  const baseApi = {
    poem: POEM,
    todayPoemId: POEM.id,
    poemItems: [POEM],
    settings: debug.normalizeSettings({}),
    poemsRes: { status: 'ready', data: { ok: true, items: [POEM] } },
    boot: { status: 'ready', data: { version: '0.1.0' } },
    changePoem() {},
    backToToday() {},
  }
  const plain = renderFresh(react, debug.TodayTab, { api: baseApi })
  assert.equal(findAll(plain, (node) => node.type === 'div' && node.props.className === 'dshp-weather').length, 0)
  const withMood = renderFresh(react, debug.TodayTab, {
    api: Object.assign({}, baseApi, {
      weatherChip: '北京 · 小雨 18℃',
      weatherNote: '今日有雨，为你选了写雨的这首',
      moodChip: '心情：开心',
    }),
  })
  const moodText = textOf(withMood)
  assert.match(moodText, /心情：开心/)
  assert.match(moodText, /北京 · 小雨 18℃/)
  const moodChips = findAll(withMood, (node) => node.type === 'span'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-mood-chip'))
  assert.equal(moodChips.length, 1)

  const updates = []
  const refreshed = []
  const previews = []
  const settingsApi = {
    settings: debug.normalizeSettings({}),
    updateSettings: (patch) => updates.push(patch),
    hideWidget() {},
    resetSettings() {},
    weatherRes: { status: 'ready', at: shanghaiTs(2026, 10, 21, 10, 0) },
    weatherData: { ok: true, city: '北京', weather: { category: 'rain', label: '小雨', tempC: 18, isDay: true } },
    refreshWeather: () => {},
    moodRes: { status: 'ready', at: shanghaiTs(2026, 10, 21, 10, 0), data: { updatedAt: shanghaiTs(2026, 10, 21, 10, 0) } },
    moodStats: debug.normalizeMoodStats({ userMessages: 12, toolCalls: 128 }),
    moodView: { key: 'tired', label: '有点累', reason: '工具调用 128 次 · 今天辛苦啦' },
    moodBasis: '今天聊了 12 句 · 工具调用 128 次 · 天气 小雨',
    refreshMoodNow: () => refreshed.push(true),
    previewSpontaneousPoem: () => previews.push(true),
    boot: { data: { version: '0.1.0', dataVersion: 'x', source: {} } },
  }
  const tree = renderFresh(react, debug.SettingsTab, { api: settingsApi })
  const text = textOf(tree)
  for (const label of ['心情换装', '自言自语（偶尔说说话）', '刷新心情', '预览一句', '随时随地可能说一句']) {
    assert.ok(text.includes(label), '设置缺少：' + label)
  }
  assert.match(text, /今天聊了 12 句 · 工具调用 128 次 · 天气 小雨/)
  assert.match(text, /有点累/)

  const moodSwitch = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '心情换装开关')[0]
  assert.ok(moodSwitch)
  moodSwitch.props.onClick()
  assertDeep(updates[0], { mood: false })
  const readSwitch = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '自言自语开关')[0]
  assert.ok(readSwitch)
  readSwitch.props.onClick()
  assertDeep(updates[1], { spontaneousPoem: false })

  const refreshButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '刷新心情')[0]
  assert.ok(refreshButton)
  refreshButton.props.onClick()
  assertDeep(refreshed, [true])
  const previewButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '预览一句')[0]
  assert.ok(previewButton)
  previewButton.props.onClick()
  assertDeep(previews, [true])
})

test('心情集成（假 React 跑 effects）：mood 开启即拉天气、心情立绘/chip、预览不计次数、关闭回默认', async () => {
  const poems = [
    {
      id: 'w-1',
      title: '鹿柴',
      author: '王维',
      lines: ['空山不见人，', '但闻人语响。', '返景入深林，', '复照青苔上。'],
      tones: ['平平仄仄平，', '仄平平仄仄。', '仄仄仄平平，', '仄仄平平仄。'],
    },
    { id: 'w-2', title: '春晓', author: '孟浩然', lines: ['春眠不觉晓，'], tones: ['平平仄仄仄，'] },
  ]
  const dataVersion = 'test.mood.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: true, weatherCity: '北京' }
  const bootstrap = {
    ok: true,
    version: '0.1.0',
    dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-21', poemId: 'w-1' },
    counts: { poems: poems.length, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'bootstrap.json': bootstrap,
    'poems.json': { ok: true, dataVersion, items: poems },
    'ci.json': { ok: true, dataVersion, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-21', stats: { userMessages: 2, toolCalls: 100 }, updatedAt: shanghaiTs(2026, 10, 21, 10, 0) },
    'settings.json': { ok: true, settings },
    'self-talk.json': { ok: true, lines: [{ text: '今天也辛苦啦，我陪着你。' }, { text: '夜深了，记得早点休息。' }], model: { provider: 'test', model: 'test' } },
  }
  const fetchUrls = []
  const { react, debug, storage } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: async (url) => {
      fetchUrls.push(String(url))
      const key = String(url).replace('/api/dsh-poetry/', '')
      const data = responses[key]
      if (!data) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, json: async () => data }
    },
  })

  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 4; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }

    // 补充要求 3：weatherPoem=false 但 mood=true 时仍拉天气（心情也要天气）
    assert.ok(fetchUrls.some((url) => url.includes('weather.json')), 'mood 开启也应拉取天气')
    assert.ok(fetchUrls.some((url) => url.includes('mood.json')), '应拉取心情统计')

    // 心情 tired（工具调用 100）→ work-sleep 立绘（天气晴不是强制 overlay）
    let mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(String(mascot.props.src).includes('dsh-whale-state-work-sleep.webp'), '心情立绘应为 work-sleep，实际：' + mascot.props.src)

    // 气泡第 1 张：心情 chip（天气诗被关闭，无天气 chip）
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    let bubble = findBubble(tree)
    assert.ok(bubble)
    let bubbleText = textOf(bubble)
    assert.match(bubbleText, /心情：有点累/)
    assert.ok(!bubbleText.includes('℃'), 'weatherPoem=false 不应显示天气 chip')

    // 补充要求 1：预览心情诗立即弹出，且不写 lastShownAt/todayCount
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    assert.ok(panelButton)
    panelButton.props.onClick()
    tree = renderMain()
    const panelTabs = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-tab'))
    const settingsTab = panelTabs.find((tab) => textOf(tab) === '设置')
    assert.ok(settingsTab)
    settingsTab.props.onClick()
    tree = renderMain()
    const settingsElement = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.ok(settingsElement)
    const mainApi = settingsElement.props.api
    mainApi.previewSpontaneousPoem()
    await sleep(30)
    tree = renderMain()
    const spontCards = findAll(tree, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont')
    assert.equal(spontCards.length, 1, '预览应立即显示自言自语卡片（面板开着也可）')
    const spontText = textOf(spontCards[0])
    assert.match(spontText, /它小声嘀咕：/, '自言自语标题固定嘀咕类')
    assert.ok(!spontText.includes('它想读一句'), '自言自语不念诗')
    const sourceNodes = findAll(spontCards[0], (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont-source')
    assert.equal(sourceNodes.length, 0, '自言自语不显示诗句出处')
    const sentenceNodes = findAll(spontCards[0], (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont-sentence')
    assert.equal(sentenceNodes.length, 1, '卡片正文只渲染一段随想')
    const shownSentence = textOf(sentenceNodes[0])
    assert.match(shownSentence, /[。！？]$/, '随想也是完整的一句话')
    assert.equal(storage.getItem(debug.SPONT_KEY), null, '预览不写 localStorage（不计次数/不写 lastShownAt）')

    // 旧 forceType（poem/hybrid）也被忽略：仍然只显示随想
    mainApi.previewSpontaneousPoem('poem')
    await sleep(30)
    tree = renderMain()
    const typedCard = findAll(tree, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont')[0]
    assert.ok(typedCard)
    assert.match(textOf(typedCard), /它小声嘀咕：/)
    assert.ok(!textOf(typedCard).includes('它想读一句'))
    const murmurSentence = findAll(typedCard, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont-sentence')[0]
    assert.equal(typeof murmurSentence.props.onClick, 'undefined', '随想不可点开诗句')

    // 补充要求 2 + C：刷新心情 / 关闭心情后回默认立绘
    // 假 React 每轮都会重跑 bootstrap effect；同步 mock 设置，模拟真实宿主已保存 mood=false
    responses['bootstrap.json'] = Object.assign({}, bootstrap, { settings: Object.assign({}, settings, { mood: false }) })
    mainApi.updateSettings({ mood: false })
    tree = renderMain()
    for (let round = 0; round < 2; round += 1) {
      react._runEffects()
      await sleep(10)
      tree = renderMain()
    }
    await sleep(2600) // 等每日 greet / 表情彩蛋 2.5s 结束
    tree = renderMain()
    mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(
      String(mascot.props.src).includes('dsh-whale-settings-peek.webp'),
      '面板打开时应显示设置页探头图，实际：' + mascot.props.src,
    )
    const closePanelButton = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '关闭面板')[0]
    assert.ok(closePanelButton)
    closePanelButton.props.onClick()
    tree = renderMain()
    mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(
      String(mascot.props.src).includes('dsh-whale-state-celebrate.webp'),
      '关闭心情+关闭面板后应回默认立绘，实际：' + mascot.props.src,
    )
  } finally {
    react._cleanup()
  }
})


test('彩蛋卡片：30s 自动关闭 + 正文可滚动不截断（CSS 与常量）', () => {
  const { react, debug } = loadClient()
  assert.equal(debug.SPONT_AUTO_CLOSE_MS, 25000, '自动关闭应为 25 秒')
  const tree = renderFresh(react, debug.PoetryWidget, {})
  const css = String(findAll(tree, (node) => node.type === 'style')[0].children[0] || '')
  assert.match(css, /\.dshp-spont-sentence\{/)
  assert.match(css, /max-height:72px/)
  assert.match(css, /overflow-y:auto/)
  const sentenceRule = (css.match(/\.dshp-spont-sentence\{[^}]*\}/) || [''])[0]
  assert.match(sentenceRule, /white-space:normal/)
  assert.ok(!sentenceRule.includes('nowrap'), '彩蛋正文不能 nowrap')
  assert.ok(!sentenceRule.includes('ellipsis'), '彩蛋正文不能 ellipsis 截断')
})

/* ------------------------------------------------------------------ */
/* 12. M9：诗库 / 平水韵格律检测 / 句库扩容 / 剩余立绘彩蛋                */
/* ------------------------------------------------------------------ */

function makeM9Fixtures() {
  const anthology = {
    ok: true,
    dataVersion: 'test.m9.1',
    categories: ['诗经', '楚辞', '千家诗', '唐诗三百首'],
    items: [
      { id: 'shijing-001', category: '诗经', title: '关雎', author: '佚名', lines: ['关关雎鸠，在河之洲。', '窈窕淑女，君子好逑。'] },
      { id: 'chuci-001', category: '楚辞', title: '离骚', author: '屈原', lines: ['路漫漫其修远兮，吾将上下而求索。'] },
      { id: 'qianjiashi-001', category: '千家诗', title: '春日', author: '朱熹', lines: ['胜日寻芳泗水滨，', '无边光景一时新。'] },
      { id: 'tang300-001', category: '唐诗三百首', title: '月下独酌', author: '李白', lines: ['花间一壶酒，独酌无相亲。'] },
    ],
  }
  const bank = {
    ok: true,
    dataVersion: 'test.m9.1',
    items: [
      {
        id: 'bank-001',
        title: '登鹳雀楼',
        author: '王之涣',
        dynasty: 'tang',
        lines: ['白日依山尽，', '黄河入海流。', '欲穷千里目，', '更上一层楼。'],
        tones: ['仄仄平平仄，', '平平仄仄平。', '仄平平仄仄，', '仄仄仄平平。'],
        form: '五绝',
        start: '仄起',
        firstRhyme: false,
        rhymeIdx: [1, 3],
        source: 'bank',
      },
      { id: 'bank-002', title: '春晓', author: '孟浩然', dynasty: 'tang', lines: ['春眠不觉晓，', '处处闻啼鸟。'], source: 'bank' },
    ],
  }
  const pingshui = {
    ok: true,
    dataVersion: 'test.m9.1',
    source: { repo: 'pingshui', license: 'MIT' },
    categories: [
      { name: '下平聲十一尤', short: '十一尤', tone: 'ping', chars: '流楼愁' },
      { name: '上平聲一東', short: '一东', tone: 'ping', chars: '依山河穷千层' },
      { name: '上聲一董', short: '一董', tone: 'ze', chars: '白日尽黄入海欲里目更上一' },
    ],
    charIndex: {},
  }
  return { anthology, bank, pingshui }
}

test('诗库 helpers：分类合并、搜索过滤、分页', () => {
  const { debug } = loadClient()
  const { anthology, bank } = makeM9Fixtures()
  const items = debug.buildLibraryItems(anthology, bank)
  assert.equal(items.length, 6)
  assert.equal(items.filter((item) => item.categoryId === 'shijing').length, 1)
  assert.equal(items.filter((item) => item.categoryId === 'bank').length, 2)
  assert.equal(items[items.length - 1].source, 'bank')

  assert.equal(debug.filterLibraryItems(items, 'all', '').length, 6)
  assert.equal(debug.filterLibraryItems(items, 'bank', '').length, 2)
  assert.equal(debug.filterLibraryItems(items, 'all', '李白').length, 1)
  assert.equal(debug.filterLibraryItems(items, 'all', '流').length, 1)
  assert.equal(debug.filterLibraryItems(items, 'all', '不存在的词').length, 0)
  assert.equal(debug.libraryPage(items, 3).length, 3)
  assert.equal(debug.libraryPage(items, 0).length, 0)
})

test('平水韵检测：诗体/起式/韵部/借韵/拗字/三平调/孤平/出韵', () => {
  const { debug } = loadClient()
  const { pingshui } = makeM9Fixtures()
  const index = debug.buildPingshuiIndex(pingshui)
  assert.equal(index.ready, true)
  assert.equal(index.charInfo('流').rhymes[0], '十一尤')
  assertDeep(index.charInfo('日').tones, ['仄'])

  const poem = {
    lines: ['白日依山尽，', '黄河入海流。', '欲穷千里目，', '更上一层楼。'],
    tones: ['仄仄平平仄，', '平平仄仄平。', '仄平平仄仄，', '仄仄仄平平。'],
  }
  const report = debug.detectPoem(poem, index)
  assert.equal(report.ok, true)
  assert.equal(report.form, '五绝')
  assert.equal(report.start, '仄起')
  assert.equal(report.firstRhyme, false)
  assert.equal(report.meter, '仄起首句不入韵')
  assert.equal(report.violations.filter((item) => !item.rhyme).length, 0)
  assert.ok(report.rhymeGroup.indexOf('十一尤') >= 0)
  assert.equal(report.rhymeError, '')
  assert.match(report.summary, /五绝/)
  assert.match(report.summary, /十一尤/)

  // 一三五不论：首句第一字 仄→平 不算拗
  const freeTone = Object.assign({}, poem, { tones: ['平仄平平仄，', '平平仄仄平。', '仄平平仄仄，', '仄仄仄平平。'] })
  assert.equal(debug.detectPoem(freeTone, index).violations.filter((item) => !item.rhyme).length, 0)
  // 二四六分明：第二句第二字 平→仄 记拗
  const violation = Object.assign({}, poem, { tones: ['仄仄平平仄，', '平仄仄仄平。', '仄平平仄仄，', '仄仄仄平平。'] })
  const violationReport = debug.detectPoem(violation, index)
  assert.ok(violationReport.violations.some((item) => item.line === 2 && item.position === 2), '二四六位置违律应报拗字')
  // 孤平：平平仄仄平 首字用仄
  const guPing = Object.assign({}, poem, { tones: ['仄仄平平仄，', '仄平仄仄平。', '仄平平仄仄，', '仄仄仄平平。'] })
  assert.ok(debug.detectPoem(guPing, index).guPing.indexOf(2) >= 0)
  // 三平调：末三字全平
  const sanPing = Object.assign({}, poem, { lines: ['白日依山尽，', '黄河入海流。', '欲穷千里目，', '更上一层楼。'] })
  sanPing.tones = ['仄仄平平仄，', '平平平平平。', '仄平平仄仄，', '仄仄仄平平。']
  assert.ok(debug.detectPoem(sanPing, index).sanPing.indexOf(2) >= 0)

  // 借韵：首句用别部平声韵（一东），2/4 句十一尤
  const borrowPoem = {
    lines: ['白日依山风，', '黄河入海流。', '欲穷千里目，', '更上一层楼。'],
    tones: ['仄仄仄平平，', '平平仄仄平。', '仄平平仄仄，', '仄仄仄平平。'],
  }
  const borrowReport = debug.detectPoem(borrowPoem, index)
  assert.equal(borrowReport.firstRhyme, true)
  assert.equal(borrowReport.rhymeLines[0].borrowed, true, '首句可借邻韵')

  // 出韵：第 4 句韵脚换部
  const outPoem = {
    lines: ['白日依山尽，', '黄河入海流。', '欲穷千里目，', '更上一层东。'],
    tones: ['仄仄平平仄，', '平平仄仄平。', '仄平平仄仄，', '仄仄仄平平。'],
  }
  const outReport = debug.detectPoem(outPoem, index)
  assert.match(outReport.rhymeError, /出韵|共同韵部/)

  // 七绝 / 七律 体裁判定
  const seven = {
    lines: ['朝辞白帝彩云间，', '千里江陵一日还。', '两岸猿声啼不住，', '轻舟已过万重山。'],
    tones: ['平平仄仄仄平平，', '平仄平平仄仄平。', '仄仄平平平仄仄，', '平平仄仄仄平平。'],
  }
  assert.equal(debug.detectPoem(seven, index).form, '七绝')
  const eight = { lines: [], tones: [] }
  for (let i = 0; i < 8; i += 1) {
    eight.lines.push('Test')
    eight.tones.push('')
  }
  // 占位长度不足时给出可读错误而不是崩溃
  assert.equal(debug.detectPoem(eight, index).ok, false)
})

test('格律检测输入：解析/校验/逐字标注/错误提示', () => {
  const { debug } = loadClient()
  const { pingshui } = makeM9Fixtures()
  const index = debug.buildPingshuiIndex(pingshui)
  const text = '白日依山尽，\n黄河入海流。\n欲穷千里目，\n更上一层楼。'
  const parsed = debug.parsePoemInput(text)
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.lines.length, 4)
  assert.deepEqual(parsed.lines[0].chars.join(''), '白日依山尽')

  const report = debug.detectPoemText(text, index)
  assert.equal(report.form, '五绝')
  assert.equal(report.ok, true)
  assert.match(report.summary, /五绝/)
  assert.ok(Array.isArray(report.annotation) && report.annotation[0][0].tone === '仄')

  assert.match(debug.parsePoemInput('白日依山尽，黄河入海流。').error, /4 句或 8 句/)
  assert.equal(debug.parsePoemInput('白日依山尽，黄河入海流。欲穷千里目，更上一层楼。').error, undefined)
  assert.match(debug.parsePoemInput('白白白日依山尽，\n黄河入海流。\n欲穷千里目，\n更上一层楼。').error, /5 或 7|不一致/)
  assert.match(debug.detectPoemText('', index).errors[0], /请输入/)
  assert.ok(debug.formatDetectionReport(report).includes('格律检测'))
  assertDeep(Object.keys(debug.detectionRhymeIndexes(report)).map(Number).sort((a, b) => a - b), [1, 3])
})

test('诗库 UI：分类 chips / 列表 / 详情 / 平仄与检测入口；加载与失败态', () => {
  const { react, debug } = loadClient()
  const { anthology, bank, pingshui } = makeM9Fixtures()
  const api = {
    anthologyRes: { status: 'ready', data: anthology },
    bankRes: { status: 'ready', data: bank },
    pingshuiRes: { status: 'ready', data: pingshui },
    reloadAnthology: async () => {},
    reloadBank: async () => {},
    reloadPingshui: async () => {},
    showToast() {},
    libraryFocus: null,
    settings: debug.normalizeSettings({}),
  }
  let tree = renderFresh(react, debug.LibraryTab, { api })
  let text = textOf(tree)
  assert.match(text, /共 6 首/)
  for (const label of ['诗经', '楚辞', '千家诗', '唐诗三百首', '全唐诗精选']) assert.ok(text.includes(label), '缺少分类：' + label)
  const rows = findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-row')
  assert.equal(rows.length, 6)

  // 详情：有 tones → 平仄 + 体式；点条目进入
  const bankChip = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).includes('全唐诗精选'))
  bankChip.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  const bankRows = findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-row')
  assert.equal(bankRows.length, 2)
  bankRows[0].props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  text = textOf(tree)
  assert.match(text, /王之涣《登鹳雀楼》/)
  assert.match(text, /体式 五绝/)
  assert.ok(findAll(tree, (node) => node.type === 'span'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dshp-ch-ping')).length > 0, '有 tones 应逐字平仄着色')

  // 格律检测入口 → 报告
  const detectButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '格律检测')[0]
  assert.ok(detectButton)
  detectButton.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  text = textOf(tree)
  assert.match(text, /五绝/)
  assert.match(text, /十一尤/)

  // 输入自测
  const selfButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '自测输入')[0]
  assert.ok(selfButton)
  selfButton.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  const textarea = findAll(tree, (node) => node.type === 'textarea')[0]
  assert.ok(textarea)
  textarea.props.onChange({ target: { value: '白日依山尽，\n黄河入海流。\n欲穷千里目，\n更上一层楼。' } })
  tree = rerender(react, debug.LibraryTab, { api })
  const runButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '开始检测')[0]
  runButton.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  assert.match(textOf(tree), /五绝/)

  // 失败/加载态
  const errorTree = renderFresh(react, debug.LibraryTab, {
    api: Object.assign({}, api, { anthologyRes: { status: 'error', error: { status: 404 } }, bankRes: { status: 'error', error: { status: 404 } } }),
  })
  assert.match(textOf(errorTree), /诗库数据暂时不可用|重试/)
  const loadingTree = renderFresh(react, debug.LibraryTab, { api: Object.assign({}, api, { anthologyRes: { status: 'loading', data: null }, bankRes: { status: 'loading', data: null } }) })
  assert.match(textOf(loadingTree), /正在载入诗库/)
})

test('资产数据缓存：URL 带 dataVersion，版本变化失效，404 友好降级', async () => {
  const { context, debug } = loadClient()
  const calls = []
  context.fetch = async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => ({ ok: true, dataVersion: String(url).slice(String(url).indexOf('v=') + 2), items: [] }) }
  }
  debug.setAssetDataVersion('2026-10-21.4')
  await debug.loadResource('anthology')
  assert.ok(calls[0].includes('f=data/anthology.json'))
  assert.ok(calls[0].includes('v=2026-10-21.4'))
  await debug.loadResource('anthology')
  assert.equal(calls.length, 1, '同版本应命中模块缓存')

  debug.setAssetDataVersion('2026-10-22.1')
  await debug.loadResource('anthology')
  assert.equal(calls.length, 2, 'dataVersion 变化应使缓存失效')
  assert.ok(calls[1].includes('v=2026-10-22.1'))

  context.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
  debug.clearResourceCache('pingshui')
  await assert.rejects(() => debug.loadResource('pingshui'), (error) => error.status === 404)
})

test('飞花令句库扩容：anthology + bank lines 入索引且去重、句数增长', () => {
  const { debug } = loadClient()
  const { anthology, bank } = makeM9Fixtures()
  const poems = {
    items: [{ id: 'p1', title: '静夜思', author: '李白', lines: ['床前明月光，', '疑是地上霜。'] }],
  }
  const ci = { items: [{ id: 'c1', author: '苏轼', rhythmic: '水调歌头', lines: ['明月几时有，', '把酒问青天。'] }] }
  const base = debug.buildFeihuaIndex(poems, ci)
  const extended = debug.buildFeihuaIndex(poems, ci, anthology, bank)
  assert.ok(extended.entries.length > base.entries.length)
  assert.ok(extended.entries.some((entry) => entry.text === '关关雎鸠，在河之洲。'))
  assert.ok(extended.entries.some((entry) => entry.text === '白日依山尽，黄河入海流。'), '半句应合为完整句')
  assert.ok(extended.entries.every((entry) => /[。！？]$/.test(entry.text)), '不得保留半句结尾')
  assert.equal(extended.counts['月'], base.counts['月'], '不含令字的句子不增加该字计数')
  assert.ok(extended.counts['山'] > base.counts['山'], '额外句库应提升令字句数')
  // 去重：同一句跨诗/词/选集只保留一次
  const dup = { items: [{ id: 'dup', author: '甲', title: '重复', lines: ['床前明月光，', '疑是地上霜。'] }] }
  const deduped = debug.buildFeihuaIndex(poems, ci, dup)
  assert.equal(deduped.entries.filter((entry) => entry.text === '床前明月光，疑是地上霜。').length, 1)
})

test('天气诗 / 彩蛋选诗池优先级：精选 320 → anthology → bank', () => {
  const { debug } = loadClient()
  const { anthology, bank } = makeM9Fixtures()
  const tags = ['雨', '风', '春', '白']
  const poemsData = {
    items: [
      { id: 'p1', title: '雨诗', author: '甲', lines: ['夜来风雨声，'] },
      { id: 'p2', title: '雨诗二', author: '乙', lines: ['好雨知时节，'] },
    ],
  }
  const extraAnthology = { items: [
    { id: 'a1', author: '甲', title: '春风', lines: ['春风又绿江南岸，'] },
    { id: 'a2', author: '乙', title: '春雨', lines: ['春雨贵如油，'] },
  ] }
  const extraBank = { items: [
    { id: 'b1', author: '丙', title: '白雪', lines: ['白雪却嫌春色晚，'] },
  ] }
  const weatherPool = debug.buildWeatherPoemPool(poemsData, null, tags, 3, { anthology: extraAnthology, bank: extraBank })
  assert.equal(weatherPool.length, 3)
  assert.equal(weatherPool[0].kind, 'poem')
  assert.equal(weatherPool[1].kind, 'poem')
  assert.equal(weatherPool[2].kind, 'anthology', '诗不足时先用 anthology 再 bank')
  const weatherPool2 = debug.buildWeatherPoemPool(poemsData, null, tags, 5, { anthology: extraAnthology, bank: extraBank })
  assertDeep(weatherPool2.map((entry) => entry.kind), ['poem', 'poem', 'anthology', 'anthology', 'bank'])

})

test('剩余立绘彩蛋：随机表情映射、每日 greet、idle ≤1 次/45min', async () => {
  const { debug, storage } = loadClient()
  assert.ok(debug.MASCOT_EXPRESSION_FILES.length >= 20)
  for (const file of debug.MASCOT_EXPRESSION_FILES) {
    assert.ok(existsSync(path.join(ROOT, 'assets', 'generated', file)), '缺少立绘：' + file)
  }
  assert.equal(debug.pickMascotExpression(() => 0), debug.MASCOT_EXPRESSION_FILES[0])
  assert.equal(debug.pickMascotExpression(() => 0.9999), debug.MASCOT_EXPRESSION_FILES[debug.MASCOT_EXPRESSION_FILES.length - 1])

  const now = shanghaiTs(2026, 10, 21, 10, 0)
  const empty = debug.normalizeMascotEggState(null, now)
  assert.equal(debug.shouldShowDailyGreet(empty, now), true)
  const greeted = debug.recordMascotEgg(empty, { greet: true }, now)
  assert.equal(debug.shouldShowDailyGreet(greeted, now), false)
  assert.equal(debug.shouldShowDailyGreet(greeted, now + 24 * 3600 * 1000), true, '新的一天重新 greet')
  debug.writeMascotEggState(debug.recordMascotEgg(greeted, { idle: true }, now))
  const stored = debug.readMascotEggState(now)
  assert.equal(stored.idleAt, now)
  assert.equal(debug.canShowIdlePose({ idleAt: 0 }, now, now - 6 * 60 * 1000), true)
  assert.equal(debug.canShowIdlePose({ idleAt: 0 }, now, now - 60 * 1000), false, '用户刚交互过不出 idle 姿态')
  assert.equal(debug.canShowIdlePose({ idleAt: now - 10 * 60 * 1000 }, now, now - 6 * 60 * 1000), false, '45min 内只出一次')
  assert.equal(debug.canShowIdlePose({ idleAt: now - 46 * 60 * 1000 }, now, now - 6 * 60 * 1000), true)
  storage.setItem(debug.MASCOT_EGG_KEY, '{bad json')
  assert.equal(debug.shouldShowDailyGreet(debug.readMascotEggState(now), now), true, '损坏记录安全降级')
})

test('立绘彩蛋：双击随机表情（2.5s 回退）+ onError 回 celebrate', async () => {
  const { react, debug } = loadClient({ seed: CACHE_SEED })
  const renderMain = () => {
    react._beginRender()
    return debug.PoetryWidget({})
  }
  let tree = renderFresh(react, debug.PoetryWidget, {})
  const stage = findStage(tree)
  assert.ok(stage)
  stage.props.onDoubleClick({ preventDefault() {} })
  tree = renderMain()
  let img = findAll(tree, (node) => node.type === 'img')[0]
  const expressionFile = String(img.props.src).split('generated/')[1]
  assert.ok(debug.MASCOT_EXPRESSION_FILES.indexOf(expressionFile) >= 0, '双击应显示随机表情立绘，实际：' + img.props.src)

  // onError 回退 celebrate
  img.props.onError()
  tree = renderMain()
  img = findAll(tree, (node) => node.type === 'img')[0]
  assert.ok(String(img.props.src).includes('dsh-whale-state-celebrate.webp'), '加载失败应回 fallback celebrate')

  await sleep(2600)
  tree = renderMain()
  img = findAll(tree, (node) => node.type === 'img')[0]
  assert.ok(String(img.props.src).includes('dsh-whale-state-celebrate.webp'), '2.5s 后应回到心情/天气/默认立绘')
})

const M9_DATA_DIR = path.join(ROOT, 'assets', 'data')
const HAS_M9_DATA = ['anthology.json', 'poems-bank.json', 'pingshui.json'].every((name) => existsSync(path.join(M9_DATA_DIR, name)))

test('真实 M9 数据冒烟：诗库/平水韵/格律检测/句库扩容/选诗池', {
  skip: HAS_M9_DATA ? false : 'assets/data 尚未生成',
}, () => {
  const readM9 = (name) => JSON.parse(readFileSync(path.join(M9_DATA_DIR, name), 'utf8'))
  const anthology = readM9('anthology.json')
  const bank = readM9('poems-bank.json')
  const pingshuiRaw = readM9('pingshui.json')
  const manifest = readM9('manifest.json')
  const poems = JSON.parse(readFileSync(path.join(DATA_DIR, 'poems.json'), 'utf8'))
  const { react, debug } = loadClient()

  assert.equal(anthology.dataVersion, manifest.dataVersion)
  assert.ok(anthology.items.length >= 600)
  assert.ok(bank.items.length >= 3000)
  assert.ok(bank.items.some((item) => Array.isArray(item.tones) && item.tones.length > 0))

  const libraryItems = debug.buildLibraryItems(anthology, bank)
  assert.equal(libraryItems.length, anthology.items.length + bank.items.length)
  for (const category of ['shijing', 'chuci', 'qianjiashi', 'tang300', 'bank']) {
    assert.ok(libraryItems.some((item) => item.categoryId === category), '缺少分类：' + category)
  }

  const pingshui = debug.buildPingshuiIndex(pingshuiRaw)
  assert.equal(pingshui.ready, true)
  assert.equal(pingshui.categories.length, 106)
  assertDeep(pingshui.charInfo('月').tones, ['仄'])
  assertDeep(pingshui.charInfo('风').tones, ['平'])
  assert.equal(pingshui.charInfo('看').tones.length, 2, '多音字应有平仄候选')
  assert.ok(pingshui.charInfo('月').rhymes.length === 0, '仄声字不作为平声韵脚')

  const inputText = '白日依山尽，\n黄河入海流。\n欲穷千里目，\n更上一层楼。'
  const report = debug.detectPoemText(inputText, pingshui)
  assert.equal(report.form, '五绝')
  assert.equal(report.start, '仄起')
  assert.equal(report.firstRhyme, false)
  assert.ok(report.rhymeGroup.indexOf('十一尤') >= 0)
  assert.equal(report.violations.filter((item) => !item.rhyme).length, 0)
  assert.match(report.summary, /粘对成立/)

  const baseFeihua = debug.buildFeihuaIndex({ ok: true, items: poems.items.slice(0, 5) }, { ok: true, items: [] })
  const extended = debug.buildFeihuaIndex({ ok: true, items: poems.items }, { ok: true, items: [] }, anthology, bank)
  assert.ok(extended.entries.length > 20000, '扩容句库应有 2 万句以上')
  assert.ok(extended.entries.length > baseFeihua.entries.length)
  assert.ok(extended.counts['花'] > 500)

  const rainTags = debug.weatherPoemTags({ category: 'rain', isDay: true })
  const pool = debug.buildWeatherPoemPool(poems, null, rainTags, 20, { anthology, bank })
  assert.equal(pool.length, 20)
  assert.ok(pool.every((entry) => entry.kind === 'poem'), '精选 320 足够时优先用诗')


  // 真实数据渲染诗库：分类/列表/详情/检测
  const api = {
    anthologyRes: { status: 'ready', data: anthology },
    bankRes: { status: 'ready', data: bank },
    pingshuiRes: { status: 'ready', data: pingshuiRaw },
    reloadAnthology: async () => {},
    reloadBank: async () => {},
    reloadPingshui: async () => {},
    showToast() {},
    libraryFocus: null,
    settings: debug.normalizeSettings({}),
  }
  let tree = renderFresh(react, debug.LibraryTab, { api })
  assert.match(textOf(tree), new RegExp('共 ' + libraryItems.length + ' 首'))
  const bankChip = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).includes('全唐诗精选'))
  assert.ok(bankChip)
  bankChip.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  const bankRows = findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-row')
  assert.ok(bankRows.length > 0)
  bankRows[0].props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  const detailText = textOf(tree)
  assert.match(detailText, /格律检测/)
  const detectButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '格律检测')[0]
  detectButton.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api })
  const reportText = textOf(tree)
  assert.match(reportText, /五|七/)
  assert.ok(reportText.includes('韵脚') || reportText.includes('粘对') || reportText.includes('拗字'), '真实数据应渲染检测报告')
})

/* ------------------------------------------------------------------ */
/* 13. M9c：宋词全库（ci-bank）懒加载 / 诗库联动 / 句库并入 / 池降级      */
/* ------------------------------------------------------------------ */

function makeCiSelectedFixture() {
  return {
    ok: true,
    items: [
      { id: 'ci-s1', author: '苏轼', rhythmic: '水调歌头', lines: ['明月几时有，', '把酒问青天。'] },
      { id: 'ci-s2', author: '李清照', rhythmic: '如梦令', lines: ['常记溪亭日暮，', '沉醉不知归路。'] },
    ],
  }
}

function makeCiBankFixture() {
  return {
    ok: true,
    dataVersion: 'test.m9.1',
    count: 3,
    items: [
      { id: 'cib-1', author: '苏轼', rhythmic: '水调歌头', title: '水调歌头·明月几时有', lines: ['明月几时有，', '把酒问青天。'] },
      { id: 'cib-2', author: '李清照', rhythmic: '如梦令', title: '如梦令·常记溪亭日暮', lines: ['常记溪亭日暮，', '沉醉不知归路。'] },
      { id: 'cib-3', author: '苏轼', rhythmic: '水调歌头', title: '水调歌头·落日绣帘卷', lines: ['落日绣帘卷，', '亭下水连空。'] },
    ],
  }
}

test('诗库 helpers：宋词全库合并 / 词牌分布 / 词牌筛选', () => {
  const { debug } = loadClient()
  const { anthology, bank } = makeM9Fixtures()
  const ciBank = makeCiBankFixture()
  const items = debug.buildLibraryItems(anthology, bank, ciBank)
  assert.equal(items.length, 6 + 3)
  assert.equal(items.filter((item) => item.categoryId === 'ci-bank').length, 3)
  assert.equal(items[items.length - 1].source, 'ci-bank')
  assertDeep(debug.ciBankRhythmics(ciBank), [{ name: '水调歌头', count: 2 }, { name: '如梦令', count: 1 }])
  assert.equal(debug.filterLibraryItems(items, 'ci-bank', '').length, 3)
  assert.equal(debug.filterLibraryItems(items, 'ci-bank', '', '水调歌头').length, 2)
  assert.equal(debug.filterLibraryItems(items, 'ci-bank', '李清照').length, 1)
  assert.equal(debug.filterLibraryItems(items, 'ci-bank', '把酒').length, 1)
  assert.equal(debug.filterLibraryItems(items, 'all', '如梦令').length, 1)
})

test('诗库 UI：宋词精选默认 283 条不拉全库；全部宋词点击才加载；切回不重复拉', () => {
  const { react, debug } = loadClient()
  const { anthology, bank, pingshui } = makeM9Fixtures()
  const ciSelected = makeCiSelectedFixture()
  const ciBank = makeCiBankFixture()
  const requested = []
  const baseApi = {
    anthologyRes: { status: 'ready', data: anthology },
    bankRes: { status: 'ready', data: bank },
    pingshuiRes: { status: 'ready', data: pingshui },
    ciRes: { status: 'ready', data: ciSelected },
    ciBankRes: { status: 'idle', data: null },
    reloadAnthology: async () => {},
    reloadBank: async () => {},
    reloadPingshui: async () => {},
    reloadCi: async () => {},
    reloadCiBank: async () => {},
    requestCiBank: () => requested.push(true),
    showToast() {},
    libraryFocus: null,
    settings: debug.normalizeSettings({}),
  }
  let tree = renderFresh(react, debug.LibraryTab, { api: baseApi })
  const ciChip = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).includes('宋词精选'))
  assert.ok(ciChip, '应有宋词精选分类')
  assert.match(textOf(ciChip), /宋词精选 2/)
  ciChip.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api: baseApi })
  assert.match(textOf(tree), /共 2 首/)
  assertDeep(requested, [], '进入宋词精选不应拉取 ci-bank')
  const fullEntry = findButtonsByClass(tree, 'dshp-seg-btn').find((button) => textOf(button).includes('全部宋词'))
  assert.ok(fullEntry, '应有「全部宋词」入口')
  assert.match(textOf(fullEntry), /点击加载/)
  fullEntry.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api: baseApi })
  assert.match(textOf(tree), /正在载入全部宋词/)
  react._runEffects()
  react._cleanup()
  assertDeep(requested, [true], '点全部宋词才触发 ci-bank 加载')

  const readyApi = Object.assign({}, baseApi, { ciBankRes: { status: 'ready', data: ciBank } })
  tree = rerender(react, debug.LibraryTab, { api: readyApi })
  assert.match(textOf(tree), /共 3 首/)
  const selectedSeg = findButtonsByClass(tree, 'dshp-seg-btn').find((button) => textOf(button).includes('宋词精选'))
  selectedSeg.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api: readyApi })
  assert.match(textOf(tree), /共 2 首/)
  assert.equal(requested.length, 1, '切回精选不应重复请求 ci-bank')
  const rhythmSelect = findAll(tree, (node) => node.type === 'select' && node.props['aria-label'] === '按词牌筛选宋词精选')[0]
  assert.ok(rhythmSelect)
  rhythmSelect.props.onChange({ target: { value: '如梦令' } })
  tree = rerender(react, debug.LibraryTab, { api: readyApi })
  assert.match(textOf(tree), /共 1 首/)
  const rows = findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-row')
  assert.equal(rows.length, 1)
  rows[0].props.onClick()
  tree = rerender(react, debug.LibraryTab, { api: readyApi })
  const detailText = textOf(tree)
  assert.match(detailText, /宋词精选/)
  assert.match(detailText, /词牌 如梦令/)
  assert.match(detailText, /未标注平仄/)

  const requested2 = []
  const focusApi = Object.assign({}, readyApi, {
    ciBankRes: { status: 'idle', data: null },
    requestCiBank: () => requested2.push(true),
    libraryFocus: { type: 'ci-selected', rhythmic: '水调歌头', token: 1 },
  })
  const focusedTree = renderFresh(react, debug.LibraryTab, { api: focusApi })
  react._runEffects()
  react._cleanup()
  const focusedAfter = rerender(react, debug.LibraryTab, { api: focusApi })
  assert.match(textOf(focusedAfter), /共 1 首/, '预置词牌精选应只筛出精选词牌')
  assertDeep(requested2, [], '精选预置不应拉 ci-bank')
})
test('词牌 tab：同词牌精选 N 首优先，次级全库 M 首点击才加载并跳转', () => {
  const { react, debug } = loadClient()
  const ciBank = makeCiBankFixture()
  const ciSelected = makeCiSelectedFixture()
  const selectedJumps = []
  const fullJumps = []
  const knowledge = { status: 'ready', data: { cards: [], ciCards: [{ id: 'shuidiao', name: '水调歌头', aliases: [], form: '双调九十五字', rhyme: '平韵', note: '风格', example: '明月几时有' }] } }
  const ciRes = { status: 'ready', data: { items: [{ id: 'ci-1', author: '苏轼', rhythmic: '水调歌头', title: '水调歌头·明月几时有', lines: ['明月几时有，'], quote: '' }] } }
  const api = {
    knowledgeRes: knowledge,
    ciRes,
    ciBankRes: { status: 'ready', data: ciBank },
    reloadKnowledge: async () => {},
    reloadCi: async () => {},
    openCiSelectedForRhythmic: (name) => selectedJumps.push(name),
    openCiBankForRhythmic: (name) => fullJumps.push(name),
  }
  let tree = renderFresh(react, debug.CiTab, { api })
  const rows = findAll(tree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-row')
  rows[0].props.onClick()
  tree = rerender(react, debug.CiTab, { api })
  const selectedLink = findAll(tree, (node) => node.type === 'button' && textOf(node).includes('同词牌精选'))[0]
  assert.ok(selectedLink, '名篇词应有「同词牌精选」入口')
  assert.match(textOf(selectedLink), /（1 首）/)
  selectedLink.props.onClick()
  assertDeep(selectedJumps, ['水调歌头'])
  const fullLink = findAll(tree, (node) => node.type === 'button' && textOf(node).includes('全库'))[0]
  assert.ok(fullLink, '名篇词应有次级「全库」入口')
  assert.match(textOf(fullLink), /（2 首）/)
  fullLink.props.onClick()
  assertDeep(fullJumps, ['水调歌头'])

  const segButtons = findButtonsByClass(tree, 'dshp-seg-btn')
  segButtons.find((button) => textOf(button) === '词牌卡').props.onClick()
  tree = rerender(react, debug.CiTab, { api })
  const cardSelectedLink = findAll(tree, (node) => node.type === 'button' && textOf(node).includes('同词牌精选'))[0]
  assert.ok(cardSelectedLink)
  cardSelectedLink.props.onClick()
  assertDeep(selectedJumps, ['水调歌头', '水调歌头'])

  const noFullApi = Object.assign({}, api, { ciBankRes: { status: 'idle', data: null } })
  let noFullTree = renderFresh(react, debug.CiTab, { api: noFullApi })
  const rows2 = findAll(noFullTree, (node) => node.type === 'button'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-row')
  rows2[0].props.onClick()
  noFullTree = rerender(react, debug.CiTab, { api: noFullApi })
  const fullLink2 = findAll(noFullTree, (node) => node.type === 'button' && textOf(node).includes('全库'))[0]
  assert.ok(fullLink2)
  fullLink2.props.onClick()
  assertDeep(fullJumps, ['水调歌头', '水调歌头'])
})
test('飞花令句库并入宋词全库：分片合并 = 全量构建（去重），完成前提示可降级', () => {
  const { react, debug } = loadClient()
  const { anthology, bank } = makeM9Fixtures()
  const ciBank = makeCiBankFixture()
  const poems = { items: [{ id: 'p1', title: '静夜思', author: '李白', lines: ['床前明月光，', '疑是地上霜。'] }] }
  const ci = { items: [{ id: 'c1', author: '苏轼', rhythmic: '水调歌头', lines: ['明月几时有，'] }] }

  const full = debug.buildFeihuaIndex(poems, ci, anthology, bank, ciBank)
  const chunked = debug.buildFeihuaIndex(poems, ci, anthology, bank)
  assertDeep(chunked.candidates, [])
  debug.mergeFeihuaItems(chunked, [ciBank.items[0]])
  debug.mergeFeihuaItems(chunked, [ciBank.items[1], ciBank.items[2]])
  debug.finishFeihuaIndex(chunked)
  assert.equal(chunked.entries.length, full.entries.length, '分片合并后句数与全量一致')
  assertDeep(chunked.candidates, JSON.parse(JSON.stringify(full.candidates)), '候选令字与句数一致')
  for (const char of ['花', '月', '风', '春', '楼']) {
    assert.equal(chunked.counts[char], full.counts[char])
  }
  // 去重：跨诗/词/全库重复句只保留一次
  const dup = { items: [{ id: 'dup', author: '甲', title: '重', lines: ['明月几时有，', '把酒问青天。'] }] }
  const deduped = debug.buildFeihuaIndex(poems, ci, null, null, dup)
  assert.equal(deduped.entries.filter((entry) => entry.text === '明月几时有，把酒问青天。').length, 1)
  assert.equal(debug.feihuaSourceOf({ author: '苏轼', rhythmic: '水调歌头' }), '苏轼《水调歌头》')

  // 构建提示与失败降级
  const baseApi = {
    poemsRes: { status: 'ready', data: poems },
    ciRes: { status: 'ready', data: ci },
    anthologyRes: { status: 'ready', data: anthology },
    bankRes: { status: 'ready', data: bank },
    ciBankRes: { status: 'loading', data: null },
    feihuaIndex: debug.buildFeihuaIndex(poems, ci, anthology, bank),
    feihuaBuilding: true,
    poem: poems.items[0],
    reloadPoems: async () => {},
    reloadCi: async () => {},
    reloadKnowledge: async () => {},
    reloadYun: async () => {},
    reloadCiBank: async () => {},
    pulseMascot() {},
    settings: debug.normalizeSettings({}),
  }
  let tree = renderFresh(react, debug.FeihuaTab, { api: baseApi })
  assert.ok(textOf(tree).includes('正在并入宋词全库'))
  const failedTree = renderFresh(react, debug.FeihuaTab, {
    api: Object.assign({}, baseApi, { ciBankRes: { status: 'error', error: { status: 404 } }, feihuaBuilding: false }),
  })
  assert.ok(textOf(failedTree).includes('宋词全库加载失败'))
})

test('天气/彩蛋池：ci-bank 仅最后优先级且只在已加载时参与', () => {
  const { debug } = loadClient()
  const ciBank = makeCiBankFixture()
  const tags = ['月', '酒', '如']
  const bankExtra = { items: [{ id: 'b1', author: '甲', title: '月', lines: ['明月照高楼，'] }] }
  const ciBankExtra = { items: [{ id: 'cb1', author: '苏轼', rhythmic: '水调歌头', title: '明月', lines: ['明月几时有，'] }] }
  const pool = debug.buildWeatherPoemPool({ items: [] }, null, tags, 5, { bank: bankExtra, ciBank: ciBankExtra })
  assertDeep(pool.map((entry) => entry.kind), ['bank', 'ci-bank'], 'bank 优先于 ci-bank')
  const onlyCiBank = debug.buildWeatherPoemPool({ items: [] }, null, tags, 5, { ciBank: ciBankExtra })
  assertDeep(onlyCiBank.map((entry) => entry.kind), ['ci-bank'])
  const noCiBank = debug.buildWeatherPoemPool({ items: [] }, null, tags, 5, {})
  assert.equal(noCiBank.length, 0, '未加载 ci-bank 时不主动参与')

})

test('ci-bank 资产懒加载：URL 带 dataVersion 且版本失效', async () => {
  const { context, debug } = loadClient()
  const calls = []
  context.fetch = async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => ({ ok: true, dataVersion: 'v', count: 1, items: [] }) }
  }
  debug.setAssetDataVersion('2026-10-21.4')
  await debug.loadResource('ciBank')
  assert.ok(calls[0].includes('f=data/ci-bank.json'))
  assert.ok(calls[0].includes('&v=2026-10-21.4'))
  await debug.loadResource('ciBank')
  assert.equal(calls.length, 1, '同版本命中缓存')
  debug.setAssetDataVersion('2026-10-22.1')
  await debug.loadResource('ciBank')
  assert.equal(calls.length, 2)
})

const CI_BANK_FILE = path.join(M9_DATA_DIR, 'ci-bank.json')
const HAS_CI_BANK = existsSync(CI_BANK_FILE)

test('真实宋词全库冒烟：2 万首 / 891 词牌 / 句库约 19 万 / 诗库联动', {
  skip: HAS_CI_BANK ? false : 'assets/data/ci-bank.json 尚未生成',
}, () => {
  const readM9 = (name) => JSON.parse(readFileSync(path.join(M9_DATA_DIR, name), 'utf8'))
  const ciBank = readM9('ci-bank.json')
  const anthology = readM9('anthology.json')
  const bank = readM9('poems-bank.json')
  const manifest = readM9('manifest.json')
  const poems = JSON.parse(readFileSync(path.join(DATA_DIR, 'poems.json'), 'utf8'))
  const ci = JSON.parse(readFileSync(path.join(DATA_DIR, 'ci.json'), 'utf8'))
  const { debug } = loadClient()

  assert.equal(ciBank.dataVersion, manifest.dataVersion)
  assert.ok(ciBank.items.length >= 20000, '全库应有 2 万首左右')
  assert.equal(ciBank.count, ciBank.items.length)
  const totalLines = ciBank.items.reduce((sum, item) => sum + (Array.isArray(item.lines) ? item.lines.length : 0), 0)
  assert.ok(totalLines >= 140000, '宋词全库行数应达 14 万+')
  assert.ok(ciBank.items[0].author && ciBank.items[0].rhythmic && Array.isArray(ciBank.items[0].lines))

  const libraryItems = debug.buildLibraryItems(anthology, bank, ciBank)
  assert.equal(libraryItems.length, anthology.items.length + bank.items.length + ciBank.items.length)
  assert.ok(libraryItems.some((item) => item.categoryId === 'ci-bank'))

  // 宋词精选（data/ci.json 283 首）默认映射
  const ciData = JSON.parse(readFileSync(path.join(DATA_DIR, 'ci.json'), 'utf8'))
  const selectedItems = debug.buildLibraryItems(anthology, bank, null, ciData)
  assert.equal(selectedItems.filter((item) => item.categoryId === 'ci-selected').length, 283)
  assert.equal(selectedItems.length, anthology.items.length + bank.items.length + 283)
  const firstSelected = selectedItems.filter((item) => item.categoryId === 'ci-selected')[0]
  assert.match(firstSelected.title, /·/)
  assert.ok(firstSelected.rhythmic)
  assert.ok(debug.ciSelectedRhythmics(ciData).length >= 100)

  const rhythms = debug.ciBankRhythmics(ciBank)
  assert.ok(rhythms.length >= 500, '词牌数量应充足')
  const huanxisha = rhythms.find((entry) => entry.name === '浣溪沙')
  assert.ok(huanxisha && huanxisha.count > 500)
  assert.ok(rhythms.find((entry) => entry.name === '水调歌头').count > 500)
  assert.equal(debug.filterLibraryItems(libraryItems, 'ci-bank', '', '浣溪沙').length, huanxisha.count)

  const startedAt = Date.now()
  const index = debug.buildFeihuaIndex(poems, ci, anthology, bank, ciBank)
  const buildMs = Date.now() - startedAt
  assert.ok(index.entries.length >= 150000, '并入全库后句数应达 15 万+，实际 ' + index.entries.length)
  assert.ok(index.counts['花'] > 10000)
  assert.equal(index.candidates.length, 12)
  assert.ok(buildMs < 5000, '全量索引构建应在 5s 内（性能保护），实际 ' + buildMs + 'ms')

})

test('诗库搜索范围：默认只搜宋词精选，切「全部宋词」才纳入全库并提示', async () => {
  const { react, debug } = loadClient()
  const { anthology, bank, pingshui } = makeM9Fixtures()
  const ciSelected = makeCiSelectedFixture()
  const ciBank = makeCiBankFixture()
  const baseApi = {
    anthologyRes: { status: 'ready', data: anthology },
    bankRes: { status: 'ready', data: bank },
    pingshuiRes: { status: 'ready', data: pingshui },
    ciRes: { status: 'ready', data: ciSelected },
    ciBankRes: { status: 'ready', data: ciBank },
    reloadAnthology: async () => {},
    reloadBank: async () => {},
    reloadPingshui: async () => {},
    reloadCi: async () => {},
    reloadCiBank: async () => {},
    requestCiBank: () => {},
    showToast() {},
    libraryFocus: null,
    settings: debug.normalizeSettings({}),
  }
  let tree = renderFresh(react, debug.LibraryTab, { api: baseApi })
  const ciChip = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).includes('宋词精选'))
  ciChip.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api: baseApi })
  const searchInput = findAll(tree, (node) => node.type === 'input' && node.props.type === 'search')[0]
  searchInput.props.onChange({ target: { value: '明月' } })
  tree = rerender(react, debug.LibraryTab, { api: baseApi })
  react._runEffects()
  await sleep(330)
  tree = rerender(react, debug.LibraryTab, { api: baseApi })
  assert.match(textOf(tree), /共 1 首/, '默认范围应只搜宋词精选')
  const scopeButtons = findButtonsByClass(tree, 'dshp-seg-btn').map((button) => textOf(button))
  assert.ok(scopeButtons.includes('精选'))
  assert.ok(scopeButtons.includes('全部宋词'))
  const allCiScope = findButtonsByClass(tree, 'dshp-seg-btn').find((button) => textOf(button) === '全部宋词')
  allCiScope.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api: baseApi })
  assert.match(textOf(tree), /共 2 首/, '「全部宋词」范围应纳入 ci-bank')

  const requested = []
  const noBankApi = Object.assign({}, baseApi, {
    ciBankRes: { status: 'idle', data: null },
    requestCiBank: () => requested.push(true),
  })
  let noBankTree = renderFresh(react, debug.LibraryTab, { api: noBankApi })
  const ciChip2 = findButtonsByClass(noBankTree, 'dshp-fh-chip').find((chip) => textOf(chip).includes('宋词精选'))
  ciChip2.props.onClick()
  noBankTree = rerender(react, debug.LibraryTab, { api: noBankApi })
  const searchInput2 = findAll(noBankTree, (node) => node.type === 'input' && node.props.type === 'search')[0]
  searchInput2.props.onChange({ target: { value: '明月' } })
  noBankTree = rerender(react, debug.LibraryTab, { api: noBankApi })
  react._runEffects()
  await sleep(330)
  noBankTree = rerender(react, debug.LibraryTab, { api: noBankApi })
  const allCiScope2 = findButtonsByClass(noBankTree, 'dshp-seg-btn').find((button) => textOf(button) === '全部宋词')
  allCiScope2.props.onClick()
  noBankTree = rerender(react, debug.LibraryTab, { api: noBankApi })
  react._runEffects()
  react._cleanup()
  assert.match(textOf(noBankTree), /宋词全库未加载|宋词全库加载中/)
  assert.equal(requested.length, 1, '选全部宋词应触发 ci-bank 加载')
})


test('宋词精选 helpers：283 映射、词牌·首句 title、默认不含全库', () => {
  const { debug } = loadClient()
  const { anthology, bank } = makeM9Fixtures()
  const ciSelected = makeCiSelectedFixture()
  const selected = debug.ciSelectedLibraryItems(ciSelected)
  assert.equal(selected.length, 2)
  assert.ok(selected.every((item) => item.categoryId === 'ci-selected'))
  assert.equal(selected[0].title, '水调歌头·明月几时有')
  assert.equal(selected[1].title, '如梦令·常记溪亭日暮')
  const selectedRhythmics = debug.ciSelectedRhythmics(ciSelected)
  assert.equal(selectedRhythmics.length, 2)
  assert.equal(selectedRhythmics.find((entry) => entry.name === '水调歌头').count, 1)
  assert.equal(selectedRhythmics.find((entry) => entry.name === '如梦令').count, 1)

  const withSelected = debug.buildLibraryItems(anthology, bank, null, ciSelected)
  assert.equal(withSelected.length, 6 + 2)
  assert.equal(withSelected.filter((item) => item.categoryId === 'ci-bank').length, 0, '默认不含全库')
  assert.equal(withSelected.filter((item) => item.categoryId === 'ci-selected').length, 2)

  const withFull = debug.buildLibraryItems(anthology, bank, makeCiBankFixture(), ciSelected)
  assert.equal(withFull.length, 6 + 3 + 2)
  assert.equal(withFull.filter((item) => item.categoryId === 'ci-bank').length, 3)
})

test('诗库宋词降级：精选加载失败可重试；全部宋词失败可回退精选', () => {
  const { react, debug } = loadClient()
  const { anthology, bank, pingshui } = makeM9Fixtures()
  const ciSelected = makeCiSelectedFixture()
  const errorApi = {
    anthologyRes: { status: 'ready', data: anthology },
    bankRes: { status: 'ready', data: bank },
    pingshuiRes: { status: 'ready', data: pingshui },
    ciRes: { status: 'error', error: { status: 500 } },
    ciBankRes: { status: 'error', error: { status: 404 } },
    reloadAnthology: async () => {},
    reloadBank: async () => {},
    reloadPingshui: async () => {},
    reloadCi: async () => {},
    reloadCiBank: async () => {},
    requestCiBank: () => {},
    showToast() {},
    libraryFocus: null,
    settings: debug.normalizeSettings({}),
  }
  let tree = renderFresh(react, debug.LibraryTab, { api: errorApi })
  const ciChip = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).includes('宋词精选'))
  ciChip.props.onClick()
  tree = rerender(react, debug.LibraryTab, { api: errorApi })
  assert.match(textOf(tree), /宋词精选暂时不可用|重试/)
  // 切到全部宋词失败态，再切回精选仍能回退列表（ciRes 正常时）
  const selectedApi = Object.assign({}, errorApi, {
    ciRes: { status: 'ready', data: ciSelected },
    ciBankRes: { status: 'error', error: { status: 404 } },
  })
  let tree2 = renderFresh(react, debug.LibraryTab, { api: selectedApi })
  const ciChip2 = findButtonsByClass(tree2, 'dshp-fh-chip').find((chip) => textOf(chip).includes('宋词精选'))
  ciChip2.props.onClick()
  tree2 = rerender(react, debug.LibraryTab, { api: selectedApi })
  const fullEntry = findButtonsByClass(tree2, 'dshp-seg-btn').find((button) => textOf(button).includes('全部宋词'))
  assert.ok(fullEntry)
  fullEntry.props.onClick()
  tree2 = rerender(react, debug.LibraryTab, { api: selectedApi })
  assert.match(textOf(tree2), /全部宋词暂时不可用|重试/)
  const backSelected = findButtonsByClass(tree2, 'dshp-seg-btn').find((button) => textOf(button).includes('宋词精选'))
  assert.ok(backSelected)
  backSelected.props.onClick()
  tree2 = rerender(react, debug.LibraryTab, { api: selectedApi })
  assert.match(textOf(tree2), /共 2 首/)
})

test('飞花令完整句：先合句再入库，选项/图鉴/计数全用完整句', () => {
  const { react, debug } = loadClient()
  assertDeep(debug.completeSentencesFromLines(['白日依山尽，', '黄河入海流。']), ['白日依山尽，黄河入海流。'])
  assertDeep(debug.completeSentencesFromLines(['欲穷千里目，', '更上一层楼。', '空山。', '孤舟蓑笠翁，']), ['欲穷千里目，更上一层楼。'])
  assertDeep(debug.completeSentencesFromLines([]), [])

  const fixture = makeFeihuaFixture()
  const index = debug.buildFeihuaIndex(fixture.poems, fixture.ci)
  assert.ok(index.entries.length > 0)
  for (const entry of index.entries) {
    assert.match(entry.text, /[。！？]$/, '句库必须是完整句：' + entry.text)
    assert.ok(!/[，；、：]$/.test(entry.text), '不得以逗号/分号/顿号/冒号结尾：' + entry.text)
    assert.ok(!/…/.test(entry.text), '不得加省略号')
  }
  // 所有 entry 都来自「合句集合」
  const expected = new Set()
  for (const item of fixture.poems.items.concat(fixture.ci.items)) {
    for (const sentence of debug.completeSentencesFromLines(item.lines)) expected.add(sentence)
  }
  for (const entry of index.entries) assert.ok(expected.has(entry.text), '句不在合句集合中：' + entry.text)
  // 计数按完整句重算
  for (const char of debug.FEIHUA_CANDIDATE_CHARS) {
    assert.equal(index.counts[char], index.byChar[char].length, '令字计数须与完整句集合一致：' + char)
  }

  // 系统出句 / 自由输入校验都基于完整句
  const state = debug.feihuaStart(index, '花', () => 0.2)
  assert.match(state.system.text, /[。！？]$/)
  assert.equal(debug.feihuaLookup(index, debug.feihuaPlainOf(state.system.text)).entry.text, state.system.text)
  const candidate = index.byChar['花'].find((entry) => entry !== state.system)
  const submitted = debug.feihuaSubmit(state, index, candidate.text)
  assert.match(submitted.feedback.text, /接上了/)
  assert.ok(submitted.feedback.text.includes(candidate.source))

  // 图鉴：完整显示，无逗号截断、无省略号
  const api = {
    poemsRes: { status: 'ready', data: fixture.poems },
    ciRes: { status: 'ready', data: fixture.ci },
    feihuaIndex: index,
    poem: fixture.poems.items[0],
    reloadPoems: async () => {},
    reloadCi: async () => {},
    reloadKnowledge: async () => {},
    reloadYun: async () => {},
    reloadCiBank: async () => {},
    feihuaLaunch: 0,
  }
  let tree = renderFresh(react, debug.FeihuaTab, { api })
  findButtonsByClass(tree, 'dshp-seg-btn').find((button) => textOf(button) === '图鉴').props.onClick()
  tree = rerender(react, debug.FeihuaTab, { api })
  const lineTexts = findAll(tree, (node) => node.type === 'div'
    && typeof node.props.className === 'string'
    && node.props.className === 'dshp-fh-line-text')
  assert.ok(lineTexts.length > 0, '图鉴应有完整句')
  for (const node of lineTexts) {
    const value = textOf(node)
    assert.match(value, /[。！？]$/, '图鉴不得显示半句：' + value)
    assert.ok(!value.includes('…'), '图鉴不得加省略号')
    assert.ok(index.entries.some((entry) => entry.text === value), '图鉴须展示完整原句')
  }
})

test('真实数据完整句：登鹳雀楼半句合为完整句，基础/全库句库均无半句', {
  skip: HAS_REAL_DATA ? false : 'data/ 产物尚未就绪',
}, () => {
  const readJson = (name) => JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'))
  const poems = readJson('poems.json')
  const ci = readJson('ci.json')
  const { debug } = loadClient()

  const poem = poems.items.find((item) => item && item.title === '登鹳雀楼')
  assert.ok(poem, '真实数据应含登鹳雀楼')
  assertDeep(debug.completeSentencesFromLines(poem.lines), ['白日依山尽，黄河入海流。', '欲穷千里目，更上一层楼。'])

  const base = debug.buildFeihuaIndex(poems, ci)
  assert.ok(base.entries.some((entry) => entry.text === '白日依山尽，黄河入海流。'), '真实半句应合为完整句')
  assert.ok(base.entries.length > 3000, '基础完整句句库应 3000+，实际 ' + base.entries.length)
  assert.equal(base.entries.filter((entry) => !/[。！？]$/.test(entry.text)).length, 0, '基础句库不得有半句')
  assert.equal(base.entries.filter((entry) => /[，；、：]$/.test(entry.text)).length, 0)
  assert.ok(base.counts['花'] >= 250, '完整句口径花计数下限，实际 ' + base.counts['花'])
  for (const char of debug.FEIHUA_CANDIDATE_CHARS) assert.equal(base.counts[char], base.byChar[char].length)

  const bankFile = path.join(ROOT, 'assets', 'data', 'poems-bank.json')
  if (existsSync(bankFile)) {
    const bank = JSON.parse(readFileSync(bankFile, 'utf8'))
    const withBank = debug.buildFeihuaIndex(poems, ci, null, bank)
    assert.ok(withBank.entries.length > 15000, '含全唐诗库完整句应 1.5 万+，实际 ' + withBank.entries.length)
    assert.equal(withBank.entries.filter((entry) => !/[。！？]$/.test(entry.text)).length, 0, '全库句库不得有半句')
    assert.ok(withBank.entries.some((entry) => entry.text === '白日依山尽，黄河入海流。'))
  }
})

test('自言自语 murmur 池：≥100 条、6–40 字、无重复、tag 合法、不发半句', () => {
  const { debug } = loadClient()
  const allowedTags = ['greeting', 'night', 'rain', 'snow', 'sunny', 'hot', 'cold', 'hungry', 'tired', 'busy', 'idle', 'lonely', 'happy', 'poem-love', 'work', 'food', 'weather', 'time', 'self-talk', 'encourage']
  assert.ok(debug.MURMUR_POOL.length >= 100, 'murmur 文案池应 ≥100 条，实际 ' + debug.MURMUR_POOL.length)
  assert.ok(debug.MURMUR_TEMPLATES.length >= 5)
  const texts = new Set()
  for (const entry of debug.MURMUR_POOL) {
    assert.equal(typeof entry.text, 'string')
    const length = Array.from(entry.text).length
    assert.ok(length >= 6 && length <= 40, 'murmur 长度应 6–40 字：' + entry.text + '（' + length + '）')
    assert.match(entry.text, /[。！？]$/, 'murmur 必须是完整的一句话：' + entry.text)
    assert.ok(!texts.has(entry.text), 'murmur 不可重复：' + entry.text)
    texts.add(entry.text)
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0)
    for (const tag of entry.tags) assert.ok(allowedTags.indexOf(tag) >= 0, '非法 tag：' + tag)
  }
  const now = shanghaiTs(2026, 10, 21, 22, 30)
  const candidates = debug.buildMurmurCandidates({
    now,
    moodKey: 'tired',
    weather: { category: 'rain', label: '小雨', isDay: true },
    stats: { toolCalls: 12, userMessages: 3, activeMs: 25 * 60 * 1000 },
  })
  assert.ok(candidates.length >= debug.MURMUR_POOL.length, '应包含静态池 + 满足条件的模板')
  for (const candidate of candidates) {
    const length = Array.from(candidate.text).length
    assert.ok(length >= 6 && length <= 40)
    assert.match(candidate.text, /[。！？]$/)
  }
  const templateIds = candidates.filter((candidate) => candidate.id.indexOf('tpl-') === 0)
  assert.ok(templateIds.length >= 3, '状态模板应参与候选')
  assert.ok(candidates.some((candidate) => candidate.text.includes('12 次工具')), '模板可用聚合数字且不读消息内容')
})

test('自言自语 murmur 选择：tag 匹配、3 天去重、避免连续同 tag', () => {
  const { debug } = loadClient()
  const now = shanghaiTs(2026, 10, 21, 23, 30)
  const options = {
    moodKey: 'tired',
    weather: { category: 'rain', label: '小雨', isDay: true },
    stats: { toolCalls: 9, userMessages: 4, activeMs: 20 * 60 * 1000 },
    now,
    seenEntries: [],
    random: () => 0,
  }
  const first = debug.pickMurmur(options)
  assert.ok(first)
  assert.equal(first.type, 'murmur')
  assert.equal(first.line, first.text)
  assert.match(first.text, /[。！？]$/)
  assert.ok(debug.MURMUR_TITLES.includes(first.title))
  const context = debug.buildMurmurContext(options)
  const preferred = debug.murmurTagsForContext(context, 'tired')
  assert.ok(first.tags.some((tag) => preferred.indexOf(tag) >= 0), 'tag 应匹配心情/天气/时段')
  assert.ok(preferred.includes('tired') && preferred.includes('rain') && preferred.includes('night'))

  const recent = debug.pickMurmur(Object.assign({}, options, { seenEntries: [{ id: first.id, at: now - 24 * 3600 * 1000 }] }))
  assert.notEqual(recent.id, first.id, '3 天内同句不重复')
  const stale = debug.pickMurmur(Object.assign({}, options, { seenEntries: [{ id: first.id, at: now - 4 * 24 * 3600 * 1000 }] }))
  assert.equal(stale.id, first.id, '3 天以前的句子可再次出现')

  const avoid = debug.pickMurmur(Object.assign({}, options, { lastTag: first.tags[0] }))
  assert.ok(avoid.tags.indexOf(first.tags[0]) < 0 || avoid.id !== first.id, '避免连续同 tag')
})

test('自言自语只有 murmur：不再调度 poem/hybrid，请求 kind 固定 murmur', () => {
  const { debug } = loadClient()
  assert.equal(debug.selfTalkKindFor('poem'), 'murmur')
  assert.equal(debug.selfTalkKindFor('hybrid'), 'murmur')
  assert.equal(debug.selfTalkKindFor(), 'murmur')
  const query = debug.selfTalkQuery({ kind: 'intro', moodKey: 'tired', recent: ['一'] })
  const params = new URLSearchParams(query.slice(query.indexOf('?') + 1))
  assert.equal(params.get('kind'), 'murmur', 'self-talk 只允许 kind=murmur')
  assert.ok(!query.includes('intro'))
  // 本地兜底池仍是随想：每条都是完整一句话，且不是带出处的诗句
  for (const entry of debug.MURMUR_POOL) {
    assert.match(entry.text, /[。！？]$/)
    assert.ok(!entry.text.includes('《') && !entry.text.includes('——'))
  }
})
test('self-talk 请求参数：kind/mood/weather/idleMinutes/recent≤5，不含会话内容', () => {
  const { debug } = loadClient()
  const query = debug.selfTalkQuery({
    kind: 'intro',
    moodKey: 'tired',
    weather: 'rain',
    idleMinutes: 42,
    recent: ['一', '二', '三', '四', '五', '六'],
  })
  assert.ok(query.indexOf('self-talk.json?') === 0)
  const params = new URLSearchParams(query.slice(query.indexOf('?') + 1))
  assert.equal(params.get('kind'), 'murmur', 'kind 固定 murmur')
  assert.equal(params.get('mood'), 'tired')
  assert.equal(params.get('weather'), 'rain')
  assert.equal(params.get('idleMinutes'), '42')
  const recent = params.get('recent').split('|')
  assert.equal(recent.length, 5, 'recent 最多 5 条')
  assertDeep(recent, ['二', '三', '四', '五', '六'])

  const encoded = debug.selfTalkQuery({ kind: 'murmur', recent: ['你好 & 再见，今天好吗？'] })
  assert.ok(encoded.includes('recent=' + encodeURIComponent('你好 & 再见，今天好吗？')))
  assert.ok(!encoded.includes('你好 & 再见，今天好吗？'), 'raw 文本必须 URI 编码')

  const keys = Array.from(params.keys())
  assertDeep(keys.sort(), ['idleMinutes', 'kind', 'mood', 'recent', 'weather'], '只允许聚合上下文参数')

  assertDeep(debug.parseSelfTalkResponse({ ok: true, lines: [{ text: '今天也辛苦啦。' }, { text: '早点休息。' }] }), { ok: true, line: '今天也辛苦啦。', next: '早点休息。' })
  assert.equal(debug.parseSelfTalkResponse({ ok: true, lines: ['一句。'] }).line, '一句。')
  assert.equal(debug.parseSelfTalkResponse({ ok: false }).ok, false)
  assert.equal(debug.parseSelfTalkResponse({ ok: true, lines: [] }).ok, false)
  assert.equal(debug.parseSelfTalkResponse({ ok: true, lines: [{ text: '   ' }] }).ok, false)
  assert.equal(debug.parseSelfTalkResponse(null).ok, false)
  assert.equal(debug.SELF_TALK_TIMEOUT_MS, 8000)
})

test('self-talk 请求：成功/404/401/ok:false/网络失败/超时全部静默降级', async () => {
  const success = loadClient({
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, lines: [{ text: '模型说。' }, { text: '第二句。' }] }) }),
  })
  const okResult = await success.debug.requestSelfTalk({ kind: 'murmur', moodKey: 'calm' })
  assert.equal(okResult.ok, true)
  assert.equal(okResult.line, '模型说。')
  assert.equal(okResult.next, '第二句。')
  assert.ok(success.debug.requestSelfTalk.length >= 0)

  for (const status of [404, 401, 500]) {
    const client = loadClient({ fetch: async () => ({ ok: false, status, json: async () => ({}) }) })
    const result = await client.debug.requestSelfTalk({ kind: 'intro' })
    assert.equal(result.ok, false, 'HTTP ' + status + ' 应静默失败')
  }
  const okFalse = loadClient({ fetch: async () => ({ ok: true, json: async () => ({ ok: false, error: { code: 'SELF_TALK_UNAVAILABLE' } }) }) })
  assert.equal((await okFalse.debug.requestSelfTalk({})).ok, false)
  const network = loadClient({ fetch: async () => { throw new Error('network') } })
  assert.equal((await network.debug.requestSelfTalk({})).ok, false)

  // 8s 超时：替换沙箱 setTimeout，只触发 8s 定时器
  const timeoutClient = loadClient({ fetch: () => new Promise(() => {}) })
  const timers = []
  timeoutClient.context.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 1 }
  timeoutClient.context.clearTimeout = () => {}
  const pending = timeoutClient.debug.requestSelfTalk({ kind: 'murmur' })
  const timeoutTimer = timers.find((entry) => entry.ms === 8000)
  assert.ok(timeoutTimer, '应注册 8s 超时（实际 ' + JSON.stringify(timers.map((entry) => entry.ms)) + '）')
  timeoutTimer.fn()
  const timedOut = await pending
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.reason, 'timeout')
})

test('自言自语模型集成：占位→模型 murmur、缓存、再说一句、force 忽略、失败回退无诗句', async () => {
  const dataVersion = 'test.selftalk.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: true, weatherCity: '北京' }
  const poems = [{ id: 'st-1', title: '鹿柴', author: '王维', lines: ['空山不见人，', '但闻人语响。'], tones: ['平平仄仄平，', '仄平平仄仄。'] }]
  const bootstrap = {
    ok: true,
    version: '0.1.0',
    dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-21', poemId: 'st-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'rain', label: '小雨', tempC: 18, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-21', stats: { userMessages: 2, toolCalls: 30 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  let selfTalkCalls = []
  let selfTalkMode = 'deferred'
  let resolveDeferred = null
  const modelResponse = (lines) => ({ ok: true, json: async () => ({ ok: true, lines: lines.map((text) => ({ text })), model: { provider: 'test', model: 'test' } }) })
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('self-talk.json') >= 0) {
      selfTalkCalls.push(raw)
      if (selfTalkMode === '404') return { ok: false, status: 404, json: async () => ({}) }
      if (selfTalkMode === 'ok') return modelResponse(['外面下雨了，我先发会呆。', '第二句随想，慢慢来。'])
      return new Promise((resolve) => {
        resolveDeferred = () => resolve(modelResponse(['模型第一句，今天也辛苦啦。', '模型第二句，早点休息。']))
      })
    }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 4; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    assert.ok(panelButton)
    panelButton.props.onClick()
    tree = renderMain()
    const settingsTab = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-tab')
      && textOf(node) === '设置')[0]
    assert.ok(settingsTab)
    settingsTab.props.onClick()
    tree = renderMain()
    const settingsElement = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.ok(settingsElement)
    const mainApi = settingsElement.props.api
    const findSpontCard = (currentTree) => findAll(currentTree, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont')[0]

    // 1) 预览：先占位「它正在想…」，只请求 kind=murmur
    mainApi.previewSpontaneousPoem()
    await sleep(10)
    tree = renderMain()
    let card = findSpontCard(tree)
    assert.ok(card, '应显示生成中占位卡')
    assert.match(textOf(card), /它正在想/)
    assert.equal(selfTalkCalls.length, 1)
    const firstUrl = selfTalkCalls[0]
    const query = new URLSearchParams(firstUrl.slice(firstUrl.indexOf('?') + 1))
    assert.equal(query.get('kind'), 'murmur')
    assert.ok(query.get('mood'))
    assert.equal(query.get('weather'), 'rain')
    assert.ok(Number(query.get('idleMinutes')) >= 0)
    const allowedKeys = ['kind', 'mood', 'weather', 'idleMinutes', 'recent']
    for (const key of Array.from(query.keys())) assert.ok(allowedKeys.includes(key), '请求不得包含额外/会话参数：' + key)

    resolveDeferred()
    await sleep(40)
    tree = renderMain()
    card = findSpontCard(tree)
    assert.ok(card)
    let cardText = textOf(card)
    assert.ok(cardText.includes('模型第一句，今天也辛苦啦。'), '占位应被模型 murmur 替换')
    assert.ok(!cardText.includes('它正在想'))
    assert.match(cardText, /它小声嘀咕：/, '标题固定嘀咕类')
    assert.ok(!cardText.includes('它想读一句'), '自言自语不念诗')
    assert.equal(findAll(card, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && (node.props.className === 'dshp-spont-source' || node.props.className === 'dshp-spont-prefix')).length, 0)

    // 2) 缓存第二句：再次预览复用，不重复请求
    mainApi.previewSpontaneousPoem()
    await sleep(10)
    tree = renderMain()
    card = findSpontCard(tree)
    assert.ok(textOf(card).includes('模型第二句，早点休息。'), '缓存第二句应立即复用')
    assert.equal(selfTalkCalls.length, 1, '缓存复用不应再请求模型')

    // 3) 再说一句：走新逻辑（必要时请求模型），仍是 murmur
    selfTalkMode = 'ok'
    const closePanelButton = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '关闭面板')[0]
    assert.ok(closePanelButton)
    closePanelButton.props.onClick()
    tree = renderMain()
    const collapseDot = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-dot-collapse'))[0]
    if (collapseDot) {
      collapseDot.props.onClick({ stopPropagation() {} })
      tree = renderMain()
    }
    card = findSpontCard(tree)
    assert.ok(card)
    const another = findAll(card, (node) => node.type === 'button' && textOf(node) === '再说一句')[0]
    assert.ok(another)
    another.props.onClick({ stopPropagation() {} })
    await sleep(40)
    tree = renderMain()
    card = findSpontCard(tree)
    assert.ok(card)
    cardText = textOf(card)
    assert.match(cardText, /它小声嘀咕：/)
    assert.ok(!cardText.includes('它想读一句'))

    // 4) 旧 forceType 被忽略：预览 poem/hybrid 仍只产生 murmur 且仍请求 kind=murmur
    mainApi.previewSpontaneousPoem('poem')
    await sleep(40)
    tree = renderMain()
    card = findSpontCard(tree)
    assert.ok(card)
    cardText = textOf(card)
    assert.match(cardText, /它小声嘀咕：/)
    assert.ok(!cardText.includes('它想读一句'))
    mainApi.previewSpontaneousPoem('hybrid')
    await sleep(40)
    tree = renderMain()
    card = findSpontCard(tree)
    assert.ok(card)
    assert.match(textOf(card), /它小声嘀咕：/)
    for (const url of selfTalkCalls) {
      const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))
      assert.equal(params.get('kind'), 'murmur', '所有 self-talk 请求都必须是 murmur')
    }

    // 5) 模型失败 → 静默回退本地随想池，不出现诗句/报错
    selfTalkMode = '404'
    mainApi.previewSpontaneousPoem('murmur')
    await sleep(40)
    tree = renderMain()
    card = findSpontCard(tree)
    assert.ok(card, '失败后仍应显示本地随想卡片')
    cardText = textOf(card)
    assert.ok(!cardText.includes('它正在想'))
    assert.ok(!cardText.includes('它想读一句'), '回退不得出现诗句卡片')
    assert.match(cardText, /它小声嘀咕：/)
    assert.ok(!textOf(tree).match(/失败|错误|不可用/), '失败不得弹错误提示')
    const fallbackTexts = debug.MURMUR_POOL.map((entry) => entry.text)
    assert.ok(fallbackTexts.some((text) => cardText.includes(text)), '应回退本地静态 murmur 池')
  } finally {
    react._cleanup()
  }
})
test('设置页显示「当前使用本地句子池」回退状态', () => {
  const { react, debug } = loadClient()
  const api = {
    settings: debug.normalizeSettings({ spontaneousPoem: true }),
    updateSettings() {},
    hideWidget() {},
    resetSettings() {},
    selfTalkFallback: true,
    moodStats: debug.normalizeMoodStats({}),
    moodView: null,
    weatherRes: { status: 'idle' },
    weatherData: null,
    moodRes: { status: 'idle' },
    refreshWeather() {},
    refreshMoodNow() {},
    previewSpontaneousPoem() {},
    boot: { data: { version: '0.1.0' } },
  }
  const tree = renderFresh(react, debug.SettingsTab, { api })
  assert.match(textOf(tree), /随时随地可能说一句/)
  assert.match(textOf(tree), /当前使用本地句子池/)
})

test('自言自语不再念诗：本地诗句/hybrid 能力已移除，只保留随想池', () => {
  const { debug } = loadClient()
  assert.equal(typeof debug.pickSpontaneousPoem, 'undefined', '不应再暴露本地诗句选择器')
  assert.equal(typeof debug.pickSpontaneousCard, 'undefined', '不应再暴露 poem/hybrid 卡片选择器')
  assert.equal(typeof debug.chooseSpontType, 'undefined', '不应再暴露 poem/hybrid 类型调度')
  assert.equal(typeof debug.hybridPrefix, 'undefined')
  assert.equal(typeof debug.pickMurmur, 'function')
  assert.equal(debug.selfTalkKindFor('poem'), 'murmur')
  assert.equal(debug.selfTalkKindFor('hybrid'), 'murmur')
  const query = debug.selfTalkQuery({ kind: 'intro' })
  assert.match(query, /kind=murmur/)
  assert.ok(!query.includes('intro'))
  assert.ok(!query.includes('《'))
  for (const entry of debug.MURMUR_POOL) {
    assert.match(entry.text, /[。！？]$/)
    assert.ok(!entry.text.includes('《') && !entry.text.includes('——'), '本地随想池不得像诗句/带出处')
  }
})

/* ------------------------------------------------------------------ */
/* 14. M13：模型心情 + 92 张图鉴 + 面板探头图                            */
/* ------------------------------------------------------------------ */

function makeMoodCatalogFixture() {
  return {
    ok: true,
    version: 'test.mood.1',
    images: [
      { file: 'dsh-whale-home-peek.webp', label: '探头看你（今日面板）', scope: 'panel', tags: ['panel', 'home'] },
      { file: 'dsh-whale-settings-peek.webp', label: '探头看你（设置面板）', scope: 'panel', tags: ['panel', 'settings'] },
      { file: 'dsh-whale-workbench-peek.webp', label: '探头看你（工作台）', scope: 'panel', tags: ['panel', 'workbench'] },
    ],
    panelImages: [
      { file: 'dsh-whale-home-peek.webp', label: '探头看你（今日面板）', tags: ['panel', 'home'] },
      { file: 'dsh-whale-settings-peek.webp', label: '探头看你（设置面板）', tags: ['panel', 'settings'] },
      { file: 'dsh-whale-workbench-peek.webp', label: '探头看你（工作台）', tags: ['panel', 'workbench'] },
    ],
    moodImages: [
      { file: 'dsh-whale-state-abstract.webp', label: '发呆出神', tags: ['idle', 'abstract'] },
      { file: 'dsh-whale-state-afk.webp', label: '暂时离开', tags: ['idle', 'away'] },
      { file: 'dsh-whale-state-rare-42.webp', label: '少见的第 42 张', tags: ['mood', 'rare'] },
    ],
  }
}

test('心情图鉴 helpers：92 张口径、任意 moodImages 可接受、3 张 panel 探头映射', () => {
  const { debug } = loadClient()
  const catalog = debug.normalizeMoodCatalog(makeMoodCatalogFixture())
  assert.ok(catalog)
  assertDeep(catalog.moodFiles, ['dsh-whale-state-abstract.webp', 'dsh-whale-state-afk.webp', 'dsh-whale-state-rare-42.webp'])
  assert.equal(debug.panelPeekFile(catalog, 'today'), 'dsh-whale-home-peek.webp')
  assert.equal(debug.panelPeekFile(catalog, 'settings'), 'dsh-whale-settings-peek.webp')
  assert.equal(debug.panelPeekFile(catalog, 'library'), 'dsh-whale-workbench-peek.webp')
  assert.equal(debug.panelPeekFile(catalog, 'ci'), 'dsh-whale-workbench-peek.webp')
  assert.equal(debug.panelPeekFile(null, 'today'), 'dsh-whale-home-peek.webp')
  assert.equal(debug.moodCatalogAllows(catalog, 'dsh-whale-state-rare-42.webp'), true, '模型选中任意 moodImages 都接受')
  assert.equal(debug.moodCatalogAllows(catalog, 'dsh-whale-home-peek.webp'), false, 'panel 图不能当心情图')
  assert.equal(debug.moodCatalogAllows(catalog, 'unknown.webp'), false)
  assert.equal(debug.normalizeMoodCatalog({ ok: true, moodImages: [] }), null)
  assert.equal(debug.normalizeMoodCatalog(null), null)
})

test('mood-ai 请求参数：force/mood/weather/idleMinutes/recent≤3/recentImages≤20（去重），不含会话内容', () => {
  const { debug } = loadClient()
  const query = debug.moodAiQuery({
    force: true,
    moodKey: 'tired',
    weather: 'rain',
    idleMinutes: 23,
    recent: ['一', '二', '三', '四'],
    recentImages: Array.from({ length: 25 }, (_, index) => 'img' + index + '.webp').concat(['img24.webp', 'img0.webp']),
  })
  assert.ok(query.indexOf('mood-ai.json?') === 0)
  const params = new URLSearchParams(query.slice(query.indexOf('?') + 1))
  assert.equal(params.get('force'), '1')
  assert.equal(params.get('mood'), 'tired')
  assert.equal(params.get('weather'), 'rain')
  assert.equal(params.get('idleMinutes'), '23')
  assert.equal(params.get('recent').split('|').length, 3)
  assertDeep(params.get('recentImages').split('|'), Array.from({ length: 20 }, (_, index) => 'img' + (index + 5) + '.webp'))
  const names = Array.from(params.keys()).sort()
  assertDeep(names, ['force', 'idleMinutes', 'mood', 'recent', 'recentImages', 'weather'], '只允许聚合上下文参数')
  const noForce = debug.moodAiQuery({ moodKey: 'calm' })
  assert.ok(!noForce.includes('force='))

  const catalog = debug.normalizeMoodCatalog(makeMoodCatalogFixture())
  const parsed = debug.parseMoodAiResponse({ ok: true, mood: { label: '发呆出神', image: 'dsh-whale-state-abstract.webp', reason: '想发会儿呆' } }, catalog)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.mood.label, '发呆出神')
  assert.equal(parsed.mood.image, 'dsh-whale-state-abstract.webp')
  assert.equal(parsed.mood.reason, '想发会儿呆')
  assert.equal(parsed.mood.source, 'model')
  assert.equal(debug.parseMoodAiResponse({ ok: true, mood: { label: 'x', image: 'unknown.webp', reason: '' } }, catalog).ok, false, '未知图必须拒绝')
  assert.equal(debug.parseMoodAiResponse({ ok: true, mood: { label: 'x', image: 'dsh-whale-home-peek.webp', reason: '' } }, catalog).ok, false, 'panel 图不能当心情图')
  assert.equal(debug.parseMoodAiResponse({ ok: false }, catalog).ok, false)
  assert.equal(debug.parseMoodAiResponse({ ok: true, mood: null }, catalog).ok, false)
})

test('实时心情：2–4s 防抖、无 15min/10min 定时常量、时段/饭点桶', () => {
  const { debug } = loadClient()
  assert.equal(debug.MOOD_AI_DEBOUNCE_MIN_MS, 2000)
  assert.equal(debug.MOOD_AI_DEBOUNCE_MAX_MS, 4000)
  const low = debug.nextMoodAiDebounceDelay(() => 0)
  const high = debug.nextMoodAiDebounceDelay(() => 0.999999)
  assert.equal(low, 2000)
  assert.ok(high <= 4000 && high >= 3900)
  for (const name of ['MOOD_AI_REFRESH_MS', 'MOOD_AI_MIN_INTERVAL_MS', 'canRequestMoodAi']) {
    assert.equal(typeof debug[name], 'undefined', '定时/分钟限频应删除：' + name)
  }
  const morning = debug.moodTimeBucket(shanghaiTs(2026, 10, 21, 8, 0))
  const noon = debug.moodTimeBucket(shanghaiTs(2026, 10, 21, 12, 0))
  const night = debug.moodTimeBucket(shanghaiTs(2026, 10, 21, 23, 0))
  assert.match(morning, /morning\|meal/)
  assert.match(noon, /noon\|meal/)
  assert.match(night, /night\|offmeal/)
  assert.notEqual(morning, noon, '时段/饭点切换应可触发事件')
  const base = debug.moodAiSnapshot({ userMessages: 2, toolCalls: 10, toolErrors: 0 }, { category: 'clear' }, 0, 0)
  assert.equal(base.userMessages, 2)
})
test('mood-ai 请求：成功/未知图/404/401/ok:false/非法 JSON/超时全部静默回退', async () => {
  const catalog = makeMoodCatalogFixture()
  const normalized = (loadClient().debug.normalizeMoodCatalog(catalog))
  const success = loadClient({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, mood: { label: '发呆出神', image: 'dsh-whale-state-abstract.webp', reason: '想发会儿呆' } }) }) })
  const okResult = await success.debug.requestMoodAi({ catalog: normalized, moodKey: 'calm' })
  assert.equal(okResult.ok, true)
  assert.equal(okResult.mood.image, 'dsh-whale-state-abstract.webp')

  const unknown = loadClient({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, mood: { label: 'x', image: 'unknown.webp', reason: 'x' } }) }) })
  assert.equal((await unknown.debug.requestMoodAi({ catalog: normalized })).ok, false, '未知图片静默失败')

  for (const status of [404, 401, 500]) {
    const client = loadClient({ fetch: async () => ({ ok: false, status, json: async () => ({}) }) })
    assert.equal((await client.debug.requestMoodAi({ catalog: normalized })).ok, false)
  }
  const okFalse = loadClient({ fetch: async () => ({ ok: true, json: async () => ({ ok: false, error: { code: 'MOOD_AI_UNAVAILABLE' } }) }) })
  assert.equal((await okFalse.debug.requestMoodAi({ catalog: normalized })).ok, false)
  const badJson = loadClient({ fetch: async () => ({ ok: true, json: async () => { throw new Error('bad') } }) })
  assert.equal((await badJson.debug.requestMoodAi({ catalog: normalized })).ok, false)
  const network = loadClient({ fetch: async () => { throw new Error('network') } })
  assert.equal((await network.debug.requestMoodAi({ catalog: normalized })).ok, false)

  const timeoutClient = loadClient({ fetch: () => new Promise(() => {}) })
  const timers = []
  timeoutClient.context.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 1 }
  timeoutClient.context.clearTimeout = () => {}
  const pending = timeoutClient.debug.requestMoodAi({ catalog: normalized })
  const timer = timers.find((entry) => entry.ms === 25000)
  assert.ok(timer, '应有 25s 超时（宿主 20s + 余量）')
  timer.fn()
  assert.equal((await pending).ok, false)
})

test('模型心情集成：图鉴懒加载→mood-ai 任意图生效、chip label/reason/来源、面板 3 探头图、force 与未知图回退', async () => {
  const dataVersion = 'test.moodai.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'ma-1', title: '鹿柴', author: '王维', lines: ['空山不见人，', '但闻人语响。'], tones: ['平平仄仄平，', '仄平平仄仄。'] }]
  const bootstrap = {
    ok: true,
    version: '0.1.0',
    dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-21', poemId: 'ma-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'rain', label: '小雨', tempC: 18, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-21', stats: { userMessages: 2, toolCalls: 30 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  const catalog = makeMoodCatalogFixture()
  let moodAiCalls = []
  let moodAiMode = 'model'
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('mood-ai.json') >= 0) {
      moodAiCalls.push(raw)
      if (moodAiMode === 'unknown') return { ok: true, json: async () => ({ ok: true, mood: { label: '假心情', image: 'unknown.webp', reason: '不该用' } }) }
      if (moodAiMode === '404') return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, json: async () => ({ ok: true, mood: { label: '发呆出神', image: 'dsh-whale-state-abstract.webp', reason: '想发会儿呆' }, model: { provider: 'test', model: 'test' } }) }
    }
    if (raw.indexOf('assets') >= 0 && raw.indexOf('mood-catalog') >= 0) {
      return { ok: true, json: async () => catalog }
    }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 10; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    await sleep(4300) // 实时心情 2–4s 防抖
    tree = renderMain()
    assert.ok(moodAiCalls.length >= 1, '图鉴加载后应请求 mood-ai')
    const firstUrl = moodAiCalls[0]
    const params = new URLSearchParams(firstUrl.slice(firstUrl.indexOf('?') + 1))
    const allowedKeys = ['force', 'mood', 'weather', 'idleMinutes', 'recent', 'recentImages']
    for (const key of Array.from(params.keys())) assert.ok(allowedKeys.includes(key), 'mood-ai 请求不得带额外/会话参数：' + key)
    assert.equal(params.get('weather'), 'rain')

    let mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(String(mascot.props.src).includes('dsh-whale-state-abstract.webp'), '模型返回的任意图应直接用于立绘，实际：' + mascot.props.src)

    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const bubbleText = textOf(findBubble(tree))
    assert.match(bubbleText, /心情：发呆出神/)
    const chip = findAll(tree, (node) => node.type === 'span'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-mood-chip'))[0]
    assert.ok(chip)
    assert.match(String(chip.props.title || ''), /想发会儿呆/, '心情 chip 应带 reason')

    // 面板探头图：今日→home、设置→settings、其他→workbench；关闭恢复模型心情图
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    assert.ok(panelButton)
    panelButton.props.onClick()
    tree = renderMain()
    mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(String(mascot.props.src).includes('dsh-whale-home-peek.webp'), '今日面板应显示 home-peek，实际 ' + mascot.props.src)
    const settingsTab = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-tab')
      && textOf(node) === '设置')[0]
    assert.ok(settingsTab)
    settingsTab.props.onClick()
    tree = renderMain()
    mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(String(mascot.props.src).includes('dsh-whale-settings-peek.webp'), '设置面板应显示 settings-peek，实际 ' + mascot.props.src)
    const classTab = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-tab')
      && textOf(node) === '课堂')[0]
    classTab.props.onClick()
    tree = renderMain()
    mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(String(mascot.props.src).includes('dsh-whale-workbench-peek.webp'), '其他 tab 应显示 workbench-peek，实际 ' + mascot.props.src)

    // 设置显示 label/reason/来源（模型）
    const settingsTabAgain = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-tab')
      && textOf(node) === '设置')[0]
    settingsTabAgain.props.onClick()
    tree = renderMain()
    const settingsElement = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.ok(settingsElement)
    assert.equal(settingsElement.props.api.moodSource, 'model')
    assert.equal(settingsElement.props.api.moodView.label, '发呆出神')
    assert.match(settingsElement.props.api.moodView.reason, /想发会儿呆/)

    // force=1 刷新：未知图片 → 回退启发式、设置提示本地面部表情
    moodAiMode = 'unknown'
    const mainApi = settingsElement.props.api
    await mainApi.refreshMoodNow()
    await sleep(50)
    tree = renderMain()
    const forceCall = moodAiCalls[moodAiCalls.length - 1]
    assert.match(forceCall, /[?&]force=1(&|$)/, '刷新心情应带 force=1')
    const forceParams = new URLSearchParams(forceCall.slice(forceCall.indexOf('?') + 1))
    assert.equal(forceParams.get('force'), '1')
    const recentImages = forceParams.get('recentImages') || ''
    assert.ok(recentImages.includes('dsh-whale-state-abstract.webp'), '应把最近用过的图片传给 mood-ai：' + recentImages)
    mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(!String(mascot.props.src).includes('unknown.webp'), '未知图片不能用于立绘')
    const closePanelButton = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '关闭面板')[0]
    assert.ok(closePanelButton)
    closePanelButton.props.onClick()
    tree = renderMain()
    const settingsAfter = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')
    // 面板关闭后重新打开设置以读回退状态
    const stage2 = findStage(tree)
    if (stage2) {
      stage2.props.onPointerDown(pointerEvent(1))
      stage2.props.onPointerUp(pointerEvent(1))
      tree = renderMain()
      const panelButton2 = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
      if (panelButton2) panelButton2.props.onClick()
      tree = renderMain()
      const settingsTab2 = findAll(tree, (node) => node.type === 'button'
        && typeof node.props.className === 'string'
        && node.props.className.includes('dshp-tab')
        && textOf(node) === '设置')[0]
      if (settingsTab2) settingsTab2.props.onClick()
      tree = renderMain()
    }
    const settingsEl = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.ok(settingsEl)
    assert.equal(settingsEl.props.api.moodAiFallback, false, '30min 内已有模型心情，失败时保留上一次')
    assert.equal(settingsEl.props.api.moodSource, 'model')
    assert.equal(settingsEl.props.api.moodAiStale, true)
    assert.equal(settingsEl.props.api.moodAiFailure, 'image')
  } finally {
    react._cleanup()
  }
})

const MOOD_CATALOG_FILE = path.join(ROOT, 'assets', 'data', 'mood-catalog.json')
const HAS_MOOD_CATALOG = existsSync(MOOD_CATALOG_FILE)

test('真实心情图鉴：89 张 mood + 3 张 panel 全部可用且文件存在', {
  skip: HAS_MOOD_CATALOG ? false : 'mood-catalog.json 尚未生成',
}, () => {
  const raw = JSON.parse(readFileSync(MOOD_CATALOG_FILE, 'utf8'))
  const { debug } = loadClient()
  const catalog = debug.normalizeMoodCatalog(raw)
  assert.ok(catalog)
  assert.equal(catalog.moodFiles.length, 89, '心情图应为 89 张')
  assert.equal(debug.panelPeekFile(catalog, 'today'), 'dsh-whale-home-peek.webp')
  assert.equal(debug.panelPeekFile(catalog, 'settings'), 'dsh-whale-settings-peek.webp')
  assert.equal(debug.panelPeekFile(catalog, 'library'), 'dsh-whale-workbench-peek.webp')
  for (const file of catalog.moodFiles) {
    assert.ok(existsSync(path.join(ROOT, 'assets', 'generated', file)), '缺少心情图：' + file)
    assert.equal(debug.moodCatalogAllows(catalog, file), true, '每张 mood 图都应被接受：' + file)
  }
  assert.equal(debug.moodCatalogAllows(catalog, 'dsh-whale-home-peek.webp'), false, 'panel 图不能作为心情图')
  const parsed = debug.parseMoodAiResponse({
    ok: true,
    mood: { label: '任意心情', image: catalog.moodFiles[88], reason: '模型选到的第 89 张' },
  }, catalog)
  assert.equal(parsed.ok, true, '模型选中的任意一张 mood 图都必须接受')
  assert.equal(parsed.mood.image, catalog.moodFiles[88])
})

test('mood-catalog 资产懒加载：URL 带 dataVersion、版本变化失效、失败不抛错', async () => {
  const { context, debug } = loadClient()
  const calls = []
  context.fetch = async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => makeMoodCatalogFixture() }
  }
  debug.setAssetDataVersion('test.mood.1')
  await debug.loadResource('moodCatalog')
  assert.ok(calls[0].includes('f=data/mood-catalog.json'))
  assert.ok(calls[0].includes('&v=test.mood.1'))
  await debug.loadResource('moodCatalog')
  assert.equal(calls.length, 1, '同版本命中模块缓存')
  debug.setAssetDataVersion('test.mood.2')
  await debug.loadResource('moodCatalog')
  assert.equal(calls.length, 2)
  assert.ok(calls[1].includes('&v=test.mood.2'))
  context.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
  debug.clearResourceCache('moodCatalog')
  await assert.rejects(() => debug.loadResource('moodCatalog'), (error) => error.status === 404)
})

test('设置心情展示：label + reason + 来源（模型/启发式）与本地回退状态', () => {
  const { react, debug } = loadClient()
  const baseApi = {
    settings: debug.normalizeSettings({}),
    updateSettings() {},
    hideWidget() {},
    resetSettings() {},
    moodStats: debug.normalizeMoodStats({}),
    moodView: { key: 'ai', label: '发呆出神', image: 'dsh-whale-state-abstract.webp', reason: '想发会儿呆', source: 'model' },
    moodSource: 'model',
    moodAiFallback: false,
    weatherRes: { status: 'idle' },
    weatherData: null,
    moodRes: { status: 'ready', at: 1 },
    refreshWeather() {},
    refreshMoodNow() {},
    previewSpontaneousPoem() {},
    boot: { data: { version: '0.1.0' } },
  }
  let text = textOf(renderFresh(react, debug.SettingsTab, { api: baseApi }))
  assert.match(text, /发呆出神/)
  assert.match(text, /想发会儿呆/)
  assert.match(text, /来源：模型/)
  const fallbackText = textOf(renderFresh(react, debug.SettingsTab, {
    api: Object.assign({}, baseApi, {
      moodSource: 'heuristic',
      moodAiFallback: true,
      moodView: { key: 'tired', label: '有点累', image: 'dsh-whale-state-work-sleep.webp', reason: '工具调用 128 次' },
    }),
  }))
  assert.match(fallbackText, /来源：启发式/)
  assert.match(fallbackText, /当前使用本地面部表情/)
})

test('模型心情图鉴加载失败：不请求 mood-ai、回退启发式心情且不报错', async () => {
  const dataVersion = 'test.moodfail.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'mf-1', title: '鹿柴', author: '王维', lines: ['空山不见人，', '但闻人语响。'], tones: ['平平仄仄平，', '仄平平仄仄。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-21', poemId: 'mf-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-21', stats: { userMessages: 2, toolCalls: 100 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  let moodAiCalls = 0
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('mood-ai.json') >= 0) {
      moodAiCalls += 1
      return { ok: true, json: async () => ({ ok: true, mood: { label: 'x', image: 'dsh-whale-state-abstract.webp', reason: 'x' } }) }
    }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: false, status: 404, json: async () => ({}) }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 8; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    assert.equal(moodAiCalls, 0, '图鉴不可用时不应请求 mood-ai')
    const mascot = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(mascot)
    assert.ok(String(mascot.props.src).includes('dsh-whale-state-work-sleep.webp'), '应回退启发式心情立绘（tired），实际 ' + mascot.props.src)
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    assert.match(textOf(tree), /心情：有点累/)
  } finally {
    react._cleanup()
  }
})

test('自言自语随时触发/一卡制/关闭后 3s 再检查（假定时器集成）', async () => {
  const dataVersion = 'test.anytime.1'
  const settings = { weatherPoem: false, mood: false, spontaneousPoem: true, weatherCity: '北京' }
  const bootstrap = {
    ok: true,
    version: '0.1.0',
    dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-21', poemId: null },
    counts: { poems: 0, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: [] },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: false, error: { code: 'WEATHER_UNAVAILABLE' } },
    'mood.json': { ok: true, date: '2026-10-21', stats: {}, updatedAt: 0 },
    'settings.json': { ok: true, settings },
  }
  let selfTalkCalls = 0
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('self-talk.json') >= 0) {
      selfTalkCalls += 1
      return { ok: true, json: async () => ({ ok: true, lines: [{ text: '随时想到一句，就说出来啦。' }] }) }
    }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, context, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  // 假定时器：不自动执行，只记录，由测试手动触发目标轮询
  const timers = []
  context.setTimeout = (fn, ms) => {
    const id = timers.length + 1
    timers.push({ id, fn, ms })
    return id
  }
  context.clearTimeout = () => {}
  const findTimer = (minMs, maxMs) => {
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      if (timers[i].ms >= minMs && timers[i].ms <= maxMs) return timers[i]
    }
    return null
  }
  const invoke = (entry) => {
    if (!entry) return false
    entry.fn()
    return true
  }
  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 5; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    // 初始就安排 20–40s 轮询（不再有 8–15min/5min 硬底）
    const initialPoll = findTimer(debug.SPONT_POLL_MIN_MS, debug.SPONT_POLL_MAX_MS)
    assert.ok(initialPoll, '应安排 20–40s 轮询，实际定时器：' + JSON.stringify(timers.map((item) => item.ms)))
    assert.equal(timers.some((item) => item.ms >= 8 * 60 * 1000 && item.ms <= 15 * 60 * 1000), false, '不应再有 8–15min 旧间隔')

    // 触发一次轮询：条件满足立即触发（不等待任何时间闸门）
    invoke(initialPoll)
    await sleep(30)
    tree = renderMain()
    let card = findAll(tree, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont')[0]
    assert.ok(card, '轮询到期应直接显示自言自语卡片')
    assert.equal(selfTalkCalls, 1)

    // 一卡制：有卡时再轮询不应请求新卡
    const pollWhileCard = findTimer(debug.SPONT_POLL_MIN_MS, debug.SPONT_POLL_MAX_MS)
    assert.ok(pollWhileCard)
    invoke(pollWhileCard)
    await sleep(20)
    tree = renderMain()
    assert.equal(selfTalkCalls, 1, '当前有卡时不得弹新卡/请求模型')
    const recheck = findTimer(debug.SPONT_CLOSE_RECHECK_MS, debug.SPONT_CLOSE_RECHECK_MS)
    assert.ok(recheck, '有卡时应安排关闭后 3s 再检查')

    // 关闭卡片 → 3s 后再检查（关闭后唤醒）
    card = findAll(tree, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont')[0]
    const closeButton = findAll(card, (node) => node.type === 'button' && textOf(node) === '关闭')[0]
    assert.ok(closeButton)
    closeButton.props.onClick({ stopPropagation() {} })
    tree = renderMain()
    assert.equal(findAll(tree, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont').length, 0)
    const afterClose = findTimer(debug.SPONT_CLOSE_RECHECK_MS, debug.SPONT_CLOSE_RECHECK_MS)
    assert.ok(afterClose, '关闭卡片后应安排 3s 再检查')
    invoke(afterClose)
    await sleep(30)
    tree = renderMain()
    card = findAll(tree, (node) => node.type === 'div'
      && typeof node.props.className === 'string'
      && node.props.className === 'dshp-spont')[0]
    assert.ok(card, '关闭 3s 后应能再次随时说一句')
    assert.equal(selfTalkCalls, 2, '关闭后应能再次请求模型，不受每日/时间限制')

    // 面板关闭事件唤醒：应在 2–5s 内安排一次尝试
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    assert.ok(panelButton)
    panelButton.props.onClick()
    tree = renderMain()
    const closePanelButton = findAll(tree, (node) => node.type === 'button' && node.props['aria-label'] === '关闭面板')[0]
    assert.ok(closePanelButton)
    closePanelButton.props.onClick()
    tree = renderMain()
    assert.ok(findTimer(debug.SPONT_EVENT_MIN_MS, debug.SPONT_EVENT_MAX_MS), '关闭面板后应安排 2–5s 事件唤醒')
  } finally {
    react._cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* 15. M17：飞花令全量校验句库懒加载 + 合并                              */
/* ------------------------------------------------------------------ */

function feihuaFullEntriesFixture() {
  return [
    ['花开满院春色好。', '全量诗人《全量集》'],
    ['花 开 满 院 春 色 好。', '重复标点《不应重复》'],
    ['花字第1句。', '本地已有《重复》'],
    ['月落乌啼霜满天。', '另一个令字《不应入花》'],
  ]
}

test('全量校验合并：只注册当前令字、补齐 lookup、去重、其他字不变', () => {
  const { debug } = loadClient()
  const fixture = makeFeihuaFixture()
  const index = debug.buildFeihuaIndex(fixture.poems, fixture.ci)
  const beforeHua = index.byChar['花'].length
  const beforeYue = index.byChar['月'].length
  const beforeCounts = Object.assign({}, index.counts)
  const added = debug.mergeFeihuaFullEntries(index, '花', feihuaFullEntriesFixture())
  assert.equal(added, 1, '本地已有/重复标点/别字句应被去重或过滤，只新增 1 句')
  assert.equal(index.byChar['花'].length, beforeHua + 1)
  assert.equal(index.byChar['月'].length, beforeYue, '不应把别的令字句注册到月')
  assert.equal(index.counts['月'], beforeCounts['月'])
  const fullEntry = index.byChar['花'].find((entry) => entry.text === '花开满院春色好。')
  assert.ok(fullEntry)
  assert.equal(fullEntry.source, '全量诗人《全量集》')
  const hit = debug.feihuaLookup(index, '花开满院春色好')
  assert.ok(hit)
  assert.equal(hit.entry.text, '花开满院春色好。')
  // 再次合并同 char 幂等
  assert.equal(debug.mergeFeihuaFullEntries(index, '花', feihuaFullEntriesFixture()), 0, '同字已合并应幂等')
  // 系统出句池可含全量句
  const texts = index.byChar['花'].map((entry) => entry.text)
  assert.ok(texts.includes('花开满院春色好。'))
})

test('feihua-full 请求：URL 编码、成功缓存、失败 60s 短缓存、abort、20s 超时、版本清理', async () => {
  const first = loadClient()
  const calls = []
  first.context.fetch = async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => ({ ok: true, char: '花', count: 2, entries: [['花落知多少。', '甲《一》'], ['花间一壶酒。', '乙《二》']] }) }
  }
  const result = await first.debug.requestFeihuaFull('花')
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes('feihua-full.json?char='))
  assert.ok(calls[0].includes(encodeURIComponent('花')), 'char 必须 URI 编码：' + calls[0])
  const cached = await first.debug.requestFeihuaFull('花')
  assert.equal(cached.cached, true)
  assert.equal(calls.length, 1, '同字应命中缓存')
  first.debug.setAssetDataVersion('test.full.2')
  assert.equal(first.debug.readFeihuaFullCache('花'), null, 'dataVersion 变化应清空缓存')

  const failing = loadClient()
  let failCalls = 0
  failing.context.fetch = async () => {
    failCalls += 1
    return { ok: false, status: 404, json: async () => ({}) }
  }
  const bad = await failing.debug.requestFeihuaFull('花')
  assert.equal(bad.ok, false)
  assert.equal(failCalls, 1)
  const badAgain = await failing.debug.requestFeihuaFull('花')
  assert.equal(badAgain.ok, false)
  assert.equal(badAgain.cached, true)
  assert.equal(failCalls, 1, '失败应短缓存 60s，避免频繁重试')
  failing.debug.clearFeihuaFullCache()
  assert.equal(failing.debug.readFeihuaFullCache('花'), null)

  // abort：切字时中止旧请求，且不写失败缓存
  const abortClient = loadClient()
  abortClient.context.fetch = () => new Promise(() => {})
  const pending = abortClient.debug.requestFeihuaFull('花')
  abortClient.debug.abortFeihuaFull('花')
  const aborted = await pending
  assert.equal(aborted.ok, false)
  assert.equal(aborted.reason, 'aborted')
  assert.equal(abortClient.debug.readFeihuaFullCache('花'), null, '主动中止不应写失败缓存')

  // 20s 超时：假定时器触发
  const timeoutClient = loadClient()
  timeoutClient.context.fetch = () => new Promise(() => {})
  const timers = []
  timeoutClient.context.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 1 }
  timeoutClient.context.clearTimeout = () => {}
  const timeoutPending = timeoutClient.debug.requestFeihuaFull('月')
  const timeoutTimer = timers.find((entry) => entry.ms === 20000)
  assert.ok(timeoutTimer, '应注册 20s 超时')
  timeoutTimer.fn()
  const timedOut = await timeoutPending
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.reason, 'timeout')
})

test('飞花 UI 全量校验：loading→启用、全量句可校验、切字加载新 char、同字缓存', async () => {
  const fixture = makeFeihuaFixture()
  const fullEntries = {
    '花': [['花 开 满 院 春 色 好。', '全量诗人《全量集》'], ['花字第1句。', '本地已有《重复》']],
    '月': [['月落乌啼霜满天。', '全量诗人《月集》'], ['月上柳梢头。', '全量诗人《月集二》']],
  }
  const calls = []
  let resolveHua = null
  let mode = 'normal'
  const fetchImpl = (url) => {
    const raw = String(url)
    calls.push(raw)
    const params = new URLSearchParams(raw.slice(raw.indexOf('?') + 1))
    const char = params.get('char')
    if (mode === 'deferred-hua' && char === '花') return new Promise((resolve) => { resolveHua = () => resolve({ ok: true, json: async () => ({ ok: true, char, count: 2, entries: fullEntries['花'] }) }) })
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, char, count: (fullEntries[char] || []).length, entries: fullEntries[char] || [] }) })
  }
  const { react, debug } = loadClient({ fetch: fetchImpl })
  const api = {
    poemsRes: { status: 'ready', data: fixture.poems },
    ciRes: { status: 'ready', data: fixture.ci },
    poem: { lines: ['花'] },
    reloadPoems: async () => {},
    reloadCi: async () => {},
    feihuaLaunch: 0,
  }
  try {
    // 初始 activeChar=花，先延迟旧请求以验证 loading/切字
    mode = 'deferred-hua'
    let tree = renderFresh(react, debug.FeihuaTab, { api })
    react._runEffects()
    await sleep(20)
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /正在加载全量校验句库/)
    assert.equal(calls.length, 1)
    assert.ok(calls[0].includes(encodeURIComponent('花')))

    // 切到「月」：应加载月，旧花请求被取消/忽略
    mode = 'normal'
    const yueChip = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).indexOf('月') === 0)
    assert.ok(yueChip)
    yueChip.props.onClick({ stopPropagation() {} })
    tree = rerender(react, debug.FeihuaTab, { api })
    react._runEffects()
    await sleep(20)
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /全量校验已启用（2 句）/, '应显示月字全量状态')
    assert.ok(calls.some((url) => url.includes(encodeURIComponent('月'))))
    const huaCallsBefore = calls.filter((url) => url.includes(encodeURIComponent('花'))).length
    if (resolveHua) resolveHua()
    await sleep(20)
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /「月」/, '旧花请求不应把当前字改回花')
    assert.ok(!textOf(tree).includes('全量校验已启用（2 句）') || textOf(tree).includes('「月」'))

    // 切回花：全新请求（之前被 abort，无缓存）
    const huaChip = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).indexOf('花') === 0)
    huaChip.props.onClick({ stopPropagation() {} })
    tree = rerender(react, debug.FeihuaTab, { api })
    react._runEffects()
    await sleep(20)
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /全量校验已启用（2 句）/)
    const huaCalls = calls.filter((url) => url.includes(encodeURIComponent('花'))).length
    assert.ok(huaCalls >= 1)

    // 再切回月：同字缓存，不应重复请求
    const yueChip2 = findButtonsByClass(tree, 'dshp-fh-chip').find((chip) => textOf(chip).indexOf('月') === 0)
    yueChip2.props.onClick({ stopPropagation() {} })
    tree = rerender(react, debug.FeihuaTab, { api })
    react._runEffects()
    await sleep(20)
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /全量校验已启用（2 句）/)
    assert.equal(calls.filter((url) => url.includes(encodeURIComponent('月'))).length, 1, '同字缓存不应重复请求')

    // 用全量句校验：本地没有的「月落乌啼霜满天」应能接上
    const startButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '来一局')[0]
    assert.ok(startButton)
    startButton.props.onClick({ stopPropagation() {} })
    tree = rerender(react, debug.FeihuaTab, { api })
    const input = findAll(tree, (node) => node.type === 'input' && node.props['aria-label'] === '输入飞花令对句')[0]
    const panelText = textOf(tree)
    const fullOnly = (fullEntries['月'] || []).find((entry) => !panelText.includes(entry[0]))
    assert.ok(fullOnly, '应有未被系统使用的全量句')
    input.props.onChange({ target: { value: fullOnly[0] } })
    tree = rerender(react, debug.FeihuaTab, { api })
    findAll(tree, (node) => node.type === 'button' && textOf(node) === '接一句')[0].props.onClick({ stopPropagation() {} })
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /接上了/)
    assert.ok(textOf(tree).includes(fullOnly[1]))
  } finally {
    react._cleanup()
  }
})

test('飞花 UI 全量校验失败：静默回退本地句库，状态「未启用」且本地仍可玩', async () => {
  const fixture = makeFeihuaFixture()
  const { react, debug } = loadClient({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) })
  const api = {
    poemsRes: { status: 'ready', data: fixture.poems },
    ciRes: { status: 'ready', data: fixture.ci },
    poem: { lines: ['花'] },
    reloadPoems: async () => {},
    reloadCi: async () => {},
    feihuaLaunch: 0,
  }
  try {
    let tree = renderFresh(react, debug.FeihuaTab, { api })
    react._runEffects()
    await sleep(30)
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /全量校验未启用（使用本地句库）/)
    const startButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '来一局')[0]
    assert.ok(startButton)
    startButton.props.onClick({ stopPropagation() {} })
    tree = rerender(react, debug.FeihuaTab, { api })
    assert.match(textOf(tree), /对方：/)
    assert.ok(!textOf(tree).includes('失败'), '失败不应弹错误文案')
  } finally {
    react._cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* 16. M18：dsh-pet webm 动画心情素材                                    */
/* ------------------------------------------------------------------ */

function makePetCatalogFixture() {
  return {
    ok: true,
    v: 1,
    source: 'PC2005-cloud/dsh-pet@MIT',
    entries: [
      { file: 'webm/吃白饭.webm', label: '吃白饭', media: 'video', scope: 'mood', tags: ['hungry', 'food'] },
      { file: 'webm/中秋赏月吃月饼.webm', label: '中秋赏月吃月饼', media: 'video', scope: 'mood', tags: ['festival', 'food'] },
      { file: 'webm/吃白饭.webm', label: '重复条目', media: 'video', scope: 'mood', tags: ['dup'] },
      { file: '../evil.webm', label: '非法路径', media: 'video', scope: 'mood', tags: [] },
      { file: 'webm/not-video.png', label: '非视频', media: 'video', scope: 'mood', tags: [] },
    ],
  }
}

test('pet-media 图鉴：normalize/merge 保留 92 张静态图、追加视频、去重/byFile 更新', () => {
  const { debug } = loadClient()
  const base = debug.normalizeMoodCatalog(makeMoodCatalogFixture())
  const videos = debug.normalizePetMediaCatalog(makePetCatalogFixture())
  assert.equal(videos.length, 2, '只接受 webm/ 下 .webm 且去重')
  assert.equal(videos[0].file, 'webm/吃白饭.webm')
  assert.equal(videos[0].media, 'video')
  const merged = debug.mergePetMediaIntoCatalog(base, videos)
  assert.equal(merged.moodImages.length, base.moodImages.length + 2, '保留原静态图并追加动画')
  assert.deepEqual(merged.moodFiles.slice(0, base.moodFiles.length), base.moodFiles)
  assert.ok(merged.moodFiles.includes('webm/吃白饭.webm'))
  assert.equal(merged.byFile['webm/吃白饭.webm'].media, 'video')
  assert.equal(merged.moodImages[merged.moodImages.length - 1].label, '中秋赏月吃月饼')
  const mergedAgain = debug.mergePetMediaIntoCatalog(merged, videos)
  assert.equal(mergedAgain.moodImages.length, merged.moodImages.length, '同一动画重复 merge 不重复追加')
  assert.equal(debug.moodCatalogAllows(merged, 'webm/吃白饭.webm'), true)
  assert.equal(debug.moodCatalogAllows(merged, 'webm/不存在.webm'), false)
  assert.equal(debug.isVideoMoodFile('webm/吃白饭.webm'), true)
  assert.equal(debug.isVideoMoodFile('dsh-whale-state-abstract.webp'), false)
  assert.ok(debug.petMediaUrl('webm/吃白饭.webm').includes('f=' + encodeURIComponent('webm/吃白饭.webm')))
})

test('pet-media catalog 请求：成功缓存、404/非法结构静默失败、9s 超时、dataVersion 清缓存', async () => {
  const calls = []
  const client = loadClient()
  client.context.fetch = async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => makePetCatalogFixture() }
  }
  const first = await client.debug.requestPetMediaCatalog()
  assert.equal(first.ok, true)
  assert.equal(first.entries.length, 2)
  assert.ok(calls[0].includes('pet-media?f='))
  assert.ok(calls[0].includes(encodeURIComponent('catalog.json')))
  const second = await client.debug.requestPetMediaCatalog()
  assert.equal(second.ok, true)
  assert.equal(calls.length, 1, 'catalog 同版本应缓存')
  client.debug.setAssetDataVersion('test.pet.2')
  const third = await client.debug.requestPetMediaCatalog()
  assert.equal(third.ok, true)
  assert.equal(calls.length, 2, 'dataVersion 变化应清空动画图鉴缓存并重新请求')

  for (const response of [
    { ok: false, status: 404, json: async () => ({}) },
    { ok: true, json: async () => ({ ok: false }) },
  ]) {
    const failing = loadClient({ fetch: async () => response })
    const failed = await failing.debug.requestPetMediaCatalog()
    assert.equal(failed.ok, false, 'HTTP/ok:false 应静默返回失败')
    assert.ok(Array.isArray(failed.entries))
  }
  const emptyClient = loadClient({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, entries: [] }) }) })
  const emptyResult = await emptyClient.debug.requestPetMediaCatalog()
  assert.equal(emptyResult.ok, true, '空素材清单应成功但 0 个动画')
  assert.equal(emptyResult.entries.length, 0)

  const timeoutClient = loadClient({ fetch: () => new Promise(() => {}) })
  const timers = []
  timeoutClient.context.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 1 }
  timeoutClient.context.clearTimeout = () => {}
  const pending = timeoutClient.debug.requestPetMediaCatalog()
  const timer = timers.find((entry) => entry.ms === 9000)
  assert.ok(timer, 'pet catalog 应注册 9s 超时')
  timer.fn()
  const timedOut = await pending
  assert.equal(timedOut.ok, false)
})

test('pet-media 视频立绘：mood-ai 返回 webm → <video> 属性/URL 编码、onError 回退静态图', async () => {
  const dataVersion = 'test.pet.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'pet-1', title: '鹿柴', author: '王维', lines: ['空山不见人。'], tones: ['平平仄仄平。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-23', poemId: 'pet-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-23', stats: { userMessages: 2, toolCalls: 30 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  const calls = []
  const fetchImpl = async (url) => {
    const raw = String(url)
    calls.push(raw)
    if (raw.indexOf('pet-media') >= 0) {
      if (raw.indexOf('catalog.json') >= 0) return { ok: true, json: async () => makePetCatalogFixture() }
      return { ok: true, json: async () => ({}) }
    }
    if (raw.indexOf('mood-ai.json') >= 0) {
      return { ok: true, json: async () => ({ ok: true, mood: { label: '吃白饭', image: 'webm/吃白饭.webm', reason: '饿了，干饭' } }) }
    }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: true, json: async () => makeMoodCatalogFixture() }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 10; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    await sleep(4300) // 实时心情 2–4s 防抖
    tree = renderMain()
    const video = findAll(tree, (node) => node.type === 'video')[0]
    assert.ok(video, '模型返回 webm 时应渲染 <video>')
    assert.equal(video.props.className, 'dshp-mascot-video dshp-mascot-swap')
    assert.equal(video.props.autoPlay, true)
    assert.equal(video.props.muted, true)
    assert.equal(video.props.loop, true)
    assert.equal(video.props.playsInline, true)
    assert.equal(video.props.preload, 'auto')
    assert.equal(video.props['aria-hidden'], 'true')
    assert.ok(String(video.props.src).includes('pet-media?f='))
    assert.ok(String(video.props.src).includes(encodeURIComponent('webm/吃白饭.webm')))
    assert.equal(findAll(tree, (node) => node.type === 'img').length, 0)
    assert.ok(calls.some((url) => url.indexOf('mood-ai.json') >= 0))
    // 心情 chip 照常显示 label/reason
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const bubbleText = textOf(findBubble(tree))
    assert.match(bubbleText, /心情：吃白饭/)
    const chip = findAll(tree, (node) => node.type === 'span'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-mood-chip'))[0]
    assert.ok(chip)
    assert.match(String(chip.props.title || ''), /饿了/)
    // onError 回退静态 celebrate（先等每日 greet/表情彩蛋 2.5s 结束）
    await sleep(2600)
    tree = renderMain()
    video.props.onError()
    tree = renderMain()
    const img = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(img)
    assert.ok(String(img.props.src).includes('dsh-whale-state-celebrate.webp'), '实际回退图：' + img.props.src)
  } finally {
    react._cleanup()
  }
})

test('pet-media 失败/旧宿主：mood-ai 返回 webm 时按未知图回退启发式，不报错', async () => {
  const dataVersion = 'test.petfail.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'pf-1', title: '鹿柴', author: '王维', lines: ['空山不见人。'], tones: ['平平仄仄平。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-23', poemId: 'pf-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-23', stats: { userMessages: 2, toolCalls: 100 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('pet-media') >= 0) return { ok: false, status: 404, json: async () => ({}) }
    if (raw.indexOf('mood-ai.json') >= 0) return { ok: true, json: async () => ({ ok: true, mood: { label: '不该用', image: 'webm/吃白饭.webm', reason: '未知动画' } }) }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: true, json: async () => makeMoodCatalogFixture() }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  try {
    const renderMain = () => {
      react._beginRender()
      return debug.PoetryWidget({})
    }
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 10; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    await sleep(50)
    tree = renderMain()
    assert.equal(findAll(tree, (node) => node.type === 'video').length, 0, '未知动画不可渲染')
    const img = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(img)
    assert.ok(String(img.props.src).includes('dsh-whale-state-work-sleep.webp'), '应回退启发式 tired 图片')
    assert.equal(debug.mascotVideoShouldPause({ hidden: true }), true)
    assert.equal(debug.mascotVideoShouldPause({ panelOpen: true }), true)
    assert.equal(debug.mascotVideoShouldPause({}), false)
  } finally {
    react._cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* 17. M19：心情 15min 刷新 + 小动作 webm 轮转                          */
/* ------------------------------------------------------------------ */

test('小动作：1.5–3.5min、20–30s、首次静态图 10–20s、轮转顺序覆盖全部 106 个、持久化、优先级', () => {
  const { debug, storage } = loadClient()
  assert.equal(typeof debug.MOOD_AI_REFRESH_MS, 'undefined', '定时刷新已删除')
  assert.equal(debug.MOOD_AI_RECENT_IMAGES_MAX, 20, 'recentImages 保留最近 20')
  assert.equal(debug.MOOD_AI_DEBOUNCE_MIN_MS, 2000)
  assert.equal(debug.MOOD_AI_DEBOUNCE_MAX_MS, 4000)
  assert.equal(debug.MOTION_MIN_DELAY_MS, 90 * 1000)
  assert.equal(debug.MOTION_MAX_DELAY_MS, 210 * 1000)
  assert.equal(debug.MOTION_PLAY_MIN_MS, 20 * 1000)
  assert.equal(debug.MOTION_PLAY_MAX_MS, 30 * 1000)
  assert.equal(debug.MOTION_FIRST_MIN_DELAY_MS, 10 * 1000)
  assert.equal(debug.MOTION_FIRST_MAX_DELAY_MS, 20 * 1000)
  const lowDelay = debug.nextMotionDelay(() => 0)
  const highDelay = debug.nextMotionDelay(() => 0.999999)
  assert.equal(lowDelay, 90 * 1000)
  assert.ok(highDelay <= 210 * 1000 && highDelay >= 209 * 1000)
  const lowPlay = debug.nextMotionDuration(() => 0)
  const highPlay = debug.nextMotionDuration(() => 0.999999)
  assert.equal(lowPlay, 20 * 1000)
  assert.ok(highPlay <= 30 * 1000 && highPlay >= 29 * 1000)
  assert.equal(debug.nextMotionFirstDelay(() => 0), 10 * 1000)
  assert.ok(debug.nextMotionFirstDelay(() => 0.999999) <= 20000 && debug.nextMotionFirstDelay(() => 0.999999) >= 19900)
  // 静态心情首次 10–20s；有视频心情/非首次按 90–210s
  assert.equal(debug.nextMotionScheduleDelay({ first: true, moodImage: 'dsh-whale-state-abstract.webp', random: () => 0 }), 10 * 1000)
  assert.equal(debug.nextMotionScheduleDelay({ first: true, moodImage: 'webm/吃白饭.webm', random: () => 0 }), 90 * 1000)
  assert.equal(debug.nextMotionScheduleDelay({ first: false, moodImage: 'dsh-whale-state-abstract.webp', random: () => 0 }), 90 * 1000)

  const entries = Array.from({ length: 106 }, (_, index) => ({ file: 'webm/动作' + index + '.webm' }))
  let index = 0
  const order = []
  for (let i = 0; i < entries.length; i += 1) {
    const picked = debug.nextMotionEntry(entries, index)
    assert.equal(picked.entry.file, 'webm/动作' + i + '.webm', '必须按轮转顺序，不随机')
    order.push(picked.entry.file)
    index = picked.index
  }
  assert.equal(new Set(order).size, 106, '一轮必须覆盖全部 106 个动作')
  assert.equal(index, 0, '一轮结束回到开头')
  const wrapped = debug.nextMotionEntry(entries, 105)
  assert.equal(wrapped.entry.file, 'webm/动作105.webm', '轮转位置 105 → 最后一个')
  assert.equal(wrapped.index, 0)

  // 轮转位置持久化：刷新后继续
  debug.writeMotionRotation(7)
  assert.equal(debug.readMotionRotation(), 7)
  assert.equal(storage.getItem(debug.MOTION_ROTATION_KEY), '7')
  debug.writeMotionRotation(0)
  storage.setItem(debug.MOTION_ROTATION_KEY, '{bad')
  assert.equal(debug.readMotionRotation(), 0, '损坏轮转记录安全降级')

  // 优先级 pulse > panel > expression > motion > mood
  assert.equal(debug.mascotFilePriority({ pulseFile: 'p', panelFile: 'pa', expressionFile: 'e', motionFile: 'm', moodFile: 'mo' }), 'p')
  assert.equal(debug.mascotFilePriority({ panelFile: 'pa', expressionFile: 'e', motionFile: 'm', moodFile: 'mo' }), 'pa')
  assert.equal(debug.mascotFilePriority({ expressionFile: 'e', motionFile: 'm', moodFile: 'mo' }), 'e')
  assert.equal(debug.mascotFilePriority({ motionFile: 'm', moodFile: 'mo' }), 'm')
  assert.equal(debug.mascotFilePriority({ moodFile: 'mo' }), 'mo')
})

test('小动作集成：静态图首次快速轮转 webm、20–30s 后回心情图、onError 跳过、面板暂停结束', async () => {
  const dataVersion = 'test.motion.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'mo-1', title: '鹿柴', author: '王维', lines: ['空山不见人。'], tones: ['平平仄仄平。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-23', poemId: 'mo-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-23', stats: { userMessages: 2, toolCalls: 30 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  const petCatalog = {
    ok: true,
    v: 1,
    entries: [
      { file: 'webm/动作0.webm', label: '动作0', media: 'video', scope: 'mood', tags: [] },
      { file: 'webm/动作1.webm', label: '动作1', media: 'video', scope: 'mood', tags: [] },
      { file: 'webm/动作2.webm', label: '动作2', media: 'video', scope: 'mood', tags: [] },
    ],
  }
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('pet-media') >= 0) {
      if (raw.indexOf('catalog.json') >= 0) return { ok: true, json: async () => petCatalog }
      return { ok: true, json: async () => ({}) }
    }
    if (raw.indexOf('mood-ai.json') >= 0) {
      return { ok: true, json: async () => ({ ok: true, mood: { label: '发呆出神', image: 'dsh-whale-state-abstract.webp', reason: '想发会儿呆' } }) }
    }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: true, json: async () => makeMoodCatalogFixture() }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, context, debug } = loadClient({
    seed: {
      [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }),
      'dshp-motion-rotation-v1': '1',
    },
    fetch: fetchImpl,
  })
  const timers = []
  context.setTimeout = (fn, ms) => {
    timers.push({ id: timers.length + 1, fn, ms })
    return timers.length
  }
  context.clearTimeout = () => {}
  const findTimer = (minMs, maxMs) => {
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      if (timers[i].ms >= minMs && timers[i].ms <= maxMs && !timers[i].used) return timers[i]
    }
    return null
  }
  const fire = (timer) => {
    assert.ok(timer)
    timer.used = true
    timer.fn()
  }
  const renderMain = () => {
    react._beginRender()
    return debug.PoetryWidget({})
  }
  const videoNode = (tree) => findAll(tree, (node) => node.type === 'video')[0]
  try {
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 8; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    await sleep(30)
    tree = renderMain()
    assert.equal(videoNode(tree), undefined, '小动作未到时间前应显示心情静态图')
    let delayTimer = findTimer(debug.MOTION_FIRST_MIN_DELAY_MS, debug.MOTION_FIRST_MAX_DELAY_MS - 1)
    assert.ok(delayTimer, '静态图首次应在 10–20s 排期：' + JSON.stringify(timers.map((item) => item.ms)))
    fire(delayTimer)
    tree = renderMain()
    let video = videoNode(tree)
    if (!video) {
      for (const candidate of timers.filter((item) => !item.used && item.ms >= debug.MOTION_FIRST_MIN_DELAY_MS && item.ms < debug.MOTION_FIRST_MAX_DELAY_MS)) {
        fire(candidate)
        tree = renderMain()
        video = videoNode(tree)
        if (video) break
      }
    }
    assert.ok(video, '到达间隔后应播放 pet webm 动作；timers=' + JSON.stringify(timers.map((item) => item.ms)))
    assert.ok(String(video.props.src).includes(encodeURIComponent('webm/动作1.webm')), '应按持久化轮转位置取下一个动作：' + video.props.src)
    assert.equal(video.props.className, 'dshp-mascot-video dshp-mascot-swap')
    assert.equal(video.props.autoPlay, true)
    let stopTimer = findTimer(debug.MOTION_PLAY_MIN_MS, debug.MOTION_PLAY_MAX_MS)
    assert.ok(stopTimer, '动作应有 20–30s 播放时长')
    fire(stopTimer)
    tree = renderMain()
    video = videoNode(tree)
    assert.equal(video, undefined, '播放结束后回心情图')
    let img = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(img, '动作结束应显示当前心情静态图')

    // 下一轮轮转 + onError 跳过动作
    delayTimer = findTimer(debug.MOTION_MIN_DELAY_MS, debug.MOTION_MAX_DELAY_MS)
    assert.ok(delayTimer)
    fire(delayTimer)
    tree = renderMain()
    video = videoNode(tree)
    assert.ok(video)
    assert.ok(String(video.props.src).includes(encodeURIComponent('webm/动作2.webm')))
    video.props.onError()
    tree = renderMain()
    assert.equal(videoNode(tree), undefined, 'onError 应跳过该动作并回心情图')
    img = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(img, 'onError 后应显示心情图')
    assert.ok(findTimer(debug.MOTION_MIN_DELAY_MS, debug.MOTION_MAX_DELAY_MS), '跳过动作后应继续安排下一次')

    // 面板打开结束动作（并显示静态 peek）
    delayTimer = findTimer(debug.MOTION_MIN_DELAY_MS, debug.MOTION_MAX_DELAY_MS)
    fire(delayTimer)
    tree = renderMain()
    assert.ok(videoNode(tree), '再次轮转到动作')
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    assert.ok(panelButton)
    panelButton.props.onClick()
    tree = renderMain()
    assert.equal(videoNode(tree), undefined, '面板打开应结束动作')
    const panelImg = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(panelImg && String(panelImg.props.src).includes('dsh-whale-home-peek.webp'))
  } finally {
    react._cleanup()
  }
})

test('实时心情事件：2–4s 防抖合并、force=1、面板事件、in-flight pending 补发、失败回退', async () => {
  const dataVersion = 'test.realtime.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'rt-1', title: '鹿柴', author: '王维', lines: ['空山不见人。'], tones: ['平平仄仄平。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-23', poemId: 'rt-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-23', stats: { userMessages: 2, toolCalls: 30 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  let mode = 'ok'
  let moodAiCalls = []
  let deferredResolve = null
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('mood-ai.json') >= 0) {
      moodAiCalls.push(raw)
      if (mode === 'deferred') return new Promise((resolve) => { deferredResolve = () => resolve({ ok: true, json: async () => ({ ok: true, mood: { label: '实时心情', image: 'dsh-whale-state-abstract.webp', reason: '刚更新' } }) }) })
      if (mode === 'fail') return { ok: true, json: async () => ({ ok: false, error: { code: 'MOOD_AI_UNAVAILABLE' } }) }
      return { ok: true, json: async () => ({ ok: true, mood: { label: '实时心情', image: 'dsh-whale-state-abstract.webp', reason: '刚更新' } }) }
    }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: true, json: async () => makeMoodCatalogFixture() }
    if (raw.indexOf('pet-media') >= 0) return { ok: false, status: 404, json: async () => ({}) }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, context, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  const timers = []
  context.setTimeout = (fn, ms) => {
    const id = timers.length + 1
    timers.push({ id, fn, ms, cancelled: false })
    return id
  }
  context.clearTimeout = (id) => {
    const timer = timers.find((item) => item.id === id)
    if (timer) timer.cancelled = true
  }
  const findDebounceTimer = () => {
    // 已有请求后事件触发会走 20s 最小间隔（剩余时间），优先取该计时器
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      const timer = timers[i]
      if (!timer.cancelled && timer.ms > debug.MOOD_AI_DEBOUNCE_MAX_MS && timer.ms <= debug.MOOD_AI_MIN_GAP_MS) return timer
    }
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      const timer = timers[i]
      if (!timer.cancelled && timer.ms >= debug.MOOD_AI_DEBOUNCE_MIN_MS && timer.ms <= debug.MOOD_AI_DEBOUNCE_MAX_MS) return timer
    }
    return null
  }
  const fire = (timer) => {
    assert.ok(timer, '应存在事件防抖/最小间隔计时器')
    timer.cancelled = true
    timer.fn()
  }
  const renderMain = () => {
    react._beginRender()
    return debug.PoetryWidget({})
  }
  try {
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 8; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    await sleep(20)
    tree = renderMain()
    // 初次加载：2–4s 防抖后请求，固定 force=1
    let debounce = findDebounceTimer()
    assert.ok(debounce, '初次加载应安排实时心情防抖')
    fire(debounce)
    await sleep(30)
    tree = renderMain()
    assert.equal(moodAiCalls.length, 1)
    assert.match(moodAiCalls[0], /[?&]force=1(&|$)/, '实时心情必须带 force=1')
    assert.ok(!/[?&](?:refresh|interval)=/.test(moodAiCalls[0]))

    // 打开面板 + 切 tab 两个事件应合并成一次请求
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    assert.ok(panelButton)
    panelButton.props.onClick()
    tree = renderMain()
    const settingsTab = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-tab')
      && textOf(node) === '设置')[0]
    assert.ok(settingsTab)
    settingsTab.props.onClick()
    tree = renderMain()
    debounce = findDebounceTimer()
    assert.ok(debounce)
    fire(debounce)
    await sleep(30)
    tree = renderMain()
    assert.equal(moodAiCalls.length, 2, '同时段多个事件应合并为一次请求')

    // in-flight 时记 pending，完成后补发一次
    let settingsElement = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.ok(settingsElement)
    const mainApi = settingsElement.props.api
    mode = 'deferred'
    await mainApi.refreshMoodNow()
    let immediate = null
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      if (!timers[i].cancelled && timers[i].ms === 0) { immediate = timers[i]; break }
    }
    fire(immediate)
    await sleep(20)
    tree = renderMain()
    assert.equal(moodAiCalls.length, 3, '进入 in-flight 请求')
    // 请求未完成时再触发保存设置事件 → 只记 pending，不并发请求
    mainApi.updateSettings({ showTones: true })
    tree = renderMain()
    debounce = findDebounceTimer()
    fire(debounce)
    await sleep(20)
    assert.equal(moodAiCalls.length, 3, 'in-flight 时不应并发请求，应记 pending')
    mode = 'ok'
    deferredResolve()
    await sleep(30)
    tree = renderMain()
    debounce = findDebounceTimer()
    assert.ok(debounce, 'in-flight 完成后应为 pending 安排补发')
    fire(debounce)
    await sleep(30)
    tree = renderMain()
    assert.equal(moodAiCalls.length, 4, 'pending 应补发一次')
    for (const url of moodAiCalls) assert.match(url, /[?&]force=1(&|$)/, '所有实时心情请求都应 force=1')

    // 失败静默回退启发式，不报错
    mode = 'fail'
    mainApi.updateSettings({ showTones: false })
    tree = renderMain()
    debounce = findDebounceTimer()
    fire(debounce)
    await sleep(30)
    tree = renderMain()
    assert.equal(moodAiCalls.length, 5)
    assert.ok(!textOf(tree).match(/失败|错误|不可用/), '心情失败不得弹错误')
    settingsElement = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    if (settingsElement.length) assert.equal(settingsElement[0].props.api.moodSource, 'heuristic')
  } finally {
    react._cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* 18. M21：快速拖动晕眩 + 饭点吃饭提醒                                  */
/* ------------------------------------------------------------------ */

test('晕眩/饭点纯函数：快速拖动阈值、时长、选动画、饭点边界/每餐一次/过期不补/优先级', () => {
  const { debug, storage } = loadClient()
  // 快速拖动：速度阈值 / 120ms 内 >120px
  assert.equal(debug.detectFastDrag({ x: 0, y: 0, t: 0 }, { x: 200, y: 0, t: 100 }), true, '200px/100ms = 2000px/s')
  assert.equal(debug.detectFastDrag({ x: 0, y: 0, t: 0 }, { x: 121, y: 0, t: 100 }), true, '120ms 内位移 >120px')
  assert.equal(debug.detectFastDrag({ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 500 }), false, '慢拖不触发')
  assert.equal(debug.detectFastDrag({ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 0 }), false, '无时间差/点按不触发')
  assert.equal(debug.detectFastDrag({ x: 0, y: 0, t: 0 }, { x: 200, y: 0, t: 120 }), false, '1666px/s 且 dt 不小于 120ms 不触发')
  assert.equal(debug.detectFastDrag({ x: 0, y: 0, t: 0 }, { x: 50, y: 0, t: 10 }), true, '瞬时高速也算快拖')
  assert.equal(debug.DIZZY_FAST_PX_PER_SEC, 1800)
  assert.equal(debug.DIZZY_FAST_DISTANCE_PX, 120)
  assert.equal(debug.DIZZY_FAST_WINDOW_MS, 120)
  assert.equal(debug.nextDizzyDuration(() => 0), 1500)
  assert.equal(debug.nextDizzyDuration(() => 0.999999), 2500)

  const petEntries = [
    { file: 'webm/转圈圈.webm', label: '转圈圈' },
    { file: 'webm/小幅度原地360度旋转展示.webm', label: '小幅度原地360度旋转展示' },
    { file: 'webm/吃午餐.webm', label: '吃午餐' },
    { file: 'webm/吃白饭.webm', label: '吃白饭' },
  ]
  assert.equal(debug.pickDizzyMedia(petEntries).file, 'webm/小幅度原地360度旋转展示.webm', '优先指定转圈动画')
  assert.equal(debug.pickDizzyMedia([{ file: 'webm/a.webm', label: '普通' }]), null)
  assert.equal(debug.pickMealMedia(petEntries, 'lunch').file, 'webm/吃午餐.webm')
  assert.equal(debug.pickMealMedia([{ file: 'webm/干饭.webm', label: '干饭' }], 'lunch').file, 'webm/干饭.webm', 'fallback 干饭')
  assert.equal(debug.pickMealMedia([{ file: 'webm/吃零食.webm', label: '吃零食' }], 'dinner').file, 'webm/吃零食.webm', 'fallback 含吃')
  assert.equal(debug.pickMealMedia([], 'lunch'), null)

  // 饭点窗口边界（含开始、不含结束）
  const at = (h, m) => shanghaiTs(2026, 10, 23, h, m)
  assert.equal(debug.mealMomentFor(at(6, 59)), null)
  assert.equal(debug.mealMomentFor(at(7, 0)).meal, 'breakfast')
  assert.equal(debug.mealMomentFor(at(8, 59)).meal, 'breakfast')
  assert.equal(debug.mealMomentFor(at(9, 0)), null)
  assert.equal(debug.mealMomentFor(at(11, 29)), null)
  assert.equal(debug.mealMomentFor(at(11, 30)).meal, 'lunch')
  assert.equal(debug.mealMomentFor(at(13, 29)).meal, 'lunch')
  assert.equal(debug.mealMomentFor(at(13, 30)), null)
  assert.equal(debug.mealMomentFor(at(17, 29)), null)
  assert.equal(debug.mealMomentFor(at(17, 30)).meal, 'dinner')
  assert.equal(debug.mealMomentFor(at(19, 29)).meal, 'dinner')
  assert.equal(debug.mealMomentFor(at(19, 30)), null)
  assert.equal(debug.mealMomentFor(at(14, 0)), null, '过期不补，只有窗口内触发')
  assert.equal(debug.nextMealDuration(() => 0), 25000)
  assert.ok(debug.nextMealDuration(() => 0.999999) <= 40000 && debug.nextMealDuration(() => 0.999999) >= 39900)

  // 每天每餐一次 / 跨天重置
  const day = at(12, 0)
  const empty = debug.normalizeMealState(null, day)
  assert.equal(empty.date, '2026-10-23')
  assert.equal(empty.meals.lunch, undefined)
  const once = debug.markMealDone(empty, 'lunch', day)
  assert.equal(once.meals.lunch, true)
  assert.equal(debug.mealTriggerFor({ now: day, state: once }), null, '同一天同一餐只触发一次')
  assert.ok(debug.mealTriggerFor({ now: day, state: empty }))
  assert.equal(debug.mealTriggerFor({ now: day, state: empty, panelOpen: true }), null, '面板开推迟')
  assert.equal(debug.mealTriggerFor({ now: day, state: empty, hidden: true }), null, '挂件隐藏推迟')
  assert.equal(debug.mealTriggerFor({ now: day, state: empty, visible: false }), null, '页面隐藏推迟')
  const nextDay = at(12, 0) + 24 * 60 * 60 * 1000
  const reset = debug.normalizeMealState(once, nextDay)
  assert.equal(reset.date, '2026-10-24')
  assert.equal(reset.meals.lunch, undefined, '跨天自动重置')
  assert.ok(debug.mealTriggerFor({ now: nextDay, state: reset }))

  debug.writeMealState(once)
  assert.equal(debug.readMealState(day).meals.lunch, true)
  storage.setItem(debug.MEAL_KEY, '{bad')
  assert.equal(debug.readMealState(day).meals.lunch, undefined, '损坏记录安全降级')

  // 优先级 pulse > panel > dizzy > meal > expression > motion > mood
  const all = { pulseFile: 'p', panelFile: 'pa', dizzyFile: 'd', mealFile: 'me', expressionFile: 'e', motionFile: 'm', moodFile: 'mo' }
  assert.equal(debug.mascotFilePriority(all), 'p')
  assert.equal(debug.mascotFilePriority(Object.assign({}, all, { pulseFile: '' })), 'pa')
  assert.equal(debug.mascotFilePriority(Object.assign({}, all, { pulseFile: '', panelFile: '' })), 'd')
  assert.equal(debug.mascotFilePriority(Object.assign({}, all, { pulseFile: '', panelFile: '', dizzyFile: '' })), 'me')
  assert.equal(debug.mascotFilePriority(Object.assign({}, all, { pulseFile: '', panelFile: '', dizzyFile: '', mealFile: '' })), 'e')
})

test('晕眩集成：快拖播转圈 webm + 摇晃/星星/提示、1.5–2.5s 恢复、慢拖不触发、无 catalog 仍摇晃', async () => {
  const dataVersion = 'test.dizzy.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'dz-1', title: '鹿柴', author: '王维', lines: ['空山不见人。'], tones: ['平平仄仄平。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-23', poemId: 'dz-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-23', stats: { userMessages: 2, toolCalls: 30 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  const makeFetch = (withCatalog) => async (url) => {
    const raw = String(url)
    if (raw.indexOf('pet-media') >= 0) {
      if (!withCatalog) return { ok: false, status: 404, json: async () => ({}) }
      if (raw.indexOf('catalog.json') >= 0) {
        return { ok: true, json: async () => ({ ok: true, entries: [{ file: 'webm/转圈圈.webm', label: '转圈圈', media: 'video', scope: 'mood', tags: [] }, { file: 'webm/小幅度原地360度旋转展示.webm', label: '小幅度原地360度旋转展示', media: 'video', scope: 'mood', tags: [] }] }) }
      }
      return { ok: true, json: async () => ({}) }
    }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: true, json: async () => makeMoodCatalogFixture() }
    if (raw.indexOf('mood-ai.json') >= 0) return { ok: true, json: async () => ({ ok: false }) }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const runClient = async (withCatalog) => {
    const client = loadClient({
      seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
      fetch: makeFetch(withCatalog),
    })
    const timers = []
    client.context.setTimeout = (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id }
    client.context.clearTimeout = () => {}
    const renderMain = () => {
      client.react._beginRender()
      return client.debug.PoetryWidget({})
    }
    let tree = renderFresh(client.react, client.debug.PoetryWidget, {})
    for (let round = 0; round < 8; round += 1) {
      client.react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    await sleep(20)
    tree = renderMain()
    return { client, renderMain, tree, timers, findTimer: (min, max) => { for (let i = timers.length - 1; i >= 0; i -= 1) { if (timers[i].ms >= min && timers[i].ms <= max) return timers[i] } return null } }
  }
  const findAnyStage = (tree) => findAll(tree, (node) => node.type === 'div'
    && typeof node.props.className === 'string'
    && node.props.className.split(' ').includes('dshp-stage'))[0]
  const dragEvent = (x, t, pointerId) => ({
    button: 0,
    pointerId,
    clientX: x,
    clientY: 100,
    timeStamp: t,
    cancelable: true,
    preventDefault() {},
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
  })
  let noCat = null
  let cat = null
  try {
    // 无 catalog：快拖仍摇晃+星星+提示，不渲染视频
    noCat = await runClient(false)
    let stage = findAnyStage(noCat.tree)
    stage.props.onPointerDown(dragEvent(100, 1000, 1))
    stage.props.onPointerMove(dragEvent(320, 1050, 1))
    stage.props.onPointerUp(dragEvent(320, 1050, 1))
    noCat.tree = noCat.renderMain()
    stage = findAnyStage(noCat.tree)
    assert.ok(String(stage.props.className).includes('dshp-dizzy'), '无 catalog 也要摇晃')
    assert.match(textOf(noCat.tree), /别甩啦，头好晕…/)
    assert.match(textOf(noCat.tree), /💫/)
    assert.equal(findAll(noCat.tree, (node) => node.type === 'video').length, 0, '无 catalog 不播转圈视频')
    const dizzyTimer = noCat.findTimer(noCat.client.debug.DIZZY_MIN_MS, noCat.client.debug.DIZZY_MAX_MS)
    assert.ok(dizzyTimer, '晕眩时长 1.5–2.5s')
    dizzyTimer.fn()
    noCat.tree = noCat.renderMain()
    assert.ok(!String(findAnyStage(noCat.tree).props.className).includes('dshp-dizzy'), '结束后恢复')
    noCat.client.react._cleanup()

    // 有 catalog：快拖优先播「小幅度原地360度旋转展示」，慢拖不触发
    cat = await runClient(true)
    stage = findAnyStage(cat.tree)
    stage.props.onPointerDown(dragEvent(100, 2000, 2))
    stage.props.onPointerMove(dragEvent(260, 2500, 2))
    stage.props.onPointerUp(dragEvent(260, 2500, 2))
    cat.tree = cat.renderMain()
    assert.ok(!String(findAnyStage(cat.tree).props.className).includes('dshp-dizzy'), '慢拖不触发晕眩')
    stage = findAnyStage(cat.tree)
    stage.props.onPointerDown(dragEvent(100, 3000, 3))
    stage.props.onPointerMove(dragEvent(330, 3050, 3))
    stage.props.onPointerUp(dragEvent(330, 3050, 3))
    cat.tree = cat.renderMain()
    assert.ok(String(findAnyStage(cat.tree).props.className).includes('dshp-dizzy'))
    const dizzyVideo = findAll(cat.tree, (node) => node.type === 'video')[0]
    assert.ok(dizzyVideo, '有 catalog 应播转圈 webm')
    assert.ok(String(dizzyVideo.props.src).includes(encodeURIComponent('webm/小幅度原地360度旋转展示.webm')))
    assert.match(textOf(cat.tree), /别甩啦，头好晕…/)
    // 脉冲优先于晕眩
    const settingsElement = findAll(cat.tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    if (settingsElement) {
      settingsElement.props.api.pulseMascot('gameThink')
      cat.tree = cat.renderMain()
      const pulseImg = findAll(cat.tree, (node) => node.type === 'img')[0]
      assert.ok(pulseImg && String(pulseImg.props.src).includes('dsh-whale-state-game-think.webp'))
    }
  } finally {
    if (noCat && noCat.client) noCat.client.react._cleanup()
    if (cat && cat.client) cat.client.react._cleanup()
  }
})

test('饭点集成：12:00 播吃午餐动画+提醒文案、25–40s 后恢复、无 catalog 静态 daily-eat、每餐一天一次', async () => {
  const dataVersion = 'test.meal.1'
  const settings = { weatherPoem: false, mood: false, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'ml-1', title: '鹿柴', author: '王维', lines: ['空山不见人。'], tones: ['平平仄仄平。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-23', poemId: 'ml-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-23', stats: { userMessages: 0, toolCalls: 0 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('pet-media') >= 0) return { ok: false, status: 404, json: async () => ({}) }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: true, json: async () => makeMoodCatalogFixture() }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, context, debug, storage } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  storage.removeItem(debug.MEAL_KEY)
  const fixedNow = shanghaiTs(2026, 10, 23, 12, 0)
  const RealDate = Date
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args)
      else super(fixedNow)
    }
    static now() { return fixedNow }
  }
  context.Date = FakeDate
  const timers = []
  context.setTimeout = (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id }
  context.clearTimeout = () => {}
  const renderMain = () => {
    react._beginRender()
    return debug.PoetryWidget({})
  }
  try {
    let tree = renderFresh(react, debug.PoetryWidget, {})
    react._runEffects()
    await sleep(20)
    tree = renderMain()
    assert.match(textOf(tree), /到饭点啦，我去吃午饭/)
    assert.match(textOf(tree), /记得吃/)
    assert.match(textOf(tree), /token/)
    const mealImg = findAll(tree, (node) => node.type === 'img')[0]
    assert.ok(mealImg)
    assert.ok(String(mealImg.props.src).includes('dsh-whale-state-daily-eat.webp'), '无 catalog 用静态 daily-eat 图')
    const mealState = debug.readMealState(fixedNow)
    assert.equal(mealState.meals.lunch, true, '触发后标记当天午餐已用')
    assert.equal(storage.getItem(debug.MEAL_KEY) !== null, true)
    const stopTimer = timers.find((timer) => timer.ms >= debug.MEAL_PLAY_MIN_MS && timer.ms <= debug.MEAL_PLAY_MAX_MS)
    assert.ok(stopTimer, '吃饭动画 25–40s')
    stopTimer.fn()
    tree = renderMain()
    assert.ok(!textOf(tree).includes('到饭点啦，我去吃午饭'))
    // 同一天同一餐不重复触发
    debug.writeMealState(debug.markMealDone(debug.readMealState(fixedNow), 'lunch', fixedNow))
    react._runEffects()
    await sleep(20)
    tree = renderMain()
    assert.ok(!textOf(tree).includes('到饭点啦，我去吃午饭'))
  } finally {
    react._cleanup()
  }
})

test('mood-ai 超时 25s + webm 图片校验放宽：未在图鉴的合法 webm 接受、非法/静态未知拒绝', () => {
  const { debug } = loadClient()
  assert.equal(debug.MOOD_AI_TIMEOUT_MS, 25000)
  const catalog = debug.normalizeMoodCatalog(makeMoodCatalogFixture())
  const makeMood = (image) => ({ ok: true, mood: { label: '实时', image, reason: '测试' } })
  // 合法 webm 即使动画图鉴未加载/未收录也接受（宿主只返回图鉴内文件，视频 404 由 onError 回退）
  const validUnlisted = debug.parseMoodAiResponse(makeMood('webm/未收录的动画.webm'), catalog)
  assert.equal(validUnlisted.ok, true)
  assert.equal(validUnlisted.mood.image, 'webm/未收录的动画.webm')
  assert.equal(debug.parseMoodAiResponse(makeMood('webm/未收录的动画.webm'), null).ok, true, '图鉴未加载/失败时仍接受合法 webm')
  assert.equal(debug.parseMoodAiResponse(makeMood('dsh-whale-state-abstract.webp'), catalog).ok, true, '已收录静态图照常接受')
  for (const image of [
    'webm/../evil.webm',
    'webm/sub/动画.webm',
    'webm/动画.mp4',
    'webm/动画.WEBM',
    '/webm/动画.webm',
    'webm//动画.webm',
    'webm/动画.webm/extra',
    '视频.webm',
    'unknown.webp',
    'dsh-whale-home-peek.webp',
    '',
  ]) {
    assert.equal(debug.parseMoodAiResponse(makeMood(image), catalog).ok, false, '应拒绝非法/未知图片：' + JSON.stringify(image))
  }
  assert.equal(debug.parseMoodAiResponse({ ok: true, mood: { label: '', image: 'webm/动画.webm', reason: '' } }, catalog).ok, false, '空 label 拒绝')
})

/* ------------------------------------------------------------------ */
/* 20. M29b 模型心情失败保留/自动重试                                    */
/* ------------------------------------------------------------------ */

test('模型心情失败保留/重试纯函数：12–25s、30min 保留窗口、5 次上限、失败原因归一化', () => {
  const { debug } = loadClient()
  assert.equal(debug.MOOD_AI_RETRY_MIN_MS, 12 * 1000)
  assert.equal(debug.MOOD_AI_RETRY_MAX_MS, 25 * 1000)
  assert.equal(debug.MOOD_AI_KEEP_MS, 30 * 60 * 1000)
  assert.equal(debug.MOOD_AI_MAX_RETRIES, 5)
  assert.equal(debug.nextMoodAiRetryDelay(() => 0), 12000)
  assert.ok(debug.nextMoodAiRetryDelay(() => 0.999999) <= 25000 && debug.nextMoodAiRetryDelay(() => 0.999999) >= 24900)
  const now = Date.now()
  assert.equal(debug.moodAiKeepDecision({ source: 'heuristic', lastSuccessAt: now - 1000, now }), false, '从没成功/已回退不保留')
  assert.equal(debug.moodAiKeepDecision({ source: 'model', lastSuccessAt: 0, now }), false, '没有成功时间不保留')
  assert.equal(debug.moodAiKeepDecision({ source: 'model', lastSuccessAt: now - 29 * 60 * 1000, now }), true, '<30min 保留')
  assert.equal(debug.moodAiKeepDecision({ source: 'model', lastSuccessAt: now - 30 * 60 * 1000, now }), false, '>30min 回退')
  const reasons = {
    timeout: 'timeout',
    http: 'http',
    json: 'json',
    image: 'image',
    network: 'network',
    rate: 'rate',
    'no-fetch': 'network',
    invalid: 'model',
    other: 'unknown',
  }
  for (const [reason, expected] of Object.entries(reasons)) {
    assert.equal(debug.normalizeMoodAiFailure({ reason }), expected, '失败原因：' + reason)
  }
  assert.equal(debug.normalizeMoodAiFailure({ reason: 'http', status: 429 }), 'rate', '429 归为请求过频')
  assert.equal(debug.normalizeMoodAiFailure({ reason: 'other', status: 429 }), 'rate')
  assert.equal(debug.moodAiFailureLabel('timeout'), '超时')
  assert.equal(debug.moodAiFailureLabel('image'), '图片无效')
})

test('模型心情失败集成：首次失败回退、成功过则保留并重试、失败原因显示、5 次后停止自动重试', async () => {
  const dataVersion = 'test.moodretry.1'
  const settings = { weatherPoem: false, mood: true, spontaneousPoem: false, weatherCity: '北京' }
  const poems = [{ id: 'mr-1', title: '鹿柴', author: '王维', lines: ['空山不见人。'], tones: ['平平仄仄平。'] }]
  const bootstrap = {
    ok: true, version: '0.1.0', dataVersion,
    source: { repo: 'test', commit: 'abc', license: 'MIT' },
    today: { date: '2026-10-23', poemId: 'mr-1' },
    counts: { poems: 1, ci: 0, yun: 30, cards: 12, ciCards: 15 },
    settings,
  }
  const responses = {
    'poems.json': { ok: true, items: poems },
    'ci.json': { ok: true, items: [] },
    'weather.json': { ok: true, city: '北京', weather: { category: 'clear', label: '晴', tempC: 20, isDay: true }, stale: false },
    'mood.json': { ok: true, date: '2026-10-23', stats: { userMessages: 1, toolCalls: 10 }, updatedAt: 1 },
    'settings.json': { ok: true, settings },
  }
  let mode = 'fail'
  const fetchImpl = async (url) => {
    const raw = String(url)
    if (raw.indexOf('mood-ai.json') >= 0) {
      if (mode === 'fail') return { ok: false, status: 500, json: async () => ({}) }
      if (mode === 'rate') return { ok: true, json: async () => ({ ok: false, error: { code: 'MOOD_AI_RATE_LIMITED', message: 'rate' } }) }
      return { ok: true, json: async () => ({ ok: true, mood: { label: '成功心情', image: 'dsh-whale-state-abstract.webp', reason: '好了' } }) }
    }
    if (raw.indexOf('mood-catalog') >= 0) return { ok: true, json: async () => makeMoodCatalogFixture() }
    if (raw.indexOf('pet-media') >= 0) return { ok: false, status: 404, json: async () => ({}) }
    const key = raw.replace('/api/dsh-poetry/', '')
    const data = responses[key]
    if (!data) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, json: async () => data }
  }
  const { react, context, debug } = loadClient({
    seed: { [CACHE_KEY]: JSON.stringify({ dataVersion, bootstrap, settings, todayPoem: null }) },
    fetch: fetchImpl,
  })
  const timers = []
  context.setTimeout = (fn, ms) => { const item = { fn, ms, used: false }; timers.push(item); return item }
  context.clearTimeout = (item) => { if (item) item.cleared = true }
  const findTimer = (min, max) => {
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      const item = timers[i]
      if (!item.used && !item.cleared && item.ms >= min && item.ms <= max) return item
    }
    return null
  }
  const fire = (item) => { assert.ok(item); item.used = true; item.fn() }
  const renderMain = () => {
    react._beginRender()
    return debug.PoetryWidget({})
  }
  const openSettings = () => {
    let tree = renderMain()
    const stage = findStage(tree)
    stage.props.onPointerDown(pointerEvent(1))
    stage.props.onPointerUp(pointerEvent(1))
    tree = renderMain()
    const panelButton = findAll(tree, (node) => node.type === 'button' && textOf(node) === '展开面板')[0]
    if (panelButton) panelButton.props.onClick()
    tree = renderMain()
    const settingsTab = findAll(tree, (node) => node.type === 'button'
      && typeof node.props.className === 'string'
      && node.props.className.includes('dshp-tab')
      && textOf(node) === '设置')[0]
    if (settingsTab) settingsTab.props.onClick()
    tree = renderMain()
    return findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
  }
  try {
    let tree = renderFresh(react, debug.PoetryWidget, {})
    for (let round = 0; round < 8; round += 1) {
      react._runEffects()
      await sleep(20)
      tree = renderMain()
    }
    await sleep(20)
    tree = renderMain()
    // 首次失败（从没成功）→ 回退启发式 + 记录原因 + 自动重试排期
    // 先打开设置面板，避免打开面板事件取消待执行的自动重试计时
    let settingsEl = openSettings()
    assert.ok(settingsEl)
    let debounce = findTimer(debug.MOOD_AI_DEBOUNCE_MIN_MS, debug.MOOD_AI_DEBOUNCE_MAX_MS)
    fire(debounce)
    await sleep(20)
    tree = renderMain()
    settingsEl = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.ok(settingsEl)
    assert.equal(settingsEl.props.api.moodAiFallback, true, '首次失败应回退本地')
    assert.equal(settingsEl.props.api.moodSource, 'heuristic')
    assert.equal(settingsEl.props.api.moodAiFailure, 'http')
    let retryTimer = findTimer(debug.MOOD_AI_RETRY_MIN_MS, debug.MOOD_AI_RETRY_MAX_MS)
    assert.ok(retryTimer, '首次失败应安排 12–25s 自动重试')

    // 重试成功 → 模型心情、清除 stale/failure
    mode = 'ok'
    fire(retryTimer)
    await sleep(20)
    tree = renderMain()
    settingsEl = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.equal(settingsEl.props.api.moodAiFallback, false)
    assert.equal(settingsEl.props.api.moodSource, 'model')
    assert.equal(settingsEl.props.api.moodAiStale, false)
    assert.equal(settingsEl.props.api.moodAiFailure, '')

    // 已有模型心情 <30min 再失败 → 保留模型心情 + stale 提示，不切本地
    mode = 'fail'
    settingsEl.props.api.refreshMoodNow()
    tree = renderMain()
    let immediate = findTimer(0, 0)
    fire(immediate)
    await sleep(20)
    tree = renderMain()
    settingsEl = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.equal(settingsEl.props.api.moodAiFallback, false, '30min 内保留上一次模型心情')
    assert.equal(settingsEl.props.api.moodSource, 'model')
    assert.equal(settingsEl.props.api.moodAiStale, true)
    assert.equal(settingsEl.props.api.moodAiFailure, 'http')
    const settingsText = textOf(settingsEl.type(settingsEl.props))
    assert.match(settingsText, /模型心情暂时不可用（HTTP 错误），保留上一次，稍后重试/)
    assert.match(settingsText, /上次模型心情失败：HTTP 错误/)
    retryTimer = findTimer(debug.MOOD_AI_RETRY_MIN_MS, debug.MOOD_AI_RETRY_MAX_MS)
    assert.ok(retryTimer)

    // 重试成功清 stale
    mode = 'ok'
    fire(retryTimer)
    await sleep(20)
    tree = renderMain()
    settingsEl = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    assert.equal(settingsEl.props.api.moodAiStale, false)
    assert.equal(settingsEl.props.api.moodAiFailure, '')

    // 连续 5 次失败后停止自动重试
    mode = 'fail'
    for (let i = 0; i < debug.MOOD_AI_MAX_RETRIES; i += 1) {
      settingsEl.props.api.refreshMoodNow()
      tree = renderMain()
      immediate = findTimer(0, 0)
      fire(immediate)
      await sleep(20)
      tree = renderMain()
      settingsEl = findAll(tree, (node) => typeof node.type === 'function' && node.type.name === 'SettingsTab')[0]
    }
    assert.equal(debug.MOOD_AI_MAX_RETRIES, 5)
    retryTimer = findTimer(debug.MOOD_AI_RETRY_MIN_MS, debug.MOOD_AI_RETRY_MAX_MS)
    assert.equal(retryTimer, null, '连续 5 次失败后不应再自动重试')
    assert.equal(settingsEl.props.api.moodAiStale, true, '仍保留上一次模型心情')
  } finally {
    react._cleanup()
  }
})

/* ------------------------------------------------------------------ */
/* 21. M30b 失败原因透传 + 事件触发 20s 最小间隔                         */
/* ------------------------------------------------------------------ */

test('mood-ai 失败原因透传：host code/HTTP status/429、parse 保留 code、label 映射', async () => {
  const { debug } = loadClient()
  const catalog = debug.normalizeMoodCatalog(makeMoodCatalogFixture())
  assert.equal(debug.MOOD_AI_MIN_GAP_MS, 20000)
  // parse 保留 error.code
  const parsedInvalid = debug.parseMoodAiResponse({ ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: '不可用' } }, catalog)
  assert.equal(parsedInvalid.ok, false)
  assert.equal(parsedInvalid.code, 'MOOD_AI_UNAVAILABLE')

  // host ok:false + code → reason 'host'+code、保留 code/status/message
  const hostClient = loadClient({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: { code: 'MOOD_AI_UNAVAILABLE', message: '模型不可用' } }) }) })
  const hostResult = await hostClient.debug.requestMoodAi({ catalog })
  assert.equal(hostResult.ok, false)
  assert.equal(hostResult.reason, 'host')
  assert.equal(hostResult.code, 'MOOD_AI_UNAVAILABLE')
  assert.equal(hostResult.status, 200)
  assert.equal(hostResult.message, '模型不可用')
  const hostRate = await loadClient({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: { code: 'MOOD_AI_RATE_LIMITED', message: '限频' } }) }) }).debug.requestMoodAi({ catalog })
  assert.equal(hostRate.reason, 'rate', 'host RATE_LIMITED → rate')
  assert.equal(hostRate.code, 'MOOD_AI_RATE_LIMITED')

  // 429 → rate，保留 status
  const rateClient = loadClient({ fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) })
  const rateResult = await rateClient.debug.requestMoodAi({ catalog })
  assert.equal(rateResult.reason, 'rate')
  assert.equal(rateResult.status, 429)
  // 其它 HTTP 错误保留 status
  const httpClient = loadClient({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) })
  const httpResult = await httpClient.debug.requestMoodAi({ catalog })
  assert.equal(httpResult.reason, 'http')
  assert.equal(httpResult.status, 503)

  // 归一化 host code → 可读原因
  assert.equal(debug.normalizeMoodAiFailure(hostResult), 'model')
  assert.equal(debug.normalizeMoodAiFailure({ reason: 'hostMOOD_AI_RATE_LIMITED', code: 'MOOD_AI_RATE_LIMITED', status: 200 }), 'rate')
  assert.equal(debug.normalizeMoodAiFailure({ code: 'MOOD_AI_TIMEOUT' }), 'timeout')
  assert.equal(debug.normalizeMoodAiFailure({ code: 'MOOD_AI_INVALID_JSON' }), 'json')
  assert.equal(debug.normalizeMoodAiFailure({ code: 'MOOD_CATALOG_MISSING' }), 'catalog')
  assert.equal(debug.normalizeMoodAiFailure({ code: 'MOOD_AI_NETWORK' }), 'network')
  assert.equal(debug.normalizeMoodAiFailure({ reason: 'host', code: 'MYSTERY_CODE' }), 'model')
  assert.equal(debug.normalizeMoodAiFailure(rateResult), 'rate')
  assert.equal(debug.moodAiFailureLabel('model'), '模型返回错误')
  assert.equal(debug.moodAiFailureLabel('catalog'), '图鉴未加载')
  assert.equal(debug.moodAiFailureLabel('network'), '网络错误')
  assert.equal(debug.moodAiFailureLabel('unknown'), '未知原因')
  assert.equal(debug.moodAiFailureLabel('model'), '模型返回错误', 'host code 映射到模型错误而非未知原因')

  // 20s 最小间隔纯函数
  const now = Date.now()
  assert.equal(debug.moodAiEventDelay({ lastRequestAt: 0, now, random: () => 0 }), 2000)
  const early = debug.moodAiEventDelay({ lastRequestAt: now - 5 * 1000, now, random: () => 0 })
  assert.equal(early, 15000, '距上次开始 5s → 剩余 15s')
  const tooEarly = debug.moodAiEventDelay({ lastRequestAt: now - 19 * 1000, now, random: () => 0 })
  assert.equal(tooEarly, 1000, '距上次开始 19s → 剩余 1s')
  const afterGap = debug.moodAiEventDelay({ lastRequestAt: now - 25 * 1000, now, random: () => 0 })
  assert.equal(afterGap, 2000, '超过 20s → 回落到 2–4s 防抖')
})
