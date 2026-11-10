import type { Env } from './env';
import { snapshotEntries } from './store';
import { blobKey } from './routes/snapshots';

/**
 * `lab.json`：一个实验包自己说明「怎么评估我」。
 *
 * 它像 `package.json` 那样待在包根目录，但只回答一个问题——把快照解到一个目录里
 * 之后，跑什么命令能算出这一轮的数字。这样算法跟着快照走：快照不可变，
 * 所以历史指标真的可以复算，而不是「用今天项目设置里那条命令重算一遍」。
 *
 * 最小的一份：
 *
 *   { "evaluate": "python -m qlabs.evaluate" }
 *
 * 也可以带上自己的超时（默认与上限都是一个小时，那是 eXe 的调用寿命）：
 *
 *   { "evaluate": { "command": "python -m qlabs.evaluate", "timeout_seconds": 1800 } }
 */

export const LAB_MANIFEST_FILE = 'lab.json';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MIN_TIMEOUT_SECONDS = 60;
export const MAX_TIMEOUT_SECONDS = 3600;

export interface LabManifest {
  command: string;
  /** null = 用默认值。 */
  timeoutSeconds: number | null;
}

export type LabManifestResult =
  | { kind: 'absent' }
  | { kind: 'ok'; manifest: LabManifest }
  | { kind: 'invalid'; message: string };

function invalid(message: string): LabManifestResult {
  return { kind: 'invalid', message };
}

export function parseLabManifest(text: string): LabManifestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid(`${LAB_MANIFEST_FILE} 不是合法 JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return invalid(`${LAB_MANIFEST_FILE} 顶层必须是一个对象`);
  }
  const evaluate = (parsed as Record<string, unknown>).evaluate;
  if (evaluate === undefined) {
    return invalid(`${LAB_MANIFEST_FILE} 里没有 evaluate：写一条命令，例如 {"evaluate": "python -m evaluate"}`);
  }

  let command: unknown = evaluate;
  let rawTimeout: unknown;
  if (typeof evaluate === 'object' && evaluate !== null && !Array.isArray(evaluate)) {
    command = (evaluate as Record<string, unknown>).command;
    rawTimeout = (evaluate as Record<string, unknown>).timeout_seconds;
  }
  if (typeof command !== 'string' || !command.trim()) {
    return invalid('evaluate 必须是命令字符串，或者 { "command": "…" } 对象');
  }

  let timeoutSeconds: number | null = null;
  if (rawTimeout !== undefined && rawTimeout !== null) {
    if (typeof rawTimeout !== 'number' || !Number.isFinite(rawTimeout) || rawTimeout <= 0) {
      return invalid('timeout_seconds 必须是一个正数');
    }
    timeoutSeconds = Math.min(Math.max(Math.round(rawTimeout), MIN_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS);
  }

  return { kind: 'ok', manifest: { command: command.trim(), timeoutSeconds } };
}

/** 只看快照根目录：`lab.json` 是一个包的门面，不该从子目录里翻出来。 */
export async function readLabManifest(env: Env, snapshotId: string): Promise<LabManifestResult> {
  const entries = await snapshotEntries(env, snapshotId);
  const entry = entries.find((item) => item.path === LAB_MANIFEST_FILE);
  if (!entry) return { kind: 'absent' };
  if (entry.size > MAX_MANIFEST_BYTES) {
    return invalid(`${LAB_MANIFEST_FILE} 有 ${entry.size} 字节，超过 ${MAX_MANIFEST_BYTES} 的上限`);
  }
  const object = await env.BLOBS.get(blobKey(entry.sha256));
  if (!object) return invalid(`${LAB_MANIFEST_FILE} 的内容在存储里找不到`);
  return parseLabManifest(await object.text());
}
