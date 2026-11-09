// lib/self-growth.mjs —— 最小自驱成长循环（契约 v1.27 §2.16，M38）。
//
// 每 60s tick：
//   · 驱动内在状态随时间漂移（state 由外部创建）；
//   · 每 60min 自我反思：模型输出 {thought} → journal 追加 `{kind:'thought', text:'自省：…'}`；
//   · 每 90min 自学：模型输出 {question,note,topic|null} → 追加 learning-log.md；
//     合法 topic 写入 topics-candidates.json（**不直接写 topics.json**）。
// 失败也把 last*At 推进到当前（推迟到下一周期，不在每个 tick 重试）；并发不重入；20s 超时。
//
// 隐私白名单：prompt 只含时间、内在状态（数字/定性）与固定指令；不读会话正文，
// 不读用户消息，不把用户隐私写进学习日志。
import { callCandidate } from '../../kernel/llm-call.mjs'
import { naturalStyleLines } from '../voice/language-style.mjs'
import { formatJournalTime } from '../memory/memory-journal.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from '../../kernel/settings-store.mjs'
import { normalizeEffort } from '../../kernel/model-policy.mjs'
import { describeTimeline, formatBeingLine } from '../being/self-being.mjs'
import { appendFeeling, parseNewFeeling } from '../emotion/feelings.mjs'
import { compactTopicBankForArchive, mergeLearnedTopicIntoBank } from './self-talk-topics.mjs'

import {
  buildLearnPrompt,
  buildProbeProposalPrompt,
  buildProbeVerdictPrompt,
  buildReflectPrompt,
  extractGrowthJson,
  normalizeTopicCandidate,
  parseLearnResult,
  parseProbeProposal,
  parseProbeVerdict,
  parseReflectResult,
} from './self-growth-prompts.mjs'

export {
  buildLearnPrompt,
  buildProbeProposalPrompt,
  buildProbeVerdictPrompt,
  buildReflectPrompt,
  extractGrowthJson,
  normalizeTopicCandidate,
  parseLearnResult,
  parseProbeProposal,
  parseProbeVerdict,
  parseReflectResult,
} from './self-growth-prompts.mjs'

/** 循环 tick 间隔（毫秒）。 */
export const SELF_GROWTH_TICK_MS = 60 * 1000
/** 自我反思周期。 */
export const SELF_GROWTH_REFLECT_INTERVAL_MS = 40 * 60 * 1000
/** 自学周期。 */
export const SELF_GROWTH_LEARN_INTERVAL_MS = 25 * 60 * 1000
/** 单次模型调用超时（契约 v1.38 起 20s→40s）。 */
export const SELF_GROWTH_TIMEOUT_MS = 40000
/** 自学候选文件最多保留条数。 */
export const SELF_GROWTH_MAX_CANDIDATES = 500
/** 「注意力集中时的介入/试探」最小间隔（v1.62）：至少 3 小时一次，不打扰。 */
export const SELF_PROBE_GAP_MS = 40 * 60 * 1000

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, max)
}

export function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/**
 * 创建自驱成长循环。
 * @param {{
 *   state: {tick: Function, applyEvent: Function, snapshot: Function},
 *   llm?: object|(() => object|undefined|null),
 *   getLlm?: () => object|undefined|null,
 *   getSelection?: () => {provider?: string, model?: string}|null,
 *   journal?: {append: (entry: object) => Promise<object>}|null,
 *   learningLogPath: string,
 *   candidatesPath: string,
 *   topicsBankPath?: string|null,
 *   topicsArchivePath?: string|null,
 *   feelingsPath?: string|null,
 *   feelings?: object[]|{names?: Function, read?: Function}|null,
 *   topics?: object[]|{read: Function}|null,
 *   recall?: {recentThoughts?: Function, recentLearning?: Function, randomTopicSeed?: Function}|null,
 *   policy?: object|Function|null,
 *   logger?: {warn?: Function, info?: Function}|null,
 *   now?: () => number,
 *   reflectIntervalMs?: number,
 *   learnIntervalMs?: number,
 *   probeGapMs?: number,
 *   probeStatePath?: string,
 *   timeoutMs?: number,
 *   tickIntervalMs?: number,
 *   random?: () => number,
 * }} options
 */
