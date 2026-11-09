-- 指标由程序算：项目声明一个评估入口，平台把它派到一台设备上跑。
--
-- run thread 报完「实现完成」就交棒：它证明实验跑得通、门禁自测过，
-- 但不再写数字。数字由这台设备上的一条命令产出，命令最后一行是指标 JSON。
ALTER TABLE projects ADD COLUMN eval_command TEXT;
ALTER TABLE projects ADD COLUMN eval_device_id TEXT;

-- 一次评估派发出去之后要能收回来：调用 id、设备、过期时间、试了几次。
-- 结果信封的附加数据钉住了 (call_id, caller, device, expires_at)，
-- 所以这几列足以把回传的结果解开，不需要把整个信封原样存下来。
ALTER TABLE runs ADD COLUMN eval_call_id TEXT;
ALTER TABLE runs ADD COLUMN eval_device_address TEXT;
ALTER TABLE runs ADD COLUMN eval_expires_at INTEGER;
ALTER TABLE runs ADD COLUMN eval_dispatched_at INTEGER;
ALTER TABLE runs ADD COLUMN eval_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN eval_error TEXT;
