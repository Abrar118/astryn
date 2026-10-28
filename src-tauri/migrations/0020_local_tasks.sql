-- Local tasks: a tracker that lives entirely in SQLite (the source of truth,
-- not a cache). Ids are 'lt_' + random hex. See
-- docs/superpowers/specs/2026-10-28-local-tasks-design.md.

CREATE TABLE lt_spaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE lt_lists (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES lt_spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Identifier prefix (OPS -> OPS-12), unique across lists.
    key TEXT NOT NULL UNIQUE,
    next_number INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- A workflow: the statuses of a space, or of a list that overrides its space.
CREATE TABLE lt_statuses (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('backlog','unstarted','started','completed','canceled')),
    color TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX lt_statuses_scope ON lt_statuses(scope_id, position);

CREATE TABLE lt_sprints (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES lt_spaces(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT
);

CREATE TABLE lt_labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
);

CREATE TABLE lt_tasks (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lt_lists(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status_id TEXT NOT NULL,
    -- 0 none, 1 urgent, 2 high, 3 medium, 4 low (the neutral scale).
    priority INTEGER NOT NULL DEFAULT 0,
    assigned_to_me INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    due_date TEXT,
    estimate REAL,
    parent_id TEXT,
    sprint_id TEXT,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE (list_id, number)
);
CREATE INDEX lt_tasks_due ON lt_tasks(due_date);
CREATE INDEX lt_tasks_parent ON lt_tasks(parent_id);

CREATE TABLE lt_task_labels (
    task_id TEXT NOT NULL REFERENCES lt_tasks(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES lt_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
);

CREATE TABLE lt_checklist_items (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES lt_tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
);

-- Stored once: 'blocks' means task_id blocks related_id.
CREATE TABLE lt_relations (
    task_id TEXT NOT NULL REFERENCES lt_tasks(id) ON DELETE CASCADE,
    related_id TEXT NOT NULL REFERENCES lt_tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('blocks','related')),
    PRIMARY KEY (task_id, related_id, type)
);

CREATE TABLE lt_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES lt_tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE lt_attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES lt_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Linear issue -> local copy, so a re-import never duplicates or overwrites.
CREATE TABLE lt_imports (
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    PRIMARY KEY (source, source_id)
);
