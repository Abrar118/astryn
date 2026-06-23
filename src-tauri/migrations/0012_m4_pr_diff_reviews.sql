-- Diff size + reviewer summary for richer PR triage.
ALTER TABLE github_prs ADD COLUMN additions     INTEGER;
ALTER TABLE github_prs ADD COLUMN deletions      INTEGER;
ALTER TABLE github_prs ADD COLUMN changed_files  INTEGER;
ALTER TABLE github_prs ADD COLUMN merged_at       TEXT;   -- set for the "merged" bucket
-- JSON array of { login, avatar, state } — opinionated reviews + pending requests.
ALTER TABLE github_prs ADD COLUMN reviewers       TEXT;
