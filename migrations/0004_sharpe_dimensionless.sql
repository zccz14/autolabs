-- 夏普是「每单位波动换来多少收益」的倍数，不是比例：存 1.9322 就该显示 1.93，
-- 而不是 193.22%。把已有项目里 unit = 'ratio' 的 sharpe 升一个新版本（只追加，
-- 历史行一个字节都不动），之后榜单按 number 原样展示。
--
-- 幂等：跑完之后 sharpe 的最新版本 unit 已经是 'number'，再跑一次不会命中。
INSERT INTO project_metrics (
  id, project_id, key, version, label, unit, direction, definition_md,
  is_primary, required, sort_order, created_by, created_at
)
SELECT
  'met_' || lower(hex(randomblob(16))),
  m.project_id,
  m.key,
  m.version + 1,
  m.label,
  'number',
  m.direction,
  m.definition_md,
  m.is_primary,
  m.required,
  m.sort_order,
  m.created_by,
  CAST(strftime('%s', 'now') AS INTEGER)
FROM project_metrics m
JOIN (
  SELECT project_id, key, MAX(version) AS version
    FROM project_metrics
   WHERE key = 'sharpe'
   GROUP BY project_id, key
) latest
  ON latest.project_id = m.project_id
 AND latest.key = m.key
 AND latest.version = m.version
WHERE m.unit = 'ratio'
  AND m.retired_at IS NULL;
