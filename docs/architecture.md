# 架构：控制面，不是执行面

## 一句话

AutoLabs 不做计算。真正的 `run_conceptual.py` / 回测 / 画图发生在用户自己的机器上，由 Cybion 的 Thread 驱动；AutoLabs 只做四件事：**发指令、记账、判门禁、推给人看**。所以它选 Cloudflare Workers 不是妥协，而是匹配——这是一个纯 I/O 的状态机。

## 组件

| 组件 | 用什么 | 负责 |
| --- | --- | --- |
| HTTP + SPA | 单个 Worker（`assets` 托管 `dist/`） | 同源、无 CORS、一次部署 |
| 状态 | D1 | project / snapshot / run / gates / sota 账本 |
| 实验文件 | R2（内容寻址） | `blobs/<ab>/<sha256>`，跨项目去重 |
| 身份 | Auth Mini | 前端 `AuthMiniProvider`，后端验 EdDSA + JWKS |
| 触达 | Linkit | 冻结、SOTA 变更、run lost 三件事才通知 |
| 执行 | Cybion `/v1/threads` | 一个 run 对应一个 Thread，`external_ref` 是幂等键 |
| 对账 | Cron（`*/15 * * * *`） | 救援，不是主循环 |

## 轮询：为什么这么设计

Cybion 目前只有读接口，没有 webhook，所以"等结果"必须轮询。在无进程的运行时里，轮询的正确形态是**把等待变成持久状态**：

1. **主循环放在 Workflows（Phase 2）**：一个 run 一个实例，`step.sleep` 退避、`step.do` 轮询、步骤可重试、实例 id 天然幂等。将来 Cybion 有 webhook，把 `sleep+GET` 换成 `step.waitForEvent` 即可，骨架不动。
2. **Cron 只做救援**：扫出"停在 `dispatched` 太久"的 run 判 `lost`，扫出无人接管的租约重新排队。主循环死了，系统仍然收敛。
3. **租约 + 围栏**：`lease_owner` / `lease_until` 保证主循环与救援永不同时推进同一个 run。
4. **退避表**：`10s → 20s → 30s → 60s` 封顶，只在 `running` 时继续。40 分钟的一轮 ≈ 50 次 GET，成本可忽略。
5. **轮询对象是 Thread 元数据**（`idle | running | failed`），正文只在终态读一次。
6. **前端不轮询**：页面读 D1 快照即可刷新；实时性由 DO + WebSocket（hibernation）推送（Phase 2）。

明确不做的三件事：`waitUntil` 串轮询（30 秒就断）、GitHub Actions cron 当调度（会排队会跳过）、留一台 VPS 守护进程（那这个设计就已经错了）。

## 存储模型

```
R2                                D1
────────────                      ──────────────────────
blobs/<ab>/<sha256>               blobs(sha, size)
                                  project_blobs(project_id, sha)
                                  snapshots(id, parent_id, tree_sha, frozen_at)
                                  snapshot_entries(snapshot_id, path, sha256, size)
```

- `tree_sha` = 对排序后的 `path\0sha` 求 sha256：同一批文件永远得到同一个快照身份，与上传顺序无关。
- 快照是**线性追加**的：只有 `parent_id`，没有分支与合并。
- 冻结是 **DB 不变量**，不是 README 里的一句话。
- 打包走 `tar.gz`（Workers 只有 gzip，没有 zstd），Phase 1 上限 32 MiB——快照只装源码与报告，行情数据是 dataset，不进快照。

## 授权

- 人类：项目角色 `owner / maintainer / runner / reader`。
- 机器：`alb_<id>_<secret>` 项目凭据，库里只存 secret 的 sha256，能力收窄成 `read / write / verdict / sota`，可吊销、可过期。
- 公开只读：`visibility = public-read` 的项目对外来者降级为 `reader`。

## 已知边界

- 门禁里"需要执行才能验"的部分只能由机器自述（`machine-attested`）。平台侧只算不需要执行的门禁：canonical 逐字节、口径一致、样本量/频率、跨 run 单调性。要更强的保证，用第二台 Worker 复核，两次自述不一致判 `disputed`。
- 没有 Git 的分支 / merge / LFS / blame，也不打算有。
