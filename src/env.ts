/** 绑定的运行时环境。除 DEV_USER_ID 外全部由 wrangler.jsonc 提供。 */
export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  ASSETS: Fetcher;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  /** Firmament（数据集唯一真相发布方）的基地址；本地开发留空则走离线绑定。 */
  FIRMAMENT_BASE_URL?: string;
  /** AutoLabs 自己的对外地址：研究循环在后台跑，没有请求可借 origin。 */
  APP_ORIGIN?: string;
  /** Cybion 的基地址；开一轮实验要往这里建 Thread。 */
  CYBION_BASE_URL?: string;
  /** Cybion 公钥的地址；默认 https://cybion.ntnl.io/.well-known/jwks.json，测试与自建部署可覆盖。 */
  CYBION_JWKS_URL?: string;
  /** Cybion 外部集成面的 API key（cyb_…），只放在 Worker secret 里；后台换不到人凭据时兜底。 */
  CYBION_API_KEY?: string;
  /** 密封 cybion_credentials.sealed 的 AES-GCM 密钥（32 字节 base64），只在 Worker secret 里。 */
  CREDENTIALS_KEY?: string;
  /** 仅本地开发：把 identity 固定成这个用户，生产环境永远不设置。 */
  DEV_USER_ID?: string;
}
