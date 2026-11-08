import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { createThread } from '../src/cybion';
import { cybionKeyFor, withCybionKey } from '../src/credentials';
import { seal } from '../src/sealed';

const SEALING_KEY = Buffer.alloc(32, 5).toString('base64');

interface Row {
  user_id: string;
  cybion_key_id: string;
  label: string;
  prefix: string;
  sealed: string;
  created_at: number;
}

/** 只认得 cybion_credentials 那张表的最小 D1 替身。 */
function fakeDB() {
  const rows = new Map<string, Row>();
  const db = {
    prepare(sql: string) {
      const execute = (args: unknown[]) => {
        if (sql.includes('FROM cybion_credentials')) return rows.get(String(args[0])) ?? null;
        if (sql.startsWith('INSERT INTO cybion_credentials')) {
          const [user_id, cybion_key_id, label, prefix, sealed, created_at] = args as [
            string,
            string,
            string,
            string,
            string,
            number,
          ];
          rows.set(user_id, { user_id, cybion_key_id, label, prefix, sealed, created_at });
          return null;
        }
        if (sql.startsWith('DELETE FROM cybion_credentials')) {
          rows.delete(String(args[0]));
          return null;
        }
        throw new Error(`替身不认识的 SQL：${sql}`);
      };
      return {
        bind: (...args: unknown[]) => ({
          first: async () => execute(args),
          run: async () => {
            execute(args);
            return { success: true };
          },
        }),
      };
    },
  };
  return { db: db as unknown as D1Database, rows };
}

function baseEnv(db: D1Database) {
  return { DB: db, CYBION_BASE_URL: 'https://cybion.test', CREDENTIALS_KEY: SEALING_KEY } as unknown as Env;
}

/** Auth Mini 的 access token：只解签名，不验签，所以随便拼一段就能用。 */
function jwt(audiences: string[]): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'u1', aud: audiences })}.sig`;
}

/** audience 用的是 CYBION_BASE_URL 的主机名：这里就是 cybion.test。 */
const LOGIN = jwt(['autolabs.ntnl.io', 'cybion.test']);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const MINTED = { id: 'key_new', label: 'AutoLabs', prefix: 'abc123', created_at: 1, last_used_at: null, secret: 'cyb_new' };

function stubFetch(handler: (url: string, init: RequestInit | undefined) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Cybion 凭据在后台静默维护', () => {
  it('存过就直接用，不再打扰 Cybion', async () => {
    const { db, rows } = fakeDB();
    const env = baseEnv(db);
    rows.set('u1', {
      user_id: 'u1',
      cybion_key_id: 'key_old',
      label: 'AutoLabs',
      prefix: 'old',
      sealed: await seal(env, 'cyb_stored'),
      created_at: 1,
    });
    const fetchSpy = stubFetch(() => json(MINTED));

    await expect(cybionKeyFor(env, 'u1', { userId: 'u1', jwt: LOGIN })).resolves.toBe('cyb_stored');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('第一次要用的时候用当次登录换一把，并且只存密文', async () => {
    const { db, rows } = fakeDB();
    const env = baseEnv(db);
    const fetchSpy = stubFetch(() => json(MINTED));

    await expect(cybionKeyFor(env, 'u1', { userId: 'u1', jwt: LOGIN })).resolves.toBe('cyb_new');

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://cybion.test/api/api-keys');
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${LOGIN}`);
    expect(rows.get('u1')?.cybion_key_id).toBe('key_new');
    expect(JSON.stringify(rows.get('u1'))).not.toContain('cyb_new');
  });

  it('没有登录 JWT（机器凭据）时不去换，回退服务级 key', async () => {
    const { db, rows } = fakeDB();
    const env = { ...baseEnv(db), CYBION_API_KEY: 'cyb_service' } as Env;
    const fetchSpy = stubFetch(() => json(MINTED));

    await expect(cybionKeyFor(env, 'u1', { userId: 'u1', jwt: 'alb_abc_secret' })).resolves.toBe('cyb_service');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it('登录没带 cybion audience 时不去换，回退服务级 key', async () => {
    const { db } = fakeDB();
    const env = { ...baseEnv(db), CYBION_API_KEY: 'cyb_service' } as Env;
    const fetchSpy = stubFetch(() => json(MINTED));

    await expect(cybionKeyFor(env, 'u1', { userId: 'u1', jwt: jwt(['autolabs.ntnl.io']) })).resolves.toBe('cyb_service');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('别人名下的 Thread 不替他换', async () => {
    const { db, rows } = fakeDB();
    const env = { ...baseEnv(db), CYBION_API_KEY: 'cyb_service' } as Env;
    const fetchSpy = stubFetch(() => json(MINTED));

    await expect(cybionKeyFor(env, 'u1', { userId: 'u2', jwt: LOGIN })).resolves.toBe('cyb_service');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it('key 被 Cybion 拒了就当场重换一把重来一次', async () => {
    const { db, rows } = fakeDB();
    const env = baseEnv(db);
    rows.set('u1', {
      user_id: 'u1',
      cybion_key_id: 'key_old',
      label: 'AutoLabs',
      prefix: 'old',
      sealed: await seal(env, 'cyb_revoked'),
      created_at: 1,
    });
    const seen: string[] = [];
    stubFetch((url, init) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      seen.push(`${init?.method} ${url} ${authorization}`);
      if (url.endsWith('/api/api-keys') && init?.method === 'POST') return json(MINTED);
      if (url.includes('/api/api-keys/') && init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (authorization === 'Bearer cyb_revoked') return json({ error: 'invalid API key' }, 401);
      return json({ id: 'thr_1', external_ref: 'autolabs:q-labs:lab-0001', title: 'lab-0001 · q-labs', status: 'idle' });
    });

    const thread = await withCybionKey(env, 'u1', { userId: 'u1', jwt: LOGIN }, (apiKey) =>
      createThread(env, apiKey, { externalRef: 'autolabs:q-labs:lab-0001', title: 'lab-0001 · q-labs' }),
    );

    expect(thread.id).toBe('thr_1');
    expect(rows.get('u1')?.cybion_key_id).toBe('key_new');
    expect(seen.filter((line) => line.includes('cyb_revoked'))).toHaveLength(1);
    expect(seen.filter((line) => line.includes('Bearer cyb_new'))).toHaveLength(1);
  });

  it('不是「key 不认了」的错误照样抛出去，不重换', async () => {
    const { db, rows } = fakeDB();
    const env = baseEnv(db);
    rows.set('u1', {
      user_id: 'u1',
      cybion_key_id: 'key_old',
      label: 'AutoLabs',
      prefix: 'old',
      sealed: await seal(env, 'cyb_stored'),
      created_at: 1,
    });
    const fetchSpy = stubFetch(() => json({ error: 'boom' }, 500));

    await expect(
      withCybionKey(env, 'u1', { userId: 'u1', jwt: LOGIN }, (apiKey) =>
        createThread(env, apiKey, { externalRef: 'x', title: 'y' }),
      ),
    ).rejects.toThrow(/500：boom/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('后台换不到 key 时退回服务级 key，别把这一轮堵死', async () => {
    const { db, rows } = fakeDB();
    const env = { ...baseEnv(db), CYBION_API_KEY: 'cyb_service' } as Env;
    stubFetch((url, init) =>
      url.endsWith('/api/api-keys') && init?.method === 'POST'
        ? json({ error: 'mint failed' }, 500)
        : json({ id: 'thr_9', external_ref: 'x', title: 'y', status: 'idle' }),
    );

    const thread = await withCybionKey(env, 'u1', { userId: 'u1', jwt: LOGIN }, (apiKey) =>
      createThread(env, apiKey, { externalRef: 'x', title: 'y' }),
    );

    expect(thread.id).toBe('thr_9');
    expect(rows.size).toBe(0);
  });

  it('一条路都走不通时才报错，并且说清楚缺什么', async () => {
    const { db } = fakeDB();
    const env = baseEnv(db);
    stubFetch(() => json(MINTED));

    await expect(cybionKeyFor(env, 'u1', { userId: 'u1', jwt: null })).rejects.toThrow(/CYBION_API_KEY/);
  });
});
