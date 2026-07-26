-- Linear's completedAt, for the report generators' "completed in window" bucket.
-- Rows cached before this migration keep NULL; readers fall back to updated_at.
ALTER TABLE issues ADD COLUMN completed_at TEXT;
