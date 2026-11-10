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
  findSnapshot,
  currentMetrics,
  latestSnapshot,
  listRuns,
  listSotaEvents,
  recordEvent,
  snapshotEntries,
  type RunRow,
} from '../store';
import { createThread, sendInput } from '../cybion';
import { callerOf, withCybionKey, type Caller } from '../credentials';
import { buildRunBrief, withExclusion } from '../runs';
import { readLabManifest } from '../lab-manifest';
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
/** 开一轮实验：编号由项目原子分配，external_ref 是往 Cybion 开 Thread 的幂等键。 */
projectRunRoutes.post('/:slug/runs', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'runner', 'write');
  const payload = await readJson<Record<string, unknown>>(c);
  const note = optionalString(payload.note, 'note', 2000) ?? '';
  const idea = optionalString(payload.idea_md, 'idea_md', 20000) ?? null;
  const run = await openRun(c.env, access.project, principal.userId, { idea, note });
  if (!run) return fail(409, 'no_snapshot', '项目还没有任何快照，先上传实验文件');
  // 开一轮实验＝真的把这一轮发出去：建 Thread、发首条输入、置 dispatched。
  // 发不出去就留在 proposed，把原文回给调用方——不假装发出去了。
  const dispatched = await startRunThread(
    c.env,
    new URL(c.req.url).origin,
    access.project,
    run,
    principal.userId,
    callerOf(c.req.raw, principal),
  )
    .then((started) => ({ ok: true as const, run: started }))
    .catch(async (error: Error) => {
      await recordEvent(c.env, 'run.dispatch_failed', access.project.id, principal.userId, {
        run_id: run.id,
        error: error.message,
      });
      return { ok: false as const, error: error.message };
    });
  const latest = dispatched.ok ? dispatched.run : ((await findRun(c.env, run.id)) as RunRow);
  return c.json(
    {
      run: viewRun(latest),
      dispatch: dispatched.ok ? { ok: true } : { ok: false, error: dispatched.error },
    },
    201,
  );
});

/**
 * 登记一轮实验（state=proposed）。研究循环与界面上的「开新一轮实验」共用这一段，
 * 免得两边的编号、快照、事件写法各走各的。
 */
export async function openRun(
  env: Env,
  project: { id: string; slug: string; dataset_pin_id: string | null },
  actorUserId: string,
  input: { idea: string | null; note: string },
): Promise<RunRow | null> {
  const snapshot = await latestSnapshot(env, project.id);
  if (!snapshot) return null;
  const labNo = await allocateLabNo(env, project.id);
  const id = newId('run');
  const ref = externalRef(project.slug, labNo);
  const createdAt = nowSeconds();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO runs (id, project_id, lab_no, external_ref, state, input_snapshot_id, dataset_pin_id, note, idea_md, created_by, created_at)
       VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`,
    ).bind(id, project.id, labNo, ref, snapshot.id, project.dataset_pin_id, input.note, input.idea, actorUserId, createdAt),
    env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, 'run.proposed', ?, ?, ?)`).bind(
      newId('evt'),
      project.id,
      JSON.stringify({ run_id: id, lab: labLabel(labNo) }),
      actorUserId,
      createdAt,
    ),
  ]);
  return (await findRun(env, id)) as RunRow;
}

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
  const definitions = await currentMetrics(c.env, access.project.id);
  return c.json({
    project: { slug: access.project.slug, name: access.project.name, sota_run_id: access.project.sota_run_id },
    metrics: definitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      direction: definition.direction,
      is_primary: Boolean(definition.is_primary),
      version: definition.version,
    })),
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
  } else if (action === 'exclude') {
    // 排除＝这个结论不算数：state 落 rejected，榜单上不再出现它。
    // 只追加一条 excluded 门禁与一条账本事件，指标、报告、原门禁一个字节都不改。
    const gates = run.gates_json ? (JSON.parse(run.gates_json) as { rule_id: string; pass: boolean; evidence: string | null }[]) : [];
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE runs SET state = 'rejected', gates_json = ?, settled_at = COALESCE(settled_at, ?) WHERE id = ?`).bind(
        JSON.stringify(withExclusion(gates, reason)),
        nowSeconds(),
        run.id,
      ),
      c.env.DB.prepare(`UPDATE projects SET sota_run_id = NULL WHERE id = ? AND sota_run_id = ?`).bind(access.project.id, run.id),
    ]);
    await recordEvent(c.env, 'run.rejected', access.project.id, principal.userId, {
      run_id: run.id,
      action: 'exclude',
      reason,
    });
  }
  await c.env.DB.prepare(
    `INSERT INTO sota_events (id, project_id, run_id, action, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('sot'), access.project.id, run.id, action, reason, principal.userId, nowSeconds())
    .run();
  const latest = (await findRun(c.env, run.id)) ?? run;
  return c.json({ ok: true, action, run: viewRun(latest as RunRow), sota_events: await listSotaEvents(c.env, access.project.id, 20) });
});

export const runRoutes = new Hono<{ Bindings: Env }>();

async function accessRun(env: Env, request: Request, runId: string, needed: 'reader' | 'runner' | 'maintainer' = 'reader') {
  const principal = needed === 'reader' ? await authenticateOptional(request, env) : await authenticate(request, env);
  const run = await findRun(env, runId);
  if (!run) fail(404, 'not_found', 'run 不存在');
  const project = await findProjectById(env, (run as RunRow).project_id);
  if (!project) fail(404, 'not_found', 'run 所属项目不存在');
  const access = await loadProject(env, project.slug, principal, needed, needed === 'reader' ? 'read' : 'write');
  // 一轮实验的执行体只能结算它自己那一轮：Thread 与 run 的绑定就是授权本身。
  if (principal?.kind === 'thread' && principal.runId !== (run as RunRow).id) {
    fail(403, 'forbidden', '这条 Thread 只能操作它自己那一轮实验');
  }
  return { run: run as RunRow, access, principal };
}

runRoutes.get('/:runId', async (c) => {
  const { run } = await accessRun(c.env, c.req.raw, c.req.param('runId'));
  return c.json({ run: viewRun(run) });
});

/**
 * 把这一轮发出去。没有 Thread 就开一个，然后发首条输入，最后置 dispatched。
 *
 * 分三步落库是为了失败可重试：Thread 一建出来就先记下 id，重试时复用它。
 * external_ref 只是给人看的集成标记，Cybion 不拿它去重，所以重试绝不能再开一个。
 */
export async function startRunThread(
  env: Env,
  origin: string,
  project: { id: string; slug: string; name: string; run_model?: string | null },
  run: RunRow,
  actorUserId: string,
  caller: Caller,
): Promise<RunRow> {
  const definitions = await currentMetrics(env, project.id);
  const brief = buildRunBrief({
    lab: labLabel(run.lab_no),
    projectSlug: project.slug,
    projectName: project.name,
    runId: run.id,
    externalRef: run.external_ref,
    origin,
    snapshotId: run.input_snapshot_id,
    treeSha: await snapshotTreeSha(env, run.input_snapshot_id),
    idea: run.idea_md,
    note: run.note,
    metrics: definitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      direction: definition.direction,
      required: Boolean(definition.required),
      definition_md: definition.definition_md,
    })),
  });
  // Thread 必须开在这一轮创建者名下：用他的 Cybion key，AutoLabs 在后台保证这把
  // key 存在（第一次要用时才换，key 失效了当场重换），界面上没有这件事。
  let threadId: string | null = run.cybion_thread_id;
  await withCybionKey(env, run.created_by, caller, async (apiKey) => {
    if (!threadId) {
      const thread = await createThread(env, apiKey, {
        externalRef: run.external_ref,
        title: `${labLabel(run.lab_no)} · ${project.name}`,
        model: project.run_model,
      });
      // 一建出来就先落库：重试复用它，绝不在 Cybion 里开出第二个 Thread。
      threadId = thread.id;
      await env.DB.prepare(`UPDATE runs SET cybion_thread_id = ? WHERE id = ?`).bind(threadId, run.id).run();
    }
    await sendInput(env, apiKey, threadId, brief);
  });
  await env.DB.batch([
    env.DB.prepare(`UPDATE runs SET state = 'dispatched' WHERE id = ? AND state = 'proposed'`).bind(run.id),
    env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, 'run.dispatched', ?, ?, ?)`).bind(
      newId('evt'),
      project.id,
      JSON.stringify({ run_id: run.id, lab: labLabel(run.lab_no), cybion_thread_id: threadId }),
      actorUserId,
      nowSeconds(),
    ),
  ]);
  const updated = await findRun(env, run.id);
  return (updated ?? run) as RunRow;
}

/** 发出去的 brief 要写清快照的 tree_sha，好让执行体核对它拿到的文件对不对。 */
async function snapshotTreeSha(env: Env, snapshotId: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT tree_sha FROM snapshots WHERE id = ?`).bind(snapshotId).first<{ tree_sha: string }>();
  return row?.tree_sha ?? '';
}

/** 发一次。不带 thread id 就是「真的发出去」；带 thread id 是换绑到已有的 Thread。 */
runRoutes.post('/:runId/dispatch', async (c) => {
  const { run, access, principal: actor } = await accessRun(c.env, c.req.raw, c.req.param('runId'), 'runner');
  // 'runner' 一定带了身份；accessRun 的返回类型为了 reader 场景才允许 null。
  const principal = actor!;
  const raw = await c.req.text();
  let payload: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return fail(400, 'invalid_json', '请求体必须是 JSON');
    }
  }
  if (run.state === 'frozen' || run.state === 'rejected') return fail(409, 'already_settled', '该 run 已结算');
  const threadId = optionalString(payload.cybion_thread_id, 'cybion_thread_id', 120);
  if (threadId) {
    await c.env.DB.prepare(`UPDATE runs SET state = 'dispatched', cybion_thread_id = ? WHERE id = ?`).bind(threadId, run.id).run();
    await recordEvent(c.env, 'run.dispatched', access.project.id, principal.userId, {
      run_id: run.id,
      cybion_thread_id: threadId,
      rebind: true,
    });
    const updated = await findRun(c.env, run.id);
    return c.json({ run: viewRun((updated ?? run) as RunRow), dispatch: { ok: true } });
  }
  try {
    const started = await startRunThread(
      c.env,
      new URL(c.req.url).origin,
      access.project,
      run,
      principal.userId,
      callerOf(c.req.raw, principal),
    );
    return c.json({ run: viewRun(started), dispatch: { ok: true } });
  } catch (error) {
    await recordEvent(c.env, 'run.dispatch_failed', access.project.id, principal.userId, {
      run_id: run.id,
      error: (error as Error).message,
    });
    const latest = (await findRun(c.env, run.id)) ?? run;
    return c.json({ run: viewRun(latest as RunRow), dispatch: { ok: false, error: (error as Error).message } });
  }
});

/**
 * 上报结论。门禁由平台记录并判定：全通过才 frozen，否则 rejected。
 * 机器可以上报 metrics/report/output_files，但不能自己宣布通过。
 */
/**
 * 实验做完了。这是执行体能说的最后一件事：把实验实现出来、跑通冒烟、自己过一遍门禁，
 * 然后交棒。**指标不在这里**——它由评估器在用户自己的机器上算出来，见 src/evaluation.ts。
 *
 * 交棒之后这一轮进 evaluating：等一条命令把数字算出来，等不到就按次数记账，
 * 够次数了记成 rejected，不留一个永远挂着的行。
 */
runRoutes.post('/:runId/implemented', async (c) => {
  const { run, access, principal } = await accessRun(c.env, c.req.raw, c.req.param('runId'), 'runner');
  if (['frozen', 'rejected', 'lost'].includes(run.state)) {
    return fail(409, 'already_settled', '这一轮已经结算了：要重跑就开新一轮，历史行不覆盖');
  }
  const payload = await readJson<Record<string, unknown>>(c);
  if (payload.metrics !== undefined) {
    return fail(
      400,
      'metrics_not_accepted',
      '指标不由执行体上报：做完了就报「实现完成」，数字由评估器算。这一轮会进 evaluating 等评估结果。',
    );
  }
  const gates = Array.isArray(payload.gates) ? payload.gates : [];
  if (gates.length === 0) return fail(400, 'missing_gates', '至少需要一条门禁自测记录');
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
  // 思路可以在这时补写，但不能覆盖已经写下的那一条。
  const idea = optionalString(payload.idea_md, 'idea_md', 20000) ?? run.idea_md;
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
  // 自测门禁全过才算「实现完成」；有一条没过就是这一轮实验本身不成立，直接 rejected。
  const allPass = normalized.every((gate) => gate.pass);
  const state = allPass ? 'evaluating' : 'rejected';
  await c.env.DB.prepare(
    `UPDATE runs SET state = ?, gates_json = ?, report_md = ?, idea_md = ?, output_snapshot_id = ?, eval_error = ?, settled_at = ? WHERE id = ?`,
  )
    .bind(state, JSON.stringify(normalized), report, idea, outputSnapshotId, allPass ? null : null, allPass ? null : nowSeconds(), run.id)
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

/**
 * 修复交回来了：这一轮的包补上了 lab.json。
 *
 * 修好的包就是这一轮的代码，所以替换 `input_snapshot_id`——Soul 第 6 条允许
 * 「结算之前，为了合规可以改代码」。核两件事：派生自原快照、lab.json 真能解析。
 */
runRoutes.post('/:runId/repaired', async (c) => {
  const { run, access, principal } = await accessRun(c.env, c.req.raw, c.req.param('runId'), 'runner');
  const payload = await readJson<Record<string, unknown>>(c);
  const snapshotId = requireString(payload.snapshot_id, 'snapshot_id', 80);
  const snapshot = await findSnapshot(c.env, snapshotId);
  if (!snapshot || snapshot.project_id !== access.project.id) return fail(404, 'unknown_snapshot', '没有这份快照');
  if (['frozen', 'rejected', 'lost'].includes(run.state)) {
    return fail(409, 'already_settled', '这一轮已经结算了：合法的实验是事实，不再改');
  }
  if (snapshot.parent_id !== run.input_snapshot_id) {
    return fail(400, 'not_derived', `修复快照必须从这一轮的快照派生：parent_id 要指向 ${run.input_snapshot_id}`);
  }
  const manifest = await readLabManifest(c.env, snapshot.id);
  if (manifest.kind !== 'ok') {
    return fail(
      400,
      'invalid_manifest',
      manifest.kind === 'invalid' ? manifest.message : '派生出来的快照里没有 lab.json',
    );
  }
  await c.env.DB.prepare(`UPDATE runs SET input_snapshot_id = ?, dirty_reason = NULL, eval_error = NULL WHERE id = ?`)
    .bind(snapshot.id, run.id)
    .run();
  await recordEvent(c.env, 'run.repaired', access.project.id, principal?.userId ?? null, {
    run_id: run.id,
    from_snapshot_id: run.input_snapshot_id,
    to_snapshot_id: snapshot.id,
    command: manifest.manifest.command,
  });
  const updated = await findRun(c.env, run.id);
  return c.json({ run: viewRun((updated ?? run) as RunRow) });
});

export { blobKey };
