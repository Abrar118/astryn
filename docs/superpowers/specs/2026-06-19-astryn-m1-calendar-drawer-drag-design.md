# Astryn M1 — Calendar + Drawer + Drag (F1–F3) — Design

**Status:** proposed (revised after review)
**Date:** 2026-06-19
**Milestone:** M1 (per `requirements.md` §11)
**Depends on:** M0 (scaffold: secrets, db, linear client, commands, dual clock, Settings) — complete on `main`.

M1 is the core loop: **see issues on a calendar, open an issue's details, edit them, and reschedule by dragging.** It covers features **F1 (calendar view)**, **F2 (issue detail drawer)**, and **F3 (draggable calendar tasks)** from `requirements.md` §9.

---

## 1. Locked decisions

1. **Sync model — full workspace sync.** On launch/refresh, page through all issues the personal key can access (intended: the whole `GAM Health Solutions` workspace) into SQLite; the calendar renders purely from cache. Incremental `updatedAt`-cursor sync thereafter.
2. **Drawer edits — full F2 set.** Inline-edit state, priority, due date, title, **assignee** (picker), and **description** (markdown). Comments / sub-issues / relations are read-only. PRs (F7) and doc links (F9) are out of M1.
3. **App shell — react-router + sidebar now.** A persistent left sidebar (Calendar, Settings; stubbed Timeline/Standup slots) with the Dhaka/Germany dual clock relocated into the shell header.
4. **Refresh — manual button + 5-min auto-poll.** Both run incremental syncs.
5. **Persistence scope — calendar core only (Approach A).** M1 persists `issues` + `labels` + `sync_cursors` only. The drawer's rich sections (comments, sub-issues, relations) come from a live `issue(id)` query and are not persisted in M1. The assignee picker fetches the workspace user list live (cached in TanStack memory); no SQLite `users` table.
6. **Workspace identity is cached and validated.** A personal key maps to one organization, but it *may be team-restricted*, so "all teams" is not guaranteed — the scope is "all issues the key can access." The org `id`/`name`/`urlKey` is cached on connect and **re-validated on every sync**; a mismatch (or a key change) triggers a full cache wipe (see §4.4).

---

## 2. Architecture & module layout

Follows the M0 pattern: **thin `#[tauri::command]` wrappers over unit-testable async logic functions**; all external API calls in Rust; the webview is a pure consumer.

### Rust (`src-tauri/src/`)
- **`linear/`** (extends existing): query strings + types + pure `parse_*` functions (unit-tested against sample JSON), covering issues-list (paged), single-issue detail, `issueUpdate`, users, and organization identity. A **`sync` submodule** (`full_sync`, `incremental_sync`) over an injected fetcher.
- **`db/`** (extends existing): migration `0002`, plus repositories: `upsert_issue` (conditional), `upsert_labels`, `load_issues_in_range`, `load_unscheduled`, `load_issue`, `list_filter_options`, `get_sync_cursor`, `set_sync_cursor`, and a transactional `wipe_workspace_cache`.
- **`commands/`** (extends existing): `sync_issues`, `list_calendar_issues`, `list_unscheduled`, `get_issue_detail`, `update_issue`, `list_users`, `list_filter_options`.

### Concurrency — lock + generation token (P0)
Two mechanisms, because the bulk writers and the single-issue writer have different latency profiles:

1. **`AppState.workspace_lock: tokio::sync::Mutex<()>`** — acquired by **`set_linear_key`, `clear_linear_key`, `test_linear_connection`, and `sync_issues`**. These are mutually exclusive, so a key change can never interleave with a bulk sync. (Replaces M0's `op_lock`, which was independent of any sync lock.)

2. **`AppState.workspace_generation: AtomicU64`** — bumped (under the lock) whenever `set_linear_key`/`clear_linear_key` wipes the cache. This guards the one credential-bound *writer* that must **not** hold the lock for its whole duration (it would block on a long sync): **`update_issue`**. The flow:
   - capture `gen = workspace_generation.load()` at entry;
   - run `issueUpdate` over the network (no lock held);
   - **before** the SQLite upsert, re-check `workspace_generation == gen`. If it changed (a key was replaced mid-flight), **discard the write** and return `CmdError::WorkspaceChanged` so the optimistic UI rolls back. This is what stops a late update from repopulating SQLite with an old-workspace issue after a wipe.

**Read commands** (`get_issue_detail`, `list_users`, `list_*`) do **not persist** anything, so a result that races a key change is transient and harmless; the frontend clears the drawer/users caches on key change (the calendar invalidation after a wipe already does this). They take neither the lock nor the generation guard.

### Frontend (`src/`)
- **Routing:** `react-router-dom` — `/` → Calendar, `/settings` → Settings. The **drawer is driven by a `?issue=<id>` search param** so it overlays the calendar without unmounting it (non-modal, deep-linkable).
- **`components/AppShell.tsx`** — sidebar (Calendar, Settings; disabled Timeline/Standup stubs) + header (relocated dual clock, refresh button, sync/offline indicator) + `<Outlet/>`.
- **`features/calendar/`**, **`features/drawer/`**, **`lib/commands.ts`** (typed bindings + types), **`lib/queries.ts`** (TanStack hooks), **`lib/optimistic.ts`** + **`lib/dates.ts`** (pure, unit-tested helpers).

---

## 3. Data model — migration `0002_m1_issues.sql`

Creates only what M1 reads.

```sql
CREATE TABLE issues (
  id            TEXT PRIMARY KEY,   -- Linear UUID
  identifier    TEXT NOT NULL,      -- "ENG-123"
  title         TEXT NOT NULL,
  description   TEXT,               -- markdown
  due_date      TEXT,               -- ISO date or NULL (NULL => Unscheduled rail)
  priority      INTEGER,            -- 0..4
  url           TEXT NOT NULL,
  state_id      TEXT,
  state_name    TEXT,
  state_type    TEXT,               -- backlog|unstarted|started|completed|canceled
  state_color   TEXT,
  assignee_id   TEXT,
  assignee_name TEXT,
  team_id       TEXT,
  team_key      TEXT,
  project_id    TEXT,
  project_name  TEXT,
  parent_id     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,      -- incremental-sync watermark + conditional-upsert guard
  archived_at   TEXT,               -- non-NULL => archived; hidden from all queries
  synced_at     TEXT NOT NULL,
  raw_json      TEXT
);
CREATE INDEX idx_issues_due ON issues(due_date);
CREATE INDEX idx_issues_assignee ON issues(assignee_id);
CREATE INDEX idx_issues_updated ON issues(updated_at);

CREATE TABLE labels (
  issue_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  name     TEXT,
  color    TEXT,
  PRIMARY KEY (issue_id, label_id)
);

CREATE TABLE sync_cursors (
  source TEXT NOT NULL,             -- "linear_issues"
  key    TEXT NOT NULL,             -- "last_updated_at"
  value  TEXT,
  PRIMARY KEY (source, key)
);
```

**Identity in `settings`:** M0 caches the viewer *name*; M1 additionally caches viewer **id** and the organization **id/name/urlKey**, written on a successful connection test, used for `assignee = me` defaults, the picker's "me" flag, and workspace validation.

**Conditional upsert (P1):** every issue write is
```sql
INSERT INTO issues (...) VALUES (...)
ON CONFLICT(id) DO UPDATE SET <cols> = excluded.<cols>
WHERE excluded.updated_at >= issues.updated_at;
```
so an older record fetched via boundary-overlap (or out of order) never clobbers a newer cached row. The upsert reports whether it **applied** (via `RETURNING` / `changes()`).

**Label replacement is gated on the upsert applying (P1):** issue + labels are written in one transaction; labels for an issue are deleted-and-reinserted **only when that issue's conditional upsert applied**. So a rejected (older) issue never disturbs the current labels, and a removed label *is* pruned (delete-then-insert, not insert-only).

**Filtering is SQL-side**, not client-side: `list_calendar_issues` / `list_unscheduled` take optional `team_id` / `assignee_id` / `project_id` (default `assignee_id` = cached viewer id). All read queries exclude `archived_at IS NOT NULL`.

**Calendar range is half-open (P1):** `due_date >= :start AND due_date < :end` (exclusive end), with `:end` set to the day after the last visible day.

---

## 4. Sync engine (`linear/sync`)

Two paths, both pure async logic over an injected fetcher (unit-testable without network, like M0's `test_connection_logic`), writing through `db`.

### 4.1 Full vs incremental selection (P1)
Choose by **cursor presence, not table emptiness**: if `sync_cursors("linear_issues","last_updated_at")` is **absent** → `full_sync`; else `incremental_sync`. A full sync that fails partway leaves rows but writes no cursor, so the next run correctly re-runs a full sync to establish a valid baseline.

### 4.2 `full_sync`
Page `issues(first: 100, after: $cursor, includeArchived: true)` with no due-date filter, ordered by `updatedAt`. Upsert `issues` + `labels` per page (conditional upsert; archived nodes set `archived_at`). Track the max `updatedAt` across all pages. **Write the cursor only after the final page is durably committed** — never mid-pagination.

### 4.3 `incremental_sync` (lookback window, P1)
Plain `gte: $cursor` only covers the exact boundary instant; an issue updated *during* a multi-page scan can shift across page boundaries and be missed. So M1 queries with a **lookback window**: `issues(filter: { updatedAt: { gte: $cursor − LOOKBACK } }, includeArchived: true)`, `LOOKBACK = 5 minutes` (absorbs in-scan updates and modest clock skew). The conditional upsert makes the re-fetched window idempotent and cheap. Page, upsert (with gated label replacement), then advance the cursor to the new max `updatedAt` **after all pages commit** — never mid-pagination. `includeArchived: true` lets newly-archived issues arrive with `archived_at` set so they drop out of the calendar.

### 4.4 Workspace validation & cache wipe (P0 / decision 6)
The invariant: **cached issues always belong to the org currently identified in `settings`, and that identity is only ever written after a compare.** The "compare → wipe-on-mismatch → save identity" sequence is shared by the three identity-touching commands:

- **`set_linear_key` / `clear_linear_key`** (under `workspace_lock`): always `db::wipe_workspace_cache` — a **single transaction** deleting all rows from `issues`, `labels`, `sync_cursors` and clearing cached viewer + org identity — then **bump `workspace_generation`**. (On `set`, identity is left empty; the next `test`/`sync` populates it.) A key change therefore can never leave another workspace's issues cached.
- **`test_linear_connection`** (under the lock): fetch `viewer { … organization { id name urlKey } }`. **Compare the fetched org id to the cached one *before* overwriting:** if a cached org exists and differs (key was swapped externally), `wipe_workspace_cache` + bump generation first; then **save** the fetched viewer + org identity. If no cached org exists, just save it. This prevents relabeling existing cache as a new workspace.
- **`sync_issues`** (under the lock): fetch org identity and compare to cached. On mismatch → `wipe_workspace_cache` + bump generation. On mismatch **or** when no identity is cached (fresh / post-wipe) → **save the fetched identity**, then proceed (full sync, since the cursor is now absent). On match → proceed normally. Identity is thus always persisted after being fetched.

### 4.5 Triggers
- **Startup:** no cursor → `full_sync` (visible syncing state); cursor present → render cache immediately, `incremental_sync` in the background.
- **Manual refresh / 5-min auto-poll:** `sync_issues` (incremental, or full if no cursor). All acquire `workspace_lock`; an in-flight sync makes the next await the lock.

### 4.6 Archival / deletion
`includeArchived: true` + the `archived_at` column means **archived issues are fetched and then hidden** — archival is handled. **Hard-deleted** issues (rare in Linear) are *not* pruned by an upsert-only sync: there is no tombstone to fetch, so they **persist in the cache until a cache wipe.** A wipe happens on a key change and via an explicit **`sync_issues({ full: true })`** ("Resync" in Settings), which runs `wipe_workspace_cache` + `full_sync` under the lock (requires being online; on failure the next auto-sync re-runs full since the cursor is absent). M1 does **not** add snapshot/diff pruning to the normal sync path.

---

## 5. Tauri command surface (typed, shared with TS)

All return a sanitized `CmdError` (M0's enum + `From<LinearError>`, plus a new `WorkspaceChanged` variant).

| Command | Input → Output | Notes |
|---|---|---|
| `sync_issues` | `{ full?: boolean }` → `SyncResult { mode: "full"\|"incremental", synced: number }` | `workspace_lock`-guarded; validates org identity; `full:true` wipes + full-syncs (Settings "Resync") |
| `list_calendar_issues` | `{ start, end, team_id?, assignee_id?, project_id? }` → `CalendarIssue[]` | Half-open range; excludes archived |
| `list_unscheduled` | `{ team_id?, assignee_id?, project_id? }` → `CalendarIssue[]` | `due_date IS NULL`; excludes archived |
| `list_filter_options` | `{}` → `FilterOptions { teams, projects }` | `SELECT DISTINCT` over cached issues (works offline) |
| `get_issue_detail` | `{ id }` → `IssueDetailResult` | Live `issue(id)`; **discriminated** live/cache result (below) |
| `update_issue` | `{ id, patch: UpdateIssuePatch }` → `Issue` | `issueUpdate`; generation-guarded upsert of the returned issue (§7 `[REQ]`); `WorkspaceChanged` if the key changed mid-flight |
| `list_users` | `{}` → `User[]` | Assignee picker; bounded `first: 250`; cached in TanStack |

### 5.1 Types
```ts
type CalendarIssue = {
  id: string; identifier: string; title: string;
  dueDate: string | null; priority: number;
  stateType: string; stateColor: string;
  assigneeId: string | null; teamKey: string | null;
};

// Full cached row returned by update_issue (mirrors the issues table minus bookkeeping)
type Issue = CalendarIssue & {
  description: string | null; url: string;
  stateId: string; stateName: string; assigneeName: string | null;
  teamId: string | null; projectId: string | null; projectName: string | null;
  parentId: string | null; createdAt: string; updatedAt: string;
};

// Discriminated so the UI never pretends to have data it lacks (P1).
// "preview" is the FRONTEND placeholder (built from the calendar row) shown
// before the query resolves; "cache"/"live" are what the command returns.
type IssueDetailResult =
  | { source: "preview"; detail: CalendarIssue }   // frontend-only placeholder; all editors disabled
  | { source: "cache";   detail: CachedIssue }     // command, offline fallback; live-only editors disabled
  | { source: "live";    detail: IssueDetail };    // command, online; all editors enabled

type CachedIssue = Issue;   // exactly what the cache can honestly provide

type IssueDetail = Issue & {
  labels: { id: string; name: string; color: string }[];
  teamStates: { id: string; name: string; type: string; color: string }[]; // state-picker options
  parent: { id: string; identifier: string; title: string } | null;
  children: { id: string; identifier: string; title: string; stateType: string }[];
  relations: { type: string; issue: { id: string; identifier: string; title: string } }[];
  comments: { id: string; body: string; userName: string | null; createdAt: string }[];
};
```
The state picker's options ship inside `get_issue_detail` via `team { states(first: 50) }` — no extra command.

### 5.2 Patch semantics (tri-state, P1)
Clearing due date / assignee / description must be distinguishable from "leave unchanged." Plain `Option<T>` collapses `null` and absent in serde, so M1 uses the **double-option** pattern:
```rust
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where T: Deserialize<'de>, D: Deserializer<'de> { Deserialize::deserialize(de).map(Some) }

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpdateIssuePatch {
    #[serde(default)] title: Option<String>,      // not nullable in Linear
    #[serde(default)] state_id: Option<String>,
    #[serde(default)] priority: Option<i64>,
    #[serde(default, deserialize_with = "double_option")] due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")] assignee_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")] description: Option<Option<String>>,
}
```
Mapping: outer `None` ⇒ omit from the GraphQL input; `Some(None)` ⇒ send explicit `null` (clear); `Some(Some(v))` ⇒ set `v`. Covered by unit tests for all three states on a nullable field.

### 5.3 Bounded collections (P1)
`get_issue_detail` requests bounded first pages — `comments(first: 50)`, `children(first: 50)`, `relations(first: 50)`, `labels(first: 50)`, `team { states(first: 50) }`; `list_users` uses `first: 250`. M1 renders the first page only; **no pagination UI** (documented bound). If a `hasNextPage` is true, the drawer shows a quiet "showing first N" note.

---

## 6. Frontend — views & data flow

### 6.1 App shell & sync loop
`AppShell` runs `sync_issues` on mount and on a 5-minute interval, invalidating the calendar/unscheduled queries on success and surfacing errors as toasts. The header shows last-synced / "syncing…" / "offline."

### 6.2 F1 — Calendar (`features/calendar/`)
- **FullCalendar** with `dayGridMonth` + `timeGridWeek` (toggle), `interaction` plugin, `editable: true`, `firstDay: 0` (Sunday).
- **Events:** issues with a `dueDate` → all-day events `{ id, title: "IDENTIFIER  Title", start: dueDate, allDay: true }`, colored by **`state_type`** or **priority** (toggle). **Overdue** (`dueDate < dhakaToday` and state not completed/canceled) gets a distinct class.
- **Unscheduled rail:** `due_date IS NULL` issues, draggable via the interaction plugin's `Draggable`.
- **Filters:** team / project options from `list_filter_options`; assignee (default = me) — passed as query params to the list commands.
- **Range:** FullCalendar's `datesSet` sets the visible half-open `[start, end)`, keyed into the calendar query. Switching months **queries only the visible SQLite range; an identical prior range may hit the TanStack cache** (no network/SQLite call needed).
- **Interactions:** `eventClick` → `setSearchParams({ issue: id })`; `eventDrop` and rail `eventReceive` → reschedule (F3).

### 6.3 F2 — Drawer (`features/drawer/`)
- Opens whenever `?issue=<id>` is present; non-modal; the calendar stays interactive.
- **Instant open** comes from the frontend seeding `useIssueDetail` via TanStack `placeholderData` = `{ source: "preview", detail: <CalendarIssue from the calendar cache> }`. Because the union has a dedicated `preview` branch, the placeholder is type-consistent with the query's `IssueDetailResult` (no shape mismatch). The live `get_issue_detail` query runs underneath and replaces it on arrival.
- **Result handling by branch:** `preview` → render the calendar fields, **all editors disabled** (data still loading). `cache` (command's offline/failed-live fallback) → render cached fields, **live-only editors disabled** (no `teamStates`, comments, etc.), with a "offline — showing cached" note. `live` → all six editors enabled.
- **Editable (live only):** state (from `teamStates`), priority (static enum 0–4), due date (date picker, clearable), title (text), assignee (combobox over `useUsers`, clearable), description (textarea + `react-markdown` preview, clearable). Each calls `update_issue` optimistically.
- **Read-only:** labels, project/cycle, sub-issues, relations, comments.

### 6.4 F3 — Drag-to-reschedule
`eventDrop` / `eventReceive` call `update_issue` with `{ dueDate }`. **Optimistic** via TanStack: `onMutate` cancels in-flight queries, snapshots the calendar/unscheduled/detail caches, applies the patch; `onError` rolls back + error toast; `onSuccess` upserts the returned `Issue`; `onSettled` invalidates. A failed drop visibly snaps back.

### 6.5 Pure helpers (extracted for tests)
- `lib/dates.ts` — `dhakaToday()`, `isOverdue(issue, today)`, half-open range builders, FullCalendar date↔`YYYY-MM-DD` conversion.
- `lib/optimistic.ts` — the patch/rollback reducers over a `CalendarIssue[]` (move between scheduled/unscheduled, apply field edits). These are framework-free and directly unit-tested.

---

## 7. Time, locale & calendar correctness (`[REQ]`)

- **All "today"/overdue/week logic is computed in `Asia/Dhaka`.** `dhakaToday()` uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })` → `YYYY-MM-DD`.
- Events are **all-day, date-only**, so timezone doesn't affect placement; only "today" is tz-sensitive — set FullCalendar's `now` to `dhakaToday()` and use the same value for overdue.
- **Week starts Sunday** (`firstDay: 0`).
- After any mutation, **upsert the returned issue into SQLite** (`requirements.md` §7 `[REQ]`).

---

## 8. Error handling & offline (`requirements.md` §12)

- **Offline-first:** calendar always renders from cache; `get_issue_detail` falls back to `source: "cache"`.
- **Optimistic writes with rollback:** every edit/drag reverts on failure with a `goey-toast` error whose **description carries the sanitized message** (M0 `errorText`).
- **Rate limiting (P1):** Linear may signal throttling as **HTTP 429 *or* an HTTP-400 GraphQL error with extension code `RATELIMITED`**. M1 extends M0's `interpret_response` + GraphQL-error parsing to detect both and map to `LinearError::RateLimited`, and reads `X-RateLimit-Requests-Reset` / `Retry-After` to back off the sync loop rather than hammering. Surfaced as a non-blocking toast; cached calendar untouched.
- **Sync failures** never clear the cache; first-launch full-sync failure shows an error + retry with whatever is cached still visible. (An explicit `full:true` Resync is the *only* path that deliberately wipes first.)
- **`WorkspaceChanged`** from `update_issue` (key replaced mid-edit): the optimistic change rolls back; no toast needed beyond a quiet notice, since the calendar has already been wiped/reloaded for the new workspace.
- Commands never leak raw diagnostics; GraphQL `errors` on HTTP 200 are failures.

---

## 9. Testing

**Rust (unit, `cargo test`):**
- `parse_*` for issues-list page (`pageInfo`), issue detail (children/relations/comments/teamStates), users, org identity, `issueUpdate` — each with a malformed-body and a GraphQL-`errors`/`RATELIMITED` case.
- `full_sync` over a multi-page injected fetcher: all pages upserted; cursor = max `updatedAt`; **cursor unset if a page fails**.
- `incremental_sync`: `gte` boundary re-fetch is idempotent (conditional upsert); cursor advances only after commit.
- Conditional upsert: older `updated_at` is rejected; archived node sets `archived_at` and drops from `load_issues_in_range`.
- **Label gating:** a removed label is pruned (delete-then-insert) when the upsert applies; a rejected (older) issue upsert leaves existing labels untouched.
- **Incremental lookback:** with a cursor, the fetch filter is `updatedAt >= cursor − 5min`; re-fetched window rows are idempotent.
- **Identity compare-before-overwrite:** matching org keeps the cache; a mismatched org wipes *then* saves the new identity (and bumps generation); a fresh (no-identity) sync saves identity.
- **Generation guard:** `update_issue` discards its upsert and returns `WorkspaceChanged` when the generation changed between entry and commit; persists normally when unchanged.
- Repositories vs temp SQLite: half-open range boundaries, unscheduled (NULL only), filter combinations, `list_filter_options` distinctness, `wipe_workspace_cache` clears all tables + identity.
- `UpdateIssuePatch` deserialization: omit vs explicit-null vs value on a nullable field; GraphQL-input mapping.

**Frontend (Vitest, P2):** add Vitest (no React Testing Library yet) covering the pure helpers — optimistic patch/rollback reducers, calendar date conversion, half-open range building, and Dhaka "today". Wire a `test` script. Component/RTL tests remain deferred.

---

## 10. New dependencies
- **Frontend:** `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction` (all MIT), `react-router-dom`, `react-markdown`, `remark-gfm`; dev: `vitest`.
- **Rust:** none new.

---

## 11. Out of scope for M1
Comments/relations/activity persistence (M2/M5), activity transformer, standup/weekly (M3), GitHub PRs (M4/F7), hierarchy graph (M5/F8), doc links (M6/F9), Linear webhooks, multi-org support, hard-delete pruning, LLM polish, drawer pagination UI, RTL/component tests.

---

## 12. Definition of done

**Feature ACs (`requirements.md` §9):**
- **F1:** opening the app shows the current month from cache fast; switching months queries only the visible SQLite range (identical prior ranges may hit TanStack cache); filters update the view without a full reload; unscheduled + overdue are visually flagged.
- **F2:** drawer opens instantly over the seeded cache row then hydrates from the live query; editing any of the six fields (including clearing due date/assignee/description) persists to Linear and survives a refresh; offline open shows cached fields with live-only editors disabled.
- **F3:** a dropped issue's due date updates in Linear; on a simulated API failure the event snaps back and an error toast shows.

**Engineering gates:**
- `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`, `npm run build`, and `npm run test` (Vitest) all pass.
- Key change wipes the workspace cache atomically; no cross-workspace bleed; no secret crosses into webview/DB/logs.
- `npm run tauri dev` launches into the calendar; `npm run tauri build` bundles.

**Manual GUI checklist:** full sync populates the month; drag reschedule persists + survives restart; rail→day sets a due date; each drawer edit (and each clear) persists; offline open shows cached calendar + disabled-editor drawer; replacing the Linear key empties the calendar; rate-limit/network errors toast without crashing.
