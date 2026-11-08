import type { Env } from './env';

/**
 * 密封存放别人家的长寿命凭据（现在是 Cybion 的 API key）。
 *
 * 这类凭据必须能读回原文才能用，所以不能像项目凭据那样只存哈希；这里用
 * AES-GCM 加一把只存在 Worker secret 里的密钥（CREDENTIALS_KEY），库被读走
 * 也解不开。附加数据固定成一条用途串，密文搬去别处也用不了。
 */

const AAD = new TextEncoder().encode('autolabs:cybion-credential:v1');

function keyBytes(env: Env): Uint8Array {
  const raw = env.CREDENTIALS_KEY;
  if (!raw) throw new Error('没有配置 CREDENTIALS_KEY（wrangler secret put CREDENTIALS_KEY）');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  } catch {
    throw new Error('CREDENTIALS_KEY 必须是 base64');
  }
  if (bytes.length !== 32) throw new Error('CREDENTIALS_KEY 必须是 32 字节的 base64（openssl rand -base64 32）');
  return bytes;
}

async function aesKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes(env), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function seal(env: Env, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await aesKey(env), new TextEncoder().encode(plaintext));
  return toBase64(new Uint8Array([...iv, ...new Uint8Array(sealed)]));
}

export async function unseal(env: Env, value: string): Promise<string> {
  const bytes = fromBase64(value);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: AAD },
    await aesKey(env),
    bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}
