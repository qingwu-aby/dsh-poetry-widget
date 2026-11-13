// client-src/widget/models/spont-model.js —— 自言自语状态 / 请求（self-talk）。
import { getStorage } from '../../data.js'
import { SPONT_KEY, SELF_TALK_TIMEOUT_MS, normalizeSpontState, parseSelfTalkResponse, selfTalkQuery } from '../../self-talk-client.js'
import { ROUTE } from './constants.js'

  export function readSpontState(now) {
  const storage = getStorage()
  if (!storage) return normalizeSpontState(null, now)
  try {
   const raw = storage.getItem(SPONT_KEY)
   return normalizeSpontState(raw ? JSON.parse(raw) : null, now)
  } catch (error) {
   return normalizeSpontState(null, now)
  }
  }

  export function writeSpontState(state) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(SPONT_KEY, JSON.stringify(state))
  } catch (error) {
   /* 配额/隐私模式：放弃记录，不影响展示 */
  }
  }



  /** 彩蛋触发条件（纯函数）：开关/可见/隐藏/面板/气泡/30s 闲置/45min 间隔/每日 3 次。 */




  /** 事件唤醒后的尝试延迟 2–5 秒。 */
  export function murmurPeriod(hour) {
  if (hour >= 5 && hour < 9) return '早上'
  if (hour >= 9 && hour < 11) return '上午'
  if (hour >= 11 && hour < 14) return '中午'
  if (hour >= 14 && hour < 18) return '下午'
  if (hour >= 18 && hour < 23) return '晚上'
  return '深夜'
  }




  /** 请求 host 实时自言自语；35s 超时（与宿主 high 推理对齐）；所有失败都 resolve 成 {ok:false}，由调用方静默处理。 */
  export function requestSelfTalk(options) {
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
   }, SELF_TALK_TIMEOUT_MS)
  })
  const request = Promise.resolve()
   .then(() => fetch(ROUTE + selfTalkQuery(opts), controller ? { signal: controller.signal } : undefined))
   .then((response) => {
    if (!response || typeof response.ok !== 'boolean' || !response.ok) {
     return { ok: false, reason: 'http', status: response ? response.status : 0 }
    }
    return Promise.resolve(response.json()).then((data) => parseSelfTalkResponse(data)).catch(() => ({ ok: false, reason: 'json' }))
   })
   .catch(() => ({ ok: false, reason: 'network' }))
  return Promise.race([request, timeout]).then((result) => {
   if (timer) clearTimeout(timer)
   return result
  })
  }

  /* ================================================================
   * 2.9 诗库数据 / 平水韵格律检测 / 剩余立绘彩蛋（M9 纯函数）
   * ================================================================ */

