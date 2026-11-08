-- 编号从 0009 挪到 0010：0009 同时被 research_loop 占用，两条迁移撞了号。
-- 内容没动（两条 CREATE INDEX 都是 IF NOT EXISTS，重跑无副作用），只是把序号排回一条线。
-- Agent 每次调用带的是一个 Cybion Thread id，验签之后就是拿它查这两张表。
-- 令牌只有 60 秒，查得慢一点都要重签，所以给两条查找路径各上一条索引。
CREATE INDEX IF NOT EXISTS idx_runs_cybion_thread ON runs(cybion_thread_id);
CREATE INDEX IF NOT EXISTS idx_projects_idea_thread ON projects(idea_thread_id);
