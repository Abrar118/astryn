-- Indexes for the local-tasks child lookups (detail view, cascades, label and
-- reverse-relation reads). The composite primary keys only cover their
-- leading column.
CREATE INDEX lt_checklist_items_task ON lt_checklist_items(task_id);
CREATE INDEX lt_attachments_task ON lt_attachments(task_id);
CREATE INDEX lt_comments_task ON lt_comments(task_id);
CREATE INDEX lt_relations_related ON lt_relations(related_id);
CREATE INDEX lt_task_labels_label ON lt_task_labels(label_id);
