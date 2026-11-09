// lib/local-voice.mjs —— 本地权重模型的「口吻层」（v2.80）
//
// 把已经生成好的一句话，交给本地 LoRA 模型（mlx_lm.server，OpenAI 兼容）重写成她的口吻。
// 只是润色：失败/超时/胡话就返回 null，调用方保留原句。
export const LOCAL_VOICE_VERSION = 1
export const LOCAL_VOICE_MAX_CHARS = 240
const REFUSAL = /(抱歉|无法|不能|作为AI|作为 AI|无法理解|无法识别|我会尽力|请提供)/

function clean(value, max) {
  const text = String(value ?? '')
    .replace(/^["“'「『]+|["”'」』]+$/g, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function createLocalVoice(options = {}) {
  const baseURL = String(options.baseURL ?? '').replace(/\/+$/, '')
  const model = String(options.model ?? '')
  const enabled = options.enabled === true && baseURL.length > 0 && model.length > 0
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12000
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : (typeof globalThis.fetch === 'function' ? globalThis.fetch : null)
  const logger = options.logger ?? null
  let calls = 0
  let polished = 0

  async function polish(text, polishOptions = {}) {
    if (!enabled || fetchImpl === null) return null
    const source = clean(text, LOCAL_VOICE_MAX_CHARS)
    if (Array.from(source).length < 4) return null
    const maxChars = Number.isFinite(polishOptions.maxChars) && polishOptions.maxChars > 0 ? polishOptions.maxChars : LOCAL_VOICE_MAX_CHARS
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null
    calls += 1
    try {
      const response = await fetchImpl(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是小鲸鱼的口吻层。只输出改写后的一句话，不加引号，不解释，不要客服腔。' },
            { role: 'user', content: `把这句话用你自己的口吻重写，保持原意，不超过 ${maxChars} 字：${source}` },
          ],
          max_tokens: 160,
          temperature: 0.8,
        }),
        signal: controller !== null ? controller.signal : undefined,
      })
      if (!response || response.ok !== true) return null
      const data = await response.json()
      const raw = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : ''
      const text2 = clean(raw, maxChars)
      if (Array.from(text2).length < 4) return null
      if (REFUSAL.test(text2)) return null
      polished += 1
      return text2
    } catch (error) {
      logger?.warn?.(`[dsh-little-whale] 本地口吻层失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  return { enabled, polish, snapshot: () => ({ enabled, baseURL, model, calls, polished }) }
}
