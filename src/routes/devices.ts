import { Hono } from 'hono';
import type { Env } from '../env';
import { authenticate, type Principal } from '../auth';
import { fail, optionalString, readJson, requireString } from '../http';
import { newId, nowSeconds } from '../ids';
import { recordEvent } from '../store';
import { ensureIdentity, findIdentity, identityOf, rotateIdentity, type ExeIdentityRow } from '../exe-identity';
import { probeDevice, type ProbeResult } from '../exe';
import { isAddress } from '../exe-protocol';

/**
 * 设备对接：用户在这里拿到自己那把 eXe 地址，把它加进自己机器的 trust，
 * 然后登记这台机器。登记时会顺手探活一次——绑定与验证是同一步，不留
 * 「以为配好了、其实没配上」这种中间状态。
 *
 * 这一页不属于任何一个项目：地址是人的，机器也是人的。
 */

export const DEVICE_EVENTS = {
  registered: 'device.registered',
  probed: 'device.probed',
  removed: 'device.removed',
  identityCreated: 'exe.identity.created',
  identityRotated: 'exe.identity.rotated',
} as const;

interface DeviceRow {
  id: string;
  user_id: string;
  address: string;
  label: string;
  platform: string | null;
  last_seen_at: number | null;
  probe_at: number | null;
  probe_ok: number | null;
  probe_error: string | null;
  created_at: number;
}

function viewIdentity(row: ExeIdentityRow) {
  return { address: row.address, created_at: row.created_at };
}

function viewDevice(row: DeviceRow) {
  return {
    id: row.id,
    address: row.address,
    label: row.label,
    platform: row.platform,
    last_seen_at: row.last_seen_at,
    probe_at: row.probe_at,
    probe_ok: row.probe_ok === null ? null : row.probe_ok === 1,
    probe_error: row.probe_error,
    created_at: row.created_at,
  };
}

/** 机器凭据与 Thread 令牌没有「我的机器」这个概念：设备绑定只属于具体的人。 */
async function requireUser(request: Request, env: Env): Promise<Principal> {
  const principal = await authenticate(request, env);
  if (principal.kind !== 'user') fail(403, 'forbidden', '设备绑定属于具体的人：请用登录身份操作');
  return principal;
}

async function findDevice(env: Env, userId: string, id: string): Promise<DeviceRow | null> {
  return env.DB.prepare(`SELECT * FROM devices WHERE id = ? AND user_id = ?`).bind(id, userId).first<DeviceRow>();
}

/** 探活结果就是这一行的状态：device 表里存的是「上一次问它的时候它怎么样」。 */
async function saveProbe(env: Env, id: string, probe: ProbeResult): Promise<void> {
  await env.DB.prepare(
    `UPDATE devices SET probe_at = ?, probe_ok = ?, probe_error = ?, platform = COALESCE(?, platform), last_seen_at = COALESCE(?, last_seen_at) WHERE id = ?`,
  )
    .bind(
      nowSeconds(),
      probe.ok ? 1 : 0,
      probe.ok ? null : probe.message,
      probe.status?.platform ?? null,
      probe.status?.last_seen_at ?? null,
      id,
    )
    .run();
}

export const deviceRoutes = new Hono<{ Bindings: Env }>();

deviceRoutes.get('/', async (c) => {
  const principal = await requireUser(c.req.raw, c.env);
  const identity = await findIdentity(c.env, principal.userId);
  const devices = await c.env.DB.prepare(`SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(principal.userId)
    .all<DeviceRow>();
  return c.json({
    identity: identity ? viewIdentity(identity) : null,
    devices: (devices.results ?? []).map(viewDevice),
  });
});

deviceRoutes.post('/identity', async (c) => {
  const principal = await requireUser(c.req.raw, c.env);
  const row = await ensureIdentity(c.env, principal.userId);
  await recordEvent(c.env, DEVICE_EVENTS.identityCreated, null, principal.userId, { address: row.address });
  return c.json({ identity: viewIdentity(row) });
});

/**
 * 换一把地址。旧的不删——历史调用还追得回去谁签的。
 * 代价说清楚：换完之后每台设备都得加一遍新地址，否则它们不再认 AutoLabs。
 */
deviceRoutes.post('/identity/rotate', async (c) => {
  const principal = await requireUser(c.req.raw, c.env);
  const before = await findIdentity(c.env, principal.userId);
  const row = await rotateIdentity(c.env, principal.userId);
  await recordEvent(c.env, DEVICE_EVENTS.identityRotated, null, principal.userId, {
    address: row.address,
    previous: before?.address ?? null,
  });
  return c.json({ identity: viewIdentity(row), previous: before ? viewIdentity(before) : null });
});

deviceRoutes.post('/', async (c) => {
  const principal = await requireUser(c.req.raw, c.env);
  const body = await readJson<{ address?: unknown; label?: unknown }>(c);
  const address = requireString(body.address, 'address', 64);
  if (!isAddress(address)) fail(400, 'invalid_address', '这不是一个 eXe 地址（base58 的 32 字节公钥）');
  const label = optionalString(body.label, 'label', 60)?.trim() || address.slice(0, 8);

  const identityRow = await ensureIdentity(c.env, principal.userId);
  const caller = await identityOf(c.env, identityRow);
  const probe = await probeDevice(c.env, caller, address);

  const existing = await c.env.DB.prepare(`SELECT * FROM devices WHERE user_id = ? AND address = ?`)
    .bind(principal.userId, address)
    .first<DeviceRow>();
  const id = existing?.id ?? newId('dev');
  const at = nowSeconds();
  await c.env.DB.prepare(
    `INSERT INTO devices (id, user_id, address, label, platform, last_seen_at, probe_at, probe_ok, probe_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, address) DO UPDATE SET
       label = excluded.label,
       platform = COALESCE(excluded.platform, devices.platform),
       last_seen_at = COALESCE(excluded.last_seen_at, devices.last_seen_at),
       probe_at = excluded.probe_at,
       probe_ok = excluded.probe_ok,
       probe_error = excluded.probe_error`,
  )
    .bind(
      id,
      principal.userId,
      address,
      label,
      probe.status?.platform ?? null,
      probe.status?.last_seen_at ?? null,
      at,
      probe.ok ? 1 : 0,
      probe.ok ? null : probe.message,
      existing?.created_at ?? at,
    )
    .run();
  await recordEvent(c.env, DEVICE_EVENTS.registered, null, principal.userId, {
    device_id: id,
    address,
    probe_ok: probe.ok,
    reason: probe.reason,
  });

  const row = await findDevice(c.env, principal.userId, id);
  return c.json({ device: row ? viewDevice(row) : null, probe });
});

deviceRoutes.post('/:id/probe', async (c) => {
  const principal = await requireUser(c.req.raw, c.env);
  const device = await findDevice(c.env, principal.userId, c.req.param('id'));
  if (!device) fail(404, 'not_found', '没有这台设备');
  const identityRow = await ensureIdentity(c.env, principal.userId);
  const caller = await identityOf(c.env, identityRow);
  const probe = await probeDevice(c.env, caller, device.address);
  await saveProbe(c.env, device.id, probe);
  await recordEvent(c.env, DEVICE_EVENTS.probed, null, principal.userId, {
    device_id: device.id,
    probe_ok: probe.ok,
    reason: probe.reason,
  });
  const row = await findDevice(c.env, principal.userId, device.id);
  return c.json({ device: row ? viewDevice(row) : null, probe });
});

deviceRoutes.delete('/:id', async (c) => {
  const principal = await requireUser(c.req.raw, c.env);
  const device = await findDevice(c.env, principal.userId, c.req.param('id'));
  if (!device) fail(404, 'not_found', '没有这台设备');
  await c.env.DB.prepare(`DELETE FROM devices WHERE id = ? AND user_id = ?`).bind(device.id, principal.userId).run();
  await recordEvent(c.env, DEVICE_EVENTS.removed, null, principal.userId, { device_id: device.id, address: device.address });
  return c.json({ ok: true });
});
