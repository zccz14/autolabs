const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 生成带类型前缀的短 id，例如 prj_9f3k…。 */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** 秒级时间戳：本服务所有时间列都是 INTEGER 秒。 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
