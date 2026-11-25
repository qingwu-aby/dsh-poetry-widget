// @ts-check
// Voyager 式“代码迭代”：自定义工具执行失败后，把报错回灌给她自己改，而不是默默失效。
export function toolFailureLines(failures = []) {
  const list = Array.isArray(failures) ? failures.filter((item) => item && typeof item.name === 'string' && item.error) : []
  if (list.length === 0) return ''
  const lines = list.slice(0, 2).map((item) => {
    const times = Number(item.failCount) > 1 ? `（已经失败 ${item.failCount} 次）` : ''
    return `- ${item.name}${item.purpose ? `（${item.purpose}）` : ''}：${String(item.error).slice(0, 120)}${times}`
  })
  return [
    '你自己写的工具执行失败了（这不是系统故障，是代码问题）：',
    ...lines,
    '可以改：用 mc_define_code 同名重写一版（只看 obs 里的观察字段，返回步骤数组），改完我再执行；不想修也可以先不用它，改用手头的现成动作。',
  ].join('\n')
}
