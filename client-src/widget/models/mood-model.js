// client-src/widget/models/mood-model.js —— 模型心情请求（mood-ai）+ 心情缓存。
import { num } from '../../base.js'
import { MOOD_AI_TIMEOUT_MS, moodAiQuery, parseMoodAiResponse } from '../../mood-engine.js'
import { ROUTE } from './constants.js'

  export let moodCache = null




  /** 心情引擎：天气 + 时间 + 本地小信号 → {key,label,image,reason,strong}；不读任何对话数据（v1.58）。 */

  /** 心情立绘限频：同 key 只更新文案；换 key 需 ≥20min，strong 变化/force 可破例。 */

  /** 天气 + 心情合成立绘：恶劣天气（rain/snow/thunder/cold/night）优先，其次心情，最后默认。 */
  /** mood-ai GET：只带 force/mood/weather/idleMinutes/recent(≤3)/recentImages(≤20)，不含会话内容。 */


  /** 请求 host 模型心情；25s 超时（宿主 20s，客户端留余量）；失败都 resolve 成 {ok:false}，由调用方回退启发式。 */
  export function requestMoodAi(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (typeof fetch !== 'function') return Promise.resolve({ ok: false, reason: 'no-fetch' })
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  const timeout = new Promise((resolve) => {
   timer = setTimeout(() => {
    try {
     if (controller) controller.abort()
    } catch (error) {
    }
    resolve({ ok: false, reason: 'timeout' })
   }, MOOD_AI_TIMEOUT_MS)
  })
  const request = Promise.resolve()
   .then(() => fetch(ROUTE + moodAiQuery(opts), controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) {
     const status = response ? num(response.status, 0) : 0
     return { ok: false, reason: status === 429 ? 'rate' : 'http', status }
    }
    return Promise.resolve(response.json()).then((data) => {
     const parsed = parseMoodAiResponse(data, opts.catalog)
     const code = parsed && parsed.code ? String(parsed.code) : (data && data.error && typeof data.error.code === 'string' ? data.error.code : '')
     if (!parsed.ok && code) {
      return {
       ok: false,
       reason: /RATE_LIMITED|RATE/i.test(code) ? 'rate' : 'host',
       code,
       status: num(response.status, 200),
       message: data && data.error && typeof data.error.message === 'string' ? data.error.message : '',
      }
     }
     return parsed
    }).catch(() => ({ ok: false, reason: 'json' }))
   })
   .catch(() => ({ ok: false, reason: 'network' }))
  return Promise.race([request, timeout]).then((result) => {
   if (timer) clearTimeout(timer)
   return result
  })
  }

