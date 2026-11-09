import type { Env } from './env';
import { nowSeconds } from './ids';
import { seal, unseal } from './sealed';
import { addressOf, decodeSecret, encodeSecret, newIdentity, type Identity } from './exe-protocol';

/**
 * 每个用户一把 eXe 身份。
 *
 * 设备只认自己 trust 列表里的地址，所以这把身份就是「AutoLabs 以你的名义能碰
 * 哪些机器」的边界：别人的设备不认你的地址，你的循环也碰不到别人的机器。
 *
 * 私钥必须能读回来签名，所以密封存；用途串把它的密文钉在 eXe 这一件事上，
 * 搬去冒充别的凭据解不开。生成是懒的——第一次真要发调用时才造。
 */

const PURPOSE = 'exe-identity';

export interface ExeIdentityRow {
  address: string;
  user_id: string;
  sealed_secret: string;
  created_at: number;
  revoked_at: number | null;
}

export async function findIdentity(env: Env, userId: string): Promise<ExeIdentityRow | null> {
  return env.DB.prepare(
    `SELECT address, user_id, sealed_secret, created_at, revoked_at FROM exe_identities
      WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<ExeIdentityRow>();
}

/** 没有就现造一把。并发的两个请求最多留下一条有效的，后到的那把自认落选。 */
export async function ensureIdentity(env: Env, userId: string): Promise<ExeIdentityRow> {
  const existing = await findIdentity(env, userId);
  if (existing) return existing;
  const identity = newIdentity();
  await env.DB.prepare(
    `INSERT INTO exe_identities (address, user_id, sealed_secret, created_at)
     SELECT ?, ?, ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM exe_identities WHERE user_id = ? AND revoked_at IS NULL
     )`,
  )
    .bind(addressOf(identity), userId, await seal(env, encodeSecret(identity), PURPOSE), nowSeconds(), userId)
    .run();
  const row = await findIdentity(env, userId);
  if (!row) throw new Error('生成 eXe 身份失败');
  return row;
}

/** 换一把：旧的标记退役而不是删掉，历史调用仍能追到是谁签的。 */
export async function rotateIdentity(env: Env, userId: string): Promise<ExeIdentityRow> {
  const current = await findIdentity(env, userId);
  const identity = newIdentity();
  const created = nowSeconds();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO exe_identities (address, user_id, sealed_secret, created_at) VALUES (?, ?, ?, ?)`).bind(
      addressOf(identity),
      userId,
      await seal(env, encodeSecret(identity), PURPOSE),
      created,
    ),
  ];
  if (current) {
    statements.push(env.DB.prepare(`UPDATE exe_identities SET revoked_at = ? WHERE address = ?`).bind(created, current.address));
  }
  await env.DB.batch(statements);
  const row = await findIdentity(env, userId);
  if (!row) throw new Error('轮换 eXe 身份失败');
  return row;
}

/** 解出私钥：只有真要签名的那一刻才解。 */
export async function identityOf(env: Env, row: ExeIdentityRow): Promise<Identity> {
  return decodeSecret(await unseal(env, row.sealed_secret, PURPOSE));
}
