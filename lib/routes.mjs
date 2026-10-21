// lib/routes.mjs —— /api/dsh-poetry/* 的 exact 路由表（不含静态资源路由）。
//
// 契约（docs/contract.md §1/§2，冻结）：
//   GET  health.json / bootstrap.json / poems.json / ci.json / yun.json / knowledge.json / settings.json /
//        weather.json（M7，Open-Meteo）/ mood.json（M8，当日心情统计）/ about.json
//   PUT  settings.json（仅回环来源、白名单校验、返回合并后的完整设置）
//   所有新增路由先过信任栅栏；数据缺失/损坏一律 200 + {ok:false, error:{code:"DATA_UNAVAILABLE"}}；
//   授权失败 403（未登录 401），设置校验失败 400。
import { MAX_SETTINGS_BODY_BYTES } from './settings-store.mjs'
import { zeroMoodResponse } from './mood.mjs'
import { maskPath } from './paths.mjs'

/** 路由前缀（契约 §0）。 */
export const ROUTE_PREFIX = '/api/dsh-poetry'

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
})

const DATA_UNAVAILABLE = (message) => ({ ok: false, error: { code: 'DATA_UNAVAILABLE', message } })

/** 以 JSON 回包（先写头部再 end，handler 独占响应生命周期）。 */
export function sendJson(res, status, payload) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(payload))
}

function methodOf(request) {
  return String(request?.method ?? 'GET').toUpperCase()
}

function shortError(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

/**
 * 读请求体（带上限）。空体返回 ''。超限抛错（code=BODY_TOO_LARGE）。
 * @param {unknown} request
 * @param {number} limit
 * @returns {Promise<string>}
 */
export async function readBody(request, limit) {
  const req = request
  if (req === undefined || req === null) return ''
  if (typeof req[Symbol.asyncIterator] !== 'function') {
    if (typeof req.body === 'string') return req.body
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
    return ''
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) {
      const error = new Error(`请求体超过 ${limit} 字节上限`)
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 把 handler 包上信任栅栏 + 方法校验 + 兜底异常收敛。 */
function guarded({ fence, methods, onError, handler }) {
  const allow = methods.join(', ')
  return async function guardedHandler(req, res) {
    let denial
    try {
      denial = fence.check(req)
    } catch {
      // 信任栅栏自身异常 → fail-closed（绝不因为校验器 bug 而放行写接口）。
      denial = { status: 403, code: 'FORBIDDEN', message: '信任校验异常，已拒绝。' }
    }
    if (denial !== null) {
      sendJson(res, denial.status, { ok: false, error: { code: denial.code, message: denial.message } })
      return
    }
    const method = methodOf(req)
    if (!methods.includes(method)) {
      res.writeHead(405, { ...JSON_HEADERS, Allow: allow })
      res.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: `该接口只支持 ${allow}` } }))
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      // 兜底回包本身也可能失败（客户端已断开等），再包一层，保证不抛未捕获异常。
      try {
        if (onError === 'settings') {
          sendJson(res, 200, {
            ok: false,
            error: { code: 'SETTINGS_UNAVAILABLE', message: `设置读写异常：${shortError(error)}` },
          })
          return
        }
        if (onError === 'weather') {
          sendJson(res, 200, {
            ok: false,
            error: { code: 'WEATHER_UNAVAILABLE', message: `天气服务异常：${shortError(error)}` },
          })
          return
        }
        if (onError === 'mood') {
          // 契约 §2.10：心情统计失败返回零值（永不 5xx，客户端不应因此报错）。
          sendJson(res, 200, zeroMoodResponse())
          return
        }
        sendJson(res, 200, DATA_UNAVAILABLE(`数据读取异常：${shortError(error)}`))
      } catch {
        try {
          res.destroy?.()
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/**
 * 创建全部 JSON 路由（顺序即注册顺序，静态资源路由由 index.js 另行注册）。
 * @param {{
 *   dataStore: ReturnType<import('./data-store.mjs').createDataStore>,
 *   settingsStore: ReturnType<import('./settings-store.mjs').createSettingsStore>,
 *   fence: {check: (req: unknown) => null | {status: number, code: string, message: string}},
 *   version: string,
 *   settingsFile: string,
 *   weatherService?: {getWeather: (city: string, options?: {refresh?: boolean}) => Promise<object>},
 *   moodTracker?: {getToday: () => object},
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   now?: () => Date,
 * }} options
 * @returns {Array<{kind: 'exact', path: string, handler: (req: unknown, res: unknown) => Promise<void>}>}
 */
export function createRouteTable(options) {
  const { dataStore, settingsStore, fence, version, settingsFile, weatherService, moodTracker } = options
  const env = options.env ?? process.env
  const home = options.home ?? env.HOME ?? ''
  const now = options.now ?? (() => new Date())

  function route(name, entry) {
    return { kind: 'exact', path: `${ROUTE_PREFIX}/${name}`, handler: entry }
  }

  /** GET 数据文件（poems/ci/yun/knowledge）：原样透传文件顶层结构。 */
  function dataGet(fileName) {
    return guarded({
      fence,
      methods: ['GET'],
      onError: 'data',
      handler: async (req, res) => {
        const loaded = dataStore.load(fileName)
        if (!loaded.ok) {
          sendJson(res, 200, DATA_UNAVAILABLE(loaded.error.message))
          return
        }
        sendJson(res, 200, loaded.value)
      },
    })
  }

  return [
    route(
      'health.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'data',
        handler: async (req, res) => {
          const manifest = dataStore.getManifest()
          sendJson(res, 200, {
            ok: true,
            version,
            dataVersion: manifest.ok ? manifest.dataVersion : null,
            dataAvailable: dataStore.isDataAvailable(),
          })
        },
      }),
    ),
    route(
      'bootstrap.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'data',
        handler: async (req, res) => {
          const manifest = dataStore.getManifest()
          if (!manifest.ok) {
            sendJson(res, 200, DATA_UNAVAILABLE(manifest.error.message))
            return
          }
          const poems = dataStore.load('poems.json')
          if (!poems.ok) {
            sendJson(res, 200, DATA_UNAVAILABLE(poems.error.message))
            return
          }
          const today = dataStore.getToday(now())
          if (!today.ok) {
            sendJson(res, 200, DATA_UNAVAILABLE(today.error.message))
            return
          }
          sendJson(res, 200, {
            ok: true,
            version,
            dataVersion: manifest.dataVersion,
            source: manifest.source,
            today: { date: today.date, poemId: today.poemId },
            counts: dataStore.getCounts(),
            settings: settingsStore.get(),
          })
        },
      }),
    ),
    route('poems.json', dataGet('poems.json')),
    route('ci.json', dataGet('ci.json')),
    route('yun.json', dataGet('yun.json')),
    route('knowledge.json', dataGet('knowledge.json')),
    route(
      'settings.json',
      guarded({
        fence,
        methods: ['GET', 'PUT'],
        onError: 'settings',
        handler: async (req, res) => {
          if (methodOf(req) === 'GET') {
            sendJson(res, 200, { ok: true, settings: settingsStore.get() })
            return
          }
          let body
          try {
            body = await readBody(req, MAX_SETTINGS_BODY_BYTES)
          } catch (error) {
            sendJson(res, 400, {
              ok: false,
              error: {
                code: 'INVALID_SETTINGS',
                message: error?.code === 'BODY_TOO_LARGE' ? error.message : `无法读取请求体：${shortError(error)}`,
                fields: ['body'],
              },
            })
            return
          }
          let patch
          try {
            patch = body.trim().length === 0 ? {} : JSON.parse(body)
          } catch {
            sendJson(res, 400, {
              ok: false,
              error: { code: 'INVALID_SETTINGS', message: '请求体不是合法 JSON', fields: ['body'] },
            })
            return
          }
          const result = settingsStore.put(patch)
          if (!result.ok) {
            const error = result.error ?? { code: 'SETTINGS_UNAVAILABLE', message: '设置写入失败' }
            if (error.code === 'INVALID_SETTINGS') {
              sendJson(res, 400, { ok: false, error })
              return
            }
            // 磁盘写入失败等非校验错误：按「错误一律 200 + JSON」的约定返回 ok:false。
            sendJson(res, 200, { ok: false, error })
            return
          }
          sendJson(res, 200, { ok: true, settings: result.settings })
        },
      }),
    ),
    route(
      'weather.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'weather',
        handler: async (req, res) => {
          // 城市来自 settings.weatherCity（settings-store 已做归一化，默认「北京」）。
          const settings = settingsStore.get()
          let refresh = false
          try {
            refresh = new URL(String(req?.url ?? '/'), 'http://127.0.0.1').searchParams.get('refresh') === '1'
          } catch {
            refresh = false
          }
          const result =
            weatherService !== undefined && typeof weatherService.getWeather === 'function'
              ? await weatherService.getWeather(settings.weatherCity, { refresh })
              : { ok: false, error: { code: 'WEATHER_UNAVAILABLE', message: '天气服务未就绪' } }
          // 无论成功失败都 200（契约 §2.9：永不 5xx）。
          sendJson(res, 200, result)
        },
      }),
    ),
    route(
      'mood.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'mood',
        handler: async (req, res) => {
          // 契约 §2.10：{ok:true,date,stats,updatedAt}；无 tracker / 读取失败 → 全零值。
          const snapshot =
            moodTracker !== undefined && typeof moodTracker.getToday === 'function'
              ? moodTracker.getToday()
              : zeroMoodResponse(now())
          sendJson(res, 200, snapshot)
        },
      }),
    ),
    route(
      'about.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'data',
        handler: async (req, res) => {
          const manifest = dataStore.getManifest()
          sendJson(res, 200, {
            ok: true,
            version,
            dataVersion: manifest.ok ? manifest.dataVersion : null,
            source: manifest.ok ? manifest.source : null,
            files: dataStore.getStatuses(),
            settingsPath: maskPath(settingsFile, { home, dshHome: env.DSH_HOME }),
            builtAt: manifest.ok ? manifest.builtAt : null,
          })
        },
      }),
    ),
  ]
}
