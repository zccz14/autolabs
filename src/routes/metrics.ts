import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate, authenticateOptional } from '../auth';
import { fail, optionalString, readJson, requireString } from '../http';
import { loadProject } from '../guards';
import { newId, nowSeconds } from '../ids';
import { manifestDigest } from '../labs';
import { validateMetricInput } from '../metrics';
import { currentMetrics, recordEvent, type DatasetPinRow, type MetricRow } from '../store';
import { fetchFirmamentManifest, firmamentEnabled, listFirmamentDatasets } from '../firmament';

export function viewMetric(row: MetricRow) {
  return {
    key: row.key,
    version: row.version,
    label: row.label,
    unit: row.unit,
    direction: row.direction,
    definition_md: row.definition_md,
    is_primary: Boolean(row.is_primary),
    required: Boolean(row.required),
    sort_order: row.sort_order,
  };
}

export function viewPin(pin: DatasetPinRow) {
  return {
    id: pin.id,
    dataset_id: pin.firmament_dataset_id,
    name: pin.name,
    digest: pin.digest,
    file_count: pin.file_count,
    bytes: pin.bytes,
    verified: Boolean(pin.verified),
    note: pin.note,
    pinned_by: pin.pinned_by,
    pinned_at: pin.pinned_at,
  };
}

export const projectMetricRoutes = new Hono<{ Bindings: Env }>();

projectMetricRoutes.get('/:slug/metrics', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const metrics = await currentMetrics(c.env, access.project.id);
  return c.json({ metrics: metrics.map(viewMetric) });
});

/** 定义或改一条指标：每次写入都是新版本，旧版本留在历史里，口径不会被悄悄改掉。 */
projectMetricRoutes.post('/:slug/metrics', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'write');
  const payload = await readJson<Record<string, unknown>>(c);
  const key = requireString(payload.key, 'key', 41).toLowerCase();
  const label = requireString(payload.label, 'label', 60);
  const unit = requireString(payload.unit, 'unit', 20);
  const direction = requireString(payload.direction, 'direction', 20);
  const definition = requireString(payload.definition_md, 'definition_md', 4000);
  try {
    validateMetricInput({ key, unit, direction, definition_md: definition });
  } catch (error) {
    return fail(400, 'invalid_metric', (error as Error).message);
  }
  const existing = await currentMetrics(c.env, access.project.id);
  const previous = existing.find((metric) => metric.key === key);
  const version = (previous?.version ?? 0) + 1;
  const isPrimary = payload.is_primary === true;
  const sortOrder = typeof payload.sort_order === 'number' ? payload.sort_order : (previous?.sort_order ?? 100);
  // 新版本沿用上一版的必报设置；显式传了 required 才改。
  const required = typeof payload.required === 'boolean' ? payload.required : Boolean(previous?.required);
  if (isPrimary) {
    await c.env.DB.prepare(`UPDATE project_metrics SET is_primary = 0 WHERE project_id = ?`).bind(access.project.id).run();
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO project_metrics (id, project_id, key, version, label, unit, direction, definition_md, is_primary, required, sort_order, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newId('met'),
      access.project.id,
      key,
      version,
      label,
      unit,
      direction,
      definition,
      isPrimary ? 1 : 0,
      required ? 1 : 0,
      sortOrder,
      principal.userId,
      nowSeconds(),
    ),
    c.env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, 'metric.defined', ?, ?, ?)`).bind(
      newId('evt'),
      access.project.id,
      JSON.stringify({ key, version }),
      principal.userId,
      nowSeconds(),
    ),
  ]);
  const metrics = await currentMetrics(c.env, access.project.id);
  return c.json({ metric: metrics.find((metric) => metric.key === key), metrics: metrics.map(viewMetric) }, 201);
});

projectMetricRoutes.post('/:slug/metrics/:key/retire', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'maintainer', 'write');
  const key = c.req.param('key');
  const metrics = await currentMetrics(c.env, access.project.id);
  const current = metrics.find((metric) => metric.key === key);
  if (!current) return fail(404, 'not_found', `项目里没有指标 ${key}`);
  await c.env.DB.prepare(`UPDATE project_metrics SET retired_at = ? WHERE project_id = ? AND key = ? AND version = ?`)
    .bind(nowSeconds(), access.project.id, key, current.version)
    .run();
  await recordEvent(c.env, 'metric.retired', access.project.id, principal.userId, { key, version: current.version });
  const remaining = await currentMetrics(c.env, access.project.id);
  return c.json({ retired: key, metrics: remaining.map(viewMetric) });
});

/** 数据集引用：钉住 Firmament 的 manifest 摘要，不复制数据。 */
projectMetricRoutes.get('/:slug/dataset', async (c) => {
  const principal = await authenticateOptional(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal);
  const pins = await c.env.DB.prepare(`SELECT * FROM dataset_pins WHERE project_id = ? ORDER BY pinned_at DESC LIMIT 20`)
    .bind(access.project.id)
    .all<DatasetPinRow>();
  const current = (pins.results ?? []).find((pin) => pin.id === access.project.dataset_pin_id) ?? null;
  return c.json({
    firmament_enabled: firmamentEnabled(c.env),
    current: current ? viewPin(current) : null,
    pins: (pins.results ?? []).map(viewPin),
  });
});

projectMetricRoutes.post('/:slug/dataset', async (c) => {
  const principal = await authenticate(c.req.raw, c.env);
  const access = await loadProject(c.env, c.req.param('slug'), principal, 'runner', 'write');
  const payload = await readJson<Record<string, unknown>>(c);
  const datasetId = requireString(payload.dataset_id, 'dataset_id', 64).toLowerCase();
  const note = optionalString(payload.note, 'note', 500) ?? '';

  let digest: string;
  let fileCount = 0;
  let bytes = 0;
  let name = datasetId;
  let verified = false;
  let manifestKey: string | null = null;

  if (firmamentEnabled(c.env)) {
    const authorization = c.req.header('authorization') ?? '';
    const datasets = await listFirmamentDatasets(c.env, authorization);
    const found = datasets.find((dataset) => dataset.id === datasetId);
    if (!found) return fail(404, 'firmament_dataset_not_found', `Firmament 上没有数据集 ${datasetId}`);
    const manifest = await fetchFirmamentManifest(c.env, authorization, datasetId);
    digest = await manifestDigest(manifest.files);
    fileCount = manifest.files.length;
    bytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
    name = found.name;
    verified = true;
    manifestKey = `datasets/${access.project.id}/${datasetId}/${digest}.json`;
    const encoded = new TextEncoder().encode(JSON.stringify(manifest));
    if (encoded.byteLength <= 8 * 1024 * 1024) await c.env.BLOBS.put(manifestKey, encoded);
    else manifestKey = null;
  } else {
    // 本地开发：没有 Firmament 连接时允许离线绑定，但标记为未核对。
    digest = await manifestDigest([]);
    name = datasetId;
  }

  const pinId = newId('dsp');
  const pinnedAt = nowSeconds();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO dataset_pins (id, project_id, firmament_dataset_id, name, digest, file_count, bytes, manifest_key, verified, note, pinned_by, pinned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(pinId, access.project.id, datasetId, name, digest, fileCount, bytes, manifestKey, verified ? 1 : 0, note, principal.userId, pinnedAt),
    c.env.DB.prepare(`UPDATE projects SET dataset_pin_id = ? WHERE id = ?`).bind(pinId, access.project.id),
    c.env.DB.prepare(`INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at) VALUES (?, ?, 'dataset.pinned', ?, ?, ?)`).bind(
      newId('evt'),
      access.project.id,
      JSON.stringify({ dataset_id: datasetId, digest, verified }),
      principal.userId,
      pinnedAt,
    ),
  ]);
  const pin = await c.env.DB.prepare(`SELECT * FROM dataset_pins WHERE id = ?`).bind(pinId).first<DatasetPinRow>();
  return c.json({ pin: pin ? viewPin(pin) : null, firmament_enabled: firmamentEnabled(c.env) }, 201);
});

/** 数据集候选：把 Firmament 的目录透给前端，用同一个 access token 转发。 */
export const firmamentRoutes = new Hono<{ Bindings: Env }>();

firmamentRoutes.get('/datasets', async (c) => {
  await authenticate(c.req.raw, c.env);
  if (!firmamentEnabled(c.env)) return c.json({ enabled: false, datasets: [] });
  const datasets = await listFirmamentDatasets(c.env, c.req.header('authorization') ?? '');
  return c.json({
    enabled: true,
    datasets: datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      description: dataset.description,
      tier: dataset.tier,
      file_count: dataset.file_count,
      bytes: dataset.bytes,
      updated_at: dataset.updated_at,
    })),
  });
});
