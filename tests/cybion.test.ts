import { afterEach, describe, expect, it, vi } from 'vitest';
import { CybionError, createThread, mintApiKey, revokeApiKey, sendInput } from '../src/cybion';
import type { Env } from '../src/env';

const env = {
  CYBION_BASE_URL: 'https://cybion.test',
  CYBION_API_KEY: 'cyb_user_secret',
} as unknown as Env;

function stubFetch(response: Response) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Cybion 外部集成面', () => {
  it('开 Thread 只发 title 与 external_ref，模型交给 Cybion 自己的默认值', async () => {
    const spy = stubFetch(
      new Response(JSON.stringify({ id: 'thr_1', external_ref: 'autolabs:q-labs:lab-0083', status: 'idle' }), {
        status: 200,
      }),
    );

    const thread = await createThread(env, 'cyb_user_secret', { externalRef: 'autolabs:q-labs:lab-0083', title: 'lab-0083 · q-labs' });

    expect(thread.id).toBe('thr_1');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://cybion.test/v1/threads');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer cyb_user_secret');
    expect(JSON.parse(init!.body as string)).toEqual({
      title: 'lab-0083 · q-labs',
      external_ref: 'autolabs:q-labs:lab-0083',
    });
  });

  it('项目指定了模型就带上，没指定就不带（交给 Cybion 默认）', async () => {
    const spy = stubFetch(new Response(JSON.stringify({ id: 'thr_1' }), { status: 200 }));
    await createThread(env, 'k', { externalRef: 'r', title: 't', model: 'deepseek-flash' });
    expect(JSON.parse(spy.mock.calls[0]![1]!.body as string)).toEqual({ title: 't', external_ref: 'r', model: 'deepseek-flash' });

    await createThread(env, 'k', { externalRef: 'r', title: 't', model: null });
    expect(JSON.parse(spy.mock.calls[1]![1]!.body as string)).toEqual({ title: 't', external_ref: 'r' });
  });

  it('首条输入走 /v1/threads/{id}/inputs', async () => {
    const spy = stubFetch(new Response(JSON.stringify({ thread_id: 'thr_1', record_idx: 3, status: 'queued' }), { status: 200 }));

    await sendInput(env, 'cyb_user_secret', 'thr_1', '# lab-0001');

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://cybion.test/v1/threads/thr_1/inputs');
    expect(JSON.parse(init!.body as string)).toEqual({ input: '# lab-0001' });
  });

  it('没配地址时说清楚缺什么，不去打网络', async () => {
    const spy = stubFetch(new Response('{}', { status: 200 }));
    await expect(createThread({} as Env, 'k', { externalRef: 'x', title: 'y' })).rejects.toBeInstanceOf(CybionError);
    await expect(createThread({} as Env, 'k', { externalRef: 'x', title: 'y' })).rejects.toThrow(/CYBION_BASE_URL/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('把 Cybion 的错误原文带出来，不吞成「失败」两个字', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'invalid API key' }), { status: 401 }));
    await expect(sendInput(env, 'k', 'thr_1', 'hi')).rejects.toThrow(/401：invalid API key/);
  });

  it('错误上带着状态码：调用方要靠它认出「这把 key 不认了」', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'invalid API key' }), { status: 401 }));
    await expect(sendInput(env, 'k', 'thr_1', 'hi')).rejects.toMatchObject({ status: 401 });
  });
});

describe('用 JWT 换 Cybion 凭据', () => {
  it('拿当前登录的 JWT 打 /api/api-keys，key 明文只在这一次返回', async () => {
    const spy = stubFetch(
      new Response(JSON.stringify({ id: 'key_1', label: 'AutoLabs', prefix: '0afada0f04', created_at: 1, last_used_at: null, secret: 'cyb_u_secret' }), {
        status: 200,
      }),
    );

    const minted = await mintApiKey(env, 'jwt-with-cybion-audience', 'AutoLabs');

    expect(minted.secret).toBe('cyb_u_secret');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://cybion.test/api/api-keys');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer jwt-with-cybion-audience');
    expect(JSON.parse(init!.body as string)).toEqual({ label: 'AutoLabs' });
  });

  it('吊销旧 key 走 DELETE /api/api-keys/{id}', async () => {
    const spy = stubFetch(new Response(null, { status: 204 }));
    await revokeApiKey(env, 'jwt', 'key_1');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://cybion.test/api/api-keys/key_1');
    expect(init!.method).toBe('DELETE');
  });
});
