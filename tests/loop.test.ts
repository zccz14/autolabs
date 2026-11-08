import { describe, expect, it } from 'vitest';
import { decideLoopAction } from '../src/loop';

const base = { loopState: 'running' as const, inFlightRunId: null, ideaReady: false, ideaFresh: false, ideaPending: false };

describe('研究循环的决策', () => {
  it('暂停时什么都不做——在飞的那一轮不归它管', () => {
    expect(decideLoopAction({ ...base, loopState: 'paused', inFlightRunId: 'run_1' })).toEqual({ type: 'idle' });
  });

  it('手里还有没结算的实验就等，不叠第二轮', () => {
    expect(decideLoopAction({ ...base, inFlightRunId: 'run_1' })).toEqual({ type: 'wait', runId: 'run_1' });
  });

  it('思路还在生成就等它', () => {
    expect(decideLoopAction({ ...base, ideaPending: true })).toEqual({ type: 'wait-idea' });
  });

  it('思路好了、而且对得上最新一轮，就直接开下一轮', () => {
    expect(decideLoopAction({ ...base, ideaReady: true, ideaFresh: true, ideaText: '下一轮验 X' })).toEqual({
      type: 'dispatch',
      idea: '下一轮验 X',
    });
  });

  it('地图变了（有新实验）就重新问一遍，不拿旧思路凑数', () => {
    expect(decideLoopAction({ ...base, ideaReady: true, ideaFresh: false })).toEqual({ type: 'request-idea' });
    expect(decideLoopAction(base)).toEqual({ type: 'request-idea' });
  });
});
