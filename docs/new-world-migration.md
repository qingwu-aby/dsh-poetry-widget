# 带记忆重新开始一个 Minecraft 世界

## 可以，但要区分“她是谁”和“她在哪个世界”

当前 `~/.dsh/.dsh-poetry/game-memory/` 是**全局一份**，没有按世界隔离。直接换存档会把这些旧事实带进去：

- 旧世界出生点/坐标
- 旧玩家关系
- 旧房子/建造计划
- 旧 todo/日志

她可能会把旧坐标当成新世界的真实位置。

## 正确的“带记忆转世”

保留：

- `methods.md`：她学会的方法
- `inquiry.md`：她做过的调研/假设
- `vision.md`：她的长期愿景

归档并重置：

- `world.md`、`players.md`、`todo.md`、`PARTNER_GAME.md`
- `build/`、`log/`
- 旧内容完整快照到 `archive/world-<名字>-<时间>/`

## 用法

先停 bot，然后 dry-run：

```bash
cd ~/dsh-workspace/dsh-poetry-widget
node scripts/new-world.mjs --world "第二世界"
```

确认输出后执行：

```bash
node scripts/new-world.mjs --world "第二世界" --apply
```

然后再启动/切换 Minecraft 新世界和 bot。

如果确实想把旧建筑文档也留下（但不建议，坐标会混）：

```bash
node scripts/new-world.mjs --world "第二世界" --keep-build --apply
```

## 结果

新世界开始时，她会看到：

- 我记得的方法/调研/愿景；
- 新世界坐标、玩家、房子从零开始；
- 旧世界完整归档，可随时回看。

脚本默认 dry-run，只有 `--apply` 才写文件；不会删除未归档内容。
