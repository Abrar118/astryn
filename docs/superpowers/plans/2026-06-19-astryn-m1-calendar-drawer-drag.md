# M1 — Calendar + Drawer + Drag (F1–F3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Astryn's core loop — a calendar of Linear issues backed by a local SQLite cache, a click-to-open detail drawer with inline editing, and drag-to-reschedule — on top of the M0 scaffold.

**Architecture:** Rust owns all Linear calls and the SQLite cache; the React webview is a pure consumer over typed Tauri commands (M0 pattern: thin `#[tauri::command]` wrappers over unit-testable async logic fns). A full workspace sync populates `issues`/`labels`; an incremental `updatedAt`-cursor sync (with a 5-min lookback window + conditional upserts) keeps it fresh. The calendar renders purely from cache; the drawer fires a live `issue(id)` query seeded by the calendar row. Credential changes wipe the cache atomically, protected by a `workspace_lock` + `workspace_generation` token.

**Tech Stack:** Tauri v2, Rust (`sqlx`/SQLite, `reqwest`/rustls, `tokio`, `thiserror`, `serde`), React 19 + TS (strict), Vite 7, TanStack Query v5, FullCalendar (daygrid/timegrid/interaction), react-router-dom, react-markdown, `goey-toast`, Vitest.

**Authoritative references:**
- Spec: `docs/superpowers/specs/2026-06-19-astryn-m1-calendar-drawer-drag-design.md`
- Requirements: `requirements.md` (§3 architecture, §5 data model, §6 sync, §7 GraphQL, §9 F1–F3, §12 cross-cutting)
- Project conventions: `CLAUDE.md`

## Global Constraints

- **All external API calls live in Rust**, never the webview. The webview never sees a token. (`requirements.md` §3)
- **Time/locale:** all "today"/overdue/week logic computed in **`Asia/Dhaka`**; **week starts Sunday** (`firstDay: 0`). Dual clock uses `Asia/Dhaka` + `Europe/Berlin` via `Intl`. (`requirements.md` §3)
- **Offline-first:** the app opens and shows cached data with no network. (`requirements.md` §12)
- **Optimistic writes with rollback:** every mutation updates the UI immediately and reverts on failure with a visible `goey-toast` error. Toast errors carry a **description** (reuse M0's `errorText`). (`requirements.md` §12)
- **After any mutation, upsert the returned entity into SQLite.** (`requirements.md` §7)
- **No secrets in renderer/DB/logs/commits. Keychain only.** Commands return **sanitized** `CmdError`; GraphQL `errors` on HTTP 200 are failures. (`requirements.md` §3/§12)
- **Toast package is `goey-toast`** (imports `GooeyToaster`/`gooeyToast` + `goey-toast/styles.css`). Do not substitute.
- **TS is strict** with `noUnusedLocals`/`noUnusedParameters` — unused symbols fail the build.
- **Tailwind v4 is CSS-first** (no `tailwind.config.js`); dark-first; match Linear's look (hairline borders, indigo accent, small base size, Geist font).
- **Rust commands:** `cargo` invoked with `--manifest-path src-tauri/Cargo.toml` (avoid `cd src-tauri`). Keep `cargo fmt` clean and `cargo clippy -- -D warnings` green.
- **Migrations:** only create tables this milestone uses (`issues`, `labels`, `sync_cursors`; `settings` already exists).

---

## File Map

**Rust (`src-tauri/`)**
- `migrations/0002_m1_issues.sql` — *create* — `issues`, `labels`, `sync_cursors` tables + indexes.
- `src/db/mod.rs` — *modify* — declare `pub mod issues;`; add identity helpers (viewer id, org) alongside the existing settings helpers.
- `src/db/issues.rs` — *create* — issue/label/cursor/filter repositories: conditional `upsert_issue`, `replace_labels`, `load_issues_in_range`, `load_unscheduled`, `load_issue`, `list_filter_options`, `get_sync_cursor`, `set_sync_cursor`, `wipe_workspace_cache`. Plus the `CachedIssue`/`CalendarIssue` row structs.
- `src/linear/mod.rs` — *modify* — declare `pub mod issues; pub mod sync;`; extend `interpret_response` + GraphQL-error parsing for `RATELIMITED` (incl. HTTP 400); re-export new types.
- `src/linear/issues.rs` — *create* — GraphQL query/mutation strings; types (`Issue`, `IssueDetail`, `User`, `OrgIdentity`, `Label`, relation/child/comment structs, `IssuesPage`); `parse_*` fns; `UpdateIssuePatch` (tri-state) + `patch_to_input`; `LinearClient` methods (`issues_page`, `issue_detail`, `users`, `viewer_with_org`, `update_issue`).
- `src/linear/sync.rs` — *create* — `full_sync`, `incremental_sync`, `select_and_sync` over injected fetchers; `SyncResult`.
- `src/commands/mod.rs` — *modify* — rename `op_lock`→`workspace_lock`, add `workspace_generation: AtomicU64`; add `WorkspaceChanged` to `CmdError`; rework `set/clear/test` logic for wipe+identity+generation; add M1 commands (`sync_issues`, `list_calendar_issues`, `list_unscheduled`, `list_filter_options`, `get_issue_detail`, `update_issue`, `list_users`).
- `src/lib.rs` — *modify* — build `AppState` with the new fields; register the new commands.

**Frontend (`src/`)**
- `lib/commands.ts` — *modify* — add M1 types + typed bindings; keep `errorText`.
- `lib/dates.ts` — *create* — `dhakaToday`, `isOverdue`, half-open range builders, FullCalendar date↔`YYYY-MM-DD`.
- `lib/optimistic.ts` — *create* — pure patch/rollback reducers over `CalendarIssue[]`.
- `lib/queries.ts` — *create* — TanStack hooks (`useCalendarIssues`, `useUnscheduled`, `useFilterOptions`, `useIssueDetail`, `useUsers`, `useUpdateIssue`, `useSyncIssues`).
- `components/AppShell.tsx` — *create* — sidebar + header (dual clock, refresh/sync indicator) + `<Outlet/>`.
- `features/home/DualClock.tsx` — *modify* — reuse inside the shell header (no logic change).
- `features/calendar/Calendar.tsx`, `features/calendar/UnscheduledRail.tsx`, `features/calendar/FilterBar.tsx`, `features/calendar/eventStyle.ts` — *create* — F1 + F3.
- `features/drawer/IssueDrawer.tsx` + `features/drawer/fields/*.tsx` — *create* — F2.
- `features/settings/Settings.tsx` — *modify* — add a "Resync workspace" button.
- `src/App.tsx`, `src/main.tsx` — *modify* — install the router; mount `AppShell` + routes.
- `src/test/setup.ts`, `vitest.config.ts`, `package.json` — *modify/create* — Vitest wiring.

**Vitest tests:** `src/lib/dates.test.ts`, `src/lib/optimistic.test.ts`.

---

## Phase A — Rust data layer, parsing, and sync

### Task 1: SQLite schema + issue/label/cursor repositories

**Files:**
- Create: `src-tauri/migrations/0002_m1_issues.sql`
- Create: `src-tauri/src/db/issues.rs`
- Modify: `src-tauri/src/db/mod.rs` (declare `pub mod issues;`; add generic setting + identity helpers)

**Interfaces:**
- Produces (read structs, serialized camelCase to TS):
  - `CalendarIssue { id, identifier, title, due_date: Option<String>, priority: i64, state_type, state_color, assignee_id: Option<String>, team_key: Option<String> }`
  - `Issue { id, identifier, title, description: Option<String>, due_date: Option<String>, priority: i64, url, state_id: Option<String>, state_name: Option<String>, state_type, state_color, assignee_id: Option<String>, assignee_name: Option<String>, team_id: Option<String>, team_key: Option<String>, project_id: Option<String>, project_name: Option<String>, parent_id: Option<String>, created_at, updated_at }`
  - `FilterOptions { teams: Vec<TeamOption{id,key}>, projects: Vec<ProjectOption{id,name}> }`
- Produces (write struct + fns):
  - `IssueRecord` (22 column fields, see below) and `LabelRecord { label_id, name: Option<String>, color: Option<String> }`
  - `async upsert_issue(tx, &IssueRecord) -> Result<bool, sqlx::Error>` (true = applied)
  - `async replace_labels(tx, issue_id: &str, &[LabelRecord]) -> Result<(), sqlx::Error>`
  - `async load_issues_in_range(pool, start, end, team_id, assignee_id, project_id) -> Result<Vec<CalendarIssue>>`
  - `async load_unscheduled(pool, team_id, assignee_id, project_id) -> Result<Vec<CalendarIssue>>`
  - `async load_issue(pool, id) -> Result<Option<Issue>>`
  - `async list_filter_options(pool) -> Result<FilterOptions>`
  - `async get_sync_cursor(pool) -> Result<Option<String>>` / `set_sync_cursor(pool, value)`
  - `async wipe_workspace_cache(pool) -> Result<()>`
- Modify `db/mod.rs` produces: `save_setting(pool, key, value)`, `load_setting(pool, key) -> Option<String>`; identity keys + `save_identity(pool, viewer_id, viewer_name, org_id, org_name, org_url_key)`, `load_org_id(pool) -> Option<String>`, `load_me(pool) -> Option<(String,String)>` (viewer_id, viewer_name).

- [ ] **Step 1: Write the migration**

Create `src-tauri/migrations/0002_m1_issues.sql` (copy the three tables + indexes verbatim from spec §3):

```sql
CREATE TABLE issues (
  id            TEXT PRIMARY KEY,
  identifier    TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  due_date      TEXT,
  priority      INTEGER,
  url           TEXT NOT NULL,
  state_id      TEXT,
  state_name    TEXT,
  state_type    TEXT,
  state_color   TEXT,
  assignee_id   TEXT,
  assignee_name TEXT,
  team_id       TEXT,
  team_key      TEXT,
  project_id    TEXT,
  project_name  TEXT,
  parent_id     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  archived_at   TEXT,
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
  source TEXT NOT NULL,
  key    TEXT NOT NULL,
  value  TEXT,
  PRIMARY KEY (source, key)
);
```

- [ ] **Step 2: Declare the module + add settings/identity helpers in `db/mod.rs`**

At the top of `src-tauri/src/db/mod.rs`, add `pub mod issues;`. Then add generic + identity helpers (these supersede ad-hoc viewer-name code; keep the existing `save_viewer_name`/`load_viewer_name`/`clear_viewer_name` so M0 tests stay green):

```rust
pub mod issues;

// Identity setting keys.
const VIEWER_ID_KEY: &str = "linear_viewer_id";
const ORG_ID_KEY: &str = "linear_org_id";
const ORG_NAME_KEY: &str = "linear_org_name";
const ORG_URL_KEY_KEY: &str = "linear_org_url_key";

pub async fn save_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.0))
}

/// Persist the full identity (viewer id+name and org id/name/urlKey) atomically,
/// so a partial failure can't leave a half-written identity.
pub async fn save_identity(
    pool: &SqlitePool,
    viewer_id: &str,
    viewer_name: &str,
    org_id: &str,
    org_name: &str,
    org_url_key: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for (k, v) in [
        (VIEWER_NAME_KEY, viewer_name),
        (VIEWER_ID_KEY, viewer_id),
        (ORG_ID_KEY, org_id),
        (ORG_NAME_KEY, org_name),
        (ORG_URL_KEY_KEY, org_url_key),
    ] {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(k)
        .bind(v)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn load_org_id(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    load_setting(pool, ORG_ID_KEY).await
}

/// (viewer_id, viewer_name) if both are cached.
pub async fn load_me(pool: &SqlitePool) -> Result<Option<(String, String)>, sqlx::Error> {
    let id = load_setting(pool, VIEWER_ID_KEY).await?;
    let name = load_viewer_name(pool).await?;
    Ok(match (id, name) {
        (Some(i), Some(n)) => Some((i, n)),
        _ => None,
    })
}
```

- [ ] **Step 3: Write the repository tests first** (`src-tauri/src/db/issues.rs`, `#[cfg(test)]` at bottom)

Add this test module skeleton (it won't compile until Step 4 defines the structs/fns — that's the failing state):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_pool;

    async fn pool() -> (tempfile::TempDir, sqlx::SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = init_pool(&dir.path().join("astryn/test.db")).await.unwrap();
        (dir, pool)
    }

    fn rec(id: &str, due: Option<&str>, updated: &str) -> IssueRecord {
        IssueRecord {
            id: id.into(), identifier: format!("ENG-{id}"), title: "T".into(),
            description: None, due_date: due.map(Into::into), priority: 0, url: "u".into(),
            state_id: Some("s".into()), state_name: Some("Todo".into()),
            state_type: Some("unstarted".into()), state_color: Some("#fff".into()),
            assignee_id: Some("me".into()), assignee_name: Some("Me".into()),
            team_id: Some("t1".into()), team_key: Some("ENG".into()),
            project_id: Some("p1".into()), project_name: Some("Proj".into()),
            parent_id: None, created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: updated.into(), archived_at: None, raw_json: "{}".into(),
        }
    }

    async fn upsert(pool: &sqlx::SqlitePool, r: &IssueRecord) -> bool {
        let mut tx = pool.begin().await.unwrap();
        let applied = upsert_issue(&mut tx, r).await.unwrap();
        tx.commit().await.unwrap();
        applied
    }

    #[tokio::test]
    async fn upsert_inserts_then_conditionally_updates() {
        let (_d, p) = pool().await;
        assert!(upsert(&p, &rec("1", Some("2026-06-10"), "2026-06-01T00:00:00Z")).await);
        // Newer update applies.
        assert!(upsert(&p, &rec("1", Some("2026-06-11"), "2026-06-02T00:00:00Z")).await);
        // Older update is rejected.
        assert!(!upsert(&p, &rec("1", Some("2026-06-09"), "2026-05-01T00:00:00Z")).await);
        let got = load_issue(&p, "1").await.unwrap().unwrap();
        assert_eq!(got.due_date.as_deref(), Some("2026-06-11"));
    }

    #[tokio::test]
    async fn range_is_half_open_and_excludes_archived() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", Some("2026-06-01"), "t1")).await;
        upsert(&p, &rec("2", Some("2026-06-30"), "t1")).await; // exclusive end -> excluded
        let mut arch = rec("3", Some("2026-06-15"), "t1");
        arch.archived_at = Some("2026-06-16T00:00:00Z".into());
        upsert(&p, &arch).await;
        let got = load_issues_in_range(&p, "2026-06-01", "2026-06-30", None, None, None)
            .await.unwrap();
        let ids: Vec<_> = got.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["1"]); // 2 is at exclusive end, 3 is archived
    }

    #[tokio::test]
    async fn unscheduled_returns_null_due_only_filtered_by_assignee() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", None, "t1")).await;
        let mut other = rec("2", None, "t1");
        other.assignee_id = Some("someone".into());
        upsert(&p, &other).await;
        upsert(&p, &rec("3", Some("2026-06-10"), "t1")).await; // has due -> excluded
        let got = load_unscheduled(&p, None, Some("me".into()), None).await.unwrap();
        let ids: Vec<_> = got.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["1"]);
    }

    #[tokio::test]
    async fn labels_replaced_and_pruned() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", Some("2026-06-10"), "t1")).await;
        let mut tx = p.begin().await.unwrap();
        replace_labels(&mut tx, "1", &[
            LabelRecord { label_id: "a".into(), name: Some("bug".into()), color: Some("#f00".into()) },
            LabelRecord { label_id: "b".into(), name: Some("ui".into()), color: None },
        ]).await.unwrap();
        tx.commit().await.unwrap();
        // Replace with a single label -> "a"/"b"? only "c" remains.
        let mut tx = p.begin().await.unwrap();
        replace_labels(&mut tx, "1", &[
            LabelRecord { label_id: "c".into(), name: Some("perf".into()), color: None },
        ]).await.unwrap();
        tx.commit().await.unwrap();
        let rows: Vec<(String,)> = sqlx::query_as("SELECT label_id FROM labels WHERE issue_id='1' ORDER BY label_id")
            .fetch_all(&p).await.unwrap();
        assert_eq!(rows.iter().map(|r| r.0.clone()).collect::<Vec<_>>(), vec!["c".to_string()]);
    }

    #[tokio::test]
    async fn cursor_roundtrip_and_filter_options() {
        let (_d, p) = pool().await;
        assert_eq!(get_sync_cursor(&p).await.unwrap(), None);
        set_sync_cursor(&p, "2026-06-01T00:00:00Z").await.unwrap();
        assert_eq!(get_sync_cursor(&p).await.unwrap(), Some("2026-06-01T00:00:00Z".into()));
        upsert(&p, &rec("1", Some("2026-06-10"), "t1")).await;
        let opts = list_filter_options(&p).await.unwrap();
        assert_eq!(opts.teams.len(), 1);
        assert_eq!(opts.teams[0].key, "ENG");
        assert_eq!(opts.projects[0].name, "Proj");
    }

    #[tokio::test]
    async fn wipe_clears_issues_labels_cursors_and_identity() {
        let (_d, p) = pool().await;
        upsert(&p, &rec("1", Some("2026-06-10"), "t1")).await;
        set_sync_cursor(&p, "x").await.unwrap();
        crate::db::save_identity(&p, "vid", "Me", "org1", "GAM", "gam").await.unwrap();
        wipe_workspace_cache(&p).await.unwrap();
        assert_eq!(load_issue(&p, "1").await.unwrap(), None);
        assert_eq!(get_sync_cursor(&p).await.unwrap(), None);
        assert_eq!(crate::db::load_org_id(&p).await.unwrap(), None);
    }
}
```

- [ ] **Step 4: Implement `src-tauri/src/db/issues.rs`**

```rust
use sqlx::{Sqlite, SqlitePool, Transaction};

#[derive(Debug, Clone, PartialEq, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CalendarIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub due_date: Option<String>,
    pub priority: i64,
    pub state_type: String,
    pub state_color: String,
    pub assignee_id: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub priority: i64,
    pub url: String,
    pub state_id: Option<String>,
    pub state_name: Option<String>,
    pub state_type: String,
    pub state_color: String,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct IssueRecord {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub priority: i64,
    pub url: String,
    pub state_id: Option<String>,
    pub state_name: Option<String>,
    pub state_type: Option<String>,
    pub state_color: Option<String>,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub raw_json: String,
}

#[derive(Debug, Clone)]
pub struct LabelRecord {
    pub label_id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct TeamOption { pub id: String, pub key: String }
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ProjectOption { pub id: String, pub name: String }
#[derive(Debug, Clone, serde::Serialize)]
pub struct FilterOptions { pub teams: Vec<TeamOption>, pub projects: Vec<ProjectOption> }

/// Conditional upsert: an incoming record with an older `updated_at` never
/// clobbers a newer cached row. Returns true if the row was inserted/updated.
pub async fn upsert_issue(
    tx: &mut Transaction<'_, Sqlite>,
    r: &IssueRecord,
) -> Result<bool, sqlx::Error> {
    let id: Option<(String,)> = sqlx::query_as(
        "INSERT INTO issues
           (id, identifier, title, description, due_date, priority, url,
            state_id, state_name, state_type, state_color, assignee_id, assignee_name,
            team_id, team_key, project_id, project_name, parent_id,
            created_at, updated_at, archived_at, synced_at, raw_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21, datetime('now'), ?22)
         ON CONFLICT(id) DO UPDATE SET
           identifier=excluded.identifier, title=excluded.title, description=excluded.description,
           due_date=excluded.due_date, priority=excluded.priority, url=excluded.url,
           state_id=excluded.state_id, state_name=excluded.state_name, state_type=excluded.state_type,
           state_color=excluded.state_color, assignee_id=excluded.assignee_id, assignee_name=excluded.assignee_name,
           team_id=excluded.team_id, team_key=excluded.team_key, project_id=excluded.project_id,
           project_name=excluded.project_name, parent_id=excluded.parent_id,
           created_at=excluded.created_at, updated_at=excluded.updated_at, archived_at=excluded.archived_at,
           synced_at=excluded.synced_at, raw_json=excluded.raw_json
         WHERE excluded.updated_at >= issues.updated_at
         RETURNING id",
    )
    .bind(&r.id).bind(&r.identifier).bind(&r.title).bind(&r.description).bind(&r.due_date)
    .bind(r.priority).bind(&r.url).bind(&r.state_id).bind(&r.state_name).bind(&r.state_type)
    .bind(&r.state_color).bind(&r.assignee_id).bind(&r.assignee_name).bind(&r.team_id).bind(&r.team_key)
    .bind(&r.project_id).bind(&r.project_name).bind(&r.parent_id).bind(&r.created_at).bind(&r.updated_at)
    .bind(&r.archived_at).bind(&r.raw_json)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(id.is_some())
}

pub async fn replace_labels(
    tx: &mut Transaction<'_, Sqlite>,
    issue_id: &str,
    labels: &[LabelRecord],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM labels WHERE issue_id = ?1")
        .bind(issue_id)
        .execute(&mut **tx)
        .await?;
    for l in labels {
        sqlx::query("INSERT INTO labels (issue_id, label_id, name, color) VALUES (?1,?2,?3,?4)")
            .bind(issue_id).bind(&l.label_id).bind(&l.name).bind(&l.color)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

const CAL_COLS: &str = "id, identifier, title, due_date, COALESCE(priority,0) AS priority,
    COALESCE(state_type,'') AS state_type, COALESCE(state_color,'') AS state_color,
    assignee_id, team_id, team_key, project_id";

pub async fn load_issues_in_range(
    pool: &SqlitePool,
    start: &str, end: &str,
    team_id: Option<String>, assignee_id: Option<String>, project_id: Option<String>,
) -> Result<Vec<CalendarIssue>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {CAL_COLS} FROM issues
         WHERE archived_at IS NULL AND due_date >= ?1 AND due_date < ?2
           AND (?3 IS NULL OR team_id = ?3)
           AND (?4 IS NULL OR assignee_id = ?4)
           AND (?5 IS NULL OR project_id = ?5)
         ORDER BY due_date, identifier"
    ))
    .bind(start).bind(end).bind(team_id).bind(assignee_id).bind(project_id)
    .fetch_all(pool)
    .await
}

pub async fn load_unscheduled(
    pool: &SqlitePool,
    team_id: Option<String>, assignee_id: Option<String>, project_id: Option<String>,
) -> Result<Vec<CalendarIssue>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {CAL_COLS} FROM issues
         WHERE archived_at IS NULL AND due_date IS NULL
           AND (?1 IS NULL OR team_id = ?1)
           AND (?2 IS NULL OR assignee_id = ?2)
           AND (?3 IS NULL OR project_id = ?3)
         ORDER BY identifier"
    ))
    .bind(team_id).bind(assignee_id).bind(project_id)
    .fetch_all(pool)
    .await
}

pub async fn load_issue(pool: &SqlitePool, id: &str) -> Result<Option<Issue>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, identifier, title, description, due_date, COALESCE(priority,0) AS priority, url,
                state_id, state_name, COALESCE(state_type,'') AS state_type,
                COALESCE(state_color,'') AS state_color, assignee_id, assignee_name,
                team_id, team_key, project_id, project_name, parent_id, created_at, updated_at
         FROM issues WHERE id = ?1 AND archived_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn list_filter_options(pool: &SqlitePool) -> Result<FilterOptions, sqlx::Error> {
    let teams: Vec<TeamOption> = sqlx::query_as(
        "SELECT DISTINCT team_id AS id, team_key AS key FROM issues
         WHERE archived_at IS NULL AND team_id IS NOT NULL AND team_key IS NOT NULL
         ORDER BY team_key",
    ).fetch_all(pool).await?;
    let projects: Vec<ProjectOption> = sqlx::query_as(
        "SELECT DISTINCT project_id AS id, project_name AS name FROM issues
         WHERE archived_at IS NULL AND project_id IS NOT NULL AND project_name IS NOT NULL
         ORDER BY project_name",
    ).fetch_all(pool).await?;
    Ok(FilterOptions { teams, projects })
}

const CURSOR_SOURCE: &str = "linear_issues";
const CURSOR_KEY: &str = "last_updated_at";

pub async fn get_sync_cursor(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT value FROM sync_cursors WHERE source = ?1 AND key = ?2",
    ).bind(CURSOR_SOURCE).bind(CURSOR_KEY).fetch_optional(pool).await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn set_sync_cursor(pool: &SqlitePool, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO sync_cursors (source, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(source, key) DO UPDATE SET value = excluded.value",
    ).bind(CURSOR_SOURCE).bind(CURSOR_KEY).bind(value).execute(pool).await?;
    Ok(())
}

/// One transaction: drop all cached workspace data + identity. Used on key change / Resync.
pub async fn wipe_workspace_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM issues").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM labels").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sync_cursors").execute(&mut *tx).await?;
    sqlx::query(
        "DELETE FROM settings WHERE key IN
         ('linear_viewer_name','linear_viewer_id','linear_org_id','linear_org_name','linear_org_url_key')",
    ).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::issues`
Expected: all six `db::issues` tests pass; existing M0 db tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/0002_m1_issues.sql src-tauri/src/db/
git commit -m "feat(m1): SQLite issues/labels/cursors schema + repositories"
```

---

### Task 2: Linear types, parsers, rate-limit classification, and the tri-state patch

**Files:**
- Create: `src-tauri/src/linear/issues.rs`
- Modify: `src-tauri/src/linear/mod.rs` (declare `pub mod issues; pub mod sync;`; add a shared `classify_graphql_errors` + `extract_data` helper; add `LinearError` usage; keep `parse_viewer_response`/`interpret_response` working)

**Interfaces:**
- Consumes: `LinearError` (M0), `reqwest::Client` (M0 `LinearClient`).
- Produces:
  - Wire types: `ParsedIssue` (all `IssueRecord` columns as fields + `labels: Vec<ParsedLabel>` + `archived_at` + a `raw_json` it carries), `IssuesPage { issues: Vec<ParsedIssue>, has_next: bool, end_cursor: Option<String> }`, `OrgIdentity { viewer_id, viewer_name, org_id, org_name, org_url_key }`, `ParsedUser { id, name }`, `IssueDetailNode { ... }` (parent/children/relations/comments/team_states + the issue fields).
  - Parsers: `parse_issues_page(body) -> Result<IssuesPage, LinearError>`, `parse_issue_detail(body) -> Result<IssueDetailNode, LinearError>`, `parse_users(body) -> Result<Vec<ParsedUser>, LinearError>`, `parse_viewer_with_org(body) -> Result<OrgIdentity, LinearError>`, `parse_issue_update(body) -> Result<ParsedIssue, LinearError>`.
  - `UpdateIssuePatch` (tri-state) + `patch_to_input(&UpdateIssuePatch) -> serde_json::Value`.
  - `LinearClient` methods: `issues_page(auth, after, since) -> IssuesPage`, `issue_detail(auth, id) -> IssueDetailNode`, `users(auth) -> Vec<ParsedUser>`, `viewer_with_org(auth) -> OrgIdentity`, `update_issue(auth, id, &serde_json::Value) -> ParsedIssue`.

- [ ] **Step 0 (gate): Confirm the live Linear schema before writing parsers**

The query strings and `parse_*` functions below hard-code field names. Per `requirements.md` §7 / CLAUDE.md "Live API wins", **introspect the live schema first** and adjust any names that differ. Use the Linear key (from Settings/keychain) against the API:

```bash
# Pull the key straight from the OS keychain — never paste it on the command line
# (keeps it out of shell history). macOS:
KEY="$(security find-generic-password -s com.orion.astryn -a linear_api_key -w)"
# (Linux/Windows, or if the above fails: add a throwaway Rust bin that reads it via
#  SecretStore and prints introspection — do NOT echo the key itself.)
gq() { curl -s https://api.linear.app/graphql -H "Content-Type: application/json" \
  -H "Authorization: $KEY" -d "{\"query\":\"$1\"}" | jq; }

# Inputs/enums and field names to confirm:
gq 'query { __type(name: \"IssueUpdateInput\") { inputFields { name } } }'   # dueDate, stateId, assigneeId, priority, title, description
gq 'query { __type(name: \"IssueFilter\") { inputFields { name } } }'         # updatedAt comparator exists
gq 'query { issues(first: 1, includeArchived: true, orderBy: updatedAt) { pageInfo { hasNextPage endCursor } nodes { id identifier archivedAt state { type color } labels { nodes { id } } } } }'
gq 'query { viewer { id name organization { id name urlKey } } }'
gq 'query { __type(name: \"Issue\") { fields { name } } }'                    # cycle, relations, children, comments, team
```
Confirm: `issues(... includeArchived orderBy ...)`, `IssueFilter.updatedAt` accepts `{ gte }`, `archivedAt`, `viewer.organization.urlKey`, `relations.nodes.relatedIssue`, `issue.team.states`, `cycle { id number name }`, and `IssueUpdateInput` field names. If any differ, update the corresponding query string + parser in this task.

- [ ] **Step 1: Carry the rate-limit reset hint + add shared error helpers in `linear/mod.rs`**

First, change the M0 `LinearError::RateLimited` unit variant to carry an optional seconds-until-reset, and update its two existing M0 call sites:

```rust
// in the LinearError enum:
    #[error("rate limited")]
    RateLimited(Option<i64>),
```
- In `interpret_response`, change `429 => Err(LinearError::RateLimited)` to `429 => Err(LinearError::RateLimited(None))`.
- In the M0 test `too_many_requests_is_rate_limited`, change the match arm to `Err(LinearError::RateLimited(_))`.

Then declare the submodules at the top and add the shared classifier + extractor:

```rust
pub mod issues;
pub mod sync;
```

```rust
use serde_json::Value;

/// Classify a non-empty GraphQL `errors` array. Linear may report throttling as
/// a GraphQL error with extension code RATELIMITED (even on HTTP 200/400).
pub fn classify_graphql_errors(errors: &[Value]) -> LinearError {
    let is_ratelimited = errors.iter().any(|e| {
        e.get("extensions").and_then(|x| x.get("code")).and_then(|c| c.as_str()) == Some("RATELIMITED")
            || e.get("extensions").and_then(|x| x.get("type")).and_then(|c| c.as_str()) == Some("RATELIMITED")
    });
    if is_ratelimited {
        return LinearError::RateLimited(None);
    }
    let joined = errors
        .iter()
        .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
        .collect::<Vec<_>>()
        .join("; ");
    LinearError::Api(joined)
}

/// Parse a GraphQL body to its `data` object, treating a non-empty `errors`
/// array as a failure (HTTP-200-with-errors), RATELIMITED-aware.
pub fn extract_data(body: &str) -> Result<Value, LinearError> {
    let v: Value = serde_json::from_str(body).map_err(|_| LinearError::Malformed)?;
    if let Some(errors) = v.get("errors").and_then(|e| e.as_array()) {
        if !errors.is_empty() {
            return Err(classify_graphql_errors(errors));
        }
    }
    v.get("data").cloned().ok_or(LinearError::Malformed)
}
```

Also change `interpret_response` so a **400** is parsed (it may carry a RATELIMITED GraphQL error) rather than treated as a hard transport error — the existing `_ => parse_viewer_response(body)` arm already does this, so only confirm 400 is not special-cased above it. Add `http_status_to_error`:

```rust
/// Map only the unambiguous transport statuses to errors; 2xx and 400 fall
/// through to body parsing (where GraphQL errors incl. RATELIMITED are detected).
pub fn http_status_to_error(status: u16) -> Option<LinearError> {
    match status {
        401 | 403 => Some(LinearError::Auth),
        429 => Some(LinearError::RateLimited(None)), // http_post fills the reset hint from headers
        500..=599 => Some(LinearError::Server),
        _ => None,
    }
}
```

- [ ] **Step 2: Write parser + patch tests** (`src-tauri/src/linear/issues.rs`, `#[cfg(test)]`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_issues_page_with_pageinfo() {
        let body = r#"{"data":{"issues":{"pageInfo":{"hasNextPage":true,"endCursor":"C1"},
          "nodes":[{"id":"i1","identifier":"ENG-1","title":"T","description":null,
          "dueDate":"2026-06-10","priority":2,"url":"u","createdAt":"c","updatedAt":"u1","archivedAt":null,
          "state":{"id":"s","name":"Todo","type":"unstarted","color":"#fff"},
          "assignee":{"id":"me","name":"Me"},"team":{"id":"t","key":"ENG"},
          "project":{"id":"p","name":"P"},"cycle":null,"parent":null,
          "labels":{"nodes":[{"id":"l1","name":"bug","color":"#f00"}]}}]}}}"#;
        let page = parse_issues_page(body).unwrap();
        assert!(page.has_next);
        assert_eq!(page.end_cursor.as_deref(), Some("C1"));
        assert_eq!(page.issues.len(), 1);
        let i = &page.issues[0];
        assert_eq!(i.identifier, "ENG-1");
        assert_eq!(i.priority, 2);
        assert_eq!(i.team_key.as_deref(), Some("ENG"));
        assert_eq!(i.labels.len(), 1);
        assert_eq!(i.archived_at, None);
        assert!(!i.raw_json.is_empty());
    }

    #[test]
    fn graphql_ratelimited_is_rate_limited() {
        let body = r#"{"errors":[{"message":"slow down","extensions":{"code":"RATELIMITED"}}]}"#;
        assert!(matches!(parse_issues_page(body), Err(LinearError::RateLimited(_))));
    }

    #[test]
    fn malformed_body_is_malformed() {
        assert!(matches!(parse_issues_page("nope"), Err(LinearError::Malformed)));
    }

    #[test]
    fn parses_org_identity() {
        let body = r#"{"data":{"viewer":{"id":"v1","name":"Me",
          "organization":{"id":"o1","name":"GAM","urlKey":"gam"}}}}"#;
        let o = parse_viewer_with_org(body).unwrap();
        assert_eq!(o.viewer_id, "v1");
        assert_eq!(o.org_id, "o1");
        assert_eq!(o.org_url_key, "gam");
    }

    #[test]
    fn patch_tristate_maps_to_graphql_input() {
        // omitted -> field absent
        let p: UpdateIssuePatch = serde_json::from_str("{}").unwrap();
        assert_eq!(patch_to_input(&p), serde_json::json!({}));
        // explicit null -> clear
        let p: UpdateIssuePatch = serde_json::from_str(r#"{"dueDate":null}"#).unwrap();
        assert_eq!(patch_to_input(&p), serde_json::json!({"dueDate": null}));
        // value -> set
        let p: UpdateIssuePatch = serde_json::from_str(r#"{"dueDate":"2026-06-12","priority":1}"#).unwrap();
        assert_eq!(patch_to_input(&p), serde_json::json!({"dueDate":"2026-06-12","priority":1}));
    }

    #[test]
    fn parses_issue_update_returned_issue() {
        let body = r#"{"data":{"issueUpdate":{"success":true,"issue":{"id":"i1","identifier":"ENG-1",
          "title":"T","description":null,"dueDate":null,"priority":0,"url":"u","createdAt":"c","updatedAt":"u2","archivedAt":null,
          "state":{"id":"s","name":"Todo","type":"unstarted","color":"#fff"},"assignee":null,
          "team":{"id":"t","key":"ENG"},"project":null,"cycle":null,"parent":null,
          "labels":{"nodes":[]}}}}}"#;
        let i = parse_issue_update(body).unwrap();
        assert_eq!(i.id, "i1");
        assert_eq!(i.updated_at, "u2");
        assert_eq!(i.assignee_id, None);
    }
}
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml linear::issues`
Expected: FAIL to compile (`parse_issues_page` etc. not defined).

- [ ] **Step 4: Implement `src-tauri/src/linear/issues.rs`**

```rust
use crate::linear::{extract_data, http_status_to_error, LinearClient, LinearError};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedLabel { pub id: String, pub name: Option<String>, pub color: Option<String> }

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedIssue {
    pub id: String, pub identifier: String, pub title: String, pub description: Option<String>,
    pub due_date: Option<String>, pub priority: i64, pub url: String,
    pub state_id: Option<String>, pub state_name: Option<String>,
    pub state_type: Option<String>, pub state_color: Option<String>,
    pub assignee_id: Option<String>, pub assignee_name: Option<String>,
    pub team_id: Option<String>, pub team_key: Option<String>,
    pub project_id: Option<String>, pub project_name: Option<String>,
    pub parent_id: Option<String>, pub created_at: String, pub updated_at: String,
    pub archived_at: Option<String>, pub labels: Vec<ParsedLabel>, pub raw_json: String,
}

pub struct IssuesPage { pub issues: Vec<ParsedIssue>, pub has_next: bool, pub end_cursor: Option<String> }

#[derive(Debug, Clone, PartialEq)]
pub struct OrgIdentity {
    pub viewer_id: String, pub viewer_name: String,
    pub org_id: String, pub org_name: String, pub org_url_key: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedUser { pub id: String, pub name: String }

// ---- helpers to read nested JSON safely ----
fn s(v: &Value, k: &str) -> Option<String> { v.get(k).and_then(|x| x.as_str()).map(Into::into) }
fn nested(v: &Value, obj: &str, k: &str) -> Option<String> {
    v.get(obj).and_then(|o| o.get(k)).and_then(|x| x.as_str()).map(Into::into)
}

fn node_to_issue(n: &Value) -> ParsedIssue {
    let labels = n.get("labels").and_then(|l| l.get("nodes")).and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(|l| ParsedLabel {
            id: s(l, "id").unwrap_or_default(), name: s(l, "name"), color: s(l, "color"),
        }).collect()).unwrap_or_default();
    ParsedIssue {
        id: s(n, "id").unwrap_or_default(),
        identifier: s(n, "identifier").unwrap_or_default(),
        title: s(n, "title").unwrap_or_default(),
        description: s(n, "description"),
        due_date: s(n, "dueDate"),
        priority: n.get("priority").and_then(|p| p.as_i64()).unwrap_or(0),
        url: s(n, "url").unwrap_or_default(),
        state_id: nested(n, "state", "id"), state_name: nested(n, "state", "name"),
        state_type: nested(n, "state", "type"), state_color: nested(n, "state", "color"),
        assignee_id: nested(n, "assignee", "id"), assignee_name: nested(n, "assignee", "name"),
        team_id: nested(n, "team", "id"), team_key: nested(n, "team", "key"),
        project_id: nested(n, "project", "id"), project_name: nested(n, "project", "name"),
        parent_id: nested(n, "parent", "id"),
        created_at: s(n, "createdAt").unwrap_or_default(),
        updated_at: s(n, "updatedAt").unwrap_or_default(),
        archived_at: s(n, "archivedAt"),
        labels,
        raw_json: n.to_string(),
    }
}

pub fn parse_issues_page(body: &str) -> Result<IssuesPage, LinearError> {
    let data = extract_data(body)?;
    let issues_obj = data.get("issues").ok_or(LinearError::Malformed)?;
    let page = issues_obj.get("pageInfo").ok_or(LinearError::Malformed)?;
    let nodes = issues_obj.get("nodes").and_then(|n| n.as_array()).ok_or(LinearError::Malformed)?;
    Ok(IssuesPage {
        issues: nodes.iter().map(node_to_issue).collect(),
        has_next: page.get("hasNextPage").and_then(|b| b.as_bool()).unwrap_or(false),
        end_cursor: s(page, "endCursor"),
    })
}

pub fn parse_viewer_with_org(body: &str) -> Result<OrgIdentity, LinearError> {
    let data = extract_data(body)?;
    let v = data.get("viewer").ok_or(LinearError::Malformed)?;
    Ok(OrgIdentity {
        viewer_id: s(v, "id").ok_or(LinearError::Malformed)?,
        viewer_name: s(v, "name").unwrap_or_default(),
        org_id: nested(v, "organization", "id").ok_or(LinearError::Malformed)?,
        org_name: nested(v, "organization", "name").unwrap_or_default(),
        org_url_key: nested(v, "organization", "urlKey").unwrap_or_default(),
    })
}

pub fn parse_users(body: &str) -> Result<Vec<ParsedUser>, LinearError> {
    let data = extract_data(body)?;
    let nodes = data.get("users").and_then(|u| u.get("nodes")).and_then(|n| n.as_array())
        .ok_or(LinearError::Malformed)?;
    Ok(nodes.iter().filter_map(|u| Some(ParsedUser {
        id: s(u, "id")?, name: s(u, "name").unwrap_or_default(),
    })).collect())
}

pub fn parse_issue_update(body: &str) -> Result<ParsedIssue, LinearError> {
    let data = extract_data(body)?;
    let upd = data.get("issueUpdate").ok_or(LinearError::Malformed)?;
    if upd.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api("issueUpdate returned success=false".into()));
    }
    let issue = upd.get("issue").ok_or(LinearError::Malformed)?;
    Ok(node_to_issue(issue))
}

// ---- issue detail (drawer) ----
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRef { pub id: String, pub identifier: String, pub title: String }
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailChild { pub id: String, pub identifier: String, pub title: String, pub state_type: String }
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRelation { pub r#type: String, pub issue: DetailRef }
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailComment { pub id: String, pub body: String, pub user_name: Option<String>, pub created_at: String }
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailState { pub id: String, pub name: String, pub r#type: String, pub color: String }
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailCycle { pub id: String, pub number: Option<i64>, pub name: Option<String> }

pub struct IssueDetailNode {
    pub issue: ParsedIssue,
    pub team_states: Vec<DetailState>,
    pub cycle: Option<DetailCycle>,
    pub parent: Option<DetailRef>,
    pub children: Vec<DetailChild>,
    pub relations: Vec<DetailRelation>,
    pub comments: Vec<DetailComment>,
    pub has_more_children: bool,
    pub has_more_relations: bool,
    pub has_more_comments: bool,
}

fn conn_has_next(n: &Value, conn: &str) -> bool {
    n.get(conn).and_then(|c| c.get("pageInfo")).and_then(|p| p.get("hasNextPage"))
        .and_then(|b| b.as_bool()).unwrap_or(false)
}

pub fn parse_issue_detail(body: &str) -> Result<IssueDetailNode, LinearError> {
    let data = extract_data(body)?;
    let n = data.get("issue").ok_or(LinearError::Malformed)?;
    let issue = node_to_issue(n);
    let cycle = n.get("cycle").filter(|c| !c.is_null()).map(|c| DetailCycle {
        id: s(c, "id").unwrap_or_default(),
        number: c.get("number").and_then(|x| x.as_i64()),
        name: s(c, "name"),
    });
    let team_states = n.get("team").and_then(|t| t.get("states")).and_then(|s2| s2.get("nodes"))
        .and_then(|x| x.as_array()).map(|arr| arr.iter().map(|st| DetailState {
            id: s(st, "id").unwrap_or_default(), name: s(st, "name").unwrap_or_default(),
            r#type: s(st, "type").unwrap_or_default(), color: s(st, "color").unwrap_or_default(),
        }).collect()).unwrap_or_default();
    let parent = n.get("parent").filter(|p| !p.is_null()).map(|p| DetailRef {
        id: s(p, "id").unwrap_or_default(), identifier: s(p, "identifier").unwrap_or_default(),
        title: s(p, "title").unwrap_or_default(),
    });
    let children = n.get("children").and_then(|c| c.get("nodes")).and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(|c| DetailChild {
            id: s(c, "id").unwrap_or_default(), identifier: s(c, "identifier").unwrap_or_default(),
            title: s(c, "title").unwrap_or_default(),
            state_type: nested(c, "state", "type").unwrap_or_default(),
        }).collect()).unwrap_or_default();
    let relations = n.get("relations").and_then(|r| r.get("nodes")).and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|r| {
            let ri = r.get("relatedIssue")?;
            Some(DetailRelation {
                r#type: s(r, "type").unwrap_or_default(),
                issue: DetailRef {
                    id: s(ri, "id").unwrap_or_default(), identifier: s(ri, "identifier").unwrap_or_default(),
                    title: s(ri, "title").unwrap_or_default(),
                },
            })
        }).collect()).unwrap_or_default();
    let comments = n.get("comments").and_then(|c| c.get("nodes")).and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(|c| DetailComment {
            id: s(c, "id").unwrap_or_default(), body: s(c, "body").unwrap_or_default(),
            user_name: nested(c, "user", "name"), created_at: s(c, "createdAt").unwrap_or_default(),
        }).collect()).unwrap_or_default();
    Ok(IssueDetailNode {
        issue, team_states, cycle, parent, children, relations, comments,
        has_more_children: conn_has_next(n, "children"),
        has_more_relations: conn_has_next(n, "relations"),
        has_more_comments: conn_has_next(n, "comments"),
    })
}

// ---- tri-state patch ----
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where T: Deserialize<'de>, D: Deserializer<'de> {
    Deserialize::deserialize(de).map(Some)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIssuePatch {
    #[serde(default)] pub title: Option<String>,
    #[serde(default)] pub state_id: Option<String>,
    #[serde(default)] pub priority: Option<i64>,
    #[serde(default, deserialize_with = "double_option")] pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")] pub assignee_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")] pub description: Option<Option<String>>,
}

/// Build the GraphQL `IssueUpdateInput`. Omitted => absent; Some(None) => null (clear).
pub fn patch_to_input(p: &UpdateIssuePatch) -> Value {
    let mut m = serde_json::Map::new();
    if let Some(v) = &p.title { m.insert("title".into(), Value::String(v.clone())); }
    if let Some(v) = &p.state_id { m.insert("stateId".into(), Value::String(v.clone())); }
    if let Some(v) = p.priority { m.insert("priority".into(), Value::from(v)); }
    if let Some(opt) = &p.due_date { m.insert("dueDate".into(), opt.clone().map(Value::String).unwrap_or(Value::Null)); }
    if let Some(opt) = &p.assignee_id { m.insert("assigneeId".into(), opt.clone().map(Value::String).unwrap_or(Value::Null)); }
    if let Some(opt) = &p.description { m.insert("description".into(), opt.clone().map(Value::String).unwrap_or(Value::Null)); }
    Value::Object(m)
}
```

- [ ] **Step 5: Add the GraphQL query strings + `LinearClient` methods** (append to `linear/issues.rs`)

```rust
const ISSUE_NODE_FIELDS: &str = "id identifier title description dueDate priority url createdAt updatedAt archivedAt
  state { id name type color } assignee { id name } team { id key } project { id name } parent { id }
  labels { nodes { id name color } }";

fn issues_query() -> String {
    format!(
        "query Issues($after: String, $filter: IssueFilter) {{
           issues(first: 100, after: $after, filter: $filter, includeArchived: true, orderBy: updatedAt) {{
             pageInfo {{ hasNextPage endCursor }}
             nodes {{ {ISSUE_NODE_FIELDS} }}
           }}
         }}"
    )
}

fn issue_detail_query() -> String {
    format!(
        "query Issue($id: String!) {{
           issue(id: $id) {{
             {ISSUE_NODE_FIELDS}
             cycle {{ id number name }}
             team {{ id key states(first: 50) {{ nodes {{ id name type color }} }} }}
             parent {{ id identifier title }}
             children(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ id identifier title state {{ type }} }} }}
             relations(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ type relatedIssue {{ id identifier title }} }} }}
             comments(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ id body createdAt user {{ name }} }} }}
           }}
         }}"
    )
}

const USERS_QUERY: &str = "query { users(first: 250) { nodes { id name } } }";
const VIEWER_ORG_QUERY: &str = "query { viewer { id name organization { id name urlKey } } }";
const ISSUE_UPDATE_MUTATION: &str =
    "mutation U($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) {
       success issue { id identifier title description dueDate priority url createdAt updatedAt archivedAt
         state { id name type color } assignee { id name } team { id key } project { id name } parent { id }
         labels { nodes { id name color } } } } }";

impl LinearClient {
    async fn post(&self, auth: &str, body: serde_json::Value) -> Result<String, LinearError> {
        let resp = self.http_post(auth, body).await?; // see Step 6 in linear/mod.rs
        Ok(resp)
    }

    pub async fn issues_page(&self, auth: &str, after: Option<&str>, since: Option<&str>) -> Result<IssuesPage, LinearError> {
        let filter = since.map(|c| serde_json::json!({ "updatedAt": { "gte": c } })).unwrap_or(serde_json::json!({}));
        let body = serde_json::json!({ "query": issues_query(), "variables": { "after": after, "filter": filter } });
        parse_issues_page(&self.post(auth, body).await?)
    }

    pub async fn issue_detail(&self, auth: &str, id: &str) -> Result<IssueDetailNode, LinearError> {
        let body = serde_json::json!({ "query": issue_detail_query(), "variables": { "id": id } });
        parse_issue_detail(&self.post(auth, body).await?)
    }

    pub async fn users(&self, auth: &str) -> Result<Vec<ParsedUser>, LinearError> {
        let body = serde_json::json!({ "query": USERS_QUERY });
        parse_users(&self.post(auth, body).await?)
    }

    pub async fn viewer_with_org(&self, auth: &str) -> Result<OrgIdentity, LinearError> {
        let body = serde_json::json!({ "query": VIEWER_ORG_QUERY });
        parse_viewer_with_org(&self.post(auth, body).await?)
    }

    pub async fn update_issue(&self, auth: &str, id: &str, input: &serde_json::Value) -> Result<ParsedIssue, LinearError> {
        let body = serde_json::json!({ "query": ISSUE_UPDATE_MUTATION, "variables": { "id": id, "input": input } });
        parse_issue_update(&self.post(auth, body).await?)
    }
}
```

- [ ] **Step 6: Add the shared `http_post` to `LinearClient` in `linear/mod.rs`**

Refactor the existing `viewer` method to share one POST helper that applies `http_status_to_error`:

```rust
impl LinearClient {
    /// POST a GraphQL body, returning the raw response text. Maps unambiguous
    /// transport statuses to errors; leaves body parsing to the caller's parser.
    pub async fn http_post(&self, authorization: &str, body: serde_json::Value) -> Result<String, LinearError> {
        let resp = self
            .http
            .post(&self.endpoint)
            .header("Authorization", authorization)
            .json(&body)
            .send()
            .await
            .map_err(|_| LinearError::Network)?;
        let status = resp.status().as_u16();
        // Capture the reset hint from headers before the body is consumed.
        if status == 429 {
            let h = resp.headers();
            let num = |name: &str| h.get(name).and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<i64>().ok());
            // Retry-After is a delta (seconds); X-RateLimit-Requests-Reset is an epoch.
            let retry = num("retry-after").or_else(|| {
                num("x-ratelimit-requests-reset").map(|reset| {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    reset - now
                })
            });
            return Err(LinearError::RateLimited(retry));
        }
        let text = resp.text().await.map_err(|_| LinearError::Network)?;
        if let Some(e) = http_status_to_error(status) {
            return Err(e);
        }
        Ok(text)
    }
}
```

Leave the existing `viewer(...)` method as-is (M0's `test_linear_connection` still uses it via `interpret_response`); it stays green.

- [ ] **Step 7: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml linear`
Expected: all `linear::issues` tests pass; existing M0 `linear` tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/linear/
git commit -m "feat(m1): Linear issue/detail/user parsers, rate-limit + tri-state patch"
```

---

### Task 3: Sync engine (full + incremental)

**Files:**
- Modify: `src-tauri/Cargo.toml` (add the `time` dependency)
- Create: `src-tauri/src/linear/sync.rs`

**Interfaces:**
- Consumes: `db::issues` (upsert/labels/cursor), `linear::issues::{ParsedIssue, IssuesPage}`.
- Produces:
  - `SyncResult { mode: SyncMode, synced: usize }`, `enum SyncMode { Full, Incremental }` (serialized `"full"`/`"incremental"`).
  - `async run_sync<F, Fut>(pool, fetch_page, force_full: bool) -> Result<SyncResult, LinearError>` where `fetch_page(after: Option<String>, since: Option<String>) -> Fut`, `Fut: Future<Output = Result<IssuesPage, LinearError>>`. (The injected fetcher decouples tests from the network; the command layer passes a closure over `LinearClient::issues_page`.)
  - `LOOKBACK_SECS: i64 = 300`.
  - `pub fn lookback_cursor(cursor: &str) -> String` — subtract 5 minutes from an ISO-8601 timestamp (string-safe; see impl).

- [ ] **Step 1: Write the sync tests** (`src-tauri/src/linear/sync.rs`, `#[cfg(test)]`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{init_pool, issues::{get_sync_cursor, load_issue, set_sync_cursor}};
    use crate::linear::issues::{IssuesPage, ParsedIssue, ParsedLabel};
    use std::sync::{Arc, Mutex};

    fn issue(id: &str, updated: &str) -> ParsedIssue {
        ParsedIssue {
            id: id.into(), identifier: format!("ENG-{id}"), title: "T".into(), description: None,
            due_date: Some("2026-06-10".into()), priority: 0, url: "u".into(),
            state_id: Some("s".into()), state_name: Some("Todo".into()),
            state_type: Some("unstarted".into()), state_color: Some("#fff".into()),
            assignee_id: Some("me".into()), assignee_name: Some("Me".into()),
            team_id: Some("t".into()), team_key: Some("ENG".into()),
            project_id: None, project_name: None, parent_id: None,
            created_at: "c".into(), updated_at: updated.into(), archived_at: None,
            labels: vec![ParsedLabel { id: "l1".into(), name: Some("bug".into()), color: None }],
            raw_json: "{}".into(),
        }
    }

    // Build a fetcher that returns pre-seeded pages and records the (after, since) args.
    fn pager(pages: Vec<IssuesPage>) -> (impl Fn(Option<String>, Option<String>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<IssuesPage, crate::linear::LinearError>> + Send>>, Arc<Mutex<Vec<(Option<String>, Option<String>)>>>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let pages = Arc::new(Mutex::new(pages.into_iter()));
        let c2 = calls.clone();
        let f = move |after: Option<String>, since: Option<String>| {
            c2.lock().unwrap().push((after, since));
            let next = pages.lock().unwrap().next();
            Box::pin(async move { Ok(next.expect("ran out of pages")) }) as _
        };
        (f, calls)
    }

    #[tokio::test]
    async fn full_sync_pages_and_sets_cursor_after_commit() {
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();
        let (f, calls) = pager(vec![
            IssuesPage { issues: vec![issue("1","2026-06-01T00:00:00Z")], has_next: true, end_cursor: Some("C1".into()) },
            IssuesPage { issues: vec![issue("2","2026-06-03T00:00:00Z")], has_next: false, end_cursor: None },
        ]);
        let res = run_sync(&p, f, false).await.unwrap();
        assert_eq!(res.mode, SyncMode::Full);
        assert_eq!(res.synced, 2);
        assert!(load_issue(&p, "1").await.unwrap().is_some());
        assert_eq!(get_sync_cursor(&p).await.unwrap(), Some("2026-06-03T00:00:00Z".into()));
        // first call has no cursor (after=None, since=None); second pages with endCursor.
        let c = calls.lock().unwrap();
        assert_eq!(c[0], (None, None));
        assert_eq!(c[1].0, Some("C1".into()));
    }

    #[tokio::test]
    async fn incremental_uses_lookback_window() {
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();
        set_sync_cursor(&p, "2026-06-10T12:00:00Z").await.unwrap();
        let (f, calls) = pager(vec![
            IssuesPage { issues: vec![issue("9","2026-06-10T12:30:00Z")], has_next: false, end_cursor: None },
        ]);
        let res = run_sync(&p, f, false).await.unwrap();
        assert_eq!(res.mode, SyncMode::Incremental);
        // since = cursor - 5 min
        assert_eq!(calls.lock().unwrap()[0].1, Some("2026-06-10T11:55:00Z".into()));
        assert_eq!(get_sync_cursor(&p).await.unwrap(), Some("2026-06-10T12:30:00Z".into()));
    }

    #[tokio::test]
    async fn force_full_ignores_existing_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();
        set_sync_cursor(&p, "2026-06-10T12:00:00Z").await.unwrap();
        let (f, _calls) = pager(vec![
            IssuesPage { issues: vec![issue("1","2026-06-01T00:00:00Z")], has_next: false, end_cursor: None },
        ]);
        let res = run_sync(&p, f, true).await.unwrap();
        assert_eq!(res.mode, SyncMode::Full);
    }
}
```

> Each test builds its own pool inline via `init_pool(&dir.path().join("a/t.db"))` (kept explicit so the `create_dir_all` path is exercised).

- [ ] **Step 2: Add the `time` dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`:
```toml
time = { version = "0.3", features = ["parsing", "formatting"] }
```
(`parsing` for `OffsetDateTime::parse(.., &Rfc3339)`; `std`/`now_utc` are on by default.)

- [ ] **Step 3: Implement `src-tauri/src/linear/sync.rs`**

```rust
use crate::db::issues::{self, IssueRecord, LabelRecord};
use crate::linear::issues::{IssuesPage, ParsedIssue};
use crate::linear::LinearError;
use sqlx::SqlitePool;
use std::future::Future;

pub const LOOKBACK_SECS: i64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncMode { Full, Incremental }

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult { pub mode: SyncMode, pub synced: usize }

fn to_record(i: ParsedIssue) -> (IssueRecord, Vec<LabelRecord>) {
    let labels = i.labels.iter().map(|l| LabelRecord {
        label_id: l.id.clone(), name: l.name.clone(), color: l.color.clone(),
    }).collect();
    let rec = IssueRecord {
        id: i.id, identifier: i.identifier, title: i.title, description: i.description,
        due_date: i.due_date, priority: i.priority, url: i.url, state_id: i.state_id,
        state_name: i.state_name, state_type: i.state_type, state_color: i.state_color,
        assignee_id: i.assignee_id, assignee_name: i.assignee_name, team_id: i.team_id,
        team_key: i.team_key, project_id: i.project_id, project_name: i.project_name,
        parent_id: i.parent_id, created_at: i.created_at, updated_at: i.updated_at,
        archived_at: i.archived_at, raw_json: i.raw_json,
    };
    (rec, labels)
}

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

fn fmt_utc_secs(dt: OffsetDateTime) -> String {
    let u = dt.to_offset(time::UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        u.year(), u8::from(u.month()), u.day(), u.hour(), u.minute(), u.second(),
    )
}

/// Subtract LOOKBACK_SECS from an RFC3339 timestamp (handles fractional seconds
/// and any offset). On a parse failure, returns the input unchanged (safe
/// over-fetch, never an under-fetch).
pub fn lookback_cursor(cursor: &str) -> String {
    match OffsetDateTime::parse(cursor, &Rfc3339) {
        Ok(dt) => fmt_utc_secs(dt - time::Duration::seconds(LOOKBACK_SECS)),
        Err(_) => cursor.to_string(),
    }
}

/// Current UTC time as second-precision RFC3339 — the baseline cursor for an
/// empty workspace, so we don't full-sync forever.
fn now_rfc3339() -> String {
    fmt_utc_secs(OffsetDateTime::now_utc())
}

/// Run a sync. `force_full` (Resync) or an absent cursor => full; else incremental
/// with a lookback window. The cursor is advanced only after every page commits.
pub async fn run_sync<F, Fut>(
    pool: &SqlitePool,
    fetch_page: F,
    force_full: bool,
) -> Result<SyncResult, LinearError>
where
    F: Fn(Option<String>, Option<String>) -> Fut,
    Fut: Future<Output = Result<IssuesPage, LinearError>>,
{
    let cursor = issues::get_sync_cursor(pool).await.map_err(|_| LinearError::Malformed)?;
    let (mode, since) = match (force_full, cursor.as_deref()) {
        (false, Some(c)) => (SyncMode::Incremental, Some(lookback_cursor(c))),
        _ => (SyncMode::Full, None),
    };

    let mut after: Option<String> = None;
    let mut synced = 0usize;
    // Full sync builds a fresh baseline from scratch; incremental keeps the prior
    // cursor as the floor so a zero-result run doesn't lose the watermark.
    let mut max_updated: Option<String> = match mode {
        SyncMode::Full => None,
        SyncMode::Incremental => cursor.clone(),
    };

    loop {
        let page = fetch_page(after.clone(), since.clone()).await?;
        let mut tx = pool.begin().await.map_err(|_| LinearError::Malformed)?;
        for parsed in page.issues {
            let updated = parsed.updated_at.clone();
            let (rec, labels) = to_record(parsed);
            let applied = issues::upsert_issue(&mut tx, &rec).await.map_err(|_| LinearError::Malformed)?;
            if applied {
                issues::replace_labels(&mut tx, &rec.id, &labels).await.map_err(|_| LinearError::Malformed)?;
            }
            synced += 1;
            if max_updated.as_deref().map_or(true, |m| updated.as_str() > m) {
                max_updated = Some(updated);
            }
        }
        tx.commit().await.map_err(|_| LinearError::Malformed)?;
        if page.has_next {
            // hasNextPage with no cursor is a broken response — fail rather than
            // commit an incomplete baseline.
            after = Some(page.end_cursor.ok_or(LinearError::Malformed)?);
        } else {
            break;
        }
    }

    // Advance the cursor only after all pages are durably committed. An empty
    // full sync still records a baseline (now) so we don't full-sync forever.
    let new_cursor = match max_updated {
        Some(m) => m,
        None => now_rfc3339(),
    };
    issues::set_sync_cursor(pool, &new_cursor).await.map_err(|_| LinearError::Malformed)?;
    Ok(SyncResult { mode, synced })
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml linear::sync`
Expected: the three sync tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/linear/sync.rs
git commit -m "feat(m1): full + incremental sync with lookback window and gated labels"
```

---

### Task 4: AppState (lock + generation) + credential commands rework

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (AppState fields; `CmdError::WorkspaceChanged`; rework `set`/`clear`/`test` logic for wipe + identity-compare + generation bump; update their tests)
- Modify: `src-tauri/src/lib.rs` (construct the new `AppState` fields)

**Interfaces:**
- Consumes: `db::{wipe_workspace_cache, save_identity, load_org_id}`, `linear::issues::OrgIdentity`.
- Produces:
  - `AppState { pool, secret_store, credentials, linear, workspace_lock: tokio::sync::Mutex<()>, workspace_generation: AtomicU64 }`
  - `CmdError::WorkspaceChanged`
  - `async set_linear_key_logic(store, pool, generation: &AtomicU64, key) -> Result<(), CmdError>`
  - `async clear_linear_key_logic(store, pool, generation: &AtomicU64) -> Result<(), CmdError>`
  - `async test_connection_logic(creds, pool, generation, fetch_identity) -> Result<ConnectionStatus, CmdError>` where `fetch_identity: FnOnce(String) -> Fut`, `Fut: Future<Output = Result<OrgIdentity, LinearError>>`.

- [ ] **Step 1: Update `AppState` + `CmdError` + imports**

In `src-tauri/src/commands/mod.rs`, add imports and fields:

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use crate::linear::issues::OrgIdentity;
```

Replace the `op_lock` field. The struct becomes:

```rust
pub struct AppState {
    pub pool: SqlitePool,
    pub secret_store: Arc<dyn SecretStore>,
    pub credentials: Arc<dyn LinearCredentialProvider>,
    pub linear: LinearClient,
    /// Serializes credential mutations and bulk sync (set/clear/test/sync).
    pub workspace_lock: tokio::sync::Mutex<()>,
    /// Bumped by every cache wipe; guards `update_issue`'s late write.
    pub workspace_generation: AtomicU64,
    /// Epoch-seconds deadline before which sync is suppressed after a 429 (0 = none).
    pub rate_limited_until: AtomicU64,
}
```

Add a `CmdError` variant:

```rust
    #[error("Workspace changed; please retry.")]
    WorkspaceChanged,
```

Update the M0 `From<LinearError> for CmdError` match arm for the new payload-carrying variant:

```rust
    LinearError::RateLimited(_) => CmdError::RateLimited,
```

- [ ] **Step 2: Rework the set/clear/test logic** (replace the M0 bodies)

```rust
pub async fn set_linear_key_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    key: String,
) -> Result<(), CmdError> {
    // Wipe + bump FIRST so a later keyring failure can only leave an empty cache
    // (safe), never the new key paired with the old workspace's data.
    db::issues::wipe_workspace_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(LINEAR_KEY_ACCOUNT, &key))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_linear_key_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    // Wipe + bump first; a failed delete then leaves an empty cache, which is safe.
    db::issues::wipe_workspace_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(LINEAR_KEY_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn test_connection_logic<F, Fut>(
    credentials: Arc<dyn LinearCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    fetch_identity: F,
) -> Result<ConnectionStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<OrgIdentity, LinearError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    let id = fetch_identity(auth).await?;
    // Compare BEFORE overwriting: a swapped key pointing at a different org wipes first.
    if let Some(cached) = db::load_org_id(pool).await.map_err(|_| CmdError::Internal)? {
        if cached != id.org_id {
            db::issues::wipe_workspace_cache(pool).await.map_err(|_| CmdError::Internal)?;
            generation.fetch_add(1, Ordering::SeqCst);
        }
    }
    db::save_identity(pool, &id.viewer_id, &id.viewer_name, &id.org_id, &id.org_name, &id.org_url_key)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(ConnectionStatus::Connected { name: id.viewer_name })
}
```

- [ ] **Step 3: Update the command wrappers** (acquire `workspace_lock`, pass generation)

```rust
#[tauri::command]
pub async fn set_linear_key(state: State<'_, AppState>, key: String) -> Result<(), CmdError> {
    let _g = state.workspace_lock.lock().await;
    set_linear_key_logic(state.secret_store.clone(), &state.pool, &state.workspace_generation, key).await
}

#[tauri::command]
pub async fn clear_linear_key(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.workspace_lock.lock().await;
    clear_linear_key_logic(state.secret_store.clone(), &state.pool, &state.workspace_generation).await
}

#[tauri::command]
pub async fn test_linear_connection(state: State<'_, AppState>) -> Result<ConnectionStatus, CmdError> {
    let _g = state.workspace_lock.lock().await;
    let client = state.linear.clone();
    test_connection_logic(
        state.credentials.clone(),
        &state.pool,
        &state.workspace_generation,
        move |auth| async move { client.viewer_with_org(&auth).await },
    )
    .await
}
```

`get_connection_status` is unchanged (reads `has_key` + cached name).

- [ ] **Step 4: Update the existing command tests for the new signatures**

In `commands/mod.rs` `logic_tests`, thread an `AtomicU64` and switch the fetcher to `OrgIdentity`. Replace the affected tests:

```rust
fn gen0() -> AtomicU64 { AtomicU64::new(0) }

fn org(id: &str) -> OrgIdentity {
    OrgIdentity {
        viewer_id: "v1".into(), viewer_name: "Abrar".into(),
        org_id: id.into(), org_name: "GAM".into(), org_url_key: "gam".into(),
    }
}

#[tokio::test]
async fn saving_key_wipes_and_bumps_generation() {
    let (_dir, pool) = temp_pool().await;
    let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
    db::save_identity(&pool, "v0", "Old", "org0", "Old", "old").await.unwrap();
    let g = gen0();
    set_linear_key_logic(store.clone(), &pool, &g, "lin_xyz".into()).await.unwrap();
    assert_eq!(g.load(Ordering::SeqCst), 1);
    assert_eq!(db::load_org_id(&pool).await.unwrap(), None); // identity wiped
    let status = get_status_logic(store, &pool).await.unwrap();
    assert_eq!(status, ConnectionStatus::Unverified);
}

#[tokio::test]
async fn clearing_key_wipes_and_bumps() {
    let (_dir, pool) = temp_pool().await;
    let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
    store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
    let g = gen0();
    clear_linear_key_logic(store.clone(), &pool, &g).await.unwrap();
    assert_eq!(g.load(Ordering::SeqCst), 1);
    assert_eq!(store.get(LINEAR_KEY_ACCOUNT).unwrap(), None);
}

#[tokio::test]
async fn test_connection_same_org_keeps_cache_and_saves_identity() {
    let (_dir, pool) = temp_pool().await;
    let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
    store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
    db::save_identity(&pool, "v1", "Abrar", "orgA", "GAM", "gam").await.unwrap();
    let creds: Arc<dyn LinearCredentialProvider> =
        Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
    let g = AtomicU64::new(5);
    let status = test_connection_logic(creds, &pool, &g, |_a| async { Ok(org("orgA")) }).await.unwrap();
    assert_eq!(status, ConnectionStatus::Connected { name: "Abrar".into() });
    assert_eq!(g.load(Ordering::SeqCst), 5); // same org -> no wipe -> no bump
}

#[tokio::test]
async fn test_connection_different_org_wipes_and_bumps() {
    let (_dir, pool) = temp_pool().await;
    let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
    store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
    db::save_identity(&pool, "v1", "Abrar", "orgA", "GAM", "gam").await.unwrap();
    let creds: Arc<dyn LinearCredentialProvider> =
        Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
    let g = AtomicU64::new(0);
    test_connection_logic(creds, &pool, &g, |_a| async { Ok(org("orgB")) }).await.unwrap();
    assert_eq!(g.load(Ordering::SeqCst), 1); // mismatch -> wipe -> bump
    assert_eq!(db::load_org_id(&pool).await.unwrap(), Some("orgB".into())); // new identity saved
}
```

Delete the old M0 tests that referenced the previous signatures (`saving_key_reports_unverified`, `replacing_key_invalidates_cached_identity`, `clearing_key_removes_key_and_identity`, `test_connection_persists_viewer_name`, `failed_test_leaves_cache_unchanged`, `test_connection_without_key_is_not_configured`) — they are superseded by the above plus the Task 5 tests. Keep `no_key_reports_not_configured` and `cached_identity_reports_connected` (still valid for `get_status_logic`).

- [ ] **Step 5: Update `lib.rs` AppState construction**

In `src-tauri/src/lib.rs`, replace the `app.manage(AppState { ... })` block:

```rust
app.manage(AppState {
    pool,
    secret_store: store,
    credentials,
    linear,
    workspace_lock: tokio::sync::Mutex::new(()),
    workspace_generation: std::sync::atomic::AtomicU64::new(0),
    rate_limited_until: std::sync::atomic::AtomicU64::new(0),
});
```

- [ ] **Step 6: Run tests + clippy**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass (db, linear, sync, commands).
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(m1): workspace_lock + generation; wipe + identity-compare on key change"
```

---

### Task 5: M1 data commands (sync, lists, detail, update, me) + registration

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (new logic fns + `#[tauri::command]` wrappers + result types)
- Modify: `src-tauri/src/lib.rs` (register the new commands)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces commands: `sync_issues({ full?: bool }) -> SyncResult`, `list_calendar_issues({start,end,team_id?,assignee_id?,project_id?}) -> Vec<CalendarIssue>`, `list_unscheduled({...}) -> Vec<CalendarIssue>`, `list_filter_options() -> FilterOptions`, `get_issue_detail({id}) -> IssueDetailResult`, `update_issue({id, patch}) -> Issue`, `list_users() -> Vec<ParsedUser>`, `get_me() -> Option<Me>`.
- Produces types: `IssueDetailResult` (tagged `live`/`cache`), `LiveDetail`, `Me { viewer_id, viewer_name }`.

- [ ] **Step 1: Add result types + mapping helpers** (`commands/mod.rs`)

```rust
use crate::db::issues::{self, CalendarIssue, FilterOptions, Issue, IssueRecord, LabelRecord};
use crate::linear::issues::{
    DetailChild, DetailComment, DetailCycle, DetailRef, DetailRelation, DetailState, IssueDetailNode,
    ParsedIssue, ParsedUser, UpdateIssuePatch, patch_to_input,
};
use crate::linear::sync::{run_sync, SyncResult};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelOut { pub id: String, pub name: Option<String>, pub color: Option<String> }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDetail {
    #[serde(flatten)] pub issue: Issue,
    pub labels: Vec<LabelOut>,
    pub team_states: Vec<DetailState>,
    pub cycle: Option<DetailCycle>,
    pub parent: Option<DetailRef>,
    pub children: Vec<DetailChild>,
    pub relations: Vec<DetailRelation>,
    pub comments: Vec<DetailComment>,
    pub has_more_children: bool,
    pub has_more_relations: bool,
    pub has_more_comments: bool,
}

#[derive(serde::Serialize)]
#[serde(tag = "source", rename_all = "lowercase")]
pub enum IssueDetailResult {
    Live { detail: LiveDetail },
    Cache { detail: Issue },
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me { pub viewer_id: String, pub viewer_name: String }

/// Map a parsed wire issue to the cached read-shape (used after issueUpdate).
fn parsed_to_issue(p: &ParsedIssue) -> Issue {
    Issue {
        id: p.id.clone(), identifier: p.identifier.clone(), title: p.title.clone(),
        description: p.description.clone(), due_date: p.due_date.clone(), priority: p.priority,
        url: p.url.clone(), state_id: p.state_id.clone(), state_name: p.state_name.clone(),
        state_type: p.state_type.clone().unwrap_or_default(),
        state_color: p.state_color.clone().unwrap_or_default(),
        assignee_id: p.assignee_id.clone(), assignee_name: p.assignee_name.clone(),
        team_id: p.team_id.clone(), team_key: p.team_key.clone(),
        project_id: p.project_id.clone(), project_name: p.project_name.clone(),
        parent_id: p.parent_id.clone(), created_at: p.created_at.clone(), updated_at: p.updated_at.clone(),
    }
}

fn parsed_to_record(p: ParsedIssue) -> (IssueRecord, Vec<LabelRecord>) {
    crate::linear::sync::to_record(p) // make to_record pub in sync.rs
}
```

> In `linear/sync.rs`, change `fn to_record` to `pub fn to_record`.

- [ ] **Step 2: Write the data-command logic fns**

```rust
fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// On a rate-limit error, arm the backoff deadline (default 60s) before mapping
/// to CmdError so the next sync within the window is suppressed.
fn arm_backoff(e: LinearError, rate_limited_until: &AtomicU64) -> CmdError {
    if let LinearError::RateLimited(secs) = e {
        let wait = secs.unwrap_or(60).max(0) as u64;
        rate_limited_until.store(now_epoch() + wait, Ordering::SeqCst);
    }
    CmdError::from(e)
}

pub async fn sync_issues_logic(
    creds: Arc<dyn LinearCredentialProvider>,
    linear: LinearClient,
    pool: &SqlitePool,
    generation: &AtomicU64,
    rate_limited_until: &AtomicU64,
    full: bool,
) -> Result<SyncResult, CmdError> {
    // Suppress network sync while inside a rate-limit window. A background poll
    // (full=false) reports a silent no-op; an explicit Resync (full=true) surfaces
    // the rate limit instead of a misleading "Resynced 0 issues".
    if now_epoch() < rate_limited_until.load(Ordering::SeqCst) {
        if full {
            return Err(CmdError::RateLimited);
        }
        return Ok(SyncResult { mode: SyncMode::Incremental, synced: 0 });
    }

    let c = creds.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await.map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;

    // Validate org identity; wipe on mismatch (or honor an explicit full Resync).
    let id = match linear.viewer_with_org(&auth).await {
        Ok(id) => id,
        Err(e) => return Err(arm_backoff(e, rate_limited_until)),
    };
    let mut force_full = full;
    let cached = db::load_org_id(pool).await.map_err(|_| CmdError::Internal)?;
    let mismatch = cached.as_deref().map(|c| c != id.org_id).unwrap_or(false);
    if full || mismatch {
        db::issues::wipe_workspace_cache(pool).await.map_err(|_| CmdError::Internal)?;
        generation.fetch_add(1, Ordering::SeqCst);
        force_full = true;
    }
    if mismatch || cached.is_none() || full {
        db::save_identity(pool, &id.viewer_id, &id.viewer_name, &id.org_id, &id.org_name, &id.org_url_key)
            .await.map_err(|_| CmdError::Internal)?;
    }

    let client = linear.clone();
    let auth2 = auth.clone();
    run_sync(pool, move |after, since| {
        let client = client.clone();
        let auth = auth2.clone();
        async move { client.issues_page(&auth, after.as_deref(), since.as_deref()).await }
    }, force_full)
    .await
    .map_err(|e| arm_backoff(e, rate_limited_until))
}

pub async fn get_issue_detail_logic(
    creds: Arc<dyn LinearCredentialProvider>,
    linear: LinearClient,
    pool: &SqlitePool,
    id: String,
) -> Result<IssueDetailResult, CmdError> {
    let c = creds.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await.map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    if let Some(auth) = auth {
        match linear.issue_detail(&auth, &id).await {
            Ok(node) => return Ok(IssueDetailResult::Live { detail: node_to_live(node) }),
            Err(_) => { /* fall through to cache */ }
        }
    }
    match db::issues::load_issue(pool, &id).await.map_err(|_| CmdError::Internal)? {
        Some(issue) => Ok(IssueDetailResult::Cache { detail: issue }),
        None => Err(CmdError::Network), // offline + not cached
    }
}

fn node_to_live(n: IssueDetailNode) -> LiveDetail {
    let labels = n.issue.labels.iter().map(|l| LabelOut {
        id: l.id.clone(), name: l.name.clone(), color: l.color.clone(),
    }).collect();
    LiveDetail {
        issue: parsed_to_issue(&n.issue),
        labels,
        team_states: n.team_states,
        cycle: n.cycle,
        parent: n.parent,
        children: n.children,
        relations: n.relations,
        comments: n.comments,
        has_more_children: n.has_more_children,
        has_more_relations: n.has_more_relations,
        has_more_comments: n.has_more_comments,
    }
}

pub async fn update_issue_logic<F, Fut>(
    pool: &SqlitePool,
    lock: &tokio::sync::Mutex<()>,
    generation: &AtomicU64,
    creds: Arc<dyn LinearCredentialProvider>,
    do_update: F,
) -> Result<Issue, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<ParsedIssue, LinearError>>,
{
    // (1) snapshot generation + credential under the lock
    let (gen, auth) = {
        let _g = lock.lock().await;
        let gen = generation.load(Ordering::SeqCst);
        let c = creds.clone();
        let auth = tokio::task::spawn_blocking(move || c.authorization())
            .await.map_err(|_| CmdError::Internal)?
            .map_err(|_| CmdError::SecretStore)?
            .ok_or(CmdError::NotConfigured)?;
        (gen, auth)
    };
    // (2) network mutation, no lock held
    let parsed = do_update(auth).await?;
    // (3) recheck + write under the lock
    let _g = lock.lock().await;
    if generation.load(Ordering::SeqCst) != gen {
        return Err(CmdError::WorkspaceChanged);
    }
    let id = parsed.id.clone();
    let (rec, labels) = parsed_to_record(parsed);
    let mut tx = pool.begin().await.map_err(|_| CmdError::Internal)?;
    let applied = issues::upsert_issue(&mut tx, &rec).await.map_err(|_| CmdError::Internal)?;
    if applied {
        issues::replace_labels(&mut tx, &rec.id, &labels).await.map_err(|_| CmdError::Internal)?;
    }
    tx.commit().await.map_err(|_| CmdError::Internal)?;
    issues::load_issue(pool, &id).await.map_err(|_| CmdError::Internal)?.ok_or(CmdError::Internal)
}
```

- [ ] **Step 3: Write the command wrappers + remaining logic**

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarArgs {
    pub start: String, pub end: String,
    pub team_id: Option<String>, pub assignee_id: Option<String>, pub project_id: Option<String>,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnscheduledArgs {
    pub team_id: Option<String>, pub assignee_id: Option<String>, pub project_id: Option<String>,
}

#[tauri::command]
pub async fn sync_issues(state: State<'_, AppState>, full: Option<bool>) -> Result<SyncResult, CmdError> {
    let _g = state.workspace_lock.lock().await;
    sync_issues_logic(
        state.credentials.clone(), state.linear.clone(), &state.pool,
        &state.workspace_generation, &state.rate_limited_until, full.unwrap_or(false),
    ).await
}

#[tauri::command]
pub async fn list_calendar_issues(state: State<'_, AppState>, args: CalendarArgs) -> Result<Vec<CalendarIssue>, CmdError> {
    db::issues::load_issues_in_range(&state.pool, &args.start, &args.end, args.team_id, args.assignee_id, args.project_id)
        .await.map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn list_unscheduled(state: State<'_, AppState>, args: UnscheduledArgs) -> Result<Vec<CalendarIssue>, CmdError> {
    db::issues::load_unscheduled(&state.pool, args.team_id, args.assignee_id, args.project_id)
        .await.map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn list_filter_options(state: State<'_, AppState>) -> Result<FilterOptions, CmdError> {
    db::issues::list_filter_options(&state.pool).await.map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn get_issue_detail(state: State<'_, AppState>, id: String) -> Result<IssueDetailResult, CmdError> {
    get_issue_detail_logic(state.credentials.clone(), state.linear.clone(), &state.pool, id).await
}

#[tauri::command]
pub async fn update_issue(state: State<'_, AppState>, id: String, patch: UpdateIssuePatch) -> Result<Issue, CmdError> {
    let input = patch_to_input(&patch);
    let client = state.linear.clone();
    let id2 = id.clone();
    update_issue_logic(
        &state.pool, &state.workspace_lock, &state.workspace_generation, state.credentials.clone(),
        move |auth| async move { client.update_issue(&auth, &id2, &input).await },
    ).await
}

#[tauri::command]
pub async fn list_users(state: State<'_, AppState>) -> Result<Vec<ParsedUser>, CmdError> {
    let c = state.credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await.map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    state.linear.users(&auth).await.map_err(CmdError::from)
}

#[tauri::command]
pub async fn get_me(state: State<'_, AppState>) -> Result<Option<Me>, CmdError> {
    Ok(db::load_me(&state.pool).await.map_err(|_| CmdError::Internal)?
        .map(|(viewer_id, viewer_name)| Me { viewer_id, viewer_name }))
}
```

- [ ] **Step 4: Write tests for `update_issue_logic` (generation guard)** (`commands/mod.rs` `logic_tests`)

```rust
fn parsed(id: &str, due: Option<&str>, updated: &str) -> ParsedIssue {
    ParsedIssue {
        id: id.into(), identifier: format!("ENG-{id}"), title: "T".into(), description: None,
        due_date: due.map(Into::into), priority: 0, url: "u".into(),
        state_id: Some("s".into()), state_name: Some("Todo".into()),
        state_type: Some("unstarted".into()), state_color: Some("#fff".into()),
        assignee_id: Some("me".into()), assignee_name: Some("Me".into()),
        team_id: Some("t".into()), team_key: Some("ENG".into()), project_id: None, project_name: None,
        parent_id: None, created_at: "c".into(), updated_at: updated.into(), archived_at: None,
        labels: vec![], raw_json: "{}".into(),
    }
}

#[tokio::test]
async fn update_issue_persists_when_generation_unchanged() {
    let (_dir, pool) = temp_pool().await;
    let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
    store.set(LINEAR_KEY_ACCOUNT, "lin").unwrap();
    let creds: Arc<dyn LinearCredentialProvider> =
        Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
    let lock = tokio::sync::Mutex::new(());
    let g = AtomicU64::new(0);
    let issue = update_issue_logic(&pool, &lock, &g, creds, |_auth| async {
        Ok(parsed("1", Some("2026-06-20"), "2026-06-19T00:00:00Z"))
    }).await.unwrap();
    assert_eq!(issue.due_date.as_deref(), Some("2026-06-20"));
    assert_eq!(db::issues::load_issue(&pool, "1").await.unwrap().unwrap().due_date.as_deref(), Some("2026-06-20"));
}

#[tokio::test]
async fn update_issue_discards_write_when_generation_changes() {
    let (_dir, pool) = temp_pool().await;
    let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
    store.set(LINEAR_KEY_ACCOUNT, "lin").unwrap();
    let creds: Arc<dyn LinearCredentialProvider> =
        Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
    let lock = tokio::sync::Mutex::new(());
    let g = AtomicU64::new(0);
    // Simulate a key change landing during the network mutation by bumping inside the fetcher.
    let res = update_issue_logic(&pool, &lock, &g, creds, |_auth| async {
        g.fetch_add(1, Ordering::SeqCst);
        Ok(parsed("1", Some("2026-06-20"), "2026-06-19T00:00:00Z"))
    }).await;
    assert!(matches!(res, Err(CmdError::WorkspaceChanged)));
    assert!(db::issues::load_issue(&pool, "1").await.unwrap().is_none()); // no write
}
```

> Note: the closure borrows `&g`; declare the closure `move` is not needed since `g` outlives the await. If the borrow checker complains, capture a `&AtomicU64` reference explicitly via a helper variable `let gref = &g;` used inside.

- [ ] **Step 5: Register the commands in `lib.rs`**

Extend `tauri::generate_handler![ ... ]` with the new commands:

```rust
.invoke_handler(tauri::generate_handler![
    commands::set_linear_key,
    commands::clear_linear_key,
    commands::get_connection_status,
    commands::test_linear_connection,
    commands::sync_issues,
    commands::list_calendar_issues,
    commands::list_unscheduled,
    commands::list_filter_options,
    commands::get_issue_detail,
    commands::update_issue,
    commands::list_users,
    commands::get_me
])
```

Add the window permissions if needed (the default capability already allows `core:default`; custom commands need no extra capability entry in Tauri v2 invoke).

- [ ] **Step 6: Run the full suite + clippy + fmt**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` → clean.
Run: `cargo fmt --manifest-path src-tauri/Cargo.toml` (apply), then `-- --check` → clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/linear/sync.rs
git commit -m "feat(m1): sync/list/detail/update/me commands with lock-bracketed update_issue"
```

---

## Phase B — Frontend foundation

### Task 6: Dependencies, Vitest wiring, and typed command bindings

**Files:**
- Modify: `package.json` (deps + `test` script), create `vitest.config.ts`, `src/test/setup.ts`
- Modify: `src/lib/commands.ts` (M1 types + bindings)

**Interfaces:**
- Produces: all M1 TS types (`CalendarIssue`, `Issue`, `LiveDetail`, `IssueDetailResult`, `FilterOptions`, `User`, `Me`, `SyncResult`, `UpdateIssuePatch`) and binding functions, used by every later frontend task.

- [ ] **Step 1: Install dependencies**

```bash
npm install @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction react-router-dom react-markdown remark-gfm
npm install -D vitest
```
Expected: installs succeed; `react-router-dom` v6+, FullCalendar v6+ (all MIT).

- [ ] **Step 2: Add the `test` script + Vitest config**

In `package.json` `scripts`, add: `"test": "vitest run --passWithNoTests"` (the `--passWithNoTests` flag lets this task's empty run exit 0; real tests arrive in Task 7).

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```
(Pure-logic tests run in `node`; no jsdom needed since RTL is deferred.)

- [ ] **Step 3: Add the typed bindings + types** (append to `src/lib/commands.ts`, keep existing M0 exports + `errorText`)

```ts
export type CalendarIssue = {
  id: string;
  identifier: string;
  title: string;
  dueDate: string | null;
  priority: number;
  stateType: string;
  stateColor: string;
  assigneeId: string | null;
  teamId: string | null;
  teamKey: string | null;
  projectId: string | null;
};

export type Issue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: number;
  url: string;
  stateId: string | null;
  stateName: string | null;
  stateType: string;
  stateColor: string;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  teamKey: string | null;
  projectId: string | null;
  projectName: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Label = { id: string; name: string | null; color: string | null };
export type DetailState = { id: string; name: string; type: string; color: string };
export type DetailCycle = { id: string; number: number | null; name: string | null };
export type DetailRef = { id: string; identifier: string; title: string };
export type DetailChild = { id: string; identifier: string; title: string; stateType: string };
export type DetailRelation = { type: string; issue: DetailRef };
export type DetailComment = { id: string; body: string; userName: string | null; createdAt: string };

export type LiveDetail = Issue & {
  labels: Label[];
  teamStates: DetailState[];
  cycle: DetailCycle | null;
  parent: DetailRef | null;
  children: DetailChild[];
  relations: DetailRelation[];
  comments: DetailComment[];
  hasMoreChildren: boolean;
  hasMoreRelations: boolean;
  hasMoreComments: boolean;
};

// "preview" is frontend-only (placeholder); the command returns "live" | "cache".
export type IssueDetailResult =
  | { source: "preview"; detail: CalendarIssue }
  | { source: "cache"; detail: Issue }
  | { source: "live"; detail: LiveDetail };

export type FilterOptions = {
  teams: { id: string; key: string }[];
  projects: { id: string; name: string }[];
};
export type User = { id: string; name: string };
export type Me = { viewerId: string; viewerName: string };
export type SyncResult = { mode: "full" | "incremental"; synced: number };

export type IssueFilters = {
  teamId?: string;
  assigneeId?: string;
  projectId?: string;
};

export type UpdateIssuePatch = {
  title?: string;
  stateId?: string;
  priority?: number;
  dueDate?: string | null;
  assigneeId?: string | null;
  description?: string | null;
};

export const syncIssues = (full = false): Promise<SyncResult> =>
  invoke("sync_issues", { full });

export const listCalendarIssues = (
  args: { start: string; end: string } & IssueFilters,
): Promise<CalendarIssue[]> => invoke("list_calendar_issues", { args });

export const listUnscheduled = (args: IssueFilters): Promise<CalendarIssue[]> =>
  invoke("list_unscheduled", { args });

export const listFilterOptions = (): Promise<FilterOptions> =>
  invoke("list_filter_options");

export const getIssueDetail = (id: string): Promise<IssueDetailResult> =>
  invoke("get_issue_detail", { id });

export const updateIssue = (id: string, patch: UpdateIssuePatch): Promise<Issue> =>
  invoke("update_issue", { id, patch });

export const listUsers = (): Promise<User[]> => invoke("list_users");

export const getMe = (): Promise<Me | null> => invoke("get_me");
```

- [ ] **Step 4: Verify types compile + Vitest runs**

Run: `npx tsc --noEmit`
Expected: passes.
Run: `npm test`
Expected: "No test files found" (or 0 tests) — Vitest is wired (non-error exit).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test src/lib/commands.ts
git commit -m "feat(m1): frontend deps, vitest wiring, typed command bindings"
```

---

### Task 7: Pure date + optimistic helpers (Vitest)

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/dates.test.ts`
- Create: `src/lib/optimistic.ts`, `src/lib/optimistic.test.ts`

**Interfaces:**
- Produces: `dhakaToday(now?)`, `isOverdue(dueDate, stateType, today)`, `toDateStr(d)`, `rangeFromDates(start, end)`; `matchesFilters(i, f)`, `inRange(dueDate, start, end)`, `reconcileList(list, issue, belongs)`, `applyPatchToCalendarIssue(base, patch)`.

- [ ] **Step 1: Write `src/lib/dates.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { dhakaToday, isOverdue, toDateStr, rangeFromDates } from "./dates";

describe("dhakaToday", () => {
  it("rolls into the next day in Dhaka (UTC+6)", () => {
    // 2026-06-19 20:00Z == 2026-06-20 02:00 in Dhaka
    expect(dhakaToday(new Date("2026-06-19T20:00:00Z"))).toBe("2026-06-20");
  });
  it("stays same day before the Dhaka rollover", () => {
    expect(dhakaToday(new Date("2026-06-19T10:00:00Z"))).toBe("2026-06-19");
  });
});

describe("isOverdue", () => {
  const today = "2026-06-19";
  it("flags a past due date that is not done", () => {
    expect(isOverdue("2026-06-18", "started", today)).toBe(true);
  });
  it("does not flag completed/canceled", () => {
    expect(isOverdue("2026-06-18", "completed", today)).toBe(false);
    expect(isOverdue("2026-06-18", "canceled", today)).toBe(false);
  });
  it("does not flag today or future or null", () => {
    expect(isOverdue("2026-06-19", "started", today)).toBe(false);
    expect(isOverdue("2026-06-20", "started", today)).toBe(false);
    expect(isOverdue(null, "started", today)).toBe(false);
  });
});

describe("toDateStr / rangeFromDates", () => {
  it("formats a Date to YYYY-MM-DD using local parts", () => {
    expect(toDateStr(new Date(2026, 5, 9))).toBe("2026-06-09"); // month is 0-based
  });
  it("passes through FullCalendar's exclusive end", () => {
    const r = rangeFromDates(new Date(2026, 5, 1), new Date(2026, 6, 1));
    expect(r).toEqual({ start: "2026-06-01", end: "2026-07-01" });
  });
});
```

- [ ] **Step 2: Implement `src/lib/dates.ts`**

```ts
/** Today's calendar date in Asia/Dhaka as YYYY-MM-DD (en-CA yields that format). */
export function dhakaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Overdue = past due date on an issue that isn't completed/canceled. */
export function isOverdue(
  dueDate: string | null,
  stateType: string,
  today: string,
): boolean {
  if (!dueDate) return false;
  if (stateType === "completed" || stateType === "canceled") return false;
  return dueDate < today;
}

/** A Date's local calendar day as YYYY-MM-DD. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** FullCalendar's activeStart/activeEnd are already half-open (end exclusive). */
export function rangeFromDates(start: Date, end: Date): { start: string; end: string } {
  return { start: toDateStr(start), end: toDateStr(end) };
}
```

- [ ] **Step 3: Write `src/lib/optimistic.test.ts`**

These are the building blocks the (query-key-aware) optimistic update in Task 9 composes — they must be exact so a moved issue lands only in caches whose range *and* filters it actually matches.

```ts
import { describe, it, expect } from "vitest";
import { matchesFilters, inRange, reconcileList, applyPatchToCalendarIssue } from "./optimistic";
import type { CalendarIssue } from "./commands";

const mk = (id: string, dueDate: string | null, over: Partial<CalendarIssue> = {}): CalendarIssue => ({
  id, identifier: `ENG-${id}`, title: "T", dueDate, priority: 0,
  stateType: "unstarted", stateColor: "#fff", assigneeId: "me",
  teamId: "t1", teamKey: "ENG", projectId: "p1", ...over,
});

describe("matchesFilters", () => {
  it("matches when filter fields agree or are unset", () => {
    expect(matchesFilters(mk("1", null), {})).toBe(true);
    expect(matchesFilters(mk("1", null), { assigneeId: "me" })).toBe(true);
    expect(matchesFilters(mk("1", null), { assigneeId: "other" })).toBe(false);
    expect(matchesFilters(mk("1", null), { teamId: "t2" })).toBe(false);
    expect(matchesFilters(mk("1", null), { projectId: "p1" })).toBe(true);
  });
});

describe("inRange (half-open)", () => {
  it("includes start, excludes end, excludes null", () => {
    expect(inRange("2026-06-01", "2026-06-01", "2026-07-01")).toBe(true);
    expect(inRange("2026-07-01", "2026-06-01", "2026-07-01")).toBe(false);
    expect(inRange(null, "2026-06-01", "2026-07-01")).toBe(false);
  });
});

describe("reconcileList", () => {
  it("inserts when belongs, removes when not, updates in place", () => {
    const a = mk("1", "2026-06-10");
    expect(reconcileList([], a, true).map((i) => i.id)).toEqual(["1"]);
    expect(reconcileList([a], a, false)).toEqual([]);
    const moved = { ...a, dueDate: "2026-06-12" };
    const out = reconcileList([a], moved, true);
    expect(out).toHaveLength(1);
    expect(out[0].dueDate).toBe("2026-06-12");
  });
});

describe("applyPatchToCalendarIssue", () => {
  it("applies only the calendar-visible patch fields", () => {
    const out = applyPatchToCalendarIssue(mk("1", "2026-06-10"), { dueDate: null, priority: 2 });
    expect(out.dueDate).toBeNull();
    expect(out.priority).toBe(2);
    expect(out.title).toBe("T");
  });
});
```

- [ ] **Step 4: Implement `src/lib/optimistic.ts`**

```ts
import type { CalendarIssue, IssueFilters, UpdateIssuePatch } from "./commands";

/** Does this issue satisfy the (sparse) filter set? Unset filter fields match all. */
export function matchesFilters(i: CalendarIssue, f: IssueFilters): boolean {
  if (f.teamId && i.teamId !== f.teamId) return false;
  if (f.assigneeId && i.assigneeId !== f.assigneeId) return false;
  if (f.projectId && i.projectId !== f.projectId) return false;
  return true;
}

/** Half-open membership: [start, end), null never in range. */
export function inRange(dueDate: string | null, start: string, end: string): boolean {
  return dueDate !== null && dueDate >= start && dueDate < end;
}

/** Insert/update the issue when it belongs, else remove it. Pure, id-keyed. */
export function reconcileList(
  list: CalendarIssue[],
  issue: CalendarIssue,
  belongs: boolean,
): CalendarIssue[] {
  const without = list.filter((i) => i.id !== issue.id);
  return belongs ? [...without, issue] : without;
}

/** Apply only the CalendarIssue-visible fields of a patch onto a base issue. Pure. */
export function applyPatchToCalendarIssue(base: CalendarIssue, patch: UpdateIssuePatch): CalendarIssue {
  return {
    ...base,
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all `dates.test.ts` + `optimistic.test.ts` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts src/lib/optimistic.ts src/lib/optimistic.test.ts
git commit -m "feat(m1): pure date + optimistic helpers with vitest coverage"
```

---

### Task 8: App shell + routing (sidebar, header clock, Resync)

**Files:**
- Create: `src/components/AppShell.tsx`
- Modify: `src/App.tsx` (routes), `src/main.tsx` (HashRouter)
- Modify: `src/features/settings/Settings.tsx` (Resync button)
- Modify: `src/features/home/Home.tsx` → becomes the calendar host later; for this task render a placeholder.

**Interfaces:**
- Consumes: `DualClock` (M0), `syncIssues` (Task 6).
- Produces: `<AppShell/>` layout with `<Outlet/>`; routes `/` (calendar placeholder) and `/settings`.

- [ ] **Step 1: HashRouter in `src/main.tsx`**

Wrap the app in `HashRouter` (chosen over BrowserRouter because Tauri's asset protocol has no SPA path fallback):

```tsx
import { HashRouter } from "react-router-dom";
// inside the render tree, wrap <App/>:
//   <QueryClientProvider client={queryClient}>
//     <HashRouter>
//       <App />
//     </HashRouter>
//   </QueryClientProvider>
```
(Keep the existing `QueryClientProvider` and `import "./styles/index.css"`.)

- [ ] **Step 2: Routes in `src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import { AppShell } from "@/components/AppShell";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { Settings } from "@/features/settings/Settings";

function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<CalendarPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <GooeyToaster position="bottom-right" />
    </>
  );
}

export default App;
```

> `CalendarPage` is created in Task 10. For this task, create a temporary stub `src/features/calendar/CalendarPage.tsx` that renders `<div className="p-10 text-sm text-muted-foreground">Calendar (coming in Task 10)</div>` so the app compiles and routing is testable. Task 10 replaces its body.

- [ ] **Step 3: Implement `src/components/AppShell.tsx`**

```tsx
import { NavLink, Outlet } from "react-router-dom";
import { useSyncLoop } from "@/lib/queries";
import { DualClock } from "@/features/home/DualClock";
import { Button } from "@/components/ui/button";

const navItem = (active: boolean) =>
  `block rounded-md px-3 py-2 text-sm ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`;

export function AppShell() {
  const { isSyncing, refresh } = useSyncLoop();
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-56 flex-col gap-1 border-r p-3">
        <div className="px-3 py-2 text-lg font-semibold">Astryn</div>
        <nav className="flex flex-col gap-1">
          <NavLink to="/" className={({ isActive }) => navItem(isActive)} end>Calendar</NavLink>
          <NavLink to="/settings" className={({ isActive }) => navItem(isActive)}>Settings</NavLink>
          <span className={navItem(false) + " cursor-not-allowed opacity-40"}>Timeline · M2</span>
          <span className={navItem(false) + " cursor-not-allowed opacity-40"}>Standup · M3</span>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
          <DualClock />
          <Button variant="outline" size="sm" disabled={isSyncing} onClick={refresh}>
            {isSyncing ? "Syncing…" : "Refresh"}
          </Button>
        </header>
        <main className="min-w-0 flex-1"><Outlet /></main>
      </div>
    </div>
  );
}
```

> `useSyncLoop` is defined in Task 9. To keep this task self-contained, create `src/lib/queries.ts` now with exactly this temporary scaffold; Task 9 replaces the whole file with the real hooks:
>
> ```ts
> // src/lib/queries.ts — temporary scaffold; Task 9 replaces this entire file.
> export function useSyncLoop(): { isSyncing: boolean; refresh: () => void } {
>   return { isSyncing: false, refresh: () => {} };
> }
> ```

- [ ] **Step 4: Settings "Resync" button** (`src/features/settings/Settings.tsx`)

The M0 Settings takes an `onBack` prop; routing replaces that. Change the header's Back button to a `NavLink`/`useNavigate` is unnecessary — Settings is now a route. Remove the `onBack` prop and its Back button (the sidebar handles nav). Add a Resync row that calls `syncIssues(true)`:

```tsx
import { syncIssues, errorText } from "@/lib/commands";
import { clearWorkspaceQueries } from "@/lib/queries";
// `qc` already exists in M0 Settings via useQueryClient().
// inside the component, alongside testMut/clearMut:
const resyncMut = useMutation({
  mutationFn: () => syncIssues(true),
  onSuccess: (r) => gooeyToast.success(`Resynced ${r.synced} issues`),
  onError: (err) => gooeyToast.error("Resync failed", { description: errorText(err) }),
});
// add to the `busy` guard: const busy = saving || testMut.isPending || clearMut.isPending || resyncMut.isPending;
// add a button in the actions row:
//   <Button type="button" variant="ghost" disabled={busy} onClick={() => resyncMut.mutate()}>
//     Resync workspace
//   </Button>
```
Remove `Settings`'s `{ onBack }` param and the `<Button ... onClick={onBack}>Back</Button>`.

**Drop the renderer's workspace caches on every key change (P0).** The Rust wipe happens before the keyring write, so the webview must clear regardless of success/failure:
- In `handleSave`, after `await setLinearKey(key)` succeeds **and** in its `catch`, call `clearWorkspaceQueries(qc)` (in addition to `invalidateStatus()`).
- In `clearMut`, call `clearWorkspaceQueries(qc)` in **both** `onSuccess` and `onError`.

```tsx
// handleSave try/catch:
try {
  await setLinearKey(key);
  clearWorkspaceQueries(qc);
  gooeyToast.success("Linear key saved");
  invalidateStatus();
} catch (err) {
  clearWorkspaceQueries(qc);
  gooeyToast.error("Could not save the key", { description: errorText(err) });
} finally {
  setSaving(false);
}

// clearMut:
const clearMut = useMutation({
  mutationFn: () => clearLinearKey(),
  onSuccess: () => { clearWorkspaceQueries(qc); gooeyToast.success("Key cleared"); invalidateStatus(); },
  onError: (err) => { clearWorkspaceQueries(qc); gooeyToast.error("Could not clear the key", { description: errorText(err) }); },
});
```

- [ ] **Step 5: Update `Home.tsx` usage** — `Home` is no longer routed (calendar replaces it). Leave the file in place (unused) or delete it; if `noUnusedLocals`/build complains about an unused import anywhere, remove the stale `Home` import from `App.tsx` (already replaced above). Delete `src/features/home/Home.tsx` to avoid a dead-code import (keep `DualClock.tsx`, still used by the shell).

```bash
git rm src/features/home/Home.tsx
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: builds. (App not yet runnable end-to-end until Task 9/10, but it compiles and routes.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(m1): app shell, hash routing, sidebar, header clock, Resync button"
```

---

### Task 9: TanStack Query hooks (data + optimistic update + sync loop)

**Files:**
- Modify/replace: `src/lib/queries.ts` (replace the Task 8 stub with the full set)

**Interfaces:**
- Consumes: all bindings (Task 6), `matchesFilters`/`inRange`/`reconcileList`/`applyPatchToCalendarIssue` (Task 7), `errorText` (M0).
- Produces hooks: `useMe()`, `useFilterOptions()`, `useCalendarIssues(range, filters)`, `useUnscheduled(filters)`, `useIssueDetail(id, seed)`, `useUsers()`, `useUpdateIssue()`, `useSyncLoop()`.
- Query keys: `["me"]`, `["filter-options"]`, `["calendar", start, end, filters]`, `["unscheduled", filters]`, `["issue", id]`, `["users"]`.

- [ ] **Step 1: Implement `src/lib/queries.ts`**

```ts
import { useEffect } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import {
  errorText,
  getIssueDetail,
  getMe,
  listCalendarIssues,
  listFilterOptions,
  listUnscheduled,
  listUsers,
  syncIssues,
  updateIssue,
  type CalendarIssue,
  type IssueDetailResult,
  type IssueFilters,
  type LiveDetail,
  type UpdateIssuePatch,
} from "./commands";
import {
  applyPatchToCalendarIssue,
  inRange,
  matchesFilters,
  reconcileList,
} from "./optimistic";

/** Merge a patch's changed fields into a cached detail result (any branch). */
function patchDetail(result: IssueDetailResult, patch: UpdateIssuePatch): IssueDetailResult {
  const d = { ...(result.detail as Record<string, unknown>) };
  if (patch.title !== undefined) d.title = patch.title;
  if (patch.priority !== undefined) d.priority = patch.priority;
  if (patch.dueDate !== undefined) d.dueDate = patch.dueDate;
  if (patch.assigneeId !== undefined) d.assigneeId = patch.assigneeId;
  if (patch.description !== undefined) d.description = patch.description;
  if (patch.stateId !== undefined) {
    d.stateId = patch.stateId;
    if (result.source === "live") {
      const st = (result.detail as LiveDetail).teamStates.find((s) => s.id === patch.stateId);
      if (st) { d.stateName = st.name; d.stateType = st.type; d.stateColor = st.color; }
    }
  }
  return { ...result, detail: d } as IssueDetailResult;
}

/**
 * Drop every workspace-scoped query so the renderer cannot keep showing the old
 * workspace's data after the Rust cache is wiped (key set/clear). Call this on
 * BOTH success and failure of set/clear — the Rust wipe happens before the
 * keyring write, so a failed write still leaves an empty cache.
 */
export function clearWorkspaceQueries(qc: QueryClient) {
  for (const key of [
    ["calendar"], ["unscheduled"], ["issue"], ["users"], ["filter-options"], ["me"],
  ]) {
    qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key });
  }
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: Infinity });
}

export function useFilterOptions() {
  return useQuery({ queryKey: ["filter-options"], queryFn: listFilterOptions });
}

export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: listUsers, staleTime: 5 * 60_000 });
}

export function useCalendarIssues(range: { start: string; end: string }, filters: IssueFilters) {
  return useQuery({
    queryKey: ["calendar", range.start, range.end, filters],
    queryFn: () => listCalendarIssues({ ...range, ...filters }),
  });
}

export function useUnscheduled(filters: IssueFilters) {
  return useQuery({
    queryKey: ["unscheduled", filters],
    queryFn: () => listUnscheduled(filters),
  });
}

export function useIssueDetail(id: string | null, seed?: CalendarIssue) {
  return useQuery({
    queryKey: ["issue", id],
    queryFn: () => getIssueDetail(id as string),
    enabled: !!id,
    placeholderData: seed ? ({ source: "preview", detail: seed } as IssueDetailResult) : undefined,
  });
}

type UpdateVars = { id: string; patch: UpdateIssuePatch };

// Snapshot of every calendar/unscheduled cache entry we touch, for rollback.
type Snapshot = [QueryKey, unknown][];

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateVars) => updateIssue(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["calendar"] });
      await qc.cancelQueries({ queryKey: ["unscheduled"] });
      await qc.cancelQueries({ queryKey: ["issue", id] });

      const calEntries = qc.getQueriesData<CalendarIssue[]>({ queryKey: ["calendar"] });
      const unschedEntries = qc.getQueriesData<CalendarIssue[]>({ queryKey: ["unscheduled"] });
      const snapshot: Snapshot = [
        ...calEntries,
        ...unschedEntries,
        [["issue", id], qc.getQueryData(["issue", id])],
      ];

      // Find the issue's current CalendarIssue from any cache, then compute its patched form.
      const current =
        calEntries.flatMap(([, l]) => l ?? []).find((i) => i.id === id) ??
        unschedEntries.flatMap(([, l]) => l ?? []).find((i) => i.id === id);

      if (current) {
        const updated = applyPatchToCalendarIssue(current, patch);
        // Each calendar cache reconciles against ITS OWN range + filters.
        for (const [key, list] of calEntries) {
          const start = key[1] as string;
          const end = key[2] as string;
          const filters = (key[3] ?? {}) as IssueFilters;
          const belongs = inRange(updated.dueDate, start, end) && matchesFilters(updated, filters);
          qc.setQueryData(key, reconcileList(list ?? [], updated, belongs));
        }
        // Each unscheduled cache reconciles against its filters (belongs iff dueDate === null).
        for (const [key, list] of unschedEntries) {
          const filters = (key[1] ?? {}) as IssueFilters;
          const belongs = updated.dueDate === null && matchesFilters(updated, filters);
          qc.setQueryData(key, reconcileList(list ?? [], updated, belongs));
        }
      }

      // Patch the drawer detail cache (any branch) so the open drawer reflects the edit.
      const detail = qc.getQueryData<IssueDetailResult>(["issue", id]);
      if (detail) qc.setQueryData(["issue", id], patchDetail(detail, patch));

      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      gooeyToast.error("Update failed", { description: errorText(err) });
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["unscheduled"] });
      qc.invalidateQueries({ queryKey: ["issue", id] });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
    },
  });
}

/** Runs sync on mount + every 5 minutes; exposes a manual refresh + status. */
export function useSyncLoop() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => syncIssues(false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["unscheduled"] });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => gooeyToast.error("Sync failed", { description: errorText(err) }),
  });
  // Stable refs: trigger once on mount, then on an interval.
  useEffect(() => {
    mut.mutate();
    const t = setInterval(() => mut.mutate(), 5 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { isSyncing: mut.isPending, refresh: () => mut.mutate() };
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(m1): TanStack query hooks, optimistic update, 5-min sync loop"
```

---

## Phase C — Features (F1 calendar, F3 drag, F2 drawer)

> These are UI tasks. There is no component test runner in M1 (RTL deferred per spec §9), so each task's gate is `npx tsc --noEmit` + `npm run build` plus the manual check noted. The end-to-end manual verification is Task 13.

### Task 10: F1 — Calendar view (events, filters, color, rail, click-to-open)

**Files:**
- Replace: `src/features/calendar/CalendarPage.tsx` (the Task 8 stub)
- Create: `src/features/calendar/eventStyle.ts`, `src/features/calendar/FilterBar.tsx`, `src/features/calendar/UnscheduledRail.tsx`
- Modify: `src/styles/index.css` (add `.astryn-overdue`)

**Interfaces:**
- Consumes: `useCalendarIssues`, `useUnscheduled`, `useMe` (Task 9); `dhakaToday`, `rangeFromDates` (Task 7); `eventStyle`.
- Produces: `<CalendarPage/>` rendering the month/week calendar from cache, a filter bar, and the Unscheduled rail; `eventClick` opens the drawer route (`?issue=`).

- [ ] **Step 1: `src/features/calendar/eventStyle.ts`**

```ts
import type { CalendarIssue } from "@/lib/commands";
import { isOverdue } from "@/lib/dates";

// Linear priority order: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
const PRIORITY_COLORS = ["#6b7280", "#ef4444", "#f97316", "#eab308", "#3b82f6"];

export function eventStyle(i: CalendarIssue, colorBy: "state" | "priority", today: string) {
  const color =
    colorBy === "priority" ? PRIORITY_COLORS[i.priority] ?? "#6b7280" : i.stateColor || "#6b7280";
  return {
    backgroundColor: color,
    borderColor: color,
    classNames: isOverdue(i.dueDate, i.stateType, today) ? ["astryn-overdue"] : [],
  };
}
```

- [ ] **Step 2: `src/features/calendar/FilterBar.tsx`**

```tsx
import { useFilterOptions, useUsers } from "@/lib/queries";
import type { IssueFilters } from "@/lib/commands";

export function FilterBar({
  filters, colorBy, meId, onFilters, onColorBy,
}: {
  filters: IssueFilters;
  colorBy: "state" | "priority";
  meId?: string;
  onFilters: (f: IssueFilters) => void;
  onColorBy: (c: "state" | "priority") => void;
}) {
  const { data } = useFilterOptions();
  const { data: users } = useUsers();
  const sel = "rounded-md border bg-background px-2 py-1 text-sm";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <select className={sel} value={filters.assigneeId ?? "__all"}
        onChange={(e) => onFilters({ ...filters, assigneeId: e.target.value === "__all" ? undefined : e.target.value })}>
        <option value="__all">All assignees</option>
        {users?.map((u) => (
          <option key={u.id} value={u.id}>{u.name}{u.id === meId ? " (me)" : ""}</option>
        ))}
      </select>
      <select className={sel} value={filters.teamId ?? "__all"}
        onChange={(e) => onFilters({ ...filters, teamId: e.target.value === "__all" ? undefined : e.target.value })}>
        <option value="__all">All teams</option>
        {data?.teams.map((t) => <option key={t.id} value={t.id}>{t.key}</option>)}
      </select>
      <select className={sel} value={filters.projectId ?? "__all"}
        onChange={(e) => onFilters({ ...filters, projectId: e.target.value === "__all" ? undefined : e.target.value })}>
        <option value="__all">All projects</option>
        {data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className={sel} value={colorBy} onChange={(e) => onColorBy(e.target.value as "state" | "priority")}>
        <option value="state">Color: state</option>
        <option value="priority">Color: priority</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 3: `src/features/calendar/UnscheduledRail.tsx`** (visual now; made draggable in Task 11)

```tsx
import type { CalendarIssue } from "@/lib/commands";

export function UnscheduledRail({
  issues, onOpen,
}: {
  issues: CalendarIssue[];
  onOpen: (id: string) => void;
}) {
  return (
    <aside id="astryn-unscheduled" className="w-64 shrink-0 border-l p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Unscheduled ({issues.length})
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i) => (
          <div
            key={i.id}
            data-id={i.id}
            className="astryn-rail-item cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => onOpen(i.id)}
            title={i.title}
          >
            <span className="text-muted-foreground">{i.identifier}</span> {i.title}
          </div>
        ))}
        {issues.length === 0 && <div className="text-xs text-muted-foreground">Nothing unscheduled.</div>}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Replace `src/features/calendar/CalendarPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg } from "@fullcalendar/core";
import { useCalendarIssues, useMe, useUnscheduled } from "@/lib/queries";
import { dhakaToday, rangeFromDates } from "@/lib/dates";
import type { IssueFilters } from "@/lib/commands";
import { eventStyle } from "./eventStyle";
import { FilterBar } from "./FilterBar";
import { UnscheduledRail } from "./UnscheduledRail";

function currentDhakaMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}

export function CalendarPage() {
  const today = dhakaToday();
  const me = useMe();
  const [range, setRange] = useState(() => currentDhakaMonth(today));
  const [filters, setFilters] = useState<IssueFilters>({});
  const [initialized, setInitialized] = useState(false);
  const [colorBy, setColorBy] = useState<"state" | "priority">("state");
  const [, setParams] = useSearchParams();

  // Default the assignee filter to "me" exactly once, when identity loads. After
  // that, filters.assigneeId === undefined genuinely means "All assignees".
  useEffect(() => {
    if (!initialized && me.data) {
      setFilters({ assigneeId: me.data.viewerId });
      setInitialized(true);
    }
  }, [me.data, initialized]);

  const { data: scheduled } = useCalendarIssues(range, filters);
  const { data: unscheduled } = useUnscheduled(filters);

  // Any explicit filter interaction counts as "initialized" so the me-default
  // effect above can never later clobber a deliberate "All assignees" choice.
  const handleFilters = (f: IssueFilters) => {
    setInitialized(true);
    setFilters(f);
  };

  const events = useMemo(
    () =>
      (scheduled ?? [])
        .filter((i) => i.dueDate)
        .map((i) => ({
          id: i.id,
          title: `${i.identifier}  ${i.title}`,
          start: i.dueDate as string,
          allDay: true,
          ...eventStyle(i, colorBy, today),
        })),
    [scheduled, colorBy, today],
  );

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 p-4">
        <FilterBar filters={filters} colorBy={colorBy} meId={me.data?.viewerId} onFilters={handleFilters} onColorBy={setColorBy} />
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          firstDay={0}
          now={today}
          editable={true}
          height="auto"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek" }}
          events={events}
          datesSet={(arg: DatesSetArg) => setRange(rangeFromDates(arg.start, arg.end))}
          eventClick={(arg: EventClickArg) => setParams({ issue: arg.event.id })}
        />
      </div>
      <UnscheduledRail issues={unscheduled ?? []} onOpen={(id) => setParams({ issue: id })} />
    </div>
  );
}
```

- [ ] **Step 5: Add the overdue style** (`src/styles/index.css`, after the theme block)

```css
.astryn-overdue {
  outline: 2px solid #ef4444;
  outline-offset: -2px;
}
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: builds clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/calendar/ src/styles/index.css
git commit -m "feat(m1): F1 calendar view — events, filters, color toggle, unscheduled rail"
```

---

### Task 11: F3 — Drag-to-reschedule (event drop + rail drop)

**Files:**
- Modify: `src/features/calendar/CalendarPage.tsx` (drop handlers + `useUpdateIssue`)
- Modify: `src/features/calendar/UnscheduledRail.tsx` (init FullCalendar `Draggable`)

**Interfaces:**
- Consumes: `useUpdateIssue` (Task 9), `toDateStr` (Task 7), `Draggable` from `@fullcalendar/interaction`.

- [ ] **Step 1: Make rail items external draggables** (`UnscheduledRail.tsx`)

Add a `useEffect` that initializes a `Draggable` on the rail container. `create: false` tells FullCalendar not to add its own event (our cache drives rendering); the calendar's `drop` callback still fires with the target date.

Replace the whole file from Task 10 with this version (Task 10's markup + the `ref`/`Draggable` wiring):

```tsx
import { useEffect, useRef } from "react";
import { Draggable } from "@fullcalendar/interaction";
import type { CalendarIssue } from "@/lib/commands";

export function UnscheduledRail({
  issues, onOpen,
}: {
  issues: CalendarIssue[];
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // create:false => FullCalendar adds no internal event on drop; our cache drives
    // rendering. The calendar's `drop` callback still fires with the target date.
    const d = new Draggable(ref.current, {
      itemSelector: ".astryn-rail-item",
      eventData: () => ({ create: false }),
    });
    return () => d.destroy();
  }, []);

  return (
    <aside id="astryn-unscheduled" ref={ref} className="w-64 shrink-0 border-l p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Unscheduled ({issues.length})
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i) => (
          <div
            key={i.id}
            data-id={i.id}
            className="astryn-rail-item cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => onOpen(i.id)}
            title={i.title}
          >
            <span className="text-muted-foreground">{i.identifier}</span> {i.title}
          </div>
        ))}
        {issues.length === 0 && <div className="text-xs text-muted-foreground">Nothing unscheduled.</div>}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Wire drop handlers in `CalendarPage.tsx`**

Add `useUpdateIssue` and the handlers; set `droppable`. The controlled `events` prop (driven by the optimistic cache) reconciles position on success/rollback.

```tsx
import { useUpdateIssue } from "@/lib/queries";
import { toDateStr } from "@/lib/dates";
import type { EventDropArg } from "@fullcalendar/core";
import type { DropArg } from "@fullcalendar/interaction";
// inside the component:
const update = useUpdateIssue();
// add these props to <FullCalendar/>:
//   droppable={true}
//   eventDrop={(arg: EventDropArg) => {
//     if (!arg.event.start) return;
//     update.mutate({ id: arg.event.id, patch: { dueDate: toDateStr(arg.event.start) } });
//   }}
//   drop={(arg: DropArg) => {
//     const id = arg.draggedEl.getAttribute("data-id");
//     if (id) update.mutate({ id, patch: { dueDate: toDateStr(arg.date) } });
//   }}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/calendar/
git commit -m "feat(m1): F3 drag-to-reschedule — event drop + rail-to-day drop"
```

---

### Task 12: F2 — Issue detail drawer (preview/cache/live + inline edits)

**Files:**
- Create: `src/features/drawer/IssueDrawer.tsx`
- Modify: `src/features/calendar/CalendarPage.tsx` (render the drawer)

> Per the File Map, editors are kept inline in `IssueDrawer.tsx` rather than a `fields/` folder — the drawer is one focused unit and splitting six tiny controls adds more ceremony than clarity.

**Interfaces:**
- Consumes: `useIssueDetail`, `useUsers`, `useUpdateIssue` (Task 9); `IssueDetailResult` branches (Task 6).
- Produces: `<IssueDrawer/>` (renders when `?issue=<id>` is present).

- [ ] **Step 1: Implement `src/features/drawer/IssueDrawer.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIssueDetail, useUpdateIssue, useUsers } from "@/lib/queries";
import type { CalendarIssue, IssueDetailResult, LiveDetail, UpdateIssuePatch } from "@/lib/commands";
import { Button } from "@/components/ui/button";

const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"];

function useSeed(id: string | null): CalendarIssue | undefined {
  const qc = useQueryClient();
  if (!id) return undefined;
  for (const key of [["calendar"], ["unscheduled"]] as const) {
    for (const [, list] of qc.getQueriesData<CalendarIssue[]>({ queryKey: key })) {
      const found = list?.find((i) => i.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

export function IssueDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("issue");
  const seed = useSeed(id);
  const { data: result } = useIssueDetail(id, seed);
  if (!id || !result) return null;
  return <DrawerBody id={id} result={result} onClose={() => setParams({})} />;
}

function DrawerBody({
  id, result, onClose,
}: {
  id: string;
  result: IssueDetailResult;
  onClose: () => void;
}) {
  const update = useUpdateIssue();
  const users = useUsers();
  const live = result.source === "live" ? (result.detail as LiveDetail) : null;
  const editable = result.source === "live";

  // Display fields available across all branches.
  const d = result.detail;
  const identifier = d.identifier;
  const stateName = "stateName" in d ? d.stateName ?? "" : ("stateType" in d ? d.stateType : "");

  // Local edit buffers for free-text fields.
  const [title, setTitle] = useState(d.title);
  const [desc, setDesc] = useState("description" in d ? d.description ?? "" : "");
  const [showPreview, setShowPreview] = useState(true);
  useEffect(() => {
    setTitle(d.title);
    setDesc("description" in d ? d.description ?? "" : "");
  }, [id, result.source]); // re-seed when the issue or branch changes

  const patch = (p: UpdateIssuePatch) => update.mutate({ id, patch: p });

  return (
    <aside className="fixed right-0 top-0 z-20 flex h-full w-[460px] flex-col gap-4 overflow-y-auto border-l bg-background p-5 shadow-xl">
      <header className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{identifier}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </header>

      {result.source !== "live" && (
        <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {result.source === "preview" ? "Loading…" : "Offline — showing cached data. Editing is disabled."}
        </p>
      )}

      {/* Title */}
      <input
        className="rounded-md border bg-background px-2 py-1 text-base font-medium disabled:opacity-60"
        value={title}
        disabled={!editable}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => editable && title !== d.title && patch({ title })}
      />

      {/* State / Priority / Due / Assignee */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">State</span>
          <select
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={live?.stateId ?? ""}
            onChange={(e) => patch({ stateId: e.target.value })}
          >
            {!live && <option>{stateName}</option>}
            {live?.teamStates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Priority</span>
          <select
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={d.priority}
            onChange={(e) => patch({ priority: Number(e.target.value) })}
          >
            {PRIORITY_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Due date</span>
          <input
            type="date"
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={d.dueDate ?? ""}
            onChange={(e) => patch({ dueDate: e.target.value === "" ? null : e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Assignee</span>
          <select
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={d.assigneeId ?? ""}
            onChange={(e) => patch({ assigneeId: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">Unassigned</option>
            {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </div>

      {/* Description (markdown) */}
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Description</span>
          {editable && (
            <button className="text-xs underline" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "Edit" : "Preview"}
            </button>
          )}
        </div>
        {showPreview || !editable ? (
          <div className="prose prose-sm prose-invert max-w-none rounded-md border p-2 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{desc || "_No description_"}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            className="min-h-32 rounded-md border bg-background p-2 text-sm"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => patch({ description: desc === "" ? null : desc })}
          />
        )}
      </section>

      {/* Read-only rich sections (live only) */}
      {live && (
        <div className="flex flex-col gap-3 text-sm">
          {live.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {live.labels.map((l) => (
                <span key={l.id} className="rounded-full border px-2 py-0.5 text-xs"
                  style={{ borderColor: l.color ?? undefined }}>{l.name}</span>
              ))}
            </div>
          )}
          {live.projectName && <div><span className="text-muted-foreground">Project:</span> {live.projectName}</div>}
          {live.cycle && (
            <div><span className="text-muted-foreground">Cycle:</span> {live.cycle.name ?? `#${live.cycle.number ?? "?"}`}</div>
          )}
          {live.children.length > 0 && (
            <section>
              <div className="mb-1 text-xs text-muted-foreground">Sub-issues</div>
              {live.children.map((c) => (
                <div key={c.id} className="text-xs">{c.identifier} — {c.title} <span className="text-muted-foreground">({c.stateType})</span></div>
              ))}
              {live.hasMoreChildren && <div className="text-xs text-muted-foreground">Showing first 50</div>}
            </section>
          )}
          {live.relations.length > 0 && (
            <section>
              <div className="mb-1 text-xs text-muted-foreground">Relations</div>
              {live.relations.map((r, idx) => (
                <div key={idx} className="text-xs">{r.type}: {r.issue.identifier} — {r.issue.title}</div>
              ))}
              {live.hasMoreRelations && <div className="text-xs text-muted-foreground">Showing first 50</div>}
            </section>
          )}
          {live.comments.length > 0 && (
            <section>
              <div className="mb-1 text-xs text-muted-foreground">Comments</div>
              {live.comments.map((c) => (
                <div key={c.id} className="mb-2 rounded-md border p-2 text-xs">
                  <div className="text-muted-foreground">{c.userName ?? "Unknown"}</div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                </div>
              ))}
              {live.hasMoreComments && <div className="text-xs text-muted-foreground">Showing first 50</div>}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Render the drawer in `CalendarPage.tsx`**

Add the import and render it at the end of the returned tree (it self-hides when no `?issue`):

```tsx
import { IssueDrawer } from "@/features/drawer/IssueDrawer";
// at the end of the outer <div className="flex h-full"> ... add as a sibling:
//   <IssueDrawer />
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: builds clean. (If `prose` classes warn, they are harmless utility classes; no Typography plugin is required for correctness.)

- [ ] **Step 4: Commit**

```bash
git add src/features/drawer/ src/features/calendar/CalendarPage.tsx
git commit -m "feat(m1): F2 issue drawer — preview/cache/live, inline edits, read-only sections"
```

---

## Phase D — Integration & verification

### Task 13: End-to-end wiring check, manual verification, and milestone gates

**Files:** none new — this task verifies the whole milestone and fixes any integration gaps found.

- [ ] **Step 1: Full automated gate**

```bash
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt   --manifest-path src-tauri/Cargo.toml -- --check
npm test
npm run build
```
Expected: every command passes/clean.

- [ ] **Step 2: Launch the app**

Run: `npm run tauri dev`
Expected: launches into the Calendar route with the sidebar + header dual clock; the sync loop kicks a sync on mount.

- [ ] **Step 3: F1 verification**

- [ ] Enter the Linear key in Settings → "Test connection" shows **Connected as Abrar Mahir Esam**; the calendar populates (full sync on first run).
- [ ] The current Dhaka month renders; events are colored; switching to **Color: priority** recolors; overdue events show the red outline.
- [ ] Switch month → only the new range is queried (returning to a prior month is instant from TanStack cache).
- [ ] Filters: changing team/project/assignee updates the calendar without a full reload; clearing assignee shows everyone.
- [ ] The Unscheduled rail lists `due_date IS NULL` issues for the current filter.

- [ ] **Step 4: F3 verification**

- [ ] Drag an event to another day → it stays; reload the app → the new due date persisted (Linear + cache).
- [ ] Drag a rail item onto a day → it leaves the rail and appears on that day; persists across restart.
- [ ] Temporarily point at a bad endpoint or kill network, drag an event → it snaps back and an error toast with a description shows.

- [ ] **Step 5: F2 verification**

- [ ] Click an event/rail item → drawer opens instantly (preview from cache) then hydrates (live).
- [ ] Edit each field — title, state, priority, due date, assignee, description (incl. **clearing** due date/assignee/description) → persists to Linear and survives a refresh; closing/reopening shows the new value.
- [ ] Go offline, open an issue → drawer shows cached fields with editors disabled and the "Offline — showing cached" note.

- [ ] **Step 6: Workspace-safety verification**

- [ ] In Settings, change the Linear key → the calendar empties immediately (cache wiped); a fresh sync repopulates for the new key.
- [ ] "Resync workspace" wipes + full-syncs and toasts the synced count.

- [ ] **Step 7: Production bundle**

Run: `npm run tauri build`
Expected: bundles `.app`/`.dmg` without error.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore(m1): integration verification — F1-F3 acceptance met"
```

---

## Self-Review Notes (author check)

- **Spec coverage:** F1 (Task 10), F2 (Task 12), F3 (Task 11); full workspace sync + incremental lookback (Task 3), workspace_lock + generation + identity wipe (Tasks 4–5), tri-state patch (Task 2), bounded collections (Task 2 queries), half-open range (Task 1), RATELIMITED-on-400 (Task 2), Vitest for pure helpers (Task 7), Resync/hard-delete remedy (Tasks 5/8). Shell + router + Resync (Task 8). `get_me` for the "assigned to me" default (Tasks 5/9/10).
- **Type consistency:** Rust serializes camelCase; TS types in Task 6 mirror them. `CalendarIssue`/`Issue`/`LiveDetail`/`IssueDetailResult` names are identical Rust↔TS. `update_issue` takes `{ id, patch }`; binding matches. `sync_issues` takes `full`; binding matches.
- **Known approximations to confirm during execution (spec § live-API):** GraphQL field names (`viewer.organization.urlKey`, `relations.relatedIssue`, `issue.team.states`, `cycle.number/name`, `IssueUpdateInput`) are representative — **Task 2 Step 0 is now an explicit introspection gate** that must pass before the parsers are written (`requirements.md` §7 / CLAUDE.md "Live API wins").

### Post-review revisions (round 4)

- **P0 — ordering:** `set_linear_key_logic`/`clear_linear_key_logic` now wipe + bump the generation **before** the keyring write, so a failed keyring op leaves only an empty (safe) cache; `save_identity` is transactional (Tasks 1, 4).
- **P1 — optimistic correctness:** `useUpdateIssue` is query-key-aware — each calendar/unscheduled cache reconciles against **its own** range + filters (new pure helpers `matchesFilters`/`inRange`/`reconcileList`/`applyPatchToCalendarIssue`, Vitest-covered), and the drawer cache is patched via `patchDetail`. `CalendarIssue` gained `teamId`/`projectId` so filter matching is exact (Tasks 1, 6, 7, 9).
- **P1 — rate-limit backoff:** `LinearError::RateLimited(Option<i64>)` + `http_post` reads `Retry-After`; `AppState.rate_limited_until` suppresses sync inside the window and is armed on any 429 (Tasks 2, 4, 5).
- **P1 — sync correctness:** lookback now uses the `time` crate (RFC3339, fractional seconds); `hasNextPage` with no cursor fails the sync; full sync resets the watermark and an empty workspace still records a `now` baseline; `update_issue` replaces labels only when the upsert applied (Tasks 3, 5).
- **P1 — introspection gate** added (Task 2 Step 0).
- **P2:** assignee filter selects any workspace user (with a one-time "me" default that no longer fights an explicit "All"); cycle is queried in the detail query and displayed; detail connections request `pageInfo` and the drawer shows "Showing first 50"; the broken Task 3 stub helper is removed; `vitest` uses `--passWithNoTests` for the empty Task 6 run.

### Post-review revisions (round 5)

- **P0 — renderer cache:** added `clearWorkspaceQueries(qc)` (cancels + removes `calendar`/`unscheduled`/`issue`/`users`/`filter-options`/`me`), called on **both** success and failure of `handleSave` and `clearMut`, so the webview can't keep showing the old workspace after a wipe (Tasks 8, 9).
- **P1 — Resync honesty:** a rate-limited `sync_issues({ full: true })` now returns `CmdError::RateLimited` (not a fake "Resynced 0"); `http_post` also parses `X-RateLimit-Requests-Reset` (epoch) as a fallback to `Retry-After` (Tasks 2, 5).
- **P1 — key hygiene:** the introspection gate reads the key from the keychain (`security find-generic-password …`), never from a shell-history-visible variable (Task 2 Step 0).
- **P2:** Task 11 `UnscheduledRail` and Task 8's temporary `useSyncLoop` are now spelled out in full (no `...unchanged...` placeholder); the me-default effect is short-circuited by `handleFilters` on any interaction.
