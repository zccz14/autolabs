/** 绑定的运行时环境。除 DEV_USER_ID 外全部由 wrangler.jsonc 提供。 */
export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  ASSETS: Fetcher;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  /** Firmament（数据集唯一真相发布方）的基地址；本地开发留空则走离线绑定。 */
  FIRMAMENT_BASE_URL?: string;
  /** 仅本地开发：把 identity 固定成这个用户，生产环境永远不设置。 */
  DEV_USER_ID?: string;
}
