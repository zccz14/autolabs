import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env';
import { fail } from './http';
import { nowSeconds } from './ids';
import { parseProjectToken, tokenFingerprint } from './tokens';

export interface Principal {
  kind: 'user' | 'token';
  /** Auth Mini 的 sub；token 身份时是签发人。 */
  userId: string;
  /** token 身份绑定的项目，user 身份为 undefined。 */
  projectId?: string;
  capabilities: string[];
  tokenId?: string;
}

type Jwks = ReturnType<typeof createRemoteJWKSet>;

/** 每个 isolate 内按 issuer 缓存 JWKS；jose 自己再做 stale-while-revalidate。 */
const keySets = new Map<string, Jwks>();

function keySet(issuer: string): Jwks {
  let cached = keySets.get(issuer);
  if (!cached) {
    cached = createRemoteJWKSet(new URL('/jwks', issuer), {
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
    });
    keySets.set(issuer, cached);
  }
  return cached;
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function authenticateToken(raw: string, env: Env): Promise<Principal> {
  const parsed = parseProjectToken(raw);
  if (!parsed) fail(401, 'unauthorized', '项目凭据格式不正确');
  const fingerprint = await tokenFingerprint(parsed.id, parsed.secret);
  const row = await env.DB.prepare(
    `SELECT id, project_id, capabilities, created_by, expires_at, revoked_at FROM project_tokens WHERE id = ?`,
  )
    .bind(parsed.id)
    .first<{
      id: string;
      project_id: string;
      capabilities: string;
      created_by: string;
      expires_at: number | null;
      revoked_at: number | null;
    }>();
  if (!row || row.revoked_at !== null) fail(401, 'unauthorized', '项目凭据无效');
  if (row.expires_at !== null && row.expires_at <= nowSeconds()) fail(401, 'token_expired', '项目凭据已过期');
  const secretRow = await env.DB.prepare(`SELECT secret_sha256 FROM project_tokens WHERE id = ?`)
    .bind(parsed.id)
    .first<{ secret_sha256: string }>();
  if (!secretRow || secretRow.secret_sha256 !== fingerprint) fail(401, 'unauthorized', '项目凭据无效');
  return {
    kind: 'token',
    userId: row.created_by,
    projectId: row.project_id,
    capabilities: row.capabilities.split(',').filter(Boolean),
    tokenId: row.id,
  };
}

/** 必须登录：Auth Mini access token（aud = 本站）或项目凭据。 */
export async function authenticate(request: Request, env: Env): Promise<Principal> {
  const raw = bearer(request);
  if (!raw) fail(401, 'unauthorized', '缺少 Authorization: Bearer');
  if (env.DEV_USER_ID && raw === 'dev') return { kind: 'user', userId: env.DEV_USER_ID, capabilities: ['*'] };
  if (raw.startsWith('alb_')) return authenticateToken(raw, env);
  try {
    const { payload } = await jwtVerify(raw, keySet(env.AUTH_ISSUER), {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
    });
    const subject = payload.sub;
    if (!subject) return fail(401, 'unauthorized', 'token 缺少 sub');
    return { kind: 'user', userId: subject, capabilities: ['*'] };
  } catch {
    return fail(401, 'unauthorized', 'access token 无效或已过期');
  }
}

/** 可匿名：公开只读项目允许无身份访问。 */
export async function authenticateOptional(request: Request, env: Env): Promise<Principal | null> {
  if (!bearer(request)) return null;
  try {
    return await authenticate(request, env);
  } catch {
    return null;
  }
}
