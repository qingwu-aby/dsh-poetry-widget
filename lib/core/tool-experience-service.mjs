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

export function skillHintLines(experience, input = {}) {
  if (!experience || typeof experience.summary !== 'function') return []
  const spec = /** @type {any} */ (input)
  const activity = spec.activity
  const context = spec.context
  const limit = spec.limit === undefined ? 4 : spec.limit
  const hints = experience.summary({ scope: 'activity:' + activity, context: context || {}, limit })
    .map((item) => `${item.tool} 成功率 ${Math.round(item.rate * 100)}%（${item.success}/${item.attempts}）`)
  if (hints.length === 0) return ['这个情境还没有工具经验，可以试不同的做法，别只凭习惯。']
  if (hints.length > 0 && /（[01]\//.test(hints[0])) hints.push('样本还少，可以偶尔换个工具试试。')
  return hints
}


let activeToolExperience = null
export function setActiveToolExperience(experience) {
  activeToolExperience = experience ?? null
  return activeToolExperience
}
export function getActiveToolExperience() {
  return activeToolExperience
}
