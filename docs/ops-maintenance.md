# 运维维护（ops-maintenance）

> 一条命令完成日常维护：**临时文件清理 → 状态备份 → 日志轮转**。
> 默认 dry-run（只报告，不改文件）；`--apply` 才真正执行。任一步失败会继续执行后续步骤并汇总（退出码 1）。

## 命令

```bash
# 1) dry-run：先看会做什么（推荐每次执行前先跑）
node scripts/ops-maintenance.mjs

# 2) JSON 报告（可接监控/定时任务）
node scripts/ops-maintenance.mjs --json

# 3) 真正执行
node scripts/ops-maintenance.mjs --apply

# 4) 自定义目录/策略
node scripts/ops-maintenance.mjs --apply --home "$DSH_HOME" \
  --log-dir "$HOME/Library/Logs" --keep 7 --max-size 10M --stale-ms 3600000
```

退出码：`0` 全部步骤成功；`1` 有步骤失败或参数非法。

## 步骤与安全边界

| 步骤 | 做什么 | 安全边界 |
|---|---|---|
| cleanup-temp | 清理已知目录中过期的临时文件（`*.tmp` / `.tmp-*`，且超过 `--stale-ms`） | 只扫 `$DSH_HOME/.dsh-poetry`、`training-logs`、`memory-exports`、`state-backups`；不删用户文件 |
| backup | 复用 `scripts/state-backup.mjs`：快照 `.dsh-poetry` + `agent-memory`，按 keep 保留 | 只写 `$DSH_HOME/state-backups`；dry-run 不写 |
| rotate-logs | 复用 `scripts/log-rotate.mjs`：按大小轮转 + 按份数清理 | 只处理日志目录下 `whale-*.log` 普通文件；copytruncate 不重启进程 |

失败隔离：任一步抛错/报错只记录到该 step 的 `errors`，后续步骤继续执行；最终 `ok:false` + 退出码 1。

## 建议频率

- **每日一次**（如凌晨低峰）：`--apply`；执行前可先跑一次 dry-run 检查。
- **每周一次**：人工看 `--json` 报告，确认备份保留份数/日志增长趋势。
- 不建议高频（<1h）运行：临时文件过期阈值默认 1h，频繁跑意义不大。

## launchd 示例（不自动安装）

`~/Library/LaunchAgents/com.example.dsh-ops-maintenance.plist`（示例，按需修改路径后 `launchctl load`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.dsh-ops-maintenance</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string><string>node</string>
    <string>/path/to/dsh-poetry-widget/scripts/ops-maintenance.mjs</string>
    <string>--apply</string><string>--json</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>10</integer></dict>
  <key>StandardOutPath</key><string>/tmp/dsh-ops-maintenance.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/dsh-ops-maintenance.err.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
```

安装（需用户自己执行，本仓库不自动安装）：

```bash
cp com.example.dsh-ops-maintenance.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.example.dsh-ops-maintenance.plist
```

## 验证

```bash
node scripts/ops-maintenance.mjs --json | jq '.ok, .steps[].id, .totals'
# 检查备份：
ls -lt "$DSH_HOME/state-backups" | head
# 检查日志轮转：
ls -lt "$HOME/Library/Logs" | grep whale | head
```

## 回滚

- **备份**：`state-backups/<id>/` 内含 manifest（sha256）；恢复时按 manifest 把文件拷回 `$DSH_HOME`（先停服务）。
- **日志轮转**：`node scripts/log-rotate.mjs --restore <轮转文件> --apply` 把轮转内容拼回原日志。
- **临时清理**：只删过期临时文件，不可恢复（均为崩溃残留/中间产物，不含用户数据）。

## 相关文件

- `scripts/ops-maintenance.mjs`（本命令）
- `scripts/state-backup.mjs`、`scripts/log-rotate.mjs`（被复用的既有脚本）
- `$DSH_HOME/state-backups`、`$DSH_HOME/.dsh-poetry/training-logs`、`$DSH_HOME/.dsh-poetry/memory-exports`
