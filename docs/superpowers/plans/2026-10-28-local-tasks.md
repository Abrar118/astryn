# Local Tasks — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-28-local-tasks-design.md`. Stacked on the
swappable-tracker branch (module spec 3). Test-first per step.

1. **Migration 0020** — `lt_*` tables.
2. **Rust core** (`src-tauri/src/local_tasks/`) — `db.rs` (tree, workflows with
   remap, sprints, labels, tasks, checklist, comments, links, relations,
   neutral rows/statuses/filter options), `backup.rs` (snapshot, validate,
   restore, daily rotation, safety snapshots), `import.rs` (Linear team copy,
   re-import skip). Unit tests on temp DBs.
3. **Module + commands** — `ModuleId::LocalTasks` (provides `tracker`),
   `commands/local_tasks.rs` (each starts with `require(LocalTasks)`), guard
   map, `remove_module_data` wipe with a final snapshot, report fact source.
4. **TS boundary** — bindings in `commands.ts`; `local-tasks` adapter in
   `tracker.ts` (`lt_` routing, `lt_me` viewer, detail key + patch); merged
   hook tests with two trackers.
5. **Queries** — `localTaskQueries.ts` (tree, rows, detail, writes, daily
   backup hook).
6. **Screens** — `VIEW_META.tasks`; `LocalTasksPage` (sidebar, view switcher,
   filters, N shortcut); List, Board (dnd-kit), Table, Calendar, Timeline;
   `LocalTaskDetail` via `TaskDetail`; `LocalTaskMenu` via the menu provider;
   workflow and sprint dialogs; Settings → Local tasks (backups, import);
   stronger remove-data warning.
7. **Verify** — focused tests, `npm test`, `npm run build`, `cargo test`,
   `cargo clippy`, `cargo fmt -- --check`, `git diff --check`.
