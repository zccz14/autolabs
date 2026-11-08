import { describe, expect, it } from 'vitest';
import { buildIdeaBrief, extractIdea } from '../src/ideas';

const brief = buildIdeaBrief({
  projectSlug: 'q-labs',
  projectName: 'Q-Labs',
  description: '股指期货日内策略研究',
  labCount: 2,
  sotaLab: 'lab-0001',
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
  runs: [
    {
      lab: 'lab-0001',
      state: 'frozen',
      idea: '把信号窗口从 5 日拉到 20 日',
      report: '夏普从 0.9 升到 1.47',
      metrics: { sharpe: 1.47 },
      gates: [{ rule_id: 'no-future-leak', pass: true, evidence: '只用入场前字段' }],
    },
    {
      lab: 'lab-0002',
      state: 'rejected',
      idea: '用当日完整候选做 rank',
      report: '收益虚高',
      metrics: { sharpe: 0.9 },
      gates: [{ rule_id: 'no-future-leak', pass: false, evidence: '用了同日收盘后的排名' }],
    },
  ],
});

describe('给 master thread 的研究地图', () => {
  it('把每个 lab 的思路、结果、指标、门禁按顺序摆出来', () => {
    expect(brief).toContain('### lab-0001 · frozen');
    expect(brief).toContain('把信号窗口从 5 日拉到 20 日');
    expect(brief).toContain('sharpe=1.47');
    expect(brief).toContain('### lab-0002 · rejected');
    expect(brief.indexOf('lab-0001')).toBeLessThan(brief.indexOf('lab-0002'));
  });

  it('没过门禁的实验要写清为什么没过——那才是下一步的依据', () => {
    expect(brief).toContain('门禁为什么没过：no-future-leak — 用了同日收盘后的排名');
  });

  it('指标口径与当前 SOTA 一起给，免得它自己编口径', () => {
    expect(brief).toContain('`sharpe`：夏普｜单位 number｜higher-better｜必报');
    expect(brief).toContain('当前 SOTA：lab-0001');
  });

  it('只交一段 Markdown，并且允许说「证据不够」', () => {
    expect(brief).toContain('只输出一段 Markdown');
    expect(brief).toContain('补数据 / 补诊断');
  });
});

describe('从 Cybion 回复里取思路', () => {
  it('只取最后一条 assistant message，不要它的思考过程', () => {
    const idea = extractIdea({
      status: 'completed',
      input_record_id: 12,
      response: {
        output: [
          { item: { type: 'reasoning', content: [{ type: 'reasoning_text', text: '先看看地图……' }] } },
          { item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '## 下一轮\n验证窗口拉长后的夏普。' }] } },
        ],
      },
    });
    expect(idea).toBe('## 下一轮\n验证窗口拉长后的夏普。');
  });

  it('还没回话时返回 null，不拿思考过程冒充结论', () => {
    expect(
      extractIdea({
        status: 'in_progress',
        input_record_id: 12,
        response: { output: [{ item: { type: 'reasoning', content: [{ type: 'reasoning_text', text: '想想' }] } }] },
      }),
    ).toBeNull();
    expect(extractIdea(null)).toBeNull();
  });
});
