# ADR 0004：开一轮实验就直接建 Cybion Thread

日期：2026-11-08

> 后续：ADR 0006 把「换 key」从界面挪到了后台。本文第 1 条里的「工作台 →『Cybion 凭据』」以及 `/api/v1/cybion/credentials` 已不存在，其余决定仍然有效。

## 背景

第一版把「发出」留给人：AutoLabs 只登记一行，人自己去 Cybion 开 Thread，再把 `thr_…` 贴回 run 详情。这条路上有三个停点——忘了开、贴错 id、开了两个——而平台完全没有能力判断这一轮到底发出去了没有。AutoLabs 的自我定位是控制面：它应该能把一条指令送到执行面，而不是把指令写给用户让他转达。

## 决定

1. 每个人在 AutoLabs 里换一把自己的 Cybion API key（工作台 →「Cybion 凭据」），AutoLabs 密封存下来；开 run 时用开 run 那个人的 key 在服务端直接 `POST /v1/threads` 建 Thread，`external_ref = autolabs:<slug>:<lab-000N>`。没换过的人回退到 Worker secret 里的服务级 `CYBION_API_KEY`。
2. 建完 Thread 立刻签发一把只覆盖 `read/write/verdict`、30 天到期的项目凭据，把「要验什么、文件在哪、指标口径、结论往哪报」写成第一条输入 `POST /v1/threads/{id}/inputs`。Thread 从这一步才真正开始跑。
3. Thread id 一建出来就先落库；首条输入失败时 run 留在 `proposed`，重试复用这个 Thread。`external_ref` 在 Cybion 侧不做唯一性约束，重复开 Thread 只能靠 AutoLabs 自己挡。
4. `POST /api/v1/runs/{id}/dispatch` 保留为「重发 / 换绑」入口，不再是人手贴 id 的主路径。

## JWT 只用在换 key 的那一刻

Cybion 有两套入口，正好对应两种身份：

- `/api/*` 是浏览器身份，验 Auth Mini 签发的 JWT，audience 必须是 `cybion.ntnl.io`；
- `/v1/*` 是集成身份，只认 Cybion 自己的 `cyb_<user_id>_<secret>`（`src/cloud.rs` 的 `api_key_auth`）。

JWT 一小时就过期，而一轮实验可能跑几天，所以 JWT 不能进运行时链路。它在整条链路上只出现一次：**换 key 的那一次**。AutoLabs 的登录会话因此需要在 `audiences` 里带上 `cybion.ntnl.io`（前端 `AuthMiniProvider`），换到 key 之后所有 Thread 都只用 key。

换来的 key 存在 AutoLabs 自己的库里（`cybion_credentials`），用 `CREDENTIALS_KEY` 做 AES-GCM 密封——它能被读回来使用，所以不能像项目凭据那样只存哈希。换新的时候顺手吊销 Cybion 上的旧 key，一个人最多一把。

没换过的人回退到 Worker 里的服务级 `CYBION_API_KEY`，这样机器上报链路和已有部署不会因为没登录过而断掉。

## 代价

- key 属于这一轮 run 的创建者（谁开 run 谁出 Thread），因此执行体跑在谁的账号下是可以追溯的；没换过凭据的人用的是服务级 key，等于跑在部署者的账号下。
- 库里多了一份需要用 `CREDENTIALS_KEY` 才能解开的凭据；这把密钥丢了就得让所有人重换一次。
- 每轮多一把项目凭据。它在令牌列表里按 `verdict · lab-000N · run_…` 命名，30 天到期；泄露了就吊销那一把。
- 发不出去时 run 停在 `proposed`，需要人点一下重试——平台不会无限重试，也不会假装发成功。
