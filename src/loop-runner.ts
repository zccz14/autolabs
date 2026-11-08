import type { Env } from './env';
import type { ProjectRow } from './store';
import { recordEvent } from './store';
import type { Caller } from './credentials';
import { decideLoopAction, LOOP_EVENTS } from './loop';
import { readIdea, requestIdea } from './proposals';
import { openRun, startRunThread } from './routes/runs';
import { labLabel } from './labs';
import { nowSeconds } from './ids';

/**
 * 研究循环的一拍。
 *
 * 每一拍都从数据库重新判断「现在该做什么」，所以它是幂等的：cron 每分钟来一次，
 * 启动时也会立刻来一次；重复的一拍只会得出同一个结论，不会多开一轮实验。
 */
export async function driveProjectLoop(env: Env, project: ProjectRow): Promise<void> {
  if (project.loop_state !== 'running') return;
  const origin = env.APP_ORIGIN ?? 'https://autolabs.ntnl.io';
  const actor = project.idea_thread_user_id ?? project.owner_user_id;
  // 后台没有登录 JWT：用这个人存过的凭据，没有就回退服务级 key。
  const caller: Caller = { userId: actor, jwt: null };

  const inFlight = await env.DB.prepare(
    `SELECT id FROM runs WHERE project_id = ? AND state IN ('proposed', 'dispatched', 'running') ORDER BY lab_no DESC LIMIT 1`,
  )
    .bind(project.id)
    .first<{ id: string }>();

  let idea = null;
  if (!inFlight) {
    idea = await readIdea(env, project, caller).catch(() => null);
  }

  const action = decideLoopAction({
    loopState: 'running',
    inFlightRunId: inFlight?.id ?? null,
    ideaReady: idea?.status === 'ready',
    ideaFresh: idea?.fresh === true,
    ideaPending: idea?.status === 'pending',
    ideaText: idea?.idea_md ?? '',
  });
  await env.DB.prepare(`UPDATE projects SET loop_last_tick_at = ? WHERE id = ?`).bind(nowSeconds(), project.id).run();

  if (action.type === 'idle') return;
  if (action.type === 'wait') {
    await env.DB.prepare(`UPDATE projects SET loop_run_id = ? WHERE id = ?`).bind(action.runId, project.id).run();
    return;
  }
  if (action.type === 'wait-idea') return;

  try {
    if (action.type === 'request-idea') {
      await requestIdea(env, project, caller, actor, origin);
      return;
    }

    const run = await openRun(env, project, actor, { idea: action.idea || idea?.idea_md || null, note: '研究循环自动发起' });
    if (!run) {
      await pauseWithError(env, project.id, '项目还没有任何快照：研究循环没法开工');
      return;
    }
    await startRunThread(env, origin, project, run, actor, caller);
    await env.DB.prepare(`UPDATE projects SET loop_run_id = ?, loop_error = NULL WHERE id = ?`).bind(run.id, project.id).run();
    await recordEvent(env, LOOP_EVENTS.runOpened, project.id, actor, { run_id: run.id, lab: labLabel(run.lab_no) });
  } catch (error) {
    // 循环自己出错就停下来等人：与其每分钟重试一次烧掉一堆请求，不如把原因摆出来。
    await pauseWithError(env, project.id, (error as Error).message);
  }
}

async function pauseWithError(env: Env, projectId: string, message: string): Promise<void> {
  await env.DB.prepare(`UPDATE projects SET loop_state = 'paused', loop_paused_at = ?, loop_error = ? WHERE id = ?`)
    .bind(nowSeconds(), message, projectId)
    .run();
  await recordEvent(env, LOOP_EVENTS.failed, projectId, null, { error: message });
}
