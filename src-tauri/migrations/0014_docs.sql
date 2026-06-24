-- Cached docs tree + file contents from GAM-Health-Solutions/core-psycloud-docs.
-- The whole tree is replaced on each sync (single source, no buckets).
CREATE TABLE docs_files (
  path         TEXT PRIMARY KEY,          -- repo-relative, e.g. "02-technical/backend/README.md"
  name         TEXT NOT NULL,             -- basename
  kind         TEXT NOT NULL,             -- 'blob' (file) | 'tree' (folder)
  parent_path  TEXT NOT NULL DEFAULT '',  -- '' for top-level
  sha          TEXT NOT NULL,
  content      TEXT,                      -- markdown text; NULL for folders
  synced_at    TEXT NOT NULL
);
CREATE INDEX idx_docs_files_parent ON docs_files(parent_path);

-- Single-row sync metadata so staleness/truncation survive restart.
CREATE TABLE docs_sync_meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  last_synced_at TEXT,
  file_count     INTEGER NOT NULL DEFAULT 0,
  tree_sha       TEXT,
  truncated      INTEGER NOT NULL DEFAULT 0
);
