// lib/domain/learning/self-growth-log.mjs —— 自学/试探日志读写（v0.2.5 从 self-growth.mjs 拆出）
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import { formatJournalTime } from '../memory/index.mjs'
import { clampText } from './self-growth-core.mjs'

export function appendLearningLog(learningLogPath, currentNow, question, note, topic) {
  const time = formatJournalTime(currentNow)
  const lines = [`\n## ${time} · 自学\n`, `Q: ${question}\n`, `${note}\n`]
  if (topic !== null) lines.push(`候选话题：${topic.title} — ${topic.fact}\n`)
  mkdirSync(path.dirname(learningLogPath), { recursive: true })
  appendFileSync(learningLogPath, lines.join(''), 'utf8')
}

export function readProbeHistory(learningLogPath, limit = 6) {
  try {
    const text = readFileSync(learningLogPath, 'utf8')
    const sections = text.split(/\n## /).filter((section) => section.includes('· 试探'))
    return sections
      .slice(-Math.max(1, Math.floor(limit)))
      .map((section) => {
        const domain = (section.match(/类型：([^\n]+)/) || [])[1] || ''
        const title = (section.match(/题目：([^\n]+)/) || [])[1] || ''
        const verdict = (section.match(/她自己的结论：(喜欢|不喜欢)/) || [])[1]
        return {
          domain: clampText(domain.trim(), 12),
          title: clampText(title.trim(), 30),
          liked: verdict === '喜欢' ? true : verdict === '不喜欢' ? false : null,
        }
      })
      .filter((item) => item.title.length > 0)
  } catch {
    return []
  }
}

export function persistProbeState(probeStatePath, lastProbeAt) {
  try {
    mkdirSync(path.dirname(probeStatePath), { recursive: true })
    writeJsonAtomic(probeStatePath, { ok: true, v: 1, lastProbeAt })
  } catch {
    /* 状态文件失败不影响试探本身 */
  }
}

export function appendProbeLog(learningLogPath, currentNow, focus, proposal, verdict) {
  const time = formatJournalTime(currentNow)
  const lines = [
    `\n## ${time} · 试探\n`,
    `注意力落在：${focus.length > 0 ? focus : '（没写）'}\n`,
    `类型：${proposal.domain}\n`,
    `题目：${proposal.title}\n`,
    `引子：${proposal.hook}\n`,
    `看过之后：${verdict.impression}\n`,
    `她自己的结论：${verdict.liked === true ? '喜欢' : '不喜欢'}${verdict.why.length > 0 ? `——${verdict.why}` : ''}\n`,
  ]
  mkdirSync(path.dirname(learningLogPath), { recursive: true })
  appendFileSync(learningLogPath, lines.join(''), 'utf8')
}
