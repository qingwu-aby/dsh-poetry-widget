// lib/predict-check.mjs —— 预测与观测的比对（v2.74 改造 A）
//
// 她做动作前会写下 expect；世界反馈账本里会记录真实观测。这里把两者粗粒度对齐：
// 观测失败/内容对不上 → 高“惊讶”。惊讶不是分数展示，只用来让她下一轮优先处理
// “和预想不一样”的事（World Models / Curiosity / Inner Monologue 的最小版本）。
export const PREDICT_SURPRISE_SURFACE = 0.62

function clean(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function bigrams(text) {
  const value = String(text ?? '').replace(/[^\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]+/gu, '').toLowerCase()
  const chars = Array.from(value)
  const set = new Set()
  for (let index = 0; index + 1 < chars.length; index += 1) set.add(`${chars[index]}${chars[index + 1]}`)
  return set
}

/** 0 = 完全符合预想；1 = 完全对不上（或直接失败）。 */
export function compareExpectation(expect, observation) {
  const expectation = clean(expect, 200)
  const obs = observation && typeof observation === 'object' ? observation : {}
  if (expectation.length < 4) return { surprise: 0, reason: '', overlap: 1 }
  if (obs.ok !== true) return { surprise: 1, reason: '结果和预想的相反：没成', overlap: 0 }
  const observed = clean(obs.summary, 240)
  if (observed.length === 0) return { surprise: 0.3, reason: '没有可对比的观测细节', overlap: 0 }
  const left = bigrams(expectation)
  const right = bigrams(observed)
  if (left.size === 0 || right.size === 0) {
    const same = expectation === observed
    return { surprise: same ? 0 : 0.5, reason: same ? '和预想一致' : '没法逐字对比', overlap: same ? 1 : 0 }
  }
  let overlap = 0
  for (const gram of left) if (right.has(gram)) overlap += 1
  const score = (2 * overlap) / (left.size + right.size)
  const surprise = Math.max(0, Math.min(1, 1 - score))
  const reason =
    surprise >= 0.8
      ? '实际发生的和预想的几乎对不上'
      : surprise >= PREDICT_SURPRISE_SURFACE
        ? '实际和预想有一部分不一样'
        : '大体符合预想'
  return { surprise, reason, overlap: score }
}

export function shouldSurfaceSurprise(value) {
  return Boolean(value && Number.isFinite(value.surprise) && value.surprise >= PREDICT_SURPRISE_SURFACE)
}

/** prompt 用的一行：她上次以为 X，实际发生 Y。 */
export function formatExpectationSurprise(expect, observation, comparison = null) {
  const cmp = comparison ?? compareExpectation(expect, observation)
  if (!shouldSurfaceSurprise(cmp)) return ''
  const expected = clean(expect, 120)
  const obs = observation && typeof observation === 'object' ? observation : {}
  const actual = `${obs.ok === true ? '成了' : '没成'}：${clean(obs.summary, 140)}`
  return `你上次做一件事时以为：${expected}。实际观测是——${actual}。${cmp.reason}。`
}
