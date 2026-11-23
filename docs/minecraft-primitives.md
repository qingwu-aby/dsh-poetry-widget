# Minecraft 原语清单（对照官方控制/玩法）

来源：
- [Minecraft Wiki: Controls](https://minecraft.wiki/w/Controls)
- [Minecraft 官方 Controls 指南](https://www.minecraft.net/en-us/article/minecraft-controls)

先说明：Minecraft 没有一份官方“原语 API 列表”。下面按**玩家可执行动作**拆，适合做宿主原语；不是每个键位都要单独一个工具。

## 1. 官方基础控制

| 官方动作 | 键位/含义 | 当前工具 | 状态 |
|---|---|---|---|
| 前进/后退/左右 | WASD | `mc_move_to` / `mc_follow` | 已有 |
| 跳跃 | Space | 寻路内隐式 | 部分 |
| 疾跑 | Ctrl / 双击 W | 寻路内隐式 | 部分 |
| 潜行 | Shift | 无 | 缺 |
| 攻击/破坏 | 左键 | `mc_attack` / `mc_mine` | 已有 |
| 使用/放置 | 右键 | `mc_use` / `mc_place` | 已有 |
| 选取方块 | 中键 | 无（`mc_equip` 近似） | 部分 |
| 丢弃物品 | Q | 无 | 缺 |
| 打开背包 | E | `mc_inventory` | 已有（只读） |
| 快捷栏切换 | 1–9/滚轮 | `mc_equip` | 已有 |
| 切换视角 | F5 | 无 | 不需要 |
| 聊天/命令 | T / / | `mc_say` | 部分 |

## 2. 生存与移动

- [x] 移动/寻路 `mc_move_to`
- [x] 探索 `mc_explore`
- [ ] 跳跃/疾跑/潜行的显式控制
- [ ] 游泳/上浮
- [ ] 骑乘/下马（马、船、矿车）
- [ ] 睡觉 `mc_sleep` 已有
- [ ] 进食 `mc_eat`
- [ ] 喝药水
- [ ] 重生/复活
- [ ] 丢弃物品
- [ ] 与实体交互（`mc_use` 部分）

## 3. 采集与建造

- [x] 挖方块 `mc_mine`
- [x] 放方块 `mc_place`
- [x] 找资源 `mc_find`
- [x] 收集掉落 `mc_collect`
- [x] 装备工具 `mc_equip`
- [x] 建造计划 `mc_plan` / `mc_build`
- [ ] 范围填充/拆除
- [ ] 楼梯/台阶/门/栅栏等定向放置
- [ ] 放置火把/照明
- [ ] 水/岩浆桶操作（`mc_water` 仅耕地）

## 4. 合成与加工

- [x] 合成 `mc_craft`
- [x] 熔炼 `mc_smelt`
- [ ] 酿造（酿造台）
- [ ] 附魔（附魔台）
- [ ] 铁砧修复/命名
- [ ] 砂轮修复
- [ ] 切石机/织布机/制图台/锻造台
- [ ] 烟花/染料/旗帜

## 5. 农业与动物

- [x] 锄地 `mc_till`
- [x] 播种 `mc_plant`
- [x] 浇水 `mc_water`（目录）
- [x] 收割 `mc_harvest`
- [x] 喂动物 `mc_feed_animal`（目录）
- [x] 剪羊毛 `mc_shear`（目录）
- [x] 挤奶 `mc_milk`（目录）
- [ ] 骨粉催熟
- [ ] 堆肥
- [ ] 驯服（狼/猫/马）
- [ ] 拴绳/牵引
- [ ] 鸡蛋/蜜蜂/蜂巢

## 6. 战斗与远程

- [x] 近战 `mc_attack`
- [ ] 弓箭/弩
- [ ] 盾牌格挡
- [ ] 投掷物（雪球/鸡蛋/末影珍珠）
- [ ] 药水投掷
- [ ] TNT/爆炸
- [ ] 躲避/走位

## 7. 容器与交易

- [x] 打开容器 `mc_use_container`
- [ ] 存入/取出指定数量
- [ ] 箱子/桶/潜影盒/末影箱
- [ ] 漏斗/投掷器/发射器
- [x] 村民交易 `mc_trade`（基础）
- [ ] 村民职业/补货

## 8. 钓鱼与食物

- [x] 钓鱼 `mc_fish`
- [ ] 烤/煮 `mc_smelt`
- [ ] 切制/营火烹饪
- [ ] 喂食/繁殖已有

## 9. 下界/末地/传送

- [ ] 建造/点燃下界门
- [ ] 进入传送门
- [ ] 末地传送门
- [ ] 末影珍珠传送
- [ ] 重生锚

## 10. 红石与自动化

- [ ] 放置红石元件
- [ ] 拉杆/按钮/压力板
- [ ] 活塞/观察者/漏斗
- [ ] 定时/循环（`mc_automate` 只做动作循环）

## 11. 信息与元动作

- [x] `mc_inventory`
- [x] `mc_plan` / `mc_build`
- [x] `mc_guide` / `mc_learn` / `mc_inquire`
- [x] `mc_automate`
- [x] `mc_define_tool` / `mc_define_code`
- [x] `mc_request_capability`

## 建议的下一批

按生存收益排序：

1. 骨粉催熟 / 堆肥
2. 弓箭 / 盾牌
3. 范围放置 / 定向门梯
4. 药水 / 酿造
5. 驯服 / 骑乘
6. 容器精确存取
7. 下界门

原则：**语义原语**（till/plant/harvest）优先于键位原语（jump/sneak），除非寻路确实需要。
