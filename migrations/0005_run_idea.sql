-- 研究地图的叙事轴：每个实验立项时写清它想验证什么（思路）。
-- 与 report_md（结果）并列，二者加指标一起构成目录的一行。见 docs/decisions/0002-research-map.md。
ALTER TABLE runs ADD COLUMN idea_md TEXT;
