-- Docs sources gain a kind: a GitHub repository (as before) or a local folder
-- (and later a ClickUp Doc). Local folders are read in place, so only their path
-- is stored (`location`); their files are never copied into the cache.
--
-- owner/repo/branch only apply to GitHub sources, so they become nullable.
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt and its rows
-- copied across as `github` sources. docs_files / docs_sync_meta are untouched
-- (their source_id values are unchanged).
CREATE TABLE docs_sources_new (
  id         TEXT PRIMARY KEY,                 -- "owner/repo@branch" | "local:<path>"
  kind       TEXT NOT NULL DEFAULT 'github',   -- 'github' | 'local'
  name       TEXT NOT NULL,
  owner      TEXT,                             -- GitHub only
  repo       TEXT,                             -- GitHub only
  branch     TEXT,                             -- GitHub only
  location   TEXT,                             -- local: absolute folder path
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO docs_sources_new (id, kind, name, owner, repo, branch, location, position, created_at)
SELECT id, 'github', name, owner, repo, branch, NULL, position, created_at
FROM docs_sources;

DROP TABLE docs_sources;
ALTER TABLE docs_sources_new RENAME TO docs_sources;
