import { describe, expect, it } from 'vitest';
import { buildRepairBrief } from '../src/repair';
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
