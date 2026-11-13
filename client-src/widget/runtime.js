// client-src/widget/runtime.js —— 组件运行时桥（React / createElement 由 register.js 注入）
//
// 视图与 hooks 是独立模块，但 React 实例来自插件 factory 的 `require('react')`。
// register.js 在 factory 里调用 setRuntime()，之后渲染期通过 getRuntime() 读取。
let runtime = null

export function setRuntime(next) {
  runtime = next
}

export function getRuntime() {
  if (!runtime) throw new Error('dsh-little-whale: 组件运行时尚未初始化')
  return runtime
}

export function getReact() {
  return getRuntime().React
}

export function h(type, props) {
  const create = getRuntime().h
  const args = [type, props]
  for (let i = 2; i < arguments.length; i += 1) args.push(arguments[i])
  return create.apply(null, args)
}
