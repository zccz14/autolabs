/**
 * 「下一轮做什么」这件事的入口与出口。
 *
 * 入口是一张研究地图：每个 lab 想验证什么、结论是什么、数字多少、门禁为什么没过。
 * 出口是下一轮实验的思路——一段 Markdown，正好能填进开 run 表单的那一栏。
 * 中间发生了什么（诊断、取舍）由 master thread 决定，AutoLabs 只负责把地图给全。
 */

export interface IdeaBriefMetric {
  key: string;
  label: string;
  unit: string;
  direction: string;
  required: boolean;
  is_primary: boolean;
  definition_md: string;
}

export interface IdeaBriefRun {
  lab: string;
  state: string;
  idea: string | null;
  report: string | null;
  metrics: Record<string, unknown> | null;
  gates: { rule_id: string; pass: boolean; evidence: string | null }[];
}

export interface IdeaBriefInput {
  projectSlug: string;
  projectName: string;
  description: string;
  labCount: number;
  sotaLab: string | null;
  metrics: IdeaBriefMetric[];
  runs: IdeaBriefRun[];
  /** 只读令牌：让它按需取某一轮的全文，而不是把几十个实验全塞进提示词。 */
  readerToken?: string;
  /** AutoLabs 的对外地址，拼接口地址用。 */
  origin?: string;
}

/** 一条叙事在地图上只留摘要：整篇 README 塞进上下文，读的人也抓不住重点。 */
function clip(text: string | null | undefined, limit = 240): string {
  if (!text) return '（未填写）';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function numbers(metrics: Record<string, unknown> | null): [string, number][] {
  if (!metrics) return [];
  return Object.entries(metrics).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
}

function metricLine(metrics: Record<string, unknown> | null): string {
  const entries = numbers(metrics);
  return entries.length === 0 ? '（没有上报指标）' : entries.map(([key, value]) => `${key}=${value}`).join('、');
}

/** 一行一个实验：状态、关键数字、一句话思路，没过门禁的直接写死因。 */
function oneLine(run: IdeaBriefRun, keys: string[]): string {
  const reported = numbers(run.metrics);
  const picked = keys
    .map((key) => reported.find((entry) => entry[0] === key))
    .filter((entry): entry is [string, number] => Boolean(entry))
    .slice(0, 2)
    .map(([key, value]) => `${key}=${Number.isInteger(value) ? value : value.toFixed(2)}`);
  const failed = run.gates.filter((gate) => !gate.pass);
  const gate = failed.length ? ` · 挂 ${failed.map((entry) => `${entry.rule_id}（${clip(entry.evidence, 60)}）`).join('；')}` : '';
  return `- ${run.lab} ${run.state}${picked.length ? ` · ${picked.join(' ')}` : ''} · ${clip(run.idea, 60)}${gate}`;
}

function detail(run: IdeaBriefRun): string {
  const gates = run.gates.length
    ? run.gates.map((gate) => `${gate.rule_id}:${gate.pass ? 'pass' : 'fail'}`).join('、')
    : '（没有门禁记录）';
  const failed = run.gates.filter((gate) => !gate.pass);
  const reasons = failed.length
    ? `\n门禁为什么没过：${failed.map((gate) => `${gate.rule_id} — ${clip(gate.evidence, 200)}`).join('；')}`
    : '';
  return `### ${run.lab} · ${run.state}
思路：${clip(run.idea)}
结果：${clip(run.report)}
指标：${metricLine(run.metrics)}
门禁：${gates}${reasons}`;
}

/**
 * 给 master thread 的地图：**速览 + 按需取细节**，不是把几十个实验的全文倒进去。
 *
 * 一屏装不下第 83 个实验的来龙去脉，硬塞进去只会让上下文变成噪声、让每一轮都变慢。
 * 所以这里每个实验只留一行，最近的几个给完整叙事，其余靠只读令牌按需去取。
 */
export function buildIdeaBrief(input: IdeaBriefInput): string {
  const primary = input.metrics.find((metric) => metric.is_primary) ?? input.metrics[0];
  const keys = [primary?.key, ...input.metrics.filter((metric) => metric.required).map((metric) => metric.key)].filter(
    (key): key is string => Boolean(key),
  );

  const counts = new Map<string, number>();
  for (const run of input.runs) counts.set(run.state, (counts.get(run.state) ?? 0) + 1);
  const spread = [...counts.entries()].map(([state, count]) => `${state} ${count}`).join('、') || '还没有实验';

  const best = primary
    ? input.runs
        .filter((run) => typeof run.metrics?.[primary.key] === 'number')
        .sort((left, right) => {
          const a = left.metrics![primary.key] as number;
          const b = right.metrics![primary.key] as number;
          return primary.direction === 'lower-better' ? a - b : b - a;
        })[0]
    : undefined;
  const bestLine = primary && best ? `${primary.label} 最好的是 ${best.lab}：${(best.metrics![primary.key] as number).toFixed(2)}` : '';

  const index = input.runs.map((run) => oneLine(run, keys)).join('\n');
  const recent = input.runs.slice(-6).map(detail).join('\n\n');

  const contract = input.metrics.length
    ? input.metrics
        .map(
          (metric) =>
            `- \`${metric.key}\`：${metric.label}｜单位 ${metric.unit}｜${metric.direction}${metric.required ? '｜必报' : ''}${metric.is_primary ? '｜主指标' : ''}\n  口径：${metric.definition_md}`,
        )
        .join('\n')
    : '- （这个项目还没有定义指标契约）';

  const drillDown =
    input.readerToken && input.origin
      ? `## 要细节自己去取

上面每个实验只留了一行。需要某一轮的完整思路、结果、指标与门禁时再取，别一次全拉：

- 整个项目：\`GET ${input.origin}/api/v1/projects/${input.projectSlug}/runs\`
- 单轮：\`GET ${input.origin}/api/v1/runs/<run_id>\`（run_id 在上面那个接口的返回里）
- 请求头：\`Authorization: Bearer ${input.readerToken}\`（只读，30 天到期）`
      : '';

  return `# 这条研究线的下一轮

你是这条研究线的负责人。项目 \`${input.projectSlug}\`（${input.projectName}）已经有 ${input.labCount} 个实验，当前 SOTA：${input.sotaLab ?? '无'}。

项目定位：${input.description || '（没有写）'}

你的任务：先诊断这条线现在卡在哪、证据支持什么，再给出**下一轮实验的思路**；这段思路会直接成为下一轮的实验设计，请当作写给未来执行者看的任务书。

## 指标契约

${contract}

## 地图速览

状态分布：${spread}${bestLine ? `\n${bestLine}` : ''}

## 每个实验一行（从旧到新）

${index || '（还一个实验都没有）'}

## 最近几个实验（完整叙事）

${recent || '（还一个实验都没有）'}

${drillDown}

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
