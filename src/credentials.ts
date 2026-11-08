import { decodeJwt } from 'jose';
import type { Env } from './env';
import { bearerOf } from './auth';
import { CybionError, mintApiKey, revokeApiKey } from './cybion';
import { nowSeconds } from './ids';
import { seal, unseal } from './sealed';

/**
 * 每个人在 Cybion 上的长寿命 API key——AutoLabs 自己在后台维护，界面上没有它。
 *
 * 为什么还得按人存一把：Thread 建在谁名下，就只有谁的 key 读得回来；这一轮跑在
 * 谁的账号下也才追得住。但 JWT 一小时就过期，一轮实验可能跑几天，所以运行链路
 * 只认长寿命的 key。
 *
 * 换 key 的时机就是第一次真正要用它那一刻：请求里本来就带着这个人的登录 JWT，
 * 后台顺手换一把存下来。用户不需要知道这件事，也没有「换一把 / 吊销」这种按钮。
 *
 * 换不到的路径（机器凭据上报、别人名下的 Thread）回退到 Worker 里的服务级
 * `CYBION_API_KEY`，部署层面的链路不会因为没人登录过就断掉。
 */

const LABEL = 'AutoLabs';

export interface CredentialRow {
  user_id: string;
  cybion_key_id: string;
  label: string;
  prefix: string;
  sealed: string;
  created_at: number;
}

/** 这次请求能证明的身份：为谁干活，以及手上有没有那个人的登录 JWT。 */
export interface Caller {
  userId: string;
  /** Auth Mini 签发的 access token；机器凭据（`alb_…`）与 Thread 令牌都为 null。 */
  jwt: string | null;
}

/** 把一次请求里的身份翻译成 Caller：机器凭据与 Thread 都没有登录 JWT，也就换不了 key。 */
export function callerOf(
  request: Request,
  principal: { kind: 'user' | 'token' | 'thread'; userId: string },
): Caller {
  return { userId: principal.userId, jwt: principal.kind === 'user' ? bearerOf(request) : null };
}

export async function readCredential(env: Env, userId: string): Promise<CredentialRow | null> {
  return env.DB.prepare(
    `SELECT user_id, cybion_key_id, label, prefix, sealed, created_at FROM cybion_credentials WHERE user_id = ?`,
  )
    .bind(userId)
    .first<CredentialRow>();
}

export async function saveCredential(
  env: Env,
  userId: string,
  input: { cybionKeyId: string; label: string; prefix: string; secret: string },
): Promise<void> {
  const sealed = await seal(env, input.secret);
  await env.DB.prepare(
    `INSERT INTO cybion_credentials (user_id, cybion_key_id, label, prefix, sealed, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       cybion_key_id = excluded.cybion_key_id,
       label = excluded.label,
       prefix = excluded.prefix,
       sealed = excluded.sealed,
       created_at = excluded.created_at`,
  )
    .bind(userId, input.cybionKeyId, input.label, input.prefix, sealed, nowSeconds())
    .run();
}

export async function dropCredential(env: Env, userId: string): Promise<CredentialRow | null> {
  const row = await readCredential(env, userId);
  if (!row) return null;
  await env.DB.prepare(`DELETE FROM cybion_credentials WHERE user_id = ?`).bind(userId).run();
  return row;
}

/** Cybion 认的 audience 就是它自己的主机名。 */
function cybionAudience(env: Env): string {
  try {
    return env.CYBION_BASE_URL ? new URL(env.CYBION_BASE_URL).hostname : 'cybion.ntnl.io';
  } catch {
    return 'cybion.ntnl.io';
  }
}

/**
 * 这张 JWT 现在能不能用来给 ownerId 换一把 key。
 *
 * 三条都得满足：是本人的请求（key 落在本人名下）、换得到（audience 里有 Cybion）、
 * 存得下来（有 CREDENTIALS_KEY，否则换一把丢一把，Cybion 那边会积一堆没人认领的 key）。
 */
function mintJwt(env: Env, ownerId: string, caller: Caller): string | null {
  if (caller.userId !== ownerId) return null;
  if (!env.CREDENTIALS_KEY) return null;
  const raw = caller.jwt;
  if (!raw || raw.startsWith('alb_')) return null;
  try {
    const claim = decodeJwt(raw).aud;
    const audiences = Array.isArray(claim) ? claim : claim ? [claim] : [];
    if (!audiences.includes(cybionAudience(env))) return null;
  } catch {
    return null;
  }
  return raw;
}

/** 换一把新的、存下来，顺手把上一把在 Cybion 上吊销掉。 */
async function mintAndStore(env: Env, ownerId: string, jwt: string, previous: CredentialRow | null): Promise<string> {
  const minted = await mintApiKey(env, jwt, LABEL);
  await saveCredential(env, ownerId, {
    cybionKeyId: minted.id,
    label: minted.label,
    prefix: minted.prefix,
    secret: minted.secret,
  });
  if (previous && previous.cybion_key_id !== minted.id) {
    try {
      await revokeApiKey(env, jwt, previous.cybion_key_id);
    } catch (error) {
      // 旧 key 已经失效时吊销会失败：这不影响新的那一把已经生效。
      console.warn('旧 Cybion key 吊销失败', (error as Error).message);
    }
  }
  return minted.secret;
}

/**
 * 这一刻该用哪把 key：存过就用存的，没存过就趁请求里的登录还热乎顺手换一把，
 * 换不到才回退服务级 key。
 */
export async function cybionKeyFor(env: Env, ownerId: string, caller: Caller): Promise<string> {
  const row = await readCredential(env, ownerId);
  if (row) return unseal(env, row.sealed);
  const jwt = mintJwt(env, ownerId, caller);
  if (jwt) {
    try {
      return await mintAndStore(env, ownerId, jwt, null);
    } catch (error) {
      // 换不到不是这一轮的错，别把这条路堵死：服务级 key 还在就继续走。
      console.warn('后台换 Cybion 凭据失败', (error as Error).message);
    }
  }
  if (env.CYBION_API_KEY) return env.CYBION_API_KEY;
  throw new CybionError('没有可用的 Cybion 凭据：请用登录身份重新进入 AutoLabs，或给 Worker 配 CYBION_API_KEY');
}

/**
 * 用 ownerId 名下的 key 做一件事。
 *
 * key 可能在别处被吊销、或者 Cybion 那边轮换了：这时候用户看到的只该是一轮照常
 * 开跑的实验，所以当场再换一把、重来一次，而不是把 401 甩给人。
 */
export async function withCybionKey<T>(
  env: Env,
  ownerId: string,
  caller: Caller,
  use: (apiKey: string) => Promise<T>,
): Promise<T> {
  const apiKey = await cybionKeyFor(env, ownerId, caller);
  try {
    return await use(apiKey);
  } catch (error) {
    const jwt = mintJwt(env, ownerId, caller);
    if (!jwt || !(error instanceof CybionError) || error.status !== 401) throw error;
    console.warn('Cybion 不认这把 key 了，后台重换一把', error.message);
    const previous = await dropCredential(env, ownerId);
    const fresh = await mintAndStore(env, ownerId, jwt, previous);
    return use(fresh);
  }
}
