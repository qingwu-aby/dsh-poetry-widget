// 窄 facade：只导出跨域需要的符号，避免 `export *` 把整域拉进来形成循环。
export { describeTimeline, formatBeingLine } from './self-being.mjs'
export { readSelfProjects, createSelfProjects } from './self-projects.mjs'
export { createMetabolism, resolveMetabolismPath } from './self-metabolism.mjs'
