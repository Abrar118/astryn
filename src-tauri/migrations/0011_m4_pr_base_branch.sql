-- Target (base) branch of each PR, for the branch→target visualization.
ALTER TABLE github_prs ADD COLUMN base_branch TEXT;
