-- 每个项目一条「思路线程」（master thread）。
--
-- 它读整张研究地图、诊断这条线该往哪走，产出下一轮实验的思路；人随时可以进去
-- 干预。一个项目只绑一条，所以是项目上的字段，不是 run 上的。
ALTER TABLE projects ADD COLUMN idea_thread_id TEXT;
-- 这条 Thread 属于谁：只有它的 owner 的 Cybion 凭据才读得到它的回复。
ALTER TABLE projects ADD COLUMN idea_thread_user_id TEXT;
-- 最近一次请它出主意的那条输入，用来判断回复是不是这一轮的新回复。
ALTER TABLE projects ADD COLUMN idea_request_record_id INTEGER;
ALTER TABLE projects ADD COLUMN idea_requested_at INTEGER;
