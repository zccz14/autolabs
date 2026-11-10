import { describe, expect, it } from 'vitest';
import { compareMetrics } from '../src/recheck';

describe('复算核对', () => {
  it('算出来一样，就是一条可复现的证据', () => {
    expect(compareMetrics({ sharpe: 1.93, trades: 1493 }, { sharpe: 1.93, trades: 1493 })).toEqual({
      state: 'matched',
      diffs: [],
    });
  });

  it('浮点末位差不算不一致：同一个包不该因为最后一位被判成不可复现', () => {
    expect(compareMetrics({ sharpe: 1.93 }, { sharpe: 1.93 + 1e-12 }).state).toBe('matched');
  });

  it('差得出来就点名，把两个值都摆上', () => {
    const result = compareMetrics({ sharpe: 1.93, trades: 1493 }, { sharpe: 1.71, trades: 1493 });
    expect(result.state).toBe('diverged');
    expect(result.diffs).toEqual([{ key: 'sharpe', expected: 1.93, actual: 1.71 }]);
  });

  it('这次多报了一个 key，也算不一致', () => {
    const result = compareMetrics({ sharpe: 1.93 }, { sharpe: 1.93, win_rate: 0.5 });
    expect(result.state).toBe('diverged');
    expect(result.diffs[0]!.key).toBe('win_rate');
  });

  it('当年没记数字（rejected 的行）就只跟空的比', () => {
    expect(compareMetrics(null, {}).state).toBe('matched');
    expect(compareMetrics(null, { sharpe: 1 }).state).toBe('diverged');
  });
});
