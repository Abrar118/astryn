-- Docs search: per-file index state, text chunks, and a keyword (FTS5) index.
-- No foreign keys (the app runs with them off); deletes are explicit.

CREATE TABLE doc_indexed_files (
    source_id    TEXT NOT NULL,
    path         TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    indexed_at   TEXT NOT NULL,
    PRIMARY KEY (source_id, path)
);

CREATE TABLE doc_chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id       TEXT NOT NULL,
    path            TEXT NOT NULL,
    title           TEXT NOT NULL,
    heading_path    TEXT NOT NULL,
    start_line      INTEGER NOT NULL,
    content         TEXT NOT NULL,
    embedding       BLOB,
    embedding_model TEXT
);
CREATE INDEX idx_doc_chunks_file ON doc_chunks(source_id, path);

CREATE VIRTUAL TABLE doc_chunks_fts USING fts5(
    title, heading_path, content,
    content = 'doc_chunks', content_rowid = 'id',
    tokenize = 'porter unicode61'
);

CREATE TRIGGER doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
    INSERT INTO doc_chunks_fts(rowid, title, heading_path, content)
    VALUES (new.id, new.title, new.heading_path, new.content);
END;

CREATE TRIGGER doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
    INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, title, heading_path, content)
    VALUES ('delete', old.id, old.title, old.heading_path, old.content);
END;

CREATE TRIGGER doc_chunks_au AFTER UPDATE OF title, heading_path, content ON doc_chunks BEGIN
    INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, title, heading_path, content)
    VALUES ('delete', old.id, old.title, old.heading_path, old.content);
    INSERT INTO doc_chunks_fts(rowid, title, heading_path, content)
    VALUES (new.id, new.title, new.heading_path, new.content);
END;
