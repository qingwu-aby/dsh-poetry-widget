# mc_automate 完整自动机

## 支持的操作

```json
{"tool":"mc_automate","arguments":{"action":"create","name":"auto_eat","trigger":{"type":"hunger","threshold":16},"steps":[{"tool":"mc_eat","arguments":{}}],"stopWhen":{"foodGte":20},"maxRuns":10,"cooldownMs":5000,"continueOnError":false}}
```

- `create`：创建/覆盖
- `list`：查看
- `enable` / `disable`
- `delete`
- `run_once`

## 触发器

- `hunger`：饱食度 ≤ threshold
- `health`：生命 ≤ threshold
- `night`：游戏时间 13000–23000
- `inventory_full`：空槽 ≤1
- `interval`：每 `everyMs`
- `death`：死亡事件
- `player_join`：其他玩家加入
- `item_pickup`：捡到掉落物
- `dawn`：每天第一次天亮
- `always`

## 步骤

- 1–12 步；
- 可以使用已有原语；
- 也可以引用她注册的宏/受限代码工具（由宿主展开成原语步骤，bot 不执行代码）；
- 禁止 `mc_automate` 递归；
- 失败默认停止，`continueOnError:true` 可继续；
- 支持 `stopWhen`：`foodGte`、`healthGte`、`dayTime`、`any`。

## 长任务

- `schedule.timeoutMs` 限制单次运行时长（默认 60s）；
- 超时会记录 `timeout` 并结束当前轮；
- 自动机本身由触发器/冷却/次数控制重复。

## 安全

- 无任意代码；
- 无文件/网络/进程；
- 定义持久化到 `~/.dsh/.dsh-poetry/minecraft-automations.json`（0600）；
- 最多 50 个自动机；
- `maxRuns` 默认 20，显式传 0 才是无限；
- `night` 每个自然日只触发一次；
- `run_once` 可在忙碌的 World tick 中手动执行，不会互相锁死。
- 每次运行写事件回执。
