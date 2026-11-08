import { Hono } from 'hono';
import { decodeJwt } from 'jose';
import type { Env } from '../env';
import { authenticate } from '../auth';
import { fail } from '../http';
import { CybionError, mintApiKey, revokeApiKey } from '../cybion';
import { credentialView, dropCredential, readCredential, saveCredential } from '../credentials';

/**
 * Cybion 凭据的换与扔。
 *
 * 换的那一刻用当前登录的 JWT（Auth Mini 签发、带 cybion.ntnl.io audience），
 * 换到一把不会过期的 API key，密封存进库里；之后所有 Thread 都用它。
 * JWT 不进数据库，也不留在任何地方。
 */
export const cybionRoutes = new Hono<{ Bindings: Env }>();

const LABEL = 'AutoLabs';

function rawBearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

function expectedAudience(env: Env): string {
  return env.CYBION_BASE_URL ? new URL(env.CYBION_BASE_URL).hostname : 'cybion.ntnl.io';
}

/** 这把 JWT 能不能当 Cybion 的入场券：必须是登录拿的，且 audience 里得有 Cybion。 */
function requireCybionJwt(env: Env, raw: string | null): string {
  if (!raw || raw.startsWith('alb_')) {
    fail(403, 'jwt_required', '换 Cybion 凭据要用登录拿到的 JWT，项目凭据不行');
  }
  const audience = expectedAudience(env);
  const claim = decodeJwt(raw as string).aud;
  const audiences = Array.isArray(claim) ? claim : claim ? [claim] : [];
  if (!audiences.includes(audience)) {
    fail(
      403,
      'missing_cybion_audience',
      `当前登录没有 ${audience} 这个 audience。退出重新登录一次，AutoLabs 会在登录时一并申请。`,
    );
  }
  return raw as string;
}

function requireSealingKey(env: Env): void {
  if (!env.CREDENTIALS_KEY) {
    fail(503, 'no_credentials_key', 'Worker 还没有 CREDENTIALS_KEY：wrangler secret put CREDENTIALS_KEY（32 字节 base64）');
  }
}

cybionRoutes.get('/credentials', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  if (principal.kind !== 'user') return fail(403, 'user_only', 'Cybion 凭据属于人，不属于项目凭据');
  return c.json({ credential: await credentialView(c.env, principal.userId) });
});

cybionRoutes.post('/credentials', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  if (principal.kind !== 'user') return fail(403, 'user_only', 'Cybion 凭据属于人，不属于项目凭据');
  requireSealingKey(c.env);
  const jwt = requireCybionJwt(c.env, rawBearer(c.req.raw));
  const previous = await readCredential(c.env, principal.userId);
  try {
    const minted = await mintApiKey(c.env, jwt, LABEL);
    await saveCredential(c.env, principal.userId, {
      cybionKeyId: minted.id,
      label: minted.label,
      prefix: minted.prefix,
      secret: minted.secret,
    });
    // 换新就吊销旧的：Cybion 那边不留一串没人认领的 key。
    if (previous && previous.cybion_key_id !== minted.id) {
      try {
        await revokeApiKey(c.env, jwt, previous.cybion_key_id);
      } catch (error) {
        console.warn('旧 Cybion key 吊销失败', (error as Error).message);
      }
    }
    return c.json({ credential: await credentialView(c.env, principal.userId) }, 201);
  } catch (error) {
    if (error instanceof CybionError) return fail(502, 'cybion_error', error.message);
    throw error;
  }
});

cybionRoutes.delete('/credentials', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  if (principal.kind !== 'user') return fail(403, 'user_only', 'Cybion 凭据属于人，不属于项目凭据');
  const jwt = requireCybionJwt(c.env, rawBearer(c.req.raw));
  const row = await readCredential(c.env, principal.userId);
  if (!row) return fail(404, 'not_found', '这个人还没有存过 Cybion 凭据');
  try {
    await revokeApiKey(c.env, jwt, row.cybion_key_id);
  } catch (error) {
    if (error instanceof CybionError) return fail(502, 'cybion_error', error.message);
    throw error;
  }
  await dropCredential(c.env, principal.userId);
  return c.json({ deleted: true });
});
