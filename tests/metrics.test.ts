import { describe, expect, it } from 'vitest';
import { assertMetricKey, manifestDigest } from '../src/labs';
import { METRIC_TEMPLATE, matchMetrics, validateMetricInput } from '../src/metrics';

describe('manifest digest', () => {
  it('is order independent and sensitive to size and content', async () => {
    const a = await manifestDigest([
      { path: 'BTCUSDT/1m.csv', sha256: 'aa', size: 10 },
      { path: 'BTCUSDT/funding.csv', sha256: 'bb', size: 4 },
    ]);
    const b = await manifestDigest([
      { path: 'BTCUSDT/funding.csv', sha256: 'bb', size: 4 },
      { path: 'BTCUSDT/1m.csv', sha256: 'aa', size: 10 },
    ]);
    const c = await manifestDigest([
      { path: 'BTCUSDT/1m.csv', sha256: 'aa', size: 11 },
      { path: 'BTCUSDT/funding.csv', sha256: 'bb', size: 4 },
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not confuse path/sha/size boundaries', async () => {
    const split = await manifestDigest([{ path: 'a', sha256: 'bb', size: 1 }]);
    const shifted = await manifestDigest([{ path: 'ab', sha256: 'b', size: 1 }]);
    expect(split).not.toBe(shifted);
  });
});

describe('metric keys', () => {
  it('accepts snake_case keys', () => {
    for (const key of ['sharpe', 'cumulative_return', 'avg_daily_trades']) expect(() => assertMetricKey(key)).not.toThrow();
  });
  it('rejects uppercase, leading digit and symbols', () => {
    for (const key of ['Sharpe', '1sharpe', 'sharpe-ratio', 'sharpe ratio', '']) expect(() => assertMetricKey(key)).toThrow();
  });
});

describe('metric input', () => {
  const base = { key: 'sharpe', unit: 'ratio', direction: 'higher-better', definition_md: '按日收益序列计算，无风险利率 0，年化 sqrt(252)。' };
  it('accepts a complete definition', () => {
    expect(() => validateMetricInput(base)).not.toThrow();
  });
  it('rejects an unknown unit, direction or a too-short definition', () => {
    expect(() => validateMetricInput({ ...base, unit: 'percent' })).toThrow();
    expect(() => validateMetricInput({ ...base, direction: 'best' })).toThrow();
    expect(() => validateMetricInput({ ...base, definition_md: '夏普' })).toThrow();
  });
});

describe('reported metrics must match the project contract', () => {
  const definitions = [
    { key: 'sharpe', version: 3 },
    { key: 'max_drawdown', version: 1 },
  ];

  it('pins the version actually used', () => {
    const { metricSet, unknown } = matchMetrics(definitions, { sharpe: 1.2, max_drawdown: -0.15 });
    expect(unknown).toEqual([]);
    expect(metricSet).toEqual([
      { key: 'sharpe', version: 3 },
      { key: 'max_drawdown', version: 1 },
    ]);
  });

  it('reports unknown keys instead of silently dropping them', () => {
    const { unknown } = matchMetrics(definitions, { sharpe: 1.2, win_rate: 0.5 });
    expect(unknown).toEqual(['win_rate']);
  });

  it('treats a null payload as no metrics', () => {
    expect(matchMetrics(definitions, null)).toEqual({ metricSet: [], unknown: [] });
  });
});

describe('template', () => {
  it('ships definitions that carry a real口径 rather than a label', () => {
    expect(METRIC_TEMPLATE.length).toBeGreaterThan(3);
    for (const metric of METRIC_TEMPLATE) {
      expect(metric.definition_md.length).toBeGreaterThan(30);
      expect(() => validateMetricInput(metric)).not.toThrow();
    }
    expect(METRIC_TEMPLATE.filter((metric) => metric.is_primary)).toHaveLength(1);
  });
});
