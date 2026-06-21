CREATE TABLE relations (
  issue_id            TEXT NOT NULL,
  related_issue_id    TEXT NOT NULL,
  type                TEXT NOT NULL,
  related_identifier  TEXT,
  related_title       TEXT,
  related_state_name  TEXT,
  related_state_type  TEXT,
  related_state_color TEXT,
  PRIMARY KEY (issue_id, related_issue_id, type)
);
CREATE INDEX idx_relations_issue ON relations(issue_id);
