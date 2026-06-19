-- Attachment-derived counts for the list/board "Links" and "Pull requests"
-- display options. Derived at sync time from each issue's attachments.
ALTER TABLE issues ADD COLUMN link_count INTEGER;
ALTER TABLE issues ADD COLUMN pr_count INTEGER;
