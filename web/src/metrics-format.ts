/** 指标的展示口径：ratio 存的是小数（1.16 = 116%），count 就是笔数。 */
export function formatMetricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'ratio') return `${(value * 100).toFixed(2)}%`;
  if (unit === 'count') return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return String(value);
}
