-- Additional cached issue fields for the list/board display options
-- (estimate, cycle, milestone). Labels already live in the `labels` table.
ALTER TABLE issues ADD COLUMN estimate INTEGER;
ALTER TABLE issues ADD COLUMN cycle_name TEXT;
ALTER TABLE issues ADD COLUMN cycle_number INTEGER;
ALTER TABLE issues ADD COLUMN milestone_name TEXT;
