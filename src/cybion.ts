import type { Env } from './env';

/**
 * Cybion 的外部集成面。
 *
 * 浏览器会话走 `/api/threads`（Auth Mini 的 Bearer token），外部集成走
 * `/v1/threads`（Cybion 自己的 API key `cyb_<user_id>_<secret>`）。AutoLabs
 * 是后者：服务端拿一把 key 代表这个用户开 Thread。
 *
 * 开 Thread 本身不会开始跑——执行要等第一条 input 入队。所以「发出一轮实验」
 * 一定是两步都成功，只建了 Thread 什么都不算。
 */

/** 只在这里把传输层失败翻译成人能读的话；怎么处理由调用方决定。 */
export class CybionError extends Error {}

function credentials(env: Env): { base: string; key: string } {
  if (!env.CYBION_BASE_URL) throw new CybionError('没有配置 CYBION_BASE_URL，无法联系 Cybion');
  if (!env.CYBION_API_KEY) throw new CybionError('没有配置 CYBION_API_KEY（wrangler secret put CYBION_API_KEY）');
  return { base: env.CYBION_BASE_URL, key: env.CYBION_API_KEY };
}

async function call<T>(env: Env, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { base, key } = credentials(env);
  let response: Response;
  try {
    response = await fetch(new URL(path, base), {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    throw new CybionError(`Cybion 返回 ${response.status}${reason ? `：${reason}` : ''}`);
  }
  return parsed as T;
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
export async function createThread(env: Env, input: { externalRef: string; title: string }): Promise<CybionThread> {
  return call<CybionThread>(env, 'POST', '/v1/threads', {
    title: input.title,
    external_ref: input.externalRef,
  });
}

export interface CybionRequest {
  thread_id: string;
  record_idx: number;
  status: string;
}

/** 发第一条输入：Thread 从这一步才真正开始跑。 */
export async function sendInput(env: Env, threadId: string, input: string): Promise<CybionRequest> {
  return call<CybionRequest>(env, 'POST', `/v1/threads/${encodeURIComponent(threadId)}/inputs`, { input });
}
