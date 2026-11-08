/**
 * 「下一轮做什么」这件事的入口与出口。
 *
 * 入口是一张研究地图：每个 lab 想验证什么、结论是什么、数字多少、门禁为什么没过。
 * 出口是下一轮实验的思路——一段 Markdown，正好能填进开 run 表单的那一栏。
 * 中间发生了什么（诊断、取舍）由 master thread 决定，AutoLabs 只负责把地图给全。
 */

export interface IdeaBriefInput {
  projectSlug: string;
  projectName: string;
  description: string;
  labCount: number;
  sotaLab: string | null;
  metrics: { key: string; label: string; unit: string; direction: string; required: boolean; definition_md: string }[];
  runs: {
    lab: string;
    state: string;
    idea: string | null;
    report: string | null;
    metrics: Record<string, unknown> | null;
    gates: { rule_id: string; pass: boolean; evidence: string | null }[];
  }[];
}

/** 一条叙事在地图上只留摘要：整篇 README 塞进上下文，读的人也抓不住重点。 */
function clip(text: string | null | undefined, limit = 240): string {
  if (!text) return '（未填写）';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function metricLine(metrics: Record<string, unknown> | null): string {
  if (!metrics) return '（没有上报指标）';
  const entries = Object.entries(metrics).filter(([, value]) => typeof value === 'number');
  return entries.length === 0 ? '（没有上报指标）' : entries.map(([key, value]) => `${key}=${value}`).join('、');
}

export function buildIdeaBrief(input: IdeaBriefInput): string {
  const map = input.runs
    .map((run) => {
      const failed = run.gates.filter((gate) => !gate.pass);
      const gates = run.gates.length
        ? run.gates.map((gate) => `${gate.rule_id}:${gate.pass ? 'pass' : 'fail'}`).join('、')
        : '（没有门禁记录）';
      const reasons = failed.length
        ? `\n门禁为什么没过：${failed.map((gate) => `${gate.rule_id} — ${clip(gate.evidence, 200)}`).join('；')}`
        : '';
      return `### ${run.lab} · ${run.state}
思路：${clip(run.idea)}
结果：${clip(run.report)}
指标：${metricLine(run.metrics)}
门禁：${gates}${reasons}`;
    })
    .join('\n\n');

  const metricLineItems = input.metrics.length
    ? input.metrics
        .map(
          (metric) =>
            `- \`${metric.key}\`：${metric.label}｜单位 ${metric.unit}｜${metric.direction}${metric.required ? '｜必报' : ''}\n  口径：${metric.definition_md}`,
        )
        .join('\n')
    : '- （这个项目还没有定义指标契约）';

  return `# 这条研究线的下一轮

你是这条研究线的负责人。项目 \`${input.projectSlug}\`（${input.projectName}）已经有 ${input.labCount} 个实验，当前 SOTA：${input.sotaLab ?? '无'}。

项目定位：${input.description || '（没有写）'}

你的任务：读完下面整张研究地图，诊断这条线现在卡在哪、证据支持什么、下一步最值得验证哪个假设，然后给出**下一轮实验的思路**。这段思路会直接成为下一轮的实验设计，请当作写给未来执行者看的任务书。

## 指标契约

${metricLineItems}

## 研究地图（从旧到新）

${map || '（还一个实验都没有）'}

## 你要交的东西

只输出一段 Markdown，就是下一轮实验的思路。不要前言、不要客套、不要用代码块把整段包起来、不要反问。

里面必须写清三件事：

1. **要验证什么**：一个明确的假设，能被指标或门禁判真假。
2. **为什么这么设计**：依据是上面哪个 lab 的结果、哪条门禁的失败原因，或哪一版指标口径。
3. **排除了哪些做法**：以及为什么现在不做它们。

如果地图上的证据还不足以支撑新假设，就写一轮「补数据 / 补诊断」的验证，把缺什么写清楚——不要为了出新实验而编一个故事。
`;
}

/** Cybion 的回复里，真正要的是最后一条 assistant message，不是它的思考过程。 */
export interface ThreadResponseItem {
  item?: {
    type?: string;
    role?: string;
    content?: { type?: string; text?: string }[];
  };
}

export interface ThreadResponse {
  status?: string;
  input_record_id?: number | null;
  response?: { output?: ThreadResponseItem[] } | null;
}

export function extractIdea(response: ThreadResponse | null | undefined): string | null {
  const items = response?.response?.output ?? [];
  const messages = items.filter((entry) => entry.item?.type === 'message' && entry.item?.role === 'assistant');
  const last = messages[messages.length - 1];
  if (!last) return null;
  const text = (last.item?.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
  return text || null;
}
