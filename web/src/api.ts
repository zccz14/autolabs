import { useQuery, useMutation } from '@tanstack/react-query';

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
  sota_events: { id: string; run_id: string; action: string; reason: string; actor_user_id: string; created_at: number }[];
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
    mutationFn: (note: string) =>
      api<{ run: RunView }>(sdk as SdkLike, `/api/v1/projects/${slug}/runs`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
  });
}

export function useFreezeSnapshot(sdk: SdkLike | null) {
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api<{ snapshot: SnapshotView }>(sdk as SdkLike, `/api/v1/snapshots/${snapshotId}/freeze`, { method: 'POST' }),
  });
}

export function useMintToken(sdk: SdkLike | null, slug: string) {
  return useMutation({
    mutationFn: (label: string) =>
      api<{ token: string; id: string; capabilities: string[]; expires_in_days: number }>(
        sdk as SdkLike,
        `/api/v1/projects/${slug}/tokens`,
        { method: 'POST', body: JSON.stringify({ label }) },
      ),
  });
}

export function useDispatchRun(sdk: SdkLike | null) {
  return useMutation({
    mutationFn: (input: { runId: string; threadId: string }) =>
      api<{ run: RunView }>(sdk as SdkLike, `/api/v1/runs/${input.runId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ cybion_thread_id: input.threadId }),
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
