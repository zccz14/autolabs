-- 跑实验的那条 Thread 从项目选定的「线程预设」起步，而不是只钉一个模型名。
-- 预设是一份设置快照：模型、推理档位、初始手册、预算一起钉在那条 Thread 上，
-- 之后改预设也影响不到已经开出去的实验。空 = 跟随这个人 Cybion 的账户默认。
ALTER TABLE projects ADD COLUMN run_preset TEXT;
-- 模型现在跟着预设走，项目上再留一个能被读到的模型字段只会误导人。
ALTER TABLE projects DROP COLUMN run_model;
