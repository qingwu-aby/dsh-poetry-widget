// lib/autonomy.mjs —— 自主节奏的环境旋钮（v2.0，用户要求“放开限制”）。
//
// 这里不替她决定做什么，只把“多久检查一次/多久允许学一次/读多久/看多久热搜”等
// 可调参数集中起来：默认值比旧版开放很多，环境变量可以继续放宽到几乎不设限。
// 业务模块自己仍按 gap 判断，不做新的强制调度。
function minutesToMs(value, fallbackMinutes) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallbackMinutes * 60 * 1000
  if (n <= 0) return 0
  return Math.round(n * 60 * 1000)
}

function numberOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 默认自主节奏（分钟/个）。旧版是 15–30min 自处、60/90min 成长、24h 读书、8h 热搜。 */
export const AUTONOMY_DEFAULTS = Object.freeze({
  driveCheckMin: 5,
  driveCheckMax: 12,
  driveRetryMin: 2,
  driveRetryMax: 6,
  driveFirstMinSec: 20,
  driveFirstMaxSec: 60,
  reflectMin: 40,
  learnMin: 25,
  probeMin: 40,
  readingMin: 90,
  wanderMin: 40,
  netlangMin: 120,
  readingFirstMinSec: 30,
  readingFirstMaxSec: 90,
  wanderFirstMinSec: 30,
  wanderFirstMaxSec: 90,
  netlangFirstMinSec: 30,
  netlangFirstMaxSec: 90,
  selfTalkThemeProbability: 0.35,
  selfTalkMinChars: 4,
  selfTalkMaxChars: 120,
})

/** 读取环境变量覆盖后的节奏（DSH_POETRY_*_MIN 等；0 表示不设下限）。 */
export function resolveAutonomy(env = process.env) {
  const d = AUTONOMY_DEFAULTS
  const seconds = (value, fallbackSec) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n * 1000 : fallbackSec * 1000
  }
  return {
    driveCheckMinMs: minutesToMs(env?.DSH_POETRY_DRIVE_MIN, d.driveCheckMin),
    driveCheckMaxMs: minutesToMs(env?.DSH_POETRY_DRIVE_MAX, d.driveCheckMax),
    driveRetryMinMs: minutesToMs(env?.DSH_POETRY_DRIVE_RETRY_MIN, d.driveRetryMin),
    driveRetryMaxMs: minutesToMs(env?.DSH_POETRY_DRIVE_RETRY_MAX, d.driveRetryMax),
    driveFirstMinMs: seconds(env?.DSH_POETRY_DRIVE_FIRST_MIN, d.driveFirstMinSec),
    driveFirstMaxMs: seconds(env?.DSH_POETRY_DRIVE_FIRST_MAX, d.driveFirstMaxSec),
    reflectIntervalMs: minutesToMs(env?.DSH_POETRY_REFLECT_MIN, d.reflectMin),
    learnIntervalMs: minutesToMs(env?.DSH_POETRY_LEARN_MIN, d.learnMin),
    probeGapMs: minutesToMs(env?.DSH_POETRY_PROBE_MIN, d.probeMin),
    readingGapMs: minutesToMs(env?.DSH_POETRY_READING_MIN, d.readingMin),
    wanderGapMs: minutesToMs(env?.DSH_POETRY_WANDER_MIN, d.wanderMin),
    netlangGapMs: minutesToMs(env?.DSH_POETRY_NETLANG_MIN, d.netlangMin),
    readingFirstMinMs: seconds(env?.DSH_POETRY_READING_FIRST_MIN, d.readingFirstMinSec),
    readingFirstMaxMs: seconds(env?.DSH_POETRY_READING_FIRST_MAX, d.readingFirstMaxSec),
    wanderFirstMinMs: seconds(env?.DSH_POETRY_WANDER_FIRST_MIN, d.wanderFirstMinSec),
    wanderFirstMaxMs: seconds(env?.DSH_POETRY_WANDER_FIRST_MAX, d.wanderFirstMaxSec),
    netlangFirstMinMs: seconds(env?.DSH_POETRY_NETLANG_FIRST_MIN, d.netlangFirstMinSec),
    netlangFirstMaxMs: seconds(env?.DSH_POETRY_NETLANG_FIRST_MAX, d.netlangFirstMaxSec),
    selfTalkThemeProbability: Math.min(1, Math.max(0, numberOr(env?.DSH_POETRY_TALK_THEME_PROBABILITY, d.selfTalkThemeProbability))),
    selfTalkMinChars: Math.max(1, numberOr(env?.DSH_POETRY_TALK_MIN_CHARS, d.selfTalkMinChars)),
    selfTalkMaxChars: Math.max(8, numberOr(env?.DSH_POETRY_TALK_MAX_CHARS, d.selfTalkMaxChars)),
  }
}
