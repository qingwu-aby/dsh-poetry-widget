# ADR 0002：状态文件统一 schema 与启动迁移

- 状态：已采纳（2026-11-09）
- 背景：worldview.json 曾因 essay.version/at 字段漂移，导致世界观静默停在 v4 数天；48 处裸读、77 处原子写各写各的。
- 决策：
  1. 所有 JSON 状态文件进入 `lib/kernel/state-schema.mjs` 注册表（id/file/version/normalizer/migrate）；
  2. 统一 `json-store` 原子写 + 备份轮转（最多 3 份 `.bak-*`）；
  3. 启动时 migrate：默认执行，`DSH_POETRY_MIGRATE=dry-run|off` 可控；损坏文件不覆盖，只报错；
  4. 迁移结果进 health.json 的 `stateMigrations`。
- 后果：新状态文件必须注册；旧文件按 touched 顺序迁移；jsonl 追加型文件保持追加语义。
