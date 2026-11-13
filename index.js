// dsh-little-whale —— 宿主半区入口（M2）。
//
// 本文件只做三件事：引导启动、把 host.inject 交给 composition/plugin-runtime、导出插件名。
// 具体装配见 lib/composition/；分层与依赖规则见 docs/architecture.md。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPackageMeta } from './lib/kernel/paths.mjs'
import { createBootstrap } from './lib/composition/bootstrap.mjs'
import { startPluginRuntime } from './lib/composition/plugin-runtime.mjs'
import { registerLittleWhaleChatTool } from './lib/integrations/qq-bridge.mjs'

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
  // v0.2.0：QQ/对话传话工具从独立子插件并入；工具名与语义保持不变。
  boot.host.inject(['tools', 'webServer', 'attachments'], (toolCtx) => {
    const dispose = registerLittleWhaleChatTool({ host: boot.host, hostCtx: toolCtx, logger: boot.logger })
    if (typeof dispose === 'function') boot.host.effect(toolCtx, dispose, 'dsh-little-whale: qq bridge tool')
  })
}
