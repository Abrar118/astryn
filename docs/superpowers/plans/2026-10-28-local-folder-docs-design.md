# Local Folder Docs Source — Plan

Spec: `docs/superpowers/specs/2026-10-28-local-folder-docs-design.md`. TDD: each step starts with a failing test.

1. **Migration 0017** — rebuild `docs_sources` with `kind`/`location`, nullable GitHub columns. Test: a pre-0017 GitHub row survives as `kind = 'github'` (db test against a temp database).
2. **`local_docs.rs`** — `scan_folder`, `resolve_file`, `read_text`, `read_pdf`, `format_of`. Tests with `tempfile` dirs: extension filter, hidden skip, nested folders + pruning, size caps, truncation, `..`/absolute rejection, symlink escape (unix only).
3. **`db/docs.rs`** — `DocsSource { kind, location, available, owner/repo/branch: Option }`, `insert_local_docs_source`, `write_scan_meta`; GitHub wipe scoped to GitHub sources. Update existing tests.
4. **`commands/docs.rs`** — kind dispatch in `sync_docs` / `list_docs_tree` / `get_doc_content`; `add_local_docs_source` (Rust folder picker), `get_doc_pdf` (raw bytes); availability checks. Register in `lib.rs`, add owners in `modules/mod.rs`.
5. **Module manifest** — Docs no longer requires `docs-source` (Rust + TS), update tests.
6. **Frontend bindings** — `commands.ts`, `queries.ts` (`useDocPdf`, sync enabling per source kind).
7. **Viewers** — `docFormat.ts`, `TextViewer`, `PdfViewer` (`pdfjs-dist`, lazy canvas pages).
8. **DocsPage / picker / tree** — empty states, unavailable notice, kind icons.
9. **Settings → Documentation** — "Add a local folder…", per-kind rows.
10. **Verify** — focused tests, `npm test`, `npm run build`, `cargo test`, `cargo clippy`, `cargo fmt -- --check`, `git diff --check`.
