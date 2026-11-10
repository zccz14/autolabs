-- 不符合规范的包会被标成 dirty，并由一个 Agent 自动修。
--
-- 修好的包就是这一轮的代码：替换 input_snapshot_id，旧树记进事件。
-- 这是 Soul 第 6 条允许的那一种改动——结算之前，为了合规可以改代码，
-- 只要它还在追同一个问题（idea_md 与 lab 编号都不动）。
ALTER TABLE runs ADD COLUMN dirty_reason TEXT;
ALTER TABLE runs ADD COLUMN repair_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN repair_thread_id TEXT;
ALTER TABLE runs ADD COLUMN repair_last_at INTEGER;
