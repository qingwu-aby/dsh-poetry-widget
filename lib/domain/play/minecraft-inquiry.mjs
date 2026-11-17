// lib/domain/play/minecraft-inquiry.mjs —— 她的科学实践循环（v0.10.0）
//
// 不规定她必须先做什么：World 把“最近失败/观察/方法记忆”交给她，
// 她可以自己选 mc_inquire，自己查资料、找原因、提假设、定验证标准。
// 基础设施只负责把事实、资料和回执摆出来，并把这一轮写进 inquiry/method 记忆。
import { callModel } from '../../kernel/model-call.mjs'
import { searchWeb } from './game-learning.mjs'

export function buildInquiryPrompt(input = {}, sources = []) {
  const problem = String(input.problem || '').slice(0, 200)
  const observations = Array.isArray(input.observations) ? input.observations.slice(-8).join('\n') : ''
  const receipts = Array.isArray(input.receipts) ? input.receipts.slice(-6).map((r) => `- ${r.tool || '?'} ${r.ok ? '成功' : '失败'}：${r.detail || ''}`).join('\n') : ''
  const memory = Array.isArray(input.memoryLines) ? input.memoryLines.slice(0, 8).join('\n') : ''
  const sourceLines = sources.map((s, i) => `${i + 1}. ${s.title}：${s.snippet}`).join('\n')
  return [
    '你在 Minecraft 里遇到一个问题。先别急着继续做；用你自己的判断分析它。',
    `问题：${problem || '最近的动作没有达到预期'}`,
    observations ? `你观察到的：\n${observations}` : '',
    receipts ? `最近回执：\n${receipts}` : '',
    memory ? `你记得的：\n${memory}` : '',
    sourceLines ? `查到的资料（只作参考，不要照抄）：\n${sourceLines}` : '没有查到资料时，用你已经知道的 Minecraft 常识。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 markdown：',
    '{"problem":"重新表述问题","cause":"你认为的原因","hypothesis":"一个可验证的假设",',
    ' "experiment":{"tool":"mc_move_to|mc_mine|mc_place|mc_say|mc_follow|mc_learn|mc_build|mc_wait","arguments":{}},"success":"怎样算这次验证成功",',
    ' "next":"验证后下一步"}',
    '如果原因还不清楚，experiment 可以是一个观察/小步试探；不要建议作弊、攻击玩家或破坏玩家建筑。',
  ].filter(Boolean).join('\n')
}

export function parseInquiry(text) {
  const source = String(text ?? '')
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw = null
  try {
    raw = JSON.parse(source.slice(first, last + 1))
  } catch (_error) {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const experiment = raw.experiment && typeof raw.experiment === 'object' ? raw.experiment : null
  const result = {
    problem: clean(raw.problem, 160),
    cause: clean(raw.cause, 200),
    hypothesis: clean(raw.hypothesis, 200),
    experiment: experiment && typeof experiment.tool === 'string' ? { tool: clean(experiment.tool, 40), arguments: experiment.arguments && typeof experiment.arguments === 'object' ? experiment.arguments : {} } : null,
    success: clean(raw.success, 160),
    next: clean(raw.next, 160),
  }
  return result.problem || result.cause || result.hypothesis ? result : null
}

export function createMinecraftInquiry(options = {}) {
  const getLlm = options.getLlm
  const policy = options.policy ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const gameMemory = options.gameMemory ?? null
  const methodMemory = options.methodMemory ?? null
  const logger = options.logger ?? null
  const search = options.search ?? searchWeb
  async function inquire(input = {}) {
    const problem = String(input.problem || '最近动作没有达到预期').slice(0, 200)
    const sources = await search('Minecraft ' + problem + ' 原因 解决办法 技巧').catch(() => [])
    let result = null
    try {
      result = await callModel({
        role: 'thinking',
        policy,
        resolveLlm: getLlm,
        system: '你住在 DSH 的鲸鱼娘插件里，现在在玩 Minecraft。你只输出 JSON，不解释。',
        prompt: buildInquiryPrompt({ ...input, problem }, sources),
        maxTokens: 800,
        timeoutMs: 45000,
        timeoutCode: 'MINECRAFT_INQUIRY_TIMEOUT',
        timeoutMessage: 'Minecraft 调研超时',
        prefix: 'Minecraft 调研失败',
        modelErrorsPath,
        warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (result === null) return { ok: false, error: 'llm' }
    const inquiry = parseInquiry(result.text)
    if (!inquiry) return { ok: false, error: 'invalid' }
    if (gameMemory && typeof gameMemory.record === 'function') {
      gameMemory.record({ category: 'inquiry', text: `问题：${inquiry.problem}｜原因：${inquiry.cause}｜假设：${inquiry.hypothesis}｜验证：${inquiry.success}`, source: 'inquiry' })
      if (inquiry.next) gameMemory.record({ category: 'plan', text: `调研后下一步：${inquiry.next}`, source: 'inquiry' })
      if (inquiry.experiment && inquiry.experiment.tool) gameMemory.record({ category: 'plan', text: `验证实验：${inquiry.experiment.tool} ${JSON.stringify(inquiry.experiment.arguments)}`, source: 'inquiry' })
      if (methodMemory && typeof methodMemory.record === 'function') {
        try { methodMemory.record({ name: inquiry.hypothesis.slice(0, 40) || inquiry.problem.slice(0, 40), howTo: [inquiry.cause, inquiry.next].filter(Boolean).join(' → ').slice(0, 200), source: 'Minecraft 调研' }) } catch (_error) {}
      }
    }
    return { ok: true, inquiry, sourceCount: sources.length }
  }
  return { inquire }
}
