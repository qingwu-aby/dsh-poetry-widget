// lib/media-budget.mjs —— 媒体生成预算（v2.52）。
//
// 本地静态素材合成本身不花钱，但生成会占用时间/注意力；
// 先按“每天图片/视频条数”限制；将来接付费媒体 API 时，同一条预算可加 USD 上限。
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './settings-store.mjs'

function shanghaiDay(ts = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(ts))
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}

export function resolveMediaBudgetPath(env = process.env, home = null) {
  const base = env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(home ?? '', '.dsh')
  return path.join(base, '.dsh-poetry', 'media-budget.json')
}

export function createMediaBudget(options = {}) {
  const file = path.resolve(options.file ?? resolveMediaBudgetPath(options.env ?? process.env, options.home ?? null))
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const imageLimit = Number.parseInt(String(options.imageLimit ?? process.env.DSH_POETRY_MEDIA_IMAGE_DAILY ?? '6'), 10) || 6
  const videoLimit = Number.parseInt(String(options.videoLimit ?? process.env.DSH_POETRY_MEDIA_VIDEO_DAILY ?? '2'), 10) || 2
  const usdLimit = Number.isFinite(options.usdLimit) ? options.usdLimit : Number(process.env.DSH_POETRY_MEDIA_USD_DAILY ?? '0.5') || 0.5
  let state = load()

  function load() {
    const day = shanghaiDay(now())
    try {
      if (!existsSync(file)) return { ok: true, v: 1, day, images: 0, videos: 0, spentUsd: 0 }
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      return {
        ok: true,
        v: 1,
        day: parsed.day === day ? day : day,
        images: parsed.day === day && Number.isFinite(parsed.images) ? parsed.images : 0,
        videos: parsed.day === day && Number.isFinite(parsed.videos) ? parsed.videos : 0,
        spentUsd: parsed.day === day && Number.isFinite(parsed.spentUsd) ? parsed.spentUsd : 0,
      }
    } catch {
      return { ok: true, v: 1, day, images: 0, videos: 0, spentUsd: 0 }
    }
  }

  function roll() {
    const day = shanghaiDay(now())
    if (state.day !== day) state = { ok: true, v: 1, day, images: 0, videos: 0, spentUsd: 0 }
    return state
  }

  function canMake(kind, costUsd = 0) {
    const current = roll()
    if (current.spentUsd + (Number.isFinite(costUsd) ? costUsd : 0) > usdLimit) return { ok: false, reason: 'usd' }
    if (kind === 'video' && current.videos >= videoLimit) return { ok: false, reason: 'video_daily' }
    if (kind === 'image' && current.images >= imageLimit) return { ok: false, reason: 'image_daily' }
    return { ok: true }
  }

  function record(kind, costUsd = 0) {
    const current = roll()
    if (kind === 'video') current.videos += 1
    if (kind === 'image') current.images += 1
    if (Number.isFinite(costUsd) && costUsd > 0) current.spentUsd += costUsd
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, current)
    } catch {
      /* ignore */
    }
    return { ...current }
  }

  return {
    file,
    canMake,
    record,
    snapshot: () => ({ ...roll(), imageLimit, videoLimit, usdLimit }),
  }
}
