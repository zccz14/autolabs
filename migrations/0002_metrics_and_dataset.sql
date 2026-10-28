-- 项目级：指标契约（带口径、可版本化、只追加）与数据集引用（Firmament 定义的 manifest 摘要 pin）。

CREATE TABLE project_metrics (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,              -- 机器键：cumulative_return
  version       INTEGER NOT NULL,
  label         TEXT NOT NULL,              -- 人看的名字：累计收益率
  unit          TEXT NOT NULL,              -- ratio | count | bps | seconds
  direction     TEXT NOT NULL CHECK (direction IN ('higher-better', 'lower-better', 'neutral')),
  definition_md TEXT NOT NULL,              -- 口径说明：分母、成本、样本外、年化因子…
  is_primary    INTEGER NOT NULL DEFAULT 0, -- 榜单默认排序指标
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  retired_at    INTEGER,
  UNIQUE (project_id, key, version)
);

-- 数据集 pin：AutoLabs 不复制数据，只钉住 Firmament 的 manifest 摘要。
-- 同一数据集再次绑定会新增一 pin，旧 pin 永不修改。
CREATE TABLE dataset_pins (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  firmament_dataset_id  TEXT NOT NULL,
  name                  TEXT NOT NULL DEFAULT '',
  digest                TEXT NOT NULL,      -- 对排序后的 path\0sha\0size 求 sha256
  file_count            INTEGER NOT NULL DEFAULT 0,
  bytes                 INTEGER NOT NULL DEFAULT 0,
  manifest_key          TEXT,               -- R2 中的 manifest 快照，便于离线溯源
  verified              INTEGER NOT NULL DEFAULT 1, -- 0 = 本地/离线绑定，未与 Firmament 核对
  note                  TEXT NOT NULL DEFAULT '',
  pinned_by             TEXT NOT NULL,
  pinned_at             INTEGER NOT NULL
);

ALTER TABLE projects ADD COLUMN dataset_pin_id TEXT REFERENCES dataset_pins(id);
ALTER TABLE runs ADD COLUMN dataset_pin_id TEXT REFERENCES dataset_pins(id);
ALTER TABLE runs ADD COLUMN metric_set_json TEXT;

CREATE INDEX idx_project_metrics ON project_metrics(project_id, key, version DESC);
CREATE INDEX idx_dataset_pins_project ON dataset_pins(project_id, pinned_at DESC);
