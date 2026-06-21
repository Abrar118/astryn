# "This Week" Agenda (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a "This Week" agenda view — my issues grouped by due date (Overdue, Sunday→Thursday, Weekend), each row reusing the existing `IssueRow`, with sub-issues threaded and related issues listed beneath.

**Architecture:** Reuse the existing `list_issues` path (the frontend already loads the full workspace via `useIssues({})` and groups client-side) so sub-issues are derived for free by `parentId`. The only backend gap is **relations**, which aren't cached — so we add a `relations` table, populate it during sync, and expose a single `list_relations` command. The week-window math, grouping, dedup, and rendering all happen on the frontend. This is a deliberate refinement of the approved spec (which proposed a bespoke `get_week_agenda` assembler): same behavior, but DRYer — no new Rust query module, no shipping a parallel issue shape.

**Tech Stack:** Rust (Tauri v2, sqlx/SQLite, serde_json), React 19 + TypeScript (strict), TanStack Query, Tailwind v4 + shadcn/ui, Vitest, `cargo test`.

## Global Constraints

- **All external API calls live in Rust**; the webview is a pure consumer. This feature is read-only over the cache — no new network calls.
- **All date/time logic is computed in `Asia/Dhaka`; the week starts Sunday.** Never use UTC or machine locale for bucketing.
- **TS is strict** with `noUnusedLocals`/`noUnusedParameters` — unused symbols fail the build.
- **Tauri commands return sanitized `CmdError`** — never raw sqlx/reqwest diagnostics.
- **UI:** dark-first Linear aesthetic, Geist font, Lucide icons (no emoji as icons), subtle ~100ms hover transitions, visible focus rings, `prefers-reduced-motion` respected, meaningful empty states.
- **Migrations:** only create what this milestone uses; migrations live in `src-tauri/migrations/` and run on startup via `sqlx::migrate!("./migrations")`.
- **Commit after each task.** End commit messages with the project's `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Relations cache — table, db functions, cascade deletes

**Files:**
- Create: `src-tauri/migrations/0008_m1_relations.sql`
- Modify: `src-tauri/src/db/issues.rs` (add `RelationRecord` + `RelationItem` structs; `replace_relations`; `load_relations`; cascade `DELETE FROM relations` in `finalize_delete:339`, `recover_pending_deletes:356`, `wipe_workspace_cache:417`; add a test)

**Interfaces:**
- Consumes: nothing new (existing `Transaction`, `Sqlite`, `SqlitePool` already imported in this file).
- Produces:
  - `pub struct RelationRecord { pub related_issue_id: String, pub r#type: String, pub related_identifier: Option<String>, pub related_title: Option<String>, pub related_state_name: Option<String>, pub related_state_type: Option<String>, pub related_state_color: Option<String> }`
  - `pub struct RelationItem` (serde camelCase, sqlx::FromRow) with `issue_id, r#type, related_id, related_identifier, related_title, related_state_name, related_state_type, related_state_color`
  - `pub async fn replace_relations(tx: &mut Transaction<'_, Sqlite>, issue_id: &str, relations: &[RelationRecord]) -> Result<(), sqlx::Error>`
  - `pub async fn load_relations(pool: &SqlitePool) -> Result<Vec<RelationItem>, sqlx::Error>`

- [ ] **Step 1: Create the migration**

Create `src-tauri/migrations/0008_m1_relations.sql`:

```sql
CREATE TABLE relations (
  issue_id            TEXT NOT NULL,
  related_issue_id    TEXT NOT NULL,
  type                TEXT NOT NULL,
  related_identifier  TEXT,
  related_title       TEXT,
  related_state_name  TEXT,
  related_state_type  TEXT,
  related_state_color TEXT,
  PRIMARY KEY (issue_id, related_issue_id, type)
);
CREATE INDEX idx_relations_issue ON relations(issue_id);
```

- [ ] **Step 2: Add the structs**

In `src-tauri/src/db/issues.rs`, immediately after the `LabelRecord` struct (ends at line 107), add:

```rust
#[derive(Debug, Clone)]
pub struct RelationRecord {
    pub related_issue_id: String,
    pub r#type: String,
    pub related_identifier: Option<String>,
    pub related_title: Option<String>,
    pub related_state_name: Option<String>,
    pub related_state_type: Option<String>,
    pub related_state_color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RelationItem {
    pub issue_id: String,
    pub r#type: String,
    pub related_id: String,
    pub related_identifier: Option<String>,
    pub related_title: Option<String>,
    pub related_state_name: Option<String>,
    pub related_state_type: Option<String>,
    pub related_state_color: Option<String>,
}
```

- [ ] **Step 3: Write the failing test**

In the `#[cfg(test)] mod tests` block of `src-tauri/src/db/issues.rs` (after the existing tests, before the closing `}`), add:

```rust
    #[tokio::test]
    async fn replace_relations_replaces_and_load_returns() {
        let (_d, p) = pool().await;
        assert!(upsert(&p, &rec("1", Some("2026-06-10"), "2026-06-01T00:00:00Z")).await);

        let mut tx = p.begin().await.unwrap();
        replace_relations(
            &mut tx,
            "1",
            &[RelationRecord {
                related_issue_id: "2".into(),
                r#type: "blocks".into(),
                related_identifier: Some("ENG-2".into()),
                related_title: Some("Other".into()),
                related_state_name: Some("In Progress".into()),
                related_state_type: Some("started".into()),
                related_state_color: Some("#abc".into()),
            }],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let rels = load_relations(&p).await.unwrap();
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].issue_id, "1");
        assert_eq!(rels[0].r#type, "blocks");
        assert_eq!(rels[0].related_id, "2");
        assert_eq!(rels[0].related_state_type.as_deref(), Some("started"));

        // Replacing with an empty slice clears them.
        let mut tx = p.begin().await.unwrap();
        replace_relations(&mut tx, "1", &[]).await.unwrap();
        tx.commit().await.unwrap();
        assert!(load_relations(&p).await.unwrap().is_empty());
    }
```

- [ ] **Step 4: Run the test to verify it fails (won't compile yet)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml replace_relations_replaces_and_load_returns`
Expected: FAIL — `cannot find function replace_relations` / `cannot find function load_relations`.

- [ ] **Step 5: Implement `replace_relations` and `load_relations`**

In `src-tauri/src/db/issues.rs`, immediately after the `replace_labels` function (ends at line 207), add:

```rust
pub async fn replace_relations(
    tx: &mut Transaction<'_, Sqlite>,
    issue_id: &str,
    relations: &[RelationRecord],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM relations WHERE issue_id = ?1")
        .bind(issue_id)
        .execute(&mut **tx)
        .await?;
    for r in relations {
        sqlx::query(
            "INSERT OR IGNORE INTO relations
               (issue_id, related_issue_id, type, related_identifier, related_title,
                related_state_name, related_state_type, related_state_color)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        )
        .bind(issue_id)
        .bind(&r.related_issue_id)
        .bind(&r.r#type)
        .bind(&r.related_identifier)
        .bind(&r.related_title)
        .bind(&r.related_state_name)
        .bind(&r.related_state_type)
        .bind(&r.related_state_color)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

pub async fn load_relations(pool: &SqlitePool) -> Result<Vec<RelationItem>, sqlx::Error> {
    sqlx::query_as(
        "SELECT issue_id, type, related_issue_id AS related_id, related_identifier, related_title,
                related_state_name, related_state_type, related_state_color
         FROM relations",
    )
    .fetch_all(pool)
    .await
}
```

- [ ] **Step 6: Add the cascade deletes**

In `finalize_delete` (line 339), add this immediately after the `DELETE FROM labels` query (after line 344):

```rust
    sqlx::query("DELETE FROM relations WHERE issue_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
```

In `recover_pending_deletes` (line 356), add immediately after the labels delete (after line 362):

```rust
    sqlx::query(
        "DELETE FROM relations WHERE issue_id IN (SELECT issue_id FROM pending_issue_deletes)",
    )
    .execute(&mut *tx)
    .await?;
```

In `wipe_workspace_cache` (line 417), add immediately after the `DELETE FROM labels` line (after line 420):

```rust
    sqlx::query("DELETE FROM relations").execute(&mut *tx).await?;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml replace_relations_replaces_and_load_returns`
Expected: PASS.

- [ ] **Step 8: Run the full Rust suite (no regressions)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/migrations/0008_m1_relations.sql src-tauri/src/db/issues.rs
git commit -m "feat(db): cache Linear issue relations (table + replace/load + cascades)"
```

---

### Task 2: Parse relations from Linear into `ParsedIssue`

**Files:**
- Modify: `src-tauri/src/linear/issues.rs` (add `ParsedRelation` struct; add `relations` field to `ParsedIssue:13`; parse in `node_to_issue:158`; add relations selection to `issues_query:1074`; add a parse test in the `mod tests` at line 1322)
- Modify: `src-tauri/src/linear/sync.rs` (add `relations: vec![]` to the test `issue()` builder at line 208's struct)
- Modify: `src-tauri/src/commands/mod.rs` (add `relations: vec![]` to the `parsed` test-helper's `ParsedIssue` literal near line 1148)

**Interfaces:**
- Consumes: `s()`, `nested()` helpers (lines 100–108).
- Produces:
  - `pub struct ParsedRelation { pub related_id: String, pub r#type: String, pub related_identifier: Option<String>, pub related_title: Option<String>, pub related_state_name: Option<String>, pub related_state_type: Option<String>, pub related_state_color: Option<String> }`
  - `ParsedIssue.relations: Vec<ParsedRelation>` (new field).

- [ ] **Step 1: Add the `ParsedRelation` struct**

In `src-tauri/src/linear/issues.rs`, immediately after the `ParsedLabel` struct (ends at line 9), add:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedRelation {
    pub related_id: String,
    pub r#type: String,
    pub related_identifier: Option<String>,
    pub related_title: Option<String>,
    pub related_state_name: Option<String>,
    pub related_state_type: Option<String>,
    pub related_state_color: Option<String>,
}
```

- [ ] **Step 2: Add the field to `ParsedIssue`**

In the `ParsedIssue` struct (line 13), add a new field immediately after `pub labels: Vec<ParsedLabel>,`:

```rust
    pub relations: Vec<ParsedRelation>,
```

- [ ] **Step 3: Write the failing parse test**

In the `#[cfg(test)] mod tests` block (line 1322) of `src-tauri/src/linear/issues.rs`, add:

```rust
    #[test]
    fn node_to_issue_parses_relations() {
        let n = serde_json::json!({
            "id": "1", "identifier": "ENG-1", "title": "T", "url": "u",
            "createdAt": "c", "updatedAt": "u",
            "attachments": { "nodes": [] },
            "labels": { "nodes": [] },
            "relations": { "nodes": [
                { "type": "blocks", "relatedIssue": {
                    "id": "2", "identifier": "ENG-2", "title": "Other",
                    "state": { "name": "In Progress", "type": "started", "color": "#abc" }
                }}
            ]}
        });
        let p = node_to_issue(&n);
        assert_eq!(p.relations.len(), 1);
        assert_eq!(p.relations[0].related_id, "2");
        assert_eq!(p.relations[0].r#type, "blocks");
        assert_eq!(p.relations[0].related_identifier.as_deref(), Some("ENG-2"));
        assert_eq!(p.relations[0].related_state_type.as_deref(), Some("started"));
    }
```

- [ ] **Step 4: Run the test to verify it fails (won't compile)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml node_to_issue_parses_relations`
Expected: FAIL — missing field `relations` in `ParsedIssue` initializers / `ParsedRelation` unused, etc.

- [ ] **Step 5: Parse relations in `node_to_issue`**

In `node_to_issue` (line 158), immediately after the `let labels = ...;` block (ends at line 173, just before `ParsedIssue {`), add:

```rust
    let relations = n
        .get("relations")
        .and_then(|r| r.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let ri = r.get("relatedIssue")?;
                    Some(ParsedRelation {
                        related_id: s(ri, "id").unwrap_or_default(),
                        r#type: s(r, "type").unwrap_or_default(),
                        related_identifier: s(ri, "identifier"),
                        related_title: s(ri, "title"),
                        related_state_name: nested(ri, "state", "name"),
                        related_state_type: nested(ri, "state", "type"),
                        related_state_color: nested(ri, "state", "color"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
```

Then in the `ParsedIssue { ... }` literal that follows, add `relations,` immediately after the existing `labels,` line (before `raw_json: n.to_string(),`).

- [ ] **Step 6: Fix the two other `ParsedIssue` constructors so they compile**

In `src-tauri/src/linear/sync.rs`, in the test `issue()` builder, add a line immediately after the `labels: vec![ParsedLabel { ... }],` block (after line 212):

```rust
            relations: vec![],
```

In `src-tauri/src/commands/mod.rs`, find the `parsed` test helper's `ParsedIssue { ... }` literal (near line 1148) and add `relations: vec![],` immediately after its `labels: ...,` field.

- [ ] **Step 7: Add relations to the bulk sync query**

In `issues_query()` (line 1074), change the node body so the bulk query fetches relations. Replace line 1079:

```rust
             nodes {{ {ISSUE_NODE_FIELDS} }}
```

with:

```rust
             nodes {{ {ISSUE_NODE_FIELDS}
               relations(first: 50) {{ nodes {{ type relatedIssue {{ id identifier title state {{ name type color }} }} }} }}
             }}
```

(Do **not** add relations to the shared `ISSUE_NODE_FIELDS` const — the detail query already selects `relations` with a different sub-shape, and a shared duplicate would be a GraphQL field-conflict error.)

- [ ] **Step 8: Run the parse test, then the full suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml node_to_issue_parses_relations`
Expected: PASS.
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/linear/issues.rs src-tauri/src/linear/sync.rs src-tauri/src/commands/mod.rs
git commit -m "feat(linear): parse issue relations from the bulk sync query"
```

---

### Task 3: Persist relations during sync

**Files:**
- Modify: `src-tauri/src/linear/sync.rs` (`to_record:23` → 3-tuple; sync loop:132 calls `replace_relations`; add a test)
- Modify: `src-tauri/src/commands/mod.rs` (`parsed_to_record:167` discards the new third element)

**Interfaces:**
- Consumes: `RelationRecord`, `replace_relations`, `load_relations` (Task 1); `ParsedIssue.relations` (Task 2).
- Produces: `pub fn to_record(i: ParsedIssue) -> (IssueRecord, Vec<LabelRecord>, Vec<RelationRecord>)` (changed arity).

- [ ] **Step 1: Write the failing test**

In the `#[cfg(test)] mod tests` block of `src-tauri/src/linear/sync.rs` (after the existing tests, before the closing `}` at line 309), add:

```rust
    #[tokio::test]
    async fn sync_persists_relations() {
        use crate::db::issues::load_relations;
        let dir = tempfile::tempdir().unwrap();
        let p = init_pool(&dir.path().join("a/t.db")).await.unwrap();

        let mut iss = issue("1", "2026-06-01T00:00:00Z");
        iss.relations = vec![crate::linear::issues::ParsedRelation {
            related_id: "2".into(),
            r#type: "blocks".into(),
            related_identifier: Some("ENG-2".into()),
            related_title: Some("Other".into()),
            related_state_name: Some("In Progress".into()),
            related_state_type: Some("started".into()),
            related_state_color: Some("#abc".into()),
        }];
        let (f, _calls) = pager(vec![IssuesPage {
            issues: vec![iss],
            has_next: false,
            end_cursor: None,
        }]);
        run_sync(&p, f, true).await.unwrap();

        let rels = load_relations(&p).await.unwrap();
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].issue_id, "1");
        assert_eq!(rels[0].related_id, "2");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sync_persists_relations`
Expected: FAIL — relations are never written, `assert_eq!(rels.len(), 1)` fails (returns 0).

- [ ] **Step 3: Widen `to_record` to emit relation records**

In `src-tauri/src/linear/sync.rs`, change the import on line 1:

```rust
use crate::db::issues::{self, IssueRecord, LabelRecord, RelationRecord};
```

Change the `to_record` signature (line 23) to:

```rust
pub fn to_record(i: ParsedIssue) -> (IssueRecord, Vec<LabelRecord>, Vec<RelationRecord>) {
```

Immediately after the `let labels = ...;` block (ends at line 32), add:

```rust
    let relations = i
        .relations
        .iter()
        .map(|r| RelationRecord {
            related_issue_id: r.related_id.clone(),
            r#type: r.r#type.clone(),
            related_identifier: r.related_identifier.clone(),
            related_title: r.related_title.clone(),
            related_state_name: r.related_state_name.clone(),
            related_state_type: r.related_state_type.clone(),
            related_state_color: r.related_state_color.clone(),
        })
        .collect();
```

Change the final return (line 64) from `(rec, labels)` to:

```rust
    (rec, labels, relations)
```

- [ ] **Step 4: Persist relations in the sync loop**

In `run_sync`'s loop, change line 132 from `let (rec, labels) = to_record(parsed);` to:

```rust
            let (rec, labels, relations) = to_record(parsed);
```

Then inside the `if applied {` block (after the `replace_labels` call at lines 137–139), add:

```rust
                issues::replace_relations(&mut tx, &rec.id, &relations)
                    .await
                    .map_err(|_| LinearError::Malformed)?;
```

- [ ] **Step 5: Keep the mutation path from wiping relations**

The post-mutation upsert path must NOT call `replace_relations` (the `issueUpdate`/`issueCreate` mutations don't fetch relations, so doing so would erase them on every edit). In `src-tauri/src/commands/mod.rs`, change `parsed_to_record` (line 167) to discard the third element:

```rust
fn parsed_to_record(p: ParsedIssue) -> (IssueRecord, Vec<LabelRecord>) {
    let (rec, labels, _relations) = crate::linear::sync::to_record(p);
    (rec, labels)
}
```

(Its callers at lines 358 and 1148 keep working unchanged.)

- [ ] **Step 6: Run the test, then the full suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sync_persists_relations`
Expected: PASS.
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/linear/sync.rs src-tauri/src/commands/mod.rs
git commit -m "feat(sync): persist issue relations on each synced page"
```

---

### Task 4: Expose relations via a `list_relations` command

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (add the `list_relations` command, mirroring `list_issues:626`)
- Modify: `src-tauri/src/lib.rs` (register it in `generate_handler!:49`)

**Interfaces:**
- Consumes: `issues::load_relations` (Task 1).
- Produces: Tauri command `list_relations() -> Result<Vec<issues::RelationItem>, CmdError>`.

- [ ] **Step 1: Add the command**

In `src-tauri/src/commands/mod.rs`, immediately after the `list_issues` command (ends at line 634), add:

```rust
#[tauri::command]
pub async fn list_relations(
    state: State<'_, AppState>,
) -> Result<Vec<issues::RelationItem>, CmdError> {
    issues::load_relations(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![...]` block, add `list_relations` to the list. Change the last entry (line ~75) from:

```rust
            commands::create_label
```

to:

```rust
            commands::create_label,
            commands::list_relations
```

- [ ] **Step 3: Verify it builds and all tests pass**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add list_relations command"
```

---

### Task 5: `weekWindow` / `addDays` date helpers

**Files:**
- Modify: `src/lib/dates.ts` (add `WeekWindow` type, `addDays`, `weekWindow`)
- Modify: `src/lib/dates.test.ts` (add tests)

**Interfaces:**
- Consumes: `dhakaToday` (line 2).
- Produces:
  - `export type WeekWindow = { weekStart: string; weekEnd: string; weekdays: string[]; weekend: string[] }`
  - `export function addDays(date: string, n: number): string`
  - `export function weekWindow(now?: Date): WeekWindow`

- [ ] **Step 1: Write the failing tests**

In `src/lib/dates.test.ts`, add the import of the new symbols to the top import line and append:

```ts
import { addDays, weekWindow } from "./dates";

describe("addDays", () => {
  it("adds and subtracts days across month boundaries (UTC-safe)", () => {
    expect(addDays("2026-06-21", 1)).toBe("2026-06-22");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(addDays("2026-06-21", 7)).toBe("2026-06-28");
  });
});

describe("weekWindow (Asia/Dhaka, Sunday-started)", () => {
  it("computes the Sunday→next-Sunday window for a mid-week day", () => {
    // 2026-06-24 is a Wednesday; that week's Sunday is 2026-06-21.
    const w = weekWindow(new Date("2026-06-24T06:00:00Z"));
    expect(w.weekStart).toBe("2026-06-21");
    expect(w.weekEnd).toBe("2026-06-28");
    expect(w.weekdays).toEqual([
      "2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25",
    ]);
    expect(w.weekend).toEqual(["2026-06-26", "2026-06-27"]);
  });

  it("treats Sunday as the first day of its own week", () => {
    const w = weekWindow(new Date("2026-06-21T06:00:00Z"));
    expect(w.weekStart).toBe("2026-06-21");
  });

  it("uses Dhaka calendar date past the UTC midnight rollover", () => {
    // 2026-06-20 20:00Z == 2026-06-21 02:00 Dhaka (a Sunday) -> weekStart that Sunday.
    const w = weekWindow(new Date("2026-06-20T20:00:00Z"));
    expect(w.weekStart).toBe("2026-06-21");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — `addDays`/`weekWindow` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/dates.ts`:

```ts
export type WeekWindow = {
  /** Sunday of the current Dhaka week, YYYY-MM-DD (inclusive). */
  weekStart: string;
  /** The following Sunday, YYYY-MM-DD (exclusive). */
  weekEnd: string;
  /** [Sun, Mon, Tue, Wed, Thu] as YYYY-MM-DD. */
  weekdays: string[];
  /** [Fri, Sat] as YYYY-MM-DD. */
  weekend: string[];
};

/** Add `n` days to a YYYY-MM-DD string. UTC arithmetic avoids DST/local drift. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The current Sunday-started week, anchored to today's Asia/Dhaka calendar date. */
export function weekWindow(now: Date = new Date()): WeekWindow {
  const today = dhakaToday(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
  const weekStart = addDays(today, -dow);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 7),
    weekdays: [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)),
    weekend: [5, 6].map((i) => addDays(weekStart, i)),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat(dates): add weekWindow + addDays (Dhaka, Sunday-started)"
```

---

### Task 6: `Relation` binding + `useRelations` hook

**Files:**
- Modify: `src/lib/commands.ts` (add `Relation` type + `listRelations` binding)
- Modify: `src/lib/queries.ts` (add `useRelations`; add `["relations"]` to `WORKSPACE_KEYS:135`)

**Interfaces:**
- Consumes: `invoke` (commands.ts:1), `useQuery`, `listRelations`.
- Produces:
  - `export type Relation = { issueId: string; type: string; relatedId: string; relatedIdentifier: string | null; relatedTitle: string | null; relatedStateName: string | null; relatedStateType: string | null; relatedStateColor: string | null }`
  - `export const listRelations: () => Promise<Relation[]>`
  - `export function useRelations(): UseQueryResult<Relation[]>`

- [ ] **Step 1: Add the type + binding**

In `src/lib/commands.ts`, after the `IssueListItem` type (line 78), add:

```ts
export type Relation = {
  issueId: string;
  type: string;
  relatedId: string;
  relatedIdentifier: string | null;
  relatedTitle: string | null;
  relatedStateName: string | null;
  relatedStateType: string | null;
  relatedStateColor: string | null;
};
```

After the `listIssues` binding (line 245), add:

```ts
export const listRelations = (): Promise<Relation[]> => invoke("list_relations");
```

- [ ] **Step 2: Add the hook and register the workspace key**

In `src/lib/queries.ts`, add `["relations"]` into the `WORKSPACE_KEYS` array (line 135) — append it to the list, e.g. after `["issue"]`:

```ts
  ["calendar"], ["unscheduled"], ["issues"], ["issue"], ["relations"], ["users"], ["labels"], ["cycles"],
```

Ensure `listRelations` and `Relation` are imported from `./commands` at the top of the file (add to the existing import from `./commands`).

Then, near `useIssues` (line 263), add:

```ts
export function useRelations() {
  return useQuery({ queryKey: ["relations"], queryFn: listRelations });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/commands.ts src/lib/queries.ts
git commit -m "feat(queries): add Relation binding + useRelations hook"
```

---

### Task 7: `buildAgenda` grouping logic (pure, fully tested)

**Files:**
- Create: `src/features/agenda/agenda.ts`
- Create: `src/features/agenda/agenda.test.ts`

**Interfaces:**
- Consumes: `IssueListItem`, `Relation` (from `../../lib/commands`); `WeekWindow` (from `../../lib/dates`).
- Produces:
  - `export type AgendaItem = { issue: IssueListItem; children: IssueListItem[]; relations: Relation[] }`
  - `export type AgendaGroup = { key: string; label: string; date: string | null; items: AgendaItem[] }`
  - `export function buildAgenda(args: { issues: IssueListItem[]; relations: Relation[]; viewerId: string; window: WeekWindow }): AgendaGroup[]`

Semantics: top-level rows are the viewer's issues. **Overdue** = due before `weekStart` and not `completed`/`canceled`. **Weekday groups** (`weekdays[0..4]`, always present even when empty) = issues due on that date, any state. **Weekend** (only if non-empty) = issues due on `weekend` dates. Undated issues are omitted. A viewer issue that is also a sub-issue (`parentId`) of another top-level item appears nested only (deduped from top level). Within a group: sort by priority (urgent→none), then identifier.

- [ ] **Step 1: Write the failing tests**

Create `src/features/agenda/agenda.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAgenda } from "./agenda";
import type { IssueListItem, Relation } from "../../lib/commands";
import type { WeekWindow } from "../../lib/dates";

const WINDOW: WeekWindow = {
  weekStart: "2026-06-21",
  weekEnd: "2026-06-28",
  weekdays: ["2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"],
  weekend: ["2026-06-26", "2026-06-27"],
};

function iss(over: Partial<IssueListItem> & { id: string }): IssueListItem {
  return {
    id: over.id,
    identifier: over.identifier ?? `ENG-${over.id}`,
    title: over.title ?? "T",
    description: null,
    dueDate: over.dueDate ?? null,
    priority: over.priority ?? 0,
    url: "u",
    stateId: null,
    stateName: over.stateName ?? "Todo",
    stateType: over.stateType ?? "unstarted",
    stateColor: "#fff",
    assigneeId: over.assigneeId ?? "me",
    assigneeName: "Me",
    teamId: null,
    teamKey: null,
    projectId: null,
    projectName: null,
    parentId: over.parentId ?? null,
    estimate: null,
    cycleName: null,
    cycleNumber: null,
    milestoneName: null,
    linkCount: 0,
    prCount: 0,
    attachmentsTruncated: false,
    createdAt: "c",
    updatedAt: "u",
    labels: [],
    ...over,
  };
}

const find = (gs: ReturnType<typeof buildAgenda>, key: string) =>
  gs.find((g) => g.key === key);

describe("buildAgenda", () => {
  it("buckets the viewer's issues by weekday and always renders Sun-Thu", () => {
    const issues = [iss({ id: "1", dueDate: "2026-06-22" })];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(gs.filter((g) => g.date).map((g) => g.key)).toEqual(WINDOW.weekdays);
    expect(find(gs, "2026-06-22")!.items.map((i) => i.issue.id)).toEqual(["1"]);
    expect(find(gs, "2026-06-21")!.items).toEqual([]); // empty weekday still present
  });

  it("excludes other people's issues and undated issues", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-22", assigneeId: "someone" }),
      iss({ id: "2", dueDate: null }),
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(gs.flatMap((g) => g.items)).toEqual([]);
  });

  it("puts past-due open issues in Overdue but not completed/canceled ones", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-10", stateType: "started" }),
      iss({ id: "2", dueDate: "2026-06-10", stateType: "completed" }),
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(find(gs, "overdue")!.items.map((i) => i.issue.id)).toEqual(["1"]);
  });

  it("folds Friday/Saturday into a Weekend group only when non-empty", () => {
    const noWeekend = buildAgenda({
      issues: [iss({ id: "1", dueDate: "2026-06-22" })],
      relations: [], viewerId: "me", window: WINDOW,
    });
    expect(find(noWeekend, "weekend")).toBeUndefined();
    const withWeekend = buildAgenda({
      issues: [iss({ id: "2", dueDate: "2026-06-26" })],
      relations: [], viewerId: "me", window: WINDOW,
    });
    expect(find(withWeekend, "weekend")!.items.map((i) => i.issue.id)).toEqual(["2"]);
  });

  it("threads sub-issues and dedupes them from the top level", () => {
    const issues = [
      iss({ id: "p", dueDate: "2026-06-22" }),
      iss({ id: "c", dueDate: "2026-06-23", parentId: "p" }), // mine AND due this week
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(find(gs, "2026-06-22")!.items[0].children.map((c) => c.id)).toEqual(["c"]);
    expect(find(gs, "2026-06-23")).toBeUndefined(); // 'c' not a standalone top-level row
  });

  it("attaches relations to their issue", () => {
    const rel: Relation = {
      issueId: "1", type: "blocks", relatedId: "9",
      relatedIdentifier: "ENG-9", relatedTitle: "Dep",
      relatedStateName: "Done", relatedStateType: "completed", relatedStateColor: "#0f0",
    };
    const gs = buildAgenda({
      issues: [iss({ id: "1", dueDate: "2026-06-22" })],
      relations: [rel], viewerId: "me", window: WINDOW,
    });
    expect(find(gs, "2026-06-22")!.items[0].relations).toEqual([rel]);
  });

  it("sorts within a day by priority then identifier", () => {
    const issues = [
      iss({ id: "a", identifier: "ENG-3", dueDate: "2026-06-22", priority: 0 }), // none -> last
      iss({ id: "b", identifier: "ENG-2", dueDate: "2026-06-22", priority: 1 }), // urgent -> first
      iss({ id: "c", identifier: "ENG-1", dueDate: "2026-06-22", priority: 1 }),
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(find(gs, "2026-06-22")!.items.map((i) => i.issue.identifier)).toEqual([
      "ENG-1", "ENG-2", "ENG-3",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/agenda/agenda.test.ts`
Expected: FAIL — `buildAgenda` not found.

- [ ] **Step 3: Implement `buildAgenda`**

Create `src/features/agenda/agenda.ts`:

```ts
import type { IssueListItem, Relation } from "../../lib/commands";
import type { WeekWindow } from "../../lib/dates";

export type AgendaItem = {
  issue: IssueListItem;
  children: IssueListItem[];
  relations: Relation[];
};

export type AgendaGroup = {
  /** "overdue" | a weekday date string | "weekend". */
  key: string;
  label: string;
  /** The weekday date for day groups; null for overdue/weekend. */
  date: string | null;
  items: AgendaItem[];
};

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];

/** Sort rank: urgent(1) first, none(0) last. */
const prioRank = (p: number) => (p === 0 ? 5 : p);

function sortItems(items: AgendaItem[]): AgendaItem[] {
  return items.sort(
    (a, b) =>
      prioRank(a.issue.priority) - prioRank(b.issue.priority) ||
      a.issue.identifier.localeCompare(b.issue.identifier),
  );
}

export function buildAgenda(args: {
  issues: IssueListItem[];
  relations: Relation[];
  viewerId: string;
  window: WeekWindow;
}): AgendaGroup[] {
  const { issues, relations, viewerId, window } = args;

  const relationsByIssue = new Map<string, Relation[]>();
  for (const r of relations) {
    const list = relationsByIssue.get(r.issueId) ?? [];
    list.push(r);
    relationsByIssue.set(r.issueId, list);
  }

  const childrenByParent = new Map<string, IssueListItem[]>();
  for (const i of issues) {
    if (!i.parentId) continue;
    const list = childrenByParent.get(i.parentId) ?? [];
    list.push(i);
    childrenByParent.set(i.parentId, list);
  }

  // Top-level candidates: the viewer's dated issues.
  const mine = issues.filter((i) => i.assigneeId === viewerId && i.dueDate);

  // Dedup: a candidate that is a child of another candidate shows nested only.
  const childIds = new Set<string>();
  for (const c of mine) {
    for (const kid of childrenByParent.get(c.id) ?? []) childIds.add(kid.id);
  }
  const topLevel = mine.filter((i) => !childIds.has(i.id));

  const toItem = (issue: IssueListItem): AgendaItem => ({
    issue,
    children: childrenByParent.get(issue.id) ?? [],
    relations: relationsByIssue.get(issue.id) ?? [],
  });

  const overdue = topLevel.filter(
    (i) =>
      i.dueDate! < window.weekStart &&
      i.stateType !== "completed" &&
      i.stateType !== "canceled",
  );
  const weekendItems = topLevel.filter((i) => window.weekend.includes(i.dueDate!));

  const groups: AgendaGroup[] = [];
  if (overdue.length) {
    groups.push({ key: "overdue", label: "Overdue", date: null, items: sortItems(overdue.map(toItem)) });
  }
  window.weekdays.forEach((date, idx) => {
    const items = topLevel.filter((i) => i.dueDate === date).map(toItem);
    groups.push({ key: date, label: WEEKDAY_LABELS[idx], date, items: sortItems(items) });
  });
  if (weekendItems.length) {
    groups.push({ key: "weekend", label: "Weekend", date: null, items: sortItems(weekendItems.map(toItem)) });
  }
  return groups;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/agenda/agenda.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/agenda/agenda.ts src/features/agenda/agenda.test.ts
git commit -m "feat(agenda): buildAgenda grouping/dedup logic"
```

---

### Task 8: `AgendaView` component

**Files:**
- Create: `src/features/agenda/AgendaView.tsx`

**Interfaces:**
- Consumes: `buildAgenda`, `AgendaGroup`, `AgendaItem` (Task 7); `useIssues`, `useRelations`, `useMe`, `useUsers` (queries); `weekWindow`, `dhakaToday` (dates); `IssueRow` + `DEFAULT_DISPLAY` (issues feature); `useIssueMenu` (issue context menu); `useSearchParams` (react-router).
- Produces: `export function AgendaView()`.

Verified by typecheck + build + manual run (the grouping logic is fully unit-tested in Task 7; this task is presentation/wiring).

- [ ] **Step 1: Implement the component**

Create `src/features/agenda/AgendaView.tsx`:

```tsx
import { useSearchParams } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import { useIssues, useRelations, useMe, useUsers } from "../../lib/queries";
import { dhakaToday, weekWindow } from "../../lib/dates";
import { buildAgenda, type AgendaItem } from "./agenda";
import { IssueRow } from "../issues/IssueRow";
import { DEFAULT_DISPLAY } from "../issues/viewConfig";
import { useIssueMenu } from "../issues/IssueContextMenu";

const RELATION_LABEL: Record<string, string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  related: "Related",
  duplicate: "Duplicate",
};

export function AgendaView() {
  const today = dhakaToday();
  const window = weekWindow();
  const me = useMe();
  const { data: issues, isLoading: issuesLoading } = useIssues({});
  const { data: relations, isLoading: relsLoading } = useRelations();
  const { data: users } = useUsers();
  const { openMenu } = useIssueMenu();
  const [, setParams] = useSearchParams();

  const open = (id: string) => setParams({ issue: id });
  const avatarOf = (id: string | null) => {
    if (!id) return null;
    const u = (users ?? []).find((x) => x.id === id);
    return u ? { name: u.name } : null;
  };

  if (issuesLoading || relsLoading || me.isLoading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    );
  }

  const viewerId = me.data?.viewerId;
  const groups = viewerId
    ? buildAgenda({ issues: issues ?? [], relations: relations ?? [], viewerId, window })
    : [];

  const isEmpty = groups.every((g) => g.items.length === 0);

  const renderItem = (item: AgendaItem) => (
    <div key={item.issue.id}>
      <IssueRow
        issue={item.issue}
        display={DEFAULT_DISPLAY}
        avatar={avatarOf(item.issue.assigneeId)}
        onOpen={open}
        onContextMenu={(e) => openMenu(e, item.issue.id)}
        today={today}
      />
      {(item.children.length > 0 || item.relations.length > 0) && (
        <div className="ml-5 border-l border-border/60 pl-1">
          {item.children.map((child) => (
            <IssueRow
              key={child.id}
              issue={child}
              display={DEFAULT_DISPLAY}
              avatar={avatarOf(child.assigneeId)}
              onOpen={open}
              onContextMenu={(e) => openMenu(e, child.id)}
              today={today}
            />
          ))}
          {item.relations.map((r) => (
            <button
              key={`${r.type}-${r.relatedId}`}
              type="button"
              onClick={() => open(r.relatedId)}
              className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50"
            >
              <span className="w-16 shrink-0 uppercase tracking-wide text-[10px]">
                {RELATION_LABEL[r.type] ?? r.type}
              </span>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.relatedStateColor ?? "#888" }}
                title={r.relatedStateName ?? undefined}
              />
              <span className="w-16 shrink-0 font-mono">{r.relatedIdentifier}</span>
              <span className="flex-1 truncate text-foreground/80">{r.relatedTitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <CalendarRange className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">This Week</h1>
        <span className="text-xs text-muted-foreground">
          {window.weekStart} – {window.weekdays[4]}
        </span>
      </header>

      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
          Nothing on your plate this week.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-4 py-1.5 backdrop-blur">
                <span className="text-xs font-medium">{g.label}</span>
                {g.date && <span className="text-[11px] text-muted-foreground">{g.date}</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">{g.items.length}</span>
              </div>
              {g.items.length ? (
                g.items.map(renderItem)
              ) : (
                <div className="px-4 py-2 text-xs text-muted-foreground/70">Nothing due</div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

> Implementation notes for the worker:
> - Confirm the exact import paths against the repo: `IssueRow` is `../issues/IssueRow`, `DEFAULT_DISPLAY` is exported from `../issues/viewConfig`, `useIssueMenu` is from `../issues/IssueContextMenu`, and `react-router`'s hook import matches how `IssuesView.tsx` imports `useSearchParams` (match its specifier exactly — `react-router-dom` vs `react-router`).
> - `avatarOf` returns `{ name } | null`, structurally matching `IssueRow`'s `avatar` prop.
> - If `lucide-react` lacks `CalendarRange`, use `CalendarClock` or `CalendarDays`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any import-path/prop mismatches surfaced here.

- [ ] **Step 3: Commit**

```bash
git add src/features/agenda/AgendaView.tsx
git commit -m "feat(agenda): AgendaView component (groups + threaded rows + relations)"
```

---

### Task 9: Wire the "this-week" view into navigation

**Files:**
- Modify: `src/lib/paneModel.ts` (`ViewKind` union:1 + `VIEWS`:11)
- Modify: `src/components/SplitLayout.tsx` (`PaneContent` switch:33 + import)
- Modify: `src/components/Dock.tsx` (`NAV`:38 + `META`:45 + icon import)
- Modify: `src/components/PaneTabStrip.tsx` (`META`:11 + icon import)
- Modify: `src/features/command/CommandPalette.tsx` (commands array:193 + icon import)

**Interfaces:**
- Consumes: `AgendaView` (Task 8); `ViewKind`.
- Produces: a navigable `"this-week"` view reachable from the dock and command palette.

Verified by typecheck + build + manual run. Note: both `Dock.tsx` and `PaneTabStrip.tsx` `META` maps are `Record<Exclude<ViewKind, "issue">, …>`, so TypeScript will fail the build until **both** are extended.

- [ ] **Step 1: Extend the view union**

In `src/lib/paneModel.ts`, change line 1:

```ts
export type ViewKind = "calendar" | "list" | "this-week" | "inbox" | "settings" | "issue";
```

and add `"this-week"` to the `VIEWS` array (line 11):

```ts
export const VIEWS: ViewKind[] = ["calendar", "list", "this-week", "inbox", "settings", "issue"];
```

- [ ] **Step 2: Render the view**

In `src/components/SplitLayout.tsx`, add the import near the other view imports:

```tsx
import { AgendaView } from "../features/agenda/AgendaView";
```

and add a case to the `PaneContent` switch (after the `"list"` case, line 37):

```tsx
      case "this-week":
        return <AgendaView />;
```

- [ ] **Step 3: Add the dock entry**

In `src/components/Dock.tsx`, add `CalendarRange` to the `lucide-react` import. Add to the `NAV` array (line 38), after the `list` entry:

```tsx
    { view: "this-week", label: "This Week", icon: <CalendarRange className="size-5" /> },
```

and add to the `META` record (line 45):

```tsx
"this-week": "This Week",
```

- [ ] **Step 4: Add the tab-strip label/icon**

In `src/components/PaneTabStrip.tsx`, add `CalendarRange` to the `lucide-react` import, and add to the `META` record (line 11):

```tsx
  "this-week": { label: "This Week", icon: <CalendarRange className="size-3.5" /> },
```

- [ ] **Step 5: Add the command-palette action**

In `src/features/command/CommandPalette.tsx`, add `CalendarRange` to the `lucide-react` import, and add an entry to the `commands` array (line 193), after the `go-issues` entry:

```tsx
        { key: "go-this-week", section: "Go to", icon: <CalendarRange className="size-4" />, label: "Go to This Week", onSelect: () => goTo("this-week") },
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: builds clean.

- [ ] **Step 7: Run the full frontend test suite (no regressions)**

Run: `npm run test`
Expected: all pass (existing `PaneTabStrip.test.tsx` / `SplitLayout.test.tsx` / `CommandPalette.test.tsx` still green with the new view).

- [ ] **Step 8: Manual verification**

Run: `npm run tauri dev`. Then:
1. Click the **This Week** dock icon → the agenda renders with sticky day headers Sunday→Thursday.
2. An issue assigned to you with a due date this week appears under the right day; an overdue open issue appears under **Overdue**; a Fri/Sat one appears under **Weekend**.
3. A parent issue shows its sub-issues threaded beneath with an indent rail; related issues show with a type label + state dot.
4. Clicking any row (top-level, sub-issue, or related) opens the issue drawer.
5. Right-clicking a row opens the issue context menu.
6. A weekday with nothing due still shows its header + "Nothing due".
7. `⌘/Ctrl+K` → "Go to This Week" navigates to the view.

- [ ] **Step 9: Commit**

```bash
git add src/lib/paneModel.ts src/components/SplitLayout.tsx src/components/Dock.tsx src/components/PaneTabStrip.tsx src/features/command/CommandPalette.tsx
git commit -m "feat(agenda): wire This Week view into dock, tabs, and palette"
```

---

### Task 10: Update `requirements.md`

**Files:**
- Modify: `requirements.md` (F5, F6, M3 milestone line, §13 decision 5, §5 data-model note)

- [ ] **Step 1: Rewrite the F5/F6/M3 spec to match the shipped design**

Update `requirements.md`:
- **F5 + F6**: replace the standup/weekly bucket descriptions with the single "This Week" agenda: viewer's issues by due date, Sunday→Thursday (+ Overdue, + Weekend), any state, sub-issues threaded + related issues listed, in-app view (no markdown export, no `polish` seam).
- **M3 milestone line (§11)**: mark it as the "This Week agenda (replaces F5/F6 generators)" and update its status.
- **§13 decision 5**: note the output is now a structured in-app view (markdown/polish dropped).
- **§5 data model**: add the new `relations` cache table to the schema list.
- Reference the design doc: `docs/superpowers/specs/2026-06-21-this-week-agenda-design.md`.

- [ ] **Step 2: Commit**

```bash
git add requirements.md
git commit -m "docs: update F5/F6/M3 to the This Week agenda design"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-21-this-week-agenda-design.md`):
- Track by due date, Asia/Dhaka, Sunday week → Task 5 (`weekWindow`) + Task 7 (bucketing). ✓
- Assignee = me → Task 7 (`viewerId` filter). ✓
- Any state; undated omitted → Task 7. ✓
- Overdue (open, past-due) / Sun–Thu (always shown) / Weekend (if non-empty) → Task 7. ✓
- Sub-issues threaded; dedup rule → Task 7 (childrenByParent + dedup) + Task 8 (render). ✓
- Related issues per row → Tasks 1–4 (cache + command) + Task 6 (binding) + Task 8 (render). ✓
- Reuse `IssueRow`; sticky headers; empty/loading states → Task 8. ✓
- Dock entry + command-palette action; opens F2 drawer → Tasks 8–9. ✓
- Offline-first (cache-only reads) → `list_issues`/`list_relations` read SQLite only. ✓
- Relations cache as a data-model addition; cascade cleanup → Task 1. ✓
- Drop markdown/polish; spec update → Task 10. ✓

**Placeholder scan:** none — every code step contains complete code; every run step has an exact command + expected result.

**Type consistency:** `RelationRecord`/`RelationItem` (Rust) ↔ `Relation` (TS, camelCase) field names align (`relatedId` ⇄ `related_id AS related_id`). `to_record`'s new 3-tuple is consumed in the sync loop (Task 3) and discarded in `parsed_to_record` (Task 3). `buildAgenda`'s `AgendaGroup`/`AgendaItem` are produced in Task 7 and consumed in Task 8. `weekWindow`/`WeekWindow` (Task 5) feed Task 7 and Task 8.
