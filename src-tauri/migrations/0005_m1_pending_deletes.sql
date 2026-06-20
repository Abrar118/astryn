CREATE TABLE pending_issue_deletes (
  issue_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
