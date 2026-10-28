# Local Tasks — a second tracker module

**Status:** Approved for build (spec approval waived for this run), 2026-10-28.
**Requirement:** `docs/backlog.md` item 3 (owner decisions 2026-10-28);
`requirements.md` §3 *Module architecture*. Builds on
`2026-10-28-swappable-tracker-design.md` (module spec 3).

## 1. Summary

A `local-tasks` provider module manages tasks without Linear. It provides the
`tracker` capability, so Calendar, This Week, Dependencies, the Dashboard and
Reports work with Linear off, and merge both when both are on. Local tasks
follow ClickUp's structure and flow (spaces → lists → tasks, custom status
workflows, sprints, several views) in Astryn's own calm visual language.
Unlike Linear's cache, SQLite is the **source of truth**, so backup and restore
ship with the first release.

## 2. Model

### 2.1 Hierarchy

- **Space** → **List** → **Task** → subtasks (one level of nesting shown in
  views; deeper parents are allowed in data).
- A list has a short **key** (`OPS`); tasks are numbered per list, giving
  identifiers like `OPS-12`. Moving a task to another list gives it that list's
  next number.
- **Sprints** belong to a space (name, start, end, sequential number).
- **Projects are deferred** (backlog: "projects later"); no table is created
  until they are built.

### 2.2 Custom workflows

- A workflow is an ordered list of statuses `{ name, category, color }` with
  category ∈ `backlog | unstarted | started | completed | canceled` (the neutral
  status categories from spec 3).
- Every space owns a workflow; a list may **override** it with its own. A list
  without an override uses its space's statuses.
- Replacing a workflow re-maps tasks whose status disappeared to the first new
  status of the same category, else the first status.
- New spaces start with: Backlog · To do · In progress · Done · Canceled.

### 2.3 Fields (first release)

Title, Markdown description, status, priority (urgent/high/medium/low/none —
the neutral 1..4/0 scale), assignee (**me** or unassigned), start date, due
date, labels, subtasks, checklists, dependencies (blocks / related), comments,
link attachments, estimate (points), sprint.

### 2.4 Tables (migration `0020_local_tasks.sql`)

`lt_spaces`, `lt_lists`, `lt_statuses` (`scope_id` = space or list),
`lt_sprints`, `lt_labels`, `lt_tasks`, `lt_task_labels`, `lt_checklist_items`,
`lt_relations` (`blocks` / `related`, stored once), `lt_comments`,
`lt_attachments`, `lt_imports` (Linear issue id → local task id, for re-import).
Ids are `lt_` + random hex, so `trackerOf` recognises them.

## 3. Tracker integration

The `local-tasks` adapter maps rows onto the neutral model:

| Neutral | Local |
|---|---|
| `teamId` / `teamKey` (workflow scope) | list id / list key |
| `projectId` / `projectName` | space id / name (until local projects exist) |
| `cycleName` / `cycleNumber` | sprint name / number |
| `stateType` | status category |
| `assigneeId` | `lt_me` when assigned to me |
| `url` | empty (no web page) |

Rows also carry local-only fields (`startDate`, `spaceId`, `sprintId`,
`position`, checklist progress) used by the local views. The local viewer is
`lt_me`; it has no display name, so the Dashboard greeting keeps Linear's name
or falls back to "Your workspace".

## 4. Rust

- `src-tauri/src/local_tasks/` — `db.rs` (all SQL, unit-tested on a temp DB),
  `backup.rs` (snapshot format, auto-backup rotation, restore validation),
  `import.rs` (Linear → local copy).
- `src-tauri/src/commands/local_tasks.rs` — thin commands, each starting with
  `state.require(ModuleId::LocalTasks)?`. Writes run in transactions; there is
  no network, so no generation counter is needed.
- `remove_module_data(local-tasks)` writes a final snapshot to the backups
  folder, then deletes every `lt_*` row.

### 4.1 Backup and restore

- **Format:** one JSON document `{ format: "astryn-local-tasks", version: 1,
  exportedAt, tables: { spaces, lists, statuses, … } }`.
- **Automatic:** once per Dhaka day, the first local-tasks read writes
  `<app data>/backups/local-tasks-YYYY-MM-DD.json`; the newest 14 are kept.
  A snapshot is also written before every restore and before data removal.
- **Manual:** *Export backup…* (native save dialog, in Rust) and *Restore from
  backup…* (native open dialog). File paths never cross IPC. Restore validates
  the format and version, then replaces all local-task data in one transaction.

### 4.2 Linear import

- One-way copy of **cached** Linear issues (no network) of one Linear team into
  a chosen list. Requires both modules on.
- Statuses map by name (missing ones are appended to the list's workflow with
  the Linear category and color); labels by name; priority, dates, estimate,
  description and "assigned to me" copy over; parent links and blocks/related
  relations are kept inside the imported set.
- **Re-import** skips issues already imported (tracked in `lt_imports`), so local
  edits are never overwritten; the result reports imported/skipped counts.

## 5. UI

- **Tasks** screen (`VIEW_META.tasks`, owner `local-tasks`): a sidebar of spaces
  and lists, a list header with the view switcher **List · Board · Table ·
  Calendar · Timeline**, a sprint filter, "Show closed", and **New task**.
- **List:** grouped by status, collapsible groups, inline add per group.
- **Board:** a column per status, drag a card to change status (`@dnd-kit`).
- **Table:** sortable columns (ID, title, status, priority, due, start,
  estimate, sprint).
- **Calendar:** month grid of the list's dated tasks, drag to reschedule.
- **Timeline:** week-scaled bars from start to due date; dateless tasks listed
  below.
- **Drawer:** `TaskDetail` dispatches `lt_` ids to `LocalTaskDetail` —
  ClickUp-like layout: title, a field grid (status, assignee, dates, priority,
  estimate, sprint, labels), description (the shared Markdown editor without
  Linear uploads), subtasks, checklist, dependencies, links, comments.
- **Context menu:** status, priority, due date, open, open in tab, delete.
- **Workflow editor** and **sprint editor** as small dialogs from the sidebar.
- **Settings → Local tasks:** export / restore backups, backups folder, Linear
  import.
- Visuals follow `DESIGN.md`: matte surfaces, status color only as data (the
  user's status colors), priority mapping per the Priority Mapping Rule.

## 6. Rulings

- Workflows per space with optional per-list override.
- Projects deferred; neutral "project" shows the space meanwhile.
- Assignee is "me" or nobody (single-user app).
- Attachments are links only; file attachments are deferred.
- Deleting a task deletes its subtasks, checklist, comments, links and
  relations.
- Relations: `blocks` and `related` only (no `duplicate`).
- Backups: daily automatic snapshot (14 kept) + manual export/restore; restore
  replaces everything after snapshotting the current data.
- Linear import is per team, one-way, cache-only, and never overwrites.

## 7. Deferred

Projects, file attachments, custom fields, recurring tasks, time tracking,
multiple assignees, drag-reorder of spaces/lists, saved view filters,
document links (F9), and a ClickUp provider (backlog item 3, decision 1).

## 8. Testing

- Rust: migration + every DB function on a temp DB (create/update/move/
  delete cascade, workflow replacement remap, relation directions, calendar
  ranges, filter options), backup round trip + rotation + bad-file rejection,
  import mapping + re-import skip, guard coverage.
- Frontend: adapter mapping, merged hooks with two trackers, view helpers
  (grouping, timeline geometry, table sort), drawer and Settings flows.
