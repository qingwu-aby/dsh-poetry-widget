# 发布 / 升级 / 回滚 Runbook（Gate N5）

> 目标：发布前有一键检查、升级/回滚有明确步骤。**`scripts/release-check.mjs` 不会 publish、不写文件**（`--build` 仅跑 `build:client`）。

## 1. 发布前检查

```bash
node scripts/release-check.mjs            # 文本报告（默认只读）
node scripts/release-check.mjs --json     # 机器可读报告
node scripts/release-check.mjs --build    # 先 npm run build:client，再检查
node scripts/release-check.mjs --skip-build  # 跳过构建新鲜度（仅应急）
```

检查项与失败处理：

| 检查 | 失败时 |
|---|---|
| package.json 版本合法 semver | 修正 `version` |
| CHANGELOG 含当前版本条目（`v<version>` 或 `## <version>`） | 在 `CHANGELOG.md` 补条目 |
| client.js 构建新鲜（client-src 最新 mtime ≤ client.js） | `npm run build:client`（或 `--build`） |
| 必需文件（index.js/client.js/CHANGELOG.md/README.md/docs/）与 package.files 覆盖入口 | 补齐文件/`package.files` |
| `npm pack --dry-run --json` 清单包含入口/CHANGELOG/README | 修正 `files`/忽略规则 |

退出码：`0` 通过；`1` 有失败项（不会执行任何发布动作）。

## 2. 升级 DSH 宿主

1. 记录当前版本：`node -e "console.log(require('./package.json').version)"` 与 DSH 宿主版本。
2. 看 `package.json` 的 `engines.dsh` 是否满足新宿主；升级宿主后先跑：
   ```bash
   npm test && npm run check
   ```
3. 重点回归：设置页各区块（模型/Hub/训练/成本/记忆与权限/Minecraft）、`/api/dsh-poetry/*.json` 契约测试、client.js 构建产物。
4. 升级失败 → 用 npm 安装上一版本 tarball/registry 版本回退，保留 `$DSH_HOME` 数据目录不动。

## 3. 插件版本发布

1. `npm version patch|minor`（或手动改 `package.json`）→ 更新 `CHANGELOG.md`（`v<version>` 条目）→ `npm run build:client`。
2. `node scripts/release-check.mjs` 全绿。
3. `npm pack --dry-run` 人工看一眼清单（不应含 live 数据/密钥）。
4. 真实发布（本 runbook 不代执行）：`npm publish` / 推送 tag / 分发 tarball；发布后安装到测试 profile 验证。

## 4. 备份（发布前）

```bash
node scripts/ops-maintenance.mjs            # dry-run 看计划
node scripts/ops-maintenance.mjs --apply    # 清理临时 + 备份 + 日志轮转
```

备份产物：`$DSH_HOME/state-backups/<id>/`（含 manifest sha256）。发布/升级前至少保留一份最近备份。

## 5. 灰度 / 回滚

- **灰度**：新版本先装到测试 profile（不同 `DSH_HOME` 或独立会话），观察 1–2 天：设置页可用、Hub off/shadow 无异常、模型调用正常、日志无未捕获异常。
- **回滚插件**：卸载新版本 → 安装上一版本（npm 指定版本或旧 tarball）→ 重启 DSH → `node scripts/release-check.mjs --skip-build` 确认基本文件/版本；数据目录不迁移即天然回滚。
- **回滚数据**：用 `state-backups/<id>` 的 manifest 恢复 `$DSH_HOME/.dsh-poetry` 与 `agent-memory`（先停服务，恢复后重启）。
- **训练/适配器回滚**：训练相关用 `training.json` 的 `rollback`（confirm:true）；adapter 目录先备份（见 `docs/training-runbook.md`）。

## 6. 数据迁移

- 版本升级如涉及数据格式（如 cost-policy/grants/taskboard 持久化文件），先备份再升级；旧文件由各 store 的“坏文件降级/默认值”兜底，不会阻塞启动。
- 不自动迁移用户文件；需要迁移时单独写脚本并在测试 profile 验证后再用于 live。

## 7. 常见失败

| 现象 | 排查 |
|---|---|
| release-check 报 build-freshness 失败 | 忘记 `npm run build:client`；跑 `--build` |
| pack 清单缺文件 | `package.json` `files` 未包含；检查 `.npmignore` |
| CHANGELOG 缺条目 | 补 `v<version>` 行（Unreleased 段即可） |
| 升级后设置页空白 | client.js 与宿主不兼容；回滚版本或重建并强刷 |
| 启动报路由重复 | 检查是否重复注册；回滚到上一版本 |
