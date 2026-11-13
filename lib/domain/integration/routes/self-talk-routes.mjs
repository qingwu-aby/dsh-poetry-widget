// lib/domain/integration/routes/self-talk-routes.mjs —— 实时自言自语路由（v0.2.4 从 routes.mjs 拆出）
import { parseRecentQuery, selfTalkUnavailable } from '../../chat/self-talk.mjs'

export function createSelfTalkRoutes(ctx) {
  const { route, guarded, sendJson, fence, selfTalkService, journal, getSelfState, safeReadings, writeSelfTalkMemory, settingsStore, weatherService, shortError, now } = ctx
  return [
    route(
      'self-talk.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'self-talk',
        handler: async (req, res) => {
          // 契约 §2.11 / v1.8b：只向模型提供非敏感聚合上下文（不含会话消息文本，
          // 也不含今日诗标题/作者——避免诱导模型背诗）。
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
          // kind 固定 murmur（v1.8b：intro 已废弃，收到 intro 也按 murmur 处理）。
          const kind = 'murmur'
          const moodKey = queryText('mood', 32)
          // v1.27：心情理由与当前立绘/动画（白名单、长度限制；只用于 prompt 联动，不读文件内容）。
          const moodLabel = queryText('moodLabel', 24)
          const moodReason = queryText('moodReason', 80)
          const image = queryText('image', 120)
          const imageLabel = queryText('imageLabel', 24)
          const weatherParam = queryText('weather', 40)
          const recent = parseRecentQuery(params.get('recent'))
          const nowDate = typeof now === 'function' ? now() : new Date()
          const nowMs = nowDate instanceof Date ? nowDate.getTime() : Date.now()

          // v1.58：不再使用任何对话/会话聚合数据（stats/activity/idle）——她的上下文完全独立。
          // 天气：优先客户端 query；否则用天气服务「已有缓存」（绝不为自言自语触发网络请求）。
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

          // v1.59：不再读取外部 experience 文件——她的“正在体会”由她自己写入 self-state。
          // v1.28：内在状态快照（只读指标，供模型判断心情/碎碎念，不报数字）。
          let selfState = null
          try {
            selfState = typeof getSelfState === 'function' ? getSelfState() : null
          } catch {
            selfState = null
          }

          let response
          try {
            response =
              selfTalkService !== undefined && typeof selfTalkService.generate === 'function'
                ? await selfTalkService.generate({
                    kind,
                    moodKey,
                    moodLabel,
                    moodReason,
                    image,
                    imageLabel,
                    weather,
                    recent,
                    selfState,
                  })
                : selfTalkUnavailable('宿主插件版本过旧，暂不支持实时自言自语')
          } catch (error) {
            response = selfTalkUnavailable(`自言自语服务异常：${shortError(error)}`)
          }
          // 契约 §2.13：仅新生成的成功自言自语追加到自主记忆日志（cached 不重复写）。
          await writeSelfTalkMemory(journal, response)
          // 契约 §2.11：成功/失败都 200。
          sendJson(res, 200, response)
        },
      }),
    ),
  ]
}
