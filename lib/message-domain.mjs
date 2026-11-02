// lib/message-domain.mjs —— 最小消息域：Source / Trigger / Thread / authority（v2.54）。
//
// 借鉴 dsh-superagent 的核心区分：
//   · authority=explicit：用户本人明确对她说，能影响行为/记忆/预算；
//   · authority=inferred：由规则/关系推断，只能作为候选；
//   · authority=context：镜像、网页、材料、旧消息；只提供上下文，不授权。
export const MESSAGE_AUTHORITIES = Object.freeze(['explicit', 'inferred', 'context'])

export function normalizeAuthority(value, options = {}) {
  if (MESSAGE_AUTHORITIES.includes(value)) return value
  if (options.explicit === true) return 'explicit'
  if (options.inferred === true) return 'inferred'
  return 'context'
}

export function threadKey(source, id) {
  const kind = String(source ?? '').trim() || 'unknown'
  const key = String(id ?? '').trim() || 'default'
  return `${kind}:${key}`
}

export function createTrigger(input = {}) {
  const source = String(input.source ?? 'unknown').trim() || 'unknown'
  const id = String(input.id ?? '').trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const threadId = String(input.threadId ?? '').trim() || threadKey(source, 'default')
  return {
    id,
    source,
    threadId,
    actor: String(input.actor ?? source).trim() || source,
    human: input.human === true,
    addressed: input.addressed === true,
    authority: normalizeAuthority(input.authority, { explicit: input.human === true && input.addressed === true, inferred: input.human === true }),
    text: String(input.text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(),
    at: Number.isFinite(input.at) ? input.at : Date.now(),
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
  }
}

/** 用户明确消息才有 explicit；镜像/网页最多 context；规则推断为 inferred。 */
export function authorityOfSource(source, options = {}) {
  if (source === 'user' || source === 'qq-owner') return 'explicit'
  if (source === 'twin' || source === 'mirror' || source === 'web' || source === 'research') return 'context'
  return normalizeAuthority(options.authority, { inferred: options.inferred === true })
}
