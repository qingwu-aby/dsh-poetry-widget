# 小鲸鱼 · dsh-little-whale

DeepSeek Harness（DSH）Web 界面角落里的一只**会自己长大**的小鲸鱼：自处、自学、读小说、看大家说话、写自己的作品，有分层记忆、自己的声音、情绪延续与关系记忆；诗词与格律降权为二级菜单。

> 形象来自 [dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume)（MIT，见 [PROVENANCE.md](./PROVENANCE.md)）；数据来自 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT）与本地公版作品。

## 功能一览

- **自驱成长**：状态由事实时间线 + 她自己写下的一句「此刻状态」组成，不设阈值；自省/自学/自处都由她的模型决定。
- **分层记忆 + 记忆中枢**：journal 原文永久保留；每日整合回忆概括与自我短句；统一登记/备份/恢复/健康检查。
- **学习反哺**：自学、读小说、溜达、看大家说话 → learning-log → 记忆检索/认知图谱 → 聊天与自处；**哲学阅读优先于历史资源**（用户指定三个哲学仓库），按“问题→论证→反方→我的看法”读，并抽出**方法论账本**（辩证/怀疑/先验论证…）反哺自处与对话。
- **关系记忆 / 情绪延续 / 情绪评价 / 日常素材 / 承诺账本**：她记得你的偏好与约定；学习/研究结果会经“相关/可控/确定/归因”评价进入情绪线程；日有小事件，答应的事会提醒。
- **认知图谱 + 反哺机制**：学习日志增量抽取节点/关系/判断；对话时做**扩散激活**（沿关系 1–2 跳联想）；每晚**离线巩固**（合并重复节点、校准判断置信度、汇总当天学习），让知识真正进入语言与行为。
- **自主研究 / 自训练 / 世界观**：孪生研究线程、每周本地语言层自训练（评估闸门）、世界观周更与矛盾账。
- **作品与声音**：文字/SVG 作品、voice.json 自生成语言档案、飞花令/诗库/格律检测等诗词二级菜单。
- **聊天与主动消息**：GUI 对话桥、主动分享、图片 OCR、本地 1.5B 语气层（可选）。

## 安装

### 官方桌面端（主要形态）

在 DSH 里用 `plugin_manager` 安装本地目录；或把插件目录 link 到 profile 后重启 DSH。

### 从 GitHub 安装（仓库名仍为 dsh-poetry-widget）

```bash
# 1) 安装插件包
dsh plugin install https://github.com/qingwu-aby/dsh-poetry-widget
# 2) 自然重启 dsh web，浏览器 Ctrl+F5
```

### 从 npm 安装（发布后可用）

```bash
dsh plugin install dsh-little-whale
```

### 本地开发安装（link）

```bash
ln -s "$(pwd)" ~/.dsh/profiles/desktop/plugins/dsh-little-whale
# 重启 dsh web；改 code 后 Ctrl+F5，改 client 需重新 build:client
```

## 使用

- 点右下角形象打开面板：**成长 / 图谱 / 设置** 顶层 tab；诗词与格律在「成长 → 诗词」二级菜单。
- 右键形象可打开/关闭面板；拖动/吸附/缩放/隐藏均在设置里。
- 她自己的记忆在 `~/.dsh/agent-memory/` 与 `~/.dsh/.dsh-poetry/`。

## 配置

全部环境变量见自动生成的 [docs/config.md](./docs/config.md)（`npm run config:doc`）。常用：

| 变量 | 作用 |
|---|---|
| `DSH_POETRY_TWIN=on` | 镜像/孪生系统（含自主研究） |
| `DSH_AGENT_LOOP=on` | 常驻自进化巡检 |
| `DSH_POETRY_SELF_TRAIN=on` | 每周自训练本地语言层 |
| `DSH_POETRY_LOCAL_VOICE=mood\|chat\|on` | 本地 1.5B 语气层用途 |
| `DSH_POETRY_WEB=off` / `DSH_POETRY_WANDER=off` / `DSH_POETRY_READING=off` | 关闭对应行为 |
| `DSH_POETRY_MIGRATE=dry-run\|off` | 状态文件迁移模式 |

## 开发

```bash
npm install
npm run build:client     # 改 client-src 后必须
npm test                 # 512 条（含域测试 + 契约测试）
npm run check            # 依赖/体量/lint/语法
npm run test:coverage    # 覆盖率门槛（lines 65 / branches 65 / functions 70）
npm run config:doc       # 重新生成 docs/config.md
```

本机运维脚本（常驻巡检/自训练/本地语言层）见 [scripts/ops/README.md](./scripts/ops/README.md)；目录结构与依赖规则见 [docs/architecture.md](./docs/architecture.md)；状态文件见 [docs/state-files.md](./docs/state-files.md)；重构进度与 ADR 见 [docs/refactor-progress.md](./docs/refactor-progress.md)、[docs/adr/](./docs/adr/)；接口契约见 [docs/contract.md](./docs/contract.md)；验收清单见 [docs/acceptance.md](./docs/acceptance.md)。

## 已知限制

- 主脑是远端模型，本地只训练 1.5B 语气层；自训练有评估闸门与回滚。
- 她看不到图片内容，只能 OCR 图上的文字。
- 无音频输入/输出；不做真实世界操作。
- 插件依赖宿主 0.2.1-rc.x；升级宿主后需按 `plugin-test` 流程回归。

## 许可

MIT。素材与数据许可见 [PROVENANCE.md](./PROVENANCE.md)。
