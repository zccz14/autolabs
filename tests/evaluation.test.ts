import { describe, expect, it } from 'vitest';
import { buildEvalCommand, parseMetrics, shellQuote } from '../src/evaluation';

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
    const built = buildEvalCommand(command);
    expect(built.endsWith(' python -m harness.evaluate')).toBe(true);
    expect(built).toContain("AUTOLABS_SNAPSHOT_URL='https://autolabs.ntnl.io/api/v1/snapshots/snp_1/tar.gz'");
    expect(built).toContain("AUTOLABS_TOKEN='alb_tok_secret'");
    expect(built).toContain("AUTOLABS_DATASET='okx-btc-usdt-perp-1m@deadbeef'");
    // 口径也一起下发：评估器要按项目定义的那几个 key 说话。
    expect(built).toContain('"key":"sharpe"');
    expect(built).toContain('"version":2');
  });

  it('值里有单引号也不会把命令拼歪', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    const built = buildEvalCommand({ ...command, dataset: "a'b" });
    expect(built).toContain(`AUTOLABS_DATASET='a'\\''b'`);
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
