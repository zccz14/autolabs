import { useQuery, useMutation } from '@tanstack/react-query';
import type { TokenView } from './tokens-format';

/** 只用到 session 的两个能力：结构类型，避免把 auth-mini 的完整类型拖进前端。 */
export interface SdkLike {
  session: {
    getState(): { accessToken?: string | null; expiresAt?: string | null };
    refresh(): Promise<{ accessToken?: string | null }>;
  };
}

async function accessToken(sdk: SdkLike): Promise<string> {
  const session = sdk.session.getState();
  if (!session.accessToken) throw new Error('Auth Mini 会话尚未就绪');
  const expiresAt = Date.parse(session.expiresAt ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000) {
    const refreshed = await sdk.session.refresh();
    if (!refreshed.accessToken) throw new Error('Auth Mini 刷新失败');
    return refreshed.accessToken;
  }
  return session.accessToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function api<T>(sdk: SdkLike, path: string, init?: RequestInit): Promise<T> {
  const send = async (token: string) =>
    fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  const first = await send(await accessToken(sdk));
  const response = first.status === 401 ? await send(await accessToken(sdk)) : first;
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const payload = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(payload.message ?? response.statusText, response.status, payload.error ?? 'error');
  }
  return body as T;
}

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'private' | 'public-read';
  lab_seq: number;
  next_lab: string;
  sota_run_id: string | null;
  owner_user_id: string;
  created_at: number;
  role: string;
  /** 跑实验的 Thread 用哪个模型；空表示跟随 Cybion 默认。 */
  run_model?: string | null;
  /** 研究循环：running 就一直推进，paused 就不开新实验。 */
  loop_state?: 'running' | 'paused';
  loop_run_id?: string | null;
  loop_error?: string | null;
  loop_started_at?: number | null;
  loop_paused_at?: number | null;
  loop_last_tick_at?: number | null;
}

export interface MetricView {
  key: string;
  version: number;
  label: string;
  unit: string;
  direction: 'higher-better' | 'lower-better' | 'neutral';
  definition_md: string;
  is_primary: boolean;
  required: boolean;
  sort_order: number;
}

export interface DatasetPinView {
  id: string;
  dataset_id: string;
  name: string;
  digest: string;
  file_count: number;
  bytes: number;
  verified: boolean;
  note: string;
  pinned_by: string;
  pinned_at: number;
}

export interface FirmamentDatasetView {
  id: string;
  name: string;
  description: string;
  tier: string;
  file_count: number;
  bytes: number;
  updated_at: number;
}

/** 发出这一轮的结果：发不出去时 ok=false，run 仍停在 proposed。 */
export interface DispatchOutcome {
  ok: boolean;
  error?: string;
}

export interface CreateRunResult {
  run: RunView;
  dispatch: DispatchOutcome;
}

export interface RunView {
  id: string;
  lab_no: number;
  lab: string;
  external_ref: string;
  state: 'proposed' | 'dispatched' | 'running' | 'evaluating' | 'frozen' | 'rejected' | 'lost';
  input_snapshot_id: string;
  output_snapshot_id: string | null;
  dataset_pin_id: string | null;
  metric_set: { key: string; version: number }[];
  cybion_thread_id: string | null;
  note: string;
  idea_md: string | null;
  report_md: string | null;
  metrics: Record<string, unknown> | null;
  gates: { rule_id: string; pass: boolean; evidence: string | null }[];
  created_at: number;
  settled_at: number | null;
}

export interface SnapshotView {
  id: string;
  parent_id: string | null;
  tree_sha: string;
  message: string;
  author_user_id: string;
  frozen: boolean;
  created_at: number;
}

export interface ProjectDetail {
  project: ProjectSummary & {
    run_count: number;
    snapshot_count: number;
    rules_snapshot_id: string | null;
    dataset_pin_id: string | null;
  };
  runs: RunView[];
  snapshots: SnapshotView[];
  sota_events: {
    id: string;
    run_id: string;
    lab: string | null;
    action: string;
    reason: string;
    actor_user_id: string;
    created_at: number;
  }[];
}

export function useProjects(sdk: SdkLike | null) {
  return useQuery({
    queryKey: ['projects'],
    enabled: Boolean(sdk),
    queryFn: ({ signal }) => api<{ projects: ProjectSummary[] }>(sdk as SdkLike, '/api/v1/projects', { signal }),
  });
}

export function useProject(sdk: SdkLike | null, slug: string | undefined) {
  return useQuery({
    queryKey: ['project', slug],
    enabled: Boolean(sdk && slug),
    queryFn: ({ signal }) => api<ProjectDetail>(sdk as SdkLike, `/api/v1/projects/${slug}`, { signal }),
  });
}

export function useRun(sdk: SdkLike | null, runId: string | undefined) {
  return useQuery({
    queryKey: ['run', runId],
    enabled: Boolean(sdk && runId),
    queryFn: ({ signal }) => api<{ run: RunView }>(sdk as SdkLike, `/api/v1/runs/${runId}`, { signal }),
  });
}

export function useSnapshotManifest(sdk: SdkLike | null, snapshotId: string | undefined) {
  return useQuery({
    queryKey: ['manifest', snapshotId],
    enabled: Boolean(sdk && snapshotId),
    queryFn: ({ signal }) =>
      api<{ entries: { path: string; sha256: string; size: number }[] }>(
        sdk as SdkLike,
        `/api/v1/snapshots/${snapshotId}/manifest`,
        { signal },
      ),
  });
}

export function useCreateProject(sdk: SdkLike | null) {
  return useMutation({
    mutationFn: (input: { slug: string; name: string; description: string; visibility: 'private' | 'public-read' }) =>
      api<{ project: ProjectSummary }>(sdk as SdkLike, '/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useCreateRun(sdk: SdkLike | null, slug: string) {
  return useMutation({
    // 思路是开 run 的必填项（ADR 0002）：由表单强制，API 仍保持可选，
    // 免得打断 scripts/smoke.sh 与既有的机器上报链路。
    // 创建就是发出：服务端建 Thread、发首条输入，发不出去会带回 dispatch.error。
    mutationFn: (input: { note: string; idea_md: string }) =>
      api<CreateRunResult>(sdk as SdkLike, `/api/v1/projects/${slug}/runs`, {
        method: 'POST',
        body: JSON.stringify({ note: input.note, idea_md: input.idea_md }),
      }),
  });
}

export function useFreezeSnapshot(sdk: SdkLike | null) {
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api<{ snapshot: SnapshotView }>(sdk as SdkLike, `/api/v1/snapshots/${snapshotId}/freeze`, { method: 'POST' }),
  });
}

export function useTokens(sdk: SdkLike | null, slug: string) {
  return useQuery({
    queryKey: ['tokens', slug],
    enabled: Boolean(sdk && slug),
    queryFn: ({ signal }) => api<{ tokens: TokenView[] }>(sdk as SdkLike, `/api/v1/projects/${slug}/tokens`, { signal }),
  });
}

export function useMintToken(sdk: SdkLike | null, slug: string) {
  return useMutation({
    mutationFn: (input: { label: string; capabilities?: string[]; expires_in_days?: number }) =>
      api<{ token: string; id: string; capabilities: string[]; expires_in_days: number }>(
        sdk as SdkLike,
        `/api/v1/projects/${slug}/tokens`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
  });
}

/** 吊销是唯一的回头路：令牌一死，用它签的请求立刻 401。 */
export function useRevokeToken(sdk: SdkLike | null, slug: string) {
  return useMutation({
    mutationFn: (tokenId: string) =>
      api<{ revoked: boolean }>(sdk as SdkLike, `/api/v1/projects/${slug}/tokens/${tokenId}/revoke`, { method: 'POST' }),
  });
}

export function useDispatchRun(sdk: SdkLike | null) {
  return useMutation({
    // 不带 threadId 就是「发出去」（已建过的 Thread 会复用）；带了就是换绑。
    mutationFn: (input: { runId: string; threadId?: string }) =>
      api<{ run: RunView; dispatch: DispatchOutcome }>(sdk as SdkLike, `/api/v1/runs/${input.runId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify(input.threadId ? { cybion_thread_id: input.threadId } : {}),
      }),
  });
}

export function useVerdict(sdk: SdkLike | null) {
  return useMutation({
    mutationFn: (input: { runId: string; payload: unknown }) =>
      api<{ run: RunView }>(sdk as SdkLike, `/api/v1/runs/${input.runId}/verdict`, {
        method: 'POST',
        body: JSON.stringify(input.payload),
      }),
  });
}

export function usePromoteSota(sdk: SdkLike | null, slug: string) {
  return useMutation({
    mutationFn: (input: { runId: string; reason: string }) =>
      api<unknown>(sdk as SdkLike, `/api/v1/projects/${slug}/sota`, {
        method: 'POST',
        body: JSON.stringify({ run_id: input.runId, action: 'promote', reason: input.reason }),
      }),
  });
}

/** 带鉴权的原始请求：下载 tar.gz 这类不能用 JSON 客户端的路径。 */
export async function authFetch(sdk: SdkLike, path: string, init?: RequestInit): Promise<Response> {
  const token = await accessToken(sdk);
  return fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
}

export async function downloadSnapshot(sdk: SdkLike, projectSlug: string, snapshotId: string): Promise<void> {
  const response = await authFetch(sdk, `/api/v1/snapshots/${snapshotId}/tar.gz`);
  if (!response.ok) throw new ApiError(`下载失败：${response.statusText}`, response.status, 'download_failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${projectSlug}-${snapshotId}.tar.gz`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useMetrics(sdk: SdkLike | null, slug: string | undefined) {
  return useQuery({
    queryKey: ['metrics', slug],
    enabled: Boolean(sdk && slug),
    queryFn: ({ signal }) => api<{ metrics: MetricView[] }>(sdk as SdkLike, `/api/v1/projects/${slug}/metrics`, { signal }),
  });
}

export function useUpsertMetric(sdk: SdkLike | null, slug: string) {
  return useMutation({
    mutationFn: (input: {
      key: string;
      label: string;
      unit: string;
      direction: string;
      definition_md: string;
      is_primary?: boolean;
      sort_order?: number;
    }) =>
      api<{ metrics: MetricView[] }>(sdk as SdkLike, `/api/v1/projects/${slug}/metrics`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useRetireMetric(sdk: SdkLike | null, slug: string) {
  return useMutation({
    mutationFn: (key: string) =>
      api<{ metrics: MetricView[] }>(sdk as SdkLike, `/api/v1/projects/${slug}/metrics/${key}/retire`, { method: 'POST' }),
  });
}

export function useDataset(sdk: SdkLike | null, slug: string | undefined) {
  return useQuery({
    queryKey: ['dataset', slug],
    enabled: Boolean(sdk && slug),
    queryFn: ({ signal }) =>
      api<{ firmament_enabled: boolean; current: DatasetPinView | null; pins: DatasetPinView[] }>(
        sdk as SdkLike,
        `/api/v1/projects/${slug}/dataset`,
        { signal },
      ),
  });
}

export function usePinDataset(sdk: SdkLike | null, slug: string) {
  return useMutation({
    mutationFn: (input: { dataset_id: string; note: string }) =>
      api<{ pin: DatasetPinView | null }>(sdk as SdkLike, `/api/v1/projects/${slug}/dataset`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useFirmamentDatasets(sdk: SdkLike | null, enabled: boolean) {
  return useQuery({
    queryKey: ['firmament-datasets'],
    enabled: Boolean(sdk && enabled),
    retry: false,
    queryFn: ({ signal }) =>
      api<{ enabled: boolean; datasets: FirmamentDatasetView[] }>(sdk as SdkLike, '/api/v1/firmament/datasets', { signal }),
  });
}

/** 项目绑定的那条「思路线程」：它读整张研究地图，产出下一轮的思路。 */
export interface ProjectIdea {
  thread_id: string | null;
  status: 'none' | 'pending' | 'ready' | 'empty' | 'error' | 'unknown';
  idea_md?: string | null;
  requested_at?: number | null;
  /** 地图没变：这一版思路仍然对得上最新一轮实验，不用再问一遍。 */
  fresh?: boolean;
  message?: string;
}

export function useProjectIdea(sdk: SdkLike | null, slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['idea', slug],
    enabled: Boolean(sdk && slug && enabled),
    queryFn: () => api<ProjectIdea>(sdk as SdkLike, `/api/v1/projects/${slug}/idea`),
    // 一轮诊断要好几分钟：pending 时每 4 秒问一次，有结论就停。
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 4000 : false),
  });
}

export function useStartIdea(sdk: SdkLike | null, slug: string | undefined) {
  return useMutation({
    mutationFn: () =>
      api<{ thread_id: string; status: string; record_idx: number }>(sdk as SdkLike, `/api/v1/projects/${slug}/idea`, {
        method: 'POST',
      }),
  });
}

/** 启动 / 暂停研究循环：启动之后没有人在环，暂停就不开新实验。 */
export function useLoopControl(sdk: SdkLike | null, slug: string | undefined) {
  return useMutation({
    mutationFn: (action: 'start' | 'pause') =>
      api<{ loop_state: 'running' | 'paused' }>(sdk as SdkLike, `/api/v1/projects/${slug}/loop`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      }),
  });
}

/** 项目级设置：跑实验用哪个模型（空 = 跟随 Cybion 默认）。 */
export function useSaveRunModel(sdk: SdkLike | null, slug: string | undefined) {
  return useMutation({
    mutationFn: (runModel: string) =>
      api<{ run_model: string | null }>(sdk as SdkLike, `/api/v1/projects/${slug}/settings`, {
        method: 'POST',
        body: JSON.stringify({ run_model: runModel }),
      }),
  });
}
