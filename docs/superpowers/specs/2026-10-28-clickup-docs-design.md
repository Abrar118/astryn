# ClickUp Docs Source — Design

**Date:** 2026-10-28
**Status:** Approved (spec approval waived for the parallel-lanes run; open details decided below as Rulings)
**Branch:** `feat/clickup-docs` (stacked on `feat/docs-sources`)
**Backlog:** `docs/backlog.md` item 3, decision 1 ("ClickUp Docs links … a new `clickup` provider module (API token in the keychain, Rust client) that provides the `docs-source` capability; treat it as its own small spec").

## Purpose

Let the Docs page show ClickUp Docs next to GitHub repositories and local
folders. The user pastes a ClickUp Doc link; its pages (and sub-pages) appear
as a tree and render as Markdown, offline from the cache.

## Shape

- **New provider module `clickup`** (`ModuleId::Clickup`, kind provider, provides `docs-source`). The Docs feature module keeps owning sources; a ClickUp Doc is a third source kind (`docs_sources.kind = 'clickup'`).
- **Credential:** a ClickUp personal API token (`pk_…`) in the OS keychain, account **`clickup_token`**, behind a `ClickUpCredentialProvider` seam (OAuth can slot in later). It is sent raw in `Authorization` (ClickUp personal tokens take no `Bearer` prefix). It is never returned to TypeScript; settings save it with a direct async call and clear the input immediately.
- **Client:** `src-tauri/src/clickup/` — `ClickUpClient` (reqwest, 20 s timeout), all HTTP in Rust. Endpoints (ClickUp public API):
  - `GET https://api.clickup.com/api/v2/user` → `{ "user": { "id", "username", … } }` (connection test).
  - `GET https://api.clickup.com/api/v3/workspaces/{workspace_id}/docs/{doc_id}` → `{ "id", "name", … }` (validate a link, default name).
  - `GET https://api.clickup.com/api/v3/workspaces/{workspace_id}/docs/{doc_id}/pages?max_page_depth=-1&content_format=text/md` → array of pages `{ "id", "name", "content", "pages": [ …nested… ], "archived", "deleted", … }`.
- **Caching:** pages are cached in `docs_files` exactly like GitHub Markdown (one row per page, `kind = 'blob'`, content = Markdown) and refreshed on demand. **No new migration** — `kind` is free text and the doc reference lives in `docs_sources.location` (`"{workspace_id}/{doc_id}"`).
- **Tree:** a page's path is its id chain (`p1/p2`), parent path the parent's chain, name the page name. A page with sub-pages is a document *and* a parent, so the tree shows an expand toggle on file rows that have children.

## Rulings

- **Accepted links:** `https://app.clickup.com/{workspace_id}/v/dc/{doc_id}[/{page_id}]` (with or without scheme, query string, or trailing slash) and a bare `{workspace_id}/{doc_id}` pair. The workspace id must be numeric. Public `doc.clickup.com` share links are not accepted (they don't identify the workspace for the API).
- **Source id:** `clickup:{workspace_id}/{doc_id}` — stable across renames, doubles as the duplicate guard (same pattern as GitHub and local folders).
- **Adding requires a token and network:** the Doc is fetched once on add, so a wrong link or missing access fails immediately; the name defaults to the Doc's own name.
- **Skipped pages:** pages flagged `archived` or `deleted` are not cached (nor their sub-pages). A page without a name shows as "Untitled".
- **Order:** sibling pages are sorted by the Docs tree's existing rules (numeric prefix, then name), not ClickUp's manual order — v1 keeps one ordering rule.
- **Errors:** 401/403 → "ClickUp rejected the request." (`ClickUpApi`); 429 → `RateLimited`; 5xx / transport → `Network`; any other non-2xx or an `err` body → `ClickUpApi`; unparsable → `ClickUpApi`. Error bodies are never forwarded.
- **Concurrency:** `clickup_lock` serializes token mutations, link checks and syncs; `clickup_generation` is bumped on token change / module disable so a late sync write is dropped.
- **Token change / Clear token / Remove module data** wipe the ClickUp-cached pages and their sync metadata (and the cached ClickUp username), leaving the configured Doc entries (they are Docs config, not credential-derived) so a new token just resyncs them. Removing the Docs module's data deletes the entries.
- **Availability:** ClickUp sources are listed with `available: false` while the ClickUp module is off, like GitHub repositories with GitHub off.
- **Status:** `get_clickup_status` is a core (always-callable) command, like the other providers' status: `not_configured` / `unverified` / `connected { username }` (username cached in `settings.clickup_username` by the connection test). `get_docs_status` gains `clickupTokenPresent` so the Docs page can prompt per source.
- **Live verification pending:** no ClickUp credentials were available while building. Request shapes follow ClickUp's public API reference; response parsing is covered by fixture-based unit tests. The first real run must confirm the v3 pages response shape (field names `pages`, `content`, `archived`, `deleted`) and that `content_format=text/md` returns Markdown.

## Frontend

- Settings → Connections → **ClickUp**: token field (password input), Save / Test connection / Clear token, status line.
- Settings → Documentation: **Add a ClickUp Doc** (link + optional name) while ClickUp is on.
- Docs page: ClickUp sources sync lazily like repositories; without a token and with nothing cached the page offers **Connect ClickUp**.
- `MODULE_MANIFEST` / `MODULE_COPY` gain `clickup`; the module picker and Settings → Modules list it automatically.

## Testing

- Rust: link parsing (forms, rejects), pages flattening (nesting, archived/deleted skip, untitled), doc-name / user parsing, status-code mapping, sync with fake creds + generation guard, add flow (duplicate, bad link, missing token), token set/clear wiping only ClickUp cache, remove-module-data, manifest + guard coverage.
- Vitest: Settings ClickUp section (save clears input, test, clear), Docs section add form, tree expand toggle for pages with children, Docs page ClickUp prompt, manifest.
