// lib/composition/runtime-setup.mjs —— 启动期基础设施装配（W2）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createServiceRuntime } from '../domain/host/service-runtime.mjs'
import { resolveAutonomy } from '../domain/being/autonomy.mjs'
import { createHeartbeat } from '../domain/host/heartbeat.mjs'
import { createDataStore } from '../domain/memory/data-store.mjs'
import { createSettingsStore } from '../settings-store.mjs'
import { createModelPolicy } from '../domain/host/model-policy.mjs'
import { resolveModelErrorsPath } from '../domain/host/model-errors.mjs'
import { createStateRegistry, migrateAll, summarizeMigrations } from '../kernel/state-schema.mjs'
import { createStateSpecs } from './state-specs.mjs'
import { createTrustFence } from '../domain/integration/trust.mjs'
import { createLocalVoiceService } from './model-services.mjs'
import { createWeather } from './host-services.mjs'
import { loadFeelingBank, resolveFeelingsPath } from '../domain/emotion/feelings.mjs'
import { loadTopicBank, resolveTopicsArchivePath, resolveTopicsPath } from '../domain/learning/self-talk-topics.mjs'
import { createAgentLoop, createWebBenchService, createWebStack } from './host-services.mjs'
import { createWorksService } from './works-services.mjs'

export function createRuntimeSetup(deps) {
  const { env, home, settingsPath, dataDir, logger, getHostService, journal, worldFeedback, disposers, assetsDir, getState } = deps
  const serviceRuntime = createServiceRuntime({ logger })
  const autonomy = resolveAutonomy(env)
  const heartbeat = createHeartbeat({ logger })
  const webServer = getHostService('webServer')
  const connection = getHostService('connection')

  const dataStore = createDataStore({ dataDir })
  const settingsStore = createSettingsStore({
    file: settingsPath.file,
    knownPoemIds: () => dataStore.knownPoemIds(),
    onWarn: (message) => logger?.warn?.(`[dsh-little-whale] ${message}`),
  })

  let migrationSummary = null
  try {
    const migrateMode = String(env.DSH_POETRY_MIGRATE ?? '').toLowerCase()
    if (migrateMode !== 'off') {
      const stateRegistry = createStateRegistry(createStateSpecs(settingsPath.dir))
      const migration = migrateAll(stateRegistry, { dryRun: migrateMode === 'dry-run', logger })
      migrationSummary = summarizeMigrations(migration)
      if (migration.changed > 0) {
        logger?.info?.(`[dsh-little-whale] 状态迁移：${migration.changed}/${migration.total} 个文件被规范化，${migration.errors} 个错误`)
      }
    }
  } catch (error) {
    logger?.warn?.(`[dsh-little-whale] 状态迁移初始化失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const fence = createTrustFence({ getConnection: () => connection, logger })
  const weatherService = createWeather()

  const getLlm = () => {
    try {
      return getHostService('llm')
    } catch {
      return undefined
    }
  }
  const getSelection = () => {
    try {
      const agentDefaultModel = getHostService('agentDefaultModel')
      return typeof agentDefaultModel?.currentSelection === 'function' ? agentDefaultModel.currentSelection() : null
    } catch {
      return null
    }
  }
  const getProviders = () => {
    try {
      const llm = getLlm()
      if (llm !== null && llm !== undefined && typeof llm.listProviders === 'function') return llm.listProviders()
      return null
    } catch {
      return null
    }
  }
  const modelPolicy = createModelPolicy({ env, getSelection, getProviders })
  const localVoiceMode = String(env.DSH_POETRY_LOCAL_VOICE ?? '').toLowerCase()
  const localVoice = createLocalVoiceService({ env, localVoiceMode, logger })
  const modelErrorsPath = resolveModelErrorsPath(env, home)
  const { deepseekWeb, twinWebAccess, webAccess, browseForWhale } = createWebStack({ env, logger, worldFeedback, journal })
  const webBench = createWebBenchService({ settingsDir: settingsPath.dir, webAccess, journal, logger, modelPolicy, getLlm, modelErrorsPath })
  disposers.push(() => webBench.stop())
  const agentLoop = createAgentLoop({ home, env, logger })
  disposers.push(() => agentLoop.stop())
  const { mediaBudget, selfWorks } = createWorksService({ env, home, assetsDir, getLlm, modelPolicy, modelErrorsPath, logger, getState })

  const topicsPath = resolveTopicsPath(env, home)
  const topicsArchivePath = resolveTopicsArchivePath(env, home)
  try {
    mkdirSync(path.dirname(topicsArchivePath), { recursive: true })
    if (!existsSync(topicsArchivePath)) writeFileSync(topicsArchivePath, '', 'utf8')
  } catch {
    /* 归档目录不可写时静默降级 */
  }
  const topicBank = loadTopicBank({ path: topicsPath, logger })
  const feelingsPath = resolveFeelingsPath(env, home)
  try {
    mkdirSync(path.dirname(feelingsPath), { recursive: true })
    if (!existsSync(feelingsPath)) writeFileSync(feelingsPath, `${JSON.stringify({ ok: true, v: 1, feelings: [] }, null, 2)}\n`, 'utf8')
  } catch {
    /* 情绪库不可写时静默降级 */
  }
  const feelingBank = loadFeelingBank({ path: feelingsPath, logger })
  const topicSnapshot = topicBank.read()
  if (topicSnapshot.ok === true) {
    logger?.info?.(`[dsh-little-whale] 碎碎念话题库：${topicsPath}（${topicSnapshot.entries.length} 个话题）`)
  } else {
    logger?.warn?.(`[dsh-little-whale] 碎碎念话题库不可用（自言自语将不使用话题）：${topicsPath}`)
  }

  return {
    serviceRuntime,
    autonomy,
    heartbeat,
    webServer,
    connection,
    dataStore,
    settingsStore,
    migrationSummary,
    fence,
    weatherService,
    getLlm,
    getSelection,
    modelPolicy,
    localVoiceMode,
    localVoice,
    modelErrorsPath,
    topicsPath,
    topicsArchivePath,
    topicBank,
    feelingsPath,
    feelingBank,
    deepseekWeb,
    twinWebAccess,
    webAccess,
    browseForWhale,
    webBench,
    agentLoop,
    mediaBudget,
    selfWorks,
  }
}
