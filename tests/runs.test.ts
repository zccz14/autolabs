import { describe, expect, it } from 'vitest';
import { buildRunBrief, withExclusion } from '../src/runs';

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

describe('发给 Thread 的第一条输入', () => {
  const brief = buildRunBrief({
    lab: 'lab-0083',
    projectSlug: 'q-labs',
    projectName: 'Q Labs',
    runId: 'run_abc',
    externalRef: 'autolabs:q-labs:lab-0083',
    origin: 'https://autolabs.ntnl.io',
    snapshotId: 'snp_1',
    treeSha: 'tree_1',
    idea: '把信号窗口从 5 日拉到 20 日，看夏普是否还站得住。',
    note: '',
    metrics: [
      {
        key: 'sharpe',
        label: '夏普',
        unit: 'number',
        direction: 'higher-better',
        required: true,
        definition_md: '年化收益 / 年化波动，无风险利率取 0。',
      },
    ],
    verdictToken: 'alb_tok_secret',
    tokenExpiresAt: 1800000000,
  });

  it('把这一轮要验什么、文件在哪、结论往哪报都写清楚', () => {
    expect(brief).toContain('lab-0083');
    expect(brief).toContain('把信号窗口从 5 日拉到 20 日');
    expect(brief).toContain('https://autolabs.ntnl.io/api/v1/snapshots/snp_1/manifest');
    expect(brief).toContain('https://autolabs.ntnl.io/api/v1/runs/run_abc/verdict');
    expect(brief).toContain('Bearer alb_tok_secret');
  });

  it('指标口径带着 key、单位与必报标记一起下发', () => {
    expect(brief).toContain('`sharpe`：夏普｜单位 number｜higher-better｜必报');
    expect(brief).toContain('年化收益 / 年化波动');
  });

  it('没写思路就退回备注，不留下空的一段', () => {
    const fallback = buildRunBrief({
      lab: 'lab-0001',
      projectSlug: 'test',
      projectName: 'Test',
      runId: 'run_1',
      externalRef: 'autolabs:test:lab-0001',
      origin: 'http://127.0.0.1:8787',
      snapshotId: 'snp_1',
      treeSha: 'tree_1',
      idea: null,
      note: '跑一次基线',
      metrics: [],
      verdictToken: 'alb_x_y',
      tokenExpiresAt: 1800000000,
    });
    expect(fallback).toContain('跑一次基线');
    expect(fallback).toContain('这个项目还没有定义指标');
  });
});
