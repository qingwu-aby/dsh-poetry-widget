// lib/domain/integration/routes/feihua-routes.mjs —— 飞花令全量库路由（v0.2.4 从 routes.mjs 拆出）
import { feihuaFullUnavailable } from '../../works/feihua-full.mjs'

export function createFeihuaRoutes(ctx) {
  const { route, guarded, sendJson, sendJsonMaybeGzip, feihuaFullService, fence } = ctx
  return [
    route(
      'feihua-full.json',
      guarded({
        fence,
        methods: ['GET'],
        onError: 'feihua-full',
        handler: async (req, res) => {
          // 契约 §2.14：按令字分片读取全量校验句库；只读、200+JSON 永不 5xx。
          const params = (() => {
            try {
              return new URL(String(req?.url ?? '/'), 'http://127.0.0.1').searchParams
            } catch {
              return new URLSearchParams()
            }
          })()
          const rawChar = params.get('char')
          let response
          try {
            response =
              feihuaFullService !== undefined && typeof feihuaFullService.load === 'function'
                ? await feihuaFullService.load(typeof rawChar === 'string' ? rawChar : '')
                : feihuaFullUnavailable('宿主插件版本过旧，暂不支持全量校验句库')
          } catch (error) {
            response = feihuaFullUnavailable(`全量校验句库异常：${shortError(error)}`)
          }
          // 成功响应可能很大（最大分片 16MB）：客户端支持时 gzip 传输。
          if (response !== null && typeof response === 'object' && response.ok === true) {
            await sendJsonMaybeGzip(req, res, response)
            return
          }
          sendJson(res, 200, response)
        },
      }),
    ),
  ]
}
