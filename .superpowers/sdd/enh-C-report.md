# enh-C: React Flow Dependency Graph — Implementation Report

## Install

`@xyflow/react` v12.11.0 added to `package.json` / `package-lock.json`.

## Node / Edge Assembly

**Nodes** are built by iterating `items`:
- Each `item.issue` → a "root" (isRoot=true) node placed in the left column.
- Each `item.children[]` → a non-root node placed in the right column + a dashed `smoothstep` edge `item.issue.id → child.id` labeled "sub-issue".
- Each `item.relations[]` → a non-root node placed in the right column + a solid `smoothstep` edge `rel.issueId → rel.relatedId` labeled with `humanizeRelationType(rel.type)`.

Deduplication: a `Map<id, nodeData>` is built; if an id already exists and the incoming data is a root (week item) it overwrites a previously stored non-root entry. Relation-ref partial data is never preferred over a full `IssueListItem` or child entry.

Data preference order: `allIssues` lookup → `item.issue` / `item.children[]` → partial relation fields.

## Hover-card Reuse

`mountIssueMentionHoverCard` from `IssueMentionPill.tsx` is called inside the custom `IssueNode` component on a 150 ms `setTimeout` (matching the CalendarPage pattern). Cleanup (timer clear + returned `() => void`) fires on `mouseleave` and `useEffect` teardown (unmount). `MentionTarget` is constructed via `toMentionTarget(IssueListItem)` when a full issue is available; otherwise a best-effort partial is built from relation fields.

## MentionTarget Exact Fields

Defined in `src/features/drawer/markdownComponents.tsx`:

```ts
type MentionTarget = {
  identifier: string;
  title: string;
  stateType: string;
  stateColor: string;
  stateName: string | null;
  projectName: string | null;
  priority: number;
  assigneeName: string | null;
};
```

## Layout Approach

Hand-computed two-tier columnar layout (no external layout library):
- Left column (x=0): root/week issues stacked with `NODE_HEIGHT (32px) + ROW_GAP (56px)` spacing.
- Right column (x=240): children + relation-only nodes stacked with the same spacing.
- `fitView` with `padding: 0.2` frames the result. `nodesDraggable` is enabled so users can rearrange. `<Background />` and `<Controls />` are included.

## Empty State

Two conditions show the quiet placeholder ("No dependencies this week") instead of an empty canvas:
1. `items.length === 0` — no agenda items at all.
2. `edges.length === 0` — items exist but none have children or relations (zero graph edges were produced). This check runs inside `useMemo`; if `edgeList` is empty the memo returns `{ nodes: [], edges: [] }` early, and the component renders the placeholder.

## tsc / build Results

- `npx tsc --noEmit` → clean (exit 0).
- `npm run build` → succeeded in 3.97 s; only pre-existing chunk-size warnings from mermaid/cytoscape; no type or build errors.

## File Created

`src/features/agenda/DependencyGraph.tsx` — exports `DependencyGraph` component; not yet integrated into `AgendaView` (next task).
