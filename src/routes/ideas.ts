import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate, authenticateOptional } from '../auth';
import { fail } from '../http';
import { loadProject } from '../guards';
import { CybionError, createThread, readThreadResponse, sendInput } from '../cybion';
import { cybionKeyFor } from '../credentials';
import { buildIdeaBrief, extractIdea } from '../ideas';
import { currentMetrics, listRuns, recordEvent } from '../store';
import { labLabel } from '../labs';
import { nowSeconds } from '../ids';
import { mintProjectToken } from '../tokens';

/**
 * 「下一轮做什么」：项目绑一条思路线程（master thread），它读整张研究地图、
 * 诊断这条线该往哪走，产出一段思路。
 *
 * 这条 Thread 是长期的：一个项目只开一条，之前的每次诊断都在它的上下文里，
 * 人随时可以进去干预。AutoLabs 只负责把地图给全、把回复取回来填进表单。
 */
export const projectIdeaRoutes = new Hono<{ Bindings: Env }>();

projectIdeaRoutes.post('/:slug/idea', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  // Thread 属于人：项目凭据没有 Cybion 账号，开不出来也读不回来。
  if (principal.kind !== 'user') return fail(403, 'user_only', '出主意要用登录身份，项目凭据不行');
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'runner', 'write');
  const project = access.project;

  try {
    const threadOwner = project.idea_thread_user_id ?? principal.userId;
    const apiKey = await cybionKeyFor(c.env, threadOwner);
    let threadId = project.idea_thread_id;
    if (!threadId) {
      const thread = await createThread(c.env, apiKey, {
        externalRef: `autolabs:${project.slug}:master`,
        title: `思路 · ${project.name}`,
      });
      threadId = thread.id;
      await c.env.DB.prepare(`UPDATE projects SET idea_thread_id = ?, idea_thread_user_id = ? WHERE id = ?`)
        .bind(threadId, principal.userId, project.id)
        .run();
      await recordEvent(c.env, 'idea.thread_created', project.id, principal.userId, { thread_id: threadId });
    }

    const [definitions, runs] = await Promise.all([currentMetrics(c.env, project.id), listRuns(c.env, project.id, 500)]);
    const sota = runs.find((run) => run.id === project.sota_run_id);
    // 只读令牌：地图只给速览，细节让它自己按需去取。每次请求换一把，旧的当场吊销。
    const ideaLabel = `idea · ${project.slug}`;
    const reader = await mintProjectToken();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE project_tokens SET revoked_at = ? WHERE project_id = ? AND label = ? AND revoked_at IS NULL`).bind(
        nowSeconds(),
        project.id,
        ideaLabel,
      ),
      c.env.DB.prepare(
        `INSERT INTO project_tokens (id, project_id, label, secret_sha256, capabilities, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'read', ?, ?, ?)`,
      ).bind(reader.id, project.id, ideaLabel, reader.secretSha256, principal.userId, nowSeconds(), nowSeconds() + 30 * 86400),
    ]);
    const brief = buildIdeaBrief({
      projectSlug: project.slug,
      projectName: project.name,
      description: project.description,
      labCount: project.lab_seq,
      sotaLab: sota ? labLabel(sota.lab_no) : null,
      metrics: definitions.map((definition) => ({
        key: definition.key,
        label: definition.label,
        unit: definition.unit,
        direction: definition.direction,
        required: Boolean(definition.required),
        is_primary: Boolean(definition.is_primary),
        definition_md: definition.definition_md,
      })),
      readerToken: reader.token,
      origin: new URL(c.req.url).origin,
      runs: [...runs]
        .sort((left, right) => left.lab_no - right.lab_no)
        .map((run) => ({
          lab: labLabel(run.lab_no),
          state: run.state,
          idea: run.idea_md,
          report: run.report_md,
          metrics: run.metrics_json ? (JSON.parse(run.metrics_json) as Record<string, unknown>) : null,
          gates: run.gates_json ? (JSON.parse(run.gates_json) as { rule_id: string; pass: boolean; evidence: string | null }[]) : [],
        })),
    });

    const request = await sendInput(c.env, apiKey, threadId, brief);
    await c.env.DB.prepare(`UPDATE projects SET idea_request_record_id = ?, idea_requested_at = ? WHERE id = ?`)
      .bind(request.record_idx, nowSeconds(), project.id)
      .run();
    await recordEvent(c.env, 'idea.requested', project.id, principal.userId, {
      thread_id: threadId,
      record_idx: request.record_idx,
    });
    return c.json({ thread_id: threadId, status: 'pending', record_idx: request.record_idx }, 202);
  } catch (error) {
    if (error instanceof CybionError) return fail(502, 'cybion_error', error.message);
    throw error;
  }
});

projectIdeaRoutes.get('/:slug/idea', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const project = access.project;
  if (!project.idea_thread_id) return c.json({ thread_id: null, status: 'none' });

  const viewer = principal?.kind === 'user' ? principal.userId : null;
  const owner = project.idea_thread_user_id ?? viewer;
  if (!owner) {
    return c.json({ thread_id: project.idea_thread_id, status: 'unknown', message: '这条思路线程不属于当前身份，读不到它的回复' });
  }
  try {
    const apiKey = await cybionKeyFor(c.env, owner);
    const response = await readThreadResponse(c.env, apiKey, project.idea_thread_id);
    // 回复必须是对「最近一次请求」的：旧回复不能当成新思路，否则表单会填上上一轮的内容。
    const fresh = response?.input_record_id != null && response.input_record_id === project.idea_request_record_id;
    // 只有这一轮真的说完了才算有结果：in_flight 时它可能连 assistant message 都还没写出来。
    const finished = fresh && response?.status === 'completed';
    const idea = finished ? extractIdea(response) : null;
    return c.json({
      thread_id: project.idea_thread_id,
      status: !fresh ? 'pending' : !finished ? 'pending' : idea ? 'ready' : 'empty',
      idea_md: idea,
      requested_at: project.idea_requested_at,
    });
  } catch (error) {
    if (error instanceof CybionError) {
      return c.json({ thread_id: project.idea_thread_id, status: 'error', message: error.message });
    }
    throw error;
  }
});
