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
    report_md: run.report_md,
    metrics: run.metrics_json ? JSON.parse(run.metrics_json) : null,
    gates: run.gates_json ? JSON.parse(run.gates_json) : [],
    created_by: run.created_by,
    created_at: run.created_at,
    settled_at: run.settled_at,
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
  return c.json({
    project: viewProject(access, { run_count: runCount, snapshot_count: snapshotCount }),
    runs: runs.map(viewRun),
    snapshots: snapshots.map(viewSnapshot),
    sota_events: sotaEvents,
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
  await c.env.DB.prepare(`UPDATE project_tokens SET revoked_at = ? WHERE id = ? AND project_id = ?`)
    .bind(nowSeconds(), c.req.param('tokenId'), access.project.id)
    .run();
  await recordEvent(c.env, 'token.revoked', access.project.id, principal.userId, { token_id: c.req.param('tokenId') });
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
