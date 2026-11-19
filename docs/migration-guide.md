# 小鲸鱼 / DSH 迁移指南

> 本机：DSH 0.2.1-rc.2，macOS，用户 `yangyuan`，DSH home `~/.dsh`。
> 会话：75 个 `session.v4.jsonl.zstd`；`~/.dsh/sessions` 约 107MB，`~/.dsh` 总计约 2.5GB，`~/dsh-workspace` 约 26GB（含 Minecraft 服务端/世界/缓存）。

## 0. 先选迁移等级

| 目标 | 要复制 | 适合 |
|---|---|---|
| 只要历史对话 | `~/.dsh/sessions` + `~/.dsh/storages` | 新设备干净、重新登录/重装插件 |
| 完整搬家 | 整个 `~/.dsh` + 插件仓库 + 必要 workspace | 想尽量开箱即用 |
| 全量克隆 | 上面 + `~/dsh-workspace` + MLX/本地模型 + launchd | 连 Minecraft/本地语音一起搬 |

**关键限制：DSH 会话目录名和每条 session 的 `cwd` 都是绝对路径**，例如：

```text
~/.dsh/sessions/--Users-yangyuan-Documents-deepseek-harness-default-workspace--/<session>/session.v4.jsonl.zstd
```

所以“历史对话能不能无缝出现”最大取决于：**新设备是否使用相同的用户短名和相同的 workspace 绝对路径**。  
最稳做法：新 Mac 也建 `/Users/yangyuan`，并把 workspace 放在相同路径。用户短名不同则可能需要在目标设备处理路径，不能保证开箱即见。

## 1. 源机器：停止写入并打包

先完全退出 DSH（`Cmd+Q`），再执行：

```bash
# 只搬对话与索引
rsync -a --exclude '*.lock' --exclude '.DS_Store' \
  ~/.dsh/sessions ~/.dsh/storages \
  /Volumes/Backup/dsh-history/

# 完整 DSH home（含插件、设置、凭据、小鲸鱼记忆）
rsync -a --exclude '*.lock' --exclude '.DS_Store' \
  ~/.dsh/ /Volumes/Backup/dsh-home/

# 插件源码/工作区（按需，26GB 很大）
rsync -a --exclude 'logs' --exclude 'libraries' --exclude 'jars' \
  ~/dsh-workspace/ /Volumes/Backup/dsh-workspace/
```

建议额外单独备份：

```bash
~/.dsh/profiles/desktop/cordis.patch.yml
~/.dsh/.credentials.yaml
~/.dsh/.dsh-poetry/          # 小鲸鱼设置/记忆/游戏记忆
~/.dsh/agent-memory/         # 她的长期记忆/日记
~/.dsh/.dsh-poetry-twin/     # 镜像鲸鱼
~/Library/Application Support/dsh-whale-mlx/   # 本地 1.5B 语音层/自训练 adapter（如要搬）
~/Library/LaunchAgents/com.yangyuan.whale.*.plist
```

不要复制 `*.lock`、`.DS_Store`；不要手动解压/编辑 `session.v4.jsonl.zstd`。

## 2. 目标机器：先装同版本 DSH

1. 安装 **相同版本** Desktop（本机 0.2.1-rc.2；版本不同先看升级指南）。
2. 先启动一次，生成 `~/.dsh`；然后完全退出。
3. 恢复 DSH home：

```bash
rsync -a --exclude '*.lock' --exclude '.DS_Store' \
  /Volumes/Backup/dsh-home/ ~/.dsh/
```

4. 若目标不是 `/Users/yangyuan`，至少把 **workspace 放到原绝对路径**，或保留一个同名用户；否则会话可能归到旧项目路径。

## 3. 插件与配置

`~/.dsh/profiles/desktop` 约 573MB，里面已有插件配置和部分 `node_modules`。两种方式：

### 方式 A：整包复制（同 macOS/同架构最省事）

```bash
rsync -a /Volumes/Backup/dsh-home/profiles/desktop/ ~/.dsh/profiles/desktop/
```

注意 `dsh-poetry-widget` 是**符号链接**，指向：

```text
../../../../Documents/deepseek-harness/default-workspace/dsh-poetry-widget
```

目标机要么把仓库放到同样路径，要么重装/改链接。

### 方式 B：重装插件（更干净）

```bash
# 以实际插件包/路径为准
dsh plugin --profile desktop add dsh-bili-scroll
dsh plugin --profile desktop add /path/to/dsh-poetry-widget
```

然后恢复 `cordis.patch.yml`。其中可能含绝对路径，例如：

```yaml
- id: bili-scroll
  config:
    pythonPath: /Users/yangyuan/.dsh/bili-duty/.venv/bin/python
```

目标机要改路径或重建 venv。

## 4. 登录与密钥

- `.credentials.yaml` 含 DeepSeek 账号 OAuth/设备记录；**建议目标机重新登录**，比直接复制更稳（设备绑定可能失效）。
- 如果复制，先备份原文件；登录失败就删除对应记录重新扫码。
- DeepSeek 搜索 API key：
  - 新版设置页「DeepSeek 搜索」保存到 `~/.dsh/.dsh-poetry/deepseek-api-key`（0600）；
  - 迁移时可复制该文件，或迁移后重新在设置页填写；
  - 环境变量 `DSH_POETRY_DEEPSEEK_API_KEY` 优先级更高。

## 5. Minecraft / 本地语音（按需）

Minecraft：

- 服务端世界在 `~/dsh-workspace/minecraft-bot/server`（`world/`、`server.properties` 等）；
- 建议只搬世界和配置，jar/libraries 在目标机重装；Java 版本要一致；
- launchd plist 里有绝对路径，需要按目标机修改并 `launchctl bootstrap`；
- bot 的 `discoverDshUrl()` 会找 DeepSeek 监听端口，通常不用改。

本地语音/自训练：

- `~/Library/Application Support/dsh-whale-mlx/`（model-1.5b、adapters-live、self-train）；
- 体积大、与 MLX/芯片架构相关；目标机不是 Apple Silicon 就不要直接搬。

## 6. 恢复后验证

```bash
# 会话数量
find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' | wc -l

# 抽查一条会话能否解压
find ~/.dsh/sessions -name 'session.v4.jsonl.zstd' | head -1 | xargs zstd -dc | head -1

# 插件/设置
ls ~/.dsh/profiles/desktop/node_modules/dsh-poetry-widget
```

GUI 里检查：

1. 左侧历史会话是否出现、能否打开旧对话；
2. 设置 → 插件 → 小鲸鱼 是否能打开；
3. 模型策略是否仍是 `deepseek-account/deepseek-flash`；
4. 聊天/记忆是否正常；
5. Minecraft bot 是否连上（如需）。

## 7. 最大程度“开箱即用”的推荐组合

**同 macOS + 同用户短名 + 同 workspace 路径**：

```text
复制整个 ~/.dsh
+ 把插件仓库放回原路径或重装
+ 复制 ~/Documents/little-whale-chat、little-whale-books/videos
+ 复制 ~/dsh-workspace（按需，至少 minecraft-bot/server/world 和 agent-loop）
+ 修 launchd plist 路径
+ 重新登录 DeepSeek 账号
```

如果目标用户名不同，**不要期待会话自动归到新 workspace**；最稳是保持 `/Users/yangyuan/...` 路径，或接受旧会话在旧路径分组下查看。

## 8. 注意

- 先停 DSH 再复制，别在运行中直接搬 `sessions`；
- 不要复制 `*.lock`；
- 不要把 `.credentials.yaml`、`deepseek-api-key` 上传网盘/仓库；
- 迁移前保留一份 `~/.dsh/state-backups` 和 `sessions` 的独立备份。
