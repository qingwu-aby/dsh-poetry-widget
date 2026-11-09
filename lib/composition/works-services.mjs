import { createMediaBudget, resolveMediaBudgetPath } from '../domain/works/media-budget.mjs'
import { createSelfWorks, resolveWorksDir } from '../domain/works/self-works.mjs'

export function createWorksService({ env, home, assetsDir, getLlm, modelPolicy, modelErrorsPath, logger, getState }) {
  const mediaBudget = createMediaBudget({ file: resolveMediaBudgetPath(env, home) })
  const selfWorks = createSelfWorks({
    dir: resolveWorksDir(env, home),
    mediaBudget,
    getLlm,
    policy: modelPolicy,
    modelErrorsPath,
    logger,
    assetsDir,
    getContext: () => {
      try {
        return getState ? getState() : null
      } catch {
        return null
      }
    },
  })
  return { mediaBudget, selfWorks }
}
