-- 退役被取代的旧口径：夏普曾经以 ratio 存过，1.93 被展示成 193%。
-- 0004 已经为这些项目升了 number 版；这里把被新版取代的 ratio 版正式下线，
-- 让「当前口径」与「历史版本」在账上分开，而不是两个都挂着当现役。
--
-- 只下线「已经有更高版本」的旧版：某项目如果只有 ratio 版，它仍是该项目的
-- 当前口径，贸然退役会让 sharpe 从契约里消失。
-- 幂等：命中过的行 retired_at 已非空，再跑一次不会重复。
UPDATE project_metrics
   SET retired_at = CAST(strftime('%s', 'now') AS INTEGER)
 WHERE key = 'sharpe'
   AND unit = 'ratio'
   AND retired_at IS NULL
   AND EXISTS (
     SELECT 1 FROM project_metrics newer
      WHERE newer.project_id = project_metrics.project_id
        AND newer.key = 'sharpe'
        AND newer.version > project_metrics.version
   );
