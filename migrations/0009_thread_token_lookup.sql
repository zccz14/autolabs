-- Agent 每次调用带的是一个 Cybion Thread id，验签之后就是拿它查这两张表。
-- 令牌只有 60 秒，查得慢一点都要重签，所以给两条查找路径各上一条索引。
CREATE INDEX IF NOT EXISTS idx_runs_cybion_thread ON runs(cybion_thread_id);
CREATE INDEX IF NOT EXISTS idx_projects_idea_thread ON projects(idea_thread_id);
