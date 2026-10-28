# Local Folder Docs Source — Design

**Date:** 2026-10-28
**Status:** Approved (spec approval waived for the parallel-lanes run; open details decided below as Rulings)
**Branch:** `feat/docs-sources`
**Backlog:** `docs/backlog.md` item 1

## Purpose

Let the Docs page read documentation from a folder on this machine — Markdown,
plain text and PDF files — alongside the existing GitHub repositories. Docs
sources become "GitHub repository" or "Local folder" (and, in the follow-up
spec, "ClickUp Doc").

## Owner decisions (from the backlog, binding)

1. A source **type inside Docs**, not a separate module.
2. **Read in place.** Files are read from disk when viewed; nothing is copied into SQLite.
3. **On-demand refresh.** The tree is rescanned when the user asks; no file watching.
4. **PDFs render as real pages.**
5. **`.txt` shows as plain text** (not parsed as Markdown).
6. **Recursive.** Anything unreadable (unsupported type, unreadable/broken file, permission error) is skipped silently.
7. Docs must work with GitHub off: drop `docs` → `docs-source` requirement; GitHub repositories show as unavailable while GitHub is off.
8. Only the folder path is stored; removing Docs data deletes source entries, never the user's files.

## Rulings (details decided for this run)

- **Folder picking happens in Rust.** A new `add_local_docs_source` command opens the native folder dialog itself (`tauri-plugin-dialog`, already registered and used the same way by `upload_file`). The webview never supplies a filesystem path, so **no new Tauri capability, no CSP change for the picker**.
- **Reads are confined to the picked folder.** `get_doc_content` / `get_doc_pdf` take a source id + a relative path. The path must be relative with no `..`/root components, have a supported extension, and its canonicalized form must stay inside the canonicalized root (so symlinks pointing outside are refused).
- **Scan rules:** recursive; entries whose name starts with `.` (e.g. `.git`, `.obsidian`) are skipped; symlinks are not followed; supported extensions are `.md`, `.markdown`, `.txt`, `.pdf` (case-insensitive); a file must open for reading to be listed; folders with no supported files are pruned.
- **Limits:** text/Markdown files over 5 MB and PDFs over 50 MB are skipped; a scan stops at 5,000 listed files, 50,000 directory entries visited (so picking a home folder or drive is not a full disk walk) or depth 32 and reports `truncated` (reusing the existing flag). Reads are capped on bytes actually read (`take(max + 1)`), not on an earlier size check.
- **What is stored:** the folder path (`docs_sources.location`) plus scan metadata in `docs_sync_meta` (last scanned time, file count, truncated) so Settings can show "12 files · scanned 3m ago". The listing and file contents are never stored.
- **Refresh = rescan, on request only.** A local source never auto-syncs: `list_docs_tree` is the one scan (it also records the scan metadata) and TanStack Query keeps it (`staleTime: Infinity`); the header's rescan button invalidates it.
- **Text decoding:** Markdown and `.txt` are decoded as UTF-8, lossily (invalid bytes become U+FFFD) rather than failing.
- **Missing folder:** if the folder was moved or deleted, scans fail with a sanitized "That folder can't be read." error; the source stays configured so the user can fix or remove it.
- **Source ids** are `local:<canonical path>` (symlinks resolved, `..` removed, on-disk case on Windows, no `\\?\` prefix; non-UTF-8 paths refused), so one folder reached two ways is one source. A sync or scan that finishes after its source was removed writes nothing (checked inside the write transaction). Ids are stable across renames ( the primary key doubles as the duplicate guard, as for GitHub).
- **PDF viewer:** `pdfjs-dist` (pinned `5.7.284`, loaded lazily in its own chunk) renders each page to a `<canvas>`, lazily as pages scroll into view. Bytes come from Rust as a raw IPC response (`tauri::ipc::Response` → `ArrayBuffer`). The worker is bundled by Vite (served from `'self'`, allowed by the existing `script-src 'self'`); pdf.js 5.7 uses no `eval`, so **no CSP change**. No CMap, ICC, standard-font or wasm URLs are configured (the CSP allows no fetches besides IPC, and wasm would need `wasm-unsafe-eval`): pdf.js falls back to system fonts, and the rare PDF needing external CMaps or JPEG 2000 decoding may render incompletely. No text layer (no selection/search inside PDFs) in v1.
- **GitHub sources with GitHub off** stay listed with `available: false`; the picker shows them disabled ("GitHub is off") and their commands return the sanitized `ModuleDisabled` error. Their cache is kept.
- **GitHub cache wipe is scoped** to GitHub-kind sources, so changing the GitHub token no longer touches local-folder metadata (or ClickUp's cache later).
- **GitHub repos stay Markdown-only.** The backlog's later line about "GitHub repositories with Markdown, text or PDF files" is not built here; GitHub sync is unchanged.

## Data

Migration `0017_docs_source_kinds.sql` rebuilds `docs_sources` (SQLite can't drop
`NOT NULL`):

| column | notes |
|---|---|
| `id TEXT PRIMARY KEY` | `owner/repo@branch` (GitHub), `local:<path>` (local) |
| `kind TEXT NOT NULL DEFAULT 'github'` | `'github'` \| `'local'` (\| `'clickup'` later) |
| `name TEXT NOT NULL` | display label |
| `owner`, `repo`, `branch` `TEXT` | GitHub only, now nullable |
| `location TEXT` | local: absolute folder path |
| `position`, `created_at` | unchanged |

Existing rows copy across as `kind = 'github'`. `docs_files` / `docs_sync_meta` are unchanged.

## Backend

- `src-tauri/src/local_docs.rs`: `scan_folder(root) -> Scan { entries, truncated }`, `resolve_file(root, rel) -> Option<PathBuf>`, `read_text`, `read_pdf`, `format_of(name)`. Pure std; unit-tested with temp dirs.
- `db/docs.rs`: `DocsSource` gains `kind`, `location`, `available`; GitHub fields become `Option`. `insert_local_docs_source`, `write_scan_meta`.
- `commands/docs.rs`: `add_local_docs_source` (picker), `get_doc_pdf`; `sync_docs`, `list_docs_tree`, `get_doc_content` dispatch on the source kind. Every command starts with `state.require(ModuleId::Docs)?`; GitHub sources additionally require the GitHub module.
- `modules/mod.rs`: `docs` → `requires: []`, `optional: [DocsSource]`.
- New `CmdError::DocsFolderUnavailable` ("That folder can't be read.").

## Frontend

- `commands.ts`: `DocsSource` gains `kind`, `location`, `available`; `addLocalDocsSource()`, `getDocPdf()`.
- `docFormat.ts`: viewer choice per file (`markdown` / `text` / `pdf`) — only local sources carry text/PDF.
- `DocsPage`: empty state when there are no sources ("Add a source"); the GitHub-token prompt only applies to a GitHub source; an unavailable source shows an inline notice. Viewer switches between `DocViewer` (Milkdown), `TextViewer` (`<pre>`), `PdfViewer`.
- Picker + Settings list show kind icons and per-kind detail (repo · branch, or folder path).
- Settings → Documentation: "Add a local folder…" button next to the GitHub form.
- `MODULE_MANIFEST` / `MODULE_COPY` updated (Docs description no longer says GitHub-only).

## Testing

- Rust: scan rules (extensions, hidden, nesting, pruning, size caps, truncation), path confinement (`..`, absolute, symlink escape), migration carries GitHub rows, local add/duplicate, sync meta, GitHub-off availability, scoped GitHub wipe, module manifest change.
- Vitest: `docFormat`, DocsPage local source rendering (text viewer, PDF branch with a mocked viewer, no-sources empty state, unavailable GitHub source), modules manifest.

## Out of scope

File watching; editing; full-text search; GitHub text/PDF files; relative images inside local Markdown.
