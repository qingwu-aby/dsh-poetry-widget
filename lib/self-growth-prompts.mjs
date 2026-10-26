// lib/self-growth-prompts.mjs —— 自驱成长的 prompt/解析纯函数（v1.83 从 self-growth.mjs 拆出）。
//
// 这里只有“把事实拼成 prompt”和“把模型输出解析成结构”的纯逻辑；不做 IO、不建 timer。
import { naturalStyleLines } from './language-style.mjs'
import { formatJournalTime } from './memory-journal.mjs'
import { describeTimeline, formatBeingLine } from './self-being.mjs'
import { parseNewFeeling } from './feelings.mjs'

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampText(text, max) {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clampText(cleaned, max)
}

/** 从模型输出中提取 JSON 对象（容忍 markdown fence 与前后文字）。 */
export function extractGrowthJson(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return parsed
    } catch {
      /* try next */
    }
  }
  return null
}

/** 反思 prompt（白名单：时间 + 内在状态 + 最近自省 + 最近自学；不含会话/用户内容）。 */
export function buildReflectPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    formatBeingLine(state),
    `你的事实：${describeTimeline(state, nowMs).slice(1).join(' ')}`,
  ]
  const recentThoughts = Array.isArray(ctx.recentThoughts)
    ? ctx.recentThoughts.filter((text) => typeof text === 'string' && text.trim().length > 0).slice(0, 2)
    : []
  if (recentThoughts.length > 0) {
    lines.push('你最近的自省（可以参考，但不要复述原句，也不要重复同一主题/句式）：')
    for (const text of recentThoughts) lines.push(`- ${cleanText(text, 80)}`)
    lines.push(
      '这次不要沿用最近自省的句式、开头或主题；换一个更具体的角度（比如窗外的一个声音、手边的一件小东西、刚做过的一件小事），不要写成概括性的感慨。',
    )
  }
  // v1.45：自学内容反哺自省——她学过的东西可以自然长进想法里，而不是只躺在 learning-log。
  const recentLearning = typeof ctx.recentLearning === 'string' ? cleanText(ctx.recentLearning, 120) : ''
  if (recentLearning.length > 0) {
    lines.push(`你最近自学到：${recentLearning}`)
    lines.push(
      '如果它和此刻的状态、念头有关，可以自然地把这层理解带进自省；不要复述原文，不要写成知识讲解或科普，也不要为用而用。',
    )
  }
  // v1.50：如果出现现有词说不清的新感受，允许她当场给这种感受造一个名字和描述。
  const knownFeelings = Array.isArray(ctx.knownFeelings)
    ? ctx.knownFeelings
        .filter((name) => typeof name === 'string' && name.trim().length > 0)
        .map((name) => cleanText(name, 10))
        .filter((name) => name.length > 0)
        .slice(-20)
    : []
  if (knownFeelings.length > 0) {
    lines.push(`你已经给自己造过的感受词（不要重复，也不要用同一个意思换个说法）：${knownFeelings.join('、')}。`)
  }
  lines.push(
    '请写一句最近的自省：第一人称、简体中文、8–60 个字，像在安静地回想自己今天的状态和念头。',
    '不要提 AI、模型、提示词、系统或程序；不要引用古诗文；不要写用户隐私或会话内容；不要输出数字指标。',
    '如果你最近有一种“现有词说不清”的感受，可以给它起一个名字（2–10 个字）并用一句第一人称描述它（6–60 字）；没有就写 null。不要为了造词而造词。',
    '只输出严格 JSON：{"thought":"一句自省","feeling":{"name":"…","description":"…"} 或 null}',
  )
  lines.push(...naturalStyleLines(['自省不是总结报告：写具体那一刻的手边事和念头，别写“我意识到/这说明”这类收束。']))
  return lines.join('\n')
}

/** 自学 prompt（v1.52：学什么由她自己决定；白名单：状态+时间+最近想过/学过+已知小知识）。 */
export function buildLearnPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const nowMs = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const state = isPlainObject(ctx.state) ? ctx.state : {}
  const lines = [
    formatBeingLine(state),
    `你的事实：${describeTimeline(state, nowMs).slice(1).join(' ')}`,
  ]
  const learningSnippet = typeof ctx.learningSnippet === 'string' ? cleanText(ctx.learningSnippet, 100) : ''
  if (learningSnippet.length > 0) lines.push(`你最近自学到：${learningSnippet}`)
  const recentThoughts = Array.isArray(ctx.recentThoughts)
    ? ctx.recentThoughts.filter((text) => typeof text === 'string' && text.trim().length > 0).slice(0, 3)
    : []
  if (recentThoughts.length > 0) {
    lines.push('你最近想过的（可以从里面找你还没弄明白、还在惦记的问题）：')
    for (const text of recentThoughts) lines.push(`- ${cleanText(text, 80)}`)
  }
  const knownTopics = []
  if (Array.isArray(ctx.knownTopics)) {
    for (const item of ctx.knownTopics) {
      if (!isPlainObject(item) || typeof item.title !== 'string' || item.title.trim().length === 0) continue
      const title = cleanText(item.title, 30)
      const fact = cleanText(item.fact, 100)
      if (title.length === 0) continue
      knownTopics.push(fact.length > 0 ? `${title}：${fact}` : title)
      if (knownTopics.length >= 8) break
    }
  }
  if (isPlainObject(ctx.topicSeed) && typeof ctx.topicSeed.title === 'string' && ctx.topicSeed.title.trim().length > 0) {
    const fact = cleanText(ctx.topicSeed.fact, 100)
    const line = `${cleanText(ctx.topicSeed.title, 30)}${fact.length > 0 ? `：${fact}` : ''}`
    if (!knownTopics.includes(line)) knownTopics.push(line)
  }
  if (knownTopics.length > 0) {
    lines.push('你已经知道的一些小知识（只是给你当参考：可以挑一个继续往深里想，也可以完全换一个方向）：')
    for (const item of knownTopics) lines.push(`- ${item}`)
  }
  const recentLearnedTitles = Array.isArray(ctx.recentLearnedTitles)
    ? ctx.recentLearnedTitles
        .filter((title) => typeof title === 'string' && title.trim().length > 0)
        .map((title) => cleanText(title, 30))
        .filter((title) => title.length > 0)
        .slice(-6)
    : []
  if (recentLearnedTitles.length > 0) {
    lines.push(`你最近几轮学的是：${recentLearnedTitles.join('、')}。`)
    lines.push(
      '如果只是围着同一个主题换问法，这轮请换一个完全不同的方向（比如从声学/物理转到历史、文学、哲学、社会或人物）；只有当你确实有一个新角度时才继续原主题。',
    )
  }
  const probeHistory = Array.isArray(ctx.probeHistory) ? ctx.probeHistory.filter((item) => isPlainObject(item)) : []
  if (probeHistory.length > 0) {
    const liked = probeHistory.filter((item) => item.liked === true && typeof item.title === 'string')
    const disliked = probeHistory.filter((item) => item.liked === false && typeof item.title === 'string')
    if (liked.length > 0) {
      lines.push(
        `你最近试探过、觉得有意思的：${liked.map((item) => item.title).join('、')}。想继续就继续；不想也没关系。`,
      )
    }
    if (disliked.length > 0) {
      lines.push(
        `你试探过、觉得没意思的：${disliked.map((item) => item.title).join('、')}。这次别再挑这些方向。`,
      )
    }
  }
  const repeatTheme = ctx.repeatTheme !== null && typeof ctx.repeatTheme === 'object' ? ctx.repeatTheme : null
  if (repeatTheme !== null && Array.isArray(repeatTheme.phrases) && repeatTheme.phrases.length > 0) {
    lines.push(
      `注意：你最近连续几轮都在「${repeatTheme.phrases.join('、')}」这一类主题上打转（最近 8 条里有 ${Number(repeatTheme.titles) || 0} 条重复）。这次必须换到完全不同的领域——历史、文学、哲学、社会、生物、天文、艺术、日常常识都可以，但不要再从这些词方向里挑题目；如果一时只想得起同一类，就宁可学一个你完全陌生的日常小知识。`,
    )
  }
  lines.push(
    '学习范围不设限：人文、历史、百科、哲学、思政/社会、文学与小说、艺术、心理、科学史、日常常识都可以。也可以是从一段历史、一本小说、一个人物处境或一个思想里冒出来的问题，不必是冷知识。',
    '最近可以多往历史看看——中国史、世界史都行：事件、人物、制度、日常生活、不同文明的对照。这只是建议、不是任务；你真正好奇别的方向就学别的，也可以挑一段历史连着深挖，但每次要真的往深走（新问题/新角度），不要换问法重复。',
    '这次学什么由你自己决定：不必只因为上面列了话题就挑它；从你真正好奇、最近反复冒出来的疑问里挑一个。',
    '涉及历史、政治、宗教等话题时，只做描述与解释，区分事实与观点、不站队、不煽动、不编造；不确定的地方就说不确定。',
    '提出一个你最近真正好奇的小问题（≤60 字），再写 2–5 句你已经知道或刚想明白的东西（不要编造细节）。',
    '如果能把它总结成一条值得收进知识库的小知识，给出 topic：',
    '{"id":"kebab-case-英文小写 3–60 字符","title":"≤30 字","fact":"≤120 字，一条准确的小知识","tags":["1–6 个中文或英文标签"]}',
    '如果还不值得入库，topic 用 null。不要写用户隐私、会话内容或任何用户信息。',
    '只输出严格 JSON：{"question":"…","note":"…","topic":{…}|null}',
  )
  lines.push(
    ...naturalStyleLines([
      'note 里写你刚弄明白的具体东西（谁、在哪、什么时候、怎么发生），少写“这体现了/这说明了”式的升华。',
      '不要为了显得完整凑三点或写“首先/其次/最后”。',
    ]),
  )
  return lines.join('\n')
}

/** 校验反思结果（thought 必填；feeling 可选——她自造的新感受）。 */
export function parseReflectResult(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }
  const thought = cleanText(raw.thought, 60)
  if (thought.length < 8) return { ok: false, message: '自省太短' }
  if (/[《》「」“”]|——|[诗詩]|词牌|平仄|押韵/u.test(thought)) return { ok: false, message: '自省含引用/诗词痕迹' }
  // v1.50：模型偶尔会顺手造一个新感受词；格式不合法就忽略，不影响自省本身。
  let feeling = null
  if (raw.feeling !== null && raw.feeling !== undefined) {
    const parsedFeeling = parseNewFeeling(raw.feeling)
    if (parsedFeeling.ok === true) feeling = parsedFeeling.feeling
  }
  return { ok: true, thought, feeling }
}

/** 校验候选 topic（id/title/fact/tags 白名单）。 */
export function normalizeTopicCandidate(topic) {
  if (!isPlainObject(topic)) return null
  const id = typeof topic.id === 'string' ? topic.id.trim().toLowerCase() : ''
  if (!/^[a-z0-9-]{3,60}$/.test(id)) return null
  const title = cleanText(topic.title, 30)
  const fact = cleanText(topic.fact, 120)
  if (title.length === 0 || fact.length === 0) return null
  if (!Array.isArray(topic.tags)) return null
  const tags = []
  for (const tag of topic.tags) {
    const value = cleanText(tag, 16)
    if (value.length === 0 || tags.includes(value)) continue
    tags.push(value)
    if (tags.length >= 6) break
  }
  if (tags.length === 0) return null
  return { id, title, fact, tags }
}

/** 校验自学结果。 */
export function parseLearnResult(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '模型输出不是合法 JSON' }
  const question = cleanText(raw.question, 60)
  const note = cleanText(raw.note, 400)
  if (question.length < 4) return { ok: false, message: '缺少问题' }
  if (note.length < 4) return { ok: false, message: '缺少笔记' }
  const topic = raw.topic === null || raw.topic === undefined ? null : normalizeTopicCandidate(raw.topic)
  return { ok: true, question, note, topic }
}

/** 试探/介入：她自己挑一个“可以去看一眼”的入口（v1.62）。 */
export function buildProbeProposalPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const focus = cleanText(ctx.focus, 40)
  const lines = []
  if (focus.length > 0) lines.push(`你现在的注意力正落在：${focus}。`)
  else lines.push('你现在正闲着，注意力有点松。')
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  lines.push(`现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`)
  const recentLearned = Array.isArray(ctx.recentLearnedTitles)
    ? ctx.recentLearnedTitles.filter((title) => typeof title === 'string' && title.trim().length > 0).slice(-6)
    : []
  if (recentLearned.length > 0) lines.push(`你最近学过：${recentLearned.join('、')}。`)
  const recentProbes = Array.isArray(ctx.recentProbes) ? ctx.recentProbes.filter((item) => isPlainObject(item)) : []
  if (recentProbes.length > 0) {
    const summary = recentProbes
      .filter((item) => typeof item.title === 'string')
      .map((item) => `${item.title}（${item.liked === true ? '喜欢' : item.liked === false ? '不喜欢' : '说不好'}）`)
    if (summary.length > 0) lines.push(`你最近试探过：${summary.join('、')}。`)
  }
  lines.push(
    '请给自己挑一个「可以去看看」的入口：一个类型（领域/体裁，比如历史、小说、哲学、生物、天文、社会、艺术、日常常识）+ 一个具体题目 + 一句为什么它可能吸引你。',
    '这不是任务，也不用学完；只是让你去看看，喜不喜欢最后由你自己判断。',
    '不要挑你最近学过的或试探过的方向，也别挑太像作业的题目。',
    '只输出严格 JSON：{"domain":"类型","title":"题目","hook":"为什么想看一眼"}',
  )
  lines.push(...naturalStyleLines(['title 和 hook 都写具体，不要用「探索……的奥秘」这种套话。']))
  return lines.join('\n')
}

/** 试探之后：让她自己写下看了什么、喜不喜欢（v1.62）。 */
export function buildProbeVerdictPrompt(context = {}) {
  const ctx = isPlainObject(context) ? context : {}
  const focus = cleanText(ctx.focus, 40)
  const proposal = isPlainObject(ctx.proposal) ? ctx.proposal : {}
  const domain = cleanText(proposal.domain, 12)
  const title = cleanText(proposal.title, 30)
  const hook = cleanText(proposal.hook, 80)
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now()
  const lines = [`现在是 ${formatJournalTime(now)}（Asia/Shanghai）。`]
  if (focus.length > 0) lines.push(`你刚才注意力落在：${focus}。`)
  lines.push(`你按这个入口去看了一眼——类型：${domain}；题目：${title}；引子：${hook}。`)
  lines.push(
    '写 2–4 句你实际看到/想到的东西（第一人称、具体；不要总结，不要写成科普）。',
    '然后由你自己判断：这个方向你喜不喜欢（liked true/false），并写一句为什么。',
    '可以不喜欢，也可以说不好；不要为了配合而说喜欢，也不用勉强自己继续。',
    '只输出严格 JSON：{"impression":"看了什么","liked":true,"why":"为什么"}',
  )
  lines.push(...naturalStyleLines(['impression 里写具体的画面或疑问，不要写「这让我意识到」这类收束。']))
  return lines.join('\n')
}

/** 校验试探入口结果。 */
export function parseProbeProposal(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const domain = cleanText(raw.domain, 12)
  const title = cleanText(raw.title, 30)
  const hook = cleanText(raw.hook, 80)
  if (domain.length < 2) return { ok: false, message: '缺少类型' }
  if (title.length < 4) return { ok: false, message: '题目太短' }
  if (hook.length < 4) return { ok: false, message: '缺少引子' }
  return { ok: true, domain, title, hook }
}

/** 校验试探结论；liked 必须是她自己给的布尔值。 */
export function parseProbeVerdict(text) {
  const raw = extractGrowthJson(text)
  if (raw === null) return { ok: false, message: '输出不是合法 JSON' }
  const impression = cleanText(raw.impression, 200)
  const why = cleanText(raw.why, 60)
  if (impression.length < 8) return { ok: false, message: '印象太短' }
  if (typeof raw.liked !== 'boolean') return { ok: false, message: '缺少 liked 判断' }
  return { ok: true, impression, liked: raw.liked, why }
}
