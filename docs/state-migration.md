# 状态备份、恢复演练与数据迁移（Gate A4）

> 目标：把“有备份”变成“能恢复”，并把 state schema 的迁移规则写死，避免升级时静默丢字段/丢记忆。
> 适用范围：`$DSH_HOME/.dsh-poetry/`（运行状态）与 `$DSH_HOME/agent-memory/`（长期记忆）。
> 相关代码：`lib/composition/state-specs.mjs`、`lib/kernel/state-schema.mjs`、`lib/kernel/json-store.mjs`、
> `lib/domain/memory/memory-hub.mjs`、`scripts/state-backup.mjs`、`scripts/state-restore-check.mjs`。

## 1. 数据在哪里

| 目录 | 内容 | 写入方 |
|---|---|---|
| `$DSH_HOME/.dsh-poetry/` | 设置、自我状态、心情/情绪、认知图谱、关系/承诺、项目、预算、游戏记忆、聊天历史等 JSON/JSONL | 各 domain 服务（原子写） |
| `$DSH_HOME/agent-memory/` | journal（md+jsonl）、learning-log、topics、voice、memory-layers、作品、`backups/`、`archives/` | 记忆服务 + memory-hub |
| `$DSH_HOME/state-backups/` | **本 Gate 新增**：`state-backup.mjs` 生成的全量快照（manifest + 文件镜像） | `scripts/state-backup.mjs` |

完整文件清点见 `docs/state-files.md`（W0 基线）；schema 注册表见 `lib/composition/state-specs.mjs`。

## 2. Schema 与版本机制

### 2.1 注册表

`createStateSpecs(stateDir)` 为每个 JSON 状态文件登记：

```js
{ id, file, version, normalizer, migrate?, fallback?, backup? }
```

- `version`：当前 schema 版本（数字，默认 1）；
- `normalizer(raw)`：清洗/补默认值/丢非法字段，**必须幂等**；
- `migrate(raw)`：旧字段 → 新字段（可选；先 migrate 再 normalize）；
- `backup`：写回前是否先备份（默认 true，`json-store` 写 `.bak-<timestamp>` 并保留 3 份）。

启动时 `migrateAll(registry, { dryRun })`：读 → migrate → normalize → 与原文比较 → **只有变了才写**（写前备份）。
坏 JSON 只告警、不覆盖（保留现场，人工处理）。

### 2.2 现有版本

截至本文，所有注册文件 `version = 1`；其中 5 个域有独立版本常量（均 = 1）：

| 文件 | 版本常量 |
|---|---|
| `worldview.json` | `WORLDVIEW_VERSION`（曾发生字段漂移事故，迁移时必须加测试） |
| `knowledge-graph.json` | `GRAPH_VERSION` |
| `relationship.json` | `RELATIONSHIP_VERSION` |
| `emotional-state.json` | `EMOTION_VERSION` |
| `commitments.json` | `COMMITMENTS_VERSION` |

JSONL 追加型文件（journal、learning-log、daily-life、thought-chains、model-errors 等）**不进注册表**，只追加不迁移；
字段演进靠读取方兼容（未知字段忽略）。

### 2.3 dry-run

- 迁移 dry-run：`DSH_POETRY_MIGRATE=dry-run`（启动时只报告哪些文件会被规范化，不写盘）；
- 审计只读：`node scripts/audit-state.mjs`（对比注册表与 `~/.dsh/.dsh-poetry` 实际 JSON，列出未注册文件）。

## 3. 迁移规则（写新迁移时必须遵守）

1. **只增不删**：新增字段必须给默认值；删除/改名必须走 `migrate` + 文档 + 测试，不允许 normalizer 静默丢用户数据。
2. **normalizer 幂等**：同一份数据 normalize 两次结果必须相同（`migrateAll` 靠比较决定是否写盘）。
3. **不联网、不调模型**：迁移必须是纯函数；不允许依赖外部服务或当前时间以外的环境。
4. **版本只升不降**：`version` 增加后，旧代码不得再读新文件（回滚需先恢复备份）。
5. **先备份再写**：`backup: true`（默认）；批量迁移失败时 `migrateAll` 返回 `errors > 0`，不会中断其他文件。
6. **坏文件不覆盖**：JSON 解析失败 → 告警 + 保留原文件；修复方式是从备份恢复或人工修 JSON。
7. **隐私边界**：状态文件里不写模型 key/密码；迁移日志不打印文件内容（只打 id/版本/路径）。
8. **测试**：新增/修改迁移必须带单测（旧形状 → 新形状 → 幂等 → 坏数据回退），并在 `npm test` 中跑。

## 4. 备份体系

| 机制 | 频率/触发 | 位置 | 保留 | 说明 |
|---|---|---|---|---|
| memory-hub 自动备份 | 启动 + 每 6h（心跳） | `agent-memory/backups/<时间>-<原因>/` | 最近 20 份 | 只备份核心记忆/状态文件；启动时**仅当核心文件缺失**才从最新备份恢复；损坏 JSON 只标记 |
| `state-backup.mjs` 全量快照 | 手动/升级前/定期（建议每周） | `$DSH_HOME/state-backups/<YYYYMMDD-HHmmss>[-原因]/` | 默认最近 7 份 | 覆盖 `.dsh-poetry` + `agent-memory`；manifest 含每个文件 size/sha256/mtime |
| json-store 写前备份 | 每次写入 | 同目录 `<file>.bak-<ts>` | 3 份 | 单文件级回滚 |
| archive-memory | 用户显式 | `agent-memory/archives/<id>/` | 不自动清理 | 归档个人记忆（不删除） |

`state-backup.mjs` 的一致性语义：

- **单文件一致**：每个文件只读一次内容，哈希与落盘用同一份 buffer；备份期间被删的文件记为 skipped；
- **跨文件非事务**：不做全局快照锁；要最稳的一致性，请在停止 DSH 后备份（文档建议升级前/停机时跑）；
- 排除项：嵌套 `backups/`、`archives/`、`*.tmp`/`*.partial`/`*.swp`/`*~`、符号链接；
- 不上传网络；备份目录 0700、文件 0600；manifest 只存相对路径，不含绝对 home/主机名。

常用命令：

```bash
# 备份（默认 $DSH_HOME/state-backups，保留 7 份）
node scripts/state-backup.mjs
# 只看会备份/清理什么
node scripts/state-backup.mjs --dry-run
# 指定 home/输出/保留份数/原因
node scripts/state-backup.mjs --home /tmp/dsh-home --out /tmp/backups --keep 3 --reason upgrade
# 机器可读
node scripts/state-backup.mjs --json
```

输出包含：备份 id/目录、文件数与体积（按源拆分）、保留/清理计划、跳过项。

## 5. 恢复演练（默认只读）

`state-restore-check.mjs` 默认流程：

1. 读取备份 `manifest.json` 并做结构校验（kind/version/路径安全/大小/哈希格式）；
2. 逐文件校验存在性、大小、sha256；
3. 在**系统临时目录**（`os.tmpdir()`）恢复一份，逐文件再校验；
4. 输出报告（文件数/体积/失败清单），默认删除临时目录。

安全约束：演练目录**禁止**位于 `$DSH_HOME` 内；不写 live 数据；不修改备份本身。

```bash
# 演练最近一份备份
node scripts/state-restore-check.mjs
# 指定备份 / 只校验不恢复 / 保留临时目录人工检查
node scripts/state-restore-check.mjs --backup /tmp/backups/20261118-113515 --no-copy
node scripts/state-restore-check.mjs --backup <dir> --keep-temp
# 机器可读
node scripts/state-restore-check.mjs --json
```

建议节奏：**每月一次 + 每次升级前 + 每次改迁移代码后**跑一遍；把输出（通过/失败）贴到发布记录里。

### 真恢复（用户手动，需停机）

1. 停止 DSH（插件卸载/停用或退出应用）；
2. 先对当前 live 再做一次备份（`state-backup.mjs`），避免二次损失；
3. 从备份目录把 `dsh-poetry/` 下的文件复制回 `$DSH_HOME/.dsh-poetry/`，`agent-memory/` 复制回 `$DSH_HOME/agent-memory/`（保留目录结构；不要复制 `manifest.json`）；
4. 跑 `node scripts/state-restore-check.mjs --backup <备份>` 确认备份本身完好；
5. 启动 DSH，检查 `health.json`、journal、设置页是否正常；
6. 异常则用第 2 步的备份回滚。

## 6. 失败回滚

| 场景 | 现象 | 回滚方式 |
|---|---|---|
| 迁移失败（normalizer 抛错/坏 JSON） | 启动日志 warn，文件未写 | 修复代码后重启；坏 JSON 从 `.bak-<ts>` 或 `state-backups` 恢复 |
| 迁移写回后行为异常 | 字段形状不对 | 用同目录 `.bak-<ts>` 覆盖回去（最多 3 份）；或 `state-backups` 全量恢复 |
| 备份写失败 | `state-backup` 退出码 1 | 旧备份**不会被清理**（保留策略在新备份成功后才执行）；检查磁盘/权限 |
| 恢复演练失败 | 报告 `哈希不一致`/`文件缺失` | 换更早一份备份；`--keep-temp` 保留现场人工比对；live 未被触碰 |
| 磁盘/目录误删 | 文件缺失 | memory-hub 启动时仅恢复**缺失**的核心文件；其余用 `state-backups` 手动恢复 |

## 7. 隐私清理边界

**可以安全删除（用户显式操作，删前先备份）**

- `model-errors.jsonl`：模型失败诊断，无提示词正文；
- `knowledge-graph-debug.json`：解析失败原始输出（排查用）；
- `*.tmp` / `*.bak-*` / `*.partial`：临时/旧备份残留；
- `agent-memory/archives/`：`archive-memory` 归档的个人记忆（删除前确认）；
- `state-backups/` 里超出保留份数的旧快照（脚本自动清理，或手动删）。

**不得自动删除（插件不会清理，只有用户显式要求才动）**

- `agent-memory/journal.*`、`learning-log.md`、`topics*.json`、`voice.json`、`memory-layers.json`；
- `.dsh-poetry/` 下的 `experience.json`、`self-state.json`、`chat-history.json`、`game-memory.json`、情绪/关系/承诺等；
- `settings.json`（外观与开关）。

删除流程：停止 DSH → 先 `state-backup.mjs` → 删除目标文件/目录 → 启动 → 检查 health/journal。
注意：备份本身包含同样的敏感内容（本地 0600、不上传）；如果目的是彻底清除，需同时删除 `state-backups/` 与 `agent-memory/backups/`。

## 8. 升级检查清单

- [ ] 读 `CHANGELOG` 与 `docs/state-files.md`，确认是否有状态字段变化；
- [ ] 停 DSH（或至少确认迁移 dry-run 输出）；
- [ ] `node scripts/state-backup.mjs --reason upgrade`；
- [ ] 启动一次，确认日志无迁移报错、`health.json` 正常；
- [ ] `node scripts/state-restore-check.mjs` 演练通过；
- [ ] 若升级引入新状态文件：确认已加入 `state-specs.mjs` 注册表 + 单测；
- [ ] 若删除/改名字段：确认 `migrate` 有测试、文档已更新、回滚步骤明确。

## 9. Gate A4 验收对应

| 验收项 | 对应 |
|---|---|
| 备份→临时恢复→校验通过 | `tests/kernel.test.mjs` 的 `state-backup A4` / `state-restore-check A4` 用例；CLI `--json` 冒烟 |
| 备份体积/保留可见 | `state-backup.mjs` 报告（按源文件数/体积、保留/清理清单）；`listStateBackups()` |
| dry-run | `--dry-run`（备份）/ `--no-copy`（恢复检查）/ `--json` |
| 不删除用户现有备份 | 清理只针对 `manifest.kind === 'dsh-state-backup'` 的目录；外来目录有单测保护 |
| 不触碰 live 数据 | 恢复检查只写 `os.tmpdir()`，拒绝 live 目录内演练；单测对比 live 文件哈希前后一致 |
| 文档覆盖迁移/回滚 | 本文第 2/3/6/8 节 |
