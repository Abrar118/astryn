ALTER TABLE issues RENAME COLUMN estimate TO estimate_legacy;
ALTER TABLE issues ADD COLUMN estimate REAL;
UPDATE issues SET estimate = estimate_legacy;
ALTER TABLE issues DROP COLUMN estimate_legacy;
