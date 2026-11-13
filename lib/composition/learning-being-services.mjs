// lib/composition/learning-being-services.mjs —— 学习/判断/成长/道德 装配（v0.2.3 从 domain-services 拆出）
//
// 这里只负责“把学习与 being 相关服务接起来”，不持有全局状态；domain-services 负责生命周期与跨域引用。

import path from 'node:path'
import { createGrowthArc } from '../domain/being/growth-arc.mjs'
import { createMoralPractice } from '../domain/being/moral-practice.mjs'
import { createRuleSynthesizer } from '../domain/being/rule-synthesis.mjs'
import { createThoughtChain } from '../domain/learning/thought-chain.mjs'
import { createPhilosophyService } from './learning-loop-services.mjs'

/**
 * @param {{
 *   env: object, home: string, settingsDir: string, memoryDir: string,
 *   journal: object, logger: object|null, heartbeat: object|null, serviceRuntime: object,
 *   selfState: object, getLlm: Function, modelPolicy: object, modelErrorsPath: string,
 *   commitments: object, emotional: object, emotionalEpisodes: object, affect: object,
 *   internalRules: object, habitMemory: object, memoryRecall: object, disposers: Function[],
 * }} deps
 */
export function createLearningBeingServices(deps) {
  const {
    env,
    home,
    settingsDir,
    memoryDir,
    journal,
    logger,
    heartbeat,
    serviceRuntime,
    selfState,
    getLlm,
    modelPolicy,
    modelErrorsPath,
    commitments,
    emotional,
    emotionalEpisodes,
    affect,
    internalRules,
    habitMemory,
    memoryRecall,
    disposers,
  } = deps

  const thoughtChain = createThoughtChain({
    positionsFile: path.join(settingsDir, 'positions.json'),
    chainsFile: path.join(settingsDir, 'thought-chains.jsonl'),
    journal,
    logger,
  })

  const { methodMemory, service: selfPhilosophy } = createPhilosophyService({
    selfState,
    getLlm,
    modelPolicy,
    modelErrorsPath,
    logger,
    journal,
    memoryDir,
    settingsDir,
    env,
    heartbeat,
    serviceRuntime,
    thoughtChain,
  })

  const growthArc = createGrowthArc({
    env,
    home,
    settingsDir,
    memoryDir,
    journalPath: path.join(memoryDir, 'journal.jsonl'),
    learningLogPath: path.join(memoryDir, 'learning-log.md'),
    journal,
    logger,
    heartbeat,
  })
  growthArc.start()
  disposers.push(() => growthArc.dispose())

  const moralPractice = createMoralPractice({
    env,
    heartbeat,
    commitments,
    emotional,
    journal,
    thoughtChain,
    methodMemory,
    affect,
    emotionalEpisodes,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    settingsDir,
    chainsFile: path.join(settingsDir, 'thought-chains.jsonl'),
  })
  moralPractice.start()
  disposers.push(() => moralPractice.dispose())

  const ruleSynthesizer = createRuleSynthesizer({
    env,
    rules: internalRules,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    journal,
    thoughtChain,
    methodMemory,
    habitMemory,
    recall: memoryRecall,
  })
  ruleSynthesizer.start()
  disposers.push(() => ruleSynthesizer.dispose())

  return { thoughtChain, methodMemory, selfPhilosophy, growthArc, moralPractice, ruleSynthesizer }
}
