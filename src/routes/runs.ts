import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate, authenticateOptional } from '../auth';
import { fail, optionalString, readJson, requireString } from '../http';
import { loadProject } from '../guards';
import { newId, nowSeconds } from '../ids';
import { externalRef, labLabel } from '../labs';
import {
  allocateLabNo,
  findProjectById,
  findRun,
  latestSnapshot,
  listRuns,
  listSotaEvents,
  recordEvent,
  snapshotEntries,
  type RunRow,
} from '../store';
import { viewRun } from './projects';
import { blobKey } from './snapshots';

export const projectRunRoutes = new Hono<{ Bindings: Env }>();

projectRunRoutes.get('/:slug/runs', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const runs = await listRuns(c.env, access.project.id, 200);
  return c.json({ runs: runs.map(viewRun) });
});

/** 开一轮实验：编号由项目原子分配，external_ref 是往 Cybion 开 Thread 的幂等键。 */
projectRunRoutes.post('/:slug/runs', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'runner', 'write');
  const payload = await readJson<Record<string, unknown>>(c);
  const note = optionalString(payload.note, 'note', 2000) ?? '';
  const requestedSnapshot = optionalString(payload.input_snapshot_id, 'input_snapshot_id', 80);
  const snapshot = requestedSnapshot
    ? await latestSnapshot(c.env, access.project.id)
    : await latestSnapshot(c.env, access.project.id);
  const inputSnapshotId = requestedSnapshot ?? snapshot?.id;
  if (!inputSnapshotId) return fail(409, 'no_snapshot', '项目还没有任何快照，先上传实验文件');

  const labNo = await allocateLabNo(c.env, access.project.id);
  const id = newId('run');
  const ref = externalRef(access.project.slug, labNo);
  const createdAt = nowSeconds();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO runs (id, project_id, lab_no, external_ref, state, input_snapshot_id, note, created_by, created_at)
       VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
    ).bind(id, access.project.id, labNo, ref, inputSnapshotId, note, principal.userId, createdAt),
    c.env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, 'run.proposed', ?, ?, ?)`).bind(
      newId('evt'),
      access.project.id,
      JSON.stringify({ run_id: id, lab: labLabel(labNo) }),
      principal.userId,
      createdAt,
    ),
  ]);
  const run = await findRun(c.env, id);
  return c.json({ run: viewRun(run as RunRow) }, 201);
});

projectRunRoutes.get('/:slug/leaderboard', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const runs = await listRuns(c.env, access.project.id, 200);
  const ranked = runs
    .filter((run) => run.state === 'frozen')
    .map((run) => ({
      lab: labLabel(run.lab_no),
      run_id: run.id,
      lab_no: run.lab_no,
      metrics: run.metrics_json ? JSON.parse(run.metrics_json) : null,
      gates: run.gates_json ? JSON.parse(run.gates_json) : [],
      settled_at: run.settled_at,
      sota: access.project.sota_run_id === run.id,
    }));
  return c.json({
    project: { slug: access.project.slug, name: access.project.name, sota_run_id: access.project.sota_run_id },
    leaderboard: ranked,
    excluded: runs
      .filter((run) => run.state === 'rejected')
      .map((run) => ({ lab: labLabel(run.lab_no), run_id: run.id, gates: run.gates_json ? JSON.parse(run.gates_json) : [] })),
  });
});

/** SOTA 是一个指针 + 一本账：指针回答现在是谁，账回答谁把它挤下去了。 */
projectRunRoutes.post('/:slug/sota', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'sota');
  const payload = await readJson<Record<string, unknown>>(c);
  const runId = requireString(payload.run_id, 'run_id', 80);
  const action = requireString(payload.action, 'action', 20);
  const reason = requireString(payload.reason, 'reason', 2000);
  if (!['promote', 'demote', 'exclude'].includes(action)) return fail(400, 'invalid_action', 'action 只能是 promote/demote/exclude');
  const run = await findRun(c.env, runId);
  if (!run || run.project_id !== access.project.id) return fail(404, 'not_found', 'run 不存在或不属于本项目');
  if (action === 'promote') {
    if (run.state !== 'frozen') return fail(409, 'not_frozen', '只有已冻结的 run 才能成为 SOTA');
    const gates = run.gates_json ? (JSON.parse(run.gates_json) as { pass?: boolean }[]) : [];
    if (gates.length === 0 || gates.some((gate) => gate.pass !== true)) {
      return fail(409, 'gates_failed', '门禁未全部通过，不能成为 SOTA');
    }
    await c.env.DB.prepare(`UPDATE projects SET sota_run_id = ? WHERE id = ?`).bind(run.id, access.project.id).run();
  } else if (action === 'demote' && access.project.sota_run_id === run.id) {
    await c.env.DB.prepare(`UPDATE projects SET sota_run_id = NULL WHERE id = ?`).bind(access.project.id).run();
  }
  await c.env.DB.prepare(
    `INSERT INTO sota_events (id, project_id, run_id, action, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('sot'), access.project.id, run.id, action, reason, principal.userId, nowSeconds())
    .run();
  return c.json({ ok: true, action, run: viewRun(run), sota_events: await listSotaEvents(c.env, access.project.id, 20) });
});

export const runRoutes = new Hono<{ Bindings: Env }>();

async function accessRun(env: Env, request: Request, runId: string, needed: 'reader' | 'runner' | 'maintainer' = 'reader') {
  const principal = needed === 'reader' ? await authenticateOptional(request, env) : await authenticate(request, env);
  const run = await findRun(env, runId);
  if (!run) fail(404, 'not_found', 'run 不存在');
  const project = await findProjectById(env, (run as RunRow).project_id);
  if (!project) fail(404, 'not_found', 'run 所属项目不存在');
  const access = await loadProject(env, project.slug, principal, needed, needed === 'reader' ? 'read' : 'write');
  return { run: run as RunRow, access, principal };
}

runRoutes.get('/:runId', async (c) => {
  const { run } = await accessRun(c.env, c.req.raw, c.req.param('runId'));
  return c.json({ run: viewRun(run) });
});

/** 把 Cybion Thread 绑到这一轮：Thread 才是真正的执行体。 */
runRoutes.post('/:runId/dispatch', async (c) => {
  const { run, access, principal } = await accessRun(c.env, c.req.raw, c.req.param('runId'), 'runner');
  const payload = await readJson<Record<string, unknown>>(c);
  const threadId = requireString(payload.cybion_thread_id, 'cybion_thread_id', 120);
  if (run.state === 'frozen' || run.state === 'rejected') return fail(409, 'already_settled', '该 run 已结算');
  await c.env.DB.prepare(`UPDATE runs SET state = 'running', cybion_thread_id = ? WHERE id = ?`).bind(threadId, run.id).run();
  await recordEvent(c.env, 'run.dispatched', access.project.id, principal?.userId ?? null, {
    run_id: run.id,
    cybion_thread_id: threadId,
  });
  const updated = await findRun(c.env, run.id);
  return c.json({ run: viewRun((updated ?? run) as RunRow) });
});

/**
 * 上报结论。门禁由平台记录并判定：全通过才 frozen，否则 rejected。
 * 机器可以上报 metrics/report/output_files，但不能自己宣布通过。
 */
runRoutes.post('/:runId/verdict', async (c) => {
  const { run, access, principal } = await accessRun(c.env, c.req.raw, c.req.param('runId'), 'runner');
  const payload = await readJson<Record<string, unknown>>(c);
  const gates = Array.isArray(payload.gates) ? payload.gates : [];
  if (gates.length === 0) return fail(400, 'missing_gates', '至少需要一条门禁记录');
  const normalized = gates.map((gate, index) => {
    const record = (gate ?? {}) as Record<string, unknown>;
    const ruleId = typeof record.rule_id === 'string' && record.rule_id ? record.rule_id : `gate-${index + 1}`;
    return {
      rule_id: ruleId,
      pass: record.pass === true,
      evidence: typeof record.evidence === 'string' ? record.evidence : null,
    };
  });
  const report = optionalString(payload.report_md, 'report_md', 200000) ?? null;
  const metrics = payload.metrics ?? null;
  if (metrics !== null && (typeof metrics !== 'object' || Array.isArray(metrics))) {
    return fail(400, 'invalid_metrics', 'metrics 必须是对象');
  }
  const outputFiles = payload.output_files;
  let outputSnapshotId: string | null = run.output_snapshot_id;
  if (outputFiles && typeof outputFiles === 'object' && !Array.isArray(outputFiles)) {
    const entries = Object.entries(outputFiles as Record<string, unknown>).map(([path, sha]) => ({
      path,
      sha: String(sha).toLowerCase(),
    }));
    if (entries.length > 0) {
      const shas = [...new Set(entries.map((entry) => entry.sha))];
      const placeholders = shas.map(() => '?').join(',');
      const known = await c.env.DB.prepare(
        `SELECT b.sha256 AS sha256, b.size AS size FROM blobs b JOIN project_blobs pb ON pb.sha256 = b.sha256
          WHERE pb.project_id = ? AND b.sha256 IN (${placeholders})`,
      )
        .bind(access.project.id, ...shas)
        .all<{ sha256: string; size: number }>();
      const sizes = new Map((known.results ?? []).map((row) => [row.sha256, row.size]));
      if (entries.some((entry) => !sizes.has(entry.sha))) return fail(400, 'unknown_blob', 'output_files 里有未上传的 blob');
      const { treeSha } = await import('../labs');
      const tree = await treeSha(entries.map((entry) => ({ path: entry.path, sha256: entry.sha })));
      const snapshotId = newId('snp');
      const createdAt = nowSeconds();
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO snapshots (id, project_id, parent_id, tree_sha, message, author_user_id, created_at, frozen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(snapshotId, access.project.id, run.input_snapshot_id, tree, `output of ${labLabel(run.lab_no)}`, principal?.userId ?? run.created_by, createdAt, createdAt),
        ...entries.map((entry) =>
          c.env.DB.prepare(`INSERT INTO snapshot_entries (snapshot_id, path, sha256, size) VALUES (?, ?, ?, ?)`).bind(
            snapshotId,
            entry.path,
            entry.sha,
            sizes.get(entry.sha) ?? 0,
          ),
        ),
      ]);
      outputSnapshotId = snapshotId;
    }
  }
  const allPass = normalized.every((gate) => gate.pass);
  const state = allPass ? 'frozen' : 'rejected';
  await c.env.DB.prepare(
    `UPDATE runs SET state = ?, gates_json = ?, metrics_json = ?, report_md = ?, output_snapshot_id = ?, settled_at = ? WHERE id = ?`,
  )
    .bind(
      state,
      JSON.stringify(normalized),
      metrics === null ? null : JSON.stringify(metrics),
      report,
      outputSnapshotId,
      nowSeconds(),
      run.id,
    )
    .run();
  await recordEvent(c.env, `run.${state}`, access.project.id, principal?.userId ?? null, {
    run_id: run.id,
    gates: normalized.map((gate) => ({ rule_id: gate.rule_id, pass: gate.pass })),
  });
  const updated = await findRun(c.env, run.id);
  const outputEntries = outputSnapshotId ? await snapshotEntries(c.env, outputSnapshotId) : [];
  return c.json({
    run: viewRun((updated ?? run) as RunRow),
    output_snapshot: outputSnapshotId
      ? { id: outputSnapshotId, files: outputEntries.length, blobs: outputEntries.map((entry) => ({ path: entry.path, sha256: entry.sha256 })) }
      : null,
  });
});

export { blobKey };
