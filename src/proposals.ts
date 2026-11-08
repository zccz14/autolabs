import type { Env } from './env';
import type { Caller } from './credentials';
import { withCybionKey } from './credentials';
import { createThread, readThreadResponse, sendInput } from './cybion';
import { buildIdeaBrief, extractIdea } from './ideas';
import { currentMetrics, listRuns, recordEvent, type ProjectRow } from './store';
import { labLabel } from './labs';
import { nowSeconds } from './ids';

/**
 * 「下一轮做什么」：项目绑一条思路线程（master thread），它读地图、诊断这条线
 * 该往哪走，产出一段思路。
 *
 * 这里只有两只手：请它出主意、把它的回复读回来。谁来按这个按钮不重要——
 * 人点界面、或者研究循环自己转，走的都是同一段代码。
 */

export interface IdeaStatus {
  thread_id: string | null;
  status: 'none' | 'pending' | 'ready' | 'empty' | 'error' | 'unknown';
  idea_md: string | null;
  requested_at: number | null;
  /** 请求晚于最新一轮实验：地图没变，这一版思路还作数。 */
  fresh: boolean;
  message?: string;
}

/** 请 master thread 出主意：没有线程就先开一条，然后把地图速览发过去。 */
export async function requestIdea(
  env: Env,
  project: ProjectRow,
  caller: Caller,
  actorUserId: string,
  origin: string,
): Promise<{ threadId: string; recordIdx: number }> {
  const threadOwner = project.idea_thread_user_id ?? actorUserId;
  const [definitions, runs] = await Promise.all([currentMetrics(env, project.id), listRuns(env, project.id, 500)]);
  const sota = runs.find((run) => run.id === project.sota_run_id);

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
    origin,
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

  let threadId = project.idea_thread_id;
  const request = await withCybionKey(env, threadOwner, caller, async (apiKey) => {
    if (!threadId) {
      const thread = await createThread(env, apiKey, {
        externalRef: `autolabs:${project.slug}:master`,
        title: `思路 · ${project.name}`,
      });
      threadId = thread.id;
      await env.DB.prepare(`UPDATE projects SET idea_thread_id = ?, idea_thread_user_id = ? WHERE id = ?`)
        .bind(threadId, actorUserId, project.id)
        .run();
      await recordEvent(env, 'idea.thread_created', project.id, actorUserId, { thread_id: threadId });
    }
    return sendInput(env, apiKey, threadId, brief);
  });

  await env.DB.prepare(`UPDATE projects SET idea_request_record_id = ?, idea_requested_at = ? WHERE id = ?`)
    .bind(request.record_idx, nowSeconds(), project.id)
    .run();
  await recordEvent(env, 'idea.requested', project.id, actorUserId, { thread_id: threadId, record_idx: request.record_idx });
  return { threadId: threadId as string, recordIdx: request.record_idx };
}

/** 把 master thread 最近的回复读回来，并判断这一版思路还作不作数。 */
export async function readIdea(env: Env, project: ProjectRow, caller: Caller): Promise<IdeaStatus> {
  const threadId = project.idea_thread_id;
  if (!threadId) return { thread_id: null, status: 'none', idea_md: null, requested_at: null, fresh: false };

  const owner = project.idea_thread_user_id ?? caller.userId;
  if (!owner) return { thread_id: threadId, status: 'unknown', idea_md: null, requested_at: null, fresh: false };

  const newest = await env.DB.prepare(`SELECT MAX(created_at) AS created_at FROM runs WHERE project_id = ?`)
    .bind(project.id)
    .first<{ created_at: number | null }>();
  const fresh = project.idea_requested_at !== null && project.idea_requested_at >= (newest?.created_at ?? 0);

  const response = await withCybionKey(env, owner, caller, async (apiKey) => readThreadResponse(env, apiKey, threadId));
  // 回复必须是对「最近一次请求」的：旧回复不能当成新思路。
  const matched = response?.input_record_id != null && response.input_record_id === project.idea_request_record_id;
  // 只有这一轮真的说完了才算有结果：in_flight 时它可能连 assistant message 都还没写出来。
  const finished = matched && response?.status === 'completed';
  const idea = finished ? extractIdea(response) : null;
  return {
    thread_id: threadId,
    status: !matched ? 'pending' : !finished ? 'pending' : idea ? 'ready' : 'empty',
    idea_md: idea,
    requested_at: project.idea_requested_at,
    fresh,
  };
}
