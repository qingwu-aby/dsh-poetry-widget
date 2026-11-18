#!/usr/bin/env node
// scripts/release-check.mjs —— 发布前检查（Gate N5，默认只读、不发布）。
//
// 检查项：
//   · package.json 版本号合法（semver）且与 CHANGELOG 条目对应；
//   · client.js 构建新鲜（client-src 最新 mtime ≤ client.js；--skip-build 跳过；--build 先构建）；
//   · 必需文件存在（index.js/client.js/CHANGELOG.md/README.md/docs/）且 package.files 覆盖入口；
//   · npm pack --dry-run --json 文件清单可解析、包含入口/CHANGELOG/README。
// 输出文本或 --json 报告；失败退出码 1；**不 publish、不写文件**（--build 例外，只跑 build:client）。
//
// 用法：
//   node scripts/release-check.mjs
//   node scripts/release-check.mjs --json
//   node scripts/release-check.mjs --build        # 先跑 npm run build:client 再检查
//   node scripts/release-check.mjs --skip-build   # 跳过构建新鲜度检查

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 实现版本。 */
export const RELEASE_CHECK_VERSION = 1

/** 必需仓库文件（相对 cwd）。 */
export const RELEASE_REQUIRED_FILES = Object.freeze(['index.js', 'client.js', 'CHANGELOG.md', 'README.md'])

/** npm pack 清单必须包含的文件。 */
export const RELEASE_REQUIRED_PACKED = Object.freeze(['index.js', 'client.js', 'CHANGELOG.md', 'README.md'])

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析 CLI 参数。 */
export function parseReleaseCheckArgs(argv) {
  const args = Array.isArray(argv) ? argv : []
  const out = { json: false, build: false, skipBuild: false, help: false, unknown: [] }
  for (const arg of args) {
    const value = String(arg)
    if (value === '--json') out.json = true
    else if (value === '--build') out.build = true
    else if (value === '--skip-build') out.skipBuild = true
    else if (value === '--help' || value === '-h') out.help = true
    else out.unknown.push(value)
  }
  return out
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** 递归找 client-src 最新 mtime。 */
function latestSourceMtime(dir) {
  let latest = 0
  let files = 0
  const walk = (current) => {
    let names = []
    try {
      names = readdirSync(current, { withFileTypes: true })
    } catch (error) {
      void error
      return
    }
    for (const item of names) {
      const full = path.join(current, item.name)
      if (item.isDirectory()) {
        walk(full)
        continue
      }
      if (!item.isFile()) continue
      try {
        const stat = statSync(full)
        if (stat.mtimeMs > latest) latest = stat.mtimeMs
        files += 1
      } catch (error) {
        void error
      }
    }
  }
  walk(dir)
  return { latest, files }
}

/** 解析 npm pack --dry-run --json 输出（兼容警告行）。 */
export function parsePackJson(stdout) {
  const text = String(stdout ?? '').trim()
  if (text.length === 0) return null
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const first = parsed[0]
    if (!isPlainObject(first) || !Array.isArray(first.files)) return null
    return { name: typeof first.name === 'string' ? first.name : '', version: typeof first.version === 'string' ? first.version : '', files: first.files.filter((item) => isPlainObject(item) && typeof item.path === 'string').map((item) => item.path) }
  } catch (error) {
    void error
    return null
  }
}

/**
 * 运行发布前检查（默认只读；--build 会调用 build:client）。
 * @param {{
 *   cwd?: string,
 *   build?: boolean,
 *   skipBuild?: boolean,
 *   spawn?: Function|null,
 *   now?: () => number,
 * }} [options]
 */
export function runReleaseCheck(options = {}) {
  const spec = isPlainObject(options) ? options : {}
  const cwd = typeof spec.cwd === 'string' && spec.cwd.length > 0 ? spec.cwd : process.cwd()
  const spawn = typeof spec.spawn === 'function' ? spec.spawn : null
  const now = typeof spec.now === 'function' ? spec.now : () => Date.now()
  const checks = []
  const errors = []
  const warnings = []

  function addCheck(id, ok, detail) {
    checks.push({ id, ok: ok === true, detail: String(detail ?? '') })
    if (ok !== true) errors.push(`${id}：${detail ?? ''}`)
  }

  // 0) 可选构建
  if (spec.build === true) {
    try {
      if (spawn === null) {
        addCheck('build', false, '--build 需要可执行 spawn（测试请注入）')
      } else {
        const result = spawn('npm', ['run', 'build:client'], { cwd, encoding: 'utf8', timeout: 120000 })
        const status = result === null || result === undefined ? 0 : Number(result.status ?? result.code ?? 0)
        addCheck('build', status === 0, status === 0 ? 'build:client 完成' : 'build:client 退出码 ' + status)
      }
    } catch (error) {
      addCheck('build', false, error instanceof Error ? error.message : String(error))
    }
  }

  // 1) package.json
  const pkg = readJsonFile(path.join(cwd, 'package.json'))
  const version = isPlainObject(pkg) && typeof pkg.version === 'string' ? pkg.version : ''
  if (!isPlainObject(pkg) || version.length === 0) {
    addCheck('package', false, 'package.json 缺失或无法解析')
  } else {
    addCheck('package', SEMVER_PATTERN.test(version), SEMVER_PATTERN.test(version) ? 'version=' + version : '非法 semver：' + version)
  }

  // 2) CHANGELOG 条目
  try {
    const changelog = readFileSync(path.join(cwd, 'CHANGELOG.md'), 'utf8')
    const hasEntry =
      version.length > 0 &&
      (changelog.includes('v' + version) || changelog.includes('## ' + version) || changelog.includes('## [' + version + ']'))
    addCheck('changelog', hasEntry, hasEntry ? 'CHANGELOG 含 ' + version : 'CHANGELOG 缺少 ' + (version || '(版本未知)') + ' 条目')
  } catch (error) {
    addCheck('changelog', false, error instanceof Error ? error.message : String(error))
  }

  // 3) client.js 构建新鲜度
  if (spec.skipBuild === true) {
    checks.push({ id: 'build-freshness', ok: true, detail: '已按 --skip-build 跳过' })
    warnings.push('build-freshness 已跳过（--skip-build）')
  } else {
    const clientPath = path.join(cwd, 'client.js')
    if (!existsSync(clientPath)) {
      addCheck('build-freshness', false, 'client.js 不存在')
    } else {
      const source = latestSourceMtime(path.join(cwd, 'client-src'))
      const clientMtime = statSync(clientPath).mtimeMs
      const fresh = source.files === 0 ? true : clientMtime >= source.latest
      addCheck(
        'build-freshness',
        fresh,
        source.files === 0 ? 'client-src 为空，跳过' : 'client.js mtime ' + Math.round(clientMtime) + ' vs client-src 最新 ' + Math.round(source.latest) + (fresh ? '（新鲜）' : '（需 npm run build:client）'),
      )
    }
  }

  // 4) 必需文件
  const missing = RELEASE_REQUIRED_FILES.filter((file) => !existsSync(path.join(cwd, file)))
  if (!existsSync(path.join(cwd, 'docs'))) missing.push('docs/')
  addCheck('files', missing.length === 0, missing.length === 0 ? '必需文件齐全' : '缺少：' + missing.join('、'))
  if (isPlainObject(pkg) && Array.isArray(pkg.files)) {
    const covered = ['index.js', 'client.js'].every((file) => pkg.files.indexOf(file) >= 0)
    addCheck('package-files', covered, covered ? 'package.files 覆盖入口' : 'package.files 未包含 index.js/client.js')
  } else {
    addCheck('package-files', false, 'package.files 缺失')
  }

  // 5) npm pack --dry-run
  if (spawn === null) {
    addCheck('pack', false, '需要可执行 spawn 才能 npm pack --dry-run（测试请注入）')
  } else {
    try {
      const result = spawn('npm', ['pack', '--dry-run', '--json'], { cwd, encoding: 'utf8', timeout: 120000 })
      const stdout = result !== null && result !== undefined && typeof result.stdout === 'string' ? result.stdout : ''
      const packed = parsePackJson(stdout)
      if (packed === null) {
        addCheck('pack', false, 'npm pack --dry-run 输出无法解析')
      } else {
        const missingPacked = RELEASE_REQUIRED_PACKED.filter((file) => packed.files.indexOf(file) < 0)
        addCheck('pack', missingPacked.length === 0, missingPacked.length === 0 ? 'pack 文件清单 ' + packed.files.length + ' 项（' + packed.name + '@' + packed.version + '）' : 'pack 缺少：' + missingPacked.join('、'))
      }
    } catch (error) {
      addCheck('pack', false, error instanceof Error ? error.message : String(error))
    }
  }

  const ok = errors.length === 0
  return { ok, version: RELEASE_CHECK_VERSION, packageVersion: version, checks, errors, warnings, generatedAt: now(), cwd }
}

/** 格式化文本报告。 */
export function formatReleaseReport(report) {
  const lines = []
  lines.push(`[release-check] ${report.ok ? '通过' : '未通过'} · ${report.packageVersion || '(版本未知)'}`)
  for (const check of report.checks) lines.push(`- ${check.ok ? '✓' : '✗'} ${check.id}：${check.detail}`)
  for (const warning of report.warnings) lines.push(`! ${warning}`)
  if (!report.ok) lines.push('[release-check] 修复上述问题后再发布；本命令不会 publish/写文件')
  return lines
}

/** CLI 入口。 */
export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseReleaseCheckArgs(argv)
  if (options.help) {
    process.stdout.write(
      [
        '用法：node scripts/release-check.mjs [选项]',
        '  --json        输出 JSON 报告',
        '  --build       先执行 npm run build:client',
        '  --skip-build  跳过构建新鲜度检查',
        '  （默认只读；不会 publish/写文件）',
        '',
      ].join('\n'),
    )
    return { exitCode: 0, report: null }
  }
  if (options.unknown.length > 0) {
    process.stderr.write('[release-check] 未知参数：' + options.unknown.join(' ') + '\n')
    return { exitCode: 1, report: null }
  }
  const report = runReleaseCheck({ build: options.build, skipBuild: options.skipBuild, cwd: env.PWD || process.cwd() })
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else for (const line of formatReleaseReport(report)) process.stdout.write(line + '\n')
  return { exitCode: report.ok ? 0 : 1, report }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const result = main()
  process.exitCode = result.exitCode
}
