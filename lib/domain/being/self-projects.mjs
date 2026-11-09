// lib/self-projects.mjs —— 她自己的“持续几天的小项目/章节”（v2.8，P1）。
//
// 不是任务清单：她自己在自处时决定要不要做、做什么、今天推进哪一步、什么时候收尾。
// 只存事实，不打分；项目完成后进入 completed，当前项目只保留一个。
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../settings-store.mjs'
import { resolveSettingsPath } from '../../settings-store.mjs'

export const SELF_PROJECTS_VERSION = 1
export const SELF_PROJECTS_TITLE_MAX = 60
export const SELF_PROJECTS_NOTE_MAX = 160
export const SELF_PROJECTS_STEP_MAX = 160
export const SELF_PROJECTS_STEPS_MAX = 24
export const SELF_PROJECTS_COMPLETED_MAX = 50
export const SELF_PROJECTS_DUE_MIN_HOURS = 4
export const SELF_PROJECTS_DUE_MAX_HOURS = 168
export const SELF_PROJECTS_MISS_GRACE_MS = 6 * 60 * 60 * 1000
export const PROJECT_STAGES = Object.freeze(['working', 'waiting_user', 'waiting_mirror', 'blocked', 'idle'])
export const PROJECT_REPORT_STATES = Object.freeze(['progress', 'ready', 'waiting', 'blocked', 'failed', 'dropped'])

function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stepNorm(text) {
  return String(text ?? '').replace(/[\s，。！？；：、,.!?;:…—\-"'“”‘’（）()]/g, '').toLowerCase()
}

function stepBigrams(text) {
  const value = stepNorm(text)
  const set = new Set()
  for (let i = 0; i + 1 < value.length; i += 1) set.add(value.slice(i, i + 2))
  return set
}

function stepSimilar(a, b) {
  const left = stepBigrams(a)
  const right = stepBigrams(b)
  if (left.size === 0 || right.size === 0) return stepNorm(a) === stepNorm(b)
  let overlap = 0
  for (const gram of left) if (right.has(gram)) overlap += 1
  return (2 * overlap) / (left.size + right.size) >= 0.86
}

/** 合并连续相似步骤：保留第一次的时间/文字，记录 repeatCount 与 lastAt。 */
function compactSteps(steps) {
  const out = []
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step || typeof step.text !== 'string') continue
    const previous = out[out.length - 1]
    if (previous && stepSimilar(previous.text, step.text)) {
      previous.repeatCount = (previous.repeatCount || 1) + (step.repeatCount || 1)
      previous.lastAt = step.lastAt || step.at || previous.lastAt || previous.at
      if (step.report && step.report !== 'progress') previous.report = step.report
      continue
    }
    out.push({ ...step, repeatCount: step.repeatCount || 1, lastAt: step.lastAt || step.at })
  }
  return out
}

/** 追加一步；如果和最近一步高度相似，不新增，只更新 lastAt/repeatCount/report。 */
function appendStep(steps, step) {
  const out = (Array.isArray(steps) ? steps : []).map((item) => ({ ...item }))
  const previous = out[out.length - 1]
  if (previous && stepSimilar(previous.text, step.text)) {
    previous.repeatCount = (previous.repeatCount || 1) + (step.repeatCount || 1)
    previous.lastAt = step.at
    if (step.report && step.report !== 'progress') previous.report = step.report
    return { steps: out, merged: true }
  }
  out.push({ ...step, repeatCount: step.repeatCount || 1, lastAt: step.lastAt || step.at })
  return { steps: out, merged: false }
}

/** 最近一次“真正的新步骤”时间：重复合并只更新 lastAt，不改 at。 */
export function projectProgressAt(project) {
  if (!project || typeof project !== 'object') return null
  const steps = Array.isArray(project.steps) ? project.steps : []
  const last = steps[steps.length - 1]
  if (last && typeof last.at === 'number' && Number.isFinite(last.at)) return last.at
  if (typeof project.lastStepAt === 'number' && Number.isFinite(project.lastStepAt)) return project.lastStepAt
  return typeof project.updatedAt === 'number' && Number.isFinite(project.updatedAt) ? project.updatedAt : null
}

export function resolveProjectsPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'projects.json')
}

/** 读 projects.json（缺失/坏文件 → 空状态，不抛）。 */
export function readSelfProjects(file) {
  const empty = { ok: true, v: SELF_PROJECTS_VERSION, current: null, completed: [] }
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return empty
  }
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) return empty
    const normalizeStep = (step) => {
      if (!isPlainObject(step) || typeof step.text !== 'string') return null
      const text = cleanInline(step.text, SELF_PROJECTS_STEP_MAX)
      if (text.length < 4) return null
      return {
        at: typeof step.at === 'number' && Number.isFinite(step.at) ? step.at : null,
        text,
        ...(typeof step.report === 'string' ? { report: step.report.slice(0, 20) } : {}),
        repeatCount: Number.isFinite(step.repeatCount) && step.repeatCount > 1 ? Math.floor(step.repeatCount) : 1,
        ...(typeof step.lastAt === 'number' && Number.isFinite(step.lastAt) ? { lastAt: step.lastAt } : {}),
      }
    }
    const normalizeProject = (item, fallbackAt = null) => {
      if (!isPlainObject(item)) return null
      const title = cleanInline(item.title, SELF_PROJECTS_TITLE_MAX)
      if (title.length < 2) return null
      const note = cleanInline(item.note, SELF_PROJECTS_NOTE_MAX)
      const steps = compactSteps((Array.isArray(item.steps) ? item.steps : []).map(normalizeStep).filter(Boolean)).slice(-SELF_PROJECTS_STEPS_MAX)
      const stage = PROJECT_STAGES.includes(item.stage) ? item.stage : 'working'
      const latestReport = isPlainObject(item.latestReport) && PROJECT_REPORT_STATES.includes(item.latestReport.state)
        ? { state: item.latestReport.state, summary: cleanInline(item.latestReport.summary, 240), at: Number.isFinite(item.latestReport.at) ? item.latestReport.at : fallbackAt }
        : null
      const attention = isPlainObject(item.attention) && typeof item.attention.question === 'string'
        ? { id: cleanInline(item.attention.id, 80) || 'attention', question: cleanInline(item.attention.question, 200), at: Number.isFinite(item.attention.at) ? item.attention.at : fallbackAt }
        : null
      return {
        id: typeof item.id === 'string' && item.id.length > 0 ? item.id.slice(0, 80) : `project-${fallbackAt ?? 0}`,
        title,
        note,
        createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : fallbackAt,
        updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : fallbackAt,
        dueAt: typeof item.dueAt === 'number' && Number.isFinite(item.dueAt) ? item.dueAt : null,
        lastStepAt: typeof item.lastStepAt === 'number' && Number.isFinite(item.lastStepAt) ? item.lastStepAt : null,
        staleAt: typeof item.staleAt === 'number' && Number.isFinite(item.staleAt) ? item.staleAt : null,
        staleReason: typeof item.staleReason === 'string' ? item.staleReason.slice(0, 120) : '',
        steps,
        stage,
        latestReport,
        attention,
        blockedReason: typeof item.blockedReason === 'string' ? item.blockedReason.slice(0, 200) : '',
      }
    }
    const completed = (Array.isArray(parsed.completed) ? parsed.completed : [])
      .map((item) => {
        const project = normalizeProject(item, null)
        if (!project) return null
        return {
          ...project,
          endedAt: typeof item.endedAt === 'number' && Number.isFinite(item.endedAt) ? item.endedAt : null,
          outcome: item.outcome === 'drop' ? 'drop' : item.outcome === 'missed' ? 'missed' : 'done',
        }
      })
      .filter(Boolean)
      .slice(-SELF_PROJECTS_COMPLETED_MAX)
    return {
      ok: true,
      v: SELF_PROJECTS_VERSION,
      current: normalizeProject(parsed.current, null),
      completed,
    }
  } catch {
    return empty
  }
}

/**
 * 创建项目存储。模型每次自处可以返回 project 字段：
 *   { title, step, status: 'continue'|'done'|'drop' }
 * 没有 project 就保持现状；只有明确 done/drop 才结束当前项目。
 */
export function createSelfProjects(options = {}) {
  const file = path.resolve(options.file ?? resolveProjectsPath(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger ?? null
  const state = readSelfProjects(file)
  let current = state.current
  const completed = state.completed.slice()
  let attentionStore = null

  function projectAttentionId(project = current) {
    if (!project || !project.attention || typeof project.attention.id !== 'string') return ''
    return `project-${project.id}-${project.attention.id}`
  }

  function dismissProjectAttention(project = current) {
    if (attentionStore === null || typeof attentionStore.pending !== 'function') return
    const projectId = project && typeof project.id === 'string' ? project.id : ''
    for (const item of attentionStore.pending()) {
      if (item && item.meta && item.meta.projectId && (!projectId || item.meta.projectId === projectId)) {
        attentionStore.dismiss(item.id)
      }
    }
  }

  function syncProjectAttention() {
    if (attentionStore === null || typeof attentionStore.add !== 'function') return
    if (current === null) { dismissProjectAttention(null); return }
    const stage = projectStage(current)
    const attention = current.attention
    if (stage === 'waiting_user' && attention && typeof attention.question === 'string' && attention.question.trim().length > 0) {
      attentionStore.add({
        id: projectAttentionId(current),
        kind: 'question',
        text: attention.question,
        reason: `项目「${current.title}」在等你决定`,
        source: 'project',
        threadId: `project:${current.id}`,
        draft: false,
        meta: { projectId: current.id, projectTitle: current.title },
      })
    } else {
      dismissProjectAttention(current)
    }
  }

  function bindAttention(store) {
    attentionStore = store && typeof store.add === 'function' ? store : null
    syncProjectAttention()
    return { ok: true }
  }

  function answerAttention(projectId, text) {
    if (current === null || current.id !== projectId || !current.attention) return null
    const answer = cleanInline(text, 300)
    if (answer.length < 1) return null
    const at = now()
    current = {
      ...current,
      attention: null,
      stage: 'working',
      latestReport: { state: 'progress', summary: `用户回答：${answer}`, at },
      updatedAt: at,
      lastStepAt: at,
      steps: appendStep(current.steps, { at, text: `用户回答：${answer}`, report: 'progress' }).steps.slice(-SELF_PROJECTS_STEPS_MAX),
    }
    persist()
    dismissProjectAttention(current)
    return current
  }

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ok: true, v: SELF_PROJECTS_VERSION, current, completed })
      // 项目级 attention 与全局 attention 保持同步；失败不影响项目状态。
      try { syncProjectAttention() } catch { /* ignore */ }
      return true
    } catch (error) {
      try {
        logger?.warn?.(`[dsh-little-whale] 项目写入失败：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* ignore */
      }
      return false
    }
  }

  function normalizeModelProject(raw) {
    if (!isPlainObject(raw)) return null
    const title = cleanInline(raw.title, SELF_PROJECTS_TITLE_MAX)
    const step = cleanInline(raw.step, SELF_PROJECTS_STEP_MAX)
    const statusRaw = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : ''
    const status = statusRaw === 'done' || statusRaw === 'drop' ? statusRaw : statusRaw === 'continue' ? 'continue' : ''
    const stageRaw = typeof raw.stage === 'string' ? raw.stage.trim().toLowerCase() : ''
    const stage = PROJECT_STAGES.includes(stageRaw) ? stageRaw : ''
    const reportRaw = typeof raw.report === 'string' ? raw.report.trim().toLowerCase() : ''
    const report = PROJECT_REPORT_STATES.includes(reportRaw) ? reportRaw : ''
    const summary = cleanInline(raw.summary, 240)
    const question = cleanInline(raw.question, 200)
    const dueRaw = Number(raw.dueInHours)
    const dueInHours =
      Number.isFinite(dueRaw) && dueRaw >= SELF_PROJECTS_DUE_MIN_HOURS && dueRaw <= SELF_PROJECTS_DUE_MAX_HOURS
        ? Math.round(dueRaw)
        : null
    if (title.length < 2 && step.length < 4 && status === '' && dueInHours === null && stage === '' && report === '' && question === '') return null
    return { title, step, status, dueInHours, stage, report, summary, question }
  }

  /** 应用模型返回的 project；返回变化摘要或 null。 */
  function apply(raw, at = now()) {
    const input = normalizeModelProject(raw)
    if (input === null) return null
    if (current === null) {
      if (input.title.length < 2) return null
      current = {
        id: `project-${at}`,
        title: input.title,
        note: input.step.length >= 4 ? input.step : '',
        createdAt: at,
        updatedAt: at,
        dueAt: input.dueInHours !== null ? at + input.dueInHours * 60 * 60 * 1000 : null,
        lastStepAt: at,
        staleAt: null,
        staleReason: '',
        steps: input.step.length >= 4 ? appendStep([], { at, text: input.step, report: 'progress' }).steps : [],
        stage: input.stage || (input.question ? 'waiting_user' : '') || (input.report === 'blocked' || input.report === 'failed' ? 'blocked' : '') || (input.report === 'ready' || input.report === 'waiting' ? 'idle' : '') || 'working',
        latestReport: input.report ? { state: input.report, summary: input.summary || input.step, at } : null,
        attention: input.question ? { id: `attention-${at}`, question: input.question, at } : null,
        blockedReason: input.report === 'blocked' || input.report === 'failed' ? input.summary : '',
      }
      persist()
      return { action: 'started', project: current }
    }
    if (input.status === 'done' || input.status === 'drop') {
      const ended = {
        ...current,
        updatedAt: at,
        endedAt: at,
        outcome: input.status,
        stage: 'idle',
        latestReport: { state: input.status === 'done' ? 'ready' : 'dropped', summary: input.step || input.summary || '', at },
        attention: null,
        ...(input.step.length >= 4 ? { steps: appendStep(current.steps, { at, text: input.step, report: input.status === 'done' ? 'ready' : 'dropped' }).steps.slice(-SELF_PROJECTS_STEPS_MAX) } : {}),
      }
      completed.push(ended)
      if (completed.length > SELF_PROJECTS_COMPLETED_MAX) completed.splice(0, completed.length - SELF_PROJECTS_COMPLETED_MAX)
      current = null
      persist()
      return { action: 'ended', project: ended }
    }
    const nextDueAt = input.dueInHours !== null ? at + input.dueInHours * 60 * 60 * 1000 : current.dueAt
    if (input.step.length >= 4 || input.stage !== '' || input.report !== '' || input.question !== '') {
      const report = input.report || 'progress'
      const stage = input.stage
        || (input.question.length > 0 ? 'waiting_user' : '')
        || (report === 'blocked' || report === 'failed' ? 'blocked' : '')
        || (report === 'ready' || report === 'waiting' ? 'idle' : '')
        || 'working'
      const stepText = input.step.length >= 4 ? input.step : ''
      const appended = stepText.length > 0 ? appendStep(current.steps, { at, text: stepText, report }) : null
      // v2.64：重复同一步不算推进——只有真正的新步骤或明确的阶段/问题变化，才清掉 stale。
      const progressed =
        (appended !== null && appended.merged !== true) ||
        input.stage !== '' ||
        input.question.length > 0 ||
        report !== 'progress'
      current = {
        ...current,
        updatedAt: at,
        lastStepAt: at,
        ...(progressed ? { staleAt: null, staleReason: '', stage } : {}),
        latestReport: { state: report, summary: input.summary || stepText, at },
        attention: input.question.length > 0 ? { id: `attention-${at}`, question: input.question, at } : null,
        ...(progressed ? { blockedReason: report === 'blocked' || report === 'failed' ? (input.summary || '') : '' } : {}),
        ...(nextDueAt !== null ? { dueAt: nextDueAt } : {}),
        ...(appended !== null ? { steps: appended.steps.slice(-SELF_PROJECTS_STEPS_MAX) } : {}),
      }
      persist()
      return { action: progressed ? 'stepped' : 'repeated', project: current }
    }
    return null
  }

  /** 标记“搁置”：事件被放下/很久没推进时，项目不再假装还热着。 */
  function markStale(reason, at = now()) {
    if (current === null) return null
    current = { ...current, staleAt: at, staleReason: cleanInline(reason, 120), updatedAt: at, stage: 'idle' }
    persist()
    return current
  }

  /** 超过 thresholdMs 没“真正推进” → 自动标 stale；重复同一步只算活动，不算推进。 */
  function checkStale(at = now(), thresholdMs = 12 * 60 * 60 * 1000) {
    if (current === null || current.staleAt !== null) return null
    const lastProgress = projectProgressAt(current)
    if (typeof lastProgress !== 'number' || at - lastProgress <= thresholdMs) return null
    const lastStep = Array.isArray(current.steps) && current.steps.length > 0 ? current.steps[current.steps.length - 1] : null
    const repeats = lastStep !== null && Number.isFinite(lastStep.repeatCount) && lastStep.repeatCount > 1 ? Math.floor(lastStep.repeatCount) : 1
    const repeatRecent = repeats > 1 && lastStep !== null && typeof lastStep.lastAt === 'number' && at - lastStep.lastAt <= thresholdMs
    return markStale(repeatRecent ? `最近 ${repeats} 次都只是重复同一步，没有新进展` : '已经很久没推进了', at)
  }

  /** 过了截止时间 + 宽限仍未收尾 → 记一次“错过”，项目结束（不可回滚）。 */
  function expire(at = now()) {
    if (current === null || typeof current.dueAt !== 'number') return null
    if (at <= current.dueAt + SELF_PROJECTS_MISS_GRACE_MS) return null
    const ended = {
      ...current,
      updatedAt: at,
      endedAt: at,
      outcome: 'missed',
      missedDueAt: current.dueAt,
    }
    completed.push(ended)
    if (completed.length > SELF_PROJECTS_COMPLETED_MAX) completed.splice(0, completed.length - SELF_PROJECTS_COMPLETED_MAX)
    current = null
    persist()
    return ended
  }

  /** 用户从面板点“继续/重试”：只对 blocked/idle/stale 项目生效，不越过等待回答。 */
  function retryProject(projectId, at = now()) {
    if (current === null || current.id !== projectId) return null
    const stage = projectStage(current)
    if (stage === 'waiting_user') return null
    if (stage !== 'blocked' && stage !== 'idle' && current.stage !== 'working' && current.staleAt === null) return null
    current = {
      ...current,
      stage: 'working',
      attention: null,
      staleAt: null,
      staleReason: '',
      blockedReason: '',
      latestReport: { state: 'progress', summary: '用户让我继续。', at },
      updatedAt: at,
      lastStepAt: at,
      steps: appendStep(current.steps, { at, text: '用户让我继续。', report: 'progress' }).steps.slice(-SELF_PROJECTS_STEPS_MAX),
    }
    persist()
    return current
  }

  /** 暂时不动：不结束项目，也不清空已有步骤。 */
  function pauseProject(projectId, at = now()) {
    if (current === null || current.id !== projectId) return null
    if (projectStage(current) === 'waiting_user') return null
    current = {
      ...current,
      stage: 'idle',
      latestReport: { state: 'waiting', summary: '先停一下。', at },
      updatedAt: at,
    }
    persist()
    return current
  }

  /** 用户明确放弃：进入 completed，outcome=drop。 */
  function dropProject(projectId, at = now()) {
    if (current === null || current.id !== projectId) return null
    const ended = {
      ...current,
      updatedAt: at,
      endedAt: at,
      outcome: 'drop',
      stage: 'idle',
      attention: null,
      latestReport: { state: 'dropped', summary: '用户明确放弃了这个项目。', at },
    }
    completed.push(ended)
    if (completed.length > SELF_PROJECTS_COMPLETED_MAX) completed.splice(0, completed.length - SELF_PROJECTS_COMPLETED_MAX)
    current = null
    persist()
    return ended
  }

  function dueState(at = now()) {
    if (current === null || typeof current.dueAt !== 'number') return { dueAt: null, overdue: false, remainingMs: null }
    return {
      dueAt: current.dueAt,
      overdue: at > current.dueAt,
      remainingMs: Math.max(0, current.dueAt - at),
    }
  }

  function snapshot() {
    const stage = current === null ? 'idle' : projectStage(current)
    const progressAt = current === null ? null : projectProgressAt(current)
    const lastStep = current !== null && Array.isArray(current.steps) && current.steps.length > 0 ? current.steps[current.steps.length - 1] : null
    const latestRepeat = lastStep !== null && Number.isFinite(lastStep.repeatCount) && lastStep.repeatCount > 1 ? Math.floor(lastStep.repeatCount) : 1
    return {
      current: current === null ? null : { ...current, stage, progressAt, latestRepeat },
      stage,
      attention: current && current.attention ? current.attention : null,
      latestReport: current && current.latestReport ? current.latestReport : null,
      due: dueState(),
      completedCount: completed.length,
      recentCompleted: completed.slice(-3),
    }
  }

  function description() {
    if (current === null) return ''
    const last = current.steps.length > 0 ? current.steps[current.steps.length - 1].text : current.note
    const due = dueState()
    const dueText =
      due.dueAt === null
        ? ''
        : due.overdue
          ? '（已经过期）'
          : `（还剩约 ${Math.max(1, Math.round(due.remainingMs / 3600000))} 小时）`
    const staleText =
      current.staleAt === null
        ? ''
        : `（已搁置${current.staleReason ? `：${current.staleReason}` : ''}）`
    const stageText = current.stage === 'waiting_user' ? '（在等一个回答）' : current.stage === 'waiting_mirror' ? '（在等镜像回信）' : current.stage === 'blocked' ? '（卡住了）' : current.stage === 'idle' ? '（暂时不动）' : ''
    const questionText = current.attention && current.attention.question ? `（想问：${current.attention.question}）` : ''
    return `${current.title}${last.length > 0 ? `（最近：${last}）` : ''}${stageText}${questionText}${dueText}${staleText}`
  }

  return {
    file,
    apply,
    expire,
    dueState,
    markStale,
    checkStale,
    snapshot,
    description,
    current: () => current,
    completed: () => completed.slice(),
    bindAttention,
    answerAttention,
    retryProject,
    pauseProject,
    dropProject,
    syncAttention: syncProjectAttention,
  }
}


/** 最小 Project stage：从持久化事实推导，不靠内存 flag。 */
export function projectStage(project) {
  if (!project || typeof project !== 'object') return 'idle'
  const report = project.latestReport && project.latestReport.state
  if (project.attention && typeof project.attention.question === 'string' && project.attention.question.length > 0) return 'waiting_user'
  if (project.stage === 'blocked' || report === 'blocked' || report === 'failed') return 'blocked'
  if (project.stage === 'waiting_mirror') return 'waiting_mirror'
  if (report === 'ready' || report === 'waiting' || project.stage === 'idle') return 'idle'
  return 'working'
}

/** 可以重试/继续的 stage：只有 blocked 或旧的 stale 项目。 */
export function projectCanRetry(project) {
  if (!project || typeof project !== 'object') return false
  return projectStage(project) === 'blocked' || (typeof project.staleAt === 'number' && project.staleAt > 0)
}
