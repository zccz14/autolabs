-- AutoLabs 初始 schema：项目是一等实体，实验文件由平台托管（内容寻址快照）。
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  owner_user_id   TEXT NOT NULL REFERENCES users(id),
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public-read')),
  lab_seq         INTEGER NOT NULL DEFAULT 0,       -- 实验编号计数器，只增不减，永不复用
  sota_run_id     TEXT,
  rules_snapshot_id TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('owner', 'maintainer', 'runner', 'reader')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- 机器侧凭据：alb_<id>_<secret>，只存 secret 的 sha256，能力按项目收窄。
CREATE TABLE project_tokens (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  secret_sha256 TEXT NOT NULL UNIQUE,
  capabilities  TEXT NOT NULL,       -- 逗号分隔：read,write,verdict,sota
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,
  revoked_at    INTEGER
);

CREATE TABLE blobs (
  sha256     TEXT PRIMARY KEY,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE project_blobs (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha256     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, sha256)
);

CREATE TABLE snapshots (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id      TEXT REFERENCES snapshots(id),
  tree_sha       TEXT NOT NULL,       -- 对排序后的 (path, sha) 求 sha256，快照身份
  message        TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  frozen_at      INTEGER,             -- 非空 = 已冻结，拒绝一切写入
  created_at     INTEGER NOT NULL
);

CREATE TABLE snapshot_entries (
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  size        INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, path)
);

CREATE TABLE runs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lab_no             INTEGER NOT NULL,
  external_ref       TEXT NOT NULL UNIQUE,   -- autolabs:<slug>:lab-0007，开 Thread 的幂等键
  state              TEXT NOT NULL CHECK (state IN ('proposed', 'dispatched', 'running', 'evaluating', 'frozen', 'rejected', 'lost')),
  input_snapshot_id  TEXT NOT NULL REFERENCES snapshots(id),
  output_snapshot_id TEXT REFERENCES snapshots(id),
  cybion_thread_id   TEXT,
  note               TEXT NOT NULL DEFAULT '',
  report_md          TEXT,
  metrics_json       TEXT,
  gates_json         TEXT,
  created_by         TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  settled_at         INTEGER,
  UNIQUE (project_id, lab_no)
);

CREATE TABLE sota_events (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id        TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('promote', 'demote', 'exclude')),
  reason        TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,
  kind          TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  actor_user_id TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_runs_project ON runs(project_id, lab_no DESC);
CREATE INDEX idx_snapshots_project ON snapshots(project_id, created_at DESC);
CREATE INDEX idx_entries_sha ON snapshot_entries(sha256);
CREATE INDEX idx_sota_events_project ON sota_events(project_id, created_at DESC);
CREATE INDEX idx_events_project ON events(project_id, created_at DESC);
