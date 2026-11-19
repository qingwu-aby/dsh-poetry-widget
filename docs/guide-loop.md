# 跨场景攻略回路（B站 → 方法 → 游戏/学习）

## 目标

同一个主题/事务可以跨 Minecraft、Study、Video、Reading 关联：

```text
World/Study/Video 需要攻略
→ guide.lookup(topic)
→ 查 topic hub 缓存（同一主题跨场景复用）
→ B站搜索 bili_search
→ 取字幕 bili_subtitle
→ 模型总结成 method/steps
→ 写入 topic hub（guides.json）+ 游戏 method 记忆
→ 回到当前场景执行 / 验证
```

## 入口

### Minecraft

世界工具 `mc_guide {topic}`；卡住时 bot 会：

1. 先 `mc_inquire` 查文字；
2. 文字不够 → 自动 `mc_guide` 去 B 站看攻略；
3. 把结果写回 `method` 记忆，下轮行动可参考。

### 所有场景

受保护 API：

```http
GET  /api/dsh-poetry/guide.json?topic=Minecraft%20洞窟脱困&token=...
POST /api/dsh-poetry/guide.json
{"token":"...","topic":"红石自动化","question":"怎么做时钟","activity":"study"}
```

任何 Activity 都能用同一 `topic` 查询；命中缓存时不会重复搜视频。

## 主题中枢

`~/.dsh/.dsh-poetry/guides.json`：

```json
{
  "topics": {
    "minecraft 洞窟脱困": {
      "topic": "minecraft 洞窟脱困",
      "links": [
        {"activity":"minecraft","source":"bilibili:BV...","url":"...","title":"...","summary":"..."}
      ],
      "methods": ["插火把、挖阶梯、沿水流找出口"]
    }
  }
}
```

- 同一主题来自不同场景时追加 link，不覆盖；
- `method` 最多保留 8 条，links 最多 12 条；
- 7 天内命中缓存直接返回。

## 依赖 B站插件

通过宿主 `tools` 服务调用 `dsh-bili-scroll` 已注册的工具：

- `bili_search`
- `bili_subtitle`

如果 B站工具未安装/工具不可用，guide 返回明确错误（`video_search_unavailable`/`no_videos`/`no_subtitle`/`summary_unavailable`），不会伪造攻略。

## 边界

- 只读字幕并提炼，不自动播放、不下载视频；
- 字幕没有时跳过该视频；
- 总结器只依据字幕内容，不确定写“没提到”；
- 主题 hub 是本地文件，不联网同步。
