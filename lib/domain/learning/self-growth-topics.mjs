// lib/domain/learning/self-growth-topics.mjs —— 自学话题采样（v0.2.5 从 self-growth.mjs 拆出）
import { isPlainObject } from './self-growth-core.mjs'

export function createGrowthTopicSamplers(options = {}) {
  const topicsSource = options.topicsSource ?? null
  const random = typeof options.random === 'function' ? options.random : Math.random

  function readTopics() {
    try {
      if (Array.isArray(topicsSource)) return topicsSource
      if (topicsSource !== null && topicsSource !== undefined && typeof topicsSource.read === 'function') {
        const result = topicsSource.read()
        return result !== null && result !== undefined && Array.isArray(result.entries) ? result.entries : []
      }
      return []
    } catch {
      return []
    }
  }

  function detectRepeatedTheme(titles) {
    const list = (Array.isArray(titles) ? titles : [])
      .filter((title) => typeof title === 'string' && title.trim().length > 0)
      .map((title) => title.trim())
    if (list.length < 4) return null
    const stop = new Set(['什么', '为什么', '怎么', '可以', '一个', '这个', '那个', '自己', '我们', '他们', '时候', '没有', '不是', '真的', '而是', '觉得', '知道'])
    const counts = new Map()
    list.forEach((title, titleIndex) => {
      const chars = Array.from(title)
      const seen = new Set()
      for (let i = 0; i + 1 < chars.length; i += 1) {
        const a = chars[i]
        const b = chars[i + 1]
        if (!/[\u4e00-\u9fff]/.test(a) || !/[\u4e00-\u9fff]/.test(b)) continue
        const bigram = a + b
        if (stop.has(bigram) || seen.has(bigram)) continue
        seen.add(bigram)
        const entry = counts.get(bigram) || { titles: new Set(), first: titleIndex }
        entry.titles.add(titleIndex)
        counts.set(bigram, entry)
      }
    })
    const repeated = [...counts.entries()]
      .filter(([, entry]) => entry.titles.size >= 3)
      .sort((left, right) => right[1].titles.size - left[1].titles.size)
    if (repeated.length === 0) return null
    const phrases = repeated.slice(0, 6).map(([bigram]) => bigram)
    return { phrases, titles: repeated[0][1].titles.size }
  }

  function samplePhilosophyTopics(limit = 2) {
    const philosophyPattern = /哲学|方法|辩证|矛盾|认识论|本体论|伦理|逻辑|存在|意识|自由|实践|异化|唯物|唯心|康德|黑格尔|马克思|尼采|罗素|海德格尔|福柯|柏拉图|亚里士多德|休谟|笛卡尔|斯宾诺莎/i
    const matches = readTopics().filter(
      (topic) =>
        isPlainObject(topic) &&
        typeof topic.title === 'string' &&
        (philosophyPattern.test(topic.title) ||
          (Array.isArray(topic.tags) && topic.tags.some((tag) => typeof tag === 'string' && philosophyPattern.test(tag)))),
    )
    return matches.slice(0, Math.max(0, limit)).map((topic) => ({
      title: typeof topic.title === 'string' ? topic.title : '',
      fact: typeof topic.fact === 'string' ? topic.fact : '',
    }))
  }

  function sampleHistoryTopics(limit = 2) {
    const historyPattern = /历史|史|朝代|文明|战争|帝国|王朝|古代|近代|民国|世界史|中国史/i
    const matches = readTopics().filter(
      (topic) =>
        isPlainObject(topic) &&
        typeof topic.title === 'string' &&
        (historyPattern.test(topic.title) ||
          (Array.isArray(topic.tags) && topic.tags.some((tag) => typeof tag === 'string' && historyPattern.test(tag)))),
    )
    return matches.slice(0, Math.max(0, limit)).map((topic) => ({
      title: typeof topic.title === 'string' ? topic.title : '',
      fact: typeof topic.fact === 'string' ? topic.fact : '',
    }))
  }

  function sampleKnownTopics(limit = 8) {
    const all = readTopics().filter(
      (topic) => isPlainObject(topic) && typeof topic.title === 'string' && topic.title.trim().length > 0,
    )
    if (all.length === 0) return []
    const pool = all.slice(0, 200)
    for (let index = pool.length - 1; index > 0; index -= 1) {
      let roll = Number(random())
      if (!Number.isFinite(roll)) roll = 0
      const target = Math.floor(Math.min(0.999999, Math.max(0, roll)) * (index + 1))
      const holder = pool[index]
      pool[index] = pool[target]
      pool[target] = holder
    }
    return pool.slice(0, Math.max(1, limit)).map((topic) => ({
      title: typeof topic.title === 'string' ? topic.title : '',
      fact: typeof topic.fact === 'string' ? topic.fact : '',
    }))
  }

  return { readTopics, detectRepeatedTheme, samplePhilosophyTopics, sampleHistoryTopics, sampleKnownTopics }
}
