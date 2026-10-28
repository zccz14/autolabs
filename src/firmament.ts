import type { Env } from './env';
import { fail } from './http';

/**
 * Firmament 是数据集的唯一真相发布方（Single Truth Publisher）。
 * AutoLabs 不复制数据，只读 manifest 并钉住它的摘要。
 */

export interface FirmamentFile {
  path: string;
  size: number;
  sha256: string;
  updated_at: number;
  tier: string;
}

export interface FirmamentManifest {
  dataset_id: string;
  generated_at: number;
  files: FirmamentFile[];
}

export interface FirmamentDataset {
  id: string;
  name: string;
  description: string;
  tier: string;
  file_count: number;
  bytes: number;
  cold_file_count: number;
  cold_bytes: number;
  updated_at: number;
}

export function firmamentEnabled(env: Env): boolean {
  return Boolean(env.FIRMAMENT_BASE_URL);
}

async function call<T>(env: Env, path: string, authorization: string): Promise<T> {
  const response = await fetch(new URL(path, env.FIRMAMENT_BASE_URL), {
    headers: { Authorization: authorization, Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) {
    fail(
      403,
      'firmament_unauthorized',
      'Firmament 拒绝了这次读取。当前登录会话需要包含 firma.ntnl.io 这个 audience（前端登录时已一并申请，重新登录一次即可）。',
    );
  }
  if (response.status === 404) fail(404, 'firmament_dataset_not_found', 'Firmament 上没有这个数据集');
  if (!response.ok) fail(502, 'firmament_error', `Firmament 返回 ${response.status}`);
  return (await response.json()) as T;
}

export async function listFirmamentDatasets(env: Env, authorization: string): Promise<FirmamentDataset[]> {
  return call<FirmamentDataset[]>(env, '/api/v1/datasets', authorization);
}

export async function fetchFirmamentManifest(
  env: Env,
  authorization: string,
  datasetId: string,
): Promise<FirmamentManifest> {
  return call<FirmamentManifest>(env, `/api/v1/datasets/${encodeURIComponent(datasetId)}/manifest`, authorization);
}
