import { describe, expect, it } from 'vitest';
import { parseLeaderboard, parseLeaderboardStatus, parseMetricsCsv, resolveLabMetrics } from '../scripts/lib/q-labs-metrics.mjs';

const HEADER =
  'trades,win_rate,avg_trade_return,total_return,annual_return,max_drawdown,return_drawdown_ratio,daily_sharpe,avg_daily_trades';

describe('Q-Labs 指标来源', () => {
  it('读 metrics.csv：收益列是小数，六项齐了才算数', () => {
    const csv = `${HEADER}\n3404.0,0.52,0.00042,3.018,0.4624,-0.1221,24.7,2.3546,1.0581\n`;
    expect(parseMetricsCsv(csv)).toEqual({
      cumulative_return: 3.018,
      annualized_return: 0.4624,
      max_drawdown: -0.1221,
      sharpe: 2.3546,
      trades: 3404,
      avg_daily_trades: 1.0581,
    });
  });

  it('metrics.csv 少列就返回 null，不猜', () => {
    expect(parseMetricsCsv(`${HEADER}\n3404,0.52,0.0004,,,,,,\n`)).toBeNull();
  });

  it('读根 README 的榜单行，百分比转小数', () => {
    const table = [
      '| 排名 | Lab | 定位 | 全量数据 | 样本外评估 | 交易数 | 样本外日均交易 | 累计收益 | 年化收益 | 最大回撤 | 收益回撤比 | 日收益夏普 | 评价 |',
      '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
      '| 11 | `lab7` | 早期基准 | 四品种全量 | 滚动训练 | 4321 | 1.34 | 70.85% | 4.54% | -16.37% | 4.33 | 0.74 | 说明 |',
    ].join('\n');
    const row = parseLeaderboard(table).get(7);
    expect(row).toBeDefined();
    expect(row?.trades).toBe(4321);
    expect(row?.avg_daily_trades).toBe(1.34);
    expect(row?.cumulative_return).toBeCloseTo(0.7085, 10);
    expect(row?.annualized_return).toBeCloseTo(0.0454, 10);
    expect(row?.max_drawdown).toBeCloseTo(-0.1637, 10);
    expect(row?.sharpe).toBe(0.74);
  });

  it('metrics.csv 优先于榜单行；都没有就是没汇报', () => {
    const leaderboard = new Map([[7, { trades: 1, avg_daily_trades: 1, cumulative_return: 1, annualized_return: 1, max_drawdown: -1, sharpe: 1 }]]);
    const csv = `${HEADER}\n4321,0.5,0.0005,0.7,0.05,-0.16,4.3,0.74,1.34\n`;
    expect(resolveLabMetrics({ labNo: 7, metricsCsvText: csv, leaderboard }).source).toContain('metrics.csv');
    expect(resolveLabMetrics({ labNo: 7, metricsCsvText: null, leaderboard }).source).toContain('Leaderboard');
    expect(resolveLabMetrics({ labNo: 99, metricsCsvText: null, leaderboard })).toEqual({ metrics: null, source: null });
  });
});

describe('Q-Labs 榜单的排名列', () => {
  const table = [
    '| 排名 | Lab | 定位 | 全量数据 | 样本外评估 | 交易数 | 样本外日均交易 | 累计收益 | 年化收益 | 最大回撤 | 收益回撤比 | 日收益夏普 | 评价 |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    '| 排除 | `lab54` | 原 SOTA | 四品种全量 | 滚动训练 | 3298 | 1.03 | 430.25% | 58.48% | -9.00% | 47.83 | 2.93 | 使用同日完整候选 daily_rank。 |',
    '| 重评估 | `lab82` | 因果重评估 | 四品种全量 | 滚动训练 | 1493 | 0.46 | 30.92% | 11.96% | -17.75% | 1.74 | 0.90 | 不满足频率硬约束。 |',
    '| 2 | `lab51` | IC/IH short-only | 四品种全量 | 滚动训练 | 3285 | 1.02 | 373.70% | 53.62% | -9.00% | 41.53 | 2.78 | 被 lab54 超过。 |',
  ].join('\n');

  it('排名是数字才算进了排名', () => {
    const status = parseLeaderboardStatus(table);
    expect(status.get(51)).toMatchObject({ status: '2', ranked: true });
    expect(status.get(51)?.note).toContain('被 lab54 超过');
  });

  it('写成排除/重评估的没有独立资格', () => {
    const status = parseLeaderboardStatus(table);
    expect(status.get(54)).toMatchObject({ status: '排除', ranked: false });
    expect(status.get(82)).toMatchObject({ status: '重评估', ranked: false });
    expect(status.get(82)?.note).toContain('频率硬约束');
  });
});
