/**
 * 指标的展示口径：
 *   ratio   存的是比例小数（0.16 = 16%），展示时乘 100；
 *   number  无量纲数值，原样展示——夏普 1.93 就是 1.93，乘 100 会变成荒谬的 193%；
 *   count   就是笔数。
 */
export function formatMetricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'ratio') return `${(value * 100).toFixed(2)}%`;
  if (unit === 'number') return value.toFixed(2);
  if (unit === 'count') return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return String(value);
}
