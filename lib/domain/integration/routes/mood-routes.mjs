// lib/domain/integration/routes/mood-routes.mjs —— 心情/模型心情路由（v0.2.4 从 routes.mjs 拆出）
import { MOOD_RECENT_IMAGES_MAX, moodAiUnavailable } from '../../emotion/mood-ai.mjs'

export function createMoodRoutes(ctx) {
  const { route, guarded, sendJson, fence, moodAiService, journal, getSelfState, getReadings, safeReadings, writeMoodMemory, settingsStore, weatherService, shortError, now } = ctx
  return [
    route(
      'mood-ai.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'mood-ai',
        handler: async (req, res) => {
          // 契约 §2.12：模型自主决定心情+配图；只提供非敏感聚合上下文（不含会话文本）。
          const params = (() => {
            try {
              return new URL(String(req?.url ?? '/'), 'http://127.0.0.1').searchParams
            } catch {
              return new URLSearchParams()
            }
          })()
          const queryText = (name, maxChars) => {
            const raw = params.get(name)
            if (typeof raw !== 'string') return null
            const cleaned = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
            return cleaned.length === 0 ? null : Array.from(cleaned).slice(0, maxChars).join('')
          }
          /** `a|b|c` → 去重数组（总长/条数/单条长度都有上限）。 */
          const pipedList = (raw, maxItems, itemMaxChars, listOptions = {}) => {
            const stripPath = listOptions.stripPath !== false
            if (typeof raw !== 'string' || raw.length === 0) return []
            const out = []
            for (const part of raw.slice(0, 800).split('|')) {
              const text = part
                .replace(/[\u0000-\u001f\u007f]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
              if (text.length === 0) continue
              // 图片文件名可能带 `webm/` 目录前缀（M18 动画），recentImages 必须保留完整相对路径。
              const value = stripPath ? text.replace(/^.*[\\/]/, '') : text
              const clamped = Array.from(value).slice(0, itemMaxChars).join('')
              if (!out.includes(clamped)) out.push(clamped)
              if (out.length >= maxItems) break
            }
            return out
          }

          const forceRaw = params.get('force')
          const force = forceRaw === '1' || forceRaw === 'true'
          // v1.78：自动刷新可能来自多个页面/实例；只有用户手动请求才允许 force 绕过缓存。
          const manualRaw = params.get('manual')
          const manual = manualRaw === '1' || manualRaw === 'true'
          const effectiveForce = force && manual
          const moodKey = queryText('mood', 32)
          const weatherParam = queryText('weather', 40)
          const recent = pipedList(params.get('recent'), 3, 80)
          // v1.13：recentImages 上限 5→20（这些图会从 mood-ai 图鉴中剔除以强制轮换）。
          const recentImages = pipedList(params.get('recentImages'), MOOD_RECENT_IMAGES_MAX, 120, { stripPath: false })

          const nowDate = typeof now === 'function' ? now() : new Date()
          const nowMs = nowDate instanceof Date ? nowDate.getTime() : Date.now()

          // v1.58：不再使用任何对话/会话聚合数据（stats/activity/idle）——她的上下文完全独立。
          // v1.59：不再读取外部 experience 文件——她的“正在体会”由她自己写入 self-state。
          // 天气：优先客户端 query；否则用天气服务已有缓存（绝不为心情生成触发网络请求）。
          let weather = weatherParam
          if (weather === null && weatherService !== undefined && typeof weatherService.peekCached === 'function') {
            try {
              const settings = settingsStore.get()
              const cached = weatherService.peekCached(settings.weatherCity)
              if (cached !== null && cached !== undefined && cached.weather && typeof cached.weather === 'object') {
                weather = typeof cached.weather.label === 'string' && cached.weather.label.length > 0 ? cached.weather.label : cached.weather.category ?? null
              }
            } catch {
              weather = null
            }
          }

          // v1.28：内在状态快照（只读指标，供模型判断心情，不报数字）。
          let selfState = null
          try {
            selfState = typeof getSelfState === 'function' ? getSelfState() : null
          } catch {
            selfState = null
          }

          let response
          try {
            response =
              moodAiService !== undefined && typeof moodAiService.generate === 'function'
                ? await moodAiService.generate(
                    {
                      moodKey,
                      weather,
                      recent,
                      recentImages,
                      selfState,
                      readings: typeof getReadings === 'function' ? safeReadings(getReadings) : [],
                    },
                    { force: effectiveForce },
                  )
                : moodAiUnavailable('宿主插件版本过旧，暂不支持模型心情')
          } catch (error) {
            response = moodAiUnavailable(`模型心情服务异常：${shortError(error)}`)
          }
          // 契约 §2.13：仅新生成的成功结果追加到自主记忆日志（cached 不重复写）。
          await writeMoodMemory(journal, response)
          // 契约 §2.12：成功/失败都 200。
          sendJson(res, 200, response)
        },
      }),
    ),
  ]
}
