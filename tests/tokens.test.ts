import { describe, expect, it } from 'vitest';
import { parseCapabilities, tokenStatus } from '../web/src/tokens-format';

describe('令牌状态', () => {
  const now = 1_700_000_000;

  it('吊销优先于一切', () => {
    expect(tokenStatus({ revoked_at: now - 10, expires_at: now + 1000 }, now)).toBe('revoked');
    expect(tokenStatus({ revoked_at: now - 10, expires_at: now - 1000 }, now)).toBe('revoked');
  });

  it('过了到期时间就是 expired，否则 live', () => {
    expect(tokenStatus({ revoked_at: null, expires_at: now - 1 }, now)).toBe('expired');
    expect(tokenStatus({ revoked_at: null, expires_at: now + 1 }, now)).toBe('live');
  });

  it('没有到期时间按长期有效，但吊销仍然生效', () => {
    expect(tokenStatus({ revoked_at: null, expires_at: null }, now)).toBe('live');
    expect(tokenStatus({ revoked_at: now, expires_at: null }, now)).toBe('revoked');
  });
});

describe('能力解析', () => {
  it('把 DB 里的逗号串拆成数组', () => {
    expect(parseCapabilities('read,write,verdict')).toEqual(['read', 'write', 'verdict']);
    expect(parseCapabilities('read, ,sota')).toEqual(['read', 'sota']);
  });

  it('数组原样保留并去掉空白', () => {
    expect(parseCapabilities(['read', ' sota '])).toEqual(['read', 'sota']);
    expect(parseCapabilities([])).toEqual([]);
  });

  it('空值给空数组', () => {
    expect(parseCapabilities(null)).toEqual([]);
    expect(parseCapabilities('')).toEqual([]);
  });
});
