// lib/trust.mjs —— 路由信任栅栏。
//
// 背景：本插件的路由是挂在 webServer 上的 exact 路由，会先于 connection 服务的 `/api`
// 前缀栅栏命中，因此必须自己接入宿主信任栅栏（参考 _ref/whale-widget 已验证的用法，
// 契约 §1/§3.6）。三层判定：
//   ① 插件自己的轻量校验：Host 必须可解析、拒绝跨站 Sec-Fetch-Site、带 Origin 时必须与 Host 同源；
//   ② 写方法（POST/PUT/PATCH/DELETE）：Host 必须是回环地址（127.0.0.0/8、localhost、::1）；
//   ③ 委托宿主 connection.requestRejection(req)：Host/Origin 栅栏 + 浏览器登录态（401）；
//      栅栏缺失时（极旧宿主/单测）只靠 ①②，栅栏自身抛异常 → 按拒绝处理（fail-closed）。
//
// 说明：Desktop 版 GUI 的页面 origin 是 dsh-app://app，所有请求由 Electron 主进程转发到
// 127.0.0.1 的 Host，并注入宿主签名的 cookie（host/origin/cookie/sec-fetch-site 头会被重写）。
// 因此桌面端请求到达这里时 Host=127.0.0.1:<port>、无 Origin / 无 Sec-Fetch-Site → ① ② 通过，
// ③ 用注入 cookie 认到浏览器会话。

/** 需要"仅本机可写"保护的方法。 */
export const WRITE_METHODS = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE'])

const FORBIDDEN = {
  status: 403,
  code: 'FORBIDDEN',
  message: '这个请求来自不受信任的来源，已拒绝。',
}

/** 大小写不敏感地取一个请求头（同时兼容 node IncomingMessage 与 WHATWG Headers）。 */
export function headerValue(request, name) {
  const headers = request?.headers
  if (headers === undefined || headers === null) return undefined
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value === null ? undefined : value
  }
  const direct = headers[name]
  if (typeof direct === 'string') return direct
  const lower = headers[String(name).toLowerCase()]
  if (typeof lower === 'string') return lower
  if (Array.isArray(lower)) return lower[0]
  return undefined
}

/**
 * 是否回环主机名：localhost / *.localhost / 127.0.0.0/8（逐段校验）/ ::1。
 * 刻意不接受 `127.0.0.1.evil.com` 这类相似域名。
 * @param {string} hostname
 */
export function isLoopbackHostname(hostname) {
  const host = String(hostname ?? '')
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
  if (host.length === 0) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (match === null) return false
  if (Number(match[1]) !== 127) return false
  return [match[2], match[3], match[4]].every((part) => Number(part) <= 255)
}

/** 解析 `host[:port]` 请求头；缺 Host / 畸形 → null。 */
export function parseHostHeader(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const url = new URL(`http://${value}`)
    return url.host.length === 0 ? null : url
  } catch {
    return null
  }
}

function rejection(status, code, message) {
  return { status, code, message }
}

/**
 * 创建信任栅栏。
 * @param {{getConnection?: () => ({requestRejection?: (req: unknown) => unknown}|undefined|null), logger?: {warn?: Function}}} [options]
 * @returns {{check: (req: unknown) => null | {status: number, code: string, message: string}}}
 */
export function createTrustFence(options = {}) {
  const getConnection = options.getConnection ?? (() => undefined)
  const logger = options.logger ?? null
  let warnedMissingFence = false
  let warnedFenceThrow = false

  function warnOnce(flagName, message) {
    if (flagName === 'missing' && warnedMissingFence) return
    if (flagName === 'throw' && warnedFenceThrow) return
    if (flagName === 'missing') warnedMissingFence = true
    else warnedFenceThrow = true
    try {
      logger?.warn?.(`[dsh-little-whale] ${message}`)
    } catch {
      /* 日志失败不影响请求处理 */
    }
  }

  return {
    /**
     * 通过 → null；否则返回应当拒绝的状态码与错误码。
     * @param {unknown} request - node IncomingMessage（或 mock：{method, headers}）
     * @returns {null | {status: number, code: string, message: string}}
     */
    check(request) {
      const method = String(request?.method ?? 'GET').toUpperCase()
      const isWrite = WRITE_METHODS.includes(method)

      // ①-1 Host：浏览器一定发送；Desktop 转发器由 Node fetch 自动补 Host。
      const hostValue = headerValue(request, 'host')
      const hostUrl = parseHostHeader(hostValue)
      if (hostUrl === null) return rejection(403, 'FORBIDDEN', '缺少或无法解析 Host 头，已拒绝。')
      const loopback = isLoopbackHostname(hostUrl.hostname)

      // ①-2 跨站标记：浏览器声明 cross-site 一律拒绝（DNS rebinding / 跨站写）。
      const site = String(headerValue(request, 'sec-fetch-site') ?? '').toLowerCase()
      if (site === 'cross-site') {
        return rejection(403, 'FORBIDDEN', '跨站请求被拒绝（Sec-Fetch-Site: cross-site）。')
      }

      // ①-3 Origin：存在时必须与 Host 同源；`null`（沙箱 iframe / data: 文档）视为异源。
      const origin = headerValue(request, 'origin')
      if (typeof origin === 'string' && origin.length > 0) {
        if (origin === 'null') return rejection(403, 'FORBIDDEN', 'Origin 为 null 的请求被拒绝。')
        let originUrl
        try {
          originUrl = new URL(origin)
        } catch {
          return rejection(403, 'FORBIDDEN', '无法解析 Origin 头，已拒绝。')
        }
        if (originUrl.host.toLowerCase() !== hostUrl.host.toLowerCase()) {
          return rejection(403, 'FORBIDDEN', 'Origin 与 Host 不同源，已拒绝。')
        }
      }

      // ② 写接口本机保护：非回环来源一律 403（不依赖宿主栅栏是否可用）。
      if (isWrite && !loopback) {
        return rejection(403, 'FORBIDDEN', '设置接口只允许从本机（回环地址）写入。')
      }

      // ③ 宿主栅栏：保留其 401（未登录浏览器会话）/ 403（不受信 Host）语义，原样照用。
      let connection
      try {
        connection = getConnection()
      } catch {
        connection = undefined
      }
      const fence = connection?.requestRejection
      if (typeof fence !== 'function') {
        // 没有宿主栅栏时：GET 只允许回环来源（避免把只读路由暴露给不可信 Host）。
        if (!loopback) return rejection(403, 'FORBIDDEN', '宿主信任栅栏不可用，非回环来源的请求被拒绝。')
        warnOnce('missing', '宿主 connection.requestRejection 不可用，已回退到插件自带的回环/同源校验。')
        return null
      }
      let code
      try {
        code = fence.call(connection, request)
      } catch (error) {
        warnOnce('throw', `宿主信任栅栏抛异常，已按拒绝处理：${error instanceof Error ? error.message : String(error)}`)
        return rejection(403, 'FORBIDDEN', '宿主信任栅栏判定失败，已拒绝。')
      }
      if (code === undefined || code === null || code === false) return null
      const status = typeof code === 'number' && code >= 400 && code <= 599 ? code : 403
      return rejection(status, status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', status === 401 ? '需要登录 DSH 才能访问该接口。' : FORBIDDEN.message)
    },
  }
}
