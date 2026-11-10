# 公开使用 / 发布评估（2026-11-10）

> 结论：**插件本体可以给外人用**（代码 MIT、素材/数据有 PROVENANCE、无密钥、无遥测）；
> 但仓库里的 `scripts/ops/` 是作者本机的自动化工具，公开前应移出或脱敏；个人记忆数据全部在 `~/.dsh`，不在仓库。

## 1. 可以公开（随仓库/包）

- `index.js`、`lib/`、`client-src/`、`client.js`：插件代码；
- `assets/`（含 generated 92 张立绘）：MIT 来源，见 `PROVENANCE.md`；
- `data/`、`assets/data/`：chinese-poetry（MIT）+ 公版古籍；构建源快照 `data-src/`；
- `docs/`、`tests/`、`scripts/`（build/check/gen-config-doc 等通用脚本）；
- `README.md`、`CHANGELOG.md`、`LICENSE`、`PROVENANCE.md`、`PRIVACY.md`、`package.json`、`dsh-plugin.naming.json`。

npm 包 `files` 字段已排除 `tests/`、`docs/`、`scripts/`、`content/` 等，`npm pack` 不会带它们。

## 2. 不该公开（本机私有）

| 内容 | 位置 | 说明 |
|---|---|---|
| 她的记忆/日记/作品 | `~/.dsh/agent-memory/`（150M，已清理备份到 27M） | 个人对话、情绪、生成作品 |
| 插件状态 | `~/.dsh/.dsh-poetry/`（7.3M） | 聊天历史、twin 信件、世界反馈、模型错误 |
| 孪生数据 | `~/.dsh/.dsh-poetry-twin/` | 独立实例 |
| 凭据 | `~/.dsh/.credentials.yaml` | 模型 API key |
| 常驻巡检 | `~/dsh-workspace/agent-loop/` | ledger/queue/logs/weight（334M 模型与训练数据） |
| 大语料缓存 | `~/dsh-workspace/_ref/`（642M） | 飞花令全库、宠物动画、平水韵构建源，不随包 |
| 评测记录 | `scripts/eval/turing/runs/` | 含她的原话；已在 `.gitignore` |
| 本机部署件 | `scripts/ops/` | 含 `com.yangyuan.*` launchd label、`~/dsh-workspace` 路径、本机 mlx 路径 |

## 3. 公开前需要处理

1. **`scripts/ops/` 脱敏或移出仓库**：它把作者本机的 launchd label、mlx 路径、agent-loop 私有 ledger/weight 假设写死了。建议移到私有仓库；如果坚持保留，把 label/path 改成 env 变量并默认通用值。
2. **历史记录**：`CHANGELOG.md`/`docs/` 里有本机绝对路径与个人工作区路径；如果要公开 GitHub，建议用 **squash 后的干净历史** 或至少改写这些提交。
3. **仓库名/包名**：仓库为 `dsh-poetry-widget`，插件/包名为 `dsh-little-whale`；公开时统一命名或 README 说明。
4. **模型依赖**：默认优先 `dsh-opencode-go`（`deepseek-v4.1-flash`）。外人没有这个 provider 时，插件会回退到宿主当前 selection（如 deepseek-account）；建议 README 增加“模型与 provider 配置”一节。
5. **可选增强**：本地 1.5B 语气层（`_ref`/mlx）不随包；外人安装后只是没有“本地语气层”，其余功能可用。
6. **隐私文档**：已补 `PRIVACY.md`（本地存储、联网域名白名单、关闭开关、删除方式）。

## 4. 本次安全检查

- `git grep` 未发现 API key/secret 入库（密钥只在 `~/.dsh/.credentials.yaml` 运行时读取）；
- 当前 384 个跟踪文件、29M；无 `.env`/本机 memory 文件被跟踪；
- `.gitignore` 已排除 `node_modules/`、`scripts/eval/turing/runs/`；
- 第三方素材/数据许可见 `PROVENANCE.md`（角色形象 MIT、诗词数据 MIT、动画素材 MIT 且不随包）。

## 5. 建议的公开方式

1. 仓库改为 MIT + `PRIVACY.md` + `PROVENANCE.md`；
2. `npm pack` 发布插件包（体积约 30M，含立绘与诗词库；如果嫌大，可把 `assets/generated` 与 `ci-bank` 做成可选下载）；
3. 另建 `dsh-little-whale-ops` 私有仓库保存 `scripts/ops` 与 `agent-loop`；
4. README 增加“外部用户最小配置”：DSH 版本、模型 provider、关闭自主联网的开关。
