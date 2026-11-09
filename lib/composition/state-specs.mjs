// @ts-check
// lib/composition/state-specs.mjs —— 首批纳入 schema 注册表的状态文件（W1）
//
// 只放“有 normalize 函数、且 id 可枚举”的 JSON 文件；jsonl 追加型文件不在此列。
import path from 'node:path'
import { normalizeSelfActionsFile } from '../domain/being/self-actions.mjs'
import { normalizeSelfBeing, resolveSelfBeingPath } from '../domain/being/self-being.mjs'
import { resolveEventsPath } from '../domain/being/self-events.mjs'
import { resolveMetabolismPath } from '../domain/being/self-metabolism.mjs'
import { resolveProjectsPath } from '../domain/being/self-projects.mjs'
import { resolveGuiInboxPath } from '../domain/chat/gui-inbox.mjs'
import { EMOTION_VERSION, normalizeEmotions } from '../domain/emotion/emotional-continuity.mjs'
import { resolveModelBudgetPath } from '../domain/host/model-budget.mjs'
import { GRAPH_VERSION, normalizeGraph } from '../domain/knowledge/knowledge-graph.mjs'
import { resolveCurriculumPath } from '../domain/learning/self-curriculum.mjs'
import { normalizeWorldview, WORLDVIEW_VERSION } from '../domain/learning/worldview.mjs'
import { resolveAttentionPath } from '../domain/relationship/attention.mjs'
import { COMMITMENTS_VERSION, normalizeCommitments } from '../domain/relationship/commitments.mjs'
import { normalizeRelationship, RELATIONSHIP_VERSION } from '../domain/relationship/relationship-memory.mjs'
import { normalizeVoiceFile, resolveVoicePath } from '../domain/voice/voice-memory.mjs'
import { resolveMediaBudgetPath } from '../domain/works/media-budget.mjs'

/** 尚未写 normalizer 的 JSON 状态：identity 只提供损坏检测/备份/health 登记。 */
const identity = (raw) => raw

export function createStateSpecs(stateDir, options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? process.env.HOME
  const file = (name) => path.join(stateDir, name)
  return [
    { id: 'worldview', file: file('worldview.json'), version: WORLDVIEW_VERSION, normalizer: normalizeWorldview },
    { id: 'knowledge-graph', file: file('knowledge-graph.json'), version: GRAPH_VERSION, normalizer: normalizeGraph },
    {
      id: 'relationship',
      file: file('relationship.json'),
      version: RELATIONSHIP_VERSION,
      normalizer: normalizeRelationship,
    },
    {
      id: 'emotional-state',
      file: file('emotional-state.json'),
      version: EMOTION_VERSION,
      normalizer: normalizeEmotions,
    },
    {
      id: 'commitments',
      file: file('commitments.json'),
      version: COMMITMENTS_VERSION,
      normalizer: normalizeCommitments,
    },
    { id: 'self-actions', file: file('self-actions.json'), version: 1, normalizer: normalizeSelfActionsFile },
    { id: 'self-state', file: resolveSelfBeingPath(env, home), version: 1, normalizer: normalizeSelfBeing },
    { id: 'voice', file: resolveVoicePath(env, home), version: 1, normalizer: normalizeVoiceFile },
    // 以下为 identity 规范化：先纳入损坏检测/备份/health，normalizer 后续补。
    { id: 'attention', file: resolveAttentionPath(env, home), version: 1, normalizer: identity },
    { id: 'curriculum', file: resolveCurriculumPath(env, home), version: 1, normalizer: identity },
    { id: 'self-events', file: resolveEventsPath(env, home), version: 1, normalizer: identity },
    { id: 'gui-inbox', file: resolveGuiInboxPath(env, home), version: 1, normalizer: identity },
    { id: 'media-budget', file: resolveMediaBudgetPath(env, home), version: 1, normalizer: identity },
    { id: 'metabolism', file: resolveMetabolismPath(env, home), version: 1, normalizer: identity },
    { id: 'model-budget', file: resolveModelBudgetPath(env, home), version: 1, normalizer: identity },
    { id: 'self-projects', file: resolveProjectsPath(env, home), version: 1, normalizer: identity },
    { id: 'methodology', file: file('methodology.json'), version: 1, normalizer: identity },
    { id: 'probe-state', file: file('probe-state.json'), version: 1, normalizer: identity },
    { id: 'research-thread', file: file('research-thread.json'), version: 1, normalizer: identity },
    { id: 'web-bench', file: file('web-bench.json'), version: 1, normalizer: identity },
    { id: 'wander-state', file: file('wander-state.json'), version: 1, normalizer: identity },
    { id: 'read-state', file: file('read-state.json'), version: 1, normalizer: identity },
    { id: 'netlang-state', file: file('netlang-state.json'), version: 1, normalizer: identity },
    { id: 'outbox', file: file('outbox.json'), version: 1, normalizer: identity },
    { id: 'proactive-chat', file: file('proactive-chat-state.json'), version: 1, normalizer: identity },
    { id: 'gui-push', file: file('gui-push-state.json'), version: 1, normalizer: identity },
    { id: 'chat-history', file: file('chat-history.json'), version: 1, normalizer: identity },
    { id: 'lifecycle', file: file('lifecycle.json'), version: 1, normalizer: identity },
  ]
}
