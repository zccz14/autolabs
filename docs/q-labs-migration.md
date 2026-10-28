# 把 Q-Labs 的 83 个 lab 迁进 AutoLabs

AutoLabs 的第一个项目不是新建的，是**搬进来的**：`Q-Labs` 仓库里 `labs/lab1` … `labs/lab83` 这条已有编号序列，整体落成 `q-labs` 项目的 `lab-0001` … `lab-0083`。这份文档说的是**搬了什么、没搬什么、以及为什么**——因为迁移里每一个取舍都会变成以后看历史时的盲区。

工具是仓库里的 `scripts/migrate-q-labs.mjs`，一次性的，但留在仓库里，因为同构的 `<Domain>-Labs` 还会再搬第二次。

## 一、编号是项目的，不是仓库的

Q-Labs 的 `labs/` 下有 113 个目录，但只有 83 个是 `lab<N>`：

| 目录 | 数量 | 是不是实验序列 |
| --- | --- | --- |
| `lab1` … `lab83` | 83 | **是**，进 `q-labs` 的 `lab-0001`…`lab-0083` |
| `cs_lab*` | 17 | 不是，另一条研究线 |
| `fmab_lab*` | 12 | 不是，另一条研究线 |

脚本的正则只认 `^lab(\d+)$`。这不是偷懒：`lab_seq` 是项目自己的原子计数器，一旦把三条研究线混进同一个序列，"第 54 个 lab"就同时指三样东西，而 Q-Labs 的教训恰恰是**编号必须永远指向同一个实验**（`lab-0054` 因为执行层未来信息被 `lab-0082` 降级，这条历史必须能按编号追上）。`cs_lab*` / `fmab_lab*` 要么另开项目，要么等它们有自己的编号语义，不在这里凑数。

迁完之后 `projects.lab_seq = 83`，下一个新 run 从 `lab-0084` 开始——**编号在项目里连续，且永不复用**。

## 二、快照边界：收实验定义，不收运行产物

一个 lab 进快照的东西：

- 目录根的 `*.py`（策略、评估、画图脚本）
- `README.md`（结论原文）
- `outputs/**` 里 **≤64 KiB** 的 `.csv / .txt / .json / .md`，每个 lab 最多 40 个（按体积从小到大取，保证有界）

全量 83 个 lab 的结果是 **695 个文件 / 3.73 MiB**，单 lab 最大 135 KiB。

不收的东西，和为什么不收：

| 不收 | 规模 | 理由 |
| --- | --- | --- |
| 大 `outputs/`（预测中间件、pkl、parquet、图片） | 513 个文件 / 1.17 GB | 运行产物，不是实验定义；AutoLabs 单 blob 上限 8 MiB、单快照 2000 文件，搬进来只会把仓库变成对象存储的劣质复制品 |
| 仓库其余部分（`common/`、数据、notebook 缓存） | 仓库 60 GB，`git ls-files` 1.1 GB | 属于"跑实验的机器"，不属于"这一轮实验是什么" |

所以这次迁移的证据边界要说清楚：**迁进来的是"这个 lab 是什么 + 它自己宣称了什么结论"，不是"这个结论在 AutoLabs 里被重新验证过"。** 快照可下载、可 diff、可追溯，但它不是 Q-Labs 那份 GB 级产物的替代品——真要复现，还是回原仓库跑。

## 三、门禁：`imported-history`，证据是 README 原文

每个 run 一条门禁：

```json
{ "rule_id": "imported-history", "pass": true, "evidence": "README 声明该 lab 已冻结（Q-Labs labs/lab54/README.md）" }
```

判定依据只有一条：README 里有没有"已冻结 / 已完成全量"这类声明。结果 **67 个 `frozen`、16 个 `rejected`**（`lab79`、`lab81`、`lab82` 等 README 没写这句）。

这是**继承历史**，不是**重新判卷**：`rejected` 不等于实验做错了，只等于"它没在自己的 README 里声明过冻结"。要把它判成 `frozen`，该补的是门禁语义（比如按 README 结论逐条对上门禁项），不是补指标。

README 全文同时写进 `report_md`，原文保留，方便日后逐字对照。

## 四、指标故意空着

Q-Labs 的 README 里能正则出 ≥3 个指标的 lab 有 50 个，脚本也有 `--metrics` 开关能把它们写进 verdict——**这次全部没用，`runs.metrics_json` 是 NULL**。

原因在 Q-Labs 自己的结论里：`lab82` 用执行层口径重算了历史，明确指出**榜单必须按因果口径重建**，`avg_daily_trades >= 1.0` 这类硬约束和 `lab54 / lab79 / lab82` 的降级结论还挂在 README 上。在这种状态下把旧 README 里的数字抄进 `metrics_json`，等于用平台的字段给一份已知失真的榜单盖章——**抄旧数字就是伪造 SOTA**。

所以顺序是：先按因果执行口径重算，再用新数字回填。在那之前，`q-labs` 的榜单是空表，这是正确状态，不是缺失。

## 五、怎么跑

### 1. 干跑，先看规模

```sh
node scripts/migrate-q-labs.mjs --source ~/Projects/Q-Labs
```

只读本地，不上传，打印：编号范围、文件数与总字节、单 lab 最大体积、README 声明冻结的比例、能解析出指标的比例，以及前 5 条的 frozen/rejected 预览。

### 2. 建项目：只能走 SQL

`POST /api/v1/projects` **只接受人类会话**（机器凭据不能凭空造项目，否则一个泄漏的 token 就能刷满项目列表）。所以运维侧用脚本生成同一套 schema 的落库 SQL：

```sh
node scripts/migrate-q-labs.mjs --emit-bootstrap --owner <auth-mini-uid> --out /tmp/q-labs-bootstrap.sql
npx wrangler d1 execute autolabs --remote --config wrangler.jsonc --file=/tmp/q-labs-bootstrap.sql
```

它会写：`users`（不存在才建）、`projects`（`lab_seq = 0`）、`project_members`（owner）、一条 `project.created` 事件、指标模板（从 `src/metrics.ts` 读同一份 `METRIC_TEMPLATE`，不复制），以及一个 **7 天有效、能力 `read,write,verdict,sota` 的迁移令牌**。

令牌明文只打印一次，库里只存 `sha256(id:secret)`。迁移完就该在项目页吊销它——它比日常凭据的权力大。

### 3. 真跑，可断点续跑

```sh
node scripts/migrate-q-labs.mjs --source ~/Projects/Q-Labs --apply \
  --api https://autolabs.ntnl.io --token alb_xxxx_yyyy [--limit 3]
```

顺序是每个 lab：`PUT blob`（内容寻址，重复上传无副作用）→ `POST snapshot`（`{path: sha}`）→ `POST run` → `POST verdict`（`report_md` 自动生成冻结快照）。

**续跑是安全的**，靠两条校验：

1. 先 `GET /projects/q-labs` 拿已有 run，凡是已有编号在 Q-Labs 里找不到 → 直接报错退出（编号语义对不上，不能瞎写）；
2. 已有编号必须是**连续前缀**（有 `lab-0001..0003` 可以，有 `lab-0001` 和 `lab-0005` 不行）——否则中途断档会让后面的编号整体错位。

满足这两条就只补缺失的 lab，已存在的跳过。所以试点 `--limit 3` 之后直接全量跑同一份命令即可。

### 4. 迁移后校验

```sh
# 项目状态：83 个 run，lab_seq=83
curl -sH "Authorization: Bearer $T" https://autolabs.ntnl.io/api/v1/projects/q-labs | head -c 600

# 编号连续性（应当 1..83 各一条，无空洞）
npx wrangler d1 execute autolabs --remote --config wrangler.jsonc \
  --command "SELECT COUNT(*) AS runs, MIN(lab_no) AS lo, MAX(lab_no) AS hi, COUNT(DISTINCT lab_no) AS distinct_no FROM runs WHERE project_id='prj_b615581e3a0088c505f41279'"
```

线上实测：83 个 run / 67 `frozen` / 16 `rejected` / `lab_seq = 83`，快照合计 695 文件、3.73 MiB。

## 六、这次没做的事

- **没回填指标**（见第四节），所以榜单空着；
- **没迁 `cs_lab*` / `fmab_lab*`**（见第一节）；
- **没有在 AutoLabs 里重新执行任何一个 lab**——AutoLabs 是控制面，计算发生在你自己的机器上，这条不因为迁移而破例。
