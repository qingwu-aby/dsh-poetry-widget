// lib/composition/host-services.mjs —— 公网访问/天气/网页小测/巡检/媒体预算（W2）
import path from 'node:path'
import { createAgentLoopRunner } from '../domain/life/agent-loop-runner.mjs'
import { createDeepSeekWeb, resolveDeepSeekApiKey } from '../deepseek-web.mjs'
import { createMediaBudget } from '../domain/works/media-budget.mjs'
import { resolveMediaBudgetPath } from '../domain/works/media-budget.mjs'
import { createWebAccess } from '../domain/integration/safe-web.mjs'
import { createWebBench } from '../web-bench.mjs'
import { createWeatherService } from '../domain/life/weather.mjs'
import { callModelForRole } from '../llm-call.mjs'

export function createWebStack({ env, logger, worldFeedback, journal }) {
  const deepseekWebKey = resolveDeepSeekApiKey(env)
  const deepseekWeb = createDeepSeekWeb({ apiKey: deepseekWebKey, logger })
  const twinWebAccess = createWebAccess({ env, logger, deepseek: deepseekWeb })
  const webAccess = createWebAccess({
    env,
    logger,
    deepseek: deepseekWeb,
    onFetch: (observation) =>
      worldFeedback.record({
        source: 'web',
        kind: 'fetch',
        ok: observation.ok === true,
        summary: observation.ok
          ? `${observation.title || observation.url}（${observation.status}，${observation.bytes} bytes）`
          : `${observation.url}：${observation.error || '失败'}`,
      }),
  })

  const browseForWhale = async (input = {}) => {
    const url = typeof input.browse === 'string' ? input.browse.trim() : ''
    const query = typeof input.search === 'string' ? input.search.trim() : ''
    if (url.length === 0 && query.length === 0) return ''
    let observation = ''
    if (url.length > 0) {
      const page = await webAccess.fetchPage(url)
      const text = String(page.text || '').replace(/\s+/g, ' ').slice(0, 500)
      observation = `我打开了 ${page.title || url}：${text}`
    } else {
      const results = await webAccess.search(query, { limit: 4 })
      const lines = results.map((item) => `- ${item.title || ''} ${item.url || ''}${item.snippet ? `：${String(item.snippet).slice(0, 120)}` : ''}`)
      observation = `我搜了「${query}」，看到：\n${lines.join('\n')}`.slice(0, 760)
    }
    if (observation.length === 0) return ''
    try {
      await journal.append({ kind: 'thought', text: observation.slice(0, 500) })
    } catch {
      /* 记忆写入失败不影响她这次出去看 */
    }
    return observation
  }

  logger?.info?.(
    `[dsh-little-whale] 公网搜索：${deepseekWeb !== null ? 'DeepSeek Search/Fetch（有 key）' : 'Wikipedia（无 key，可用 DSH_POETRY_DEEPSEEK_API_KEY 升级）'}`,
  )
  return { deepseekWeb, twinWebAccess, webAccess, browseForWhale }
}

export function createWeather() {
  return createWeatherService({ fetchImpl: typeof globalThis.fetch === 'function' ? (url, init) => globalThis.fetch(url, init) : null })
}

export function createWebBenchService({ settingsDir, webAccess, journal, logger, modelPolicy, getLlm, modelErrorsPath }) {
  const webBench = createWebBench({
    file: path.join(settingsDir, 'web-bench.json'),
    webAccess,
    journal,
    logger,
    callModel: async ({ prompt }) => {
      const result = await callModelForRole({
        role: 'growth',
        policy: modelPolicy,
        resolveLlm: getLlm,
        system: '你是住在 DSH 角落的小鲸鱼；这是你每周一次的真实网页小测，如实作答，不知道就说不知道。',
        prompt,
        maxTokens: 1600,
        timeoutMs: 60000,
        timeoutCode: 'WEB_BENCH_TIMEOUT',
        timeoutMessage: '真实网页小测超时',
        prefix: '真实网页小测候选失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
      return result === null ? null : { ok: true, text: result.text }
    },
  })
  webBench.start()
  return webBench
}

export function createAgentLoop({ home, env, logger }) {
  const agentLoop = createAgentLoopRunner({ home, env, logger })
  agentLoop.start()
  return agentLoop
}

export function createMediaBudgetService({ env, home }) {
  return createMediaBudget({ file: resolveMediaBudgetPath(env, home) })
}
