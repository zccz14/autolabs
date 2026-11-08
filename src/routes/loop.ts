import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate } from '../auth';
import { fail } from '../http';
import { loadProject } from '../guards';
import { findProjectById, recordEvent } from '../store';
import { driveProjectLoop } from '../loop-runner';
import { LOOP_EVENTS } from '../loop';
import { nowSeconds } from '../ids';

/**
 * 研究循环的开与关。
 *
 * 启动之后就没人什么事了：master thread 出思路 → 开实验 → 等执行体回传结论 →
 * 再出思路。暂停只做一件事：不再开新实验；在飞的那一轮照常跑完、照常结算。
 */
export const projectLoopRoutes = new Hono<{ Bindings: Env }>();

projectLoopRoutes.post('/:slug/loop', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'write');
  const raw = await c.req.text();
  let action = '';
  try {
    action = raw.trim() ? String((JSON.parse(raw) as { action?: unknown }).action ?? '') : '';
  } catch {
    return fail(400, 'invalid_json', '请求体必须是 JSON');
  }
  if (!['start', 'pause'].includes(action)) return fail(400, 'invalid_action', 'action 只能是 start / pause');

  const started = action === 'start';
  await c.env.DB.prepare(
    `UPDATE projects SET loop_state = ?, loop_started_at = ?, loop_paused_at = ?, loop_error = ? WHERE id = ?`,
  )
    .bind(started ? 'running' : 'paused', started ? nowSeconds() : access.project.loop_started_at, started ? null : nowSeconds(), started ? null : access.project.loop_error, access.project.id)
    .run();
  await recordEvent(c.env, started ? LOOP_EVENTS.started : LOOP_EVENTS.paused, access.project.id, principal.userId, {});

  if (started) {
    // 立刻走一拍，别等下一次 cron：按下启动就该看见它开始动。
    const fresh = await findProjectById(c.env, access.project.id);
    if (fresh) c.executionCtx.waitUntil(driveProjectLoop(c.env, fresh));
  }
  return c.json({ loop_state: started ? 'running' : 'paused' });
});
