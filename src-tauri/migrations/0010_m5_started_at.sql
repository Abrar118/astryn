-- Track when an issue first entered a "started" state (Linear `startedAt`),
-- so the agenda can show "from which day I started working on this".
ALTER TABLE issues ADD COLUMN started_at TEXT;
