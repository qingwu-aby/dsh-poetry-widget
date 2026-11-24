// @ts-check
// 她的 Minecraft 长期项目草稿本：她自己写、自己推进、自己收尾；宿主只存取与提示，不派任务。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const MAX_MILESTONES = 5
function clean(value, max) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) }

export function createMinecraftProjectStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const file = typeof options.file === 'string' ? options.file : ''
  let state = { project: null }
  function load() {
    if (file.length === 0) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      if (raw && isObject(raw.project)) state.project = raw.project
    } catch (_error) { void _error }
  }
  function save() {
    if (file.length === 0) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ project: state.project, updatedAt: now() }, null, 2) + '\n')
    } catch (_error) { void _error }
  }
  load()
  function get() { return state.project ? { ...state.project, milestones: state.project.milestones.slice() } : null }
  function touch(project) { project.updatedAt = now(); project.lastStepAt = now(); return project }
  function open(input) {
    const title = clean(input.title, 80)
    if (title.length === 0) return { ok: false, error: 'title_required' }
    const milestones = Array.isArray(input.milestones) ? input.milestones.map((m) => clean(m, 60)).filter(Boolean).slice(0, MAX_MILESTONES) : []
    state.project = touch({ title, why: clean(input.why, 200), milestones, stage: clean(input.stage, 40) || '开始', blockers: [], notes: [], plan: null, createdAt: now(), closedAt: 0 })
    save()
    return { ok: true, project: get(), detail: '开始了项目：' + title }
  }
  function step(input) {
    const project = state.project
    if (!project) return { ok: false, error: 'no_project', detail: '还没有项目' }
    const done = clean(input.done, 60)
    if (done.length > 0) project.milestones = project.milestones.filter((item) => item !== done)
    const stage = clean(input.stage, 40)
    if (stage.length > 0) project.stage = stage
    const blocker = clean(input.blocker, 80)
    project.blockers = blocker.length > 0 ? [blocker] : []
    const note = clean(input.note, 160)
    if (note.length > 0) project.notes = [...project.notes.slice(-4), note]
    touch(project)
    save()
    return { ok: true, project: get(), detail: '推进了一步：' + (stage || done || note || '已记录') }
  }
  /** 把施工蓝图挂到当前项目上，后面 mc_build 的成功/失败都记在这里。 */
  function attachPlan(plan) {
    const project = state.project
    if (!project || !plan || typeof plan !== 'object') return null
    const blocks = Array.isArray(plan.blocks) ? plan.blocks.length : Number.isFinite(Number(plan.blocks)) ? Math.max(0, Math.floor(Number(plan.blocks))) : 0
    project.plan = { goal: clean(plan.goal, 120), name: clean(plan.name, 80), blocks, placed: 0, done: false, at: now() }
    touch(project)
    save()
    return project.plan
  }
  /** 施工回执：累计已放块数；蓝图放完就把对应里程碑划掉。 */
  function noteBuild(result = {}) {
    const project = state.project
    if (!project || !project.plan) return null
    const facts = isObject(result.facts) ? result.facts : {}
    const placed = Number(facts.placed)
    if (Number.isFinite(placed) && placed > 0) project.plan.placed = Math.min(project.plan.blocks || placed, (project.plan.placed || 0) + placed)
    if (result.ok === true && (project.plan.blocks > 0 ? project.plan.placed >= project.plan.blocks : true)) {
      project.plan.done = true
      const goal = project.plan.goal
      if (goal.length > 0) project.milestones = project.milestones.filter((item) => item !== goal)
      project.stage = '施工完成：' + (project.plan.name || goal || '一块')
      project.plan = null
    }
    touch(project)
    save()
    return project.plan
  }
  function close(input) {
    const project = state.project
    if (!project) return { ok: false, error: 'no_project' }
    const reason = clean(input.note || input.why, 120) || '收尾'
    state.project = null
    save()
    return { ok: true, closed: { title: project.title, reason }, detail: '结束项目：' + project.title + '（' + reason + '）' }
  }
  function handle(payload = {}) {
    const action = clean(payload.action, 12) || 'show'
    if (action === 'open') return open(payload)
    if (action === 'step') return step(payload)
    if (action === 'close' || action === 'drop') return close(payload)
    const project = get()
    return project ? { ok: true, project, detail: '当前项目：' + project.title } : { ok: true, project: null, detail: '还没有项目' }
  }
  function promptLines() {
    const project = get()
    if (!project) return ['如果你在做一件要跨很多步的事（比如盖一座自己的房子、修一条路、做一台机器），可以用 mc_project 写下来；不想写也没关系，短目标直接做即可。']
    const hours = Math.max(1, Math.round((now() - (project.lastStepAt || project.createdAt)) / 3600000))
    const lines = ['你给自己定的长期项目：' + project.title + (project.why ? '（' + project.why + '）' : '') + '；阶段：' + project.stage + '。']
    if (project.plan) lines.push('施工中的计划：《' + (project.plan.name || project.plan.goal || '未命名') + '》蓝图 ' + project.plan.blocks + ' 块，已放 ' + (project.plan.placed || 0) + ' 块；mc_build 会接着往下做。')
    if (project.milestones.length > 0) lines.push('还没做完的里程碑：' + project.milestones.join('、') + '。')
    if (project.blockers.length > 0) lines.push('当前卡点：' + project.blockers[0] + '；可以自己决定绕路、换材料，或先放着。')
    if (hours >= 12) lines.push('这个项目已经 ' + hours + ' 小时没推进：想继续就推进一小步，不想做就用 mc_project action=close 明确收尾，别让它一直挂着。')
    lines.push('这件事是你自己选的，随时可以改主意；生存、饥饿、夜晚安全永远优先于它。')
    return lines
  }
  return { get, handle, promptLines, attachPlan, noteBuild, snapshot: () => ({ ok: true, project: get() }) }
}
