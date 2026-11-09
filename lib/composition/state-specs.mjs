// @ts-check
// lib/composition/state-specs.mjs —— 首批纳入 schema 注册表的状态文件（W1）
//
// 只放“有 normalize 函数、且 id 可枚举”的 JSON 文件；jsonl 追加型文件不在此列。
import path from 'node:path'
import { COMMITMENTS_VERSION, normalizeCommitments } from '../legacy/commitments.mjs'
import { EMOTION_VERSION, normalizeEmotions } from '../legacy/emotional-continuity.mjs'
import { GRAPH_VERSION, normalizeGraph } from '../legacy/knowledge-graph.mjs'
import { normalizeRelationship, RELATIONSHIP_VERSION } from '../legacy/relationship-memory.mjs'
import { normalizeWorldview, WORLDVIEW_VERSION } from '../worldview.mjs'

export function createStateSpecs(stateDir) {
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
  ]
}
