import { describe, expect, it } from 'vitest';
import { buildRepairBrief, planRepair } from '../src/repair';
import { LAB_MANIFEST_SPEC } from '../src/lab-spec';

const brief = buildRepairBrief({
  origin: 'https://autolabs.ntnl.io',
  projectSlug: 'q-labs',
  projectName: '股指期货',
  runId: 'run_abc',
  lab: 'lab-0083',
  snapshotId: 'snp_1',
  treeSha: 'tree_1',
  reason: '快照根目录没有 lab.json：这个包没说自己怎么被评估',
  attempt: 1,
});

describe('修复简报', () => {
  it('把问题原样摆出来，不让人猜', () => {
    expect(brief).toContain('lab-0083');
    expect(brief).toContain('快照根目录没有 lab.json');
  });

  it('规范与派单简报是同一份，不各写一遍', () => {
    expect(brief).toContain(LAB_MANIFEST_SPEC);
  });

  it('说清楚怎么交回来：派生 + 提交，两条路都点名', () => {
    expect(brief).toContain('POST https://autolabs.ntnl.io/api/v1/projects/q-labs/snapshots');
    expect(brief).toContain('"parent_id": "snp_1"');
    expect(brief).toContain('POST https://autolabs.ntnl.io/api/v1/runs/run_abc/repaired');
  });

  it('提醒快照是全量的：少带一个文件，这就不是原来那一轮了', () => {
    expect(brief).toContain('快照是全量的');
  });

  it('说明这是第几次尝试，别让人以为可以无限重试', () => {
    expect(brief).toContain('这是第 1 次尝试');
  });
});

describe('补规范该改哪里', () => {
  const unsettled = { state: 'evaluating', input_snapshot_id: 'snp_a', eval_snapshot_id: null };
  const frozen = { state: 'frozen', input_snapshot_id: 'snp_a', eval_snapshot_id: null };
  const derived = { parent_id: 'snp_a' };
  const ok = { kind: 'ok' as const };

  it('还没结算：改代码，旧树留痕', () => {
    expect(planRepair(unsettled, derived, ok)).toEqual({ ok: true, action: 'replace-input' });
  });

  it('已经 frozen：代码一个字不动，只挂一份复算用的树', () => {
    expect(planRepair(frozen, derived, ok)).toEqual({ ok: true, action: 'attach-eval-tree' });
  });

  it('rejected 也算结算过，同样只挂树', () => {
    expect(planRepair({ ...frozen, state: 'rejected' }, derived, ok)).toEqual({ ok: true, action: 'attach-eval-tree' });
  });

  it('不是从这一轮的树派生的，一律不收', () => {
    const plan = planRepair(frozen, { parent_id: 'snp_other' }, ok);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.code).toBe('not_derived');
  });

  it('补进来的树里 lab.json 还是不行，也不收', () => {
    const plan = planRepair(frozen, derived, { kind: 'invalid', message: 'lab.json 里没有 evaluate' });
    expect(plan.ok === false && plan.message).toContain('evaluate');
    const absent = planRepair(frozen, derived, { kind: 'absent' });
    expect(absent.ok === false && absent.message).toContain('没有 lab.json');
  });

  it('已经补过一次的，第二次要在新树上派生', () => {
    const withTree = { ...frozen, eval_snapshot_id: 'snp_b' };
    expect(planRepair(withTree, { parent_id: 'snp_a' }, ok).ok).toBe(false);
    expect(planRepair(withTree, { parent_id: 'snp_b' }, ok)).toEqual({ ok: true, action: 'attach-eval-tree' });
  });
});
