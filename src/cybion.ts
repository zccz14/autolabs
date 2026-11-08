import type { Env } from './env';
import type { ThreadResponse } from './ideas';

/**
 * Cybion 的两套入口，正好对应两种身份：
 *
 * - `/api/*`：浏览器身份，验 Auth Mini 签发的 JWT（audience 必须是 cybion.ntnl.io）。
 *   只用来做一件事——拿一把长寿命 API key 换掉会过期的 JWT。
 * - `/v1/*`：集成身份，只认 Cybion 自己的 API key（`cyb_<user_id>_<secret>`）。
 *   AutoLabs 跑实验时用的始终是这一套，JWT 不再出现在链路上。
 *
 * 开 Thread 本身不会开始跑——执行要等第一条 input 入队。所以「发出一轮实验」
 * 一定是两步都成功，只建了 Thread 什么都不算。
 */

/** 只在这里把传输层失败翻译成人能读的话；怎么处理由调用方决定。 */
export class CybionError extends Error {
  /** Cybion 的 HTTP 状态码；连不上的时候没有。调用方靠它分辨「这把 key 不认了」。 */
  status?: number;
}

function baseUrl(env: Env): string {
  if (!env.CYBION_BASE_URL) throw new CybionError('没有配置 CYBION_BASE_URL，无法联系 Cybion');
  return env.CYBION_BASE_URL;
}

interface CallOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  /** 直接放进 Authorization 的凭据：`Bearer <jwt>` 或 `Bearer cyb_…`。 */
  authorization: string;
  body?: unknown;
}

async function call<T>(env: Env, options: CallOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(options.path, baseUrl(env)), {
      method: options.method,
      headers: {
        Authorization: options.authorization,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new CybionError(`连不上 Cybion：${(error as Error).message}`);
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const detail = parsed as { error?: string; message?: string } | null;
    const reason = detail?.message ?? detail?.error ?? text.slice(0, 200) ?? '';
    const error = new CybionError(`Cybion 返回 ${response.status}${reason ? `：${reason}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return parsed as T;
}

export interface CybionApiKey {
  id: string;
  label: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
}

export interface CreatedCybionApiKey extends CybionApiKey {
  /** 只在这一刻返回一次；AutoLabs 密封存下来之后再不展示。 */
  secret: string;
}

/**
 * 用当前登录的 JWT 换一把长寿命 API key。
 * 这是整条链路上唯一一次用到 JWT——换完就只认 key。
 */
export async function mintApiKey(env: Env, jwt: string, label: string): Promise<CreatedCybionApiKey> {
  return call<CreatedCybionApiKey>(env, {
    method: 'POST',
    path: '/api/api-keys',
    authorization: `Bearer ${jwt}`,
    body: { label },
  });
}

export async function revokeApiKey(env: Env, jwt: string, keyId: string): Promise<void> {
  await call<null>(env, {
    method: 'DELETE',
    path: `/api/api-keys/${encodeURIComponent(keyId)}`,
    authorization: `Bearer ${jwt}`,
  });
}

export interface CybionThread {
  id: string;
  external_ref: string | null;
  title: string;
  model: string;
  reasoning_effort: string;
  service_tier_fast: boolean;
  status: string;
}

/**
 * 开一个 Thread。模型、上游、推理档位都不传：Cybion 会用这个用户自己的默认值，
 * 与他在界面里新开一个 Thread 得到的东西一致。external_ref 是给人看的集成标记，
 * Cybion 不拿它去重。
 */
export async function createThread(
  env: Env,
  apiKey: string,
  input: { externalRef: string; title: string; model?: string | null },
): Promise<CybionThread> {
  return call<CybionThread>(env, {
    method: 'POST',
    path: '/v1/threads',
    authorization: `Bearer ${apiKey}`,
    // model 不传就用这个人在 Cybion 里的默认值。
    body: { title: input.title, external_ref: input.externalRef, ...(input.model ? { model: input.model } : {}) },
  });
}

/** 读这条 Thread 对「最近一条输入」的回复；还没开始回就是 null。 */
export async function readThreadResponse(env: Env, apiKey: string, threadId: string): Promise<ThreadResponse | null> {
  return call<ThreadResponse | null>(env, {
    method: 'GET',
    path: `/v1/threads/${encodeURIComponent(threadId)}/response`,
    authorization: `Bearer ${apiKey}`,
  });
}

export interface CybionRequest {
  thread_id: string;
  record_idx: number;
  status: string;
}

/** 发第一条输入：Thread 从这一步才真正开始跑。 */
export async function sendInput(env: Env, apiKey: string, threadId: string, input: string): Promise<CybionRequest> {
  return call<CybionRequest>(env, {
    method: 'POST',
    path: `/v1/threads/${encodeURIComponent(threadId)}/inputs`,
    authorization: `Bearer ${apiKey}`,
    body: { input },
  });
}
