/** 令牌列表的形状：后端把 capabilities 存成逗号串，前端只做展示与判定。 */
export interface TokenView {
  id: string;
  label: string;
  capabilities: string | string[] | null;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
}

export type TokenStatus = 'live' | 'revoked' | 'expired';

/** 吊销优先于过期：吊销过的令牌无论时间走到哪都是死的。 */
export function tokenStatus(token: Pick<TokenView, 'revoked_at' | 'expires_at'>, nowSeconds: number): TokenStatus {
  if (token.revoked_at) return 'revoked';
  if (typeof token.expires_at === 'number' && token.expires_at <= nowSeconds) return 'expired';
  return 'live';
}

/** 能力可能是逗号串（DB）或数组（签发响应），统一拆成数组。 */
export function parseCapabilities(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((value) => value.trim()).filter(Boolean);
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
