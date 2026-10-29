# 项目的两条"外部定义"：指标口径与数据集

一个项目不只拥有实验编号和 SOTA，它还拥有**两样必须先说清楚、之后不许悄悄改**的东西：指标的口径，和数据集的版本。

## 一、指标：每个项目自己的一套口径

"收益率"这三个字在不同的实验里可以指完全不同的东西：扣不扣成本、复利还是单利、样本内还是样本外、分母是初始资金还是峰值权益。**跨口径比较出来的"更好"，是假的更好。**

所以指标在 AutoLabs 里不是一列数字，而是**一个带版本的契约**：

```
project_metrics
  key            机器键：cumulative_return
  label          人看的名字：累计收益率
  unit           ratio | count | bps | seconds | number
  direction      higher-better | lower-better | neutral
  definition_md  口径说明：分母、成本、样本外、年化因子、不重叠约束
  version        每次保存 +1
  is_primary     榜单默认排序指标（每个项目最多一个）
  required       必报指标：run 少了它就不算通过
```

四条规则：

1. **只追加，不覆盖。** 改一次口径 = 新版本。旧版本留在表里，历史 run 引用的是它当时那一版。
2. **上报必须对得上。** `POST /runs/{id}/verdict` 里的 `metrics` 键必须在项目已定义的指标集内，多出来的（比如随手加个 `win_rate`）直接 400 拒绝——否则榜单会被各写各的指标污染。
3. **run 记住自己用的哪一版。** `runs.metric_set_json` 存 `[{key, version}]`，所以"这个数字是在哪版口径下算出来的"是一个外键，不是一段回忆。
4. **必报指标由平台判。** 每次 verdict，平台补一条 `metrics-reported` 门禁：项目里标了 `required` 的指标缺一个（或不是有限数字）就 `pass=false`，run 只能落 `rejected`。同名门禁如果由机器上报，会被平台版本覆盖——门禁可以自报，判定不行。

新建项目会种入一份模板（累计收益率 / 年化收益率 / 最大回撤 / 日收益夏普 / 交易数 / 平均每日交易），六条默认都是**必报**；口径抄自 `Q-Labs` 的 `AGENTS.md`，可以按项目改成自己的。

### 单位决定展示，不决定好坏

| unit | 存什么 | 怎么展示 |
| --- | --- | --- |
| `ratio` | 比例，小数（`0.166`） | 乘 100 加百分号（`16.60%`） |
| `number` | 无量纲数值（`1.93`） | 原样显示（`1.93`） |
| `count` | 笔数（`1493`） | 整数或两位小数 |
| `bps` / `seconds` | 基点 / 秒 | 原样 |

夏普是「每单位波动换来多少收益」的倍数，不是比例。它被当 `ratio` 报了整整一轮，榜单上就显示成 `193.22%`——这是把 1.9322 当成 193.22% 的读数错误，不是策略特别好。所以模板里 `sharpe` 的单位是 `number`；已有项目按「只追加」的规矩升一版（`migrations/0004_sharpe_dimensionless.sql`），历史 run 仍然钉着它当时那一版。

## 二、数据集：由 Firmament 定义，AutoLabs 只钉摘要

数据集不归 AutoLabs 定义。**Firmament 是数据集的唯一真相发布方**（Single Truth Publisher）：行情、新闻、事件发布到同一片"数据天穹"上，`hot` 在 SQLite 热库、`cold` 归档到 S3。

AutoLabs 做的是**引用 + 钉住**：

```
dataset_pins
  firmament_dataset_id   例如 okx-btc-usdt-perp-1m
  digest                 sha256(排序后的 path\0sha256\0size)
  file_count / bytes     manifest 的规模
  manifest_key           R2 里的 manifest 快照（≤8 MiB），离线也能溯源
  verified               1 = 与 Firmament 核对过；0 = 离线绑定
```

- `projects.dataset_pin_id` 是项目当前引用的那一份；
- `runs.dataset_pin_id` 是**这一轮实验实际用的那一份**——开 run 的那一刻钉住，之后项目换数据集也不会改写历史；
- 同一数据集再绑一次会**新增一个 pin**，旧的永不修改。Firmament 那边数据更新了，你能看到"这轮用的是哪一版"。

### 怎么读 Firmament

`GET /api/v1/datasets`（目录）与 `GET /api/v1/datasets/{id}/manifest`（文件 + sha256）。两边都用 Auth Mini，audience 是 `firma.ntnl.io`，所以：

- 前端登录时**一并申请** `firma.ntnl.io` 这个 audience（`AuthMiniProvider` 的 `audiences` 里已经加了）；
- 绑定时 AutoLabs 把同一个 access token 转发给 Firmament，**服务端不持有任何数据凭据**；
- token 里没有 firma audience 时，绑定会返回 403 并明确说"重新登录一次"。

数据本身不复制进 AutoLabs：跑实验的机器该 `firmament sync` 还是 `firmament export`，AutoLabs 只负责证明"我这一轮用的是哪份 manifest"。

## 三、一次 verdict 的完整证据链

```
run
 ├─ input_snapshot_id   用了哪份实验文件（tree_sha）
 ├─ dataset_pin_id      用了哪份数据（Firmament manifest digest）
 ├─ metric_set_json     用了哪版指标口径（[{key, version}]）
 ├─ gates_json          过了哪些门禁（含 evidence）
 └─ output_snapshot_id  产出了什么（blob + tree_sha）
```

榜单上的任何一个数字，都能顺着这五条外键走回它的原始出处。这就是丢掉 GitHub 换来的东西。
