// dsh-little-whale —— 宿主半区入口（M2）。
//
// 本文件只做三件事：引导启动、把 host.inject 交给 composition/plugin-runtime、导出插件名。
// 具体装配见 lib/composition/；分层与依赖规则见 docs/architecture.md。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPackageMeta } from './lib/kernel/paths.mjs'
import { createBootstrap } from './lib/composition/bootstrap.mjs'
import { startPluginRuntime } from './lib/composition/plugin-runtime.mjs'
import { registerLittleWhaleChatTool } from './lib/integrations/qq-bridge.mjs'
import { normalizeSettings } from './lib/kernel/settings-store.mjs'

/** Cordis 插件名（loader 诊断用；与 package.json 的 dsh.bundle 行 id 一致）。 */
export const name = 'dsh-little-whale'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_META = readPackageMeta(path.join(PACKAGE_ROOT, 'package.json'))
/** 版本号唯一来源：package.json（不在插件里重复维护字符串）。 */
const VERSION = PACKAGE_META.version ?? '0.0.0'
const DATA_DIR = path.join(PACKAGE_ROOT, 'data')
const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets')

/**
 * 宿主插件入口。
 * 必须走 inject —— apply 运行时刻 webServer / connection 的 fiber 可能尚未创建。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
function readSettings(boot) {
  try {
    return normalizeSettings(JSON.parse(readFileSync(boot.settingsPath.file, 'utf8')))
  } catch {
    return normalizeSettings(null)
  }
}

export async function apply(ctx) {
  const boot = createBootstrap(ctx)
  boot.host.inject(['webServer', 'connection', 'schedule', 'sessionController'], (hostCtx) => {
    startPluginRuntime({
      ...boot,
      hostCtx,
      packageRoot: PACKAGE_ROOT,
      dataDir: DATA_DIR,
      version: VERSION,
      assetsDir: ASSETS_DIR,
    })
  })
  // v0.2.1：QQ/对话传话工具可在设置里关闭（启动时读取；改后重启生效）。
  const settings = readSettings(boot)
  if (settings.qqBridge !== false) {
    boot.host.inject(['tools', 'webServer', 'attachments'], (toolCtx) => {
      const dispose = registerLittleWhaleChatTool({ host: boot.host, hostCtx: toolCtx, logger: boot.logger })
      if (typeof dispose === 'function') boot.host.effect(toolCtx, dispose, 'dsh-little-whale: qq bridge tool')
    })
  } else {
    boot.logger?.info?.('[dsh-little-whale] 设置关闭了 QQ 传话工具（little_whale_chat）')
  }
}
