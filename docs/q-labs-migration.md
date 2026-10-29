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

## 三、门禁：两条，缺一不可

每个 run 至少两条门禁：

```json
{ "rule_id": "imported-history", "pass": true, "evidence": "README 声明该 lab 已冻结（Q-Labs labs/lab75/README.md）" }
{ "rule_id": "standalone-result", "pass": false, "evidence": "README 的排名列写的是「排除」，不是名次：继承 lab54/lab55 rank 执行层风险，需因果重建后再评估。" }
{ "rule_id": "metrics-reported", "pass": true, "evidence": "已上报全部 6 个必报指标" }
```

- `imported-history`：README 里有没有"已冻结 / 已完成全量"这类声明；**67 条**有，**16 条**没有（`lab79`、`lab81`、`lab82` 等）。
- `standalone-result`：这个 lab 有没有独立资格。**只认榜单的「排名」列**：写数字才算进了排名；写成「排除」「重评估」的，说明它不是一个能独立汇报完整指标的实验——要么被判定用了未来信息，要么只是对上一个 lab 的中途重评估。这类结果即使指标齐全、README 也声明了冻结，同样判 `rejected`。
- `metrics-reported`：**平台自己判定**的必报指标门禁。项目把六条口径全部标成 `required`，run 少一个就是 `pass=false`，客户端自带同名门禁会被覆盖——机器不能靠自报 `pass:true` 蒙过去。

三条全过才 `frozen`。所以 83 个 lab 里 **49 个通过、34 个 rejected**：16 个是 README 没声明冻结，16 个是没报全指标，另外 2 个（`lab54`、`lab75`）指标齐全、也声明了冻结，但 Q-Labs 自己已经把它们的排名写成「排除」（执行层未来信息），排除即不算数。`rejected` 不等于实验做错了，只等于"它没满足进入 SOTA 账本的最低条件"。

同一把尺子也解释了 `lab82`：它是对 `lab54` 的因果重评估，榜单里标「重评估」而不是名次，`0.46` 笔/日更不满足频率硬约束——中途的合格结论可以写进报告，但它不是一个能独立上台的实验。

README 全文同时写进 `report_md`，原文保留，方便日后逐字对照。

## 四、指标：只从可核对的来源取，缺了就不通过

每个 lab 必须报全六个指标（累计收益、年化收益、最大回撤、日收益夏普、交易数、平均每日交易），否则 `metrics-reported` 门禁不过。指标只有两个来源，都要求"机器可核对"：

| 来源 | 覆盖 | 为什么可信 |
| --- | --- | --- |
| `labs/labN/outputs/metrics.csv` | **50 条** | lab 自己的脚本跑出来的原始输出，一行一条策略，收益列本来就是小数 |
| 根 `README.md` 的 SOTA Leaderboard 表 | **+4 条**（`lab7/8/13/14`） | 人工维护但列定义固定，每行都写了口径 |
| 合计 | **54 / 83** | |

**故意不解析 README 散文。** 那些句子里经常同时出现别的 lab 的数字：

> 相比 `lab3` 的 `63261` 笔交易，`lab4` 降到 `1395` 笔……累计收益也从 `-100.00%` 改善到 `-8.33%`

正则很容易把 `63261` 或 `-100.00%` 当成 lab4 的结果。抄错一个数，就是用平台的字段给一份假榜单盖章——比空着更糟。所以 **29 个只有散文、没有 `metrics.csv` 的 lab 一律判 rejected**，缺的指标在证据里点名，而不是猜一个值填进去。

这也意味着 `lab1`–`lab6`、`lab9`–`lab30`、`lab52/53/58` 里，凡是没跑出 `metrics.csv` 的都不再算"通过"。要把它们救回来，正确做法是在 Q-Labs 机器上补跑：

```sh
python -m qlabs_eval.cli labs/labN/outputs --report-dir /tmp/labN_audit
```

拿到同口径的 `metrics.csv` 后重跑迁移脚本即可（脚本按编号前缀续跑，已存在的会跳过，需要整段重导时先清空项目的 runs）。

## 五、怎么跑

### 1. 干跑，先看规模

```sh
node scripts/migrate-q-labs.mjs --source ~/Projects/Q-Labs
```

只读本地，不上传，打印：编号范围、文件数与总字节、单 lab 最大体积、README 声明冻结的比例、能报全六个指标的比例与来源、缺指标的 lab 清单、按门禁预计通过多少条，以及前 5 条的预览。

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
# 项目状态：83 个 run，lab_seq=83，51 frozen / 32 rejected
curl -sH "Authorization: Bearer $T" https://autolabs.ntnl.io/api/v1/projects/q-labs | head -c 600

# 编号连续性（应当 1..83 各一条，无空洞）
npx wrangler d1 execute autolabs --remote --config wrangler.jsonc \
  --command "SELECT COUNT(*) AS runs, MIN(lab_no) AS lo, MAX(lab_no) AS hi, COUNT(DISTINCT lab_no) AS distinct_no FROM runs WHERE project_id='prj_b615581e3a0088c505f41279'"
```

线上实测：83 个 run / **51 `frozen`** / **32 `rejected`** / `lab_seq = 83`，快照合计 695 文件、3.73 MiB；51 个 frozen 的 `metrics_json` 全部非空。

## 六、这次没做的事

- **29 个 lab 没有 `metrics.csv`**，只有 README 散文 → 判 rejected（见第四节），榜单上只有 51 条；
- **没迁 `cs_lab*` / `fmab_lab*`**（见第一节）；
- **没有在 AutoLabs 里重新执行任何一个 lab**——AutoLabs 是控制面，计算发生在你自己的机器上，这条不因为迁移而破例。
