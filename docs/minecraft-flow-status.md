# Minecraft 流程跑通状态（2026-11-23）

## 已跑通

| 流程 | 证据 |
|---|---|
| 放置 / 装备 / 精确放置重试 | 石台 + 夹具 |
| 容器存取 | store/take + 读回 |
| 红石灯 | lever → lit:true |
| 自动门 | lever → open:true |
| 活塞 | lever → extended:true |
| 农业 | plant → bonemeal → harvest → compost |
| 动物 | feed → shear → milk |
| 战斗 | attack / block / shoot / throw |
| 防守循环 | mc_defend 5 秒 |
| 自动收菜 | mc_autofarm 收 1 补 1 |
| 刷怪塔收集端 | 清怪 → 掉落 → 入箱 → 读回（collect 偶发漏拾） |
| 矿车骑乘 | mc_ride minecart |

全部在独立创造世界；生存世界未参与。

## 没跑通

| 流程 | 卡点 |
|---|---|
| bot 自建精确红石装置 | `mc_place at` 服务端 ack 不稳定，回退后坐标改变 |
| observer 精确朝向 | 请求 north，实际 east |
| 红石全自动农场 | observer+piston 未形成可重复验收 |
| boat 生成 | placeEntity 序列化错误；activateItem 不生成实体 |
| 刷怪塔完整自动化 | collect 已改为 24 格/5 轮扫描 + 0.8 格接近，待复验 |
| 矿车/轨道自建 | 只能骑已存在的 minecart，不能放轨道/矿车 |
| 装饰性建造 | 未验收 |
| 生存世界集成 | 未验证，避免污染当前世界 |

## 结论

P1/P2 主体、P3 基础战斗、P4 骑乘已跑通；  
剩余集中在“bot 自建装置的放置协议”和“载具/复杂自动化”。
