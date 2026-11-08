import { describe, expect, it } from 'vitest';
import { CYBION_ISSUER, issuerOf } from '../src/auth';

/** 与 jose 一致：base64url，无 padding。 */
function segment(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(payload: unknown): string {
  return `${segment({ alg: 'EdDSA', kid: 'k1' })}.${segment(payload)}.c2ln`;
}

describe('按 issuer 分流', () => {
  it('认出 Cybion 签的 Thread 令牌', () => {
    expect(issuerOf(token({ iss: CYBION_ISSUER, sub: 'thread-1' }))).toBe(CYBION_ISSUER);
  });

  it('无 padding 的 base64url 也能读出来', () => {
    // 覆盖四种 padding 余数：atob 不接受缺 padding 的输入，补错了 Thread 令牌
    // 就会静默掉进 Auth Mini 分支。
    const lengths = ['a', 'ab', 'abc', 'abcd'].map((sub) => {
      const value = token({ iss: CYBION_ISSUER, sub });
      expect(issuerOf(value)).toBe(CYBION_ISSUER);
      return value.split('.')[1]!.length % 4;
    });
    expect(lengths.some((remainder) => remainder !== 0)).toBe(true);
  });

  it('别的 issuer 原样返回，交给 Auth Mini 那条路', () => {
    expect(issuerOf(token({ iss: 'https://auth.ntnl.io', sub: 'user-1' }))).toBe('https://auth.ntnl.io');
  });

  it('读不出来就是 null，不抛异常', () => {
    expect(issuerOf('garbage')).toBeNull();
    expect(issuerOf('a.!!!.c')).toBeNull();
    expect(issuerOf(`${segment({ alg: 'EdDSA' })}.${segment({ sub: 'no-issuer' })}.c2ln`)).toBeNull();
  });
});
