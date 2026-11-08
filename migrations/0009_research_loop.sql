-- 研究循环：按下启动就一直推进「出思路 → 开实验 → 等结论 → 再出思路」，
-- 按下暂停就不再开新实验（在飞的那一轮照常跑完、照常结算）。
ALTER TABLE projects ADD COLUMN loop_state TEXT NOT NULL DEFAULT 'paused';
ALTER TABLE projects ADD COLUMN loop_run_id TEXT;
ALTER TABLE projects ADD COLUMN loop_started_at INTEGER;
ALTER TABLE projects ADD COLUMN loop_paused_at INTEGER;
ALTER TABLE projects ADD COLUMN loop_last_tick_at INTEGER;
ALTER TABLE projects ADD COLUMN loop_error TEXT;
