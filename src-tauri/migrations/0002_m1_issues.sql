CREATE TABLE issues (
  id            TEXT PRIMARY KEY,
  identifier    TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  due_date      TEXT,
  priority      INTEGER,
  url           TEXT NOT NULL,
  state_id      TEXT,
  state_name    TEXT,
  state_type    TEXT,
  state_color   TEXT,
  assignee_id   TEXT,
  assignee_name TEXT,
  team_id       TEXT,
  team_key      TEXT,
  project_id    TEXT,
  project_name  TEXT,
  parent_id     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  archived_at   TEXT,
  synced_at     TEXT NOT NULL,
  raw_json      TEXT
);
CREATE INDEX idx_issues_due ON issues(due_date);
CREATE INDEX idx_issues_assignee ON issues(assignee_id);
CREATE INDEX idx_issues_updated ON issues(updated_at);

CREATE TABLE labels (
  issue_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  name     TEXT,
  color    TEXT,
  PRIMARY KEY (issue_id, label_id)
);

CREATE TABLE sync_cursors (
  source TEXT NOT NULL,
  key    TEXT NOT NULL,
  value  TEXT,
  PRIMARY KEY (source, key)
);
