#!/usr/bin/env node
/**
 * patch-dsh-opencode-go.mjs —— 让 dsh-opencode-go@0.1.24 在 DSH 0.2.1-rc.2 上能加载（task-71）
 *
 * 背景：DSH 0.2.1-rc.2 的 `@deepseek-ai/dsh-typert-protocol` 已不导出 `RemoteError`，而
 * dsh-opencode-go@0.1.24 的 `lib/index.js` 仍然
 *   import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
 * 于是整个插件在 profile 内加载失败，provider `dsh-opencode-go` 不注册，插件模型调用只能
 * 回落原生 `opencode-go`（其 zen/go 网关已废弃，必然 400 INVALID_REQUEST）。
 *
 * 本脚本把导入改成只导入 `TypertRemoteService`，并内联一个与旧导出行为等价的
 * `RemoteError` 类（`code` / `message` / `data`，`name = "RemoteError"`）。
 *
 * 特性：幂等（已打过补丁直接退出 0）；首次修改前备份原文件；只改这一个文件。
 * 注意：这是对已安装第三方包 node_modules 的本地补丁，**插件升级/重装后可能需要重跑**；
 * 运行后需要让 DSH 重新加载 profile 插件（桌面端重启 DSH 或重载 profile）。
 *
 * 用法：
 *   node scripts/patch-dsh-opencode-go.mjs                 # 打补丁（默认 profile: desktop）
 *   node scripts/patch-dsh-opencode-go.mjs --dry-run       # 只检查，不写文件
 *   node scripts/patch-dsh-opencode-go.mjs --profile web   # 指定 profile
 *   DSH_HOME=/path/to/.dsh node scripts/patch-dsh-opencode-go.mjs
 *
 * 退出码：0 成功/无需修改；1 插件版本与预期不符；2 找不到已安装的插件。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OLD_IMPORT =
  'import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";'
const NEW_IMPORT = 'import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";'
const LOCAL_CLASS_MARKER = 'class RemoteError extends Error'
const LOCAL_CLASS = `class RemoteError extends Error {
  constructor(code, message, data) {
    super(String(message));
    this.name = "RemoteError";
    this.code = String(code);
    this.data = data;
  }
}`

function parseArgs(argv) {
  const options = { profile: process.env.DSH_PROFILE || 'desktop', dryRun: false, home: process.env.DSH_HOME || '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--profile') {
      options.profile = argv[index + 1] || ''
      index += 1
    } else if (arg === '--home') {
      options.home = argv[index + 1] || ''
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/patch-dsh-opencode-go.mjs [--dry-run] [--profile <name>] [--home <DSH_HOME>]')
      process.exit(0)
    } else {
      console.error(`未知参数：${arg}`)
      process.exit(1)
    }
  }
  if (!options.profile) {
    console.error('--profile 不能为空')
    process.exit(1)
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const home = options.home ? path.resolve(options.home) : path.join(os.homedir(), '.dsh')
  const target = path.join(home, 'profiles', options.profile, 'node_modules', 'dsh-opencode-go', 'lib', 'index.js')

  console.log(`[patch-dsh-opencode-go] 目标：${target}`)
  if (!existsSync(target)) {
    console.error(
      '[patch-dsh-opencode-go] 找不到已安装的 dsh-opencode-go。\n' +
        '先在 DSH 里安装插件（plugin_manager install_bundle，target: dsh-opencode-go），再运行本脚本。',
    )
    process.exit(2)
  }

  const source = readFileSync(target, 'utf8')
  if (source.includes(LOCAL_CLASS_MARKER) && !source.includes(OLD_IMPORT)) {
    console.log('[patch-dsh-opencode-go] 已是兼容版本，无需修改（幂等）。')
    return
  }
  if (!source.includes(OLD_IMPORT)) {
    console.error(
      '[patch-dsh-opencode-go] 文件里没有预期的 RemoteError 导入，插件版本可能已变化。\n' +
        '请检查 dsh-opencode-go 的 package.json 版本，并确认是否已有官方修复版本可用。',
    )
    process.exit(1)
  }

  const patched = source.replace(OLD_IMPORT, `${NEW_IMPORT}\n${LOCAL_CLASS}`)
  if (patched === source || !patched.includes(LOCAL_CLASS_MARKER) || patched.includes(OLD_IMPORT)) {
    console.error('[patch-dsh-opencode-go] 替换校验失败，未写文件。')
    process.exit(1)
  }

  if (options.dryRun) {
    console.log('[patch-dsh-opencode-go] --dry-run：可以打补丁（未写文件）。')
    return
  }

  const backup = `${target}.bak-remoteerror-${Date.now()}`
  copyFileSync(target, backup)
  writeFileSync(target, patched, { encoding: 'utf8' })
  console.log(`[patch-dsh-opencode-go] 已打补丁；备份：${backup}`)
  console.log('[patch-dsh-opencode-go] 下一步：重启 DSH（或重载 profile），确认 provider dsh-opencode-go 注册。')
}

main()
