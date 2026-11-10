import { describe, expect, it } from 'vitest';
import { parseLabManifest } from '../src/lab-manifest';

describe('lab.json', () => {
  it('最短的一份：只写一条命令', () => {
    expect(parseLabManifest('{"evaluate":"python -m pack.evaluate"}')).toEqual({
      kind: 'ok',
      manifest: { command: 'python -m pack.evaluate', timeoutSeconds: null },
    });
  });

  it('想自己定超时也行，但被夹在一小时以内', () => {
    const ok = parseLabManifest('{"evaluate":{"command":"make eval","timeout_seconds":1800}}');
    expect(ok).toEqual({ kind: 'ok', manifest: { command: 'make eval', timeoutSeconds: 1800 } });
    const tooLong = parseLabManifest('{"evaluate":{"command":"make eval","timeout_seconds":99999}}');
    expect(tooLong.kind === 'ok' && tooLong.manifest.timeoutSeconds).toBe(3600);
    const tooShort = parseLabManifest('{"evaluate":{"command":"make eval","timeout_seconds":1}}');
    expect(tooShort.kind === 'ok' && tooShort.manifest.timeoutSeconds).toBe(60);
  });

  it('不是 JSON、不是对象、缺 evaluate，各自说清楚', () => {
    expect(parseLabManifest('nope')).toEqual({ kind: 'invalid', message: expect.stringContaining('合法 JSON') });
    expect(parseLabManifest('[]')).toEqual({ kind: 'invalid', message: expect.stringContaining('顶层') });
    expect(parseLabManifest('{}')).toEqual({ kind: 'invalid', message: expect.stringContaining('evaluate') });
  });

  it('evaluate 是空串或者乱七八糟的东西，不当作能用', () => {
    expect(parseLabManifest('{"evaluate":"   "}').kind).toBe('invalid');
    expect(parseLabManifest('{"evaluate":{"timeout_seconds":60}}').kind).toBe('invalid');
    expect(parseLabManifest('{"evaluate":{"command":"x","timeout_seconds":"60"}}').kind).toBe('invalid');
  });
});
