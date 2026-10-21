# data-src/ —— 古诗词 curated 源快照（本地离线）

本目录随项目保留一份**精选源数据快照**，用于离线阅读/离线重建数据，不需要网络、也不需要完整的 329MB
语料缓存即可使用；构建最终 `data/` 产物时，这些文件是知识卡、宋词、韵部等内容的**首选源**（缺失时才回退到
完整语料缓存）。

## 来源与许可

| 项 | 值 |
|---|---|
| 仓库 | [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) |
| commit | `b8594f81a89752241442f2ce267d6f66f96704ee` |
| 许可 | MIT（Copyright (c) 2016 JackeyGao，见本目录 `LICENSE`） |
| 文本性质 | 公版古典诗词（作者逝世均已逾千年），可自由分发 |

## 文件清单

| 文件 | 字节 | 用途 |
|---|---|---|
| `全唐诗/唐诗三百首.json` | 190,787 | 诗精选主源（近体 4 类），含 tags |
| `宋词/宋词三百首.json` | 151,283 | 词精选主源（280 首 / 83 词人） |
| `蒙学/qianjiashi.json` | 69,087 | 千家诗（诗精选补充源） |
| `蒙学/shenglvqimeng.json` | 30,154 | 《声律启蒙》30 韵部（`data/yun.json` 主源） |
| `蒙学/tangshisanbaishou.json` | 148,829 | 唐诗三百首（蒙学版，备用/对照） |
| `诗经/shijing.json` | 156,972 | 《诗经》全文（离线资源，暂未进入 data/） |
| `楚辞/chuci.json` | 141,832 | 《楚辞》全文（离线资源，暂未进入 data/） |
| `LICENSE` | 1,076 | chinese-poetry MIT 许可原文 |
| `source.json` | 1,521 | 源 commit + 每个文件的 sha256（构建期可校验） |
| **合计** | **≈890 KB** | 目标预算 ≤3MB，远低于预算 |

## 离线用法

```bash
# 校验离线源可用（不访问网络；curated 文件齐全即可通过）
node scripts/fetch-data.mjs --offline

# 离线重建 data/（需要完整语料缓存，见下节）
node scripts/build-data.mjs --offline
```

`scripts/fetch-data.mjs` 的源解析顺序：

1. `--source <dir>` / 环境变量 `POETRY_DATA_DIR`（显式指定）
2. 本目录 `data-src/`（curated 源快照，始终本地可用）
3. 项目同级 `_ref/poetry-source/b8594f81a897/`（完整语料缓存，329MB，不随包）
4. 系统临时目录里的旧物化缓存（历史兼容）
5. 网络物化（`_ref/poetry-data` git 仓库 → 本地缓存）——`--offline` 时禁止

## 完整语料缓存（构建 `data/` 必需）

完整语料（全唐诗 313 chunks + strains 平仄 + rank 热度 + 宋词 22 chunks + 蒙学）不随包，缓存在**项目同级**：

```
_ref/poetry-source/b8594f81a897/（相对项目根目录）
```

- 体积约 329MB；只读，不入 git、不随 npm 包发布。
- 重建方式（在有 `_ref/poetry-data` blobless clone 的机器上，可在线/离线）：
  ```bash
  node scripts/fetch-data.mjs --force    # 从 _ref/poetry-data 的 git 对象重新物化到 _ref/poetry-source/<commit>
  ```
- 仅做 curated 级离线使用时，不需要这份缓存，`data-src/` 已足够。

## 扩展数据资产（assets/data/）

`scripts/build-assets-data.mjs` 用本目录 + 完整语料缓存 + 平水韵表生成 3 份**扩展数据资产**（不进 `data/`
主产物、不改变 `dataVersion=2026-10-21.4`），由 Host 现有静态路由
`GET /api/dsh-poetry/assets?f=data/<文件名>` 直接提供（无需改 Host）：

| 文件 | 内容 | 体积 |
|---|---|---|
| `assets/data/anthology.json` | 扩展诗库：诗经 305 / 楚辞 65 / 千家诗 219 / 唐诗三百首古体乐府（去重后 135） = 724 首 | ≈356 KB |
| `assets/data/poems-bank.json` | 全唐诗/全宋诗精选库（诗库/飞花令用）4500 首，带 tones/form/start/rhymeIdx | ≈2.12 MB |
| `assets/data/pingshui.json` | 平水韵 106 韵部（平30/上29/去30/入17）+ charIndex（含简体别名） | ≈160 KB |
| `assets/data/ci-bank.json` | 全量宋词库（源 21,050 → 去重/清洗后 20,044 首），词牌别名归一 | ≈7.2 MB |
| `assets/data/manifest.json` | 上述三文件的 bytes/sha256/dataVersion/生成命令 | ≈1.1 KB |

构建（离线，只读本地源）：

```bash
node scripts/build-assets-data.mjs --offline                 # 默认 4500 首
node scripts/build-assets-data.mjs --offline --bank-target 4000
```

校验：

```bash
node --test tests/data.test.mjs      # 含 3 条 assets 资产测试
node scripts/validate-data.mjs       # 主 data/ 质量门
```

## 更新方式（上游出新数据时）

1. 更新 `_ref/poetry-data`（git pull 到目标 commit）；
2. `node scripts/fetch-data.mjs --force` 重新物化完整语料；
3. 重新生成本目录快照（只复制上表文件）并更新 `source.json` 的 commit/sha256；
4. `node scripts/build-data.mjs` → `node scripts/validate-data.mjs` → `node --test tests/data.test.mjs`；
5. 更新 `README.md` / `source.json` 里的 commit 记录。
