import type { Env } from './env';
import { nowSeconds } from './ids';
import { labLabel } from './labs';
import { currentMetrics, findSnapshot, recordEvent, type ProjectRow, type RunRow } from './store';
import { ensureIdentity, findIdentity, identityOf } from './exe-identity';
import { ackCall, dispatchShell, readOutcome } from './exe';
import { mintProjectToken } from './tokens';
import { LAB_MANIFEST_FILE, readLabManifest } from './lab-manifest';
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
  dirty: 'run.dirty',
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

export interface GateRecord {
  rule_id: string;
  pass: boolean;
  evidence: string | null;
}

export interface EvaluationJudgement {
  state: 'frozen' | 'rejected';
  gates: GateRecord[];
  missing: string[];
  unknown: string[];
  metricSet: { key: string; version: number }[];
}

/**
 * 一次评估该怎么结算：这是整条链路里唯一一次「判」，所以单独做成纯函数。
 *
 * 两条拒绝的理由不一样，别混成一句：
 *   - 报了项目没定义的 key：口径被污染，这一轮不能进地图；
 *   - 必报的没报全：口径之内但缺项，同样不算过。
 * 自测门禁原样带上——那是执行体自己跑过的证据，平台不替它重跑。
 */
export function judgeEvaluation(
  definitions: { key: string; version: number; required?: boolean | number }[],
  reported: Record<string, unknown>,
  selfGates: GateRecord[],
): EvaluationJudgement {
  const { metricSet, unknown } = matchMetrics(definitions, reported);
  if (definitions.length > 0 && unknown.length > 0) {
    return {
      state: 'rejected',
      gates: [
        ...selfGates,
        { rule_id: 'evaluation', pass: false, evidence: `评估器报了项目没定义的指标：${unknown.join(', ')}` },
      ],
      missing: [],
      unknown,
      metricSet,
    };
  }
  const missing = missingRequiredMetrics(definitions, reported);
  const gates: GateRecord[] = [
    ...selfGates.filter((gate) => gate.rule_id !== 'metrics-reported'),
    {
      rule_id: 'metrics-reported',
      pass: missing.length === 0,
      evidence:
        missing.length === 0
          ? `评估器产出了全部 ${definitions.filter((definition) => definition.required).length} 个必报指标`
          : `评估器没有产出：${missing.join(', ')}`,
    },
  ];
  return {
    state: gates.every((gate) => gate.pass) ? 'frozen' : 'rejected',
    gates,
    missing,
    unknown,
    metricSet,
  };
}

export interface EvalScriptInput {
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

/**
 * 派到设备上的那整段脚本。
 *
 * 它先干三件杂活，让评估命令本身只管算：建一个临时目录、把这一轮的快照拉下来解开、
 * 走进去。所以命令的工作目录是有定义的——`AUTOLABS_WORKDIR`，不用自己猜、也不用
 * 自己 mktemp。这也是「实验包」这个说法能成立的原因：包被展开成一个目录，命令在
 * 里面跑。
 */
export function buildEvalScript(input: EvalScriptInput): string {
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
  return [
    'set -e',
    ...Object.entries(vars).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    'AUTOLABS_WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/autolabs.XXXXXX")',
    'export AUTOLABS_WORKDIR',
    'AUTOLABS_ARCHIVE="$AUTOLABS_WORKDIR/.snapshot.tar.gz"',
    'curl -fsSL -H "Authorization: Bearer $AUTOLABS_TOKEN" "$AUTOLABS_SNAPSHOT_URL" -o "$AUTOLABS_ARCHIVE"',
    'tar -xzf "$AUTOLABS_ARCHIVE" -C "$AUTOLABS_WORKDIR"',
    'rm -f "$AUTOLABS_ARCHIVE"',
    'cd "$AUTOLABS_WORKDIR"',
    input.command,
  ].join('\n');
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

/**
 * 这个包不符合规范，算不出指标。
 *
 * 不记成 rejected：实验本身没输，输的是「它没说自己怎么被算」。也不烧尝试次数——
 * 等一个 Agent 把 lab.json 补上，补好之后这一轮自己就接着走。
 */
async function markDirty(env: Env, project: ProjectRow, run: RunRow, reason: string): Promise<void> {
  if (run.dirty_reason === reason) return;
  await env.DB.prepare(`UPDATE runs SET dirty_reason = ?, eval_error = NULL WHERE id = ?`).bind(reason, run.id).run();
  await recordEvent(env, EVAL_EVENTS.dirty, project.id, null, { run_id: run.id, reason });
}

/** 派一次评估。成功就把绑定信息落到 run 上；失败按次数记账，够次数就认账。 */
export async function dispatchEvaluation(env: Env, project: ProjectRow, run: RunRow): Promise<void> {
  const device = await evalDevice(env, project);
  if (!device) {
    await env.DB.prepare(`UPDATE runs SET eval_error = ? WHERE id = ? AND eval_call_id IS NULL`).bind(
      '项目还没有选评估设备：在设备页接入一台机器，然后在项目设置里选它',
      run.id,
    ).run();
    return;
  }

  const snapshot = await findSnapshot(env, run.eval_snapshot_id ?? run.input_snapshot_id);
  if (!snapshot) {
    await settleRejected(env, project, run, '输入快照不见了，这一轮无法评估');
    return;
  }

  // 算法跟着快照走：包里有 lab.json 就用它，没有才退回项目设置。
  // 包里写的坏掉时不悄悄退回——那会让「用的是哪套算法」变成一件猜的事。
  const manifest = await readLabManifest(env, snapshot.id);
  if (manifest.kind === 'invalid') {
    await markDirty(env, project, run, manifest.message);
    return;
  }
  if (manifest.kind === 'absent' && !project.eval_command?.trim()) {
    await markDirty(env, project, run, `快照根目录没有 ${LAB_MANIFEST_FILE}：这个包没说自己怎么被评估`);
    return;
  }
  const command = manifest.kind === 'ok' ? manifest.manifest.command : (project.eval_command?.trim() ?? '');
  const source = manifest.kind === 'ok' ? 'snapshot' : 'project';
  const timeoutSeconds =
    manifest.kind === 'ok' ? (manifest.manifest.timeoutSeconds ?? EVAL_TIMEOUT_SECONDS) : EVAL_TIMEOUT_SECONDS;

  const definitions = await currentMetrics(env, project.id);
  const identityRow = await ensureIdentity(env, project.owner_user_id);
  const caller = await identityOf(env, identityRow);
  const origin = env.APP_ORIGIN ?? 'https://autolabs.ntnl.io';

  // 只读、按这次调用的寿命到期的项目凭据：评估器要能把快照拉下来，除此之外什么都做不了。
  const minted = await mintProjectToken();
  const createdAt = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO project_tokens (id, project_id, label, secret_sha256, capabilities, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(minted.id, project.id, `评估 ${labLabel(run.lab_no)}`, minted.secretSha256, 'read', project.owner_user_id, createdAt, createdAt + timeoutSeconds)
    .run();

  const script = buildEvalScript({
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

  const dispatched = await dispatchShell(env, caller, device.address, script, {
    timeoutSeconds,
    ttlSeconds: timeoutSeconds,
  });

  if (dispatched.rejected) {
    await recordFailure(env, project, run, `评估命令没派出去（${dispatched.rejected.status}）：${dispatched.rejected.message}`, device);
    return;
  }

  await env.DB.prepare(
    `UPDATE runs SET eval_call_id = ?, eval_device_address = ?, eval_expires_at = ?, eval_dispatched_at = ?,
       eval_attempts = eval_attempts + 1, eval_error = NULL, eval_command = ?, eval_command_source = ? WHERE id = ?`,
  )
    .bind(dispatched.call.call_id, device.address, dispatched.call.expires_at, createdAt, command, source, run.id)
    .run();
  await recordEvent(env, EVAL_EVENTS.dispatched, project.id, null, {
    run_id: run.id,
    device_id: device.id,
    call_id: dispatched.call.call_id,
    lab: labLabel(run.lab_no),
    command_source: source,
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
  const selfGates = run.gates_json ? (JSON.parse(run.gates_json) as GateRecord[]) : [];
  const judgement = judgeEvaluation(definitions, reported, selfGates);
  const settledAt = nowSeconds();
  await env.DB.prepare(
    `UPDATE runs SET state = ?, gates_json = ?, metrics_json = ?, metric_set_json = ?, settled_at = ?, eval_error = NULL WHERE id = ?`,
  )
    .bind(
      judgement.state,
      JSON.stringify(judgement.gates),
      JSON.stringify(reported),
      JSON.stringify(judgement.metricSet),
      settledAt,
      run.id,
    )
    .run();
  await recordEvent(env, EVAL_EVENTS.settled, project.id, null, {
    run_id: run.id,
    state: judgement.state,
    missing: judgement.missing,
    unknown: judgement.unknown,
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
