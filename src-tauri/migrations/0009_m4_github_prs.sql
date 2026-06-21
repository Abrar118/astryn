-- Viewer/bucket-centric GitHub PR cache. A PR may appear in multiple buckets.
CREATE TABLE github_prs (
  id                TEXT NOT NULL,     -- "owner/repo#number"
  bucket            TEXT NOT NULL,     -- needs_review | mine | assigned | involved
  repo              TEXT NOT NULL,     -- "owner/name"
  number            INTEGER NOT NULL,
  title             TEXT,
  draft             INTEGER,           -- bool; every cached row is an OPEN PR
  mergeable         TEXT,              -- mergeable | conflicting | unknown
  ci_status         TEXT,              -- success | failure | pending | none
  review_decision   TEXT,              -- approved | changes_requested | review_required | NULL
  author_login      TEXT,
  author_avatar     TEXT,
  comment_count     INTEGER,
  branch            TEXT,
  url               TEXT,
  linear_identifier TEXT,              -- normalized uppercase id (e.g. "ENG-123"), nullable
  updated_at        TEXT,
  synced_at         TEXT NOT NULL,
  PRIMARY KEY (id, bucket)
);
CREATE INDEX idx_github_prs_bucket ON github_prs(bucket);
CREATE INDEX idx_github_prs_linear_identifier ON github_prs(linear_identifier);
-- Speeds the read-time join github_prs.linear_identifier = issues.identifier.
CREATE INDEX idx_issues_identifier ON issues(identifier);

-- Per-bucket sync metadata so truncation/staleness survive restart.
CREATE TABLE github_sync_meta (
  bucket         TEXT PRIMARY KEY,
  fetched_count  INTEGER NOT NULL,
  truncated      INTEGER NOT NULL,     -- bool: cap was hit
  last_synced_at TEXT
);
