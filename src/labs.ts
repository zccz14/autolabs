/**
 * 与存储无关的纯函数：路径规则、实验编号、快照身份。
 * 这些是 Phase 1 唯一能被单元测试完整覆盖的部分，故意不碰 D1/R2。
 */

/** 快照内路径：相对、无 `..`、无前导 `/`、长度受限。 */
const PATH_RE = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.\.?(\/|$))[A-Za-z0-9._\-\/]{1,240}$/;

export function assertPath(path: string): void {
  if (!PATH_RE.test(path)) {
    throw new Error(`非法路径：${path}（要求相对路径、不含 ..、只用 [A-Za-z0-9._-/]、≤240 字符）`);
  }
}

/** lab-0007：编号属于项目，永不复用。 */
export function labLabel(labNo: number): string {
  if (!Number.isInteger(labNo) || labNo < 1) throw new Error(`非法实验编号：${labNo}`);
  return `lab-${String(labNo).padStart(4, '0')}`;
}

/** Cybion Thread 的 external_ref，是开 Thread 的幂等键。 */
export function externalRef(slug: string, labNo: number): string {
  return `autolabs:${slug}:${labLabel(labNo)}`;
}

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * 快照身份：对排序后的 `path\0sha\n` 求 sha256。
 * 同一批文件永远得到同一个 tree_sha，与上传顺序无关。
 */
export async function treeSha(entries: { path: string; sha256: string }[]): Promise<string> {
  const canonical = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}\u0000${entry.sha256}`)
    .join('\n');
  return sha256Hex(canonical);
}

/** 快照之间的路径级差异，给 UI 用。 */
export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
}

export function diffSnapshots(
  from: { path: string; sha256: string }[],
  to: { path: string; sha256: string }[],
): SnapshotDiff {
  const before = new Map(from.map((entry) => [entry.path, entry.sha256]));
  const after = new Map(to.map((entry) => [entry.path, entry.sha256]));
  const diff: SnapshotDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [path, sha] of after) {
    const previous = before.get(path);
    if (previous === undefined) diff.added.push(path);
    else if (previous !== sha) diff.changed.push(path);
    else diff.unchanged += 1;
  }
  for (const path of before.keys()) if (!after.has(path)) diff.removed.push(path);
  diff.added.sort();
  diff.removed.sort();
  diff.changed.sort();
  return diff;
}

/** 数据集 manifest 的身份：对排序后的 `path\0sha\0size` 求 sha256。 */
export async function manifestDigest(entries: { path: string; sha256: string; size: number }[]): Promise<string> {
  const canonical = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}\u0000${entry.sha256}\u0000${entry.size}`)
    .join('\n');
  return sha256Hex(canonical);
}

/** 指标键：小写字母开头，只允许小写字母、数字、下划线。 */
const METRIC_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

export function assertMetricKey(key: string): void {
  if (!METRIC_KEY_RE.test(key)) {
    throw new Error(`非法指标键：${key}（要求小写字母开头，仅含小写字母/数字/下划线，2-41 字符）`);
  }
}
