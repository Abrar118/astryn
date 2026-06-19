# Astryn M1 — Calendar + Drawer + Drag (F1–F3) — Design

**Status:** proposed
**Date:** 2026-06-19
**Milestone:** M1 (per `requirements.md` §11)
**Depends on:** M0 (scaffold: secrets, db, linear client, commands, dual clock, Settings) — complete on `main`.

M1 is the core loop: **see issues on a calendar, open an issue's details, edit them, and reschedule by dragging.** It covers features **F1 (calendar view)**, **F2 (issue detail drawer)**, and **F3 (draggable calendar tasks)** from `requirements.md` §9.

---

## 1. Locked decisions

These were resolved during brainstorming and drive the rest of the design:

1. **Sync model — full workspace sync.** On launch/refresh, page through *all* GAM Health Solutions issues (all teams) into SQLite; the calendar renders purely from cache. Incremental `updatedAt`-cursor sync thereafter. This satisfies `requirements.md` §6 and builds the sync engine every later milestone needs.
2. **Drawer edits — full F2 set.** Inline-edit state, priority, due date, title, **assignee** (picker), and **description** (markdown). Comments / sub-issues / relations are read-only. PRs (F7) and doc links (F9) are out of M1.
3. **App shell — react-router + sidebar now.** A persistent left sidebar (Calendar, Settings; stubbed Timeline/Standup slots) with the Dhaka/Germany dual clock relocated into the shell header.
4. **Refresh — manual button + 5-min auto-poll.** Both run incremental syncs.
5. **Persistence scope — calendar core only (Approach A).** M1 persists `issues` + `labels` + `sync_cursors` only. The drawer's rich sections (comments, sub-issues, relations) come from a live `issue(id)` query and are not persisted in M1; their tables arrive with the milestones that own them (M2 activity, M5 graph). The assignee picker fetches the workspace user list live (cached in TanStack memory), with no SQLite `users` table.

---

## 2. Architecture & module layout

Follows the M0 pattern: **thin `#[tauri::command]` wrappers over unit-testable async logic functions**, with all external API calls in Rust and the webview as a pure consumer.

### Rust (`src-tauri/src/`)

- **`linear/`** (extends existing): GraphQL query strings + matching types + pure `parse_*` functions (unit-tested against sample JSON, like M0's `parse_viewer_response`):
  - issues list (paged, optional filter), single-issue detail, `issueUpdate` mutation, users list.
  - A **`sync` submodule** with `full_sync` and `incremental_sync` over an injected fetcher.
- **`db/`** (extends existing): migration `0002`, plus repository functions:
  `upsert_issue`, `upsert_labels`, `load_issues_in_range`, `load_unscheduled`, `load_issue`, `get_sync_cursor`, `set_sync_cursor`.
- **`commands/`** (extends existing): `sync_issues`, `list_calendar_issues`, `list_unscheduled`, `get_issue_detail`, `update_issue`, `list_users`. `AppState` gains a **`sync_lock: tokio::sync::Mutex<()>`** so the 5-min auto-poll cannot collide with a manual refresh (same concurrency lesson as M0's `op_lock`).

### Frontend (`src/`)

- **Routing:** `react-router-dom` — `/` → Calendar, `/settings` → Settings. The **drawer is driven by a `?issue=<id>` search param** so it overlays the calendar without unmounting it (non-modal, deep-linkable).
- **`components/AppShell.tsx`** — persistent left sidebar (Calendar, Settings; disabled stubs for Timeline/Standup) + header hosting the relocated dual clock and a global refresh/sync indicator.
- **`features/calendar/`** — FullCalendar wrapper, Unscheduled rail, filter bar, color-by toggle.
- **`features/drawer/`** — issue detail drawer + inline editors + read-only sections.
- **`lib/commands.ts`** — typed bindings + shared types. **`lib/queries.ts`** — TanStack Query hooks.

---

## 3. Data model — migration `0002_m1_issues.sql`

Creates only what M1 reads (`requirements.md` convention: "only create tables a milestone uses"). `settings` already exists from `0001`.

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
  updated_at    TEXT NOT NULL,      -- incremental-sync cursor
  synced_at     TEXT NOT NULL,
  raw_json      TEXT                -- full node, for fields not yet modeled
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

**Viewer identity:** M0 caches the viewer *name* in `settings`; M1 additionally caches the viewer **id** (written on a successful connection test) so the calendar can default to `assignee = me` and the picker can flag "me".

**Filtering is done in SQL**, not client-side: `list_calendar_issues` / `list_unscheduled` accept optional `team_id` / `assignee_id` / `project_id`, keeping payloads bounded on a large workspace. Default `assignee_id` is the cached viewer id (the user can clear it to see everyone).

---

## 4. Sync engine (`linear/sync`)

Two paths, both pure async logic over an injected fetcher (unit-testable without the network, mirroring M0's `test_connection_logic`), writing through the `db` repositories:

- **`full_sync`** — page `issues(first: 100, after: $cursor)` with **no due-date filter** (all teams, all issues). Upsert `issues` + `labels` per page; track the max `updatedAt`. On completion, write `sync_cursors("linear_issues","last_updated_at")`.
  - Linear personal API keys are scoped to a single workspace, so no org filter is needed in practice. **Verify against live introspection**; if the key sees multiple orgs, filter to `GAM Health Solutions`.
- **`incremental_sync`** — `issues(filter: { updatedAt: { gt: $cursor } })`, page + upsert, then advance the cursor. This is what the refresh button and the poll run.

**Trigger logic:**
- **Startup:** if `issues` is empty → `full_sync` (with a visible syncing state); else show cached data immediately and run `incremental_sync` in the background.
- **Manual refresh:** `incremental_sync` (or `full_sync` if cache is empty).
- **Auto-poll:** `incremental_sync` every 5 minutes.
- All three acquire `sync_lock`; a sync already in flight makes the next a no-op (or it awaits the lock).

**Known M1 limitation (documented):** incremental-by-`updatedAt` does not prune issues archived/deleted *after* they were cached — they may linger stale until a full resync. Acceptable for M1; a "full resync" affordance can be added later.

---

## 5. Tauri command surface (typed, shared with TS)

All return a sanitized `CmdError` (reusing M0's enum + `From<LinearError>`). Frontend types mirror these in `lib/commands.ts`.

| Command | Input → Output | Notes |
|---|---|---|
| `sync_issues` | `{}` → `SyncResult { mode: "full"\|"incremental", synced: number }` | `sync_lock`-guarded; picks full vs incremental by cache state |
| `list_calendar_issues` | `{ start, end, team_id?, assignee_id?, project_id? }` → `CalendarIssue[]` | SQL range on `due_date` ∈ [start,end] + filters |
| `list_unscheduled` | `{ team_id?, assignee_id?, project_id? }` → `CalendarIssue[]` | `due_date IS NULL` + filters |
| `get_issue_detail` | `{ id }` → `IssueDetail` | Live `issue(id)`; **cached row as fallback** if offline/failed so the drawer still opens |
| `update_issue` | `{ id, input: UpdateIssueInput }` → `Issue` | Calls `issueUpdate`; **upserts the returned issue into SQLite** (§7 `[REQ]`) |
| `list_users` | `{}` → `User[]` | Assignee picker; cached in TanStack memory |

```ts
type CalendarIssue = {
  id: string; identifier: string; title: string;
  dueDate: string | null; priority: number;
  stateType: string; stateColor: string;
  assigneeId: string | null; teamKey: string | null;
};

type UpdateIssueInput = {
  dueDate?: string | null; stateId?: string; assigneeId?: string | null;
  priority?: number; title?: string; description?: string;
};

type IssueDetail = CalendarIssue & {
  description: string | null; url: string;
  stateId: string; stateName: string;
  assigneeName: string | null; projectName: string | null;
  labels: { id: string; name: string; color: string }[];
  teamStates: { id: string; name: string; type: string; color: string }[]; // options for the state picker
  parent: { id: string; identifier: string; title: string } | null;
  children: { id: string; identifier: string; title: string; stateType: string }[];
  relations: { type: string; issue: { id: string; identifier: string; title: string } }[];
  comments: { id: string; body: string; userName: string | null; createdAt: string }[];
};
```

The **state picker's options come from `teamStates` inside `get_issue_detail`** (the `issue(id)` query pulls `team { states { nodes } }`), so editing state needs no extra command. **Priority** is the static Linear enum (0 No priority, 1 Urgent, 2 High, 3 Medium, 4 Low).

---

## 6. Frontend — views & data flow

### 6.1 App shell & routing
`AppShell` renders the sidebar + header (dual clock, refresh button + last-synced/“syncing…”/“offline” indicator) and an `<Outlet/>`. A top-level effect runs `sync_issues` on mount and on a 5-minute interval, invalidating the calendar queries on success.

### 6.2 F1 — Calendar (`features/calendar/`)
- **FullCalendar** with `dayGridMonth` + `timeGridWeek` views (toggle), `interaction` plugin enabled, `editable: true`.
- **Events:** issues with a `dueDate` → all-day events `{ id, title: "IDENTIFIER  Title", start: dueDate, allDay: true }`, colored by **`state_type`** or **priority** (a toggle). **Overdue** (`dueDate < today` and state not completed/canceled) gets a distinct class; today is highlighted.
- **Unscheduled rail:** a side list of `due_date IS NULL` issues, made draggable via the interaction plugin's `Draggable`.
- **Filters:** team / assignee (default = me) / project, passed as query params to the commands.
- **Range fetch:** FullCalendar's `datesSet` updates the visible `[start,end]`, keyed into the calendar query so switching months refetches only as needed (cache hit = instant).
- **Interactions:** `eventClick` → `setSearchParams({ issue: id })` (opens drawer); `eventDrop` → reschedule (F3); `eventReceive` (drop from rail) → set due date (F3).

### 6.3 F2 — Drawer (`features/drawer/`)
- Opens whenever `?issue=<id>` is present; non-modal, overlays the right side; the calendar stays interactive behind it.
- `useIssueDetail(id)` opens **instantly over the cached row**, then hydrates from the live query.
- **Editable:** state (dropdown from `teamStates`), priority (static enum), due date (date picker), title (inline text), assignee (combobox over `useUsers`), description (markdown — `react-markdown` for render, a textarea + preview toggle for edit). Each edit calls `update_issue` optimistically.
- **Read-only:** labels, project/cycle, sub-issues, relations, comments. (No PRs / doc links in M1.)

### 6.4 F3 — Drag-to-reschedule
- `eventDrop` and rail `eventReceive` both call `update_issue` with `{ dueDate }`.
- **Optimistic** move via TanStack: `onMutate` cancels in-flight queries, snapshots the calendar/unscheduled/issue caches, and patches them; `onError` rolls back + shows an error toast; `onSuccess` upserts the returned issue; `onSettled` invalidates. A failed drop visibly snaps back.

### 6.5 Query hooks (`lib/queries.ts`)
`useCalendarIssues(range, filters)`, `useUnscheduled(filters)`, `useIssueDetail(id)`, `useUsers()`, `useUpdateIssue()` (the optimistic mutation, shared by drawer edits and drag), `useSyncIssues()`. Query keys include the filters so views stay correctly scoped and cached.

---

## 7. Time, locale & calendar correctness (`[REQ]`)

- **All "today"/overdue/week logic is computed in `Asia/Dhaka`.** Compute "today in Dhaka" with `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })` → `YYYY-MM-DD`.
- Calendar events are **all-day, date-only** (`dueDate` is a date string), so timezone has no effect on placement; only the notion of "today" is tz-sensitive — set FullCalendar's `now` to Dhaka-today and use the same value for overdue comparison.
- **Week starts Sunday** (`firstDay: 0`) for the week view.
- A drag drop yields a calendar date already; format as `YYYY-MM-DD` for the mutation.

---

## 8. Error handling & offline (`requirements.md` §12)

- **Offline-first:** the calendar always renders from cache. `get_issue_detail` returns the cached row as a partial `IssueDetail` if the live query fails, so the drawer still opens.
- **Optimistic writes with rollback:** every edit/drag updates the UI immediately and reverts on failure with a visible **`goey-toast`** error carrying the sanitized message as its **description** (the M0 `errorText` pattern).
- **Sync errors** (network / rate-limit / auth) surface as a non-blocking toast; the cached calendar is untouched. Rate-limit (429) backs off.
- **First-launch full sync** shows a syncing state; on failure, an error toast + retry, with whatever is cached still visible.
- Commands never leak raw reqwest/GraphQL/keyring diagnostics; GraphQL `errors` on HTTP 200 are failures (M0's `interpret_response`).

---

## 9. Testing

**Rust (unit, `cargo test`):**
- `parse_*` for: issues-list page (with `pageInfo`), issue detail (children/relations/comments/teamStates), users list, `issueUpdate` response. Include a malformed-body and a GraphQL-`errors`-on-200 case per parser.
- `full_sync` over a multi-page injected fetcher: all pages upserted, cursor = max `updatedAt`.
- `incremental_sync`: only `> cursor` fetched, cursor advanced.
- Repositories against a temp SQLite DB: `upsert_issue`/`upsert_labels` (insert + update), `load_issues_in_range` (boundary dates), `load_unscheduled` (NULL only), filter combinations, `get/set_sync_cursor`.
- `update_issue` logic upserts the returned issue (verify cache reflects the change).

**Frontend:** no JS test runner is configured yet (consistent with M0). M1's F1–F3 acceptance is verified via the manual GUI checklist below. *(Optional, flagged: add Vitest + React Testing Library to cover the optimistic-update/rollback reducer logic; deferred unless desired.)*

---

## 10. New dependencies

- **Frontend:** `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction` (all MIT — no premium plugins), `react-router-dom`, `react-markdown`, `remark-gfm`.
- **Rust:** none new (`reqwest`, `sqlx`, `serde`, `tokio` with `sync` already present).

---

## 11. Out of scope for M1 (deferred to later milestones)

- Comments/relations/activity persistence (M2/M5), the `activity` transformer, standup/weekly generators (M3), GitHub PRs (M4 / F7), hierarchy graph (M5 / F8), doc links (M6 / F9).
- Linear webhooks, multi-org support beyond the single-key workspace, full-resync pruning of archived issues, LLM polish.

---

## 12. Definition of done

**Feature ACs (`requirements.md` §9):**
- **F1:** opening the app shows the current month populated from cache fast; switching month fetches only uncached ranges; filters update the view without a full reload; unscheduled + overdue are visually flagged.
- **F2:** drawer opens over cached data instantly then hydrates live; editing any of the six fields persists to Linear and survives a refresh; closing/reopening shows the updated value.
- **F3:** a dropped issue's due date updates in Linear; on a simulated API failure the event snaps back and an error toast shows.

**Engineering gates:**
- `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`, and `npm run build` (tsc strict + vite) all pass.
- All external calls remain in Rust; no secret crosses into the webview/DB/logs.
- Each milestone independently runnable: `npm run tauri dev` launches into the calendar; `npm run tauri build` bundles.

**Manual GUI checklist:** full sync populates the month; drag reschedule persists + survives restart; rail→day sets a due date; each drawer edit persists; offline open shows cached calendar + drawer fallback; rate-limit/network errors toast without crashing.
