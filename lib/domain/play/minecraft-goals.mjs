// @ts-check
// Voyager 式自动课程，但作者是她自己：给定原始状态 + 她自己的经验，让她写下“我现在最想解决的一件事”。
// 我们只提供镜子（事实），不提供目标。
import { readFileSync, writeFileSync } from 'node:fs'

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
  const debug = typeof options.debugFile === 'string' ? options.debugFile : ''
  const writeDebug = (payload) => {
    if (debug.length === 0) return
    try {
      writeFileSync(debug, JSON.stringify(payload, null, 2) + '\n')
    } catch (_error) { void _error }
  }
  const result = await callModel({
    system: '你住在 DSH 的 Minecraft 世界里。你在给自己定目标，不是给别人交作业。只输出 JSON。',
    prompt,
    maxTokens: 500,
    timeoutMs: 60000,
  }).catch(() => null)
  if (!result || typeof result.text !== 'string') { writeDebug({ error: 'empty', at: Date.now() }); return { ok: false, error: 'empty' } }
  const goal = parseGoal(result.text)
  if (goal === null) { writeDebug({ error: 'invalid', at: Date.now(), text: String(result.text).slice(0, 800) }); return { ok: false, error: 'invalid' } }
  const written = projectStore.handle({
    action: 'open',
    title: goal.title,
    why: goal.why,
    milestones: goal.firstStep.length > 0 ? [goal.firstStep] : [],
  })
  if (written && written.ok === true) { writeDebug({ error: '', at: Date.now(), goal }); return { ok: true, goal } }
  writeDebug({ error: 'write_failed', at: Date.now(), goal, written })
  return { ok: false, error: (written && written.error) || 'write_failed' }
}


/**
 * 带节流的立目标：没有活跃项目、距上次尝试超过 intervalMs 才跑一次。
 * 返回她自己的新目标（或 null）；节流状态写在 state.lastGoalAt。
 */
export async function runGoalRoundIfDue(options = {}) {
  const state = options.state && typeof options.state === 'object' ? options.state : {}
  const projectStore = options.projectStore ?? null
  if (projectStore === null) return { ok: false, reason: 'no_store' }
  if (typeof projectStore.get === 'function' && projectStore.get() !== null) return { ok: false, reason: 'has_project' }
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now()
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 20 * 60 * 1000
  const nowMs = nowFn()
  const lastAttempt = Number(state.lastGoalAt || 0)
  if (lastAttempt > 0 && nowMs - lastAttempt < intervalMs) return { ok: false, reason: 'throttled', waitMs: intervalMs - (nowMs - lastAttempt) }
  state.lastGoalAt = nowMs
  const result = await runGoalRound({
    callModel: options.callModel,
    debugFile: typeof options.debugFile === 'string' ? options.debugFile : '',
    projectStore,
    observation: options.observation,
    skillText: typeof options.skillText === 'string' ? options.skillText : '',
    roughText: typeof options.roughText === 'string' ? options.roughText : '',
    failures: Array.isArray(options.failures) ? options.failures : [],
    memoryLines: Array.isArray(options.memoryLines) ? options.memoryLines : [],
  })
  if (result && result.ok === true && result.goal) return { ok: true, goal: result.goal }
  return { ok: false, reason: 'round_failed', error: result ? result.error : 'no_result' }
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
  const debugFile = typeof options.debugFile === 'string' ? options.debugFile : ''
  const trace = (payload) => {
    if (debugFile.length === 0) return
    try {
      let history = []
      try { history = JSON.parse(readFileSync(debugFile, 'utf8')) } catch (_error) { history = [] }
      if (!Array.isArray(history)) history = []
      history.push({ at: Date.now(), ...payload })
      writeFileSync(debugFile, JSON.stringify(history.slice(-20), null, 2) + '\n')
    } catch (_error) { void _error }
  }
  return async function selfGoal(state = {}) {
    trace({ step: 'enter', hasProject: projectStore !== null && typeof projectStore.get === 'function' ? projectStore.get() !== null : null, lastGoalAt: Number(state.lastGoalAt || 0) })
    if (projectStore === null || callModel === null) { trace({ step: 'unavailable' }); return null }
    try {
      const profile = skillProfile(toolCountsOf(options.toolSkills))
      const roughText = String(roughTextOf(options.toolSkills) || '')
      const round = await runGoalRoundIfDue({
        state,
        projectStore,
        now,
        intervalMs,
        debugFile,
        observation: state.observation,
        skillText: profile.categories.filter((item) => item.count > 0).map((item) => item.name + item.count).join('、'),
        roughText,
        failures: (Array.isArray(state.commandHistory) ? state.commandHistory : []).filter((item) => item.ok === false).slice(-3).map((item) => item.tool + ' 没成功'),
        memoryLines: gameMemory && typeof gameMemory.promptLines === 'function' ? gameMemory.promptLines(2) : [],
        callModel,
      })
      trace({ step: 'round', ...(round && typeof round === 'object' ? round : { round }) })
      const goal = round && round.ok === true ? round.goal : null
      if (goal && gameMemory && typeof gameMemory.record === 'function') {
        try { gameMemory.record({ category: 'plan', text: `她自己立项：「${goal.title}」`, source: 'self-goal' }) } catch (_error) {}
      }
      return goal
    } catch (error) {
      trace({ step: 'threw', message: error instanceof Error ? error.message : String(error) })
      try {
        if (typeof debugFile === 'string' && debugFile.length > 0) {
          writeFileSync(debugFile, JSON.stringify({ error: 'threw', at: Date.now(), message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? String(error.stack || '').slice(0, 600) : '' }, null, 2) + '\n')
        }
      } catch (_writeError) { void _writeError }
      return null
    }
  }
}


/** 项目卡住时的复盘 prompt：只给三个选项，让她自己选怎么处理。 */
export function buildReviewPrompt(context = {}) {
  const project = context.project && typeof context.project === 'object' ? context.project : {}
  const obs = context.observation && typeof context.observation === 'object' ? context.observation : {}
  const hours = Math.max(1, Math.round(Number(context.hours) || 1))
  const milestones = Array.isArray(project.milestones) ? project.milestones : []
  return [
    '你之前给自己立过一个项目，但它已经有一段时间没有推进了。现在不是让你继续硬做，而是让你自己决定怎么处理它。',
    `项目：${project.title || '未命名'}（为什么：${project.why || '没写'}）。阶段：${project.stage || '开始'}。`,
    milestones.length > 0 ? `还没做完的里程碑：${milestones.join('、')}。` : '它已经没有未完成的里程碑了。',
    context.evidenceText ? `你已经具备的：${context.evidenceText}（这不一定等于完成了里程碑，你可以自己判断）。` : '',
    `它大约 ${hours} 小时没有推进。你现在的位置 ${obs.position || '未知'}；血 ${obs.health ?? '?'}/20；饥饿 ${obs.food ?? '?'}/20；时间 ${obs.timeOfDay || '未知'}。`,
    ...(Array.isArray(context.ladder) ? context.ladder : []),
    '四个选项，选一个：',
    '1) grow：这一步做到了，往上加一层更大的目标（写下更大的目标和新里程碑）；',
    '2) continue：继续做原来的目标，写下这一步具体做什么；',
    '3) shrink：这个目标太大了，缩小成更小的版本（写新的里程碑）；',
    '4) close：先收尾，把经验记下来，之后再做别的。',
    '小目标达成后，默认该往上走（grow）；只有确实做不动时才 shrink 或 close。',
    '只输出 JSON：{"decision":"grow|continue|shrink|close","note":"一句话理由","next":"下一步或更大的目标","milestones":["grow 时的 2-3 条新里程碑"]}',
  ].join('\n')
}

export function parseReview(text) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (start < 0 || last <= start) return null
  let raw = null
  try { raw = JSON.parse(source.slice(start, last + 1)) } catch (_error) { return null }
  if (!raw || typeof raw !== 'object') return null
  const decision = String(raw.decision ?? '').trim().toLowerCase()
  if (!['grow', 'continue', 'shrink', 'close'].includes(decision)) return null
  return {
    decision,
    note: String(raw.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    next: String(raw.next ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
    milestones: Array.isArray(raw.milestones) ? raw.milestones.map((item) => String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 3) : [],
  }
}

/** 跑一次复盘回合，并按她的选择改项目本子。 */
export async function runProjectReview(options = {}) {
  const callModel = typeof options.callModel === 'function' ? options.callModel : null
  const projectStore = options.projectStore ?? null
  const project = projectStore && typeof projectStore.get === 'function' ? projectStore.get() : null
  if (callModel === null || project === null) return { ok: false, reason: 'unavailable' }
  const prompt = buildReviewPrompt({ project, observation: options.observation, hours: options.hours, evidenceText: project.evidence && project.evidence.note ? project.evidence.note : '', ladder: Array.isArray(options.ladder) ? options.ladder : [] })
  const result = await callModel({ system: '你住在 DSH 的 Minecraft 世界里。你在复盘自己立的项目，只输出 JSON。', prompt, maxTokens: 400, timeoutMs: 60000 }).catch(() => null)
  if (!result || typeof result.text !== 'string') return { ok: false, reason: 'empty' }
  const review = parseReview(result.text)
  if (review === null) return { ok: false, reason: 'invalid', text: String(result.text).slice(0, 400) }
  if (review.decision === 'close') {
    const closed = projectStore.handle({ action: 'close', note: review.note || '复盘后收尾' })
    return { ok: true, review, closed: Boolean(closed && closed.ok) }
  }
  if (review.decision === 'grow') {
    const bigger = review.next.length > 0 ? review.next : (review.note || '再往前一步')
    const milestones = review.milestones.length > 0 ? review.milestones : [bigger]
    const grown = projectStore.handle({ action: 'grow', title: bigger, milestones, note: review.note })
    return { ok: true, review, grown: Boolean(grown && grown.ok), title: bigger, milestones }
  }
  if (review.decision === 'shrink') {
    // 缩小目标必须留下一个更小的里程碑；她没写就沿用原来的，绝不能清空（清空=没有下一步）
    const current = Array.isArray(project.milestones) ? project.milestones : []
    const target = review.next.length > 0 ? review.next : current[0] || ''
    if (target.length > 0) {
      const updated = projectStore.handle({ action: 'step', stage: '缩小目标', note: review.note, milestones: [target] })
      return { ok: true, review, updated: Boolean(updated && updated.ok), milestone: target }
    }
    const fallback = projectStore.handle({ action: 'step', stage: '缩小目标', note: review.note })
    return { ok: true, review, updated: Boolean(fallback && fallback.ok) }
  }
  const advanced = projectStore.handle({ action: 'step', note: review.next || review.note || '继续推进' })
  return { ok: true, review, advanced: Boolean(advanced && advanced.ok) }
}


/**
 * 项目复盘节流器：项目超过 staleMs 没推进时，让她自己做一次“继续/缩小/收尾”的决定。
 * 同一个项目 6 小时内最多复盘一次，避免刷屏。
 */
export function createProjectReviewer(options = {}) {
  const projectStore = options.projectStore ?? null
  const callModel = typeof options.callModel === 'function' ? options.callModel : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const staleMs = Number(options.staleMs) > 0 ? Number(options.staleMs) : 6 * 60 * 60 * 1000
  const cooldownMs = Number(options.cooldownMs) > 0 ? Number(options.cooldownMs) : 6 * 60 * 60 * 1000
  const reviewedAt = new Map()
  return async function reviewProject(state = {}) {
    if (projectStore === null || callModel === null) return null
    const project = typeof projectStore.get === 'function' ? projectStore.get() : null
    if (project === null) return null
    const since = Number(project.lastStepAt || project.createdAt || 0)
    const idleMs = now() - since
    // 没有里程碑 = 她其实没有下一步可走，这本身就是“卡住”，不用等 6 小时
    const noMilestones = !Array.isArray(project.milestones) || project.milestones.length === 0
    const hasEvidence = Boolean(project.evidence && project.evidence.at)
    const effectiveCooldown = noMilestones || hasEvidence ? 30 * 60 * 1000 : cooldownMs
    if (!noMilestones && !hasEvidence && idleMs < staleMs) return null
    const key = project.title
    const lastReviewed = Number(reviewedAt.get(key) || 0)
    if (lastReviewed > 0 && now() - lastReviewed < effectiveCooldown) return null
    reviewedAt.set(key, now())
    try {
      return await runProjectReview({ callModel, projectStore, observation: state.observation, hours: Math.round(idleMs / 3600000), ladder: typeof options.ladderOf === 'function' ? options.ladderOf(state.observation) : [] })
    } catch (_error) {
      return { ok: false, reason: 'threw' }
    }
  }
}
