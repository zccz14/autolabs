# 策略研发流水线：从仓库里的约定，到平台上的类型

这份文档是 AutoLabs 的产品原型：把 `Q-Labs` / `W-Labs` / `LOL-Labs` 里已经稳定运行的那套手工流水线，逐条翻译成平台里的数据模型与门禁。

## 一、仓库里已经存在的结构

三个仓库骨架几乎相同，只是领域不同：

| 构件 | 作用 | 现状（手工） |
| --- | --- | --- |
| `AGENTS.md` | 硬约束：成本模型、`avg_daily_trades >= 1.0`、lab 冻结规则、防未来信息泄漏 | 靠 agent 每次读一遍 |
| `LABS.md` | 实验索引：一行一个 lab，状态 / 结论 / 是否 SOTA / 开放问题 | 手工维护表格 |
| `SOTA.md` + 根 README 榜单 | 当前最优，且必须带口径（成本、仓位、样本外） | 散文 + 表格，降级理由写在正文里 |
| `labs/lab-NNN/` | 自包含实验：`run_conceptual.py` → `run_optimized.py` → `compare.py` → `outputs/canonical.txt` → `README.md` → `reports/index.html` | 目录即记录 |
| `common/` `models/` `qlabs_eval/` | 共享 harness：评估、审计、回测、`audit_findings.csv` | 本地 CLI |
| `.agents/skills` + `skills-lock.json` | 方法论技能包，带哈希锁 | 随仓库走 |
| `diagnostics/` `discussions/` | 尚未解释的问题 | 散落在文档里 |

流水线的真实形状是一条**线性追加的链**：一个假设 → 一个 lab → 一份结论 → 要么冻结要么否决 → 下一个 lab。没有分支、没有 merge、没有 PR 评审——这也是后面"实验文件不需要 Git 服务器"判断的依据。

## 二、关键 skill（决定流水线质量的六个）

按它们在链上的位置排：

| Skill | 管什么 | 在产品里对应 |
| --- | --- | --- |
| `recursive-residual-reasoning` (R3) | 把"还没解释清楚的部分"当成一等公民，展开成下一轮推理空间 | `residual`：未解释项挂账，不许丢 |
| `design-ml-trading-problem` | 写模型之前先问：有信息 → 可学习 → 可交易 | 立项门禁 |
| `conceptual-model` / `optimized-model` | 概念模型是语义真值，优化模型必须跟随它 | `run` 的两个阶段 + `canonical` 门禁 |
| `write-canonical-output` | 把关键语义输出固定成可逐字节比较的 `canonical.txt` | 平台侧唯一能"自己算"的重门禁 |
| `use-good-stats` | 先对齐统计口径再下结论，禁跨口径比较 | 指标契约（metric contract）挂 baseline |
| `causal-execution-audit` | 每个交易决策只能用决策时点可知的信息 | `no-future-leak` 门禁，一票否决 |
| `write-lab-report` / `write-sota-report` | 报告与 SOTA 说明必须先有结论再解释 | 冻结时要求的产物 |
| `faster-code` | 全量前先做 N-T 采样，估算耗时 | 运行预算门禁 |

四条不可让步的门禁，按你现有 README 的写法固化：

1. **无未来信息**（不可协商，一票否决）
2. **口径一致**：标签与交易一致、成本假设写明、样本外而非全样本
3. **样本量/频率**：`avg_daily_trades >= 1.0` 这类硬约束
4. **风险调整质量**：优先看可交易性与回撤，不只看累计收益

## 三、映射到 AutoLabs

| 仓库里的东西 | 平台里的对象 |
| --- | --- |
| 一个 `*-Labs` 仓库 | `project`：owner + 成员 + 独立授权 + 独立 `lab_seq` |
| `labs/lab-NNN/` | `run`：`lab_no` 原子分配，永不复用 |
| 目录里的一堆文件（某次提交） | `snapshot`：内容寻址、不可变、可冻结 |
| `AGENTS.md` | 项目 rules，挂在 `rules_snapshot_id` 上 |
| `SOTA.md` + 榜单 | `sota_run_id` 指针 + `sota_events` 账本 |
| `.agents/skills` | 快照上的 `skill_set`，每个 run 天生带"用哪版方法论跑出来的" |
| `qlabs_eval` 的审计输出 | `gates`：`{rule_id, pass, evidence}` |
| 诊断里的"待解释" | `residual`（Phase 2 入库） |

## 四、一轮实验在平台上的生命周期

```
propose ──► 快照（run_conceptual.py 等）──► dispatch（Cybion Thread，external_ref 幂等）
      ──► 机器侧执行 ──► 上报 verdict（metrics/gates/output）──► 平台判定
      ──► 全过 = frozen，可晋升 SOTA；不全过 = rejected，写 residual 开下一个 lab
```

`frozen` 与 `rejected` 之间只有一条合法的回头路：**排除**。当人判定某个结论用了未来信息、或只是一次中途重评估（既不是一个独立实验，也报不出完整口径），平台把它从 `frozen` 翻成 `rejected`，并在门禁里追加一条 `excluded`（写明理由）、在账本里记一条 `sota_events`。指标、报告、原有门禁一个字节都不改——这不是修改历史，是给历史补一条终局判定。

两条从旧仓库继承的硬规则：

- **性能差不是程序性错误。** 低频、低收益、大回撤都只能记为结论，然后开新 lab；只有未来信息、标签不一致、成本算错、切分错误这类程序性错误才允许回到原 lab。
- **冻结不可逆。** 快照冻结后拒绝一切写入；要改进就派生新快照、开新 lab。

## 五、为什么这些都值得变成类型

现在这些规则靠人记得、靠 agent 每次读一遍文档。变成平台对象之后：编号不可能重复、冻结不可能被覆盖、SOTA 的降级理由不可能消失、每个榜单数字都能追回它用的那份文件与那版 skill。**流水线最大的浪费从来不是算力，是"记不住上一轮到底怎么得出这个结论的"。**
