# ADR 0001：实验文件由 AutoLabs 托管，不走 GitHub

- 状态：已采纳（2026-10-28）
- 决策者：CZ

## 背景

`Q-Labs` / `W-Labs` / `LOL-Labs` 目前把实验文件放在 GitHub 仓库里：lab 目录、`canonical.txt`、输出、报告都是 commit；`SOTA.md` 的降级理由写在 README 散文里；CI 基本没用上（`LOL-Labs` 明确"无 CI/CD"）。

## 决策

实验文件由 AutoLabs 自己托管：内容寻址的 blob 组成不可变快照，冻结是数据库不变量。GitHub 只保留产品源码。

## 理由

| 维度 | GitHub | AutoLabs |
| --- | --- | --- |
| run 与输入的关系 | 靠 commit sha 猜 | `runs.input_snapshot_id` 外键 |
| canonical 逐字节门禁 | 靠人记得敲 CLI | 平台自己比对并留证 |
| 冻结语义 | README 里写一句 | DB 拒绝写入 |
| skill 版本 | 仓库里的一份 lock 文件 | 每个快照记 `skill_set` |
| 大文件 | 进 Git，仓库膨胀 | blob 去重 + dataset 分离 |
| 机器侧依赖 | git + GitHub 凭据 | 只要 curl + 一个项目 token |

## 代价（估算）

约 2,500 行、8–10 个工作日、6 张表、2 个页面，运维增量接近零（D1/R2 无服务器）。

## 不重建的部分

分支、合并、rebase、submodule、LFS、blame、CI 矩阵、PR 评审线程、issue 标签、项目看板——这些对"线性追加的实验记录"没有价值。

## 两个已知损失

1. **干净环境的执行**：GitHub 消失后，"另一台干净机器再跑一遍"没有了。对策：门禁分层 + 机器自述标注 + 择机用第二台 Worker 复核。
2. **Git 客户端生态**：`git log` / `bisect` / IDE diff 替代不了。对策：整项目导出 `tar.gz` 作为退出通道（不锁定）。

## 后果

- AutoLabs 成为实验的系统记录，必须自己承担备份与找回：D1 Time Travel（30 天）+ R2 版本。
- 任何"要不要顺手加个 Git 兼容层"的提议，默认否决。
