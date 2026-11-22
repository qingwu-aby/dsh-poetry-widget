# Activity 通用工具注册表

`lib/core/activity-tool-registry.mjs` 把“原语 + 宏 + 受限代码”从 Minecraft 抽出来，任何 Activity 都可以用。

## 能力

- 校验工具名前缀；
- 只允许组合已声明的原语；
- 声明式宏最多 8 步；
- 受限代码只接收 `obs`，返回步骤数组；
- 禁止文件/网络/进程/动态代码；
- 100ms 执行超时；
- 持久化到各自 Activity 的工具文件。

Minecraft 只是 `prefix: 'mc_'` 的一个实例：

```js
createActivityToolRegistry({ prefix: 'mc_', allowedTools, file })
```

Reading/Study/Video/Desktop 可以分别用 `book_`、`study_`、`video_` 等前缀复用同一套。

## 边界

它扩展的是 **工作流组合**，不是底层能力。  
新增原语仍然要开发者补 Activity 工具或 DSH 插件。
