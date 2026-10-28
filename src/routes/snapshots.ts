import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate, authenticateOptional } from '../auth';
import { fail, optionalString, readJson, requireRecord, requireString } from '../http';
import { loadProject } from '../guards';
import { newId, nowSeconds } from '../ids';
import { assertPath, diffSnapshots, sha256Hex, treeSha } from '../labs';
import { SNAPSHOT_TAR_LIMIT_BYTES, buildTarGz } from '../archive';
import {
  findSnapshot,
  listSnapshots,
  recordEvent,
  snapshotEntries,
  type EntryRow,
  type SnapshotRow,
} from '../store';
import { findProjectById } from '../store';
import { viewSnapshot, viewRun } from './projects';

const MAX_BLOB_BYTES = 8 * 1024 * 1024;

export function blobKey(sha256: string): string {
  return `blobs/${sha256.slice(0, 2)}/${sha256}`;
}

/** 项目内的 blob 与快照：上传走内容寻址，落库前必须校验 sha256。 */
export const projectSnapshotRoutes = new Hono<{ Bindings: Env }>();

projectSnapshotRoutes.put('/:slug/blobs/:sha', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'runner', 'write');
  const sha = c.req.param('sha').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) return fail(400, 'invalid_sha', 'sha 必须是 64 位十六进制');
  const body = new Uint8Array(await c.req.arrayBuffer());
  if (body.byteLength === 0) return fail(400, 'empty_blob', '文件内容为空');
  if (body.byteLength > MAX_BLOB_BYTES) return fail(413, 'blob_too_large', `单文件上限 ${MAX_BLOB_BYTES} 字节`);
  const actual = await sha256Hex(body.buffer);
  if (actual !== sha) return fail(400, 'sha_mismatch', `内容 sha 为 ${actual}，与声明的 ${sha} 不符`);
  await c.env.BLOBS.put(blobKey(sha), body);
  const createdAt = nowSeconds();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO blobs (sha256, size, created_at) VALUES (?, ?, ?)`).bind(
      sha,
      body.byteLength,
      createdAt,
    ),
    c.env.DB.prepare(`INSERT OR IGNORE INTO project_blobs (project_id, sha256, created_at) VALUES (?, ?, ?)`).bind(
      access.project.id,
      sha,
      createdAt,
    ),
  ]);
  return c.json({ sha256: sha, size: body.byteLength }, 201);
});

projectSnapshotRoutes.get('/:slug/blobs/:sha', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const sha = c.req.param('sha').toLowerCase();
  const owned = await c.env.DB.prepare(`SELECT 1 FROM project_blobs WHERE project_id = ? AND sha256 = ?`)
    .bind(access.project.id, sha)
    .first();
  if (!owned) return fail(404, 'not_found', '该项目下没有这个 blob');
  const object = await c.env.BLOBS.get(blobKey(sha));
  if (!object) return fail(404, 'not_found', 'blob 内容缺失');
  return new Response(object.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(object.size),
      etag: `"${sha}"`,
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
});

projectSnapshotRoutes.get('/:slug/snapshots', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const snapshots = await listSnapshots(c.env, access.project.id, 200);
  return c.json({ snapshots: snapshots.map(viewSnapshot) });
});

projectSnapshotRoutes.post('/:slug/snapshots', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'runner', 'write');
  const payload = await readJson<Record<string, unknown>>(c);
  const message = requireString(payload.message, 'message', 500);
  const parentId = optionalString(payload.parent_id, 'parent_id', 80) ?? null;
  const files = requireRecord(payload.files, 'files');
  const paths = Object.keys(files);
  if (paths.length === 0) return fail(400, 'empty_snapshot', '快照至少要包含一个文件');
  if (paths.length > 2000) return fail(400, 'too_many_files', '单个快照最多 2000 个文件');

  for (const path of paths) {
    try {
      assertPath(path);
    } catch (error) {
      return fail(400, 'invalid_path', (error as Error).message);
    }
  }

  if (parentId) {
    const parent = await findSnapshot(c.env, parentId);
    if (!parent || parent.project_id !== access.project.id) return fail(400, 'invalid_parent', '父快照不存在或不属于本项目');
    if (parent.frozen_at !== null) return fail(409, 'parent_frozen', '父快照已冻结，请从它派生新快照（冻结不等于可写）');
  }

  const shas = [...new Set(Object.values(files).map((value) => String(value).toLowerCase()))];
  const placeholders = shas.map(() => '?').join(',');
  const known = await c.env.DB.prepare(
    `SELECT b.sha256 AS sha256, b.size AS size
       FROM blobs b JOIN project_blobs pb ON pb.sha256 = b.sha256
      WHERE pb.project_id = ? AND b.sha256 IN (${placeholders})`,
  )
    .bind(access.project.id, ...shas)
    .all<{ sha256: string; size: number }>();
  const sizes = new Map((known.results ?? []).map((row) => [row.sha256, row.size]));
  const missing = shas.filter((sha) => !sizes.has(sha));
  if (missing.length > 0) return fail(400, 'unknown_blob', `以下 blob 尚未上传：${missing.slice(0, 5).join(', ')}`);

  const entries = paths.map((path) => {
    const sha = String(files[path]).toLowerCase();
    return { path, sha256: sha, size: sizes.get(sha) ?? 0 };
  });
  const snapshotSha = await treeSha(entries);
  const id = newId('snp');
  const createdAt = nowSeconds();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO snapshots (id, project_id, parent_id, tree_sha, message, author_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, access.project.id, parentId, snapshotSha, message, principal.userId, createdAt),
    c.env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, 'snapshot.created', ?, ?, ?)`).bind(
      newId('evt'),
      access.project.id,
      JSON.stringify({ snapshot_id: id, files: entries.length }),
      principal.userId,
      createdAt,
    ),
    ...entries.map((entry) =>
      c.env.DB.prepare(`INSERT INTO snapshot_entries (snapshot_id, path, sha256, size) VALUES (?, ?, ?, ?)`).bind(
        id,
        entry.path,
        entry.sha256,
        entry.size,
      ),
    ),
  ];
  await c.env.DB.batch(statements);

  const snapshots = await listSnapshots(c.env, access.project.id, 1);
  return c.json(
    {
      snapshot: {
        id,
        parent_id: parentId,
        tree_sha: snapshotSha,
        message,
        author_user_id: principal.userId,
        frozen: false,
        file_count: entries.length,
        created_at: createdAt,
      },
      previous: snapshots.length > 0 && snapshots[0]!.id !== id ? viewSnapshot(snapshots[0]!) : null,
    },
    201,
  );
});

/** 按 id 访问的快照：路径在 /api/v1/snapshots/:id。 */
export const snapshotRoutes = new Hono<{ Bindings: Env }>();

async function accessSnapshot(env: Env, request: Request, snapshotId: string, needed: 'reader' | 'runner' | 'maintainer' = 'reader') {
  const principal = needed === 'reader' ? await authenticateOptional(request, env) : await authenticate(request, env);
  const snapshot = await findSnapshot(env, snapshotId);
  if (!snapshot) fail(404, 'not_found', '快照不存在');
  const project = await findProjectById(env, snapshot.project_id);
  if (!project) fail(404, 'not_found', '快照所属项目不存在');
  const access = await loadProject(env, project.slug, principal, needed, needed === 'reader' ? 'read' : 'write');
  return { snapshot: snapshot as SnapshotRow, access, principal };
}

snapshotRoutes.get('/:snapshotId', async (c) => {
  const { snapshot } = await accessSnapshot(c.env, c.req.raw, c.req.param('snapshotId'));
  const entries = await snapshotEntries(c.env, snapshot.id);
  return c.json({ snapshot: viewSnapshot(snapshot), entries });
});

snapshotRoutes.get('/:snapshotId/manifest', async (c) => {
  const { snapshot } = await accessSnapshot(c.env, c.req.raw, c.req.param('snapshotId'));
  const entries = await snapshotEntries(c.env, snapshot.id);
  return c.json({
    snapshot_id: snapshot.id,
    tree_sha: snapshot.tree_sha,
    frozen: snapshot.frozen_at !== null,
    entries: entries.map((entry) => ({ path: entry.path, sha256: entry.sha256, size: entry.size })),
  });
});

snapshotRoutes.get('/:snapshotId/diff', async (c) => {
  const { snapshot } = await accessSnapshot(c.env, c.req.raw, c.req.param('snapshotId'));
  const againstId = c.req.query('against') ?? snapshot.parent_id;
  if (!againstId) return c.json({ against: null, diff: { added: [], removed: [], changed: [], unchanged: 0 } });
  const against = await findSnapshot(c.env, againstId);
  if (!against || against.project_id !== snapshot.project_id) return fail(400, 'invalid_against', '对比快照不存在或不属于本项目');
  const [from, to] = await Promise.all([snapshotEntries(c.env, against.id), snapshotEntries(c.env, snapshot.id)]);
  return c.json({ against: against.id, diff: diffSnapshots(from, to) });
});

snapshotRoutes.get('/:snapshotId/tar.gz', async (c) => {
  const { snapshot, access } = await accessSnapshot(c.env, c.req.raw, c.req.param('snapshotId'));
  if (c.req.query('against')) {
    // 增量同步：只打包 since 之后新增或变化的文件。先给 manifest，客户端自行决定拉哪些 blob。
    return fail(400, 'use_manifest', '增量请先取 manifest 再按 sha 拉取 blob');
  }
  const entries = await snapshotEntries(c.env, snapshot.id);
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total > SNAPSHOT_TAR_LIMIT_BYTES) {
    return fail(413, 'snapshot_too_large', `快照 ${total} 字节，超过打包上限 ${SNAPSHOT_TAR_LIMIT_BYTES}`);
  }
  const files = [];
  for (const entry of entries) {
    const object = await c.env.BLOBS.get(blobKey(entry.sha256));
    if (!object) return fail(500, 'blob_missing', `blob ${entry.sha256} 缺失`);
    files.push({ path: entry.path, bytes: new Uint8Array(await object.arrayBuffer()) });
  }
  const archive = await buildTarGz(files, snapshot.created_at);
  return new Response(archive, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="${access.project.slug}-${snapshot.id}.tar.gz"`,
      'x-snapshot-tree': snapshot.tree_sha,
    },
  });
});

snapshotRoutes.post('/:snapshotId/freeze', async (c) => {
  const { snapshot, access, principal } = await accessSnapshot(c.env, c.req.raw, c.req.param('snapshotId'), 'maintainer');
  if (snapshot.frozen_at !== null) return c.json({ snapshot: viewSnapshot(snapshot), already: true });
  const now = nowSeconds();
  await c.env.DB.prepare(`UPDATE snapshots SET frozen_at = ? WHERE id = ? AND frozen_at IS NULL`).bind(now, snapshot.id).run();
  await recordEvent(c.env, 'snapshot.frozen', access.project.id, principal?.userId ?? null, { snapshot_id: snapshot.id });
  const updated = await findSnapshot(c.env, snapshot.id);
  return c.json({ snapshot: viewSnapshot((updated ?? snapshot) as SnapshotRow) });
});

export { viewRun };
