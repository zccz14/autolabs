import type { Env } from './env';
import { nowSeconds } from './ids';
import { labLabel } from './labs';
import { currentMetrics, findSnapshot, recordEvent, type ProjectRow, type RunRow } from './store';
import { ensureIdentity, findIdentity, identityOf } from './exe-identity';
import { ackCall, dispatchShell, readOutcome } from './exe';
import { mintProjectToken } from './tokens';
import { matchMetrics, missingRequiredMetrics } from './metrics';

/**
 * 评估：把「这一轮到底赚了多少」交给一条命令，而不是交给一个模型。
 *
 * 分工是这样划的——run thread 只负责把实验实现出来、跑通冒烟与门禁自测，
 * 报完就交棒；指标由这个项目声明的一条评估命令在用户的机器上算出来。
 * AutoLabs 在这里只做三件事：派一条命令出去、把回传的指标收回来、按口径判门禁。
 *
 * 命令的契约只有两条，都写在派发时注入的环境变量里：
 *   输入：快照怎么拿（AUTOLABS_SNAPSHOT_URL + AUTOLABS_TOKEN）、
 *         用哪份数据（AUTOLABS_DATASET）、算哪几个指标（AUTOLABS_METRICS）；
 *   输出：进程最后一行打印一个 JSON 对象 {"metrics": {"<key>": <number>}}。
 */

export const EVAL_EVENTS = {
  dispatched: 'run.evaluation_dispatched',
  settled: 'run.evaluation_settled',
  failed: 'run.evaluation_failed',
} as const;

/** 一次调用的寿命上限就是 eXe 的上限：一小时。更长的回测得让命令自己后台跑。 */
export const EVAL_TIMEOUT_SECONDS = 3600;
/** 派不出去或算不出来，试这么多次就认账：把这一轮记成 rejected，别让它永远挂着。 */
export const EVAL_MAX_ATTEMPTS = 3;

/** 单引号包住，内部单引号按 POSIX 规矩断开重接。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface EvalCommandInput {
  origin: string;
  projectSlug: string;
  runId: string;
  lab: string;
  snapshotId: string;
  treeSha: string;
  token: string;
  dataset: string;
  metrics: { key: string; unit: string; direction: string; version: number }[];
  command: string;
}

export function buildEvalCommand(input: EvalCommandInput): string {
  const vars: Record<string, string> = {
    AUTOLABS_RUN_ID: input.runId,
    AUTOLABS_LAB: input.lab,
    AUTOLABS_PROJECT: input.projectSlug,
    AUTOLABS_SNAPSHOT_ID: input.snapshotId,
    AUTOLABS_SNAPSHOT_TREE: input.treeSha,
    AUTOLABS_SNAPSHOT_URL: `${input.origin}/api/v1/snapshots/${input.snapshotId}/tar.gz`,
    AUTOLABS_TOKEN: input.token,
    AUTOLABS_DATASET: input.dataset,
    AUTOLABS_METRICS: JSON.stringify(input.metrics),
  };
  const prefix = Object.entries(vars)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');
  return `${prefix} ${input.command}`;
}

/**
 * 从 stdout 里取指标：从最后一行往上找第一个能解析成 `{"metrics": {...}}` 的对象。
 * 允许命令打日志，但指标必须是最后说出来的一句话——这样「谁说的算」没有歧义。
 */
export function parseMetrics(stdout: string): Record<string, unknown> {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as { metrics?: unknown };
      if (parsed && typeof parsed === 'object' && parsed.metrics && typeof parsed.metrics === 'object' && !Array.isArray(parsed.metrics)) {
        return parsed.metrics as Record<string, unknown>;
      }
    } catch {
      // 不是这一行，继续往上找。
    }
  }
  throw new Error('评估器没有给出指标：命令的最后一行应该是一个 JSON 对象，形如 {"metrics":{"sharpe":1.93}}');
}

interface DeviceRef {
  id: string;
  address: string;
  label: string;
}

async function evalDevice(env: Env, project: ProjectRow): Promise<DeviceRef | null> {
  if (!project.eval_device_id) return null;
  return env.DB.prepare(`SELECT id, address, label FROM devices WHERE id = ? AND user_id = ?`)
    .bind(project.eval_device_id, project.owner_user_id)
    .first<DeviceRef>();
}

async function datasetLabel(env: Env, run: RunRow): Promise<string> {
  if (!run.dataset_pin_id) return '';
  const pin = await env.DB.prepare(`SELECT firmament_dataset_id, digest FROM dataset_pins WHERE id = ?`)
    .bind(run.dataset_pin_id)
    .first<{ firmament_dataset_id: string; digest: string }>();
  return pin ? `${pin.firmament_dataset_id}@${pin.digest.slice(0, 16)}` : '';
}

/** 派一次评估。成功就把绑定信息落到 run 上；失败按次数记账，够次数就认账。 */
export async function dispatchEvaluation(env: Env, project: ProjectRow, run: RunRow): Promise<void> {
  const command = project.eval_command?.trim();
  if (!command) {
    // 没配入口不是「失败」，是「还没准备好」：不烧尝试次数，配好了下一拍自己就动。
    await env.DB.prepare(`UPDATE runs SET eval_error = ? WHERE id = ? AND eval_call_id IS NULL`).bind(
      '项目还没有配置评估入口：在项目设置里写一条评估命令',
      run.id,
    ).run();
    return;
  }

  const device = await evalDevice(env, project);
  if (!device) {
    await env.DB.prepare(`UPDATE runs SET eval_error = ? WHERE id = ? AND eval_call_id IS NULL`).bind(
      '项目还没有选评估设备：在设备页接入一台机器，然后在项目设置里选它',
      run.id,
    ).run();
    return;
  }

  const snapshot = await findSnapshot(env, run.input_snapshot_id);
  if (!snapshot) {
    await settleRejected(env, project, run, '输入快照不见了，这一轮无法评估');
    return;
  }

  const definitions = await currentMetrics(env, project.id);
  const identityRow = await ensureIdentity(env, project.owner_user_id);
  const caller = await identityOf(env, identityRow);
  const origin = env.APP_ORIGIN ?? 'https://autolabs.ntnl.io';

  // 只读、两小时到期的项目凭据：评估器要能把快照拉下来，除此之外什么都做不了。
  const minted = await mintProjectToken();
  const createdAt = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO project_tokens (id, project_id, label, secret_sha256, capabilities, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(minted.id, project.id, `评估 ${labLabel(run.lab_no)}`, minted.secretSha256, 'read', project.owner_user_id, createdAt, createdAt + EVAL_TIMEOUT_SECONDS)
    .run();

  const shellCommand = buildEvalCommand({
    origin,
    projectSlug: project.slug,
    runId: run.id,
    lab: labLabel(run.lab_no),
    snapshotId: snapshot.id,
    treeSha: snapshot.tree_sha,
    token: minted.token,
    dataset: await datasetLabel(env, run),
    metrics: definitions.map((metric) => ({
      key: metric.key,
      unit: metric.unit,
      direction: metric.direction,
      version: metric.version,
    })),
    command,
  });

  const dispatched = await dispatchShell(env, caller, device.address, shellCommand, {
    timeoutSeconds: EVAL_TIMEOUT_SECONDS,
    ttlSeconds: EVAL_TIMEOUT_SECONDS,
  });

  if (dispatched.rejected) {
    await recordFailure(env, project, run, `评估命令没派出去（${dispatched.rejected.status}）：${dispatched.rejected.message}`, device);
    return;
  }

  await env.DB.prepare(
    `UPDATE runs SET eval_call_id = ?, eval_device_address = ?, eval_expires_at = ?, eval_dispatched_at = ?, eval_attempts = eval_attempts + 1, eval_error = NULL WHERE id = ?`,
  )
    .bind(dispatched.call.call_id, device.address, dispatched.call.expires_at, createdAt, run.id)
    .run();
  await recordEvent(env, EVAL_EVENTS.dispatched, project.id, null, {
    run_id: run.id,
    device_id: device.id,
    call_id: dispatched.call.call_id,
    lab: labLabel(run.lab_no),
  });
}

/** 收回一次评估：还没回音就等下一拍；回来了就按口径判门禁、结算。 */
export async function collectEvaluation(env: Env, project: ProjectRow, run: RunRow): Promise<void> {
  if (!run.eval_call_id || !run.eval_device_address || !run.eval_expires_at) return;
  const identityRow = await findIdentity(env, project.owner_user_id);
  if (!identityRow) return;
  const caller = await identityOf(env, identityRow);

  const outcome = await readOutcome(env, caller, {
    call_id: run.eval_call_id,
    caller: identityRow.address,
    device: run.eval_device_address,
    expires_at: run.eval_expires_at,
  });

  if (!outcome) {
    if (nowSeconds() <= run.eval_expires_at) return;
    await recordFailure(env, project, run, '评估命令一直没有回音：调用过期了，设备可能离线或没有信任这个地址', null);
    return;
  }

  await ackCall(env, caller, run.eval_call_id);
  if (!outcome.ok) {
    const detail = (outcome.stderr || outcome.stdout).trim().slice(0, 400);
    await recordFailure(env, project, run, `评估命令退出码 ${outcome.exitCode}：${detail || '没有输出'}`, null);
    return;
  }

  let reported: Record<string, unknown>;
  try {
    reported = parseMetrics(outcome.stdout);
  } catch (error) {
    await recordFailure(env, project, run, (error as Error).message, null);
    return;
  }

  const definitions = await currentMetrics(env, project.id);
  const { metricSet, unknown } = matchMetrics(definitions, reported);
  if (definitions.length > 0 && unknown.length > 0) {
    await settleRejected(env, project, run, `评估器报了项目没定义的指标：${unknown.join(', ')}`);
    return;
  }
  const missing = missingRequiredMetrics(definitions, reported);
  const gates = [
    ...((run.gates_json ? (JSON.parse(run.gates_json) as { rule_id: string; pass: boolean; evidence: string | null }[]) : [])),
    {
      rule_id: 'metrics-reported',
      pass: missing.length === 0,
      evidence:
        missing.length === 0
          ? `评估器产出了全部 ${definitions.filter((definition) => definition.required).length} 个必报指标`
          : `评估器没有产出：${missing.join(', ')}`,
    },
  ];
  const allPass = gates.every((gate) => gate.pass);
  const settledAt = nowSeconds();
  await env.DB.prepare(
    `UPDATE runs SET state = ?, gates_json = ?, metrics_json = ?, metric_set_json = ?, settled_at = ?, eval_error = NULL WHERE id = ?`,
  )
    .bind(
      allPass ? 'frozen' : 'rejected',
      JSON.stringify(gates),
      JSON.stringify(reported),
      JSON.stringify(metricSet),
      settledAt,
      run.id,
    )
    .run();
  await recordEvent(env, EVAL_EVENTS.settled, project.id, null, {
    run_id: run.id,
    state: allPass ? 'frozen' : 'rejected',
    missing,
  });
}

async function recordFailure(env: Env, project: ProjectRow, run: RunRow, message: string, device: DeviceRef | null): Promise<void> {
  const attempts = run.eval_attempts + 1;
  if (attempts >= EVAL_MAX_ATTEMPTS) {
    await settleRejected(env, project, run, `评估试了 ${attempts} 次都没成：${message}`);
    return;
  }
  await env.DB.prepare(
    `UPDATE runs SET eval_call_id = NULL, eval_device_address = NULL, eval_expires_at = NULL, eval_attempts = ?, eval_error = ? WHERE id = ?`,
  )
    .bind(attempts, message, run.id)
    .run();
  await recordEvent(env, EVAL_EVENTS.failed, project.id, null, {
    run_id: run.id,
    device_id: device?.id ?? null,
    attempts,
    error: message,
  });
}

async function settleRejected(env: Env, project: ProjectRow, run: RunRow, evidence: string): Promise<void> {
  const gates = [
    ...((run.gates_json ? (JSON.parse(run.gates_json) as { rule_id: string; pass: boolean; evidence: string | null }[]) : [])),
    { rule_id: 'evaluation', pass: false, evidence },
  ];
  await env.DB.prepare(
    `UPDATE runs SET state = 'rejected', gates_json = ?, settled_at = ?, eval_error = ?, eval_call_id = NULL WHERE id = ?`,
  )
    .bind(JSON.stringify(gates), nowSeconds(), evidence, run.id)
    .run();
  await recordEvent(env, EVAL_EVENTS.failed, project.id, null, { run_id: run.id, error: evidence });
}
