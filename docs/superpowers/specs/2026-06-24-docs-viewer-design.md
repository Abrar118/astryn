# Docs Viewer (F-Docs) — Design

**Date:** 2026-06-24
**Status:** Approved, pending implementation plan
**Branch:** `feat/git-and-docs`

## Purpose

Add a new **Docs** page to Astryn for browsing the team's project documentation,
which lives as nested markdown files in the private GitHub repo
**`GAM-Health-Solutions/core-psycloud-docs`** (`main` branch). The page is a
two-pane reader: a hierarchical document tree on the left, a rendered doc on the
right. Read-only for now; the renderer is chosen so editing can be added later
without swapping it out.

## Source repo shape

`core-psycloud-docs` is a multi-level nested tree of markdown files. Top-level
sections (`00-overview/`, `01-product/`, `02-technical/`, …) contain numbered
`.md` files (`01-architecture.md`), per-folder `README.md` files, and deeper
subfolders (`02-technical/backend/`, `02-technical/frontend/`). The repo is
**private**, so all fetches require an authenticated GitHub credential. Numeric
filename prefixes (`NN-`) encode display order.

## Decisions (locked)

- **Renderer:** Milkdown in read-only mode (`editable: () => false`), reusing the
  editor already integrated for issue descriptions. Chosen over `react-markdown`
  so the same component can become editable later with no migration.
- **Caching:** Cache the full tree + file contents into SQLite (offline-first,
  mirroring the `github_prs` / `github_sync_meta` pattern). Page opens instantly
  and works offline; a manual Refresh re-syncs.
- **Source:** Hardcoded to `GAM-Health-Solutions/core-psycloud-docs` on `main`.
  Not configurable in v1; can be made configurable later without rework.
- **Auth:** Reuse the existing classic GitHub PAT in the keychain
  (account `github_token`, used by the PR dashboard). No new credential.

## Architecture

### Hard rule compliance

All GitHub fetches stay in Rust (`requirements.md` §3). The webview never calls
GitHub and never sees the token. Data flow: GitHub → Rust client → SQLite cache →
Tauri command → TanStack Query → React (Milkdown).

### Backend (Rust)

The existing `GitHubClient` (`src-tauri/src/github/mod.rs`) is **GraphQL-only**.
Add one contained method:

```
rest_get(&self, authorization: &str, path: &str) -> Result<Value, GitHubError>
```

It hits `https://api.github.com{path}`, reusing the same `reqwest::Client`,
`Bearer`-prefixed auth (via `PatProvider`), and the existing error
interpretation (`interpret_status`, rate-limit hints, sanitized errors).

New module `src-tauri/src/commands/docs.rs`, mirroring `commands/github.rs`:
thin `#[tauri::command]` wrappers over unit-testable `*_logic(...)` fns that
receive injected dependencies (creds provider, `&SqlitePool`, a generation
`AtomicU64` guard, and a fetch closure). Acquire a `docs_lock`
(`tokio::sync::Mutex` on `AppState`); add `docs_generation` guard so an
in-flight sync is invalidated if the token changes.

**Sync flow (`sync_docs_logic`):**

1. `GET /repos/GAM-Health-Solutions/core-psycloud-docs/git/trees/main?recursive=1`
   → full flat tree (arbitrary depth) in one request. Record GitHub's
   `truncated` flag.
2. Keep `tree` entries and `blob` entries whose path ends in `.md`.
3. For each markdown blob, fetch its content
   (`GET /repos/.../git/blobs/{sha}` → base64 → decode, or the contents API).
4. Transactionally upsert rows into `docs_files`; clear rows whose path no longer
   exists in the fetched tree; write `docs_sync_meta`.

**Commands** (registered in `lib.rs` via `generate_handler!`, sanitized
`Result<T, CmdError>`):

- `sync_docs() -> DocsSyncResult` — fetch + cache; returns counts / truncated.
- `list_docs_tree() -> Vec<DocNode>` — flat list of cached entries
  (`path`, `name`, `type`, `parent_path`); the frontend nests it.
- `get_doc_content(path: String) -> String` — cached markdown for one file.
- `get_docs_status() -> DocsStatus` — `last_synced_at`, `file_count`,
  `token_present` (reuse GitHub status), `truncated`.

### Data / migration

New migration `src-tauri/migrations/0014_docs.sql` (only tables this milestone
uses):

- **`docs_files`**
  - `path TEXT PRIMARY KEY` (repo-relative, e.g. `02-technical/backend/README.md`)
  - `name TEXT NOT NULL` (basename)
  - `type TEXT NOT NULL` (`blob` | `tree`)
  - `parent_path TEXT` (empty string for top-level)
  - `sha TEXT NOT NULL`
  - `content TEXT` (NULL for folders)
  - `synced_at TEXT NOT NULL`
  - index on `parent_path`
- **`docs_sync_meta`** (single row, PK on a constant key)
  - `last_synced_at TEXT`
  - `file_count INTEGER`
  - `tree_sha TEXT`
  - `truncated INTEGER NOT NULL DEFAULT 0`

DB-access helpers live in `src-tauri/src/db/docs.rs` (upsert tree, read tree,
read content, read/write meta), mirroring `db/github.rs`.

### Frontend

New feature folder `src/features/docs/`:

- **`DocsPage.tsx`** — two-pane split: left `DocsTree`, right `DocViewer`, plus a
  thin toolbar (title, Refresh button, "last synced" timestamp). On open: select
  root `README.md` if present. No token → prompt linking to Settings (reuse the
  PR feature's pattern). Empty cache → auto-trigger first `sync_docs`.
- **`DocsTree.tsx`** — renders the nested tree from the flat list; collapsible
  folders; tracks the selected path; clicking a file loads it on the right.
- **`DocViewer.tsx`** — a Milkdown instance configured `editable: () => false`,
  fed the cached markdown string from `get_doc_content(path)`.
- **`docsTree.ts`** — pure logic: build the nested tree from the flat list;
  derive display labels by **stripping leading `NN-` numeric prefixes and the
  `.md` extension**; sort siblings by numeric prefix with `README` first.
  Colocated `docsTree.test.ts`.

Typed bindings in `src/lib/commands.ts` (`syncDocs`, `listDocsTree`,
`getDocContent`, `getDocsStatus` + the `DocNode` / `DocsStatus` /
`DocsSyncResult` types). React Query hooks in `src/lib/queries.ts`
(`useDocsTree`, `useDocContent(path)`, `useDocsSync`, `useDocsStatus`), with a
Refresh that calls `syncDocs()` then invalidates `["docs-tree"]` and
`["doc-content"]`.

### View registration (3 spots + tab strip)

1. `src/lib/paneModel.ts` — add `"docs"` to the `ViewKind` union.
2. `src/components/Dock.tsx` — `NAV`/`META` entry, lucide `BookText` icon, label
   "Docs".
3. `src/components/SplitLayout.tsx` — `case "docs": return <DocsPage/>` in
   `PaneContent`.
4. `src/components/PaneTabStrip.tsx` — tab icon + label for `"docs"`.

## Error handling

- Sync errors surface via `goey-toast` (sanitized). HTTP-200-with-`errors` and
  non-2xx are failures; rate-limit hints respected.
- Offline / no cache yet: show an empty-state with a Refresh action.
- No token: empty-state prompting the user to add a GitHub PAT in Settings.

## Testing

- **Rust:** tree-parse/filter unit tests; `sync_docs_logic` with an injected
  fetch closure + `FakeGitHubCreds` + a temp `SqlitePool`; meta/truncation
  persistence; generation-guard invalidation.
- **Vitest:** `docsTree.ts` — nesting from a flat list, label derivation
  (prefix/extension stripping), sibling ordering (numeric prefix, README first).

## Known limitations (v1)

- **Relative images** in markdown won't load — a private repo needs an
  authenticated URL. Text, code, and mermaid-as-text render fine.
- **Mermaid in Milkdown:** if the existing Milkdown config doesn't render
  ```mermaid fences, they show as code blocks in v1. The issue drawer already
  has a `MermaidDiagram` component to wire in later.
- **No tree search/filter** in v1 (straightforward follow-up).

## Out of scope (v1)

- Editing docs (the renderer choice keeps this open for later).
- Configurable source repo/branch.
- Full-text search across docs.
