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
- `always`

## 步骤

- 1–12 步；
- 只能使用已有原语；
- 禁止 `mc_automate` 递归；
- 失败默认停止，`continueOnError:true` 可继续；
- 支持 `stopWhen`：`foodGte`、`healthGte`、`dayTime`、`any`。

## 安全

- 无任意代码；
- 无文件/网络/进程；
- 定义持久化到 `~/.dsh/.dsh-poetry/minecraft-automations.json`（0600）；
- 最多 50 个自动机；
- `maxRuns` 默认 20，显式传 0 才是无限；
- `night` 每个自然日只触发一次；
- `run_once` 可在忙碌的 World tick 中手动执行，不会互相锁死。
- 每次运行写事件回执。
