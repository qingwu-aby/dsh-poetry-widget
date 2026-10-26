// lib/self-projects.mjs —— 她自己的“持续几天的小项目/章节”（v2.8，P1）。
//
// 不是任务清单：她自己在自处时决定要不要做、做什么、今天推进哪一步、什么时候收尾。
// 只存事实，不打分；项目完成后进入 completed，当前项目只保留一个。
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'
import { resolveSettingsPath } from './settings-store.mjs'

export const SELF_PROJECTS_VERSION = 1
export const SELF_PROJECTS_TITLE_MAX = 60
export const SELF_PROJECTS_NOTE_MAX = 160
export const SELF_PROJECTS_STEP_MAX = 160
export const SELF_PROJECTS_STEPS_MAX = 24
export const SELF_PROJECTS_COMPLETED_MAX = 50

function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
      return { at: typeof step.at === 'number' && Number.isFinite(step.at) ? step.at : null, text }
    }
    const normalizeProject = (item, fallbackAt = null) => {
      if (!isPlainObject(item)) return null
      const title = cleanInline(item.title, SELF_PROJECTS_TITLE_MAX)
      if (title.length < 2) return null
      const note = cleanInline(item.note, SELF_PROJECTS_NOTE_MAX)
      const steps = (Array.isArray(item.steps) ? item.steps : []).map(normalizeStep).filter(Boolean).slice(-SELF_PROJECTS_STEPS_MAX)
      return {
        id: typeof item.id === 'string' && item.id.length > 0 ? item.id.slice(0, 80) : `project-${fallbackAt ?? 0}`,
        title,
        note,
        createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : fallbackAt,
        updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : fallbackAt,
        steps,
      }
    }
    const completed = (Array.isArray(parsed.completed) ? parsed.completed : [])
      .map((item) => {
        const project = normalizeProject(item, null)
        if (!project) return null
        return {
          ...project,
          endedAt: typeof item.endedAt === 'number' && Number.isFinite(item.endedAt) ? item.endedAt : null,
          outcome: item.outcome === 'drop' ? 'drop' : 'done',
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

  function persist() {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, { ok: true, v: SELF_PROJECTS_VERSION, current, completed })
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
    if (title.length < 2 && step.length < 4 && status === '') return null
    return { title, step, status }
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
        steps: input.step.length >= 4 ? [{ at, text: input.step }] : [],
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
        ...(input.step.length >= 4 ? { steps: current.steps.concat([{ at, text: input.step }]).slice(-SELF_PROJECTS_STEPS_MAX) } : {}),
      }
      completed.push(ended)
      if (completed.length > SELF_PROJECTS_COMPLETED_MAX) completed.splice(0, completed.length - SELF_PROJECTS_COMPLETED_MAX)
      current = null
      persist()
      return { action: 'ended', project: ended }
    }
    if (input.step.length >= 4) {
      current = {
        ...current,
        updatedAt: at,
        steps: current.steps.concat([{ at, text: input.step }]).slice(-SELF_PROJECTS_STEPS_MAX),
      }
      persist()
      return { action: 'stepped', project: current }
    }
    return null
  }

  function snapshot() {
    return {
      current,
      completedCount: completed.length,
      recentCompleted: completed.slice(-3),
    }
  }

  function description() {
    if (current === null) return ''
    const last = current.steps.length > 0 ? current.steps[current.steps.length - 1].text : current.note
    return `${current.title}${last.length > 0 ? `（最近：${last}）` : ''}`
  }

  return { file, apply, snapshot, description, current: () => current, completed: () => completed.slice() }
}
