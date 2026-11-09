import type { Env } from './env';
import { nowSeconds } from './ids';
import {
  addressOf,
  buildCall,
  isAddress,
  openResult,
  requestHeaders,
  type CallEnvelope,
  type Identity,
  type ResultEnvelope,
} from './exe-protocol';

/**
 * eXe 的调用方（caller）。
 *
 * AutoLabs 只做两件事：把一条命令封给某台设备，和把设备回传的结果解开。
 * 中间的中继读不到命令，也读不到结果——它只搬信封。设备那边验的是签名，
 * 所以「这台机器认不认 AutoLabs」这件事，答案在设备的 trust 文件里，
 * 不在这边的数据库里。
 */

export function exeBase(env: Env): string {
  return (env.EXE_BASE_URL ?? 'https://exe.ntnl.io').replace(/\/+$/, '');
}

interface SignedResponse {
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}

/** 一次自签名请求：地址即身份，没有账号也没有要换的 token。 */
async function signed(env: Env, caller: Identity, path: string, init: RequestInit = {}): Promise<SignedResponse> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(requestHeaders(caller, method, path))) headers.set(key, value);
  const response = await fetch(`${exeBase(env)}${path}`, { ...init, method, headers });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 不是 JSON 就只留原文。
  }
  return { status: response.status, text, json };
}

export interface ExeDeviceStatus {
  address: string;
  registered: boolean;
  platform: string | null;
  version: string | null;
  online: boolean;
  last_seen_at: number | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 只问中继「这台设备注册过没有、在线没有」，不涉及信任关系。 */
export async function readDeviceStatus(env: Env, caller: Identity, address: string): Promise<ExeDeviceStatus | null> {
  const response = await signed(env, caller, `/api/devices/${address}`);
  if (response.status !== 200 || !response.json) return null;
  return {
    address,
    registered: response.json.registered === true,
    platform: str(response.json.platform),
    version: str(response.json.version),
    online: response.json.online === true,
    last_seen_at: num(response.json.last_seen_at),
  };
}

export interface ShellCall {
  call: CallEnvelope;
  rejected: null | { status: number; message: string };
}

/** 封一条 shell 命令给设备。返回的信封要留着——解结果时要用它绑定。 */
export async function dispatchShell(
  env: Env,
  caller: Identity,
  device: string,
  command: string,
  options: { timeoutSeconds: number; ttlSeconds?: number },
): Promise<ShellCall> {
  const issuedAt = nowSeconds();
  const ttl = Math.min(Math.max(options.ttlSeconds ?? 300, 30), 3600);
  const call = buildCall({
    seed: caller.seed,
    caller: addressOf(caller),
    device,
    callId: crypto.randomUUID(),
    name: 'shell',
    args: JSON.stringify({ command, timeout_seconds: options.timeoutSeconds }),
    issuedAt,
    expiresAt: issuedAt + ttl,
  });
  const created = await signed(env, caller, `/api/devices/${device}/calls`, {
    method: 'POST',
    body: JSON.stringify(call),
    headers: { 'content-type': 'application/json' },
  });
  if (created.status !== 200) return { call, rejected: { status: created.status, message: created.text.slice(0, 300) } };
  return { call, rejected: null };
}

export interface ShellOutcome {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface RawResult {
  ok?: boolean;
  output?: { exit_code?: number; stdout?: string; stderr?: string };
}

/** 读一次结果；还没结算就返回 null。 */
export async function readOutcome(
  env: Env,
  caller: Identity,
  call: Pick<CallEnvelope, 'call_id' | 'caller' | 'device' | 'expires_at'>,
): Promise<ShellOutcome | null> {
  const read = await signed(env, caller, `/api/calls/${call.call_id}`);
  if (read.status !== 200 || !read.json) return null;
  const result = read.json.result as ResultEnvelope | null;
  if (!result) return null;
  let parsed: RawResult;
  try {
    parsed = JSON.parse(openResult({ seed: caller.seed, call, result })) as RawResult;
  } catch {
    return { ok: false, exitCode: null, stdout: '', stderr: '结果解不开：信封与调用对不上' };
  }
  const exitCode = typeof parsed.output?.exit_code === 'number' ? parsed.output.exit_code : null;
  return {
    ok: parsed.ok === true && exitCode === 0,
    exitCode,
    stdout: parsed.output?.stdout ?? '',
    stderr: parsed.output?.stderr ?? '',
  };
}

/** 取走就该删掉：中继不做档案库，留档是调用方自己的事。 */
export async function ackCall(env: Env, caller: Identity, callId: string): Promise<void> {
  await signed(env, caller, `/api/calls/${callId}/ack`, { method: 'POST' });
}

export type ProbeReason = 'ok' | 'bad-address' | 'unregistered' | 'offline' | 'not-trusted' | 'timeout' | 'failed';

export interface ProbeResult {
  ok: boolean;
  reason: ProbeReason;
  message: string;
  status: ExeDeviceStatus | null;
}

const PROBE_COMMAND = 'true';
const PROBE_ATTEMPTS = 8;
const PROBE_INTERVAL_MS = 700;

/**
 * 探活：发一条 `true`，看它能不能回来。
 *
 * 信任没配好有两种表现，分开说才有用：
 * - 中继手上那份 trust 副本里没有这个地址 → 建调用当场 403，最快；
 * - 副本还没刷新，或者设备离线 → 排队到过期，一声不响。
 * 所以探活要等到超时才算「说不清」，不能一发出就报好。
 */
export async function probeDevice(env: Env, caller: Identity, device: string): Promise<ProbeResult> {
  if (!isAddress(device)) return { ok: false, reason: 'bad-address', message: '这不像一个 eXe 地址', status: null };
  const status = await readDeviceStatus(env, caller, device);
  if (!status?.registered) {
    return { ok: false, reason: 'unregistered', message: 'eXe 上没有这台设备：先在这台机器上把 eXe 跑起来', status };
  }
  if (!status.online) {
    return { ok: false, reason: 'offline', message: '设备注册过，但当前不在线', status };
  }

  const dispatched = await dispatchShell(env, caller, device, PROBE_COMMAND, { timeoutSeconds: 5, ttlSeconds: 60 });
  if (dispatched.rejected) {
    const denied = dispatched.rejected.status === 403;
    return {
      ok: false,
      reason: denied ? 'not-trusted' : 'failed',
      message: denied
        ? '设备还没有信任这个地址：把上面那串地址加进这台设备的 trust'
        : `eXe 拒绝了这次调用（${dispatched.rejected.status}）：${dispatched.rejected.message}`,
      status,
    };
  }

  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
    const outcome = await readOutcome(env, caller, dispatched.call);
    if (!outcome) continue;
    await ackCall(env, caller, dispatched.call.call_id);
    if (!outcome.ok) {
      return { ok: false, reason: 'failed', message: `设备执行了，但退出码是 ${outcome.exitCode}：${outcome.stderr.slice(0, 200)}`, status };
    }
    return { ok: true, reason: 'ok', message: '设备收到并执行了探活命令', status };
  }
  return {
    ok: false,
    reason: 'timeout',
    message: '调用排队了，但一直没有回音：设备可能不信任这个地址，也可能刚下线',
    status,
  };
}
