-- Multiple documentation repositories. Each source owns its own slice of the
-- cache, so switching sources in the Docs header is a local read, not a resync.
--
-- The id is derived from the origin (`owner/repo@branch`) rather than random:
-- it is stable across renames (so open doc tabs survive one) and its PRIMARY KEY
-- doubles as the "this repo is already a source" guard.
--
-- No FOREIGN KEY clauses: `PRAGMA foreign_keys` is off (SQLite's default) and
-- turning it on app-wide for this one relationship is a bigger change than the
-- feature warrants, so a declared ON DELETE CASCADE would silently never fire.
-- `remove_docs_source` deletes the child rows explicitly, in one transaction.
CREATE TABLE docs_sources (
  id         TEXT PRIMARY KEY,          -- "owner/repo@branch"
  name       TEXT NOT NULL,             -- user-facing label, defaults to the repo name
  owner      TEXT NOT NULL,
  repo       TEXT NOT NULL,
  branch     TEXT NOT NULL,
  position   INTEGER NOT NULL,          -- insertion order, drives list ordering
  created_at TEXT NOT NULL
);

-- Carry the single pre-existing repo (previously three loose `settings` keys)
-- forward as the first source, so upgrading keeps its already-synced cache.
INSERT INTO docs_sources (id, name, owner, repo, branch, position, created_at)
SELECT
  (SELECT value FROM settings WHERE key = 'docs_repo_owner') || '/' ||
  (SELECT value FROM settings WHERE key = 'docs_repo_name')  || '@' ||
  COALESCE((SELECT value FROM settings WHERE key = 'docs_repo_branch'), 'main'),
  (SELECT value FROM settings WHERE key = 'docs_repo_name'),
  (SELECT value FROM settings WHERE key = 'docs_repo_owner'),
  (SELECT value FROM settings WHERE key = 'docs_repo_name'),
  COALESCE((SELECT value FROM settings WHERE key = 'docs_repo_branch'), 'main'),
  0,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'docs_repo_owner')
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'docs_repo_name');

-- docs_files: PRIMARY KEY becomes (source_id, path). SQLite cannot add a column
-- to a primary key, so the table is rebuilt and its rows re-parented.
CREATE TABLE docs_files_new (
  source_id    TEXT NOT NULL,
  path         TEXT NOT NULL,             -- repo-relative, e.g. "02-technical/README.md"
  name         TEXT NOT NULL,             -- basename
  kind         TEXT NOT NULL,             -- 'blob' (file) | 'tree' (folder)
  parent_path  TEXT NOT NULL DEFAULT '',  -- '' for top-level
  sha          TEXT NOT NULL,
  content      TEXT,                      -- markdown text; NULL for folders
  synced_at    TEXT NOT NULL,
  PRIMARY KEY (source_id, path)
);

INSERT INTO docs_files_new (source_id, path, name, kind, parent_path, sha, content, synced_at)
SELECT (SELECT id FROM docs_sources ORDER BY position LIMIT 1),
       path, name, kind, parent_path, sha, content, synced_at
FROM docs_files
WHERE EXISTS (SELECT 1 FROM docs_sources);

DROP TABLE docs_files;
ALTER TABLE docs_files_new RENAME TO docs_files;
CREATE INDEX idx_docs_files_parent ON docs_files(source_id, parent_path);

-- docs_sync_meta: was a CHECK (id = 1) singleton; now one row per source.
CREATE TABLE docs_sync_meta_new (
  source_id      TEXT PRIMARY KEY,
  last_synced_at TEXT,
  file_count     INTEGER NOT NULL DEFAULT 0,
  tree_sha       TEXT,
  truncated      INTEGER NOT NULL DEFAULT 0
);

INSERT INTO docs_sync_meta_new (source_id, last_synced_at, file_count, tree_sha, truncated)
SELECT (SELECT id FROM docs_sources ORDER BY position LIMIT 1),
       last_synced_at, file_count, tree_sha, truncated
FROM docs_sync_meta
WHERE EXISTS (SELECT 1 FROM docs_sources);

DROP TABLE docs_sync_meta;
ALTER TABLE docs_sync_meta_new RENAME TO docs_sync_meta;

-- The origin now lives in docs_sources; drop the superseded settings keys.
DELETE FROM settings WHERE key IN ('docs_repo_owner', 'docs_repo_name', 'docs_repo_branch');
