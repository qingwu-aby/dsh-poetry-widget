/**
 * 兼容入口：`node --test tests/client.test.mjs` 与 `node --test tests/client/` 均可运行。
 * 真正的测试在 tests/client/widget.test.mjs（node:test 在同一进程内注册）。
 */
import './client/widget.test.mjs'
