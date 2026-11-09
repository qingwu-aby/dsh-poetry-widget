// @ts-check
// lib/composition/bootstrap.mjs —— 插件启动期引导（W2）
import { existsSync, renameSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDshHost } from '../domain/host/dsh-host.mjs'
import { createModelBudget, createModelGate } from '../domain/host/model-budget.mjs'
import { seedMemoryBaseline } from '../domain/memory/memory-baseline.mjs'
import { resolveMemoryDir } from '../domain/memory/memory-journal.mjs'
import { runMemoryMigrations } from '../domain/memory/memory-migrations.mjs'
import { createPluginLogger } from '../kernel/logger.mjs'
import { configureModelRuntime } from '../legacy/llm-call.mjs'
import { createMetabolism, resolveMetabolismPath } from '../self-metabolism.mjs'
import { resolveSettingsPath } from '../settings-store.mjs'
import { createBaseServices } from './base-services.mjs'

export function createBootstrap(ctx) {
  const logger = createPluginLogger(ctx?.logger ?? null)
  const host = createDshHost(ctx, logger)
  const env = process.env
  const home = env.HOME || os.homedir()
  const settingsPath = resolveSettingsPath(env, home)
  const memoryDir = resolveMemoryDir(env, home)
  const seededMemory = seedMemoryBaseline({ env, home, logger })
  if (seededMemory.length > 0) logger?.info?.(`[dsh-little-whale] 已初始化空白记忆容器：${seededMemory.join('、')}`)

  const { guiInbox, selfProjects, selfEvents, growthMetrics, journal, worldFeedback, selfLifecycle } =
    createBaseServices({
      env,
      home,
      settingsDir: settingsPath.dir,
      memoryDir,
      logger,
    })

  // 自身状态在 host.inject 后才创建；这里用可变引用给代谢服务延迟取。
  const stateRef = { current: null }
  const selfMetabolism = createMetabolism({
    file: resolveMetabolismPath(env, home),
    logger,
    getSleeping: () => {
      try {
        return stateRef.current !== null && stateRef.current.snapshot().sleeping === true
      } catch {
        return false
      }
    },
  })
  const modelBudget = createModelBudget(/** @type {any} */ ({
    file: path.join(settingsPath.dir, 'model-budget.json'),
    env,
    home,
    logger,
    onConsume: (role, _total, meta) => {
      if (meta && meta.agent === 'twin') return
      selfMetabolism.recordCall(role)
    },
  }))
  const modelGate = createModelGate({ maxConcurrent: 2, logger })
  configureModelRuntime({ budget: modelBudget, gate: modelGate })
  const budgetSnapshot = modelBudget.snapshot()
  logger?.info?.(
    `[dsh-little-whale] 模型预算：今日 ${budgetSnapshot.total} 次${
      budgetSnapshot.totalLimit > 0 ? ` / 上限 ${budgetSnapshot.totalLimit}` : '（未设上限）'
    }（亚洲/上海）`,
  )

  try {
    const migrationReport = runMemoryMigrations({ env, home, logger })
    if (migrationReport.applied.length > 0) {
      logger?.info?.(
        `[dsh-little-whale] 记忆迁移：${migrationReport.applied.map((item) => `${item.id}→v${item.to}`).join('、')}`,
      )
    }
  } catch (error) {
    logger?.warn?.(`[dsh-little-whale] 记忆迁移异常：${error instanceof Error ? error.message : String(error)}`)
  }

  // 旧 mood.json / experience.json 改名 .retired（不参与记忆中枢）。
  for (const [file, label] of [
    ['mood.json', '会话统计 mood.json'],
    ['experience.json', '外部 experience.json'],
  ]) {
    try {
      const legacyFile = path.join(settingsPath.dir, file)
      if (existsSync(legacyFile)) {
        renameSync(legacyFile, `${legacyFile}.retired-${Date.now()}`)
        logger?.info?.(`[dsh-little-whale] 已停用${label}（改名为 .retired）`)
      }
    } catch (error) {
      logger?.warn?.(
        `[dsh-little-whale] 旧 ${file} 处理失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    logger,
    host,
    env,
    home,
    settingsPath,
    memoryDir,
    guiInbox,
    selfProjects,
    selfEvents,
    growthMetrics,
    journal,
    worldFeedback,
    selfLifecycle,
    selfMetabolism,
    modelBudget,
    modelGate,
    stateRef,
  }
}
