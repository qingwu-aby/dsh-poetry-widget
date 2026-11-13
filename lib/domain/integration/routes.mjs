// lib/routes.mjs —— /api/dsh-poetry/* 的 exact 路由表（不含静态资源路由）。
//
// 契约（docs/contract.md §1/§2，冻结）：
//   GET  health.json / bootstrap.json / poems.json / ci.json / yun.json / knowledge.json / settings.json /
//        weather.json（M7，Open-Meteo）/ mood.json（M8，当日心情统计）/
//        mood-ai.json（M13，模型自主心情+配图）/ feihua-full.json（M17，飞花令全量校验句库）/
//        self-talk.json（M12，实时自言自语，ctx.llm）/ about.json
//        （非路由副作用：self-talk / mood-ai 新生成成功时追加 $DSH_HOME/agent-memory 记忆日志）
//   PUT  settings.json（仅回环来源、白名单校验、返回合并后的完整设置）
//   所有新增路由先过信任栅栏；数据缺失/损坏一律 200 + {ok:false, error:{code:"DATA_UNAVAILABLE"}}；
//   授权失败 403（未登录 401），设置校验失败 400。
import { MAX_SETTINGS_BODY_BYTES } from '../../kernel/settings-store.mjs'
import { promisify } from 'node:util'
import { gzip as zlibGzip } from 'node:zlib'
import { feihuaFullUnavailable } from '../works/feihua-full.mjs'
import { MOOD_RECENT_IMAGES_MAX, moodAiUnavailable } from '../emotion/mood-ai.mjs'
import { createMemoryBackupHandler } from '../memory/memory-hub.mjs'
import { maskPath } from '../../kernel/paths.mjs'
import { parseRecentQuery, selfTalkUnavailable } from '../chat/self-talk.mjs'
import { createBaseRoutes } from './routes/base-routes.mjs'
import { createFeihuaRoutes } from './routes/feihua-routes.mjs'
import { createMoodRoutes } from './routes/mood-routes.mjs'
import { createSelfTalkRoutes } from './routes/self-talk-routes.mjs'
import { createSettingsWeatherRoutes } from './routes/settings-weather-routes.mjs'

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

const gzipAsync = promisify(zlibGzip)
/** 低于该字节数不压缩（压缩收益太小）。 */
const GZIP_MIN_BYTES = 1024

function headerOf(request, name) {
  const headers = request?.headers
  if (headers === undefined || headers === null) return ''
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value === null || value === undefined ? '' : String(value)
  }
  const value = headers[name]
  return typeof value === 'string' ? value : ''
}

/**
 * 成功 JSON 回包；请求带 Accept-Encoding: gzip 且响应 ≥1KB 时用 gzip 压缩
 * （契约 §2.14 的大分片传输优化）。浏览器/Electron 转发会自动解压。
 */
async function sendJsonMaybeGzip(request, response, payload) {
  const body = JSON.stringify(payload)
  const byteLength = Buffer.byteLength(body)
  const acceptEncoding = headerOf(request, 'accept-encoding').toLowerCase()
  if (byteLength >= GZIP_MIN_BYTES && acceptEncoding.includes('gzip')) {
    try {
      const compressed = await gzipAsync(body)
      response.writeHead(200, {
        ...JSON_HEADERS,
        'Content-Encoding': 'gzip',
        Vary: 'Accept-Encoding',
        'Content-Length': String(compressed.length),
      })
      response.end(compressed)
      return
    } catch {
      /* 压缩失败 → 回退明文 JSON */
    }
  }
  response.writeHead(200, { ...JSON_HEADERS, 'Content-Length': String(byteLength) })
  response.end(body)
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

/**
 * 契约 §2.13：把**新生成**（cached !== true）的模型输出追加进自主记忆日志。
 * 只写模型自己说出口的文本/心情字段；query 里的 recent/mood/weather 等一律不写。
 * 写失败由 journal 内部吞掉，绝不影响路由响应。
 */
async function writeSelfTalkMemory(journal, response) {
  if (journal === undefined || journal === null || typeof journal.append !== 'function') return
  if (response === null || typeof response !== 'object' || response.ok !== true || response.cached === true) return
  const lines = Array.isArray(response.lines) ? response.lines : []
  const model = response.model
  for (const line of lines) {
    const text = typeof line === 'string' ? line : line !== null && typeof line === 'object' && typeof line.text === 'string' ? line.text : ''
    if (text.trim().length === 0) continue
    try {
      await journal.append({ kind: 'murmur', text, model })
    } catch {
      /* journal.append 自身已收敛；这里再兜一层，绝不影响响应 */
    }
  }
}

async function writeMoodMemory(journal, response) {
  if (journal === undefined || journal === null || typeof journal.append !== 'function') return
  if (response === null || typeof response !== 'object' || response.ok !== true || response.cached === true) return
  const mood = response.mood
  if (mood === null || typeof mood !== 'object') return
  try {
    await journal.append({
      kind: 'mood',
      label: mood.label,
      reason: mood.reason,
      image: mood.image,
      model: response.model,
    })
  } catch {
    /* ignore */
  }
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
        if (onError === 'self-talk') {
          // 契约 §2.11：自言自语失败返回 ok:false（200），客户端静默回退静态句池。
          sendJson(res, 200, selfTalkUnavailable(`自言自语服务异常：${shortError(error)}`))
          return
        }
        if (onError === 'mood-ai') {
          // 契约 §2.12：模型心情失败返回 ok:false（200），客户端回退启发式心情。
          sendJson(res, 200, moodAiUnavailable(`模型心情服务异常：${shortError(error)}`))
          return
        }
        if (onError === 'feihua-full') {
          // 契约 §2.14：全量校验句库不可用返回 ok:false（200），客户端回退本地句库。
          sendJson(res, 200, feihuaFullUnavailable(`全量校验句库异常：${shortError(error)}`))
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
 *   dataStore: ReturnType<import('../memory/data-store.mjs').createDataStore>,
 *   settingsStore: ReturnType<import('../../kernel/settings-store.mjs').createSettingsStore>,
 *   fence: {check: (req: unknown) => null | {status: number, code: string, message: string}},
 *   version: string,
 *   settingsFile: string,
 *   weatherService?: {getWeather: (city: string, options?: {refresh?: boolean}) => Promise<object>},
 *   selfTalkService?: {generate: (context: object) => Promise<object>},
 *   moodAiService?: {generate: (context: object, options?: {force?: boolean}) => Promise<object>},
 *   journal?: {append: (entry: object) => Promise<object>},
 *   feihuaFullService?: {load: (char: string) => Promise<object>},
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   now?: () => Date,
 *   getSelfState?: () => object|null,
 *   memoryHub?: object|null,
 * }} options
 * @returns {Array<{kind: 'exact', path: string, handler: (req: unknown, res: unknown) => Promise<void>}>}
 */
/** v2.67：安全取「最近读到/学到的」提示行（失败返回空数组，不影响心情生成）。 */
function safeReadings(getter) {
  try {
    const value = getter()
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 3) : []
  } catch {
    return []
  }
}

export function createRouteTable(options) {
  const {
    dataStore,
    settingsStore,
    fence,
    version,
    settingsFile,
    weatherService,
    selfTalkService,
    moodAiService,
    journal,
    feihuaFullService,
    getSelfState,
    getReadings,
    memoryHub,
    getRuntime,
  } = options
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
    ...createBaseRoutes({
      route,
      dataGet,
      guarded,
      sendJson,
      DATA_UNAVAILABLE,
      dataStore,
      settingsStore,
      version,
      getRuntime,
      now,
      memoryHub,
      fence,
      settingsFile,
      home,
      env,
    }),
    ...createSettingsWeatherRoutes({
      route,
      guarded,
      sendJson,
      DATA_UNAVAILABLE,
      settingsStore,
      weatherService,
      readBody,
      fence,
      methodOf,
    }),
    ...createMoodRoutes({
      route,
      guarded,
      sendJson,
      fence,
      moodAiService,
      journal,
      getSelfState,
      getReadings,
      safeReadings,
      writeMoodMemory,
      settingsStore,
      weatherService,
      shortError,
      now,
    }),
    ...createFeihuaRoutes({ route, guarded, sendJson, sendJsonMaybeGzip, feihuaFullService, fence }),
    ...createSelfTalkRoutes({
      route,
      guarded,
      sendJson,
      fence,
      selfTalkService,
      journal,
      getSelfState,
      safeReadings,
      writeSelfTalkMemory,
      settingsStore,
      weatherService,
      shortError,
      now,
    }),
  ]
}
