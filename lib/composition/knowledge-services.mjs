// lib/composition/knowledge-services.mjs —— 知识/关系/情绪域服务组装（W1）
import path from 'node:path'
import { createCommitments } from '../commitments.mjs'
import { createEmotionalState } from '../emotional-continuity.mjs'
import { createKnowledgeExtractor } from '../knowledge-extract.mjs'
import { createRelationshipMemory } from '../relationship-memory.mjs'
import { createSelfTrainer } from '../self-trainer.mjs'

/**
 * @param {{ settingsDir: string, learningLogPath: string, modelPolicy: object, getLlm: Function, modelErrorsPath: string, journal: object, logger: object|null, env: object, home: string }} deps
 */
export function createKnowledgeServices(deps) {
  const knowledgeGraph = createKnowledgeExtractor({
    file: path.join(deps.settingsDir, 'knowledge-graph.json'),
    statePath: path.join(deps.settingsDir, 'knowledge-graph-state.json'),
    learningLogPath: deps.learningLogPath,
    policy: deps.modelPolicy,
    getLlm: deps.getLlm,
    modelErrorsPath: deps.modelErrorsPath,
    journal: deps.journal,
    logger: deps.logger,
    env: deps.env,
  })
  knowledgeGraph.start()

  const selfTrainer = createSelfTrainer({ home: deps.home, env: deps.env, logger: deps.logger })
  selfTrainer.start()

  const relationship = createRelationshipMemory({
    file: path.join(deps.settingsDir, 'relationship.json'),
    policy: deps.modelPolicy,
    getLlm: deps.getLlm,
    modelErrorsPath: deps.modelErrorsPath,
    logger: deps.logger,
    env: deps.env,
  })
  const emotional = createEmotionalState({ file: path.join(deps.settingsDir, 'emotional-state.json') })
  const commitments = createCommitments({ file: path.join(deps.settingsDir, 'commitments.json') })
  return { knowledgeGraph, selfTrainer, relationship, emotional, commitments }
}
