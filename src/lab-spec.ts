/**
 * `lab.json` 的规范文本：派单简报与修复简报共用同一份。
 *
 * 两处各写一份迟早会漂移，而这个产品里「一个包该怎么写」只能有一个答案。
 */
export const LAB_MANIFEST_SPEC = `平台的评估器不认识你的代码。它只认一件事：**快照根目录的 \`lab.json\`**。

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

**这一条是硬要求**：没有 \`lab.json\`、或者它写得不对，这一轮就算不出指标，进不了榜单。它跟着快照走，所以改算法＝开新一轮，历史行不会被今天的命令改写。`;
