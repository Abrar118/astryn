# F9 — Per-task doc links

**Date:** 2026-10-29
**Status:** Approved for build (spec approval waived for this run; open details are decided below as Rulings)
**Branch:** `feat/f9-doc-links`
**Requirement:** `requirements.md` §9 F9, §5 (`doc_links`), §11 M6. Builds on
`2026-10-28-swappable-tracker-design.md` (tracker-neutral drawer),
`2026-10-28-local-tasks-design.md`, `2026-06-24-docs-viewer-design.md`,
`2026-10-28-local-folder-docs-design.md` and `2026-10-28-clickup-docs-design.md`.

## 1. Summary

The task drawer (and the full-page task tab) gains a **Docs & links** section
for every tracker's task, Linear issues and local tasks alike. A link is either

- a **web link**: an http(s) URL, opened in the system browser, or
- a **doc link**: a document in any configured docs source (GitHub repository,
  local folder, ClickUp Doc), opened in Astryn's Docs page.

Each link has an optional title, note and tags, and can be edited or removed.
Links are app-owned rows in SQLite: they work offline, persist across restarts,
and are never written to Linear.

## 2. Data

Migration `0040_doc_links.sql` creates the one table the feature uses:

| column | notes |
|---|---|
| `id TEXT PRIMARY KEY` | `dl_` + random hex |
| `tracker TEXT NOT NULL` | owning tracker = its module id (`linear`, `local-tasks`) |
| `task_id TEXT NOT NULL` | that tracker's task id (Linear UUID, `lt_…`) |
| `kind TEXT NOT NULL` | `url` \| `doc` (CHECK) |
| `url TEXT` | `kind = url` only |
| `source_id TEXT` | `kind = doc` only: `docs_sources.id` (no foreign key) |
| `doc_path TEXT` | `kind = doc` only: path inside the source |
| `title`, `note` `TEXT` | optional, trimmed, `NULL` when blank |
| `tags TEXT NOT NULL DEFAULT '[]'` | JSON array of strings |
| `created_at`, `updated_at TEXT NOT NULL` | RFC 3339 UTC |

A table CHECK ties the target columns to `kind`. Index on `(tracker, task_id)`.
Rows are listed oldest first (`created_at, rowid`).

## 3. Backend (Docs module)

- `src-tauri/src/db/doc_links.rs`: `list`, `load`, `insert`, `update`,
  `delete`, all on plain values; unit-tested on a temp DB.
- `src-tauri/src/commands/doc_links.rs`: `validate_input` (pure) and thin
  commands, each starting with `state.require(ModuleId::Docs)?`:
  - `list_doc_links(tracker, task_id) -> DocLink[]`
  - `create_doc_link(tracker, task_id, input) -> DocLink`
  - `update_doc_link(id, input) -> DocLink` (replaces target, title, note, tags)
  - `delete_doc_link(id) -> ()`
- `DocLinkInput { kind, url?, sourceId?, docPath?, title?, note?, tags[] }`.
- New sanitized errors: `InvalidDocLink` ("Check the link and try again.") and
  `DocLinkNotFound` ("That link no longer exists."); bad URLs reuse `InvalidUrl`,
  a missing source reuses `DocsSourceNotFound`.
- `remove_module_data(docs)` also deletes `doc_links`.

## 4. Frontend

- `commands.ts`: `DocLink`, `DocLinkInput`, `listDocLinks`, `createDocLink`,
  `updateDocLink`, `deleteDocLink`.
- `src/lib/docLinkQueries.ts`: `useDocLinks(tracker, taskId)` (key
  `["doc-links", tracker, taskId]`, gated by `isActive("docs")`) and
  `useCreateDocLink` / `useUpdateDocLink` / `useDeleteDocLink` — optimistic, with
  snapshot rollback and a `goey-toast` error.
- `src/features/docs/docLinks.ts`: pure helpers (tag parsing, labels, cache
  edits) with tests.
- `src/features/docs/DocLinksPanel.tsx`: the section. `TaskDetail` builds it once
  (when Docs is active) and hands it to each tracker body, which places it in its
  own layout: after Resources in the Linear body, after Links in the local body.
- Row: kind icon, title (falls back to the host or file name), detail line (host,
  or source name · path), note, tag pills; Edit / Remove buttons that show on
  hover and on keyboard focus.
- Add / edit is an inline form (not a popover): a Web link / Doc toggle, then
  URL, or source + filtered document list; title, note, comma-separated tags.
  Escape cancels; Enter in a single-line field submits.
- Opening: a web link goes through `safeExternalUrl` + the opener plugin; a doc
  link opens a Docs tab on that document (`openDocTab`), closing the drawer in
  drawer mode.

## 5. Rulings

- **Owner module: Docs.** The commands, table and wipe belong to the Docs
  feature module; the section is hidden while Docs is off. No new module,
  capability or screen (no `VIEW_META` change).
- **Key = (tracker, task id).** The tracker column is the owning module id; Rust
  accepts only modules that provide the `tracker` capability, so a new tracker
  works without a schema change.
- **Local only.** The `[CHOICE]` "also push to Linear as an attachment" toggle is
  not built; nothing is written to Linear. Linear's own Resources and the local
  task Links section are unchanged.
- **Two kinds of target:** web link or doc in a docs source. A doc link stores
  the source id and path, not a copy of the document.
- **Orphans are kept.** Deleting a task, removing a docs source or turning a
  tracker off does not delete links. Links to a removed source show "Source
  removed" and can still be edited or deleted; links to a source whose provider
  is off show why and don't open. Restoring a local-tasks backup or an issue
  brings its links back.
- **Validation in Rust** (the frontend mirrors limits with `maxLength`): URL as
  for Linear links (`https://` added to a bare domain, http/https only, ≤ 2048);
  source must exist when the link is saved; path non-empty, ≤ 1024, no control
  characters; title ≤ 200; note ≤ 4000; ≤ 20 tags of ≤ 40 characters, trimmed,
  blank ones dropped, duplicates (case-insensitive) merged.
- **Doc titles are snapshots.** Picking a document fills the title with its
  display name; renaming the file later doesn't change the link.
- **The picker reads what the Docs page reads:** the source's cached tree
  (GitHub / ClickUp) or a fresh scan (local folder). A repository that was never
  synced shows "Nothing cached yet — open it in Docs to sync"; the picker does
  not start a sync.
- **Removal is immediate** (optimistic, rolled back on failure), matching the
  local task Links and checklist rows.
- **Docs data removal deletes the links** along with sources and caches.

## 6. Testing

- Rust: migration constraints, every DB function, validation (URL forms, limits,
  tags, unknown tracker, missing source), CRUD through the command logic,
  scoping (links of one task never appear for another, or for the same id under
  another tracker), Docs data wipe, guard coverage.
- Vitest: helpers (tags, labels, cache edits), query hooks (gating, optimistic
  add/edit/remove and rollback with a toast), the panel (render, add web link,
  add doc link, edit, remove, keyboard), `TaskDetail` passes the panel to both
  trackers only while Docs is active.

## 7. Out of scope

Pushing links to Linear, link previews/unfurling in the section, drag-reorder,
filtering tasks by tag, backlinks from a doc to its tasks.
