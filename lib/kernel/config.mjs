// @ts-check
// lib/kernel/config.mjs —— 环境变量注册表（W1）
//
// 把散落的 DSH_POETRY_* / DSH_* 收成一张表：类型、默认值、说明。
// 当前阶段只做“读 + 文档”，业务模块按 touched 顺序迁移，避免一次性改动行为。
export const CONFIG_SCHEMA = Object.freeze([
  // 功能开关
  {
    key: 'DSH_POETRY_TWIN',
    name: 'twin',
    group: '功能',
    type: 'boolean',
    default: false,
    doc: '镜像/孪生系统（含自主研究）',
  },
  { key: 'DSH_AGENT_LOOP', name: 'agentLoop', group: '功能', type: 'boolean', default: false, doc: '常驻自进化巡检' },
  {
    key: 'DSH_POETRY_SELF_TRAIN',
    name: 'selfTrain',
    group: '功能',
    type: 'boolean',
    default: false,
    doc: '每周自训练语言层',
  },
  {
    key: 'DSH_POETRY_DAILY_LIFE',
    name: 'dailyLife',
    group: '功能',
    type: 'boolean',
    default: true,
    doc: '日常生活素材生成',
  },
  {
    key: 'DSH_POETRY_GRAPH',
    name: 'knowledgeGraph',
    group: '功能',
    type: 'boolean',
    default: true,
    doc: '认知图谱抽取',
  },
  {
    key: 'DSH_POETRY_RELATIONSHIP',
    name: 'relationship',
    group: '功能',
    type: 'boolean',
    default: true,
    doc: '关系记忆抽取',
  },
  { key: 'DSH_POETRY_WORLDVIEW', name: 'worldview', group: '功能', type: 'boolean', default: true, doc: '世界观周更' },
  { key: 'DSH_POETRY_WEB', name: 'web', group: '功能', type: 'boolean', default: true, doc: '真实网页访问' },
  { key: 'DSH_POETRY_WANDER', name: 'wander', group: '功能', type: 'boolean', default: true, doc: '网络溜达' },
  { key: 'DSH_POETRY_READING', name: 'reading', group: '功能', type: 'boolean', default: true, doc: '读小说/读记' },
  {
    key: 'DSH_POETRY_NETLANG',
    name: 'netlang',
    group: '功能',
    type: 'boolean',
    default: true,
    doc: '看大家说话（RSS）',
  },
  { key: 'DSH_POETRY_EXPERIENCE', name: 'experience', group: '功能', type: 'boolean', default: true, doc: '经历账本' },
  {
    key: 'DSH_POETRY_PROACTIVE_QUIET_HOURS',
    name: 'proactiveQuietHours',
    group: '功能',
    type: 'boolean',
    default: false,
    doc: '主动消息静默时段（已默认关闭）',
  },
  {
    key: 'DSH_POETRY_LOCAL_VOICE',
    name: 'localVoice',
    group: '功能',
    type: 'enum',
    enum: ['off', 'mood', 'chat', 'on'],
    default: 'off',
    doc: '本地 1.5B 语言层用途',
  },
  {
    key: 'DSH_POETRY_MIGRATE',
    name: 'migrate',
    group: '功能',
    type: 'enum',
    enum: ['on', 'dry-run', 'off'],
    default: 'on',
    doc: '状态文件迁移模式',
  },

  // 模型
  {
    key: 'DSH_POETRY_MODEL_PROVIDER',
    name: 'modelProvider',
    group: '模型',
    type: 'string',
    default: '',
    doc: 'LLM provider 覆盖',
  },
  { key: 'DSH_POETRY_MODEL', name: 'model', group: '模型', type: 'string', default: '', doc: 'LLM 模型覆盖' },
  {
    key: 'DSH_POETRY_DEEPSEEK_API_KEY',
    name: 'deepseekApiKey',
    group: '模型',
    type: 'string',
    default: '',
    secret: true,
    doc: 'DeepSeek 搜索/网页密钥',
  },

  // 路径
  { key: 'DSH_HOME', name: 'dshHome', group: '路径', type: 'string', default: '~/.dsh', doc: 'DSH 家目录' },
  { key: 'DSH_PET_MEDIA_DIR', name: 'petMediaDir', group: '路径', type: 'string', default: '', doc: '宠物媒体目录' },
  {
    key: 'DSH_AGENT_MEMORY_DIR',
    name: 'agentMemoryDir',
    group: '路径',
    type: 'string',
    default: '',
    doc: '记忆目录覆盖',
  },
  { key: 'DSH_SELF_STATE', name: 'selfState', group: '路径', type: 'string', default: '', doc: '自身状态文件覆盖' },
  { key: 'DSH_VOICE', name: 'voice', group: '路径', type: 'string', default: '', doc: '声音档案覆盖' },
  {
    key: 'DSH_SELF_TALK_TOPICS',
    name: 'selfTalkTopics',
    group: '路径',
    type: 'string',
    default: '',
    doc: '碎碎念话题库覆盖',
  },
  {
    key: 'DSH_POETRY_FULL_INDEX',
    name: 'poetryFullIndex',
    group: '路径',
    type: 'string',
    default: '',
    doc: '飞花令全库索引路径',
  },
  {
    key: 'DSH_POETRY_FEELINGS',
    name: 'feelings',
    group: '路径',
    type: 'string',
    default: '',
    doc: '自造感受词文件覆盖',
  },
  {
    key: 'DSH_POETRY_SEARCH_URL',
    name: 'searchUrl',
    group: '路径',
    type: 'string',
    default: '',
    doc: '搜索接口 URL 覆盖',
  },

  // 本地服务
  {
    key: 'DSH_POETRY_LOCAL_VOICE_URL',
    name: 'localVoiceUrl',
    group: '本地服务',
    type: 'string',
    default: 'http://127.0.0.1:8080/v1',
    doc: '本地语言层服务地址',
  },
  {
    key: 'DSH_POETRY_LOCAL_VOICE_MODEL',
    name: 'localVoiceModel',
    group: '本地服务',
    type: 'string',
    default: 'default_model',
    doc: '本地语言层模型名',
  },
  {
    key: 'DSH_POETRY_OCR_BIN',
    name: 'ocrBin',
    group: '本地服务',
    type: 'string',
    default: '',
    doc: 'OCR 可执行文件路径',
  },

  // 周期
  {
    key: 'DSH_POETRY_WANDER_MIN',
    name: 'wanderMin',
    group: '周期',
    type: 'number',
    default: 40,
    doc: '溜达间隔（分钟）',
  },
  {
    key: 'DSH_POETRY_WANDER_FIRST_MIN',
    name: 'wanderFirstMin',
    group: '周期',
    type: 'number',
    default: 5,
    doc: '首次溜达最早（分钟）',
  },
  {
    key: 'DSH_POETRY_WANDER_FIRST_MAX',
    name: 'wanderFirstMax',
    group: '周期',
    type: 'number',
    default: 25,
    doc: '首次溜达最晚（分钟）',
  },
  {
    key: 'DSH_POETRY_WORK_INTERVAL_MS',
    name: 'workIntervalMs',
    group: '周期',
    type: 'number',
    default: 0,
    doc: '作品循环间隔（毫秒）',
  },
  {
    key: 'DSH_POETRY_WORK_INITIAL_MS',
    name: 'workInitialMs',
    group: '周期',
    type: 'number',
    default: 0,
    doc: '作品循环首次延迟（毫秒）',
  },
  {
    key: 'DSH_POETRY_SELF_TRAIN_INTERVAL_MS',
    name: 'selfTrainIntervalMs',
    group: '周期',
    type: 'number',
    default: 604800000,
    doc: '自训练间隔',
  },
  {
    key: 'DSH_POETRY_SELF_TRAIN_FIRST_MS',
    name: 'selfTrainFirstMs',
    group: '周期',
    type: 'number',
    default: 43200000,
    doc: '自训练首次延迟',
  },
])

const SCHEMA_BY_KEY = new Map(CONFIG_SCHEMA.map((item) => [item.key, item]))

function parseValue(schema, raw) {
  if (raw === undefined || raw === null) return schema.default
  const text = String(raw).trim()
  if (schema.type === 'boolean') {
    if (['on', '1', 'true', 'yes'].includes(text.toLowerCase())) return true
    if (['off', '0', 'false', 'no', ''].includes(text.toLowerCase())) return false
    return schema.default
  }
  if (schema.type === 'number') {
    const value = Number(text)
    return Number.isFinite(value) ? value : schema.default
  }
  if (schema.type === 'enum') {
    const lower = text.toLowerCase()
    return schema.enum.includes(lower) ? lower : schema.default
  }
  return text
}

/** 读取全部注册配置：{ [name]: value }。未注册的 env 不读取（保持白名单）。 */
export function readConfig(env = process.env) {
  const out = {}
  for (const schema of CONFIG_SCHEMA) out[schema.name] = parseValue(schema, env[schema.key])
  return out
}

/** 生成文档行（scripts/gen-config-doc.mjs 使用）。 */
export function describeConfig() {
  return CONFIG_SCHEMA.map((schema) => ({
    key: schema.key,
    name: schema.name,
    group: schema.group,
    type: schema.type,
    default: schema.secret
      ? '（已隐藏）'
      : schema.enum
        ? `${schema.default}（${schema.enum.join(' / ')}）`
        : String(schema.default),
    doc: schema.doc,
  }))
}

export function schemaFor(key) {
  return SCHEMA_BY_KEY.get(key) ?? null
}
