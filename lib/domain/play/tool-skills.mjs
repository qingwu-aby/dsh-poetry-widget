// @ts-check
// Minecraft 工具经验：通用 tool-experience 的 activity:minecraft 视图。
import { createToolExperience, experienceContextKey } from '../../core/tool-experience.mjs'

export function buildSkillContext(observation = {}) {
  const obs = /** @type {any} */ (typeof observation === 'object' && observation !== null ? observation : {})
  const inventory = Array.isArray(obs.inventory) ? obs.inventory.map(String) : []
  const joined = inventory.join(' ').toLowerCase()
  return {
    empty: inventory.length === 0,
    hungry: Number(obs.food) <= 10,
    night: String(obs.timeOfDay || '').includes('夜'),
    stuck: obs.stuck === true,
    hasWood: /log|plank|wood|oak|birch|spruce|jungle/.test(joined),
    hasPickaxe: /pickaxe/.test(joined),
    hasTable: /crafting_table/.test(joined),
  }
}

export function contextKey(context = {}) { return experienceContextKey(context) }

export function createToolSkills(options = {}) {
  const experience = options.experience && typeof options.experience.record === 'function'
    ? options.experience
    : createToolExperience({ file: options.file, now: options.now })
  const scope = 'activity:minecraft'
  function record(input = {}) {
    return experience.record({
      scope,
      tool: input.tool,
      ok: input.ok,
      arguments: input.arguments,
      context: typeof input.context === 'object' && input.context !== null ? input.context : {},
    })
  }
  function summary(context = {}, limit = 4) { return experience.summary({ scope, context, limit }) }
  function snapshot() { return experience.snapshot() }
  return { file: experience.file, record, summary, snapshot, experience }
}
