import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { seal, unseal } from '../src/sealed';

const env = { CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64') } as unknown as Env;

describe('凭据密封', () => {
  it('存进去再读回来是同一把 key', async () => {
    const sealed = await seal(env, 'cyb_user_secret');
    expect(sealed).not.toContain('cyb_user_secret');
    expect(await unseal(env, sealed)).toBe('cyb_user_secret');
  });

  it('每次的密文都不一样（IV 随机）', async () => {
    expect(await seal(env, 'same')).not.toBe(await seal(env, 'same'));
  });

  it('换一把密钥就解不开', async () => {
    const sealed = await seal(env, 'cyb_user_secret');
    const other = { CREDENTIALS_KEY: Buffer.alloc(32, 9).toString('base64') } as unknown as Env;
    await expect(unseal(other, sealed)).rejects.toBeTruthy();
  });

  it('密文被改过就解不开', async () => {
    const sealed = await seal(env, 'cyb_user_secret');
    const bytes = Buffer.from(sealed, 'base64');
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    await expect(unseal(env, bytes.toString('base64'))).rejects.toBeTruthy();
  });

  it('没配密钥时直接说清楚缺什么', async () => {
    await expect(seal({} as Env, 'x')).rejects.toThrow(/CREDENTIALS_KEY/);
  });
});
