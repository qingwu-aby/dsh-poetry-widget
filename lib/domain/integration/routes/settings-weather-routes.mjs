// lib/domain/integration/routes/settings-weather-routes.mjs —— 设置/天气路由（v0.2.4 从 routes.mjs 拆出）
import { MAX_SETTINGS_BODY_BYTES } from '../../../kernel/settings-store.mjs'

export function createSettingsWeatherRoutes(ctx) {
  const { route, guarded, sendJson, DATA_UNAVAILABLE, settingsStore, weatherService, readBody, fence, methodOf } = ctx
  return [
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
  ]
}
