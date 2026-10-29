import { assertMetricKey } from './labs';

export type MetricDirection = 'higher-better' | 'lower-better' | 'neutral';
export type MetricUnit = 'ratio' | 'count' | 'bps' | 'seconds';

export const METRIC_UNITS: MetricUnit[] = ['ratio', 'count', 'bps', 'seconds'];
export const METRIC_DIRECTIONS: MetricDirection[] = ['higher-better', 'lower-better', 'neutral'];

export interface MetricDefinition {
  key: string;
  version: number;
  label: string;
  unit: string;
  direction: MetricDirection;
  definition_md: string;
  is_primary: boolean;
  /** 必报指标：run 少了它就不算通过（平台在 verdict 时自动判这条门禁）。 */
  required: boolean;
  sort_order: number;
}

/**
 * 新建项目时种入的指标模板：不是强制，只是让"口径"这件事从第一天就有内容可改。
 * 每条都是你现有 README 里已经在用的口径。
 */
export const METRIC_TEMPLATE: Omit<MetricDefinition, 'version'>[] = [
  {
    key: 'cumulative_return',
    label: '累计收益率',
    unit: 'ratio',
    direction: 'higher-better',
    is_primary: true,
    sort_order: 1,
    required: true,
    definition_md:
      '样本外全区间累计收益，复利，初始资金记为 1.0。必须扣全部成本（手续费 + 滑点），必须遵守不重叠交易约束。分母是初始资金，不是最大回撤也不是最大浮盈。',
  },
  {
    key: 'annualized_return',
    label: '年化收益率',
    unit: 'ratio',
    direction: 'higher-better',
    is_primary: false,
    sort_order: 2,
    required: true,
    definition_md: '由样本外净值按自然日折算：`(1 + 累计收益) ^ (365 / 覆盖天数) - 1`。覆盖天数按首个交易日到最后一个交易日计。',
  },
  {
    key: 'max_drawdown',
    label: '最大回撤',
    unit: 'ratio',
    direction: 'higher-better',
    is_primary: false,
    sort_order: 3,
    required: true,
    definition_md: '样本外净值（含未平仓浮盈亏，按收盘价盯市）的最大峰谷回撤，记为负数，-0.15 表示 -15%。越接近 0 越好。',
  },
  {
    key: 'sharpe',
    label: '日收益夏普',
    unit: 'ratio',
    direction: 'higher-better',
    is_primary: false,
    sort_order: 4,
    required: true,
    definition_md: '按日收益序列计算：`mean(日收益) / std(日收益) * sqrt(252)`，无风险利率取 0，std 用样本标准差（ddof=1）。日收益为空的日子记 0，不剔除。',
  },
  {
    key: 'trades',
    label: '交易数',
    unit: 'count',
    direction: 'neutral',
    is_primary: false,
    sort_order: 5,
    required: true,
    definition_md: '样本外成交笔数。一手开一手平算一笔；锁仓按一次开仓 + 一次平昨计。',
  },
  {
    key: 'avg_daily_trades',
    label: '平均每日交易',
    unit: 'count',
    direction: 'higher-better',
    is_primary: false,
    sort_order: 6,
    required: true,
    definition_md: '样本外交易数 / 样本外交易日数。硬约束是 `>= 1.0`，低于该值的实验只能作为研究 baseline，不能进入 SOTA。',
  },
];

/**
 * 必报指标缺了哪些：值必须是有限数字，null / 缺键 / 字符串都算没报。
 * 这条判定属于平台，不由机器上报的门禁决定。
 */
export function missingRequiredMetrics(
  definitions: { key: string; required?: boolean | number }[],
  reported: Record<string, unknown> | null,
): string[] {
  return definitions
    .filter((definition) => Boolean(definition.required))
    .filter((definition) => {
      const value = reported ? reported[definition.key] : undefined;
      return typeof value !== 'number' || !Number.isFinite(value);
    })
    .map((definition) => definition.key);
}

export function validateMetricInput(input: {
  key: string;
  unit: string;
  direction: string;
  definition_md: string;
}): void {
  assertMetricKey(input.key);
  if (!METRIC_UNITS.includes(input.unit as MetricUnit)) throw new Error(`unit 只能是 ${METRIC_UNITS.join(' / ')}`);
  if (!METRIC_DIRECTIONS.includes(input.direction as MetricDirection)) {
    throw new Error(`direction 只能是 ${METRIC_DIRECTIONS.join(' / ')}`);
  }
  if (input.definition_md.trim().length < 10) throw new Error('口径说明太短：至少写清分母、成本与样本范围');
}

/**
 * 上报的指标必须落在项目已定义的指标集内（键必须对得上）。
 * 返回这一轮实际使用的口径版本，随 run 一起钉住。
 */
export function matchMetrics(
  definitions: { key: string; version: number }[],
  reported: Record<string, unknown> | null,
): { metricSet: { key: string; version: number }[]; unknown: string[] } {
  if (!reported) return { metricSet: [], unknown: [] };
  const known = new Map(definitions.map((definition) => [definition.key, definition.version] as const));
  const unknown = Object.keys(reported).filter((key) => !known.has(key));
  const metricSet = definitions
    .filter((definition) => Object.prototype.hasOwnProperty.call(reported, definition.key))
    .map((definition) => ({ key: definition.key, version: definition.version }));
  return { metricSet, unknown };
}
