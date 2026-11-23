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
| 刷怪塔收集端 | 清怪 → 收集 → 入箱 → 读回（已复验 4/4） |
| 矿车骑乘 | mc_ride minecart |

全部在独立创造世界；生存世界未参与。

## 没跑通

| 流程 | 卡点 |
|---|---|
| bot 自建红石装置 | 已通过：lamp+lever、door+lever、piston+lever 均按实际 at 自建并触发 |
| observer 精确朝向 | 请求 north，实际 east |
| 红石全自动农场 | observer+piston 未形成可重复验收 |
| boat | 召唤后实体列表里完全没有 boat；mineflayer 不跟踪该实体 |
| 刷怪塔完整自动化 | 已通过：清怪→收集→入箱→读回（rotten_flesh×1） |
| 矿车/轨道自建 | 只能骑已存在的 minecart，不能放轨道/矿车 |
| 装饰性建造 | 未验收 |
| 生存世界集成 | 未验证，避免污染当前世界 |

## 结论

P1/P2 主体、P3 基础战斗、P4 骑乘已跑通；  
剩余集中在“bot 自建装置的放置协议”和“载具/复杂自动化”。


## 配方查询

新增 `mc_recipe`：本地配方库，不依赖联网。覆盖：
矿车/铁轨/动力轨/船/箱子/工作台/熔炉/桶/剪刀/盾/弓/箭/火把/床/运输矿车/漏斗矿车/动力矿车。
查不到时回退 `mc_learn` 查攻略。


## 建设自主边界

建设场景不再由宿主给标准方案：

- 她自己看资源/地形决定建不建、建什么；
- 不确定时用 `mc_recipe` / `mc_guide` / `mc_learn` 查；
- 查完按自己的判断做，不等待预设；
- 宿主只提供原语、安全边界和工具经验。
