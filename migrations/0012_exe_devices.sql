-- eXe：把「算指标」这件事派到用户自己的机器上。
--
-- 责任边界：Cybion Thread 只负责把实验实现出来、跑通冒烟与门禁自测；
-- 指标不由它嘴报，而是由一台机器上的确定性程序算出来。AutoLabs 是控制面，
-- 它发指令、记账、判门禁，执行交给 eXe。
--
-- 每个用户一把 eXe 身份：address 就是 Ed25519 公钥。设备只认自己 trust 列表
-- 里的地址，所以 A 用户的身份碰不到 B 用户的机器——这不是策略，是验签。
-- 私钥要能读回来签名，所以密封存（和 cybion_credentials 同一把 CREDENTIALS_KEY）。
PRAGMA foreign_keys = ON;

CREATE TABLE exe_identities (
  address       TEXT PRIMARY KEY,           -- base58 公钥，就是要贴进设备 trust 的那串
  user_id       TEXT NOT NULL REFERENCES users(id),
  sealed_secret TEXT NOT NULL,              -- AES-GCM(base58 seed||pub)，AAD 固定用途串
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER                     -- 轮换后旧的那把：历史调用仍可溯源，不再使用
);

CREATE INDEX idx_exe_identities_user ON exe_identities(user_id, created_at DESC);

-- 用户登记过的 eXe 设备。项目以后从这里挑一台来跑评估。
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  address      TEXT NOT NULL,               -- 设备的 eXe 地址
  label        TEXT NOT NULL,
  platform     TEXT,                        -- 最近一次探活时设备自报的平台
  last_seen_at INTEGER,                     -- 最近一次探活时设备最后一次上线的时间
  probe_at     INTEGER,
  probe_ok     INTEGER,
  probe_error  TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, address)
);
