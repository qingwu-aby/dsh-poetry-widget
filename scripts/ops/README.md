# 运维脚本（scripts/ops）

这里的文件是**本机部署件**的版本化来源：常驻巡检、自训练、本地 1.5B 语言层服务。仓库只存脚本与模板，不存运行状态、日志和权重。

## 内容

| 路径 | 作用 |
|---|---|
| `agent-loop/run.sh` | 常驻巡检入口：headless `dsh --profile resident` + 持久 session |
| `agent-loop/prompt.md` | 巡检任务提示词（读 ledger/queue、跑健康检查、按队列改代码） |
| `agent-loop/health-check.mjs` | 跑核心测试 + 检查推送/队列/模型错误，写 `agent-loop/state/health.json` |
| `agent-loop/self-train.mjs` | 自训练闭环（收数据 → 中性对照 → LoRA → 评估闸门 → 换 adapter） |
| `agent-loop/self-train.sh` | 自训练入口包装（日志落 `$WHALE_MLX_HOME/self-train/`） |
| `mlx/server.sh` | 本地语言层服务（`mlx_lm.server`，默认端口 8080） |
| `launchd/*.plist.template` | launchd 模板（`__HOME__` / `__WORKSPACE__` / `__MLX_HOME__` 由 install 渲染） |
| `install.mjs` | 渲染模板并把脚本/plist 安装到本机 |

## 后台独立运行（可选）

`agent-loop` 可以脱离 GUI 由 launchd 定时运行，但 macOS 的 TCC 会拒绝 launchd 进程访问 `~/Documents`：

- 若要让 launchd 独立跑，需要给执行它的 shell（如 `/bin/bash`）或包装程序授予「完全磁盘访问权限」；
- 否则会出现 `Operation not permitted`（exit 126），此时保持 DSH 应用运行即可，她的后台循环本来就在宿主进程内自动跑；
- 安装/重载：`node scripts/ops/install.mjs` → `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yangyuan.whale.agent-loop.plist`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `WHALE_WORKSPACE` | `~/Documents/deepseek-harness/default-workspace` | 巡检工作区（含 `agent-loop/`） |
| `WHALE_MLX_HOME` | `~/Library/Application Support/dsh-whale-mlx` | 模型/adapter/日志目录 |
| `WHALE_DSH_HOME` | `~/.dsh` | DSH 家目录（journal/credentials/chat-history） |
| `WHALE_REPO` | `$WHALE_WORKSPACE/dsh-poetry-widget` | 插件仓库路径（health-check 用） |
| `WHALE_MLX_MODEL` / `WHALE_MLX_ADAPTER` | 模型/`adapters-live` | 本地服务使用的模型与 adapter |
| `WHALE_MLX_PORT` | `8080` | 本地服务端口 |
| `WHALE_MLX_PLIST` | `com.yangyuan.whale.mlx-server` | 自训练换 adapter 后重启的 launchd label |

## 安装 / 更新

```bash
# 只补缺失文件（安全默认，不覆盖本机已有脚本）
node scripts/ops/install.mjs

# 覆盖本机脚本与 plist（升级后用）
node scripts/ops/install.mjs --force

# 只预览
node scripts/ops/install.mjs --dry-run
```

安装后按脚本输出里的 `launchctl` 命令加载/重启服务。

## 不纳入版本控制的内容

- `agent-loop/ledger.md`、`queue/`、`state/`、`logs/`（她自己的运行记录与状态）；
- `agent-loop/weight/`（约 334MB 数据集、模型、日志；训练脚本若需要版本化再单独收）；
- `~/.dsh/`（记忆、凭证、会话）与任何密钥；
- 本机生成的 `*.plist`（由模板 + install 渲染）。

脚本本身不含密钥：`OPENCODE_GO_API_KEY` 在运行时从 `$WHALE_DSH_HOME/.credentials.yaml` 读取。
