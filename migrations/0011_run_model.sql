-- 项目层面指定「跑实验那条 Thread」用哪个模型。
-- 空 = 跟随这个人在 Cybion 里的默认值；出思路的 master thread 不受影响（那条可以进去手改）。
ALTER TABLE projects ADD COLUMN run_model TEXT;
