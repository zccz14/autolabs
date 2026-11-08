/**
 * 研究循环：没有人在环。
 *
 * 启动之后 AutoLabs 自己推进：让 master thread 读地图出思路 → 用这段思路开一轮
 * 实验并发出去 → 等执行体回传结论 → 再出思路。暂停只做一件事：不再开新实验，
 * 在飞的那一轮照常跑完、照常结算。
 *
 * 决策是纯函数，执行在 worker 侧（cron 每分钟一拍 + 启动时立刻一拍）。
 */

export type LoopState = 'running' | 'paused';

export type LoopAction =
  | { type: 'idle' }
  | { type: 'wait'; runId: string }
  | { type: 'request-idea' }
  | { type: 'wait-idea' }
  | { type: 'dispatch'; idea: string };

export interface LoopInput {
  /** 已经读回来的思路正文（ready 时才有）。 */
  ideaText?: string;
  loopState: LoopState;
  /** 手里还没结算的那一轮（proposed / dispatched / running）。 */
  inFlightRunId: string | null;
  /** master thread 这一轮是否已经说完。 */
  ideaReady: boolean;
  /** 这一版思路是不是对得上最新一轮实验（地图没变）。 */
  ideaFresh: boolean;
  /** 思路正在生成。 */
  ideaPending: boolean;
}

export function decideLoopAction(input: LoopInput): LoopAction {
  if (input.loopState !== 'running') return { type: 'idle' };
  if (input.inFlightRunId) return { type: 'wait', runId: input.inFlightRunId };
  if (input.ideaPending) return { type: 'wait-idea' };
  if (input.ideaReady && input.ideaFresh) return { type: 'dispatch', idea: input.ideaText ?? '' };
  return { type: 'request-idea' };
}

/** 循环里每一轮都留一条事件，事后能看清它是怎么走到这一步的。 */
export const LOOP_EVENTS = {
  started: 'loop.started',
  paused: 'loop.paused',
  runOpened: 'loop.run_opened',
  failed: 'loop.failed',
} as const;
