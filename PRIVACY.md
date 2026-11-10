# 隐私说明（dsh-little-whale）

## 她的数据放在哪里

插件默认把“她的记忆”保存在本机 `~/.dsh` 下，不上传到本项目维护者：

- `~/.dsh/agent-memory/`：journal、学习日志、话题库、声音档案、她写/画的作品；
- `~/.dsh/.dsh-poetry/`：设置、聊天历史、心情/情绪、认知图谱、承诺、判断/思维链等状态；
- `~/.dsh/.dsh-poetry-twin/`：镜像/孪生实例的数据（若启用）；
- 托管模型 provider 的请求由你配置的模型服务处理；插件本身没有自建服务器、没有遥测、没有账号体系。

## 会联网做什么（均为只读，按需开启）

| 用途 | 目标域名（示例） |
|---|---|
| 读小说/读哲学/溜达 | `zh.wikisource.org`、`*.wikipedia.org`、`raw.githubusercontent.com`（用户指定书目仓库） |
| 天气 | `geocoding-api.open-meteo.com`、`api.open-meteo.com` |
| 看大家说话 / 公开热搜 | `weibo.com`、`top.baidu.com`、`api.bilibili.com`、`hn.algolia.com` 等公开页面/接口 |
| 网页搜索（可选） | 由 DSH 的搜索能力或已配置的安全搜索提供方处理 |
| 插件/模型 | 由你自己的 DSH 宿主与模型 provider 决定 |

- 不登录、不评论、不带 cookie、不写回任何站点；
- 抓到的网页只用于当次生成，记忆里只保存她自己的话（她主动写下的）；
- 每个联网行为都有开关（如 `DSH_POETRY_WANDER=off`、`DSH_POETRY_READING=off`）。

## 删除数据

停止 DSH 后删除 `~/.dsh/agent-memory/` 与 `~/.dsh/.dsh-poetry/` 即可；插件不保留其他副本（插件内的备份也在这两个目录里）。

## 免责

这是个人向的陪伴型插件，不提供医疗、法律、投资建议；她的输出不保证事实正确，重要信息请自行核实。
