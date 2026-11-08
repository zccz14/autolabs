import { afterEach, describe, expect, it, vi } from 'vitest';
import { CybionError, createThread, sendInput } from '../src/cybion';
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

    const thread = await createThread(env, { externalRef: 'autolabs:q-labs:lab-0083', title: 'lab-0083 · q-labs' });

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

  it('首条输入走 /v1/threads/{id}/inputs', async () => {
    const spy = stubFetch(new Response(JSON.stringify({ thread_id: 'thr_1', record_idx: 3, status: 'queued' }), { status: 200 }));

    await sendInput(env, 'thr_1', '# lab-0001');

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://cybion.test/v1/threads/thr_1/inputs');
    expect(JSON.parse(init!.body as string)).toEqual({ input: '# lab-0001' });
  });

  it('没配地址或 key 时说清楚缺什么，不去打网络', async () => {
    const spy = stubFetch(new Response('{}', { status: 200 }));
    await expect(createThread({} as Env, { externalRef: 'x', title: 'y' })).rejects.toBeInstanceOf(CybionError);
    await expect(createThread({} as Env, { externalRef: 'x', title: 'y' })).rejects.toThrow(/CYBION_BASE_URL/);
    await expect(createThread({ CYBION_BASE_URL: 'https://cybion.test' } as Env, { externalRef: 'x', title: 'y' })).rejects.toThrow(
      /CYBION_API_KEY/,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('把 Cybion 的错误原文带出来，不吞成「失败」两个字', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'invalid API key' }), { status: 401 }));
    await expect(sendInput(env, 'thr_1', 'hi')).rejects.toThrow(/401：invalid API key/);
  });
});
