import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMetricValue } from '../metrics-format';

/** 一个实验在这个指标上的一个点。横轴是实验编号，所以编号本身就是 x。 */
export interface MetricPoint {
  lab: string;
  lab_no: number;
  value: number;
  state: string;
}

const axisStyle = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;

/**
 * 刻度按 1/2/5 取整，别把 101.61% 这种数据值当刻度——刻度是尺子，不是数字。
 * 纵轴永远把 0 包进来：负值指标（回撤、负夏普）没有零线就没有参照。
 */
function niceScale(min: number, max: number, targetTicks = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return { min, max, step: 1 };
  const step = (() => {
    const raw = (max - min) / (targetTicks - 1);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / magnitude;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  })();
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

function ticksBetween(min: number, max: number, step: number, from = min) {
  const ticks: number[] = [];
  for (let value = from; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

function Dot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: MetricPoint }) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const frozen = payload.state === 'frozen';
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill={frozen ? 'var(--foreground)' : 'var(--background)'}
      stroke={frozen ? 'var(--foreground)' : 'var(--muted-foreground)'}
      strokeWidth={1.5}
    />
  );
}

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: MetricPoint }[]; unit: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
      <p className="font-mono">{point.lab}</p>
      <p className="font-mono">{formatMetricValue(point.value, unit)}</p>
      <p className="text-muted-foreground">{point.state}</p>
    </div>
  );
}

/**
 * 指标随实验序号的变化：横轴 lab 编号，纵轴这个指标的值。
 * 冻结的 run 实心、其它空心，0 画一条虚线——负数指标（回撤、负夏普）一眼能看出来。
 */
export function MetricChart({ points, unit, height = 220 }: { points: MetricPoint[]; unit: string; height?: number }) {
  const values = points.map((point) => point.value);
  const y = niceScale(Math.min(0, ...values), Math.max(0, ...values));
  const lastLab = Math.max(1, ...points.map((point) => point.lab_no));
  const x = niceScale(1, lastLab);
  const xTicks = ticksBetween(x.min, x.max, x.step, 1).filter((tick) => tick <= lastLab);

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="lab_no"
            type="number"
            domain={[1, Math.max(1, lastLab)]}
            ticks={xTicks}
            allowDecimals={false}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tickFormatter={(value: number) => `#${value}`}
          />
          <YAxis
            width={64}
            // 纵轴贴着数据走，但一定把 0 包进来——不然零线要么看不见，要么上面留一大截空白。
            domain={[y.min, y.max]}
            ticks={ticksBetween(y.min, y.max, y.step)}
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatMetricValue(value, unit)}
          />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: 'var(--border)' }} />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            dot={<Dot />}
            activeDot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
