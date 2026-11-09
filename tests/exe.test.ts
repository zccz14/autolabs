import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { seal, unseal } from '../src/sealed';
import { addressOf, buildCall, buildResult, newIdentity, openCall, openResult, type CallEnvelope } from '../src/exe-protocol';
import { probeDevice } from '../src/exe';

const env = { EXE_BASE_URL: 'https://exe.test' } as unknown as Env;
const caller = newIdentity();
const device = newIdentity();
const deviceAddress = addressOf(device);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('eXe 信封', () => {
  it('设备解得出命令，调用方解得出结果', () => {
    const call = buildCall({
      seed: caller.seed,
      caller: addressOf(caller),
      device: deviceAddress,
      callId: 'call-0001',
      name: 'shell',
      args: JSON.stringify({ command: 'true', timeout_seconds: 5 }),
      issuedAt: 1_000,
      expiresAt: 2_000,
    });
    expect(openCall({ seed: device.seed, call })).toEqual({
      name: 'shell',
      args: JSON.stringify({ command: 'true', timeout_seconds: 5 }),
    });
    const result = buildResult({
      seed: device.seed,
      call,
      ok: true,
      plaintext: JSON.stringify({ ok: true, output: { exit_code: 0, stdout: 'hi\n', stderr: '' } }),
      issuedAt: 1_001,
    });
    expect((JSON.parse(openResult({ seed: caller.seed, call, result })) as { output: { stdout: string } }).output.stdout).toBe('hi\n');
  });

  it('eXe 身份的密文搬不到 Cybion 凭据上', async () => {
    const keyEnv = { CREDENTIALS_KEY: Buffer.alloc(32, 3).toString('base64') } as unknown as Env;
    const sealed = await seal(keyEnv, 'some-seed', 'exe-identity');
    await expect(unseal(keyEnv, sealed)).rejects.toBeTruthy();
    expect(await unseal(keyEnv, sealed, 'exe-identity')).toBe('some-seed');
  });
});

describe('探活判定', () => {
  it('设备没注册过：直接说清楚', async () => {
    stubFetch(() => json({ address: deviceAddress, registered: false }));
    const probe = await probeDevice(env, caller, deviceAddress);
    expect(probe.reason).toBe('unregistered');
    expect(probe.ok).toBe(false);
  });

  it('注册过但离线：不白等', async () => {
    stubFetch(() => json({ address: deviceAddress, registered: true, online: false }));
    const probe = await probeDevice(env, caller, deviceAddress);
    expect(probe.reason).toBe('offline');
  });

  it('设备不信任这个地址：中继当场 403，翻成人话', async () => {
    stubFetch((url, init) => {
      if (init?.method === 'POST') return json({ error: 'the relay will not queue this call' }, 403);
      return json({ address: deviceAddress, registered: true, online: true });
    });
    const probe = await probeDevice(env, caller, deviceAddress);
    expect(probe.reason).toBe('not-trusted');
    expect(probe.message).toMatch(/trust/);
  });

  it('信任配好了：命令回得来就算通', async () => {
    let posted: CallEnvelope | null = null;
    stubFetch((url, init) => {
      if (url.endsWith('/ack')) return json({ ok: true });
      if (url.includes('/api/calls/')) {
        const result = buildResult({
          seed: device.seed,
          call: posted!,
          ok: true,
          plaintext: JSON.stringify({ ok: true, output: { exit_code: 0, stdout: '', stderr: '' } }),
          issuedAt: posted!.issued_at + 1,
        });
        return json({ call: {}, result });
      }
      if (init?.method === 'POST') {
        posted = JSON.parse(String(init.body)) as CallEnvelope;
        return json({ call: { call_id: posted.call_id } });
      }
      return json({ address: deviceAddress, registered: true, online: true });
    });

    const probe = await probeDevice(env, caller, deviceAddress);
    expect(probe.reason).toBe('ok');
    expect(probe.ok).toBe(true);
    expect(openCall({ seed: device.seed, call: posted! }).name).toBe('shell');
  });
});
