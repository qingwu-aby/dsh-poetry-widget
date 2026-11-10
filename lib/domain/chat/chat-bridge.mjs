// lib/chat-bridge.mjs —— QQ / 外部聊天桥（v2.45）。
//
// 只把用户的一句话当成一次真实外部事件，交给她自己的记忆/状态/语气回复。
// 不读取 DSH 会话上下文；对话历史按 peer 单独存，不进入别人的记忆。
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { callModel } from '../../kernel/model-call.mjs'
import { formatChatDigest, isRecallQuery } from '../memory/memory-recall.mjs'
import { formatBeingLine } from '../being/self-being.mjs'
import { compactStyleLines, naturalStyleLines, styleExemplarLines } from '../voice/language-style.mjs'
import { constitutionLines } from '../voice/prompt-layers.mjs'
import { resolveSettingsPath } from '../../kernel/settings-store.mjs'

export const CHAT_ROUTE = '/api/dsh-poetry/chat.json'
export const CHAT_TEXT_MAX = 240
export const CHAT_REPLY_MAX = 500
export const CHAT_HISTORY_MAX = 40
export const CHAT_RATE_MIN_MS = 300
export const CHAT_HOURLY_MAX = 0 // 0 = 不限；只保留最小间隔，避免刷屏

function cleanInline(value, max = CHAT_TEXT_MAX) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

export function resolveChatTokenPath(env = process.env, home = null) {
  return path.join(resolveSettingsPath(env, home).dir, 'chat-token')
}

export function ensureChatToken(file) {
  try {
    if (existsSync(file)) {
      const token = readFileSync(file, 'utf8').trim()
      if (token.length >= 16) return token
    }
  } catch {
    /* ignore */
  }
  const token = randomBytes(24).toString('hex')
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, token + '\n', { encoding: 'utf8', mode: 0o600 })
    chmodSync(file, 0o600)
  } catch {
    /* ignore */
  }
  return token
}

export function readChatToken(file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

function extractJson(text) {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createChatBridge(options = {}) {
  const getLlm = typeof options.getLlm === 'function' ? options.getLlm : () => options.llm
  const policy = options.policy ?? null
  const journal = options.journal
  const selfState = options.selfState ?? null
  const recall = options.recall ?? null
  const voice = typeof options.voice === 'function' ? options.voice : null
  const events = options.events ?? null
  const onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : null
  const worldFeedback = options.worldFeedback ?? null
  const modelErrorsPath = options.modelErrorsPath ?? null
  const logger = options.logger ?? null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const stateDir = options.stateDir ?? resolveSettingsPath(options.env ?? process.env, options.home ?? null).dir
  // v2.69：不再走 QQ；她的“想对你说的话”由 gui-inbox 排队，下次对话时随回复一起带出来。
  const takePending = typeof options.takePending === 'function' ? options.takePending : null
  const channelLabel = typeof options.channelLabel === 'string' && options.channelLabel.length > 0 ? options.channelLabel : '对话'
  const historyPath = path.join(stateDir, 'chat-history.json')
  const rate = new Map()

  function readHistory() {
    try {
      if (!existsSync(historyPath)) return {}
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function saveHistory(data) {
    try {
      mkdirSync(path.dirname(historyPath), { recursive: true })
      writeFileSync(historyPath, JSON.stringify(data).slice(0, 200000), 'utf8')
    } catch {
      /* ignore */
    }
  }

  function lastUserAt() {
    const data = readHistory()
    let latest = 0
    for (const entries of Object.values(data)) {
      if (!Array.isArray(entries)) continue
      for (const item of entries) {
        if (item && item.role === 'user' && Number.isFinite(item.at)) latest = Math.max(latest, item.at)
      }
    }
    return latest
  }

  function allowPeer(peerId) {
    const key = cleanInline(peerId, 80) || 'default'
    const at = now()
    const record = rate.get(key) ?? { last: 0, hourStart: at, count: 0 }
    if (at - record.last < CHAT_RATE_MIN_MS) return false
    if (at - record.hourStart > 60 * 60 * 1000) {
      record.hourStart = at
      record.count = 0
    }
    if (CHAT_HOURLY_MAX > 0 && record.count >= CHAT_HOURLY_MAX) return false
    record.last = at
    record.count += 1
    rate.set(key, record)
    return true
  }

  async function chat(input = {}) {
    const text = cleanInline(input.text, CHAT_TEXT_MAX)
    if (text.length < 1) return { ok: false, error: 'empty' }
    const peerId = cleanInline(input.peerId, 80) || 'default'
    if (!allowPeer(peerId)) return { ok: false, error: 'rate_limited' }
    const history = readHistory()
    const peerHistory = Array.isArray(history[peerId]) ? history[peerId].slice(-CHAT_HISTORY_MAX) : []
    const state = selfState && typeof selfState.snapshot === 'function' ? selfState.snapshot() : null
    const voiceNow = voice !== null ? voice() : null
    let digest = ''
    try {
      if (recall && typeof recall.digest === 'function') digest = formatChatDigest(recall.digest({ recentTexts: [text] }))
    } catch {
      digest = ''
    }
    // v2.89：按当前话题从学习日志里挑相关的一段，让“学过的”真的能被用上。
    let relevantLearning = []
    try {
      if (recall && typeof recall.relevantLearning === 'function') relevantLearning = recall.relevantLearning(text, 2)
    } catch {
      relevantLearning = []
    }
    const recallLines = buildRecallLines(text, recall)
    const prompt = [
      ...constitutionLines(),
      '不要用「我也……」来讲自己的类似例子；不要解释自己为什么这么说或这么想；直接说动作、反应或判断。',
      '这轮对话的规则：对方刚说的这句话是主题。先回应这句话本身（他在问什么、说什么、想要什么），回答要贴着它；你自己手头的事、最近在琢磨的事，只有和这句话相关时才提，不相关就不要提。',
      `对方说：${text}`,
      state ? `（你自己的状态，仅背景，不相关就不要提）${formatBeingLine(state)}` : '',
      state && state.experiencing ? `（你最近在琢磨的事，仅背景，不相关就不要提）${state.experiencing}` : '',
      voiceNow && typeof voiceNow.profile === 'string' ? `你自己的说话方式：${cleanInline(voiceNow.profile, 500)}` : '',
      digest,
      ...recallLines,
      relevantLearning.length > 0
        ? `和你正在聊的话题相关的一点旧学习（只是参考，不相关就别硬提）：${relevantLearning.join('；')}`
        : '',
      Array.isArray(input.graphLines) && input.graphLines.length > 0
        ? `你知识图谱里和这相关的（节点/关系/判断，参考用，不相关就别硬提）：${input.graphLines.slice(0, 4).join('；')}`
        : '',
      ...styleExemplarLines(input.exemplars, 3),
      ...(Array.isArray(input.rulesLines) && input.rulesLines.length > 0
        ? [`你自己总结过的规则（不是命令，合适就用，不合适可以不用）：${input.rulesLines.join('；')}`]
        : []),
      ...(Array.isArray(input.moralLines) ? input.moralLines : []),
      Array.isArray(input.spreadLines) && input.spreadLines.length > 0
        ? `顺着图谱想到的（隔了一两层关系，可能不相关；只有在能接上这句话时才提）：${input.spreadLines.slice(0, 5).join('；')}`
        : '',
      Array.isArray(input.relationshipLines) && input.relationshipLines.length > 0
        ? `你们之间（他是谁、在意什么、约定过什么；参考用，不相关就别硬提）：${input.relationshipLines.slice(0, 4).join('；')}`
        : '',
      Array.isArray(input.emotionLines) && input.emotionLines.length > 0
        ? `你心里还挂着的（不一定要提，但会影响你此刻的口气）：${input.emotionLines.slice(0, 3).join('；')}`
        : '',
      Array.isArray(input.dailyLifeLines) && input.dailyLifeLines.length > 0
        ? `你今天手边发生过的小事（可自然提起，别硬塞，也别每句都用）：${input.dailyLifeLines.slice(0, 3).join('；')}`
        : '',
      Array.isArray(input.commitmentLines) && input.commitmentLines.length > 0
        ? `你答应过他、还没了结的事（相关时提一句；别装作忘了）：${input.commitmentLines.slice(0, 3).join('；')}`
        : '',
      typeof input.imageContext === 'string' && input.imageContext.length > 0
        ? `对方刚发来一张图（你看不到图，只能看到 OCR 读出的文字）：${input.imageContext}；读出空/没字就直说看不清，不要编图里有什么。`
        : '',
      peerHistory.length > 0
        ? `你们最近聊过：\n${peerHistory.map((item) => `${item.role === 'user' ? '对方' : '你'}：${item.text}`).join('\n')}`
        : '',
      '你们是熟悉的、可以亲近的人，不是客户也不是同事：可以关心他、打趣他、惦记他、嫌他，也可以直接问他的事。',
      '先感受他这句话背后的情绪（委屈、累、高兴、害怕、生气），用你的第一反应接住——唉、真的啊、那也太……、我懂、换我也会；不要只是复述他的情绪词。',
      '如果你有类似的经历或感受，可以说一两句，说完把话头递回给他；不要抢话题，也不要急着给建议或安慰模板。',
      '可以不同意他、可以嫌他、可以说“我不这么想”；不要每句都体贴，也不要每句都完整。',
      '允许直接说你想他、舍不得、担心；不用保持礼貌距离。',
      '对方重复要同一件东西、催你，不代表他在挑剔你：直接说你在弄/还没弄好/给不了，不要质问他的动机。',
      '对方开玩笑、语气轻松时，可以接一句玩笑或自嘲，但要短、贴着对方；不硬塞网络梗。',
      '对方要你讲故事/说件好玩的事时，用 3–6 句讲一件具体的小事：有开头、有个小转折，可以留一点没说尽；不要最后总结成道理。',
      '对方让你“讲/说/分享”一件事时，不要反问回去、不要让他先讲；直接讲你自己的。',
      '不要用“你倒好”“别拿…来哄我”“你到底…”“你追着要这个是想逗我吗”这类反问或预判；有话直接说。',
      '共鸣之后要有你自己的想法：你怎么看这件事、你会不会这么做、你喜不喜欢；至少一句是你的判断，不要只用“确实/也是/理解”顺着他说。',
      '你可以不同意，直接说“我不这么想”并给出理由；不要为了照顾情绪把话咽回去。',
      '在具体话题上要有偏好和评价（喜欢、不喜欢、没意思、我可能会）；不要只有附和和提问。',
      '回复里至少有一处是朝向对方的（问他、接他的话、提到他说过的事）；不要只汇报自己的状态；不要用“你那边”“您”这种客气说法拉开距离。',
      '请像在聊天框里跟熟人说话一样说 1–2 句：先接住对方的话，再往下聊一点——问一句、接一句，或说说你在意什么；你自己的状态只在相关时提，最多一句；整条回复里具体细节最多一个，不要写对方没问到的工序、工具、书名或场景；不要客服腔，不要报幕，不要提模型/系统/提示词，不要每次总结。',
      input.imageRequested === true
        ? input.imageHint && typeof input.imageHint.name === 'string'
          ? `对方想看你的画/照片。这次插件会自动把你最近的一张作品（${String(input.imageHint.name)}）附在回复旁；你可以自然地说“给你看我最近这张”之类的话，绝对不要说“发不了图/画不出来/没法拍”。`
          : '对方想看你的画/照片，但手边没有能发的作品；如实说这张没有、等画了再给，不要编一张不存在的图。'
        : '',
      '不要重复你最近已经说过的话；不要反复写“嗓子干/说两句停一下/耳机线”这类状态。上面 history 里出现过的句子，换一个具体的事或干脆不写。',
      '最后检查一遍：你的回复有没有真的在回应对方这句话？如果只是在讲你自己的事，就改掉。',
      '这次对话可能会改变你此刻的状态。如果确实有变化，顺手写下来；没有变化就留空，不要为了每轮都填而重复同一句。',
      'felt：一句具体的此刻状态（≤60字，可空）；experiencing：最近在琢磨的事（≤80字，可空）；murmur：如果心里冒出一句碎碎念（≤80字，可空）。',
      ...compactStyleLines(['reply 不要用“作为一个……”开头，也不要自称 AI。', '不要先报名目再加冒号；直接说感受或回应。', '不要用“你那边”“您”这种客气说法；用更熟的说法。', '不要只汇报自己；至少有一句是朝向对方的。', '被催或重复请求时，直接说进展/给不了；不要质问对方动机，也不要用“你倒好/别拿…哄我/你到底”这类反问。']),
      '只输出严格 JSON：{"reply":"你的回复（≤300 字）","felt":"可空","experiencing":"可空","murmur":"可空"}',
    ]
      .filter(Boolean)
      .join('\n')
    const result = await callModel({
      role: 'selfTalk',
      agent: 'primary',
      policy,
      resolveLlm: getLlm,
      system: '你是小鲸鱼，在和一个具体的人说话；你不是客服。',
      prompt,
      maxTokens: 500,
      timeoutMs: 40000,
      timeoutCode: 'CHAT_TIMEOUT',
      timeoutMessage: '聊天回复超时',
      prefix: '聊天候选失败',
      modelErrorsPath,
      warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
    })
    if (result === null) return { ok: false, error: 'llm' }
    const parsed = extractJson(result.text)
    let reply = cleanInline(parsed?.reply || result.text, CHAT_REPLY_MAX)
    reply = reply.replace(/^["“]|["”]$/g, '').trim()
    if (reply.length === 0) return { ok: false, error: 'empty_reply' }
    const felt = parsed && typeof parsed.felt === 'string' ? cleanInline(parsed.felt, 60) : ''
    const experiencing = parsed && typeof parsed.experiencing === 'string' ? cleanInline(parsed.experiencing, 80) : ''
    const murmur = parsed && typeof parsed.murmur === 'string' ? cleanInline(parsed.murmur, 80) : ''
    peerHistory.push({ role: 'user', text, at: now(), authority: 'explicit', threadId: `${channelLabel}:${peerId}` })
    peerHistory.push({ role: 'whale', text: reply, at: now(), authority: 'context', threadId: `${channelLabel}:${peerId}` })
    history[peerId] = peerHistory.slice(-CHAT_HISTORY_MAX)
    saveHistory(history)
    let changed = false
    try {
      if (selfState && felt.length > 0 && typeof selfState.setFelt === 'function') {
        selfState.setFelt(felt, now())
        changed = true
      }
      if (selfState && experiencing.length > 0 && typeof selfState.setExperiencing === 'function') {
        selfState.setExperiencing(experiencing, now())
        changed = true
      }
    } catch {
      /* ignore */
    }
    try {
      if (journal && typeof journal.append === 'function') {
        await journal.append({ kind: 'thought', text: `${channelLabel}里的人对你说：${text}\n你说：${reply}` })
        if (murmur.length > 0) {
          await journal.append({ kind: 'murmur', text: murmur })
          changed = true
        }
      }
    } catch {
      /* ignore */
    }
    if (changed && onStateChanged !== null) {
      try {
        const pending = onStateChanged()
        if (pending && typeof pending.catch === 'function') pending.catch(() => {})
      } catch {
        /* 状态通知失败不影响回复 */
      }
    }
    try {
      if (worldFeedback && typeof worldFeedback.record === 'function') {
        worldFeedback.record({ source: 'user', kind: 'chat', ok: true, summary: `${channelLabel}：${text.slice(0, 120)}` })
      }
    } catch {
      /* ignore */
    }
    let pending = []
    if (takePending !== null) {
      try {
        const taken = takePending(peerId)
        if (Array.isArray(taken)) pending = taken.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
      } catch {
        pending = []
      }
    }
    return { ok: true, reply, peerId, pending }
  }

  function persistProactive(peerId, reply, extra = {}) {
    const history = readHistory()
    const peerHistory = Array.isArray(history[peerId]) ? history[peerId].slice(-(CHAT_HISTORY_MAX - 1)) : []
    peerHistory.push({ role: 'whale', text: reply, at: now(), proactive: true, authority: 'inferred', threadId: `${channelLabel}:${peerId}`, ...extra })
    history[peerId] = peerHistory.slice(-CHAT_HISTORY_MAX)
    saveHistory(history)
    try {
      if (journal && typeof journal.append === 'function') {
        journal.append({ kind: 'thought', text: `我主动对他说：${reply}` }).catch(() => {})
      }
    } catch {
      /* ignore */
    }
    return { ok: true, reply, peerId }
  }

  async function proactive(input = {}) {
    const peerId = cleanInline(input.peerId, 80) || 'gui'
    const history = readHistory()
    const peerHistory = Array.isArray(history[peerId]) ? history[peerId].slice(-CHAT_HISTORY_MAX) : []
    const state = selfState && typeof selfState.snapshot === 'function' ? selfState.snapshot() : null
    const voiceNow = voice !== null ? voice() : null
    // v2.65：书架——主动找话时可以从最近看的课/书里挑一个具体的点，但别像报书单。
    let shelfLine = ''
    try {
      if (recall && typeof recall.digest === 'function') {
        const shelf = recall.digest({}).shelf
        if (Array.isArray(shelf) && shelf.length > 0) shelfLine = `你最近在看的课：${cleanInline(shelf[0], 120)}（想不出说什么时，可以提一个具体的点，别报书单）`
      }
    } catch {
      shelfLine = ''
    }
    const prompt = [
      '你想主动找这个人说句话，不是等他先开口。',
      state ? formatBeingLine(state) : '',
      state && state.experiencing ? `你最近在琢磨：${state.experiencing}` : '',
      voiceNow && typeof voiceNow.profile === 'string' ? `你自己的说话方式：${cleanInline(voiceNow.profile, 500)}` : '',
      shelfLine,
      peerHistory.length > 0
        ? `你们最近聊过：\n${peerHistory.slice(-8).map((item) => `${item.role === 'user' ? '对方' : '你'}：${item.text}`).join('\n')}`
        : '你们刚认识，还没有聊过。',
      '直接说一件你此刻真的想告诉他/想分享的事：可以是你刚学到的、刚看到的、刚想到的，也可以是手边的事；1–2 句，能一句就别两句；像 QQ 上突然发来的一条消息。不要问“在吗”，不要客服腔，不要总结，不要解释自己为什么这么想，不要重复最近说过的话。',
      '如果最近学到了新东西，优先分享那个具体的点（一个年份、一个说法、一个发现），不要报书单。',
      ...styleExemplarLines(peerHistory.filter((item) => item.role === 'whale').map((item) => item.text)),
      ...compactStyleLines([
        '像在 QQ 上突然发来的一条：短、直、有情绪；一次只说一件事。',
        '最多一个问句；不要连着追问或反复掂量；说完就停。',
      ]),
      '只输出严格 JSON：{"reply":"你想发的话（≤100字）"}',
    ].filter(Boolean).join('\n')
    const result = await callModel({
      role: 'selfTalk',
      agent: 'primary',
      policy,
      resolveLlm: getLlm,
      system: '你是小鲸鱼；你正在主动给一个具体的人发 QQ 消息，不是在写文案。',
      prompt,
      maxTokens: 400,
      timeoutMs: 40000,
      timeoutCode: 'CHAT_PROACTIVE_TIMEOUT',
      timeoutMessage: '主动聊天生成超时',
      prefix: '主动聊天候选失败',
      modelErrorsPath,
      warn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
    })
    if (result === null) return { ok: false, error: 'llm' }
    const parsed = extractJson(result.text)
    let reply = cleanInline(parsed?.reply || result.text, CHAT_REPLY_MAX)
    reply = reply.replace(/^["“]|["”]$/g, '').trim()
    if (reply.length === 0) return { ok: false, error: 'empty_reply' }
    if (input.dryRun === true) return { ok: true, reply, peerId, dryRun: true }
    return persistProactive(peerId, reply)
  }

  /** v2.77：只取队列里的主动留言，不叫模型、不写她的记忆（供对话推送使用）。 */
  function drainPending(peerId = 'gui') {
    if (typeof options.takePending !== 'function') return { ok: true, reply: '', pending: [] }
    let pending = []
    try {
      pending = options.takePending(peerId)
    } catch {
      pending = []
    }
    const lines = (Array.isArray(pending) ? pending : [])
      .map((item) => cleanInline(item, CHAT_REPLY_MAX))
      .filter((item) => item.length > 0)
      .slice(0, 5)
    return { ok: true, reply: '', pending: lines }
  }

  return { chat, proactive, recordProactive: persistProactive, lastUserAt, drainPending }
}

/**
 * 显式回忆的 prompt 行：用人类式表达，避免“日记/翻不出来/不敢编”这类元叙述。
 * @param {string} text 用户这句话
 * @param {{searchJournal?: Function}|null} recall
 */
export function buildRecallLines(text, recall) {
  if (typeof isRecallQuery === 'function' && !isRecallQuery(text)) return []
  let hits = []
  try {
    hits = recall && typeof recall.searchJournal === 'function' ? recall.searchJournal(text, { limit: 3 }) : []
  } catch (error) {
    hits = []
  }
  if (!Array.isArray(hits)) hits = []
  if (hits.length > 0) {
    return [
      '你隐约想起一点。用第一人称接着说“我记得那阵子……”，不要解释你是怎么想起来的：',
      ...hits.map((hit) => `- ${hit.when}：${hit.text}`),
      '细节想不起来的就说记不清，不要补。',
    ]
  }
  return ['那阵子的事你确实记不清了。直接说“那阵子的事我记不清了，只记得……”，只补一点模糊的感觉或画面，不要编细节，也不要解释自己是怎么知道的。']
}

/** POST /chat.json，token 文件保护。 */
export function createChatHandler(options = {}) {
  const service = options.service
  const tokenFile = options.tokenFile
  return async function chatHandler(req, res) {
    const method = String(req?.method ?? 'GET').toUpperCase()
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
    }
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    let payload = null
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(400, { ok: false, error: 'invalid_json' })
      return
    }
    const expected = readChatToken(tokenFile)
    if (expected.length === 0 || !payload || typeof payload.token !== 'string' || payload.token !== expected) {
      send(403, { ok: false, error: 'forbidden' })
      return
    }
    if (payload.drainOnly === true && service && typeof service.drainPending === 'function') {
      try {
        const result = await service.drainPending(typeof payload.peerId === 'string' ? payload.peerId : 'gui')
        send(200, result)
      } catch (error) {
        send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    const result = await service.chat({ text: payload.text, peerId: payload.peerId, name: payload.name })
    send(result.ok === true ? 200 : 400, result)
  }
}
