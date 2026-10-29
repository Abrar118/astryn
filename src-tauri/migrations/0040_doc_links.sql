-- F9: per-task doc links. App-owned (not a cache): a web link or a document in
-- a docs source, attached to one task of any tracker. `tracker` is the owning
-- tracker's module id (`linear`, `local-tasks`) and `task_id` that tracker's
-- task id. No foreign keys: a link outlives its task or docs source.
CREATE TABLE doc_links (
  id         TEXT PRIMARY KEY,
  tracker    TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('url', 'doc')),
  url        TEXT,
  source_id  TEXT,
  doc_path   TEXT,
  title      TEXT,
  note       TEXT,
  tags       TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'url' AND url IS NOT NULL AND source_id IS NULL AND doc_path IS NULL)
    OR (kind = 'doc' AND url IS NULL AND source_id IS NOT NULL AND doc_path IS NOT NULL)
  )
);
CREATE INDEX idx_doc_links_task ON doc_links(tracker, task_id);
