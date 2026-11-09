# 配置注册表（自动生成）

> 由 `scripts/gen-config-doc.mjs` 从 `lib/kernel/config.mjs` 生成，勿手改。

## 功能

| 环境变量 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `DSH_POETRY_TWIN` | boolean | false | 镜像/孪生系统（含自主研究） |
| `DSH_AGENT_LOOP` | boolean | false | 常驻自进化巡检 |
| `DSH_POETRY_SELF_TRAIN` | boolean | false | 每周自训练语言层 |
| `DSH_POETRY_DAILY_LIFE` | boolean | true | 日常生活素材生成 |
| `DSH_POETRY_GRAPH` | boolean | true | 认知图谱抽取 |
| `DSH_POETRY_RELATIONSHIP` | boolean | true | 关系记忆抽取 |
| `DSH_POETRY_WORLDVIEW` | boolean | true | 世界观周更 |
| `DSH_POETRY_WEB` | boolean | true | 真实网页访问 |
| `DSH_POETRY_WANDER` | boolean | true | 网络溜达 |
| `DSH_POETRY_READING` | boolean | true | 读小说/读记 |
| `DSH_POETRY_NETLANG` | boolean | true | 看大家说话（RSS） |
| `DSH_POETRY_EXPERIENCE` | boolean | true | 经历账本 |
| `DSH_POETRY_PROACTIVE_QUIET_HOURS` | boolean | false | 主动消息静默时段（已默认关闭） |
| `DSH_POETRY_LOCAL_VOICE` | enum | off（off / mood / chat / on） | 本地 1.5B 语言层用途 |
| `DSH_POETRY_MIGRATE` | enum | on（on / dry-run / off） | 状态文件迁移模式 |

## 模型

| 环境变量 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `DSH_POETRY_MODEL_PROVIDER` | string |  | LLM provider 覆盖 |
| `DSH_POETRY_MODEL` | string |  | LLM 模型覆盖 |
| `DSH_POETRY_DEEPSEEK_API_KEY` | string | （已隐藏） | DeepSeek 搜索/网页密钥 |

## 路径

| 环境变量 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `DSH_HOME` | string | ~/.dsh | DSH 家目录 |
| `DSH_PET_MEDIA_DIR` | string |  | 宠物媒体目录 |
| `DSH_AGENT_MEMORY_DIR` | string |  | 记忆目录覆盖 |
| `DSH_SELF_STATE` | string |  | 自身状态文件覆盖 |
| `DSH_VOICE` | string |  | 声音档案覆盖 |
| `DSH_SELF_TALK_TOPICS` | string |  | 碎碎念话题库覆盖 |
| `DSH_POETRY_FULL_INDEX` | string |  | 飞花令全库索引路径 |
| `DSH_POETRY_FEELINGS` | string |  | 自造感受词文件覆盖 |
| `DSH_POETRY_SEARCH_URL` | string |  | 搜索接口 URL 覆盖 |

## 本地服务

| 环境变量 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `DSH_POETRY_LOCAL_VOICE_URL` | string | http://127.0.0.1:8080/v1 | 本地语言层服务地址 |
| `DSH_POETRY_LOCAL_VOICE_MODEL` | string | default_model | 本地语言层模型名 |
| `DSH_POETRY_OCR_BIN` | string |  | OCR 可执行文件路径 |

## 周期

| 环境变量 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `DSH_POETRY_WANDER_MIN` | number | 40 | 溜达间隔（分钟） |
| `DSH_POETRY_WANDER_FIRST_MIN` | number | 5 | 首次溜达最早（分钟） |
| `DSH_POETRY_WANDER_FIRST_MAX` | number | 25 | 首次溜达最晚（分钟） |
| `DSH_POETRY_WORK_INTERVAL_MS` | number | 0 | 作品循环间隔（毫秒） |
| `DSH_POETRY_WORK_INITIAL_MS` | number | 0 | 作品循环首次延迟（毫秒） |
| `DSH_POETRY_SELF_TRAIN_INTERVAL_MS` | number | 604800000 | 自训练间隔 |
| `DSH_POETRY_SELF_TRAIN_FIRST_MS` | number | 43200000 | 自训练首次延迟 |
