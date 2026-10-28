# AutoLabs

**托管的研究流水线。** 一个项目就是一族 `<Domain>-Labs`：它有 owner、有自己的授权、有自己的实验编号序列，还有一本 SOTA 账。实验文件由 AutoLabs 自己托管，计算发生在你自己的机器上——由 [Cybion](https://cybion.ntnl.io) 的 Thread 驱动。

- 线上：**https://autolabs.ntnl.io**
- 设计：[流水线](docs/pipeline.md) · [架构](docs/architecture.md) · [为什么丢掉 GitHub](docs/decisions/0001-experiment-files-in-autolabs.md)

## 它解决什么

手工跑 lab 的瓶颈从来不是算力，是**记不住上一轮到底是怎么得出这个结论的**：

- `lab-0054` 曾经是 SOTA，后来被 `lab-0082` 证明存在执行层未来信息——那条降级理由现在是一段散文。
- `canonical.txt` 逐字节一致这条门禁，靠人记得敲命令。
- 冻结靠 README 里写一句"已冻结"。

AutoLabs 把这些变成类型：编号不可重复、快照不可变、冻结是数据库不变量、SOTA 的每次升降都有账。

## 数据模型

| 对象 | 含义 |
| --- | --- |
| **Project** | `q-labs` / `lol-labs` / … owner + 成员角色 + 独立 `lab_seq` + 独立授权 |
| **Snapshot** | 一次不可变的实验文件提交，内容寻址（`tree_sha`），可冻结 |
| **Run** | 一轮实验：`lab-0007`，编号由项目原子分配、永不复用 |
| **Gate** | `{rule_id, pass, evidence}`，全过才 `frozen`，否则 `rejected` |
| **SOTA event** | `promote / demote / exclude` + 理由 + 操作者 |

一轮的生命周期：

```
proposed → dispatched → running → frozen | rejected | lost
```

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
| `POST` | `/api/v1/runs/{id}/dispatch` | 绑定 Cybion Thread |
| `POST` | `/api/v1/runs/{id}/verdict` | 上报门禁与指标（判定权在平台） |
| `GET` | `/api/v1/projects/{slug}/leaderboard` | 榜单 |
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

Phase 2（未开始）：Workflows 主循环、Durable Object 推送、Diff 页、Linkit 通知、residuals。

## 身份

Auth Mini（`https://auth.ntnl.io`），前端 `AuthMiniProvider`、后端验 EdDSA + JWKS。audience 是 `autolabs.ntnl.io`——由登录回调的 hostname 决定，不需要额外配置。UI 外壳用 [`@zccz14/ux`](https://github.com/zccz14/ux)，和 Cybion / CTX / Linkit 长得一样。
