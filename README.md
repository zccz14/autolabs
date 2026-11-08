# AutoLabs

**托管的研究地图。** 一个项目就是一族 `<Domain>-Labs`：它有 owner、有自己的授权、有自己的实验编号序列，还有一本 SOTA 账。实验文件由 AutoLabs 自己托管，计算发生在你自己的机器上——由 [Cybion](https://cybion.ntnl.io) 的 Thread 驱动。

- 线上：**https://autolabs.ntnl.io**
- 灵魂：[Soul](docs/soul.md)
- 设计：[流水线](docs/pipeline.md) · [架构](docs/architecture.md) · [指标口径与数据集](docs/metrics-and-datasets.md) · [研究地图是一等对象](docs/decisions/0002-research-map.md) · [为什么丢掉 GitHub](docs/decisions/0001-experiment-files-in-autolabs.md) · [Q-Labs 迁移](docs/q-labs-migration.md)

## 它解决什么

手工跑 lab 的瓶颈从来不是算力，是**记不住上一轮到底是怎么得出这个结论的**：

- `lab-0054` 曾经是 SOTA，后来被 `lab-0082` 证明存在执行层未来信息——那条降级理由现在是一段散文。
- `canonical.txt` 逐字节一致这条门禁，靠人记得敲命令。
- 冻结靠 README 里写一句"已冻结"。

AutoLabs 把这些变成类型：编号不可重复、快照不可变、冻结是数据库不变量、SOTA 的每次升降都有账。

## 研究地图

**研究地图**是一个项目里所有实验的目录。目录的一行是一个实验，行上有三列：它想验证什么（**思路**）、它得到了什么（**结果**）、以及一组同口径的**指标**。

自动化研究的典型失败不是算错，是在狭窄的搜索空间里反复重跑同一类实验，直到预算耗尽——因为没人记得住前面 80 个 lab 已经排除了哪些方向。地图存在的唯一理由就是消除这种重复：能看见历史，才谈得上换方向。

这也解释了为什么结果不能只是一份文件躺在实验目录里，也不能只是详情页里的一块 `<pre>`：**它必须在目录层与自己的思路、指标并排出现**，否则它无法参与比较。只有指标的地图能告诉你哪个数字最大，不能告诉你哪条路已经走死。

## 数据模型

| 对象 | 含义 |
| --- | --- |
| **Project** | `q-labs` / `lol-labs` / … owner + 成员角色 + 独立 `lab_seq` + 独立授权 |
| **Snapshot** | 一次不可变的实验文件提交，内容寻址（`tree_sha`），可冻结 |
| **Run** | 一轮实验：`lab-0007`，编号由项目原子分配、永不复用 |
| **Lab 元信息** | 目录层的叙事两列：`idea_md`（这个实验想验证什么）与 `report_md`（得到了什么）。指标是第三列。 |
| **Gate** | `{rule_id, pass, evidence}`，全过才 `frozen`，否则 `rejected` |
| **SOTA event** | `promote / demote / exclude` + 理由 + 操作者 |
| **Metric** | 项目级指标契约：key + 单位 + 方向 + **口径说明** + 版本（只追加） |
| **Dataset pin** | 引用 Firmament 定义的数据集，钉住 manifest 摘要（[详见](docs/metrics-and-datasets.md)） |

一轮的生命周期：

```
proposed → dispatched → running → frozen | rejected | lost
```

## 目录：研究地图的一行

- **思路**：`runs.idea_md`，开 run 时必填——这个实验想验证什么、为什么这么设计、排除了哪些做法。
- **结果**：`runs.report_md`，verdict 时写入；Q-Labs 迁移时取每个 lab 的 `README.md` 原文。
- **指标**：项目级契约下的一组数字，与上面两列并排。

项目详情的「目录」页签把这三列并排列出来，可以按状态过滤；完整内容在 run 详情里按 Markdown 渲染。设计取舍见 [ADR 0002](docs/decisions/0002-research-map.md)。

## 开一轮实验会发生什么

开 run 就是**发出**这一轮，不是先登记再手动绑 Thread。项目页上有**启动研究 / 暂停研究**：启动之后就没人什么事了——出思路、开实验、等结论、再出思路，全自动；暂停只是不再开新实验，在飞的那一轮照常跑完。要自己写思路也可以用表单手开一轮。

思路可以先由这个项目的 **master thread**（一条长期的 Cybion Thread）写出来——点「开新一轮实验」时它会自动开始诊断，写好的思路填进表单，你可以直接改。它收到的是一张**地图速览**（每个 lab 一行 + 最近几轮全文），细节由它拿只读令牌按需去取：



1. 平台分配 `lab-000N` 与 `external_ref = autolabs:<slug>:<lab-000N>`，钉住输入快照。
2. 平台在**开 run 那个人自己的** Cybion 里开一个 Thread，标题是 `lab-000N · <项目名>`。这把 Cybion key 由平台在后台维护，用户看不见、也不需要设置：第一次真正要用它的时候，AutoLabs 拿当次请求里那条带 `cybion.ntnl.io` audience 的登录 JWT 调 `POST /api/api-keys` 换一把不会过期的 key，密封存进库（`cybion_credentials`，`CREDENTIALS_KEY` 加密），之后一直用它；key 在 Cybion 侧失效了就当场再换一把。拿不到登录 JWT 的路径（机器凭据上报、别人名下的 Thread）回退到 Worker 里的服务级 `CYBION_API_KEY`。
3. 平台给这一轮签一把只覆盖 `read/write/verdict` 的项目凭据，连同「要验什么、文件在哪、指标口径、结论往哪报」写成第一条输入发进 Thread——这一步才真正开始跑。
4. Thread id 写回这一行、状态置 `dispatched`。

第 2 步一建出 Thread 就先落库，所以重试不会在 Cybion 里开出第二个 Thread（`external_ref` 只是给人看的标记，Cybion 不拿它去重）。任何一步失败，这一轮都留在 `proposed`，`dispatch.error` 带回原文，run 详情页可以点「发出这一轮」重试。

## 机器同步协议（给 Cybion 的 Thread）

机器上只需要 `curl`，不需要 git，也不需要 GitHub 凭据。凭据是项目级的 `alb_…` token（在项目页签发，可吊销、可过期）。

```sh
B=https://autolabs.ntnl.io
T=alb_xxxx_yyyy                       # 项目凭据
P=q-labs

# 1. 取 manifest（{path: sha}），只拉本地没有的 blob
curl -sH "Authorization: Bearer $T" $B/api/v1/snapshots/<snapshot>/manifest

# 2. 拉单个文件
curl -sH "Authorization: Bearer $T" $B/api/v1/projects/$P/blobs/<sha> -o run_conceptual.py

# 3. 或者一键整包
curl -sH "Authorization: Bearer $T" $B/api/v1/snapshots/<snapshot>/tar.gz | tar xz

# 4. 传结果：先按 sha 上传 blob，再开 run / 上报 verdict
curl -sX PUT --data-binary @outputs/canonical.txt \
  -H "Authorization: Bearer $T" $B/api/v1/projects/$P/blobs/$(shasum -a 256 outputs/canonical.txt | cut -d' ' -f1)
```

## HTTP API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/health` | 存活 |
| `GET` | `/api/v1/me` | 我是谁（Auth Mini 或项目凭据） |
| `GET` `POST` | `/api/v1/projects` | 列表 / 新建 |
| `GET` | `/api/v1/projects/{slug}` | 项目详情（runs / snapshots / SOTA 账） |
| `POST` | `/api/v1/projects/{slug}/tokens` | 签发机器凭据（只显示一次） |
| `GET` | `/api/v1/projects/{slug}/whoami` | 机器自检能力 |
| `PUT` `GET` | `/api/v1/projects/{slug}/blobs/{sha}` | 内容寻址上传 / 下载（上传前校验 sha） |
| `GET` `POST` | `/api/v1/projects/{slug}/snapshots` | 快照列表 / 提交 |
| `GET` | `/api/v1/snapshots/{id}/manifest` | 增量同步用的全表 |
| `GET` | `/api/v1/snapshots/{id}/tar.gz` | 整包下载 |
| `GET` | `/api/v1/snapshots/{id}/diff?against=` | 路径级差异 |
| `POST` | `/api/v1/snapshots/{id}/freeze` | 冻结（不可逆） |
| `GET` `POST` | `/api/v1/projects/{slug}/runs` | 实验列表 / 开新一轮 |
| `POST` | `/api/v1/runs/{id}/dispatch` | 重发 / 换绑 Cybion Thread（开 run 时已经自动发过一次） |
| `POST` | `/api/v1/runs/{id}/verdict` | 上报门禁与指标（判定权在平台） |
| `GET` `POST` | `/api/v1/projects/{slug}/metrics` | 指标契约（每次写入 = 新版本） |
| `POST` | `/api/v1/projects/{slug}/metrics/{key}/retire` | 退役一个指标 |
| `GET` `POST` | `/api/v1/projects/{slug}/dataset` | 当前数据集 pin / 绑定新 pin |
| `GET` `POST` | `/api/v1/projects/{slug}/idea` | 思路线程：请它出主意 / 取回这一轮的想法 |
| `POST` | `/api/v1/projects/{slug}/loop` | 启动 / 暂停研究循环 |
| `GET` | `/api/v1/firmament/datasets` | Firmament 数据集目录（token 透传） |
| `GET` | `/api/v1/projects/{slug}/leaderboard` | 榜单（带指标定义与顺序） |
| `POST` | `/api/v1/projects/{slug}/sota` | 晋升 / 降级 / 排除 |

## 本地开发

```sh
pnpm install
pnpm db:migrate:local          # 建本地 D1
cp .dev.vars.example .dev.vars # 固定一个假身份，绕过 Auth Mini
pnpm dev                       # wrangler dev，http://127.0.0.1:8787
./scripts/smoke.sh http://127.0.0.1:8787 dev   # 全链路冒烟
```

`pnpm check` 跑类型检查与单元测试；`pnpm build` 产出 `dist/`（由 Worker 的 `assets` 托管）。

## 部署

```sh
pnpm exec wrangler d1 migrations apply autolabs --remote
pnpm deploy                    # 构建 + wrangler deploy，绑定 autolabs.ntnl.io
```

`.github/workflows/pr-check.yml` 在 PR 上跑类型检查、单测、构建和本地迁移。`deploy.yml` 只在配置了 `CLOUDFLARE_API_TOKEN` 时自动部署，否则跳过（由维护者在本机部署）。

## 状态

Phase 1（已上线）：项目实体与授权、内容寻址存储、快照与冻结、run 与门禁、SOTA 账本、榜单、对账器。
Phase 1.5（已上线）：项目级指标契约（带口径、版本化、上报强校验）、Firmament 数据集 pin。

Phase 2（进行中）：`idea_md` 与目录页已上线（见 [ADR 0002](docs/decisions/0002-research-map.md)）；未开始：Workflows 主循环、Durable Object 推送、Diff 页、Linkit 通知、residuals。

## 身份

Auth Mini（`https://auth.ntnl.io`），前端 `AuthMiniProvider`、后端验 EdDSA + JWKS。audience 是 `autolabs.ntnl.io`——由登录回调的 hostname 决定，不需要额外配置。UI 外壳用 [`@zccz14/ux`](https://github.com/zccz14/ux)，和 Cybion / CTX / Linkit 长得一样。
