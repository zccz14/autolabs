import { describe, expect, it } from 'vitest';
import { buildEvalScript, judgeEvaluation, parseMetrics, shellQuote } from '../src/evaluation';

const command = {
  origin: 'https://autolabs.ntnl.io',
  projectSlug: 'q-labs',
  runId: 'run_abc',
  lab: 'lab-0083',
  snapshotId: 'snp_1',
  treeSha: 'tree_1',
  token: 'alb_tok_secret',
  dataset: 'okx-btc-usdt-perp-1m@deadbeef',
  metrics: [{ key: 'sharpe', unit: 'number', direction: 'higher-better', version: 2 }],
  command: 'python -m harness.evaluate',
};

describe('评估命令的契约', () => {
  it('把输入全塞进环境变量，命令本身原样留在最后', () => {
    const built = buildEvalScript(command);
    expect(built.trimEnd().endsWith('python -m harness.evaluate')).toBe(true);
    expect(built).toContain("export AUTOLABS_SNAPSHOT_URL='https://autolabs.ntnl.io/api/v1/snapshots/snp_1/tar.gz'");
    expect(built).toContain("export AUTOLABS_TOKEN='alb_tok_secret'");
    expect(built).toContain("export AUTOLABS_DATASET='okx-btc-usdt-perp-1m@deadbeef'");
    // 口径也一起下发：评估器要按项目定义的那几个 key 说话。
    expect(built).toContain('"key":"sharpe"');
    expect(built).toContain('"version":2');
  });

  it('先把快照解到一个临时目录，再进去跑命令：工作目录是有定义的', () => {
    const built = buildEvalScript(command);
    const lines = built.split('\n');
    const unzip = lines.findIndex((line) => line.includes('tar -xzf'));
    const cd = lines.findIndex((line) => line === 'cd "$AUTOLABS_WORKDIR"');
    const run = lines.findIndex((line) => line === 'python -m harness.evaluate');
    expect(built).toContain('export AUTOLABS_WORKDIR');
    expect(unzip).toBeGreaterThan(0);
    expect(cd).toBeGreaterThan(unzip);
    expect(run).toBeGreaterThan(cd);
  });

  it('值里有单引号也不会把命令拼歪', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    const built = buildEvalScript({ ...command, dataset: "a'b" });
    expect(built).toContain(`export AUTOLABS_DATASET='a'\\''b'`);
  });

  it('指标取最后一行 JSON，前面打多少日志都不影响', () => {
    const stdout = ['loading snapshot…', 'rows=1493', '{"metrics":{"sharpe":1.93,"trades":1493}}'].join('\n');
    expect(parseMetrics(stdout)).toEqual({ sharpe: 1.93, trades: 1493 });
  });

  it('后面又打了一行不是指标的东西，仍然认那一条指标', () => {
    const stdout = ['{"metrics":{"sharpe":1.93}}', 'done in 12s'].join('\n');
    expect(parseMetrics(stdout)).toEqual({ sharpe: 1.93 });
  });

  it('一句指标都没说就明确报错，不要静默返回空对象', () => {
    expect(() => parseMetrics('all good\nno metrics here')).toThrow(/评估器没有给出指标/);
  });

  it('只有 metrics 不是对象的那一行，不算数', () => {
    expect(() => parseMetrics('{"metrics":[1,2,3]}')).toThrow(/评估器没有给出指标/);
  });
});

const definitions = [
  { key: 'sharpe', version: 2, required: true },
  { key: 'trades', version: 1, required: false },
];

describe('一次评估怎么结算', () => {
  it('指标齐了、自测也过了，就进榜单', () => {
    const judged = judgeEvaluation(definitions, { sharpe: 1.93, trades: 12 }, [
      { rule_id: 'no-future-leak', pass: true, evidence: '审查过' },
    ]);
    expect(judged.state).toBe('frozen');
    expect(judged.metricSet).toEqual([
      { key: 'sharpe', version: 2 },
      { key: 'trades', version: 1 },
    ]);
    expect(judged.gates.find((gate) => gate.rule_id === 'metrics-reported')?.pass).toBe(true);
  });

  it('必报的没报全：口径之内但缺项，不算过', () => {
    const judged = judgeEvaluation(definitions, { trades: 12 }, []);
    expect(judged.state).toBe('rejected');
    expect(judged.missing).toEqual(['sharpe']);
    expect(judged.gates.find((gate) => gate.rule_id === 'metrics-reported')?.evidence).toContain('sharpe');
  });

  it('报了项目没定义的 key：口径被污染，点名拒掉', () => {
    const judged = judgeEvaluation(definitions, { sharpe: 1.93, win_rate: 0.5 }, []);
    expect(judged.state).toBe('rejected');
    expect(judged.unknown).toEqual(['win_rate']);
    expect(judged.gates.some((gate) => gate.evidence?.includes('win_rate'))).toBe(true);
  });

  it('自测有一条没过，指标再全也进不了榜单', () => {
    const judged = judgeEvaluation(definitions, { sharpe: 1.93 }, [
      { rule_id: 'canonical-byte-equal', pass: false, evidence: '两份 canonical 不一致' },
    ]);
    expect(judged.state).toBe('rejected');
  });

  it('自测里自带一条 metrics-reported 也压不过平台那一条', () => {
    const judged = judgeEvaluation(definitions, { trades: 1 }, [
      { rule_id: 'metrics-reported', pass: true, evidence: '我说过了' },
    ]);
    const gates = judged.gates.filter((gate) => gate.rule_id === 'metrics-reported');
    expect(gates).toHaveLength(1);
    expect(gates[0]!.pass).toBe(false);
    expect(judged.state).toBe('rejected');
  });
});
