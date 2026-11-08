import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate, authenticateOptional } from '../auth';
import { fail } from '../http';
import { loadProject } from '../guards';
import { CybionError } from '../cybion';
import { callerOf } from '../credentials';
import { readIdea, requestIdea } from '../proposals';

/**
 * 「下一轮做什么」的两个动作：请 master thread 出主意、把它的回复读回来。
 * 研究循环用的是同一段逻辑（src/proposals.ts），只是不需要人按按钮。
 */
export const projectIdeaRoutes = new Hono<{ Bindings: Env }>();

projectIdeaRoutes.post('/:slug/idea', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  if (principal.kind !== 'user') return fail(403, 'user_only', '出主意要用登录身份，项目凭据不行');
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'runner', 'write');
  try {
    const idea = await requestIdea(
      c.env,
      access.project,
      callerOf(c.req.raw, principal),
      principal.userId,
      new URL(c.req.url).origin,
    );
    return c.json({ thread_id: idea.threadId, status: 'pending', record_idx: idea.recordIdx }, 202);
  } catch (error) {
    if (error instanceof CybionError) return fail(502, 'cybion_error', error.message);
    throw error;
  }
});

projectIdeaRoutes.get('/:slug/idea', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  try {
    const idea = await readIdea(
      c.env,
      access.project,
      principal ? callerOf(c.req.raw, principal) : { userId: '', jwt: null },
    );
    return c.json(idea);
  } catch (error) {
    if (error instanceof CybionError) {
      return c.json({ thread_id: access.project.idea_thread_id, status: 'error', idea_md: null, requested_at: null, fresh: false, message: error.message });
    }
    throw error;
  }
});
