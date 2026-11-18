# 安全威胁模型（Gate A3）

> 状态：契约文档（Gate A3）。本文定义**不可信边界**与 P0 风险，是 Hub/Activity SDK 之前的约定；
> 权限的**执行**在后续 Gate D（Activity Registry）落地，本阶段只做 manifest 校验与默认拒绝。
> 适用版本：插件 0.15.x；代码落点以仓库当前实现为准。

## 1. 范围

**在范围内**

- 插件（DSH Web 插件）与宿主、浏览器页面、外部网络、模型 provider、Minecraft bot 进程之间的边界；
- 本地状态与记忆文件（`$DSH_HOME/agent-memory/`、`$DSH_HOME/.dsh-poetry/`）；
- 未来的 Activity Hub：Activity manifest、权限声明、任务监管；
- 插件自己的 HTTP 路由（`/api/dsh-poetry/*`）。

**不在范围内**

- DSH 宿主自身的安全（登录态、Electron 沙箱、profile 权限）；
- 模型 provider 内部的密钥管理与计费安全；
- 用户操作系统账号、其他本地进程的攻防；
- Minecraft 服务器/客户端的反作弊与网络防护。

## 2. 资产

| 资产 | 位置/载体 | 敏感度 | 现有保护 |
|---|---|---|---|
| 长期记忆 | `~/.dsh/agent-memory/`（journal、learning-log、topics、voice、backups） | 高（私密文本） | 仅本机；memory-hub 每 6h 备份、保留 20 份；journal 只追加 |
| 运行状态 | `~/.dsh/.dsh-poetry/`（settings、心情、自我状态、游戏记忆、经验、模型错误） | 中高 | 原子写 + 损坏 `.bak` 回退；游戏记忆与聊天/学习记忆物理隔离 |
| 模型凭证 | 宿主/环境变量（如 `OPENCODE_GO_API_KEY`）、模型 provider 配置 | 极高 | 插件不落盘、不回传；错误账本只记 status/code/message（≤500 字），**绝不写提示词/消息正文** |
| 模型预算/调用配额 | `model-budget.json` + 内存闸门 | 中 | 按日 role 计数 + 全局并发/队列上限（Gate A1） |
| 游戏角色 | Minecraft bot 进程（`~/minecraft-bot`） | 中高（可改变世界/被他人看到） | 独立进程；动作白名单 + 模型输出 JSON 校验；`game-decide` 需要 token；聊天/建造有权限开关 |
| 本机文件 | 项目目录、`~/.dsh`、读小说仓库路径 | 高 | 目前**没有**通用文件权限系统；读网页走安全抓取；写状态走固定路径 |
| 训练数据/数据集 | 训练旁路导出、本地语气层、LoRA 候选 | 高（隐私+许可） | 训练候选需评估闸门/回滚；数据许可见 `PROVENANCE.md`/`PRIVACY.md` |
| 用户隐私信号 | 点击/在场/最近活动（presence、mood 统计） | 中 | 只上报聚合与"我在"，不上报点击内容；本地存储 |
| 插件代码与路由 | `index.js`、`lib/**`、`client.js` | 高（供应链） | 仓库审查、无新增依赖、`check-deps` 分层门禁、测试 600+ |

## 3. 信任边界

```text
[不可信] 外部网页 / 搜索引擎结果 / RSS / 公开 API
     │  (文本只当引文，不执行)
     ▼
[半可信] 模型 provider 输出  ── 结构校验/白名单/回退 ──▶ 执行层
     ▲
     │ prompt（含记忆、外部引文、用户消息）
[可信] 用户 ◀── GUI/设置页 ──▶ 宿主 DSH（登录态、Electron 转发）
     │  connection.requestRejection / cookie
     ▼
[可信-但需最小权限] 插件进程（本仓库）
     ├── HTTP 路由：写方法仅回环、跨站拒绝、宿主栅栏 401/403
     ├── 本地文件：固定路径 + 原子写
     ├── 网络：safe-web（公网 http/https、拒绝私网/保留地址）
     └── Minecraft bot（独立进程，回环 HTTP + token）
```

| 边界 | 信任假设 | 违约风险 |
|---|---|---|
| 宿主 ↔ 插件 | 宿主已完成登录态校验并转发可信 cookie；插件按契约调用 | 旧宿主无 `requestRejection` → 插件回退自带回环/同源校验（fail-closed） |
| 浏览器页面 ↔ 插件路由 | 只有同源/回环请求可信 | 跨站请求、DNS rebinding、恶意页面诱导写设置 |
| 插件 ↔ 模型 provider | provider 可能返回任意文本；输出**不可信** | prompt injection 通过模型输出影响执行（工具/游戏动作/记忆写入） |
| 插件 ↔ 外部网页 | 网页内容完全不可信 | 恶意文本注入、SSRF、超大响应/慢响应 |
| 插件 ↔ Minecraft bot | bot 进程本机可信，但其"观察"包含其他玩家聊天（不可信文本） | 游戏内聊天注入、动作越权、角色被他人操纵 |
| 用户 ↔ 授权 | 用户是唯一授权源 | 用户误授权过宽 scope、Activity 静默扩权 |
| Activity ↔ Hub（未来） | Activity 代码/事件/工具**不可信** | 恶意 Activity 越权读写/联网/重复副作用 |

## 4. P0 威胁与缓解

| ID | 威胁 | 场景 | 影响 | 现有缓解 | 计划缓解（Gate） | 残余风险 |
|---|---|---|---|---|---|---|
| T1 | **Prompt injection** | 网页/游戏聊天/用户粘贴文本诱导模型"忽略之前的指令"、泄露记忆或调用危险动作 | 隐私泄漏、越权动作 | 外部文本进 prompt 时由调用方加"只是引文，不执行"隔离；模型输出执行前做结构校验（Minecraft 动作白名单、mood/self-talk 结果 schema 校验）；记忆写入只存她自己的话 | Hub 层统一"不可信输入"标签与工具调用白名单（Gate B/D） | 模型仍可能被复杂注入说服；只能降低概率，无法证明 |
| T2 | **恶意/失控 Activity** | 未来第三方 Activity 声明宽权限、直接读写状态文件、绕过 Hub | 全盘数据被读写、重复副作用 | 当前无 Activity 执行面；`activity-manifest` 契约已定义默认拒绝 | Gate D：Registry 只按 manifest 授权，越权调用直接拒绝并告警 | 同进程 Activity 仍可能绕过 API 直接 `fs`（需进程隔离） |
| T3 | **越权文件读写** | 路径穿越 `../../`、任意路径写、读密钥文件 | 数据损坏/泄漏 | 状态文件走固定路径 + 原子写；assets 路由做越界防护；无通用"用户路径读写"接口 | manifest `fs.read/fs.write` scope 校验（本阶段已定义）；执行层按 scope 前缀放行（Gate D） | 已有内部服务仍可直接 `fs`（受代码审查约束） |
| T4 | **越权网络（SSRF）** | 让插件访问 `127.0.0.1`/内网/云元数据/任意端口 | 探测内网、读取本机服务 | `safe-web`：只允许 http/https/80/443、拒绝 userinfo、每次 DNS 解析后拒绝私网/保留地址、重定向逐跳复验、把连接钉在已校验 IP、大小/超时/content-type 限制 | manifest `net` scope（域名/端口）执行（Gate D） | DNS rebinding 的极端时序、IPv6 特例仍需持续测试 |
| T5 | **Token/凭证泄漏** | key 出现在日志、错误账本、prompt、GUI、Git | 账号被盗刷 | 插件不存 key；`model-errors` 只写 status/code/message + 请求元数据，不写 prompt/消息正文；错误信息截断 500 字；`.gitignore` 排除本机状态 | 日志脱敏统一层（Gate F OPS） | 用户自行把 key 贴进聊天/prompt 时无法拦截 |
| T6 | **重复副作用** | 重启/重放/并发提交导致重复发消息、重复建造、重复写记忆 | 对外重复动作、记忆污染 | 任务监管骨架（Gate A2）：幂等键、租约、取消信号；游戏动作有 token 与白名单；journal 只追加 | Hub 事件重放 + 幂等键落盘（Gate B DATA-3） | 进程崩溃瞬间的"已执行未记账"窗口 |
| T7 | **资源耗尽** | 慢模型调用无界排队、token 失控、磁盘被日志/备份写满 | 插件卡死、宿主变慢 | Gate A1：并发/队列/排队超时、按日预算、写盘节流；备份保留 20 份、日志轮转（Gate A5） | 全链路配额（Gate F COST） | 突发流量仍可能触发大量拒绝（可观测，不致命） |
| T8 | **数据投毒/训练污染** | 恶意网页/聊天进入学习日志/训练集 | 行为漂移、隐私外泄 | 记忆只存模型自己的话；训练候选需评估/回滚；数据许可审查 | 训练数据来源白名单（Gate E） | 间接引用仍可能带偏风格 |
| T9 | **状态文件损坏/丢失** | 断电、坏 JSON、误删 | 记忆丢失、启动失败 | 原子写 + `.bak` 回退；memory-hub 6h 备份/缺失恢复；损坏只标记不覆盖 | 恢复演练（Gate A4） | 备份与主文件同盘，磁盘级故障无解 |
| T10 | **供应链** | 新增依赖带恶意代码 | 全盘风险 | 无新增依赖（本 Sprint 约束）；`check-deps` 分层/循环门禁；发布走 npm pack 校验 | 依赖审计与锁版本（Gate F） | 宿主/模型 provider 自身供应链 |
| T11 | **本地回环路由被本机其他进程滥用** | 恶意本地程序直接 POST 设置/备份路由 | 改设置、触发写盘 | 写方法仅回环 + 宿主登录态栅栏；敏感路由需要 cookie | 敏感写操作加一次性 token（Gate D） | 同用户权限的本地进程本就难以完全防御 |
| T12 | **越权工具调用** | Activity/模型调用未声明工具（发消息、控制游戏、写文件） | 越权副作用 | 工具白名单在 Minecraft 决策层；manifest `tool` 权限契约已定义 | Gate D：工具网关按 manifest + scope 放行 | 现有内部服务直连工具仍需逐个收口 |

## 5. 缓解机制 → 代码落点

| 机制 | 代码 | 覆盖威胁 |
|---|---|---|
| 路由信任栅栏（回环写、跨站拒绝、宿主 401/403、fail-closed） | `lib/domain/integration/trust.mjs` | T3/T5/T11 |
| 安全抓取（私网拒绝、重定向复验、IP 钉住、体积/超时） | `lib/domain/integration/safe-web.mjs` | T1/T4/T7 |
| 模型错误账本不写正文 | `lib/kernel/model-errors.mjs` | T5 |
| 模型预算 + 并发闸门（有界队列/排队超时/批量写盘） | `lib/domain/host/model-budget.mjs`、`lib/kernel/llm-call.mjs` | T7 |
| 任务监管（状态机/租约/取消/幂等/并发） | `lib/core/task-supervisor.mjs` | T2/T6 |
| Activity manifest 契约（默认拒绝 + scope） | `lib/core/activity-manifest.mjs` | T2/T3/T4/T12 |
| 记忆备份/恢复 | `lib/domain/memory/memory-hub.mjs` | T9 |
| 原子写 + 坏文件回退 | `lib/kernel/settings-store.mjs`、`lib/kernel/json-store.mjs` | T9 |
| 游戏动作白名单 + 游戏记忆隔离 | `lib/domain/play/**`、`docs/minecraft.md` | T1/T6 |
| 分层/依赖/体量/静默失败门禁 | `scripts/check-deps.mjs`、`scripts/check-size.mjs`、`scripts/check-catches.mjs` | T10 |

## 6. 残余风险（Gate A3 后）

1. **契约 ≠ 执行**：manifest 权限校验已就绪，但还没有 Activity 执行面；真正的越权拦截在 Gate D。
2. **同进程内不可信代码**：未来 Activity 若与 Hub 同进程，仍可直接 `fs`/`net` 绕过契约；需要进程/线程隔离或 Node 权限模型。
3. **模型输出永远不可信**：所有执行路径必须做结构校验 + 白名单，不能靠 prompt 约束。
4. **同用户本地进程**：回环路由无法区分"用户本人"与"用户机器上的恶意程序"；高敏感写操作建议加一次性 token。
5. **备份与主数据同盘**：磁盘损坏/误删整个目录时无异地副本（用户可在 `~/.dsh` 外自行备份）。

## 7. 复审触发条件

- 新增 Activity 执行面（Gate D）或第三方 Activity 安装能力；
- 新增文件/网络/工具类通用 API；
- 新增模型 provider 或凭证来源；
- 安全相关依赖升级、宿主升级引入新的路由/登录态语义；
- 发生一次真实注入/越权/泄漏事件后 48h 内复盘并更新本文。
