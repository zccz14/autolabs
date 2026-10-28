import { Hono } from 'hono';
import type { Env } from './env';
import { HttpError } from './http';
import { authenticate, type Principal } from './auth';
import projectRoutes from './routes/projects';
import { projectSnapshotRoutes, snapshotRoutes } from './routes/snapshots';
import { projectRunRoutes, runRoutes } from './routes/runs';
import { firmamentRoutes, projectMetricRoutes } from './routes/metrics';

type Variables = { principal: Principal };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/api/v1/health', (c) =>
  c.json({ ok: true, service: 'autolabs', version: '0.1.0', now: Math.floor(Date.now() / 1000) }),
);

app.get('/api/v1/me', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  return c.json({ kind: principal.kind, user_id: principal.userId, capabilities: principal.capabilities });
});

app.route('/api/v1/projects', projectRoutes);
app.route('/api/v1/projects', projectSnapshotRoutes);
app.route('/api/v1/projects', projectRunRoutes);
app.route('/api/v1/projects', projectMetricRoutes);
app.route('/api/v1/firmament', firmamentRoutes);
app.route('/api/v1/snapshots', snapshotRoutes);
app.route('/api/v1/runs', runRoutes);

app.notFound((c) => c.json({ error: 'not_found', message: `没有这个接口：${new URL(c.req.url).pathname}` }, 404));

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.code, message: error.message }, error.status as 400 | 401 | 403 | 404 | 409 | 413 | 500);
  }
  console.error('autolabs error', error);
  return c.json({ error: 'internal_error', message: '服务内部错误' }, 500);
});

/** 静态资源与 SPA：Hash Router，所以只有 / 真正需要 index.html。 */
app.all('*', async (c) => {
  const { pathname } = new URL(c.req.url);
  // 未知 API 必须答 JSON 404，不能被 SPA 外壳吞掉。
  if (pathname.startsWith('/api/')) {
    return c.json({ error: 'not_found', message: `没有这个接口：${pathname}` }, 404);
  }
  const response = await c.env.ASSETS.fetch(c.req.raw);
  if (response.status !== 404) return response;
  return c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString(), c.req.raw));
});

/**
 * 对账器：只做救援，不做主循环。任何 run 都不允许永远停在 dispatched。
 * 主循环在 Workflows 里（Phase 2），这里每秒都是兜底。
 */
async function reconcile(env: Env): Promise<void> {
  const staleBefore = Math.floor(Date.now() / 1000) - 24 * 3600;
  const stuck = await env.DB.prepare(
    `SELECT id, project_id FROM runs WHERE state = 'dispatched' AND cybion_thread_id IS NULL AND created_at < ?`,
  )
    .bind(staleBefore)
    .all<{ id: string; project_id: string }>();
  for (const run of stuck.results ?? []) {
    await env.DB.prepare(`UPDATE runs SET state = 'lost', settled_at = ? WHERE id = ? AND state = 'dispatched'`)
      .bind(Math.floor(Date.now() / 1000), run.id)
      .run();
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcile(env));
  },
} satisfies ExportedHandler<Env>;
