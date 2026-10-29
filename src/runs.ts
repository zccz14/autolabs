/**
 * run 的门禁与状态语义。
 *
 * 一个 lab 只有在「同一个口径下完整可比」时才算数。中途的重评估、消融诊断、
 * 被判定使用了未来信息的结果，都不是一个可以独立汇报指标的实验——它们的
 * 结论只能算 rejected，不能留在榜单上被当成「当前最好」。
 */

export interface GateRecord {
  rule_id: string;
  pass: boolean;
  evidence: string | null;
}

/**
 * 排除即 rejected：把「为什么不算数」写成一条不通过的门禁，追加在原有门禁之后。
 * 原来的门禁一条都不删——历史照原样留着，只是多了一条终局判定。
 */
export function withExclusion(gates: GateRecord[], reason: string): GateRecord[] {
  const kept = gates.filter((gate) => gate.rule_id !== 'excluded');
  return [...kept, { rule_id: 'excluded', pass: false, evidence: reason }];
}
