# Dependency Graph — Grouping & Bulk Actions (Spec 2)

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Milestone:** M5 (F8 — Issue web / hierarchy viz), agenda graph power features
**Branch context:** `m5-dependency-graph`
**Builds on:** Spec 1 (`2026-06-21-explorable-dependency-graph-design.md`) — the explorable-graph core (start-minimal, lazy expand/collapse, elk layout, MiniMap, neighborhood highlight).

## Summary

Two independent "power" upgrades to the explorable dependency graph:

1. **Grouping (sub-flows)** — optionally box the visible issues into React Flow
   container nodes by **Status**, **Project**, or **Cycle** (default **None**),
   laid out with elk's hierarchical (nested) layout.
2. **Multi-select bulk actions** — select multiple nodes (React Flow native
   selection) and apply **Status / Assignee / Priority / Due date** to all of
   them at once via a bulk action bar, reusing the existing issue-update path.

The two parts are independent and are implemented as two separate task groups
in the plan; each can be built and reviewed on its own.

## Goals

- Make a busy week legible by grouping related issues into labelled containers.
- Let the user retarget several issues in one gesture instead of one-by-one.
- Reuse the Spec 1 core (visible set, node rendering, edges, search) and the
  existing issue-update mutation/optimistic-rollback path unchanged.

## Non-goals

- New group-by dimensions beyond Status / Project / Cycle.
- Bulk label editing, bulk delete, bulk project/cycle moves (only Status /
  Assignee / Priority / Due in this spec).
- Persisting group-by choice across sessions (session state only).
- Cross-team bulk **Status** (see the team-scoping rule below).

## Architecture

Unchanged data flow: the graph is a pure consumer of cached `useIssues` /
`useRelations` / `useUsers` / `useFilterOptions`. Grouping is a client-side
transform of the already-computed visible set. Bulk actions call the existing
`useUpdateIssue` mutation once per selected id (optimistic; existing rollback).
No backend changes.

### Part A — Grouping (sub-flows)

**Control:** a group-by selector in a top-left Panel (segmented control or
small dropdown): `None | Status | Project | Cycle`. Session state
(`groupBy`), default `None`.

**Model (pure, in `graphModel.ts`, unit-tested):**
- `groupKeyOf(issue, groupBy)` → a stable group key + display label:
  - Status → `issue.stateName` (fallback `"No status"`).
  - Project → `issue.projectName` (fallback `"No project"`).
  - Cycle → `issue.cycleName ?? (cycleNumber != null ? "Cycle N" : "No cycle")`.
  - `None` → no grouping.
- `buildGroups(visibleIds, groupBy, index)` → `GraphGroup[]`
  (`{ id, label, memberIds }`) over the **currently-visible** issue nodes only;
  recomputed whenever the visible set or `groupBy` changes. Issues missing the
  dimension fall into the catch-all group.

**Render:** for each group, a React Flow container node (`type: "group"`) with
the member issue nodes carrying `parentId = group.id` and `extent: "parent"`.
Group node shows the label + member count. Issues with no group (only when
`groupBy === "None"`) render at top level as today.

**Layout (`graphLayout.ts`):** extend the elk wrapper to build a *hierarchical*
elk graph — group nodes as elk parents containing their member children; elk
lays out members within each group and the groups relative to one another
(`elk.algorithm: layered` at both levels, padding for group chrome). When
`groupBy === "None"`, fall back to the existing flat layout. Cross-group edges
(relations/sub-issues whose endpoints are in different groups) are still
emitted and routed by elk. Latest-wins token guard from Spec 1 is retained.

### Part B — Multi-select bulk actions

**Selection model (unifies with Spec 1's single-select highlight):** React Flow
native selection is the single source of truth via `onSelectionChange` →
`selectedIds: string[]` (group container nodes are excluded from the selection
count).
- 0 selected → normal.
- 1 selected → the Spec 1 neighborhood highlight (driven by that id).
- ≥2 selected → a **bulk action bar**; neighborhood highlight is suppressed.

Gestures use React Flow defaults: **Shift+click** adds a node;
**Shift+drag** draws a box selection. Pane click clears. Double-click still
opens the drawer; right-click still opens the per-issue context menu.

**Bulk action bar (`BulkActionBar.tsx`, a Panel):** shows "N selected" and four
controls — **Status**, **Assignee**, **Priority**, **Due date** — each a small
dropdown, plus **Clear**. Choosing a value applies it to every selected id by
calling `useUpdateIssue().mutate({ id, patch })` per id (optimistic; the
existing per-issue rollback applies independently). A brief `goey-toast`
summarises the result.

**Team-scoping rule (Status only):** workflow states are team-scoped. Bulk
**Status** is enabled only when **all** selected issues share one `teamId`
(then the bar shows that team's states); when selection spans teams, the Status
control is disabled with a tooltip "Select issues from one team to set status."
Priority / Assignee / Due are global and always enabled.

**Option-data reuse:** extract the option constants the context menu and the
bar both need — `PRIORITIES` and the due-date presets — into a small shared
module (e.g. `src/features/issues/issueFields.ts`) imported by both, so they
are not duplicated. Assignees come from `useUsers`; team states from the cached
issues / `useFilterOptions` exactly as the context menu derives them.

### Components / units

- **`graphModel.ts`** (extend): `groupKeyOf`, `buildGroups`, and a pure
  `bulkStatusTeamId(selectedIds, index)` → the shared `teamId` or `null`.
- **`graphLayout.ts`** (extend): nested/hierarchical elk layout when grouped;
  existing flat path when `None`.
- **`src/features/issues/issueFields.ts`** (new): shared `PRIORITIES` +
  due-date presets, imported by `IssueContextMenu.tsx` and `BulkActionBar.tsx`.
- **`BulkActionBar.tsx`** (new): the ≥2-selection toolbar.
- **`DependencyGraph.tsx`** (extend): group-by selector, group container node
  type, `onSelectionChange` wiring, bulk bar, selection-driven highlight.

## Error / edge handling

- **Group with one member** still renders as a (small) container — acceptable.
- **All issues missing the dimension** → a single catch-all group.
- **Lazy-expand during grouping** — groups recompute from the new visible set;
  elk re-runs (token guard prevents stale layouts).
- **Bulk apply partial failure** — each id's mutation is independent; failures
  roll back per id and the toast reports the count that failed.
- **Bulk Status across teams** — disabled (see rule), never silently applied.
- **Offline** — grouping works (pure/local); bulk mutations queue/fail per the
  existing offline behaviour of `useUpdateIssue`.

## Testing

Vitest unit tests (pure logic only):
- `groupKeyOf` — each dimension + fallbacks.
- `buildGroups` — membership over a visible set, catch-all bucket, empty when
  `None`.
- `bulkStatusTeamId` — single shared team → id; mixed teams → null.

elk nested layout, the group container rendering, the bulk bar UI, and
selection gestures are visual/integration and not unit-tested. Existing Spec 1
`graphModel` tests remain green.

## Acceptance criteria

- Group-by selector offers None / Status / Project / Cycle; choosing one boxes
  the visible issues into labelled containers with member counts; None restores
  the flat layout.
- Grouped layout is readable; cross-group edges still render; expanding/
  collapsing re-groups and re-lays-out correctly.
- Selecting ≥2 nodes shows the bulk bar; applying Status/Assignee/Priority/Due
  updates every selected issue (optimistic), with a summary toast.
- Bulk Status is disabled when the selection spans teams; enabled (team's
  states) when they share one.
- Single selection still shows the neighborhood highlight; pane click clears.
- `PRIORITIES` / due presets are sourced from one shared module (no
  duplication between the context menu and the bar).
- `tsc` clean; vitest green (incl. new grouping/bulk helper tests);
  `npm run build` OK.
