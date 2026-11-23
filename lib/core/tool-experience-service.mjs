// @ts-check
// Activity 情境特征：把任意 Activity 的 payload/observation 转成工具经验 context。
export function skillContextForActivity(activity, input = {}) {
  const payload = /** @type {any} */ (input && typeof input === 'object' ? input : {})
  const args = /** @type {any} */ (payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : payload)
  if (activity === 'reading') {
    return {
      hasPath: typeof args.path === 'string' && args.path.length > 0,
      hasPage: Number.isFinite(Number(args.page)),
      hasNote: typeof args.note === 'string' && args.note.length > 0,
    }
  }
  if (activity === 'study') {
    return {
      hasQuestion: typeof args.question === 'string' && args.question.length > 0,
      hasQuery: typeof args.query === 'string' && args.query.length > 0,
      hasNote: typeof args.note === 'string' && args.note.length > 0,
      noSources: payload.noSources === true,
    }
  }
  if (activity === 'video') {
    return {
      hasUrl: typeof args.url === 'string' && args.url.length > 0,
      hasPath: typeof args.path === 'string' && args.path.length > 0,
      noSubtitle: payload.noSubtitle === true,
    }
  }
  if (activity === 'chat') return { hasPeer: typeof payload.peerId === 'string' && payload.peerId.length > 0 }
  return { hasArguments: Object.keys(args).length > 0 }
}

export function skillHintLines(experience, { activity, context, limit = 4 } = {}) {
  if (!experience || typeof experience.summary !== 'function') return []
  return experience.summary({ scope: 'activity:' + activity, context: context || {}, limit })
    .map((item) => `${item.tool} 成功率 ${Math.round(item.rate * 100)}%（${item.success}/${item.attempts}）`)
}
