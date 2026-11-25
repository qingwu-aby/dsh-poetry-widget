// @ts-check
// Voyager 式自动课程，但作者是她自己：给定原始状态 + 她自己的经验，让她写下“我现在最想解决的一件事”。
// 我们只提供镜子（事实），不提供目标。

const MAX_TITLE = 60

/** 立目标用的 prompt：只给原始事实，不给建议清单。 */
export function buildGoalPrompt(context = {}) {
  const obs = context.observation && typeof context.observation === 'object' ? context.observation : {}
  const inv = Array.isArray(obs.inventory) ? obs.inventory.slice(0, 12).join('、') : ''
  const facilities = obs.facilities && typeof obs.facilities === 'object' ? obs.facilities : {}
  const facilityText = Object.entries(facilities)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${key}×${value}`)
    .join('、')
  const skills = typeof context.skillText === 'string' ? context.skillText : ''
  const failures = Array.isArray(context.failures) ? context.failures.slice(0, 3) : []
  const memory = Array.isArray(context.memoryLines) ? context.memoryLines.slice(0, 3) : []
  return [
    '你是住在 Minecraft 世界里的小鲸鱼。现在不是让你立刻行动，而是让你停下来想一想：接下来这段时间，你自己最想做成哪一件事。',
    `你现在的状态：位置 ${obs.position || '未知'}；血 ${obs.health ?? '?'}/20；饥饿 ${obs.food ?? '?'}/20；时间 ${obs.timeOfDay || '未知'}。`,
    inv ? `背包：${inv}。` : '背包：空。',
    facilityText ? `你身边的设施：${facilityText}。` : '你身边目前没有任何设施（床/门/火把/箱子/熔炉都没有）。',
    skills ? `你自己的经验（做得多/做得少）：${skills}。` : '',
    typeof context.roughText === 'string' && context.roughText.length > 0 ? `你自己最不顺手的：${context.roughText}。` : '',
    failures.length > 0 ? `最近没做成的事：${failures.join('；')}。` : '',
    memory.length > 0 ? `你记得的：${memory.join('；')}。` : '',
    '规则：这件事必须是你自己想要的，不是清单里最“正确”的那个；必须是你最近几轮能真正推进一小步的（不要写“造一座城”这种）。',
    '只输出 JSON：{"title":"一句话目标（≤40字）","why":"为什么是它（≤60字）","first":"第一步具体做什么（≤60字，能用 mc_ 工具落地）"}',
  ]
    .filter((line) => typeof line === 'string' && line.length > 0)
    .join('\n')
}

/** 解析她写下的目标；不合法返回 null（那就这轮不立项，等下轮再想）。 */
export function parseGoal(text) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (start < 0 || last <= start) return null
  let raw = null
  try {
    raw = JSON.parse(source.slice(start, last + 1))
  } catch (_error) {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
  if (title.length < 4) return null
  const why = String(raw.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
  const firstStep = String(raw.first ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
  return { title, why, firstStep }
}


/**
 * 执行一次“她自己立目标”的回合：调模型 → 解析 → 写进她自己的项目本子。
 * 失败（模型没给合法 JSON / 项目写不进去）就返回 ok:false，等下一轮再试。
 */
export async function runGoalRound(options = {}) {
  const callModel = typeof options.callModel === 'function' ? options.callModel : null
  const projectStore = options.projectStore ?? null
  if (callModel === null || projectStore === null) return { ok: false, error: 'unavailable' }
  const prompt = buildGoalPrompt({
    observation: options.observation,
    skillText: options.skillText,
    failures: options.failures,
    memoryLines: options.memoryLines,
  })
  const result = await callModel({
    system: '你住在 DSH 的 Minecraft 世界里。你在给自己定目标，不是给别人交作业。只输出 JSON。',
    prompt,
    maxTokens: 500,
    timeoutMs: 40000,
  }).catch(() => null)
  if (!result || typeof result.text !== 'string') return { ok: false, error: 'empty' }
  const goal = parseGoal(result.text)
  if (goal === null) return { ok: false, error: 'invalid' }
  const written = projectStore.handle({
    action: 'open',
    title: goal.title,
    why: goal.why,
    milestones: goal.firstStep.length > 0 ? [goal.firstStep] : [],
  })
  if (written && written.ok === true) return { ok: true, goal }
  return { ok: false, error: (written && written.error) || 'write_failed' }
}


/**
 * 带节流的立目标：没有活跃项目、距上次尝试超过 intervalMs 才跑一次。
 * 返回她自己的新目标（或 null）；节流状态写在 state.lastGoalAt。
 */
export async function runGoalRoundIfDue(options = {}) {
  const state = options.state && typeof options.state === 'object' ? options.state : {}
  const projectStore = options.projectStore ?? null
  if (projectStore === null) return null
  if (typeof projectStore.get === 'function' && projectStore.get() !== null) return null
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now()
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 20 * 60 * 1000
  const nowMs = nowFn()
  const lastAttempt = Number(state.lastGoalAt || 0)
  if (lastAttempt > 0 && nowMs - lastAttempt < intervalMs) return null
  state.lastGoalAt = nowMs
  const result = await runGoalRound({
    callModel: options.callModel,
    projectStore,
    observation: options.observation,
    skillText: typeof options.skillText === 'string' ? options.skillText : '',
    roughText: typeof options.roughText === 'string' ? options.roughText : '',
    failures: Array.isArray(options.failures) ? options.failures : [],
    memoryLines: Array.isArray(options.memoryLines) ? options.memoryLines : [],
  })
  return result && result.ok === true && result.goal ? result.goal : null
}


/** 组装成“每轮可调用”的自驱回合：自己算技能分布/失败，自己节流，自己写项目本子。 */
export function createSelfGoal(options = {}) {
  const projectStore = options.projectStore ?? null
  const callModel = typeof options.callModel === 'function' ? options.callModel : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const toolCountsOf = typeof options.toolCountsOf === 'function' ? options.toolCountsOf : () => ({})
  const roughTextOf = typeof options.roughTextOf === 'function' ? options.roughTextOf : () => ''
  const skillProfile = typeof options.skillProfile === 'function' ? options.skillProfile : () => ({ categories: [] })
  const gameMemory = options.gameMemory ?? null
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 20 * 60 * 1000
  return async function selfGoal(state = {}) {
    if (projectStore === null || callModel === null) return null
    try {
      const profile = skillProfile(toolCountsOf(options.toolSkills))
      const roughText = String(roughTextOf(options.toolSkills) || '')
      const goal = await runGoalRoundIfDue({
        state,
        projectStore,
        now,
        intervalMs,
        observation: state.observation,
        skillText: profile.categories.filter((item) => item.count > 0).map((item) => item.name + item.count).join('、'),
        roughText,
        failures: (Array.isArray(state.commandHistory) ? state.commandHistory : []).filter((item) => item.ok === false).slice(-3).map((item) => item.tool + ' 没成功'),
        memoryLines: gameMemory && typeof gameMemory.promptLines === 'function' ? gameMemory.promptLines(2) : [],
        callModel,
      })
      if (goal && gameMemory && typeof gameMemory.record === 'function') {
        try { gameMemory.record({ category: 'plan', text: `她自己立项：「${goal.title}」`, source: 'self-goal' }) } catch (_error) {}
      }
      return goal
    } catch (_error) {
      return null
    }
  }
}
