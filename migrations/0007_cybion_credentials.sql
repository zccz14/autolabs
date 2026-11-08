-- 每个人在 Cybion 上的长寿命 API key。
--
-- 换一次就够：用 Auth Mini 签发的、带 cybion.ntnl.io audience 的 JWT 调
-- POST /api/api-keys 换一把，然后一直用它（JWT 一小时就过期，key 不会）。
-- 明文只在换的那一刻出现，落库的是用 CREDENTIALS_KEY 做的 AES-GCM 密封值。
CREATE TABLE cybion_credentials (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Cybion 侧的 key id：换新的时候先吊销旧的，不在那边堆垃圾
  cybion_key_id TEXT NOT NULL,
  label         TEXT NOT NULL,
  -- 只留前缀用于认人（对应 Cybion 上的 prefix）
  prefix        TEXT NOT NULL,
  -- base64(iv || AES-GCM 密文)，密钥是 Worker secret CREDENTIALS_KEY
  sealed        TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
