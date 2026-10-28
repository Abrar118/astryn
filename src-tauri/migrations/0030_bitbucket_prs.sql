-- Bitbucket Cloud PR cache (module spec 2a). Column-for-column the same shape as
-- github_prs / github_sync_meta so the provider-neutral cache code
-- (db/code_host.rs) serves both. A PR may appear in several scopes.
CREATE TABLE bitbucket_prs (
  id                TEXT NOT NULL,     -- "workspace/repo_slug#id"
  bucket            TEXT NOT NULL,     -- mine | needs_review | repo:<lowercase workspace/slug>
  repo              TEXT NOT NULL,     -- "workspace/repo_slug"
  number            INTEGER NOT NULL,  -- pull request id (unique within the repo)
  title             TEXT,
  draft             INTEGER,
  mergeable         TEXT,              -- always 'unknown' (not in Bitbucket list responses)
  ci_status         TEXT,              -- always 'none' in lists; the drawer reads statuses live
  review_decision   TEXT,              -- approved | changes_requested | review_required | NULL
  author_login      TEXT,
  author_avatar     TEXT,
  comment_count     INTEGER,
  branch            TEXT,              -- source branch
  base_branch       TEXT,              -- destination branch
  url               TEXT,
  linear_identifier TEXT,
  updated_at        TEXT,
  synced_at         TEXT NOT NULL,
  merged_at         TEXT,
  additions         INTEGER,
  deletions         INTEGER,
  changed_files     INTEGER,
  reviewers         TEXT,              -- JSON array of { login, avatar, state }
  PRIMARY KEY (id, bucket)
);
CREATE INDEX idx_bitbucket_prs_bucket ON bitbucket_prs(bucket);
CREATE INDEX idx_bitbucket_prs_linear_identifier ON bitbucket_prs(linear_identifier);

CREATE TABLE bitbucket_sync_meta (
  bucket         TEXT PRIMARY KEY,
  fetched_count  INTEGER NOT NULL,
  truncated      INTEGER NOT NULL,
  last_synced_at TEXT
);
