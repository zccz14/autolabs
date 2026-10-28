import { newId } from './ids';
import { sha256Hex } from './labs';

/** 机器侧凭据：alb_<tokenId>_<secret>。库中只留 secret 的 sha256。 */
export interface MintedToken {
  id: string;
  token: string;
  secretSha256: string;
}

export async function mintProjectToken(): Promise<MintedToken> {
  const id = newId('tok');
  const secretBytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = [...secretBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const secretSha256 = await sha256Hex(`${id}:${secret}`);
  return { id, token: `alb_${id}_${secret}`, secretSha256 };
}

export function parseProjectToken(raw: string): { id: string; secret: string } | null {
  if (!raw.startsWith('alb_')) return null;
  const body = raw.slice(4);
  const split = body.lastIndexOf('_');
  if (split <= 0) return null;
  return { id: body.slice(0, split), secret: body.slice(split + 1) };
}

export async function tokenFingerprint(id: string, secret: string): Promise<string> {
  return sha256Hex(`${id}:${secret}`);
}
