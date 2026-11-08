# ADR 0004：开一轮实验就直接建 Cybion Thread

日期：2026-11-08

## 背景

第一版把「发出」留给人：AutoLabs 只登记一行，人自己去 Cybion 开 Thread，再把 `thr_…` 贴回 run 详情。这条路上有三个停点——忘了开、贴错 id、开了两个——而平台完全没有能力判断这一轮到底发出去了没有。AutoLabs 的自我定位是控制面：它应该能把一条指令送到执行面，而不是把指令写给用户让他转达。

## 决定

1. AutoLabs 持有 Cybion 的外部集成 API key（`CYBION_API_KEY`，只放在 Worker secret 里），开 run 时在服务端直接 `POST /v1/threads` 建 Thread，`external_ref = autolabs:<slug>:<lab-000N>`。
2. 建完 Thread 立刻签发一把只覆盖 `read/write/verdict`、30 天到期的项目凭据，把「要验什么、文件在哪、指标口径、结论往哪报」写成第一条输入 `POST /v1/threads/{id}/inputs`。Thread 从这一步才真正开始跑。
3. Thread id 一建出来就先落库；首条输入失败时 run 留在 `proposed`，重试复用这个 Thread。`external_ref` 在 Cybion 侧不做唯一性约束，重复开 Thread 只能靠 AutoLabs 自己挡。
4. `POST /api/v1/runs/{id}/dispatch` 保留为「重发 / 换绑」入口，不再是人手贴 id 的主路径。

## 为什么不用 Auth Mini 的 audience

Cybion 有两套入口：浏览器会话走 `/api/threads`，验 Auth Mini 的 Bearer token（audience 是 `cybion.ntnl.io`）；外部集成走 `/v1/threads`，只认 Cybion 自己的 `cyb_<user_id>_<secret>`（`src/cloud.rs` 的 `api_key_auth`）。给 AutoLabs 的登录会话加一个 `cybion.ntnl.io` audience 只影响浏览器拿到的 token，对服务端到服务端的调用没有任何作用；`/v1` 那条路根本不看 Auth Mini 的 token。所以打通的正确做法是 API key，不是加 audience。

## 代价

- key 属于这一轮 run 的创建者（谁开 run 谁出 Thread），因此执行体跑在谁的账号下是可以追溯的。
- 每轮多一把项目凭据。它在令牌列表里按 `verdict · lab-000N · run_…` 命名，30 天到期；泄露了就吊销那一把。
- 发不出去时 run 停在 `proposed`，需要人点一下重试——平台不会无限重试，也不会假装发成功。
