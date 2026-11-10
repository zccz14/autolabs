-- 一键复算整条实验线：把已结算的实验重新算一遍，核对数字。
--
-- 复算不改已经记下的数字——已结算的行是事实。它只产出一份「核对结果」：
-- 一致、不一致（差在哪、差多少）、或者失败。不一致本身是有价值的信号：
-- 同一个包、同一个入口、同一份数据，为什么这次算出来不一样。
ALTER TABLE runs ADD COLUMN recheck_state TEXT;              -- queued | dispatched | matched | diverged | failed
ALTER TABLE runs ADD COLUMN recheck_call_id TEXT;
ALTER TABLE runs ADD COLUMN recheck_device_address TEXT;
ALTER TABLE runs ADD COLUMN recheck_expires_at INTEGER;
ALTER TABLE runs ADD COLUMN recheck_metrics_json TEXT;
ALTER TABLE runs ADD COLUMN recheck_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN recheck_at INTEGER;
