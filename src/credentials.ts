import type { Env } from './env';
import { CybionError } from './cybion';
import { nowSeconds } from './ids';
import { seal, unseal } from './sealed';

/**
 * 每个人在 Cybion 上的长寿命 API key。
 *
 * 为什么要有这一层：JWT 只有一小时，Thread 可能跑几天；所以换一次、存下来，
 * 运行时只用 key。没换过的人回退到 Worker 里那把服务级 key（`CYBION_API_KEY`），
 * 这样老部署和没登录过的机器上报链路都不会断。
 */

export interface CredentialRow {
  user_id: string;
  cybion_key_id: string;
  label: string;
  prefix: string;
  sealed: string;
  created_at: number;
}

export interface CredentialView {
  /** user = 这个人自己换来的；service = Worker 里那把服务级 key。 */
  source: 'user' | 'service';
  label: string;
  prefix: string | null;
  created_at: number | null;
}

export async function readCredential(env: Env, userId: string): Promise<CredentialRow | null> {
  return env.DB.prepare(
    `SELECT user_id, cybion_key_id, label, prefix, sealed, created_at FROM cybion_credentials WHERE user_id = ?`,
  )
    .bind(userId)
    .first<CredentialRow>();
}

export async function credentialView(env: Env, userId: string): Promise<CredentialView | null> {
  const row = await readCredential(env, userId);
  if (row) return { source: 'user', label: row.label, prefix: row.prefix, created_at: row.created_at };
  if (env.CYBION_API_KEY) return { source: 'service', label: 'AutoLabs（服务级）', prefix: null, created_at: null };
  return null;
}

/** 这一轮该用谁的 key：先用创建者自己换来的，没有就用服务级那把。 */
export async function cybionKeyFor(env: Env, userId: string): Promise<string> {
  const row = await readCredential(env, userId);
  if (row) return unseal(env, row.sealed);
  if (env.CYBION_API_KEY) return env.CYBION_API_KEY;
  throw new CybionError('还没有 Cybion 凭据：在 AutoLabs 里用登录换一把，或给 Worker 配 CYBION_API_KEY');
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
