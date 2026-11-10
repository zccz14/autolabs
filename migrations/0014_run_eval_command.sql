-- 一条评估命令到底跑了什么，要落在 run 上。
--
-- 命令可以来自快照根目录的 lab.json，也可以来自项目设置；两者都会变，而历史行
-- 不该跟着变。把「这一轮实际跑的那条命令」记下来，指标才追得回它的算法——
-- metric_set_json 钉的是口径版本，钉不住算法本身。
ALTER TABLE runs ADD COLUMN eval_command TEXT;
ALTER TABLE runs ADD COLUMN eval_command_source TEXT;
