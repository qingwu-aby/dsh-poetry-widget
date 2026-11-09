// lib/video-courses.mjs —— 她的“书架”（v2.65）。
//
// 用户投喂的长内容（B站长视频/讲座/课程）被整理进 <settings>/video-courses/<slug>/：
//   - course.json：元数据（标题、清单、每讲她的想法、全课回顾）
//   - NN.md：每讲正文（字幕转录）
// 这里只读 course.json，给记忆摘要提供一行“我看过什么课”，正文不塞进 prompt。
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveSettingsPath } from '../../kernel/settings-store.mjs'

export const VIDEO_COURSES_SHELF_LIMIT = 3
export const VIDEO_COURSE_TITLE_MAX = 40
export const VIDEO_COURSE_EPISODE_TITLE_MAX = 40
export const VIDEO_COURSE_LINE_MAX = 120

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanInline(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function resolveVideoCoursesDir(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'video-courses')
}

/** course.json → 摘要对象；坏数据返回 null。 */
export function normalizeVideoCourse(raw) {
  if (!isPlainObject(raw)) return null
  const title = cleanInline(raw.title, VIDEO_COURSE_TITLE_MAX)
  if (title.length < 2) return null
  const episodes = Array.isArray(raw.episodes) ? raw.episodes.filter((item) => isPlainObject(item)) : []
  const total = episodes.length
  const watchedRaw = Array.isArray(raw.watched) ? raw.watched.filter((item) => isPlainObject(item) && Number.isFinite(Number(item.n))) : []
  const watchedNumbers = []
  for (const item of watchedRaw) {
    const n = Math.floor(Number(item.n))
    if (n > 0 && !watchedNumbers.includes(n)) watchedNumbers.push(n)
  }
  const watched = total > 0 ? Math.min(total, watchedNumbers.length) : watchedNumbers.length
  const lastWatched = watchedRaw.length > 0 ? watchedRaw[watchedRaw.length - 1] : null
  const lastEpisode = episodes.length > 0 ? episodes[episodes.length - 1] : null
  const latestTitle = cleanInline(
    (lastWatched && (lastWatched.title || '')) || (lastEpisode && (lastEpisode.title || '')) || '',
    VIDEO_COURSE_EPISODE_TITLE_MAX,
  )
  const at = finiteNumber(raw.watchedAt) ?? finiteNumber(raw.importedAt) ?? finiteNumber(raw.updatedAt)
  return {
    slug: cleanInline(typeof raw.slug === 'string' ? raw.slug : '', 60),
    title,
    total,
    watched,
    latestTitle,
    collectionUrl: cleanInline(typeof raw.collectionUrl === 'string' ? raw.collectionUrl : '', 300),
    at,
  }
}

/** 读一个目录下所有 course.json（按时间新→旧）；目录缺失/坏文件静默跳过。 */
export function readVideoCourses(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return []
  let names = []
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  const courses = []
  for (const name of names) {
    const file = path.join(dir, name, 'course.json')
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const course = normalizeVideoCourse(parsed)
      if (course !== null) {
        if (course.slug.length === 0) course.slug = name
        courses.push(course)
      }
    } catch {
      /* 单本坏掉不影响其它 */
    }
  }
  courses.sort((left, right) => (right.at ?? 0) - (left.at ?? 0) || left.title.localeCompare(right.title, 'zh'))
  return courses
}

/** 一本书课 → prompt 里的一行。 */
export function formatVideoCourseLine(course) {
  if (!isPlainObject(course) || typeof course.title !== 'string' || course.title.length === 0) return ''
  const total = Number.isFinite(course.total) ? Math.max(0, Math.floor(course.total)) : 0
  const watched = Number.isFinite(course.watched) ? Math.max(0, Math.min(total || Infinity, Math.floor(course.watched))) : 0
  const latest = typeof course.latestTitle === 'string' ? course.latestTitle : ''
  if (total > 0) {
    if (watched >= total) return cleanInline(`${course.title}：${total} 讲全看完了${latest ? `（最后一讲：${latest}）` : ''}`, VIDEO_COURSE_LINE_MAX)
    if (watched > 0) return cleanInline(`${course.title}：看到第 ${watched} 讲（共 ${total} 讲）${latest ? `，最近是：${latest}` : ''}`, VIDEO_COURSE_LINE_MAX)
    return cleanInline(`${course.title}：${total} 讲，还没开始看`, VIDEO_COURSE_LINE_MAX)
  }
  return cleanInline(`${course.title}：${latest ? `最近看的是：${latest}` : '在书架上'}`, VIDEO_COURSE_LINE_MAX)
}

/** 记忆摘要用：最近几本书课各一行；没有就空数组。 */
export function readVideoCoursesShelf(dir, options = {}) {
  const limitRaw = Number(options.limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, VIDEO_COURSES_SHELF_LIMIT) : VIDEO_COURSES_SHELF_LIMIT
  return readVideoCourses(dir)
    .slice(0, limit)
    .map((course) => formatVideoCourseLine(course))
    .filter((line) => line.length > 0)
}
