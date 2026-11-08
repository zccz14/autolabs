import { Hono } from 'hono';
import type { Env } from './env';
import { HttpError } from './http';
import { authenticate, type Principal } from './auth';
import projectRoutes from './routes/projects';
import { projectSnapshotRoutes, snapshotRoutes } from './routes/snapshots';
import { projectRunRoutes, runRoutes } from './routes/runs';
import { firmamentRoutes, projectMetricRoutes } from './routes/metrics';
import { driveProjectLoop } from './loop-runner';
import type { ProjectRow } from './store';
import { projectIdeaRoutes } from './routes/ideas';
import { projectLoopRoutes } from './routes/loop';

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
app.route('/api/v1/projects', projectIdeaRoutes);
app.route('/api/v1/projects', projectLoopRoutes);
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
  // dispatched 意味着 Thread 已经发出去、正在用户自己的机器上跑。跑多久都合理，
  // 但一直不结算就是丢了：30 天后标记 lost，研究地图上不再假装它还在跑。
  const staleBefore = Math.floor(Date.now() / 1000) - 30 * 86400;
  const stuck = await env.DB.prepare(
    `SELECT id FROM runs WHERE state = 'dispatched' AND created_at < ?`,
  )
    .bind(staleBefore)
    .all<{ id: string }>();
  for (const run of stuck.results ?? []) {
    await env.DB.prepare(`UPDATE runs SET state = 'lost', settled_at = ? WHERE id = ? AND state = 'dispatched'`)
      .bind(Math.floor(Date.now() / 1000), run.id)
      .run();
  }
}

/** 研究循环的心跳：每一拍都重新判断该做什么，所以重复执行是安全的。 */
async function driveLoops(env: Env): Promise<void> {
  const running = await env.DB.prepare(`SELECT * FROM projects WHERE loop_state = 'running' LIMIT 10`).all<ProjectRow>();
  console.log('loop.cron', { projects: (running.results ?? []).map((project) => `${project.slug}:${project.loop_last_tick_at}`) });
  for (const project of running.results ?? []) {
    if (project.loop_last_tick_at && project.loop_last_tick_at > Math.floor(Date.now() / 1000) - 20) continue;
    try {
      await driveProjectLoop(env, project);
    } catch (error) {
      console.error('loop.failed', (error as Error).message);
    }
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcile(env));
    ctx.waitUntil(driveLoops(env));
  },
} satisfies ExportedHandler<Env>;
