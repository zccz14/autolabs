import type { Env } from './env';
import { nowSeconds } from './ids';
import { labLabel } from './labs';
import { findProjectById, recordEvent, type ProjectRow, type RunRow } from './store';
import { ensureIdentity, identityOf } from './exe-identity';
import { ackCall, dispatchShell, readOutcome } from './exe';
import { markDirty, parseMetrics, prepareEval } from './evaluation';

/**
 * 一键复算整条实验线。
 *
 * 它不改任何已经记下的数字——已结算的行是事实。它做的事只有一件：拿同一份包、
 * 同一个入口、同一份数据，再算一遍，然后核对。三种结局：
 *
 *   matched   算出来一样。这条数字从此有了一份「可复现」的证据。
 *   diverged  算出来不一样。这本身是结论：口径或环境里有一处没被钉住。
 *   failed    这一轮根本算不出来（通常是因为包不符合规范）。
 *
 * 失败会标 dirty，走已有的修复通道；已结算的行修的是「评估树」，改完自动重新排队。
 */

export const RECHECK_EVENTS = {
  queued: 'run.recheck_queued',
  matched: 'run.recheck_matched',
  diverged: 'run.recheck_diverged',
  failed: 'run.recheck_failed',
} as const;

/** 每一拍最多派两个：别把几十个 shell 调用同时砸到同一台机器上。 */
export const RECHECK_PER_TICK = 2;
/** 相对容差。同一个包同一个入口，差到这个量级以下算一致。 */
const RECHECK_EPSILON = 1e-9;

export interface MetricDiff {
  key: string;
  expected: number | null;
  actual: number | null;
}

export interface RecheckComparison {
  state: 'matched' | 'diverged';
  diffs: MetricDiff[];
}

/** 拿复算出来的数字和当年记下的数字对一遍。 */
export function compareMetrics(
  expected: Record<string, unknown> | null,
  actual: Record<string, unknown> | null,
): RecheckComparison {
  const left = expected ?? {};
  const right = actual ?? {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const diffs: MetricDiff[] = [];
  for (const key of keys) {
    const a = left[key];
    const b = right[key];
    if (typeof a === 'number' && typeof b === 'number') {
      const scale = Math.max(1, Math.abs(a));
      if (Math.abs(a - b) <= RECHECK_EPSILON * scale) continue;
      diffs.push({ key, expected: a, actual: b });
      continue;
    }
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    diffs.push({ key, expected: typeof a === 'number' ? a : null, actual: typeof b === 'number' ? b : null });
  }
  return { state: diffs.length === 0 ? 'matched' : 'diverged', diffs };
}

/** 把这个项目里所有已结算的实验排进复算队列。 */
export async function queueRecheck(env: Env, project: ProjectRow): Promise<number> {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM runs WHERE project_id = ? AND state IN ('frozen', 'rejected')`,
  )
    .bind(project.id)
    .first<{ n: number }>();
  const queued = count?.n ?? 0;
  if (queued === 0) return 0;
  await env.DB.prepare(
    `UPDATE runs SET recheck_state = 'queued', recheck_attempts = 0, recheck_at = NULL, recheck_call_id = NULL,
       recheck_device_address = NULL, recheck_expires_at = NULL, recheck_metrics_json = NULL
     WHERE project_id = ? AND state IN ('frozen', 'rejected')`,
  )
    .bind(project.id)
    .run();
  await recordEvent(env, RECHECK_EVENTS.queued, project.id, null, { runs: queued });
  return queued;
}

/** cron 的一拍：派出去、收回来、对一遍。 */
export async function driveRechecks(env: Env): Promise<void> {
  const projects = new Map<string, ProjectRow>();
  const projectOf = async (id: string): Promise<ProjectRow | null> => {
    if (projects.has(id)) return projects.get(id)!;
    const found = await findProjectById(env, id);
    if (found) projects.set(id, found);
    return found;
  };

  const queued =
    (
      await env.DB.prepare(`SELECT * FROM runs WHERE recheck_state = 'queued' ORDER BY lab_no DESC LIMIT ?`)
        .bind(RECHECK_PER_TICK)
        .all<RunRow>()
    ).results ?? [];
  for (const run of queued) {
    const project = await projectOf(run.project_id);
    if (!project) continue;
    await dispatchRecheck(env, project, run);
  }

  const dispatched =
    (
      await env.DB.prepare(`SELECT * FROM runs WHERE recheck_state = 'dispatched' LIMIT 20`).all<RunRow>()
    ).results ?? [];
  for (const run of dispatched) {
    const project = await projectOf(run.project_id);
    if (!project) continue;
    await collectRecheck(env, project, run);
  }
}

async function dispatchRecheck(env: Env, project: ProjectRow, run: RunRow): Promise<void> {
  const prepared = await prepareEval(env, project, run);
  if (!prepared.ok) {
    // 算不出来的根因通常是不合规的包：标 dirty，让修复合集接手。
    if (prepared.kind === 'dirty') await markDirty(env, project, run, prepared.message);
    await failRecheck(env, project, run, prepared.message);
    return;
  }

  const caller = await identityOf(env, await ensureIdentity(env, project.owner_user_id));
  const dispatched = await dispatchShell(env, caller, prepared.device.address, prepared.script, {
    timeoutSeconds: prepared.timeoutSeconds,
    ttlSeconds: prepared.timeoutSeconds,
  });
  if (dispatched.rejected) {
    await failRecheck(env, project, run, `复算命令没派出去（${dispatched.rejected.status}）：${dispatched.rejected.message}`);
    return;
  }
  await env.DB.prepare(
    `UPDATE runs SET recheck_state = 'dispatched', recheck_call_id = ?, recheck_device_address = ?,
       recheck_expires_at = ?, recheck_attempts = recheck_attempts + 1 WHERE id = ?`,
  )
    .bind(dispatched.call.call_id, prepared.device.address, dispatched.call.expires_at, run.id)
    .run();
}

async function collectRecheck(env: Env, project: ProjectRow, run: RunRow): Promise<void> {
  if (!run.recheck_call_id || !run.recheck_device_address || !run.recheck_expires_at) {
    await failRecheck(env, project, run, '复算的调用信息不完整');
    return;
  }
  const identityRow = await ensureIdentity(env, project.owner_user_id);
  const caller = await identityOf(env, identityRow);
  const outcome = await readOutcome(env, caller, {
    call_id: run.recheck_call_id,
    caller: identityRow.address,
    device: run.recheck_device_address,
    expires_at: run.recheck_expires_at,
  });
  if (!outcome) {
    if (nowSeconds() <= run.recheck_expires_at) return;
    await failRecheck(env, project, run, '复算一直没有回音：调用过期了');
    return;
  }
  await ackCall(env, caller, run.recheck_call_id);
  if (!outcome.ok) {
    const detail = (outcome.stderr || outcome.stdout).trim().slice(0, 400);
    await failRecheck(env, project, run, `复算命令退出码 ${outcome.exitCode}：${detail || '没有输出'}`);
    return;
  }

  let actual: Record<string, unknown>;
  try {
    actual = parseMetrics(outcome.stdout);
  } catch (error) {
    await failRecheck(env, project, run, (error as Error).message);
    return;
  }

  const expected = run.metrics_json ? (JSON.parse(run.metrics_json) as Record<string, unknown>) : null;
  const comparison = compareMetrics(expected, actual);
  await env.DB.prepare(
    `UPDATE runs SET recheck_state = ?, recheck_metrics_json = ?, recheck_at = ?, recheck_call_id = NULL WHERE id = ?`,
  )
    .bind(comparison.state, JSON.stringify(actual), nowSeconds(), run.id)
    .run();
  await recordEvent(
    env,
    comparison.state === 'matched' ? RECHECK_EVENTS.matched : RECHECK_EVENTS.diverged,
    project.id,
    null,
    { run_id: run.id, lab: labLabel(run.lab_no), diffs: comparison.diffs },
  );
}

async function failRecheck(env: Env, project: ProjectRow, run: RunRow, message: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE runs SET recheck_state = 'failed', recheck_at = ?, recheck_call_id = NULL, recheck_metrics_json = NULL WHERE id = ?`,
  )
    .bind(nowSeconds(), run.id)
    .run();
  await recordEvent(env, RECHECK_EVENTS.failed, project.id, null, { run_id: run.id, error: message });
}
