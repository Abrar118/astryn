# M3 — "This Week" Agenda — Design

**Status:** Approved (brainstorming complete) — ready for implementation plan
**Date:** 2026-06-21
**Milestone:** M3 (replaces the original F5 standup + F6 weekly generators)
**Owner:** Abrar

---

## 1. Summary

M3 becomes a single in-app view, **"This Week"** — *my* issues organized by **due date** for the current work week (**Sunday → Thursday**), in any state. It replaces both originally-specced generators:

- **F5** (daily standup: Done / In-progress / Blocked buckets) — replaced.
- **F6** (weekly review: Completed / Carried / New buckets) — replaced.

The original generators produced **title-only markdown** text routed through a no-op `polish()` seam. This design **drops markdown export and the `polish` seam** — output is now a structured in-app view, not generated text. `requirements.md` (F5, F6, M3, §13) will be updated to record this change. These were `[REQ]` items; the owner is redefining them.

The one motivating reframe: track by **due date**, not completion time. This sidesteps the cache's missing `completed_at` column (issues store `state_type` but not *when* they completed), so no completion-time tracking is needed.

---

## 2. Behavior

### 2.1 Scope of data
- **Whose:** issues where `assignee = me` (the cached viewer id from `settings`, via `db::load_me`).
- **When:** by **`due_date`**, within the current week computed in **`Asia/Dhaka`**, week starting **Sunday** (per the project's `[REQ]` time/locale rules).
- **State:** any state (not filtered to completed/started).
- **Undated issues are omitted** — no due date means not on the agenda.

### 2.2 Day groups (render order)
1. **Overdue** — `due_date` < this week's Sunday **and** still open (`state_type` not `completed`/`canceled`). Shown only if non-empty. Sorted by due date ascending.
2. **Sunday → Thursday** — one section per weekday; issues whose `due_date` equals that day (all states, including completed/canceled). Each weekday section always renders, even when empty.
3. **Weekend** — Friday/Saturday of this week. Shown only if non-empty.

Within a day group: sort by **priority** (high → low), then **identifier**.

Group headers are **sticky** while scrolling and show: day name · date · muted count badge.

### 2.3 Threaded content (under each top-level row)
Linear-style thread: a vertical hairline rail + ~24px indent, content slightly de-emphasized.

- **Sub-issues** (children via `parent_id`): each rendered as a compact `IssueRow`, clickable to its own drawer. Expanded by default with a chevron to collapse.
- **Related issues** (relations: `blocks` / `blocked_by` / `related` / `duplicate`): a lighter reference list — relation type · identifier · title · state chip. Not clickable rows in v1 beyond opening the drawer (optional).

**Dedup rule:** if a sub-issue is itself one of *my* issues due this week, it appears **only** nested under its parent — not also as a standalone top-level row.

### 2.4 Navigation & interaction
- Reached via a new **dock/sidebar "This Week" entry** + a **command-palette "Go to This Week"** action.
- Clicking any issue (top-level or sub-issue) opens the existing **F2 drawer**.
- Rows are keyboard-focusable; Enter opens the drawer; visible focus rings.
- Reads cache only → **offline-first** holds (shows cached data with no network; a manual resync refreshes it via the existing sync path).

### 2.5 States
- **Weekday empty:** header stays + a quiet muted "Nothing due" line (keeps the week's shape visible).
- **Whole week empty:** a calm centered empty state.
- **Loading:** skeleton rows (not a blocking spinner).

---

## 3. Architecture

**Compute split:** Rust owns the **data assembly** (honoring `requirements.md` §10's `generators/` Rust module); the **frontend owns week-window math** (reusing `src/lib/dates.ts`, the project's `[REQ]` `Asia/Dhaka` tz authority) plus grouping and rendering. This avoids duplicating timezone logic into Rust.

### 3.1 Data layer (Rust)

**New: relations cache.** Relations are not cached today (only fetched live per-issue in the detail query). The "related issues" thread requires them.

- **Migration `0008`** — new `relations` table, denormalized so the agenda renders in one read:
  ```sql
  CREATE TABLE relations (
    issue_id              TEXT NOT NULL,
    related_issue_id      TEXT NOT NULL,
    type                  TEXT NOT NULL,   -- blocks | blocked_by | related | duplicate
    related_identifier    TEXT,
    related_title         TEXT,
    related_state_name    TEXT,
    related_state_type    TEXT,
    related_state_color   TEXT,
    PRIMARY KEY (issue_id, related_issue_id, type)
  );
  CREATE INDEX idx_relations_issue ON relations(issue_id);
  ```
- **Sync change** — add `relations { nodes { type relatedIssue { id identifier title state { name type color } } } }` to the bulk `ISSUE_NODE_FIELDS` (`src-tauri/src/linear/issues.rs`), parse into `ParsedIssue`, and `replace_relations(...)` on upsert (mirrors the existing `replace_labels` pattern).
  - *Tradeoff:* adds nested-connection cost to the workspace-wide sync (Linear's complexity-based limiter). Accepted — relation connections are small per issue, it mirrors the already-present `labels`/`attachments` nested fetches, and it pre-positions F8 (graph viz), which needs relations regardless.

**Sub-issues:** no schema change. Children come from the existing `parent_id` column (already indexed: `idx_issues_parent`). A new query loads children for a set of parent ids.

### 3.2 Backend command

`get_week_agenda(assignee_id, range_start, range_end, overdue_before)`:
- Thin `#[tauri::command]` over a unit-testable async logic fn; registered in `src-tauri/src/lib.rs`.
- Returns the viewer's issues in the due-date range **plus** an overdue set, each enriched with:
  - `children` — sub-issues from `parent_id`.
  - `relations` — from the new relations table.
- Reads cache only. Sanitized `CmdError` per existing convention.
- Window dates are passed in from the frontend (computed via `dates.ts`).

### 3.3 Frontend

- New feature folder `src/features/agenda/`.
- Add a `weekWindow(now)` helper to `src/lib/dates.ts` returning the current Sunday-started week bounds + the overdue cutoff, in `Asia/Dhaka`.
- New typed binding in `src/lib/commands.ts` + a TanStack hook in `src/lib/queries.ts` (workspace-scoped query key, invalidated on sync alongside the existing `WORKSPACE_KEYS`).
- Grouping: bucket results by `due_date` day-string (plain `YYYY-MM-DD` comparison — no tz needed once the window is known) into Overdue / Sun–Thu / Weekend; apply the dedup rule.
- Rendering: reuse `IssueRow` for top-level and (compact variant) sub-issue rows; thread rail + indent; sticky day headers; empty/loading states above.
- Add the dock/sidebar "This Week" entry and the command-palette action.

### 3.4 UI direction (from `ui-ux-pro-max`)
Micro-interactions style on the existing Linear-dark palette + Geist: subtle ~100ms hover transitions, visible focus states, skeleton loading, `prefers-reduced-motion` respected, Lucide (no emoji) icons, dark-mode text contrast ≥ 4.5:1, meaningful empty states.

---

## 4. Testing

- **Rust:** unit tests for relations parse + `replace_relations` upsert, the children query, and the `get_week_agenda` logic fn (range filtering, overdue set, enrichment).
- **Frontend (vitest):** `weekWindow` (Sunday-start, Dhaka, DST-safe via Intl), and the grouping/overdue/dedup logic.

---

## 5. Out of scope / explicitly dropped

- Markdown export and the no-op `polish()` seam (output is now a structured view).
- The original Done / In-progress / Blocked and Completed / Carried / New buckets.
- Completion-time (`completed_at`) tracking — not needed since we track by due date.
- Filtering to other assignees/teams (agenda is "just me"); navigable prev/next weeks (current week only). Both are easy future extensions.

---

## 6. Spec updates required (`requirements.md`)

On implementation, update: **F5**, **F6**, the **M3** milestone line, and **§13 decision 5** to describe this due-date "This Week" agenda and the dropped markdown/polish output. Note the new `relations` cache as a data-model addition (§5).
