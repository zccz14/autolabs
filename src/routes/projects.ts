import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate, authenticateOptional } from '../auth';
import { fail, optionalString, readJson, requireString } from '../http';
import { loadProject, type Access } from '../guards';
import { nowSeconds } from '../ids';
import { labLabel } from '../labs';
import {
  countRuns,
  countSnapshots,
  createProject,
  findProjectBySlug,
  listProjectsForUser,
  listRuns,
  listSnapshots,
  listSotaEvents,
  projectRole,
  recordEvent,
  type RunRow,
  type SnapshotRow,
} from '../store';
import { mintProjectToken } from '../tokens';

const routes = new Hono<{ Bindings: Env }>();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

function viewProject(access: Access, extra: Record<string, unknown> = {}) {
  const { project, role } = access;
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    owner_user_id: project.owner_user_id,
    visibility: project.visibility,
    lab_seq: project.lab_seq,
    next_lab: labLabel(project.lab_seq + 1),
    sota_run_id: project.sota_run_id,
    rules_snapshot_id: project.rules_snapshot_id,
    dataset_pin_id: project.dataset_pin_id,
    run_model: project.run_model,
    loop_state: project.loop_state,
    loop_run_id: project.loop_run_id,
    loop_error: project.loop_error,
    eval_command: project.eval_command,
    eval_device_id: project.eval_device_id,
    loop_started_at: project.loop_started_at,
    loop_paused_at: project.loop_paused_at,
    loop_last_tick_at: project.loop_last_tick_at,
    idea_thread_id: project.idea_thread_id,
    idea_thread_user_id: project.idea_thread_user_id,
    created_at: project.created_at,
    role,
    ...extra,
  };
}

export function viewRun(run: RunRow) {
  return {
    id: run.id,
    lab_no: run.lab_no,
    lab: labLabel(run.lab_no),
    external_ref: run.external_ref,
    state: run.state,
    input_snapshot_id: run.input_snapshot_id,
    output_snapshot_id: run.output_snapshot_id,
    dataset_pin_id: run.dataset_pin_id,
    metric_set: run.metric_set_json ? JSON.parse(run.metric_set_json) : [],
    cybion_thread_id: run.cybion_thread_id,
    note: run.note,
    idea_md: run.idea_md,
    report_md: run.report_md,
    metrics: run.metrics_json ? JSON.parse(run.metrics_json) : null,
    gates: run.gates_json ? JSON.parse(run.gates_json) : [],
    created_by: run.created_by,
    created_at: run.created_at,
    settled_at: run.settled_at,
    /** 指标由评估器算：这几列说的是「派给谁了、还在等吗、上一次为什么没成」。 */
    eval: {
      call_id: run.eval_call_id,
      device_address: run.eval_device_address,
      dispatched_at: run.eval_dispatched_at,
      expires_at: run.eval_expires_at,
      attempts: run.eval_attempts,
      error: run.eval_error,
    },
  };
}

export function viewSnapshot(snapshot: SnapshotRow) {
  return {
    id: snapshot.id,
    parent_id: snapshot.parent_id,
    tree_sha: snapshot.tree_sha,
    message: snapshot.message,
    author_user_id: snapshot.author_user_id,
    frozen_at: snapshot.frozen_at,
    frozen: snapshot.frozen_at !== null,
    created_at: snapshot.created_at,
  };
}

routes.get('/', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  if (principal.kind !== 'user') return fail(403, 'forbidden', '项目列表只对登录用户开放');
  const projects = await listProjectsForUser(c.env, principal.userId);
  return c.json({
    projects: projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      visibility: project.visibility,
      lab_seq: project.lab_seq,
      next_lab: labLabel(project.lab_seq + 1),
      sota_run_id: project.sota_run_id,
      owner_user_id: project.owner_user_id,
      created_at: project.created_at,
      role: project.owner_user_id === principal.userId ? 'owner' : 'member',
    })),
  });
});

routes.post('/', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  if (principal.kind !== 'user') return fail(403, 'forbidden', '只有人类会话可以创建项目');
  const payload = await readJson<Record<string, unknown>>(c);
  const slug = requireString(payload.slug, 'slug', 39).toLowerCase();
  if (!SLUG_RE.test(slug)) return fail(400, 'invalid_slug', 'slug 必须是 2-39 位小写字母/数字/连字符');
  const name = (optionalString(payload.name, 'name', 120) ?? slug).trim() || slug;
  const description = optionalString(payload.description, 'description', 600) ?? '';
  const visibility = payload.visibility === 'public-read' ? 'public-read' : 'private';
  if (await findProjectBySlug(c.env, slug)) return fail(409, 'slug_taken', `slug ${slug} 已被占用`);
  const project = await createProject(c.env, { slug, name, description, visibility, ownerUserId: principal.userId });
  const role = await projectRole(c.env, project, principal.userId);
  return c.json({ project: viewProject({ project, role: role ?? 'owner', principal }) }, 201);
});

routes.get('/:slug', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const [runs, snapshots, sotaEvents, runCount, snapshotCount] = await Promise.all([
    listRuns(c.env, access.project.id, 200),
    listSnapshots(c.env, access.project.id, 200),
    listSotaEvents(c.env, access.project.id, 50),
    countRuns(c.env, access.project.id),
    countSnapshots(c.env, access.project.id),
  ]);
  // 账本按 lab 号说话，和目录、榜单同一套编号；run id 只是外键，不给人读。
  const labByRun = new Map(runs.map((run) => [run.id, labLabel(run.lab_no)]));
  return c.json({
    project: viewProject(access, { run_count: runCount, snapshot_count: snapshotCount }),
    runs: runs.map(viewRun),
    snapshots: snapshots.map(viewSnapshot),
    sota_events: sotaEvents.map((event) => ({ ...event, lab: labByRun.get(event.run_id) ?? null })),
  });
});

routes.post('/:slug/tokens', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'write');
  const payload = await readJson<Record<string, unknown>>(c);
  const label = requireString(payload.label, 'label', 120);
  const requested = Array.isArray(payload.capabilities) ? payload.capabilities.map(String) : ['read', 'write', 'verdict'];
  const allowed = new Set(['read', 'write', 'verdict', 'sota']);
  const capabilities = requested.filter((capability) => allowed.has(capability));
  if (capabilities.length === 0) return fail(400, 'invalid_capabilities', '至少需要一个能力：read/write/verdict/sota');
  const days =
    typeof payload.expires_in_days === 'number' ? Math.min(Math.max(payload.expires_in_days, 1), 365) : 90;
  const minted = await mintProjectToken();
  await c.env.DB.prepare(
    `INSERT INTO project_tokens (id, project_id, label, secret_sha256, capabilities, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      minted.id,
      access.project.id,
      label,
      minted.secretSha256,
      capabilities.join(','),
      principal.userId,
      nowSeconds(),
      nowSeconds() + days * 86400,
    )
    .run();
  await recordEvent(c.env, 'token.minted', access.project.id, principal.userId, { token_id: minted.id, capabilities });
  return c.json({ token: minted.token, id: minted.id, capabilities, expires_in_days: days }, 201);
});

/** 项目级设置：现在只有「跑实验用哪个模型」，空字符串表示跟随 Cybion 默认。 */
/**
 * 项目级设置。三样东西各管一段：
 *   run_model      —— 跑实验的 Thread 用哪个模型（执行体的事）；
 *   eval_command   —— 指标怎么算（评估器的事，一条命令）；
 *   eval_device_id —— 这条命令在哪台机器上跑（用户自己的设备）。
 * 这些都是「只传什么改什么」：界面保存一块，不该顺手把别的块清零。
 */
routes.post('/:slug/settings', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'write');
  const payload = await readJson<Record<string, unknown>>(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  const event: Record<string, unknown> = {};

  if ('run_model' in payload) {
    const raw = optionalString(payload.run_model, 'run_model', 120)?.trim() ?? '';
    sets.push('run_model = ?');
    binds.push(raw || null);
    event.run_model = raw || null;
  }

  if ('eval_command' in payload) {
    const raw = optionalString(payload.eval_command, 'eval_command', 2000)?.trim() ?? '';
    sets.push('eval_command = ?');
    binds.push(raw || null);
    event.eval_command = raw ? raw.slice(0, 120) : null;
  }

  if ('eval_device_id' in payload) {
    const raw = optionalString(payload.eval_device_id, 'eval_device_id', 64)?.trim() ?? '';
    if (raw) {
      const device = await c.env.DB.prepare(`SELECT id FROM devices WHERE id = ? AND user_id = ?`)
        .bind(raw, access.project.owner_user_id)
        .first<{ id: string }>();
      if (!device) return fail(400, 'unknown_device', '这台设备不在项目所有者名下：先去设备页接入');
    }
    sets.push('eval_device_id = ?');
    binds.push(raw || null);
    event.eval_device_id = raw || null;
  }

  if (sets.length === 0) return fail(400, 'nothing_to_update', '没有要改的设置');
  await c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, access.project.id)
    .run();
  await recordEvent(c.env, 'project.settings', access.project.id, principal.userId, event);
  const updated = await findProjectBySlug(c.env, access.project.slug);
  return c.json({
    run_model: updated?.run_model ?? null,
    eval_command: updated?.eval_command ?? null,
    eval_device_id: updated?.eval_device_id ?? null,
  });
});

routes.get('/:slug/tokens', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'read');
  const result = await c.env.DB.prepare(
    `SELECT id, label, capabilities, created_at, expires_at, revoked_at FROM project_tokens WHERE project_id = ? ORDER BY created_at DESC`,
  )
    .bind(access.project.id)
    .all();
  return c.json({ tokens: result.results ?? [] });
});

routes.post('/:slug/tokens/:tokenId/revoke', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'write');
  const tokenId = c.req.param('tokenId');
  // 只在「还活着」的时候翻状态：重复吊销不该刷出第二笔审计事件。
  const result = await c.env.DB.prepare(
    `UPDATE project_tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL`,
  )
    .bind(nowSeconds(), tokenId, access.project.id)
    .run();
  if (!result.meta.changes) return fail(409, 'already_revoked', '令牌不存在或已吊销');
  await recordEvent(c.env, 'token.revoked', access.project.id, principal.userId, { token_id: tokenId });
  return c.json({ revoked: true });
});

/** 机器侧凭据用它确认自己是谁、能干什么。 */
routes.get('/:slug/whoami', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  return c.json({
    kind: principal.kind,
    user_id: principal.userId,
    capabilities: principal.capabilities,
    role: access.role,
    project: { id: access.project.id, slug: access.project.slug },
  });
});

export default routes;
