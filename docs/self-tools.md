# 小鲸鱼自己扩展 Minecraft 工具

## 原语

她可以用这些动作自己解决生存问题：

- `mc_craft`：合成（木板/工作台/木镐/床等，依赖 mineflayer 配方）
- `mc_eat`：吃食物
- `mc_attack`：攻击附近动物/敌对生物
- `mc_collect`：捡掉落物
- `mc_equip`：把工具拿到手上
- `mc_use`：右键使用方块/实体（门、箱子、熔炉、床、羊）
- `mc_smelt`：用熔炉烧炼/烹饪
- `mc_sleep`：睡床跳过夜晚
- `mc_inventory`：读取完整背包与手持

这些动作没有在 prompt 里写“你现在缺什么”，她需要自己从 `mc_learn`/`mc_guide` 的攻略里判断。

## 宏工具

她可以调用 `mc_define_tool` 把一个固定动作序列保存成新工具：

```json
{
  "name": "mc_make_wooden_pickaxe",
  "purpose": "做木镐",
  "steps": [
    {"tool": "mc_craft", "arguments": {"item": "oak_planks", "count": 3}},
    {"tool": "mc_craft", "arguments": {"item": "stick", "count": 2}},
    {"tool": "mc_craft", "arguments": {"item": "wooden_pickaxe", "count": 1}}
  ]
}
```

限制：

- 只能组合已有原语；
- 最多 8 步；
- 工具名 `mc_` 前缀；
- 最多保存 30 个；
- 存在 `~/.dsh/.dsh-poetry/minecraft-tools.json`。

注册成功后，下一次 World prompt 会列出这个工具，模型可自己调用。

## 受限代码工具

她可以调用 `mc_define_code` 注册一个只读代码工具：

```js
return obs.food < 20
  ? [{ tool: "mc_eat", arguments: {} }]
  : []
```

限制：

- 代码只能读取 `obs`，返回步骤数组；
- 不能 `require/import/process/globalThis/Function/eval/fetch/child_process`；
- 不能访问文件/网络/进程；
- 语法在注册时检查，执行 100ms 超时；
- 返回的步骤仍只允许已有原语；
- 代码存在同一个 `minecraft-tools.json`。

它不是 DSH 插件级工具注册，只是“安全宏/步骤生成器”，不会执行任意代码。
