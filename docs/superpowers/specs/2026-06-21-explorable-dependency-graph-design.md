# Explorable Dependency Graph — Core (Spec 1)

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Milestone:** M5 (F8 — Issue web / hierarchy viz), agenda graph upgrade
**Branch context:** `m5-dependency-graph`

## Summary

Rework the agenda dependency graph (`src/features/agenda/DependencyGraph.tsx`)
from a fixed, fully-expanded this-week view into an **explorable** graph:
it starts minimal (this-week root issues only) and the user drills inward by
expanding a node's neighbors on demand. Node placement moves from manual
two-column logic to **automatic layout (elkjs)**. Add a MiniMap and a
neighborhood focus-highlight.

This is **Spec 1 of two**. Grouping/sub-flows and multi-select bulk actions are
deferred to Spec 2 (built on this core).

### Superseded (removed in this work)

- **Drag-position persistence** (`savedPositions` + `localStorage`). Auto-layout
  owns positions; dragging is session-only nudging.
- **"Collapse related" → round connector node** (`ConnectorNode`). The
  expand/collapse model replaces it. The `MenuExtraAction` mechanism added for
  it is *kept* and repurposed (see §4).

## Goals

- Readable graph at ~50 nodes (the F8 acceptance bar) via auto-layout.
- Incremental exploration: start from this week's issues, reveal neighbors as
  needed, collapse to refocus.
- Keep the existing visual language: typed/colored edges, the legend, the
  status-tinted issue nodes, hover-cards, the issue context menu, and search.

## Non-goals (→ Spec 2)

- Grouping / sub-flow container nodes (by project / assignee / team).
- Multi-select box-selection and bulk field edits.

## Architecture

Data flow is unchanged from today: Linear → Rust → SQLite → Tauri command →
TanStack Query → React. The graph is a pure consumer of already-cached data
(`useIssues({})`, `useRelations()`, `useMe()`); all exploration state is
client-side. No backend changes.

### Components / units

1. **`graphModel.ts`** (new, pure, unit-tested) — the testable core. No React,
   no React Flow types beyond plain descriptors.
   - `buildIndex(issues, relations)` → an index with: issue-by-id, children-by-
     parent, and relation adjacency (both directions).
   - `neighbors(id, index)` → set of directly-connected issue ids = parent +
     children + relation-connected issues (outgoing `issueId===id` and incoming
     `relatedId===id`).
   - `computeVisible(rootIds, expandedIds, index)` → ordered set of visible
     issue ids. BFS from roots; a node reveals its neighbors **only if it is in
     `expandedIds`**. Roots are always visible. Visited-set guards relation
     cycles. Collapsing (removing an id from `expandedIds`) drops nodes
     reachable only through it (orphan removal) on recompute.
   - `hiddenNeighborCount(id, visibleIds, index)` → number of `neighbors(id)`
     not in `visibleIds` (drives the per-node expand badge).
   - `buildGraphElements(visibleIds, index, viewData)` → `{ nodes, edges }`
     descriptors: one node per visible id (identifier, title, stateColor,
     isRoot, mentionTarget, hiddenCount); edges for parent-child (sub-issue)
     and relations between two visible nodes, deduped, each carrying its
     `EdgeKind` (existing `SUB_ISSUE` / `edgeKind(type)` logic, moved here).

2. **`graphLayout.ts`** (new, thin) — elkjs wrapper.
   - `layout(nodes, edges, opts) → Promise<positionedNodes>` using
     `elkjs/lib/elk.bundled.js`, layered algorithm, direction RIGHT, node sizes
     fed from constants (width 200, height ~48). Returns nodes with `position`.
   - Not unit-tested (async/visual). Kept side-effect-free and small.

3. **`DependencyGraph.tsx`** (reworked) — the React/React Flow shell.
   - State: `expandedIds: Set<string>`, `selectedId: string | null`,
     `query: string` (search, unchanged), and React Flow `nodes`/`edges` state.
   - On `rootIds` / `expandedIds` / data change: recompute visible →
     `buildGraphElements` → `layout` (async) → set positioned nodes; `fitView`.
   - Search highlight (existing `dimmed`/`highlight` flags) takes precedence;
     otherwise selection drives the neighborhood highlight.
   - Renders `<ReactFlow>` with `<Background>`, themed `<Controls>`,
     `<MiniMap>` (node color = state color), `SearchPanel`, the legend `Panel`,
     and a **"Re-layout"** button (re-runs `layout`).

4. **`DependencyGraphPage.tsx`** (minor) — compute `rootIds` from
   `buildAgenda(...).flatMap(items)` and pass `rootIds` + `issues` + `relations`
   to `DependencyGraph` (instead of pre-flattened `items` + `allIssues`).

5. **`IssueContextMenu.tsx`** (minor) — keep the `MenuExtraAction` mechanism;
   the graph now injects **"Expand neighbors" / "Collapse neighbors"** (shown
   only when the node has hidden neighbors / is expanded). No structural change.

### Interaction model

| Gesture | Action |
|---|---|
| Single-click node | Select + highlight neighborhood (dim non-neighbors); click empty canvas clears |
| Double-click node | Open issue drawer (`setParams({ issue })`) |
| Chevron / badge on node | Toggle expand/collapse of that node's neighbors; badge shows hidden-neighbor count; stops propagation |
| Right-click node | Context menu (existing), incl. injected Expand/Collapse action |
| Hover node | Issue hover-card (existing `mountIssueMentionHoverCard`) |
| "Re-layout" button | Re-run elk layout |

Dragging remains enabled (`nodesDraggable`) for session-only nudging; positions
are not persisted and are reset by re-layout or any visible-set change.

## Error / edge handling

- **Empty roots** (nothing due this week): render "Nothing to graph this week"
  (replaces today's edge-based empty check; now root-based).
- **Relation cycles**: BFS visited-set prevents infinite loops.
- **Neighbor that is also a root**: stays visible as a root; still expandable.
- **Related ref not in issues cache**: node still renders from partial relation
  data (existing `mentionTargetFromRelation` fallback); context menu safely
  no-ops if the issue isn't cached (existing behavior).
- **Layout async race**: ignore stale layout results when a newer visible-set
  supersedes (guard with a request token / latest-wins).
- **Offline**: unaffected — reads are cache-only.

## Testing

Vitest unit tests on `graphModel.ts`:
- `computeVisible`: start-minimal (roots only when nothing expanded); expand
  reveals direct neighbors; nested expand reveals next ring; collapse removes
  orphaned descendants but keeps nodes still reachable another way; cycle safety.
- `neighbors`: parent + children + both relation directions, deduped.
- `hiddenNeighborCount`: correct before/after expansion.
- `buildGraphElements`: node-per-visible-id; edges only between visible nodes;
  edge kinds/labels correct; dedup.

`graphLayout.ts` (elk) and the React shell are not unit-tested (async/visual).
Existing `agendaStats` tests are unaffected.

## Dependencies

- Add `elkjs` to `package.json` (import `elkjs/lib/elk.bundled.js`).

## Acceptance criteria

- Graph opens showing only this-week root issues; no neighbors until expanded.
- A node with hidden neighbors shows a count badge; expanding reveals exactly
  its direct neighbors; collapsing removes those (and any now-orphaned).
- Layout is automatic and readable at ~50 visible nodes; "Re-layout" reflows.
- Single-click highlights a node's neighborhood; double-click opens the drawer;
  right-click shows the context menu with an Expand/Collapse action.
- MiniMap reflects the visible graph with state-colored dots.
- Search still highlights/dims and recenters; legend unchanged.
- `tsc` clean; vitest green (incl. new `graphModel` tests); `npm run build` OK.
