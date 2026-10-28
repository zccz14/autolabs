import type { Context } from 'hono';

/** 业务错误：抛出去由上层的 onError 统一转成 JSON。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

export function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, message, code);
}

export async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    fail(400, 'invalid_json', '请求体必须是 JSON');
  }
}

export function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string') fail(400, 'invalid_field', `${field} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) fail(400, 'invalid_field', `${field} 不能为空`);
  if (trimmed.length > max) fail(400, 'invalid_field', `${field} 超过 ${max} 字符`);
  return trimmed;
}

export function optionalString(value: unknown, field: string, max = 4000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(400, 'invalid_field', `${field} 必须是字符串`);
  if (value.length > max) fail(400, 'invalid_field', `${field} 超过 ${max} 字符`);
  return value;
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(400, 'invalid_field', `${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}
