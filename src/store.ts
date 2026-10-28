import type { Env } from './env';
import { nowSeconds, newId } from './ids';

export type Role = 'owner' | 'maintainer' | 'runner' | 'reader';

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  owner_user_id: string;
  visibility: 'private' | 'public-read';
  lab_seq: number;
  sota_run_id: string | null;
  rules_snapshot_id: string | null;
  dataset_pin_id: string | null;
  created_at: number;
}

export interface SnapshotRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  tree_sha: string;
  message: string;
  author_user_id: string;
  frozen_at: number | null;
  created_at: number;
}

export interface EntryRow {
  path: string;
  sha256: string;
  size: number;
}

export type RunState = 'proposed' | 'dispatched' | 'running' | 'evaluating' | 'frozen' | 'rejected' | 'lost';

export interface RunRow {
  id: string;
  project_id: string;
  lab_no: number;
  external_ref: string;
  state: RunState;
  input_snapshot_id: string;
  output_snapshot_id: string | null;
  dataset_pin_id: string | null;
  metric_set_json: string | null;
  cybion_thread_id: string | null;
  note: string;
  report_md: string | null;
  metrics_json: string | null;
  gates_json: string | null;
  created_by: string;
  created_at: number;
  settled_at: number | null;
}

const ROLE_RANK: Record<Role, number> = { reader: 1, runner: 2, maintainer: 3, owner: 4 };

export function roleAtLeast(role: Role | null, needed: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}

/** 用户在项目里的角色；公开只读项目对外来者是 reader。 */
export async function projectRole(env: Env, project: ProjectRow, userId: string | null): Promise<Role | null> {
  if (userId && project.owner_user_id === userId) return 'owner';
  if (userId) {
    const row = await env.DB.prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
      .bind(project.id, userId)
      .first<{ role: Role }>();
    if (row) return row.role;
  }
  if (project.visibility === 'public-read' && project.sota_run_id !== null) return 'reader';
  return null;
}

export async function findProjectBySlug(env: Env, slug: string): Promise<ProjectRow | null> {
  return env.DB.prepare(`SELECT * FROM projects WHERE slug = ?`).bind(slug).first<ProjectRow>();
}

export async function findProjectById(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(id).first<ProjectRow>();
}

export async function listProjectsForUser(env: Env, userId: string): Promise<ProjectRow[]> {
  const result = await env.DB.prepare(
    `SELECT p.* FROM projects p
      WHERE p.owner_user_id = ?
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
      ORDER BY p.created_at DESC`,
  )
    .bind(userId, userId)
    .all<ProjectRow>();
  return result.results ?? [];
}

export async function ensureUser(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)`)
    .bind(userId, nowSeconds())
    .run();
}

export async function createProject(
  env: Env,
  input: { slug: string; name: string; description: string; visibility: 'private' | 'public-read'; ownerUserId: string },
): Promise<ProjectRow> {
  const id = newId('prj');
  const createdAt = nowSeconds();
  await ensureUser(env, input.ownerUserId);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO projects (id, slug, name, description, owner_user_id, visibility, lab_seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).bind(id, input.slug, input.name, input.description, input.ownerUserId, input.visibility, createdAt),
    env.DB.prepare(`INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(
      id,
      input.ownerUserId,
      createdAt,
    ),
    env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, 'project.created', ?, ?, ?)`).bind(
      newId('evt'),
      id,
      JSON.stringify({ slug: input.slug }),
      input.ownerUserId,
      createdAt,
    ),
  ]);
  await seedMetrics(env, id, input.ownerUserId);
  const created = await findProjectById(env, id);
  if (!created) throw new Error('项目创建失败');
  return created;
}

/**
 * 分配实验编号：只增不减、永不复用。
 * D1 不支持可靠的多语句事务跨读，所以 update-then-read 用 batch 保证原子序。
 */
export async function allocateLabNo(env: Env, projectId: string): Promise<number> {
  await env.DB.prepare(`UPDATE projects SET lab_seq = lab_seq + 1 WHERE id = ?`).bind(projectId).run();
  const row = await env.DB.prepare(`SELECT lab_seq FROM projects WHERE id = ?`).bind(projectId).first<{ lab_seq: number }>();
  if (!row) throw new Error('项目不存在');
  return row.lab_seq;
}

export async function listRuns(env: Env, projectId: string, limit = 100): Promise<RunRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM runs WHERE project_id = ? ORDER BY lab_no DESC LIMIT ?`)
    .bind(projectId, limit)
    .all<RunRow>();
  return result.results ?? [];
}

export async function findRun(env: Env, runId: string): Promise<RunRow | null> {
  return env.DB.prepare(`SELECT * FROM runs WHERE id = ?`).bind(runId).first<RunRow>();
}

export async function findRunByExternalRef(env: Env, ref: string): Promise<RunRow | null> {
  return env.DB.prepare(`SELECT * FROM runs WHERE external_ref = ?`).bind(ref).first<RunRow>();
}

/** 列表是截断的（LIMIT），所以"有多少个"必须单独数，不能用列表长度冒充。 */
export async function countRuns(env: Env, projectId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE project_id = ?`)
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countSnapshots(env: Env, projectId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM snapshots WHERE project_id = ?`)
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listSnapshots(env: Env, projectId: string, limit = 100): Promise<SnapshotRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(projectId, limit)
    .all<SnapshotRow>();
  return result.results ?? [];
}

export async function findSnapshot(env: Env, snapshotId: string): Promise<SnapshotRow | null> {
  return env.DB.prepare(`SELECT * FROM snapshots WHERE id = ?`).bind(snapshotId).first<SnapshotRow>();
}

export async function snapshotEntries(env: Env, snapshotId: string): Promise<EntryRow[]> {
  const result = await env.DB.prepare(`SELECT path, sha256, size FROM snapshot_entries WHERE snapshot_id = ? ORDER BY path`)
    .bind(snapshotId)
    .all<EntryRow>();
  return result.results ?? [];
}

export async function latestSnapshot(env: Env, projectId: string): Promise<SnapshotRow | null> {
  return env.DB.prepare(`SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(projectId)
    .first<SnapshotRow>();
}

export async function recordEvent(
  env: Env,
  kind: string,
  projectId: string | null,
  actorUserId: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(newId('evt'), projectId, kind, JSON.stringify(payload), actorUserId, nowSeconds())
    .run();
}

export interface SotaEvent {
  id: string;
  project_id: string;
  run_id: string;
  action: 'promote' | 'demote' | 'exclude';
  reason: string;
  actor_user_id: string;
  created_at: number;
}

export async function listSotaEvents(env: Env, projectId: string, limit = 50): Promise<SotaEvent[]> {
  const result = await env.DB.prepare(`SELECT * FROM sota_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(projectId, limit)
    .all<SotaEvent>();
  return result.results ?? [];
}

export interface DatasetPinRow {
  id: string;
  project_id: string;
  firmament_dataset_id: string;
  name: string;
  digest: string;
  file_count: number;
  bytes: number;
  manifest_key: string | null;
  verified: number;
  note: string;
  pinned_by: string;
  pinned_at: number;
}

/** 当前生效的指标：每个 key 取最大版本，且未被退役。 */
export async function currentMetrics(env: Env, projectId: string): Promise<MetricRow[]> {
  const result = await env.DB.prepare(
    `SELECT m.* FROM project_metrics m
       JOIN (SELECT key, MAX(version) AS v FROM project_metrics WHERE project_id = ? GROUP BY key) latest
         ON latest.key = m.key AND latest.v = m.version
      WHERE m.project_id = ? AND m.retired_at IS NULL
      ORDER BY m.sort_order, m.key`,
  )
    .bind(projectId, projectId)
    .all<MetricRow>();
  return result.results ?? [];
}

export interface MetricRow {
  id: string;
  project_id: string;
  key: string;
  version: number;
  label: string;
  unit: string;
  direction: 'higher-better' | 'lower-better' | 'neutral';
  definition_md: string;
  is_primary: number;
  sort_order: number;
  created_by: string;
  created_at: number;
  retired_at: number | null;
}

/** 新建项目时种入指标模板：让"口径"从第一天就有内容可改。 */
export async function seedMetrics(env: Env, projectId: string, userId: string): Promise<void> {
  const { METRIC_TEMPLATE } = await import('./metrics');
  const createdAt = nowSeconds();
  await env.DB.batch(
    METRIC_TEMPLATE.map((metric) =>
      env.DB.prepare(
        `INSERT INTO project_metrics (id, project_id, key, version, label, unit, direction, definition_md, is_primary, sort_order, created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId('met'),
        projectId,
        metric.key,
        metric.label,
        metric.unit,
        metric.direction,
        metric.definition_md,
        metric.is_primary ? 1 : 0,
        metric.sort_order,
        userId,
        createdAt,
      ),
    ),
  );
}
