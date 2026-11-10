import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env';
import { fail } from './http';
import { nowSeconds } from './ids';
import { parseProjectToken, tokenFingerprint } from './tokens';

/** Cybion 签 Thread 令牌用的 issuer；公钥发布在它的 /.well-known/jwks.json。 */
export const CYBION_ISSUER = 'https://cybion.ntnl.io';

export interface Principal {
  kind: 'user' | 'token' | 'thread';
  /** Auth Mini 的 sub；token 与 thread 身份时是它替谁干活。 */
  userId: string;
  /** token 与 thread 身份绑定的项目，user 身份为 undefined。 */
  projectId?: string;
  /** thread 身份绑定的那一轮 run；思路 Thread 不绑 run，为 undefined。 */
  runId?: string;
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

/**
 * Cybion 的 Thread 公钥。每个 isolate 缓存一份，jose 自己负责刷新。
 * 令牌只有 60 秒，所以这里不需要长缓存——按 `kid` 选键、未知 kid 时刷新一次就够了。
 */
const threadKeySets = new Map<string, Jwks>();

function threadKeySet(env: Env): Jwks {
  const url = env.CYBION_JWKS_URL ?? `${CYBION_ISSUER}/.well-known/jwks.json`;
  let cached = threadKeySets.get(url);
  if (!cached) {
    cached = createRemoteJWKSet(new URL(url), { cacheMaxAge: 600_000, cooldownDuration: 30_000 });
    threadKeySets.set(url, cached);
  }
  return cached;
}

/**
 * 不验签地读出 `iss`，只用来决定走哪条校验路径；两条路径各自完整验签。
 *
 * JWT 的段是无 padding 的 base64url，`atob` 却不接受缺 padding 的输入，
 * 所以先补齐再解码——这一步错了会让 Thread 令牌静默掉进 Auth Mini 那条分支。
 */
export function issuerOf(token: string): string | null {
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const payload = JSON.parse(json) as { iss?: unknown };
    return typeof payload.iss === 'string' ? payload.iss : null;
  } catch {
    return null;
  }
}

/**
 * Thread 身份：Cybion 签的 JWT，`sub` 是那条 Thread。
 * 令牌本身不带权限，权限来自「这条 Thread 在 AutoLabs 里绑了什么」——
 * 绑了某一轮 run 就是那一轮的执行体，绑了项目的思路线程就只读。
 */
async function authenticateThread(raw: string, env: Env): Promise<Principal> {
  let threadId: string;
  try {
    const { payload } = await jwtVerify(raw, threadKeySet(env), {
      issuer: CYBION_ISSUER,
      algorithms: ['EdDSA'],
    });
    if (!payload.sub) return fail(401, 'unauthorized', 'Thread 令牌缺少 sub');
    threadId = payload.sub;
  } catch {
    return fail(401, 'unauthorized', 'Thread 令牌无效或已过期：调用 create_thread_token 重新签发一张');
  }
  const run = await env.DB.prepare(`SELECT id, project_id, created_by FROM runs WHERE cybion_thread_id = ?`)
    .bind(threadId)
    .first<{ id: string; project_id: string; created_by: string }>();
  if (run) {
    return {
      kind: 'thread',
      userId: run.created_by,
      projectId: run.project_id,
      runId: run.id,
      capabilities: ['read', 'write', 'verdict'],
    };
  }
  // 修复 thread 也是一条执行体：它要能把补好的包传上来、并说「这一轮改用新快照」。
  // 少了这一段，修复 Agent 签出来的令牌会被判 401，只能自己瞎找凭据。
  const repair = await env.DB.prepare(`SELECT id, project_id, created_by FROM runs WHERE repair_thread_id = ?`)
    .bind(threadId)
    .first<{ id: string; project_id: string; created_by: string }>();
  if (repair) {
    return {
      kind: 'thread',
      userId: repair.created_by,
      projectId: repair.project_id,
      runId: repair.id,
      // 能读能写，但**不能** verdict：修包的人不结算实验。
      capabilities: ['read', 'write'],
    };
  }
  const project = await env.DB.prepare(`SELECT id, owner_user_id FROM projects WHERE idea_thread_id = ?`)
    .bind(threadId)
    .first<{ id: string; owner_user_id: string }>();
  if (project) {
    return { kind: 'thread', userId: project.owner_user_id, projectId: project.id, capabilities: ['read'] };
  }
  return fail(401, 'unauthorized', '这条 Thread 没有绑定 AutoLabs 的任何东西');
}

/** Authorization: Bearer <token> 里的那一段。 */
export function bearerOf(request: Request): string | null {
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
  const raw = bearerOf(request);
  if (!raw) fail(401, 'unauthorized', '缺少 Authorization: Bearer');
  if (env.DEV_USER_ID && raw === 'dev') return { kind: 'user', userId: env.DEV_USER_ID, capabilities: ['*'] };
  if (raw.startsWith('alb_')) return authenticateToken(raw, env);
  if (issuerOf(raw) === CYBION_ISSUER) return authenticateThread(raw, env);
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
  if (!bearerOf(request)) return null;
  try {
    return await authenticate(request, env);
  } catch {
    return null;
  }
}
