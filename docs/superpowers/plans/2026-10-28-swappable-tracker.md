# Swappable Tracker (Module Spec 3) — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-28-swappable-tracker-design.md`.
Each step is test-first and leaves the app building and running.

1. **Tracker model** — `src/lib/tracker.ts`: `TrackerId`, `TRACKERS`,
   `trackerOf`, `ME`, `resolveFilters`, neutral type aliases, Linear adapter.
   Tests: `tracker.test.ts`.
2. **Per-tracker query keys** — move Linear list/calendar/unscheduled/relations/
   filter-options/workflow-states/users keys to `[root, "linear", …]`; scope the
   Linear wipe/resync invalidation to `"linear"` entries.
3. **Merged hooks** — `src/lib/taskQueries.ts` (`useTasks`, `useCalendarTasks`,
   `useUnscheduledTasks`, `useTaskRelations`, `useTaskFilterOptions`,
   `useTaskStatuses`, `useTaskUsers`, `useViewer`, `useActiveTrackers`).
   Tests: merge semantics, inactive trackers, partial errors.
4. **Routed mutations** — `useUpdateTask`, `useDeleteTask`,
   `useCreateTaskRelation`; reconcile only same-tracker cache entries. Tests:
   routing + guard.
5. **Module gating** — `VIEW_META` tracker owner, `tabActive`. Tests.
6. **Pure helpers** — `buildAgenda`, `buildHeatmap`, dashboard functions take
   `viewerIds`. Update tests.
7. **Screens** — Calendar + FilterBar, This Week, Dependencies, bulk bar,
   Dashboard, tab strip, split layout, palette, context-menu provider.
8. **Drawer shell** — `TaskDrawer`, `TaskPage`, `TaskDetail` dispatch; Linear
   body unchanged.
9. **Reports (Rust)** — `FactSource` list in `facts::assemble`; tests.
10. **Verify** — focused tests, `npm test`, `npm run build`, `cargo test`,
    `cargo clippy`, `cargo fmt -- --check`, `git diff --check`.
