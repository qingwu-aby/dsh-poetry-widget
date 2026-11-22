// Minecraft 工具注册表：通用 Activity 工具注册表的 mc_ 前缀封装。
import { createActivityToolRegistry } from '../../core/activity-tool-registry.mjs'

export function createMinecraftToolRegistry(options = {}) {
  return createActivityToolRegistry({ ...options, prefix: 'mc_' })
}
