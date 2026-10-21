# PROVENANCE —— 第三方素材与数据来源

本项目代码为 MIT。以下第三方资源的来源、许可与使用方式单独说明。

## 1. 角色形象

- 文件：`assets/mascot-celebrate.webp`、`assets/icon.webp`
- 原文件：`assets/generated/dsh-whale-state-celebrate.webp`
- 来源：<https://github.com/Sutera-Diffusus/dsh-whale-musume>（`main` 分支，2026-10-21 取得）
- 许可：MIT License，Copyright (c) 2026 Sutera-Diffusus（见该仓库 LICENSE）
- 修改：`icon.webp` 为原图直接复制用于插件图标；`mascot-celebrate.webp` 未修改。若后续做裁剪/压缩，会在本文件记录。
- 用途：本插件挂件形象。按要求保留原作者署名；不用于再许可之外的用途。

## 1b. 挂件立绘（92 张，本地）

- 目录：`assets/generated/`（92 个 WebP，共 12,692,916 B，2026-10-21 取得）
- 原目录：<https://github.com/Sutera-Diffusus/dsh-whale-musume/tree/main/assets/generated>（`main` 分支）
- 许可：MIT License，Copyright (c) 2026 Sutera-Diffusus（同仓库 LICENSE）
- 修改：原样下载，未修改；客户端按状态（天气/飞花对局/待机）引用其中一部分，其余保留供后续功能使用。
- 用途：挂件形象与天气/对局状态；不用于再许可之外的用途。

## 2. 诗词数据

- 目录：`data/poems.json`、`data/ci.json`、`data/yun.json`
- 来源：<https://github.com/chinese-poetry/chinese-poetry>，commit `b8594f81a89752241442f2ce267d6f66f96704ee`
- 许可：MIT License，Copyright (c) 2016 JackeyGao
- 使用字段：`全唐诗/`（全唐诗、全宋诗）、`strains/`（逐句平仄）、`rank/`（热度）、`宋词/`（全宋词 + 词牌）、`蒙学/shenglvqimeng.json`（声律启蒙 30 韵部）、`蒙学/tangshisanbaishou.json`、`蒙学/qianjiashi.json`（精选校验）
- 处理：对齐/过滤/排序/繁体→简体逐字转换；产物中保留 `linesOriginal` 原文。诗词文本本身为公版古籍。
- 重新生成：`node scripts/build-data.mjs`（`data/manifest.json` 记录源 commit、构建时间与统计）。
- 本地化：`data-src/` 保存构建所需 curated 源快照（可离线重建/核对）；完整语料缓存默认在 `_ref/poetry-source/b8594f81a897/`（不随包），见 `data-src/README.md`。

## 2b. 构建期押韵校验字表（不随包）

- 文件：`_ref/pingshui/pingshui_rhyme/data/organized_ping_ze_rhyme_dict.json`（仅构建时读取，**产物与包内不含**）
- 来源：<https://github.com/rbnyng/pingshui_rhyme>，MIT License，Copyright (c) 2024 rbnyng；韵书文本为公版《平水韻》（Wikisource 转录）
- 用途：构建期校验诗韵脚（平声韵部/同韵/首句借邻韵），并辅助繁体异体归一；不改变数据来源（诗词仍来自 chinese-poetry）。

## 3. 知识内容

- 文件：`content/cards.json`、`content/ci-cards.json`、`content/yun-overrides.json`，构建期并入 `data/knowledge.json`
- 来源：本项目原创撰写；内容为公版格律常识（王力《诗词格律》体系等通行表述），例句为公版诗/词/联。
- 许可：MIT（随本项目）。

## 4. 未使用的素材（声明）

- 未使用 `DeepSeek-Balance-Whale-Widget` 的任何图片/音频/动图（该仓库美术素材不在 MIT 覆盖范围内）。仅参考其交互与工程结构（代码 MIT）。

## 5. 下架/署名请求

如权利人认为上述使用不当，请提 issue 或联系仓库维护者，我们会立即移除相应素材并重新发布。
