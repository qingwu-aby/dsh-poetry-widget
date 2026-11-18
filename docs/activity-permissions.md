# Activity 权限说明（Gate A3）

> 状态：契约文档。当前版本**只定义 manifest 权限契约与校验**（`lib/core/activity-manifest.mjs`），
> 还没有真正执行权限拦截的 Activity 运行时（计划在 Gate D 的 Activity Registry 落地）。
> 用户可见的权限授权界面也将在 Gate D/F 的控制面提供。

## 1. 一句话模型

**默认拒绝**：Activity 没在 manifest 里声明的权限，一律不能用；声明了也要按 scope 最小化。

## 2. 权限枚举

只有 5 类权限，不允许自定义（新增需走代码审查 + 威胁模型更新）：

| 权限 | 中文含义 | 典型 scope 示例 | 风险提示 |
|---|---|---|---|
| `fs.read` | 读取本机文件 | `fs.read:~/Books`、`fs.read:~/dsh-workspace/notes` | 可读到的内容都可能进 prompt/记忆，等同隐私暴露面 |
| `fs.write` | 写入本机文件 | `fs.write:~/Books/notes`、`fs.write:~/dsh-workspace/outputs` | 可覆盖/删除文件；scope 必须尽量窄 |
| `net` | 访问网络 | `net:api.open-meteo.com`、`net:zh.wikisource.org` | 可能触发外发数据/被注入；默认只允许公网 http/https |
| `model` | 调用模型 | `model`（不带 scope = 允许调用模型） | 消耗预算/token；模型输出仍不可信 |
| `tool` | 调用工具 | `tool:book.open`、`tool:book.*`（* 仅作说明，当前按精确匹配） | 工具可能产生真实副作用（发消息、控制游戏、写文件） |

权限字符串语法：

```text
<permission>            例：model
<permission>:<scope>    例：fs.read:~/Books
```

- scope 不能为空（`fs.read:` 非法）；
- 不允许控制字符，长度 ≤ 200；
- 同一 manifest 内权限条目去重，最多 32 条。

## 3. Activity manifest

一个 Activity 必须提供 manifest（当前由代码/测试构造；未来由 Activity 包提供）：

```js
{
  id: 'reading',                    // 必填：小写字母开头，3–40 位小写字母/数字/连字符
  version: '1.0.0',                 // 必填：语义化版本
  name: '读书',                      // 可选，默认用 id
  events: ['reading.started', 'reading.highlight', 'reading.finished'], // 必填，命名空间事件，≤64
  tasks: [                          // 必填，≤32；kind 唯一
    { kind: 'reading.read', goal: '读一章并留下笔记', priority: 30, success: '章节完成 + 笔记' },
  ],
  tools: ['book.open', 'book.page', 'book.highlight', 'book.note'],      // 必填，≤64
  permissions: ['fs.read:~/Books', 'model', 'tool:book.open'],           // 必填，可空数组（= 无权限）
  resources: { model: true, foreground: false, maxMinutes: 60 },         // 必填；字段可省，默认 false/false/60
  world: { entry: './world.mjs', isolate: 'process', health: 'reading.health' }, // 可选
}
```

校验规则（`validateActivityManifest`）：

- 必填字段缺失、类型错误、命名不合法、条目重复/超限 → 返回 `ok:false` + `errors[]`（一次收集全部，含 `path/code/message`）；
- 未知顶层字段允许（向前兼容），不会被复制进归一化 manifest；
- 越权权限（不在 5 类枚举内）→ `MANIFEST_UNKNOWN_PERMISSION`；
- 空 scope / 控制字符 / 超长 → `MANIFEST_INVALID_PERMISSION` / `MANIFEST_INVALID_VALUE`；
- 校验通过返回归一化 manifest（权限条目归一为 `{permission, scope, raw}`）。

## 4. scope 匹配规则

判定函数：`checkActivityPermission(manifest, 'fs.read:~/Books/a.md')`，返回 `{allowed, reason, permission, scope}`。

| 授权声明 | 请求 | 结果 | 说明 |
|---|---|---|---|
| `fs.read` | `fs.read:~/anywhere` | ✅ | 未带 scope 的授权覆盖整个权限 |
| `fs.read:~/Books` | `fs.read:~/Books` | ✅ | 精确相同 |
| `fs.read:~/Books` | `fs.read:~/Books/a.md` | ✅ | `fs.*` 按**路径前缀 + 边界**匹配 |
| `fs.read:~/Books` | `fs.read:~/Bookshelf` | ❌ | 前缀必须按路径边界（`/`） |
| `fs.read:~/Books` | `fs.read` | ❌ | 受控权限必须带 scope 请求（`scope-required`） |
| `model` | `model` | ✅ | 非 `fs.*` 权限按精确匹配 |
| `tool:book.open` | `tool:book.page` | ❌ | 精确匹配，不自动扩到同类工具 |
| `net:api.example.com` | `net:api.example.com` | ✅ | 非 `fs.*` 权限按精确匹配 |
| （空 manifest / 未声明） | 任意 | ❌ | 默认拒绝 |

默认拒绝的三种原因：

- `no-manifest`：没有 manifest（或为空）；
- `not-granted`：声明里没有该权限（或 scope 不匹配）；
- `invalid-permission`：请求本身不合法（未知权限/空 scope 等）。

## 5. 用户会看到什么（计划）

Gate D/F 的控制面会提供：

- 活动列表：Activity 名称、版本、来源、启用状态；
- 权限清单：每条权限的中文含义 + scope（如「读取本机文件：`~/Books`」）；
- 授权/撤销：首次启用时逐条确认；扩大 scope 需重新确认；
- 审计：最近一次权限拒绝原因（来自 Registry 告警），与 `health`/日志同一套观测。

在控制面就绪前，用户可通过阅读 manifest（或本文档）了解某个 Activity 能做什么。

## 6. 责任边界

| 角色 | 责任 |
|---|---|
| 插件/Hub | 校验 manifest 合法性；**默认拒绝**未声明权限；按 scope 放行；越权调用拒绝并记录告警 |
| Activity 作者 | 只声明真正需要的最小权限；scope 尽量窄；不绕过 Hub 直接访问 `fs`/`net`/宿主 |
| 用户 | 授权前确认权限范围；不把过宽 scope（如 `fs.write:~`）给不信任的 Activity；定期复查 |
| 宿主 DSH | 登录态、跨站栅栏、Electron 进程隔离；插件依赖其 `connection.requestRejection` |
| 模型 provider | 凭证与计费安全；插件不保存 key、错误账本不写 prompt/正文 |

**明确不做的事**：本阶段不执行真实权限系统、不做 Activity 沙箱、不做进程隔离；这些属于 Gate D。
因此当前 manifest 校验是**防误配置/防契约漂移**，不是防恶意代码的最终防线。

## 7. 常见问题

**Q：Activity 没写 permissions 字段会怎样？**
校验直接拒绝（`MANIFEST_MISSING_FIELD`）。想表示"不需要任何权限"，请写 `permissions: []`。

**Q：`model` 权限能调用任何模型吗？**
契约上 `model` 是"允许调用模型"，具体 provider/模型仍受 Model Gateway 策略（角色、预算、token 上限）约束；
`model:<scope>` 目前没有定义 scope 语义，建议只写 `model`。

**Q：`tool:book.*` 支持通配吗？**
当前**不支持**通配，按精确匹配（避免通配导致越权）。若需要一组工具，请逐条声明。

**Q：越权会发生什么？**
Gate D 起：调用被拒绝 + 记录拒绝原因（Registry 告警/health），Activity 收到可识别错误码；
不会静默降级为"部分执行"。

**Q：怎么审计某个 Activity 最近做了什么？**
Gate D/F 会提供 Activity 事件流与 Task 回执；在此之前可看 `health.json` 的服务快照与日志。

## 8. 与威胁模型的对应

本契约主要缓解 `docs/security-threat-model.md` 中的 T2（恶意/失控 Activity）、T3（越权文件）、
T4（越权网络）、T12（越权工具）。执行层落地前，这些威胁的残余风险见该文档第 6 节。
