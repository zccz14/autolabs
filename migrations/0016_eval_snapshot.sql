-- 已结算的实验不能改代码，但可以补一份「合规的评估树」。
--
-- input_snapshot_id 是这一轮跑的代码，结算之后是事实，永不改。
-- eval_snapshot_id 是另一回事：同一份实验 + 它应有的 lab.json，只在必须补规范
-- 或者要复算时才出现。它不动已经记下的任何数字。
ALTER TABLE runs ADD COLUMN eval_snapshot_id TEXT;
