// lib/domain/play/practice-loop.mjs —— 贯穿生活的实践循环（v0.11.0）
//
// 把“遇到问题 → 事实 → 原因 → 假设 → 小步验证 → 复盘”做成她可复用的能力：
//   · World 的 mc_inquire 已经能调用；
//   · 这个服务给生活/心跳用：没有具体输入时不空想，有失败回执/问题时才复盘；
//   · 结果写全局 method 账本与 journal，聊天和游戏都能看到。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { callModel } from '../../kernel/model-call.mjs'
import { buildInquiryPrompt, parseInquiry } from './minecraft-inquiry.mjs'

export function createPracticeLoop(options = {}) {
  const getLlm = options.getLlm
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const methodMemory = options.methodMemory ?? null
  const journal = options.journal ?? null
  const search = options.search ?? (async () => [])
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const stateFile = options.stateFile ?? ''
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 6 * 60 * 60 * 1000
  let lastAt = 0
  if (stateFile) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
      lastAt = Number(saved.lastAt) || 0
    } catch (_error) {}
  }
  function save() {
    if (!stateFile) return
    try {
      mkdirSync(path.dirname(stateFile), { recursive: true })
      writeFileSync(stateFile, JSON.stringify({ lastAt }, null, 2) + '\n')
    } catch (_error) {}
  }
  async function reflect(input = {}) {
    const problem = String(input.problem || '').slice(0, 200)
    const receipts = Array.isArray(input.receipts) ? input.receipts.slice(-6) : []
    const hasEvidence = problem.length > 0 || receipts.length > 0
    if (!hasEvidence) return { ok: false, skipped: true, reason: 'no_evidence' }
    const sources = await search('Minecraft 问题 ' + problem).catch(() => [])
    const memoryLines = methodMemory && typeof methodMemory.digest === 'function' ? methodMemory.digest(4) : []
    let result = null
    try {
      result = await callModel({
        role: 'thinking',
        policy,
        resolveLlm: getLlm,
        system: '你住在 DSH 的鲸鱼娘插件里。你在复盘一件做不通的事，只输出 JSON，不解释。',
        prompt: buildInquiryPrompt({ problem, observations: Array.isArray(input.observations) ? input.observations : [], receipts, memoryLines }, sources),
        maxTokens: 800,
        timeoutMs: 45000,
        timeoutCode: 'PRACTICE_TIMEOUT',
        timeoutMessage: '实践复盘超时',
        prefix: '实践复盘失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (result === null) return { ok: false, error: 'llm' }
    const inquiry = parseInquiry(result.text)
    if (!inquiry) return { ok: false, error: 'invalid' }
    lastAt = now()
    save()
    if (methodMemory && typeof methodMemory.record === 'function') {
      try {
        methodMemory.record({
          name: inquiry.hypothesis.slice(0, 40) || inquiry.problem.slice(0, 40),
          howTo: [inquiry.cause, inquiry.next].filter(Boolean).join(' → ').slice(0, 200),
          source: '实践复盘',
        })
      } catch (_error) {}
    }
    if (journal && typeof journal.append === 'function') {
      try {
        journal.append({ kind: 'thought', text: `实践复盘：${inquiry.problem}。原因：${inquiry.cause}。下一步：${inquiry.next}` }).catch(() => {})
      } catch (_error) {}
    }
    return { ok: true, inquiry, sources: sources.length }
  }
  async function maybeRun(input = {}) {
    if (now() - lastAt < intervalMs) return { ok: false, skipped: true, reason: 'interval' }
    const receipts = Array.isArray(input.receipts) ? input.receipts.filter((receipt) => receipt && receipt.ok === false) : []
    if (!input.problem && receipts.length === 0) return { ok: false, skipped: true, reason: 'no_failure' }
    return reflect({ ...input, receipts, problem: input.problem || `最近反复失败：${receipts[0].tool} ${receipts[0].detail || ''}` })
  }
  return { reflect, maybeRun, lastAt: () => lastAt }
}
