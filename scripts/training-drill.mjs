#!/usr/bin/env node
// scripts/training-drill.mjs —— 训练演练 CLI（Gate M3）。
//
// 默认 dry-run：只读取 training-config / report.md / dataset stats / adapter 路径，打印计划与风险，不启动训练。
// 真实运行必须同时满足：--confirm 且环境变量 DSH_POETRY_TRAIN_DRILL=1。
//   · 调 ~/dsh-workspace/agent-loop/self-train.sh（路径可用 DSH_POETRY_SELF_TRAIN_SCRIPT 覆盖）；
//   · 输出流式写入 $DSH_HOME/.dsh-poetry/training-logs/drill-<stamp>.log；
//   · 结束后读取 report.md 评估结果并打印；退出码 0=完成 / 1=失败/超时/拒绝；
//   · 本脚本不直接修改 adapter（self-train.sh 自身行为保留；运行前请备份 adapters-live）。
//
// 可测试：runTrainingDrill({argv, env, spawn, ...}) 全部依赖可注入，测试用 fake spawn 不真正训练。

import { spawn as nodeSpawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createTrainingConfigStore } from '../lib/domain/life/training-config.mjs'
import { createTrainingDataset } from '../lib/domain/life/training-dataset.mjs'
import { createTrainingEvaluator } from '../lib/domain/life/training-evaluator.mjs'

/** 演练环境变量（必须显式 =1 才允许真实运行）。 */
export const DRILL_ENV = 'DSH_POETRY_TRAIN_DRILL'

/** 错误码。 */
export const DRILL_CODES = Object.freeze({
  confirmRequired: 'TRAIN_DRILL_CONFIRM_REQUIRED',
  envRequired: 'TRAIN_DRILL_ENV_REQUIRED',
  scriptMissing: 'TRAIN_DRILL_SCRIPT_MISSING',
  tokenMissing: 'TRAIN_DRILL_TOKEN_MISSING',
  spawnFailed: 'TRAIN_DRILL_SPAWN_FAILED',
  timeout: 'TRAIN_DRILL_TIMEOUT',
  cancelled: 'TRAIN_DRILL_CANCELLED',
})

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** 解析 CLI 参数（只认 --confirm/--timeout/--help；未知参数忽略）。 */
export function parseDrillArgs(argv) {
  const args = Array.isArray(argv) ? argv : []
  const out = { confirm: false, help: false, timeoutMs: null }
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index])
    if (arg === '--confirm') out.confirm = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--timeout') {
      const next = Number(args[index + 1])
      if (Number.isFinite(next) && next > 0) out.timeoutMs = Math.floor(next)
      index += 1
    }
  }
  return out
}

/** 解析演练路径（全部可被 options/env 覆盖，便于测试）。 */
export function resolveDrillPaths(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const env = isPlainObject(spec.env) ? spec.env : process.env
  const home = typeof spec.home === 'string' && spec.home.length > 0 ? spec.home : env.DSH_HOME || os.homedir()
  const settingsDir = path.join(home, '.dsh-poetry')
  const selfTrainDir =
    typeof spec.selfTrainDir === 'string' && spec.selfTrainDir.length > 0
      ? spec.selfTrainDir
      : typeof env.DSH_POETRY_SELF_TRAIN_DIR === 'string' && env.DSH_POETRY_SELF_TRAIN_DIR.length > 0
        ? env.DSH_POETRY_SELF_TRAIN_DIR
        : path.join(os.homedir(), 'Library', 'Application Support', 'dsh-whale-mlx', 'self-train')
  return {
    home,
    settingsDir,
    selfTrainDir,
    configFile: typeof spec.configFile === 'string' ? spec.configFile : path.join(settingsDir, 'training-config.json'),
    scriptFile:
      typeof spec.scriptFile === 'string' && spec.scriptFile.length > 0
        ? spec.scriptFile
        : typeof env.DSH_POETRY_SELF_TRAIN_SCRIPT === 'string' && env.DSH_POETRY_SELF_TRAIN_SCRIPT.length > 0
          ? env.DSH_POETRY_SELF_TRAIN_SCRIPT
          : path.join(os.homedir(), 'dsh-workspace', 'agent-loop', 'self-train.sh'),
    tokenFile: typeof spec.tokenFile === 'string' ? spec.tokenFile : path.join(settingsDir, 'chat-token'),
    logDir: typeof spec.logDir === 'string' && spec.logDir.length > 0 ? spec.logDir : path.join(settingsDir, 'training-logs'),
    reportFile: path.join(selfTrainDir, 'report.md'),
    historyFile: path.join(selfTrainDir, 'history.log'),
    adaptersDir: path.join(selfTrainDir, 'adapters'),
  }
}

function listAdapters(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .slice(0, 20)
  } catch (error) {
    void error
    return []
  }
}

function readToken(tokenFile) {
  try {
    return readFileSync(tokenFile, 'utf8').trim()
  } catch (error) {
    void error
    return ''
  }
}

/** 收集 dry-run 计划（只读；不启动训练、不改 adapter）。 */
export function buildDrillPlan(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const paths = resolveDrillPaths(spec)
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const store = createTrainingConfigStore({ file: paths.configFile, now, logger: null })
  const configState = store.read()
  const dataset = createTrainingDataset({
    agentMemoryDir: path.join(paths.home, 'agent-memory'),
    gameMemoryDir: path.join(paths.settingsDir, 'game-memory'),
    methodsFile: path.join(paths.settingsDir, 'methods.json'),
    file: path.join(paths.settingsDir, 'training-data.jsonl'),
    now,
  })
  const evaluator = createTrainingEvaluator({ reportFile: paths.reportFile, historyFile: paths.historyFile, now })
  const report = evaluator.evaluate()
  const config = configState.config
  const token = readToken(paths.tokenFile)
  const scriptExists = existsSync(paths.scriptFile)
  const risks = []
  if (scriptExists) risks.push('self-train.sh 可能替换线上语言层（adapters-live）：运行前请备份')
  else risks.push('训练脚本不存在：真实 drill 会被拒绝')
  if (token.length === 0) risks.push('缺少 chat token：真实 drill 会被拒绝')
  if (config === null || config.enabled !== true) risks.push('训练配置 enabled=false：正式训练需先开启（drill 直接跑脚本不受影响）')
  if (report.ok !== true) risks.push('当前没有可解析的评估报告：drill 结束后需人工核对')
  else if (report.passed !== true) risks.push(`最近评估未通过（score=${report.score ?? 'n/a'}）：不要 promote`)
  const datasetStats = dataset.stats()
  if (datasetStats.available !== true) risks.push('数据集为空：建议先导出/收集训练数据')
  return {
    ok: true,
    now: now(),
    paths,
    config: config === null ? null : { enabled: config.enabled, intervalDays: config.intervalDays, dataset: config.dataset, eval: config.eval, adapter: config.adapter },
    configErrors: configState.errors,
    dataset: datasetStats,
    report,
    scriptExists,
    tokenPresent: token.length > 0,
    adapters: listAdapters(paths.adaptersDir),
    risks,
  }
}

/** 把计划格式化为可打印文本行。 */
export function formatDrillPlan(plan) {
  const lines = []
  lines.push('[training-drill] 模式：dry-run（默认，不启动训练）')
  lines.push(`- 训练脚本：${plan.paths.scriptFile}${plan.scriptExists ? '' : '（不存在）'}`)
  lines.push(`- 训练配置：${plan.paths.configFile}`)
  lines.push(`  enabled=${plan.config === null ? 'n/a' : plan.config.enabled} intervalDays=${plan.config === null ? 'n/a' : plan.config.intervalDays} minScore=${plan.config === null ? 'n/a' : plan.config.eval.minScore} currentAdapter=${plan.config === null ? 'n/a' : plan.config.adapter.current}`)
  lines.push(`- 数据集：available=${plan.dataset.available} entries=${plan.dataset.entries} sufficient=${plan.dataset.sufficient} file=${plan.dataset.file}`)
  lines.push(`- 评估报告：ok=${plan.report.ok} source=${plan.report.source ?? 'none'} score=${plan.report.score ?? 'n/a'} passed=${plan.report.passed}`)
  lines.push(`- token：${plan.tokenPresent ? '已配置' : '缺失'}；adapters：${plan.adapters.length > 0 ? plan.adapters.join('、') : '（无）'}`)
  lines.push('- 风险/前置：')
  for (const risk of plan.risks) lines.push('  · ' + risk)
  lines.push(`[training-drill] 真实运行需：--confirm 且 ${DRILL_ENV}=1（会运行 self-train.sh，请先备份 adapters-live）`)
  return lines
}

/**
 * 运行训练演练（dry-run 默认；真实运行需 --confirm + env）。
 * @param {{
 *   argv?: string[],
 *   env?: Record<string, string|undefined>,
 *   spawn?: Function,
 *   now?: () => number,
 *   home?: string,
 *   selfTrainDir?: string,
 *   configFile?: string,
 *   scriptFile?: string,
 *   tokenFile?: string,
 *   logDir?: string,
 *   timeoutMs?: number,
 *   stdout?: {write?: Function}|null,
 *   stderr?: {write?: Function}|null,
 *   signal?: {aborted?: boolean, addEventListener?: Function}|null,
 *   streamToStdout?: boolean,
 * }} [options]
 */
export async function runTrainingDrill(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const argv = Array.isArray(spec.argv) ? spec.argv : process.argv.slice(2)
  const env = isPlainObject(spec.env) ? spec.env : process.env
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const stdout = spec.stdout !== null && spec.stdout !== undefined && typeof spec.stdout.write === 'function' ? spec.stdout : null
  const stderr = spec.stderr !== null && spec.stderr !== undefined && typeof spec.stderr.write === 'function' ? spec.stderr : null
  const writeOut = (line) => {
    try {
      stdout?.write(line + '\n')
    } catch (error) {
      void error
    }
  }
  const writeErr = (line) => {
    try {
      stderr?.write(line + '\n')
    } catch (error) {
      void error
    }
  }
  const args = parseDrillArgs(argv)
  if (args.help) {
    writeOut('用法：node scripts/training-drill.mjs [--confirm] [--timeout <ms>]')
    writeOut(`默认 dry-run；真实运行需 --confirm 且 ${DRILL_ENV}=1。`)
    return { ok: true, exitCode: 0, dryRun: true, help: true }
  }
  const plan = buildDrillPlan(spec)
  const lines = formatDrillPlan(plan)
  for (const line of lines) writeOut(line)
  const envAllows = String(env[DRILL_ENV] ?? '') === '1'
  if (!args.confirm || !envAllows) {
    const dryRun = true
    if (args.confirm && !envAllows) {
      writeErr(`[training-drill] 拒绝真实运行：缺少 ${DRILL_ENV}=1（当前 dry-run）`)
    } else if (!args.confirm && envAllows) {
      writeErr('[training-drill] 拒绝真实运行：缺少 --confirm（当前 dry-run）')
    }
    return { ok: true, exitCode: 0, dryRun, plan, code: !args.confirm && envAllows ? DRILL_CODES.confirmRequired : !envAllows && args.confirm ? DRILL_CODES.envRequired : undefined }
  }
  if (!plan.scriptExists) return { ok: false, exitCode: 1, dryRun: false, plan, code: DRILL_CODES.scriptMissing, message: '训练脚本不存在：' + plan.paths.scriptFile }
  if (!plan.tokenPresent) return { ok: false, exitCode: 1, dryRun: false, plan, code: DRILL_CODES.tokenMissing, message: '缺少 chat token：' + plan.paths.tokenFile }
  const logFile = path.join(plan.paths.logDir, 'drill-' + new Date(now()).toISOString().replace(/[:.]/g, '-') + '.log')
  try {
    mkdirSync(plan.paths.logDir, { recursive: true })
    writeFileSync(logFile, '# training drill ' + new Date(now()).toISOString() + '\n' + lines.join('\n') + '\n\n', 'utf8')
  } catch (error) {
    return { ok: false, exitCode: 1, dryRun: false, plan, code: DRILL_CODES.spawnFailed, message: error instanceof Error ? error.message : String(error) }
  }
  const spawnFn = typeof spec.spawn === 'function' ? spec.spawn : nodeSpawn
  const timeoutMs = readPositiveInt(spec.timeoutMs ?? args.timeoutMs, DEFAULT_TIMEOUT_MS)
  writeOut('[training-drill] 开始真实 drill，日志：' + logFile)
  const result = await new Promise((resolve) => {
    let child = null
    let settled = false
    let timedOut = false
    let cancelled = false
    let timer = null
    const finish = (payload) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve({ ...payload, logFile, plan })
    }
    try {
      child = spawnFn('/bin/bash', [plan.paths.scriptFile], {
        cwd: path.dirname(path.dirname(plan.paths.scriptFile)),
        env: { ...env, DSH_TRAIN_DRILL: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ ok: false, exitCode: 1, code: DRILL_CODES.spawnFailed, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if (child === null || child === undefined || typeof child.on !== 'function') {
      finish({ ok: false, exitCode: 1, code: DRILL_CODES.spawnFailed, message: 'spawn 返回空 child' })
      return
    }
    const append = (chunk) => {
      try {
        appendFileSync(logFile, chunk)
      } catch (error) {
        void error
      }
      if (spec.streamToStdout === true) {
        try {
          process.stdout.write(chunk)
        } catch (error) {
          void error
        }
      }
    }
    try {
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
    } catch (error) {
      void error
    }
    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch (error) {
        void error
      }
    }, timeoutMs)
    if (spec.signal !== null && spec.signal !== undefined && typeof spec.signal.addEventListener === 'function') {
      try {
        spec.signal.addEventListener('abort', () => {
          cancelled = true
          try {
            child.kill('SIGTERM')
          } catch (error) {
            void error
          }
        })
      } catch (error) {
        void error
      }
    }
    child.on('close', (code) => {
      if (timedOut) {
        finish({ ok: false, exitCode: 1, code: DRILL_CODES.timeout, message: '训练超时（' + timeoutMs + 'ms）' })
        return
      }
      if (cancelled) {
        finish({ ok: false, exitCode: 1, code: DRILL_CODES.cancelled, message: '训练已取消' })
        return
      }
      const exitCode = Number.isInteger(code) ? code : 1
      const evaluator = createTrainingEvaluator({ reportFile: plan.paths.reportFile, historyFile: plan.paths.historyFile, now })
      const report = evaluator.evaluate()
      const reportLines = [
        '[training-drill] 训练进程结束：exitCode=' + exitCode,
        `- 评估报告：ok=${report.ok} source=${report.source ?? 'none'} score=${report.score ?? 'n/a'} passed=${report.passed}`,
      ]
      for (const line of reportLines) writeOut(line)
      finish({ ok: exitCode === 0, exitCode, report, dryRun: false, ...(exitCode === 0 ? {} : { code: 'TRAIN_DRILL_FAILED', message: '训练进程退出码 ' + exitCode }) })
    })
    child.on('error', (error) => {
      finish({ ok: false, exitCode: 1, code: DRILL_CODES.spawnFailed, message: error instanceof Error ? error.message : String(error) })
    })
  })
  return result
}

/** CLI 入口（仅直接运行时执行）。 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const result = await runTrainingDrill({ argv, env, stdout: process.stdout, stderr: process.stderr, streamToStdout: true })
  process.exitCode = result.exitCode
  return result
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    try {
      process.stderr.write('[training-drill] 失败：' + (error instanceof Error ? error.message : String(error)) + '\n')
    } catch (writeError) {
      void writeError
    }
    process.exitCode = 1
  })
}
