import { describe, expect, it } from 'vitest';
import { withExclusion } from '../src/runs';

describe('排除即 rejected', () => {
  const gates = [
    { rule_id: 'imported-history', pass: true, evidence: 'README 声明已冻结' },
    { rule_id: 'metrics-reported', pass: true, evidence: '已上报全部 6 个必报指标' },
  ];

  it('追加一条不通过的 excluded 门禁，原来的门禁一条不删', () => {
    const next = withExclusion(gates, '使用同日完整候选 daily_rank，属执行层未来信息');
    expect(next).toHaveLength(3);
    expect(next.slice(0, 2)).toEqual(gates);
    expect(next[2]).toMatchObject({ rule_id: 'excluded', pass: false });
    expect(next[2]?.evidence).toContain('未来信息');
  });

  it('重复排除只留一条，理由取最新的', () => {
    const once = withExclusion(gates, '第一次判定');
    const twice = withExclusion(once, '第二次判定');
    expect(twice.filter((gate) => gate.rule_id === 'excluded')).toHaveLength(1);
    expect(twice[twice.length - 1]?.evidence).toBe('第二次判定');
  });
});
