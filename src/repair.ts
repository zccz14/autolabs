import type { Env } from './env';
import { nowSeconds } from './ids';
import { labLabel } from './labs';
import { findProjectById, recordEvent, type ProjectRow, type RunRow } from './store';
import { createThread, sendInput } from './cybion';
import { withCybionKey, type Caller } from './credentials';
import { LAB_MANIFEST_FILE } from './lab-manifest';
import { LAB_MANIFEST_SPEC } from './lab-spec';

/**
 * 把不符合规范的包交给一个 Agent 去修。
 *
 * 扫的是「所有标了脏的行」，不看 state：需要修的既可能是还没结算的（改代码），
 * 也可能是复算才发现不合规的已结算行（只挂评估树）。哪一种是 `/repaired` 去判的。
 *
 * 只修一件事：补 `lab.json`（或者改对）。不碰实验内容——那是上一轮的执行体写的，
 * 已经进了快照。所以修复只补入口声明，不碰实验内容——修完的包就是这一轮的代码，
 * 直接替换 `input_snapshot_id`，旧树记进事件。
 *
 * 修完还得人说一句「改用它」：`POST /runs/{id}/repaired`。平台会核对它是派生、
 * 且 lab.json 真能解析，才认。
 */

export const REPAIR_EVENTS = {
  started: 'run.repair_started',
  failed: 'run.repair_failed',
} as const;

/** 开一条、再催一条，够了。修不好就该人看，而不是一直烧 token。 */
export const REPAIR_MAX_ATTEMPTS = 2;
const REPAIR_COOLDOWN_SECONDS = 600;

export interface RepairBriefInput {
  origin: string;
  projectSlug: string;
  projectName: string;
  runId: string;
  lab: string;
  snapshotId: string;
  treeSha: string;
  reason: string;
  attempt: number;
}

export function buildRepairBrief(input: RepairBriefInput): string {
  const base = input.origin;
  return `# ${input.lab} · 这个包不符合规范

你被派来修一样很具体的东西。

这一轮实验已经做完了，但它卡在 \`dirty\`：**平台算不出它的指标**，因为这个包没有说清楚自己怎么被评估。

> ${input.reason}

## 只补这个文件，别改实验

不要动任何实验代码、数据或结论。要做的只有一件事：在包根目录放一份 \`${LAB_MANIFEST_FILE}\`（或者把已经有的那份改对）。

## 规范

${LAB_MANIFEST_SPEC}

## 这一轮的包

| | |
| --- | --- |
| run | \`${input.runId}\` |
| 项目 | ${input.projectName}（\`${input.projectSlug}\`） |
| 快照 | \`${input.snapshotId}\`（tree \`${input.treeSha}\`） |

取文件（每次都要现签一张 60 秒的令牌：调用 Cybion 的 \`create_thread_token\`，放进 \`Authorization: Bearer\`）：

- 清单：\`GET ${base}/api/v1/snapshots/${input.snapshotId}/manifest\`
- 单个文件：\`GET ${base}/api/v1/projects/${input.projectSlug}/blobs/<sha256>\`
- 整包：\`GET ${base}/api/v1/snapshots/${input.snapshotId}/tar.gz\`

## 怎么交回去

1. 把写好的 \`${LAB_MANIFEST_FILE}\` 传上来：\`PUT ${base}/api/v1/projects/${input.projectSlug}/blobs/<sha256>\`
2. 从原快照**派生**一份新快照：

   \`\`\`http
   POST ${base}/api/v1/projects/${input.projectSlug}/snapshots
   \`\`\`

   \`\`\`json
   {
     "message": "补 ${LAB_MANIFEST_FILE}",
     "parent_id": "${input.snapshotId}",
     "files": { "（原快照里的每一个文件）": "<sha256>", "${LAB_MANIFEST_FILE}": "<sha256>" }
   }
   \`\`\`

   **快照是全量的**：先把 manifest 取下来，把它列出的文件原样带上，再加上你补的这一个。少一个文件，这一轮就不是原来那一轮了。

3. 告诉平台改用新快照：

   \`\`\`http
   POST ${base}/api/v1/runs/${input.runId}/repaired
   \`\`\`

   \`\`\`json
   { "snapshot_id": "<新快照 id>" }
   \`\`\`

平台会核对两件事：新快照必须是从 \`${input.snapshotId}\` 派生的；里面的 \`${LAB_MANIFEST_FILE}\` 必须能解析通过。过了就回到 \`evaluating\`，下一拍自动算指标。

> 这是第 ${input.attempt} 次尝试。修不好这一轮就停在这里等人来看——不会一直重试。
`;
}

export type RepairAction = 'replace-input' | 'attach-eval-tree';

export type RepairPlan =
  | { ok: true; action: RepairAction }
  | { ok: false; code: 'not_derived' | 'invalid_manifest'; message: string };

const SETTLED_STATES = ['frozen', 'rejected', 'lost'];

/**
 * 补规范该改哪里，取决于这一轮结算了没有。
 *
 * - 还没结算：代码还没成为事实，直接替换 input_snapshot_id，旧树留痕；
 * - 已经结算：代码是事实，一个字不动，只挂一份合规的评估树，让它能复算。
 *
 * 两种情况都核同一件事：新快照必须是从这一轮现有的那份派生的，且 lab.json 能解析。
 */
export function planRepair(
  run: { state: string; input_snapshot_id: string; eval_snapshot_id: string | null },
  snapshot: { parent_id: string | null },
  manifest: { kind: 'absent' | 'ok' | 'invalid'; message?: string },
): RepairPlan {
  const base = run.eval_snapshot_id ?? run.input_snapshot_id;
  if (snapshot.parent_id !== base) {
    return { ok: false, code: 'not_derived', message: `修复快照必须从这一轮的快照派生：parent_id 要指向 ${base}` };
  }
  if (manifest.kind !== 'ok') {
    return {
      ok: false,
      code: 'invalid_manifest',
      message: manifest.kind === 'invalid' ? (manifest.message ?? 'lab.json 不合法') : '派生出来的快照里没有 lab.json',
    };
  }
  return { ok: true, action: SETTLED_STATES.includes(run.state) ? 'attach-eval-tree' : 'replace-input' };
}

export interface RepairOutcome {
  started: number;
  failed: number;
}

/** cron 的一拍：把该修的包交给该修的人。 */
export async function driveRepairs(env: Env): Promise<RepairOutcome> {
  const rows =
    (
      await env.DB.prepare(
        `SELECT * FROM runs
          WHERE dirty_reason IS NOT NULL
            AND repair_attempts < ?
            AND (repair_last_at IS NULL OR repair_last_at < ?)
          ORDER BY created_at ASC LIMIT 10`,
      )
        .bind(REPAIR_MAX_ATTEMPTS, nowSeconds() - REPAIR_COOLDOWN_SECONDS)
        .all<RunRow>()
    ).results ?? [];

  let started = 0;
  let failed = 0;
  for (const run of rows) {
    const project = await findProjectById(env, run.project_id);
    if (!project || !run.dirty_reason) continue;
    const attempt = run.repair_attempts + 1;
    try {
      await startRepairThread(env, project, run, attempt);
      started += 1;
    } catch (error) {
      failed += 1;
      const message = (error as Error).message;
      await env.DB.prepare(`UPDATE runs SET repair_attempts = ?, repair_last_at = ?, eval_error = ? WHERE id = ?`)
        .bind(attempt, nowSeconds(), `修复指令没发出去：${message}`, run.id)
        .run();
      await recordEvent(env, REPAIR_EVENTS.failed, project.id, null, { run_id: run.id, attempt, error: message });
    }
  }
  return { started, failed };
}

async function startRepairThread(env: Env, project: ProjectRow, run: RunRow, attempt: number): Promise<void> {
  const origin = env.APP_ORIGIN ?? 'https://autolabs.ntnl.io';
  const caller: Caller = { userId: run.created_by, jwt: null };
  const snapshot = await env.DB.prepare(`SELECT id, tree_sha FROM snapshots WHERE id = ?`)
    .bind(run.eval_snapshot_id ?? run.input_snapshot_id)
    .first<{ id: string; tree_sha: string }>();
  if (!snapshot) throw new Error('这一轮的快照不见了');

  const brief = buildRepairBrief({
    origin,
    projectSlug: project.slug,
    projectName: project.name,
    runId: run.id,
    lab: labLabel(run.lab_no),
    snapshotId: snapshot.id,
    treeSha: snapshot.tree_sha,
    reason: run.dirty_reason ?? '',
    attempt,
  });

  let threadId: string | null = run.repair_thread_id;
  await withCybionKey(env, run.created_by, caller, async (apiKey) => {
    if (!threadId) {
      const thread = await createThread(env, apiKey, {
        // 和这一轮的执行体分开：修复有它自己的目标，不该混进原来那段对话。
        externalRef: `${run.external_ref}:repair`,
        title: `修复 ${labLabel(run.lab_no)} · ${project.name}`,
        model: project.run_model,
      });
      threadId = thread.id;
      await env.DB.prepare(`UPDATE runs SET repair_thread_id = ? WHERE id = ?`).bind(threadId, run.id).run();
    }
    await sendInput(env, apiKey, threadId, brief);
  });

  await env.DB.prepare(`UPDATE runs SET repair_attempts = ?, repair_last_at = ? WHERE id = ?`)
    .bind(attempt, nowSeconds(), run.id)
    .run();
  await recordEvent(env, REPAIR_EVENTS.started, project.id, null, { run_id: run.id, attempt, thread_id: threadId });
}
