/**
 * run 的门禁与状态语义。
 *
 * 一个 lab 只有在「同一个口径下完整可比」时才算数。中途的重评估、消融诊断、
 * 被判定使用了未来信息的结果，都不是一个可以独立汇报指标的实验——它们的
 * 结论只能算 rejected，不能留在榜单上被当成「当前最好」。
 */

export interface GateRecord {
  rule_id: string;
  pass: boolean;
  evidence: string | null;
}

/**
 * 排除即 rejected：把「为什么不算数」写成一条不通过的门禁，追加在原有门禁之后。
 * 原来的门禁一条都不删——历史照原样留着，只是多了一条终局判定。
 */
export function withExclusion(gates: GateRecord[], reason: string): GateRecord[] {
  const kept = gates.filter((gate) => gate.rule_id !== 'excluded');
  return [...kept, { rule_id: 'excluded', pass: false, evidence: reason }];
}

export interface RunBriefInput {
  lab: string;
  projectSlug: string;
  projectName: string;
  runId: string;
  externalRef: string;
  /** AutoLabs 自己的对外地址；Thread 里的人要用它取文件、报结论。 */
  origin: string;
  snapshotId: string;
  treeSha: string;
  idea: string | null;
  note: string;
  metrics: { key: string; label: string; unit: string; direction: string; required: boolean; definition_md: string }[];
}

/**
 * 发给 Cybion Thread 的第一条输入。
 *
 * 这是 AutoLabs 与执行体之间唯一的契约：告诉它这一轮要验什么、文件在哪、
 * 算哪些指标、以及结论往哪里报。文字写给「第一次见到这个项目的执行者」看，
 * 不假设它读过仓库里的任何文档。
 */
export function buildRunBrief(input: RunBriefInput): string {
  const base = input.origin;
  const metricLines = input.metrics.length
    ? input.metrics
        .map(
          (metric) =>
            `- \`${metric.key}\`：${metric.label}｜单位 ${metric.unit}｜${metric.direction}${metric.required ? '｜必报' : ''}\n  口径：${metric.definition_md}`,
        )
        .join('\n')
    : '- 这个项目还没有定义指标；可以只报门禁与结论。';

  return `# ${input.lab} · ${input.projectName}

AutoLabs 把你放在这一轮实验的执行位上。做完之后，按第 5 节的格式把结论报回来——那是唯一的结算入口。

| 项 | 值 |
| --- | --- |
| 项目 | ${input.projectSlug}（${input.projectName}） |
| 实验 | ${input.lab} |
| run id | \`${input.runId}\` |
| external_ref | \`${input.externalRef}\` |
| 输入快照 | \`${input.snapshotId}\`（tree \`${input.treeSha}\`） |

## 1. 这一轮要验证什么

${input.idea?.trim() || input.note.trim() || '（这一轮没有写思路：按项目既有规则跑一次基线，如实报结论。）'}

## 2. 实验文件在哪

实验文件都在输入快照里，按内容寻址，不在你的机器上：

- 清单：\`GET ${base}/api/v1/snapshots/${input.snapshotId}/manifest\`
- 单个文件：\`GET ${base}/api/v1/projects/${input.projectSlug}/blobs/<sha256>\`
- 整包（快照不超过打包上限时）：\`GET ${base}/api/v1/snapshots/${input.snapshotId}/tar.gz\`

请求都要带一张证明「你是这条 Thread」的令牌（它对文件有读权限）：调用 Cybion 的 \`create_thread_token\` 工具现签一张，60 秒内有效，放进 \`Authorization: Bearer\`。快照是只读的，改动请落在你自己的机器上。

## 3. 让这个包能被评估：lab.json

平台的评估器不认识你的代码。它只认一件事：**快照根目录的 \`lab.json\`**。

\`\`\`json
{
  "evaluate": "python -m pack.evaluate"
}
\`\`\`

派评估的时候，平台会：把这一轮的快照解到一个临时目录、\`cd\` 进去、跑这条命令。所以：

- 命令的当前目录就是包根目录，\`AUTOLABS_WORKDIR\` 也是它；不要假设别的工作目录。
- 数据集在 \`AUTOLABS_DATASET\`（\`<id>@<digest 前 16 位>\`），本轮钉住的那一份；没绑就是空串。
- 口径在 \`AUTOLABS_METRICS\`（\`[{"key","unit","direction","version"}]\`），只按这些 key 说话。
- 命令的最后一行打印 \`{"metrics": {"<key>": <number>}}\`，退出码 0。前面打多少日志都行。
- 想自己定超时就写成 \`{"evaluate": {"command": "…", "timeout_seconds": 1800}}\`；默认和上限都是一小时。

**这一条是硬要求**：没有 \`lab.json\`、或者它写得不对，这一轮就算不出指标，进不了榜单。它跟着快照走，所以改算法＝开新一轮，历史行不会被今天的命令改写。

## 4. 判定规则

- **no-future-leak**：任何一步都只能用入场时可知的字段；引用了当时的未来信息，这一轮就不算数。
- **canonical-byte-equal**：同一口径下的两次执行，产出必须逐字节一致。
- **指标不是你的活。** 这一轮做完之后，平台会在用户的机器上跑一条评估命令，把数字算出来。你要做的是让那些数字算得出来——下面这些口径就是它要的东西，不要自创 key：
${metricLines}

所以你在第 5 节里只报「实验做完了、我自己跑过哪些检查」。数字由评估器产出，报上来也会被拒。

## 5. 怎么报结论

\`\`\`http
POST ${base}/api/v1/runs/${input.runId}/implemented
Authorization: Bearer <create_thread_token 返回的 token>
Content-Type: application/json
\`\`\`

\`\`\`json
{
  "gates": [
    { "rule_id": "no-future-leak", "pass": true, "evidence": "怎么验证的" },
    { "rule_id": "canonical-byte-equal", "pass": true, "evidence": "怎么验证的" }
  ],
  "report_md": "## 结论\\n\\n……",
  "output_files": { "路径/文件名": "<sha256>" }
}
\`\`\`

- \`gates\` 至少一条，如实填；平台不接受「我自己宣布通过」。有一条没过，这一轮就到此为止。
- \`report_md\` 是这一轮的结果：做了什么、怎么验证的、下一步该看什么。
- \`output_files\` 可选；要带的话，先把文件 \`PUT ${base}/api/v1/projects/${input.projectSlug}/blobs/<sha256>\` 传上来，再用 sha256 引用。
- **不要报 \`metrics\`**：带了会被直接拒掉。
- 令牌只证明「你是这条 Thread」，60 秒后过期：发之前现签一张，遇到 401 就再签一张重发。

报完之后你的事就做完了：这一轮进 \`evaluating\`，等评估器算出数字，才决定它进榜单还是标 rejected。
`;
}
