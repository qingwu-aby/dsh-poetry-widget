// client-src/widget/models/self-model.js —— 自我状态 / 记忆中枢 / 作品 / 注意力 / 镜像 归一化。
import { num } from '../../base.js'
import { getStorage } from '../../data.js'
import { ACTION_SEEN_KEY } from './constants.js'
import { weatherUpdatedLabel } from './weather-model.js'

  /** 自驱成长状态：规范化 host self.json；数据缺失/404 返回 null（整块隐藏）。 */
  export function normalizeSelfStatus(data) {
  if (!data || data.ok === false || !data.state || typeof data.state !== 'object') return null
  const state = data.state
  const text = (value, max) => {
   const raw = String(value == null ? '' : value).trim()
   return raw.length > max ? raw.slice(0, max) : raw
  }
  const growth = data.growth && typeof data.growth === 'object' ? data.growth : {}
  const count = (key) => Math.max(0, Math.floor(num(growth[key], 0)))
  const at = (key) => {
   const value = num(growth[key], 0)
   return value > 0 ? value : 0
  }
  const rawActions = data.actions && typeof data.actions === 'object' ? data.actions : {}
  const rawProject = data.project && typeof data.project === 'object' ? data.project : null
  const context = Array.isArray(data.context) ? data.context.filter((line) => typeof line === 'string' && line.trim().length > 0).slice(0, 6).map((line) => line.trim()) : []
  return {
   // v1.51：不再有 0–100 的指标；只有她自己写的一句话 + 事实时间线。
   felt: text(data.felt || state.felt, 80),
   experiencing: text(data.experiencing || state.experiencing, 120),
   context,
   feltAt: num(state.feltAt, 0),
   sleeping: state.sleeping === true,
   sleepSince: num(state.sleepSince, 0),
   updatedAt: num(state.updatedAt, 0),
   growth: {
    learnings: count('learnings'),
    reflections: count('reflections'),
    lastLearnAt: at('lastLearnAt'),
    lastReflectAt: at('lastReflectAt'),
   },
   actions: {
    latest: normalizeSelfAction(rawActions.latest),
    recent: (Array.isArray(rawActions.recent) ? rawActions.recent : []).map(normalizeSelfAction).filter(Boolean).slice(0, 5),
   },
   project: rawProject && typeof rawProject.title === 'string'
    ? {
      id: String(rawProject.id || ''),
      title: text(rawProject.title, 60),
      note: text(rawProject.note, 160),
      steps: (Array.isArray(rawProject.steps) ? rawProject.steps : [])
        .filter((step) => step && typeof step.text === 'string')
        .slice(-3)
        .map((step) => ({
          at: num(step.at, 0),
          text: text(step.text, 160),
          repeatCount: num(step.repeatCount, 1) > 1 ? Math.floor(num(step.repeatCount, 1)) : 1,
          lastAt: num(step.lastAt, 0),
        })),
      stage: ['working', 'waiting_user', 'waiting_mirror', 'blocked', 'idle'].includes(rawProject.stage) ? rawProject.stage : 'working',
      progressAt: num(rawProject.progressAt, 0),
      latestRepeat: num(rawProject.latestRepeat, 1) > 1 ? Math.floor(num(rawProject.latestRepeat, 1)) : 1,
      staleAt: num(rawProject.staleAt, 0),
      staleReason: text(rawProject.staleReason, 120),
      attention: rawProject.attention && typeof rawProject.attention.question === 'string'
        ? { question: text(rawProject.attention.question, 200), at: num(rawProject.attention.at, 0) }
        : null,
      latestReport: rawProject.latestReport && typeof rawProject.latestReport.state === 'string'
        ? { state: text(rawProject.latestReport.state, 20), summary: text(rawProject.latestReport.summary, 240), at: num(rawProject.latestReport.at, 0) }
        : null,
    }
    : null,
  }
  }

  export function normalizeSelfAction(item) {
  if (!item || typeof item !== 'object' || item.id == null || item.id === '') return null
  return {
   id: String(item.id),
   label: String(item.label == null ? '' : item.label).slice(0, 40),
   text: String(item.text == null ? '' : item.text).slice(0, 200),
   at: num(item.at, 0),
  }
  }

  export function readSeenActionId() {
  const storage = getStorage()
  if (!storage) return ''
  try {
   return String(storage.getItem(ACTION_SEEN_KEY) || '')
  } catch (error) {
   return ''
  }
  }

  export function writeSeenActionId(id) {
  const storage = getStorage()
  if (!storage) return
  try {
   storage.setItem(ACTION_SEEN_KEY, String(id == null ? '' : id))
  } catch (error) {
  }
  }

  /** 成长摘要：自学/自省次数 + weatherUpdatedLabel 风格时间；无数据「尚未开始」。 */
  export function selfStatusSummary(status) {
  if (!status) return ''
  const growth = status.growth || {}
  const learnings = Math.max(0, Math.floor(num(growth.learnings, 0)))
  const reflections = Math.max(0, Math.floor(num(growth.reflections, 0)))
  const lastLearn = weatherUpdatedLabel(growth.lastLearnAt)
  const lastReflect = weatherUpdatedLabel(growth.lastReflectAt)
  if (!learnings && !reflections && !lastLearn && !lastReflect) return '尚未开始'
  const parts = ['自学 ' + learnings + ' 条', '自省 ' + reflections + ' 次']
  if (lastLearn) parts.push('上次自学 ' + lastLearn)
  if (lastReflect) parts.push('上次自省 ' + lastReflect)
  return parts.join(' · ')
  }

  /** 记忆中枢状态规范化：health/files/backups/recovered；404/非法返回 null（整卡隐藏）。 */
  export function normalizeMemoryStatus(data) {
  if (!data || data.ok === false || !Array.isArray(data.files)) return null
  const files = data.files.filter((file) => file && typeof file === 'object')
  const countBy = (patterns) => {
   let sum = 0
   for (const file of files) {
    const id = String(file.id || '') + ' ' + String(file.path || '')
    if (!patterns.some((pattern) => id.toLowerCase().indexOf(pattern) >= 0)) continue
    sum += Math.max(0, Math.floor(num(file.entries, 0)))
   }
   return sum
  }
  const health = data.health === 'warn' || data.health === 'error' ? data.health : data.health === 'ok' ? 'ok' : 'warn'
  const backups = data.backups && typeof data.backups === 'object' ? data.backups : {}
  const recovered = typeof data.recovered === 'number'
   ? Math.max(0, Math.floor(data.recovered))
   : data.recovered && typeof data.recovered === 'object' && typeof data.recovered.count === 'number'
    ? Math.max(0, Math.floor(data.recovered.count))
    : data.recovered === true ? 1 : 0
  return {
   health,
   journal: countBy(['journal']),
   topics: countBy(['topic']),
   learnings: countBy(['learn', 'growth', 'self']),
   backups: {
    count: Math.max(0, Math.floor(num(backups.count, 0))),
    lastAt: num(backups.lastAt, 0),
    latestId: String(backups.latestId || ''),
   },
   recovered,
   updatedAt: num(data.updatedAt, 0),
  }
  }

  /** 作品列表归一化：SVG 转 data URL，文字保留。 */
  export function normalizeWorks(raw) {
   if (!raw || raw.ok === false || !Array.isArray(raw.works)) return { works: [] }
   const works = []
   for (const item of raw.works) {
    if (!item || typeof item.title !== 'string') continue
    const kind = item.kind === 'svg' || item.kind === 'image' || item.kind === 'video' ? item.kind : 'text'
    const body = typeof item.body === 'string' ? String(item.body) : ''
    if (kind === 'text' && body.length < 4) continue
    const mediaUrl = typeof item.mediaUrl === 'string' && item.mediaUrl.length > 0 ? item.mediaUrl : ''
    if ((kind === 'image' || kind === 'video') && mediaUrl.length === 0) continue
    works.push({
     id: String(item.id || ''),
     title: item.title.slice(0, 60),
     kind,
     createdAt: num(item.createdAt, 0),
     body: kind === 'text' ? body.slice(0, 2000) : '',
     src: kind === 'svg'
      ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(body)
      : kind === 'image' || kind === 'video'
       ? mediaUrl
       : '',
    })
    if (works.length >= 6) break
   }
   return { works }
  }

  /** 注意力：主动消息草稿 / 需要用户处理的问题。 */
  export function normalizeAttention(raw) {
   if (!raw || raw.ok === false) return { mode: 'observe', items: [], pending: 0 }
   const mode = raw.mode === 'auto' ? 'auto' : 'observe'
   const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter((item) => item && typeof item.text === 'string' && item.status === 'pending')
    .slice(0, 10)
    .map((item) => ({
     id: String(item.id || ''),
     kind: item.kind === 'question' || item.kind === 'result' ? item.kind : 'social',
     text: String(item.text).slice(0, 500),
     reason: String(item.reason || '').slice(0, 160),
     draft: item.draft === true,
     createdAt: num(item.createdAt, 0),
    }))
   return { mode, items, pending: items.length }
  }

  export function normalizeTwinState(raw) {
   if (!raw || raw.ok === false || raw.enabled === false) return null
   const twin = raw.twin && typeof raw.twin === 'object' ? raw.twin : {}
   const projects = twin.projects && typeof twin.projects === 'object' ? twin.projects : {}
   const project = projects.current && typeof projects.current === 'object'
    ? {
      title: String(projects.current.title || '').slice(0, 60),
      stage: ['working', 'waiting_user', 'waiting_mirror', 'blocked', 'idle'].includes(projects.current.stage) ? projects.current.stage : 'working',
      question: projects.current.attention && typeof projects.current.attention.question === 'string' ? projects.current.attention.question.slice(0, 200) : '',
     }
    : null
   return { enabled: true, project }
  }

