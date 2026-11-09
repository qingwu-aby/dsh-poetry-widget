// lib/domain/being/rule-synthesis.mjs —— 从经验里长规则（v3.15）
//
// 每隔约一天，翻她自己的最近想法/行动/判断/方法，让模型提出 0–2 条“我自己的规则”，
// 存进 internal-rules；之后被引用、被结果校准。
import { callModel } from '../../kernel/model-call.mjs'
import { buildRuleSynthesisPrompt, parseRuleProposal } from './internal-rules.mjs'

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000
const FIRST_MS = 8 * 60 * 1000

export function createRuleSynthesizer(options = {}) {
  const env = options.env ?? process.env
  const rules = options.rules ?? null
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => null
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const journal = options.journal ?? null
  const thoughtChain = options.thoughtChain ?? null
  const methodMemory = options.methodMemory ?? null
  const habitMemory = options.habitMemory ?? null
  const recall = options.recall ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : DEFAULT_INTERVAL_MS
  const firstMs = Number.isFinite(options.firstMs) ? options.firstMs : FIRST_MS
  const disabled = String(env.DSH_POETRY_RULES ?? '').toLowerCase() === 'off'
  let lastResult = null
  let timer = null
  let disposed = false

  function gather() {
    const thoughts = (() => {
      try {
        if (recall && typeof recall.recentThoughts === 'function') return recall.recentThoughts(8)
        return []
      } catch (error) {
        return []
      }
    })()
    const chains = (() => {
      try {
        return thoughtChain && typeof thoughtChain.chainDigest === 'function' ? thoughtChain.chainDigest(6) : []
      } catch (error) {
        return []
      }
    })()
    const methods = (() => {
      try {
        return methodMemory && typeof methodMemory.digest === 'function' ? methodMemory.digest(6) : []
      } catch (error) {
        return []
      }
    })()
    const actions = (() => {
      try {
        const snap = habitMemory && typeof habitMemory.snapshot === 'function' ? habitMemory.snapshot() : null
        const top = snap && Array.isArray(snap.top) ? snap.top : []
        return top.map((entry) => `${entry.action}（在${entry.situation}）`).filter(Boolean)
      } catch (error) {
        return []
      }
    })()
    return { thoughts, chains, methods, actions }
  }

  async function runOnce() {
    if (disabled) return { ok: false, reason: 'disabled' }
    const material = gather()
    const total = material.thoughts.length + material.chains.length + material.methods.length + material.actions.length
    if (total < 3) return { ok: true, skipped: true, reason: 'not-enough-material' }
    const at = now()
    let proposals = []
    try {
      const result = await callModel({
        role: 'reflection',
        policy,
        resolveLlm: getLlm,
        system: '你是住在 DSH Web 角落的鲸鱼娘，在总结自己的经验；只写你真正观察到的，不写口号，不替用户下判断。',
        prompt: buildRuleSynthesisPrompt(material),
        maxTokens: 900,
        timeoutMs: 90000,
        timeoutCode: 'RULE_SYNTHESIS_TIMEOUT',
        timeoutMessage: '规则总结超时',
        prefix: '规则总结失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
      if (result !== null) proposals = parseRuleProposal(result.text)
    } catch (error) {
      return { ok: false, reason: 'llm' }
    }
    const added = []
    for (const proposal of proposals) {
      const result = rules && typeof rules.add === 'function' ? rules.add(proposal) : { added: false }
      if (result.added || result.merged) added.push(proposal.rule)
    }
    if (added.length > 0) {
      try {
        await journal?.append?.({ kind: 'thought', text: `我给自己留了条规则：${added.slice(0, 2).join('；')}` })
      } catch (error) {
        /* journal 失败不影响规则 */
      }
      logger?.info?.(`[dsh-little-whale] 内生规则：新增/合并 ${added.length} 条`)
    }
    lastResult = { at, added, proposals: proposals.length }
    return { ok: true, ...lastResult }
  }

  function tick() {
    if (disposed || timer !== null) return { ok: false, reason: 'off' }
    runOnce().catch(() => {})
    return { ok: true }
  }
  function start(startOptions = {}) {
    if (disabled || disposed || timer !== null) return
    if (startOptions && startOptions.heartbeat === true) return
    timer = setTimeout(() => {
      runOnce().catch(() => {})
      timer = setInterval(() => tick(), intervalMs)
      timer.unref?.()
    }, firstMs)
    timer.unref?.()
  }
  function dispose() {
    disposed = true
    if (timer !== null) {
      clearTimeout(timer)
      clearInterval(timer)
      timer = null
    }
  }
  return { runOnce, tick, start, dispose, snapshot: () => ({ disabled, last: lastResult, rules: rules ? rules.snapshot() : null }) }
}
