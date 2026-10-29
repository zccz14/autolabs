-- 每个项目自己决定哪些指标是「必报」：run 少了它，平台就不给 frozen。
-- 模板里的六条口径全部标为必报——它们是项目契约本身。
ALTER TABLE project_metrics ADD COLUMN required INTEGER NOT NULL DEFAULT 0;

UPDATE project_metrics
   SET required = 1
 WHERE key IN (
   'cumulative_return',
   'annualized_return',
   'max_drawdown',
   'sharpe',
   'trades',
   'avg_daily_trades'
 );
