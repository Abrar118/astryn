-- Cached docs keep the order their source gave them. ClickUp returns a Doc's
-- pages in the order the author arranged them, which no name-based sort can
-- reconstruct. Existing rows get 0 and fall back to path order until resynced.
ALTER TABLE docs_files ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
